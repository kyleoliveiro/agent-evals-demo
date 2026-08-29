<!-- model: openrouter/x-ai/grok-4.6 | run: 3 | framework: Express -->

A complete Express + TypeScript service with an in-memory store behind a `Store` interface, Zod validation, bearer auth, CORS, request logging, and consistent JSON errors.

---

**package.json**

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "REST API for a team task board",
  "main": "dist/index.js",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.2",
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

**tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"]
}
```

**.gitignore**

```
node_modules/
dist/
.env
*.log
.DS_Store
coverage/
```

**.env.example**

```
API_TOKEN=change-me-to-a-long-random-secret
PORT=3000
CORS_ORIGIN=*
```

**README.md**

```markdown
# Team Task Board API

Production-style REST API for projects and tasks. Storage is in-memory and
hidden behind a `Store` interface so it can be replaced with a database later.

## Requirements

- Node.js 20+
- `API_TOKEN` environment variable (required)

## Setup

```bash
npm install
cp .env.example .env   # then set API_TOKEN
export API_TOKEN=change-me-to-a-long-random-secret
npm run dev            # http://localhost:3000
```

Production:

```bash
export API_TOKEN=...
npm run build
npm start
```

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer <API_TOKEN>
```

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | `{ "ok": true }` |
| GET | `/api/v1/projects` | list projects |
| POST | `/api/v1/projects` | `{ "name": string }` |
| GET | `/api/v1/projects/:projectId` | |
| DELETE | `/api/v1/projects/:projectId` | also deletes tasks |
| GET | `/api/v1/projects/:projectId/tasks` | `status`, `page`, `pageSize` |
| POST | `/api/v1/projects/:projectId/tasks` | |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | partial update |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | |

Task list query params:

- `status` — `todo` \| `in_progress` \| `done`
- `page` — integer ≥ 1, default `1`
- `pageSize` — integer 1–100, default `20`

## Error shape

```json
{ "error": { "code": "NOT_FOUND", "message": "Project not found" } }
```

Codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404),
`METHOD_NOT_ALLOWED` (405), `INTERNAL_ERROR` (500).
```

---

**src/types.ts**

```typescript
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

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

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

export interface ListTasksQuery {
  projectId: string;
  status?: TaskStatus;
  page: number;
  pageSize: number;
}
```

**src/errors.ts**

```typescript
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }

  static validation(message: string): AppError {
    return new AppError(400, "VALIDATION_ERROR", message);
  }

  static unauthorized(message = "Unauthorized"): AppError {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static notFound(resource: string): AppError {
    return new AppError(404, "NOT_FOUND", `${resource} not found`);
  }

  static methodNotAllowed(method: string): AppError {
    return new AppError(
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${method} not allowed`,
    );
  }

  static internal(message = "An unexpected error occurred"): AppError {
    return new AppError(500, "INTERNAL_ERROR", message);
  }
}
```

**src/config.ts**

```typescript
export interface Config {
  port: number;
  apiToken: string;
  corsOrigin: boolean | string | string[];
}

function parseCorsOrigin(value: string | undefined): boolean | string | string[] {
  if (!value || value === "*") {
    return true;
  }
  if (value.includes(",")) {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiToken = env.API_TOKEN?.trim();
  if (!apiToken) {
    throw new Error("API_TOKEN environment variable is required");
  }

  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    port,
    apiToken,
    corsOrigin: parseCorsOrigin(env.CORS_ORIGIN),
  };
}
```

**src/asyncHandler.ts**

```typescript
import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

**src/validation.ts**

```typescript
import { z, type ZodType } from "zod";
import { AppError } from "./errors";
import { TASK_STATUSES } from "./types";

const taskStatusSchema = z.enum(TASK_STATUSES);

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    status: taskStatusSchema.optional(),
    assignee: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: taskStatusSchema.optional(),
    assignee: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

function queryInt(defaultValue: number, min: number, max: number) {
  return z.preprocess((val) => {
    if (val === undefined || val === "") {
      return defaultValue;
    }
    return val;
  }, z.coerce.number().int().min(min).max(max));
}

export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  page: queryInt(1, 1, Number.MAX_SAFE_INTEGER),
  pageSize: queryInt(20, 1, 100),
});

export function parseWith<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw AppError.validation(message);
  }
  return result.data;
}
```

**src/store.ts**

```typescript
import { randomUUID } from "node:crypto";
import type {
  CreateProjectInput,
  CreateTaskInput,
  ListTasksQuery,
  Project,
  Task,
  UpdateTaskInput,
} from "./types";

export interface Store {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(input: CreateProjectInput): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;

  listTasks(
    query: ListTasksQuery,
  ): Promise<{ tasks: Task[]; total: number }>;
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<Task | undefined>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}

function cloneProject(project: Project): Project {
  return { ...project };
}

function cloneTask(task: Task): Task {
  return { ...task };
}

function compareCreatedDesc(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class MemoryStore implements Store {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()]
      .sort(compareCreatedDesc)
      .map(cloneProject);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const project = this.projects.get(id);
    return project ? cloneProject(project) : undefined;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return cloneProject(project);
  }

  async deleteProject(id: string): Promise<boolean> {
    const existed = this.projects.delete(id);
    if (!existed) {
      return false;
    }
    for (const [taskId, task] of [...this.tasks.entries()]) {
      if (task.projectId === id) {
        this.tasks.delete(taskId);
      }
    }
    return true;
  }

  async listTasks(
    query: ListTasksQuery,
  ): Promise<{ tasks: Task[]; total: number }> {
    let matches = [...this.tasks.values()].filter(
      (task) => task.projectId === query.projectId,
    );
    if (query.status) {
      matches = matches.filter((task) => task.status === query.status);
    }
    matches.sort(compareCreatedDesc);
    const total = matches.length;
    const start = (query.page - 1) * query.pageSize;
    const tasks = matches.slice(start, start + query.pageSize).map(cloneTask);
    return { tasks, total };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return undefined;
    }
    return cloneTask(task);
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId,
      title: input.title,
      status: input.status ?? "todo",
      createdAt: now,
      updatedAt: now,
    };
    if (input.description !== undefined) {
      task.description = input.description;
    }
    if (input.assignee !== undefined) {
      task.assignee = input.assignee;
    }
    this.tasks.set(task.id, task);
    return cloneTask(task);
  }

  async updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<Task | undefined> {
    const existing = this.tasks.get(taskId);
    if (!existing || existing.projectId !== projectId) {
      return undefined;
    }

    const updated: Task = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };

    if (input.title !== undefined) {
      updated.title = input.title;
    }
    if (input.status !== undefined) {
      updated.status = input.status;
    }
    if (input.description !== undefined) {
      if (input.description === null) {
        delete updated.description;
      } else {
        updated.description = input.description;
      }
    }
    if (input.assignee !== undefined) {
      if (input.assignee === null) {
        delete updated.assignee;
      } else {
        updated.assignee = input.assignee;
      }
    }

    this.tasks.set(taskId, updated);
    return cloneTask(updated);
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return false;
    }
    return this.tasks.delete(taskId);
  }
}
```

**src/middleware/auth.ts**

```typescript
import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../errors";

function tokensEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function requireAuth(apiToken: string): RequestHandler {
  return (req, _res, next) => {
    const header = req.header("authorization");
    if (!header) {
      next(AppError.unauthorized("Missing Authorization header"));
      return;
    }

    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) {
      next(AppError.unauthorized("Invalid Authorization header"));
      return;
    }

    if (!tokensEqual(match[1], apiToken)) {
      next(AppError.unauthorized("Invalid token"));
      return;
    }

    next();
  };
}
```

**src/middleware/requestLogger.ts**

```typescript
import type { RequestHandler } from "express";

export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const path = req.originalUrl || req.url;
    console.log(
      `${req.method} ${path} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
    );
  });

  next();
};
```

**src/middleware/methodNotAllowed.ts**

```typescript
import type { RequestHandler, Router } from "express";
import { AppError } from "../errors";

type HttpMethod = "get" | "post" | "patch" | "delete";

export function methodNotAllowed(allowed: string[]): RequestHandler {
  return (req, res, next) => {
    res.set("Allow", allowed.join(", "));
    next(AppError.methodNotAllowed(req.method));
  };
}

export function defineRoutes(
  router: Router,
  path: string,
  handlers: Partial<Record<HttpMethod, RequestHandler | RequestHandler[]>>,
): void {
  const allowed: string[] = [];
  const methods: HttpMethod[] = ["get", "post", "patch", "delete"];

  for (const method of methods) {
    const handler = handlers[method];
    if (!handler) {
      continue;
    }
    allowed.push(method.toUpperCase());
    const stack = Array.isArray(handler) ? handler : [handler];
    router[method](path, ...stack);
  }

  router.all(path, methodNotAllowed(allowed));
}
```

**src/middleware/errorHandler.ts**

```typescript
import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../errors";

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound("Route"));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json(errorBody(err.code, err.message));
    return;
  }

  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json(errorBody("VALIDATION_ERROR", "Invalid JSON body"));
    return;
  }

  console.error(err);
  res
    .status(500)
    .json(errorBody("INTERNAL_ERROR", "An unexpected error occurred"));
};
```

**src/routes/health.ts**

```typescript
import type { RequestHandler } from "express";

export const healthHandler: RequestHandler = (_req, res) => {
  res.json({ ok: true });
};
```

**src/routes/projects.ts**

```typescript
import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { AppError } from "../errors";
import { defineRoutes } from "../middleware/methodNotAllowed";
import type { Store } from "../store";
import {
  createProjectSchema,
  createTaskSchema,
  listTasksQuerySchema,
  parseWith,
  updateTaskSchema,
} from "../validation";

export function createProjectsRouter(store: Store): Router {
  const router = Router();

  defineRoutes(router, "/projects", {
    get: asyncHandler(async (_req, res) => {
      const projects = await store.listProjects();
      res.json({ data: projects });
    }),
    post: asyncHandler(async (req, res) => {
      const body = parseWith(createProjectSchema, req.body);
      const project = await store.createProject(body);
      res.status(201).json({ data: project });
    }),
  });

  defineRoutes(router, "/projects/:projectId", {
    get: asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        throw AppError.notFound("Project");
      }
      res.json({ data: project });
    }),
    delete: asyncHandler(async (req, res) => {
      const deleted = await store.deleteProject(req.params.projectId);
      if (!deleted) {
        throw AppError.notFound("Project");
      }
      res.status(204).end();
    }),
  });

  defineRoutes(router, "/projects/:projectId/tasks", {
    get: asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        throw AppError.notFound("Project");
      }

      const query = parseWith(listTasksQuerySchema, req.query);
      const { tasks, total } = await store.listTasks({
        projectId: req.params.projectId,
        status: query.status,
        page: query.page,
        pageSize: query.pageSize,
      });

      res.json({
        data: tasks,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize) || 0,
        },
      });
    }),
    post: asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        throw AppError.notFound("Project");
      }
      const body = parseWith(createTaskSchema, req.body);
      const task = await store.createTask(req.params.projectId, body);
      res.status(201).json({ data: task });
    }),
  });

  defineRoutes(router, "/projects/:projectId/tasks/:taskId", {
    get: asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        throw AppError.notFound("Project");
      }
      const task = await store.getTask(req.params.projectId, req.params.taskId);
      if (!task) {
        throw AppError.notFound("Task");
      }
      res.json({ data: task });
    }),
    patch: asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        throw AppError.notFound("Project");
      }
      const body = parseWith(updateTaskSchema, req.body);
      const task = await store.updateTask(
        req.params.projectId,
        req.params.taskId,
        body,
      );
      if (!task) {
        throw AppError.notFound("Task");
      }
      res.json({ data: task });
    }),
    delete: asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        throw AppError.notFound("Project");
      }
      const deleted = await store.deleteTask(
        req.params.projectId,
        req.params.taskId,
      );
      if (!deleted) {
        throw AppError.notFound("Task");
      }
      res.status(204).end();
    }),
  });

  return router;
}
```

**src/app.ts**

```typescript
import cors from "cors";
import express, { Router, type Express } from "express";
import type { Config } from "./config";
import { requireAuth } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { methodNotAllowed } from "./middleware/methodNotAllowed";
import { requestLogger } from "./middleware/requestLogger";
import { healthHandler } from "./routes/health";
import { createProjectsRouter } from "./routes/projects";
import type { Store } from "./store";

export interface AppDeps {
  store: Store;
  config: Config;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogger);
  app.use(
    cors({
      origin: deps.config.corsOrigin,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 86400,
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  const v1 = Router();
  v1.get("/health", healthHandler);
  v1.all("/health", methodNotAllowed(["GET"]));

  v1.use(requireAuth(deps.config.apiToken));
  v1.use(createProjectsRouter(deps.store));

  app.use("/api/v1", v1);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
```

**src/index.ts**

```typescript
import { createServer } from "node:http";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { MemoryStore } from "./store";

function main(): void {
  const config = loadConfig();
  const app = createApp({ store: new MemoryStore(), config });
  const server = createServer(app);

  server.listen(config.port, () => {
    console.log(`Team task board API listening on port ${config.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down`);
    server.close((err) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
```

---

### Run it

```bash
npm install
export API_TOKEN=dev-secret
npm run dev
```

```bash
curl -s http://localhost:3000/api/v1/health
curl -s -H "Authorization: Bearer dev-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Launch"}' \
  http://localhost:3000/api/v1/projects
```

Swap storage later by implementing `Store` (same methods as `MemoryStore`) and passing it into `createApp`.