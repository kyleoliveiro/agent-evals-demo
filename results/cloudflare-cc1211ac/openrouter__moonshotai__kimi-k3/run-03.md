<!-- model: openrouter/moonshotai/kimi-k3 | run: 3 | framework: Hono -->

Here's a complete, production-style implementation. It uses **[Hono](https://hono.dev)** (routing + CORS middleware), **[zod](https://zod.dev)** (validation), and a small KV repository layer. Tests use the official `@cloudflare/vitest-pool-workers` runner.

### File tree

```
├── package.json
├── tsconfig.json
├── wrangler.toml
├── vitest.config.ts
├── .gitignore
├── .dev.vars.example
├── README.md
├── src
│   ├── index.ts
│   ├── types.ts
│   ├── errors.ts
│   ├── middleware
│   │   ├── auth.ts
│   │   └── logging.ts
│   ├── routes
│   │   ├── projects.ts
│   │   ├── registry.ts
│   │   └── tasks.ts
│   ├── storage
│   │   └── kv.ts
│   └── validation
│       ├── schemas.ts
│       └── validate.ts
└── test
    └── api.spec.ts
```

#### package.json

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.7.11",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.7",
    "@cloudflare/workers-types": "^4.20250530.0",
    "typescript": "^5.7.3",
    "vitest": "^3.2.4",
    "wrangler": "^4.22.0"
  }
}
```

#### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

#### wrangler.toml

```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2025-06-10"

# Run `wrangler kv namespace create TASKS` and paste the returned id(s) here.
kv_namespaces = [
  { binding = "TASKS", id = "REPLACE_WITH_KV_NAMESPACE_ID" }
]

[observability]
enabled = true

# Secrets are not stored here. Set the bearer token with:
#   wrangler secret put API_TOKEN
# For local dev, copy .dev.vars.example to .dev.vars.
```

#### vitest.config.ts

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          kvNamespaces: ["TASKS"],
          bindings: { API_TOKEN: "test-token" },
        },
      },
    },
  },
});
```

#### .gitignore

```
node_modules
.wrangler
dist
coverage
.dev.vars
```

#### .dev.vars.example

```
API_TOKEN=dev-token
```

#### src/types.ts

```ts
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

export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}
```

#### src/errors.ts

```ts
export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 404 | 405 | 500,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}
```

#### src/validation/schemas.ts

```ts
import { z } from "zod";
import { TASK_STATUSES } from "../types";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(300),
  description: z.string().max(5000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.string().trim().min(1).max(120).optional(),
});

// All fields optional; null clears description/assignee. At least one field required.
export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().max(5000).nullish(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: z.string().trim().min(1).max(120).nullish(),
  })
  .refine(
    (obj) => Object.values(obj).some((v) => v !== undefined),
    "Provide at least one of: title, description, status, assignee",
  );

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
```

#### src/validation/validate.ts

```ts
import type { Context } from "hono";
import type { z, ZodTypeAny } from "zod";
import { ApiError } from "../errors";

export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be valid JSON");
  }
}

export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
      issues: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return result.data;
}
```

#### src/storage/kv.ts

```ts
import type { Project, Task } from "../types";

const PROJECT_INDEX = "idx:projects";
const projectKey = (id: string) => `project:${id}`;
const taskIndexKey = (projectId: string) => `idx:tasks:${projectId}`;
const taskKey = (projectId: string, taskId: string) => `task:${projectId}:${taskId}`;

async function readIds(kv: KVNamespace, key: string): Promise<string[]> {
  const value = (await kv.get(key, "json")) as string[] | null;
  return Array.isArray(value) ? value : [];
}

// ---- Projects ----

export async function listProjects(kv: KVNamespace): Promise<Project[]> {
  const ids = await readIds(kv, PROJECT_INDEX);
  const items = await Promise.all(ids.map((id) => kv.get(projectKey(id), "json")));
  return items.filter(Boolean) as Project[];
}

export async function getProject(kv: KVNamespace, id: string): Promise<Project | null> {
  return (await kv.get(projectKey(id), "json")) as Project | null;
}

export async function createProject(kv: KVNamespace, name: string): Promise<Project> {
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };
  await kv.put(projectKey(project.id), JSON.stringify(project));

  const ids = await readIds(kv, PROJECT_INDEX);
  await kv.put(PROJECT_INDEX, JSON.stringify([...ids, project.id]));
  return project;
}

/** Deletes the project, all of its task keys, and its indexes. Returns false if missing. */
export async function deleteProject(kv: KVNamespace, id: string): Promise<boolean> {
  const existing = await getProject(kv, id);
  if (!existing) return false;

  const taskIds = await readIds(kv, taskIndexKey(id));
  const projectIds = await readIds(kv, PROJECT_INDEX);

  await Promise.all([
    ...taskIds.map((taskId) => kv.delete(taskKey(id, taskId))),
    kv.delete(projectKey(id)),
    kv.delete(taskIndexKey(id)),
    kv.put(PROJECT_INDEX, JSON.stringify(projectIds.filter((pid) => pid !== id))),
  ]);
  return true;
}

// ---- Tasks ----

export async function listTasksByProject(kv: KVNamespace, projectId: string): Promise<Task[]> {
  const ids = await readIds(kv, taskIndexKey(projectId));
  const items = await Promise.all(ids.map((id) => kv.get(taskKey(projectId, id), "json")));
  const tasks = items.filter(Boolean) as Task[];
  tasks.sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  );
  return tasks;
}

export async function getTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<Task | null> {
  return (await kv.get(taskKey(projectId, taskId), "json")) as Task | null;
}

export async function createTask(kv: KVNamespace, task: Task): Promise<Task> {
  await kv.put(taskKey(task.projectId, task.id), JSON.stringify(task));

  const ids = await readIds(kv, taskIndexKey(task.projectId));
  await kv.put(taskIndexKey(task.projectId), JSON.stringify([...ids, task.id]));
  return task;
}

export async function putTask(kv: KVNamespace, task: Task): Promise<Task> {
  await kv.put(taskKey(task.projectId, task.id), JSON.stringify(task));
  return task;
}

export async function deleteTask(kv: KVNamespace, projectId: string, taskId: string): Promise<boolean> {
  const existing = await getTask(kv, projectId, taskId);
  if (!existing) return false;

  const ids = await readIds(kv, taskIndexKey(projectId));
  await Promise.all([
    kv.delete(taskKey(projectId, taskId)),
    kv.put(taskIndexKey(projectId), JSON.stringify(ids.filter((id) => id !== taskId))),
  ]);
  return true;
}
```

#### src/middleware/auth.ts

```ts
import type { MiddlewareHandler } from "hono";
import { ApiError } from "../errors";
import type { Env } from "../types";

export const auth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  // Preflight requests are handled by the CORS middleware before this; health is public.
  if (c.req.method === "OPTIONS") return next();
  if (c.req.path === "/api/v1/health") return next();

  const header = c.req.header("Authorization");
  const token =
    header && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;

  if (!token || token !== c.env.API_TOKEN) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing or invalid bearer token");
  }
  return next();
};
```

#### src/middleware/logging.ts

```ts
import type { MiddlewareHandler } from "hono";
import { ApiError } from "../errors";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  let status: number | undefined;
  try {
    await next();
    status = c.res.status;
  } catch (err) {
    status = err instanceof ApiError ? err.status : 500;
    throw err;
  } finally {
    const durationMs = Date.now() - start;
    console.log(
      JSON.stringify({
        method: c.req.method,
        path: c.req.path,
        status: status ?? 500,
        durationMs,
      }),
    );
  }
};
```

#### src/routes/registry.ts

```ts
export interface RouteEntry {
  template: string;
  methods: string[];
}

export const ROUTE_TABLE: RouteEntry[] = [
  { template: "/api/v1/health", methods: ["GET"] },
  { template: "/api/v1/projects", methods: ["GET", "POST"] },
  { template: "/api/v1/projects/:projectId", methods: ["GET", "DELETE"] },
  { template: "/api/v1/projects/:projectId/tasks", methods: ["GET", "POST"] },
  { template: "/api/v1/projects/:projectId/tasks/:taskId", methods: ["GET", "PATCH", "DELETE"] },
];

export function templateMatches(template: string, pathname: string): boolean {
  const pattern = template.replace(/:[^/]+/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(pathname);
}
```

#### src/routes/projects.ts

```ts
import { Hono } from "hono";
import { ApiError } from "../errors";
import { readJsonBody, validate } from "../validation/validate";
import { createProjectSchema } from "../validation/schemas";
import { createProject, deleteProject, getProject, listProjects } from "../storage/kv";
import { tasksRoutes } from "./tasks";
import type { Env } from "../types";

export const projectsRoutes = new Hono<{ Bindings: Env }>();

projectsRoutes.get("/", async (c) => {
  const projects = await listProjects(c.env.TASKS);
  return c.json({ data: projects });
});

projectsRoutes.post("/", async (c) => {
  const body = validate(createProjectSchema, await readJsonBody(c));
  const project = await createProject(c.env.TASKS, body.name);
  return c.json(project, 201);
});

projectsRoutes.get("/:projectId", async (c) => {
  const project = await getProject(c.env.TASKS, c.req.param("projectId"));
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  return c.json(project);
});

projectsRoutes.delete("/:projectId", async (c) => {
  const deleted = await deleteProject(c.env.TASKS, c.req.param("projectId"));
  if (!deleted) throw new ApiError(404, "NOT_FOUND", "Project not found");
  return c.body(null, 204);
});

projectsRoutes.route("/:projectId/tasks", tasksRoutes);
```

#### src/routes/tasks.ts

```ts
import { Hono } from "hono";
import { ApiError } from "../errors";
import { readJsonBody, validate } from "../validation/validate";
import { createTaskSchema, listTasksQuerySchema, updateTaskSchema } from "../validation/schemas";
import { createTask, deleteTask, getProject, getTask, listTasksByProject, putTask } from "../storage/kv";
import type { Env, Task } from "../types";

export const tasksRoutes = new Hono<{ Bindings: Env }>();

tasksRoutes.get("/", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getProject(c.env.TASKS, projectId);
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");

  const query = validate(listTasksQuerySchema, {
    status: c.req.query("status"),
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });

  const all = await listTasksByProject(c.env.TASKS, projectId);
  const filtered = query.status ? all.filter((t) => t.status === query.status) : all;
  const total = filtered.length;
  const start = (query.page - 1) * query.pageSize;

  return c.json({
    data: filtered.slice(start, start + query.pageSize),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  });
});

tasksRoutes.post("/", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getProject(c.env.TASKS, projectId);
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");

  const body = validate(createTaskSchema, await readJsonBody(c));
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    projectId,
    title: body.title,
    status: body.status ?? "todo",
    createdAt: now,
    updatedAt: now,
  };
  if (body.description !== undefined) task.description = body.description;
  if (body.assignee !== undefined) task.assignee = body.assignee;

  await createTask(c.env.TASKS, task);
  return c.json(task, 201);
});

tasksRoutes.get("/:taskId", async (c) => {
  const task = await getTask(c.env.TASKS, c.req.param("projectId"), c.req.param("taskId"));
  if (!task) throw new ApiError(404, "NOT_FOUND", "Task not found");
  return c.json(task);
});

tasksRoutes.patch("/:taskId", async (c) => {
  const projectId = c.req.param("projectId");
  const taskId = c.req.param("taskId");
  const existing = await getTask(c.env.TASKS, projectId, taskId);
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Task not found");

  const updates = validate(updateTaskSchema, await readJsonBody(c));
  const next: Task = { ...existing };

  if (updates.title !== undefined) next.title = updates.title;
  if (updates.status !== undefined) next.status = updates.status;
  if (updates.description === null) delete next.description;
  else if (updates.description !== undefined) next.description = updates.description;
  if (updates.assignee === null) delete next.assignee;
  else if (updates.assignee !== undefined) next.assignee = updates.assignee;
  next.updatedAt = new Date().toISOString();

  await putTask(c.env.TASKS, next);
  return c.json(next);
});

tasksRoutes.delete("/:taskId", async (c) => {
  const deleted = await deleteTask(c.env.TASKS, c.req.param("projectId"), c.req.param("taskId"));
  if (!deleted) throw new ApiError(404, "NOT_FOUND", "Task not found");
  return c.body(null, 204);
});
```

#### src/index.ts

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ApiError, errorBody } from "./errors";
import { auth } from "./middleware/auth";
import { requestLogger } from "./middleware/logging";
import { projectsRoutes } from "./routes/projects";
import { ROUTE_TABLE, templateMatches } from "./routes/registry";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use("*", requestLogger);
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

const api = new Hono<{ Bindings: Env }>();
api.use("*", auth);
api.get("/health", (c) => c.json({ ok: true }));
api.route("/projects", projectsRoutes);

app.route("/api/v1", api);

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message, err.details), err.status);
  }
  console.error(err);
  return c.json(errorBody("INTERNAL_ERROR", "Internal server error"), 500);
});

app.notFound((c) => {
  const match = ROUTE_TABLE.find((r) => templateMatches(r.template, c.req.path));
  if (match && !match.methods.includes(c.req.method)) {
    return c.json(
      errorBody("METHOD_NOT_ALLOWED", `Method '${c.req.method}' is not allowed on this route`),
      405,
    );
  }
  return c.json(errorBody("NOT_FOUND", "Route not found"), 404);
});

export default app;
```

#### test/api.spec.ts

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const TOKEN = "test-token";
const headers = (extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  ...extra,
});

async function createProject(name = "Board") {
  const res = await SELF.fetch("http://x/api/v1/projects", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name }),
  });
  return (await res.json()) as { id: string };
}

async function createTask(projectId: string, body: Record<string, unknown> = { title: "Task" }) {
  const res = await SELF.fetch(`http://x/api/v1/projects/${projectId}/tasks`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return (await res.json()) as { id: string };
}

describe("team task board API", () => {
  it("GET /health requires no auth", async () => {
    const res = await SELF.fetch("http://x/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects requests without a bearer token with 401", async () => {
    const res = await SELF.fetch("http://x/api/v1/projects");
    expect(res.status).toBe(401);
    expect((await res.json()) as any).toEqual({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid bearer token" },
    });
  });

  it("returns 404 error shape for unknown routes", async () => {
    const res = await SELF.fetch("http://x/api/v1/nope", { headers: headers() });
    expect(res.status).toBe(404);
    expect((await res.json()) as any).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  it("returns 405 for a known route with the wrong method", async () => {
    const res = await SELF.fetch("http://x/api/v1/projects", {
      method: "DELETE",
      headers: headers(),
    });
    expect(res.status).toBe(405);
    expect(((await res.json()) as any).error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("validates project creation bodies", async () => {
    const res = await SELF.fetch("http://x/api/v1/projects", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("performs project CRUD", async () => {
    const created = await createProject();
    const get = await SELF.fetch(`http://x/api/v1/projects/${created.id}`, { headers: headers() });
    expect(get.status).toBe(200);

    const list = await SELF.fetch("http://x/api/v1/projects", { headers: headers() });
    expect(((await list.json()) as any).data.map((p: any) => p.id)).toContain(created.id);

    const del = await SELF.fetch(`http://x/api/v1/projects/${created.id}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(del.status).toBe(204);

    const missing = await SELF.fetch(`http://x/api/v1/projects/${created.id}`, {
      headers: headers(),
    });
    expect(missing.status).toBe(404);
  });

  it("supports task filtering and pagination", async () => {
    const project = await createProject();
    for (let i = 0; i < 25; i++) {
      await createTask(project.id, { title: `Task ${i}` });
    }
    await createTask(project.id, { title: "Done", status: "done" });

    const page2 = await SELF.fetch(
      `http://x/api/v1/projects/${project.id}/tasks?page=2&pageSize=10`,
      { headers: headers() },
    );
    const body = (await page2.json()) as any;
    expect(body.data).toHaveLength(10);
    expect(body.pagination.total).toBe(25);
    expect(body.pagination.totalPages).toBe(3);

    const done = await SELF.fetch(
      `http://x/api/v1/projects/${project.id}/tasks?status=done`,
      { headers: headers() },
    );
    expect(((await done.json()) as any).pagination.total).toBe(1);
  });

  it("PATCHes tasks and can clear nullable fields", async () => {
    const project = await createProject();
    const task = await createTask(project.id, { title: "Old", assignee: "sam" });

    const patch = await SELF.fetch(
      `http://x/api/v1/projects/${project.id}/tasks/${task.id}`,
      {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status: "in_progress", assignee: null }),
      },
    );
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as any;
    expect(updated.status).toBe("in_progress");
    expect("assignee" in updated).toBe(false);
  });

  it("cascades task deletion when a project is deleted", async () => {
    const project = await createProject();
    await createTask(project.id);
    await SELF.fetch(`http://x/api/v1/projects/${project.id}`, {
      method: "DELETE",
      headers: headers(),
    });
    const res = await SELF.fetch(`http://x/api/v1/projects/${project.id}/tasks`, {
      headers: headers(),
    });
    expect(res.status).toBe(404);
  });
});
```

#### README.md

````markdown
# Team Task Board API

REST API built on Cloudflare Workers. Router: [Hono](https://hono.dev), validation: [zod](https://zod.dev), storage: one KV namespace bound as `TASKS`.

## Setup

```bash
npm install
# create the KV namespace and paste the id into wrangler.toml
npx wrangler kv namespace create TASKS
# production bearer token
npx wrangler secret put API_TOKEN
# local dev: copy .dev.vars.example -> .dev.vars

npm run dev
npm run deploy
```

## Tests

```bash
npm run test
```

## KV layout

| Key | Value |
| --- | --- |
| `idx:projects` | `string[]` of project ids |
| `project:{id}` | `Project` JSON |
| `idx:tasks:{projectId}` | `string[]` of task ids |
| `task:{projectId}:{taskId}` | `Task` JSON |

Indexes of ids avoid KV "list" operations; project deletion cleans up all related keys.

## Conventions

- All endpoints except `GET /api/v1/health` require `Authorization: Bearer <API_TOKEN>`.
- Errors always use `{ "error": { "code", "message" } }` with codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `INTERNAL_ERROR` (500).
- Task PATCH treats `null` for `description`/`assignee` as "clear the field".
- Task listing supports `?status=todo|in_progress|done&page=N&pageSize=N` (max pageSize 100) and returns `{ data, pagination }`.
- Every request is logged as JSON: `{ method, path, status, durationMs }`.
````

### Notes on the design

- **Mounting/auth:** everything is mounted under `/api/v1` on a sub-app; the `auth` middleware runs for all of it, with explicit `OPTIONS` and `/api/v1/health` bypasses. CORS is registered before auth, so preflights never hit the token check.
- **405 vs 404:** `registry.ts` keeps a route template table so unknown paths return a proper `METHOD_NOT_ALLOWED` (405) only when the path matches a real route with the wrong method.
- **Validation:** handlers parse the JSON body through `readJsonBody` (turning malformed JSON into a clean 400) and validate with zod; issues are reported with path + message.
- **Logging:** the middleware measures duration even when a route throws, deriving the status from `ApiError` (so thrown 404s are logged as 404, not 500).
- To deploy, you'll only need to fill in the KV namespace id and set the `API_TOKEN` secret as described in the README.