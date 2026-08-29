<!-- model: openrouter/anthropic/claude-opus-5 | run: 1 | framework: Express -->

# Team Task Board API

Stack: **Node 20 + TypeScript + Express 4 + Zod + Pino**, tested with **Vitest + Supertest**. Storage sits behind a `Store` interface (`InMemoryStore` provided, swappable for Postgres/Redis later).

```
.
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── src
│   ├── server.ts
│   ├── app.ts
│   ├── config.ts
│   ├── errors.ts
│   ├── logger.ts
│   ├── schemas.ts
│   ├── middleware
│   │   ├── auth.ts
│   │   ├── errorHandler.ts
│   │   ├── methodNotAllowed.ts
│   │   ├── requestContext.ts
│   │   ├── requestLogger.ts
│   │   └── validate.ts
│   ├── routes
│   │   ├── index.ts
│   │   ├── projects.ts
│   │   └── tasks.ts
│   └── store
│       ├── types.ts
│       └── memory.ts
└── test
    └── api.test.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "REST API for a team task board",
  "type": "commonjs",
  "main": "dist/server.js",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "pino": "^9.3.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "node",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

### `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: {
      API_TOKEN: 'test-token',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
  },
});
```

### `.env.example`

```bash
# Required: bearer token clients must present in `Authorization: Bearer <token>`
API_TOKEN=replace-me-with-a-long-random-string

PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Comma-separated list of allowed browser origins, or `*` for any.
CORS_ORIGINS=*

# Pagination
DEFAULT_PAGE_SIZE=20
MAX_PAGE_SIZE=100
```

### `.gitignore`

```
node_modules
dist
.env
coverage
*.log
```

---

### `src/config.ts`

```ts
import { z } from 'zod';

const csv = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  API_TOKEN: z.string().min(1, 'API_TOKEN must be set'),
  CORS_ORIGINS: csv.default('*'),
  DEFAULT_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(20),
  MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
});

export type Config = z.infer<typeof EnvSchema>;

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Fail fast: a misconfigured process must not start.
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

export const config: Config = load();

export const isProduction = config.NODE_ENV === 'production';
```

### `src/logger.ts`

```ts
import pino from 'pino';
import { config, isProduction } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: undefined, // keep log lines lean; add { service: '...' } if you ship to an aggregator
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'authorization', 'token'],
    censor: '[redacted]',
  },
  ...(isProduction ? {} : { transport: undefined }),
});

export type Logger = typeof logger;
```

### `src/errors.ts`

```ts
export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'payload_too_large'
  | 'internal_error';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/** Any error thrown with this class is safe to expose to clients. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { details?: unknown; headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers;
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

  static validation(message = 'Request validation failed', details?: unknown) {
    return new ApiError(400, 'validation_error', message, { details });
  }

  static unauthorized(message = 'Missing or invalid credentials') {
    return new ApiError(401, 'unauthorized', message, {
      headers: { 'WWW-Authenticate': 'Bearer realm="api", charset="UTF-8"' },
    });
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'not_found', message);
  }

  static methodNotAllowed(allowed: string[]) {
    return new ApiError(405, 'method_not_allowed', 'HTTP method not allowed for this resource', {
      headers: { Allow: allowed.join(', ') },
      details: { allowed },
    });
  }

  static internal(message = 'An unexpected error occurred', cause?: unknown) {
    return new ApiError(500, 'internal_error', message, { cause });
  }
}
```

---

### `src/store/types.ts`

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

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

/** Partial update. `null` explicitly clears an optional field. */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}

export interface ListTasksOptions {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Persistence boundary. Implementations may be async (SQL, Redis, ...),
 * so every method returns a promise even if the current one is synchronous.
 */
export interface Store {
  listProjects(): Promise<Project[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(projectId: string): Promise<Project | null>;
  /** Deletes the project and cascades to its tasks. Returns false if absent. */
  deleteProject(projectId: string): Promise<boolean>;

  listTasks(projectId: string, options: ListTasksOptions): Promise<Page<Task>>;
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  getTask(projectId: string, taskId: string): Promise<Task | null>;
  updateTask(projectId: string, taskId: string, patch: UpdateTaskInput): Promise<Task | null>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

### `src/store/memory.ts`

```ts
import { randomUUID } from 'node:crypto';
import type {
  CreateProjectInput,
  CreateTaskInput,
  ListTasksOptions,
  Page,
  Project,
  Store,
  Task,
  UpdateTaskInput,
} from './types';

/**
 * Reference implementation of `Store` backed by process memory.
 * Data is lost on restart — swap for a real database in production.
 */
export class InMemoryStore implements Store {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: { now?: () => Date; newId?: () => string } = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(clone);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: this.newId(),
      name: input.name,
      createdAt: this.now().toISOString(),
    };
    this.projects.set(project.id, project);
    return clone(project);
  }

  async getProject(projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    return project ? clone(project) : null;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    if (!this.projects.delete(projectId)) return false;
    for (const [taskId, task] of this.tasks) {
      if (task.projectId === projectId) this.tasks.delete(taskId);
    }
    return true;
  }

  async listTasks(projectId: string, options: ListTasksOptions): Promise<Page<Task>> {
    const matching = [...this.tasks.values()]
      .filter((t) => t.projectId === projectId)
      .filter((t) => (options.status ? t.status === options.status : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

    const start = (options.page - 1) * options.pageSize;
    return {
      items: matching.slice(start, start + options.pageSize).map(clone),
      total: matching.length,
      page: options.page,
      pageSize: options.pageSize,
    };
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    const timestamp = this.now().toISOString();
    const task: Task = {
      id: this.newId(),
      projectId,
      title: input.title,
      status: input.status ?? 'todo',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
    };
    this.tasks.set(task.id, task);
    return clone(task);
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return null;
    return clone(task);
  }

  async updateTask(
    projectId: string,
    taskId: string,
    patch: UpdateTaskInput,
  ): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return null;

    const next: Task = { ...task };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.status !== undefined) next.status = patch.status;
    applyOptional(next, 'description', patch.description);
    applyOptional(next, 'assignee', patch.assignee);
    next.updatedAt = this.now().toISOString();

    this.tasks.set(taskId, next);
    return clone(next);
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return false;
    this.tasks.delete(taskId);
    return true;
  }
}

function applyOptional(
  task: Task,
  key: 'description' | 'assignee',
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) delete task[key];
  else task[key] = value;
}

function clone<T>(value: T): T {
  return { ...value };
}
```

---

### `src/schemas.ts`

```ts
import { z } from 'zod';
import { config } from './config';
import { TASK_STATUSES } from './store/types';

const trimmed = (max: number) => z.string().trim().max(max);

export const ProjectIdParamsSchema = z.object({
  projectId: trimmed(128).min(1),
});

export const TaskParamsSchema = z.object({
  projectId: trimmed(128).min(1),
  taskId: trimmed(128).min(1),
});

export const CreateProjectSchema = z
  .object({
    name: trimmed(200).min(1, 'name must not be empty'),
  })
  .strict();

export const CreateTaskSchema = z
  .object({
    title: trimmed(200).min(1, 'title must not be empty'),
    description: trimmed(5_000).min(1).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: trimmed(200).min(1).optional(),
  })
  .strict();

export const UpdateTaskSchema = z
  .object({
    title: trimmed(200).min(1).optional(),
    description: trimmed(5_000).min(1).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: trimmed(200).min(1).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one of title, description, status, assignee must be provided',
  });

export const ListTasksQuerySchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(config.MAX_PAGE_SIZE)
      .default(config.DEFAULT_PAGE_SIZE),
  })
  .strict();

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
```

---

### `src/middleware/requestContext.ts`

```ts
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id: inbound X-Request-Id when present, otherwise generated. */
      id: string;
    }
  }
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get('x-request-id');
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
```

### `src/middleware/requestLogger.ts`

```ts
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';

/** Logs method, path, status and duration once the response is complete. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const payload = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip,
    };

    const message = `${req.method} ${payload.path} ${res.statusCode} ${payload.durationMs}ms`;
    if (res.statusCode >= 500) logger.error(payload, message);
    else if (res.statusCode >= 400) logger.warn(payload, message);
    else logger.info(payload, message);
  });

  next();
}
```

### `src/middleware/auth.ts`

```ts
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ApiError } from '../errors';

const BEARER = /^Bearer[ ]+(?<token>[^\s]+)$/i;

/** Requires `Authorization: Bearer <API_TOKEN>`; 401 otherwise. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization');
  if (!header) {
    next(ApiError.unauthorized('Authorization header is required'));
    return;
  }

  const token = BEARER.exec(header)?.groups?.token;
  if (!token) {
    next(ApiError.unauthorized('Authorization header must use the Bearer scheme'));
    return;
  }

  if (!constantTimeEquals(token, config.API_TOKEN)) {
    next(ApiError.unauthorized('Invalid API token'));
    return;
  }

  next();
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison to avoid leaking length via timing.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
```

### `src/middleware/validate.ts`

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodIssue, ZodTypeAny, z } from 'zod';
import { ApiError } from '../errors';

export interface ValidatedData {
  params?: unknown;
  query?: unknown;
  body?: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      valid: ValidatedData;
    }
  }
}

function formatIssues(issues: ZodIssue[]) {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

function make(
  source: keyof ValidatedData,
  schema: ZodTypeAny,
  message: string,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(ApiError.validation(message, formatIssues(result.error.issues)));
      return;
    }
    req.valid = { ...(req.valid ?? {}), [source]: result.data };
    next();
  };
}

export const validateBody = (schema: ZodTypeAny) =>
  make('body', schema, 'Invalid request body');

export const validateQuery = (schema: ZodTypeAny) =>
  make('query', schema, 'Invalid query parameters');

export const validateParams = (schema: ZodTypeAny) =>
  make('params', schema, 'Invalid path parameters');

/** Typed accessors for data produced by the validators above. */
export function body<S extends ZodTypeAny>(req: Request, _schema: S): z.infer<S> {
  return req.valid.body as z.infer<S>;
}
export function query<S extends ZodTypeAny>(req: Request, _schema: S): z.infer<S> {
  return req.valid.query as z.infer<S>;
}
export function params<S extends ZodTypeAny>(req: Request, _schema: S): z.infer<S> {
  return req.valid.params as z.infer<S>;
}
```

### `src/middleware/methodNotAllowed.ts`

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../errors';

/**
 * Mount with `router.all(path, methodNotAllowed([...]))` *after* the real
 * handlers for `path`: the path matched but the method did not.
 */
export function methodNotAllowed(allowed: string[]): RequestHandler {
  const list = [...new Set([...allowed.map((m) => m.toUpperCase()), 'OPTIONS'])];
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Allow', list.join(', '));
    next(ApiError.methodNotAllowed(list));
  };
}
```

### `src/middleware/errorHandler.ts`

```ts
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors';
import { logger } from '../logger';

/** Terminal 404 for paths that matched no route. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`No route matches ${req.method} ${req.path}`));
}

function normalize(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  // express.json() failures
  if (err instanceof SyntaxError && 'body' in err) {
    return ApiError.validation('Request body is not valid JSON');
  }
  const anyErr = err as { type?: string; status?: number; statusCode?: number } | null;
  if (anyErr?.type === 'entity.too.large') {
    return new ApiError(413, 'payload_too_large', 'Request body is too large');
  }
  if (anyErr?.type === 'entity.parse.failed') {
    return ApiError.validation('Request body could not be parsed');
  }
  if (anyErr?.type === 'charset.unsupported' || anyErr?.type === 'encoding.unsupported') {
    return ApiError.validation('Unsupported request body encoding');
  }

  return ApiError.internal('An unexpected error occurred', err);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = normalize(err);

  if (apiError.status >= 500) {
    logger.error(
      { requestId: req.id, err: err instanceof Error ? err : { message: String(err) } },
      'Unhandled error while processing request',
    );
  } else {
    logger.debug(
      { requestId: req.id, code: apiError.code, message: apiError.message },
      'Client error',
    );
  }

  if (res.headersSent) {
    res.destroy();
    return;
  }

  for (const [name, value] of Object.entries(apiError.headers ?? {})) {
    res.setHeader(name, value);
  }
  res.status(apiError.status).json(apiError.toBody());
};
```

---

### `src/routes/projects.ts`

```ts
import { Router } from 'express';
import { ApiError } from '../errors';
import { CreateProjectSchema, ProjectIdParamsSchema } from '../schemas';
import type { Store } from '../store/types';
import { methodNotAllowed } from '../middleware/methodNotAllowed';
import { body, params, validateBody, validateParams } from '../middleware/validate';
import { asyncHandler } from './index';
import { createTasksRouter } from './tasks';

export function createProjectsRouter(store: Store): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const projects = await store.listProjects();
      res.status(200).json({ data: projects });
    }),
  );

  router.post(
    '/',
    validateBody(CreateProjectSchema),
    asyncHandler(async (req, res) => {
      const input = body(req, CreateProjectSchema);
      const project = await store.createProject(input);
      res.status(201).location(`/api/v1/projects/${project.id}`).json({ data: project });
    }),
  );

  router.all('/', methodNotAllowed(['GET', 'POST']));

  // Nested task routes are mounted before the `/:projectId` catch-alls so the
  // longer path wins.
  router.use('/:projectId/tasks', createTasksRouter(store));

  router.get(
    '/:projectId',
    validateParams(ProjectIdParamsSchema),
    asyncHandler(async (req, res) => {
      const { projectId } = params(req, ProjectIdParamsSchema);
      const project = await store.getProject(projectId);
      if (!project) throw ApiError.notFound(`Project '${projectId}' was not found`);
      res.status(200).json({ data: project });
    }),
  );

  router.delete(
    '/:projectId',
    validateParams(ProjectIdParamsSchema),
    asyncHandler(async (req, res) => {
      const { projectId } = params(req, ProjectIdParamsSchema);
      const deleted = await store.deleteProject(projectId);
      if (!deleted) throw ApiError.notFound(`Project '${projectId}' was not found`);
      res.status(204).send();
    }),
  );

  router.all('/:projectId', methodNotAllowed(['GET', 'DELETE']));

  return router;
}
```

### `src/routes/tasks.ts`

```ts
import { Router } from 'express';
import { ApiError } from '../errors';
import {
  CreateTaskSchema,
  ListTasksQuerySchema,
  ProjectIdParamsSchema,
  TaskParamsSchema,
  UpdateTaskSchema,
} from '../schemas';
import type { Store } from '../store/types';
import { methodNotAllowed } from '../middleware/methodNotAllowed';
import {
  body,
  params,
  query,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate';
import { asyncHandler } from './index';

/** Mounted at /projects/:projectId/tasks */
export function createTasksRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  /** Guarantees the parent project exists before touching tasks. */
  const requireProject = asyncHandler(async (req, _res, next) => {
    const { projectId } = params(req, ProjectIdParamsSchema);
    const project = await store.getProject(projectId);
    if (!project) throw ApiError.notFound(`Project '${projectId}' was not found`);
    next();
  });

  router.get(
    '/',
    validateParams(ProjectIdParamsSchema),
    requireProject,
    validateQuery(ListTasksQuerySchema),
    asyncHandler(async (req, res) => {
      const { projectId } = params(req, ProjectIdParamsSchema);
      const { status, page, pageSize } = query(req, ListTasksQuerySchema);

      const result = await store.listTasks(projectId, {
        page,
        pageSize,
        ...(status ? { status } : {}),
      });

      res.status(200).json({
        data: result.items,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
          hasMore: result.page * result.pageSize < result.total,
        },
      });
    }),
  );

  router.post(
    '/',
    validateParams(ProjectIdParamsSchema),
    requireProject,
    validateBody(CreateTaskSchema),
    asyncHandler(async (req, res) => {
      const { projectId } = params(req, ProjectIdParamsSchema);
      const task = await store.createTask(projectId, body(req, CreateTaskSchema));
      res
        .status(201)
        .location(`/api/v1/projects/${projectId}/tasks/${task.id}`)
        .json({ data: task });
    }),
  );

  router.all('/', methodNotAllowed(['GET', 'POST']));

  router.get(
    '/:taskId',
    validateParams(TaskParamsSchema),
    requireProject,
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = params(req, TaskParamsSchema);
      const task = await store.getTask(projectId, taskId);
      if (!task) throw ApiError.notFound(`Task '${taskId}' was not found`);
      res.status(200).json({ data: task });
    }),
  );

  router.patch(
    '/:taskId',
    validateParams(TaskParamsSchema),
    requireProject,
    validateBody(UpdateTaskSchema),
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = params(req, TaskParamsSchema);
      const task = await store.updateTask(projectId, taskId, body(req, UpdateTaskSchema));
      if (!task) throw ApiError.notFound(`Task '${taskId}' was not found`);
      res.status(200).json({ data: task });
    }),
  );

  router.delete(
    '/:taskId',
    validateParams(TaskParamsSchema),
    requireProject,
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = params(req, TaskParamsSchema);
      const deleted = await store.deleteTask(projectId, taskId);
      if (!deleted) throw ApiError.notFound(`Task '${taskId}' was not found`);
      res.status(204).send();
    }),
  );

  router.all('/:taskId', methodNotAllowed(['GET', 'PATCH', 'DELETE']));

  return router;
}
```

### `src/routes/index.ts`

```ts
import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { methodNotAllowed } from '../middleware/methodNotAllowed';
import type { Store } from '../store/types';
import { createProjectsRouter } from './projects';

/** Forwards rejected promises to the Express error pipeline. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
}

export function createApiRouter(store: Store): Router {
  const router = Router();

  // Public: liveness/readiness probe.
  router.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  router.all('/health', methodNotAllowed(['GET']));

  // Everything below requires a valid bearer token.
  router.use(authenticate);
  router.use('/projects', createProjectsRouter(store));

  return router;
}
```

---

### `src/app.ts`

```ts
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { requestLogger } from './middleware/requestLogger';
import { createApiRouter } from './routes';
import { InMemoryStore } from './store/memory';
import type { Store } from './store/types';

const ALLOW_ANY_ORIGIN = config.CORS_ORIGINS.includes('*');

export function createApp(store: Store = new InMemoryStore()): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set('etag', false);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  app.use(
    cors({
      origin: ALLOW_ANY_ORIGIN ? true : config.CORS_ORIGINS,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Location', 'Allow'],
      credentials: !ALLOW_ANY_ORIGIN,
      maxAge: 600,
      optionsSuccessStatus: 204,
    }),
  );

  app.use(requestContext);
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb', strict: true }));

  app.use('/api/v1', createApiRouter(store));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
```

### `src/server.ts`

```ts
import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { InMemoryStore } from './store/memory';

const store = new InMemoryStore();
const app = createApp(store);

const server: Server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    `Team task board API listening on port ${config.PORT}`,
  );
});

server.headersTimeout = 65_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 61_000;

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully');

  const timer = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error while closing HTTP server');
      process.exit(1);
    }
    logger.info('HTTP server closed');
    process.exit(0);
  });
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});
```

---

### `test/api.test.ts`

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryStore } from '../src/store/memory';

const TOKEN = 'test-token';
const auth = { Authorization: `Bearer ${TOKEN}` };

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp(new InMemoryStore());
});

async function newProject(name = 'Apollo') {
  const res = await request(app).post('/api/v1/projects').set(auth).send({ name });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string; createdAt: string };
}

describe('health & auth', () => {
  it('health needs no token', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects missing token with 401 and WWW-Authenticate', async () => {
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Bearer');
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a wrong token', async () => {
    const res = await request(app).get('/api/v1/projects').set({ Authorization: 'Bearer nope' });
    expect(res.status).toBe(401);
  });
});

describe('CORS', () => {
  it('answers preflight requests', async () => {
    const res = await request(app)
      .options('/api/v1/projects')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
  });
});

describe('projects', () => {
  it('creates, lists, reads and deletes', async () => {
    const project = await newProject('Apollo');
    expect(project).toMatchObject({ name: 'Apollo' });

    const list = await request(app).get('/api/v1/projects').set(auth);
    expect(list.body.data).toHaveLength(1);

    const one = await request(app).get(`/api/v1/projects/${project.id}`).set(auth);
    expect(one.status).toBe(200);

    const del = await request(app).delete(`/api/v1/projects/${project.id}`).set(auth);
    expect(del.status).toBe(204);

    const gone = await request(app).get(`/api/v1/projects/${project.id}`).set(auth);
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('not_found');
  });

  it('validates the create body', async () => {
    const res = await request(app).post('/api/v1/projects').set(auth).send({ name: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details[0].path).toBe('name');
  });

  it('rejects unknown fields', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'X', hacker: true });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(auth)
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('deleting a project cascades to its tasks', async () => {
    const project = await newProject();
    await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set(auth)
      .send({ title: 'T1' });

    await request(app).delete(`/api/v1/projects/${project.id}`).set(auth);

    const other = await newProject('Second');
    const res = await request(app).get(`/api/v1/projects/${other.id}/tasks`).set(auth);
    expect(res.body.data).toEqual([]);
  });
});

describe('tasks', () => {
  it('creates with defaults and updates partially', async () => {
    const project = await newProject();

    const created = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set(auth)
      .send({ title: 'Write docs', description: 'Cover the API', assignee: 'ada' });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      title: 'Write docs',
      status: 'todo',
      assignee: 'ada',
      projectId: project.id,
    });

    const taskId = created.body.data.id;
    const patched = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${taskId}`)
      .set(auth)
      .send({ status: 'in_progress', assignee: null });

    expect(patched.status).toBe(200);
    expect(patched.body.data.status).toBe('in_progress');
    expect(patched.body.data.assignee).toBeUndefined();
    expect(patched.body.data.createdAt).toBe(created.body.data.createdAt);

    const removed = await request(app)
      .delete(`/api/v1/projects/${project.id}/tasks/${taskId}`)
      .set(auth);
    expect(removed.status).toBe(204);

    const missing = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${taskId}`)
      .set(auth);
    expect(missing.status).toBe(404);
  });

  it('rejects an empty patch and invalid status', async () => {
    const project = await newProject();
    const created = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set(auth)
      .send({ title: 'T' });
    const taskId = created.body.data.id;

    const empty = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${taskId}`)
      .set(auth)
      .send({});
    expect(empty.status).toBe(400);

    const bad = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${taskId}`)
      .set(auth)
      .send({ status: 'archived' });
    expect(bad.status).toBe(400);
  });

  it('filters by status and paginates', async () => {
    const project = await newProject();
    for (const [i, status] of ['todo', 'todo', 'done', 'in_progress', 'done'].entries()) {
      await request(app)
        .post(`/api/v1/projects/${project.id}/tasks`)
        .set(auth)
        .send({ title: `Task ${i}`, status });
    }

    const done = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks?status=done`)
      .set(auth);
    expect(done.body.data).toHaveLength(2);
    expect(done.body.pagination.total).toBe(2);

    const page2 = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks?page=2&pageSize=2`)
      .set(auth);
    expect(page2.body.data).toHaveLength(2);
    expect(page2.body.pagination).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      hasMore: true,
    });

    const invalid = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks?page=0`)
      .set(auth);
    expect(invalid.status).toBe(400);
  });

  it('404s for tasks under a missing project', async () => {
    const res = await request(app).get('/api/v1/projects/does-not-exist/tasks').set(auth);
    expect(res.status).toBe(404);
  });
});

describe('routing errors', () => {
  it('returns 405 with Allow header for wrong methods', async () => {
    const res = await request(app).put('/api/v1/projects').set(auth);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toContain('POST');
    expect(res.body.error.code).toBe('method_not_allowed');
  });

  it('returns 404 in the standard shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope').set(auth);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'not_found', message: expect.any(String) },
    });
  });
});
```

---

### `Dockerfile`

```dockerfile
# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
```

### `README.md`

````markdown
# Team Task Board API

Express + TypeScript REST API. Storage lives behind the `Store` interface
(`src/store/types.ts`); `InMemoryStore` is the default implementation and can be
replaced by a database-backed one without touching the routes.

## Run

```bash
cp .env.example .env      # set API_TOKEN
npm install
npm run dev               # http://localhost:3000/api/v1/health
npm test
npm run build && npm start
```

## Endpoints (base path `/api/v1`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | public, `{ "ok": true }` |
| GET | `/projects` | list |
| POST | `/projects` | `{ "name": "Apollo" }` → 201 |
| GET | `/projects/:projectId` | 404 if missing |
| DELETE | `/projects/:projectId` | 204, cascades to tasks |
| GET | `/projects/:projectId/tasks` | `?status=&page=&pageSize=` |
| POST | `/projects/:projectId/tasks` | `{ title, description?, status?, assignee? }` |
| GET | `/projects/:projectId/tasks/:taskId` | |
| PATCH | `/projects/:projectId/tasks/:taskId` | any of `title/description/status/assignee`; `null` clears optional fields |
| DELETE | `/projects/:projectId/tasks/:taskId` | 204 |

All routes except `/health` require `Authorization: Bearer $API_TOKEN` (401 otherwise,
compared in constant time).

## Responses

Success: `{ "data": ... }`, lists of tasks also include `pagination`
(`page`, `pageSize`, `total`, `totalPages`, `hasMore`).

Errors are always:

```json
{ "error": { "code": "validation_error", "message": "Invalid request body", "details": [] } }
```

Codes: `validation_error` (400), `unauthorized` (401), `not_found` (404),
`method_not_allowed` (405, with `Allow` header), `payload_too_large` (413),
`internal_error` (500). Internal details are never leaked to clients.

## Cross-cutting

- CORS incl. preflight (`CORS_ORIGINS`, `*` allowed for dev).
- Every request logged with method, path, status, duration and `X-Request-Id`.
- Helmet headers, 100 kB JSON limit, config validated at boot (fail fast),
  graceful shutdown on SIGTERM/SIGINT.

## Example

```bash
curl -s -X POST localhost:3000/api/v1/projects \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Apollo"}'
```
````