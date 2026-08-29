<!-- model: openrouter/anthropic/claude-opus-5 | run: 3 | framework: Express -->

# Team Task Board API

A production-ready REST API built with **Express 5**, **TypeScript (strict)**, **Zod** for validation/env parsing, and **Pino** for structured logging. Storage sits behind an async `Store` interface with an in-memory implementation, so a Postgres/Redis adapter can be dropped in without touching route code.

---

## Project layout

```
.
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── eslint.config.js
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── README.md
├── src
│   ├── server.ts
│   ├── app.ts
│   ├── config.ts
│   ├── logger.ts
│   ├── errors.ts
│   ├── domain
│   │   └── types.ts
│   ├── store
│   │   ├── store.ts
│   │   └── memory-store.ts
│   ├── http
│   │   ├── async-handler.ts
│   │   ├── validate.ts
│   │   └── middleware
│   │       ├── auth.ts
│   │       ├── request-context.ts
│   │       ├── request-logger.ts
│   │       ├── method-not-allowed.ts
│   │       ├── not-found.ts
│   │       └── error-handler.ts
│   ├── schemas
│   │   ├── common.ts
│   │   ├── project.ts
│   │   └── task.ts
│   └── routes
│       ├── index.ts
│       ├── health.routes.ts
│       ├── project.routes.ts
│       └── task.routes.ts
└── test
    ├── setup.ts
    ├── helpers.ts
    ├── auth.test.ts
    ├── projects.test.ts
    └── tasks.test.ts
```

---

## `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "REST API for a team task board",
  "type": "module",
  "engines": {
    "node": ">=20.11.0"
  },
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "helmet": "^8.1.0",
    "pino": "^9.7.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@eslint/js": "^9.32.0",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.3",
    "@types/node": "^22.15.3",
    "@types/supertest": "^6.0.3",
    "@vitest/coverage-v8": "^3.2.4",
    "eslint": "^9.32.0",
    "pino-pretty": "^13.0.0",
    "supertest": "^7.1.1",
    "tsx": "^4.20.3",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.38.0",
    "vitest": "^3.2.4"
  }
}
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],

    "outDir": "dist",
    "rootDir": ".",
    "sourceMap": true,
    "declaration": false,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "noUnusedLocals": true,
    "noUnusedParameters": true,

    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

---

## `tsconfig.build.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test/**/*.ts", "**/*.test.ts"]
}
```

---

## `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
  },
});
```

---

## `eslint.config.js`

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

---

## `.env.example`

```bash
# Required: bearer token clients must present in `Authorization: Bearer <token>`
API_TOKEN=replace-me-with-a-long-random-secret

# Optional
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
LOG_PRETTY=true

# Comma-separated list of allowed browser origins, or `*` for any origin.
CORS_ORIGINS=*
```

---

## `.gitignore`

```
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
*.log
.DS_Store
```

---

## `.dockerignore`

```
node_modules
dist
coverage
.git
.env
.env.*
!.env.example
*.log
```

---

## `src/config.ts`

```ts
import { z } from 'zod';

/**
 * Environment configuration. Parsed and validated once at startup so the
 * process fails fast (rather than at first request) on misconfiguration.
 */
const csvList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.string()).min(1));

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  API_TOKEN: z.string().min(1, 'API_TOKEN must not be empty'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LOG_PRETTY: booleanish.optional(),
  CORS_ORIGINS: csvList.default('*'),
  BODY_LIMIT: z.string().default('100kb'),
});

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  host: string;
  apiToken: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  logPretty: boolean;
  corsOrigins: string[];
  bodyLimit: string;
}>;

function buildConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';

  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    isProduction,
    port: value.PORT,
    host: value.HOST,
    apiToken: value.API_TOKEN,
    logLevel: value.LOG_LEVEL,
    logPretty: value.LOG_PRETTY ?? !isProduction,
    corsOrigins: value.CORS_ORIGINS,
    bodyLimit: value.BODY_LIMIT,
  });
}

export const config: AppConfig = buildConfig();
```

---

## `src/logger.ts`

```ts
import { pino } from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
  base: { service: 'team-task-board-api' },
  redact: {
    paths: ['req.headers.authorization', 'headers.authorization', 'authorization'],
    censor: '[redacted]',
  },
  ...(config.logPretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
```

---

## `src/errors.ts`

```ts
/** Machine-readable error codes returned in `error.code`. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface ErrorBody {
  error: {
    code: ErrorCodeValue | string;
    message: string;
    details?: ErrorDetail[];
    requestId?: string;
  };
}

/** Base class for all errors that map to a deliberate HTTP response. */
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: ErrorDetail[];
  public readonly headers?: Record<string, string>;
  public readonly expose = true;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: ErrorDetail[]; headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (options.details) this.details = options.details;
    if (options.headers) this.headers = options.headers;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: ErrorDetail[]) {
    super(400, ErrorCode.VALIDATION_ERROR, message, details ? { details } : {});
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid credentials') {
    super(401, ErrorCode.UNAUTHORIZED, message, {
      headers: { 'WWW-Authenticate': 'Bearer realm="api", charset="UTF-8"' },
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, ErrorCode.NOT_FOUND, message);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(allowedMethods: readonly string[], message?: string) {
    const allow = [...new Set(allowedMethods.map((m) => m.toUpperCase()))].join(', ');
    super(
      405,
      ErrorCode.METHOD_NOT_ALLOWED,
      message ?? `Method not allowed. Allowed methods: ${allow}`,
      { headers: { Allow: allow } },
    );
  }
}
```

---

## `src/domain/types.ts`

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
```

---

## `src/store/store.ts`

```ts
import type { Project, Task, TaskStatus } from '../domain/types.js';

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

/**
 * Patch semantics:
 *   - key absent  -> leave field unchanged
 *   - key = null  -> clear the optional field
 *   - key = value -> set the field
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}

export interface ListTasksOptions {
  status?: TaskStatus;
  offset: number;
  limit: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

/**
 * Persistence boundary. Every method is async so an adapter backed by a
 * database, HTTP service, or cache can be substituted without changing callers.
 */
export interface Store {
  listProjects(): Promise<Project[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(projectId: string): Promise<Project | null>;
  /** @returns true when a project was deleted (with its tasks), false if absent. */
  deleteProject(projectId: string): Promise<boolean>;

  listTasks(projectId: string, options: ListTasksOptions): Promise<Page<Task>>;
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  getTask(projectId: string, taskId: string): Promise<Task | null>;
  /** @returns the updated task, or null when the task does not exist. */
  updateTask(projectId: string, taskId: string, patch: UpdateTaskInput): Promise<Task | null>;
  /** @returns true when a task was deleted, false if absent. */
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

---

## `src/store/memory-store.ts`

```ts
import { randomUUID } from 'node:crypto';
import type { Project, Task } from '../domain/types.js';
import type {
  CreateProjectInput,
  CreateTaskInput,
  ListTasksOptions,
  Page,
  Store,
  UpdateTaskInput,
} from './store.js';

export interface MemoryStoreOptions {
  /** Injectable for deterministic tests. */
  idFactory?: () => string;
  clock?: () => Date;
}

/**
 * In-memory `Store` implementation. Entities are cloned on the way in and out
 * so callers can never mutate stored state by accident.
 */
export class MemoryStore implements Store {
  private readonly projects = new Map<string, Project>();
  /** projectId -> (taskId -> Task). Insertion order preserved for stable listings. */
  private readonly tasksByProject = new Map<string, Map<string, Task>>();

  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(options: MemoryStoreOptions = {}) {
    this.newId = options.idFactory ?? randomUUID;
    this.now = options.clock ?? (() => new Date());
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()]
      .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)))
      .map(clone);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: this.newId(),
      name: input.name,
      createdAt: this.timestamp(),
    };
    this.projects.set(project.id, project);
    this.tasksByProject.set(project.id, new Map());
    return clone(project);
  }

  async getProject(projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    return project ? clone(project) : null;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const existed = this.projects.delete(projectId);
    this.tasksByProject.delete(projectId);
    return existed;
  }

  async listTasks(projectId: string, options: ListTasksOptions): Promise<Page<Task>> {
    const all = [...(this.tasksByProject.get(projectId)?.values() ?? [])];
    const filtered = options.status ? all.filter((task) => task.status === options.status) : all;
    const items = filtered
      .slice(options.offset, options.offset + options.limit)
      .map(clone);
    return { items, total: filtered.length };
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    const tasks = this.tasksByProject.get(projectId) ?? new Map<string, Task>();
    this.tasksByProject.set(projectId, tasks);

    const timestamp = this.timestamp();
    const task: Task = {
      id: this.newId(),
      projectId,
      title: input.title,
      status: input.status ?? 'todo',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (input.description !== undefined) task.description = input.description;
    if (input.assignee !== undefined) task.assignee = input.assignee;

    tasks.set(task.id, task);
    return clone(task);
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    const task = this.tasksByProject.get(projectId)?.get(taskId);
    return task ? clone(task) : null;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    patch: UpdateTaskInput,
  ): Promise<Task | null> {
    const tasks = this.tasksByProject.get(projectId);
    const existing = tasks?.get(taskId);
    if (!tasks || !existing) return null;

    const next: Task = { ...existing };

    if (patch.title !== undefined) next.title = patch.title;
    if (patch.status !== undefined) next.status = patch.status;

    if (patch.description !== undefined) {
      if (patch.description === null) delete next.description;
      else next.description = patch.description;
    }
    if (patch.assignee !== undefined) {
      if (patch.assignee === null) delete next.assignee;
      else next.assignee = patch.assignee;
    }

    next.updatedAt = this.timestamp();
    tasks.set(taskId, next);
    return clone(next);
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    return this.tasksByProject.get(projectId)?.delete(taskId) ?? false;
  }

  /** Test/dev convenience: wipe all data. Not part of the `Store` contract. */
  reset(): void {
    this.projects.clear();
    this.tasksByProject.clear();
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
```

---

## `src/http/async-handler.ts`

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 forwards rejected promises to the error middleware, but wrapping
 * keeps behaviour explicit and future-proof for handlers used with Express 4.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
```

---

## `src/http/validate.ts`

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ValidationError, type ErrorDetail } from '../errors.js';

export interface ValidationSchemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
}

export interface ValidatedData<S extends ValidationSchemas> {
  params: S['params'] extends ZodTypeAny ? z.infer<S['params']> : undefined;
  query: S['query'] extends ZodTypeAny ? z.infer<S['query']> : undefined;
  body: S['body'] extends ZodTypeAny ? z.infer<S['body']> : undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validated?: { params?: unknown; query?: unknown; body?: unknown };
    }
  }
}

/**
 * Validates and coerces `params`, `query` and `body`, storing the parsed
 * results on `req.validated`. Raw request properties are left untouched
 * (Express 5 exposes `req.query` as a getter).
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const details: ErrorDetail[] = [];
    const validated: { params?: unknown; query?: unknown; body?: unknown } = {};

    for (const source of ['params', 'query', 'body'] as const) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (result.success) {
        validated[source] = result.data;
      } else {
        details.push(...toDetails(source, result.error));
      }
    }

    if (details.length > 0) {
      next(new ValidationError('Request validation failed', details));
      return;
    }

    req.validated = validated;
    next();
  };
}

/** Typed accessor for the parsed payload of a validated request. */
export function validated<S extends ValidationSchemas>(req: Request): ValidatedData<S> {
  return (req.validated ?? {}) as ValidatedData<S>;
}

function toDetails(source: string, error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: [source, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}
```

---

## `src/http/middleware/request-context.ts`

```ts
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id: inbound `x-request-id` when present, otherwise generated. */
      requestId: string;
    }
  }
}

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get(REQUEST_ID_HEADER);
    req.requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, req.requestId);
    next();
  };
}
```

---

## `src/http/middleware/request-logger.ts`

```ts
import type { RequestHandler } from 'express';
import type { Logger } from '../../logger.js';

/** Logs method, path, status code and duration for every completed request. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const payload = {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        route: req.route?.path ?? undefined,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ip: req.ip,
        userAgent: req.get('user-agent'),
        contentLength: res.getHeader('content-length'),
      };

      const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${payload.durationMs}ms`;

      if (res.statusCode >= 500) logger.error(payload, message);
      else if (res.statusCode >= 400) logger.warn(payload, message);
      else logger.info(payload, message);
    });

    next();
  };
}
```

---

## `src/http/middleware/auth.ts`

```ts
import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../../errors.js';

const BEARER_PREFIX = /^Bearer[ ]+(.+)$/i;

/**
 * Requires `Authorization: Bearer <token>` matching the configured API token.
 * Comparison is constant-time to avoid leaking the secret via timing.
 */
export function requireBearerToken(expectedToken: string): RequestHandler {
  const expected = Buffer.from(expectedToken, 'utf8');

  return (req, _res, next) => {
    const header = req.get('authorization');
    if (!header) {
      next(new UnauthorizedError('Missing Authorization header'));
      return;
    }

    const match = BEARER_PREFIX.exec(header.trim());
    if (!match?.[1]) {
      next(new UnauthorizedError('Authorization header must use the Bearer scheme'));
      return;
    }

    const provided = Buffer.from(match[1].trim(), 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      next(new UnauthorizedError('Invalid API token'));
      return;
    }

    next();
  };
}
```

---

## `src/http/middleware/method-not-allowed.ts`

```ts
import type { RequestHandler } from 'express';
import { MethodNotAllowedError } from '../../errors.js';

/**
 * Terminal handler for a known path: the path matched but the HTTP method did
 * not, which is a 405 (with an `Allow` header) rather than a 404.
 */
export function methodNotAllowed(...allowedMethods: string[]): RequestHandler {
  const allowed = ['OPTIONS', ...allowedMethods];
  return (_req, _res, next) => {
    next(new MethodNotAllowedError(allowed));
  };
}
```

---

## `src/http/middleware/not-found.ts`

```ts
import type { RequestHandler } from 'express';
import { NotFoundError } from '../../errors.js';

/** Catch-all for unmatched routes; produces the standard 404 error shape. */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
  };
}
```

---

## `src/http/middleware/error-handler.ts`

```ts
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  ErrorCode,
  ValidationError,
  type ErrorBody,
  type ErrorDetail,
} from '../../errors.js';
import type { Logger } from '../../logger.js';

interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

/** Single funnel that turns any thrown value into the canonical JSON error body. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      // Response already streaming: let Express destroy the socket.
      next(err);
      return;
    }

    const appError = normalize(err);

    const logPayload = {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: appError.status,
      code: appError.code,
      err,
    };
    if (appError.status >= 500) {
      logger.error(logPayload, `Unhandled error: ${appError.code}`);
    } else {
      logger.debug(logPayload, `Request failed: ${appError.code}`);
    }

    for (const [name, value] of Object.entries(appError.headers ?? {})) {
      res.setHeader(name, value);
    }

    const body: ErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details?.length ? { details: appError.details } : {}),
        ...(req.requestId ? { requestId: req.requestId } : {}),
      },
    };

    res.status(appError.status).json(body);
  };
}

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    return new ValidationError('Request validation failed', details);
  }

  if (isBodyParserError(err)) {
    const status = err.status ?? err.statusCode ?? 400;
    switch (err.type) {
      case 'entity.parse.failed':
        return new ValidationError('Request body is not valid JSON');
      case 'entity.too.large':
        return new AppError(413, ErrorCode.PAYLOAD_TOO_LARGE, 'Request body is too large');
      case 'charset.unsupported':
      case 'encoding.unsupported':
        return new AppError(
          415,
          ErrorCode.UNSUPPORTED_MEDIA_TYPE,
          'Unsupported request encoding',
        );
      default:
        if (status === 400) return new ValidationError('Malformed request');
        break;
    }
  }

  return new AppError(500, ErrorCode.INTERNAL_ERROR, 'Internal server error', { cause: err });
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    err instanceof Error &&
    ('type' in err || 'status' in err || 'statusCode' in err)
  );
}
```

---

## `src/schemas/common.ts`

```ts
import { z } from 'zod';
import { TASK_STATUSES } from '../domain/types.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Resource ids are opaque strings (UUIDv4 as produced by the store). We do not
 * enforce UUID format so that unknown-but-well-formed ids yield 404, not 400.
 */
export const idParam = z
  .string()
  .trim()
  .min(1, 'must not be empty')
  .max(128, 'must be at most 128 characters');

export const projectIdParams = z.object({ projectId: idParam });

export const projectTaskIdParams = z.object({
  projectId: idParam,
  taskId: idParam,
});

export const taskStatusSchema = z.enum(TASK_STATUSES);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export function buildPaginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && total > 0,
  };
}
```

---

## `src/schemas/project.ts`

```ts
import { z } from 'zod';

export const createProjectBody = z
  .object({
    name: z
      .string({ required_error: 'name is required', invalid_type_error: 'name must be a string' })
      .trim()
      .min(1, 'name must not be empty')
      .max(120, 'name must be at most 120 characters'),
  })
  .strict();

export type CreateProjectBody = z.infer<typeof createProjectBody>;
```

---

## `src/schemas/task.ts`

```ts
import { z } from 'zod';
import { paginationQuery, taskStatusSchema } from './common.js';

const title = z
  .string({ required_error: 'title is required', invalid_type_error: 'title must be a string' })
  .trim()
  .min(1, 'title must not be empty')
  .max(200, 'title must be at most 200 characters');

const description = z
  .string()
  .trim()
  .max(5000, 'description must be at most 5000 characters');

const assignee = z
  .string()
  .trim()
  .min(1, 'assignee must not be empty')
  .max(120, 'assignee must be at most 120 characters');

export const createTaskBody = z
  .object({
    title,
    description: description.optional(),
    status: taskStatusSchema.default('todo'),
    assignee: assignee.optional(),
  })
  .strict();

/** `null` clears an optional field; omitting a key leaves it unchanged. */
export const updateTaskBody = z
  .object({
    title: title.optional(),
    description: description.nullable().optional(),
    status: taskStatusSchema.optional(),
    assignee: assignee.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one of title, description, status or assignee must be provided',
  });

export const listTasksQuery = paginationQuery
  .extend({
    status: taskStatusSchema.optional(),
  })
  .strict();

export type CreateTaskBody = z.infer<typeof createTaskBody>;
export type UpdateTaskBody = z.infer<typeof updateTaskBody>;
export type ListTasksQuery = z.infer<typeof listTasksQuery>;
```

---

## `src/routes/health.routes.ts`

```ts
import { Router } from 'express';
import { methodNotAllowed } from '../http/middleware/method-not-allowed.js';

/** Unauthenticated liveness probe. */
export function healthRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  router.all('/', methodNotAllowed('GET'));

  return router;
}
```

---

## `src/routes/project.routes.ts`

```ts
import { Router } from 'express';
import { NotFoundError } from '../errors.js';
import { asyncHandler } from '../http/async-handler.js';
import { methodNotAllowed } from '../http/middleware/method-not-allowed.js';
import { validate, validated } from '../http/validate.js';
import { projectIdParams } from '../schemas/common.js';
import { createProjectBody } from '../schemas/project.js';
import type { Store } from '../store/store.js';
import { taskRouter } from './task.routes.js';

export function projectRouter(store: Store): Router {
  const router = Router();

  // GET /projects
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const projects = await store.listProjects();
      res.status(200).json({ data: projects });
    }),
  );

  // POST /projects
  router.post(
    '/',
    validate({ body: createProjectBody }),
    asyncHandler(async (req, res) => {
      const { body } = validated<{ body: typeof createProjectBody }>(req);
      const project = await store.createProject({ name: body.name });
      res.status(201)
        .location(`/api/v1/projects/${project.id}`)
        .json({ data: project });
    }),
  );

  router.all('/', methodNotAllowed('GET', 'POST'));

  // GET /projects/:projectId
  router.get(
    '/:projectId',
    validate({ params: projectIdParams }),
    asyncHandler(async (req, res) => {
      const { params } = validated<{ params: typeof projectIdParams }>(req);
      const project = await store.getProject(params.projectId);
      if (!project) throw new NotFoundError(`Project '${params.projectId}' not found`);
      res.status(200).json({ data: project });
    }),
  );

  // DELETE /projects/:projectId  (cascades to its tasks)
  router.delete(
    '/:projectId',
    validate({ params: projectIdParams }),
    asyncHandler(async (req, res) => {
      const { params } = validated<{ params: typeof projectIdParams }>(req);
      const deleted = await store.deleteProject(params.projectId);
      if (!deleted) throw new NotFoundError(`Project '${params.projectId}' not found`);
      res.status(204).send();
    }),
  );

  // Nested task resources
  router.use('/:projectId/tasks', taskRouter(store));

  router.all('/:projectId', methodNotAllowed('GET', 'DELETE'));

  return router;
}
```

---

## `src/routes/task.routes.ts`

```ts
import { Router } from 'express';
import { NotFoundError } from '../errors.js';
import { asyncHandler } from '../http/async-handler.js';
import { methodNotAllowed } from '../http/middleware/method-not-allowed.js';
import { validate, validated } from '../http/validate.js';
import { buildPaginationMeta, projectIdParams, projectTaskIdParams } from '../schemas/common.js';
import { createTaskBody, listTasksQuery, updateTaskBody } from '../schemas/task.js';
import type { Store, UpdateTaskInput } from '../store/store.js';

/** Mounted at /projects/:projectId/tasks — needs parent params. */
export function taskRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  const ensureProjectExists = asyncHandler(async (req, _res, next) => {
    const projectId = String(req.params.projectId);
    const project = await store.getProject(projectId);
    if (!project) throw new NotFoundError(`Project '${projectId}' not found`);
    next();
  });

  // GET /projects/:projectId/tasks?status=&page=&pageSize=
  router.get(
    '/',
    validate({ params: projectIdParams, query: listTasksQuery }),
    ensureProjectExists,
    asyncHandler(async (req, res) => {
      const { params, query } = validated<{
        params: typeof projectIdParams;
        query: typeof listTasksQuery;
      }>(req);

      const { items, total } = await store.listTasks(params.projectId, {
        ...(query.status ? { status: query.status } : {}),
        offset: (query.page - 1) * query.pageSize,
        limit: query.pageSize,
      });

      res.status(200).json({
        data: items,
        pagination: buildPaginationMeta(query.page, query.pageSize, total),
      });
    }),
  );

  // POST /projects/:projectId/tasks
  router.post(
    '/',
    validate({ params: projectIdParams, body: createTaskBody }),
    ensureProjectExists,
    asyncHandler(async (req, res) => {
      const { params, body } = validated<{
        params: typeof projectIdParams;
        body: typeof createTaskBody;
      }>(req);

      const task = await store.createTask(params.projectId, {
        title: body.title,
        status: body.status,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
      });

      res.status(201)
        .location(`/api/v1/projects/${params.projectId}/tasks/${task.id}`)
        .json({ data: task });
    }),
  );

  router.all('/', methodNotAllowed('GET', 'POST'));

  // GET /projects/:projectId/tasks/:taskId
  router.get(
    '/:taskId',
    validate({ params: projectTaskIdParams }),
    ensureProjectExists,
    asyncHandler(async (req, res) => {
      const { params } = validated<{ params: typeof projectTaskIdParams }>(req);
      const task = await store.getTask(params.projectId, params.taskId);
      if (!task) throw new NotFoundError(`Task '${params.taskId}' not found`);
      res.status(200).json({ data: task });
    }),
  );

  // PATCH /projects/:projectId/tasks/:taskId
  router.patch(
    '/:taskId',
    validate({ params: projectTaskIdParams, body: updateTaskBody }),
    ensureProjectExists,
    asyncHandler(async (req, res) => {
      const { params, body } = validated<{
        params: typeof projectTaskIdParams;
        body: typeof updateTaskBody;
      }>(req);

      const patch: UpdateTaskInput = {};
      if (body.title !== undefined) patch.title = body.title;
      if (body.status !== undefined) patch.status = body.status;
      if (body.description !== undefined) patch.description = body.description;
      if (body.assignee !== undefined) patch.assignee = body.assignee;

      const task = await store.updateTask(params.projectId, params.taskId, patch);
      if (!task) throw new NotFoundError(`Task '${params.taskId}' not found`);
      res.status(200).json({ data: task });
    }),
  );

  // DELETE /projects/:projectId/tasks/:taskId
  router.delete(
    '/:taskId',
    validate({ params: projectTaskIdParams }),
    ensureProjectExists,
    asyncHandler(async (req, res) => {
      const { params } = validated<{ params: typeof projectTaskIdParams }>(req);
      const deleted = await store.deleteTask(params.projectId, params.taskId);
      if (!deleted) throw new NotFoundError(`Task '${params.taskId}' not found`);
      res.status(204).send();
    }),
  );

  router.all('/:taskId', methodNotAllowed('GET', 'PATCH', 'DELETE'));

  return router;
}
```

---

## `src/routes/index.ts`

```ts
import { Router } from 'express';
import { requireBearerToken } from '../http/middleware/auth.js';
import type { Store } from '../store/store.js';
import { healthRouter } from './health.routes.js';
import { projectRouter } from './project.routes.js';

export interface ApiRouterOptions {
  store: Store;
  apiToken: string;
}

/** The /api/v1 router: public health check, everything else bearer-protected. */
export function apiRouter({ store, apiToken }: ApiRouterOptions): Router {
  const router = Router();

  router.use('/health', healthRouter());

  router.use(requireBearerToken(apiToken));
  router.use('/projects', projectRouter(store));

  return router;
}
```

---

## `src/app.ts`

```ts
import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config, type AppConfig } from './config.js';
import { errorHandler } from './http/middleware/error-handler.js';
import { notFoundHandler } from './http/middleware/not-found.js';
import { requestContext } from './http/middleware/request-context.js';
import { requestLogger } from './http/middleware/request-logger.js';
import { logger as defaultLogger, type Logger } from './logger.js';
import { apiRouter } from './routes/index.js';
import { MemoryStore } from './store/memory-store.js';
import type { Store } from './store/store.js';

export const API_PREFIX = '/api/v1';

export interface CreateAppOptions {
  store?: Store;
  logger?: Logger;
  config?: AppConfig;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const appConfig = options.config ?? config;
  const log = options.logger ?? defaultLogger;
  const store = options.store ?? new MemoryStore();

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', appConfig.isProduction ? 1 : false);
  app.set('etag', false);

  app.use(requestContext());
  app.use(requestLogger(log));
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(cors(buildCorsOptions(appConfig)));
  app.options('/*splat', cors(buildCorsOptions(appConfig))); // explicit preflight handling
  app.use(express.json({ limit: appConfig.bodyLimit }));

  app.use(API_PREFIX, apiRouter({ store, apiToken: appConfig.apiToken }));

  app.use(notFoundHandler());
  app.use(errorHandler(log));

  return app;
}

function buildCorsOptions(appConfig: AppConfig): CorsOptions {
  const allowAll = appConfig.corsOrigins.includes('*');
  const allowList = new Set(appConfig.corsOrigins);

  return {
    origin: allowAll
      ? '*'
      : (origin, callback) => {
          // Non-browser clients send no Origin header: allow them through.
          if (!origin || allowList.has(origin)) callback(null, true);
          else callback(null, false);
        },
    credentials: !allowAll,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Location'],
    maxAge: 86_400,
    optionsSuccessStatus: 204,
  };
}
```

---

## `src/server.ts`

```ts
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { MemoryStore } from './store/memory-store.js';

const store = new MemoryStore();
const app = createApp({ store, logger, config });

const server = app.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port, env: config.nodeEnv },
    `Team task board API listening on http://${config.host}:${config.port}/api/v1`,
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

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close((err) => {
    clearTimeout(forceExit);
    if (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
    logger.info('Shutdown complete');
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

## `test/setup.ts`

```ts
process.env.NODE_ENV = 'test';
process.env.API_TOKEN = process.env.API_TOKEN ?? 'test-token-abcdef123456';
process.env.LOG_LEVEL = 'silent';
process.env.LOG_PRETTY = 'false';
process.env.CORS_ORIGINS = 'https://app.example.com';
```

---

## `test/helpers.ts`

```ts
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory-store.js';

export const TOKEN = process.env.API_TOKEN as string;
export const AUTH = `Bearer ${TOKEN}`;
export const BASE = '/api/v1';

export interface TestContext {
  app: Express;
  store: MemoryStore;
}

export function makeApp(): TestContext {
  const store = new MemoryStore();
  return { app: createApp({ store }), store };
}
```

---

## `test/auth.test.ts`

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH, BASE, makeApp, type TestContext } from './helpers.js';

describe('cross-cutting concerns', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = makeApp();
  });

  it('serves health without authentication', async () => {
    const res = await request(ctx.app).get(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects missing Authorization header with 401', async () => {
    const res = await request(ctx.app).get(`${BASE}/projects`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.headers['www-authenticate']).toContain('Bearer');
  });

  it.each([
    ['Basic abc', 'wrong scheme'],
    ['Bearer wrong-token', 'wrong token'],
    ['Bearer', 'no token'],
  ])('rejects %s (%s)', async (header) => {
    const res = await request(ctx.app).get(`${BASE}/projects`).set('Authorization', header);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts a valid bearer token', async () => {
    const res = await request(ctx.app).get(`${BASE}/projects`).set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it('answers CORS preflight requests', async () => {
    const res = await request(ctx.app)
      .options(`${BASE}/projects`)
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('does not reflect disallowed origins', async () => {
    const res = await request(ctx.app)
      .get(`${BASE}/health`)
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns 404 in the standard shape for unknown routes', async () => {
    const res = await request(ctx.app).get('/nope').set('Authorization', AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('returns 405 with Allow header for a known path and wrong method', async () => {
    const res = await request(ctx.app).put(`${BASE}/projects`).set('Authorization', AUTH);
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(res.headers.allow).toContain('POST');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(ctx.app)
      .post(`${BASE}/projects`)
      .set('Authorization', AUTH)
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('echoes a request id header', async () => {
    const res = await request(ctx.app).get(`${BASE}/health`).set('x-request-id', 'req-123');
    expect(res.headers['x-request-id']).toBe('req-123');
  });
});
```

---

## `test/projects.test.ts`

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH, BASE, makeApp, type TestContext } from './helpers.js';

describe('projects', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = makeApp();
  });

  const createProject = (name = 'Apollo') =>
    request(ctx.app).post(`${BASE}/projects`).set('Authorization', AUTH).send({ name });

  it('creates a project', async () => {
    const res = await createProject('Apollo');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Apollo' });
    expect(res.body.data.id).toBeTruthy();
    expect(new Date(res.body.data.createdAt).toString()).not.toBe('Invalid Date');
    expect(res.headers.location).toBe(`${BASE}/projects/${res.body.data.id}`);
  });

  it.each([
    [{}, 'missing name'],
    [{ name: '' }, 'empty name'],
    [{ name: '   ' }, 'blank name'],
    [{ name: 42 }, 'wrong type'],
    [{ name: 'ok', extra: true }, 'unknown key'],
  ])('rejects invalid payload %j (%s)', async (body) => {
    const res = await request(ctx.app)
      .post(`${BASE}/projects`)
      .set('Authorization', AUTH)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('lists projects', async () => {
    await createProject('A');
    await createProject('B');
    const res = await request(ctx.app).get(`${BASE}/projects`).set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(['A', 'B']);
  });

  it('gets one project and 404s for unknown ids', async () => {
    const created = await createProject();
    const ok = await request(ctx.app)
      .get(`${BASE}/projects/${created.body.data.id}`)
      .set('Authorization', AUTH);
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe(created.body.data.id);

    const missing = await request(ctx.app)
      .get(`${BASE}/projects/does-not-exist`)
      .set('Authorization', AUTH);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('deletes a project and cascades to its tasks', async () => {
    const project = (await createProject()).body.data;
    await request(ctx.app)
      .post(`${BASE}/projects/${project.id}/tasks`)
      .set('Authorization', AUTH)
      .send({ title: 'Task 1' });

    const del = await request(ctx.app)
      .delete(`${BASE}/projects/${project.id}`)
      .set('Authorization', AUTH);
    expect(del.status).toBe(204);
    expect(del.body).toEqual({});

    const tasks = await ctx.store.listTasks(project.id, { offset: 0, limit: 10 });
    expect(tasks.total).toBe(0);

    const again = await request(ctx.app)
      .delete(`${BASE}/projects/${project.id}`)
      .set('Authorization', AUTH);
    expect(again.status).toBe(404);
  });
});
```

---

## `test/tasks.test.ts`

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH, BASE, makeApp, type TestContext } from './helpers.js';

describe('tasks', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(async () => {
    ctx = makeApp();
    const project = await ctx.store.createProject({ name: 'Apollo' });
    projectId = project.id;
  });

  const tasksUrl = () => `${BASE}/projects/${projectId}/tasks`;
  const createTask = (body: unknown) =>
    request(ctx.app).post(tasksUrl()).set('Authorization', AUTH).send(body);

  it('creates a task with defaults', async () => {
    const res = await createTask({ title: 'Write docs' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      projectId,
      title: 'Write docs',
      status: 'todo',
    });
    expect(res.body.data.description).toBeUndefined();
    expect(res.body.data.createdAt).toBe(res.body.data.updatedAt);
  });

  it('creates a task with all fields', async () => {
    const res = await createTask({
      title: 'Ship v1',
      description: 'Cut the release',
      status: 'in_progress',
      assignee: 'ada',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: 'Ship v1',
      description: 'Cut the release',
      status: 'in_progress',
      assignee: 'ada',
    });
  });

  it.each([
    [{}, 'missing title'],
    [{ title: '' }, 'empty title'],
    [{ title: 'ok', status: 'blocked' }, 'invalid status'],
    [{ title: 'ok', nope: 1 }, 'unknown key'],
  ])('rejects invalid task payload %j (%s)', async (body) => {
    const res = await createTask(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s when creating a task for a missing project', async () => {
    const res = await request(ctx.app)
      .post(`${BASE}/projects/missing/tasks`)
      .set('Authorization', AUTH)
      .send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('lists tasks with pagination metadata', async () => {
    for (let i = 1; i <= 5; i += 1) await createTask({ title: `T${i}` });

    const res = await request(ctx.app)
      .get(tasksUrl())
      .query({ page: 2, pageSize: 2 })
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(['T3', 'T4']);
    expect(res.body.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('filters tasks by status', async () => {
    await createTask({ title: 'A', status: 'todo' });
    await createTask({ title: 'B', status: 'done' });
    await createTask({ title: 'C', status: 'done' });

    const res = await request(ctx.app)
      .get(tasksUrl())
      .query({ status: 'done' })
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(['B', 'C']);
  });

  it.each([
    { status: 'nope' },
    { page: 0 },
    { pageSize: 1000 },
    { pageSize: 'many' },
    { unknown: '1' },
  ])('rejects invalid list query %j', async (query) => {
    const res = await request(ctx.app).get(tasksUrl()).query(query).set('Authorization', AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('gets a single task', async () => {
    const task = (await createTask({ title: 'Solo' })).body.data;
    const res = await request(ctx.app)
      .get(`${tasksUrl()}/${task.id}`)
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(task.id);

    const missing = await request(ctx.app)
      .get(`${tasksUrl()}/unknown`)
      .set('Authorization', AUTH);
    expect(missing.status).toBe(404);
  });

  it('partially updates a task and bumps updatedAt', async () => {
    const task = (await createTask({ title: 'Old', assignee: 'ada' })).body.data;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const res = await request(ctx.app)
      .patch(`${tasksUrl()}/${task.id}`)
      .set('Authorization', AUTH)
      .send({ title: 'New', status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: 'New', status: 'done', assignee: 'ada' });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(task.updatedAt).getTime(),
    );
    expect(res.body.data.createdAt).toBe(task.createdAt);
  });

  it('clears optional fields when null is sent', async () => {
    const task = (await createTask({ title: 'X', description: 'd', assignee: 'ada' })).body.data;
    const res = await request(ctx.app)
      .patch(`${tasksUrl()}/${task.id}`)
      .set('Authorization', AUTH)
      .send({ description: null, assignee: null });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBeUndefined();
    expect(res.body.data.assignee).toBeUndefined();
  });

  it('rejects empty and invalid patches', async () => {
    const task = (await createTask({ title: 'X' })).body.data;

    const empty = await request(ctx.app)
      .patch(`${tasksUrl()}/${task.id}`)
      .set('Authorization', AUTH)
      .send({});
    expect(empty.status).toBe(400);

    const bad = await request(ctx.app)
      .patch(`${tasksUrl()}/${task.id}`)
      .set('Authorization', AUTH)
      .send({ status: 'archived' });
    expect(bad.status).toBe(400);
  });

  it('deletes a task', async () => {
    const task = (await createTask({ title: 'Bye' })).body.data;

    const del = await request(ctx.app)
      .delete(`${tasksUrl()}/${task.id}`)
      .set('Authorization', AUTH);
    expect(del.status).toBe(204);

    const again = await request(ctx.app)
      .delete(`${tasksUrl()}/${task.id}`)
      .set('Authorization', AUTH);
    expect(again.status).toBe(404);
  });

  it('returns 405 for unsupported methods on task paths', async () => {
    const task = (await createTask({ title: 'X' })).body.data;
    const res = await request(ctx.app)
      .put(`${tasksUrl()}/${task.id}`)
      .set('Authorization', AUTH);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toContain('PATCH');
  });
});
```

---

## `Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["node", "dist/server.js"]
```

---

## `README.md`

````markdown
# Team Task Board API

REST backend for a team task board. Express 5 + TypeScript (strict) + Zod + Pino.

## Quick start

```bash
npm install
cp .env.example .env      # set API_TOKEN
npm run dev               # http://localhost:3000/api/v1
```

Production:

```bash
npm run build && npm start
```

Tests / checks:

```bash
npm test
npm run typecheck
npm run lint
```

## Configuration

| Variable       | Required | Default       | Description                                        |
| -------------- | -------- | ------------- | -------------------------------------------------- |
| `API_TOKEN`    | yes      | —             | Bearer token required by all non-health routes     |
| `PORT`         | no       | `3000`        | Listen port                                        |
| `HOST`         | no       | `0.0.0.0`     | Listen address                                     |
| `NODE_ENV`     | no       | `development` | `development` \| `test` \| `production`            |
| `LOG_LEVEL`    | no       | `info`        | Pino level                                         |
| `LOG_PRETTY`   | no       | dev only      | Human-readable logs                                |
| `CORS_ORIGINS` | no       | `*`           | Comma-separated allowed origins, or `*`            |
| `BODY_LIMIT`   | no       | `100kb`       | Max JSON body size                                 |

Config is validated at boot; invalid env crashes the process immediately.

## Auth

All routes except `GET /api/v1/health` require:

```
Authorization: Bearer <API_TOKEN>
```

Otherwise `401` with a `WWW-Authenticate: Bearer` header. Token comparison is constant-time.

## Endpoints

| Method | Path                                     | Description                                  |
| ------ | ---------------------------------------- | -------------------------------------------- |
| GET    | `/api/v1/health`                         | `{ "ok": true }` (public)                    |
| GET    | `/api/v1/projects`                       | List projects                                |
| POST   | `/api/v1/projects`                       | Create project                               |
| GET    | `/api/v1/projects/:projectId`            | Get project                                  |
| DELETE | `/api/v1/projects/:projectId`            | Delete project **and its tasks**             |
| GET    | `/api/v1/projects/:projectId/tasks`      | List tasks (`status`, `page`, `pageSize`)    |
| POST   | `/api/v1/projects/:projectId/tasks`      | Create task                                  |
| GET    | `/api/v1/projects/:pid/tasks/:taskId`    | Get task                                     |
| PATCH  | `/api/v1/projects/:pid/tasks/:taskId`    | Partial update                               |
| DELETE | `/api/v1/projects/:pid/tasks/:taskId`    | Delete task                                  |

### Examples

```bash
TOKEN=your-token
API=http://localhost:3000/api/v1

curl -s $API/health

curl -s -X POST $API/projects \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Apollo"}'

curl -s -X POST $API/projects/$PID/tasks \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Ship v1","description":"Cut the release","status":"in_progress","assignee":"ada"}'

curl -s "$API/projects/$PID/tasks?status=in_progress&page=1&pageSize=20" \
  -H "Authorization: Bearer $TOKEN"

curl -s -X PATCH $API/projects/$PID/tasks/$TID \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"done","assignee":null}'
```

### Response shapes

Single resource / collection:

```json
{ "data": { "id": "…", "name": "Apollo", "createdAt": "2026-08-29T10:00:00.000Z" } }
```

Paginated list:

```json
{
  "data": [ /* tasks */ ],
  "pagination": {
    "page": 1, "pageSize": 20, "total": 42, "totalPages": 3,
    "hasNextPage": true, "hasPreviousPage": false
  }
}
```

Errors (all failures, uniformly):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "body.title", "message": "title must not be empty" }],
    "requestId": "b6f1…"
  }
}
```

Codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404),
`METHOD_NOT_ALLOWED` (405, includes `Allow` header), `PAYLOAD_TOO_LARGE` (413),
`UNSUPPORTED_MEDIA_TYPE` (415), `INTERNAL_ERROR` (500). Internal errors never
leak stack traces or messages; details are logged with the `requestId`.

### PATCH semantics

- omit a key → field unchanged
- `null` for `description` / `assignee` → field cleared
- value → field set
- empty object `{}` → `400` (nothing to update)
- unknown keys → `400` (schemas are strict)

## Design notes

- **Storage behind an interface.** `src/store/store.ts` defines the async `Store`
  contract; `MemoryStore` implements it. A Postgres adapter only needs to
  implement the same interface and be passed into `createApp({ store })` —
  routes stay unchanged.
- **Validation at the edge.** `validate({ params, query, body })` parses with Zod
  and puts coerced values on `req.validated`; handlers work with typed data only.
- **405 vs 404.** Each router ends with `router.all(path, methodNotAllowed(...))`,
  so a matching path with the wrong method returns 405 + `Allow`, while unmatched
  paths fall through to the global 404 handler.
- **Observability.** Every request gets an `x-request-id` (inbound value reused if
  safe) and one structured log line with method, path, status, and duration in ms.
  `Authorization` headers are redacted.
- **Security.** Helmet headers, `x-powered-by` disabled, JSON body size limit,
  CORS allow-list with preflight support, constant-time token check.
- **Graceful shutdown.** `SIGTERM`/`SIGINT` drain in-flight requests with a 10s
  force-exit guard; suitable for Kubernetes/ECS.
````