<!-- model: openrouter/anthropic/claude-opus-5 | run: 1 | framework: Hono -->

Below is a complete, production-ready Cloudflare Workers project using **Hono** (tiny, fast, Workers-native router with built-in CORS) and **Zod** for validation, plus tests with `@cloudflare/vitest-pool-workers`.

---

## Project layout

```
task-board-api/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── vitest.config.ts
├── .dev.vars.example
├── .gitignore
├── README.md
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── errors.ts
│   ├── schemas.ts
│   ├── store.ts
│   ├── routes/
│   │   ├── projects.ts
│   │   └── tasks.ts
│   └── middleware/
│       ├── auth.ts
│       ├── logger.ts
│       ├── store.ts
│       └── notFound.ts
└── test/
    └── api.test.ts
```

---

### `package.json`

```json
{
  "name": "task-board-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Team task board REST API on Cloudflare Workers",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "cf-typegen": "wrangler types"
  },
  "dependencies": {
    "hono": "^4.6.14",
    "zod": "^3.23.8",
    "@hono/zod-validator": "^0.4.2"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.35",
    "@cloudflare/workers-types": "^4.20241230.0",
    "typescript": "^5.7.2",
    "vitest": "2.1.8",
    "wrangler": "^3.99.0"
  }
}
```

---

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "verbatimModuleSyntax": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

---

### `wrangler.toml`

```toml
name = "task-board-api"
main = "src/index.ts"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = true

[observability]
enabled = true

# Public, non-secret config
[vars]
ENVIRONMENT = "development"
# Comma-separated list of allowed browser origins, or "*" for any.
CORS_ALLOWED_ORIGINS = "*"

# KV namespace holding both projects and tasks.
# Create with:  npx wrangler kv namespace create TASKS
#               npx wrangler kv namespace create TASKS --preview
[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_PREVIEW_KV_NAMESPACE_ID"

# API_TOKEN is a *secret*, never put it in this file.
#   Local dev : add API_TOKEN=... to .dev.vars
#   Deployed  : npx wrangler secret put API_TOKEN

[env.production]
name = "task-board-api-prod"

[env.production.vars]
ENVIRONMENT = "production"
CORS_ALLOWED_ORIGINS = "https://board.example.com"

[[env.production.kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_YOUR_PROD_KV_NAMESPACE_ID"
```

---

### `.dev.vars.example`

```
# Copy to .dev.vars (git-ignored) for `wrangler dev`
API_TOKEN=dev-super-secret-token
```

---

### `.gitignore`

```
node_modules/
.wrangler/
.dev.vars
dist/
*.log
```

---

### `src/types.ts`

```ts
import type { Store } from './store';

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
}

/** Bindings declared in wrangler.toml / secrets. */
export interface Bindings {
  TASKS: KVNamespace;
  API_TOKEN: string;
  ENVIRONMENT?: string;
  CORS_ALLOWED_ORIGINS?: string;
}

export interface Variables {
  requestId: string;
  store: Store;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}
```

---

### `src/errors.ts`

```ts
import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'payload_too_large'
  | 'internal_error';

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId?: string;
  };
}

/** Any error thrown as ApiError is rendered verbatim to the client. */
export class ApiError extends Error {
  readonly status: StatusCode;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];
  readonly headers?: Record<string, string>;

  constructor(
    status: StatusCode,
    code: ErrorCode,
    message: string,
    options?: { details?: ErrorDetail[]; headers?: Record<string, string> }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.headers = options?.headers;
  }

  static badRequest(message: string, details?: ErrorDetail[]) {
    return new ApiError(400, 'validation_error', message, { details });
  }
  static unauthorized(message = 'Missing or invalid credentials.') {
    return new ApiError(401, 'unauthorized', message, {
      headers: { 'WWW-Authenticate': 'Bearer realm="api", charset="UTF-8"' },
    });
  }
  static notFound(message = 'Resource not found.') {
    return new ApiError(404, 'not_found', message);
  }
  static methodNotAllowed(allowed: string[]) {
    return new ApiError(405, 'method_not_allowed', 'HTTP method not allowed for this resource.', {
      headers: { Allow: allowed.join(', ') },
    });
  }
  static internal(message = 'An unexpected error occurred.') {
    return new ApiError(500, 'internal_error', message);
  }
}

export function errorBody(
  code: ErrorCode,
  message: string,
  extra?: { details?: ErrorDetail[]; requestId?: string }
): ErrorBody {
  return {
    error: {
      code,
      message,
      ...(extra?.details?.length ? { details: extra.details } : {}),
      ...(extra?.requestId ? { requestId: extra.requestId } : {}),
    },
  };
}

/** Render an ApiError (or anything else) as a consistent JSON response. */
export function renderError(c: Context, err: unknown): Response {
  const requestId = c.get('requestId') as string | undefined;

  if (err instanceof ApiError) {
    const res = c.json(
      errorBody(err.code, err.message, { details: err.details, requestId }),
      err.status as 400
    );
    for (const [k, v] of Object.entries(err.headers ?? {})) res.headers.set(k, v);
    return res;
  }

  // Unknown/unexpected error: never leak internals to the client.
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'unhandled_exception',
      requestId,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    })
  );
  return c.json(errorBody('internal_error', 'An unexpected error occurred.', { requestId }), 500);
}
```

---

### `src/schemas.ts`

```ts
import { z } from 'zod';
import type { ZodError } from 'zod';
import type { ErrorDetail } from './errors';

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);

const trimmed = (max: number) => z.string().trim().max(max);

export const createProjectSchema = z
  .object({
    name: trimmed(120).min(1, 'name must not be empty'),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: trimmed(200).min(1, 'title must not be empty'),
    description: trimmed(2000).optional(),
    status: taskStatusSchema.default('todo'),
    assignee: trimmed(120).optional(),
  })
  .strict();

/**
 * PATCH body: every field optional, at least one required.
 * `null` explicitly clears an optional field.
 */
export const updateTaskSchema = z
  .object({
    title: trimmed(200).min(1, 'title must not be empty').optional(),
    description: trimmed(2000).nullable().optional(),
    status: taskStatusSchema.optional(),
    assignee: trimmed(120).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one of title, description, status or assignee must be provided.',
  });

export const listTasksQuerySchema = z
  .object({
    status: taskStatusSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

export const idParamSchema = z.object({
  projectId: z.string().min(1).max(128),
});

export const taskParamSchema = z.object({
  projectId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
```

---

### `src/store.ts`

KV access layer. Keys: `project:<projectId>` and `task:<projectId>:<taskId>`, so a project's tasks are a single prefix scan and deletes cascade cleanly.

```ts
import { ApiError } from './errors';
import type { CreateProjectInput, CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './schemas';
import type { Paginated, Project, Task } from './types';

const PROJECT_PREFIX = 'project:';
const TASK_PREFIX = 'task:';
const KV_LIST_LIMIT = 1000;
const CONCURRENCY = 32;

const projectKey = (projectId: string) => `${PROJECT_PREFIX}${projectId}`;
const taskKey = (projectId: string, taskId: string) => `${TASK_PREFIX}${projectId}:${taskId}`;
const taskPrefix = (projectId: string) => `${TASK_PREFIX}${projectId}:`;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export class Store {
  constructor(private readonly kv: KVNamespace) {}

  // ---------------------------------------------------------------- projects

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    await this.kv.put(projectKey(project.id), JSON.stringify(project));
    return project;
  }

  async getProject(projectId: string): Promise<Project | null> {
    return await this.kv.get<Project>(projectKey(projectId), 'json');
  }

  /** Throws a 404 ApiError if the project does not exist. */
  async requireProject(projectId: string): Promise<Project> {
    const project = await this.getProject(projectId);
    if (!project) throw ApiError.notFound(`Project '${projectId}' was not found.`);
    return project;
  }

  async listProjects(): Promise<Project[]> {
    const keys = await this.listKeys(PROJECT_PREFIX);
    const projects = await mapWithConcurrency(keys, CONCURRENCY, (key) =>
      this.kv.get<Project>(key, 'json')
    );
    return projects
      .filter((p): p is Project => p !== null)
      .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : b.createdAt.localeCompare(a.createdAt)));
  }

  /** Deletes the project and every task belonging to it. Returns tasks removed. */
  async deleteProject(projectId: string): Promise<number> {
    await this.requireProject(projectId);
    const taskKeys = await this.listKeys(taskPrefix(projectId));
    await mapWithConcurrency(taskKeys, CONCURRENCY, (key) => this.kv.delete(key));
    await this.kv.delete(projectKey(projectId));
    return taskKeys.length;
  }

  // ------------------------------------------------------------------- tasks

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    await this.requireProject(projectId);
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      projectId,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      status: input.status,
      ...(input.assignee ? { assignee: input.assignee } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.kv.put(taskKey(projectId, task.id), JSON.stringify(task));
    return task;
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    return await this.kv.get<Task>(taskKey(projectId, taskId), 'json');
  }

  async requireTask(projectId: string, taskId: string): Promise<Task> {
    await this.requireProject(projectId);
    const task = await this.getTask(projectId, taskId);
    if (!task) throw ApiError.notFound(`Task '${taskId}' was not found in project '${projectId}'.`);
    return task;
  }

  async listTasks(projectId: string, query: ListTasksQuery): Promise<Paginated<Task>> {
    await this.requireProject(projectId);

    const keys = await this.listKeys(taskPrefix(projectId));
    const loaded = await mapWithConcurrency(keys, CONCURRENCY, (key) => this.kv.get<Task>(key, 'json'));

    const tasks = loaded
      .filter((t): t is Task => t !== null)
      .filter((t) => (query.status ? t.status === query.status : true))
      .sort((a, b) =>
        a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : b.createdAt.localeCompare(a.createdAt)
      );

    const total = tasks.length;
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const start = (query.page - 1) * query.pageSize;
    const data = tasks.slice(start, start + query.pageSize);

    return {
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
        hasMore: start + data.length < total,
      },
    };
  }

  async updateTask(projectId: string, taskId: string, patch: UpdateTaskInput): Promise<Task> {
    const current = await this.requireTask(projectId, taskId);
    const next: Task = { ...current, updatedAt: new Date().toISOString() };

    if (patch.title !== undefined) next.title = patch.title;
    if (patch.status !== undefined) next.status = patch.status;

    if (patch.description !== undefined) {
      if (patch.description === null || patch.description === '') delete next.description;
      else next.description = patch.description;
    }
    if (patch.assignee !== undefined) {
      if (patch.assignee === null || patch.assignee === '') delete next.assignee;
      else next.assignee = patch.assignee;
    }

    await this.kv.put(taskKey(projectId, taskId), JSON.stringify(next));
    return next;
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.requireTask(projectId, taskId);
    await this.kv.delete(taskKey(projectId, taskId));
  }

  // ------------------------------------------------------------------ helper

  private async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const result = await this.kv.list({ prefix, limit: KV_LIST_LIMIT, ...(cursor ? { cursor } : {}) });
      for (const key of result.keys) keys.push(key.name);
      if (result.list_complete) break;
      cursor = result.cursor;
    }
    return keys;
  }
}
```

---

### `src/middleware/logger.ts`

```ts
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';

/**
 * Assigns a request id and emits one structured log line per request
 * containing method, path, status and duration in milliseconds.
 */
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const started = Date.now();
  const requestId = c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);

  const url = new URL(c.req.url);

  try {
    await next();
  } finally {
    const durationMs = Date.now() - started;
    c.res.headers.set('x-request-id', requestId);
    c.res.headers.set('server-timing', `app;dur=${durationMs}`);

    console.log(
      JSON.stringify({
        level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
        msg: 'request',
        requestId,
        method: c.req.method,
        path: url.pathname,
        query: url.search || undefined,
        status: c.res.status,
        durationMs,
        env: c.env.ENVIRONMENT,
        ip: c.req.header('cf-connecting-ip'),
        ua: c.req.header('user-agent'),
      })
    );
  }
});
```

---

### `src/middleware/auth.ts`

```ts
import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

/** Constant-time string comparison to avoid leaking the token via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= (aBytes[i] as number) ^ (bBytes[i] as number);
  return diff === 0;
}

const PUBLIC_PATHS = new Set(['/api/v1/health']);

/** Requires `Authorization: Bearer <API_TOKEN>` on every route except /health. */
export const bearerAuth = createMiddleware<AppEnv>(async (c, next) => {
  // CORS preflight must never require credentials.
  if (c.req.method === 'OPTIONS') return next();
  if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) return next();

  const expected = c.env.API_TOKEN;
  if (!expected) {
    console.error(JSON.stringify({ level: 'error', msg: 'missing_api_token_binding' }));
    throw ApiError.internal('Server is misconfigured.');
  }

  const header = c.req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw ApiError.unauthorized('Authorization header must be "Bearer <token>".');

  if (!timingSafeEqual((match[1] as string).trim(), expected)) {
    throw ApiError.unauthorized('Invalid API token.');
  }

  return next();
});
```

---

### `src/middleware/store.ts`

```ts
import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors';
import { Store } from '../store';
import type { AppEnv } from '../types';

/** Makes a Store instance available as c.get('store'). */
export const withStore = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.env.TASKS) {
    console.error(JSON.stringify({ level: 'error', msg: 'missing_kv_binding', binding: 'TASKS' }));
    throw ApiError.internal('Server is misconfigured.');
  }
  c.set('store', new Store(c.env.TASKS));
  return next();
});
```

---

### `src/middleware/notFound.ts`

Hono answers unmatched *methods* with 404; this table lets us distinguish "no such resource" (404) from "wrong verb" (405, with an `Allow` header).

```ts
import type { Context } from 'hono';
import { ApiError, errorBody, renderError } from '../errors';
import type { AppEnv } from '../types';

interface RouteDef {
  /** Path segments; ':' prefix marks a parameter. */
  segments: string[];
  methods: string[];
}

const ROUTES: RouteDef[] = [
  { segments: ['api', 'v1', 'health'], methods: ['GET'] },
  { segments: ['api', 'v1', 'projects'], methods: ['GET', 'POST'] },
  { segments: ['api', 'v1', 'projects', ':projectId'], methods: ['GET', 'DELETE'] },
  { segments: ['api', 'v1', 'projects', ':projectId', 'tasks'], methods: ['GET', 'POST'] },
  {
    segments: ['api', 'v1', 'projects', ':projectId', 'tasks', ':taskId'],
    methods: ['GET', 'PATCH', 'DELETE'],
  },
];

function matches(route: RouteDef, segments: string[]): boolean {
  if (route.segments.length !== segments.length) return false;
  return route.segments.every((s, i) => s.startsWith(':') || s === segments[i]);
}

export function notFoundHandler(c: Context<AppEnv>): Response {
  const segments = new URL(c.req.url).pathname.split('/').filter(Boolean);
  const route = ROUTES.find((r) => matches(r, segments));

  if (route && !route.methods.includes(c.req.method)) {
    return renderError(c, ApiError.methodNotAllowed([...route.methods, 'OPTIONS']));
  }

  return c.json(
    errorBody('not_found', `Route ${c.req.method} ${new URL(c.req.url).pathname} does not exist.`, {
      requestId: c.get('requestId'),
    }),
    404
  );
}
```

---

### `src/routes/projects.ts`

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ApiError } from '../errors';
import { createProjectSchema, idParamSchema, zodDetails } from '../schemas';
import type { AppEnv } from '../types';
import { tasks } from './tasks';

const validationHook = (result: { success: boolean; error?: any }) => {
  if (!result.success) {
    throw ApiError.badRequest('Request validation failed.', zodDetails(result.error));
  }
};

export const projects = new Hono<AppEnv>();

// GET /projects
projects.get('/', async (c) => {
  const data = await c.get('store').listProjects();
  return c.json({ data });
});

// POST /projects
projects.post('/', zValidator('json', createProjectSchema, validationHook), async (c) => {
  const project = await c.get('store').createProject(c.req.valid('json'));
  return c.json({ data: project }, 201, { Location: `/api/v1/projects/${project.id}` });
});

// GET /projects/:projectId
projects.get('/:projectId', zValidator('param', idParamSchema, validationHook), async (c) => {
  const { projectId } = c.req.valid('param');
  const project = await c.get('store').requireProject(projectId);
  return c.json({ data: project });
});

// DELETE /projects/:projectId  (cascades to tasks)
projects.delete('/:projectId', zValidator('param', idParamSchema, validationHook), async (c) => {
  const { projectId } = c.req.valid('param');
  const deletedTasks = await c.get('store').deleteProject(projectId);
  return c.json({ data: { id: projectId, deleted: true, deletedTasks } });
});

// Nested task routes
projects.route('/:projectId/tasks', tasks);
```

---

### `src/routes/tasks.ts`

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ApiError } from '../errors';
import {
  createTaskSchema,
  listTasksQuerySchema,
  taskParamSchema,
  updateTaskSchema,
  idParamSchema,
  zodDetails,
} from '../schemas';
import type { AppEnv } from '../types';

const validationHook = (result: { success: boolean; error?: any }) => {
  if (!result.success) {
    throw ApiError.badRequest('Request validation failed.', zodDetails(result.error));
  }
};

export const tasks = new Hono<AppEnv>();

// GET /projects/:projectId/tasks?status=&page=&pageSize=
tasks.get(
  '/',
  zValidator('param', idParamSchema, validationHook),
  zValidator('query', listTasksQuerySchema, validationHook),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const result = await c.get('store').listTasks(projectId, c.req.valid('query'));
    return c.json(result);
  }
);

// POST /projects/:projectId/tasks
tasks.post(
  '/',
  zValidator('param', idParamSchema, validationHook),
  zValidator('json', createTaskSchema, validationHook),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const task = await c.get('store').createTask(projectId, c.req.valid('json'));
    return c.json({ data: task }, 201, {
      Location: `/api/v1/projects/${projectId}/tasks/${task.id}`,
    });
  }
);

// GET /projects/:projectId/tasks/:taskId
tasks.get('/:taskId', zValidator('param', taskParamSchema, validationHook), async (c) => {
  const { projectId, taskId } = c.req.valid('param');
  const task = await c.get('store').requireTask(projectId, taskId);
  return c.json({ data: task });
});

// PATCH /projects/:projectId/tasks/:taskId
tasks.patch(
  '/:taskId',
  zValidator('param', taskParamSchema, validationHook),
  zValidator('json', updateTaskSchema, validationHook),
  async (c) => {
    const { projectId, taskId } = c.req.valid('param');
    const task = await c.get('store').updateTask(projectId, taskId, c.req.valid('json'));
    return c.json({ data: task });
  }
);

// DELETE /projects/:projectId/tasks/:taskId
tasks.delete('/:taskId', zValidator('param', taskParamSchema, validationHook), async (c) => {
  const { projectId, taskId } = c.req.valid('param');
  await c.get('store').deleteTask(projectId, taskId);
  return c.json({ data: { id: taskId, deleted: true } });
});

// Guard against unsupported verbs slipping through as ApiError-free 404s
tasks.all('*', () => {
  throw ApiError.notFound('Route does not exist.');
});
```

---

### `src/index.ts`

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { ApiError, errorBody, renderError } from './errors';
import { bearerAuth } from './middleware/auth';
import { requestLogger } from './middleware/logger';
import { notFoundHandler } from './middleware/notFound';
import { withStore } from './middleware/store';
import { projects } from './routes/projects';
import type { AppEnv } from './types';

const MAX_BODY_BYTES = 64 * 1024; // 64 KiB is plenty for these payloads

const app = new Hono<AppEnv>();

/* ------------------------------- middleware ------------------------------ */

app.use('*', requestLogger);
app.use('*', secureHeaders());

app.use('*', (c, next) =>
  cors({
    origin: (origin) => {
      const configured = (c.env.CORS_ALLOWED_ORIGINS ?? '*').trim();
      if (configured === '*') return origin ?? '*';
      const allowed = configured.split(',').map((o) => o.trim()).filter(Boolean);
      return origin && allowed.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id', 'Location', 'Server-Timing'],
    maxAge: 86400,
    credentials: false,
  })(c, next)
);

// Reject oversized / wrongly-typed bodies before touching KV.
app.use('/api/v1/*', async (c, next) => {
  if (['POST', 'PATCH', 'PUT'].includes(c.req.method)) {
    const length = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      throw new ApiError(413, 'payload_too_large', 'Request body is too large.');
    }
    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw ApiError.badRequest('Content-Type must be application/json.');
    }
  }
  return next();
});

app.use('/api/v1/*', bearerAuth);
app.use('/api/v1/*', withStore);

/* --------------------------------- routes -------------------------------- */

app.get('/api/v1/health', (c) => c.json({ ok: true }));

app.route('/api/v1/projects', projects);

/* ----------------------------- error handling ---------------------------- */

app.notFound(notFoundHandler);

app.onError((err, c) => {
  // Malformed JSON body, Hono internals, etc.
  if (err instanceof HTTPException && err.status === 400) {
    return renderError(c, ApiError.badRequest('Request body must be valid JSON.'));
  }
  if (err instanceof SyntaxError) {
    return renderError(c, ApiError.badRequest('Request body must be valid JSON.'));
  }
  if (err instanceof HTTPException && !(err instanceof ApiError)) {
    const status = err.status;
    const code = status === 401 ? 'unauthorized' : status === 404 ? 'not_found' : 'internal_error';
    return c.json(errorBody(code, err.message || 'Request failed.', { requestId: c.get('requestId') }), status);
  }
  return renderError(c, err);
});

export default app satisfies ExportedHandler<AppEnv['Bindings']>;
```

---

### `vitest.config.ts`

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        miniflare: {
          compatibilityDate: '2026-08-01',
          compatibilityFlags: ['nodejs_compat'],
          kvNamespaces: ['TASKS'],
          bindings: {
            API_TOKEN: 'test-token',
            ENVIRONMENT: 'test',
            CORS_ALLOWED_ORIGINS: '*',
          },
        },
      },
    },
  },
});
```

---

### `test/api.test.ts`

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const AUTH = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
const base = 'https://api.test/api/v1';

async function createProject(name = 'Launch') {
  const res = await SELF.fetch(`${base}/projects`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json<any>()).data;
}

describe('health & auth', () => {
  it('health needs no auth', async () => {
    const res = await SELF.fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('401 without a token', async () => {
    const res = await SELF.fetch(`${base}/projects`);
    expect(res.status).toBe(401);
    expect((await res.json<any>()).error.code).toBe('unauthorized');
  });

  it('401 with a wrong token', async () => {
    const res = await SELF.fetch(`${base}/projects`, { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });
});

describe('cors', () => {
  it('answers preflight without credentials', async () => {
    const res = await SELF.fetch(`${base}/projects`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://board.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect([204, 200]).toContain(res.status);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://board.example.com');
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
  });
});

describe('projects', () => {
  it('creates, reads and lists', async () => {
    const project = await createProject('Website');
    const one = await SELF.fetch(`${base}/projects/${project.id}`, { headers: AUTH });
    expect(one.status).toBe(200);
    expect((await one.json<any>()).data.name).toBe('Website');

    const list = await SELF.fetch(`${base}/projects`, { headers: AUTH });
    expect((await list.json<any>()).data.length).toBeGreaterThan(0);
  });

  it('validates the body', async () => {
    const res = await SELF.fetch(`${base}/projects`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ name: '', extra: 1 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<any>();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('404s for unknown project', async () => {
    const res = await SELF.fetch(`${base}/projects/does-not-exist`, { headers: AUTH });
    expect(res.status).toBe(404);
    expect((await res.json<any>()).error.code).toBe('not_found');
  });

  it('deletes project and its tasks', async () => {
    const project = await createProject('Temp');
    await SELF.fetch(`${base}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ title: 'T1' }),
    });
    const del = await SELF.fetch(`${base}/projects/${project.id}`, { method: 'DELETE', headers: AUTH });
    expect(del.status).toBe(200);
    expect((await del.json<any>()).data.deletedTasks).toBe(1);

    const after = await SELF.fetch(`${base}/projects/${project.id}/tasks`, { headers: AUTH });
    expect(after.status).toBe(404);
  });
});

describe('tasks', () => {
  it('supports full CRUD, filtering and pagination', async () => {
    const project = await createProject('Sprint');

    for (let i = 0; i < 5; i++) {
      const res = await SELF.fetch(`${base}/projects/${project.id}/tasks`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({
          title: `Task ${i}`,
          status: i % 2 === 0 ? 'todo' : 'done',
          assignee: 'ana',
        }),
      });
      expect(res.status).toBe(201);
    }

    const page = await SELF.fetch(`${base}/projects/${project.id}/tasks?page=1&pageSize=2`, { headers: AUTH });
    const paged = await page.json<any>();
    expect(paged.data).toHaveLength(2);
    expect(paged.pagination).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3, hasMore: true });

    const filtered = await SELF.fetch(`${base}/projects/${project.id}/tasks?status=done`, { headers: AUTH });
    const doneList = await filtered.json<any>();
    expect(doneList.pagination.total).toBe(2);
    expect(doneList.data.every((t: any) => t.status === 'done')).toBe(true);

    const target = doneList.data[0];
    const patch = await SELF.fetch(`${base}/projects/${project.id}/tasks/${target.id}`, {
      method: 'PATCH',
      headers: AUTH,
      body: JSON.stringify({ status: 'in_progress', assignee: null }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json<any>()).data;
    expect(patched.status).toBe('in_progress');
    expect(patched.assignee).toBeUndefined();
    expect(patched.updatedAt >= patched.createdAt).toBe(true);

    const del = await SELF.fetch(`${base}/projects/${project.id}/tasks/${target.id}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(del.status).toBe(200);

    const gone = await SELF.fetch(`${base}/projects/${project.id}/tasks/${target.id}`, { headers: AUTH });
    expect(gone.status).toBe(404);
  });

  it('rejects empty PATCH bodies and bad status values', async () => {
    const project = await createProject('Validation');
    const created = await SELF.fetch(`${base}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ title: 'x' }),
    });
    const task = (await created.json<any>()).data;

    const empty = await SELF.fetch(`${base}/projects/${project.id}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: AUTH,
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);

    const badStatus = await SELF.fetch(`${base}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ title: 'y', status: 'blocked' }),
    });
    expect(badStatus.status).toBe(400);

    const badQuery = await SELF.fetch(`${base}/projects/${project.id}/tasks?pageSize=1000`, { headers: AUTH });
    expect(badQuery.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await SELF.fetch(`${base}/projects`, { method: 'POST', headers: AUTH, body: '{oops' });
    expect(res.status).toBe(400);
  });
});

describe('routing errors', () => {
  it('404 for unknown routes in the standard shape', async () => {
    const res = await SELF.fetch(`${base}/nope`, { headers: AUTH });
    expect(res.status).toBe(404);
    const body = await res.json<any>();
    expect(body.error.code).toBe('not_found');
    expect(typeof body.error.message).toBe('string');
  });

  it('405 with Allow header for wrong method', async () => {
    const res = await SELF.fetch(`${base}/health`, { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
    expect((await res.json<any>()).error.code).toBe('method_not_allowed');
  });
});
```

---

### `README.md`

````md
# Team Task Board API (Cloudflare Workers)

Hono + Zod + Workers KV. All routes live under `/api/v1`.

## Setup

```bash
npm install
npx wrangler kv namespace create TASKS          # copy id -> wrangler.toml
npx wrangler kv namespace create TASKS --preview # copy preview_id -> wrangler.toml
cp .dev.vars.example .dev.vars                  # set API_TOKEN
npm run dev
````

Deploy:

```bash
npx wrangler secret put API_TOKEN --env production
npm run deploy -- --env production
```

Tests: `npm test` (runs in workerd via `@cloudflare/vitest-pool-workers`, real KV emulation).

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer $API_TOKEN
```

Otherwise `401 { "error": { "code": "unauthorized", ... } }`.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | `{ "ok": true }`, public |
| GET | `/api/v1/projects` | `{ "data": Project[] }`, newest first |
| POST | `/api/v1/projects` | body `{ "name": string }` → 201 + `Location` |
| GET | `/api/v1/projects/:projectId` | 404 if missing |
| DELETE | `/api/v1/projects/:projectId` | cascades to tasks, returns `deletedTasks` |
| GET | `/api/v1/projects/:projectId/tasks` | `?status=todo\|in_progress\|done&page=1&pageSize=20` (max 100) |
| POST | `/api/v1/projects/:projectId/tasks` | body `{ title, description?, status?, assignee? }` |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | any subset of `title/description/status/assignee`; `null` clears an optional field |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | |

### Responses

Single resource: `{ "data": {...} }`
Collection with pagination:

```json
{
  "data": [ { "id": "…", "title": "Ship it", "status": "todo", "…": "…" } ],
  "pagination": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3, "hasMore": true }
}
```

Errors (all of 400/401/404/405/413/500):

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "details": [{ "path": "title", "message": "title must not be empty" }],
    "requestId": "8a…"
  }
}
```

## Cross-cutting behaviour

* **CORS**: `hono/cors` with preflight, `Authorization` allowed, origins from `CORS_ALLOWED_ORIGINS` (`*` or comma-separated list). Preflight never requires a token.
* **Logging**: one JSON line per request with `method`, `path`, `status`, `durationMs`, `requestId`; echoed back as `X-Request-Id` and `Server-Timing`.
* **405**: unmatched method on a known path returns 405 + `Allow`; truly unknown paths return 404 in the same error shape.
* **Safety**: unknown JSON keys rejected (`.strict()`), body size cap of 64 KiB, `Content-Type` enforced on writes, constant-time token comparison, security headers, no internal details leaked on 500.

## KV layout

```
project:<projectId>            -> Project JSON
task:<projectId>:<taskId>      -> Task JSON
```

Tasks of a project are a single prefix scan, so project deletion cascades and status filtering/pagination happen over that prefix. This is ideal for boards up to a few thousand tasks per project; for very large boards, add a per-project index value or move to D1 while keeping the same `Store` interface.

```

---

### Quick smoke test

```bash
curl -s localhost:8787/api/v1/health
curl -s -X POST localhost:8787/api/v1/projects \
  -H 'Authorization: Bearer dev-super-secret-token' -H 'Content-Type: application/json' \
  -d '{"name":"Launch"}'
curl -s "localhost:8787/api/v1/projects/<id>/tasks?status=todo&page=1&pageSize=10" \
  -H 'Authorization: Bearer dev-super-secret-token'
```