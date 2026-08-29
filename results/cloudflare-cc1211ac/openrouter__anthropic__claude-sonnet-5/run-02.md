<!-- model: openrouter/anthropic/claude-sonnet-5 | run: 2 | framework: Hono -->

# Cloudflare Workers Team Task Board API

A production-ready REST API built with **Hono** (lightweight, fast router built for Workers) + **Zod** (schema validation) + **Cloudflare KV** for storage.

## Project layout

```
team-task-board-api/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── .gitignore
├── README.md
└── src/
    ├── index.ts
    ├── types.ts
    ├── errors.ts
    ├── validation.ts
    ├── store.ts
    ├── middleware/
    │   ├── auth.ts
    │   └── logger.ts
    └── routes/
        ├── projects.ts
        └── tasks.ts
```

---

## `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Team task board REST API on Cloudflare Workers",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "tail": "wrangler tail"
  },
  "dependencies": {
    "hono": "^4.6.9",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241004.0",
    "typescript": "^5.6.3",
    "wrangler": "^3.86.0"
  }
}
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "allowJs": false,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

---

## `wrangler.toml`

```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

# One KV namespace binding named TASKS, used for both Projects and Tasks.
[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_PREVIEW_KV_NAMESPACE_ID"

# API_TOKEN is a secret - do NOT put it here.
# Set it with: wrangler secret put API_TOKEN
[vars]
# Non-secret example var (optional), keep empty or remove.
# ENVIRONMENT = "production"
```

---

## `.gitignore`

```
node_modules
.wrangler
dist
.dev.vars
*.log
```

---

## `src/types.ts`

```ts
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export interface Project {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

---

## `src/errors.ts`

```ts
export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "AppError";
  }

  static badRequest(message: string, code = "BAD_REQUEST") {
    return new AppError(400, code, message);
  }

  static notFound(message: string, code = "NOT_FOUND") {
    return new AppError(404, code, message);
  }

  static methodNotAllowed(message = "Method not allowed", code = "METHOD_NOT_ALLOWED") {
    return new AppError(405, code, message);
  }

  static unauthorized(message = "Unauthorized", code = "UNAUTHORIZED") {
    return new AppError(401, code, message);
  }

  static internal(message = "Internal server error", code = "INTERNAL_ERROR") {
    return new AppError(500, code, message);
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}
```

---

## `src/validation.ts`

```ts
import { z } from "zod";
import type { Context } from "hono";
import { AppError } from "./errors";

export const TaskStatusEnum = z.enum(["todo", "in_progress", "done"]);

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200, "name too long"),
});

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(300, "title too long"),
  description: z.string().trim().max(5000).optional(),
  status: TaskStatusEnum.optional().default("todo"),
  assignee: z.string().trim().min(1).max(200).optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    status: TaskStatusEnum.optional(),
    assignee: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const ListTasksQuerySchema = z.object({
  status: TaskStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Parses and validates the JSON body of a request against a zod schema.
 * Throws a 400 AppError on invalid JSON or failed validation.
 */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.badRequest("Request body must be valid JSON", "INVALID_JSON");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    throw AppError.badRequest(message, "VALIDATION_ERROR");
  }

  return result.data;
}

/**
 * Parses and validates query parameters against a zod schema.
 */
export function parseQuery<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  const query = c.req.query();
  const result = schema.safeParse(query);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join(".") || "query"}: ${i.message}`)
      .join("; ");
    throw AppError.badRequest(message, "VALIDATION_ERROR");
  }
  return result.data;
}
```

---

## `src/store.ts`

```ts
import type { Env, Paginated, Project, Task, TaskStatus } from "./types";

const PROJECT_PREFIX = "proj::";
const TASK_PREFIX = "task::";

function projectKey(id: string): string {
  return `${PROJECT_PREFIX}${id}`;
}

function taskKey(projectId: string, taskId: string): string {
  return `${TASK_PREFIX}${projectId}::${taskId}`;
}

function taskPrefixForProject(projectId: string): string {
  return `${TASK_PREFIX}${projectId}::`;
}

/** Lists all keys under a prefix, following cursors until complete. */
async function listAllKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const res = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of res.keys) keys.push(k.name);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);

  return keys;
}

// ---------- Projects ----------

export async function createProject(env: Env, project: Project): Promise<void> {
  await env.TASKS.put(projectKey(project.id), JSON.stringify(project));
}

export async function getProject(env: Env, id: string): Promise<Project | null> {
  return env.TASKS.get<Project>(projectKey(id), "json");
}

export async function listProjects(env: Env): Promise<Project[]> {
  const keys = await listAllKeys(env.TASKS, PROJECT_PREFIX);
  const values = await Promise.all(keys.map((k) => env.TASKS.get<Project>(k, "json")));
  const projects = values.filter((p): p is Project => p !== null);
  projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return projects;
}

export async function deleteProjectCascade(env: Env, projectId: string): Promise<void> {
  const taskKeys = await listAllKeys(env.TASKS, taskPrefixForProject(projectId));
  await Promise.all(taskKeys.map((k) => env.TASKS.delete(k)));
  await env.TASKS.delete(projectKey(projectId));
}

// ---------- Tasks ----------

export async function createTask(env: Env, task: Task): Promise<void> {
  await env.TASKS.put(taskKey(task.projectId, task.id), JSON.stringify(task));
}

export async function getTask(env: Env, projectId: string, taskId: string): Promise<Task | null> {
  return env.TASKS.get<Task>(taskKey(projectId, taskId), "json");
}

export async function putTask(env: Env, task: Task): Promise<void> {
  await env.TASKS.put(taskKey(task.projectId, task.id), JSON.stringify(task));
}

export async function deleteTask(env: Env, projectId: string, taskId: string): Promise<void> {
  await env.TASKS.delete(taskKey(projectId, taskId));
}

export async function listTasks(
  env: Env,
  projectId: string,
  opts: { status?: TaskStatus; page: number; pageSize: number }
): Promise<Paginated<Task>> {
  const keys = await listAllKeys(env.TASKS, taskPrefixForProject(projectId));
  const values = await Promise.all(keys.map((k) => env.TASKS.get<Task>(k, "json")));
  let tasks = values.filter((t): t is Task => t !== null);

  if (opts.status) {
    tasks = tasks.filter((t) => t.status === opts.status);
  }

  tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const total = tasks.length;
  const totalPages = Math.max(1, Math.ceil(total / opts.pageSize));
  const start = (opts.page - 1) * opts.pageSize;
  const items = tasks.slice(start, start + opts.pageSize);

  return {
    items,
    page: opts.page,
    pageSize: opts.pageSize,
    total,
    totalPages,
  };
}
```

---

## `src/middleware/auth.ts`

```ts
import type { Context, Next } from "hono";
import type { Env } from "../types";
import { AppError } from "../errors";

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header("Authorization");

  if (!header || !header.startsWith("Bearer ")) {
    throw AppError.unauthorized("Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length).trim();

  if (!c.env.API_TOKEN) {
    // Misconfiguration: fail closed.
    throw AppError.internal("Server is not configured with an API token");
  }

  if (token !== c.env.API_TOKEN) {
    throw AppError.unauthorized("Invalid API token");
  }

  await next();
}
```

---

## `src/middleware/logger.ts`

```ts
import type { Context, Next } from "hono";

export async function loggerMiddleware(c: Context, next: Next) {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  try {
    await next();
  } finally {
    const duration = Date.now() - start;
    const status = c.res?.status ?? 0;
    console.log(
      JSON.stringify({
        method,
        path,
        status,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
```

---

## `src/routes/projects.ts`

```ts
import { Hono } from "hono";
import type { Env, Project } from "../types";
import { AppError } from "../errors";
import { CreateProjectSchema, parseJsonBody } from "../validation";
import { createProject, deleteProjectCascade, getProject, listProjects } from "../store";

export const projects = new Hono<{ Bindings: Env }>();

// GET /projects
projects.get("/", async (c) => {
  const items = await listProjects(c.env);
  return c.json({ items });
});

// POST /projects
projects.post("/", async (c) => {
  const body = await parseJsonBody(c, CreateProjectSchema);

  const project: Project = {
    id: crypto.randomUUID(),
    name: body.name,
    createdAt: new Date().toISOString(),
  };

  await createProject(c.env, project);
  return c.json(project, 201);
});

// Fallback for unsupported methods on /projects
projects.all("/", () => {
  throw AppError.methodNotAllowed();
});

// GET /projects/:projectId
projects.get("/:projectId", async (c) => {
  const project = await getProject(c.env, c.req.param("projectId"));
  if (!project) throw AppError.notFound("Project not found");
  return c.json(project);
});

// DELETE /projects/:projectId
projects.delete("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getProject(c.env, projectId);
  if (!project) throw AppError.notFound("Project not found");

  await deleteProjectCascade(c.env, projectId);
  return c.body(null, 204);
});

// Fallback for unsupported methods on /projects/:projectId
projects.all("/:projectId", () => {
  throw AppError.methodNotAllowed();
});
```

---

## `src/routes/tasks.ts`

```ts
import { Hono } from "hono";
import type { Env, Task } from "../types";
import { AppError } from "../errors";
import {
  CreateTaskSchema,
  ListTasksQuerySchema,
  UpdateTaskSchema,
  parseJsonBody,
  parseQuery,
} from "../validation";
import { createTask, deleteTask, getProject, getTask, listTasks, putTask } from "../store";

export const tasks = new Hono<{ Bindings: Env }>();

/** Ensures the parent project exists before operating on its tasks. */
async function requireProject(c: any) {
  const projectId = c.req.param("projectId");
  const project = await getProject(c.env, projectId);
  if (!project) throw AppError.notFound("Project not found");
  return projectId;
}

// GET /projects/:projectId/tasks
tasks.get("/:projectId/tasks", async (c) => {
  const projectId = await requireProject(c);
  const query = parseQuery(c, ListTasksQuerySchema);

  const result = await listTasks(c.env, projectId, {
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  });

  return c.json(result);
});

// POST /projects/:projectId/tasks
tasks.post("/:projectId/tasks", async (c) => {
  const projectId = await requireProject(c);
  const body = await parseJsonBody(c, CreateTaskSchema);

  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    projectId,
    title: body.title,
    description: body.description,
    status: body.status,
    assignee: body.assignee,
    createdAt: now,
    updatedAt: now,
  };

  await createTask(c.env, task);
  return c.json(task, 201);
});

// Fallback for unsupported methods on /projects/:projectId/tasks
tasks.all("/:projectId/tasks", () => {
  throw AppError.methodNotAllowed();
});

// GET /projects/:projectId/tasks/:taskId
tasks.get("/:projectId/tasks/:taskId", async (c) => {
  const projectId = await requireProject(c);
  const task = await getTask(c.env, projectId, c.req.param("taskId"));
  if (!task) throw AppError.notFound("Task not found");
  return c.json(task);
});

// PATCH /projects/:projectId/tasks/:taskId
tasks.patch("/:projectId/tasks/:taskId", async (c) => {
  const projectId = await requireProject(c);
  const taskId = c.req.param("taskId");
  const existing = await getTask(c.env, projectId, taskId);
  if (!existing) throw AppError.notFound("Task not found");

  const body = await parseJsonBody(c, UpdateTaskSchema);

  const updated: Task = {
    ...existing,
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description ?? undefined } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.assignee !== undefined ? { assignee: body.assignee ?? undefined } : {}),
    updatedAt: new Date().toISOString(),
  };

  await putTask(c.env, updated);
  return c.json(updated);
});

// DELETE /projects/:projectId/tasks/:taskId
tasks.delete("/:projectId/tasks/:taskId", async (c) => {
  const projectId = await requireProject(c);
  const taskId = c.req.param("taskId");
  const existing = await getTask(c.env, projectId, taskId);
  if (!existing) throw AppError.notFound("Task not found");

  await deleteTask(c.env, projectId, taskId);
  return c.body(null, 204);
});

// Fallback for unsupported methods on /projects/:projectId/tasks/:taskId
tasks.all("/:projectId/tasks/:taskId", () => {
  throw AppError.methodNotAllowed();
});
```

---

## `src/index.ts`

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { AppError, errorBody } from "./errors";
import { authMiddleware } from "./middleware/auth";
import { loggerMiddleware } from "./middleware/logger";
import { projects } from "./routes/projects";
import { tasks } from "./routes/tasks";

const app = new Hono<{ Bindings: Env }>();

// ---------- Global middleware ----------

// Log every request (method, path, status, duration).
app.use("*", loggerMiddleware);

// CORS for browser clients, including preflight (OPTIONS is handled
// automatically by this middleware and short-circuits before auth).
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Require Authorization: Bearer <token> for everything except /health.
app.use("/api/v1/*", async (c, next) => {
  if (c.req.path === "/api/v1/health") {
    return next();
  }
  return authMiddleware(c, next);
});

// ---------- Routes ----------

app.get("/api/v1/health", (c) => c.json({ ok: true }));

app.route("/api/v1/projects", projects);
app.route("/api/v1/projects", tasks);

// ---------- 404 for unknown routes ----------

app.notFound((c) => {
  return c.json(errorBody("NOT_FOUND", `Route not found: ${c.req.method} ${c.req.path}`), 404);
});

// ---------- Centralized error handling ----------

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message), err.status as 400 | 401 | 404 | 405 | 500);
  }

  console.error("Unexpected error:", err);
  return c.json(errorBody("INTERNAL_ERROR", "An unexpected error occurred"), 500);
});

export default app;
```

---

## `README.md`

```markdown
# Team Task Board API (Cloudflare Workers)

REST API for managing projects and tasks, built with Hono + Zod on Cloudflare Workers,
backed by a single Cloudflare KV namespace.

## Setup

1. Install dependencies:

   npm install

2. Create the KV namespace(s):

   npx wrangler kv namespace create TASKS
   npx wrangler kv namespace create TASKS --preview

   Copy the returned `id` / `preview_id` into `wrangler.toml`.

3. Set the API token secret (used for Bearer auth on all routes except /health):

   npx wrangler secret put API_TOKEN

   For local dev, create a `.dev.vars` file:

   API_TOKEN=dev-secret-token

4. Run locally:

   npm run dev

5. Deploy:

   npm run deploy

## Auth

All routes except `GET /api/v1/health` require:

  Authorization: Bearer <API_TOKEN>

Requests without a valid token receive `401` with:

  { "error": { "code": "UNAUTHORIZED", "message": "..." } }

## Endpoints

- GET    /api/v1/health
- GET    /api/v1/projects
- POST   /api/v1/projects                 { "name": string }
- GET    /api/v1/projects/:projectId
- DELETE /api/v1/projects/:projectId
- GET    /api/v1/projects/:projectId/tasks?status=&page=&pageSize=
- POST   /api/v1/projects/:projectId/tasks   { "title": string, "description"?, "status"?, "assignee"? }
- GET    /api/v1/projects/:projectId/tasks/:taskId
- PATCH  /api/v1/projects/:projectId/tasks/:taskId  { title?, description?, status?, assignee? }
- DELETE /api/v1/projects/:projectId/tasks/:taskId

## Error shape

  { "error": { "code": "VALIDATION_ERROR", "message": "title: title is required" } }

Status codes used: 400 (validation), 401 (auth), 404 (not found / unknown route),
405 (method not allowed), 500 (unexpected).

## Example requests

  curl -H "Authorization: Bearer dev-secret-token" \
       -X POST https://<worker>/api/v1/projects \
       -H "Content-Type: application/json" \
       -d '{"name":"Website Redesign"}'

  curl -H "Authorization: Bearer dev-secret-token" \
       https://<worker>/api/v1/projects/<projectId>/tasks?status=todo&page=1&pageSize=10
```

---

### Notes on design decisions

- **KV key scheme**: `proj::<id>` for projects, `task::<projectId>::<id>` for tasks. This lets project listing use `list({prefix: "proj::"})` and per-project task listing use `list({prefix: "task::<projectId>::"})` without a secondary index, while still allowing efficient cascade deletes.
- **Pagination**: KV's native `list()` is cursor-based, not page-number based, so tasks for a project are fetched (looping cursors), filtered/sorted, then paginated in memory — appropriate for a task-board's realistic per-project task volumes.
- **Method-not-allowed (405)**: each resource path registers specific method handlers first, followed by a catch-all (`app.all(...)`) on the *same path* that only triggers if no specific handler already produced a response, yielding correct 405s instead of falling through to a generic 404.
- **CORS vs Auth ordering**: CORS middleware (and its automatic OPTIONS preflight short-circuit) runs before the auth middleware, so preflight requests never get rejected for missing credentials.
- **Validation**: Zod schemas centralize input validation for bodies and query params, producing uniform `400 VALIDATION_ERROR` responses.