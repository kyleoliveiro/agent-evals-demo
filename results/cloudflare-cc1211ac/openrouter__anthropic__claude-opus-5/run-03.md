<!-- model: openrouter/anthropic/claude-opus-5 | run: 3 | framework: Hono -->

# Team Task Board API — Cloudflare Workers

**Stack choice:** [Hono](https://hono.dev) (tiny, fast, first-class Workers support, built-in CORS/router) + [Zod](https://zod.dev) for validation + `@hono/zod-validator` glue + Wrangler for build/deploy + `@cloudflare/vitest-pool-workers` for integration tests that run in real `workerd`.

```
.
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── vitest.config.ts
├── .dev.vars.example
├── .gitignore
├── README.md
├── src
│   ├── index.ts              # app wiring: middleware, routers, error handlers
│   ├── env.ts                # binding types
│   ├── types.ts              # domain models
│   ├── schemas.ts            # zod schemas + validator helper
│   ├── errors.ts             # ApiError + JSON error shape
│   ├── http.ts              # response helpers
│   ├── store.ts              # KV repository
│   ├── routes
│   │   ├── projects.ts
│   │   └── tasks.ts
│   └── middleware
│       ├── auth.ts
│       ├── logger.ts
│       └── methodNotAllowed.ts
└── test
    ├── env.d.ts
    └── api.test.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "cf-typegen": "wrangler types --env-interface CloudflareBindings"
  },
  "dependencies": {
    "hono": "^4.6.14",
    "zod": "^3.24.1",
    "@hono/zod-validator": "^0.4.2"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.40",
    "@cloudflare/workers-types": "^4.20241230.0",
    "typescript": "^5.7.2",
    "vitest": "2.1.8",
    "wrangler": "^3.99.0"
  }
}
```

---

### `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "team-task-board-api",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-30",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  },
  "kv_namespaces": [
    {
      "binding": "TASKS",
      // Replace with the id from: wrangler kv namespace create TASKS
      "id": "REPLACE_WITH_KV_NAMESPACE_ID",
      "preview_id": "REPLACE_WITH_KV_PREVIEW_ID"
    }
  ],
  "vars": {
    // Comma-separated list of allowed browser origins, or "*" for any.
    "CORS_ALLOWED_ORIGINS": "*"
  }
  // Secrets (NOT stored here):
  //   wrangler secret put API_TOKEN
  // Local dev: put API_TOKEN in .dev.vars
}
```

---

### `.dev.vars.example`

```ini
# Copy to .dev.vars for local development (never commit .dev.vars)
API_TOKEN=dev-super-secret-token
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

---

### `.gitignore`

```gitignore
node_modules/
.wrangler/
.dev.vars
dist/
*.log
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
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "verbatimModuleSyntax": false,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

---

### `src/env.ts`

```ts
export interface Bindings {
  /** KV namespace holding projects and tasks. */
  TASKS: KVNamespace;
  /** Bearer token required on every route except /health. */
  API_TOKEN: string;
  /** Comma separated origin allow-list, or "*". */
  CORS_ALLOWED_ORIGINS?: string;
}

export interface AppVariables {
  requestId: string;
}

export type AppEnv = { Bindings: Bindings; Variables: AppVariables };
```

---

### `src/types.ts`

```ts
export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  createdAt: string; // ISO-8601
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export interface Page<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

---

### `src/errors.ts`

```ts
export type ErrorCode =
  | 'bad_request'
  | 'validation_error'
  | 'unauthorized'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'internal_error';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/** Any error thrown as an ApiError is rendered verbatim to the client. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: { details?: unknown; headers?: Record<string, string> },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.headers = options?.headers;
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }

  static badRequest(message = 'Malformed request.', details?: unknown) {
    return new ApiError(400, 'bad_request', message, { details });
  }

  static validation(message = 'Request body failed validation.', details?: unknown) {
    return new ApiError(400, 'validation_error', message, { details });
  }

  static unauthorized(message = 'Missing or invalid bearer token.') {
    return new ApiError(401, 'unauthorized', message, {
      headers: { 'WWW-Authenticate': 'Bearer realm="api", charset="UTF-8"' },
    });
  }

  static notFound(message = 'Resource not found.') {
    return new ApiError(404, 'not_found', message);
  }

  static methodNotAllowed(allow: string[]) {
    return new ApiError(405, 'method_not_allowed', 'HTTP method not allowed for this resource.', {
      headers: { Allow: allow.join(', ') },
    });
  }

  static internal(message = 'An unexpected error occurred.') {
    return new ApiError(500, 'internal_error', message);
  }
}
```

---

### `src/http.ts`

```ts
import type { Context } from 'hono';
import { ApiError, type ErrorBody } from './errors';

export function json<T>(c: Context, body: T, status = 200): Response {
  return c.json(body as never, status as never);
}

export function errorResponse(c: Context, err: ApiError): Response {
  for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
  return c.json(err.toBody() as unknown as ErrorBody, err.status as never);
}
```

---

### `src/schemas.ts`

```ts
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';
import { ApiError } from './errors';
import { TASK_STATUSES } from './types';

const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, field: string) =>
  trimmed(max).min(1, `${field} must not be empty`);

/** Optional free-text field: empty string / null clears the value. */
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((v) => (v === null || v === '' ? undefined : v));

export const idParamSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
});

export const taskParamsSchema = z.object({
  projectId: z.string().trim().min(1).max(128),
  taskId: z.string().trim().min(1).max(128),
});

export const createProjectSchema = z
  .object({
    name: requiredText(120, 'name'),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: requiredText(200, 'title'),
    description: optionalText(4000).optional(),
    status: z.enum(TASK_STATUSES).default('todo'),
    assignee: optionalText(120).optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: requiredText(200, 'title').optional(),
    description: optionalText(4000).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: optionalText(120).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one of: title, description, status, assignee.',
  });

export const listTasksQuerySchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strip();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/**
 * zValidator wrapper that turns every Zod failure into our canonical
 * 400 { error: { code, message, details } } envelope.
 */
export function validate<T extends z.ZodTypeAny, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (result.success) return;
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    throw ApiError.validation(
      target === 'query'
        ? 'Invalid query parameters.'
        : target === 'param'
          ? 'Invalid path parameters.'
          : 'Request body failed validation.',
      details,
    );
  });
}
```

---

### `src/store.ts`

KV repository. Keys are namespaced so a project's tasks are listable by prefix:

* `project:<projectId>` → `Project`
* `task:<projectId>:<taskId>` → `Task`

```ts
import type { Page, Project, Task, TaskStatus } from './types';

const PROJECT_PREFIX = 'project:';
const TASK_PREFIX = 'task:';
const KV_LIST_LIMIT = 1000;
const READ_CONCURRENCY = 25;

const projectKey = (projectId: string) => `${PROJECT_PREFIX}${projectId}`;
const taskKey = (projectId: string, taskId: string) => `${TASK_PREFIX}${projectId}:${taskId}`;
const taskPrefix = (projectId: string) => `${TASK_PREFIX}${projectId}:`;

async function listKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await kv.list({ prefix, limit: KV_LIST_LIMIT, cursor });
    for (const k of res.keys) keys.push(k.name);
    if (res.list_complete) return keys;
    cursor = res.cursor;
  }
}

/** Bounded-concurrency map so we never fan out thousands of KV reads at once. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  return {
    data: items.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages },
  };
}

export class Store {
  constructor(private readonly kv: KVNamespace) {}

  // ----- projects -------------------------------------------------------

  async getProject(projectId: string): Promise<Project | null> {
    return this.kv.get<Project>(projectKey(projectId), 'json');
  }

  async putProject(project: Project): Promise<void> {
    await this.kv.put(projectKey(project.id), JSON.stringify(project));
  }

  async listProjects(): Promise<Project[]> {
    const keys = await listKeys(this.kv, PROJECT_PREFIX);
    const rows = await mapLimit(keys, READ_CONCURRENCY, (key) =>
      this.kv.get<Project>(key, 'json'),
    );
    return rows
      .filter((p): p is Project => p !== null)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  /** Deletes the project and every task belonging to it. */
  async deleteProjectCascade(projectId: string): Promise<number> {
    const taskKeys = await listKeys(this.kv, taskPrefix(projectId));
    await mapLimit(taskKeys, READ_CONCURRENCY, (key) => this.kv.delete(key));
    await this.kv.delete(projectKey(projectId));
    return taskKeys.length;
  }

  // ----- tasks ----------------------------------------------------------

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    return this.kv.get<Task>(taskKey(projectId, taskId), 'json');
  }

  async putTask(task: Task): Promise<void> {
    await this.kv.put(taskKey(task.projectId, task.id), JSON.stringify(task));
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.kv.delete(taskKey(projectId, taskId));
  }

  /**
   * Lists tasks for a project, newest first, with optional status filter.
   * KV has no secondary indexes, so filtering/sorting happens in the Worker.
   */
  async listTasks(
    projectId: string,
    opts: { status?: TaskStatus; page: number; pageSize: number },
  ): Promise<Page<Task>> {
    const keys = await listKeys(this.kv, taskPrefix(projectId));
    const rows = await mapLimit(keys, READ_CONCURRENCY, (key) => this.kv.get<Task>(key, 'json'));
    const tasks = rows
      .filter((t): t is Task => t !== null)
      .filter((t) => (opts.status ? t.status === opts.status : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return paginate(tasks, opts.page, opts.pageSize);
  }
}
```

---

### `src/middleware/logger.ts`

```ts
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

/**
 * Structured single-line JSON access log: method, path, status, duration.
 * Also stamps every request/response with an id for correlation.
 */
export const accessLogger = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const started = Date.now();
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);

  try {
    await next();
  } finally {
    const durationMs = Date.now() - started;
    const url = new URL(c.req.url);
    console.log(
      JSON.stringify({
        level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
        msg: 'request',
        requestId,
        method: c.req.method,
        path: url.pathname,
        query: url.search ? url.search.slice(1) : undefined,
        status: c.res.status,
        durationMs,
        ip: c.req.header('cf-connecting-ip'),
        ua: c.req.header('user-agent'),
      }),
    );
  }
};
```

---

### `src/middleware/auth.ts`

```ts
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

/** Length-safe, timing-attack-resistant string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare a fixed number of bytes so length alone does not leak via timing.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Requires `Authorization: Bearer <API_TOKEN>`.
 * Paths in `skip` (e.g. /health) bypass the check.
 */
export const bearerAuth =
  (skip: readonly string[] = []): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (skip.includes(new URL(c.req.url).pathname)) return next();

    const expected = c.env.API_TOKEN;
    if (!expected) {
      console.log(
        JSON.stringify({ level: 'error', msg: 'API_TOKEN binding is not configured' }),
      );
      throw ApiError.internal('Server authentication is misconfigured.');
    }

    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match || !timingSafeEqual(match[1] as string, expected)) {
      throw ApiError.unauthorized();
    }

    return next();
  };
```

---

### `src/middleware/methodNotAllowed.ts`

```ts
import { ApiError } from '../errors';

interface RouteSpec {
  pattern: RegExp;
  methods: string[];
}

const SEG = '[^/]+';

/**
 * Known resources and the methods they support. Used by the 404 fallback to
 * distinguish "unknown route" (404) from "wrong verb on a known route" (405).
 */
const ROUTES: RouteSpec[] = [
  { pattern: new RegExp('^/api/v1/health$'), methods: ['GET'] },
  { pattern: new RegExp('^/api/v1/projects$'), methods: ['GET', 'POST'] },
  { pattern: new RegExp(`^/api/v1/projects/${SEG}$`), methods: ['GET', 'DELETE'] },
  { pattern: new RegExp(`^/api/v1/projects/${SEG}/tasks$`), methods: ['GET', 'POST'] },
  {
    pattern: new RegExp(`^/api/v1/projects/${SEG}/tasks/${SEG}$`),
    methods: ['GET', 'PATCH', 'DELETE'],
  },
];

/** Returns a 405 ApiError if the path is known but the method is not, else 404. */
export function resolveUnmatched(method: string, pathname: string): ApiError {
  const route = ROUTES.find((r) => r.pattern.test(pathname));
  if (!route) return ApiError.notFound(`No route matches ${method} ${pathname}.`);

  const allow = [...new Set([...route.methods, 'OPTIONS'])];
  if (allow.includes(method.toUpperCase())) {
    // Path + method are declared but nothing handled it: treat as not found.
    return ApiError.notFound(`No route matches ${method} ${pathname}.`);
  }
  return ApiError.methodNotAllowed(allow);
}
```

---

### `src/routes/projects.ts`

```ts
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { createProjectSchema, idParamSchema, validate } from '../schemas';
import { Store } from '../store';
import type { Project } from '../types';
import { tasks } from './tasks';

export const projects = new Hono<AppEnv>();

// GET /projects
projects.get('/', async (c) => {
  const store = new Store(c.env.TASKS);
  const data = await store.listProjects();
  return c.json({ data, pagination: { total: data.length } });
});

// POST /projects
projects.post('/', validate('json', createProjectSchema), async (c) => {
  const { name } = c.req.valid('json');
  const store = new Store(c.env.TASKS);

  const project: Project = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };
  await store.putProject(project);

  c.header('Location', `/api/v1/projects/${project.id}`);
  return c.json({ data: project }, 201);
});

// GET /projects/:projectId
projects.get('/:projectId', validate('param', idParamSchema), async (c) => {
  const { projectId } = c.req.valid('param');
  const project = await new Store(c.env.TASKS).getProject(projectId);
  if (!project) throw ApiError.notFound(`Project '${projectId}' does not exist.`);
  return c.json({ data: project });
});

// DELETE /projects/:projectId  (cascades to tasks)
projects.delete('/:projectId', validate('param', idParamSchema), async (c) => {
  const { projectId } = c.req.valid('param');
  const store = new Store(c.env.TASKS);
  const project = await store.getProject(projectId);
  if (!project) throw ApiError.notFound(`Project '${projectId}' does not exist.`);

  const deletedTasks = await store.deleteProjectCascade(projectId);
  return c.json({ data: { id: projectId, deleted: true, deletedTasks } });
});

// Nested task routes: /projects/:projectId/tasks...
projects.route('/:projectId/tasks', tasks);
```

---

### `src/routes/tasks.ts`

```ts
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
  validate,
} from '../schemas';
import { Store } from '../store';
import type { Task } from '../types';

export const tasks = new Hono<AppEnv>();

/** Ensures the parent project exists before touching tasks. */
async function requireProject(store: Store, projectId: string): Promise<void> {
  const project = await store.getProject(projectId);
  if (!project) throw ApiError.notFound(`Project '${projectId}' does not exist.`);
}

function projectIdOf(c: { req: { param: (k: string) => string | undefined } }): string {
  const projectId = c.req.param('projectId');
  if (!projectId) throw ApiError.notFound('Project not specified.');
  return projectId;
}

// GET /projects/:projectId/tasks?status=&page=&pageSize=
tasks.get('/', validate('query', listTasksQuerySchema), async (c) => {
  const projectId = projectIdOf(c);
  const { status, page, pageSize } = c.req.valid('query');
  const store = new Store(c.env.TASKS);
  await requireProject(store, projectId);
  return c.json(await store.listTasks(projectId, { status, page, pageSize }));
});

// POST /projects/:projectId/tasks
tasks.post('/', validate('json', createTaskSchema), async (c) => {
  const projectId = projectIdOf(c);
  const body = c.req.valid('json');
  const store = new Store(c.env.TASKS);
  await requireProject(store, projectId);

  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    projectId,
    title: body.title,
    ...(body.description ? { description: body.description } : {}),
    status: body.status,
    ...(body.assignee ? { assignee: body.assignee } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await store.putTask(task);

  c.header('Location', `/api/v1/projects/${projectId}/tasks/${task.id}`);
  return c.json({ data: task }, 201);
});

// GET /projects/:projectId/tasks/:taskId
tasks.get('/:taskId', async (c) => {
  const projectId = projectIdOf(c);
  const taskId = c.req.param('taskId') as string;
  const store = new Store(c.env.TASKS);
  await requireProject(store, projectId);

  const task = await store.getTask(projectId, taskId);
  if (!task) throw ApiError.notFound(`Task '${taskId}' does not exist in this project.`);
  return c.json({ data: task });
});

// PATCH /projects/:projectId/tasks/:taskId
tasks.patch('/:taskId', validate('json', updateTaskSchema), async (c) => {
  const projectId = projectIdOf(c);
  const taskId = c.req.param('taskId') as string;
  const patch = c.req.valid('json');
  const store = new Store(c.env.TASKS);
  await requireProject(store, projectId);

  const existing = await store.getTask(projectId, taskId);
  if (!existing) throw ApiError.notFound(`Task '${taskId}' does not exist in this project.`);

  const updated: Task = { ...existing, updatedAt: new Date().toISOString() };
  if ('title' in patch && patch.title !== undefined) updated.title = patch.title;
  if ('status' in patch && patch.status !== undefined) updated.status = patch.status;
  // description/assignee: explicit null or "" clears the field.
  if ('description' in patch) {
    if (patch.description === undefined) delete updated.description;
    else updated.description = patch.description;
  }
  if ('assignee' in patch) {
    if (patch.assignee === undefined) delete updated.assignee;
    else updated.assignee = patch.assignee;
  }

  await store.putTask(updated);
  return c.json({ data: updated });
});

// DELETE /projects/:projectId/tasks/:taskId
tasks.delete('/:taskId', async (c) => {
  const projectId = projectIdOf(c);
  const taskId = c.req.param('taskId') as string;
  const store = new Store(c.env.TASKS);
  await requireProject(store, projectId);

  const existing = await store.getTask(projectId, taskId);
  if (!existing) throw ApiError.notFound(`Task '${taskId}' does not exist in this project.`);

  await store.deleteTask(projectId, taskId);
  return c.json({ data: { id: taskId, deleted: true } });
});
```

---

### `src/index.ts`

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv, Bindings } from './env';
import { ApiError } from './errors';
import { errorResponse } from './http';
import { bearerAuth } from './middleware/auth';
import { accessLogger } from './middleware/logger';
import { resolveUnmatched } from './middleware/methodNotAllowed';
import { projects } from './routes/projects';

const API_PREFIX = '/api/v1';
const PUBLIC_PATHS = [`${API_PREFIX}/health`] as const;

const app = new Hono<AppEnv>();

/* ------------------------------ middleware ------------------------------ */

app.use('*', accessLogger());
app.use('*', secureHeaders());

app.use('*', (c, next) => {
  const configured = (c.env.CORS_ALLOWED_ORIGINS ?? '*').trim();
  const allowList =
    configured === '*'
      ? '*'
      : configured
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);

  return cors({
    origin: (origin) => {
      if (allowList === '*') return origin ?? '*';
      return origin && allowList.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id', 'Location'],
    maxAge: 86400,
    credentials: false,
  })(c, next);
});

// Auth on everything under the API prefix except the public paths.
app.use(`${API_PREFIX}/*`, bearerAuth(PUBLIC_PATHS));

/* -------------------------------- routes -------------------------------- */

app.get(`${API_PREFIX}/health`, (c) => c.json({ ok: true }));

app.route(`${API_PREFIX}/projects`, projects);

/* --------------------------- error handling ----------------------------- */

app.notFound((c) => errorResponse(c, resolveUnmatched(c.req.method, new URL(c.req.url).pathname)));

app.onError((err, c) => {
  if (err instanceof ApiError) return errorResponse(c, err);

  // Hono/std HTTP exceptions (e.g. malformed JSON body -> 400).
  const status = (err as { status?: number }).status;
  if (status === 400) {
    return errorResponse(c, ApiError.badRequest('Request body is not valid JSON.'));
  }
  if (status === 413) {
    return errorResponse(c, new ApiError(413, 'payload_too_large', 'Request body is too large.'));
  }

  console.log(
    JSON.stringify({
      level: 'error',
      msg: 'unhandled_error',
      requestId: c.get('requestId'),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return errorResponse(c, ApiError.internal());
});

export default app satisfies ExportedHandler<Bindings>;
```

---

### `vitest.config.ts`

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            API_TOKEN: 'test-token',
            CORS_ALLOWED_ORIGINS: '*',
          },
          kvNamespaces: ['TASKS'],
        },
      },
    },
  },
});
```

---

### `test/env.d.ts`

```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TASKS: KVNamespace;
    API_TOKEN: string;
    CORS_ALLOWED_ORIGINS?: string;
  }
}
```

---

### `test/api.test.ts`

```ts
import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const BASE = 'https://api.test/api/v1';
const AUTH = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };

async function createProject(name = 'Apollo') {
  const res = await SELF.fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json<{ data: { id: string } }>()).data;
}

async function createTask(projectId: string, body: Record<string, unknown>) {
  const res = await SELF.fetch(`${BASE}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json<{ data: { id: string } }>()).data;
}

describe('health + auth', () => {
  it('health is public', async () => {
    const res = await SELF.fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects missing token with 401 envelope', async () => {
    const res = await SELF.fetch(`${BASE}/projects`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    expect(await res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Missing or invalid bearer token.' },
    });
  });

  it('rejects wrong token', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(401);
  });

  it('answers CORS preflight', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
  });
});

describe('projects', () => {
  it('creates, lists, reads and deletes', async () => {
    const project = await createProject('Board A');

    const list = await SELF.fetch(`${BASE}/projects`, { headers: AUTH });
    expect(list.status).toBe(200);
    const listed = await list.json<{ data: Array<{ id: string }> }>();
    expect(listed.data.some((p) => p.id === project.id)).toBe(true);

    const one = await SELF.fetch(`${BASE}/projects/${project.id}`, { headers: AUTH });
    expect(one.status).toBe(200);

    const del = await SELF.fetch(`${BASE}/projects/${project.id}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(del.status).toBe(200);

    const gone = await SELF.fetch(`${BASE}/projects/${project.id}`, { headers: AUTH });
    expect(gone.status).toBe(404);
    expect((await gone.json<{ error: { code: string } }>()).error.code).toBe('not_found');
  });

  it('validates the body', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; details: unknown[] } }>();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects malformed JSON', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: AUTH,
      body: '{oops',
    });
    expect(res.status).toBe(400);
  });
});

describe('tasks', () => {
  let projectId: string;

  beforeEach(async () => {
    projectId = (await createProject()).id;
  });

  it('creates with defaults', async () => {
    const res = await SELF.fetch(`${BASE}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ title: 'Write docs' }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json<{ data: Record<string, unknown> }>();
    expect(data).toMatchObject({ title: 'Write docs', status: 'todo', projectId });
    expect(res.headers.get('location')).toContain(`/tasks/${data.id as string}`);
  });

  it('filters by status and paginates', async () => {
    await createTask(projectId, { title: 'a', status: 'todo' });
    await createTask(projectId, { title: 'b', status: 'done' });
    await createTask(projectId, { title: 'c', status: 'done' });

    const res = await SELF.fetch(
      `${BASE}/projects/${projectId}/tasks?status=done&page=1&pageSize=1`,
      { headers: AUTH },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[]; pagination: Record<string, number> }>();
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('rejects bad query params', async () => {
    const res = await SELF.fetch(`${BASE}/projects/${projectId}/tasks?status=nope`, {
      headers: AUTH,
    });
    expect(res.status).toBe(400);
  });

  it('patches partially and clears optional fields', async () => {
    const task = await createTask(projectId, { title: 'x', assignee: 'ada' });

    const patched = await SELF.fetch(`${BASE}/projects/${projectId}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: AUTH,
      body: JSON.stringify({ status: 'in_progress', assignee: null }),
    });
    expect(patched.status).toBe(200);
    const { data } = await patched.json<{ data: Record<string, unknown> }>();
    expect(data.status).toBe('in_progress');
    expect(data.title).toBe('x');
    expect(data.assignee).toBeUndefined();
  });

  it('rejects empty patch and unknown fields', async () => {
    const task = await createTask(projectId, { title: 'x' });
    for (const body of [{}, { bogus: 1 }]) {
      const res = await SELF.fetch(`${BASE}/projects/${projectId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: AUTH,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it('deletes a task and cascades on project delete', async () => {
    const t1 = await createTask(projectId, { title: 'one' });
    const t2 = await createTask(projectId, { title: 'two' });

    const del = await SELF.fetch(`${BASE}/projects/${projectId}/tasks/${t1.id}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(del.status).toBe(200);
    expect(
      (await SELF.fetch(`${BASE}/projects/${projectId}/tasks/${t1.id}`, { headers: AUTH })).status,
    ).toBe(404);

    const cascade = await SELF.fetch(`${BASE}/projects/${projectId}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    const body = await cascade.json<{ data: { deletedTasks: number } }>();
    expect(body.data.deletedTasks).toBe(1);
    expect(
      (await SELF.fetch(`${BASE}/projects/${projectId}/tasks/${t2.id}`, { headers: AUTH })).status,
    ).toBe(404);
  });

  it('404s for tasks under a missing project', async () => {
    const res = await SELF.fetch(`${BASE}/projects/does-not-exist/tasks`, { headers: AUTH });
    expect(res.status).toBe(404);
  });
});

describe('routing errors', () => {
  it('unknown route -> 404 envelope', async () => {
    const res = await SELF.fetch(`${BASE}/nope`, { headers: AUTH });
    expect(res.status).toBe(404);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('not_found');
  });

  it('wrong method on known route -> 405 with Allow', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, { method: 'PATCH', headers: AUTH });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('POST');
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('method_not_allowed');
  });
});
```

---

### `README.md`

````markdown
# Team Task Board API (Cloudflare Workers)

Hono + Zod + Workers KV. All routes under `/api/v1`.

## Setup

```bash
npm install
wrangler kv namespace create TASKS            # copy id -> wrangler.jsonc
wrangler kv namespace create TASKS --preview  # copy id -> preview_id
cp .dev.vars.example .dev.vars                # set API_TOKEN for local dev
npm run dev
```

Deploy:

```bash
wrangler secret put API_TOKEN
npm run deploy
```

Tests (run in real workerd via Miniflare): `npm test`

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer <API_TOKEN>
```

Failures return `401` with `WWW-Authenticate: Bearer`.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | `{ "ok": true }`, public |
| GET | `/api/v1/projects` | newest first |
| POST | `/api/v1/projects` | `{ "name": string }` → 201 + `Location` |
| GET | `/api/v1/projects/:projectId` | 404 if missing |
| DELETE | `/api/v1/projects/:projectId` | cascades to tasks |
| GET | `/api/v1/projects/:projectId/tasks` | `?status=todo\|in_progress\|done&page=1&pageSize=25` |
| POST | `/api/v1/projects/:projectId/tasks` | `{ title, description?, status?, assignee? }` |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | partial; `null`/`""` clears `description`/`assignee` |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | |

Success envelopes: `{ "data": ... }`, plus `{ "pagination": { page, pageSize, total, totalPages } }` on task lists.

Error envelope (400 / 401 / 404 / 405 / 500):

```json
{ "error": { "code": "validation_error", "message": "Request body failed validation.",
             "details": [{ "path": "title", "message": "title must not be empty" }] } }
```

Codes: `bad_request`, `validation_error`, `unauthorized`, `not_found`, `method_not_allowed`, `payload_too_large`, `internal_error`.

## Examples

```bash
TOKEN=dev-super-secret-token
API=http://localhost:8787/api/v1

curl $API/health
PID=$(curl -s -X POST $API/projects -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Q3 Launch"}' | jq -r .data.id)

curl -X POST $API/projects/$PID/tasks -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Draft launch plan","assignee":"ada","status":"in_progress"}'

curl "$API/projects/$PID/tasks?status=in_progress&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"
```

## Operational notes

- **Observability:** one structured JSON log line per request (`method`, `path`, `status`, `durationMs`, `requestId`); `x-request-id` is echoed on every response. Workers Logs is enabled in `wrangler.jsonc`.
- **CORS:** `CORS_ALLOWED_ORIGINS` is `*` or a comma-separated allow-list; preflight (`OPTIONS`) returns 204 with `Allow-Methods`/`Allow-Headers`, cached 24h.
- **KV trade-offs:** KV has no secondary indexes, so status filtering, sorting and pagination happen in the Worker after a prefix `list` (`task:<projectId>:`) with bounded-concurrency reads (25 at a time). This is fine for boards up to a few thousand tasks per project; beyond that, move to D1 or Durable Objects (the `Store` class is the only thing that would change). KV is also eventually consistent, so a read immediately after a write may briefly return stale data.
- **Security:** bearer token compared in constant time; `secureHeaders()` applied; unknown JSON body fields are rejected (`.strict()`).
````