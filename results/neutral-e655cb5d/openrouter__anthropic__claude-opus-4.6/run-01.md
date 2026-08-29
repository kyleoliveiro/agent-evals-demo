<!-- model: openrouter/anthropic/claude-opus-4.6 | run: 1 | framework: Express -->

Here's the complete application. I'm choosing **Express** (most mature Node.js framework), **Zod** (runtime validation), **uuid** (ID generation), and **tsx** (dev runner) with a clean layered architecture.

## Project Structure

```
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── config.ts
│   ├── models/
│   │   ├── project.ts
│   │   └── task.ts
│   ├── storage/
│   │   ├── interfaces.ts
│   │   └── memory.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── logger.ts
│   │   ├── errorHandler.ts
│   │   └── cors.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── projects.ts
│   │   └── tasks.ts
│   ├── validators/
│   │   ├── project.ts
│   │   └── task.ts
│   └── helpers/
│       └── errors.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board",
  "private": true,
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.21.0",
    "uuid": "^10.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
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
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `src/config.ts`

```typescript
export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  apiToken: process.env.API_TOKEN || "",
} as const;

export function validateConfig(): void {
  if (!config.apiToken) {
    console.error("FATAL: API_TOKEN environment variable is required.");
    process.exit(1);
  }
}
```

### `src/index.ts`

```typescript
import { validateConfig, config } from "./config";
import { createApp } from "./app";

validateConfig();

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`✅ Task Board API listening on http://localhost:${config.port}`);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`\n${signal} received – shutting down gracefully…`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forcefully shutting down.");
    process.exit(1);
  }, 10_000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

### `src/app.ts`

```typescript
import express, { Request, Response } from "express";
import { corsMiddleware } from "./middleware/cors";
import { requestLogger } from "./middleware/logger";
import { authMiddleware } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { healthRouter } from "./routes/health";
import { projectsRouter } from "./routes/projects";
import { tasksRouter } from "./routes/tasks";

export function createApp(): express.Application {
  const app = express();

  // ── Global middleware ──────────────────────────────────────────────
  app.use(corsMiddleware);
  app.use(express.json({ limit: "100kb" }));
  app.use(requestLogger);

  // ── Routes ─────────────────────────────────────────────────────────
  const v1 = express.Router();

  // Health is public
  v1.use("/health", healthRouter);

  // Everything else requires auth
  v1.use(authMiddleware);
  v1.use("/projects", projectsRouter);
  v1.use("/projects", tasksRouter);

  app.use("/api/v1", v1);

  // ── Fallthrough ────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
```

---

### `src/models/project.ts`

```typescript
export interface Project {
  id: string;
  name: string;
  createdAt: string; // ISO-8601
}
```

### `src/models/task.ts`

```typescript
export type TaskStatus = "todo" | "in_progress" | "done";

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

---

### `src/helpers/errors.ts`

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

export function notFound(resource: string, id: string): AppError {
  return new AppError(404, "NOT_FOUND", `${resource} '${id}' not found.`);
}

export function validationError(message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message);
}

export function formatError(code: string, message: string) {
  return { error: { code, message } };
}
```

---

### `src/storage/interfaces.ts`

```typescript
import { Project } from "../models/project";
import { Task, TaskStatus } from "../models/task";

export interface TaskListFilter {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface IProjectStore {
  findAll(): Project[];
  findById(id: string): Project | undefined;
  create(project: Project): Project;
  delete(id: string): boolean;
}

export interface ITaskStore {
  findByProject(projectId: string, filter: TaskListFilter): PaginatedResult<Task>;
  findById(projectId: string, taskId: string): Task | undefined;
  create(task: Task): Task;
  update(projectId: string, taskId: string, fields: Partial<Task>): Task | undefined;
  delete(projectId: string, taskId: string): boolean;
  deleteByProject(projectId: string): number;
}
```

### `src/storage/memory.ts`

```typescript
import { Project } from "../models/project";
import { Task } from "../models/task";
import {
  IProjectStore,
  ITaskStore,
  TaskListFilter,
  PaginatedResult,
} from "./interfaces";

// ── In-memory Project store ──────────────────────────────────────────

export class MemoryProjectStore implements IProjectStore {
  private projects: Map<string, Project> = new Map();

  findAll(): Project[] {
    return [...this.projects.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  findById(id: string): Project | undefined {
    return this.projects.get(id);
  }

  create(project: Project): Project {
    this.projects.set(project.id, project);
    return project;
  }

  delete(id: string): boolean {
    return this.projects.delete(id);
  }
}

// ── In-memory Task store ─────────────────────────────────────────────

export class MemoryTaskStore implements ITaskStore {
  private tasks: Map<string, Task> = new Map();

  findByProject(projectId: string, filter: TaskListFilter): PaginatedResult<Task> {
    let items = [...this.tasks.values()]
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filter.status) {
      items = items.filter((t) => t.status === filter.status);
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / filter.pageSize));
    const start = (filter.page - 1) * filter.pageSize;
    const data = items.slice(start, start + filter.pageSize);

    return { data, total, page: filter.page, pageSize: filter.pageSize, totalPages };
  }

  findById(projectId: string, taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task && task.projectId === projectId ? task : undefined;
  }

  create(task: Task): Task {
    this.tasks.set(task.id, task);
    return task;
  }

  update(projectId: string, taskId: string, fields: Partial<Task>): Task | undefined {
    const task = this.findById(projectId, taskId);
    if (!task) return undefined;

    const updated: Task = {
      ...task,
      ...fields,
      id: task.id,               // prevent overwrite
      projectId: task.projectId, // prevent overwrite
      createdAt: task.createdAt, // prevent overwrite
      updatedAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, updated);
    return updated;
  }

  delete(projectId: string, taskId: string): boolean {
    const task = this.findById(projectId, taskId);
    if (!task) return false;
    return this.tasks.delete(taskId);
  }

  deleteByProject(projectId: string): number {
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

// ── Singleton instances (swap these to change storage) ───────────────

export const projectStore: IProjectStore = new MemoryProjectStore();
export const taskStore: ITaskStore = new MemoryTaskStore();
```

---

### `src/validators/project.ts`

```typescript
import { z } from "zod";

export const CreateProjectSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(200),
  })
  .strict();

export type CreateProjectBody = z.infer<typeof CreateProjectSchema>;
```

### `src/validators/task.ts`

```typescript
import { z } from "zod";

const TASK_STATUS = z.enum(["todo", "in_progress", "done"]);

export const CreateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(500),
    description: z.string().trim().max(5000).optional(),
    status: TASK_STATUS.optional().default("todo"),
    assignee: z.string().trim().max(200).optional(),
  })
  .strict();

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "title must not be empty").max(500).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    status: TASK_STATUS.optional(),
    assignee: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Request body must contain at least one updatable field.",
  });

export const TaskListQuerySchema = z.object({
  status: TASK_STATUS.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateTaskBody = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskBody = z.infer<typeof UpdateTaskSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
```

---

### `src/middleware/cors.ts`

```typescript
import { Request, Response, NextFunction } from "express";

const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Accept",
  "Origin",
  "X-Requested-With",
].join(", ");

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin || "*";

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
```

### `src/middleware/auth.ts`

```typescript
import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { formatError } from "../helpers/errors";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json(formatError("UNAUTHORIZED", "Missing or malformed Authorization header."));
    return;
  }

  const token = header.slice(7);

  if (token !== config.apiToken) {
    res.status(401).json(formatError("UNAUTHORIZED", "Invalid bearer token."));
    return;
  }

  next();
}
```

### `src/middleware/logger.ts`

```typescript
import { Request, Response, NextFunction } from "express";

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

### `src/middleware/errorHandler.ts`

```typescript
import { Request, Response, NextFunction } from "express";
import { AppError, formatError } from "../helpers/errors";

export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json(formatError("NOT_FOUND", `Route ${req.method} ${req.path} not found.`));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json(formatError(err.code, err.message));
    return;
  }

  // JSON parse errors from express.json()
  if (
    err &&
    typeof err === "object" &&
    "type" in err &&
    (err as Record<string, unknown>).type === "entity.parse.failed"
  ) {
    res.status(400).json(formatError("BAD_REQUEST", "Malformed JSON in request body."));
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json(formatError("INTERNAL_ERROR", "An unexpected error occurred."));
}
```

---

### `src/routes/health.ts`

```typescript
import { Router, Request, Response } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Method-not-allowed for anything else on /health
healthRouter.all("/", (_req: Request, res: Response) => {
  res.status(405).json({
    error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is allowed on /health." },
  });
});
```

### `src/routes/projects.ts`

```typescript
import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuid } from "uuid";
import { projectStore, taskStore } from "../storage/memory";
import { CreateProjectSchema } from "../validators/project";
import { notFound, validationError, formatError } from "../helpers/errors";

export const projectsRouter = Router();

// ── List projects ────────────────────────────────────────────────────
projectsRouter.get("/", (_req: Request, res: Response) => {
  res.json({ data: projectStore.findAll() });
});

// ── Create project ───────────────────────────────────────────────────
projectsRouter.post("/", (req: Request, res: Response, next: NextFunction) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return next(validationError(msg));
  }

  const project = {
    id: uuid(),
    name: parsed.data.name,
    createdAt: new Date().toISOString(),
  };

  projectStore.create(project);
  res.status(201).json({ data: project });
});

// ── Get one project ──────────────────────────────────────────────────
projectsRouter.get("/:projectId", (req: Request, res: Response, next: NextFunction) => {
  const project = projectStore.findById(req.params.projectId);
  if (!project) return next(notFound("Project", req.params.projectId));
  res.json({ data: project });
});

// ── Delete project (+ its tasks) ────────────────────────────────────
projectsRouter.delete("/:projectId", (req: Request, res: Response, next: NextFunction) => {
  const existed = projectStore.delete(req.params.projectId);
  if (!existed) return next(notFound("Project", req.params.projectId));
  taskStore.deleteByProject(req.params.projectId);
  res.status(204).end();
});

// ── Method not allowed catch-all ─────────────────────────────────────
projectsRouter.all("/", (_req, res) => {
  res.status(405).json(formatError("METHOD_NOT_ALLOWED", "Method not allowed on /projects."));
});

projectsRouter.all("/:projectId", (_req, res) => {
  res
    .status(405)
    .json(formatError("METHOD_NOT_ALLOWED", "Method not allowed on /projects/:projectId."));
});
```

### `src/routes/tasks.ts`

```typescript
import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuid } from "uuid";
import { projectStore, taskStore } from "../storage/memory";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskListQuerySchema,
} from "../validators/task";
import { notFound, validationError, formatError } from "../helpers/errors";

export const tasksRouter = Router();

// ── Helper: ensure parent project exists ─────────────────────────────
function requireProject(req: Request, _res: Response, next: NextFunction): void {
  const project = projectStore.findById(req.params.projectId);
  if (!project) return next(notFound("Project", req.params.projectId));
  next();
}

// ── List tasks (with optional status filter + pagination) ────────────
tasksRouter.get(
  "/:projectId/tasks",
  requireProject,
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = TaskListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return next(validationError(msg));
    }

    const result = taskStore.findByProject(req.params.projectId, parsed.data);
    res.json(result);
  },
);

// ── Create task ──────────────────────────────────────────────────────
tasksRouter.post(
  "/:projectId/tasks",
  requireProject,
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join("; ");
      return next(validationError(msg));
    }

    const now = new Date().toISOString();
    const task = {
      id: uuid(),
      projectId: req.params.projectId,
      title: parsed.data.title,
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      status: parsed.data.status,
      ...(parsed.data.assignee !== undefined && { assignee: parsed.data.assignee }),
      createdAt: now,
      updatedAt: now,
    };

    taskStore.create(task);
    res.status(201).json({ data: task });
  },
);

// ── Get one task ─────────────────────────────────────────────────────
tasksRouter.get(
  "/:projectId/tasks/:taskId",
  requireProject,
  (req: Request, res: Response, next: NextFunction) => {
    const task = taskStore.findById(req.params.projectId, req.params.taskId);
    if (!task) return next(notFound("Task", req.params.taskId));
    res.json({ data: task });
  },
);

// ── Partial update task ──────────────────────────────────────────────
tasksRouter.patch(
  "/:projectId/tasks/:taskId",
  requireProject,
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = UpdateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join("; ");
      return next(validationError(msg));
    }

    // Convert null → undefined so the field is cleared in storage
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      fields[key] = value === null ? undefined : value;
    }

    const updated = taskStore.update(req.params.projectId, req.params.taskId, fields);
    if (!updated) return next(notFound("Task", req.params.taskId));
    res.json({ data: updated });
  },
);

// ── Delete task ──────────────────────────────────────────────────────
tasksRouter.delete(
  "/:projectId/tasks/:taskId",
  requireProject,
  (req: Request, res: Response, next: NextFunction) => {
    const deleted = taskStore.delete(req.params.projectId, req.params.taskId);
    if (!deleted) return next(notFound("Task", req.params.taskId));
    res.status(204).end();
  },
);

// ── Method not allowed catch-alls ────────────────────────────────────
tasksRouter.all("/:projectId/tasks", (_req, res) => {
  res.status(405).json(formatError("METHOD_NOT_ALLOWED", "Method not allowed."));
});

tasksRouter.all("/:projectId/tasks/:taskId", (_req, res) => {
  res.status(405).json(formatError("METHOD_NOT_ALLOWED", "Method not allowed."));
});
```

---

### `.env.example`

```bash
# Copy to .env and fill in values
API_TOKEN=my-secret-token-change-me
PORT=3000
```

---

## How to run

```bash
# Install dependencies
npm install

# Start in development mode (with hot reload)
API_TOKEN=supersecret npm run dev

# -- or build & run production --
npm run build
API_TOKEN=supersecret node dist/index.js
```

## Quick smoke test

```bash
TOKEN="supersecret"
BASE="http://localhost:3000/api/v1"

# Health (no auth required)
curl $BASE/health

# Create a project
curl -s -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sprint 42"}' | jq .

# List projects
curl -s $BASE/projects -H "Authorization: Bearer $TOKEN" | jq .

# Create tasks (use the project id from above)
PID="<project-id>"
curl -s -X POST "$BASE/projects/$PID/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Write docs","assignee":"Alice"}' | jq .

# List tasks with filter + pagination
curl -s "$BASE/projects/$PID/tasks?status=todo&page=1&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Partial update
TID="<task-id>"
curl -s -X PATCH "$BASE/projects/$PID/tasks/$TID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}' | jq .
```

---

### Key design decisions

| Concern | Decision |
|---|---|
| **Storage abstraction** | `IProjectStore` / `ITaskStore` interfaces in `storage/interfaces.ts` — swap `memory.ts` for Postgres/Mongo/Redis by implementing the same interfaces and changing the singleton exports. |
| **Validation** | Zod schemas with `.strict()` reject unknown keys → 400. Coercion on query params handles string→number for pagination. |
| **Auth** | Simple bearer-token check scoped to everything *except* `/health`. The middleware runs at the v1 router level after health is mounted. |
| **CORS** | Hand-rolled (avoids a dependency). Handles preflight `OPTIONS` with 204, sets `Access-Control-*` on every response. |
| **Error shape** | All errors (validation, 404, 405, 500, unknown routes, malformed JSON) funnel through `formatError()` producing `{ error: { code, message } }`. |
| **Logging** | Listens on `res.finish` to capture the final status code and duration. |
| **Pagination** | Defaults to `page=1, pageSize=20`; max `pageSize=100`. Response includes `total`, `totalPages` metadata alongside `data`. |
| **Nullable fields on PATCH** | Sending `"assignee": null` clears the field; omitting it leaves it unchanged. |