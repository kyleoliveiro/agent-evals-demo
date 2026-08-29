<!-- model: openrouter/anthropic/claude-opus-5 | run: 2 | framework: Express -->

Below is a complete, production-ready service. Stack: **Node 20+, TypeScript (strict), Express 5, Zod for validation, Pino for structured logging, Vitest + Supertest for tests**. Storage sits behind a `TaskBoardStore` interface with an in-memory implementation.

---

## Project layout

```
.
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── README.md
└── src
    ├── server.ts
    ├── app.ts
    ├── config.ts
    ├── logger.ts
    ├── errors.ts
    ├── types.ts
    ├── http/
    │   ├── asyncHandler.ts
    │   ├── validate.ts
    │   └── routeTable.ts
    ├── middleware/
    │   ├── auth.ts
    │   ├── requestContext.ts
    │   ├── requestLogger.ts
    │   ├── notFound.ts
    │   └── errorHandler.ts
    ├── schemas/
    │   └── index.ts
    ├── store/
    │   ├── store.ts
    │   └── memoryStore.ts
    ├── services/
    │   └── taskBoardService.ts
    └── routes/
        ├── index.ts
        ├── health.ts
        ├── projects.ts
        └── tasks.ts
└── test
    └── api.test.ts
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
    "node": ">=20.11"
  },
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint . --ext .ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^5.1.0",
    "helmet": "^8.0.0",
    "pino": "^9.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.9.0",
    "@types/supertest": "^6.0.2",
    "@typescript-eslint/eslint-plugin": "^8.15.0",
    "@typescript-eslint/parser": "^8.15.0",
    "eslint": "^8.57.1",
    "pino-pretty": "^13.0.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

## `tsconfig.build.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test/**/*", "vitest.config.ts"]
}
```

## `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: {
      API_TOKEN: "test-token",
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    },
  },
});
```

---

## `.env.example`

```dotenv
# Required: bearer token clients must present in `Authorization: Bearer <token>`
API_TOKEN=change-me-to-a-long-random-string

# Optional
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info
# Comma-separated list of allowed browser origins, or "*" for any
CORS_ORIGINS=*
# Max page size for paginated endpoints
MAX_PAGE_SIZE=100
```

## `.gitignore`

```gitignore
node_modules
dist
coverage
.env
*.log
.DS_Store
```

## `.dockerignore`

```dockerignore
node_modules
dist
coverage
.git
.env
*.log
```

---

## `src/config.ts`

```ts
import "dotenv/config";
import { z } from "zod";

const csvToArray = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  API_TOKEN: z.string().min(1, "API_TOKEN must be set"),
  CORS_ORIGINS: z.string().default("*"),
  MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  BODY_LIMIT: z.string().default("100kb"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  // Fail fast: a misconfigured service must not boot.
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,
  apiToken: env.API_TOKEN,
  bodyLimit: env.BODY_LIMIT,
  corsOrigins: env.CORS_ORIGINS === "*" ? "*" : csvToArray(env.CORS_ORIGINS),
  pagination: {
    defaultPage: 1,
    defaultPageSize: 20,
    maxPageSize: env.MAX_PAGE_SIZE,
  },
  apiPrefix: "/api/v1",
} as const;

export type Config = typeof config;
```

---

## `src/logger.ts`

```ts
import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "team-task-board-api" },
  redact: {
    paths: ["req.headers.authorization", "authorization"],
    censor: "[redacted]",
  },
  ...(config.isProduction || config.logLevel === "silent"
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname,service" },
        },
      }),
});

export type Logger = typeof logger;
```

---

## `src/types.ts`

```ts
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
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
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

---

## `src/errors.ts`

```ts
export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "CONFLICT"
  | "INTERNAL_ERROR";

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

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];
  readonly headers?: Record<string, string>;
  readonly expose: boolean;

  constructor(opts: {
    status: number;
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    headers?: Record<string, string>;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    this.headers = opts.headers;
    this.expose = opts.status < 500;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message: string, details?: ErrorDetail[]): ApiError {
    return new ApiError({ status: 400, code: "BAD_REQUEST", message, details });
  }

  static validation(message: string, details: ErrorDetail[]): ApiError {
    return new ApiError({ status: 400, code: "VALIDATION_ERROR", message, details });
  }

  static unauthorized(message = "Missing or invalid credentials."): ApiError {
    return new ApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message,
      headers: { "WWW-Authenticate": 'Bearer realm="api", charset="UTF-8"' },
    });
  }

  static notFound(message = "Resource not found."): ApiError {
    return new ApiError({ status: 404, code: "NOT_FOUND", message });
  }

  static methodNotAllowed(method: string, allowed: readonly string[]): ApiError {
    return new ApiError({
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: `Method ${method} is not allowed for this resource. Allowed: ${allowed.join(", ")}.`,
      headers: { Allow: allowed.join(", ") },
    });
  }

  static internal(message = "An unexpected error occurred.", cause?: unknown): ApiError {
    return new ApiError({ status: 500, code: "INTERNAL_ERROR", message, cause });
  }
}
```

---

## `src/store/store.ts`

```ts
import type { Page, Project, Task, TaskStatus } from "../types.js";

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

/**
 * Patch semantics: a key that is *absent* leaves the field untouched;
 * a key present with `null` clears the (optional) field.
 */
export interface UpdateTaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}

export interface ListTasksQuery {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

/**
 * Persistence boundary. The in-memory implementation can be swapped for
 * Postgres/Mongo/etc. without touching routes or services.
 */
export interface TaskBoardStore {
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | null>;
  /** @returns true if a project was deleted (with its tasks), false if it did not exist. */
  deleteProject(projectId: string): Promise<boolean>;

  createTask(input: CreateTaskInput): Promise<Task>;
  listTasks(projectId: string, query: ListTasksQuery): Promise<Page<Task>>;
  getTask(projectId: string, taskId: string): Promise<Task | null>;
  updateTask(projectId: string, taskId: string, patch: UpdateTaskPatch): Promise<Task | null>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;

  reset?(): Promise<void>;
}
```

## `src/store/memoryStore.ts`

```ts
import { randomUUID } from "node:crypto";
import type { Page, Project, Task } from "../types.js";
import type {
  CreateProjectInput,
  CreateTaskInput,
  ListTasksQuery,
  TaskBoardStore,
  UpdateTaskPatch,
} from "./store.js";

interface Clock {
  now(): Date;
}

const systemClock: Clock = { now: () => new Date() };

/** Deterministic ordering: newest first, id as tiebreaker for stable pagination. */
function byCreatedAtDesc<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

export class InMemoryTaskBoardStore implements TaskBoardStore {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();
  /** projectId -> ordered set of task ids, for O(project tasks) listing. */
  private readonly tasksByProject = new Map<string, Set<string>>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly idFactory: () => string = randomUUID,
  ) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: this.idFactory(),
      name: input.name,
      createdAt: this.clock.now().toISOString(),
    };
    this.projects.set(project.id, project);
    this.tasksByProject.set(project.id, new Set());
    return { ...project };
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].sort(byCreatedAtDesc).map((p) => ({ ...p }));
  }

  async getProject(projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    return project ? { ...project } : null;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    if (!this.projects.delete(projectId)) return false;
    const taskIds = this.tasksByProject.get(projectId);
    if (taskIds) {
      for (const taskId of taskIds) this.tasks.delete(taskId);
      this.tasksByProject.delete(projectId);
    }
    return true;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = this.clock.now().toISOString();
    const task: Task = {
      id: this.idFactory(),
      projectId: input.projectId,
      title: input.title,
      status: input.status ?? "todo",
      createdAt: now,
      updatedAt: now,
    };
    if (input.description !== undefined) task.description = input.description;
    if (input.assignee !== undefined) task.assignee = input.assignee;

    this.tasks.set(task.id, task);
    const bucket = this.tasksByProject.get(input.projectId) ?? new Set<string>();
    bucket.add(task.id);
    this.tasksByProject.set(input.projectId, bucket);
    return { ...task };
  }

  async listTasks(projectId: string, query: ListTasksQuery): Promise<Page<Task>> {
    const ids = this.tasksByProject.get(projectId) ?? new Set<string>();
    const all: Task[] = [];
    for (const id of ids) {
      const task = this.tasks.get(id);
      if (!task) continue;
      if (query.status && task.status !== query.status) continue;
      all.push(task);
    }
    all.sort(byCreatedAtDesc);

    const total = all.length;
    const offset = (query.page - 1) * query.pageSize;
    const items = all.slice(offset, offset + query.pageSize).map((t) => ({ ...t }));

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0,
    };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return null;
    return { ...task };
  }

  async updateTask(
    projectId: string,
    taskId: string,
    patch: UpdateTaskPatch,
  ): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return null;

    const next: Task = { ...task };
    if ("title" in patch && patch.title !== undefined) next.title = patch.title;
    if ("status" in patch && patch.status !== undefined) next.status = patch.status;
    if ("description" in patch) {
      if (patch.description == null) delete next.description;
      else next.description = patch.description;
    }
    if ("assignee" in patch) {
      if (patch.assignee == null) delete next.assignee;
      else next.assignee = patch.assignee;
    }
    next.updatedAt = this.clock.now().toISOString();

    this.tasks.set(taskId, next);
    return { ...next };
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return false;
    this.tasks.delete(taskId);
    this.tasksByProject.get(projectId)?.delete(taskId);
    return true;
  }

  async reset(): Promise<void> {
    this.projects.clear();
    this.tasks.clear();
    this.tasksByProject.clear();
  }
}
```

---

## `src/schemas/index.ts`

```ts
import { z } from "zod";
import { config } from "../config.js";
import { TASK_STATUSES } from "../types.js";

const trimmedString = (max: number) => z.string().trim().max(max);

export const projectIdParamSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
});

export const taskIdParamSchema = projectIdParamSchema.extend({
  taskId: z.string().trim().min(1).max(200),
});

export const createProjectSchema = z
  .object({
    name: trimmedString(200).min(1, "name must not be empty"),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: trimmedString(200).min(1, "title must not be empty"),
    description: trimmedString(5000).min(1).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: trimmedString(200).min(1).optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: trimmedString(200).min(1, "title must not be empty").optional(),
    description: trimmedString(5000).min(1).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: trimmedString(200).min(1).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one of title, description, status, assignee must be provided.",
  });

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(config.pagination.defaultPage),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(config.pagination.maxPageSize)
    .default(config.pagination.defaultPageSize),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
```

---

## `src/http/validate.ts`

```ts
import type { ZodError, ZodTypeAny, z } from "zod";
import { ApiError, type ErrorDetail } from "../errors.js";

function toDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw ApiError.validation(`Invalid request ${label}.`, toDetails(result.error));
  }
  return result.data;
}

export const validateBody = <S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> =>
  parse(schema, data ?? {}, "body");

export const validateQuery = <S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> =>
  parse(schema, data ?? {}, "query parameters");

export const validateParams = <S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> =>
  parse(schema, data ?? {}, "path parameters");
```

## `src/http/asyncHandler.ts`

```ts
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 5 forwards rejected promises automatically, but wrapping keeps the
 * behaviour explicit and portable.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
```

## `src/http/routeTable.ts`

```ts
import { config } from "../config.js";

const ID = "[^/]+";

/** Known resources, used to distinguish 405 (path exists) from 404 (it doesn't). */
const RESOURCES: ReadonlyArray<{ pattern: RegExp; methods: readonly string[] }> = [
  { pattern: new RegExp("^/health$"), methods: ["GET", "HEAD"] },
  { pattern: new RegExp("^/projects$"), methods: ["GET", "HEAD", "POST"] },
  { pattern: new RegExp(`^/projects/${ID}$`), methods: ["GET", "HEAD", "DELETE"] },
  { pattern: new RegExp(`^/projects/${ID}/tasks$`), methods: ["GET", "HEAD", "POST"] },
  {
    pattern: new RegExp(`^/projects/${ID}/tasks/${ID}$`),
    methods: ["GET", "HEAD", "PATCH", "DELETE"],
  },
];

function normalize(pathname: string): string | null {
  const withoutQuery = pathname.split("?")[0] ?? "";
  const trimmed =
    withoutQuery.length > 1 && withoutQuery.endsWith("/")
      ? withoutQuery.replace(/\/+$/, "")
      : withoutQuery;
  if (!trimmed.startsWith(config.apiPrefix)) return null;
  const rest = trimmed.slice(config.apiPrefix.length);
  return rest === "" ? "/" : rest;
}

/**
 * @returns the allowed methods for a known path, or null if the path is unknown.
 */
export function allowedMethodsFor(pathname: string): readonly string[] | null {
  const rest = normalize(pathname);
  if (rest === null) return null;
  for (const resource of RESOURCES) {
    if (resource.pattern.test(rest)) {
      return [...resource.methods, "OPTIONS"];
    }
  }
  return null;
}
```

---

## `src/middleware/requestContext.ts`

```ts
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      startedAt: bigint;
    }
  }
}

const HEADER = "x-request-id";
const SAFE_ID = /^[A-Za-z0-9._@=+/-]{1,200}$/;

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header(HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.startedAt = process.hrtime.bigint();
  res.setHeader(HEADER, req.id);
  next();
};
```

## `src/middleware/requestLogger.ts`

```ts
import type { RequestHandler } from "express";
import { logger } from "../logger.js";

/** Logs method, path, status and duration for every request, exactly once. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = req.startedAt ?? process.hrtime.bigint();

  const log = (event: "finish" | "close") => {
    res.removeListener("finish", onFinish);
    res.removeListener("close", onClose);

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const payload = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
      aborted: event === "close",
      ip: req.ip,
      userAgent: req.header("user-agent"),
    };
    const message = `${payload.method} ${payload.path} ${payload.status} ${payload.durationMs}ms`;

    if (event === "close") logger.warn(payload, `${message} (client aborted)`);
    else if (payload.status >= 500) logger.error(payload, message);
    else if (payload.status >= 400) logger.warn(payload, message);
    else logger.info(payload, message);
  };

  const onFinish = () => log("finish");
  const onClose = () => {
    if (!res.writableEnded) log("close");
  };

  res.once("finish", onFinish);
  res.once("close", onClose);
  next();
};
```

## `src/middleware/auth.ts`

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";

const BEARER = /^Bearer[ ]+(?<token>[^\s]+)$/i;

/** Constant-time comparison that does not leak token length. */
function tokensMatch(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Requires `Authorization: Bearer <API_TOKEN>`; responds 401 otherwise. */
export const requireBearerToken: RequestHandler = (req, _res, next) => {
  const header = req.header("authorization");
  if (!header) {
    return next(ApiError.unauthorized("Missing Authorization header."));
  }

  const match = BEARER.exec(header.trim());
  const token = match?.groups?.["token"];
  if (!token) {
    return next(ApiError.unauthorized("Authorization header must use the Bearer scheme."));
  }

  if (!tokensMatch(token, config.apiToken)) {
    return next(ApiError.unauthorized("Invalid API token."));
  }

  next();
};
```

## `src/middleware/notFound.ts`

```ts
import type { RequestHandler } from "express";
import { ApiError } from "../errors.js";
import { allowedMethodsFor } from "../http/routeTable.js";

/**
 * Terminal router fallback: 405 when the path is known but the method is not,
 * otherwise 404 — both in the standard error envelope.
 */
export const notFoundOrMethodNotAllowed: RequestHandler = (req, _res, next) => {
  const allowed = allowedMethodsFor(req.path);
  if (allowed && !allowed.includes(req.method.toUpperCase())) {
    return next(ApiError.methodNotAllowed(req.method.toUpperCase(), allowed));
  }
  next(ApiError.notFound(`Route ${req.method} ${req.path} does not exist.`));
};
```

## `src/middleware/errorHandler.ts`

```ts
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError, type ErrorBody } from "../errors.js";
import { logger } from "../logger.js";

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
  expose?: boolean;
}

function normalize(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return ApiError.validation(
      "Invalid request.",
      err.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    );
  }

  const candidate = err as BodyParserError | undefined;
  const status = candidate?.status ?? candidate?.statusCode;

  if (candidate?.type === "entity.parse.failed") {
    return ApiError.badRequest("Request body is not valid JSON.");
  }
  if (candidate?.type === "entity.too.large") {
    return new ApiError({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large.",
    });
  }
  if (candidate?.type === "charset.unsupported" || candidate?.type === "encoding.unsupported") {
    return ApiError.badRequest("Unsupported request body encoding.");
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    return new ApiError({
      status,
      code: status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
      message: candidate?.expose && candidate.message ? candidate.message : "Invalid request.",
    });
  }

  return ApiError.internal("An unexpected error occurred.", err);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const apiError = normalize(err);

  const logPayload = {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    status: apiError.status,
    code: apiError.code,
  };
  if (apiError.status >= 500) {
    logger.error({ ...logPayload, err: apiError.cause ?? apiError }, "Request failed");
  } else {
    logger.debug({ ...logPayload, details: apiError.details }, "Request rejected");
  }

  // Headers already flushed — nothing safe left to do but drop the connection.
  if (res.headersSent) {
    return next(err);
  }

  for (const [name, value] of Object.entries(apiError.headers ?? {})) {
    res.setHeader(name, value);
  }

  const body: ErrorBody = {
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details && apiError.details.length > 0 ? { details: apiError.details } : {}),
      ...(req.id ? { requestId: req.id } : {}),
    },
  };

  res.status(apiError.status).type("application/json").json(body);
};
```

---

## `src/services/taskBoardService.ts`

```ts
import { ApiError } from "../errors.js";
import type { CreateProjectBody, CreateTaskBody, UpdateTaskBody } from "../schemas/index.js";
import type { ListTasksQuery, TaskBoardStore } from "../store/store.js";
import type { Page, Project, Task } from "../types.js";

/** Business rules + 404 semantics, kept independent of Express. */
export class TaskBoardService {
  constructor(private readonly store: TaskBoardStore) {}

  listProjects(): Promise<Project[]> {
    return this.store.listProjects();
  }

  createProject(body: CreateProjectBody): Promise<Project> {
    return this.store.createProject({ name: body.name });
  }

  async getProject(projectId: string): Promise<Project> {
    const project = await this.store.getProject(projectId);
    if (!project) throw ApiError.notFound(`Project '${projectId}' was not found.`);
    return project;
  }

  async deleteProject(projectId: string): Promise<void> {
    const deleted = await this.store.deleteProject(projectId);
    if (!deleted) throw ApiError.notFound(`Project '${projectId}' was not found.`);
  }

  async listTasks(projectId: string, query: ListTasksQuery): Promise<Page<Task>> {
    await this.getProject(projectId);
    return this.store.listTasks(projectId, query);
  }

  async createTask(projectId: string, body: CreateTaskBody): Promise<Task> {
    await this.getProject(projectId);
    return this.store.createTask({ projectId, ...body });
  }

  async getTask(projectId: string, taskId: string): Promise<Task> {
    await this.getProject(projectId);
    const task = await this.store.getTask(projectId, taskId);
    if (!task) {
      throw ApiError.notFound(`Task '${taskId}' was not found in project '${projectId}'.`);
    }
    return task;
  }

  async updateTask(projectId: string, taskId: string, body: UpdateTaskBody): Promise<Task> {
    await this.getProject(projectId);
    const updated = await this.store.updateTask(projectId, taskId, body);
    if (!updated) {
      throw ApiError.notFound(`Task '${taskId}' was not found in project '${projectId}'.`);
    }
    return updated;
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.getProject(projectId);
    const deleted = await this.store.deleteTask(projectId, taskId);
    if (!deleted) {
      throw ApiError.notFound(`Task '${taskId}' was not found in project '${projectId}'.`);
    }
  }
}
```

---

## `src/routes/health.ts`

```ts
import { Router } from "express";

export function healthRouter(): Router {
  const router = Router();

  // Public: intentionally mounted before authentication.
  router.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return router;
}
```

## `src/routes/projects.ts`

```ts
import { Router } from "express";
import { asyncHandler } from "../http/asyncHandler.js";
import { validateBody, validateParams } from "../http/validate.js";
import { createProjectSchema, projectIdParamSchema } from "../schemas/index.js";
import type { TaskBoardService } from "../services/taskBoardService.js";

export function projectsRouter(service: TaskBoardService): Router {
  const router = Router();

  router.get(
    "/projects",
    asyncHandler(async (_req, res) => {
      const projects = await service.listProjects();
      res.status(200).json({ data: projects });
    }),
  );

  router.post(
    "/projects",
    asyncHandler(async (req, res) => {
      const body = validateBody(createProjectSchema, req.body);
      const project = await service.createProject(body);
      res
        .status(201)
        .location(`/api/v1/projects/${encodeURIComponent(project.id)}`)
        .json({ data: project });
    }),
  );

  router.get(
    "/projects/:projectId",
    asyncHandler(async (req, res) => {
      const { projectId } = validateParams(projectIdParamSchema, req.params);
      const project = await service.getProject(projectId);
      res.status(200).json({ data: project });
    }),
  );

  router.delete(
    "/projects/:projectId",
    asyncHandler(async (req, res) => {
      const { projectId } = validateParams(projectIdParamSchema, req.params);
      await service.deleteProject(projectId);
      res.status(204).send();
    }),
  );

  return router;
}
```

## `src/routes/tasks.ts`

```ts
import { Router } from "express";
import { asyncHandler } from "../http/asyncHandler.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import {
  createTaskSchema,
  listTasksQuerySchema,
  projectIdParamSchema,
  taskIdParamSchema,
  updateTaskSchema,
} from "../schemas/index.js";
import type { TaskBoardService } from "../services/taskBoardService.js";

export function tasksRouter(service: TaskBoardService): Router {
  const router = Router();

  router.get(
    "/projects/:projectId/tasks",
    asyncHandler(async (req, res) => {
      const { projectId } = validateParams(projectIdParamSchema, req.params);
      const query = validateQuery(listTasksQuerySchema, req.query);
      const page = await service.listTasks(projectId, query);
      res.status(200).json({
        data: page.items,
        meta: {
          page: page.page,
          pageSize: page.pageSize,
          total: page.total,
          totalPages: page.totalPages,
          ...(query.status ? { status: query.status } : {}),
        },
      });
    }),
  );

  router.post(
    "/projects/:projectId/tasks",
    asyncHandler(async (req, res) => {
      const { projectId } = validateParams(projectIdParamSchema, req.params);
      const body = validateBody(createTaskSchema, req.body);
      const task = await service.createTask(projectId, body);
      res
        .status(201)
        .location(
          `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}`,
        )
        .json({ data: task });
    }),
  );

  router.get(
    "/projects/:projectId/tasks/:taskId",
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = validateParams(taskIdParamSchema, req.params);
      const task = await service.getTask(projectId, taskId);
      res.status(200).json({ data: task });
    }),
  );

  router.patch(
    "/projects/:projectId/tasks/:taskId",
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = validateParams(taskIdParamSchema, req.params);
      const body = validateBody(updateTaskSchema, req.body);
      const task = await service.updateTask(projectId, taskId, body);
      res.status(200).json({ data: task });
    }),
  );

  router.delete(
    "/projects/:projectId/tasks/:taskId",
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = validateParams(taskIdParamSchema, req.params);
      await service.deleteTask(projectId, taskId);
      res.status(204).send();
    }),
  );

  return router;
}
```

## `src/routes/index.ts`

```ts
import { Router } from "express";
import { requireBearerToken } from "../middleware/auth.js";
import type { TaskBoardService } from "../services/taskBoardService.js";
import { healthRouter } from "./health.js";
import { projectsRouter } from "./projects.js";
import { tasksRouter } from "./tasks.js";

export function apiRouter(service: TaskBoardService): Router {
  const router = Router();

  router.use(healthRouter());

  // Everything below requires a valid bearer token.
  router.use(requireBearerToken);
  router.use(projectsRouter(service));
  router.use(tasksRouter(service));

  return router;
}
```

---

## `src/app.ts`

```ts
import cors, { type CorsOptions } from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundOrMethodNotAllowed } from "./middleware/notFound.js";
import { requestContext } from "./middleware/requestContext.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { apiRouter } from "./routes/index.js";
import { InMemoryTaskBoardStore } from "./store/memoryStore.js";
import type { TaskBoardStore } from "./store/store.js";
import { TaskBoardService } from "./services/taskBoardService.js";

export interface AppDeps {
  store?: TaskBoardStore;
}

function corsOptions(): CorsOptions {
  const allowed = config.corsOrigins;
  return {
    origin: allowed === "*" ? true : allowed,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Location", "Allow"],
    credentials: allowed !== "*",
    maxAge: 600,
    optionsSuccessStatus: 204,
  };
}

export function createApp(deps: AppDeps = {}): Express {
  const store = deps.store ?? new InMemoryTaskBoardStore();
  const service = new TaskBoardService(store);

  const app = express();

  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.set("etag", false);

  app.use(requestContext);
  app.use(requestLogger);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  // CORS before routing so preflight (OPTIONS) short-circuits without auth.
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: config.bodyLimit, strict: true }));

  app.use(config.apiPrefix, apiRouter(service));

  app.use(notFoundOrMethodNotAllowed);
  app.use(errorHandler);

  return app;
}

export { InMemoryTaskBoardStore };
```

## `src/server.ts`

```ts
import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port, env: config.env, prefix: config.apiPrefix },
    `Listening on http://${config.host}:${config.port}${config.apiPrefix}`,
  );
});

server.headersTimeout = 65_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 61_000;

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
    logger.info("Shutdown complete");
    process.exit(0);
  });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => shutdown(signal));
}

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  shutdown("unhandledRejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  shutdown("uncaughtException");
});
```

---

## `test/api.test.ts`

```ts
import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryTaskBoardStore } from "../src/store/memoryStore.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };

let app: Express;
let store: InMemoryTaskBoardStore;

async function createProject(name = "Apollo"): Promise<string> {
  const res = await request(app).post("/api/v1/projects").set(auth).send({ name });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

beforeEach(() => {
  store = new InMemoryTaskBoardStore();
  app = createApp({ store });
});

describe("health", () => {
  it("is public and returns { ok: true }", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("auth", () => {
  it("rejects a missing token with 401", async () => {
    const res = await request(app).get("/api/v1/projects");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer/);
  });

  it("rejects a wrong token and a non-bearer scheme", async () => {
    await request(app).get("/api/v1/projects").set({ Authorization: "Bearer nope" }).expect(401);
    await request(app).get("/api/v1/projects").set({ Authorization: "Basic abc" }).expect(401);
  });
});

describe("cors", () => {
  it("answers preflight without credentials", async () => {
    const res = await request(app)
      .options("/api/v1/projects")
      .set({
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });
});

describe("projects", () => {
  it("creates, lists, reads and deletes", async () => {
    const id = await createProject("Apollo");

    const list = await request(app).get("/api/v1/projects").set(auth).expect(200);
    expect(list.body.data).toHaveLength(1);

    const one = await request(app).get(`/api/v1/projects/${id}`).set(auth).expect(200);
    expect(one.body.data).toMatchObject({ id, name: "Apollo" });
    expect(one.body.data.createdAt).toBeTypeOf("string");

    await request(app).delete(`/api/v1/projects/${id}`).set(auth).expect(204);
    await request(app).get(`/api/v1/projects/${id}`).set(auth).expect(404);
  });

  it("validates the body", async () => {
    const res = await request(app).post("/api/v1/projects").set(auth).send({ name: "  " });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("name");

    await request(app).post("/api/v1/projects").set(auth).send({ nope: 1 }).expect(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/v1/projects")
      .set({ ...auth, "Content-Type": "application/json" })
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("cascades deletion to tasks", async () => {
    const projectId = await createProject();
    await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(auth)
      .send({ title: "T" })
      .expect(201);

    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth).expect(204);
    const page = await store.listTasks(projectId, { page: 1, pageSize: 10 });
    expect(page.total).toBe(0);
  });
});

describe("tasks", () => {
  it("supports the full lifecycle", async () => {
    const projectId = await createProject();

    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(auth)
      .send({ title: "Write docs", description: "Draft", assignee: "ada" })
      .expect(201);
    expect(created.body.data).toMatchObject({ projectId, status: "todo", assignee: "ada" });
    const taskId = created.body.data.id as string;

    await request(app).get(`/api/v1/projects/${projectId}/tasks/${taskId}`).set(auth).expect(200);

    const patched = await request(app)
      .patch(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set(auth)
      .send({ status: "in_progress", description: null })
      .expect(200);
    expect(patched.body.data.status).toBe("in_progress");
    expect(patched.body.data.description).toBeUndefined();
    expect(patched.body.data.updatedAt >= patched.body.data.createdAt).toBe(true);

    await request(app).delete(`/api/v1/projects/${projectId}/tasks/${taskId}`).set(auth).expect(204);
    await request(app).get(`/api/v1/projects/${projectId}/tasks/${taskId}`).set(auth).expect(404);
  });

  it("rejects invalid payloads", async () => {
    const projectId = await createProject();
    const base = `/api/v1/projects/${projectId}/tasks`;

    await request(app).post(base).set(auth).send({}).expect(400);
    await request(app).post(base).set(auth).send({ title: "x", status: "bogus" }).expect(400);

    const created = await request(app).post(base).set(auth).send({ title: "x" }).expect(201);
    const empty = await request(app)
      .patch(`${base}/${created.body.data.id}`)
      .set(auth)
      .send({})
      .expect(400);
    expect(empty.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("filters by status and paginates", async () => {
    const projectId = await createProject();
    const base = `/api/v1/projects/${projectId}/tasks`;

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post(base)
        .set(auth)
        .send({ title: `task-${i}`, status: i % 2 === 0 ? "done" : "todo" })
        .expect(201);
    }

    const done = await request(app).get(`${base}?status=done`).set(auth).expect(200);
    expect(done.body.data).toHaveLength(3);
    expect(done.body.meta).toMatchObject({ total: 3, page: 1, totalPages: 1 });

    const p1 = await request(app).get(`${base}?page=1&pageSize=2`).set(auth).expect(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta).toMatchObject({ total: 5, pageSize: 2, totalPages: 3 });

    const p3 = await request(app).get(`${base}?page=3&pageSize=2`).set(auth).expect(200);
    expect(p3.body.data).toHaveLength(1);

    const p9 = await request(app).get(`${base}?page=9&pageSize=2`).set(auth).expect(200);
    expect(p9.body.data).toHaveLength(0);

    await request(app).get(`${base}?pageSize=0`).set(auth).expect(400);
    await request(app).get(`${base}?pageSize=99999`).set(auth).expect(400);
    await request(app).get(`${base}?status=nope`).set(auth).expect(400);
  });

  it("404s for an unknown project and for cross-project task access", async () => {
    const a = await createProject("A");
    const b = await createProject("B");
    const task = await request(app)
      .post(`/api/v1/projects/${a}/tasks`)
      .set(auth)
      .send({ title: "t" })
      .expect(201);

    await request(app).get("/api/v1/projects/missing/tasks").set(auth).expect(404);
    await request(app)
      .get(`/api/v1/projects/${b}/tasks/${task.body.data.id}`)
      .set(auth)
      .expect(404);
  });
});

describe("routing errors", () => {
  it("404s unknown routes in the standard shape", async () => {
    const res = await request(app).get("/api/v1/nope").set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND" });
    expect(res.body.error.message).toBeTypeOf("string");

    await request(app).get("/totally/off-prefix").expect(404);
  });

  it("405s known paths with the wrong method and sets Allow", async () => {
    const res = await request(app).put("/api/v1/projects").set(auth);
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(res.headers["allow"]).toContain("POST");

    const health = await request(app).post("/api/v1/health");
    expect(health.status).toBe(405);
  });

  it("returns 500 in the standard shape for unexpected failures", async () => {
    const boom = createApp({
      store: {
        ...new InMemoryTaskBoardStore(),
        listProjects: async () => {
          throw new Error("db down");
        },
      } as unknown as InMemoryTaskBoardStore,
    });
    const res = await request(boom).get("/api/v1/projects").set(auth);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).not.toContain("db down");
  });
});
```

---

## `Dockerfile`

```dockerfile
# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ---------- deps (prod only) ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
```

---

## `README.md`

````markdown
# Team Task Board API

REST API for projects and tasks. Express 5 + TypeScript, Zod validation, Pino logging,
in-memory storage behind a swappable `TaskBoardStore` interface.

## Run

```bash
cp .env.example .env      # set API_TOKEN
npm install
npm run dev               # http://localhost:3000/api/v1
npm test
npm run build && npm start
```

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer $API_TOKEN
```

Missing/invalid → `401` with `WWW-Authenticate: Bearer`. CORS preflight (`OPTIONS`)
is answered before auth so browsers work.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | public → `{ "ok": true }` |
| GET | `/api/v1/projects` | list (newest first) |
| POST | `/api/v1/projects` | body `{ "name": string }` → 201 + `Location` |
| GET | `/api/v1/projects/:projectId` | 404 if missing |
| DELETE | `/api/v1/projects/:projectId` | 204; cascades to tasks |
| GET | `/api/v1/projects/:projectId/tasks` | `?status=&page=&pageSize=` |
| POST | `/api/v1/projects/:projectId/tasks` | body `{ title, description?, status?, assignee? }` |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | partial; `null` clears `description`/`assignee` |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | 204 |

`status ∈ {todo, in_progress, done}` (default `todo`). Unknown body fields are rejected.
Pagination defaults: `page=1`, `pageSize=20`, max `MAX_PAGE_SIZE` (100).

### Responses

Single resource / collection:

```json
{ "data": { "id": "…", "name": "Apollo", "createdAt": "2026-08-29T10:00:00.000Z" } }
{ "data": [ … ], "meta": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }
```

Errors (400 / 401 / 404 / 405 / 413 / 500) always use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body.",
    "details": [{ "path": "name", "message": "name must not be empty" }],
    "requestId": "…"
  }
}
```

`405` includes an `Allow` header; unknown paths return `404` in the same shape.

## Logging

One structured line per request: `method`, `path`, `status`, `durationMs`, `requestId`
(echoed as `X-Request-Id`). `Authorization` is redacted. 5xx bodies never leak internals.

## Swapping the store

Implement `TaskBoardStore` (`src/store/store.ts`) and pass it in:

```ts
createApp({ store: new PostgresTaskBoardStore(pool) });
```

## Example

```bash
TOKEN=$(grep API_TOKEN .env | cut -d= -f2)
curl -s -X POST localhost:3000/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Apollo"}'
```
````

---

### Design notes

- **Layering:** `routes → service → store`. The service owns 404 semantics and cross-checks that a task belongs to the project; routes only validate and shape HTTP.
- **405 vs 404:** Express has no native "method not allowed", so `src/http/routeTable.ts` holds a small declarative table of known resource paths; the terminal middleware returns 405 + `Allow` when the path matches but the method doesn't, else 404.
- **Auth safety:** tokens are compared with `timingSafeEqual` over SHA-256 digests, so neither content nor length leaks.
- **Error envelope:** all failures — Zod issues, body-parser `entity.parse.failed`/`entity.too.large`, thrown `ApiError`s, and unexpected exceptions — funnel through one `errorHandler` that emits `{ error: { code, message, details?, requestId } }` and never exposes internal messages on 500.
- **Ops:** fail-fast env validation, graceful SIGTERM shutdown with a forced-exit timer, request/keep-alive timeouts, Helmet, non-root Docker image with a healthcheck.