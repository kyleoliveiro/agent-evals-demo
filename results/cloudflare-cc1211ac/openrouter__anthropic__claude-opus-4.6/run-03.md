<!-- model: openrouter/anthropic/claude-opus-4.6 | run: 3 | framework: Hono -->

# Team Task Board API — Cloudflare Workers

Here's the complete project. I'm using **Hono** (the de-facto Workers framework) for routing/middleware and **Zod** for validation.

## Project Structure

```
├── package.json
├── tsconfig.json
├── wrangler.toml
└── src/
    ├── index.ts
    ├── types.ts
    ├── middleware/
    │   ├── auth.ts
    │   ├── cors.ts
    │   ├── logger.ts
    │   └── errors.ts
    ├── routes/
    │   ├── health.ts
    │   ├── projects.ts
    │   └── tasks.ts
    └── services/
        ├── projects.ts
        └── tasks.ts
```

---

## `package.json`

```json
{
  "name": "team-task-board",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240815.0",
    "typescript": "^5.5.4",
    "wrangler": "^3.72.0"
  }
}
```

## `wrangler.toml`

```toml
name = "team-task-board"
main = "src/index.ts"
compatibility_date = "2024-08-15"

# KV namespace – run `wrangler kv namespace create TASKS` and paste the id below
[[kv_namespaces]]
binding = "TASKS"
id = "<YOUR_KV_NAMESPACE_ID>"
# For `wrangler dev --local` a preview id is also useful:
# preview_id = "<YOUR_PREVIEW_KV_NAMESPACE_ID>"

# Secret – set via `wrangler secret put API_TOKEN`
# [vars]
# API_TOKEN is a secret binding, not set here.
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono"
  },
  "include": ["src"]
}
```

---

## `src/types.ts`

```ts
import type { KVNamespace } from "@cloudflare/workers-types";

// ── Cloudflare bindings ──────────────────────────────────────────────
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}

// ── Domain models ────────────────────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  createdAt: string; // ISO-8601
}

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

// ── KV key-design helpers ────────────────────────────────────────────
//  project:<id>                     → Project JSON
//  project_index                    → string[] of project ids
//  task:<id>                        → Task JSON
//  task_index:project:<projectId>   → string[] of task ids

export const kvKeys = {
  project: (id: string) => `project:${id}`,
  projectIndex: () => "project_index",
  task: (id: string) => `task:${id}`,
  taskIndex: (projectId: string) => `task_index:project:${projectId}`,
} as const;

// ── Standard error body ──────────────────────────────────────────────
export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}
```

---

## `src/middleware/cors.ts`

```ts
import { cors } from "hono/cors";

export const corsMiddleware = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["X-Request-Id"],
  maxAge: 86400,
});
```

## `src/middleware/auth.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

/**
 * Bearer-token auth checked against the API_TOKEN secret.
 * Skipped for the /api/v1/health endpoint and CORS preflight.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    // Allow preflight through
    if (c.req.method === "OPTIONS") return next();

    // Skip auth for health check
    if (c.req.path === "/api/v1/health") return next();

    const header = c.req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Missing or malformed Authorization header" } },
        401,
      );
    }

    const token = header.slice(7);
    if (token !== c.env.API_TOKEN) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid API token" } },
        401,
      );
    }

    await next();
  },
);
```

## `src/middleware/logger.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const loggerMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const status = c.res.status;
    console.log(
      JSON.stringify({
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs: duration,
      }),
    );
  },
);
```

## `src/middleware/errors.ts`

```ts
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../types";

/**
 * Global error handler — catches thrown HTTPExceptions and unexpected errors
 * and normalises them to the standard { error: { code, message } } shape.
 */
export const errorHandler = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof HTTPException) {
        return c.json(
          { error: { code: "HTTP_ERROR", message: err.message } },
          err.status,
        );
      }
      console.error("Unhandled error", err);
      return c.json(
        { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
        500,
      );
    }
  },
);
```

---

## `src/services/projects.ts`

```ts
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Project } from "../types";
import { kvKeys } from "../types";

export class ProjectService {
  constructor(private kv: KVNamespace) {}

  // ── helpers ──────────────────────────────────────────────────────
  private async getIndex(): Promise<string[]> {
    const raw = await this.kv.get(kvKeys.projectIndex());
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  private async setIndex(ids: string[]): Promise<void> {
    await this.kv.put(kvKeys.projectIndex(), JSON.stringify(ids));
  }

  // ── public API ───────────────────────────────────────────────────
  async list(): Promise<Project[]> {
    const ids = await this.getIndex();
    if (ids.length === 0) return [];

    const results = await Promise.all(
      ids.map((id) => this.kv.get(kvKeys.project(id))),
    );
    return results
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as Project);
  }

  async getById(id: string): Promise<Project | null> {
    const raw = await this.kv.get(kvKeys.project(id));
    return raw ? (JSON.parse(raw) as Project) : null;
  }

  async create(project: Project): Promise<void> {
    const ids = await this.getIndex();
    ids.push(project.id);
    await Promise.all([
      this.kv.put(kvKeys.project(project.id), JSON.stringify(project)),
      this.setIndex(ids),
    ]);
  }

  async delete(id: string): Promise<void> {
    const ids = await this.getIndex();
    const filtered = ids.filter((i) => i !== id);
    await Promise.all([
      this.kv.delete(kvKeys.project(id)),
      this.setIndex(filtered),
    ]);
  }
}
```

## `src/services/tasks.ts`

```ts
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Task, TaskStatus } from "../types";
import { kvKeys } from "../types";

export interface TaskListOptions {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface PaginatedTasks {
  data: Task[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export class TaskService {
  constructor(private kv: KVNamespace) {}

  // ── helpers ──────────────────────────────────────────────────────
  private async getIndex(projectId: string): Promise<string[]> {
    const raw = await this.kv.get(kvKeys.taskIndex(projectId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  private async setIndex(projectId: string, ids: string[]): Promise<void> {
    await this.kv.put(kvKeys.taskIndex(projectId), JSON.stringify(ids));
  }

  // ── public API ───────────────────────────────────────────────────
  async list(projectId: string, opts: TaskListOptions): Promise<PaginatedTasks> {
    const ids = await this.getIndex(projectId);

    // Fetch all tasks for this project (KV doesn't support server-side filtering)
    const rawTasks = await Promise.all(
      ids.map((id) => this.kv.get(kvKeys.task(id))),
    );
    let tasks = rawTasks
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as Task);

    // Optional status filter
    if (opts.status) {
      tasks = tasks.filter((t) => t.status === opts.status);
    }

    // Sort newest first
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalItems = tasks.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / opts.pageSize));
    const start = (opts.page - 1) * opts.pageSize;
    const data = tasks.slice(start, start + opts.pageSize);

    return {
      data,
      pagination: { page: opts.page, pageSize: opts.pageSize, totalItems, totalPages },
    };
  }

  async getById(taskId: string): Promise<Task | null> {
    const raw = await this.kv.get(kvKeys.task(taskId));
    return raw ? (JSON.parse(raw) as Task) : null;
  }

  async create(task: Task): Promise<void> {
    const ids = await this.getIndex(task.projectId);
    ids.push(task.id);
    await Promise.all([
      this.kv.put(kvKeys.task(task.id), JSON.stringify(task)),
      this.setIndex(task.projectId, ids),
    ]);
  }

  async update(task: Task): Promise<void> {
    await this.kv.put(kvKeys.task(task.id), JSON.stringify(task));
  }

  async delete(projectId: string, taskId: string): Promise<void> {
    const ids = await this.getIndex(projectId);
    const filtered = ids.filter((i) => i !== taskId);
    await Promise.all([
      this.kv.delete(kvKeys.task(taskId)),
      this.setIndex(projectId, filtered),
    ]);
  }

  /** Delete every task belonging to a project (used on project deletion). */
  async deleteAllForProject(projectId: string): Promise<void> {
    const ids = await this.getIndex(projectId);
    await Promise.all([
      ...ids.map((id) => this.kv.delete(kvKeys.task(id))),
      this.kv.delete(kvKeys.taskIndex(projectId)),
    ]);
  }
}
```

---

## `src/routes/health.ts`

```ts
import { Hono } from "hono";
import type { Env } from "../types";

const health = new Hono<{ Bindings: Env }>();

health.get("/", (c) => c.json({ ok: true }));

export default health;
```

## `src/routes/projects.ts`

```ts
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { ProjectService } from "../services/projects";
import { TaskService } from "../services/tasks";

const projects = new Hono<{ Bindings: Env }>();

// ── Validation schemas ────────────────────────────────────────────────
const createProjectSchema = z.object({
  name: z.string().min(1, "name is required").max(128),
});

// ── Helpers ───────────────────────────────────────────────────────────
function svc(kv: KVNamespace) {
  return new ProjectService(kv);
}

// ── Routes ────────────────────────────────────────────────────────────
projects.get("/", async (c) => {
  const list = await svc(c.env.TASKS).list();
  return c.json({ data: list });
});

projects.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" } },
      400,
    );
  }

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
  }

  const now = new Date().toISOString();
  const project = {
    id: crypto.randomUUID(),
    name: parsed.data.name,
    createdAt: now,
  };

  await svc(c.env.TASKS).create(project);
  return c.json({ data: project }, 201);
});

projects.get("/:projectId", async (c) => {
  const project = await svc(c.env.TASKS).getById(c.req.param("projectId"));
  if (!project) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Project not found" } },
      404,
    );
  }
  return c.json({ data: project });
});

projects.delete("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await svc(c.env.TASKS).getById(projectId);
  if (!project) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Project not found" } },
      404,
    );
  }

  // Cascade-delete tasks
  const taskSvc = new TaskService(c.env.TASKS);
  await taskSvc.deleteAllForProject(projectId);
  await svc(c.env.TASKS).delete(projectId);

  return c.json({ data: { deleted: true } });
});

export default projects;
```

## `src/routes/tasks.ts`

```ts
import { Hono } from "hono";
import { z } from "zod";
import type { Env, TaskStatus } from "../types";
import { ProjectService } from "../services/projects";
import { TaskService } from "../services/tasks";

const tasks = new Hono<{ Bindings: Env }>();

// ── Validation schemas ────────────────────────────────────────────────
const TASK_STATUSES = ["todo", "in_progress", "done"] as const;

const createTaskSchema = z.object({
  title: z.string().min(1, "title is required").max(256),
  description: z.string().max(4096).optional(),
  status: z.enum(TASK_STATUSES).optional().default("todo"),
  assignee: z.string().max(128).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().max(4096).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.string().max(128).nullable().optional(),
}).refine((o) => Object.keys(o).length > 0, {
  message: "At least one field must be provided",
});

const paginationSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ── Middleware: verify project exists ─────────────────────────────────
tasks.use("/*", async (c, next) => {
  const projectId = c.req.param("projectId");
  if (!projectId) return next();
  const project = await new ProjectService(c.env.TASKS).getById(projectId);
  if (!project) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Project not found" } },
      404,
    );
  }
  await next();
});

// ── Routes ────────────────────────────────────────────────────────────
tasks.get("/", async (c) => {
  const projectId = c.req.param("projectId")!;
  const query = paginationSchema.safeParse({
    status: c.req.query("status") || undefined,
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });

  if (!query.success) {
    const message = query.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
  }

  const svc = new TaskService(c.env.TASKS);
  const result = await svc.list(projectId, {
    status: query.data.status as TaskStatus | undefined,
    page: query.data.page,
    pageSize: query.data.pageSize,
  });

  return c.json(result);
});

tasks.post("/", async (c) => {
  const projectId = c.req.param("projectId")!;
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" } },
      400,
    );
  }

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
  }

  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    projectId,
    title: parsed.data.title,
    ...(parsed.data.description !== undefined && { description: parsed.data.description }),
    status: parsed.data.status,
    ...(parsed.data.assignee !== undefined && { assignee: parsed.data.assignee }),
    createdAt: now,
    updatedAt: now,
  };

  const svc = new TaskService(c.env.TASKS);
  await svc.create(task);
  return c.json({ data: task }, 201);
});

tasks.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId")!;
  const projectId = c.req.param("projectId")!;
  const svc = new TaskService(c.env.TASKS);
  const task = await svc.getById(taskId);

  if (!task || task.projectId !== projectId) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Task not found" } },
      404,
    );
  }
  return c.json({ data: task });
});

tasks.patch("/:taskId", async (c) => {
  const taskId = c.req.param("taskId")!;
  const projectId = c.req.param("projectId")!;
  const svc = new TaskService(c.env.TASKS);
  const existing = await svc.getById(taskId);

  if (!existing || existing.projectId !== projectId) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Task not found" } },
      404,
    );
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" } },
      400,
    );
  }

  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
  }

  const updates = parsed.data;
  const updated = {
    ...existing,
    ...(updates.title !== undefined && { title: updates.title }),
    ...(updates.status !== undefined && { status: updates.status }),
    // Allow null to clear optional fields
    ...(updates.description !== undefined && {
      description: updates.description ?? undefined,
    }),
    ...(updates.assignee !== undefined && {
      assignee: updates.assignee ?? undefined,
    }),
    updatedAt: new Date().toISOString(),
  };

  await svc.update(updated);
  return c.json({ data: updated });
});

tasks.delete("/:taskId", async (c) => {
  const taskId = c.req.param("taskId")!;
  const projectId = c.req.param("projectId")!;
  const svc = new TaskService(c.env.TASKS);
  const existing = await svc.getById(taskId);

  if (!existing || existing.projectId !== projectId) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Task not found" } },
      404,
    );
  }

  await svc.delete(projectId, taskId);
  return c.json({ data: { deleted: true } });
});

export default tasks;
```

---

## `src/index.ts`

```ts
import { Hono } from "hono";
import type { Env } from "./types";

// Middleware
import { corsMiddleware } from "./middleware/cors";
import { authMiddleware } from "./middleware/auth";
import { loggerMiddleware } from "./middleware/logger";
import { errorHandler } from "./middleware/errors";

// Route modules
import health from "./routes/health";
import projects from "./routes/projects";
import tasks from "./routes/tasks";

// ── App ───────────────────────────────────────────────────────────────
const app = new Hono<{ Bindings: Env }>();

// Global middleware (order matters)
app.use("*", errorHandler);
app.use("*", corsMiddleware);
app.use("*", loggerMiddleware);
app.use("*", authMiddleware);

// ── Mount routes under /api/v1 ───────────────────────────────────────
const v1 = new Hono<{ Bindings: Env }>();

v1.route("/health", health);
v1.route("/projects", projects);
v1.route("/projects/:projectId/tasks", tasks);

app.route("/api/v1", v1);

// ── 404 catch-all ────────────────────────────────────────────────────
app.all("*", (c) =>
  c.json(
    { error: { code: "NOT_FOUND", message: `Cannot ${c.req.method} ${c.req.path}` } },
    404,
  ),
);

// ── Method-not-allowed for known route prefixes ──────────────────────
// Hono returns 404 for wrong methods by default; the catch-all above
// already handles this with the correct error shape.

export default app;
```

---

## How to run

```bash
# 1. Install dependencies
npm install

# 2. Create the KV namespace
npx wrangler kv namespace create TASKS
# ⇒ copy the printed id into wrangler.toml

# 3. Set the API secret
npx wrangler secret put API_TOKEN
# ⇒ paste your token when prompted

# 4. Local dev
npm run dev

# 5. Deploy to Cloudflare
npm run deploy
```

### Quick smoke test

```bash
TOKEN="your-secret-token"
BASE="http://localhost:8787/api/v1"

# Health (no auth required)
curl $BASE/health

# Create a project
curl -s -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Redesign"}' | jq .

# List projects
curl -s $BASE/projects -H "Authorization: Bearer $TOKEN" | jq .

# Create a task (use the projectId from above)
PID="<project-id>"
curl -s -X POST $BASE/projects/$PID/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Design mockups","assignee":"alice","status":"in_progress"}' | jq .

# List tasks with filter + pagination
curl -s "$BASE/projects/$PID/tasks?status=in_progress&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Partial update
TID="<task-id>"
curl -s -X PATCH $BASE/projects/$PID/tasks/$TID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}' | jq .

# Delete cascade
curl -s -X DELETE $BASE/projects/$PID \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

### Design decisions & notes

| Decision | Rationale |
|---|---|
| **Hono** | Built for Workers; tiny bundle, middleware-first, type-safe bindings |
| **Zod** | Composable validation with excellent error messages |
| **KV index arrays** | KV is key-value only—we store lightweight index arrays (`project_index`, `task_index:project:<id>`) to support listing without `list()` prefix scans, which are eventually-consistent and have a 1 000-key page limit |
| **Project-existence middleware on tasks** | Every task route automatically 404s if the parent project is missing—DRY |
| **Nullable fields in PATCH** | Sending `"assignee": null` clears the field; omitting it leaves it unchanged |
| **crypto.randomUUID()** | Available natively in the Workers runtime; no extra dependency |
| **Structured JSON logs** | `console.log` in Workers is captured by `wrangler tail` and Logpush |