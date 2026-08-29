<!-- model: openrouter/moonshotai/kimi-k3 | run: 2 | framework: Hono -->

Below is a complete, production-grade implementation built on [Hono](https://hono.dev) (the de-facto standard routing/middleware framework for Workers) + `zod` for validation, backed by Cloudflare KV. It includes auth, CORS, request logging, unified error shapes with proper `405` handling (`Allow` header), cursor-free KV pagination, and a clean KV key layout.

**KV key layout:**
- `project:{id}` → Project
- `task:{projectId}:{taskId}` → Task (prefix-listable per project)

---

### `package.json`
```json
{
  "name": "team-task-board-api",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.6.5",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250829.0",
    "typescript": "^5.9.2",
    "wrangler": "^4.30.0"
  }
}
```

### `wrangler.toml`
```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2026-08-01"

# Create the KV namespace once and paste the real id below:
#   npx wrangler kv namespace create TASKS
kv_namespaces = [
  { binding = "TASKS", id = "replace-with-production-kv-id", preview_id = "replace-with-preview-kv-id" }
]

# The API_TOKEN is a *secret*. Set it with:
#   npx wrangler secret put API_TOKEN
# For local dev, copy .dev.vars.example to .dev.vars.
```

### `tsconfig.json`
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
    "isolatedModules": true
  },
  "include": ["src"]
}
```

### `.gitignore`
```
node_modules
.dev.vars
.wrangler
dist
```

### `.dev.vars.example`
```
API_TOKEN=dev-token-change-me
```

---

### `src/env.ts`
```ts
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}
```

### `src/lib/errors.ts`
```ts
import type { Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";

export function errorResponse(
  c: Context,
  status: StatusCode,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}

export function validationError(c: Context, err: ZodError) {
  const message = err.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "value"}: ${i.message}`)
    .join("; ");
  return errorResponse(c, 400, "VALIDATION_ERROR", message);
}
```

### `src/lib/store.ts`
```ts
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

export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}

export interface ListTasksQuery {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

const PROJECT_PREFIX = "project:";
const projectKey = (id: string) => `project:${id}`;
const taskKey = (projectId: string, taskId: string) =>
  `task:${projectId}:${taskId}`;
const taskPrefix = (projectId: string) => `task:${projectId}:`;

const now = () => new Date().toISOString();

function byCreatedAt<T extends { createdAt: string; id: string }>(a: T, b: T) {
  // Deterministic ordering so pagination is stable (tie-break on id).
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);
}

async function listAllKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  while (true) {
    const res = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of res.keys) names.push(k.name);
    if (res.list_complete) break;
    cursor = res.cursor || undefined;
  }
  return names;
}

// ---------- Projects ----------

export async function createProject(
  kv: KVNamespace,
  name: string,
): Promise<Project> {
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    createdAt: now(),
  };
  await kv.put(projectKey(project.id), JSON.stringify(project));
  return project;
}

export async function getProject(
  kv: KVNamespace,
  id: string,
): Promise<Project | null> {
  return kv.get<Project>(projectKey(id), "json");
}

export async function listProjects(kv: KVNamespace): Promise<Project[]> {
  const names = await listAllKeys(kv, PROJECT_PREFIX);
  const items = (
    await Promise.all(names.map((n) => kv.get<Project>(n, "json")))
  ).filter((p): p is Project => p !== null);
  items.sort(byCreatedAt);
  return items;
}

export async function deleteProject(kv: KVNamespace, id: string): Promise<void> {
  const taskKeys = await listAllKeys(kv, taskPrefix(id));
  await Promise.all([
    ...taskKeys.map((k) => kv.delete(k)),
    kv.delete(projectKey(id)),
  ]);
}

// ---------- Tasks ----------

export async function createTask(
  kv: KVNamespace,
  projectId: string,
  input: {
    title: string;
    description?: string;
    status?: TaskStatus;
    assignee?: string;
  },
): Promise<Task> {
  const timestamp = now();
  const task: Task = {
    id: crypto.randomUUID(),
    projectId,
    title: input.title,
    status: input.status ?? "todo",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (input.description !== undefined) task.description = input.description;
  if (input.assignee !== undefined) task.assignee = input.assignee;
  await kv.put(taskKey(projectId, task.id), JSON.stringify(task));
  return task;
}

export async function getTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<Task | null> {
  return kv.get<Task>(taskKey(projectId, taskId), "json");
}

export async function listTasks(
  kv: KVNamespace,
  projectId: string,
  query: ListTasksQuery,
): Promise<{ items: Task[]; total: number }> {
  const names = await listAllKeys(kv, taskPrefix(projectId));
  let items = (
    await Promise.all(names.map((n) => kv.get<Task>(n, "json")))
  ).filter((t): t is Task => t !== null);

  if (query.status) items = items.filter((t) => t.status === query.status);
  items.sort(byCreatedAt);

  const total = items.length;
  const start = (query.page - 1) * query.pageSize;
  return { items: items.slice(start, start + query.pageSize), total };
}

export async function updateTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
  patch: TaskPatch,
): Promise<Task | null> {
  const key = taskKey(projectId, taskId);
  const existing = await kv.get<Task>(key, "json");
  if (!existing) return null;

  const next: Task = { ...existing, updatedAt: now() };

  if (patch.title !== undefined) next.title = patch.title;
  if (patch.status !== undefined) next.status = patch.status;

  // `null` explicitly clears description / assignee.
  if ("description" in patch) {
    if (patch.description === null) delete next.description;
    else next.description = patch.description;
  }
  if ("assignee" in patch) {
    if (patch.assignee === null) delete next.assignee;
    else next.assignee = patch.assignee;
  }

  await kv.put(key, JSON.stringify(next));
  return next;
}

export async function deleteTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<boolean> {
  const existing = await getTask(kv, projectId, taskId);
  if (!existing) return false;
  await kv.delete(taskKey(projectId, taskId));
  return true;
}
```

### `src/routes/projects.ts`
```ts
import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import type { Env } from "../env";
import * as store from "../lib/store";
import { errorResponse, validationError } from "../lib/errors";

const STATUS = ["todo", "in_progress", "done"] as const;

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
});

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(500),
  description: z.string().max(10_000).optional(),
  status: z.enum(STATUS).optional(),
  assignee: z.string().trim().min(1).max(200).optional(),
});

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.union([z.string().max(10_000), z.null()]).optional(),
    status: z.enum(STATUS).optional(),
    assignee: z.union([z.string().trim().min(1).max(200), z.null()]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update.",
  });

const listTasksQuerySchema = z.object({
  status: z.enum(STATUS).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

const notFound = (c: Context, what: string, id: string) =>
  errorResponse(c, 404, "NOT_FOUND", `${what} '${id}' was not found.`);

// Mounted at /api/v1/projects
export const projects = new Hono<{ Bindings: Env }>();

// GET /projects
projects.get("/", async (c) => {
  const data = await store.listProjects(c.env.TASKS);
  return c.json({ data });
});

// POST /projects
projects.post("/", async (c) => {
  const parsed = createProjectSchema.safeParse(await readJsonBody(c));
  if (!parsed.success) return validationError(c, parsed.error);
  const project = await store.createProject(c.env.TASKS, parsed.data.name);
  return c.json(project, 201);
});

// GET /projects/:projectId
projects.get("/:projectId", async (c) => {
  const id = c.req.param("projectId");
  const project = await store.getProject(c.env.TASKS, id);
  if (!project) return notFound(c, "Project", id);
  return c.json(project);
});

// DELETE /projects/:projectId (also deletes its tasks)
projects.delete("/:projectId", async (c) => {
  const id = c.req.param("projectId");
  const project = await store.getProject(c.env.TASKS, id);
  if (!project) return notFound(c, "Project", id);
  await store.deleteProject(c.env.TASKS, id);
  return c.json({ deleted: true });
});

// GET /projects/:projectId/tasks?status=&page=&pageSize=
projects.get("/:projectId/tasks", async (c) => {
  const parsedQuery = listTasksQuerySchema.safeParse({
    status: c.req.query("status"),
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });
  if (!parsedQuery.success) return validationError(c, parsedQuery.error);
  const { status, page, pageSize } = parsedQuery.data;

  const projectId = c.req.param("projectId");
  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) return notFound(c, "Project", projectId);

  const { items, total } = await store.listTasks(c.env.TASKS, projectId, {
    status,
    page,
    pageSize,
  });

  return c.json({
    data: items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});

// POST /projects/:projectId/tasks
projects.post("/:projectId/tasks", async (c) => {
  const parsed = createTaskSchema.safeParse(await readJsonBody(c));
  if (!parsed.success) return validationError(c, parsed.error);

  const projectId = c.req.param("projectId");
  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) return notFound(c, "Project", projectId);

  const task = await store.createTask(c.env.TASKS, projectId, parsed.data);
  return c.json(task, 201);
});

// GET /projects/:projectId/tasks/:taskId
projects.get("/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  const task = await store.getTask(c.env.TASKS, projectId, taskId);
  if (!task) return notFound(c, "Task", taskId);
  return c.json(task);
});

// PATCH /projects/:projectId/tasks/:taskId
projects.patch("/:projectId/tasks/:taskId", async (c) => {
  const parsed = updateTaskSchema.safeParse(await readJsonBody(c));
  if (!parsed.success) return validationError(c, parsed.error);

  const { projectId, taskId } = c.req.param();
  const updated = await store.updateTask(
    c.env.TASKS,
    projectId,
    taskId,
    parsed.data,
  );
  if (!updated) return notFound(c, "Task", taskId);
  return c.json(updated);
});

// DELETE /projects/:projectId/tasks/:taskId
projects.delete("/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  const deleted = await store.deleteTask(c.env.TASKS, projectId, taskId);
  if (!deleted) return notFound(c, "Task", taskId);
  return c.json({ deleted: true });
});
```

### `src/index.ts`
```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { errorResponse } from "./lib/errors";
import { projects } from "./routes/projects";

const HEALTH_PATH = "/api/v1/health";

// Constant-time-ish comparison for the bearer token.
function safeEqual(a: string, b: string): boolean {
  let result = a.length ^ b.length;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Convert Hono route paths like "/projects/:id/tasks" into regexes.
function pathToRegex(path: string): RegExp {
  const pattern = path
    .split("/")
    .map((seg) =>
      seg.startsWith(":")
        ? "[^/]+"
        : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${pattern}$`);
}

const app = new Hono<{ Bindings: Env }>();

// 1. Request logging (outermost: also logs errors that hit onError).
app.use("*", async (c, next) => {
  const start = Date.now();
  try {
    await next();
  } finally {
    console.log(
      JSON.stringify({
        method: c.req.method,
        path: c.req.path,
        status: c.res?.status ?? 500,
        durationMs: Date.now() - start,
      }),
    );
  }
});

// 2. CORS (handles browser preflight OPTIONS before auth).
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  }),
);

// 3. Bearer auth for everything except /health.
app.use("/api/v1/*", async (c, next) => {
  if (c.req.path === HEALTH_PATH) {
    await next();
    return;
  }
  const header = c.req.header("Authorization") ?? "";
  const expected = `Bearer ${c.env.API_TOKEN}`;
  if (!safeEqual(header, expected)) {
    return errorResponse(
      c,
      401,
      "UNAUTHORIZED",
      "A valid Authorization: Bearer <token> header is required.",
    );
  }
  await next();
});

// Health check (unauthenticated).
app.get(HEALTH_PATH, (c) => c.json({ ok: true }));

// Resource routes.
app.route("/api/v1/projects", projects);

// Pre-compute route matchers for 405 detection (built after route registration).
const routeMatchers = app.routes
  .filter((r) => r.method !== "ALL")
  .map((r) => ({ method: r.method, regex: pathToRegex(r.path) }));

// Consistent 404 / 405 handling.
app.notFound((c) => {
  const path = c.req.path;
  const allowed = new Set<string>();
  for (const m of routeMatchers) {
    if (m.regex.test(path)) allowed.add(m.method);
  }
  // Path exists but the method doesn't → 405 with an Allow header.
  if (allowed.size > 0 && !allowed.has(c.req.method)) {
    c.header("Allow", [...allowed].sort().join(", "));
    return errorResponse(
      c,
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${c.req.method} is not allowed for '${path}'.`,
    );
  }
  return errorResponse(
    c,
    404,
    "NOT_FOUND",
    `No route matches ${c.req.method} ${path}.`,
  );
});

// Unexpected errors → consistent 500 shape.
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return errorResponse(
    c,
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred.",
  );
});

export default app;
```

---

### `README.md`
````markdown
# Team Task Board API

REST API on Cloudflare Workers (Hono + zod + KV).

## Setup

```bash
npm install

# 1. Create the KV namespace (once per account)
npx wrangler kv namespace create TASKS
#    → paste the returned id/preview_id into wrangler.toml

# 2. Configure the token
cp .dev.vars.example .dev.vars          # local dev
npx wrangler secret put API_TOKEN        # production

# 3. Run
npm run dev        # http://localhost:8787
npm run deploy
```

## Notes

- **Key layout:** `project:{id}` and `task:{projectId}:{taskId}`; list
  endpoints scan by prefix. KV listers are sorted by `createdAt` for stable
  pagination; status filtering + pagination happen in-memory after a batch
  read (appropriate for KV-scale board data; documented trade-off).
- **KV is eventually consistent:** writes may take up to ~60s to appear in
  global list/get results.
- **Errors:** all failures share the shape
  `{ "error": { "code": "...", "message": "..." } }` (400/401/404/405/500).
- PATCH supports clearing `description` / `assignee` by sending `null`.

## Quick smoke test

```bash
TOKEN=<your-token>

curl http://localhost:8787/api/v1/health

curl -X POST http://localhost:8787/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Launch"}'

curl -X POST http://localhost:8787/api/v1/projects/<projectId>/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Ship it","assignee":"ada"}'

curl "http://localhost:8787/api/v1/projects/<projectId>/tasks?status=todo&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"
```
````

---

**Design decisions worth knowing:**

- **405 vs 404:** unknown *paths* return 404; mismatched *methods* on known paths return a real 405 with an `Allow` header (computed from registered route patterns).
- **Auth:** custom constant-time token compare (avoids Hono's plain-text 401) and `/api/v1/health` is explicitly exempt; CORS preflights short-circuit before auth runs.
- **Pagination defaults:** `page=1`, `pageSize=20` (min 1, max 100); responses carry `{ data, pagination: { page, pageSize, total, totalPages } }`.
- **Logging:** JSON-structured logs with method/path/status/duration that also capture 500s via `try/finally`.