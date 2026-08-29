<!-- model: openrouter/anthropic/claude-sonnet-4.6 | run: 3 | framework: Hono -->

Here is the complete, production-ready implementation. I'm using **Hono** (purpose-built for edge/Workers), **Zod** for validation, and the standard `@cloudflare/workers-types` package.

---

### `package.json`
```json
{
  "name": "team-task-board",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "type-check": "tsc --noEmit",
    "cf-typegen": "wrangler types --env-interface CloudflareBindings"
  },
  "dependencies": {
    "hono": "^4.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240725.0",
    "typescript": "^5.5.4",
    "wrangler": "^3.65.0"
  }
}
```

---

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["@cloudflare/workers-types"],
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": false,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `wrangler.toml`
```toml
name            = "team-task-board"
main            = "src/index.ts"
compatibility_date  = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

# ── KV namespace ─────────────────────────────────────────────────────────────
# Create with: wrangler kv namespace create TASKS
# Then replace the placeholder IDs below.
[[kv_namespaces]]
binding    = "TASKS"
id         = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_KV_PREVIEW_NAMESPACE_ID"

# ── Secrets ───────────────────────────────────────────────────────────────────
# API_TOKEN must be set as a secret — never commit the value.
# Run: wrangler secret put API_TOKEN
#
# For local dev, put the value in .dev.vars (git-ignored):
#   API_TOKEN=dev-secret-change-me

[observability]
enabled = true
```

---

### `.dev.vars`
```ini
# Local-only env vars for `wrangler dev` — do NOT commit real secrets.
API_TOKEN=dev-secret-change-me
```

---

### `.gitignore`
```
node_modules/
dist/
.wrangler/
.dev.vars
*.tsbuildinfo
```

---

### `src/types.ts`
```typescript
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
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** Cloudflare bindings injected by the runtime */
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}
```

---

### `src/lib/errors.ts`
```typescript
// ── Typed error shape ─────────────────────────────────────────────────────────

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/** Builds the canonical error envelope. */
export function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

// ── Error classes ─────────────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      "NOT_FOUND",
      id ? `${resource} '${id}' not found` : `${resource} not found`,
      404
    );
  }
}
```

---

### `src/lib/schemas.ts`
```typescript
import { z } from "zod";

// ── Projects ──────────────────────────────────────────────────────────────────

export const CreateProjectSchema = z.object({
  name: z
    .string({ required_error: "name is required" })
    .min(1, "name must not be empty")
    .max(100, "name must be at most 100 characters")
    .trim(),
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const TaskStatusEnum = z.enum(["todo", "in_progress", "done"]);

export const CreateTaskSchema = z.object({
  title: z
    .string({ required_error: "title is required" })
    .min(1, "title must not be empty")
    .max(200, "title must be at most 200 characters")
    .trim(),
  description: z
    .string()
    .max(2000, "description must be at most 2000 characters")
    .optional(),
  status: TaskStatusEnum.default("todo"),
  assignee: z
    .string()
    .max(100, "assignee must be at most 100 characters")
    .optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).trim().optional(),
    // null means "clear the field"; omitted means "leave unchanged"
    description: z.string().max(2000).nullable().optional(),
    status: TaskStatusEnum.optional(),
    assignee: z.string().max(100).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided for update",
  });

export const TaskQuerySchema = z.object({
  status: TaskStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
```

---

### `src/lib/validate.ts`
```typescript
import type { ZodSchema } from "zod";
import { ValidationError } from "./errors";

/**
 * Parse `data` against `schema`.
 * Throws a `ValidationError` (→ HTTP 400) on failure.
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.errors
      .map((e) => {
        const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
        return `${path}${e.message}`;
      })
      .join("; ");
    throw new ValidationError(message);
  }
  return result.data;
}

/**
 * Read the request body as JSON and validate it.
 * Throws a `ValidationError` when the body is not valid JSON or fails the schema.
 */
export async function parseJsonBody<T>(
  schema: ZodSchema<T>,
  request: Request
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  return validate(schema, raw);
}
```

---

### `src/lib/kv.ts`
```typescript
import type { Project, Task } from "../types";

// ── Key helpers ───────────────────────────────────────────────────────────────
//
//   project:{projectId}           →  Project JSON
//   task:{projectId}:{taskId}     →  Task JSON

const KEY = {
  project: (id: string) => `project:${id}`,
  task: (projectId: string, taskId: string) => `task:${projectId}:${taskId}`,
  PROJECT_PREFIX: "project:",
  taskPrefix: (projectId: string) => `task:${projectId}:`,
} as const;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * List **all** KV keys with a given prefix, transparently following the
 * pagination cursor so we never miss entries beyond the first 1 000.
 */
async function listKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;

  do {
    const opts: KVNamespaceListOptions = { prefix, limit: 1000 };
    if (cursor) opts.cursor = cursor;

    const result = await kv.list(opts);
    names.push(...result.keys.map((k) => k.name));
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor !== undefined);

  return names;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function getProject(
  kv: KVNamespace,
  id: string
): Promise<Project | null> {
  return kv.get<Project>(KEY.project(id), { type: "json" });
}

export async function listAllProjects(kv: KVNamespace): Promise<Project[]> {
  const names = await listKeys(kv, KEY.PROJECT_PREFIX);
  if (names.length === 0) return [];
  const items = await Promise.all(
    names.map((n) => kv.get<Project>(n, { type: "json" }))
  );
  return items.filter((p): p is Project => p !== null);
}

export async function putProject(
  kv: KVNamespace,
  project: Project
): Promise<void> {
  await kv.put(KEY.project(project.id), JSON.stringify(project));
}

export async function deleteProject(
  kv: KVNamespace,
  id: string
): Promise<void> {
  await kv.delete(KEY.project(id));
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function getTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string
): Promise<Task | null> {
  return kv.get<Task>(KEY.task(projectId, taskId), { type: "json" });
}

export async function listAllTasks(
  kv: KVNamespace,
  projectId: string
): Promise<Task[]> {
  const names = await listKeys(kv, KEY.taskPrefix(projectId));
  if (names.length === 0) return [];
  const items = await Promise.all(
    names.map((n) => kv.get<Task>(n, { type: "json" }))
  );
  return items.filter((t): t is Task => t !== null);
}

export async function putTask(kv: KVNamespace, task: Task): Promise<void> {
  await kv.put(KEY.task(task.projectId, task.id), JSON.stringify(task));
}

export async function deleteTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string
): Promise<void> {
  await kv.delete(KEY.task(projectId, taskId));
}

export async function deleteProjectTasks(
  kv: KVNamespace,
  projectId: string
): Promise<void> {
  const names = await listKeys(kv, KEY.taskPrefix(projectId));
  if (names.length === 0) return;
  await Promise.all(names.map((n) => kv.delete(n)));
}
```

---

### `src/middleware/auth.ts`
```typescript
import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";
import { errorBody } from "../lib/errors";

/**
 * Validate `Authorization: Bearer <token>` against the `API_TOKEN` secret.
 * Returns HTTP 401 in the standard error shape on failure.
 */
export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next
) => {
  const header = c.req.header("Authorization") ?? "";

  if (!header.startsWith("Bearer ")) {
    return c.json(
      errorBody(
        "UNAUTHORIZED",
        "Missing or malformed Authorization header — expected: Bearer <token>"
      ),
      401
    );
  }

  const token = header.slice(7).trim();

  // Constant-time comparison is ideal for tokens; Workers has no built-in
  // crypto.timingSafeEqual for strings, so we compare lengths first to avoid
  // short-circuit leaking length, then do a character-level XOR-accumulate.
  const expected = c.env.API_TOKEN ?? "";
  let mismatch = token.length ^ expected.length;
  const len = Math.max(token.length, expected.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (token.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }

  if (mismatch !== 0) {
    return c.json(errorBody("UNAUTHORIZED", "Invalid bearer token"), 401);
  }

  await next();
};
```

---

### `src/middleware/logger.ts`
```typescript
import type { MiddlewareHandler } from "hono";

/**
 * Structured JSON request logger.
 * Logs method, path, status code and wall-clock duration after every response.
 */
export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;

  // Use console.log so Cloudflare's tail / live-logs capture it.
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs,
    })
  );
};
```

---

### `src/routes/projects.ts`
```typescript
import { Hono } from "hono";
import type { Env, Project } from "../types";
import { CreateProjectSchema } from "../lib/schemas";
import { NotFoundError } from "../lib/errors";
import { parseJsonBody } from "../lib/validate";
import * as store from "../lib/kv";

export const projectsRouter = new Hono<{ Bindings: Env }>();

// ── GET /projects ─────────────────────────────────────────────────────────────
projectsRouter.get("/", async (c) => {
  const projects = await store.listAllProjects(c.env.TASKS);
  // Sort newest-first
  projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json(projects);
});

// ── POST /projects ────────────────────────────────────────────────────────────
projectsRouter.post("/", async (c) => {
  const body = await parseJsonBody(CreateProjectSchema, c.req.raw);

  const project: Project = {
    id: crypto.randomUUID(),
    name: body.name,
    createdAt: new Date().toISOString(),
  };

  await store.putProject(c.env.TASKS, project);
  return c.json(project, 201);
});

// ── GET /projects/:projectId ──────────────────────────────────────────────────
projectsRouter.get("/:projectId", async (c) => {
  const { projectId } = c.req.param();
  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) throw new NotFoundError("Project", projectId);
  return c.json(project);
});

// ── DELETE /projects/:projectId ───────────────────────────────────────────────
projectsRouter.delete("/:projectId", async (c) => {
  const { projectId } = c.req.param();
  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) throw new NotFoundError("Project", projectId);

  // Delete project and all its tasks atomically (best-effort with KV).
  await Promise.all([
    store.deleteProject(c.env.TASKS, projectId),
    store.deleteProjectTasks(c.env.TASKS, projectId),
  ]);

  return c.body(null, 204);
});
```

---

### `src/routes/tasks.ts`
```typescript
import { Hono } from "hono";
import type { Env, Task } from "../types";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  TaskQuerySchema,
} from "../lib/schemas";
import { NotFoundError } from "../lib/errors";
import { parseJsonBody, validate } from "../lib/validate";
import * as store from "../lib/kv";

export const tasksRouter = new Hono<{ Bindings: Env }>();

// ── GET /projects/:projectId/tasks ────────────────────────────────────────────
tasksRouter.get("/:projectId/tasks", async (c) => {
  const { projectId } = c.req.param();

  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) throw new NotFoundError("Project", projectId);

  // Validate + coerce query params
  const query = validate(TaskQuerySchema, {
    status: c.req.query("status"),
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });

  let tasks = await store.listAllTasks(c.env.TASKS, projectId);

  // Optional status filter
  if (query.status) {
    tasks = tasks.filter((t) => t.status === query.status);
  }

  // Sort newest-first
  tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Paginate
  const total = tasks.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const start = (query.page - 1) * query.pageSize;
  const data = tasks.slice(start, start + query.pageSize);

  return c.json({
    data,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
    },
  });
});

// ── POST /projects/:projectId/tasks ───────────────────────────────────────────
tasksRouter.post("/:projectId/tasks", async (c) => {
  const { projectId } = c.req.param();

  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) throw new NotFoundError("Project", projectId);

  const body = await parseJsonBody(CreateTaskSchema, c.req.raw);
  const now = new Date().toISOString();

  const task: Task = {
    id: crypto.randomUUID(),
    projectId,
    title: body.title,
    status: body.status,
    createdAt: now,
    updatedAt: now,
    ...(body.description !== undefined && { description: body.description }),
    ...(body.assignee !== undefined && { assignee: body.assignee }),
  };

  await store.putTask(c.env.TASKS, task);
  return c.json(task, 201);
});

// ── GET /projects/:projectId/tasks/:taskId ────────────────────────────────────
tasksRouter.get("/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();

  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) throw new NotFoundError("Project", projectId);

  const task = await store.getTask(c.env.TASKS, projectId, taskId);
  if (!task) throw new NotFoundError("Task", taskId);

  return c.json(task);
});

// ── PATCH /projects/:projectId/tasks/:taskId ──────────────────────────────────
tasksRouter.patch("/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();

  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) throw new NotFoundError("Project", projectId);

  const task = await store.getTask(c.env.TASKS, projectId, taskId);
  if (!task) throw new NotFoundError("Task", taskId);

  const body = await parseJsonBody(UpdateTaskSchema, c.req.raw);

  // Shallow-clone current task, bump updatedAt.
  const updated: Task = { ...task, updatedAt: new Date().toISOString() };

  if (body.title !== undefined) {
    updated.title = body.title;
  }
  if (body.status !== undefined) {
    updated.status = body.status;
  }
  // null  → clear the optional field
  // value → set it
  // key absent (undefined) → leave unchanged
  if ("description" in body) {
    if (body.description === null) {
      delete updated.description;
    } else if (body.description !== undefined) {
      updated.description = body.description;
    }
  }
  if ("assignee" in body) {
    if (body.assignee === null) {
      delete updated.assignee;
    } else if (body.assignee !== undefined) {
      updated.assignee = body.assignee;
    }
  }

  await store.putTask(c.env.TASKS, updated);
  return c.json(updated);
});

// ── DELETE /projects/:projectId/tasks/:taskId ─────────────────────────────────
tasksRouter.delete("/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();

  const project = await store.getProject(c.env.TASKS, projectId);
  if (!project) throw new NotFoundError("Project", projectId);

  const task = await store.getTask(c.env.TASKS, projectId, taskId);
  if (!task) throw new NotFoundError("Task", taskId);

  await store.deleteTask(c.env.TASKS, projectId, taskId);
  return c.body(null, 204);
});
```

---

### `src/index.ts`
```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { authMiddleware } from "./middleware/auth";
import { loggerMiddleware } from "./middleware/logger";
import { projectsRouter } from "./routes/projects";
import { tasksRouter } from "./routes/tasks";
import { AppError, errorBody } from "./lib/errors";

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// ── Global middleware (runs on every request, including OPTIONS preflights) ───

app.use(
  "*",
  cors({
    origin: "*", // tighten to specific origins in production if needed
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86_400,
    credentials: false,
  })
);

app.use("*", loggerMiddleware);

// ── Public routes (no auth) ───────────────────────────────────────────────────

app.get("/api/v1/health", (c) => c.json({ ok: true }));

// ── Protected API ─────────────────────────────────────────────────────────────
// All routes below require a valid Bearer token.

const api = new Hono<{ Bindings: Env }>();

api.use("*", authMiddleware);

// Both routers are mounted at the same base path.
// Hono tries each in registration order; single-segment params like /:projectId
// will not match multi-segment paths like /:projectId/tasks, so there is no
// ambiguity between the two routers.
api.route("/projects", projectsRouter);
api.route("/projects", tasksRouter);

app.route("/api/v1", api);

// ── 404 – unknown routes ──────────────────────────────────────────────────────

app.notFound((c) => {
  const { pathname } = new URL(c.req.url);
  return c.json(
    errorBody("NOT_FOUND", `Cannot ${c.req.method} ${pathname}`),
    404
  );
});

// ── Global error handler ──────────────────────────────────────────────────────

app.onError((err, c) => {
  // Our own typed errors (ValidationError, NotFoundError, …)
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message), err.status as 400 | 401 | 404 | 500);
  }

  // Hono's own HTTP exceptions (e.g. 405 from method-not-allowed detection)
  if (err instanceof HTTPException) {
    const codeMap: Partial<Record<number, string>> = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      405: "METHOD_NOT_ALLOWED",
      409: "CONFLICT",
      422: "UNPROCESSABLE_ENTITY",
      429: "TOO_MANY_REQUESTS",
    };
    const code = codeMap[err.status] ?? "HTTP_ERROR";
    return c.json(
      errorBody(code, err.message),
      err.status as 400 | 401 | 403 | 404 | 405 | 409 | 422 | 429 | 500
    );
  }

  // Truly unexpected — log the full error, return a safe 500.
  console.error("[UnhandledError]", err);
  return c.json(errorBody("INTERNAL_ERROR", "An unexpected error occurred"), 500);
});

// ── Export ────────────────────────────────────────────────────────────────────

export default app;
```

---

## Setup & Usage

```bash
# 1. Install deps
npm install

# 2. Create the KV namespace (copy the output IDs into wrangler.toml)
wrangler kv namespace create TASKS
wrangler kv namespace create TASKS --preview

# 3. Store the API token as an encrypted secret
wrangler secret put API_TOKEN

# 4. Local dev (reads .dev.vars for the token)
npm run dev

# 5. Type-check
npm run type-check

# 6. Deploy to production
npm run deploy
```

### Example requests

```bash
BASE=http://localhost:8787/api/v1
TOKEN=dev-secret-change-me

# Health (no auth)
curl $BASE/health

# Create project
curl -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Launch v2"}'

# List projects
curl $BASE/projects -H "Authorization: Bearer $TOKEN"

# Create task
curl -X POST $BASE/projects/<projectId>/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Write docs","status":"in_progress","assignee":"alice"}'

# List tasks (with filter + pagination)
curl "$BASE/projects/<projectId>/tasks?status=in_progress&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"

# Partial update (null clears the field)
curl -X PATCH $BASE/projects/<projectId>/tasks/<taskId> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"done","assignee":null}'
```

---

## Key design decisions

| Concern | Decision | Rationale |
|---|---|---|
| Framework | **Hono v4** | Zero-dependency, first-class CF Workers support, typed bindings |
| Validation | **Zod** | Composable schemas; `.safeParse()` avoids throws in hot paths |
| KV key design | `project:{id}` / `task:{projectId}:{taskId}` | Prefix-based scanning — no separate index array that could drift |
| KV listing | Cursor loop (`list_complete`) | Handles > 1 000 entries without silent data loss |
| Auth | Constant-time string compare | Mitigates timing-oracle attacks on the token |
| Error shape | `{ error: { code, message } }` everywhere | Single shape for all 4xx/5xx makes client error handling trivial |
| PATCH nulls | `null` = clear, `undefined`/absent = leave | Industry-standard partial-update semantics |
| 204 bodies | `c.body(null, 204)` | RFC 9110 §15.3.5 — no body on successful DELETE |