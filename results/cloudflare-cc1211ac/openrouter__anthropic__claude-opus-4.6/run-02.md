<!-- model: openrouter/anthropic/claude-opus-4.6 | run: 2 | framework: Hono -->

# Team Task Board API — Cloudflare Workers

I'll use **Hono** (lightweight edge framework built for Workers), **Zod** (validation), and **nanoid** (ID generation). Here's the full project:

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
    "@cloudflare/workers-types": "^4.20240806.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "wrangler": "^3.70.0",
    "@hono/vite-dev-server": "^0.4.1"
  }
}
```

## `wrangler.toml`

```toml
name = "team-task-board"
main = "src/index.ts"
compatibility_date = "2024-08-20"

# KV namespace — run `wrangler kv namespace create TASKS` and paste the id below
[[kv_namespaces]]
binding = "TASKS"
id = "<YOUR_KV_NAMESPACE_ID>"

# For local dev, wrangler will create a preview namespace automatically.
# To create a preview namespace: wrangler kv namespace create TASKS --preview
# preview_id = "<YOUR_PREVIEW_KV_NAMESPACE_ID>"

# Secret — set via `wrangler secret put API_TOKEN`
# [vars]
# API_TOKEN is stored as a secret, not here.
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
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

## `src/types.ts`

```ts
// ─── Domain Models ───────────────────────────────────────────────

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
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ─── Cloudflare Bindings ─────────────────────────────────────────

export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}

// ─── API Response Shapes ─────────────────────────────────────────

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

```ts
/**
 * Structured application error that the global error handler converts
 * into the canonical { error: { code, message } } JSON envelope.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  /* Convenience factories */

  static badRequest(message: string) {
    return new AppError(400, "BAD_REQUEST", message);
  }

  static unauthorized(message = "Missing or invalid authorization token") {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static notFound(resource: string, id?: string) {
    const msg = id ? `${resource} '${id}' not found` : `${resource} not found`;
    return new AppError(404, "NOT_FOUND", msg);
  }

  static methodNotAllowed(method: string, path: string) {
    return new AppError(
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${method} is not allowed on ${path}`,
    );
  }
}
```

## `src/kv.ts`

```ts
/**
 * Thin KV helpers that enforce key-naming conventions and handle
 * serialisation, keeping route handlers clean.
 *
 * Key schema
 * ----------
 *   project:<projectId>                → Project JSON
 *   project_index                      → string[] of project IDs
 *   task:<taskId>                      → Task JSON
 *   task_index:<projectId>             → string[] of task IDs for a project
 */

import type { Env, Project, Task } from "./types";

// ─── Generic helpers ─────────────────────────────────────────────

async function getJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key, "text");
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

function putJson(kv: KVNamespace, key: string, value: unknown): Promise<void> {
  return kv.put(key, JSON.stringify(value));
}

// ─── Index helpers (simple JSON arrays of IDs) ───────────────────

async function getIndex(kv: KVNamespace, key: string): Promise<string[]> {
  return (await getJson<string[]>(kv, key)) ?? [];
}

async function addToIndex(
  kv: KVNamespace,
  key: string,
  id: string,
): Promise<void> {
  const idx = await getIndex(kv, key);
  if (!idx.includes(id)) {
    idx.push(id);
    await putJson(kv, key, idx);
  }
}

async function removeFromIndex(
  kv: KVNamespace,
  key: string,
  id: string,
): Promise<void> {
  const idx = await getIndex(kv, key);
  const next = idx.filter((i) => i !== id);
  await putJson(kv, key, next);
}

// ─── Project operations ──────────────────────────────────────────

const projectKey = (id: string) => `project:${id}`;
const PROJECT_INDEX = "project_index";

export async function listProjects(env: Env): Promise<Project[]> {
  const ids = await getIndex(env.TASKS, PROJECT_INDEX);
  const results = await Promise.all(
    ids.map((id) => getJson<Project>(env.TASKS, projectKey(id))),
  );
  return results.filter(Boolean) as Project[];
}

export async function getProject(
  env: Env,
  id: string,
): Promise<Project | null> {
  return getJson<Project>(env.TASKS, projectKey(id));
}

export async function createProject(env: Env, project: Project): Promise<void> {
  await putJson(env.TASKS, projectKey(project.id), project);
  await addToIndex(env.TASKS, PROJECT_INDEX, project.id);
}

export async function deleteProject(env: Env, id: string): Promise<void> {
  // Delete all tasks belonging to the project first
  const taskIds = await getIndex(env.TASKS, taskIndexKey(id));
  await Promise.all(
    taskIds.map((tid) => env.TASKS.delete(taskKey(tid))),
  );
  await env.TASKS.delete(taskIndexKey(id));

  // Delete the project itself
  await env.TASKS.delete(projectKey(id));
  await removeFromIndex(env.TASKS, PROJECT_INDEX, id);
}

// ─── Task operations ─────────────────────────────────────────────

const taskKey = (id: string) => `task:${id}`;
const taskIndexKey = (projectId: string) => `task_index:${projectId}`;

export async function listTasks(
  env: Env,
  projectId: string,
): Promise<Task[]> {
  const ids = await getIndex(env.TASKS, taskIndexKey(projectId));
  const results = await Promise.all(
    ids.map((id) => getJson<Task>(env.TASKS, taskKey(id))),
  );
  return results.filter(Boolean) as Task[];
}

export async function getTask(env: Env, id: string): Promise<Task | null> {
  return getJson<Task>(env.TASKS, taskKey(id));
}

export async function createTask(
  env: Env,
  task: Task,
): Promise<void> {
  await putJson(env.TASKS, taskKey(task.id), task);
  await addToIndex(env.TASKS, taskIndexKey(task.projectId), task.id);
}

export async function updateTask(env: Env, task: Task): Promise<void> {
  await putJson(env.TASKS, taskKey(task.id), task);
}

export async function deleteTask(
  env: Env,
  taskId: string,
  projectId: string,
): Promise<void> {
  await env.TASKS.delete(taskKey(taskId));
  await removeFromIndex(env.TASKS, taskIndexKey(projectId), taskId);
}
```

## `src/validation.ts`

```ts
import { z } from "zod";

// ─── Project schemas ─────────────────────────────────────────────

export const CreateProjectSchema = z
  .object({
    name: z
      .string({ required_error: "name is required" })
      .min(1, "name must not be empty")
      .max(128, "name must be at most 128 characters"),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

// ─── Task schemas ────────────────────────────────────────────────

const TaskStatusEnum = z.enum(["todo", "in_progress", "done"]);

export const CreateTaskSchema = z
  .object({
    title: z
      .string({ required_error: "title is required" })
      .min(1, "title must not be empty")
      .max(256, "title must be at most 256 characters"),
    description: z.string().max(4096).optional(),
    status: TaskStatusEnum.optional().default("todo"),
    assignee: z.string().max(128).optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).max(256).optional(),
    description: z.string().max(4096).nullable().optional(),
    status: TaskStatusEnum.optional(),
    assignee: z.string().max(128).nullable().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "Request body must contain at least one field to update",
  });

export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

// ─── Pagination query params ─────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: TaskStatusEnum.optional(),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;
```

## `src/middleware/auth.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { AppError } from "../errors";

/**
 * Bearer-token auth middleware.
 * Skipped for the /api/v1/health endpoint (handled at the router level).
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const header = c.req.header("Authorization");

    if (!header || !header.startsWith("Bearer ")) {
      throw AppError.unauthorized();
    }

    const token = header.slice(7);

    if (!token || token !== c.env.API_TOKEN) {
      throw AppError.unauthorized();
    }

    await next();
  },
);
```

## `src/middleware/logger.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

/**
 * Logs method, path, response status, and duration (ms) for every request.
 */
export const loggerMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const status = c.res.status;
    console.log(
      `${c.req.method} ${c.req.path} → ${status} (${duration}ms)`,
    );
  },
);
```

## `src/middleware/cors.ts`

```ts
import { cors } from "hono/cors";

/**
 * Wide-open CORS suitable for browser-based clients.
 * Tighten `origin` for production if needed.
 */
export const corsMiddleware = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["Content-Length"],
  maxAge: 86400,
});
```

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
import { nanoid } from "nanoid";
import type { Env, PaginatedResponse, Task } from "../types";
import { AppError } from "../errors";
import {
  CreateProjectSchema,
  CreateTaskSchema,
  UpdateTaskSchema,
  PaginationSchema,
} from "../validation";
import * as kv from "../kv";
import { parseBody } from "../util";

const projects = new Hono<{ Bindings: Env }>();

// ──────────────────── Projects CRUD ──────────────────────────────

projects.get("/", async (c) => {
  const list = await kv.listProjects(c.env);
  return c.json({ data: list });
});

projects.post("/", async (c) => {
  const body = await parseBody(c);
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    throw AppError.badRequest(
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const now = new Date().toISOString();
  const project = { id: nanoid(), name: parsed.data.name, createdAt: now };
  await kv.createProject(c.env, project);
  return c.json({ data: project }, 201);
});

projects.get("/:projectId", async (c) => {
  const project = await kv.getProject(c.env, c.req.param("projectId"));
  if (!project) throw AppError.notFound("Project", c.req.param("projectId"));
  return c.json({ data: project });
});

projects.delete("/:projectId", async (c) => {
  const project = await kv.getProject(c.env, c.req.param("projectId"));
  if (!project) throw AppError.notFound("Project", c.req.param("projectId"));
  await kv.deleteProject(c.env, project.id);
  return c.body(null, 204);
});

// ──────────────────── Tasks CRUD ─────────────────────────────────

/** Ensure the parent project exists before touching tasks. */
async function requireProject(env: Env, projectId: string) {
  const project = await kv.getProject(env, projectId);
  if (!project) throw AppError.notFound("Project", projectId);
  return project;
}

projects.get("/:projectId/tasks", async (c) => {
  const projectId = c.req.param("projectId");
  await requireProject(c.env, projectId);

  const qsParsed = PaginationSchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    status: c.req.query("status") || undefined,
  });

  if (!qsParsed.success) {
    throw AppError.badRequest(
      qsParsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const { page, pageSize, status } = qsParsed.data;

  let tasks = await kv.listTasks(c.env, projectId);

  // Optional status filter
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
  const paginated = tasks.slice(start, start + pageSize);

  const response: PaginatedResponse<Task> = {
    data: paginated,
    pagination: { page, pageSize, total, totalPages },
  };

  return c.json(response);
});

projects.post("/:projectId/tasks", async (c) => {
  const projectId = c.req.param("projectId");
  await requireProject(c.env, projectId);

  const body = await parseBody(c);
  const parsed = CreateTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw AppError.badRequest(
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const now = new Date().toISOString();
  const task = {
    id: nanoid(),
    projectId,
    title: parsed.data.title,
    ...(parsed.data.description !== undefined && {
      description: parsed.data.description,
    }),
    status: parsed.data.status,
    ...(parsed.data.assignee !== undefined && {
      assignee: parsed.data.assignee,
    }),
    createdAt: now,
    updatedAt: now,
  } as const;

  await kv.createTask(c.env, task);
  return c.json({ data: task }, 201);
});

projects.get("/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c.env, projectId);

  const task = await kv.getTask(c.env, taskId);
  if (!task || task.projectId !== projectId) {
    throw AppError.notFound("Task", taskId);
  }

  return c.json({ data: task });
});

projects.patch("/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c.env, projectId);

  const existing = await kv.getTask(c.env, taskId);
  if (!existing || existing.projectId !== projectId) {
    throw AppError.notFound("Task", taskId);
  }

  const body = await parseBody(c);
  const parsed = UpdateTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw AppError.badRequest(
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const updates = parsed.data;
  const updated = {
    ...existing,
    ...(updates.title !== undefined && { title: updates.title }),
    ...(updates.description !== undefined && {
      description: updates.description ?? undefined,
    }),
    ...(updates.status !== undefined && { status: updates.status }),
    ...(updates.assignee !== undefined && {
      assignee: updates.assignee ?? undefined,
    }),
    updatedAt: new Date().toISOString(),
  };

  // If nullable fields are set to null, remove them from the object
  if (updates.description === null) delete (updated as Record<string, unknown>).description;
  if (updates.assignee === null) delete (updated as Record<string, unknown>).assignee;

  await kv.updateTask(c.env, updated);
  return c.json({ data: updated });
});

projects.delete("/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c.env, projectId);

  const task = await kv.getTask(c.env, taskId);
  if (!task || task.projectId !== projectId) {
    throw AppError.notFound("Task", taskId);
  }

  await kv.deleteTask(c.env, taskId, projectId);
  return c.body(null, 204);
});

export default projects;
```

## `src/util.ts`

```ts
import type { Context } from "hono";
import { AppError } from "./errors";

/**
 * Safely parse a JSON request body.
 * Throws a 400 AppError if the body is not valid JSON.
 */
export async function parseBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw AppError.badRequest("Request body must be valid JSON");
  }
}
```

## `src/index.ts`

```ts
import { Hono } from "hono";
import type { Env, ErrorBody } from "./types";
import { AppError } from "./errors";

// Middleware
import { corsMiddleware } from "./middleware/cors";
import { loggerMiddleware } from "./middleware/logger";
import { authMiddleware } from "./middleware/auth";

// Route modules
import health from "./routes/health";
import projects from "./routes/projects";

// ─── App ─────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// ─── Global middleware (runs on every request) ───────────────────

app.use("*", corsMiddleware);
app.use("*", loggerMiddleware);

// ─── Public routes (no auth) ────────────────────────────────────

app.route("/api/v1/health", health);

// ─── Authenticated routes ───────────────────────────────────────

app.use("/api/v1/*", authMiddleware);
app.route("/api/v1/projects", projects);

// ─── 404 catch-all ──────────────────────────────────────────────

app.notFound((c) => {
  const body: ErrorBody = {
    error: {
      code: "NOT_FOUND",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
  };
  return c.json(body, 404);
});

// ─── Global error handler ───────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: { code: err.code, message: err.message },
    };
    return c.json(body, err.status as any);
  }

  // Unexpected error — log full details, return generic message
  console.error("Unhandled error:", err);
  const body: ErrorBody = {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  };
  return c.json(body, 500);
});

export default app;
```

---

## How it all fits together

```
team-task-board/
├── package.json
├── tsconfig.json
├── wrangler.toml
└── src/
    ├── index.ts              ← Hono app, global middleware, error handler
    ├── types.ts              ← Domain models, Env bindings, response shapes
    ├── errors.ts             ← AppError class (400/401/404/405/500)
    ├── validation.ts         ← Zod schemas for every write endpoint
    ├── kv.ts                 ← KV data-access layer (key conventions, CRUD)
    ├── util.ts               ← Shared helpers (parseBody)
    ├── middleware/
    │   ├── auth.ts           ← Bearer-token check against API_TOKEN secret
    │   ├── cors.ts           ← CORS with preflight support
    │   └── logger.ts         ← Request log (method, path, status, duration)
    └── routes/
        ├── health.ts         ← GET /api/v1/health (public)
        └── projects.ts       ← All /projects and nested /tasks routes
```

### Key design decisions

| Concern | Approach |
|---|---|
| **Framework** | **Hono** — built for Workers, tiny bundle, familiar Express-like API, first-class TypeScript |
| **Validation** | **Zod** with `.strict()` so unknown fields are rejected. Errors are mapped to the canonical `{ error: { code, message } }` envelope |
| **IDs** | `nanoid` — URL-safe, collision-resistant, no crypto overhead on Workers |
| **KV schema** | Separate keys per entity (`project:<id>`, `task:<id>`) plus lightweight index arrays (`project_index`, `task_index:<projectId>`) to avoid expensive `list()` operations |
| **Auth** | Middleware checks `Authorization: Bearer <token>` against the `API_TOKEN` secret binding. Health endpoint is mounted *before* the auth middleware so it's public |
| **CORS** | Hono's built-in `cors()` helper handles `OPTIONS` preflight automatically |
| **Pagination** | Offset-based (`page` + `pageSize`) with a response envelope that includes `total` and `totalPages` |
| **Nullable fields** | PATCH accepts `null` for `description` and `assignee` to explicitly clear them |
| **Error handling** | A single `AppError` class + `app.onError()` ensures every error path returns the same JSON shape. Unexpected errors log the real stack trace but return a generic 500 |

### Getting started

```bash
# 1. Install
npm install

# 2. Create the KV namespace and paste the ID into wrangler.toml
npx wrangler kv namespace create TASKS

# 3. Set the API secret
npx wrangler secret put API_TOKEN
# (paste your token when prompted)

# 4. Local dev
npm run dev

# 5. Deploy
npm run deploy
```

### Quick smoke test

```bash
TOKEN="your-secret-token"
BASE="http://localhost:8787/api/v1"

# Health (no auth needed)
curl $BASE/health

# Create a project
curl -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Redesign"}'

# Create a task (replace PROJECT_ID)
curl -X POST $BASE/projects/PROJECT_ID/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Design homepage","assignee":"alice"}'

# List tasks with filter + pagination
curl "$BASE/projects/PROJECT_ID/tasks?status=todo&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"
```