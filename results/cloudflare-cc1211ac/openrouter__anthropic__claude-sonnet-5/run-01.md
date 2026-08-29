<!-- model: openrouter/anthropic/claude-sonnet-5 | run: 1 | framework: Hono -->

Below is a complete, production-ready Cloudflare Workers TypeScript project implementing the team task board API using **Hono** (lightweight, fast router built for Workers) and **Zod** for validation.

## Project structure

```
team-task-board/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── .gitignore
├── README.md
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── errors.ts
│   ├── validation.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── logger.ts
│   ├── repositories/
│   │   ├── kv.ts
│   │   ├── projectRepo.ts
│   │   └── taskRepo.ts
│   └── routes/
│       ├── health.ts
│       ├── projects.ts
│       └── tasks.ts
└── test/
    └── smoke.test.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "Team task board REST API on Cloudflare Workers",
  "main": "src/index.ts",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "kv:create": "wrangler kv namespace create TASKS"
  },
  "dependencies": {
    "hono": "^4.6.9",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241022.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4",
    "wrangler": "^3.86.0"
  }
}
```

---

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "lib": ["ES2021"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

---

### `wrangler.toml`

```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_KV_PREVIEW_NAMESPACE_ID"

# Secrets (do NOT put real values here — use `wrangler secret put API_TOKEN`)
# [vars] can hold non-secret config, e.g.:
[vars]
CORS_ALLOWED_ORIGIN = "*"
```

> Create the KV namespace with `wrangler kv namespace create TASKS`, paste the returned `id`
> into `wrangler.toml`, and set the secret with:
> `wrangler secret put API_TOKEN`

---

### `.gitignore`

```
node_modules
dist
.wrangler
.dev.vars
*.log
```

---

### `src/types.ts`

```ts
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
  CORS_ALLOWED_ORIGIN?: string;
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

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

---

### `src/errors.ts`

```ts
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "AppError";
  }
}

export const errors = {
  badRequest: (message: string, code = "VALIDATION_ERROR") =>
    new AppError(400, code, message),
  unauthorized: (message = "Missing or invalid Authorization header") =>
    new AppError(401, "UNAUTHORIZED", message),
  notFound: (message = "Resource not found") =>
    new AppError(404, "NOT_FOUND", message),
  methodNotAllowed: (message = "Method not allowed") =>
    new AppError(405, "METHOD_NOT_ALLOWED", message),
  internal: (message = "Internal server error") =>
    new AppError(500, "INTERNAL_ERROR", message),
};

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}
```

---

### `src/validation.ts`

```ts
import { z } from "zod";
import { AppError } from "./errors";

export const TaskStatusEnum = z.enum(["todo", "in_progress", "done"]);

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
});

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(300),
  description: z.string().trim().max(5000).optional(),
  status: TaskStatusEnum.optional(),
  assignee: z.string().trim().max(200).optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    status: TaskStatusEnum.optional(),
    assignee: z.string().trim().max(200).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const TaskQuerySchema = z.object({
  status: TaskStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Parses JSON body safely and validates with the given zod schema.
 * Throws AppError(400) on any failure.
 */
export async function parseAndValidate<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<T> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    throw new AppError(400, "VALIDATION_ERROR", message);
  }
  return result.data;
}

export function validateQuery<T>(
  query: Record<string, string | undefined>,
  schema: z.ZodSchema<T>
): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join(".") || "query"}: ${i.message}`)
      .join("; ");
    throw new AppError(400, "VALIDATION_ERROR", message);
  }
  return result.data;
}
```

---

### `src/middleware/auth.ts`

```ts
import { MiddlewareHandler } from "hono";
import { Env } from "../types";
import { errors } from "../errors";

export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next
) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    throw errors.unauthorized();
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token || token !== c.env.API_TOKEN) {
    throw errors.unauthorized("Invalid API token");
  }

  await next();
};
```

---

### `src/middleware/logger.ts`

```ts
import { MiddlewareHandler } from "hono";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const { method } = c.req;
  const path = new URL(c.req.url).pathname;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  // Structured log line — pipe to your log sink of choice (Workers Logs, Logpush, etc.)
  console.log(
    JSON.stringify({
      level: "info",
      method,
      path,
      status,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    })
  );
};
```

---

### `src/repositories/kv.ts`

```ts
/**
 * Lists ALL keys under a given prefix, transparently paging through
 * KV's cursor-based list API (KV returns up to 1000 keys per call).
 */
export async function listAllKeys(
  kv: KVNamespace,
  prefix: string
): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const result: KVNamespaceListResult<unknown> = await kv.list({
      prefix,
      cursor,
    });
    for (const k of result.keys) keys.push(k.name);
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return keys;
}

export async function getJSON<T>(kv: KVNamespace, key: string): Promise<T | null> {
  return kv.get<T>(key, "json");
}

export async function putJSON<T>(
  kv: KVNamespace,
  key: string,
  value: T
): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}
```

---

### `src/repositories/projectRepo.ts`

```ts
import { Env, Project } from "../types";
import { getJSON, putJSON, listAllKeys } from "./kv";
import { listAllKeys as _unused } from "./kv"; // eslint-disable-line

const PROJECT_PREFIX = "project:";

const projectKey = (id: string) => `${PROJECT_PREFIX}${id}`;

export async function createProject(
  env: Env,
  input: { name: string }
): Promise<Project> {
  const project: Project = {
    id: crypto.randomUUID(),
    name: input.name,
    createdAt: new Date().toISOString(),
  };
  await putJSON(env.TASKS, projectKey(project.id), project);
  return project;
}

export async function getProject(
  env: Env,
  id: string
): Promise<Project | null> {
  return getJSON<Project>(env.TASKS, projectKey(id));
}

export async function listProjects(env: Env): Promise<Project[]> {
  const keys = await listAllKeys(env.TASKS, PROJECT_PREFIX);
  const projects = await Promise.all(
    keys.map((k) => getJSON<Project>(env.TASKS, k))
  );
  return projects
    .filter((p): p is Project => p !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteProject(env: Env, id: string): Promise<void> {
  await env.TASKS.delete(projectKey(id));
}
```

---

### `src/repositories/taskRepo.ts`

```ts
import { Env, Task, TaskStatus, Paginated } from "../types";
import { getJSON, putJSON, listAllKeys } from "./kv";

const taskPrefix = (projectId: string) => `task:${projectId}:`;
const taskKey = (projectId: string, taskId: string) =>
  `${taskPrefix(projectId)}${taskId}`;

export async function createTask(
  env: Env,
  projectId: string,
  input: {
    title: string;
    description?: string;
    status?: TaskStatus;
    assignee?: string;
  }
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
  await putJSON(env.TASKS, taskKey(projectId, task.id), task);
  return task;
}

export async function getTask(
  env: Env,
  projectId: string,
  taskId: string
): Promise<Task | null> {
  return getJSON<Task>(env.TASKS, taskKey(projectId, taskId));
}

export async function listTasksRaw(
  env: Env,
  projectId: string
): Promise<Task[]> {
  const keys = await listAllKeys(env.TASKS, taskPrefix(projectId));
  const tasks = await Promise.all(
    keys.map((k) => getJSON<Task>(env.TASKS, k))
  );
  return tasks.filter((t): t is Task => t !== null);
}

export async function listTasksPaginated(
  env: Env,
  projectId: string,
  opts: { status?: TaskStatus; page: number; pageSize: number }
): Promise<Paginated<Task>> {
  let tasks = await listTasksRaw(env, projectId);
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

export async function updateTask(
  env: Env,
  projectId: string,
  taskId: string,
  patch: Partial<
    Pick<Task, "title" | "description" | "status" | "assignee">
  >
): Promise<Task | null> {
  const existing = await getTask(env, projectId, taskId);
  if (!existing) return null;

  const updated: Task = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await putJSON(env.TASKS, taskKey(projectId, taskId), updated);
  return updated;
}

export async function deleteTask(
  env: Env,
  projectId: string,
  taskId: string
): Promise<void> {
  await env.TASKS.delete(taskKey(projectId, taskId));
}

export async function deleteAllTasksForProject(
  env: Env,
  projectId: string
): Promise<void> {
  const keys = await listAllKeys(env.TASKS, taskPrefix(projectId));
  await Promise.all(keys.map((k) => env.TASKS.delete(k)));
}
```

---

### `src/routes/health.ts`

```ts
import { Hono } from "hono";
import { Env } from "../types";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/health", (c) => c.json({ ok: true }));
```

---

### `src/routes/projects.ts`

```ts
import { Hono } from "hono";
import { Env } from "../types";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
} from "../repositories/projectRepo";
import { deleteAllTasksForProject } from "../repositories/taskRepo";
import { CreateProjectSchema, parseAndValidate } from "../validation";
import { errors } from "../errors";

export const projectsRoute = new Hono<{ Bindings: Env }>();

projectsRoute.get("/projects", async (c) => {
  const projects = await listProjects(c.env);
  return c.json({ items: projects });
});

projectsRoute.post("/projects", async (c) => {
  const input = await parseAndValidate(c.req.raw, CreateProjectSchema);
  const project = await createProject(c.env, input);
  return c.json(project, 201);
});

projectsRoute.get("/projects/:projectId", async (c) => {
  const { projectId } = c.req.param();
  const project = await getProject(c.env, projectId);
  if (!project) throw errors.notFound(`Project '${projectId}' not found`);
  return c.json(project);
});

projectsRoute.delete("/projects/:projectId", async (c) => {
  const { projectId } = c.req.param();
  const project = await getProject(c.env, projectId);
  if (!project) throw errors.notFound(`Project '${projectId}' not found`);

  await deleteAllTasksForProject(c.env, projectId);
  await deleteProject(c.env, projectId);
  return c.body(null, 204);
});

// Method-not-allowed fallbacks for defined resource paths
projectsRoute.all("/projects", () => {
  throw errors.methodNotAllowed();
});
projectsRoute.all("/projects/:projectId", () => {
  throw errors.methodNotAllowed();
});
```

---

### `src/routes/tasks.ts`

```ts
import { Hono } from "hono";
import { Env } from "../types";
import { getProject } from "../repositories/projectRepo";
import {
  createTask,
  deleteTask,
  getTask,
  listTasksPaginated,
  updateTask,
} from "../repositories/taskRepo";
import {
  CreateTaskSchema,
  TaskQuerySchema,
  UpdateTaskSchema,
  parseAndValidate,
  validateQuery,
} from "../validation";
import { errors } from "../errors";

export const tasksRoute = new Hono<{ Bindings: Env }>();

async function ensureProject(env: Env, projectId: string) {
  const project = await getProject(env, projectId);
  if (!project) throw errors.notFound(`Project '${projectId}' not found`);
  return project;
}

tasksRoute.get("/projects/:projectId/tasks", async (c) => {
  const { projectId } = c.req.param();
  await ensureProject(c.env, projectId);

  const url = new URL(c.req.url);
  const query = validateQuery(
    {
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    },
    TaskQuerySchema
  );

  const result = await listTasksPaginated(c.env, projectId, query);
  return c.json(result);
});

tasksRoute.post("/projects/:projectId/tasks", async (c) => {
  const { projectId } = c.req.param();
  await ensureProject(c.env, projectId);

  const input = await parseAndValidate(c.req.raw, CreateTaskSchema);
  const task = await createTask(c.env, projectId, input);
  return c.json(task, 201);
});

tasksRoute.get("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await ensureProject(c.env, projectId);

  const task = await getTask(c.env, projectId, taskId);
  if (!task) throw errors.notFound(`Task '${taskId}' not found`);
  return c.json(task);
});

tasksRoute.patch("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await ensureProject(c.env, projectId);

  const existing = await getTask(c.env, projectId, taskId);
  if (!existing) throw errors.notFound(`Task '${taskId}' not found`);

  const patch = await parseAndValidate(c.req.raw, UpdateTaskSchema);
  const updated = await updateTask(c.env, projectId, taskId, {
    ...patch,
    description: patch.description === null ? undefined : patch.description,
    assignee: patch.assignee === null ? undefined : patch.assignee,
  });

  return c.json(updated);
});

tasksRoute.delete("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await ensureProject(c.env, projectId);

  const existing = await getTask(c.env, projectId, taskId);
  if (!existing) throw errors.notFound(`Task '${taskId}' not found`);

  await deleteTask(c.env, projectId, taskId);
  return c.body(null, 204);
});

// Method-not-allowed fallbacks
tasksRoute.all("/projects/:projectId/tasks", () => {
  throw errors.methodNotAllowed();
});
tasksRoute.all("/projects/:projectId/tasks/:taskId", () => {
  throw errors.methodNotAllowed();
});
```

---

### `src/index.ts`

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "./types";
import { AppError, errorBody, errors } from "./errors";
import { authMiddleware } from "./middleware/auth";
import { requestLogger } from "./middleware/logger";
import { healthRoute } from "./routes/health";
import { projectsRoute } from "./routes/projects";
import { tasksRoute } from "./routes/tasks";

const app = new Hono<{ Bindings: Env }>();

// ---- Global middleware ----
app.use("*", requestLogger);

app.use(
  "/api/v1/*",
  cors({
    origin: (origin, c) => c.env.CORS_ALLOWED_ORIGIN ?? "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Auth applies to everything under /api/v1 EXCEPT /api/v1/health
app.use("/api/v1/*", async (c, next) => {
  if (c.req.path === "/api/v1/health") {
    await next();
    return;
  }
  return authMiddleware(c, next);
});

// ---- Routes ----
const api = new Hono<{ Bindings: Env }>();
api.route("/", healthRoute);
api.route("/", projectsRoute);
api.route("/", tasksRoute);

app.route("/api/v1", api);

// ---- 404 for unknown routes ----
app.notFound((c) => {
  return c.json(
    errorBody("NOT_FOUND", `No route matches ${c.req.method} ${c.req.path}`),
    404
  );
});

// ---- Centralized error handling ----
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message), err.status as 400);
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: err.message,
      stack: err.stack,
    })
  );

  const internal = errors.internal();
  return c.json(errorBody(internal.code, internal.message), 500);
});

export default app;
```

---

### `test/smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { Env } from "../src/types";

// Minimal in-memory KV mock for smoke-testing routing/validation logic.
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val === undefined) return null;
      return type === "json" ? JSON.parse(val) : val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts: { prefix?: string; cursor?: string } = {}) {
      const keys = Array.from(store.keys())
        .filter((k) => !opts.prefix || k.startsWith(opts.prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" } as any;
    },
  } as unknown as KVNamespace;
}

const env: Env = {
  TASKS: createMockKV(),
  API_TOKEN: "test-token",
  CORS_ALLOWED_ORIGIN: "*",
};

describe("health check", () => {
  it("does not require auth", async () => {
    const res = await app.request("/api/v1/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await app.request("/api/v1/projects", {}, env);
    expect(res.status).toBe(401);
  });
});

describe("projects + tasks flow", () => {
  const headers = { Authorization: "Bearer test-token" };

  it("creates a project then a task under it", async () => {
    const createProjectRes = await app.request(
      "/api/v1/projects",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Launch Plan" }),
      },
      env
    );
    expect(createProjectRes.status).toBe(201);
    const project = await createProjectRes.json();

    const createTaskRes = await app.request(
      `/api/v1/projects/${project.id}/tasks`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Write launch email" }),
      },
      env
    );
    expect(createTaskRes.status).toBe(201);
    const task = await createTaskRes.json();
    expect(task.status).toBe("todo");
  });

  it("returns 404 error shape for unknown project", async () => {
    const res = await app.request(
      "/api/v1/projects/does-not-exist",
      { headers },
      env
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
```

---

### `README.md`

```markdown
# Team Task Board API (Cloudflare Workers)

## Setup

1. Install dependencies:
   npm install

2. Create the KV namespace:
   npx wrangler kv namespace create TASKS
   # copy the returned `id` into wrangler.toml under [[kv_namespaces]]

3. Set the API token secret:
   npx wrangler secret put API_TOKEN

4. Run locally:
   npm run dev

5. Deploy:
   npm run deploy

## Auth

All routes except `GET /api/v1/health` require:
   Authorization: Bearer <API_TOKEN>

## Example requests

curl -H "Authorization: Bearer $TOKEN" \
  -X POST https://<worker>/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Launch Plan"}'

curl -H "Authorization: Bearer $TOKEN" \
  "https://<worker>/api/v1/projects/<projectId>/tasks?status=todo&page=1&pageSize=20"

## Error shape

All errors are returned as:
   { "error": { "code": "...", "message": "..." } }

## Notes / production considerations

- KV is eventually consistent; under very high write concurrency for the
  same project, listing tasks immediately after a write may lag briefly.
  For stronger consistency at scale, consider D1 or Durable Objects.
- Task/project listing loads all matching KV keys into memory before
  filtering/pagination. This is fine for the expected scale of a team
  task board (hundreds–low thousands of tasks per project); for much
  larger datasets, move to D1 with proper SQL pagination.
- CORS origin is configurable via the `CORS_ALLOWED_ORIGIN` var.
- Structured JSON logs are emitted per request (method, path, status,
  duration) — wire these into Workers Logs / Logpush / your log sink.
```

---

## Design notes

- **Routing/framework**: Hono — purpose-built for edge runtimes like Workers, tiny bundle size, typed bindings, built-in CORS middleware, and clean `onError`/`notFound` hooks.
- **Validation**: Zod schemas centralized in `validation.ts`; all parsing failures throw a typed `AppError` caught by the global error handler, guaranteeing the consistent `{ error: { code, message } }` shape.
- **Auth**: middleware applied to every `/api/v1/*` route except `/health`, matching against the `API_TOKEN` secret binding.
- **Storage**: KV key scheme `project:{id}` and `task:{projectId}:{taskId}` lets you cheaply list/delete all tasks for a project via prefix scan; a small helper transparently pages through KV's cursor-based `list()`.
- **Method-not-allowed handling**: each resource path registers specific method handlers, then a catch-all `.all()` on the same path returns 405 for any other verb; truly unmatched paths fall through to Hono's global `notFound` handler (404).
- **Logging**: a simple structured-logging middleware wraps every request and logs method/path/status/duration as JSON, ready to ship to Workers Logs or any log pipeline.
- **Testing**: a `vitest` smoke test with an in-memory KV mock exercises the health check, auth rejection, project/task creation, and 404 shape — a good scaffold to expand with more coverage.