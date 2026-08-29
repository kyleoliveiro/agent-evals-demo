<!-- model: openrouter/anthropic/claude-opus-4.6 | run: 3 | framework: Express -->

Here's the complete application. I'm choosing **Express** (mature, widely understood), **Zod** (runtime validation), **uuid** (ID generation), and **tsx** (dev runner) with a clean layered architecture.

## Project Structure

```
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts
│   ├── app.ts
│   ├── config.ts
│   ├── types.ts
│   ├── storage/
│   │   ├── interface.ts
│   │   └── memory.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── cors.ts
│   │   ├── logger.ts
│   │   ├── errorHandler.ts
│   │   └── notFound.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── projects.ts
│   │   └── tasks.ts
│   └── validation/
│       └── schemas.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
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
  },
  "engines": {
    "node": ">=18"
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

---

### `src/config.ts`

```typescript
export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  apiToken: process.env.API_TOKEN || "",
  corsOrigin: process.env.CORS_ORIGIN || "*",
} as const;

export function validateConfig(): void {
  if (!config.apiToken) {
    console.error("FATAL: API_TOKEN environment variable is required.");
    process.exit(1);
  }
}
```

### `src/types.ts`

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
  description: string | null;
  status: TaskStatus;
  assignee: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
```

---

### `src/storage/interface.ts`

```typescript
import type { Project, Task, TaskStatus } from "../types.js";

export interface TaskFilter {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  totalItems: number;
}

/**
 * Abstract storage contract – swap the implementation to move from
 * in-memory to Postgres, Redis, etc. without touching route handlers.
 */
export interface IStorage {
  // ── Projects ──────────────────────────────────────────────
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(name: string): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;

  // ── Tasks ─────────────────────────────────────────────────
  listTasks(projectId: string, filter: TaskFilter): Promise<PaginatedResult<Task>>;
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  createTask(
    projectId: string,
    data: { title: string; description?: string; assignee?: string },
  ): Promise<Task>;
  updateTask(
    projectId: string,
    taskId: string,
    data: Partial<Pick<Task, "title" | "description" | "status" | "assignee">>,
  ): Promise<Task | undefined>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

### `src/storage/memory.ts`

```typescript
import { v4 as uuidv4 } from "uuid";
import type { Project, Task } from "../types.js";
import type { IStorage, PaginatedResult, TaskFilter } from "./interface.js";

export class MemoryStorage implements IStorage {
  private projects: Map<string, Project> = new Map();
  private tasks: Map<string, Task> = new Map(); // keyed by task.id

  // ── Projects ──────────────────────────────────────────────

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async createProject(name: string): Promise<Project> {
    const project: Project = {
      id: uuidv4(),
      name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  async deleteProject(id: string): Promise<boolean> {
    if (!this.projects.has(id)) return false;
    this.projects.delete(id);
    // Cascade-delete tasks belonging to this project
    for (const [taskId, task] of this.tasks) {
      if (task.projectId === id) {
        this.tasks.delete(taskId);
      }
    }
    return true;
  }

  // ── Tasks ─────────────────────────────────────────────────

  async listTasks(projectId: string, filter: TaskFilter): Promise<PaginatedResult<Task>> {
    let items = [...this.tasks.values()]
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filter.status) {
      items = items.filter((t) => t.status === filter.status);
    }

    const totalItems = items.length;
    const start = (filter.page - 1) * filter.pageSize;
    items = items.slice(start, start + filter.pageSize);

    return { items, totalItems };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (task && task.projectId === projectId) return task;
    return undefined;
  }

  async createTask(
    projectId: string,
    data: { title: string; description?: string; assignee?: string },
  ): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      projectId,
      title: data.title,
      description: data.description ?? null,
      status: "todo",
      assignee: data.assignee ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    data: Partial<Pick<Task, "title" | "description" | "status" | "assignee">>,
  ): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return undefined;

    if (data.title !== undefined) task.title = data.title;
    if (data.description !== undefined) task.description = data.description;
    if (data.status !== undefined) task.status = data.status;
    if (data.assignee !== undefined) task.assignee = data.assignee;
    task.updatedAt = new Date().toISOString();

    return task;
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return false;
    this.tasks.delete(taskId);
    return true;
  }
}
```

---

### `src/validation/schemas.ts`

```typescript
import { z } from "zod";

// ── Project schemas ─────────────────────────────────────────

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, "Project name is required").max(200),
  })
  .strict();

// ── Task schemas ────────────────────────────────────────────

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Task title is required").max(500),
    description: z.string().max(5000).optional(),
    assignee: z.string().max(200).optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Task title must not be empty").max(500).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    assignee: z.string().max(200).nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Request body must contain at least one field to update",
  });

// ── Query schemas ───────────────────────────────────────────

export const taskListQuerySchema = z.object({
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  page: z
    .string()
    .optional()
    .default("1")
    .transform(Number)
    .pipe(z.number().int().min(1)),
  pageSize: z
    .string()
    .optional()
    .default("20")
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
});
```

---

### `src/middleware/auth.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health endpoint
  if (req.path === "/api/v1/health") {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or malformed Authorization header" },
    });
    return;
  }

  const token = header.slice(7);
  if (token !== config.apiToken) {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid bearer token" },
    });
    return;
  }

  next();
}
```

### `src/middleware/cors.ts`

```typescript
import cors from "cors";
import { config } from "../config.js";

export const corsMiddleware = cors({
  origin: config.corsOrigin,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["X-Request-Id"],
  credentials: true,
  maxAge: 86400,
});
```

### `src/middleware/logger.ts`

```typescript
import type { Request, Response, NextFunction } from "express";

export function loggerMiddleware(req: Request, res: Response, next: NextFunction): void {
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
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
}

/**
 * Global error handler – catches thrown errors from route handlers
 * and async wrappers and returns a uniform JSON envelope.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: formatZodError(err) },
    });
    return;
  }

  if (err instanceof SyntaxError && "body" in err) {
    // Express JSON parse error
    res.status(400).json({
      error: { code: "INVALID_JSON", message: "Request body contains invalid JSON" },
    });
    return;
  }

  console.error("[unhandled error]", err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  });
}
```

### `src/middleware/notFound.ts`

```typescript
import type { Request, Response } from "express";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "The requested resource does not exist" },
  });
}
```

---

### `src/routes/health.ts`

```typescript
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true });
});

export default router;
```

### `src/routes/projects.ts`

```typescript
import { Router } from "express";
import type { IStorage } from "../storage/interface.js";
import { createProjectSchema } from "../validation/schemas.js";

export function projectRoutes(storage: IStorage): Router {
  const router = Router();

  // List all projects
  router.get("/", async (_req, res, next) => {
    try {
      const projects = await storage.listProjects();
      res.json({ data: projects });
    } catch (err) {
      next(err);
    }
  });

  // Create project
  router.post("/", async (req, res, next) => {
    try {
      const body = createProjectSchema.parse(req.body);
      const project = await storage.createProject(body.name);
      res.status(201).json({ data: project });
    } catch (err) {
      next(err);
    }
  });

  // Get one project
  router.get("/:projectId", async (req, res, next) => {
    try {
      const project = await storage.getProject(req.params.projectId);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${req.params.projectId}' not found` },
        });
        return;
      }
      res.json({ data: project });
    } catch (err) {
      next(err);
    }
  });

  // Delete project (cascades tasks)
  router.delete("/:projectId", async (req, res, next) => {
    try {
      const deleted = await storage.deleteProject(req.params.projectId);
      if (!deleted) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${req.params.projectId}' not found` },
        });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Reject unsupported methods on collection
  router.all("/", (_req, res) => {
    res.status(405).json({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed on this resource" },
    });
  });

  // Reject unsupported methods on single resource
  router.all("/:projectId", (_req, res) => {
    res.status(405).json({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed on this resource" },
    });
  });

  return router;
}
```

### `src/routes/tasks.ts`

```typescript
import { Router } from "express";
import type { IStorage } from "../storage/interface.js";
import {
  createTaskSchema,
  updateTaskSchema,
  taskListQuerySchema,
} from "../validation/schemas.js";
import type { PaginatedResponse, Task } from "../types.js";

export function taskRoutes(storage: IStorage): Router {
  // mergeParams so we can read :projectId from the parent router
  const router = Router({ mergeParams: true });

  // Helper: ensure the parent project exists before any task operation
  async function requireProject(projectId: string): Promise<boolean> {
    return (await storage.getProject(projectId)) !== undefined;
  }

  // List tasks (with optional status filter + pagination)
  router.get("/", async (req, res, next) => {
    try {
      const { projectId } = req.params;
      if (!(await requireProject(projectId))) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectId}' not found` },
        });
        return;
      }

      const query = taskListQuerySchema.parse(req.query);
      const result = await storage.listTasks(projectId, {
        status: query.status,
        page: query.page,
        pageSize: query.pageSize,
      });

      const response: PaginatedResponse<Task> = {
        data: result.items,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalItems: result.totalItems,
          totalPages: Math.ceil(result.totalItems / query.pageSize),
        },
      };

      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  // Create task
  router.post("/", async (req, res, next) => {
    try {
      const { projectId } = req.params;
      if (!(await requireProject(projectId))) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectId}' not found` },
        });
        return;
      }

      const body = createTaskSchema.parse(req.body);
      const task = await storage.createTask(projectId, body);
      res.status(201).json({ data: task });
    } catch (err) {
      next(err);
    }
  });

  // Get one task
  router.get("/:taskId", async (req, res, next) => {
    try {
      const { projectId, taskId } = req.params;
      if (!(await requireProject(projectId))) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectId}' not found` },
        });
        return;
      }

      const task = await storage.getTask(projectId, taskId);
      if (!task) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Task '${taskId}' not found` },
        });
        return;
      }

      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  });

  // Partial update task
  router.patch("/:taskId", async (req, res, next) => {
    try {
      const { projectId, taskId } = req.params;
      if (!(await requireProject(projectId))) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectId}' not found` },
        });
        return;
      }

      const body = updateTaskSchema.parse(req.body);
      const task = await storage.updateTask(projectId, taskId, body);
      if (!task) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Task '${taskId}' not found` },
        });
        return;
      }

      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  });

  // Delete task
  router.delete("/:taskId", async (req, res, next) => {
    try {
      const { projectId, taskId } = req.params;
      if (!(await requireProject(projectId))) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectId}' not found` },
        });
        return;
      }

      const deleted = await storage.deleteTask(projectId, taskId);
      if (!deleted) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Task '${taskId}' not found` },
        });
        return;
      }

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Method-not-allowed catch-alls
  router.all("/", (_req, res) => {
    res.status(405).json({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed on this resource" },
    });
  });

  router.all("/:taskId", (_req, res) => {
    res.status(405).json({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed on this resource" },
    });
  });

  return router;
}
```

---

### `src/app.ts`

```typescript
import express from "express";
import { corsMiddleware } from "./middleware/cors.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFound.js";
import healthRouter from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { taskRoutes } from "./routes/tasks.js";
import type { IStorage } from "./storage/interface.js";

export function createApp(storage: IStorage): express.Application {
  const app = express();

  // ── Global middleware ─────────────────────────────────────
  app.use(corsMiddleware);
  app.use(express.json());
  app.use(loggerMiddleware);
  app.use(authMiddleware);

  // ── Routes ────────────────────────────────────────────────
  const v1 = express.Router();
  v1.use("/health", healthRouter);
  v1.use("/projects", projectRoutes(storage));
  v1.use("/projects/:projectId/tasks", taskRoutes(storage));

  app.use("/api/v1", v1);

  // ── Fallbacks ─────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
```

### `src/main.ts`

```typescript
import { createApp } from "./app.js";
import { config, validateConfig } from "./config.js";
import { MemoryStorage } from "./storage/memory.js";

validateConfig();

const storage = new MemoryStorage();
const app = createApp(storage);

app.listen(config.port, () => {
  console.log(`🚀  Task Board API listening on http://localhost:${config.port}/api/v1`);
  console.log(`    Environment: ${process.env.NODE_ENV ?? "development"}`);
});
```

---

## How to run

```bash
# Install dependencies
npm install

# Development (hot-reload)
API_TOKEN=my-secret-token npm run dev

# Production build
npm run build
API_TOKEN=my-secret-token node dist/main.js
```

## Quick smoke test

```bash
TOKEN="my-secret-token"
BASE="http://localhost:3000/api/v1"

# Health (no auth needed)
curl $BASE/health

# Create a project
curl -s -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sprint 42"}' | jq .

# Grab the project ID and create some tasks
PID=$(curl -s -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo"}' | jq -r .data.id)

curl -s -X POST $BASE/projects/$PID/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Design API","assignee":"Alice"}' | jq .

curl -s -X POST $BASE/projects/$PID/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Implement API","description":"Express + TS"}' | jq .

# List tasks with pagination
curl -s "$BASE/projects/$PID/tasks?page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Filter by status
curl -s "$BASE/projects/$PID/tasks?status=todo" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 401 – bad token
curl -s $BASE/projects -H "Authorization: Bearer wrong" | jq .

# 400 – validation error
curl -s -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# 404 – unknown route
curl -s $BASE/nope -H "Authorization: Bearer $TOKEN" | jq .
```

---

### Key design decisions

| Concern | Choice | Rationale |
|---|---|---|
| **Storage abstraction** | `IStorage` interface in its own file | Any route handler receives the interface; swap `MemoryStorage` for a Postgres/Mongo impl by changing one line in `main.ts` |
| **Validation** | Zod with `.strict()` | Rejects unknown fields, gives precise error paths, zero codegen |
| **Error shape** | Single `{ error: { code, message } }` envelope everywhere | Consistent for clients; `errorHandler` middleware catches Zod errors and JSON parse errors automatically |
| **Auth** | Middleware comparing against `API_TOKEN` env var | Simple bearer-token check; easy to replace with JWT verification later |
| **CORS** | `cors` package with configurable origin | Handles preflight `OPTIONS` requests automatically |
| **405 handling** | `router.all()` catch-alls after defined methods | Returns the standard error envelope instead of Express's default HTML |
| **Pagination** | Query-string validated by Zod with defaults (page=1, pageSize=20, max 100) | Prevents unbounded list responses |