<!-- model: openrouter/x-ai/grok-4.6 | run: 2 | framework: Express -->

Production-ready Express + TypeScript API: in-memory store behind an interface, Zod validation, Bearer auth, CORS, structured logs, and consistent JSON errors.

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "REST API for a team task board",
  "type": "module",
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
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "helmet": "^8.0.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.13.5",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false
  },
  "include": ["src/**/*.ts"],
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

```bash
# Copy to .env and set a strong token before running.
PORT=3000
API_TOKEN=change-me-to-a-long-random-secret
# Comma-separated origins, or * for any origin
CORS_ORIGIN=*
NODE_ENV=development
```

```markdown
# Team Task Board API

Production-oriented REST API for projects and tasks. Storage is in-memory and sits behind a `Store` interface so it can be replaced (e.g. Postgres) without touching HTTP handlers.

## Requirements

- Node.js 20+

## Setup

```bash
cp .env.example .env
# set API_TOKEN
npm install
npm run dev
```

Production:

```bash
npm run build
NODE_ENV=production API_TOKEN=... npm start
```

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer <API_TOKEN>
```

CORS preflight (`OPTIONS`) is unauthenticated so browsers can call the API.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | `{ "ok": true }` |
| GET | `/api/v1/projects` | list |
| POST | `/api/v1/projects` | `{ "name": string }` |
| GET | `/api/v1/projects/:projectId` | 404 if missing |
| DELETE | `/api/v1/projects/:projectId` | deletes tasks too |
| GET | `/api/v1/projects/:projectId/tasks` | `status`, `page`, `pageSize` |
| POST | `/api/v1/projects/:projectId/tasks` | create |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | partial update |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | |

Task `status`: `todo` | `in_progress` | `done`. Pagination defaults: `page=1`, `pageSize=20` (max 100).

Errors use `{ "error": { "code", "message" } }`.
```

```typescript
// src/types.ts
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

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListTasksOptions {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

export interface PatchTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}
```

```typescript
// src/config.ts
export interface Config {
  port: number;
  apiToken: string;
  corsOrigin: string;
  nodeEnv: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiToken = env.API_TOKEN?.trim() ?? "";
  if (!apiToken) {
    throw new Error("API_TOKEN environment variable is required");
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    port,
    apiToken,
    corsOrigin: env.CORS_ORIGIN?.trim() || "*",
    nodeEnv: env.NODE_ENV?.trim() || "development",
  };
}
```

```typescript
// src/errors.ts
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function notFound(message: string): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function badRequest(message: string, code = "VALIDATION_ERROR"): AppError {
  return new AppError(400, code, message);
}

export function unauthorized(message = "Unauthorized"): AppError {
  return new AppError(401, "UNAUTHORIZED", message);
}
```

```typescript
// src/http.ts
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "./errors.js";

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(fn: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function methodNotAllowed(allow: string): RequestHandler {
  return (_req, res) => {
    res.setHeader("Allow", allow);
    res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: `Method not allowed. Allowed: ${allow}`,
      },
    });
  };
}

export function sendError(res: Response, err: AppError): void {
  res.status(err.statusCode).json({
    error: { code: err.code, message: err.message },
  });
}
```

```typescript
// src/store.ts
import { randomUUID } from "node:crypto";
import type {
  CreateTaskInput,
  ListTasksOptions,
  PaginationMeta,
  PatchTaskInput,
  Project,
  Task,
} from "./types.js";

export interface Store {
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  createProject(name: string): Project;
  deleteProject(id: string): boolean;

  listTasks(
    projectId: string,
    options: ListTasksOptions,
  ): { items: Task[]; pagination: PaginationMeta };
  getTask(projectId: string, taskId: string): Task | undefined;
  createTask(projectId: string, input: CreateTaskInput): Task | undefined;
  updateTask(projectId: string, taskId: string, patch: PatchTaskInput): Task | undefined;
  deleteTask(projectId: string, taskId: string): boolean;
}

export class MemoryStore implements Store {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  listProjects(): Project[] {
    return [...this.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  createProject(name: string): Project {
    const now = new Date().toISOString();
    const project: Project = { id: randomUUID(), name, createdAt: now };
    this.projects.set(project.id, project);
    return project;
  }

  deleteProject(id: string): boolean {
    if (!this.projects.delete(id)) {
      return false;
    }
    for (const [taskId, task] of this.tasks) {
      if (task.projectId === id) {
        this.tasks.delete(taskId);
      }
    }
    return true;
  }

  listTasks(
    projectId: string,
    options: ListTasksOptions,
  ): { items: Task[]; pagination: PaginationMeta } {
    let items = [...this.tasks.values()].filter((t) => t.projectId === projectId);
    if (options.status) {
      items = items.filter((t) => t.status === options.status);
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = items.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / options.pageSize);
    const start = (options.page - 1) * options.pageSize;

    return {
      items: items.slice(start, start + options.pageSize),
      pagination: {
        page: options.page,
        pageSize: options.pageSize,
        total,
        totalPages,
      },
    };
  }

  getTask(projectId: string, taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return undefined;
    }
    return task;
  }

  createTask(projectId: string, input: CreateTaskInput): Task | undefined {
    if (!this.projects.has(projectId)) {
      return undefined;
    }
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
    return task;
  }

  updateTask(projectId: string, taskId: string, patch: PatchTaskInput): Task | undefined {
    const existing = this.getTask(projectId, taskId);
    if (!existing) {
      return undefined;
    }

    const next: Task = { ...existing, updatedAt: new Date().toISOString() };

    if (patch.title !== undefined) {
      next.title = patch.title;
    }
    if (patch.status !== undefined) {
      next.status = patch.status;
    }
    if (patch.description === null) {
      delete next.description;
    } else if (patch.description !== undefined) {
      next.description = patch.description;
    }
    if (patch.assignee === null) {
      delete next.assignee;
    } else if (patch.assignee !== undefined) {
      next.assignee = patch.assignee;
    }

    this.tasks.set(taskId, next);
    return next;
  }

  deleteTask(projectId: string, taskId: string): boolean {
    const existing = this.getTask(projectId, taskId);
    if (!existing) {
      return false;
    }
    return this.tasks.delete(taskId);
  }
}
```

```typescript
// src/schemas.ts
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(300),
  description: z.string().max(5000).optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  assignee: z.string().trim().min(1).max(200).optional(),
});

export const patchTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    assignee: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

const emptyToUndefined = (value: unknown) => (value === "" || value === undefined ? undefined : value);

export const listTasksQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, z.enum(["todo", "in_progress", "done"]).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
```

```typescript
// src/middleware/auth.ts
import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { unauthorized } from "../errors.js";
import { sendError } from "../http.js";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function createAuthMiddleware(apiToken: string): RequestHandler {
  return (req, res, next) => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }

    const pathname = req.originalUrl.split("?")[0];
    if (pathname === "/api/v1/health") {
      next();
      return;
    }

    const header = req.header("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      sendError(res, unauthorized("Missing or invalid Authorization header"));
      return;
    }

    const token = header.slice("Bearer ".length);
    if (!safeEqual(token, apiToken)) {
      sendError(res, unauthorized("Invalid token"));
      return;
    }

    next();
  };
}
```

```typescript
// src/middleware/requestLogger.ts
import type { RequestHandler } from "express";

export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const path = req.originalUrl.split("?")[0] ?? req.path;
    console.log(
      JSON.stringify({
        method: req.method,
        path,
        status: res.statusCode,
        duration: Math.round(durationMs * 100) / 100,
      }),
    );
  });

  next();
};
```

```typescript
// src/middleware/errorHandler.ts
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors.js";

function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "request";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
};

export function createErrorHandler(nodeEnv: string): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (res.headersSent) {
      return;
    }

    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message },
      });
      return;
    }

    if (err instanceof ZodError) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: formatZodError(err) },
      });
      return;
    }

    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        error: { code: "INVALID_JSON", message: "Request body must be valid JSON" },
      });
      return;
    }

    console.error(
      JSON.stringify({
        level: "error",
        message: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );

    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message:
          nodeEnv === "production"
            ? "An unexpected error occurred"
            : err instanceof Error
              ? err.message
              : "An unexpected error occurred",
      },
    });
  };
}
```

```typescript
// src/routes.ts
import { Router } from "express";
import { notFound } from "./errors.js";
import { asyncHandler, methodNotAllowed } from "./http.js";
import {
  createProjectSchema,
  createTaskSchema,
  listTasksQuerySchema,
  patchTaskSchema,
} from "./schemas.js";
import type { Store } from "./store.js";

export function createV1Router(store: Store): Router {
  const router = Router();

  router
    .route("/health")
    .get((_req, res) => {
      res.json({ ok: true });
    })
    .all(methodNotAllowed("GET"));

  router
    .route("/projects")
    .get((_req, res) => {
      res.json({ data: store.listProjects() });
    })
    .post(
      asyncHandler(async (req, res) => {
        const body = createProjectSchema.parse(req.body);
        const project = store.createProject(body.name);
        res.status(201).location(`/api/v1/projects/${project.id}`).json({ data: project });
      }),
    )
    .all(methodNotAllowed("GET, POST"));

  router
    .route("/projects/:projectId")
    .get((req, res) => {
      const project = store.getProject(req.params.projectId as string);
      if (!project) {
        throw notFound("Project not found");
      }
      res.json({ data: project });
    })
    .delete((req, res) => {
      const deleted = store.deleteProject(req.params.projectId as string);
      if (!deleted) {
        throw notFound("Project not found");
      }
      res.status(204).send();
    })
    .all(methodNotAllowed("GET, DELETE"));

  router
    .route("/projects/:projectId/tasks")
    .get((req, res) => {
      const projectId = req.params.projectId as string;
      if (!store.getProject(projectId)) {
        throw notFound("Project not found");
      }
      const query = listTasksQuerySchema.parse(req.query);
      const result = store.listTasks(projectId, query);
      res.json({ data: result.items, pagination: result.pagination });
    })
    .post(
      asyncHandler(async (req, res) => {
        const projectId = req.params.projectId as string;
        if (!store.getProject(projectId)) {
          throw notFound("Project not found");
        }
        const body = createTaskSchema.parse(req.body);
        const task = store.createTask(projectId, body);
        if (!task) {
          throw notFound("Project not found");
        }
        res
          .status(201)
          .location(`/api/v1/projects/${projectId}/tasks/${task.id}`)
          .json({ data: task });
      }),
    )
    .all(methodNotAllowed("GET, POST"));

  router
    .route("/projects/:projectId/tasks/:taskId")
    .get((req, res) => {
      const projectId = req.params.projectId as string;
      const taskId = req.params.taskId as string;
      if (!store.getProject(projectId)) {
        throw notFound("Project not found");
      }
      const task = store.getTask(projectId, taskId);
      if (!task) {
        throw notFound("Task not found");
      }
      res.json({ data: task });
    })
    .patch(
      asyncHandler(async (req, res) => {
        const projectId = req.params.projectId as string;
        const taskId = req.params.taskId as string;
        if (!store.getProject(projectId)) {
          throw notFound("Project not found");
        }
        const body = patchTaskSchema.parse(req.body);
        const task = store.updateTask(projectId, taskId, body);
        if (!task) {
          throw notFound("Task not found");
        }
        res.json({ data: task });
      }),
    )
    .delete((req, res) => {
      const projectId = req.params.projectId as string;
      const taskId = req.params.taskId as string;
      if (!store.getProject(projectId)) {
        throw notFound("Project not found");
      }
      const deleted = store.deleteTask(projectId, taskId);
      if (!deleted) {
        throw notFound("Task not found");
      }
      res.status(204).send();
    })
    .all(methodNotAllowed("GET, PATCH, DELETE"));

  return router;
}
```

```typescript
// src/app.ts
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { Config } from "./config.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createErrorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { createV1Router } from "./routes.js";
import type { Store } from "./store.js";

export interface CreateAppOptions {
  store: Store;
  config: Config;
}

function corsOrigin(corsOriginEnv: string): cors.CorsOptions["origin"] {
  if (corsOriginEnv === "*") {
    return true;
  }
  return corsOriginEnv.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function createApp({ store, config }: CreateAppOptions): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigin(config.corsOrigin),
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 86400,
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(requestLogger);

  app.use("/api/v1", createAuthMiddleware(config.apiToken), createV1Router(store));

  app.use(notFoundHandler);
  app.use(createErrorHandler(config.nodeEnv));

  return app;
}
```

```typescript
// src/index.ts
import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./store.js";

const config = loadConfig();
const store = new MemoryStore();
const app = createApp({ store, config });
const server = createServer(app);

server.listen(config.port, () => {
  console.log(
    JSON.stringify({
      message: "Team task board API listening",
      port: config.port,
      env: config.nodeEnv,
    }),
  );
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ message: "Shutting down", signal }));
  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

Run with `cp .env.example .env`, set `API_TOKEN`, then `npm install` and `npm run dev`.

**Design notes**

- **Swap storage** by implementing `Store` in `src/store.ts` and constructing it in `src/index.ts` instead of `MemoryStore`.
- **Auth** uses a timing-safe compare; `OPTIONS` and `GET /api/v1/health` skip the Bearer check so CORS preflight and liveness work.
- **Errors** are always `{ error: { code, message } }` for 400 / 401 / 404 / 405 / 500, including unknown routes.
- **Logs** are one JSON line per request: `method`, `path`, `status`, `duration` (ms).
- **Deletes** return `204`; creates return `201` plus `Location`. Optional task fields can be cleared on PATCH with `null`.