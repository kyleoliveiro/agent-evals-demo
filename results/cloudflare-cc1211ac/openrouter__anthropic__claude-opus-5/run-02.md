<!-- model: openrouter/anthropic/claude-opus-5 | run: 2 | framework: Hono -->

Below is a complete, production-ready Cloudflare Workers project. It uses **Hono** (tiny, Workers-native router with excellent middleware support) + **Zod** for validation, **Wrangler** for deploy, and **Vitest with `@cloudflare/vitest-pool-workers`** for tests that run inside the real `workerd` runtime with a Miniflare KV namespace.

## Project layout

```
team-task-board/
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
│   ├── schemas.ts
│   ├── errors.ts
│   ├── responses.ts
│   ├── store.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── cors.ts
│   │   └── logger.ts
│   └── routes/
│       ├── projects.ts
│       └── tasks.ts
└── test/
    └── api.spec.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board",
  "version": "1.0.0",
  "private": true,
  "description": "Team task board REST API on Cloudflare Workers (Hono + KV)",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "cf-typegen": "wrangler types"
  },
  "dependencies": {
    "@hono/zod-validator": "^0.4.3",
    "hono": "^4.7.7",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.14",
    "@cloudflare/workers-types": "^4.20250409.0",
    "typescript": "^5.8.3",
    "vitest": "~3.0.9",
    "wrangler": "^4.10.0"
  },
  "engines": {
    "node": ">=20"
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
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "verbatimModuleSyntax": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

---

### `wrangler.toml`

```toml
name = "team-task-board"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = true

# Observability: structured logs from console.log land in Workers Logs / tail.
[observability]
enabled = true

[vars]
# Comma separated list of allowed browser origins, or "*" to allow any origin.
ALLOWED_ORIGINS = "*"
ENVIRONMENT = "development"

# Create with: wrangler kv namespace create TASKS
#              wrangler kv namespace create TASKS --preview
[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_PREVIEW_KV_NAMESPACE_ID"

# API_TOKEN is a secret, never put it in this file:
#   wrangler secret put API_TOKEN
# For local dev put it in .dev.vars

[env.production]
name = "team-task-board-prod"

[env.production.vars]
ALLOWED_ORIGINS = "https://board.example.com"
ENVIRONMENT = "production"

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
.dev.vars
.wrangler/
dist/
*.log
```

---

### `src/types.ts`

```ts
export interface Env {
  /** KV namespace holding projects and tasks. */
  TASKS: KVNamespace;
  /** Bearer token required by every route except /health. */
  API_TOKEN: string;
  /** Comma separated origins, or "*". */
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
}

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

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

/** Small blob kept in KV list metadata so listing does not require a read per key. */
export interface ProjectMeta {
  name: string;
  createdAt: string;
}

export interface TaskMeta {
  status: TaskStatus;
  createdAt: string;
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

/** Hono generics used across the app. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
};
```

---

### `src/errors.ts`

```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/** Error type that maps cleanly onto the public JSON error shape. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: ErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
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
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static validation(message = 'Request body failed validation.', details?: unknown) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Missing or invalid bearer token.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static notFound(message = 'Resource not found.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static methodNotAllowed(message = 'Method not allowed for this resource.') {
    return new ApiError(405, 'METHOD_NOT_ALLOWED', message);
  }

  static internal(message = 'An unexpected error occurred.') {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}
```

---

### `src/responses.ts`

```ts
import type { Context } from 'hono';
import type { AppEnv } from './types';
import { ApiError } from './errors';

/** Render an ApiError as JSON, attaching Allow header for 405s where useful. */
export function errorResponse(
  c: Context<AppEnv>,
  err: ApiError,
  allow?: readonly string[],
) {
  if (allow?.length) c.header('Allow', allow.join(', '));
  return c.json(err.toBody(), err.status);
}

/**
 * Handler factory for "route exists but method does not" cases.
 * Registered with app.all() *after* the concrete method handlers, so Hono
 * only reaches it when the path matched but no method handler did.
 */
export function methodNotAllowed(...allow: string[]) {
  return (c: Context<AppEnv>) =>
    errorResponse(
      c,
      ApiError.methodNotAllowed(
        `Method ${c.req.method} is not allowed for ${new URL(c.req.url).pathname}.`,
      ),
      [...allow, 'OPTIONS'],
    );
}
```

---

### `src/schemas.ts`

```ts
import { z } from 'zod';
import { TASK_STATUSES } from './types';

/** Trimmed, non-empty, bounded string. */
const text = (max: number) => z.string().trim().min(1).max(max);

export const projectIdParam = z.object({
  projectId: z.string().min(1).max(128),
});

export const taskIdParams = z.object({
  projectId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
});

export const createProjectSchema = z
  .object({
    name: text(120),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: text(200),
    description: z.string().trim().max(5_000).optional(),
    status: z.enum(TASK_STATUSES).default('todo'),
    assignee: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/**
 * PATCH: every field optional, but at least one must be present.
 * `description` and `assignee` accept `null` to clear the field.
 */
export const updateTaskSchema = z
  .object({
    title: text(200).optional(),
    description: z.string().trim().max(5_000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one of: title, description, status, assignee.',
  });

export const listTasksQuerySchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

export const listProjectsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strip();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
```

---

### `src/store.ts`

KV access layer. Keys are `project:<id>` and `task:<projectId>:<taskId>`, so a project's tasks are a contiguous KV prefix (cheap listing + cascade delete). List metadata carries the fields needed for filtering/sorting, so listing costs one `list` instead of N `get`s.

```ts
import type {
  Page,
  Project,
  ProjectMeta,
  Task,
  TaskMeta,
  TaskStatus,
} from './types';

const projectKey = (projectId: string) => `project:${projectId}`;
const taskKey = (projectId: string, taskId: string) => `task:${projectId}:${taskId}`;
const taskPrefix = (projectId: string) => `task:${projectId}:`;

const PROJECT_PREFIX = 'project:';
const KV_LIST_LIMIT = 1000;

interface ListedKey<M> {
  name: string;
  metadata: M | null;
}

/** Drain a KV prefix listing across cursors. */
async function listAll<M>(
  kv: KVNamespace,
  prefix: string,
): Promise<ListedKey<M>[]> {
  const out: ListedKey<M>[] = [];
  let cursor: string | undefined;

  for (;;) {
    const res = await kv.list<M>({ prefix, limit: KV_LIST_LIMIT, cursor });
    for (const k of res.keys) {
      out.push({ name: k.name, metadata: (k.metadata as M | undefined) ?? null });
    }
    if (res.list_complete) break;
    cursor = res.cursor;
    if (!cursor) break;
  }
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

/** Newest first, id as deterministic tiebreaker. */
function byCreatedAtDesc(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) {
  if (a.createdAt === b.createdAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

export class Store {
  constructor(private readonly kv: KVNamespace) {}

  // ---------------------------------------------------------------- projects

  async createProject(input: { name: string }): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    const metadata: ProjectMeta = { name: project.name, createdAt: project.createdAt };
    await this.kv.put(projectKey(project.id), JSON.stringify(project), { metadata });
    return project;
  }

  async getProject(projectId: string): Promise<Project | null> {
    return await this.kv.get<Project>(projectKey(projectId), 'json');
  }

  async projectExists(projectId: string): Promise<boolean> {
    // Metadata-only read avoids pulling the value body.
    const { value, metadata } = await this.kv.getWithMetadata<ProjectMeta>(
      projectKey(projectId),
      'text',
    );
    return value !== null || metadata !== null;
  }

  async listProjects(page: number, pageSize: number): Promise<Page<Project>> {
    const keys = await listAll<ProjectMeta>(this.kv, PROJECT_PREFIX);

    const projects: Project[] = [];
    const needsFetch: string[] = [];

    for (const key of keys) {
      const id = key.name.slice(PROJECT_PREFIX.length);
      if (key.metadata) {
        projects.push({ id, name: key.metadata.name, createdAt: key.metadata.createdAt });
      } else {
        needsFetch.push(id); // legacy rows written without metadata
      }
    }

    if (needsFetch.length) {
      const fetched = await Promise.all(needsFetch.map((id) => this.getProject(id)));
      for (const p of fetched) if (p) projects.push(p);
    }

    projects.sort(byCreatedAtDesc);
    return paginate(projects, page, pageSize);
  }

  /** Deletes the project and cascades to all of its tasks. */
  async deleteProject(projectId: string): Promise<boolean> {
    const existed = await this.projectExists(projectId);
    if (!existed) return false;

    const taskKeys = await listAll<TaskMeta>(this.kv, taskPrefix(projectId));
    // Bounded concurrency to stay friendly with subrequest limits.
    const CHUNK = 25;
    for (let i = 0; i < taskKeys.length; i += CHUNK) {
      await Promise.all(taskKeys.slice(i, i + CHUNK).map((k) => this.kv.delete(k.name)));
    }
    await this.kv.delete(projectKey(projectId));
    return true;
  }

  // ------------------------------------------------------------------- tasks

  async createTask(
    projectId: string,
    input: { title: string; description?: string; status: TaskStatus; assignee?: string },
  ): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      projectId,
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      status: input.status,
      ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
      createdAt: now,
      updatedAt: now,
    };
    await this.putTask(task);
    return task;
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    return await this.kv.get<Task>(taskKey(projectId, taskId), 'json');
  }

  async putTask(task: Task): Promise<void> {
    const metadata: TaskMeta = { status: task.status, createdAt: task.createdAt };
    await this.kv.put(taskKey(task.projectId, task.id), JSON.stringify(task), { metadata });
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;
    await this.kv.delete(taskKey(projectId, taskId));
    return true;
  }

  async listTasks(
    projectId: string,
    opts: { status?: TaskStatus; page: number; pageSize: number },
  ): Promise<Page<Task>> {
    const prefix = taskPrefix(projectId);
    const keys = await listAll<TaskMeta>(this.kv, prefix);

    // Filter/sort on cheap metadata first...
    const candidates = keys
      .map((k) => ({
        id: k.name.slice(prefix.length),
        status: k.metadata?.status,
        createdAt: k.metadata?.createdAt ?? '',
      }))
      .filter((k) => {
        if (!opts.status) return true;
        // Unknown metadata (legacy row) is resolved by reading the value below.
        return k.status === undefined || k.status === opts.status;
      })
      .sort(byCreatedAtDesc);

    const { data: pageKeys, pagination } = paginate(candidates, opts.page, opts.pageSize);

    // ...then read only the page of full task bodies.
    const tasks = (
      await Promise.all(pageKeys.map((k) => this.getTask(projectId, k.id)))
    ).filter((t): t is Task => t !== null && (!opts.status || t.status === opts.status));

    return { data: tasks, pagination };
  }
}
```

---

### `src/middleware/logger.ts`

```ts
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

/**
 * Structured access log: method, path, status, duration.
 * Runs outermost so it also observes responses produced by onError/notFound.
 */
export const accessLogger = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const start = Date.now();
  const requestId =
    c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);

  let thrown: unknown;
  try {
    await next();
  } catch (err) {
    thrown = err;
  } finally {
    const durationMs = Date.now() - start;
    const url = new URL(c.req.url);
    const status = thrown ? 500 : (c.res?.status ?? 500);

    // Single-line JSON so Workers Logs / `wrangler tail` stay queryable.
    console.log(
      JSON.stringify({
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        msg: 'request',
        requestId,
        method: c.req.method,
        path: url.pathname,
        query: url.search ? url.search.slice(1) : undefined,
        status,
        durationMs,
        ip: c.req.header('cf-connecting-ip'),
        userAgent: c.req.header('user-agent'),
      }),
    );
  }

  if (thrown) throw thrown;

  c.res.headers.set('x-request-id', requestId);
};
```

---

### `src/middleware/cors.ts`

```ts
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

/**
 * CORS with an allow-list sourced from the ALLOWED_ORIGINS var (or "*").
 * Handles preflight (OPTIONS) automatically, before auth runs.
 */
export const corsMiddleware = (): MiddlewareHandler<AppEnv> => (c, next) => {
  const raw = (c.env.ALLOWED_ORIGINS ?? '*').trim();
  const allowList = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowAny = allowList.includes('*') || allowList.length === 0;

  return cors({
    origin: (origin) => {
      if (allowAny) return origin || '*';
      return origin && allowList.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id'],
    credentials: !allowAny,
    maxAge: 86_400,
  })(c, next);
};
```

---

### `src/middleware/auth.ts`

```ts
import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../errors';
import type { AppEnv } from '../types';

/** Length-independent, constant-time-ish comparison of two secrets. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare digests so differing lengths do not leak via early exit.
  if (ab.byteLength !== bb.byteLength) {
    let diff = 1;
    for (let i = 0; i < Math.max(ab.byteLength, bb.byteLength); i++) {
      diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
    }
    return diff === 0;
  }
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

/** Requires `Authorization: Bearer <API_TOKEN>`. */
export const bearerAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const expected = c.env.API_TOKEN;
  if (!expected) {
    // Misconfiguration: fail closed, and make it loud in the logs.
    console.log(
      JSON.stringify({ level: 'error', msg: 'API_TOKEN binding is not configured' }),
    );
    throw ApiError.unauthorized('Server is not configured for authentication.');
  }

  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  if (!match || !safeEqual(match[1]!.trim(), expected)) {
    c.header('WWW-Authenticate', 'Bearer realm="api", charset="UTF-8"');
    throw ApiError.unauthorized();
  }

  await next();
};
```

---

### `src/routes/projects.ts`

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ApiError } from '../errors';
import { errorResponse, methodNotAllowed } from '../responses';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParam,
} from '../schemas';
import { Store } from '../store';
import type { AppEnv } from '../types';
import { validationHook } from '../validation';

export const projects = new Hono<AppEnv>();

projects.get(
  '/',
  zValidator('query', listProjectsQuerySchema, validationHook),
  async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const result = await new Store(c.env.TASKS).listProjects(page, pageSize);
    return c.json(result, 200);
  },
);

projects.post(
  '/',
  zValidator('json', createProjectSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const project = await new Store(c.env.TASKS).createProject(body);
    c.header('Location', `/api/v1/projects/${project.id}`);
    return c.json(project, 201);
  },
);

projects.get(
  '/:projectId',
  zValidator('param', projectIdParam, validationHook),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const project = await new Store(c.env.TASKS).getProject(projectId);
    if (!project) {
      return errorResponse(c, ApiError.notFound(`Project '${projectId}' was not found.`));
    }
    return c.json(project, 200);
  },
);

projects.delete(
  '/:projectId',
  zValidator('param', projectIdParam, validationHook),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const deleted = await new Store(c.env.TASKS).deleteProject(projectId);
    if (!deleted) {
      return errorResponse(c, ApiError.notFound(`Project '${projectId}' was not found.`));
    }
    return c.body(null, 204);
  },
);

// 405 fallbacks (registered last so concrete method handlers win).
projects.all('/', methodNotAllowed('GET', 'POST'));
projects.all('/:projectId', methodNotAllowed('GET', 'DELETE'));
```

---

### `src/routes/tasks.ts`

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ApiError } from '../errors';
import { errorResponse, methodNotAllowed } from '../responses';
import {
  createTaskSchema,
  listTasksQuerySchema,
  projectIdParam,
  taskIdParams,
  updateTaskSchema,
} from '../schemas';
import { Store } from '../store';
import type { AppEnv, Task } from '../types';
import { validationHook } from '../validation';

export const tasks = new Hono<AppEnv>();

/** Shared guard: 404 when the parent project does not exist. */
async function requireProject(store: Store, projectId: string) {
  if (!(await store.projectExists(projectId))) {
    throw ApiError.notFound(`Project '${projectId}' was not found.`);
  }
}

tasks.get(
  '/',
  zValidator('param', projectIdParam, validationHook),
  zValidator('query', listTasksQuerySchema, validationHook),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { status, page, pageSize } = c.req.valid('query');
    const store = new Store(c.env.TASKS);
    await requireProject(store, projectId);
    const result = await store.listTasks(projectId, { status, page, pageSize });
    return c.json(result, 200);
  },
);

tasks.post(
  '/',
  zValidator('param', projectIdParam, validationHook),
  zValidator('json', createTaskSchema, validationHook),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const body = c.req.valid('json');
    const store = new Store(c.env.TASKS);
    await requireProject(store, projectId);
    const task = await store.createTask(projectId, body);
    c.header('Location', `/api/v1/projects/${projectId}/tasks/${task.id}`);
    return c.json(task, 201);
  },
);

tasks.get(
  '/:taskId',
  zValidator('param', taskIdParams, validationHook),
  async (c) => {
    const { projectId, taskId } = c.req.valid('param');
    const store = new Store(c.env.TASKS);
    await requireProject(store, projectId);
    const task = await store.getTask(projectId, taskId);
    if (!task) {
      return errorResponse(c, ApiError.notFound(`Task '${taskId}' was not found.`));
    }
    return c.json(task, 200);
  },
);

tasks.patch(
  '/:taskId',
  zValidator('param', taskIdParams, validationHook),
  zValidator('json', updateTaskSchema, validationHook),
  async (c) => {
    const { projectId, taskId } = c.req.valid('param');
    const patch = c.req.valid('json');
    const store = new Store(c.env.TASKS);
    await requireProject(store, projectId);

    const existing = await store.getTask(projectId, taskId);
    if (!existing) {
      return errorResponse(c, ApiError.notFound(`Task '${taskId}' was not found.`));
    }

    const updated: Task = { ...existing, updatedAt: new Date().toISOString() };
    if (patch.title !== undefined) updated.title = patch.title;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.description !== undefined) {
      if (patch.description === null || patch.description === '') delete updated.description;
      else updated.description = patch.description;
    }
    if (patch.assignee !== undefined) {
      if (patch.assignee === null || patch.assignee === '') delete updated.assignee;
      else updated.assignee = patch.assignee;
    }

    await store.putTask(updated);
    return c.json(updated, 200);
  },
);

tasks.delete(
  '/:taskId',
  zValidator('param', taskIdParams, validationHook),
  async (c) => {
    const { projectId, taskId } = c.req.valid('param');
    const store = new Store(c.env.TASKS);
    await requireProject(store, projectId);
    const deleted = await store.deleteTask(projectId, taskId);
    if (!deleted) {
      return errorResponse(c, ApiError.notFound(`Task '${taskId}' was not found.`));
    }
    return c.body(null, 204);
  },
);

tasks.all('/', methodNotAllowed('GET', 'POST'));
tasks.all('/:taskId', methodNotAllowed('GET', 'PATCH', 'DELETE'));
```

---

### `src/validation.ts`

```ts
import type { Context } from 'hono';
import type { ZodError } from 'zod';
import { ApiError } from './errors';
import { errorResponse } from './responses';
import type { AppEnv } from './types';

interface Issue {
  path: string;
  message: string;
  code: string;
}

function toIssues(error: ZodError): Issue[] {
  return error.issues.map((i) => ({
    path: i.path.length ? i.path.join('.') : '(root)',
    message: i.message,
    code: i.code,
  }));
}

/**
 * Shared zValidator hook: converts Zod failures into the standard
 * { error: { code, message, details } } 400 response.
 */
export function validationHook(
  result: { success: true; data: unknown } | { success: false; error: ZodError },
  c: Context<AppEnv>,
) {
  if (result.success) return;
  const issues = toIssues(result.error);
  const summary = issues.map((i) => `${i.path}: ${i.message}`).join('; ');
  return errorResponse(
    c,
    ApiError.validation(summary || 'Request failed validation.', issues),
  );
}
```

---

### `src/index.ts`

```ts
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { ApiError } from './errors';
import { bearerAuth } from './middleware/auth';
import { corsMiddleware } from './middleware/cors';
import { accessLogger } from './middleware/logger';
import { errorResponse } from './responses';
import { projects } from './routes/projects';
import { tasks } from './routes/tasks';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

/* ------------------------------- middleware ------------------------------ */

app.use('*', accessLogger());
app.use('*', secureHeaders());
app.use('*', corsMiddleware()); // handles preflight before auth

const api = app.basePath('/api/v1');

// Public.
api.get('/health', (c) => c.json({ ok: true }, 200));

// Everything else requires a bearer token.
api.use('/projects', bearerAuth());
api.use('/projects/*', bearerAuth());

/* --------------------------------- routes -------------------------------- */

api.route('/projects', projects);
api.route('/projects/:projectId/tasks', tasks);

/* ---------------------------- error handling ----------------------------- */

app.notFound((c) =>
  errorResponse(
    c,
    ApiError.notFound(
      `No route matches ${c.req.method} ${new URL(c.req.url).pathname}.`,
    ),
  ),
);

app.onError((err, c) => {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      c.header('WWW-Authenticate', 'Bearer realm="api", charset="UTF-8"');
    }
    return errorResponse(c, err);
  }

  // Hono throws these for malformed JSON bodies, oversized payloads, etc.
  if (err instanceof HTTPException) {
    const status = err.status;
    if (status === 400) return errorResponse(c, ApiError.badRequest(err.message));
    if (status === 404) return errorResponse(c, ApiError.notFound(err.message));
    if (status === 405) return errorResponse(c, ApiError.methodNotAllowed(err.message));
    if (status === 413) {
      return errorResponse(
        c,
        new ApiError(413, 'PAYLOAD_TOO_LARGE', err.message || 'Payload too large.'),
      );
    }
  }

  // Malformed JSON surfaces as SyntaxError from c.req.json().
  if (err instanceof SyntaxError) {
    return errorResponse(c, ApiError.badRequest('Request body is not valid JSON.'));
  }

  console.log(
    JSON.stringify({
      level: 'error',
      msg: 'unhandled_error',
      requestId: c.get('requestId'),
      name: err.name,
      error: err.message,
      stack: err.stack,
    }),
  );
  return errorResponse(c, ApiError.internal());
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
        isolatedStorage: true,
        miniflare: {
          kvNamespaces: ['TASKS'],
          bindings: {
            API_TOKEN: 'test-token',
            ALLOWED_ORIGINS: 'https://board.example.com',
            ENVIRONMENT: 'test',
          },
        },
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

---

### `test/api.spec.ts`

```ts
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const BASE = 'https://api.test/api/v1';
const AUTH = { Authorization: 'Bearer test-token' };
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' };

async function clearKv() {
  const { keys } = await env.TASKS.list();
  await Promise.all(keys.map((k) => env.TASKS.delete(k.name)));
}

async function createProject(name = 'Apollo') {
  const res = await SELF.fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string; createdAt: string };
}

async function createTask(projectId: string, body: Record<string, unknown>) {
  const res = await SELF.fetch(`${BASE}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, any>;
}

beforeEach(clearKv);

describe('health & auth', () => {
  it('health is public', async () => {
    const res = await SELF.fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects missing token', async () => {
    const res = await SELF.fetch(`${BASE}/projects`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects wrong token', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(401);
  });
});

describe('cors', () => {
  it('answers preflight without auth', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://board.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://board.example.com',
    );
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
  });

  it('omits allow-origin for disallowed origins', async () => {
    const res = await SELF.fetch(`${BASE}/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('projects', () => {
  it('creates, lists, gets and deletes', async () => {
    const created = await createProject('Apollo');
    expect(created).toMatchObject({ name: 'Apollo' });
    expect(created.id).toBeTruthy();

    const list = await (await SELF.fetch(`${BASE}/projects`, { headers: AUTH })).json() as any;
    expect(list.pagination.total).toBe(1);
    expect(list.data[0].id).toBe(created.id);

    const one = await SELF.fetch(`${BASE}/projects/${created.id}`, { headers: AUTH });
    expect(one.status).toBe(200);

    const del = await SELF.fetch(`${BASE}/projects/${created.id}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(del.status).toBe(204);

    const gone = await SELF.fetch(`${BASE}/projects/${created.id}`, { headers: AUTH });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('validates the create body', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].path).toBe('name');
  });

  it('rejects unknown fields and malformed JSON', async () => {
    const extra = await SELF.fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'ok', color: 'red' }),
    });
    expect(extra.status).toBe(400);

    const bad = await SELF.fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{not json',
    });
    expect(bad.status).toBe(400);
  });

  it('deleting a project cascades to its tasks', async () => {
    const project = await createProject();
    await createTask(project.id, { title: 'a' });
    await createTask(project.id, { title: 'b' });

    await SELF.fetch(`${BASE}/projects/${project.id}`, { method: 'DELETE', headers: AUTH });

    const { keys } = await env.TASKS.list({ prefix: `task:${project.id}:` });
    expect(keys).toHaveLength(0);
  });
});

describe('tasks', () => {
  it('creates with defaults and reads back', async () => {
    const project = await createProject();
    const task = await createTask(project.id, {
      title: 'Write spec',
      description: 'the details',
      assignee: 'ada',
    });
    expect(task).toMatchObject({
      projectId: project.id,
      title: 'Write spec',
      status: 'todo',
      assignee: 'ada',
    });

    const res = await SELF.fetch(`${BASE}/projects/${project.id}/tasks/${task.id}`, {
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).id).toBe(task.id);
  });

  it('filters by status and paginates', async () => {
    const project = await createProject();
    for (let i = 0; i < 5; i++) {
      await createTask(project.id, { title: `t${i}`, status: i % 2 ? 'done' : 'todo' });
    }

    const done = await (
      await SELF.fetch(`${BASE}/projects/${project.id}/tasks?status=done`, { headers: AUTH })
    ).json() as any;
    expect(done.pagination.total).toBe(2);
    expect(done.data.every((t: any) => t.status === 'done')).toBe(true);

    const p1 = await (
      await SELF.fetch(`${BASE}/projects/${project.id}/tasks?page=1&pageSize=2`, {
        headers: AUTH,
      })
    ).json() as any;
    expect(p1.data).toHaveLength(2);
    expect(p1.pagination).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    const p3 = await (
      await SELF.fetch(`${BASE}/projects/${project.id}/tasks?page=3&pageSize=2`, {
        headers: AUTH,
      })
    ).json() as any;
    expect(p3.data).toHaveLength(1);
  });

  it('rejects invalid query params and status values', async () => {
    const project = await createProject();
    const badStatus = await SELF.fetch(
      `${BASE}/projects/${project.id}/tasks?status=nope`,
      { headers: AUTH },
    );
    expect(badStatus.status).toBe(400);

    const badPage = await SELF.fetch(`${BASE}/projects/${project.id}/tasks?page=0`, {
      headers: AUTH,
    });
    expect(badPage.status).toBe(400);
  });

  it('patches partially and bumps updatedAt', async () => {
    const project = await createProject();
    const task = await createTask(project.id, { title: 'old', assignee: 'ada' });

    const res = await SELF.fetch(`${BASE}/projects/${project.id}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: 'in_progress', assignee: null }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as any;
    expect(updated.title).toBe('old');
    expect(updated.status).toBe('in_progress');
    expect(updated.assignee).toBeUndefined();
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(task.updatedAt).getTime(),
    );
  });

  it('rejects an empty patch', async () => {
    const project = await createProject();
    const task = await createTask(project.id, { title: 'x' });
    const res = await SELF.fetch(`${BASE}/projects/${project.id}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('404s for unknown project or task', async () => {
    const project = await createProject();
    const missingProject = await SELF.fetch(`${BASE}/projects/nope/tasks`, { headers: AUTH });
    expect(missingProject.status).toBe(404);

    const missingTask = await SELF.fetch(`${BASE}/projects/${project.id}/tasks/nope`, {
      headers: AUTH,
    });
    expect(missingTask.status).toBe(404);
  });

  it('deletes a task', async () => {
    const project = await createProject();
    const task = await createTask(project.id, { title: 'bye' });
    const del = await SELF.fetch(`${BASE}/projects/${project.id}/tasks/${task.id}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(del.status).toBe(204);
    const again = await SELF.fetch(`${BASE}/projects/${project.id}/tasks/${task.id}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(again.status).toBe(404);
  });
});

describe('routing errors', () => {
  it('405 with Allow header for wrong method on a known path', async () => {
    const res = await SELF.fetch(`${BASE}/projects`, { method: 'PATCH', headers: AUTH });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('POST');
    expect(await res.json()).toMatchObject({ error: { code: 'METHOD_NOT_ALLOWED' } });
  });

  it('404 in the standard shape for unknown routes', async () => {
    const res = await SELF.fetch(`${BASE}/nope`, { headers: AUTH });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });
});
```

---

### `README.md`

````markdown
# Team Task Board API (Cloudflare Workers)

REST API for projects and tasks, built with **Hono** + **Zod**, persisted in **Cloudflare KV**.

## Setup

```bash
npm install

# Create KV namespaces and paste the ids into wrangler.toml
npx wrangler kv namespace create TASKS
npx wrangler kv namespace create TASKS --preview

# Local secret
cp .dev.vars.example .dev.vars    # then edit API_TOKEN

npm run dev
```

Deploy:

```bash
npx wrangler secret put API_TOKEN            # default env
npx wrangler secret put API_TOKEN --env production
npm run deploy                                # or: wrangler deploy --env production
```

Tests (run in `workerd` with a real KV simulator):

```bash
npm test
```

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer <API_TOKEN>
```

Missing/incorrect tokens → `401` with a `WWW-Authenticate` header. CORS preflight
(`OPTIONS`) is answered before auth so browsers work correctly.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | public, `{ "ok": true }` |
| GET | `/api/v1/projects` | `?page=&pageSize=` (pageSize ≤ 100) |
| POST | `/api/v1/projects` | `{ "name": "..." }` → 201 + `Location` |
| GET | `/api/v1/projects/:projectId` | 404 if missing |
| DELETE | `/api/v1/projects/:projectId` | 204, cascades to tasks |
| GET | `/api/v1/projects/:projectId/tasks` | `?status=todo\|in_progress\|done&page=&pageSize=` |
| POST | `/api/v1/projects/:projectId/tasks` | `{ title, description?, status?, assignee? }` |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | any of `title`, `description`, `status`, `assignee`; `null` clears optional fields |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | 204 |

### Examples

```bash
TOKEN=dev-super-secret-token
API=http://localhost:8787/api/v1

curl -s $API/health

PID=$(curl -s -X POST $API/projects \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Apollo"}' | jq -r .id)

curl -s -X POST $API/projects/$PID/tasks \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Ship API","assignee":"ada","status":"in_progress"}'

curl -s "$API/projects/$PID/tasks?status=in_progress&page=1&pageSize=20" \
  -H "Authorization: Bearer $TOKEN"
```

### List response shape

```json
{
  "data": [ { "id": "…", "projectId": "…", "title": "…", "status": "todo", "createdAt": "…", "updatedAt": "…" } ],
  "pagination": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 }
}
```

### Error shape

All failures use the same envelope; `details` is added for validation errors.

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "title: String must contain at least 1 character(s)", "details": [ … ] } }
```

Codes: `VALIDATION_ERROR`/`BAD_REQUEST` (400), `UNAUTHORIZED` (401),
`NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405, with `Allow` header),
`PAYLOAD_TOO_LARGE` (413), `INTERNAL_ERROR` (500).

## Logging

One structured JSON line per request (visible via `wrangler tail` / Workers Logs):

```json
{"level":"info","msg":"request","requestId":"…","method":"GET","path":"/api/v1/projects","status":200,"durationMs":7}
```

Each response also carries `X-Request-Id` for client-side correlation.

## KV data layout & trade-offs

- `project:<projectId>` → `Project` JSON, with `{name, createdAt}` in KV **list metadata**.
- `task:<projectId>:<taskId>` → `Task` JSON, with `{status, createdAt}` in list metadata.

Because a project's tasks share a key prefix, listing and cascade deletes are a
prefix `list`. Filtering/sorting/pagination happen over list metadata, so only the
requested page of task bodies is actually read.

Caveats inherent to KV: writes are eventually consistent (a create may take a
moment to appear in `list` at the edge), and there are no transactions, so
concurrent `PATCH`es to the same task are last-write-wins. For very large
projects (10k+ tasks) or strong consistency/atomicity requirements, move to
Durable Objects or D1 — the `Store` class is the only file that would change.
````