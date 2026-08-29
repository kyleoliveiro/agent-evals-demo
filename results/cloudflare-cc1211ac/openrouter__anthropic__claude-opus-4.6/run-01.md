<!-- model: openrouter/anthropic/claude-opus-4.6 | run: 1 | framework: Hono -->

# Team Task Board — Cloudflare Workers API

I'll use **Hono** (lightweight edge framework with first-class Workers support), **Zod** (validation), and **nanoid** (IDs). Here are all the files:

## `package.json`

```json
{
  "name": "team-task-board",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "hono": "^4.5.0",
    "nanoid": "^5.0.7",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240821.1",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "wrangler": "^3.72.0",
    "@hono/vite-dev-server": "^0.4.1"
  }
}
```

## `wrangler.toml`

```toml
name = "team-task-board"
main = "src/index.ts"
compatibility_date = "2024-08-20"

[vars]
# API_TOKEN should be set as a secret, not here.
# Run: wrangler secret put API_TOKEN

[[kv_namespaces]]
binding = "TASKS"
id = "<your-kv-namespace-id>"
# For local dev:
# preview_id = "<your-preview-kv-namespace-id>"
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
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

## `src/types.ts`

```typescript
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}

// ── Domain Models ──────────────────────────────────────────

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
  createdAt: string;  // ISO-8601
  updatedAt: string;  // ISO-8601
}

// ── API Envelope ───────────────────────────────────────────

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

## `src/errors.ts`

```typescript
import { HTTPException } from "hono/http-exception";
import type { ErrorBody } from "./types";

/**
 * Thin wrapper so every thrown error lands in our standard JSON shape.
 */
export function apiError(
  status: number,
  code: string,
  message: string,
): HTTPException {
  const body: ErrorBody = { error: { code, message } };
  return new HTTPException(status as any, {
    message,
    res: new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  });
}

export const notFound = (what = "Resource") =>
  apiError(404, "NOT_FOUND", `${what} not found`);

export const badRequest = (message: string) =>
  apiError(400, "VALIDATION_ERROR", message);

export const unauthorized = (message = "Missing or invalid bearer token") =>
  apiError(401, "UNAUTHORIZED", message);
```

## `src/schemas.ts`

```typescript
import { z } from "zod";

// ── Project ────────────────────────────────────────────────

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(128),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// ── Task ───────────────────────────────────────────────────

const taskStatusEnum = z.enum(["todo", "in_progress", "done"]);

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(256),
    description: z.string().max(4096).optional(),
    status: taskStatusEnum.optional().default("todo"),
    assignee: z.string().trim().max(128).optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(256).optional(),
    description: z.string().max(4096).optional().nullable(),
    status: taskStatusEnum.optional(),
    assignee: z.string().trim().max(128).optional().nullable(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// ── Query params ───────────────────────────────────────────

export const taskListQuerySchema = z.object({
  status: taskStatusEnum.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});
```

## `src/kv.ts`

```typescript
/**
 * Thin KV helpers that keep key-schema knowledge in one place.
 *
 * Key layout:
 *   project:<id>                → Project JSON
 *   projects:idx                → string[] of project IDs
 *   task:<id>                   → Task JSON
 *   project_tasks:<projectId>   → string[] of task IDs
 */

import type { Env, Project, Task } from "./types";

// ── helpers ────────────────────────────────────────────────

async function getJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  return kv.get<T>(key, "json");
}

async function putJson(kv: KVNamespace, key: string, value: unknown): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}

// ── Project ────────────────────────────────────────────────

export async function listProjectIds(kv: KVNamespace): Promise<string[]> {
  return (await getJson<string[]>(kv, "projects:idx")) ?? [];
}

async function saveProjectIds(kv: KVNamespace, ids: string[]): Promise<void> {
  await putJson(kv, "projects:idx", ids);
}

export async function getProject(kv: KVNamespace, id: string): Promise<Project | null> {
  return getJson<Project>(kv, `project:${id}`);
}

export async function saveProject(kv: KVNamespace, project: Project): Promise<void> {
  const ids = await listProjectIds(kv);
  if (!ids.includes(project.id)) {
    ids.push(project.id);
    await saveProjectIds(kv, ids);
  }
  await putJson(kv, `project:${project.id}`, project);
}

export async function deleteProject(kv: KVNamespace, id: string): Promise<void> {
  // Remove all tasks first
  const taskIds = await listTaskIds(kv, id);
  await Promise.all(taskIds.map((tid) => kv.delete(`task:${tid}`)));
  await kv.delete(`project_tasks:${id}`);

  // Remove project
  await kv.delete(`project:${id}`);
  const ids = (await listProjectIds(kv)).filter((pid) => pid !== id);
  await saveProjectIds(kv, ids);
}

export async function listProjects(kv: KVNamespace): Promise<Project[]> {
  const ids = await listProjectIds(kv);
  const results = await Promise.all(ids.map((id) => getProject(kv, id)));
  return results.filter(Boolean) as Project[];
}

// ── Task ───────────────────────────────────────────────────

export async function listTaskIds(kv: KVNamespace, projectId: string): Promise<string[]> {
  return (await getJson<string[]>(kv, `project_tasks:${projectId}`)) ?? [];
}

async function saveTaskIds(kv: KVNamespace, projectId: string, ids: string[]): Promise<void> {
  await putJson(kv, `project_tasks:${projectId}`, ids);
}

export async function getTask(kv: KVNamespace, taskId: string): Promise<Task | null> {
  return getJson<Task>(kv, `task:${taskId}`);
}

export async function saveTask(kv: KVNamespace, task: Task): Promise<void> {
  const ids = await listTaskIds(kv, task.projectId);
  if (!ids.includes(task.id)) {
    ids.push(task.id);
    await saveTaskIds(kv, task.projectId, ids);
  }
  await putJson(kv, `task:${task.id}`, task);
}

export async function deleteTask(kv: KVNamespace, task: Task): Promise<void> {
  await kv.delete(`task:${task.id}`);
  const ids = (await listTaskIds(kv, task.projectId)).filter((tid) => tid !== task.id);
  await saveTaskIds(kv, task.projectId, ids);
}

export async function listTasks(kv: KVNamespace, projectId: string): Promise<Task[]> {
  const ids = await listTaskIds(kv, projectId);
  const results = await Promise.all(ids.map((id) => getTask(kv, id)));
  return results.filter(Boolean) as Task[];
}
```

## `src/middleware/auth.ts`

```typescript
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { unauthorized } from "../errors";

/**
 * Bearer-token auth middleware.
 * Skips the /api/v1/health endpoint.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    if (c.req.path === "/api/v1/health") {
      return next();
    }

    const header = c.req.header("Authorization");
    if (!header) throw unauthorized();

    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw unauthorized();

    const token = match[1];
    if (token !== c.env.API_TOKEN) throw unauthorized();

    await next();
  },
);
```

## `src/middleware/logger.ts`

```typescript
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const requestLogger = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(
      JSON.stringify({
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: duration,
      }),
    );
  },
);
```

## `src/routes/projects.ts`

```typescript
import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { Env, Project } from "../types";
import { createProjectSchema } from "../schemas";
import { badRequest, notFound } from "../errors";
import * as kv from "../kv";

const app = new Hono<{ Bindings: Env }>();

// LIST
app.get("/", async (c) => {
  const projects = await kv.listProjects(c.env.TASKS);
  return c.json({ data: projects });
});

// CREATE
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) throw badRequest("Invalid JSON body");

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }

  const now = new Date().toISOString();
  const project: Project = {
    id: nanoid(),
    name: parsed.data.name,
    createdAt: now,
  };

  await kv.saveProject(c.env.TASKS, project);
  return c.json({ data: project }, 201);
});

// GET ONE
app.get("/:projectId", async (c) => {
  const project = await kv.getProject(c.env.TASKS, c.req.param("projectId"));
  if (!project) throw notFound("Project");
  return c.json({ data: project });
});

// DELETE
app.delete("/:projectId", async (c) => {
  const project = await kv.getProject(c.env.TASKS, c.req.param("projectId"));
  if (!project) throw notFound("Project");
  await kv.deleteProject(c.env.TASKS, project.id);
  return c.body(null, 204);
});

export default app;
```

## `src/routes/tasks.ts`

```typescript
import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { Env, Task, PaginatedResponse } from "../types";
import {
  createTaskSchema,
  updateTaskSchema,
  taskListQuerySchema,
} from "../schemas";
import { badRequest, notFound } from "../errors";
import * as kv from "../kv";

const app = new Hono<{ Bindings: Env }>();

/**
 * Guard: ensure the parent project exists before any task operation.
 */
app.use("/*", async (c, next) => {
  const projectId = c.req.param("projectId");
  if (projectId) {
    const project = await kv.getProject(c.env.TASKS, projectId);
    if (!project) throw notFound("Project");
  }
  await next();
});

// LIST with optional status filter + pagination
app.get("/", async (c) => {
  const projectId = c.req.param("projectId")!;
  const rawQuery = {
    status: c.req.query("status"),
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  };

  // strip undefined keys so zod defaults kick in
  const cleaned = Object.fromEntries(
    Object.entries(rawQuery).filter(([, v]) => v !== undefined),
  );

  const qParsed = taskListQuerySchema.safeParse(cleaned);
  if (!qParsed.success) {
    throw badRequest(
      qParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }

  const { status, page, pageSize } = qParsed.data;

  let tasks = await kv.listTasks(c.env.TASKS, projectId);

  if (status) {
    tasks = tasks.filter((t) => t.status === status);
  }

  // Sort newest first
  tasks.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const total = tasks.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const slice = tasks.slice(start, start + pageSize);

  const response: PaginatedResponse<Task> = {
    data: slice,
    pagination: { page, pageSize, total, totalPages },
  };

  return c.json(response);
});

// CREATE
app.post("/", async (c) => {
  const projectId = c.req.param("projectId")!;

  const body = await c.req.json().catch(() => null);
  if (!body) throw badRequest("Invalid JSON body");

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }

  const now = new Date().toISOString();
  const task: Task = {
    id: nanoid(),
    projectId,
    title: parsed.data.title,
    ...(parsed.data.description !== undefined && {
      description: parsed.data.description,
    }),
    status: parsed.data.status,
    ...(parsed.data.assignee !== undefined && { assignee: parsed.data.assignee }),
    createdAt: now,
    updatedAt: now,
  };

  await kv.saveTask(c.env.TASKS, task);
  return c.json({ data: task }, 201);
});

// GET ONE
app.get("/:taskId", async (c) => {
  const task = await kv.getTask(c.env.TASKS, c.req.param("taskId"));
  if (!task || task.projectId !== c.req.param("projectId")) {
    throw notFound("Task");
  }
  return c.json({ data: task });
});

// PATCH
app.patch("/:taskId", async (c) => {
  const task = await kv.getTask(c.env.TASKS, c.req.param("taskId"));
  if (!task || task.projectId !== c.req.param("projectId")) {
    throw notFound("Task");
  }

  const body = await c.req.json().catch(() => null);
  if (!body) throw badRequest("Invalid JSON body");

  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }

  const updates = parsed.data;
  const updatedTask: Task = {
    ...task,
    ...(updates.title !== undefined && { title: updates.title }),
    ...(updates.status !== undefined && { status: updates.status }),
    // nullable fields: null means "remove", string means "set"
    ...(updates.description !== undefined && {
      description: updates.description ?? undefined,
    }),
    ...(updates.assignee !== undefined && {
      assignee: updates.assignee ?? undefined,
    }),
    updatedAt: new Date().toISOString(),
  };

  await kv.saveTask(c.env.TASKS, updatedTask);
  return c.json({ data: updatedTask });
});

// DELETE
app.delete("/:taskId", async (c) => {
  const task = await kv.getTask(c.env.TASKS, c.req.param("taskId"));
  if (!task || task.projectId !== c.req.param("projectId")) {
    throw notFound("Task");
  }
  await kv.deleteTask(c.env.TASKS, task);
  return c.body(null, 204);
});

export default app;
```

## `src/index.ts`

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, ErrorBody } from "./types";
import { authMiddleware } from "./middleware/auth";
import { requestLogger } from "./middleware/logger";
import projectRoutes from "./routes/projects";
import taskRoutes from "./routes/tasks";
import { apiError } from "./errors";

const app = new Hono<{ Bindings: Env }>();

// ── Global middleware ──────────────────────────────────────

// CORS — allow any origin for browser clients; tighten in prod if desired
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
  }),
);

app.use("*", requestLogger);

// Auth (skips /api/v1/health internally)
app.use("/api/v1/*", authMiddleware);

// ── Routes ─────────────────────────────────────────────────

app.get("/api/v1/health", (c) => c.json({ ok: true }));

app.route("/api/v1/projects/:projectId/tasks", taskRoutes);
app.route("/api/v1/projects", projectRoutes);

// ── 404 catch-all ──────────────────────────────────────────

app.notFound((c) => {
  const body: ErrorBody = {
    error: { code: "NOT_FOUND", message: `Cannot ${c.req.method} ${c.req.path}` },
  };
  return c.json(body, 404);
});

// ── Global error handler ───────────────────────────────────

app.onError((err, c) => {
  // Hono's HTTPException already carries a Response we built in apiError()
  if ("getResponse" in err && typeof err.getResponse === "function") {
    return (err as any).getResponse();
  }

  console.error("Unhandled error:", err);
  const body: ErrorBody = {
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  };
  return c.json(body, 500);
});

export default app;
```

---

## How it all fits together

```
src/
├── index.ts              ← Worker entry; Hono app, global middleware, error handler
├── types.ts              ← Domain models + API envelope types
├── errors.ts             ← Standardised error factory (400/401/404/500)
├── schemas.ts            ← Zod validation for every mutable endpoint
├── kv.ts                 ← KV data-access layer (index + entity pattern)
├── middleware/
│   ├── auth.ts           ← Bearer token check against API_TOKEN secret
│   └── logger.ts         ← JSON request log (method, path, status, durationMs)
└── routes/
    ├── projects.ts       ← /api/v1/projects CRUD
    └── tasks.ts          ← /api/v1/projects/:projectId/tasks CRUD
```

### Key design decisions

| Concern | Decision |
|---|---|
| **Framework** | **Hono** — built for Workers, ~14 kB, typed context, built-in CORS middleware |
| **Validation** | **Zod** with `.strict()` so unknown fields are rejected |
| **IDs** | `nanoid` (21-char URL-safe, collision-resistant) |
| **KV data layout** | Each entity stored at `entity:<id>`. Membership tracked via lightweight index keys (`projects:idx`, `project_tasks:<pid>`) holding `string[]`. This avoids expensive `list()` scans and stays within KV's 25 MiB value limit for reasonable dataset sizes. |
| **Pagination** | Offset-based with `page` + `pageSize` (max 100). Tasks sorted newest-first. |
| **Nullable fields** | PATCH accepts `null` for `description`/`assignee` to *clear* them, or a string to *set* them. Omitting the key leaves the field unchanged. |
| **CORS** | Permissive `*` origin with `Authorization` in allowed headers; `OPTIONS` preflight handled automatically by Hono's CORS middleware. |
| **Error shape** | Every non-2xx response (including 404 catch-all and 500) returns `{ "error": { "code", "message" } }`. |

### Getting started

```bash
# 1. Install
npm install

# 2. Create the KV namespace
npx wrangler kv namespace create TASKS
# paste the returned id into wrangler.toml

# 3. Set the auth secret
npx wrangler secret put API_TOKEN
# type your token at the prompt

# 4. Local dev
npm run dev

# 5. Deploy
npm run deploy
```

### Sample requests

```bash
TOKEN="your-secret-token"

# Health (no auth needed)
curl http://localhost:8787/api/v1/health

# Create a project
curl -X POST http://localhost:8787/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sprint 42"}'

# Create a task
curl -X POST http://localhost:8787/api/v1/projects/<PROJECT_ID>/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix login bug","assignee":"alice","status":"in_progress"}'

# List tasks with filter + pagination
curl "http://localhost:8787/api/v1/projects/<PROJECT_ID>/tasks?status=todo&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"

# Partial update
curl -X PATCH http://localhost:8787/api/v1/projects/<PROJECT_ID>/tasks/<TASK_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```