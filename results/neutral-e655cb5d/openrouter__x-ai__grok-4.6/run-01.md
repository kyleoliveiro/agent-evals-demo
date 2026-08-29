<!-- model: openrouter/x-ai/grok-4.6 | run: 1 | framework: Express -->

A complete TypeScript Express API with Zod validation, Bearer auth, CORS, request logging, and an in-memory store behind an interface.

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "helmet": "^8.0.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.13.10",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

```gitignore
node_modules/
dist/
.env
*.log
.DS_Store
coverage/
```

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
API_TOKEN=change-me-to-a-long-random-secret
CORS_ORIGIN=*
```

```markdown
# Team Task Board API

REST API (`/api/v1`) for projects and tasks. Storage is in-memory behind a `Store` interface so it can be swapped for a database later.

## Setup

```bash
cp .env.example .env
# set API_TOKEN to a strong secret
npm install
npm run dev
```

Production:

```bash
npm run build
NODE_ENV=production npm start
```

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer <API_TOKEN>
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness |
| GET | `/api/v1/projects` | List projects |
| POST | `/api/v1/projects` | Create project `{ "name": string }` |
| GET | `/api/v1/projects/:projectId` | Get project |
| DELETE | `/api/v1/projects/:projectId` | Delete project and its tasks |
| GET | `/api/v1/projects/:projectId/tasks` | List tasks (`status`, `page`, `pageSize`) |
| POST | `/api/v1/projects/:projectId/tasks` | Create task |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | Get task |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | Partial update |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | Delete task |

Task statuses: `todo` | `in_progress` | `done`.

## Error shape

```json
{ "error": { "code": "NOT_FOUND", "message": "Project not found" } }
```
```

```typescript
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

export interface PaginationQuery {
  page: number;
  pageSize: number;
}

export interface TaskListQuery extends PaginationQuery {
  status?: TaskStatus;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}
```

```typescript
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "VALIDATION_ERROR", message, details);
}

export function unauthorized(message = "Missing or invalid authorization"): AppError {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function notFound(message: string): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function methodNotAllowed(allow: string[]): AppError {
  const err = new AppError(
    405,
    "METHOD_NOT_ALLOWED",
    `Method not allowed. Allowed: ${allow.join(", ")}`,
  );
  (err as AppError & { allow: string[] }).allow = allow;
  return err;
}
```

```typescript
import { z } from "zod";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(200),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(300),
    description: z.string().trim().max(5000).optional(),
    status: taskStatusSchema.optional(),
    assignee: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    status: taskStatusSchema.optional(),
    assignee: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.string().uuid("Invalid id format");
```

```typescript
import type {
  CreateProjectInput,
  CreateTaskInput,
  Paginated,
  Project,
  Task,
  TaskListQuery,
  UpdateTaskInput,
} from "../types";

/**
 * Persistence boundary. Swap MemoryStore for a database implementation
 * without changing route handlers.
 */
export interface Store {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(input: CreateProjectInput): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;

  listTasks(
    projectId: string,
    query: TaskListQuery,
  ): Promise<Paginated<Task>>;
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<Task | undefined>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

```typescript
import { randomUUID } from "node:crypto";
import type { Store } from "./Store";
import type {
  CreateProjectInput,
  CreateTaskInput,
  Paginated,
  Project,
  Task,
  TaskListQuery,
  UpdateTaskInput,
} from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

export class MemoryStore implements Store {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: nowIso(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  async deleteProject(id: string): Promise<boolean> {
    const existed = this.projects.delete(id);
    if (!existed) return false;
    for (const [taskId, task] of this.tasks) {
      if (task.projectId === id) this.tasks.delete(taskId);
    }
    return true;
  }

  async listTasks(
    projectId: string,
    query: TaskListQuery,
  ): Promise<Paginated<Task>> {
    let items = [...this.tasks.values()].filter((t) => t.projectId === projectId);
    if (query.status) {
      items = items.filter((t) => t.status === query.status);
    }
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const total = items.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    const start = (query.page - 1) * query.pageSize;
    const data = items.slice(start, start + query.pageSize);

    return {
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
      },
    };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return undefined;
    return task;
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    const timestamp = nowIso();
    const task: Task = {
      id: randomUUID(),
      projectId,
      title: input.title,
      status: input.status ?? "todo",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (input.description !== undefined) task.description = input.description;
    if (input.assignee !== undefined) task.assignee = input.assignee;
    this.tasks.set(task.id, task);
    return task;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<Task | undefined> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return undefined;

    const next: Task = { ...existing, updatedAt: nowIso() };

    if (input.title !== undefined) next.title = input.title;
    if (input.status !== undefined) next.status = input.status;

    if (input.description === null) {
      delete next.description;
    } else if (input.description !== undefined) {
      next.description = input.description;
    }

    if (input.assignee === null) {
      delete next.assignee;
    } else if (input.assignee !== undefined) {
      next.assignee = input.assignee;
    }

    this.tasks.set(taskId, next);
    return next;
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;
    return this.tasks.delete(taskId);
  }
}
```

```typescript
import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
  isProd: boolean;
  apiToken: string;
  corsOrigin: string | string[];
}

export function loadConfig(): Config {
  const corsRaw = process.env.CORS_ORIGIN ?? "*";
  const corsOrigin =
    corsRaw === "*"
      ? "*"
      : corsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
    nodeEnv: process.env.NODE_ENV ?? "development",
    isProd: (process.env.NODE_ENV ?? "development") === "production",
    apiToken: required("API_TOKEN"),
    corsOrigin,
  };
}
```

```typescript
import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../errors";
import type { Config } from "../config";

export function createAuthMiddleware(config: Config) {
  return function auth(req: Request, _res: Response, next: NextFunction): void {
    const header = req.header("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      next(unauthorized("Authorization Bearer token is required"));
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token || token !== config.apiToken) {
      next(unauthorized("Invalid token"));
      return;
    }
    next();
  };
}
```

```typescript
import type { NextFunction, Request, Response } from "express";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const path = req.originalUrl.split("?")[0] ?? req.path;
    console.log(
      JSON.stringify({
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  });

  next();
}
```

```typescript
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";
import type { Config } from "../config";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function createErrorHandler(config: Config) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    if (res.headersSent) return;

    if (err instanceof AppError) {
      if (err.statusCode === 405) {
        const allow = (err as AppError & { allow?: string[] }).allow;
        if (allow) res.setHeader("Allow", allow.join(", "));
      }

      const body: ErrorBody = {
        error: { code: err.code, message: err.message },
      };
      if (err.details !== undefined && !config.isProd) {
        body.error.details = err.details;
      }
      res.status(err.statusCode).json(body);
      return;
    }

    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" },
      });
      return;
    }

    console.error("unhandled_error", err);
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: config.isProd
          ? "An unexpected error occurred"
          : err instanceof Error
            ? err.message
            : "An unexpected error occurred",
      },
    });
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
}
```

```typescript
import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { AppError, badRequest, methodNotAllowed } from "../errors";

export function parseBody<T>(schema: ZodSchema<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest("Request validation failed", formatZod(result.error));
  }
  return result.data;
}

export function parseQuery<T>(schema: ZodSchema<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest("Query validation failed", formatZod(result.error));
  }
  return result.data;
}

export function parseId(schema: ZodSchema<string>, value: string, label: string): string {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(`Invalid ${label}`);
  }
  return result.data;
}

function formatZod(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

export function rejectMethods(allow: string[]) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next(methodNotAllowed(allow));
  };
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function sendAppError(res: Response, err: AppError): void {
  if (err.statusCode === 405) {
    const allow = (err as AppError & { allow?: string[] }).allow;
    if (allow) res.setHeader("Allow", allow.join(", "));
  }
  res.status(err.statusCode).json({
    error: { code: err.code, message: err.message },
  });
}
```

```typescript
import { Router } from "express";

export function healthRouter(): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({ ok: true });
  });
  return router;
}
```

```typescript
import { Router } from "express";
import type { Store } from "../store/Store";
import { notFound } from "../errors";
import { createProjectSchema, idParamSchema } from "../schemas";
import { asyncHandler, parseBody, parseId, rejectMethods } from "../http";

export function projectsRouter(store: Store): Router {
  const router = Router();

  router
    .route("/")
    .get(
      asyncHandler(async (_req, res) => {
        const projects = await store.listProjects();
        res.json({ data: projects });
      }),
    )
    .post(
      asyncHandler(async (req, res) => {
        const body = parseBody(createProjectSchema, req.body);
        const project = await store.createProject(body);
        res.status(201).json(project);
      }),
    )
    .all(rejectMethods(["GET", "POST"]));

  router
    .route("/:projectId")
    .get(
      asyncHandler(async (req, res) => {
        const projectId = parseId(idParamSchema, req.params.projectId, "projectId");
        const project = await store.getProject(projectId);
        if (!project) throw notFound("Project not found");
        res.json(project);
      }),
    )
    .delete(
      asyncHandler(async (req, res) => {
        const projectId = parseId(idParamSchema, req.params.projectId, "projectId");
        const deleted = await store.deleteProject(projectId);
        if (!deleted) throw notFound("Project not found");
        res.status(204).send();
      }),
    )
    .all(rejectMethods(["GET", "DELETE"]));

  return router;
}
```

```typescript
import { Router } from "express";
import type { Store } from "../store/Store";
import { notFound } from "../errors";
import {
  createTaskSchema,
  idParamSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from "../schemas";
import { asyncHandler, parseBody, parseId, parseQuery, rejectMethods } from "../http";

async function requireProject(store: Store, projectId: string): Promise<void> {
  const project = await store.getProject(projectId);
  if (!project) throw notFound("Project not found");
}

export function tasksRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router
    .route("/")
    .get(
      asyncHandler(async (req, res) => {
        const projectId = parseId(idParamSchema, req.params.projectId, "projectId");
        await requireProject(store, projectId);
        const query = parseQuery(listTasksQuerySchema, req.query);
        const result = await store.listTasks(projectId, query);
        res.json(result);
      }),
    )
    .post(
      asyncHandler(async (req, res) => {
        const projectId = parseId(idParamSchema, req.params.projectId, "projectId");
        await requireProject(store, projectId);
        const body = parseBody(createTaskSchema, req.body);
        const task = await store.createTask(projectId, body);
        res.status(201).json(task);
      }),
    )
    .all(rejectMethods(["GET", "POST"]));

  router
    .route("/:taskId")
    .get(
      asyncHandler(async (req, res) => {
        const projectId = parseId(idParamSchema, req.params.projectId, "projectId");
        const taskId = parseId(idParamSchema, req.params.taskId, "taskId");
        await requireProject(store, projectId);
        const task = await store.getTask(projectId, taskId);
        if (!task) throw notFound("Task not found");
        res.json(task);
      }),
    )
    .patch(
      asyncHandler(async (req, res) => {
        const projectId = parseId(idParamSchema, req.params.projectId, "projectId");
        const taskId = parseId(idParamSchema, req.params.taskId, "taskId");
        await requireProject(store, projectId);
        const body = parseBody(updateTaskSchema, req.body);
        const task = await store.updateTask(projectId, taskId, body);
        if (!task) throw notFound("Task not found");
        res.json(task);
      }),
    )
    .delete(
      asyncHandler(async (req, res) => {
        const projectId = parseId(idParamSchema, req.params.projectId, "projectId");
        const taskId = parseId(idParamSchema, req.params.taskId, "taskId");
        await requireProject(store, projectId);
        const deleted = await store.deleteTask(projectId, taskId);
        if (!deleted) throw notFound("Task not found");
        res.status(204).send();
      }),
    )
    .all(rejectMethods(["GET", "PATCH", "DELETE"]));

  return router;
}
```

```typescript
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Config } from "./config";
import { createAuthMiddleware } from "./middleware/auth";
import { createErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { healthRouter } from "./routes/health";
import { projectsRouter } from "./routes/projects";
import { tasksRouter } from "./routes/tasks";
import type { Store } from "./store/Store";

export function createApp(store: Store, config: Config): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(requestLogger);

  app.use("/api/v1/health", healthRouter());

  app.use("/api/v1", createAuthMiddleware(config));
  app.use("/api/v1/projects", projectsRouter(store));
  app.use("/api/v1/projects/:projectId/tasks", tasksRouter(store));

  app.use(notFoundHandler);
  app.use(createErrorHandler(config));

  return app;
}
```

```typescript
import { loadConfig } from "./config";
import { createApp } from "./app";
import { MemoryStore } from "./store/MemoryStore";

function main(): void {
  const config = loadConfig();
  const store = new MemoryStore();
  const app = createApp(store, config);

  const server = app.listen(config.port, config.host, () => {
    console.log(
      JSON.stringify({
        msg: "server_started",
        host: config.host,
        port: config.port,
        env: config.nodeEnv,
      }),
    );
  });

  const shutdown = (signal: string) => {
    console.log(JSON.stringify({ msg: "shutdown", signal }));
    server.close((err) => {
      if (err) {
        console.error("shutdown_error", err);
        process.exit(1);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
```

### Run

```bash
cp .env.example .env   # set API_TOKEN
npm install
npm run dev
```

Example:

```bash
curl -s http://localhost:3000/api/v1/health
curl -s -H "Authorization: Bearer change-me-to-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Launch"}' \
  http://localhost:3000/api/v1/projects
```

### Design notes

- **Store**: `Store` in `src/store/Store.ts` is the swap point; `MemoryStore` is the default. Route handlers never touch maps directly.
- **Auth**: Bearer token compared to `API_TOKEN`. `/api/v1/health` is registered before the auth middleware.
- **CORS**: `cors` handles preflight (`OPTIONS`) before auth.
- **Errors**: `{ error: { code, message } }` for 400 / 401 / 404 / 405 / 500. Unknown paths use the same 404 shape. 405 sets `Allow`.
- **Logging**: JSON line per request with `method`, `path`, `status`, `durationMs`.
- **Validation**: Zod; extra fields rejected (`.strict()`). Task list supports `status`, `page` (default 1), `pageSize` (default 20, max 100).
- **PATCH**: `description` / `assignee` can be `null` to clear. Missing project or task → 404. Deleting a project removes its tasks.