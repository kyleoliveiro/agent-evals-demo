<!-- model: openrouter/anthropic/claude-opus-4.6 | run: 2 | framework: Express -->

Here's the complete application. I've chosen **Express** (lightweight, battle-tested), **Zod** (runtime validation), **uuid** (ID generation), and **tsx** (dev runner). The storage layer sits behind an interface so you can swap in Postgres/Redis later.

---

### `package.json`

```json
{
  "name": "team-task-board",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "uuid": "^10.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.5.0",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### `src/index.ts`

```typescript
import { app } from "./app.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  console.log(`🚀 Task-board API listening on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV ?? "development"}`);
});
```

### `src/app.ts`

```typescript
import express from "express";
import cors from "cors";

import { requestLogger } from "./middleware/request-logger.js";
import { authGuard } from "./middleware/auth-guard.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found-handler.js";
import { healthRouter } from "./routes/health.js";
import { projectRouter } from "./routes/projects.js";
import { taskRouter } from "./routes/tasks.js";

export const app = express();

// ── Global middleware ────────────────────────────────────────────────
app.use(cors({ origin: "*", methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.use(express.json());
app.use(requestLogger);

// ── Routes ───────────────────────────────────────────────────────────
app.use("/api/v1/health", healthRouter);

// Everything below /health requires auth
app.use("/api/v1", authGuard);
app.use("/api/v1/projects", projectRouter);
app.use("/api/v1/projects", taskRouter);

// ── Fallbacks ────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);
```

### `src/models.ts`

```typescript
export type TaskStatus = "todo" | "in_progress" | "done";

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
  createdAt: string;  // ISO-8601
  updatedAt: string;  // ISO-8601
}
```

### `src/store/store.interface.ts`

```typescript
import type { Project, Task, TaskStatus } from "../models.js";

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface TaskFilter {
  status?: TaskStatus;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Store {
  // ── Projects ─────────────────────────────────────────
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  createProject(project: Project): Project;
  deleteProject(id: string): boolean;

  // ── Tasks ────────────────────────────────────────────
  listTasks(
    projectId: string,
    filter: TaskFilter,
    pagination: PaginationOptions,
  ): PaginatedResult<Task>;
  getTask(projectId: string, taskId: string): Task | undefined;
  createTask(task: Task): Task;
  updateTask(projectId: string, taskId: string, patch: Partial<Task>): Task | undefined;
  deleteTask(projectId: string, taskId: string): boolean;
  deleteTasksByProject(projectId: string): number;
}
```

### `src/store/memory-store.ts`

```typescript
import type { Project, Task } from "../models.js";
import type {
  Store,
  TaskFilter,
  PaginationOptions,
  PaginatedResult,
} from "./store.interface.js";

export class MemoryStore implements Store {
  private projects = new Map<string, Project>();
  private tasks = new Map<string, Task>(); // keyed by task.id

  // ── Projects ─────────────────────────────────────────

  listProjects(): Project[] {
    return [...this.projects.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  createProject(project: Project): Project {
    this.projects.set(project.id, project);
    return project;
  }

  deleteProject(id: string): boolean {
    return this.projects.delete(id);
  }

  // ── Tasks ────────────────────────────────────────────

  listTasks(
    projectId: string,
    filter: TaskFilter,
    pagination: PaginationOptions,
  ): PaginatedResult<Task> {
    let items = [...this.tasks.values()]
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filter.status) {
      items = items.filter((t) => t.status === filter.status);
    }

    const total = items.length;
    const { page, pageSize } = pagination;
    const start = (page - 1) * pageSize;
    const data = items.slice(start, start + pageSize);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  getTask(projectId: string, taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task && task.projectId === projectId ? task : undefined;
  }

  createTask(task: Task): Task {
    this.tasks.set(task.id, task);
    return task;
  }

  updateTask(projectId: string, taskId: string, patch: Partial<Task>): Task | undefined {
    const existing = this.getTask(projectId, taskId);
    if (!existing) return undefined;

    const updated: Task = {
      ...existing,
      ...patch,
      // never allow overwriting identity fields
      id: existing.id,
      projectId: existing.projectId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, updated);
    return updated;
  }

  deleteTask(projectId: string, taskId: string): boolean {
    const existing = this.getTask(projectId, taskId);
    if (!existing) return false;
    return this.tasks.delete(taskId);
  }

  deleteTasksByProject(projectId: string): number {
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (task.projectId === projectId) {
        this.tasks.delete(id);
        count++;
      }
    }
    return count;
  }
}
```

### `src/store/index.ts`

```typescript
import type { Store } from "./store.interface.js";
import { MemoryStore } from "./memory-store.js";

// Single instance – swap this factory when you move to a real DB.
let _store: Store | null = null;

export function getStore(): Store {
  if (!_store) {
    _store = new MemoryStore();
  }
  return _store;
}

export type { Store } from "./store.interface.js";
```

### `src/errors.ts`

```typescript
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, "BAD_REQUEST", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Missing or invalid authorization token") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, "NOT_FOUND", `${resource} not found`);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(method: string, path: string) {
    super(405, "METHOD_NOT_ALLOWED", `${method} is not allowed on ${path}`);
  }
}
```

### `src/validation.ts`

```typescript
import { z } from "zod";

// ── Projects ───────────────────────────────────────────

export const CreateProjectSchema = z
  .object({
    name: z.string().min(1, "Project name is required").max(200),
  })
  .strict();

export type CreateProjectBody = z.infer<typeof CreateProjectSchema>;

// ── Tasks ──────────────────────────────────────────────

const TASK_STATUSES = ["todo", "in_progress", "done"] as const;

export const CreateTaskSchema = z
  .object({
    title: z.string().min(1, "Task title is required").max(500),
    description: z.string().max(5000).optional(),
    status: z.enum(TASK_STATUSES).optional().default("todo"),
    assignee: z.string().max(200).optional(),
  })
  .strict();

export type CreateTaskBody = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: z.string().max(200).nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field must be provided for update",
  });

export type UpdateTaskBody = z.infer<typeof UpdateTaskSchema>;

// ── Query params ───────────────────────────────────────

export const TaskListQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});
```

### `src/middleware/request-logger.ts`

```typescript
import type { Request, Response, NextFunction } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
    console.log(`[${new Date().toISOString()}] ${line}`);
  });

  next();
}
```

### `src/middleware/auth-guard.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../errors.js";

const API_TOKEN = process.env.API_TOKEN;

export function authGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!API_TOKEN) {
    console.warn("⚠️  API_TOKEN is not set – all authenticated routes will reject requests");
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(new UnauthorizedError());
    return;
  }

  const token = header.slice(7);
  if (token !== API_TOKEN) {
    next(new UnauthorizedError());
    return;
  }

  next();
}
```

### `src/middleware/error-handler.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors.js";
import { ZodError } from "zod";

function formatZodError(err: ZodError): string {
  return err.errors
    .map((e) => {
      const path = e.path.length ? `${e.path.join(".")}: ` : "";
      return `${path}${e.message}`;
    })
    .join("; ");
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Zod validation failures → 400
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: formatZodError(err),
      },
    });
    return;
  }

  // Known application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // JSON parse errors from express.json()
  if ("type" in err && (err as any).type === "entity.parse.failed") {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid JSON in request body",
      },
    });
    return;
  }

  // Unexpected
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
}
```

### `src/middleware/not-found-handler.ts`

```typescript
import type { Request, Response, NextFunction } from "express";

export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  });
}
```

### `src/routes/health.ts`

```typescript
import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ ok: true });
});

// Reject other methods on /health
healthRouter.all("/", (req, res) => {
  res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: `${req.method} is not allowed on /api/v1/health`,
    },
  });
});
```

### `src/routes/projects.ts`

```typescript
import { Router } from "express";
import { v4 as uuid } from "uuid";

import { getStore } from "../store/index.js";
import { NotFoundError } from "../errors.js";
import { CreateProjectSchema } from "../validation.js";

export const projectRouter = Router();

// LIST
projectRouter.get("/", (_req, res) => {
  const projects = getStore().listProjects();
  res.json({ data: projects });
});

// CREATE
projectRouter.post("/", (req, res, next) => {
  try {
    const body = CreateProjectSchema.parse(req.body);
    const now = new Date().toISOString();
    const project = getStore().createProject({
      id: uuid(),
      name: body.name,
      createdAt: now,
    });
    res.status(201).json({ data: project });
  } catch (err) {
    next(err);
  }
});

// GET ONE
projectRouter.get("/:projectId", (req, res, next) => {
  try {
    const project = getStore().getProject(req.params.projectId);
    if (!project) throw new NotFoundError("Project");
    res.json({ data: project });
  } catch (err) {
    next(err);
  }
});

// DELETE
projectRouter.delete("/:projectId", (req, res, next) => {
  try {
    const store = getStore();
    const exists = store.getProject(req.params.projectId);
    if (!exists) throw new NotFoundError("Project");

    store.deleteTasksByProject(req.params.projectId);
    store.deleteProject(req.params.projectId);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Method not allowed on collection
projectRouter.all("/", (req, res) => {
  res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: `${req.method} is not allowed on /api/v1/projects`,
    },
  });
});

// Method not allowed on single resource
projectRouter.all("/:projectId", (req, res) => {
  res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: `${req.method} is not allowed on /api/v1/projects/${req.params.projectId}`,
    },
  });
});
```

### `src/routes/tasks.ts`

```typescript
import { Router } from "express";
import { v4 as uuid } from "uuid";

import { getStore } from "../store/index.js";
import { NotFoundError } from "../errors.js";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskListQuerySchema,
} from "../validation.js";

export const taskRouter = Router();

// Helper: ensure project exists before any task operation
function ensureProject(projectId: string): void {
  if (!getStore().getProject(projectId)) {
    throw new NotFoundError("Project");
  }
}

// LIST with optional filter + pagination
taskRouter.get("/:projectId/tasks", (req, res, next) => {
  try {
    ensureProject(req.params.projectId);

    const query = TaskListQuerySchema.parse(req.query);
    const result = getStore().listTasks(
      req.params.projectId,
      { status: query.status },
      { page: query.page, pageSize: query.pageSize },
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// CREATE
taskRouter.post("/:projectId/tasks", (req, res, next) => {
  try {
    ensureProject(req.params.projectId);

    const body = CreateTaskSchema.parse(req.body);
    const now = new Date().toISOString();

    const task = getStore().createTask({
      id: uuid(),
      projectId: req.params.projectId,
      title: body.title,
      description: body.description,
      status: body.status,
      assignee: body.assignee,
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
});

// GET ONE
taskRouter.get("/:projectId/tasks/:taskId", (req, res, next) => {
  try {
    ensureProject(req.params.projectId);

    const task = getStore().getTask(req.params.projectId, req.params.taskId);
    if (!task) throw new NotFoundError("Task");

    res.json({ data: task });
  } catch (err) {
    next(err);
  }
});

// PATCH (partial update)
taskRouter.patch("/:projectId/tasks/:taskId", (req, res, next) => {
  try {
    ensureProject(req.params.projectId);

    const body = UpdateTaskSchema.parse(req.body);

    // Convert null → undefined so the store removes the optional field
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      patch[key] = value === null ? undefined : value;
    }

    const updated = getStore().updateTask(
      req.params.projectId,
      req.params.taskId,
      patch,
    );

    if (!updated) throw new NotFoundError("Task");

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE
taskRouter.delete("/:projectId/tasks/:taskId", (req, res, next) => {
  try {
    ensureProject(req.params.projectId);

    const deleted = getStore().deleteTask(req.params.projectId, req.params.taskId);
    if (!deleted) throw new NotFoundError("Task");

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Method not allowed – task collection
taskRouter.all("/:projectId/tasks", (req, res) => {
  res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: `${req.method} is not allowed on /api/v1/projects/${req.params.projectId}/tasks`,
    },
  });
});

// Method not allowed – single task
taskRouter.all("/:projectId/tasks/:taskId", (req, res) => {
  res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: `${req.method} is not allowed on /api/v1/projects/${req.params.projectId}/tasks/${req.params.taskId}`,
    },
  });
});
```

### `.env.example`

```bash
# Copy to .env and fill in your values
API_TOKEN=my-super-secret-token
PORT=3000
NODE_ENV=development
```

### `Dockerfile`

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
```

### `.dockerignore`

```
node_modules
dist
.env
*.md
```

---

## Project structure at a glance

```
.
├── .dockerignore
├── .env.example
├── Dockerfile
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                  # entry point
    ├── app.ts                    # Express app assembly
    ├── models.ts                 # type definitions
    ├── errors.ts                 # typed error classes
    ├── validation.ts             # Zod schemas
    ├── store/
    │   ├── store.interface.ts    # abstract storage contract
    │   ├── memory-store.ts       # in-memory implementation
    │   └── index.ts              # factory / singleton
    ├── middleware/
    │   ├── auth-guard.ts         # Bearer token check
    │   ├── request-logger.ts     # method/path/status/duration
    │   ├── error-handler.ts      # central error → JSON
    │   └── not-found-handler.ts  # catch-all 404
    └── routes/
        ├── health.ts
        ├── projects.ts
        └── tasks.ts
```

## How to run

```bash
npm install

# Set the token (required — requests without it get 401)
export API_TOKEN="my-secret"

# Development with hot-reload
npm run dev

# Production
npm run build && npm start
```

## Quick smoke-test

```bash
TOKEN="my-secret"

# Health (no auth needed)
curl localhost:3000/api/v1/health

# Create a project
curl -s -X POST localhost:3000/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sprint 42"}' | jq .

# List projects
curl -s localhost:3000/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" | jq .

# Create a task (use the project id from above)
PID="<project-id>"
curl -s -X POST "localhost:3000/api/v1/projects/$PID/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Write docs","assignee":"alice"}' | jq .

# List tasks with filter + pagination
curl -s "localhost:3000/api/v1/projects/$PID/tasks?status=todo&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Partial update
TID="<task-id>"
curl -s -X PATCH "localhost:3000/api/v1/projects/$PID/tasks/$TID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}' | jq .
```

### Key design decisions

| Concern | Choice | Rationale |
|---|---|---|
| **Storage** | `Store` interface + `MemoryStore` | Swap to Postgres/DynamoDB by implementing the interface; nothing else changes |
| **Validation** | Zod with `.strict()` | Rejects unknown fields, gives structured error messages, infers TS types |
| **Auth** | Middleware that runs *after* `/health` is mounted | Health checks stay public (useful for load balancers) |
| **Error shape** | Single `errorHandler` catches `AppError`, `ZodError`, and everything else | One place to maintain the `{ error: { code, message } }` contract |
| **CORS** | `cors()` package with permissive defaults | Handles `OPTIONS` preflight automatically |
| **Pagination** | Offset-based with `page` / `pageSize` / `total` / `totalPages` | Simple, stateless, easy to reason about for a task board |