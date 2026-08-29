<!-- model: openrouter/x-ai/grok-4.6 | run: 2 | framework: Hono -->

A production-oriented Workers API using Hono + Zod, KV for persistence, Bearer auth, CORS, structured errors, and request logging.

```json
{
  "name": "team-task-board",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "REST API for a team task board, running on Cloudflare Workers",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "cf-typegen": "wrangler types"
  },
  "dependencies": {
    "hono": "^4.8.12",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250823.0",
    "typescript": "^5.8.3",
    "wrangler": "^4.20.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

```toml
name = "team-task-board"
main = "src/index.ts"
compatibility_date = "2026-08-29"

[observability]
enabled = true

# Replace the id with the value from:
#   npx wrangler kv namespace create TASKS
[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_ME_WITH_KV_NAMESPACE_ID"

# API_TOKEN is a secret (not a plain var):
#   npx wrangler secret put API_TOKEN
# Locally, copy .dev.vars.example to .dev.vars
```

```gitignore
node_modules/
.wrangler/
.dev.vars
dist/
*.log
.DS_Store
```

```env
API_TOKEN=dev-secret-token-change-me
```

```markdown
# Team Task Board API

Production REST API on Cloudflare Workers. Data lives in a single KV namespace (`TASKS`). All routes except `GET /api/v1/health` require `Authorization: Bearer <token>`.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # set API_TOKEN for local dev
npx wrangler kv namespace create TASKS
# paste the namespace id into wrangler.toml
npm run dev
```

Deploy:

```bash
npx wrangler secret put API_TOKEN
npx wrangler deploy
```

## Auth

```
Authorization: Bearer <API_TOKEN>
```

Missing/invalid credentials → `401` with the standard error envelope.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/health` | Unauthenticated |
| GET | `/api/v1/projects` | List projects |
| POST | `/api/v1/projects` | `{ "name": string }` |
| GET | `/api/v1/projects/:projectId` | |
| DELETE | `/api/v1/projects/:projectId` | Also deletes the project's tasks |
| GET | `/api/v1/projects/:projectId/tasks` | `?status=&page=&pageSize=` |
| POST | `/api/v1/projects/:projectId/tasks` | `{ "title", "description?", "status?", "assignee?" }` |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | Partial update; `description`/`assignee` may be `null` to clear |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | |

Task `status`: `todo` | `in_progress` | `done` (default `todo` on create).

Pagination defaults: `page=1`, `pageSize=20` (max 100).

## Errors

```json
{ "error": { "code": "NOT_FOUND", "message": "Project not found" } }
```

| HTTP | code |
| --- | --- |
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED` |
| 404 | `NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` |
| 500 | `INTERNAL_ERROR` |
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

export type AppEnv = {
  Bindings: {
    TASKS: KVNamespace;
    API_TOKEN: string;
  };
};
```

```typescript
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly status: 400 | 401 | 404 | 405 | 500;
  readonly code: ErrorCode;

  constructor(status: 400 | 401 | 404 | 405 | 500, code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}
```

```typescript
import type { Context, Handler, Hono } from "hono";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../types.ts";

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof ALL_METHODS)[number];

export function defineRoute(
  router: Hono<AppEnv>,
  path: string,
  handlers: Partial<Record<Method, Handler<AppEnv>>>,
) {
  const allowed = Object.keys(handlers) as Method[];

  for (const method of allowed) {
    const handler = handlers[method];
    if (handler) router.on(method, path, handler);
  }

  const disallowed = ALL_METHODS.filter((m) => !allowed.includes(m));
  if (disallowed.length === 0) return;

  router.on(disallowed, path, (c: Context<AppEnv>) => {
    c.header("Allow", allowed.join(", "));
    throw new AppError(
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${c.req.method} not allowed`,
    );
  });
}
```

```typescript
import type { z } from "zod";
import { AppError } from "../errors.ts";

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) {
    throw new AppError(400, "VALIDATION_ERROR", "Request body is required");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid JSON body");
  }
}

export function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const message = result.error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");

  throw new AppError(400, "VALIDATION_ERROR", message);
}
```

```typescript
import type { MiddlewareHandler } from "hono";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../types.ts";

const BEARER = /^Bearer\s+(\S+)$/;

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  if (!c.env.API_TOKEN) {
    console.error("API_TOKEN secret is not configured");
    throw new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  const header = c.req.header("Authorization") ?? "";
  const match = BEARER.exec(header);
  if (!match || match[1] !== c.env.API_TOKEN) {
    throw new AppError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  await next();
};
```

```typescript
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.ts";

export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = Date.now();
  try {
    await next();
  } finally {
    console.log(
      JSON.stringify({
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        duration: Date.now() - started,
      }),
    );
  }
};
```

```typescript
import type { Project, Task } from "../types.ts";

const PROJECT_PREFIX = "project:";
const TASK_PREFIX = "task:";

function projectKey(id: string) {
  return `${PROJECT_PREFIX}${id}`;
}

function taskKey(projectId: string, taskId: string) {
  return `${TASK_PREFIX}${projectId}:${taskId}`;
}

function taskPrefixFor(projectId: string) {
  return `${TASK_PREFIX}${projectId}:`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export class TaskBoardStore {
  constructor(private readonly kv: KVNamespace) {}

  async getProject(id: string): Promise<Project | null> {
    return this.kv.get<Project>(projectKey(id), "json");
  }

  async putProject(project: Project): Promise<void> {
    await this.kv.put(projectKey(project.id), JSON.stringify(project));
  }

  async listProjects(): Promise<Project[]> {
    const keys = await this.listKeys(PROJECT_PREFIX);
    const projects = await this.getMany<Project>(keys);
    return projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteProject(id: string): Promise<boolean> {
    const existing = await this.getProject(id);
    if (!existing) return false;

    const taskKeys = await this.listKeys(taskPrefixFor(id));
    await this.deleteKeys([projectKey(id), ...taskKeys]);
    return true;
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    return this.kv.get<Task>(taskKey(projectId, taskId), "json");
  }

  async putTask(task: Task): Promise<void> {
    await this.kv.put(taskKey(task.projectId, task.id), JSON.stringify(task));
  }

  async listTasks(projectId: string): Promise<Task[]> {
    const keys = await this.listKeys(taskPrefixFor(projectId));
    const tasks = await this.getMany<Task>(keys);
    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;
    await this.kv.delete(taskKey(projectId, taskId));
    return true;
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;

    for (;;) {
      const page = await this.kv.list({ prefix, cursor, limit: 1000 });
      for (const key of page.keys) names.push(key.name);
      if (page.list_complete) break;
      cursor = page.cursor;
    }

    return names;
  }

  private async getMany<T>(keys: string[]): Promise<T[]> {
    const values: T[] = [];
    for (const batch of chunk(keys, 50)) {
      const reads = await Promise.all(batch.map((key) => this.kv.get<T>(key, "json")));
      for (const value of reads) {
        if (value) values.push(value);
      }
    }
    return values;
  }

  private async deleteKeys(keys: string[]): Promise<void> {
    for (const batch of chunk(keys, 50)) {
      await Promise.all(batch.map((key) => this.kv.delete(key)));
    }
  }
}
```

```typescript
import { Hono } from "hono";
import { defineRoute } from "../lib/define-route.ts";
import type { AppEnv } from "../types.ts";

export const healthRoutes = new Hono<AppEnv>();

defineRoute(healthRoutes, "/health", {
  GET: (c) => c.json({ ok: true as const }),
});
```

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { defineRoute } from "../lib/define-route.ts";
import { parseWith, readJson } from "../lib/validate.ts";
import { TaskBoardStore } from "../storage/store.ts";
import type { AppEnv, Project } from "../types.ts";
import { taskRoutes } from "./tasks.ts";

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
});

export const projectRoutes = new Hono<AppEnv>();

defineRoute(projectRoutes, "/", {
  GET: async (c) => {
    const store = new TaskBoardStore(c.env.TASKS);
    const data = await store.listProjects();
    return c.json({ data });
  },
  POST: async (c) => {
    const body = parseWith(createProjectSchema, await readJson(c.req.raw));
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name: body.name,
      createdAt: now,
    };
    const store = new TaskBoardStore(c.env.TASKS);
    await store.putProject(project);
    return c.json(project, 201);
  },
});

defineRoute(projectRoutes, "/:projectId", {
  GET: async (c) => {
    const projectId = c.req.param("projectId");
    const store = new TaskBoardStore(c.env.TASKS);
    const project = await store.getProject(projectId);
    if (!project) {
      throw new AppError(404, "NOT_FOUND", "Project not found");
    }
    return c.json(project);
  },
  DELETE: async (c) => {
    const projectId = c.req.param("projectId");
    const store = new TaskBoardStore(c.env.TASKS);
    const deleted = await store.deleteProject(projectId);
    if (!deleted) {
      throw new AppError(404, "NOT_FOUND", "Project not found");
    }
    return c.body(null, 204);
  },
});

projectRoutes.route("/:projectId/tasks", taskRoutes);
```

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { defineRoute } from "../lib/define-route.ts";
import { parseWith, readJson } from "../lib/validate.ts";
import { TaskBoardStore } from "../storage/store.ts";
import type { AppEnv, Task, TaskStatus } from "../types.ts";

const statusSchema = z.enum(["todo", "in_progress", "done"]);

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(500),
  description: z.string().max(5000).optional(),
  status: statusSchema.optional(),
  assignee: z.string().trim().min(1).max(200).optional(),
});

const patchTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: statusSchema.optional(),
    assignee: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const listQuerySchema = z.object({
  status: statusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

async function requireProject(store: TaskBoardStore, projectId: string) {
  const project = await store.getProject(projectId);
  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }
  return project;
}

export const taskRoutes = new Hono<AppEnv>();

defineRoute(taskRoutes, "/", {
  GET: async (c) => {
    const projectId = c.req.param("projectId");
    const query = parseWith(listQuerySchema, {
      status: c.req.query("status") || undefined,
      page: c.req.query("page") ?? undefined,
      pageSize: c.req.query("pageSize") ?? undefined,
    });

    const store = new TaskBoardStore(c.env.TASKS);
    await requireProject(store, projectId);

    let tasks = await store.listTasks(projectId);
    if (query.status) {
      tasks = tasks.filter((task) => task.status === query.status);
    }

    const total = tasks.length;
    const start = (query.page - 1) * query.pageSize;
    const data = tasks.slice(start, start + query.pageSize);

    return c.json({
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    });
  },
  POST: async (c) => {
    const projectId = c.req.param("projectId");
    const body = parseWith(createTaskSchema, await readJson(c.req.raw));
    const store = new TaskBoardStore(c.env.TASKS);
    await requireProject(store, projectId);

    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      projectId,
      title: body.title,
      status: (body.status ?? "todo") as TaskStatus,
      createdAt: now,
      updatedAt: now,
    };
    if (body.description !== undefined) task.description = body.description;
    if (body.assignee !== undefined) task.assignee = body.assignee;

    await store.putTask(task);
    return c.json(task, 201);
  },
});

defineRoute(taskRoutes, "/:taskId", {
  GET: async (c) => {
    const { projectId, taskId } = c.req.param();
    const store = new TaskBoardStore(c.env.TASKS);
    await requireProject(store, projectId);
    const task = await store.getTask(projectId, taskId);
    if (!task) {
      throw new AppError(404, "NOT_FOUND", "Task not found");
    }
    return c.json(task);
  },
  PATCH: async (c) => {
    const { projectId, taskId } = c.req.param();
    const body = parseWith(patchTaskSchema, await readJson(c.req.raw));
    const store = new TaskBoardStore(c.env.TASKS);
    await requireProject(store, projectId);

    const existing = await store.getTask(projectId, taskId);
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Task not found");
    }

    const updated: Task = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };

    if (body.title !== undefined) updated.title = body.title;
    if (body.status !== undefined) updated.status = body.status;

    if (body.description === null) {
      delete updated.description;
    } else if (body.description !== undefined) {
      updated.description = body.description;
    }

    if (body.assignee === null) {
      delete updated.assignee;
    } else if (body.assignee !== undefined) {
      updated.assignee = body.assignee;
    }

    await store.putTask(updated);
    return c.json(updated);
  },
  DELETE: async (c) => {
    const { projectId, taskId } = c.req.param();
    const store = new TaskBoardStore(c.env.TASKS);
    await requireProject(store, projectId);
    const deleted = await store.deleteTask(projectId, taskId);
    if (!deleted) {
      throw new AppError(404, "NOT_FOUND", "Task not found");
    }
    return c.body(null, 204);
  },
});
```

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AppError, errorBody } from "./errors.ts";
import { requireAuth } from "./middleware/auth.ts";
import { requestLogger } from "./middleware/logger.ts";
import { healthRoutes } from "./routes/health.ts";
import { projectRoutes } from "./routes/projects.ts";
import type { AppEnv } from "./types.ts";

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  }),
);

app.use("*", requestLogger);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message), err.status);
  }

  console.error("unhandled_error", err);
  return c.json(errorBody("INTERNAL_ERROR", "An unexpected error occurred"), 500);
});

app.notFound((c) => c.json(errorBody("NOT_FOUND", "Route not found"), 404));

const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  if (c.req.path === "/api/v1/health") {
    await next();
    return;
  }
  return requireAuth(c, next);
});

api.route("/", healthRoutes);
api.route("/projects", projectRoutes);

app.route("/api/v1", api);

export default app;
```

**Notes**

- KV layout: `project:{id}` and `task:{projectId}:{taskId}`. List/delete walk prefixes (cursor-safe, batched reads/writes).
- Auth is skipped for `GET /api/v1/health` and CORS preflight. `API_TOKEN` is a Wrangler secret (`.dev.vars` locally).
- 405s are registered per concrete path with an `Allow` header. Unknown paths use the same `{ error: { code, message } }` shape.
- Every request logs JSON `{ method, path, status, duration }`.
- After `npm install`, set the KV id in `wrangler.toml`, copy `.dev.vars.example` → `.dev.vars`, then `npm run dev`.