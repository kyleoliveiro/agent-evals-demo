<!-- model: openrouter/anthropic/claude-sonnet-4.6 | run: 3 | framework: Express -->

Here is the complete implementation. The project is organized into small, focused modules, uses Zod for validation, keeps all storage behind a clean interface, and covers every cross-cutting requirement.

---

### Project layout

```
team-task-board-api/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── src/
    ├── index.ts
    ├── app.ts
    ├── config.ts
    ├── types/
    │   └── models.ts
    ├── errors/
    │   └── AppError.ts
    ├── store/
    │   ├── IStore.ts
    │   ├── InMemoryStore.ts
    │   └── index.ts
    ├── middleware/
    │   ├── asyncHandler.ts
    │   ├── auth.ts
    │   ├── errorHandler.ts
    │   ├── notFound.ts
    │   └── requestLogger.ts
    ├── validators/
    │   ├── project.validator.ts
    │   └── task.validator.ts
    └── routes/
        ├── health.router.ts
        ├── projects.router.ts
        └── tasks.router.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only --exit-child src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "uuid": "^9.0.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/uuid": "^9.0.8",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.4.5"
  }
}
```

---

### `tsconfig.json`

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
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `.env.example`

```dotenv
# Required – the shared secret clients must send as: Authorization: Bearer <token>
API_TOKEN=change-me-to-a-long-random-secret

# Optional
PORT=3000
NODE_ENV=development

# Allowed CORS origin(s). Use * for development or a comma-separated list for production.
# Example: https://app.example.com,https://admin.example.com
CORS_ORIGIN=*
```

---

### `README.md`

```markdown
# Team Task Board API

A production-ready REST API built with Express + TypeScript.

## Quick start

```bash
cp .env.example .env          # fill in API_TOKEN at minimum
npm install
npm run dev                   # development (hot-reload)
npm run build && npm start    # production
```

## Authentication

Every endpoint except `GET /api/v1/health` requires:

```
Authorization: Bearer <API_TOKEN>
```

## Pagination

`GET /projects/:projectId/tasks` accepts:

| Query param | Default | Notes                          |
|-------------|---------|--------------------------------|
| `status`    | –       | `todo` \| `in_progress` \| `done` |
| `page`      | 1       | 1-based                        |
| `pageSize`  | 20      | max 100                        |

## Error shape

```json
{ "error": { "code": "NOT_FOUND", "message": "Project not found" } }
```

## Swapping the storage layer

Implement `src/store/IStore.ts` and replace the export in `src/store/index.ts`.
```
```

---

### `src/config.ts`

```typescript
import { z } from "zod";

const envSchema = z.object({
  PORT: z
    .string()
    .default("3000")
    .transform((v) => parseInt(v, 10))
    .refine((n) => !Number.isNaN(n) && n > 0, { message: "PORT must be a positive integer" }),
  API_TOKEN: z.string().min(1, "API_TOKEN must be a non-empty string"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().default("*"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("❌  Invalid environment variables:\n");
  for (const [field, messages] of Object.entries(result.error.flatten().fieldErrors)) {
    console.error(`  ${field}: ${(messages as string[]).join(", ")}`);
  }
  process.exit(1);
}

export const config = {
  port: result.data.PORT,
  apiToken: result.data.API_TOKEN,
  nodeEnv: result.data.NODE_ENV,
  corsOrigin: result.data.CORS_ORIGIN,
  isProd: result.data.NODE_ENV === "production",
} as const;
```

---

### `src/types/models.ts`

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
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}
```

---

### `src/errors/AppError.ts`

```typescript
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    // Maintain proper prototype chain in ES5 targets
    Object.setPrototypeOf(this, new.target.prototype);
  }

  // ── Factories ────────────────────────────────────────────────────────────

  static badRequest(message: string): AppError {
    return new AppError(400, "BAD_REQUEST", message);
  }

  static unauthorized(message = "Missing or invalid Authorization header"): AppError {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static notFound(resource: string): AppError {
    return new AppError(404, "NOT_FOUND", `${resource} not found`);
  }

  static methodNotAllowed(): AppError {
    return new AppError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  static internal(message = "An unexpected error occurred"): AppError {
    return new AppError(500, "INTERNAL_SERVER_ERROR", message);
  }
}
```

---

### `src/store/IStore.ts`

```typescript
import type { Project, Task, TaskStatus } from "../types/models";

export interface ListTasksOptions {
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

/**
 * Storage interface – swap this implementation for a database-backed one
 * without touching any route or middleware code.
 */
export interface IStore {
  // ── Projects ────────────────────────────────────────────────────────────
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(project: Project): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;

  // ── Tasks ───────────────────────────────────────────────────────────────
  listTasks(projectId: string, opts: ListTasksOptions): Promise<PaginatedResult<Task>>;
  getTask(projectId: string, taskId: string): Promise<Task | null>;
  createTask(task: Task): Promise<Task>;
  updateTask(
    projectId: string,
    taskId: string,
    updates: Partial<Omit<Task, "id" | "projectId" | "createdAt">>
  ): Promise<Task | null>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
  deleteTasksByProject(projectId: string): Promise<void>;
}
```

---

### `src/store/InMemoryStore.ts`

```typescript
import type { IStore, ListTasksOptions, PaginatedResult } from "./IStore";
import type { Project, Task } from "../types/models";

export class InMemoryStore implements IStore {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>(); // keyed by task id

  // ── Projects ─────────────────────────────────────────────────────────────

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
  }

  async getProject(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async createProject(project: Project): Promise<Project> {
    this.projects.set(project.id, { ...project });
    return { ...project };
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.projects.delete(id);
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async listTasks(projectId: string, opts: ListTasksOptions): Promise<PaginatedResult<Task>> {
    const { status, page, pageSize } = opts;

    let filtered = [...this.tasks.values()].filter((t) => t.projectId === projectId);

    if (status !== undefined) {
      filtered = filtered.filter((t) => t.status === status);
    }

    filtered.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const data = filtered.slice(start, start + pageSize).map((t) => ({ ...t }));

    return { data, total, page, pageSize, totalPages };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return null;
    return { ...task };
  }

  async createTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, { ...task });
    return { ...task };
  }

  async updateTask(
    projectId: string,
    taskId: string,
    updates: Partial<Omit<Task, "id" | "projectId" | "createdAt">>
  ): Promise<Task | null> {
    const existing = this.tasks.get(taskId);
    if (!existing || existing.projectId !== projectId) return null;

    const updated: Task = { ...existing, ...updates };
    this.tasks.set(taskId, updated);
    return { ...updated };
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return false;
    return this.tasks.delete(taskId);
  }

  async deleteTasksByProject(projectId: string): Promise<void> {
    for (const [id, task] of this.tasks) {
      if (task.projectId === projectId) this.tasks.delete(id);
    }
  }
}
```

---

### `src/store/index.ts`

```typescript
import { InMemoryStore } from "./InMemoryStore";
import type { IStore } from "./IStore";

/**
 * Singleton store instance.
 * Replace `InMemoryStore` with any class that implements `IStore`
 * (e.g. a PostgreSQL-backed store) and nothing else needs to change.
 */
export const store: IStore = new InMemoryStore();
```

---

### `src/middleware/asyncHandler.ts`

```typescript
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async route handler so that any rejected promise is forwarded
 * to Express's next(err) error pipeline.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
```

---

### `src/middleware/requestLogger.ts`

```typescript
import type { Request, Response, NextFunction } from "express";

function colorStatus(status: number): string {
  if (status >= 500) return `\x1b[31m${status}\x1b[0m`; // red
  if (status >= 400) return `\x1b[33m${status}\x1b[0m`; // yellow
  if (status >= 300) return `\x1b[36m${status}\x1b[0m`; // cyan
  return `\x1b[32m${status}\x1b[0m`;                    // green
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  const { method, originalUrl } = req;

  res.on("finish", () => {
    const duration = Date.now() - startedAt;
    const timestamp = new Date().toISOString();
    const status = res.statusCode;

    // In production you'd swap this for a structured JSON logger (pino, winston, etc.)
    process.stdout.write(
      `${timestamp}  ${method.padEnd(7)} ${originalUrl.padEnd(50)} ${colorStatus(status)}  ${duration}ms\n`
    );
  });

  next();
}
```

---

### `src/middleware/auth.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { AppError } from "../errors/AppError";

export function bearerAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(AppError.unauthorized());
  }

  const token = authHeader.slice(7); // strip "Bearer "

  if (token !== config.apiToken) {
    return next(AppError.unauthorized("Invalid token"));
  }

  next();
}
```

---

### `src/middleware/errorHandler.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError";
import { config } from "../config";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // ── Zod validation errors → 400 ─────────────────────────────────────────
  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten().fieldErrors,
      },
    };
    res.status(400).json(body);
    return;
  }

  // ── Known operational errors ─────────────────────────────────────────────
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: { code: err.code, message: err.message },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // ── Unexpected errors → 500 ──────────────────────────────────────────────
  if (!config.isProd && err instanceof Error) {
    console.error(err.stack);
  }

  const body: ErrorBody = {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: config.isProd ? "An unexpected error occurred" : String(err),
    },
  };
  res.status(500).json(body);
}
```

---

### `src/middleware/notFound.ts`

```typescript
import type { Request, Response } from "express";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource does not exist",
    },
  });
}
```

---

### `src/validators/project.validator.ts`

```typescript
import { z } from "zod";

export const createProjectSchema = z
  .object({
    name: z
      .string({ required_error: "name is required" })
      .min(1, "name must not be empty")
      .max(100, "name must be at most 100 characters")
      .trim(),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
```

---

### `src/validators/task.validator.ts`

```typescript
import { z } from "zod";

const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const createTaskSchema = z
  .object({
    title: z
      .string({ required_error: "title is required" })
      .min(1, "title must not be empty")
      .max(200, "title must be at most 200 characters")
      .trim(),
    description: z
      .string()
      .max(5000, "description must be at most 5 000 characters")
      .trim()
      .optional(),
    status: taskStatusSchema.default("todo"),
    assignee: z
      .string()
      .min(1, "assignee must not be empty")
      .max(100, "assignee must be at most 100 characters")
      .trim()
      .optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .min(1, "title must not be empty")
      .max(200, "title must be at most 200 characters")
      .trim()
      .optional(),
    description: z
      .string()
      .max(5000, "description must be at most 5 000 characters")
      .trim()
      .nullable() // null clears the field
      .optional(),
    status: taskStatusSchema.optional(),
    assignee: z
      .string()
      .min(1, "assignee must not be empty")
      .max(100, "assignee must be at most 100 characters")
      .trim()
      .nullable() // null clears the field
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Request body must contain at least one field to update",
  });

export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  page: z
    .string()
    .default("1")
    .transform((v) => parseInt(v, 10))
    .refine((n) => !Number.isNaN(n) && n >= 1, { message: "page must be a positive integer" }),
  pageSize: z
    .string()
    .default("20")
    .transform((v) => parseInt(v, 10))
    .refine((n) => !Number.isNaN(n) && n >= 1 && n <= 100, {
      message: "pageSize must be between 1 and 100",
    }),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
```

---

### `src/routes/health.router.ts`

```typescript
import { Router } from "express";
import type { Request, Response } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Every other method on this path → 405
healthRouter.all("/", (_req: Request, res: Response) => {
  res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
});
```

---

### `src/routes/tasks.router.ts`

```typescript
import { Router } from "express";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

import { store } from "../store";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../errors/AppError";
import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from "../validators/task.validator";
import type { Task } from "../types/models";

/**
 * Mounted at /api/v1/projects/:projectId/tasks
 * mergeParams: true lets us read req.params.projectId from the parent router.
 */
export const tasksRouter = Router({ mergeParams: true });

// ── Helper: assert the project exists ────────────────────────────────────────
async function requireProject(projectId: string): Promise<void> {
  const project = await store.getProject(projectId);
  if (!project) throw AppError.notFound("Project");
}

// ── GET /projects/:projectId/tasks ────────────────────────────────────────────
tasksRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    await requireProject(projectId);

    const query = listTasksQuerySchema.parse(req.query);
    const result = await store.listTasks(projectId, query);
    res.json(result);
  })
);

// ── POST /projects/:projectId/tasks ───────────────────────────────────────────
tasksRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    await requireProject(projectId);

    const body = createTaskSchema.parse(req.body);
    const now = new Date().toISOString();

    const task: Task = {
      id: uuidv4(),
      projectId,
      title: body.title,
      description: body.description,
      status: body.status,
      assignee: body.assignee,
      createdAt: now,
      updatedAt: now,
    };

    const created = await store.createTask(task);
    res.status(201).json(created);
  })
);

// ── GET /projects/:projectId/tasks/:taskId ────────────────────────────────────
tasksRouter.get(
  "/:taskId",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId, taskId } = req.params;
    await requireProject(projectId);

    const task = await store.getTask(projectId, taskId);
    if (!task) throw AppError.notFound("Task");

    res.json(task);
  })
);

// ── PATCH /projects/:projectId/tasks/:taskId ──────────────────────────────────
tasksRouter.patch(
  "/:taskId",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId, taskId } = req.params;
    await requireProject(projectId);

    const body = updateTaskSchema.parse(req.body);

    // Build a typed updates object; treat null as "clear the optional field"
    const updates: Partial<Omit<Task, "id" | "projectId" | "createdAt">> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.title !== undefined) updates.title = body.title;
    if (body.status !== undefined) updates.status = body.status;

    // null → remove the optional field (undefined in the stored object)
    if ("description" in body) updates.description = body.description ?? undefined;
    if ("assignee" in body) updates.assignee = body.assignee ?? undefined;

    const updated = await store.updateTask(projectId, taskId, updates);
    if (!updated) throw AppError.notFound("Task");

    res.json(updated);
  })
);

// ── DELETE /projects/:projectId/tasks/:taskId ─────────────────────────────────
tasksRouter.delete(
  "/:taskId",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId, taskId } = req.params;
    await requireProject(projectId);

    const deleted = await store.deleteTask(projectId, taskId);
    if (!deleted) throw AppError.notFound("Task");

    res.status(204).send();
  })
);

// ── 405 catch-alls ────────────────────────────────────────────────────────────
tasksRouter.all("/", (_req: Request, res: Response) => {
  res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
});

tasksRouter.all("/:taskId", (_req: Request, res: Response) => {
  res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
});
```

---

### `src/routes/projects.router.ts`

```typescript
import { Router } from "express";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

import { store } from "../store";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../errors/AppError";
import { createProjectSchema } from "../validators/project.validator";
import { tasksRouter } from "./tasks.router";

export const projectsRouter = Router();

// ── Mount task sub-router ─────────────────────────────────────────────────────
projectsRouter.use("/:projectId/tasks", tasksRouter);

// ── GET /projects ─────────────────────────────────────────────────────────────
projectsRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const projects = await store.listProjects();
    res.json(projects);
  })
);

// ── POST /projects ────────────────────────────────────────────────────────────
projectsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = createProjectSchema.parse(req.body);

    const project = await store.createProject({
      id: uuidv4(),
      name: body.name,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(project);
  })
);

// ── GET /projects/:projectId ──────────────────────────────────────────────────
projectsRouter.get(
  "/:projectId",
  asyncHandler(async (req: Request, res: Response) => {
    const project = await store.getProject(req.params.projectId);
    if (!project) throw AppError.notFound("Project");
    res.json(project);
  })
);

// ── DELETE /projects/:projectId ───────────────────────────────────────────────
projectsRouter.delete(
  "/:projectId",
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;

    const deleted = await store.deleteProject(projectId);
    if (!deleted) throw AppError.notFound("Project");

    // Cascade-delete all tasks that belong to this project
    await store.deleteTasksByProject(projectId);

    res.status(204).send();
  })
);

// ── 405 catch-alls ────────────────────────────────────────────────────────────
projectsRouter.all("/", (_req: Request, res: Response) => {
  res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
});

projectsRouter.all("/:projectId", (_req: Request, res: Response) => {
  res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
});
```

---

### `src/app.ts`

```typescript
import express from "express";
import cors from "cors";

import { config } from "./config";
import { requestLogger } from "./middleware/requestLogger";
import { bearerAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { healthRouter } from "./routes/health.router";
import { projectsRouter } from "./routes/projects.router";

export function createApp(): express.Application {
  const app = express();

  // ── Global middleware ────────────────────────────────────────────────────────

  // CORS – handles OPTIONS preflight automatically
  app.use(
    cors({
      origin: config.corsOrigin === "*" ? "*" : config.corsOrigin.split(",").map((s) => s.trim()),
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 86_400, // 24 h preflight cache
    })
  );

  app.use(express.json());
  app.use(requestLogger);

  // Disable the "X-Powered-By: Express" header
  app.disable("x-powered-by");

  // ── Routes ───────────────────────────────────────────────────────────────────

  // Health – no auth required
  app.use("/api/v1/health", healthRouter);

  // All other API routes require a valid Bearer token
  app.use("/api/v1/projects", bearerAuth, projectsRouter);

  // ── Catch-alls ───────────────────────────────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
```

---

### `src/index.ts`

```typescript
import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`\n🚀  Team Task Board API`);
  console.log(`   Environment : ${config.nodeEnv}`);
  console.log(`   Listening on: http://localhost:${config.port}/api/v1\n`);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`\n${signal} received. Closing HTTP server…`);
  server.close((err) => {
    if (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
    console.log("Server closed. Goodbye.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});
```

---

## How every requirement is satisfied

| Requirement | Where it's implemented |
|---|---|
| `GET /api/v1/health` returns `{ ok: true }` | `health.router.ts` |
| All other project/task CRUD endpoints | `projects.router.ts` + `tasks.router.ts` |
| `Authorization: Bearer <token>` on every route except `/health` | `app.ts` mounts `bearerAuth` only on `/api/v1/projects`; `health.router.ts` is mounted before it |
| 401 on bad/missing token | `auth.ts` → `AppError.unauthorized()` |
| CORS + preflight | `cors()` middleware in `app.ts` |
| Request logging (method, path, status, duration) | `requestLogger.ts` |
| Consistent JSON error shape `{ error: { code, message } }` | `errorHandler.ts` + `AppError.ts` |
| 400 for Zod validation failures (with field-level details) | `errorHandler.ts` ZodError branch |
| 404 for unknown routes and missing resources | `notFound.ts` + `AppError.notFound()` |
| 405 for wrong HTTP method on a known path | `.all()` catch-alls at the bottom of each router |
| 500 for unexpected errors (no stack leak in prod) | `errorHandler.ts` fallthrough branch |
| Optional `status` filter + `page`/`pageSize` pagination on task list | `task.validator.ts` + `InMemoryStore.listTasks()` |
| Cascade-delete tasks when a project is deleted | `projects.router.ts` DELETE handler |
| Storage behind a swappable interface | `IStore.ts` interface + `store/index.ts` singleton |
| `null` in PATCH clears optional fields (`description`, `assignee`) | `tasks.router.ts` PATCH handler |