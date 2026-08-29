<!-- model: openrouter/openai/gpt-5.6-sol | run: 1 | framework: Hono -->

Below is a complete Cloudflare Workers TypeScript project using Hono and Zod.

## Project structure

```text
team-task-board-api/
├── src/
│   └── index.ts
├── .dev.vars.example
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
  "type": "module",
  "description": "A REST API for a team task board, running on Cloudflare Workers.",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "cf-typegen": "wrangler types"
  },
  "dependencies": {
    "hono": "^4.9.8",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250823.0",
    "typescript": "^5.9.2",
    "wrangler": "^4.33.1"
  },
  "engines": {
    "node": ">=20"
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
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowJs": false,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

### `wrangler.toml`

```toml
name = "team-task-board-api"
main = "src/index.ts"
compatibility_date = "2026-08-29"

workers_dev = true

[observability]
enabled = true

[[kv_namespaces]]
binding = "TASKS"
id = "REPLACE_WITH_PRODUCTION_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID"
```

### `.dev.vars.example`

```dotenv
API_TOKEN=replace-with-a-long-random-development-token
```

Copy this file to `.dev.vars` for local development.

### `.gitignore`

```gitignore
node_modules/
.wrangler/
.dev.vars
.env
.env.*
!.dev.vars.example
dist/
coverage/
*.log
.DS_Store
```

### `src/index.ts`

```ts
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z, type ZodType } from "zod";

type TaskStatus = "todo" | "in_progress" | "done";

interface Project {
  id: string;
  name: string;
  createdAt: string;
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskMetadata {
  status: TaskStatus;
}

interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
}

type AppEnv = {
  Bindings: Env;
};

type ErrorStatus = 400 | 401 | 404 | 405 | 500;

interface ListedKey<Metadata> {
  name: string;
  metadata?: Metadata;
}

const PROJECT_KEY_PREFIX = "project:";
const TASK_KEY_PREFIX = "task:";

const projectCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
  })
  .strict();

const taskCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5_000).optional(),
    status: z.enum(["todo", "in_progress", "done"]).default("todo"),
    assignee: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const taskPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5_000).nullable().optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    assignee: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

const taskListQuerySchema = z.object({
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

class ApiError extends Error {
  readonly status: ErrorStatus;
  readonly code: string;

  constructor(status: ErrorStatus, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const app = new Hono<AppEnv>({
  strict: false,
});

/**
 * Request logging is registered first so it includes CORS preflight,
 * authentication failures, expected errors, and unexpected errors.
 */
app.use("*", async (c, next) => {
  const startedAt = performance.now();
  const requestId = c.req.header("X-Request-Id") ?? crypto.randomUUID();

  c.header("X-Request-Id", requestId);

  let status = 500;

  try {
    await next();
    status = c.res.status;
  } catch (error) {
    status = 500;
    throw error;
  } finally {
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;

    console.log(
      JSON.stringify({
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs,
      }),
    );
  }
});

app.use("*", secureHeaders());

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 86_400,
  }),
);

/**
 * CORS preflight is allowed without authentication. The health endpoint is
 * also public. Every other /api/v1 path requires a valid bearer token.
 */
app.use("/api/v1/*", async (c, next) => {
  const normalizedPath =
    c.req.path.length > 1 ? c.req.path.replace(/\/+$/, "") : c.req.path;

  if (
    c.req.method === "OPTIONS" ||
    normalizedPath === "/api/v1/health"
  ) {
    await next();
    return;
  }

  const authorization = c.req.header("Authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const suppliedToken = match?.[1];

  if (
    !suppliedToken ||
    !c.env.API_TOKEN ||
    !constantTimeEqual(suppliedToken, c.env.API_TOKEN)
  ) {
    return jsonError(
      c,
      401,
      "UNAUTHORIZED",
      "A valid bearer token is required",
    );
  }

  await next();
});

app.get("/api/v1/health", (c) => {
  return c.json({ ok: true });
});

app.get("/api/v1/projects", async (c) => {
  const keys = await listAllKeys<Project>(c.env.TASKS, PROJECT_KEY_PREFIX);

  const projects = await Promise.all(
    keys.map(async (key): Promise<Project | null> => {
      // Project data is stored as both the value and KV metadata. Metadata
      // avoids an additional KV read during normal list operations.
      if (key.metadata) {
        return key.metadata;
      }

      return c.env.TASKS.get<Project>(key.name, "json");
    }),
  );

  const data = projects
    .filter((project): project is Project => project !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return c.json(data);
});

app.post("/api/v1/projects", async (c) => {
  const input = await parseJsonBody(c, projectCreateSchema);

  const project: Project = {
    id: crypto.randomUUID(),
    name: input.name,
    createdAt: new Date().toISOString(),
  };

  await c.env.TASKS.put(projectKey(project.id), JSON.stringify(project), {
    metadata: project,
  });

  return c.json(project, 201);
});

app.get("/api/v1/projects/:projectId", async (c) => {
  const project = await getProjectOrThrow(
    c.env.TASKS,
    c.req.param("projectId"),
  );

  return c.json(project);
});

app.delete("/api/v1/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");

  await getProjectOrThrow(c.env.TASKS, projectId);

  const taskKeys = await listAllKeys<TaskMetadata>(
    c.env.TASKS,
    taskPrefix(projectId),
  );

  // Delete in bounded batches rather than scheduling an unbounded number
  // of concurrent KV operations.
  await deleteKeysInBatches(
    c.env.TASKS,
    taskKeys.map((key) => key.name),
    50,
  );

  await c.env.TASKS.delete(projectKey(projectId));

  return c.body(null, 204);
});

app.get("/api/v1/projects/:projectId/tasks", async (c) => {
  const projectId = c.req.param("projectId");

  await getProjectOrThrow(c.env.TASKS, projectId);

  const queryResult = taskListQuerySchema.safeParse({
    status: c.req.query("status"),
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });

  if (!queryResult.success) {
    throw validationError(queryResult.error);
  }

  const { status, page, pageSize } = queryResult.data;
  const offset = (page - 1) * pageSize;
  const end = offset + pageSize;

  const keys = await listAllKeys<TaskMetadata>(
    c.env.TASKS,
    taskPrefix(projectId),
  );

  let total = 0;
  const selectedNames: string[] = [];

  // KV list operations return keys in lexicographical order. Filtering and
  // pagination are applied over that stable order.
  for (const key of keys) {
    if (status && key.metadata?.status !== status) {
      continue;
    }

    if (total >= offset && total < end) {
      selectedNames.push(key.name);
    }

    total += 1;
  }

  const tasks = await Promise.all(
    selectedNames.map((key) => c.env.TASKS.get<Task>(key, "json")),
  );

  const items = tasks.filter((task): task is Task => task !== null);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return c.json({
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  });
});

app.post("/api/v1/projects/:projectId/tasks", async (c) => {
  const projectId = c.req.param("projectId");

  await getProjectOrThrow(c.env.TASKS, projectId);

  const input = await parseJsonBody(c, taskCreateSchema);
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

  await putTask(c.env.TASKS, task);

  return c.json(task, 201);
});

app.get(
  "/api/v1/projects/:projectId/tasks/:taskId",
  async (c) => {
    const projectId = c.req.param("projectId");
    const taskId = c.req.param("taskId");

    await getProjectOrThrow(c.env.TASKS, projectId);
    const task = await getTaskOrThrow(c.env.TASKS, projectId, taskId);

    return c.json(task);
  },
);

app.patch(
  "/api/v1/projects/:projectId/tasks/:taskId",
  async (c) => {
    const projectId = c.req.param("projectId");
    const taskId = c.req.param("taskId");

    await getProjectOrThrow(c.env.TASKS, projectId);

    const existingTask = await getTaskOrThrow(
      c.env.TASKS,
      projectId,
      taskId,
    );

    const input = await parseJsonBody(c, taskPatchSchema);

    const updatedTask: Task = {
      ...existingTask,
      updatedAt: new Date().toISOString(),
    };

    if (input.title !== undefined) {
      updatedTask.title = input.title;
    }

    if (input.status !== undefined) {
      updatedTask.status = input.status;
    }

    if (input.description === null) {
      delete updatedTask.description;
    } else if (input.description !== undefined) {
      updatedTask.description = input.description;
    }

    if (input.assignee === null) {
      delete updatedTask.assignee;
    } else if (input.assignee !== undefined) {
      updatedTask.assignee = input.assignee;
    }

    await putTask(c.env.TASKS, updatedTask);

    return c.json(updatedTask);
  },
);

app.delete(
  "/api/v1/projects/:projectId/tasks/:taskId",
  async (c) => {
    const projectId = c.req.param("projectId");
    const taskId = c.req.param("taskId");

    await getProjectOrThrow(c.env.TASKS, projectId);
    await getTaskOrThrow(c.env.TASKS, projectId, taskId);

    await c.env.TASKS.delete(taskKey(projectId, taskId));

    return c.body(null, 204);
  },
);

/**
 * Explicit resource-pattern fallbacks distinguish an unsupported HTTP method
 * from a completely unknown route.
 */
app.all(
  "/api/v1/health",
  methodNotAllowed(["GET"]),
);

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

app.notFound((c) => {
  return jsonError(c, 404, "NOT_FOUND", "The requested route was not found");
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return jsonError(c, error.status, error.code, error.message);
  }

  console.error(
    JSON.stringify({
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

  return jsonError(
    c,
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred",
  );
});

function projectKey(projectId: string): string {
  return `${PROJECT_KEY_PREFIX}${projectId}`;
}

function taskPrefix(projectId: string): string {
  return `${TASK_KEY_PREFIX}${projectId}:`;
}

function taskKey(projectId: string, taskId: string): string {
  return `${taskPrefix(projectId)}${taskId}`;
}

async function getProjectOrThrow(
  kv: KVNamespace,
  projectId: string,
): Promise<Project> {
  const project = await kv.get<Project>(projectKey(projectId), "json");

  if (!project) {
    throw new ApiError(
      404,
      "PROJECT_NOT_FOUND",
      "The requested project was not found",
    );
  }

  return project;
}

async function getTaskOrThrow(
  kv: KVNamespace,
  projectId: string,
  taskId: string,
): Promise<Task> {
  const task = await kv.get<Task>(taskKey(projectId, taskId), "json");

  if (!task) {
    throw new ApiError(
      404,
      "TASK_NOT_FOUND",
      "The requested task was not found",
    );
  }

  return task;
}

async function putTask(kv: KVNamespace, task: Task): Promise<void> {
  const metadata: TaskMetadata = {
    status: task.status,
  };

  await kv.put(taskKey(task.projectId, task.id), JSON.stringify(task), {
    metadata,
  });
}

async function parseJsonBody<T>(
  c: Context<AppEnv>,
  schema: ZodType<T>,
): Promise<T> {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "The request body must contain valid JSON",
    );
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    throw validationError(result.error);
  }

  return result.data;
}

function validationError(error: z.ZodError): ApiError {
  const message = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");

  return new ApiError(
    400,
    "VALIDATION_ERROR",
    message || "The request is invalid",
  );
}

async function listAllKeys<Metadata>(
  kv: KVNamespace,
  prefix: string,
): Promise<Array<ListedKey<Metadata>>> {
  const keys: Array<ListedKey<Metadata>> = [];
  let cursor: string | undefined;

  do {
    const result = await kv.list<Metadata>({
      prefix,
      limit: 1_000,
      ...(cursor ? { cursor } : {}),
    });

    for (const key of result.keys) {
      keys.push({
        name: key.name,
        ...(key.metadata !== null
          ? { metadata: key.metadata as Metadata }
          : {}),
      });
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return keys;
}

async function deleteKeysInBatches(
  kv: KVNamespace,
  keys: string[],
  batchSize: number,
): Promise<void> {
  for (let index = 0; index < keys.length; index += batchSize) {
    const batch = keys.slice(index, index + batchSize);
    await Promise.all(batch.map((key) => kv.delete(key)));
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);

  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |=
      (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function jsonError(
  c: Context<AppEnv>,
  status: ErrorStatus,
  code: string,
  message: string,
) {
  return c.json(
    {
      error: {
        code,
        message,
      },
    },
    status,
  );
}

function methodNotAllowed(allowedMethods: string[]) {
  return (c: Context<AppEnv>) => {
    c.header("Allow", allowedMethods.join(", "));

    return jsonError(
      c,
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${c.req.method} is not allowed for this resource`,
    );
  };
}

export default app;
```

### `README.md`

```md
# Team Task Board API

A REST API for projects and tasks, deployed on Cloudflare Workers and backed by Cloudflare KV.

## Features

- TypeScript
- Hono routing
- Zod request validation
- Bearer-token authentication
- Cloudflare KV persistence
- CORS and preflight support
- Structured request logging
- Consistent JSON errors
- Task status filtering and pagination
- Cascading task deletion when a project is deleted

## Prerequisites

- Node.js 20 or newer
- A Cloudflare account
- Wrangler authentication

```bash
npx wrangler login
```

## Installation

```bash
npm install
```

## Create KV namespaces

Create production and preview/development namespaces:

```bash
npx wrangler kv namespace create TASKS
npx wrangler kv namespace create TASKS --preview
```

Copy the returned namespace IDs into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TASKS"
id = "PRODUCTION_NAMESPACE_ID"
preview_id = "PREVIEW_NAMESPACE_ID"
```

## Configure the API token

### Local development

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```dotenv
API_TOKEN=your-development-token
```

Do not commit `.dev.vars`.

### Production

Set the secret through Wrangler:

```bash
npx wrangler secret put API_TOKEN
```

Use a long, randomly generated token.

## Development

```bash
npm run dev
```

By default, the API will be available through the URL printed by Wrangler.

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

CORS preflight requests do not require authentication.

## Endpoints

### Health

```http
GET /api/v1/health
```

Response:

```json
{
  "ok": true
}
```

### List projects

```http
GET /api/v1/projects
Authorization: Bearer TOKEN
```

Response:

```json
[
  {
    "id": "891dcd8e-dde5-4602-916b-d8b585f7524a",
    "name": "Website redesign",
    "createdAt": "2026-08-29T12:00:00.000Z"
  }
]
```

### Create project

```http
POST /api/v1/projects
Authorization: Bearer TOKEN
Content-Type: application/json
```

```json
{
  "name": "Website redesign"
}
```

### Get project

```http
GET /api/v1/projects/:projectId
Authorization: Bearer TOKEN
```

### Delete project

Deleting a project also deletes its tasks.

```http
DELETE /api/v1/projects/:projectId
Authorization: Bearer TOKEN
```

Successful response: `204 No Content`.

### List tasks

```http
GET /api/v1/projects/:projectId/tasks?status=todo&page=1&pageSize=20
Authorization: Bearer TOKEN
```

Supported statuses:

- `todo`
- `in_progress`
- `done`

`page` defaults to `1`.

`pageSize` defaults to `20` and has a maximum of `100`.

Response:

```json
{
  "items": [
    {
      "id": "02473d0a-faa8-45ad-9403-976b9426f37e",
      "projectId": "891dcd8e-dde5-4602-916b-d8b585f7524a",
      "title": "Create wireframes",
      "description": "Initial dashboard wireframes",
      "status": "todo",
      "assignee": "Alex",
      "createdAt": "2026-08-29T12:05:00.000Z",
      "updatedAt": "2026-08-29T12:05:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Create task

```http
POST /api/v1/projects/:projectId/tasks
Authorization: Bearer TOKEN
Content-Type: application/json
```

```json
{
  "title": "Create wireframes",
  "description": "Initial dashboard wireframes",
  "status": "todo",
  "assignee": "Alex"
}
```

Only `title` is required. The default status is `todo`.

### Get task

```http
GET /api/v1/projects/:projectId/tasks/:taskId
Authorization: Bearer TOKEN
```

### Update task

```http
PATCH /api/v1/projects/:projectId/tasks/:taskId
Authorization: Bearer TOKEN
Content-Type: application/json
```

```json
{
  "status": "in_progress",
  "assignee": "Jordan"
}
```

Supported fields:

- `title`
- `description`
- `status`
- `assignee`

Set `description` or `assignee` to `null` to remove it:

```json
{
  "description": null,
  "assignee": null
}
```

At least one field must be supplied.

### Delete task

```http
DELETE /api/v1/projects/:projectId/tasks/:taskId
Authorization: Bearer TOKEN
```

Successful response: `204 No Content`.

## Error format

All API errors use the following shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title: String must contain at least 1 character(s)"
  }
}
```

Common status codes:

- `400` — request validation failure
- `401` — missing or invalid bearer token
- `404` — project, task, or route not found
- `405` — method not allowed
- `500` — unexpected server error

## Logging

Each request emits a structured JSON log containing:

```json
{
  "requestId": "e3aaf567-a25c-4455-a5cd-b7daf77355c4",
  "method": "GET",
  "path": "/api/v1/projects",
  "status": 200,
  "durationMs": 4.32
}
```

Clients may provide an `X-Request-Id` header. Otherwise, one is generated and returned in the response.

## Cloudflare KV consistency

Cloudflare KV is eventually consistent across locations. Writes are immediately visible in many cases, but another Cloudflare location may temporarily serve an older value.

KV also does not support multi-key transactions. Cascading project deletion is therefore best-effort across multiple KV operations. For workloads requiring transactional consistency, strict secondary indexes, or very high task counts per project, Cloudflare D1 or Durable Objects would be a better storage choice.
```