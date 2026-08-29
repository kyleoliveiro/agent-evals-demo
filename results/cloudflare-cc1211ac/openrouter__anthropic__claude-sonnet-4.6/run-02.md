<!-- model: openrouter/anthropic/claude-sonnet-4.6 | run: 2 | framework: Hono -->

I'll use **Hono** (purpose-built for edge runtimes) and **Zod** (validation), with a clean layered architecture: middleware → routes → services → KV.

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
    "hono": "^4.6.3",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241022.0",
    "typescript": "^5.6.3",
    "wrangler": "^3.80.4"
  }
}
```

---

### `wrangler.toml`

```toml
name            = "team-task-board"
main            = "src/index.ts"
compatibility_date  = "2024-09-23"

# API_TOKEN is a secret – set it once with:
#   wrangler secret put API_TOKEN
# It will NOT appear here.

[[kv_namespaces]]
binding    = "TASKS"
id         = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_KV_PREVIEW_NAMESPACE_ID"

[dev]
port = 8787
```

---

### `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `.dev.vars.example`

```ini
# Copy to .dev.vars (git-ignored) for local development
API_TOKEN=dev-super-secret-token-change-me
```

---

### `.gitignore`

```gitignore
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

export type Bindings = {
  TASKS: KVNamespace;
  API_TOKEN: string;
};
```

---

### `src/errors.ts`

```typescript
/** Structured application error that maps directly to an HTTP response. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  notFound: (resource = "Resource") =>
    new AppError(404, "NOT_FOUND", `${resource} not found`),

  badRequest: (message: string) =>
    new AppError(400, "BAD_REQUEST", message),

  validationError: (message: string) =>
    new AppError(400, "VALIDATION_ERROR", message),

  invalidJson: () =>
    new AppError(400, "INVALID_JSON", "Request body must be valid JSON"),

  unauthorized: (message = "Missing or invalid Authorization header") =>
    new AppError(401, "UNAUTHORIZED", message),
} as const;
```

---

### `src/validation.ts`

```typescript
import type { Context } from "hono";
import { z } from "zod";
import { Errors } from "./errors";

/** Parse + validate a JSON request body against a Zod schema. */
export async function parseBody<T>(
  c: Context,
  schema: z.ZodSchema<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw Errors.invalidJson();
  }
  return validate(schema, raw);
}

/** Validate an arbitrary value against a Zod schema, throwing AppError on failure. */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => {
        const path = i.path.length ? `${i.path.join(".")}: ` : "";
        return `${path}${i.message}`;
      })
      .join("; ");
    throw Errors.validationError(message);
  }
  return result.data;
}
```

---

### `src/schemas/project.ts`

```typescript
import { z } from "zod";

export const CreateProjectSchema = z.object({
  name: z
    .string({ required_error: "name is required" })
    .min(1, "name must not be empty")
    .max(100, "name must not exceed 100 characters")
    .trim(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
```

---

### `src/schemas/task.ts`

```typescript
import { z } from "zod";

export const TaskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const CreateTaskSchema = z.object({
  title: z
    .string({ required_error: "title is required" })
    .min(1, "title must not be empty")
    .max(200, "title must not exceed 200 characters")
    .trim(),
  description: z.string().max(5000).trim().optional(),
  status: TaskStatusSchema.default("todo"),
  assignee: z.string().max(100).trim().optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).trim().optional(),
    // null = explicitly clear the field
    description: z.string().max(5000).trim().nullable().optional(),
    status: TaskStatusSchema.optional(),
    assignee: z.string().max(100).trim().nullable().optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: "At least one field must be provided for update" },
  );

export const ListTasksQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
```

---

### `src/middleware/auth.ts`

```typescript
import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types";
import { Errors } from "../errors";

export const authMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = async (
  c,
  next,
) => {
  const header = c.req.header("Authorization");

  if (!header?.startsWith("Bearer ")) {
    throw Errors.unauthorized();
  }

  const provided = header.slice(7); // strip "Bearer "
  const expected = c.env.API_TOKEN;

  if (!expected || !timingSafeEqual(provided, expected)) {
    throw Errors.unauthorized("Invalid token");
  }

  await next();
};

/**
 * Constant-time string comparison to avoid leaking token length/content
 * through timing side-channels.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);

  // Always iterate over the full length of 'a' to prevent early-exit leaks.
  // Return false immediately after the loop if lengths differ.
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i % bb.length] ?? 0);
  }
  return ab.length === bb.length && diff === 0;
}
```

---

### `src/middleware/logger.ts`

```typescript
import type { MiddlewareHandler } from "hono";

export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  await next();

  const status = c.res.status;
  const durationMs = Date.now() - start;
  const level = status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO";

  // Structured JSON log – surfaces in `wrangler tail` and Workers Logs
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      method,
      path,
      status,
      duration_ms: durationMs,
    }),
  );
};
```

---

### `src/services/projects.ts`

```typescript
import type { Project } from "../types";

const PREFIX = "project:";
const key = (id: string) => `${PREFIX}${id}`;

export async function getProjectById(
  kv: KVNamespace,
  id: string,
): Promise<Project | null> {
  return kv.get<Project>(key(id), "json");
}

export async function listAllProjects(kv: KVNamespace): Promise<Project[]> {
  const list = await kv.list({ prefix: PREFIX });
  if (list.keys.length === 0) return [];

  const items = await Promise.all(
    list.keys.map((k) => kv.get<Project>(k.name, "json")),
  );

  return (items.filter((p): p is Project => p !== null)).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export async function saveProject(
  kv: KVNamespace,
  project: Project,
): Promise<void> {
  await kv.put(key(project.id), JSON.stringify(project));
}

export async function deleteProject(
  kv: KVNamespace,
  id: string,
): Promise<void> {
  await kv.delete(key(id));
}
```

---

### `src/services/tasks.ts`

```typescript
import type { Task, TaskStatus } from "../types";

const PREFIX = "task:";

const taskKey = (projectId: string, taskId: string) =>
  `${PREFIX}${projectId}:${taskId}`;

const projectTaskPrefix = (projectId: string) =>
  `${PREFIX}${projectId}:`;

export async function getTaskById(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<Task | null> {
  return kv.get<Task>(taskKey(projectId, taskId), "json");
}

export interface PaginatedTasks {
  data: Task[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export async function listTasks(
  kv: KVNamespace,
  projectId: string,
  opts: { status?: TaskStatus; page: number; pageSize: number },
): Promise<PaginatedTasks> {
  const prefix = projectTaskPrefix(projectId);

  // Exhaust KV cursor pagination to collect all keys for this project
  const allKeys: string[] = [];
  let cursor: string | undefined;

  do {
    const result = await kv.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    allKeys.push(...result.keys.map((k) => k.name));
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  if (allKeys.length === 0) {
    return {
      data: [],
      meta: { total: 0, page: opts.page, pageSize: opts.pageSize, totalPages: 0 },
    };
  }

  // Fetch values in parallel
  const tasks = (
    await Promise.all(allKeys.map((k) => kv.get<Task>(k, "json")))
  ).filter((t): t is Task => t !== null);

  // Optional status filter
  const filtered = opts.status
    ? tasks.filter((t) => t.status === opts.status)
    : tasks;

  // Stable sort: newest first
  filtered.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / opts.pageSize));
  const start = (opts.page - 1) * opts.pageSize;

  return {
    data: filtered.slice(start, start + opts.pageSize),
    meta: { total, page: opts.page, pageSize: opts.pageSize, totalPages },
  };
}

export async function saveTask(kv: KVNamespace, task: Task): Promise<void> {
  await kv.put(taskKey(task.projectId, task.id), JSON.stringify(task));
}

export async function deleteTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<void> {
  await kv.delete(taskKey(projectId, taskId));
}

/** Delete every task that belongs to a project. Used when deleting a project. */
export async function deleteAllTasksForProject(
  kv: KVNamespace,
  projectId: string,
): Promise<void> {
  const prefix = projectTaskPrefix(projectId);
  let cursor: string | undefined;

  do {
    const result = await kv.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    await Promise.all(result.keys.map((k) => kv.delete(k.name)));
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
}
```

---

### `src/routes/health.ts`

```typescript
import { Hono } from "hono";
import type { Bindings } from "../types";

export const healthRouter = new Hono<{ Bindings: Bindings }>();

healthRouter.get("/", (c) => c.json({ ok: true }));
```

---

### `src/routes/tasks.ts`

```typescript
import { Hono } from "hono";
import type { Bindings, Task } from "../types";
import { parseBody, validate } from "../validation";
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  ListTasksQuerySchema,
} from "../schemas/task";
import { Errors } from "../errors";
import { getProjectById } from "../services/projects";
import {
  getTaskById,
  listTasks,
  saveTask,
  deleteTask,
} from "../services/tasks";

export const taskRouter = new Hono<{ Bindings: Bindings }>();

// ─── GET /projects/:projectId/tasks ──────────────────────────────────────────
taskRouter.get("/", async (c) => {
  const { projectId } = c.req.param();

  const project = await getProjectById(c.env.TASKS, projectId);
  if (!project) throw Errors.notFound("Project");

  // Collect only defined query params so Zod defaults work correctly
  const rawQuery: Record<string, string> = {};
  const status = c.req.query("status");
  const page = c.req.query("page");
  const pageSize = c.req.query("pageSize");
  if (status !== undefined) rawQuery["status"] = status;
  if (page !== undefined) rawQuery["page"] = page;
  if (pageSize !== undefined) rawQuery["pageSize"] = pageSize;

  const query = validate(ListTasksQuerySchema, rawQuery);
  const result = await listTasks(c.env.TASKS, projectId, query);

  return c.json(result);
});

// ─── POST /projects/:projectId/tasks ─────────────────────────────────────────
taskRouter.post("/", async (c) => {
  const { projectId } = c.req.param();

  const project = await getProjectById(c.env.TASKS, projectId);
  if (!project) throw Errors.notFound("Project");

  const body = await parseBody(c, CreateTaskSchema);
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

  await saveTask(c.env.TASKS, task);
  return c.json({ data: task }, 201);
});

// ─── GET /projects/:projectId/tasks/:taskId ───────────────────────────────────
taskRouter.get("/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();

  const project = await getProjectById(c.env.TASKS, projectId);
  if (!project) throw Errors.notFound("Project");

  const task = await getTaskById(c.env.TASKS, projectId, taskId);
  if (!task) throw Errors.notFound("Task");

  return c.json({ data: task });
});

// ─── PATCH /projects/:projectId/tasks/:taskId ────────────────────────────────
taskRouter.patch("/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();

  const project = await getProjectById(c.env.TASKS, projectId);
  if (!project) throw Errors.notFound("Project");

  const existing = await getTaskById(c.env.TASKS, projectId, taskId);
  if (!existing) throw Errors.notFound("Task");

  const body = await parseBody(c, UpdateTaskSchema);

  // Build the updated task.  nullable fields (description, assignee) with a
  // null value mean "clear this field"; undefined means "leave unchanged".
  const updated: Task = {
    ...existing,
    ...(body.title !== undefined && { title: body.title }),
    ...(body.status !== undefined && { status: body.status }),
    // description: null  →  omit key (delete); string → overwrite; undefined → keep existing
    ...(body.description !== undefined && {
      description:
        body.description === null ? undefined : body.description,
    }),
    ...(body.assignee !== undefined && {
      assignee: body.assignee === null ? undefined : body.assignee,
    }),
    updatedAt: new Date().toISOString(),
  };

  // Explicitly drop cleared optional keys so they don't persist as `undefined`
  // in the serialised JSON (JSON.stringify drops them anyway, but this keeps
  // the in-memory object tidy and the TypeScript types happy).
  if (body.description === null) delete updated.description;
  if (body.assignee === null) delete updated.assignee;

  await saveTask(c.env.TASKS, updated);
  return c.json({ data: updated });
});

// ─── DELETE /projects/:projectId/tasks/:taskId ───────────────────────────────
taskRouter.delete("/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();

  const project = await getProjectById(c.env.TASKS, projectId);
  if (!project) throw Errors.notFound("Project");

  const task = await getTaskById(c.env.TASKS, projectId, taskId);
  if (!task) throw Errors.notFound("Task");

  await deleteTask(c.env.TASKS, projectId, taskId);
  return c.body(null, 204);
});
```

---

### `src/routes/projects.ts`

```typescript
import { Hono } from "hono";
import type { Bindings, Project } from "../types";
import { parseBody } from "../validation";
import { CreateProjectSchema } from "../schemas/project";
import { Errors } from "../errors";
import { authMiddleware } from "../middleware/auth";
import {
  getProjectById,
  listAllProjects,
  saveProject,
  deleteProject,
} from "../services/projects";
import { deleteAllTasksForProject } from "../services/tasks";
import { taskRouter } from "./tasks";

export const projectRouter = new Hono<{ Bindings: Bindings }>();

// Auth guard for every route in this router (and its sub-routers)
projectRouter.use("*", authMiddleware);

// ─── GET /projects ────────────────────────────────────────────────────────────
projectRouter.get("/", async (c) => {
  const projects = await listAllProjects(c.env.TASKS);
  return c.json({ data: projects });
});

// ─── POST /projects ───────────────────────────────────────────────────────────
projectRouter.post("/", async (c) => {
  const body = await parseBody(c, CreateProjectSchema);

  const project: Project = {
    id: crypto.randomUUID(),
    name: body.name,
    createdAt: new Date().toISOString(),
  };

  await saveProject(c.env.TASKS, project);
  return c.json({ data: project }, 201);
});

// ─── GET /projects/:projectId ─────────────────────────────────────────────────
projectRouter.get("/:projectId", async (c) => {
  const { projectId } = c.req.param();
  const project = await getProjectById(c.env.TASKS, projectId);
  if (!project) throw Errors.notFound("Project");
  return c.json({ data: project });
});

// ─── DELETE /projects/:projectId ──────────────────────────────────────────────
projectRouter.delete("/:projectId", async (c) => {
  const { projectId } = c.req.param();

  const project = await getProjectById(c.env.TASKS, projectId);
  if (!project) throw Errors.notFound("Project");

  // Fan-out: delete the project record and all its tasks concurrently
  await Promise.all([
    deleteProject(c.env.TASKS, projectId),
    deleteAllTasksForProject(c.env.TASKS, projectId),
  ]);

  return c.body(null, 204);
});

// ─── /projects/:projectId/tasks/** ───────────────────────────────────────────
// Mount task sub-router; :projectId param is forwarded automatically by Hono.
projectRouter.route("/:projectId/tasks", taskRouter);
```

---

### `src/index.ts`

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Bindings } from "./types";
import { AppError } from "./errors";
import { loggerMiddleware } from "./middleware/logger";
import { healthRouter } from "./routes/health";
import { projectRouter } from "./routes/projects";

const app = new Hono<{ Bindings: Bindings }>();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(
  "*",
  cors({
    origin: "*",                                      // tighten per-deployment as needed
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: [],
    maxAge: 86_400,
    credentials: false,
  }),
);

app.use("*", loggerMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────────────

const v1 = new Hono<{ Bindings: Bindings }>();

// Public – no auth
v1.route("/health", healthRouter);

// Protected – auth is enforced inside projectRouter via its own middleware
v1.route("/projects", projectRouter);

app.route("/api/v1", v1);

// ─── 404 – unknown route ──────────────────────────────────────────────────────

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `Cannot ${c.req.method} ${new URL(c.req.url).pathname}`,
      },
    },
    404,
  ),
);

// ─── Global error handler ─────────────────────────────────────────────────────

app.onError((err, c) => {
  // Our own structured errors (validation, 404, 401, …)
  if (err instanceof AppError) {
    return c.json(
      { error: { code: err.code, message: err.message } },
      err.statusCode as Parameters<typeof c.json>[1],
    );
  }

  // Hono HTTP exceptions (e.g. 405 Method Not Allowed thrown by the router)
  if (err instanceof HTTPException) {
    const code =
      err.status === 405
        ? "METHOD_NOT_ALLOWED"
        : err.status === 401
          ? "UNAUTHORIZED"
          : "HTTP_ERROR";
    return c.json(
      { error: { code, message: err.message } },
      err.status,
    );
  }

  // Unexpected errors – log server-side, hide detail from client
  console.error(
    JSON.stringify({
      level: "ERROR",
      ts: new Date().toISOString(),
      message: "Unhandled exception",
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    500,
  );
});

export default app;
```

---

### `README.md`

```markdown
# Team Task Board API

A production-ready REST API built on **Cloudflare Workers** (TypeScript) with **Hono** + **Zod**, backed by **Cloudflare KV**.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | [Hono](https://hono.dev) |
| Validation | [Zod](https://zod.dev) |
| Storage | Cloudflare KV |
| Tooling | Wrangler, TypeScript |

---

## Quick start

### 1. Install dependencies
```bash
npm install
```

### 2. Create a KV namespace
```bash
# Production namespace
npx wrangler kv:namespace create TASKS

# Preview namespace (used by `wrangler dev`)
npx wrangler kv:namespace create TASKS --preview
```

Copy the printed `id` and `preview_id` values into `wrangler.toml`.

### 3. Set the API token secret
```bash
# Production
npx wrangler secret put API_TOKEN

# Local dev – create .dev.vars (git-ignored)
cp .dev.vars.example .dev.vars
# then edit .dev.vars and set API_TOKEN=<your-token>
```

### 4. Run locally
```bash
npm run dev
```

### 5. Deploy
```bash
npm run deploy
```

---

## API reference

Base URL: `https://<worker>.workers.dev/api/v1`

All endpoints except `/health` require:
```
Authorization: Bearer <API_TOKEN>
```

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | ✗ | Liveness check |

### Projects
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/projects` | ✓ | List all projects |
| POST | `/projects` | ✓ | Create project `{ name }` |
| GET | `/projects/:id` | ✓ | Get project by ID |
| DELETE | `/projects/:id` | ✓ | Delete project + its tasks |

### Tasks
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/projects/:pid/tasks` | ✓ | List tasks (filter + paginate) |
| POST | `/projects/:pid/tasks` | ✓ | Create task |
| GET | `/projects/:pid/tasks/:tid` | ✓ | Get task |
| PATCH | `/projects/:pid/tasks/:tid` | ✓ | Partial update |
| DELETE | `/projects/:pid/tasks/:tid` | ✓ | Delete task |

#### Task list query params
| Param | Type | Default | Description |
|---|---|---|---|
| `status` | `todo\|in_progress\|done` | — | Filter by status |
| `page` | integer ≥ 1 | `1` | Page number |
| `pageSize` | integer 1–100 | `20` | Items per page |

#### Create task body
```json
{
  "title": "string (required)",
  "description": "string (optional)",
  "status": "todo | in_progress | done  (default: todo)",
  "assignee": "string (optional)"
}
```

#### Patch task body (all fields optional, at least one required)
```json
{
  "title": "string",
  "description": "string | null  (null clears the field)",
  "status": "todo | in_progress | done",
  "assignee": "string | null  (null clears the field)"
}
```

### Error shape
All errors use a consistent envelope:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title: String must contain at least 1 character(s)"
  }
}
```

Common codes: `NOT_FOUND`, `VALIDATION_ERROR`, `INVALID_JSON`, `UNAUTHORIZED`, `METHOD_NOT_ALLOWED`, `INTERNAL_ERROR`.

---

## KV key scheme

| Key pattern | Value |
|---|---|
| `project:{id}` | JSON `Project` |
| `task:{projectId}:{taskId}` | JSON `Task` |
```

---

## Architecture notes

Here is a visual map of every request's journey through the code:

```
Inbound request
     │
     ▼
app (Hono<Bindings>)
  ├─ cors()              ← handles OPTIONS preflight, injects CORS headers
  ├─ loggerMiddleware    ← structured JSON log after response is set
  │
  └─ /api/v1  →  v1 (Hono)
       ├─ GET /health  →  healthRouter   (no auth)
       │
       └─ /projects    →  projectRouter  (Hono)
            ├─ use("*") authMiddleware   ← timing-safe Bearer check
            ├─ GET    /
            ├─ POST   /
            ├─ GET    /:projectId
            ├─ DELETE /:projectId
            │
            └─ /:projectId/tasks  →  taskRouter  (Hono, inherits auth)
                 ├─ GET    /
                 ├─ POST   /
                 ├─ GET    /:taskId
                 ├─ PATCH  /:taskId
                 └─ DELETE /:taskId

app.notFound  →  404 { error: { code, message } }
app.onError   →  AppError | HTTPException | unknown  →  correct status + shape
```

Key design decisions:

| Concern | Decision |
|---|---|
| **Auth placement** | Middleware is registered once on `projectRouter` with `use("*", …)`, so it automatically covers every project + task route without repetition |
| **Token comparison** | Custom constant-time loop avoids timing side-channels that would leak token length or prefix |
| **KV pagination** | `do/while` cursor loop in services exhausts all KV pages before filtering/sorting, so result counts are always correct |
| **Clearing optional fields** | `PATCH` accepts `null` for `description`/`assignee` to explicitly unset them; the service layer drops the key from the stored JSON |
| **204 responses** | `c.body(null, 204)` — no body, no `Content-Type` header, correct HTTP semantics for DELETE |
| **Error bubbling** | All handlers throw `AppError`; `app.onError` is the single place that serialises errors into the consistent `{ error: { code, message } }` shape |