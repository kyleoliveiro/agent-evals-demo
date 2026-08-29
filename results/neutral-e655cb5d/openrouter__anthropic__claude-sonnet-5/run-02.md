<!-- model: openrouter/anthropic/claude-sonnet-5 | run: 2 | framework: Express -->

# Team Task Board API

A production-ready REST API built with **TypeScript**, **Express**, **Zod** (validation), and a pluggable in-memory storage layer.

## Project Structure

```
team-task-board-api/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── jest.config.js
└── src/
    ├── index.ts
    ├── app.ts
    ├── config.ts
    ├── logger.ts
    ├── errors/
    │   └── AppError.ts
    ├── middleware/
    │   ├── auth.ts
    │   ├── requestLogger.ts
    │   ├── errorHandler.ts
    │   └── notFound.ts
    ├── store/
    │   ├── types.ts
    │   └── memoryStore.ts
    ├── validation/
    │   ├── project.schema.ts
    │   └── task.schema.ts
    ├── routes/
    │   ├── index.ts
    │   ├── health.routes.ts
    │   ├── project.routes.ts
    │   └── task.routes.ts
    ├── controllers/
    │   ├── project.controller.ts
    │   └── task.controller.ts
    └── utils/
        ├── asyncHandler.ts
        └── pagination.ts
└── test/
    ├── health.test.ts
    ├── projects.test.ts
    └── tasks.test.ts
```

---

## `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board",
  "main": "dist/index.js",
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "test": "jest --runInBand",
    "test:watch": "jest --watch",
    "lint": "eslint \"src/**/*.ts\"",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "uuid": "^9.0.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.9",
    "@types/supertest": "^6.0.2",
    "@types/uuid": "^9.0.8",
    "@typescript-eslint/eslint-plugin": "^7.16.1",
    "@typescript-eslint/parser": "^7.16.1",
    "eslint": "^8.57.0",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.1.5",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.5.3"
  }
}
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "moduleResolution": "node",
    "rootDir": "src",
    "outDir": "dist",
    "declaration": false,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "removeComments": true,
    "baseUrl": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

---

## `jest.config.js`

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  setupFiles: ["<rootDir>/test/setupEnv.ts"],
  verbose: true,
};
```

---

## `.env.example`

```
PORT=3000
API_TOKEN=super-secret-dev-token
CORS_ORIGIN=*
LOG_LEVEL=info
NODE_ENV=development
```

---

## `.gitignore`

```
node_modules
dist
.env
coverage
*.log
```

---

## `src/config.ts`

```ts
import "dotenv/config";

interface Config {
  port: number;
  apiToken: string;
  corsOrigin: string;
  nodeEnv: string;
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3000),
  apiToken: required("API_TOKEN", "dev-secret-token"),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  nodeEnv: process.env.NODE_ENV ?? "development",
};
```

---

## `src/logger.ts`

```ts
type Level = "info" | "warn" | "error" | "debug";

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
};
```

---

## `src/errors/AppError.ts`

```ts
export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, "BAD_REQUEST", message, details);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(400, "VALIDATION_ERROR", message, details);
  }

  static unauthorized(message = "Unauthorized"): AppError {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static notFound(message = "Resource not found"): AppError {
    return new AppError(404, "NOT_FOUND", message);
  }

  static methodNotAllowed(message = "Method not allowed"): AppError {
    return new AppError(405, "METHOD_NOT_ALLOWED", message);
  }

  static internal(message = "Internal server error"): AppError {
    return new AppError(500, "INTERNAL_ERROR", message);
  }
}
```

---

## `src/middleware/auth.ts`

```ts
import { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { AppError } from "../errors/AppError";

const BEARER_PREFIX = "Bearer ";

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("Authorization");

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw AppError.unauthorized("Missing or malformed Authorization header");
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  if (!token || token !== config.apiToken) {
    throw AppError.unauthorized("Invalid API token");
  }

  next();
}
```

---

## `src/middleware/requestLogger.ts`

```ts
import { NextFunction, Request, Response } from "express";
import { logger } from "../logger";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;

    logger.info("request", {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });

  next();
}
```

---

## `src/middleware/notFound.ts`

```ts
import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";

export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}
```

---

## `src/middleware/errorHandler.ts`

```ts
import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError";
import { logger } from "../logger";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.issues,
      },
    };
    res.status(400).json(body);
    return;
  }

  logger.error("unhandled_error", {
    path: req.originalUrl,
    method: req.method,
    error: err instanceof Error ? err.stack ?? err.message : String(err),
  });

  const body: ErrorBody = {
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  };
  res.status(500).json(body);
}
```

---

## `src/store/types.ts`

```ts
export type TaskStatus = "todo" | "in_progress" | "done";

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

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string | null;
}

export interface TaskFilter {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Storage interface — keep persistence swappable (e.g. Postgres, Mongo, Redis).
 */
export interface Store {
  // Projects
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;

  // Tasks
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  listTasks(projectId: string, filter: TaskFilter): Promise<PagedResult<Task>>;
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task | undefined>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

---

## `src/store/memoryStore.ts`

```ts
import { v4 as uuid } from "uuid";
import {
  CreateProjectInput,
  CreateTaskInput,
  PagedResult,
  Project,
  Store,
  Task,
  TaskFilter,
  UpdateTaskInput,
} from "./types";

export class MemoryStore implements Store {
  private projects = new Map<string, Project>();
  private tasks = new Map<string, Task>();

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: uuid(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async deleteProject(id: string): Promise<boolean> {
    const existed = this.projects.delete(id);
    if (existed) {
      for (const [taskId, task] of this.tasks) {
        if (task.projectId === id) {
          this.tasks.delete(taskId);
        }
      }
    }
    return existed;
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuid(),
      projectId,
      title: input.title,
      description: input.description,
      status: input.status ?? "todo",
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async listTasks(projectId: string, filter: TaskFilter): Promise<PagedResult<Task>> {
    let items = Array.from(this.tasks.values()).filter((t) => t.projectId === projectId);

    if (filter.status) {
      items = items.filter((t) => t.status === filter.status);
    }

    items = items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / filter.pageSize));
    const start = (filter.page - 1) * filter.pageSize;
    const paged = items.slice(start, start + filter.pageSize);

    return {
      items: paged,
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      totalPages,
    };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return undefined;
    return task;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<Task | undefined> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return undefined;

    const updated: Task = {
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assignee !== undefined
        ? { assignee: input.assignee === null ? undefined : input.assignee }
        : {}),
      updatedAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, updated);
    return updated;
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;
    this.tasks.delete(taskId);
    return true;
  }
}
```

---

## `src/validation/project.schema.ts`

```ts
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200, "name must be at most 200 characters"),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
```

---

## `src/validation/task.schema.ts`

```ts
import { z } from "zod";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(300),
  description: z.string().trim().max(5000).optional(),
  status: taskStatusSchema.optional(),
  assignee: z.string().trim().min(1).max(200).optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).optional(),
    status: taskStatusSchema.optional(),
    assignee: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTaskDto = z.infer<typeof createTaskSchema>;
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;
export type ListTasksQueryDto = z.infer<typeof listTasksQuerySchema>;
```

---

## `src/utils/asyncHandler.ts`

```ts
import { NextFunction, Request, Response } from "express";

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(fn: AsyncFn) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
```

---

## `src/utils/pagination.ts`

```ts
export interface PaginationParams {
  page: number;
  pageSize: number;
}

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}
```

---

## `src/controllers/project.controller.ts`

```ts
import { Request, Response } from "express";
import { Store } from "../store/types";
import { AppError } from "../errors/AppError";
import { createProjectSchema } from "../validation/project.schema";

export class ProjectController {
  constructor(private readonly store: Store) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    const projects = await this.store.listProjects();
    res.status(200).json({ data: projects });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const parsed = createProjectSchema.parse(req.body);
    const project = await this.store.createProject(parsed);
    res.status(201).json({ data: project });
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const project = await this.store.getProject(req.params.projectId as string);
    if (!project) {
      throw AppError.notFound(`Project ${req.params.projectId} not found`);
    }
    res.status(200).json({ data: project });
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const deleted = await this.store.deleteProject(req.params.projectId as string);
    if (!deleted) {
      throw AppError.notFound(`Project ${req.params.projectId} not found`);
    }
    res.status(204).send();
  };
}
```

---

## `src/controllers/task.controller.ts`

```ts
import { Request, Response } from "express";
import { Store } from "../store/types";
import { AppError } from "../errors/AppError";
import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from "../validation/task.schema";

export class TaskController {
  constructor(private readonly store: Store) {}

  private async ensureProjectExists(projectId: string): Promise<void> {
    const project = await this.store.getProject(projectId);
    if (!project) {
      throw AppError.notFound(`Project ${projectId} not found`);
    }
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId as string;
    await this.ensureProjectExists(projectId);

    const query = listTasksQuerySchema.parse(req.query);
    const result = await this.store.listTasks(projectId, query);

    res.status(200).json({
      data: result.items,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId as string;
    await this.ensureProjectExists(projectId);

    const parsed = createTaskSchema.parse(req.body);
    const task = await this.store.createTask(projectId, parsed);
    res.status(201).json({ data: task });
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { projectId, taskId } = req.params as { projectId: string; taskId: string };
    await this.ensureProjectExists(projectId);

    const task = await this.store.getTask(projectId, taskId);
    if (!task) {
      throw AppError.notFound(`Task ${taskId} not found`);
    }
    res.status(200).json({ data: task });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { projectId, taskId } = req.params as { projectId: string; taskId: string };
    await this.ensureProjectExists(projectId);

    const parsed = updateTaskSchema.parse(req.body);
    const task = await this.store.updateTask(projectId, taskId, parsed);
    if (!task) {
      throw AppError.notFound(`Task ${taskId} not found`);
    }
    res.status(200).json({ data: task });
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { projectId, taskId } = req.params as { projectId: string; taskId: string };
    await this.ensureProjectExists(projectId);

    const deleted = await this.store.deleteTask(projectId, taskId);
    if (!deleted) {
      throw AppError.notFound(`Task ${taskId} not found`);
    }
    res.status(204).send();
  };
}
```

---

## `src/routes/health.routes.ts`

```ts
import { Router } from "express";

export function buildHealthRouter(): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return router;
}
```

---

## `src/routes/project.routes.ts`

```ts
import { Router } from "express";
import { ProjectController } from "../controllers/project.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { buildTaskRouter } from "./task.routes";
import { Store } from "../store/types";

export function buildProjectRouter(store: Store): Router {
  const router = Router();
  const controller = new ProjectController(store);

  router
    .route("/")
    .get(asyncHandler(controller.list))
    .post(asyncHandler(controller.create))
    .all(mustBeAllowed(["GET", "POST"]));

  router
    .route("/:projectId")
    .get(asyncHandler(controller.getOne))
    .delete(asyncHandler(controller.remove))
    .all(mustBeAllowed(["GET", "DELETE"]));

  router.use("/:projectId/tasks", buildTaskRouter(store));

  return router;
}

function mustBeAllowed(allowed: string[]) {
  return (req: import("express").Request, _res: import("express").Response, next: import("express").NextFunction) => {
    if (!allowed.includes(req.method)) {
      const { AppError } = require("../errors/AppError");
      return next(AppError.methodNotAllowed(`${req.method} not allowed on this route`));
    }
    next();
  };
}
```

---

## `src/routes/task.routes.ts`

```ts
import { NextFunction, Request, Response, Router } from "express";
import { TaskController } from "../controllers/task.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../errors/AppError";
import { Store } from "../store/types";

export function buildTaskRouter(store: Store): Router {
  const router = Router({ mergeParams: true });
  const controller = new TaskController(store);

  router
    .route("/")
    .get(asyncHandler(controller.list))
    .post(asyncHandler(controller.create))
    .all(mustBeAllowed(["GET", "POST"]));

  router
    .route("/:taskId")
    .get(asyncHandler(controller.getOne))
    .patch(asyncHandler(controller.update))
    .delete(asyncHandler(controller.remove))
    .all(mustBeAllowed(["GET", "PATCH", "DELETE"]));

  return router;
}

function mustBeAllowed(allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!allowed.includes(req.method)) {
      return next(AppError.methodNotAllowed(`${req.method} not allowed on this route`));
    }
    next();
  };
}
```

---

## `src/routes/index.ts`

```ts
import { Router } from "express";
import { Store } from "../store/types";
import { authMiddleware } from "../middleware/auth";
import { buildHealthRouter } from "./health.routes";
import { buildProjectRouter } from "./project.routes";

export function buildApiRouter(store: Store): Router {
  const router = Router();

  // Health check is public and unauthenticated.
  router.use(buildHealthRouter());

  // Everything else requires a valid bearer token.
  router.use(authMiddleware);

  router.use("/projects", buildProjectRouter(store));

  return router;
}
```

---

## `src/app.ts`

```ts
import express, { Express } from "express";
import cors from "cors";
import { config } from "./config";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundMiddleware } from "./middleware/notFound";
import { buildApiRouter } from "./routes";
import { Store } from "./store/types";

export function createApp(store: Store): Express {
  const app = express();

  app.disable("x-powered-by");

  app.use(
    cors({
      origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(","),
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: false,
    })
  );

  // Ensure preflight requests are handled for all routes.
  app.options("*", cors());

  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  app.use("/api/v1", buildApiRouter(store));

  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}
```

---

## `src/index.ts`

```ts
import { config } from "./config";
import { createApp } from "./app";
import { MemoryStore } from "./store/memoryStore";
import { logger } from "./logger";

const store = new MemoryStore();
const app = createApp(store);

const server = app.listen(config.port, () => {
  logger.info("server_started", { port: config.port, env: config.nodeEnv });
});

function shutdown(signal: string): void {
  logger.info("shutdown_initiated", { signal });
  server.close(() => {
    logger.info("shutdown_complete");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", { reason: String(reason) });
});

process.on("uncaughtException", (err) => {
  logger.error("uncaught_exception", { error: err.stack ?? err.message });
  process.exit(1);
});
```

---

## `test/setupEnv.ts`

```ts
process.env.API_TOKEN = "test-token";
process.env.CORS_ORIGIN = "*";
process.env.NODE_ENV = "test";
```

---

## `test/health.test.ts`

```ts
import request from "supertest";
import { createApp } from "../src/app";
import { MemoryStore } from "../src/store/memoryStore";

describe("GET /api/v1/health", () => {
  it("returns ok:true without auth", async () => {
    const app = createApp(new MemoryStore());
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("unknown routes", () => {
  it("returns 404 in the standard error shape", async () => {
    const app = createApp(new MemoryStore());
    const res = await request(app)
      .get("/api/v1/does-not-exist")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
```

---

## `test/projects.test.ts`

```ts
import request from "supertest";
import { createApp } from "../src/app";
import { MemoryStore } from "../src/store/memoryStore";

const TOKEN = "test-token";
const app = createApp(new MemoryStore());

describe("Projects API", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/v1/projects");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects requests with an invalid token", async () => {
    const res = await request(app)
      .get("/api/v1/projects")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("creates a project", async () => {
    const res = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ name: "Website Redesign" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: "Website Redesign" });
    expect(res.body.data.id).toBeDefined();
  });

  it("rejects invalid project payloads", async () => {
    const res = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ name: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("lists projects", async () => {
    const res = await request(app)
      .get("/api/v1/projects")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns 404 for a missing project", async () => {
    const res = await request(app)
      .get("/api/v1/projects/does-not-exist")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("deletes a project and its tasks", async () => {
    const createRes = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ name: "Temp Project" });

    const projectId = createRes.body.data.id;

    await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ title: "Temp Task" });

    const deleteRes = await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(deleteRes.status).toBe(204);

    const getRes = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(getRes.status).toBe(404);
  });
});
```

---

## `test/tasks.test.ts`

```ts
import request from "supertest";
import { createApp } from "../src/app";
import { MemoryStore } from "../src/store/memoryStore";

const TOKEN = "test-token";
const app = createApp(new MemoryStore());

async function createProject(name = "Project A"): Promise<string> {
  const res = await request(app)
    .post("/api/v1/projects")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ name });
  return res.body.data.id;
}

describe("Tasks API", () => {
  it("returns 404 when creating a task under a missing project", async () => {
    const res = await request(app)
      .post("/api/v1/projects/missing-id/tasks")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ title: "Do the thing" });
    expect(res.status).toBe(404);
  });

  it("creates, lists, filters, updates and deletes tasks", async () => {
    const projectId = await createProject();

    const createRes = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ title: "Design homepage", assignee: "alice" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe("todo");
    const taskId = createRes.body.data.id;

    const badCreateRes = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ title: "" });
    expect(badCreateRes.status).toBe(400);

    const listRes = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.pagination.total).toBe(1);

    const getRes = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.title).toBe("Design homepage");

    const patchRes = await request(app)
      .patch(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ status: "in_progress" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.status).toBe("in_progress");

    const filterRes = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks?status=in_progress`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(filterRes.status).toBe(200);
    expect(filterRes.body.data.length).toBe(1);

    const emptyFilterRes = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks?status=done`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(emptyFilterRes.status).toBe(200);
    expect(emptyFilterRes.body.data.length).toBe(0);

    const badPatchRes = await request(app)
      .patch(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({});
    expect(badPatchRes.status).toBe(400);

    const deleteRes = await request(app)
      .delete(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(deleteRes.status).toBe(204);

    const getAfterDeleteRes = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(getAfterDeleteRes.status).toBe(404);
  });

  it("paginates task results", async () => {
    const projectId = await createProject("Pagination project");

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ title: `Task ${i}` });
    }

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks?page=2&pageSize=2`)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
  });
});
```

---

## `README.md`

```markdown
# Team Task Board API

A production-ready REST API for managing projects and tasks, built with TypeScript, Express, and Zod.

## Features

- Clean layered architecture: routes → controllers → storage interface
- Storage abstracted behind a `Store` interface (in-memory implementation included; swappable for Postgres/Mongo/etc.)
- Zod-based request validation with consistent `400` error responses
- Bearer token authentication (`API_TOKEN` env var) on every route except `/health`
- CORS enabled, including preflight (`OPTIONS`) handling
- Structured JSON request logging (method, path, status, duration)
- Consistent JSON error envelope for 400 / 401 / 404 / 405 / 500
- Pagination and status filtering for task listing
- Unit/integration tests with Jest + Supertest

## Getting started

```bash
cp .env.example .env
npm install
npm run dev
```

The server starts on `http://localhost:3000` by default.

## Environment variables

| Variable      | Description                                   | Default              |
|---------------|------------------------------------------------|-----------------------|
| `PORT`        | HTTP port                                      | `3000`               |
| `API_TOKEN`   | Bearer token required for all non-health routes| `dev-secret-token`   |
| `CORS_ORIGIN` | Comma-separated allowed origins, or `*`        | `*`                  |
| `NODE_ENV`    | Environment name                               | `development`        |

## Scripts

- `npm run dev` — run with hot reload (ts-node-dev)
- `npm run build` — compile to `dist/`
- `npm start` — run compiled build
- `npm test` — run Jest test suite
- `npm run lint` — lint with ESLint
- `npm run typecheck` — TypeScript type-check only

## API overview

All endpoints are prefixed with `/api/v1`. Except for `/health`, every request must include:

```
Authorization: Bearer <API_TOKEN>
```

### Health

```
GET /api/v1/health
```

### Projects

```
GET    /api/v1/projects
POST   /api/v1/projects            { "name": "string" }
GET    /api/v1/projects/:projectId
DELETE /api/v1/projects/:projectId
```

### Tasks

```
GET    /api/v1/projects/:projectId/tasks?status=todo|in_progress|done&page=1&pageSize=20
POST   /api/v1/projects/:projectId/tasks
       { "title": "string", "description"?: "string", "status"?: "todo"|"in_progress"|"done", "assignee"?: "string" }
GET    /api/v1/projects/:projectId/tasks/:taskId
PATCH  /api/v1/projects/:projectId/tasks/:taskId
       { "title"?, "description"?, "status"?, "assignee"? }   // at least one field
DELETE /api/v1/projects/:projectId/tasks/:taskId
```

### Error shape

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [ ... ]
  }
}
```

Codes used: `BAD_REQUEST`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `INTERNAL_ERROR`.

## Notes on production readiness

- Swap `MemoryStore` for a real database by implementing the `Store` interface in `src/store/types.ts` and injecting it in `src/index.ts`.
- Logging is structured JSON to stdout/stderr — ready to pipe into any log aggregator.
- Add a process manager (PM2 / systemd / container orchestrator) and a reverse proxy (Nginx) with TLS termination in front of this service for real deployments.
- Consider adding rate limiting (`express-rate-limit`) and request size limits for public-facing use.
```

---

### A few design notes

- **Storage abstraction**: `Store` in `src/store/types.ts` is the only contract controllers depend on — swapping `MemoryStore` for a SQL/NoSQL implementation requires no route/controller changes.
- **Validation**: Zod schemas throw `ZodError`, caught centrally in `errorHandler` and converted into the standard `400 VALIDATION_ERROR` shape; `AppError` covers all other cases uniformly (`401/404/405/500`).
- **Auth**: `authMiddleware` runs after the health route is mounted, so `/health` stays public while everything else under `/api/v1` requires a valid bearer token equal to `API_TOKEN`.
- **CORS & preflight**: `cors()` middleware plus an explicit `app.options('*', cors())` ensures preflight `OPTIONS` requests succeed for all routes.
- **Logging**: `requestLogger` hooks into the `finish` event to log method/path/status/duration for every completed request, including errors.
- **404 for unknown routes**: `notFoundMiddleware` is mounted after all real routes and before `errorHandler`, producing the same JSON error envelope as other errors.