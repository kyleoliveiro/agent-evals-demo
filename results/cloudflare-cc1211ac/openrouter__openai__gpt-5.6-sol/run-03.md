<!-- model: openrouter/openai/gpt-5.6-sol | run: 3 | framework: Hono -->

Below is a complete Cloudflare Workers TypeScript project using Hono, Zod, and Cloudflare KV.

## Project structure

```text
team-task-board-api/
├── src/
│   ├── errors.ts
│   ├── index.ts
│   ├── repository.ts
│   ├── types.ts
│   └── validation.ts
├── .gitignore
├── package.json
├── README.md
├── tsconfig.json
└── wrangler.toml
```

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "Team task board REST API running on Cloudflare Workers",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && wrangler deploy --dry-run"
  },
  "dependencies": {
    "hono": "4.9.4",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "4.20250823.0",
    "typescript": "5.9.2",
    "wrangler": "4.32.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "WebWorker"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

### `wrangler.toml`

```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2025-08-01"
workers_dev = true

[vars]
# Use "*" to allow all origins, or a comma-separated list such as:
# "https://app.example.com,https://admin.example.com"
CORS_ORIGIN = "*"

[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_PRODUCTION_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID"

[observability]
enabled = true
```

### `.gitignore`

```gitignore
node_modules/
.wrangler/
.dev.vars
.env
.env.*
dist/
coverage/
*.log
.DS_Store
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

export interface ProjectMetadata {
  createdAt: string;
}

export interface TaskMetadata {
  status: TaskStatus;
  createdAt: string;
}

export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
  CORS_ORIGIN?: string;
}

export type AppEnvironment = {
  Bindings: Env;
};
```

### `src/errors.ts`

```ts
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnvironment } from "./types";

export type ErrorCode =
  | "BAD_REQUEST"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(
  context: Context<AppEnvironment>,
  error: unknown,
): Response {
  if (error instanceof ApiError) {
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      error.status,
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: "Unhandled request error",
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : String(error),
    }),
  );

  return context.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
    500,
  );
}
```

### `src/validation.ts`

```ts
import { z } from "zod";
import { ApiError } from "./errors";

const optionalDescriptionSchema = z
  .string()
  .trim()
  .max(10_000, "Description must not exceed 10,000 characters");

const optionalAssigneeSchema = z
  .string()
  .trim()
  .min(1, "Assignee must not be empty")
  .max(200, "Assignee must not exceed 200 characters");

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const createProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(200, "Name must not exceed 200 characters"),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(500, "Title must not exceed 500 characters"),
    description: optionalDescriptionSchema.optional(),
    status: taskStatusSchema.optional().default("todo"),
    assignee: optionalAssigneeSchema.optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title must not be empty")
      .max(500, "Title must not exceed 500 characters")
      .optional(),
    description: optionalDescriptionSchema.nullable().optional(),
    status: taskStatusSchema.optional(),
    assignee: optionalAssigneeSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided",
  );

export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "Request body must contain valid JSON",
    );
  }
}

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const message = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");

  throw new ApiError(
    400,
    "VALIDATION_ERROR",
    message || "Request validation failed",
  );
}
```

### `src/repository.ts`

```ts
import type {
  Project,
  ProjectMetadata,
  Task,
  TaskMetadata,
  TaskStatus,
} from "./types";

const PROJECT_PREFIX = "project:";
const TASK_PREFIX = "task:";

const KV_LIST_LIMIT = 1_000;
const KV_CONCURRENCY = 25;

function projectKey(projectId: string): string {
  return `${PROJECT_PREFIX}${projectId}`;
}

function taskPrefix(projectId: string): string {
  return `${TASK_PREFIX}${projectId}:`;
}

function taskKey(projectId: string, taskId: string): string {
  return `${taskPrefix(projectId)}${taskId}`;
}

async function inChunks<T>(
  values: T[],
  operation: (value: T) => Promise<unknown>,
): Promise<void> {
  for (let index = 0; index < values.length; index += KV_CONCURRENCY) {
    const chunk = values.slice(index, index + KV_CONCURRENCY);
    await Promise.all(chunk.map(operation));
  }
}

async function listAllKeys<Metadata>(
  kv: KVNamespace,
  prefix: string,
): Promise<KVNamespaceListKey<Metadata>[]> {
  const keys: KVNamespaceListKey<Metadata>[] = [];
  let cursor: string | undefined;

  do {
    const result = await kv.list<Metadata>({
      prefix,
      cursor,
      limit: KV_LIST_LIMIT,
    });

    keys.push(...result.keys);

    if (result.list_complete) {
      cursor = undefined;
    } else {
      if (!result.cursor) {
        throw new Error("KV returned an incomplete listing without a cursor");
      }

      cursor = result.cursor;
    }
  } while (cursor);

  return keys;
}

async function getValues<T>(
  kv: KVNamespace,
  keys: string[],
): Promise<T[]> {
  const values: T[] = [];

  for (let index = 0; index < keys.length; index += KV_CONCURRENCY) {
    const chunk = keys.slice(index, index + KV_CONCURRENCY);
    const results = await Promise.all(
      chunk.map((key) => kv.get<T>(key, "json")),
    );

    for (const result of results) {
      if (result !== null) {
        values.push(result);
      }
    }
  }

  return values;
}

export class TaskBoardRepository {
  constructor(private readonly kv: KVNamespace) {}

  async listProjects(): Promise<Project[]> {
    const keys = await listAllKeys<ProjectMetadata>(
      this.kv,
      PROJECT_PREFIX,
    );

    keys.sort((left, right) => {
      const leftDate = left.metadata?.createdAt ?? "";
      const rightDate = right.metadata?.createdAt ?? "";
      return rightDate.localeCompare(leftDate);
    });

    return getValues<Project>(
      this.kv,
      keys.map((key) => key.name),
    );
  }

  async createProject(name: string): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };

    const metadata: ProjectMetadata = {
      createdAt: project.createdAt,
    };

    await this.kv.put(projectKey(project.id), JSON.stringify(project), {
      metadata,
    });

    return project;
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.kv.get<Project>(projectKey(projectId), "json");
  }

  async deleteProjectAndTasks(projectId: string): Promise<void> {
    const taskKeys = await listAllKeys<TaskMetadata>(
      this.kv,
      taskPrefix(projectId),
    );

    // Delete tasks first so a partial failure does not leave orphaned tasks
    // after the project has been removed.
    await inChunks(taskKeys, (key) => this.kv.delete(key.name));
    await this.kv.delete(projectKey(projectId));
  }

  async listTasks(
    projectId: string,
    options: {
      status?: TaskStatus;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    tasks: Task[];
    total: number;
  }> {
    const keys = await listAllKeys<TaskMetadata>(
      this.kv,
      taskPrefix(projectId),
    );

    const filteredKeys = options.status
      ? keys.filter((key) => key.metadata?.status === options.status)
      : keys;

    filteredKeys.sort((left, right) => {
      const leftDate = left.metadata?.createdAt ?? "";
      const rightDate = right.metadata?.createdAt ?? "";
      return rightDate.localeCompare(leftDate);
    });

    const offset = (options.page - 1) * options.pageSize;
    const pageKeys = filteredKeys.slice(offset, offset + options.pageSize);

    const tasks = await getValues<Task>(
      this.kv,
      pageKeys.map((key) => key.name),
    );

    return {
      tasks,
      total: filteredKeys.length,
    };
  }

  async createTask(
    projectId: string,
    input: {
      title: string;
      description?: string;
      status: TaskStatus;
      assignee?: string;
    },
  ): Promise<Task> {
    const now = new Date().toISOString();

    const task: Task = {
      id: crypto.randomUUID(),
      projectId,
      title: input.title,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    };

    if (input.description !== undefined) {
      task.description = input.description;
    }

    if (input.assignee !== undefined) {
      task.assignee = input.assignee;
    }

    await this.saveTask(task);
    return task;
  }

  async getTask(
    projectId: string,
    taskId: string,
  ): Promise<Task | null> {
    return this.kv.get<Task>(taskKey(projectId, taskId), "json");
  }

  async updateTask(
    task: Task,
    changes: {
      title?: string;
      description?: string | null;
      status?: TaskStatus;
      assignee?: string | null;
    },
  ): Promise<Task> {
    const updatedTask: Task = {
      ...task,
      updatedAt: new Date().toISOString(),
    };

    if (changes.title !== undefined) {
      updatedTask.title = changes.title;
    }

    if (changes.status !== undefined) {
      updatedTask.status = changes.status;
    }

    if (changes.description === null) {
      delete updatedTask.description;
    } else if (changes.description !== undefined) {
      updatedTask.description = changes.description;
    }

    if (changes.assignee === null) {
      delete updatedTask.assignee;
    } else if (changes.assignee !== undefined) {
      updatedTask.assignee = changes.assignee;
    }

    await this.saveTask(updatedTask);
    return updatedTask;
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.kv.delete(taskKey(projectId, taskId));
  }

  private async saveTask(task: Task): Promise<void> {
    const metadata: TaskMetadata = {
      status: task.status,
      createdAt: task.createdAt,
    };

    await this.kv.put(
      taskKey(task.projectId, task.id),
      JSON.stringify(task),
      { metadata },
    );
  }
}
```

### `src/index.ts`

```ts
import { Hono, type Handler } from "hono";
import { cors } from "hono/cors";
import { ApiError, errorResponse } from "./errors";
import { TaskBoardRepository } from "./repository";
import type { AppEnvironment } from "./types";
import {
  createProjectSchema,
  createTaskSchema,
  parseOrThrow,
  readJsonBody,
  taskListQuerySchema,
  updateTaskSchema,
} from "./validation";

const app = new Hono<AppEnvironment>();

function parseAllowedOrigins(value: string | undefined): string[] | "*" {
  const configured = value?.trim();

  if (!configured || configured === "*") {
    return "*";
  }

  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function tokensEqual(
  suppliedToken: string,
  expectedToken: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(suppliedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
  ]);

  const suppliedBytes = new Uint8Array(suppliedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);

  let difference = 0;

  for (let index = 0; index < suppliedBytes.length; index += 1) {
    difference |= suppliedBytes[index] ^ expectedBytes[index];
  }

  return difference === 0;
}

function methodNotAllowed(allowedMethods: string[]): Handler<AppEnvironment> {
  return (context) => {
    context.header("Allow", allowedMethods.join(", "));
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${context.req.method} is not allowed for this resource`,
    );
  };
}

async function requireProject(
  repository: TaskBoardRepository,
  projectId: string,
) {
  const project = await repository.getProject(projectId);

  if (!project) {
    throw new ApiError(404, "NOT_FOUND", "Project not found");
  }

  return project;
}

async function requireTask(
  repository: TaskBoardRepository,
  projectId: string,
  taskId: string,
) {
  const task = await repository.getTask(projectId, taskId);

  if (!task) {
    throw new ApiError(404, "NOT_FOUND", "Task not found");
  }

  return task;
}

// Request logging. Registered first so preflight, authentication failures,
// route errors, and successful responses are all logged.
app.use("*", async (context, next) => {
  const startedAt = Date.now();
  const requestId =
    context.req.header("CF-Ray") ??
    context.req.header("X-Request-ID") ??
    crypto.randomUUID();

  try {
    await next();
  } finally {
    context.header("X-Request-ID", requestId);

    console.log(
      JSON.stringify({
        level: "info",
        requestId,
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Date.now() - startedAt,
      }),
    );
  }
});

// CORS is applied before authentication so browser preflight requests do not
// need to provide an Authorization header.
app.use(
  "/api/*",
  cors({
    origin: (origin, context) => {
      const allowedOrigins = parseAllowedOrigins(
        context.env.CORS_ORIGIN,
      );

      if (allowedOrigins === "*") {
        return "*";
      }

      return allowedOrigins.includes(origin) ? origin : undefined;
    },
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "X-Request-ID",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Request-ID"],
    maxAge: 86_400,
  }),
);

// Authenticate all v1 endpoints other than health and CORS preflight.
app.use("/api/v1/*", async (context, next) => {
  if (
    context.req.method === "OPTIONS" ||
    context.req.path === "/api/v1/health"
  ) {
    await next();
    return;
  }

  const expectedToken = context.env.API_TOKEN;

  if (!expectedToken) {
    throw new Error("API_TOKEN secret binding is not configured");
  }

  const authorization = context.req.header("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "A valid Bearer token is required",
    );
  }

  const authenticated = await tokensEqual(match[1], expectedToken);

  if (!authenticated) {
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "A valid Bearer token is required",
    );
  }

  await next();
});

app.get("/api/v1/health", (context) => {
  return context.json({ ok: true });
});

app.get("/api/v1/projects", async (context) => {
  const repository = new TaskBoardRepository(context.env.TASKS);
  const projects = await repository.listProjects();

  return context.json({ projects });
});

app.post("/api/v1/projects", async (context) => {
  const body = await readJsonBody(context.req.raw);
  const input = parseOrThrow(createProjectSchema, body);
  const repository = new TaskBoardRepository(context.env.TASKS);

  const project = await repository.createProject(input.name);
  return context.json({ project }, 201);
});

app.get("/api/v1/projects/:projectId", async (context) => {
  const repository = new TaskBoardRepository(context.env.TASKS);
  const project = await requireProject(
    repository,
    context.req.param("projectId"),
  );

  return context.json({ project });
});

app.delete("/api/v1/projects/:projectId", async (context) => {
  const repository = new TaskBoardRepository(context.env.TASKS);
  const projectId = context.req.param("projectId");

  await requireProject(repository, projectId);
  await repository.deleteProjectAndTasks(projectId);

  return context.body(null, 204);
});

app.get("/api/v1/projects/:projectId/tasks", async (context) => {
  const repository = new TaskBoardRepository(context.env.TASKS);
  const projectId = context.req.param("projectId");

  await requireProject(repository, projectId);

  const query = parseOrThrow(taskListQuerySchema, {
    status: context.req.query("status"),
    page: context.req.query("page") ?? 1,
    pageSize: context.req.query("pageSize") ?? 20,
  });

  const result = await repository.listTasks(projectId, query);
  const totalPages =
    result.total === 0 ? 0 : Math.ceil(result.total / query.pageSize);

  return context.json({
    tasks: result.tasks,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
      totalPages,
    },
  });
});

app.post("/api/v1/projects/:projectId/tasks", async (context) => {
  const repository = new TaskBoardRepository(context.env.TASKS);
  const projectId = context.req.param("projectId");

  await requireProject(repository, projectId);

  const body = await readJsonBody(context.req.raw);
  const input = parseOrThrow(createTaskSchema, body);
  const task = await repository.createTask(projectId, input);

  return context.json({ task }, 201);
});

app.get(
  "/api/v1/projects/:projectId/tasks/:taskId",
  async (context) => {
    const repository = new TaskBoardRepository(context.env.TASKS);
    const projectId = context.req.param("projectId");

    await requireProject(repository, projectId);

    const task = await requireTask(
      repository,
      projectId,
      context.req.param("taskId"),
    );

    return context.json({ task });
  },
);

app.patch(
  "/api/v1/projects/:projectId/tasks/:taskId",
  async (context) => {
    const repository = new TaskBoardRepository(context.env.TASKS);
    const projectId = context.req.param("projectId");

    await requireProject(repository, projectId);

    const task = await requireTask(
      repository,
      projectId,
      context.req.param("taskId"),
    );

    const body = await readJsonBody(context.req.raw);
    const changes = parseOrThrow(updateTaskSchema, body);
    const updatedTask = await repository.updateTask(task, changes);

    return context.json({ task: updatedTask });
  },
);

app.delete(
  "/api/v1/projects/:projectId/tasks/:taskId",
  async (context) => {
    const repository = new TaskBoardRepository(context.env.TASKS);
    const projectId = context.req.param("projectId");
    const taskId = context.req.param("taskId");

    await requireProject(repository, projectId);
    await requireTask(repository, projectId, taskId);
    await repository.deleteTask(projectId, taskId);

    return context.body(null, 204);
  },
);

// Explicit fallbacks provide 405 rather than 404 for known resources.
app.all("/api/v1/health", methodNotAllowed(["GET"]));

app.all(
  "/api/v1/projects",
  methodNotAllowed(["GET", "POST"]),
);

app.all(
  "/api/v1/projects/:projectId",
  methodNotAllowed(["GET", "DELETE"]),
);

app.all(
  "/api/v1/projects/:projectId/tasks",
  methodNotAllowed(["GET", "POST"]),
);

app.all(
  "/api/v1/projects/:projectId/tasks/:taskId",
  methodNotAllowed(["GET", "PATCH", "DELETE"]),
);

app.notFound((context) => {
  return context.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    },
    404,
  );
});

app.onError((error, context) => {
  return errorResponse(context, error);
});

export default app;
```

### `README.md`

```md
# Team Task Board API

A REST API for projects and tasks, built with:

- Cloudflare Workers
- Cloudflare KV
- TypeScript
- Hono
- Zod

## Requirements

- Node.js 20 or newer
- A Cloudflare account
- Wrangler authentication

## Installation

```bash
npm install
npx wrangler login
```

## Create the KV namespaces

Create a production namespace:

```bash
npx wrangler kv namespace create TASKS
```

Create a preview/development namespace:

```bash
npx wrangler kv namespace create TASKS --preview
```

Copy the returned IDs into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TASKS"
id = "PRODUCTION_NAMESPACE_ID"
preview_id = "PREVIEW_NAMESPACE_ID"
```

## Configure the API token

For deployed environments, store the token as a Worker secret:

```bash
npx wrangler secret put API_TOKEN
```

For local development, create a `.dev.vars` file:

```dotenv
API_TOKEN=replace-with-a-long-random-token
```

Do not commit `.dev.vars`.

A token can be generated with:

```bash
openssl rand -hex 32
```

## Configure CORS

The default configuration allows every origin:

```toml
[vars]
CORS_ORIGIN = "*"
```

For production, use an explicit comma-separated allowlist:

```toml
[vars]
CORS_ORIGIN = "https://app.example.com,https://admin.example.com"
```

## Development

```bash
npm run dev
```

## Type checking

```bash
npm run typecheck
```

## Deployment

```bash
npm run deploy
```

## Authentication

Every endpoint except `GET /api/v1/health` requires:

```http
Authorization: Bearer YOUR_API_TOKEN
```

CORS preflight requests are exempt from authentication.

## Endpoints

| Method | Endpoint |
|---|---|
| GET | `/api/v1/health` |
| GET | `/api/v1/projects` |
| POST | `/api/v1/projects` |
| GET | `/api/v1/projects/:projectId` |
| DELETE | `/api/v1/projects/:projectId` |
| GET | `/api/v1/projects/:projectId/tasks` |
| POST | `/api/v1/projects/:projectId/tasks` |
| GET | `/api/v1/projects/:projectId/tasks/:taskId` |
| PATCH | `/api/v1/projects/:projectId/tasks/:taskId` |
| DELETE | `/api/v1/projects/:projectId/tasks/:taskId` |

Task listing supports:

- `status=todo`
- `status=in_progress`
- `status=done`
- `page`, default `1`
- `pageSize`, default `20`, maximum `100`

Example:

```text
GET /api/v1/projects/PROJECT_ID/tasks?status=todo&page=1&pageSize=20
```

## Example requests

Health check:

```bash
curl http://localhost:8787/api/v1/health
```

Create a project:

```bash
curl -X POST http://localhost:8787/api/v1/projects \
  -H 'Authorization: Bearer replace-with-a-long-random-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Platform Engineering"
  }'
```

Create a task:

```bash
curl -X POST \
  http://localhost:8787/api/v1/projects/PROJECT_ID/tasks \
  -H 'Authorization: Bearer replace-with-a-long-random-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Deploy the API",
    "description": "Deploy the first production version",
    "status": "todo",
    "assignee": "alex@example.com"
  }'
```

Update a task:

```bash
curl -X PATCH \
  http://localhost:8787/api/v1/projects/PROJECT_ID/tasks/TASK_ID \
  -H 'Authorization: Bearer replace-with-a-long-random-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "done"
  }'
```

Set `description` or `assignee` to `null` to remove that field:

```json
{
  "description": null,
  "assignee": null
}
```

## Error format

Errors use a consistent JSON structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title: Title is required"
  }
}
```

Common HTTP statuses:

- `400` invalid JSON or validation failure
- `401` missing or invalid API token
- `404` resource or route not found
- `405` method not allowed
- `500` unexpected server error

## Cloudflare KV consistency notes

Cloudflare KV is eventually consistent. Writes are immediately visible in many cases but may take time to propagate globally.

This implementation stores task status and creation time as KV metadata, allowing listing, filtering, sorting, and pagination without reading every task value. Numbered pagination still requires scanning task-key metadata for the project.

Project deletion and task deletion cannot be transactional in KV. Tasks are deleted before the project so that a partial failure is less likely to leave orphaned tasks.
```