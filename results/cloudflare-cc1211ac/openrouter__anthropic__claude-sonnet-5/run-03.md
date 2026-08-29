<!-- model: openrouter/anthropic/claude-sonnet-5 | run: 3 | framework: Hono -->

Below is a complete, production-ready Cloudflare Workers REST API built with **Hono** (fast, TypeScript-first router well suited to Workers) and **Zod** (schema validation). Data is stored in a single KV namespace (`TASKS`) using key prefixes `project:{id}` and `task:{projectId}:{taskId}`.

## Design notes

- **Routing/framework**: Hono — minimal overhead, first-class Workers support, easy middleware composition.
- **Validation**: Zod schemas for request bodies and query params.
- **Auth**: `Authorization: Bearer <token>` checked against the `API_TOKEN` secret, applied only to `/projects*` (not `/health`).
- **CORS**: `hono/cors` handles preflight `OPTIONS` automatically, before auth runs.
- **Logging**: middleware logs method/path/status/duration for every request (including error responses), via `console.log` (visible in `wrangler tail`).
- **Errors**: All errors converge to `{ error: { code, message } }` with proper status codes, including unmatched routes (404) and wrong HTTP method on a known path (405, via `app.all(...)` fallbacks registered after the specific method handlers).
- **Pagination/filtering**: tasks are listed per-project via KV `list()` with prefix, filtered by `status` in memory, then paginated. This is simple and correct for the scale KV is meant for; for very large task counts per project, replace with a secondary index or D1/DO.

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "Cloudflare Workers REST API for a team task board (Hono + KV)",
  "main": "src/index.ts",
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
    "@cloudflare/workers-types": "^4.20240925.0",
    "typescript": "^5.5.4",
    "wrangler": "^3.78.0"
  }
}
```

### `wrangler.toml`

```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2024-09-25"
compatibility_flags = ["nodejs_compat"]

# Create with: wrangler kv namespace create TASKS
[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_PREVIEW_KV_NAMESPACE_ID"

# Secret (not committed): wrangler secret put API_TOKEN
# [vars] section left empty on purpose - API_TOKEN must be a secret, not a var.
```

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
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

### `.gitignore`

```
node_modules
.wrangler
dist
.dev.vars
*.log
```

### `src/types.ts`

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

export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}
```

### `src/errors.ts`

```ts
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad Request") {
    super(400, "BAD_REQUEST", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not Found") {
    super(404, "NOT_FOUND", message);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(message = "Method Not Allowed") {
    super(405, "METHOD_NOT_ALLOWED", message);
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal Server Error") {
    super(500, "INTERNAL_ERROR", message);
  }
}

/**
 * Converts any thrown value into a consistent JSON error Response.
 */
export function errorToResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status }
    );
  }

  // Unknown/unexpected error - do not leak internals.
  console.error("Unhandled error:", err);
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
    { status: 500 }
  );
}
```

### `src/validation.ts`

```ts
import { z, ZodError } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(300),
  description: z.string().trim().max(5000).optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  assignee: z.string().trim().max(200).optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    assignee: z.string().trim().max(200).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field must be provided",
  });

export const taskQuerySchema = z.object({
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}
```

### `src/lib/kv.ts`

```ts
import type { Env, Project, Task } from "../types";

const PROJECT_PREFIX = "project:";
const projectKey = (id: string) => `${PROJECT_PREFIX}${id}`;
const taskPrefix = (projectId: string) => `task:${projectId}:`;
const taskKey = (projectId: string, taskId: string) =>
  `${taskPrefix(projectId)}${taskId}`;

export async function getProject(
  env: Env,
  id: string
): Promise<Project | null> {
  return env.TASKS.get<Project>(projectKey(id), "json");
}

export async function putProject(env: Env, project: Project): Promise<void> {
  await env.TASKS.put(projectKey(project.id), JSON.stringify(project));
}

export async function deleteProjectRecord(
  env: Env,
  id: string
): Promise<void> {
  await env.TASKS.delete(projectKey(id));
}

export async function listProjects(env: Env): Promise<Project[]> {
  const projects: Project[] = [];
  let cursor: string | undefined;

  do {
    const res = await env.TASKS.list({ prefix: PROJECT_PREFIX, cursor });
    const values = await Promise.all(
      res.keys.map((k) => env.TASKS.get<Project>(k.name, "json"))
    );
    for (const v of values) if (v) projects.push(v);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);

  projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return projects;
}

export async function getTask(
  env: Env,
  projectId: string,
  taskId: string
): Promise<Task | null> {
  return env.TASKS.get<Task>(taskKey(projectId, taskId), "json");
}

export async function putTask(env: Env, task: Task): Promise<void> {
  await env.TASKS.put(taskKey(task.projectId, task.id), JSON.stringify(task));
}

export async function deleteTaskRecord(
  env: Env,
  projectId: string,
  taskId: string
): Promise<void> {
  await env.TASKS.delete(taskKey(projectId, taskId));
}

export async function listTasksByProject(
  env: Env,
  projectId: string
): Promise<Task[]> {
  const tasks: Task[] = [];
  const prefix = taskPrefix(projectId);
  let cursor: string | undefined;

  do {
    const res = await env.TASKS.list({ prefix, cursor });
    const values = await Promise.all(
      res.keys.map((k) => env.TASKS.get<Task>(k.name, "json"))
    );
    for (const v of values) if (v) tasks.push(v);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);

  tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return tasks;
}

export async function deleteAllTasksForProject(
  env: Env,
  projectId: string
): Promise<void> {
  const prefix = taskPrefix(projectId);
  let cursor: string | undefined;

  do {
    const res = await env.TASKS.list({ prefix, cursor });
    await Promise.all(res.keys.map((k) => env.TASKS.delete(k.name)));
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
}
```

### `src/middleware/auth.ts`

```ts
import type { Context, Next } from "hono";
import type { Env } from "../types";
import { UnauthorizedError } from "../errors";

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError(
      "Missing or invalid Authorization header. Expected: Bearer <token>"
    );
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token || !c.env.API_TOKEN || token !== c.env.API_TOKEN) {
    throw new UnauthorizedError("Invalid API token");
  }

  await next();
}
```

### `src/middleware/logger.ts`

```ts
import type { Context, Next } from "hono";
import { errorToResponse } from "../errors";

export async function loggerMiddleware(c: Context, next: Next) {
  const start = Date.now();
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  try {
    await next();
  } catch (err) {
    // Ensure a response is produced and logged even on error, and that the
    // error doesn't propagate unformatted past this point.
    c.res = errorToResponse(err);
  } finally {
    const durationMs = Date.now() - start;
    const status = c.res?.status ?? 0;
    console.log(
      JSON.stringify({ method, path, status, durationMs })
    );
  }
}
```

### `src/routes/projects.ts`

```ts
import { Hono } from "hono";
import type { Env, Project } from "../types";
import { BadRequestError, MethodNotAllowedError, NotFoundError } from "../errors";
import { createProjectSchema, formatZodError } from "../validation";
import * as store from "../lib/kv";

export function registerProjectRoutes(app: Hono<{ Bindings: Env }>) {
  // GET /projects
  app.get("/projects", async (c) => {
    const projects = await store.listProjects(c.env);
    return c.json({ data: projects });
  });

  // POST /projects
  app.post("/projects", async (c) => {
    const body = await parseJson(c);
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestError(formatZodError(parsed.error));

    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      createdAt: now,
    };

    await store.putProject(c.env, project);
    return c.json({ data: project }, 201);
  });

  // Any other method on /projects
  app.all("/projects", () => {
    throw new MethodNotAllowedError("Allowed methods: GET, POST");
  });

  // GET /projects/:projectId
  app.get("/projects/:projectId", async (c) => {
    const project = await store.getProject(c.env, c.req.param("projectId"));
    if (!project) throw new NotFoundError("Project not found");
    return c.json({ data: project });
  });

  // DELETE /projects/:projectId
  app.delete("/projects/:projectId", async (c) => {
    const projectId = c.req.param("projectId");
    const project = await store.getProject(c.env, projectId);
    if (!project) throw new NotFoundError("Project not found");

    await store.deleteAllTasksForProject(c.env, projectId);
    await store.deleteProjectRecord(c.env, projectId);
    return c.body(null, 204);
  });

  // Any other method on /projects/:projectId
  app.all("/projects/:projectId", () => {
    throw new MethodNotAllowedError("Allowed methods: GET, DELETE");
  });
}

async function parseJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
}
```

### `src/routes/tasks.ts`

```ts
import { Hono } from "hono";
import type { Env, Task } from "../types";
import { BadRequestError, MethodNotAllowedError, NotFoundError } from "../errors";
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
  formatZodError,
} from "../validation";
import * as store from "../lib/kv";

export function registerTaskRoutes(app: Hono<{ Bindings: Env }>) {
  // GET /projects/:projectId/tasks?status=&page=&pageSize=
  app.get("/projects/:projectId/tasks", async (c) => {
    const projectId = c.req.param("projectId");
    await ensureProjectExists(c.env, projectId);

    const queryObj = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsedQuery = taskQuerySchema.safeParse(queryObj);
    if (!parsedQuery.success) {
      throw new BadRequestError(formatZodError(parsedQuery.error));
    }
    const { status, page, pageSize } = parsedQuery.data;

    let tasks = await store.listTasksByProject(c.env, projectId);
    if (status) tasks = tasks.filter((t) => t.status === status);

    const total = tasks.length;
    const start = (page - 1) * pageSize;
    const pageItems = tasks.slice(start, start + pageSize);
    const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);

    return c.json({
      data: pageItems,
      pagination: { page, pageSize, total, totalPages },
    });
  });

  // POST /projects/:projectId/tasks
  app.post("/projects/:projectId/tasks", async (c) => {
    const projectId = c.req.param("projectId");
    await ensureProjectExists(c.env, projectId);

    const body = await parseJson(c);
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestError(formatZodError(parsed.error));

    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      projectId,
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status ?? "todo",
      assignee: parsed.data.assignee,
      createdAt: now,
      updatedAt: now,
    };

    await store.putTask(c.env, task);
    return c.json({ data: task }, 201);
  });

  app.all("/projects/:projectId/tasks", () => {
    throw new MethodNotAllowedError("Allowed methods: GET, POST");
  });

  // GET /projects/:projectId/tasks/:taskId
  app.get("/projects/:projectId/tasks/:taskId", async (c) => {
    const { projectId, taskId } = c.req.param();
    await ensureProjectExists(c.env, projectId);

    const task = await store.getTask(c.env, projectId, taskId);
    if (!task) throw new NotFoundError("Task not found");
    return c.json({ data: task });
  });

  // PATCH /projects/:projectId/tasks/:taskId
  app.patch("/projects/:projectId/tasks/:taskId", async (c) => {
    const { projectId, taskId } = c.req.param();
    await ensureProjectExists(c.env, projectId);

    const existing = await store.getTask(c.env, projectId, taskId);
    if (!existing) throw new NotFoundError("Task not found");

    const body = await parseJson(c);
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestError(formatZodError(parsed.error));

    const updated: Task = {
      ...existing,
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    };

    await store.putTask(c.env, updated);
    return c.json({ data: updated });
  });

  // DELETE /projects/:projectId/tasks/:taskId
  app.delete("/projects/:projectId/tasks/:taskId", async (c) => {
    const { projectId, taskId } = c.req.param();
    await ensureProjectExists(c.env, projectId);

    const existing = await store.getTask(c.env, projectId, taskId);
    if (!existing) throw new NotFoundError("Task not found");

    await store.deleteTaskRecord(c.env, projectId, taskId);
    return c.body(null, 204);
  });

  app.all("/projects/:projectId/tasks/:taskId", () => {
    throw new MethodNotAllowedError("Allowed methods: GET, PATCH, DELETE");
  });
}

async function ensureProjectExists(env: Env, projectId: string) {
  const project = await store.getProject(env, projectId);
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

async function parseJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
}
```

### `src/index.ts`

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { loggerMiddleware } from "./middleware/logger";
import { authMiddleware } from "./middleware/auth";
import { errorToResponse } from "./errors";
import { registerProjectRoutes } from "./routes/projects";
import { registerTaskRoutes } from "./routes/tasks";

const app = new Hono<{ Bindings: Env }>().basePath("/api/v1");

// Logging wraps everything (including CORS/auth/route errors).
app.use("*", loggerMiddleware);

// CORS (handles OPTIONS preflight automatically, before auth runs).
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Public route.
app.get("/health", (c) => c.json({ ok: true }));

// Everything under /projects requires a valid bearer token.
app.use("/projects", authMiddleware);
app.use("/projects/*", authMiddleware);

registerProjectRoutes(app);
registerTaskRoutes(app);

// Unknown routes -> consistent 404 JSON shape.
app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${path} not found`,
      },
    },
    404
  );
});

// Safety-net error handler (loggerMiddleware normally handles this first).
app.onError((err) => errorToResponse(err));

export default app;
```

---

## Setup & deployment

```bash
npm install

# Create the KV namespace and paste the returned id(s) into wrangler.toml
wrangler kv namespace create TASKS
wrangler kv namespace create TASKS --preview

# Set the API token secret (not committed to source control)
wrangler secret put API_TOKEN

# Local development
npm run dev

# Deploy
npm run deploy
```

For local dev without secrets set, create a `.dev.vars` file (gitignored):

```
API_TOKEN=dev-local-token
```

## Example usage

```bash
BASE=http://127.0.0.1:8787/api/v1
TOKEN=dev-local-token

curl $BASE/health

curl -X POST $BASE/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Launch Plan"}'

curl $BASE/projects -H "Authorization: Bearer $TOKEN"

curl -X POST $BASE/projects/<projectId>/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Write copy","status":"todo","assignee":"amy"}'

curl "$BASE/projects/<projectId>/tasks?status=todo&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"

curl -X PATCH $BASE/projects/<projectId>/tasks/<taskId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'
```

Sample error response:

```json
{ "error": { "code": "NOT_FOUND", "message": "Project not found" } }
```