<!-- model: openrouter/x-ai/grok-4.6 | run: 3 | framework: Hono -->

A Hono + Zod Workers API with KV storage, bearer auth, CORS, request logging, and consistent JSON errors. Full project files below.

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "cf-typegen": "wrangler types"
  },
  "dependencies": {
    "hono": "^4.6.14",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241218.0",
    "typescript": "^5.7.2",
    "wrangler": "^3.99.0"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2024-12-18"

# Replace ids after: wrangler kv namespace create TASKS
[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_KV_PREVIEW_NAMESPACE_ID"

# API_TOKEN is a secret (not a [vars] value):
#   wrangler secret put API_TOKEN
# Local dev: copy .dev.vars.example to .dev.vars
```

```gitignore
node_modules/
dist/
.wrangler/
.dev.vars
.DS_Store
*.log
.tsbuildinfo
```

```dotenv
# Copy to .dev.vars (gitignored) for `wrangler dev`
API_TOKEN=dev-local-token-change-me
```

```markdown
# Team Task Board API

Production REST API for a team task board, running on Cloudflare Workers with KV storage.

Base path: `/api/v1`

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars and set API_TOKEN

# Create KV namespaces, then paste the ids into wrangler.toml
npx wrangler kv namespace create TASKS
npx wrangler kv namespace create TASKS --preview

npm run dev
```

Deploy:

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

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness |
| GET | `/api/v1/projects` | List projects |
| POST | `/api/v1/projects` | Create project `{ "name" }` |
| GET | `/api/v1/projects/:projectId` | Get project |
| DELETE | `/api/v1/projects/:projectId` | Delete project and its tasks |
| GET | `/api/v1/projects/:projectId/tasks` | List tasks (`status`, `page`, `pageSize`) |
| POST | `/api/v1/projects/:projectId/tasks` | Create task |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` | Get task |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` | Partial update |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` | Delete task |

Task `status`: `todo` | `in_progress` | `done`. Pagination defaults: `page=1`, `pageSize=20` (max 100).

## Errors

```json
{ "error": { "code": "NOT_FOUND", "message": "Project not found" } }
```
```

```typescript
export type Bindings = {
  TASKS: KVNamespace;
  API_TOKEN: string;
};

export type AppEnv = {
  Bindings: Bindings;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
};

export type TaskStatus = "todo" | "in_progress" | "done";

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
};
```

```typescript
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./types";

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

export type ErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

export function jsonError(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json(errorBody(code, message), status);
}
```

```typescript
import { z } from "zod";
import { AppError } from "./errors";

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(200),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(500),
    description: z.string().max(5000).optional(),
    status: z.enum(TASK_STATUSES).optional().default("todo"),
    assignee: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const patchTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw new AppError(400, "VALIDATION_ERROR", message);
  }
  return result.data;
}

export function parseUuid(label: string, value: string): string {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label}`);
  }
  return result.data;
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError(400, "VALIDATION_ERROR", "Content-Type must be application/json");
  }
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Request body must be valid JSON");
  }
}
```

```typescript
import { AppError } from "./errors";
import type { Project, Task } from "./types";

const PROJECT_PREFIX = "project:";
const TASK_PREFIX = "task:";
const KV_CHUNK = 50;

function projectKey(projectId: string): string {
  return `${PROJECT_PREFIX}${projectId}`;
}

function taskKey(projectId: string, taskId: string): string {
  return `${TASK_PREFIX}${projectId}:${taskId}`;
}

function taskPrefixFor(projectId: string): string {
  return `${TASK_PREFIX}${projectId}:`;
}

async function listAllKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    for (const key of page.keys) {
      keys.push(key.name);
    }
    if (page.list_complete) {
      break;
    }
    cursor = page.cursor;
  }

  return keys;
}

async function mapChunks<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += KV_CHUNK) {
    const chunk = items.slice(i, i + KV_CHUNK);
    results.push(...(await Promise.all(chunk.map(mapper))));
  }
  return results;
}

export async function getProject(kv: KVNamespace, projectId: string): Promise<Project | null> {
  return kv.get<Project>(projectKey(projectId), "json");
}

export async function requireProject(kv: KVNamespace, projectId: string): Promise<Project> {
  const project = await getProject(kv, projectId);
  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }
  return project;
}

export async function listProjects(kv: KVNamespace): Promise<Project[]> {
  const keys = await listAllKeys(kv, PROJECT_PREFIX);
  const projects = await mapChunks(keys, (key) => kv.get<Project>(key, "json"));
  return projects
    .filter((project): project is Project => project !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function putProject(kv: KVNamespace, project: Project): Promise<void> {
  await kv.put(projectKey(project.id), JSON.stringify(project));
}

export async function deleteProject(kv: KVNamespace, projectId: string): Promise<boolean> {
  const project = await getProject(kv, projectId);
  if (!project) {
    return false;
  }

  const taskKeys = await listAllKeys(kv, taskPrefixFor(projectId));
  await mapChunks([projectKey(projectId), ...taskKeys], (key) => kv.delete(key));
  return true;
}

export async function getTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<Task | null> {
  return kv.get<Task>(taskKey(projectId, taskId), "json");
}

export async function requireTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<Task> {
  await requireProject(kv, projectId);
  const task = await getTask(kv, projectId, taskId);
  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }
  return task;
}

export async function listTasks(kv: KVNamespace, projectId: string): Promise<Task[]> {
  const keys = await listAllKeys(kv, taskPrefixFor(projectId));
  const tasks = await mapChunks(keys, (key) => kv.get<Task>(key, "json"));
  return tasks
    .filter((task): task is Task => task !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function putTask(kv: KVNamespace, task: Task): Promise<void> {
  await kv.put(taskKey(task.projectId, task.id), JSON.stringify(task));
}

export async function deleteTask(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<boolean> {
  const task = await getTask(kv, projectId, taskId);
  if (!task) {
    return false;
  }
  await kv.delete(taskKey(projectId, taskId));
  return true;
}
```

```typescript
import type { Context, MiddlewareHandler, Next } from "hono";
import { AppError } from "./errors";
import type { AppEnv } from "./types";

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const len = Math.max(bufA.byteLength, bufB.byteLength);
  let mismatch = bufA.byteLength === bufB.byteLength ? 0 : 1;

  for (let i = 0; i < len; i++) {
    mismatch |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }

  return mismatch === 0;
}

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const expected = c.env.API_TOKEN;
  if (!expected) {
    console.error("API_TOKEN secret is not configured");
    throw new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  const header = c.req.header("Authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1] || !timingSafeEqual(match[1], expected)) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid or missing bearer token");
  }

  await next();
};

export async function logger(c: Context<AppEnv>, next: Next): Promise<void> {
  const started = Date.now();
  await next();
  const durationMs = Date.now() - started;
  const path = new URL(c.req.url).pathname;

  console.log(
    JSON.stringify({
      method: c.req.method,
      path,
      status: c.res.status,
      durationMs,
    }),
  );
}

export const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};
```

```typescript
import { Hono } from "hono";
import { AppError } from "../errors";
import { createProjectSchema, parseUuid, parseWith, readJson } from "../schemas";
import * as storage from "../storage";
import type { AppEnv, Project } from "../types";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get("/", async (c) => {
  const data = await storage.listProjects(c.env.TASKS);
  return c.json({ data });
});

projectRoutes.post("/", async (c) => {
  const body = parseWith(createProjectSchema, await readJson(c.req.raw));
  const now = new Date().toISOString();
  const project: Project = {
    id: crypto.randomUUID(),
    name: body.name,
    createdAt: now,
  };
  await storage.putProject(c.env.TASKS, project);
  return c.json(project, 201);
});

projectRoutes.get("/:projectId", async (c) => {
  const projectId = parseUuid("projectId", c.req.param("projectId"));
  const project = await storage.requireProject(c.env.TASKS, projectId);
  return c.json(project);
});

projectRoutes.delete("/:projectId", async (c) => {
  const projectId = parseUuid("projectId", c.req.param("projectId"));
  const deleted = await storage.deleteProject(c.env.TASKS, projectId);
  if (!deleted) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }
  return c.body(null, 204);
});
```

```typescript
import { Hono } from "hono";
import { AppError } from "../errors";
import {
  createTaskSchema,
  listTasksQuerySchema,
  parseUuid,
  parseWith,
  patchTaskSchema,
  readJson,
} from "../schemas";
import * as storage from "../storage";
import type { AppEnv, Task } from "../types";

export const taskRoutes = new Hono<AppEnv>();

taskRoutes.get("/", async (c) => {
  const projectId = parseUuid("projectId", c.req.param("projectId"));
  await storage.requireProject(c.env.TASKS, projectId);

  const query = parseWith(listTasksQuerySchema, {
    status: c.req.query("status") || undefined,
    page: c.req.query("page") || undefined,
    pageSize: c.req.query("pageSize") || undefined,
  });

  let tasks = await storage.listTasks(c.env.TASKS, projectId);
  if (query.status) {
    tasks = tasks.filter((task) => task.status === query.status);
  }

  const total = tasks.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
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

taskRoutes.post("/", async (c) => {
  const projectId = parseUuid("projectId", c.req.param("projectId"));
  await storage.requireProject(c.env.TASKS, projectId);

  const body = parseWith(createTaskSchema, await readJson(c.req.raw));
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    projectId,
    title: body.title,
    status: body.status,
    createdAt: now,
    updatedAt: now,
  };

  if (body.description !== undefined) {
    task.description = body.description;
  }
  if (body.assignee !== undefined) {
    task.assignee = body.assignee;
  }

  await storage.putTask(c.env.TASKS, task);
  return c.json(task, 201);
});

taskRoutes.get("/:taskId", async (c) => {
  const projectId = parseUuid("projectId", c.req.param("projectId"));
  const taskId = parseUuid("taskId", c.req.param("taskId"));
  const task = await storage.requireTask(c.env.TASKS, projectId, taskId);
  return c.json(task);
});

taskRoutes.patch("/:taskId", async (c) => {
  const projectId = parseUuid("projectId", c.req.param("projectId"));
  const taskId = parseUuid("taskId", c.req.param("taskId"));
  const existing = await storage.requireTask(c.env.TASKS, projectId, taskId);
  const patch = parseWith(patchTaskSchema, await readJson(c.req.raw));

  const updated: Task = {
    ...existing,
    updatedAt: new Date().toISOString(),
  };

  if (patch.title !== undefined) {
    updated.title = patch.title;
  }
  if (patch.status !== undefined) {
    updated.status = patch.status;
  }
  if (patch.description === null) {
    delete updated.description;
  } else if (patch.description !== undefined) {
    updated.description = patch.description;
  }
  if (patch.assignee === null) {
    delete updated.assignee;
  } else if (patch.assignee !== undefined) {
    updated.assignee = patch.assignee;
  }

  await storage.putTask(c.env.TASKS, updated);
  return c.json(updated);
});

taskRoutes.delete("/:taskId", async (c) => {
  const projectId = parseUuid("projectId", c.req.param("projectId"));
  const taskId = parseUuid("taskId", c.req.param("taskId"));
  await storage.requireProject(c.env.TASKS, projectId);
  const deleted = await storage.deleteTask(c.env.TASKS, projectId, taskId);
  if (!deleted) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }
  return c.body(null, 204);
});
```

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AppError, errorBody, jsonError } from "./errors";
import { auth, logger, noStore } from "./middleware";
import { projectRoutes } from "./routes/projects";
import { taskRoutes } from "./routes/tasks";
import type { AppEnv } from "./types";

const ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] as const;

const app = new Hono<AppEnv>();

app.use("*", logger);
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: [...ALLOWED_METHODS],
    allowHeaders: ["Authorization", "Content-Type"],
    exposeHeaders: ["Allow"],
    maxAge: 86400,
  }),
);
app.use("*", noStore);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return jsonError(c, err.status, err.code, err.message);
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

  return jsonError(c, 500, "INTERNAL_ERROR", "An unexpected error occurred");
});

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Route not found"));

const v1 = new Hono<AppEnv>();

v1.get("/health", (c) => c.json({ ok: true as const }));
v1.all("/health", (c) => methodNotAllowed(c, ["GET"]));

v1.use("*", auth);

v1.route("/projects", projectRoutes);
v1.route("/projects/:projectId/tasks", taskRoutes);

v1.all("/projects", (c) => methodNotAllowed(c, ["GET", "POST"]));
v1.all("/projects/:projectId", (c) => methodNotAllowed(c, ["GET", "DELETE"]));
v1.all("/projects/:projectId/tasks", (c) => methodNotAllowed(c, ["GET", "POST"]));
v1.all("/projects/:projectId/tasks/:taskId", (c) =>
  methodNotAllowed(c, ["GET", "PATCH", "DELETE"]),
);

app.route("/api/v1", v1);

function methodNotAllowed(c: Parameters<typeof jsonError>[0], allow: string[]) {
  c.header("Allow", [...allow, "OPTIONS"].join(", "));
  return c.json(
    errorBody("METHOD_NOT_ALLOWED", `Method ${c.req.method} is not allowed for this resource`),
    405,
  );
}

export default app;
```

**How it fits together**

- **Hono** handles routing, CORS preflight, and the Workers `fetch` export.
- **Zod** validates bodies and list-query params; failures become `{ error: { code: "VALIDATION_ERROR", message } }` with **400**.
- **KV** keys: `project:{id}` and `task:{projectId}:{taskId}`. Listing uses prefix scans with cursor pagination; writes/deletes are chunked to stay under subrequest limits. Deleting a project removes all of its tasks.
- **Auth** is a bearer check against the `API_TOKEN` secret, using a constant-time compare. `GET /api/v1/health` is registered before the auth middleware.
- **Logging** emits one JSON line per request: `method`, `path`, `status`, `durationMs`.
- **405** handlers sit after the real routes on the same paths and set `Allow`. Unknown paths use the same **404** error shape.

After `npm install`, copy `.dev.vars.example` → `.dev.vars`, create the KV namespace, put its id in `wrangler.toml`, then `npm run dev`.