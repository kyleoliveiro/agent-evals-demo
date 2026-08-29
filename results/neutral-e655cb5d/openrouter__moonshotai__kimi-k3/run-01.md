<!-- model: openrouter/moonshotai/kimi-k3 | run: 1 | framework: Express -->

Here's a complete, production-ready TypeScript REST API using **Express**, **Zod** for validation, and an in-memory store hidden behind an interface.

### `package.json`
```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "Team task board REST API",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.15.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.1"
  }
}
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

### `.gitignore`
```
node_modules
dist
.env
```

### `.env.example`
```
PORT=3000
API_TOKEN=dev-secret-token
CORS_ORIGIN=*
```

### `src/types.ts`
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
```

### `src/store/interface.ts`
```typescript
import { Project, Task, TaskStatus } from "../types";

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

export interface ListTasksFilter {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface ListTasksResult {
  items: Task[];
  total: number;
}

/**
 * Storage abstraction. Swap MemoryStore for a database-backed
 * implementation (Postgres, Mongo, etc.) without touching routes.
 */
export interface BoardStore {
  createProject(input: CreateProjectInput): Project;
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  /** Deletes the project and all of its tasks. Returns false if missing. */
  deleteProject(id: string): boolean;

  createTask(projectId: string, input: CreateTaskInput): Task;
  listTasks(projectId: string, filter: ListTasksFilter): ListTasksResult;
  getTask(projectId: string, taskId: string): Task | undefined;
  updateTask(projectId: string, taskId: string, patch: UpdateTaskInput): Task | undefined;
  deleteTask(projectId: string, taskId: string): boolean;
}
```

### `src/store/memory.ts`
```typescript
import { randomUUID } from "crypto";
import { Project, Task } from "../types";
import {
  BoardStore,
  CreateProjectInput,
  CreateTaskInput,
  ListTasksFilter,
  ListTasksResult,
  UpdateTaskInput,
} from "./interface";

export class MemoryStore implements BoardStore {
  private projects = new Map<string, Project>();
  private tasks = new Map<string, Task>();

  createProject(input: CreateProjectInput): Project {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  listProjects(): Project[] {
    return [...this.projects.values()];
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  deleteProject(id: string): boolean {
    const existed = this.projects.delete(id);
    if (existed) {
      for (const task of this.tasks.values()) {
        if (task.projectId === id) this.tasks.delete(task.id);
      }
    }
    return existed;
  }

  createTask(projectId: string, input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId,
      title: input.title,
      description: input.description,
      status: input.status,
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  listTasks(projectId: string, filter: ListTasksFilter): ListTasksResult {
    let all = [...this.tasks.values()].filter((t) => t.projectId === projectId);
    if (filter.status) all = all.filter((t) => t.status === filter.status);
    const total = all.length;
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total };
  }

  getTask(projectId: string, taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task && task.projectId === projectId ? task : undefined;
  }

  updateTask(projectId: string, taskId: string, patch: UpdateTaskInput): Task | undefined {
    const task = this.getTask(projectId, taskId);
    if (!task) return undefined;
    if (patch.title !== undefined) task.title = patch.title;
    if (patch.description !== undefined) task.description = patch.description;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.assignee !== undefined) task.assignee = patch.assignee;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  deleteTask(projectId: string, taskId: string): boolean {
    const task = this.getTask(projectId, taskId);
    if (!task) return false;
    return this.tasks.delete(taskId);
  }
}
```

### `src/errors.ts`
```typescript
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, "VALIDATION_FAILED", message);
}

export function unauthorized(message = "Missing or invalid bearer token"): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function notFound(message: string): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}
```

### `src/schemas.ts`
```typescript
import { z } from "zod";
import { badRequest } from "./errors";

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
});

export const createTaskSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  status: z.enum(TASK_STATUSES).default("todo"),
  assignee: z.string().max(100).optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: z.string().max(100).optional(),
  })
  .refine(
    (obj) => Object.values(obj).some((v) => v !== undefined),
    { message: "Provide at least one of: title, description, status, assignee" },
  );

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Throws ApiError(400) with a readable message on failure. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    throw badRequest(message);
  }
  return result.data;
}
```

### `src/middleware/logger.ts`
```typescript
import { NextFunction, Request, Response } from "express";

/** Logs method, path, status code and duration for every request. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    console.log(
      JSON.stringify({
        level: "info",
        msg: "request",
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs,
      }),
    );
  });
  next();
}
```

### `src/middleware/auth.ts`
```typescript
import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { unauthorized } from "../errors";

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function requireAuth(expectedToken: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const token =
      header && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : undefined;
    if (!token || !safeCompare(token, expectedToken)) {
      next(unauthorized());
      return;
    }
    next();
  };
}
```

### `src/middleware/errorHandler.ts`
```typescript
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors";

/** Final middleware: renders a consistent { error: { code, message } } body. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Malformed JSON bodies from express.json()
  if (
    (err as { type?: string })?.type === "entity.parse.failed" ||
    err instanceof SyntaxError
  ) {
    res.status(400).json({
      error: { code: "VALIDATION_FAILED", message: "Malformed JSON body" },
    });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
  });
}
```

### `src/middleware/notFound.ts`
```typescript
import { Request, Response } from "express";

interface RoutePattern {
  path: string;
  methods: string[];
}

function compile(pattern: string): RegExp {
  const withWildcards = pattern.replace(/:[^/]+/g, "[^/]+");
  const escaped = withWildcards.replace(/\//g, "\\/");
  return new RegExp(`^${escaped}$`);
}

/**
 * 404 for unknown paths; 405 when the path matches a known route
 * but the HTTP method isn't allowed for it.
 */
export function makeNotFoundHandler(patterns: RoutePattern[]) {
  const compiled = patterns.map((p) => ({ regex: compile(p.path), methods: p.methods }));
  return (req: Request, res: Response): void => {
    for (const p of compiled) {
      if (p.regex.test(req.path) && !p.methods.includes(req.method)) {
        res.status(405).json({
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: `${req.method} is not allowed for ${req.path}`,
          },
        });
        return;
      }
    }
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
  };
}
```

### `src/routes/tasks.ts`
```typescript
import { Request, Response, Router } from "express";
import { notFound } from "../errors";
import {
  createTaskSchema,
  listTasksQuerySchema,
  parse,
  updateTaskSchema,
} from "../schemas";
import { BoardStore } from "../store/interface";

export function tasksRouter(store: BoardStore): Router {
  const router = Router({ mergeParams: true });

  const projectIdOf = (req: Request): string => req.params.projectId;

  const ensureProject = (req: Request): void => {
    if (!store.getProject(projectIdOf(req))) throw notFound("Project not found");
  };

  // GET /projects/:projectId/tasks?status=&page=&pageSize=
  router.get("/", (req: Request, res: Response) => {
    ensureProject(req);
    const query = parse(listTasksQuerySchema, req.query);
    const result = store.listTasks(projectIdOf(req), {
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      items: result.items,
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
    });
  });

  // POST /projects/:projectId/tasks
  router.post("/", (req: Request, res: Response) => {
    ensureProject(req);
    const body = parse(createTaskSchema, req.body);
    const task = store.createTask(projectIdOf(req), body);
    res.status(201).json(task);
  });

  // GET /projects/:projectId/tasks/:taskId
  router.get("/:taskId", (req: Request, res: Response) => {
    ensureProject(req);
    const task = store.getTask(projectIdOf(req), req.params.taskId);
    if (!task) throw notFound("Task not found");
    res.json(task);
  });

  // PATCH /projects/:projectId/tasks/:taskId
  router.patch("/:taskId", (req: Request, res: Response) => {
    ensureProject(req);
    const patch = parse(updateTaskSchema, req.body);
    const task = store.updateTask(projectIdOf(req), req.params.taskId, patch);
    if (!task) throw notFound("Task not found");
    res.json(task);
  });

  // DELETE /projects/:projectId/tasks/:taskId
  router.delete("/:taskId", (req: Request, res: Response) => {
    ensureProject(req);
    if (!store.deleteTask(projectIdOf(req), req.params.taskId)) {
      throw notFound("Task not found");
    }
    res.status(204).end();
  });

  return router;
}
```

### `src/routes/projects.ts`
```typescript
import { Request, Response, Router } from "express";
import { notFound } from "../errors";
import { createProjectSchema, parse } from "../schemas";
import { BoardStore } from "../store/interface";
import { tasksRouter } from "./tasks";

export function projectsRouter(store: BoardStore): Router {
  const router = Router();

  // GET /projects
  router.get("/", (_req: Request, res: Response) => {
    res.json({ items: store.listProjects() });
  });

  // POST /projects
  router.post("/", (req: Request, res: Response) => {
    const body = parse(createProjectSchema, req.body);
    const project = store.createProject(body);
    res.status(201).json(project);
  });

  // GET /projects/:projectId
  router.get("/:projectId", (req: Request, res: Response) => {
    const project = store.getProject(req.params.projectId);
    if (!project) throw notFound("Project not found");
    res.json(project);
  });

  // DELETE /projects/:projectId (also removes its tasks)
  router.delete("/:projectId", (req: Request, res: Response) => {
    if (!store.deleteProject(req.params.projectId)) {
      throw notFound("Project not found");
    }
    res.status(204).end();
  });

  // Nested task routes
  router.use("/:projectId/tasks", tasksRouter(store));

  return router;
}
```

### `src/app.ts`
```typescript
import cors from "cors";
import express, { Router } from "express";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/logger";
import { makeNotFoundHandler } from "./middleware/notFound";
import { projectsRouter } from "./routes/projects";
import { BoardStore } from "./store/interface";

export interface AppOptions {
  apiToken: string;
  corsOrigin?: string;
}

const ROUTE_PATTERNS = [
  { path: "/api/v1/health", methods: ["GET"] },
  { path: "/api/v1/projects", methods: ["GET", "POST"] },
  { path: "/api/v1/projects/:projectId", methods: ["GET", "DELETE"] },
  { path: "/api/v1/projects/:projectId/tasks", methods: ["GET", "POST"] },
  {
    path: "/api/v1/projects/:projectId/tasks/:taskId",
    methods: ["GET", "PATCH", "DELETE"],
  },
];

export function buildApp(store: BoardStore, options: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogger);
  app.use(cors({ origin: options.corsOrigin ?? "*" })); // handles preflight
  app.use(express.json({ limit: "1mb" }));

  const api = Router();
  api.get("/health", (_req, res) => res.json({ ok: true })); // no auth
  api.use(requireAuth(options.apiToken));
  api.use("/projects", projectsRouter(store));

  app.use("/api/v1", api);

  app.use(makeNotFoundHandler(ROUTE_PATTERNS));
  app.use(errorHandler);

  return app;
}
```

### `src/index.ts`
```typescript
import { buildApp } from "./app";
import { MemoryStore } from "./store/memory";

const apiToken = process.env.API_TOKEN;
if (!apiToken) {
  console.error("FATAL: API_TOKEN environment variable is required");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const store = new MemoryStore();
const app = buildApp(store, {
  apiToken,
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
});

app.listen(port, () => {
  console.log(`task-board-api listening on port ${port}`);
});
```

### `test/api.test.ts`
```typescript
import { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store/memory";

const TOKEN = "test-token";
let app: Express;

beforeEach(() => {
  app = buildApp(new MemoryStore(), { apiToken: TOKEN });
});

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("health", () => {
  it("is open without auth", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("auth", () => {
  it("rejects missing/invalid tokens with 401", async () => {
    const res = await request(app).get("/api/v1/projects");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");

    const bad = await request(app)
      .get("/api/v1/projects")
      .set("Authorization", "Bearer wrong");
    expect(bad.status).toBe(401);
  });
});

describe("projects", () => {
  it("validates the create body", async () => {
    const res = await auth(request(app).post("/api/v1/projects").send({}));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("creates, lists, gets and deletes projects", async () => {
    const created = await auth(
      request(app).post("/api/v1/projects").send({ name: "Alpha" }),
    );
    expect(created.status).toBe(201);
    const id = created.body.id;

    const list = await auth(request(app).get("/api/v1/projects"));
    expect(list.body.items).toHaveLength(1);

    const one = await auth(request(app).get(`/api/v1/projects/${id}`));
    expect(one.status).toBe(200);
    expect(one.body.name).toBe("Alpha");

    const del = await auth(request(app).delete(`/api/v1/projects/${id}`));
    expect(del.status).toBe(204);

    const gone = await auth(request(app).get(`/api/v1/projects/${id}`));
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe("NOT_FOUND");
  });
});

describe("tasks", () => {
  it("supports full lifecycle, filtering and pagination", async () => {
    const project = await auth(
      request(app).post("/api/v1/projects").send({ name: "P" }),
    );
    const pid = project.body.id;

    const badCreate = await auth(
      request(app).post(`/api/v1/projects/${pid}/tasks`).send({ title: "" }),
    );
    expect(badCreate.status).toBe(400);

    for (let i = 1; i <= 25; i++) {
      const r = await auth(
        request(app)
          .post(`/api/v1/projects/${pid}/tasks`)
          .send({ title: `t${i}`, status: i % 2 ? "done" : "todo" }),
      );
      expect(r.status).toBe(201);
    }

    const page1 = await auth(
      request(app).get(`/api/v1/projects/${pid}/tasks?page=1&pageSize=10`),
    );
    expect(page1.body.items).toHaveLength(10);
    expect(page1.body.total).toBe(25);

    const filtered = await auth(
      request(app).get(`/api/v1/projects/${pid}/tasks?status=done&pageSize=50`),
    );
    expect(filtered.body.total).toBe(13);
    expect(filtered.body.items.every((t: any) => t.status === "done")).toBe(true);

    const taskId = page1.body.items[0].id;
    const patched = await auth(
      request(app)
        .patch(`/api/v1/projects/${pid}/tasks/${taskId}`)
        .send({ status: "in_progress", assignee: "ada" }),
    );
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe("in_progress");

    const invalidPatch = await auth(
      request(app).patch(`/api/v1/projects/${pid}/tasks/${taskId}`).send({}),
    );
    expect(invalidPatch.status).toBe(400);

    const del = await auth(
      request(app).delete(`/api/v1/projects/${pid}/tasks/${taskId}`),
    );
    expect(del.status).toBe(204);
  });

  it("cascades project deletion to tasks", async () => {
    const project = await auth(
      request(app).post("/api/v1/projects").send({ name: "P" }),
    );
    const pid = project.body.id;
    const task = await auth(
      request(app).post(`/api/v1/projects/${pid}/tasks`).send({ title: "x" }),
    );
    await auth(request(app).delete(`/api/v1/projects/${pid}`));

    const res = await auth(
      request(app).get(`/api/v1/projects/${pid}/tasks/${task.body.id}`),
    );
    expect(res.status).toBe(404);
  });
});

describe("error semantics", () => {
  it("returns 405 for wrong method on a known route", async () => {
    const res = await request(app).put("/api/v1/projects");
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("returns 404 with the error shape for unknown routes", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await auth(
      request(app)
        .post("/api/v1/projects")
        .set("Content-Type", "application/json")
        .send("{bad json"),
    );
    expect(res.status).toBe(400);
  });
});
```

### `README.md`
```markdown
# Team Task Board API

REST API for managing projects and tasks. In-memory storage behind a
`BoardStore` interface (swap in a real DB later without touching routes).

## Quick start

```bash
cp .env.example .env          # set API_TOKEN
npm install
npm run dev                   # http://localhost:3000
```

Build & run in production:

```bash
npm run build
API_TOKEN=secret node dist/index.js
```

Run tests:

```bash
npm test
```

## Environment

| Variable      | Required | Default | Purpose                     |
| ------------- | -------- | ------- | --------------------------- |
| `API_TOKEN`   | yes      | —       | Bearer token for auth       |
| `PORT`        | no       | `3000`  | Listen port                 |
| `CORS_ORIGIN` | no       | `*`     | Allowed origin(s) for CORS  |

All endpoints except `GET /api/v1/health` require
`Authorization: Bearer <API_TOKEN>`.
```

**Design notes:**

- **Storage interface** — `BoardStore` is the swap point; `MemoryStore` uses `Map`s and `crypto.randomUUID()`. A Postgres implementation would just satisfy the same interface.
- **Auth** — token compared with `timingSafeEqual` to avoid timing attacks; `/health` bypasses it.
- **Validation** — all inputs go through Zod schemas; failures produce the consistent `{ error: { code, message } }` shape with code `VALIDATION_FAILED`.
- **404 vs 405** — after the API router, a small pattern registry distinguishes "this path exists but not with that method" (405) from truly unknown paths (404), both in the canonical error shape.
- **Logging** — a JSON line per request: method, path, status, duration in ms.
- **CORS** — the `cors` middleware handles preflight automatically; origin configurable via `CORS_ORIGIN`.
- The included Vitest/Supertest suite exercises auth, validation, CRUD, pagination, filtering, cascade deletes, and error semantics (400/401/404/405).