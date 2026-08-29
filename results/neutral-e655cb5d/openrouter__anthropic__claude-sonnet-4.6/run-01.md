<!-- model: openrouter/anthropic/claude-sonnet-4.6 | run: 1 | framework: Express -->

Here is the complete, production-ready implementation. I've chosen **Express** (battle-tested HTTP framework), **Zod** (schema validation with excellent TypeScript integration), **uuid** (RFC-compliant IDs), and **dotenv** (environment config).

---

### Directory layout

```
team-task-board/
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── config.ts
│   ├── errors/
│   │   └── AppError.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── logger.middleware.ts
│   │   └── errorHandler.middleware.ts
│   ├── models/
│   │   ├── project.model.ts
│   │   └── task.model.ts
│   ├── store/
│   │   ├── store.interface.ts
│   │   └── inMemory.store.ts
│   ├── validators/
│   │   ├── project.validator.ts
│   │   └── task.validator.ts
│   └── routes/
│       ├── health.router.ts
│       ├── projects.router.ts
│       └── tasks.router.ts
├── .env.example
├── .gitignore
├── Dockerfile
├── tsconfig.json
├── package.json
└── README.md
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board",
  "engines": { "node": ">=20" },
  "main": "dist/index.js",
  "scripts": {
    "build":     "tsc",
    "start":     "node dist/index.js",
    "dev":       "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cors":   "^2.8.5",
    "dotenv": "^16.4.5",
    "express":"^4.19.2",
    "uuid":   "^10.0.0",
    "zod":    "^3.23.8"
  },
  "devDependencies": {
    "@types/cors":    "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node":    "^22.5.0",
    "@types/uuid":    "^10.0.0",
    "tsx":            "^4.17.0",
    "typescript":     "^5.5.4"
  }
}
```

---

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target":                     "ES2022",
    "module":                     "commonjs",
    "lib":                        ["ES2022"],
    "outDir":                     "./dist",
    "rootDir":                    "./src",
    "strict":                     true,
    "esModuleInterop":            true,
    "skipLibCheck":               true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule":          true,
    "declaration":                true,
    "sourceMap":                  true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `src/config.ts`

```typescript
import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const config = {
  port:       parseInt(process.env.PORT ?? "3000", 10),
  apiToken:   requireEnv("API_TOKEN"),
  nodeEnv:    process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
} as const;
```

---

### `src/errors/AppError.ts`

```typescript
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, "VALIDATION_ERROR", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(message = "Method not allowed") {
    super(405, "METHOD_NOT_ALLOWED", message);
  }
}
```

---

### `src/models/project.model.ts`

```typescript
export interface Project {
  id:        string;
  name:      string;
  createdAt: string; // ISO 8601
}
```

---

### `src/models/task.model.ts`

```typescript
export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id:          string;
  projectId:   string;
  title:       string;
  description?: string;
  status:      TaskStatus;
  assignee?:   string;
  createdAt:   string; // ISO 8601
  updatedAt:   string; // ISO 8601
}
```

---

### `src/store/store.interface.ts`

```typescript
import type { Project } from "../models/project.model";
import type { Task, TaskStatus } from "../models/task.model";

export interface TaskFilter {
  status?: TaskStatus;
}

export interface CreateTaskData {
  title:        string;
  description?: string;
  status?:      TaskStatus;
  assignee?:    string;
}

export interface UpdateTaskData {
  title?:       string;
  description?: string;
  status?:      TaskStatus;
  assignee?:    string;
}

/** Swap this out for a database-backed implementation without touching any route code. */
export interface IStore {
  // ── Projects ────────────────────────────────────────────────────────────────
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  createProject(name: string): Project;
  deleteProject(id: string): boolean;

  // ── Tasks ───────────────────────────────────────────────────────────────────
  listTasks(projectId: string, filter?: TaskFilter): Task[];
  getTask(projectId: string, taskId: string): Task | undefined;
  createTask(projectId: string, data: CreateTaskData): Task;
  updateTask(projectId: string, taskId: string, data: UpdateTaskData): Task | undefined;
  deleteTask(projectId: string, taskId: string): boolean;
}
```

---

### `src/store/inMemory.store.ts`

```typescript
import { v4 as uuid } from "uuid";
import type { Project } from "../models/project.model";
import type { Task } from "../models/task.model";
import type { IStore, TaskFilter, CreateTaskData, UpdateTaskData } from "./store.interface";

export class InMemoryStore implements IStore {
  private readonly projects = new Map<string, Project>();
  private readonly tasks    = new Map<string, Task>();   // keyed by taskId

  // ── Projects ────────────────────────────────────────────────────────────────

  listProjects(): Project[] {
    return [...this.projects.values()].sort(byCreatedAt);
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  createProject(name: string): Project {
    const project: Project = { id: uuid(), name, createdAt: now() };
    this.projects.set(project.id, project);
    return project;
  }

  deleteProject(id: string): boolean {
    if (!this.projects.has(id)) return false;
    this.projects.delete(id);
    for (const [taskId, task] of this.tasks) {
      if (task.projectId === id) this.tasks.delete(taskId);
    }
    return true;
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────

  listTasks(projectId: string, filter?: TaskFilter): Task[] {
    let tasks = [...this.tasks.values()].filter(t => t.projectId === projectId);
    if (filter?.status) tasks = tasks.filter(t => t.status === filter.status);
    return tasks.sort(byCreatedAt);
  }

  getTask(projectId: string, taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task?.projectId === projectId ? task : undefined;
  }

  createTask(projectId: string, data: CreateTaskData): Task {
    const task: Task = {
      id:          uuid(),
      projectId,
      title:       data.title,
      description: data.description,
      status:      data.status ?? "todo",
      assignee:    data.assignee,
      createdAt:   now(),
      updatedAt:   now(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  updateTask(projectId: string, taskId: string, data: UpdateTaskData): Task | undefined {
    const existing = this.getTask(projectId, taskId);
    if (!existing) return undefined;

    // Only overwrite keys that were explicitly provided in the payload
    const patch = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    ) as Partial<Task>;

    const updated: Task = { ...existing, ...patch, updatedAt: now() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  deleteTask(projectId: string, taskId: string): boolean {
    if (!this.getTask(projectId, taskId)) return false;
    this.tasks.delete(taskId);
    return true;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function byCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}
```

---

### `src/validators/project.validator.ts`

```typescript
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z
    .string({ required_error: "name is required" })
    .min(1, "name must not be empty")
    .max(200, "name must be at most 200 characters"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
```

---

### `src/validators/task.validator.ts`

```typescript
import { z } from "zod";

const taskStatusSchema = z.enum(["todo", "in_progress", "done"], {
  errorMap: () => ({ message: "status must be 'todo', 'in_progress', or 'done'" }),
});

export const createTaskSchema = z.object({
  title:       z.string({ required_error: "title is required" })
                 .min(1, "title must not be empty")
                 .max(500),
  description: z.string().max(5_000).optional(),
  status:      taskStatusSchema.optional(),
  assignee:    z.string().max(200).optional(),
});

export const updateTaskSchema = z
  .object({
    title:       z.string().min(1).max(500).optional(),
    description: z.string().max(5_000).optional(),
    status:      taskStatusSchema.optional(),
    assignee:    z.string().max(200).optional(),
  })
  .refine(
    data => Object.keys(data).length > 0,
    { message: "At least one field must be provided for update" },
  );

export const taskQuerySchema = z.object({
  status:   taskStatusSchema.optional(),
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskQueryInput  = z.infer<typeof taskQuerySchema>;
```

---

### `src/middleware/logger.middleware.ts`

```typescript
import type { Request, Response, NextFunction } from "express";

export function loggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startMs = Date.now();

  res.on("finish", () => {
    process.stdout.write(
      JSON.stringify({
        time:       new Date().toISOString(),
        method:     req.method,
        path:       req.originalUrl,
        status:     res.statusCode,
        durationMs: Date.now() - startMs,
      }) + "\n",
    );
  });

  next();
}
```

---

### `src/middleware/auth.middleware.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { UnauthorizedError } from "../errors/AppError";

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";

  if (!header.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Authorization header must use the Bearer scheme"));
  }

  const token = header.slice(7); // strip "Bearer "
  if (token !== config.apiToken) {
    return next(new UnauthorizedError("Invalid API token"));
  }

  next();
}
```

---

### `src/middleware/errorHandler.middleware.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError";

function zodMessage(err: ZodError): string {
  return err.errors
    .map(e => (e.path.length ? `${e.path.join(".")} — ${e.message}` : e.message))
    .join("; ");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandlerMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: zodMessage(err) } });
    return;
  }

  // Unexpected / unhandled error — log the full stack, expose nothing
  console.error("[unhandled]", err);
  res.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
  });
}
```

---

### `src/routes/health.router.ts`

```typescript
import { Router } from "express";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ ok: true });
  });

  return router;
}
```

---

### `src/routes/projects.router.ts`

```typescript
import { Router, Request, Response, NextFunction } from "express";
import type { IStore } from "../store/store.interface";
import { createProjectSchema } from "../validators/project.validator";
import { MethodNotAllowedError, NotFoundError } from "../errors/AppError";

export function createProjectsRouter(store: IStore): Router {
  const router = Router();

  // ── GET /projects ──────────────────────────────────────────────────────────
  router.get("/", (_req: Request, res: Response) => {
    const projects = store.listProjects();
    res.json({ data: projects, total: projects.length });
  });

  // ── POST /projects ─────────────────────────────────────────────────────────
  router.post("/", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = createProjectSchema.parse(req.body);
      const project  = store.createProject(name);
      res.status(201).json({ data: project });
    } catch (err) {
      next(err);
    }
  });

  router.all("/", (_req, _res, next) => next(new MethodNotAllowedError()));

  // ── GET /projects/:projectId ───────────────────────────────────────────────
  router.get("/:projectId", (req: Request, res: Response, next: NextFunction) => {
    const project = store.getProject(req.params.projectId);
    if (!project) return next(new NotFoundError(`Project '${req.params.projectId}' not found`));
    res.json({ data: project });
  });

  // ── DELETE /projects/:projectId ────────────────────────────────────────────
  router.delete("/:projectId", (req: Request, res: Response, next: NextFunction) => {
    const deleted = store.deleteProject(req.params.projectId);
    if (!deleted) return next(new NotFoundError(`Project '${req.params.projectId}' not found`));
    res.status(204).send();
  });

  router.all("/:projectId", (_req, _res, next) => next(new MethodNotAllowedError()));

  return router;
}
```

---

### `src/routes/tasks.router.ts`

```typescript
import { Router, Request, Response, NextFunction } from "express";
import type { IStore } from "../store/store.interface";
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
} from "../validators/task.validator";
import { MethodNotAllowedError, NotFoundError } from "../errors/AppError";

export function createTasksRouter(store: IStore): Router {
  // mergeParams lets us read :projectId that was captured by the parent app.use() path
  const router = Router({ mergeParams: true });

  // ── GET /projects/:projectId/tasks ─────────────────────────────────────────
  router.get("/", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;

      if (!store.getProject(projectId)) {
        return next(new NotFoundError(`Project '${projectId}' not found`));
      }

      const { status, page, pageSize } = taskQuerySchema.parse(req.query);
      const allTasks = store.listTasks(projectId, { status });

      const total      = allTasks.length;
      const totalPages = Math.ceil(total / pageSize) || 1;
      const start      = (page - 1) * pageSize;
      const data       = allTasks.slice(start, start + pageSize);

      res.json({ data, pagination: { total, page, pageSize, totalPages } });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /projects/:projectId/tasks ────────────────────────────────────────
  router.post("/", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;

      if (!store.getProject(projectId)) {
        return next(new NotFoundError(`Project '${projectId}' not found`));
      }

      const input = createTaskSchema.parse(req.body);
      const task  = store.createTask(projectId, input);
      res.status(201).json({ data: task });
    } catch (err) {
      next(err);
    }
  });

  router.all("/", (_req, _res, next) => next(new MethodNotAllowedError()));

  // ── GET /projects/:projectId/tasks/:taskId ─────────────────────────────────
  router.get("/:taskId", (req: Request, res: Response, next: NextFunction) => {
    const { projectId, taskId } = req.params;

    if (!store.getProject(projectId)) {
      return next(new NotFoundError(`Project '${projectId}' not found`));
    }

    const task = store.getTask(projectId, taskId);
    if (!task) return next(new NotFoundError(`Task '${taskId}' not found`));

    res.json({ data: task });
  });

  // ── PATCH /projects/:projectId/tasks/:taskId ───────────────────────────────
  router.patch("/:taskId", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, taskId } = req.params;

      if (!store.getProject(projectId)) {
        return next(new NotFoundError(`Project '${projectId}' not found`));
      }

      const input   = updateTaskSchema.parse(req.body);
      const updated = store.updateTask(projectId, taskId, input);
      if (!updated) return next(new NotFoundError(`Task '${taskId}' not found`));

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // ── DELETE /projects/:projectId/tasks/:taskId ──────────────────────────────
  router.delete("/:taskId", (req: Request, res: Response, next: NextFunction) => {
    const { projectId, taskId } = req.params;

    if (!store.getProject(projectId)) {
      return next(new NotFoundError(`Project '${projectId}' not found`));
    }

    const deleted = store.deleteTask(projectId, taskId);
    if (!deleted) return next(new NotFoundError(`Task '${taskId}' not found`));

    res.status(204).send();
  });

  router.all("/:taskId", (_req, _res, next) => next(new MethodNotAllowedError()));

  return router;
}
```

---

### `src/app.ts`

```typescript
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { config } from "./config";
import { loggerMiddleware } from "./middleware/logger.middleware";
import { authMiddleware } from "./middleware/auth.middleware";
import { errorHandlerMiddleware } from "./middleware/errorHandler.middleware";
import { createHealthRouter } from "./routes/health.router";
import { createProjectsRouter } from "./routes/projects.router";
import { createTasksRouter } from "./routes/tasks.router";
import type { IStore } from "./store/store.interface";
import { NotFoundError } from "./errors/AppError";

export function createApp(store: IStore): express.Application {
  const app = express();

  // ── Core middleware ────────────────────────────────────────────────────────
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    cors({
      origin:         config.corsOrigin,
      methods:        ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials:    true,
      // Preflight cache for 2 hours
      maxAge: 7_200,
    }),
  );

  app.use(express.json({ limit: "256kb" }));
  app.use(loggerMiddleware);

  // ── Health (no auth required) ──────────────────────────────────────────────
  app.use("/api/v1/health", createHealthRouter());

  // ── Auth guard for all remaining /api/v1 routes ────────────────────────────
  app.use("/api/v1", authMiddleware);

  // ── Feature routers ────────────────────────────────────────────────────────
  // Tasks router must be mounted before projects router so that Express sees
  // the more-specific path /projects/:projectId/tasks first.
  app.use("/api/v1/projects/:projectId/tasks", createTasksRouter(store));
  app.use("/api/v1/projects",                  createProjectsRouter(store));

  // ── Catch-all 404 ─────────────────────────────────────────────────────────
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError("Route not found"));
  });

  // ── Global error handler (must be last) ───────────────────────────────────
  app.use(errorHandlerMiddleware);

  return app;
}
```

---

### `src/index.ts`

```typescript
import { createApp } from "./app";
import { InMemoryStore } from "./store/inMemory.store";
import { config } from "./config";

const store = new InMemoryStore();
const app   = createApp(store);

const server = app.listen(config.port, () => {
  process.stdout.write(
    JSON.stringify({
      time:    new Date().toISOString(),
      message: "Server started",
      port:    config.port,
      env:     config.nodeEnv,
    }) + "\n",
  );
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  process.stdout.write(`\n${signal} received — shutting down gracefully\n`);
  server.close(() => {
    process.stdout.write("HTTP server closed\n");
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
```

---

### `.env.example`

```dotenv
# Required — all requests (except /health) must send: Authorization: Bearer <API_TOKEN>
API_TOKEN=change-me-to-a-long-random-secret

# Optional
PORT=3000
NODE_ENV=development

# Set to a specific origin in production, e.g. https://app.example.com
CORS_ORIGIN=*
```

---

### `.gitignore`

```
node_modules/
dist/
.env
*.js.map
```

---

### `Dockerfile`

```dockerfile
# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

---

### `README.md`

````markdown
# Team Task Board API

A production-ready REST API for managing projects and tasks.

## Setup

```bash
cp .env.example .env       # fill in API_TOKEN at minimum
npm install
npm run dev                # development (hot-reload via tsx)
npm run build && npm start # production
```

## Environment variables

| Variable     | Required | Default | Description                        |
|--------------|----------|---------|------------------------------------|
| `API_TOKEN`  | ✅       | —       | Bearer token checked on all routes |
| `PORT`       | ❌       | `3000`  | TCP port to listen on              |
| `NODE_ENV`   | ❌       | `development` | Affects log verbosity        |
| `CORS_ORIGIN`| ❌       | `*`     | Allowed CORS origin                |

## API reference

All routes except `/health` require the header:
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
POST   /api/v1/projects          body: { "name": "string" }
GET    /api/v1/projects/:id
DELETE /api/v1/projects/:id
```

### Tasks
```
GET    /api/v1/projects/:pid/tasks?status=todo&page=1&pageSize=20
POST   /api/v1/projects/:pid/tasks
GET    /api/v1/projects/:pid/tasks/:tid
PATCH  /api/v1/projects/:pid/tasks/:tid
DELETE /api/v1/projects/:pid/tasks/:tid
```

## Quick tour with curl

```bash
export TOKEN="change-me-to-a-long-random-secret"
export BASE="http://localhost:3000/api/v1"

# Health (no auth)
curl $BASE/health

# Create a project
curl -s -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Launch Checklist"}' | jq .

# List projects
curl -s $BASE/projects -H "Authorization: Bearer $TOKEN" | jq .

# Create a task
PID="<projectId from above>"
curl -s -X POST $BASE/projects/$PID/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Design mockup","assignee":"alice","status":"in_progress"}' | jq .

# List tasks with filter + pagination
curl -s "$BASE/projects/$PID/tasks?status=in_progress&page=1&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Patch a task
TID="<taskId from above>"
curl -s -X PATCH $BASE/projects/$PID/tasks/$TID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}' | jq .

# Delete the project (and all its tasks)
curl -s -X DELETE $BASE/projects/$PID \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}\n"
```

## Error shape

All errors follow the same envelope:
```json
{
  "error": {
    "code":    "NOT_FOUND",
    "message": "Project 'abc' not found"
  }
}
```

| HTTP | `code`                  | Cause                            |
|------|-------------------------|----------------------------------|
| 400  | `VALIDATION_ERROR`      | Invalid request body / params    |
| 401  | `UNAUTHORIZED`          | Missing or wrong Bearer token    |
| 404  | `NOT_FOUND`             | Resource or route not found      |
| 405  | `METHOD_NOT_ALLOWED`    | HTTP verb not supported          |
| 500  | `INTERNAL_SERVER_ERROR` | Unhandled exception              |
````

---

## Key design decisions explained

| Concern | Decision | Why |
|---|---|---|
| **Framework** | Express 4 | Mature, minimal, huge ecosystem; easy to reason about middleware order |
| **Validation** | Zod | First-class TypeScript inference, no separate type declarations needed |
| **IDs** | `uuid v4` | Globally unique, no coordination needed |
| **Store** | `IStore` interface + `InMemoryStore` | One file swap to add Postgres/Redis; routes never touch `Map` directly |
| **Auth** | Middleware mounted at `/api/v1` after health | Health probe skips auth; all other routes share one guard |
| **405 vs 404** | `router.all(path, …)` after specific method handlers | Routes that exist but wrong verb → 405; genuinely unknown paths → 404 |
| **Error handling** | Central `errorHandlerMiddleware` | Zod errors, AppErrors, and unknown throws all funnelled to one place |
| **Logging** | `res.on('finish', …)` | Records real status code after response is written, not before |
| **CORS preflight** | `cors()` with `maxAge: 7200` | Browser caches preflight for 2 h, reducing OPTIONS round-trips |
| **Pagination** | Applied after status filter | `total` reflects filtered count; slice gives current page |