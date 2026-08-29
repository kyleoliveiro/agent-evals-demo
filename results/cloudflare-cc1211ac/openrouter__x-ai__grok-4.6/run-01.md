<!-- model: openrouter/x-ai/grok-4.6 | run: 1 | framework: Hono -->

Production-ready Cloudflare Worker API using Hono, Zod, and a single KV namespace. Auth, CORS, structured errors, request logging, and prefix-based KV storage (no secondary indexes, so no lost updates on lists).

```json
{
  "name": "team-task-board",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "cf-typegen": "wrangler types",
    "check": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.7.11",
    "zod": "^3.24.4"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250421.0",
    "typescript": "^5.8.3",
    "wrangler": "^4.14.0"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

```toml
name = "team-task-board"
main = "src/index.ts"
compatibility_date = "2025-04-01"

# Create with: wrangler kv namespace create TASKS
# Then replace the id below. `wrangler dev` still works with a placeholder.
[[kv_namespaces]]
binding = "TASKS"
id = "replace_with_your_kv_namespace_id"
```

```gitignore
node_modules/
.wrangler/
.dev.vars
dist/
*.log
.DS_Store
```

```dotenv
API_TOKEN=change-me-in-development
```

```markdown
# Team Task Board API

REST API for a team task board, running on Cloudflare Workers with KV storage.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # set API_TOKEN
npx wrangler kv namespace create TASKS
# paste the returned id into wrangler.toml
npm run dev
```

Production secret:

```bash
npx wrangler secret put API_TOKEN
npm run deploy
```

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer <API_TOKEN>
```

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Liveness |
| GET | `/api/v1/projects` | `{ items }` |
| POST | `/api/v1/projects` | `{ name }` → 201 |
| GET | `/api/v1/projects/:projectId` | |
| DELETE | `/api/v1/projects/:projectId` | Cascades tasks, 204 |
| GET | `/api/v1/projects/:projectId/tasks` | `status`, `page`, `pageSize` |
| POST | `/api/v1/projects/:projectId/tasks` | `{ title, description?, status?, assignee? }` |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | Partial; `description`/`assignee` may be `null` to clear |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | 204 |

Errors are always:

```json
{ "error": { "code": "NOT_FOUND", "message": "Project not found" } }
```
```

```typescript
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
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

export interface TaskList {
  items: Task[];
  page: number;
  pageSize: number;
  total: number;
}

export const TASK_STATUSES: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
];
```

```typescript
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function errorJson(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
```

```typescript
import { z } from "zod";

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(200),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(500),
    description: z.string().max(10_000).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    assignee: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const patchTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(10_000).nullable().optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    assignee: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

const emptyToUndefined = (value: unknown) =>
  value === undefined || value === "" ? undefined : value;

export const listTasksQuerySchema = z.object({
  status: z.preprocess(
    emptyToUndefined,
    z.enum(["todo", "in_progress", "done"]).optional(),
  ),
  page: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).default(1),
  ),
  pageSize: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(100).default(20),
  ),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
```

```typescript
import type { Context } from "hono";
import type { ZodType } from "zod";
import { AppError } from "./errors.js";

export async function parseJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Request body must be valid JSON",
    );
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Request body must be a JSON object",
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", formatZod(parsed.error));
  }
  return parsed.data;
}

export function parseQuery<T>(
  schema: ZodType<T>,
  query: Record<string, string>,
): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", formatZod(parsed.error));
  }
  return parsed.data;
}

function formatZod(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
```

```typescript
import type { Project, Task, TaskList, TaskStatus } from "./types.js";
import type { CreateTaskInput, PatchTaskInput } from "./schemas.js";

const PROJECT_PREFIX = "project:";
const TASK_PREFIX = "task:";

export class TaskStore {
  constructor(private readonly kv: KVNamespace) {}

  async listProjects(): Promise<Project[]> {
    const keys = await this.listKeys(PROJECT_PREFIX);
    const projects = await this.getMany<Project>(keys);
    projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return projects;
  }

  async getProject(id: string): Promise<Project | null> {
    return this.kv.get<Project>(this.projectKey(id), "json");
  }

  async createProject(name: string): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
    };
    await this.kv.put(this.projectKey(project.id), JSON.stringify(project));
    return project;
  }

  async deleteProject(id: string): Promise<boolean> {
    const existing = await this.getProject(id);
    if (!existing) return false;

    const taskKeys = await this.listKeys(this.taskPrefix(id));
    await Promise.all([
      ...taskKeys.map((key) => this.kv.delete(key)),
      this.kv.delete(this.projectKey(id)),
    ]);
    return true;
  }

  async listTasks(
    projectId: string,
    opts: { status?: TaskStatus; page: number; pageSize: number },
  ): Promise<TaskList> {
    const keys = await this.listKeys(this.taskPrefix(projectId));
    let items = await this.getMany<Task>(keys);

    if (opts.status) {
      items = items.filter((task) => task.status === opts.status);
    }

    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const total = items.length;
    const start = (opts.page - 1) * opts.pageSize;
    return {
      items: items.slice(start, start + opts.pageSize),
      page: opts.page,
      pageSize: opts.pageSize,
      total,
    };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    return this.kv.get<Task>(this.taskKey(projectId, taskId), "json");
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      projectId,
      title: input.title,
      status: input.status ?? "todo",
      createdAt: now,
      updatedAt: now,
    };
    if (input.description !== undefined) task.description = input.description;
    if (input.assignee !== undefined) task.assignee = input.assignee;

    await this.kv.put(this.taskKey(projectId, task.id), JSON.stringify(task));
    return task;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    patch: PatchTaskInput,
  ): Promise<Task | null> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return null;

    const next: Task = { ...existing, updatedAt: new Date().toISOString() };

    if (patch.title !== undefined) next.title = patch.title;
    if (patch.status !== undefined) next.status = patch.status;

    if (patch.description === null) {
      delete next.description;
    } else if (patch.description !== undefined) {
      next.description = patch.description;
    }

    if (patch.assignee === null) {
      delete next.assignee;
    } else if (patch.assignee !== undefined) {
      next.assignee = patch.assignee;
    }

    await this.kv.put(this.taskKey(projectId, taskId), JSON.stringify(next));
    return next;
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;
    await this.kv.delete(this.taskKey(projectId, taskId));
    return true;
  }

  private projectKey(id: string): string {
    return `${PROJECT_PREFIX}${id}`;
  }

  private taskPrefix(projectId: string): string {
    return `${TASK_PREFIX}${projectId}:`;
  }

  private taskKey(projectId: string, taskId: string): string {
    return `${this.taskPrefix(projectId)}${taskId}`;
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;

    for (;;) {
      const page = await this.kv.list({ prefix, limit: 1000, cursor });
      for (const key of page.keys) names.push(key.name);
      if (page.list_complete) break;
      cursor = page.cursor;
    }

    return names;
  }

  private async getMany<T>(keys: string[]): Promise<T[]> {
    const values = await Promise.all(
      keys.map((key) => this.kv.get<T>(key, "json")),
    );
    return values.filter((value): value is T => value !== null);
  }
}
```

```typescript
import type { MiddlewareHandler } from "hono";
import type { Env } from "./types.js";
import { errorJson } from "./errors.js";

const HEALTH_PATH = "/api/v1/health";

export const logger: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const started = Date.now();
  const path = new URL(c.req.url).pathname;
  try {
    await next();
  } finally {
    console.log(
      JSON.stringify({
        method: c.req.method,
        path,
        status: c.res.status,
        duration: Date.now() - started,
      }),
    );
  }
};

export const requireBearer: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const path = new URL(c.req.url).pathname.replace(/\/+$/, "") || "/";
  if (path === HEALTH_PATH) {
    await next();
    return;
  }

  const header = c.req.header("Authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return errorJson(
      c,
      401,
      "UNAUTHORIZED",
      "Missing or invalid Authorization header",
    );
  }

  const expected = c.env.API_TOKEN;
  if (!expected) {
    console.error("API_TOKEN secret is not configured");
    return errorJson(c, 500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  if (!secureCompare(match[1], expected)) {
    return errorJson(c, 401, "UNAUTHORIZED", "Invalid token");
  }

  await next();
};

/** Constant-time string compare to avoid leaking token bytes via timing. */
function secureCompare(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const len = Math.max(left.byteLength, right.byteLength);
  let mismatch = left.byteLength === right.byteLength ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}
```

```typescript
export const ROUTE_TABLE: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/v1\/health\/?$/ },
  { method: "GET", pattern: /^\/api\/v1\/projects\/?$/ },
  { method: "POST", pattern: /^\/api\/v1\/projects\/?$/ },
  { method: "GET", pattern: /^\/api\/v1\/projects\/[^/]+\/?$/ },
  { method: "DELETE", pattern: /^\/api\/v1\/projects\/[^/]+\/?$/ },
  { method: "GET", pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/?$/ },
  { method: "POST", pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/?$/ },
  { method: "GET", pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+\/?$/ },
  { method: "PATCH", pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+\/?$/ },
  { method: "DELETE", pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+\/?$/ },
];

export function allowedMethods(path: string): string[] {
  const methods = ROUTE_TABLE.filter((route) => route.pattern.test(path)).map(
    (route) => route.method,
  );
  return [...new Set(methods)];
}
```

```typescript
import { Hono } from "hono";
import type { Env } from "./types.js";
import { AppError } from "./errors.js";
import {
  createProjectSchema,
  createTaskSchema,
  listTasksQuerySchema,
  patchTaskSchema,
} from "./schemas.js";
import { parseJson, parseQuery } from "./validate.js";
import { TaskStore } from "./store.js";

export const api = new Hono<{ Bindings: Env }>();

api.get("/health", (c) => c.json({ ok: true as const }));

api.get("/projects", async (c) => {
  const items = await store(c).listProjects();
  return c.json({ items });
});

api.post("/projects", async (c) => {
  const body = await parseJson(c, createProjectSchema);
  const project = await store(c).createProject(body.name);
  c.header("Location", `/api/v1/projects/${project.id}`);
  return c.json(project, 201);
});

api.get("/projects/:projectId/tasks", async (c) => {
  const { projectId } = c.req.param();
  await requireProject(c, projectId);

  const query = parseQuery(listTasksQuerySchema, c.req.query());
  const result = await store(c).listTasks(projectId, {
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  });
  return c.json(result);
});

api.post("/projects/:projectId/tasks", async (c) => {
  const { projectId } = c.req.param();
  await requireProject(c, projectId);

  const body = await parseJson(c, createTaskSchema);
  const task = await store(c).createTask(projectId, body);
  c.header("Location", `/api/v1/projects/${projectId}/tasks/${task.id}`);
  return c.json(task, 201);
});

api.get("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c, projectId);

  const task = await store(c).getTask(projectId, taskId);
  if (!task) throw new AppError(404, "NOT_FOUND", "Task not found");
  return c.json(task);
});

api.patch("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c, projectId);

  const body = await parseJson(c, patchTaskSchema);
  const task = await store(c).updateTask(projectId, taskId, body);
  if (!task) throw new AppError(404, "NOT_FOUND", "Task not found");
  return c.json(task);
});

api.delete("/projects/:projectId/tasks/:taskId", async (c) => {
  const { projectId, taskId } = c.req.param();
  await requireProject(c, projectId);

  const deleted = await store(c).deleteTask(projectId, taskId);
  if (!deleted) throw new AppError(404, "NOT_FOUND", "Task not found");
  return c.body(null, 204);
});

api.get("/projects/:projectId", async (c) => {
  const project = await store(c).getProject(c.req.param("projectId"));
  if (!project) throw new AppError(404, "NOT_FOUND", "Project not found");
  return c.json(project);
});

api.delete("/projects/:projectId", async (c) => {
  const deleted = await store(c).deleteProject(c.req.param("projectId"));
  if (!deleted) throw new AppError(404, "NOT_FOUND", "Project not found");
  return c.body(null, 204);
});

function store(c: { env: Env }): TaskStore {
  return new TaskStore(c.env.TASKS);
}

async function requireProject(c: { env: Env }, projectId: string) {
  const project = await store(c).getProject(projectId);
  if (!project) throw new AppError(404, "NOT_FOUND", "Project not found");
  return project;
}
```

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";
import { AppError, errorJson } from "./errors.js";
import { logger, requireBearer } from "./middleware.js";
import { allowedMethods } from "./routes-table.js";
import { api } from "./routes.js";

const app = new Hono<{ Bindings: Env }>({ strict: false });

app.use("*", logger);

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86_400,
  }),
);

app.use("*", requireBearer);

app.route("/api/v1", api);

app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  const allow = allowedMethods(path);

  if (allow.length > 0 && !allow.includes(c.req.method)) {
    c.header("Allow", [...allow, "OPTIONS"].join(", "));
    return errorJson(
      c,
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${c.req.method} not allowed`,
    );
  }

  return errorJson(c, 404, "NOT_FOUND", "Route not found");
});

app.onError((err, c) => {
  if (err instanceof AppError) {
    return errorJson(c, err.status, err.code, err.message);
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

  return errorJson(c, 500, "INTERNAL_ERROR", "An unexpected error occurred");
});

export default app;
```

### Layout

```
.
├── package.json
├── tsconfig.json
├── wrangler.toml
├── .gitignore
├── .dev.vars.example
├── README.md
└── src
    ├── index.ts          # app, CORS, auth, 404/405/500
    ├── types.ts
    ├── errors.ts
    ├── schemas.ts        # Zod
    ├── validate.ts
    ├── store.ts          # KV: project:{id}, task:{projectId}:{taskId}
    ├── middleware.ts     # logger + bearer
    ├── routes-table.ts   # 405 Allow
    └── routes.ts
```

Task list routes are registered before `GET/DELETE /projects/:projectId` so Hono does not treat `tasks` as an id.

### Behaviour notes

- **Auth**: all paths except `GET /api/v1/health` and CORS preflight; unknown routes still require a token, then 404.
- **Errors**: `{ error: { code, message } }` for 400 / 401 / 404 / 405 / 500.
- **Logging**: JSON `{ method, path, status, duration }` (ms) in a `finally` so it always fires.
- **Pagination**: in-memory over the project’s task keys (status filter + `page` / `pageSize`, default 20, max 100). Fine for a team board; KV has no query index.
- **Deletes**: project delete lists `task:{projectId}:*` and removes those keys plus the project.