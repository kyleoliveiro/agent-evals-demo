<!-- model: openrouter/moonshotai/kimi-k3 | run: 1 | framework: Hono -->

Below is a complete, production-ready Cloudflare Workers API built with [Hono](https://hono.dev/) (routing + CORS) and [zod](https://zod.dev/) (body validation), with a clean separation of concerns: middleware (auth/logging), a KV storage layer, route handlers, and centralized error handling.

**Project structure**

```
team-task-board/
├── package.json
├── wrangler.toml
├── tsconfig.json
├── README.md
├── .gitignore
├── .dev.vars.example
└── src/
    ├── index.ts
    ├── types.ts
    ├── errors.ts
    ├── validation.ts
    ├── store.ts
    ├── middleware/
    │   ├── auth.ts
    │   └── logging.ts
    └── routes/
        ├── projects.ts
        └── tasks.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250204.0",
    "typescript": "^5.7.3",
    "wrangler": "^4.0.0"
  }
}
```

### `wrangler.toml`

```toml
name = "team-task-board"
main = "src/index.ts"
compatibility_date = "2025-03-05"

# Create the namespace first:
#   npx wrangler kv namespace create TASKS
# then paste the returned ids below.
kv_namespaces = [
  { binding = "TASKS", id = "REPLACE_WITH_KV_ID", preview_id = "REPLACE_WITH_PREVIEW_KV_ID" }
]

# Bearer token — set with: npx wrangler secret put API_TOKEN
# (for local dev, copy .dev.vars.example to .dev.vars)

# Optional: restrict CORS origins (defaults to "*")
# [vars]
# CORS_ORIGIN = "https://app.example.com,https://staging.example.com"

[observability]
enabled = true
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

### `.gitignore`

```
node_modules/
.dev.vars
.wrangler/
dist/
```

### `.dev.vars.example`

```
API_TOKEN=dev-token-change-me
CORS_ORIGIN=*
```

---

### `src/types.ts`

```ts
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
  /** Comma-separated list of allowed origins. Defaults to "*". */
  CORS_ORIGIN?: string;
}

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

### `src/errors.ts`

```ts
import { HTTPException } from "hono/http-exception";

/**
 * ApiError carries a machine-readable `code` in addition to the HTTP status
 * and human-readable message, so `onError` can render the consistent shape:
 * { "error": { "code", "message" } }
 */
export class ApiError extends HTTPException {
  readonly code: string;

  constructor(
    status: 400 | 401 | 403 | 404 | 405 | 500,
    code: string,
    message: string
  ) {
    super(status, { message });
    this.code = code;
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } } as const;
}

/** Fallback code mapping for plain HTTPExceptions raised by the framework. */
export function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return "validation_failed";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    default:
      return "internal_error";
  }
}
```

### `src/validation.ts`

```ts
import { z } from "zod";
import type { Context } from "hono";
import { ApiError } from "./errors";
import type { TaskStatus } from "./types";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const projectCreateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name must not be empty")
      .max(200, "name must be at most 200 characters"),
  })
  .strict();

export const taskCreateSchema = z
  .object({
    title: z.string().trim().min(1, "title must not be empty").max(300),
    description: z.string().max(5000).optional(),
    status: taskStatusSchema.optional(),
    assignee: z.string().max(100).optional(),
  })
  .strict();

// PATCH: nullable fields mean "set to null to clear the value".
export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1, "title must not be empty").max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: taskStatusSchema.optional(),
    assignee: z.string().max(100).nullable().optional(),
  })
  .strict();

/**
 * Parses the JSON request body against a zod schema.
 * Throws ApiError(400) with a readable message on malformed JSON or schema failure.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "validation_failed", "Request body must be valid JSON.");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw new ApiError(400, "validation_failed", message);
  }
  return result.data as z.infer<S>;
}

/** Validates `?status=&page=&pageSize=` for the task list endpoint. */
export function parseTaskListQuery(c: Context): {
  status: TaskStatus | undefined;
  page: number;
  pageSize: number;
} {
  const rawStatus = c.req.query("status");
  let status: TaskStatus | undefined;
  if (rawStatus !== undefined) {
    const parsed = taskStatusSchema.safeParse(rawStatus);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "validation_failed",
        "Query parameter 'status' must be one of: todo, in_progress, done."
      );
    }
    status = parsed.data;
  }

  const page = parsePositiveInt(c.req.query("page"), "page", 1);
  const pageSize = parsePositiveInt(c.req.query("pageSize"), "pageSize", 20, 100);

  return { status, page, pageSize };
}

function parsePositiveInt(
  raw: string | undefined,
  name: string,
  fallback: number,
  max?: number
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(
      400,
      "validation_failed",
      `Query parameter '${name}' must be a positive integer.`
    );
  }
  const value = Number(raw);
  if (value < 1 || (max !== undefined && value > max)) {
    throw new ApiError(
      400,
      "validation_failed",
      `Query parameter '${name}' must be between 1 and ${max ?? "unlimited"}.`
    );
  }
  return value;
}
```

### `src/store.ts`

```ts
import type { Project, Task, TaskStatus } from "./types";

// KV key layout:
//   project:{id}                 -> Project
//   task:{projectId}:{taskId}    -> Task
const PROJECT_PREFIX = "project:";
const projectKey = (id: string) => `${PROJECT_PREFIX}${id}`;
const tasksPrefix = (projectId: string) => `task:${projectId}:`;
const taskKey = (projectId: string, taskId: string) => `task:${projectId}:${taskId}`;

/** KV list() returns max 1000 keys per call — page through cursors to get all of them. */
async function listAllKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of res.keys) keys.push(k.name);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor !== undefined);
  return keys;
}

// ---------- Projects ----------

export async function createProject(kv: KVNamespace, name: string): Promise<Project> {
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };
  await kv.put(projectKey(project.id), JSON.stringify(project));
  return project;
}

export async function getProject(kv: KVNamespace, id: string): Promise<Project | null> {
  return kv.get<Project>(projectKey(id), { type: "json" });
}

export async function listProjects(kv: KVNamespace): Promise<Project[]> {
  const keys = await listAllKeys(kv, PROJECT_PREFIX);
  const items = await Promise.all(keys.map((k) => kv.get<Project>(k, { type: "json" })));
  return items
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deletes the project and every task key under it. Returns false if it didn't exist. */
export async function deleteProject(kv: KVNamespace, projectId: string): Promise<boolean> {
  const existing = await getProject(kv, projectId);
  if (!existing) return false;
  const taskKeys = await listAllKeys(kv, tasksPrefix(projectId));
  await Promise.all([
    kv.delete(projectKey(projectId)),
    ...taskKeys.map((k) => kv.delete(k)),
  ]);
  return true;
}

// ---------- Tasks ----------

export interface TaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

export async function createTask(
  kv: KVNamespace,
  projectId: string,
  input: TaskInput
): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    projectId,
    title: input.title,
    description: input.description,
    status: input.status ?? "todo",
    assignee: input.assignee,
    createdAt: now,
    updatedAt: now,
  };
  await kv.put(taskKey(projectId, task.id), JSON.stringify(task));
  return task;
}

export async function getTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string
): Promise<Task | null> {
  return kv.get<Task>(taskKey(projectId, taskId), { type: "json" });
}

export async function listTasks(kv: KVNamespace, projectId: string): Promise<Task[]> {
  const keys = await listAllKeys(kv, tasksPrefix(projectId));
  const items = await Promise.all(keys.map((k) => kv.get<Task>(k, { type: "json" })));
  return items
    .filter((t): t is Task => t !== null)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
    );
}

export async function saveTask(
  kv: KVNamespace,
  projectId: string,
  task: Task
): Promise<Task> {
  await kv.put(taskKey(projectId, task.id), JSON.stringify(task));
  return task;
}

export async function deleteTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string
): Promise<boolean> {
  const existing = await getTask(kv, projectId, taskId);
  if (!existing) return false;
  await kv.delete(taskKey(projectId, taskId));
  return true;
}
```

### `src/middleware/auth.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { ApiError } from "../errors";

/**
 * Bearer-token auth. CORS preflight (OPTIONS) is exempt so browsers can
 * negotiate before credentials are attached. Token comparison is done in a
 * constant-ish time loop instead of `===`.
 */
export const auth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const expected = c.env.API_TOKEN;

  if (!token || !expected || !safeEqual(token, expected)) {
    throw new ApiError(401, "unauthorized", "Missing or invalid bearer token.");
  }

  await next();
});

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
```

### `src/middleware/logging.ts`

```ts
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";

/**
 * Logs method, path, status and duration for every request — including ones
 * that throw, by capturing the exception's status before rethrowing so
 * app-level onError can render the error response.
 */
export const requestLogger = createMiddleware(async (c, next) => {
  const start = performance.now();
  try {
    await next();
    logRequest(c, start, c.res?.status ?? 0);
  } catch (err) {
    logRequest(c, start, err instanceof HTTPException ? err.status : 500);
    throw err;
  }
});

function logRequest(c: Context, start: number, status: number): void {
  const durationMs = Math.round(performance.now() - start);
  console.log(`${c.req.method} ${c.req.path} -> ${status} (${durationMs}ms)`);
}
```

### `src/routes/projects.ts`

```ts
import { Hono } from "hono";
import type { Env } from "../types";
import { ApiError } from "../errors";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
} from "../store";
import { parseBody, projectCreateSchema } from "../validation";

export const projects = new Hono<{ Bindings: Env }>();

projects.get("/projects", async (c) => {
  const data = await listProjects(c.env.TASKS);
  return c.json({ data });
});

projects.post("/projects", async (c) => {
  const input = await parseBody(c, projectCreateSchema);
  const project = await createProject(c.env.TASKS, input.name);
  return c.json(project, 201);
});

projects.get("/projects/:projectId", async (c) => {
  const project = await getProject(c.env.TASKS, c.req.param("projectId"));
  if (!project) throw new ApiError(404, "not_found", "Project not found.");
  return c.json(project);
});

projects.delete("/projects/:projectId", async (c) => {
  const deleted = await deleteProject(c.env.TASKS, c.req.param("projectId"));
  if (!deleted) throw new ApiError(404, "not_found", "Project not found.");
  return c.body(null, 204);
});
```

### `src/routes/tasks.ts`

```ts
import { Hono } from "hono";
import type { Env } from "../types";
import { ApiError } from "../errors";
import {
  createTask,
  deleteTask,
  getProject,
  getTask,
  listTasks,
  saveTask,
} from "../store";
import {
  parseBody,
  parseTaskListQuery,
  taskCreateSchema,
  taskUpdateSchema,
} from "../validation";

export const tasks = new Hono<{ Bindings: Env }>();

async function requireProject(kv: KVNamespace, projectId: string): Promise<void> {
  const project = await getProject(kv, projectId);
  if (!project) throw new ApiError(404, "not_found", "Project not found.");
}

// GET /projects/:projectId/tasks?status=&page=&pageSize=
tasks.get("/projects/:projectId/tasks", async (c) => {
  const projectId = c.req.param("projectId");
  await requireProject(c.env.TASKS, projectId);

  const { status, page, pageSize } = parseTaskListQuery(c);

  const all = await listTasks(c.env.TASKS, projectId);
  const filtered = status ? all.filter((t) => t.status === status) : all;
  const total = filtered.length;
  const start = (page - 1) * pageSize;

  return c.json({
    data: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total,
  });
});

// POST /projects/:projectId/tasks
tasks.post("/projects/:projectId/tasks", async (c) => {
  const projectId = c.req.param("projectId");
  await requireProject(c.env.TASKS, projectId);

  const input = await parseBody(c, taskCreateSchema);
  const task = await createTask(c.env.TASKS, projectId, input);
  return c.json(task, 201);
});

// GET /projects/:projectId/tasks/:taskId
tasks.get("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c.env.TASKS, projectId);

  const task = await getTask(c.env.TASKS, projectId, taskId);
  if (!task) throw new ApiError(404, "not_found", "Task not found.");
  return c.json(task);
});

// PATCH /projects/:projectId/tasks/:taskId
tasks.patch("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c.env.TASKS, projectId);

  const input = await parseBody(c, taskUpdateSchema);
  if (Object.keys(input).length === 0) {
    throw new ApiError(
      400,
      "validation_failed",
      "Provide at least one field to update (title, description, status, assignee)."
    );
  }

  const task = await getTask(c.env.TASKS, projectId, taskId);
  if (!task) throw new ApiError(404, "not_found", "Task not found.");

  if (input.title !== undefined) task.title = input.title;
  if (input.status !== undefined) task.status = input.status;
  if (input.description !== undefined) {
    if (input.description === null) delete task.description;
    else task.description = input.description;
  }
  if (input.assignee !== undefined) {
    if (input.assignee === null) delete task.assignee;
    else task.assignee = input.assignee;
  }

  task.updatedAt = new Date().toISOString();
  const saved = await saveTask(c.env.TASKS, projectId, task);
  return c.json(saved);
});

// DELETE /projects/:projectId/tasks/:taskId
tasks.delete("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c.env.TASKS, projectId);

  const deleted = await deleteTask(c.env.TASKS, projectId, taskId);
  if (!deleted) throw new ApiError(404, "not_found", "Task not found.");
  return c.body(null, 204);
});
```

### `src/index.ts`

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { ApiError, errorBody, statusToCode } from "./errors";
import { requestLogger } from "./middleware/logging";
import { auth } from "./middleware/auth";
import { projects } from "./routes/projects";
import { tasks } from "./routes/tasks";

/**
 * Used by the notFound handler to distinguish "wrong method on a known path"
 * (405) from "unknown path" (404).
 */
const ROUTE_TABLE: ReadonlyArray<{ pattern: RegExp; methods: string[] }> = [
  { pattern: /^\/api\/v1\/health\/?$/, methods: ["GET"] },
  { pattern: /^\/api\/v1\/projects\/?$/, methods: ["GET", "POST"] },
  { pattern: /^\/api\/v1\/projects\/[^/]+\/?$/, methods: ["GET", "DELETE"] },
  { pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/?$/, methods: ["GET", "POST"] },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+\/?$/,
    methods: ["GET", "PATCH", "DELETE"],
  },
];

const app = new Hono<{ Bindings: Env }>();

// 1. Logging (outermost — records every request).
app.use("*", requestLogger);

// 2. CORS — also short-circuits browser preflight (OPTIONS) requests.
app.use("/api/v1/*", (c, next) => {
  const origins = c.env.CORS_ORIGIN
    ?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return cors({
    origin: origins && origins.length > 0 ? origins : "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  })(c, next);
});

// 3. Health check — public, no auth.
app.get("/api/v1/health", (c) => c.json({ ok: true }));

// 4. Protected routes — mounted through a sub-app that applies auth.
const authed = new Hono<{ Bindings: Env }>();
authed.use("*", auth);
authed.route("/", projects);
authed.route("/", tasks);
app.route("/api/v1", authed);

// 5. Global error handler — renders { error: { code, message } } consistently.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message), err.status);
  }
  if (err instanceof HTTPException) {
    return c.json(errorBody(statusToCode(err.status), err.message), err.status);
  }
  console.error("Unhandled error:", err);
  return c.json(errorBody("internal_error", "Internal server error."), 500);
});

// 6. Unknown routes: 404, or 405 when the path exists with an Allow header.
app.notFound((c) => {
  const pathname = new URL(c.req.url).pathname;
  for (const route of ROUTE_TABLE) {
    if (route.pattern.test(pathname)) {
      return c.json(
        errorBody(
          "method_not_allowed",
          `Method ${c.req.method} is not allowed for this path.`
        ),
        405,
        { Allow: route.methods.join(", ") }
      );
    }
  }
  return c.json(errorBody("not_found", "Route not found."), 404);
});

export default app;
```

---

### `README.md`

```md
# Team Task Board API

REST API on Cloudflare Workers (TypeScript, Hono, zod) backed by a single KV namespace (`TASKS`).

## Setup

```bash
npm install

# 1. Create the KV namespace
npx wrangler kv namespace create TASKS
#    -> copy the returned `id` / `preview_id` into wrangler.toml

# 2. Set the bearer token (production)
npx wrangler secret put API_TOKEN

#    ...or for local development:
cp .dev.vars.example .dev.vars

# 3. Run locally / deploy / typecheck
npm run dev
npm run deploy
npm run typecheck
```

All endpoints except `GET /api/v1/health` require
`Authorization: Bearer <token>` matching the `API_TOKEN` secret.

## Error format

All failures return:

```json
{ "error": { "code": "validation_failed", "message": "title: title must not be empty" } }
```

Codes: `validation_failed` (400), `unauthorized` (401), `not_found` (404),
`method_not_allowed` (405), `internal_error` (500).

## Examples

```bash
BASE="http://localhost:8787/api/v1"
TOKEN="dev-token-change-me"

# Create a project
curl -X POST "$BASE/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Platform team"}'

# Create a task
curl -X POST "$BASE/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Set up CI","status":"todo","assignee":"ana"}'

# List tasks with filter + pagination
curl "$BASE/projects/<projectId>/tasks?status=todo&page=1&pageSize=20" \
  -H "Authorization: Bearer $TOKEN"

# Partial update (null clears description/assignee)
curl -X PATCH "$BASE/projects/<projectId>/tasks/<taskId>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'
```

## Storage notes

KV keys are namespaced as `project:{id}` and `task:{projectId}:{taskId}`.
Task lists page through KV's `list()` cursors (1000 keys/call) and apply
status filtering + offset pagination in memory, sorted by `createdAt`
descending. KV is eventually consistent; a freshly written entity may briefly
be absent from `list()` results.
```

---

A few deliberate design choices worth flagging:

- **Key layout** — `task:{projectId}:{taskId}` gives a prefix-scan per project, which is how project deletion cascades to its tasks and how list endpoints scope correctly. IDs are `crypto.randomUUID()`, so they never contain `:`.
- **405 handling** — Hono routes unknown method/path combos to `notFound`, so `index.ts` keeps a small route table to distinguish a real path hit with the wrong method (405 + `Allow` header) from a genuinely unknown route (404).
- **Logging on error paths** — the logger middleware catches, logs, and rethrows so `onError` still renders the JSON error body; otherwise thrown errors would skip request logging.
- **Auth is isolated to a sub-app** — `/health` stays public by construction rather than by pattern-exclusion hacks.

You'll need to fill in the KV IDs in `wrangler.toml` and set the `API_TOKEN` secret before deploying; everything else runs as-is with `npm run dev`.