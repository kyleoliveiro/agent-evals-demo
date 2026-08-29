<!-- model: openrouter/openai/gpt-5.6-sol | run: 2 | framework: Hono -->

Below is a complete Cloudflare Workers project using Hono, Zod, TypeScript, and Cloudflare KV.

## Project structure

```text
team-task-board-api/
├── src/
│   └── index.ts
├── .dev.vars.example
├── .gitignore
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "Production-ready team task board REST API for Cloudflare Workers",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "cf-typegen": "wrangler types"
  },
  "dependencies": {
    "hono": "4.9.6",
    "zod": "4.1.5"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "4.20250823.0",
    "typescript": "5.9.2",
    "wrangler": "4.32.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": [
      "ES2022",
      "WebWorker"
    ],
    "types": [
      "@cloudflare/workers-types"
    ],
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": [
    "src/**/*.ts"
  ]
}
```

### `wrangler.toml`

```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2026-08-29"
workers_dev = true

[observability]
enabled = true

[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_PREVIEW_KV_NAMESPACE_ID"

[vars]
# Use "*" to allow all browser origins, or provide a comma-separated allowlist.
# Example: "https://app.example.com,https://admin.example.com"
CORS_ORIGIN = "*"
```

### `.dev.vars.example`

```dotenv
API_TOKEN=replace-with-a-long-random-development-token
```

### `.gitignore`

```gitignore
node_modules/
.wrangler/
.dev.vars
dist/
coverage/
*.log
.DS_Store
```

### `src/index.ts`

```ts
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { z } from 'zod'

type TaskStatus = 'todo' | 'in_progress' | 'done'

interface Project {
  id: string
  name: string
  createdAt: string
}

interface Task {
  id: string
  projectId: string
  title: string
  description?: string
  status: TaskStatus
  assignee?: string
  createdAt: string
  updatedAt: string
}

interface TaskIndex {
  id: string
  status: TaskStatus
  createdAt: string
}

interface Bindings {
  TASKS: KVNamespace
  API_TOKEN: string
  CORS_ORIGIN?: string
}

type AppEnv = {
  Bindings: Bindings
}

type ErrorStatus = 400 | 401 | 404 | 405 | 500

interface ErrorBody {
  error: {
    code: string
    message: string
  }
}

class ApiError extends Error {
  readonly status: ErrorStatus
  readonly code: string

  constructor(status: ErrorStatus, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const PROJECT_PREFIX = 'project:'
const TASK_PREFIX = 'task:'
const KV_LIST_LIMIT = 1000
const KV_READ_CONCURRENCY = 50
const KV_DELETE_CONCURRENCY = 50

const app = new Hono<AppEnv>()

const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200)
  })
  .strict()

const taskStatusSchema = z.enum(['todo', 'in_progress', 'done'])

const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(5000).optional(),
    status: taskStatusSchema.default('todo'),
    assignee: z.string().trim().min(1).max(200).optional()
  })
  .strict()

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: taskStatusSchema.optional(),
    assignee: z.string().trim().min(1).max(200).nullable().optional()
  })
  .strict()
  .refine(
    (body) =>
      body.title !== undefined ||
      body.description !== undefined ||
      body.status !== undefined ||
      body.assignee !== undefined,
    {
      message: 'At least one update field must be provided'
    }
  )

const taskQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
})

function projectKey(projectId: string): string {
  return `${PROJECT_PREFIX}${projectId}`
}

function taskPrefix(projectId: string): string {
  return `${TASK_PREFIX}${projectId}:`
}

function taskKey(projectId: string, taskId: string): string {
  return `${taskPrefix(projectId)}${taskId}`
}

function taskIndex(task: Task): TaskIndex {
  return {
    id: task.id,
    status: task.status,
    createdAt: task.createdAt
  }
}

function errorResponse(
  context: Context<AppEnv>,
  status: ErrorStatus,
  code: string,
  message: string
): Response {
  return context.json<ErrorBody>(
    {
      error: {
        code,
        message
      }
    },
    status
  )
}

async function parseJson<T>(
  context: Context<AppEnv>,
  schema: z.ZodType<T>
): Promise<T> {
  let body: unknown

  try {
    body = await context.req.json<unknown>()
  } catch {
    throw new ApiError(
      400,
      'INVALID_JSON',
      'Request body must contain valid JSON'
    )
  }

  const result = schema.safeParse(body)

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        return `${path}${issue.message}`
      })
      .join('; ')

    throw new ApiError(400, 'VALIDATION_ERROR', message)
  }

  return result.data
}

async function getProject(
  kv: KVNamespace,
  projectId: string
): Promise<Project | null> {
  return kv.get<Project>(projectKey(projectId), 'json')
}

async function requireProject(
  kv: KVNamespace,
  projectId: string
): Promise<Project> {
  const project = await getProject(kv, projectId)

  if (!project) {
    throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  }

  return project
}

async function getTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string
): Promise<Task | null> {
  return kv.get<Task>(taskKey(projectId, taskId), 'json')
}

async function requireTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string
): Promise<Task> {
  const task = await getTask(kv, projectId, taskId)

  if (!task) {
    throw new ApiError(404, 'TASK_NOT_FOUND', 'Task not found')
  }

  return task
}

async function listKeys<M>(
  kv: KVNamespace,
  prefix: string
): Promise<Array<{ name: string; metadata?: M }>> {
  const keys: Array<{ name: string; metadata?: M }> = []
  let cursor: string | undefined

  do {
    const result = await kv.list<M>({
      prefix,
      limit: KV_LIST_LIMIT,
      ...(cursor ? { cursor } : {})
    })

    for (const key of result.keys) {
      keys.push({
        name: key.name,
        ...(key.metadata == null ? {} : { metadata: key.metadata })
      })
    }

    if (result.list_complete) {
      cursor = undefined
    } else {
      cursor = result.cursor
    }
  } while (cursor)

  return keys
}

async function mapInChunks<T, R>(
  values: readonly T[],
  chunkSize: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const output: R[] = []

  for (let index = 0; index < values.length; index += chunkSize) {
    const chunk = values.slice(index, index + chunkSize)
    const results = await Promise.all(chunk.map(mapper))
    output.push(...results)
  }

  return output
}

async function deleteKeys(
  kv: KVNamespace,
  keys: readonly string[]
): Promise<void> {
  await mapInChunks(keys, KV_DELETE_CONCURRENCY, async (key) => {
    await kv.delete(key)
  })
}

async function secureTokenEquals(
  receivedToken: string,
  expectedToken: string
): Promise<boolean> {
  const encoder = new TextEncoder()

  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(receivedToken)),
    crypto.subtle.digest('SHA-256', encoder.encode(expectedToken))
  ])

  const receivedBytes = new Uint8Array(receivedHash)
  const expectedBytes = new Uint8Array(expectedHash)

  let difference = 0

  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index]! ^ receivedBytes[index]!
  }

  return difference === 0
}

function allowedOrigin(
  requestOrigin: string | undefined,
  configuredOrigins: string | undefined
): string | null {
  if (!requestOrigin) {
    return null
  }

  const configuration = configuredOrigins?.trim() || '*'

  if (configuration === '*') {
    return '*'
  }

  const allowed = configuration
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return allowed.includes(requestOrigin) ? requestOrigin : null
}

function routeMethods(path: string): string[] | null {
  if (path === '/api/v1/health') {
    return ['GET']
  }

  if (path === '/api/v1/projects') {
    return ['GET', 'POST']
  }

  if (/^\/api\/v1\/projects\/[^/]+$/.test(path)) {
    return ['GET', 'DELETE']
  }

  if (/^\/api\/v1\/projects\/[^/]+\/tasks$/.test(path)) {
    return ['GET', 'POST']
  }

  if (/^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+$/.test(path)) {
    return ['GET', 'PATCH', 'DELETE']
  }

  return null
}

async function requestLogger(context: Context<AppEnv>, next: Next) {
  const startedAt = performance.now()

  try {
    await next()
  } finally {
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100

    console.log(
      JSON.stringify({
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs
      })
    )
  }
}

async function corsMiddleware(context: Context<AppEnv>, next: Next) {
  const origin = context.req.header('Origin')
  const resolvedOrigin = allowedOrigin(origin, context.env.CORS_ORIGIN)
  const methods = routeMethods(context.req.path)

  const applyCorsHeaders = () => {
    if (!resolvedOrigin) {
      return
    }

    context.header('Access-Control-Allow-Origin', resolvedOrigin)
    context.header(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type'
    )
    context.header(
      'Access-Control-Allow-Methods',
      methods?.join(', ') ?? 'GET, POST, PATCH, DELETE, OPTIONS'
    )
    context.header('Access-Control-Max-Age', '86400')

    if (resolvedOrigin !== '*') {
      context.header('Vary', 'Origin')
    }
  }

  const requestedMethod = context.req.header('Access-Control-Request-Method')

  if (
    context.req.method === 'OPTIONS' &&
    origin &&
    requestedMethod &&
    methods?.includes(requestedMethod.toUpperCase())
  ) {
    applyCorsHeaders()
    return context.body(null, 204)
  }

  await next()
  applyCorsHeaders()
}

async function authMiddleware(context: Context<AppEnv>, next: Next) {
  if (
    context.req.method === 'OPTIONS' ||
    context.req.path === '/api/v1/health'
  ) {
    await next()
    return
  }

  const expectedToken = context.env.API_TOKEN

  if (!expectedToken) {
    console.error('API_TOKEN secret binding is missing')
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'The service is not configured correctly'
    )
  }

  const authorization = context.req.header('Authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)

  if (!match?.[1]) {
    throw new ApiError(
      401,
      'UNAUTHORIZED',
      'A valid bearer token is required'
    )
  }

  const valid = await secureTokenEquals(match[1], expectedToken)

  if (!valid) {
    throw new ApiError(
      401,
      'UNAUTHORIZED',
      'A valid bearer token is required'
    )
  }

  await next()
}

app.use('*', requestLogger)
app.use('*', corsMiddleware)
app.use('/api/v1/*', authMiddleware)

app.get('/api/v1/health', (context) => {
  return context.json({ ok: true })
})

app.get('/api/v1/projects', async (context) => {
  const entries = await listKeys<Project>(context.env.TASKS, PROJECT_PREFIX)

  const projects = await mapInChunks(
    entries,
    KV_READ_CONCURRENCY,
    async (entry): Promise<Project | null> => {
      if (entry.metadata) {
        return entry.metadata
      }

      return context.env.TASKS.get<Project>(entry.name, 'json')
    }
  )

  const filtered = projects
    .filter((project): project is Project => project !== null)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    )

  return context.json(filtered)
})

app.post('/api/v1/projects', async (context) => {
  const body = await parseJson(context, createProjectSchema)
  const now = new Date().toISOString()

  const project: Project = {
    id: crypto.randomUUID(),
    name: body.name,
    createdAt: now
  }

  await context.env.TASKS.put(
    projectKey(project.id),
    JSON.stringify(project),
    {
      metadata: project
    }
  )

  return context.json(project, 201)
})

app.get('/api/v1/projects/:projectId', async (context) => {
  const project = await requireProject(
    context.env.TASKS,
    context.req.param('projectId')
  )

  return context.json(project)
})

app.delete('/api/v1/projects/:projectId', async (context) => {
  const projectId = context.req.param('projectId')

  await requireProject(context.env.TASKS, projectId)

  /*
   * Delete the project first so subsequent task-creation requests fail their
   * project existence check. KV is eventually consistent and does not provide
   * multi-key transactions, but this ordering minimizes creation of orphans.
   */
  await context.env.TASKS.delete(projectKey(projectId))

  const taskEntries = await listKeys(
    context.env.TASKS,
    taskPrefix(projectId)
  )

  await deleteKeys(
    context.env.TASKS,
    taskEntries.map((entry) => entry.name)
  )

  return context.body(null, 204)
})

app.get('/api/v1/projects/:projectId/tasks', async (context) => {
  const projectId = context.req.param('projectId')
  await requireProject(context.env.TASKS, projectId)

  const queryResult = taskQuerySchema.safeParse({
    status: context.req.query('status'),
    page: context.req.query('page'),
    pageSize: context.req.query('pageSize')
  })

  if (!queryResult.success) {
    const message = queryResult.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        return `${path}${issue.message}`
      })
      .join('; ')

    throw new ApiError(400, 'VALIDATION_ERROR', message)
  }

  const { status, page, pageSize } = queryResult.data

  const entries = await listKeys<TaskIndex>(
    context.env.TASKS,
    taskPrefix(projectId)
  )

  /*
   * New records always have metadata. The fallback handles records written by
   * older versions or imported directly into the namespace.
   */
  const indexedEntries = await mapInChunks(
    entries,
    KV_READ_CONCURRENCY,
    async (entry): Promise<{ key: string; index: TaskIndex } | null> => {
      if (entry.metadata) {
        return {
          key: entry.name,
          index: entry.metadata
        }
      }

      const task = await context.env.TASKS.get<Task>(entry.name, 'json')

      if (!task) {
        return null
      }

      return {
        key: entry.name,
        index: taskIndex(task)
      }
    }
  )

  const filteredEntries = indexedEntries
    .filter(
      (
        entry
      ): entry is {
        key: string
        index: TaskIndex
      } => entry !== null
    )
    .filter((entry) => !status || entry.index.status === status)
    .sort(
      (left, right) =>
        right.index.createdAt.localeCompare(left.index.createdAt) ||
        left.index.id.localeCompare(right.index.id)
    )

  const total = filteredEntries.length
  const offset = (page - 1) * pageSize
  const pageEntries = filteredEntries.slice(offset, offset + pageSize)

  const tasks = await mapInChunks(
    pageEntries,
    KV_READ_CONCURRENCY,
    async (entry) => context.env.TASKS.get<Task>(entry.key, 'json')
  )

  const items = tasks.filter((task): task is Task => task !== null)

  return context.json({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize)
  })
})

app.post('/api/v1/projects/:projectId/tasks', async (context) => {
  const projectId = context.req.param('projectId')
  await requireProject(context.env.TASKS, projectId)

  const body = await parseJson(context, createTaskSchema)
  const now = new Date().toISOString()

  const task: Task = {
    id: crypto.randomUUID(),
    projectId,
    title: body.title,
    ...(body.description === undefined
      ? {}
      : { description: body.description }),
    status: body.status,
    ...(body.assignee === undefined ? {} : { assignee: body.assignee }),
    createdAt: now,
    updatedAt: now
  }

  await context.env.TASKS.put(
    taskKey(projectId, task.id),
    JSON.stringify(task),
    {
      metadata: taskIndex(task)
    }
  )

  return context.json(task, 201)
})

app.get(
  '/api/v1/projects/:projectId/tasks/:taskId',
  async (context) => {
    const projectId = context.req.param('projectId')
    const taskId = context.req.param('taskId')

    await requireProject(context.env.TASKS, projectId)
    const task = await requireTask(context.env.TASKS, projectId, taskId)

    return context.json(task)
  }
)

app.patch(
  '/api/v1/projects/:projectId/tasks/:taskId',
  async (context) => {
    const projectId = context.req.param('projectId')
    const taskId = context.req.param('taskId')

    await requireProject(context.env.TASKS, projectId)

    const existing = await requireTask(
      context.env.TASKS,
      projectId,
      taskId
    )

    const body = await parseJson(context, updateTaskSchema)

    const updated: Task = {
      ...existing,
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.status === undefined ? {} : { status: body.status }),
      updatedAt: new Date().toISOString()
    }

    if (body.description === null) {
      delete updated.description
    } else if (body.description !== undefined) {
      updated.description = body.description
    }

    if (body.assignee === null) {
      delete updated.assignee
    } else if (body.assignee !== undefined) {
      updated.assignee = body.assignee
    }

    await context.env.TASKS.put(
      taskKey(projectId, taskId),
      JSON.stringify(updated),
      {
        metadata: taskIndex(updated)
      }
    )

    return context.json(updated)
  }
)

app.delete(
  '/api/v1/projects/:projectId/tasks/:taskId',
  async (context) => {
    const projectId = context.req.param('projectId')
    const taskId = context.req.param('taskId')

    await requireProject(context.env.TASKS, projectId)
    await requireTask(context.env.TASKS, projectId, taskId)

    await context.env.TASKS.delete(taskKey(projectId, taskId))

    return context.body(null, 204)
  }
)

app.notFound((context) => {
  const methods = routeMethods(context.req.path)

  if (methods && !methods.includes(context.req.method)) {
    context.header('Allow', methods.join(', '))

    return errorResponse(
      context,
      405,
      'METHOD_NOT_ALLOWED',
      `Method ${context.req.method} is not allowed for this resource`
    )
  }

  return errorResponse(
    context,
    404,
    'NOT_FOUND',
    'The requested resource was not found'
  )
})

app.onError((error, context) => {
  if (error instanceof ApiError) {
    return errorResponse(context, error.status, error.code, error.message)
  }

  console.error(
    JSON.stringify({
      message: 'Unexpected request error',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
  )

  return errorResponse(
    context,
    500,
    'INTERNAL_ERROR',
    'An unexpected error occurred'
  )
})

export default app
```

### `README.md`

```md
# Team Task Board API

A Cloudflare Workers REST API built with TypeScript, Hono, Zod, and Cloudflare KV.

## Requirements

- Node.js 20 or newer
- A Cloudflare account
- Wrangler authentication

## Installation

```bash
npm install
```

## Create the KV namespaces

Create the production namespace:

```bash
npx wrangler kv namespace create TASKS
```

Create a preview/development namespace:

```bash
npx wrangler kv namespace create TASKS --preview
```

Copy the returned IDs into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TASKS"
id = "YOUR_PRODUCTION_NAMESPACE_ID"
preview_id = "YOUR_PREVIEW_NAMESPACE_ID"
```

## Configure the API token

For deployed environments, store the API token as a Worker secret:

```bash
npx wrangler secret put API_TOKEN
```

For local development:

```bash
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars`:

```dotenv
API_TOKEN=your-local-development-token
```

Do not commit `.dev.vars`.

## Configure CORS

`wrangler.toml` defaults to allowing all browser origins:

```toml
[vars]
CORS_ORIGIN = "*"
```

A comma-separated origin allowlist can be used instead:

```toml
CORS_ORIGIN = "https://app.example.com,https://admin.example.com"
```

## Local development

```bash
npm run dev
```

The API is normally available at:

```text
http://localhost:8787/api/v1
```

## Type checking

```bash
npm run typecheck
```

## Deployment

```bash
npm run deploy
```

## Authentication

Every endpoint except `GET /api/v1/health` requires:

```http
Authorization: Bearer YOUR_API_TOKEN
```

CORS preflight requests do not require authentication.

## Endpoints

| Method | Path |
|---|---|
| GET | `/api/v1/health` |
| GET | `/api/v1/projects` |
| POST | `/api/v1/projects` |
| GET | `/api/v1/projects/:projectId` |
| DELETE | `/api/v1/projects/:projectId` |
| GET | `/api/v1/projects/:projectId/tasks` |
| POST | `/api/v1/projects/:projectId/tasks` |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` |

## Examples

Set local variables:

```bash
export API_BASE_URL="http://localhost:8787/api/v1"
export API_TOKEN="your-local-development-token"
```

### Health check

```bash
curl "$API_BASE_URL/health"
```

### Create a project

```bash
curl -X POST "$API_BASE_URL/projects" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Website launch"
  }'
```

### List projects

```bash
curl "$API_BASE_URL/projects" \
  -H "Authorization: Bearer $API_TOKEN"
```

### Create a task

```bash
curl -X POST "$API_BASE_URL/projects/PROJECT_ID/tasks" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Prepare launch checklist",
    "description": "Verify monitoring and rollback procedures.",
    "status": "todo",
    "assignee": "alice@example.com"
  }'
```

### List tasks

```bash
curl \
  "$API_BASE_URL/projects/PROJECT_ID/tasks?status=todo&page=1&pageSize=20" \
  -H "Authorization: Bearer $API_TOKEN"
```

The task-list response has this form:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0,
  "totalPages": 0
}
```

### Update a task

```bash
curl -X PATCH \
  "$API_BASE_URL/projects/PROJECT_ID/tasks/TASK_ID" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "assignee": "bob@example.com"
  }'
```

`description` and `assignee` can be set to `null` in a PATCH request to remove them:

```json
{
  "description": null,
  "assignee": null
}
```

## Error format

Errors consistently use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "name: Too small: expected string to have >=1 characters"
  }
}
```

## KV consistency note

Cloudflare KV is eventually consistent and does not support multi-key transactions. This API deletes a project record before deleting its associated task records so new task-creation requests fail the project existence check as early as possible.

For workflows requiring strong consistency, transactions, or high-contention concurrent writes, Cloudflare D1 or Durable Objects would be a better storage layer.
```