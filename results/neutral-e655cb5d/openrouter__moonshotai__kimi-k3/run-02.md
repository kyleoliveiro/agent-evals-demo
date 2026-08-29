<!-- model: openrouter/moonshotai/kimi-k3 | run: 2 | framework: Express -->

Here's a complete, production-ready implementation. It's built on **Express** (mature, well-typed middleware ecosystem), **zod** for request validation, and keeps persistence behind an async `TaskBoardStore` interface so the in-memory implementation can be swapped for a database later without touching the routes.

## File tree

```
team-task-board-api/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
└── src/
    ├── index.ts
    ├── app.ts
    ├── config.ts
    ├── domain/types.ts
    ├── store/
    │   ├── taskBoardStore.ts
    │   └── inMemoryTaskBoardStore.ts
    ├── http/
    │   ├── auth.ts
    │   ├── errors.ts
    │   ├── requestLogger.ts
    │   └── routeRegistry.ts
    ├── controllers/
    │   ├── projectsController.ts
    │   └── tasksController.ts
    ├── routes/
    │   ├── index.ts
    │   └── validation.ts
    └── utils/
        └── asyncHandler.ts
```

## Files

```json
// package.json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "REST API backend for a team task board",
  "license": "MIT",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.4",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "Node",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "removeComments": true
  },
  "include": ["src/**/*"]
}
```

```
# .env.example
# Required. Bearer token every client must send.
API_TOKEN=dev-secret-token

# Optional. Port to listen on (default 3000).
PORT=3000

# Optional. Comma-separated allowed origins. "*" (or unset) allows any origin.
CORS_ORIGIN=*
```

```
# .gitignore
node_modules/
dist/
.env
*.log
```

```markdown
# README.md

# Team Task Board API

Production-ready REST API for managing projects and their tasks.

## Quickstart

```bash
npm install
cp .env.example .env   # set API_TOKEN
npm run dev            # tsx watch (hot reload)
# or
npm run build && npm start
```

The server fails fast at startup if `API_TOKEN` is not set.

## Calling the API

All routes except `GET /api/v1/health` require:

```
Authorization: Bearer <API_TOKEN>
```

```bash
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer dev-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"name": "Launch"}'

curl -X POST http://localhost:3000/api/v1/projects/<projectId>/tasks \
  -H "Authorization: Bearer dev-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"title": "Write announcement"}'

curl "http://localhost:3000/api/v1/projects/<projectId>/tasks?status=todo&page=1&pageSize=20" \
  -H "Authorization: Bearer dev-secret-token"

curl -X PATCH http://localhost:3000/api/v1/projects/<projectId>/tasks/<taskId> \
  -H "Authorization: Bearer dev-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
```

## Error format

Every failure returns a consistent shape:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "title: Required" } }
```

Codes: `UNAUTHORIZED` (401), `VALIDATION_FAILED` (400), `NOT_FOUND` (404),
`METHOD_NOT_ALLOWED` (405), `INTERNAL_ERROR` (500).

405s are detected via a route registry (paths plus allowed methods are recorded
at startup) and include an `Allow` header. 404 vs 405 is decided by matching
the request path against registered route patterns.

## Architecture notes

- `TaskBoardStore` (`src/store/taskBoardStore.ts`) is the only persistence seam;
  `InMemoryTaskBoardStore` is the default. A SQL/NoSQL implementation can be
  dropped in without touching controllers.
- Controllers never handle errors directly; thrown `HttpError`s and `ZodError`s
  funnel into a single error middleware that renders the uniform error shape.
- Requests are logged as one structured JSON line (method, path, status,
  duration) for ingestion into log pipelines.
```

```typescript
// src/config.ts
export interface Config {
  port: number;
  apiToken: string;
  corsOrigin: boolean | string | string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiToken = env.API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "API_TOKEN environment variable is required. Set it before starting the server."
    );
  }

  const portValue = env.PORT ?? "3000";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${portValue}".`);
  }

  const corsEnv = env.CORS_ORIGIN;
  const corsOrigin: boolean | string | string[] =
    !corsEnv || corsEnv === "*"
      ? true // reflect request origin (allows any)
      : corsEnv.includes(",")
        ? corsEnv.split(",").map((origin) => origin.trim())
        : corsEnv;

  return { port, apiToken, corsOrigin };
}
```

```typescript
// src/domain/types.ts
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

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

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null; // null clears the field
  status?: TaskStatus;
  assignee?: string | null; // null unassigns
}

export interface TasksPageQuery {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
```

```typescript
// src/store/taskBoardStore.ts
import {
  CreateProjectInput,
  CreateTaskInput,
  Page,
  Project,
  Task,
  TasksPageQuery,
  UpdateTaskInput,
} from "../domain/types";

/**
 * Persistence seam. All operations are async so the in-memory implementation
 * can be replaced with a database-backed one without changing call sites.
 */
export interface TaskBoardStore {
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  /** Deletes a project and all of its tasks. Returns false if it didn't exist. */
  deleteProject(id: string): Promise<boolean>;

  /** Returns undefined when the project does not exist. */
  createTask(projectId: string, input: CreateTaskInput): Promise<Task | undefined>;
  /** Returns undefined when the project does not exist. */
  listTasks(projectId: string, query: TasksPageQuery): Promise<Page<Task> | undefined>;
  /** Returns undefined when the project or task does not exist. */
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  /** Returns undefined when the project or task does not exist. */
  updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task | undefined>;
  /** Returns false when the project or task does not exist. */
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

```typescript
// src/store/inMemoryTaskBoardStore.ts
import { randomUUID } from "node:crypto";
import {
  CreateProjectInput,
  CreateTaskInput,
  Page,
  Project,
  Task,
  TasksPageQuery,
  UpdateTaskInput,
} from "../domain/types";
import { TaskBoardStore } from "./taskBoardStore";

export class InMemoryTaskBoardStore implements TaskBoardStore {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return { ...project };
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].map((project) => ({ ...project }));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const project = this.projects.get(id);
    return project ? { ...project } : undefined;
  }

  async deleteProject(id: string): Promise<boolean> {
    if (!this.projects.delete(id)) {
      return false;
    }
    for (const [taskId, task] of this.tasks) {
      if (task.projectId === id) {
        this.tasks.delete(taskId);
      }
    }
    return true;
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task | undefined> {
    if (!this.projects.has(projectId)) {
      return undefined;
    }
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId,
      title: input.title,
      status: input.status ?? "todo",
      createdAt: now,
      updatedAt: now,
    };
    if (input.description !== undefined) task.description = input.description;
    if (input.assignee !== undefined) task.assignee = input.assignee;
    this.tasks.set(task.id, task);
    return { ...task };
  }

  async listTasks(projectId: string, query: TasksPageQuery): Promise<Page<Task> | undefined> {
    if (!this.projects.has(projectId)) {
      return undefined;
    }
    const { status, page, pageSize } = query;
    let matching = [...this.tasks.values()].filter((task) => task.projectId === projectId);
    if (status) {
      matching = matching.filter((task) => task.status === status);
    }
    const total = matching.length;
    const start = (page - 1) * pageSize;
    const items = matching.slice(start, start + pageSize).map((task) => ({ ...task }));
    return { items, page, pageSize, total };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task && task.projectId === projectId ? { ...task } : undefined;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return undefined;
    }
    const updated: Task = { ...task, updatedAt: new Date().toISOString() };
    if (input.title !== undefined) updated.title = input.title;
    if (input.status !== undefined) updated.status = input.status;
    if (input.description !== undefined) {
      if (input.description === null) delete updated.description;
      else updated.description = input.description;
    }
    if (input.assignee !== undefined) {
      if (input.assignee === null) delete updated.assignee;
      else updated.assignee = input.assignee;
    }
    this.tasks.set(taskId, updated);
    return { ...updated };
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return false;
    }
    this.tasks.delete(taskId);
    return true;
  }
}
```

```typescript
// src/http/auth.ts
import { timingSafeEqual } from "node:crypto";
import { RequestHandler } from "express";
import { HttpError } from "./errors";

/**
 * Bearer-token auth. Comparison is timing-safe and the error message does not
 * reveal whether the header was missing, malformed, or wrong.
 */
export function authMiddleware(apiToken: string): RequestHandler {
  const expected = Buffer.from(apiToken, "utf8");

  return (req, _res, next) => {
    const header = req.headers.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
    if (!match) {
      return next(
        new HttpError(401, "UNAUTHORIZED", "Missing or malformed Authorization header. Expected 'Bearer <token>'.")
      );
    }
    const provided = Buffer.from(match[1] ?? "", "utf8");
    const valid =
      provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!valid) {
      return next(new HttpError(401, "UNAUTHORIZED", "Invalid API token."));
    }
    next();
  };
}
```

```typescript
// src/http/requestLogger.ts
import { RequestHandler } from "express";

/**
 * Logs one structured JSON line per request: method, path, status, duration.
 */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(
        JSON.stringify({
          time: new Date().toISOString(),
          level: "info",
          message: "http_request",
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 1000) / 1000,
        })
      );
    });
    next();
  };
}
```

```typescript
// src/http/routeRegistry.ts
export interface RoutePattern {
  path: string;
  regex: RegExp;
  methods: Set<string>;
}

/**
 * Records every registered (method, path) pair so the fallback handler can
 * distinguish 404 (path never registered) from 405 (path registered, wrong
 * method). Paths use Express-style ":param" segments.
 */
export class RouteRegistry {
  private readonly patterns: RoutePattern[] = [];

  add(method: string, path: string): void {
    let pattern = this.patterns.find((p) => p.path === path);
    if (!pattern) {
      pattern = { path, regex: toRegex(path), methods: new Set<string>() };
      this.patterns.push(pattern);
    }
    pattern.methods.add(method.toUpperCase());
  }

  find(pathname: string): RoutePattern | undefined {
    return this.patterns.find((p) => p.regex.test(pathname));
  }
}

function toRegex(path: string): RegExp {
  const source = path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : escapeRegex(segment)))
    .join("/");
  return new RegExp(`^${source}$`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

```typescript
// src/http/errors.ts
import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { RouteRegistry } from "./routeRegistry";

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Fallback for unmatched requests: 405 when the path is registered but the
 * method is not (with an Allow header), otherwise 404.
 */
export function notFoundHandler(registry: RouteRegistry): RequestHandler {
  return (req, res, next) => {
    const matched = registry.find(req.path);
    if (matched) {
      const allowed = [...matched.methods].sort();
      res.set("Allow", allowed.join(", "));
      return next(
        new HttpError(
          405,
          "METHOD_NOT_ALLOWED",
          `Method ${req.method} is not allowed on ${matched.path}. Allowed: ${allowed.join(", ")}.`
        )
      );
    }
    next(new HttpError(404, "NOT_FOUND", `Route ${req.method} ${req.path} does not exist.`));
  };
}

/** Single place that renders the uniform { error: { code, message } } shape. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.join(".") : "request";
    res.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: `${field}: ${issue ? issue.message : "Invalid request."}`,
      },
    });
    return;
  }

  if (isBodyParseError(err)) {
    res.status(400).json({
      error: { code: "VALIDATION_FAILED", message: "Request body is not valid JSON." },
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  });
}

function isBodyParseError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { type?: string }).type === "entity.parse.failed"
  );
}
```

```typescript
// src/utils/asyncHandler.ts
import { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wraps async route handlers so rejections reach the error middleware. */
export function asyncHandler(fn: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
```

```typescript
// src/routes/validation.ts
import { z } from "zod";
import { TASK_STATUSES } from "../domain/types";

export const createProjectBodySchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(200),
  })
  .strict();

export const createTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(5000).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const updateTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().max(5000).nullish(), // null clears
    status: z.enum(TASK_STATUSES).optional(),
    assignee: z.string().trim().min(1).max(200).nullish(), // null unassigns
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field (title, description, status, assignee) must be provided.",
  });

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
```

```typescript
// src/controllers/projectsController.ts
import { HttpError } from "../http/errors";
import { TaskBoardStore } from "../store/taskBoardStore";
import { createProjectBodySchema } from "../routes/validation";
import { asyncHandler } from "../utils/asyncHandler";

export function projectsController(store: TaskBoardStore) {
  return {
    list: asyncHandler(async (_req, res) => {
      const projects = await store.listProjects();
      res.json({ items: projects });
    }),

    create: asyncHandler(async (req, res) => {
      const body = createProjectBodySchema.parse(req.body);
      const project = await store.createProject(body);
      res.status(201).json(project);
    }),

    get: asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) {
        throw new HttpError(404, "NOT_FOUND", `Project ${req.params.projectId} was not found.`);
      }
      res.json(project);
    }),

    remove: asyncHandler(async (req, res) => {
      const deleted = await store.deleteProject(req.params.projectId);
      if (!deleted) {
        throw new HttpError(404, "NOT_FOUND", `Project ${req.params.projectId} was not found.`);
      }
      res.status(204).end();
    }),
  };
}
```

```typescript
// src/controllers/tasksController.ts
import { HttpError } from "../http/errors";
import { TaskBoardStore } from "../store/taskBoardStore";
import {
  createTaskBodySchema,
  listTasksQuerySchema,
  updateTaskBodySchema,
} from "../routes/validation";
import { asyncHandler } from "../utils/asyncHandler";
import { Project } from "../domain/types";

export function tasksController(store: TaskBoardStore) {
  async function requireProject(projectId: string): Promise<Project> {
    const project = await store.getProject(projectId);
    if (!project) {
      throw new HttpError(404, "NOT_FOUND", `Project ${projectId} was not found.`);
    }
    return project;
  }

  return {
    list: asyncHandler(async (req, res) => {
      const query = listTasksQuerySchema.parse(req.query);
      const page = await store.listTasks(req.params.projectId, query);
      if (!page) {
        throw new HttpError(404, "NOT_FOUND", `Project ${req.params.projectId} was not found.`);
      }
      res.json(page);
    }),

    create: asyncHandler(async (req, res) => {
      const body = createTaskBodySchema.parse(req.body);
      const task = await store.createTask(req.params.projectId, body);
      if (!task) {
        throw new HttpError(404, "NOT_FOUND", `Project ${req.params.projectId} was not found.`);
      }
      res.status(201).json(task);
    }),

    get: asyncHandler(async (req, res) => {
      await requireProject(req.params.projectId);
      const task = await store.getTask(req.params.projectId, req.params.taskId);
      if (!task) {
        throw new HttpError(404, "NOT_FOUND", `Task ${req.params.taskId} was not found.`);
      }
      res.json(task);
    }),

    update: asyncHandler(async (req, res) => {
      await requireProject(req.params.projectId);
      const body = updateTaskBodySchema.parse(req.body);
      const task = await store.updateTask(req.params.projectId, req.params.taskId, body);
      if (!task) {
        throw new HttpError(404, "NOT_FOUND", `Task ${req.params.taskId} was not found.`);
      }
      res.json(task);
    }),

    remove: asyncHandler(async (req, res) => {
      await requireProject(req.params.projectId);
      const deleted = await store.deleteTask(req.params.projectId, req.params.taskId);
      if (!deleted) {
        throw new HttpError(404, "NOT_FOUND", `Task ${req.params.taskId} was not found.`);
      }
      res.status(204).end();
    }),
  };
}
```

```typescript
// src/routes/index.ts
import { Express, RequestHandler } from "express";
import { Config } from "../config";
import { authMiddleware } from "../http/auth";
import { RouteRegistry } from "../http/routeRegistry";
import { projectsController } from "../controllers/projectsController";
import { tasksController } from "../controllers/tasksController";
import { TaskBoardStore } from "../store/taskBoardStore";

const API_PREFIX = "/api/v1";

type HttpMethod = "get" | "post" | "patch" | "delete";

interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handlers: RequestHandler[];
}

/**
 * Route table driven registration: every (method, path) is also recorded in
 * the registry so the fallback can distinguish 404 from 405.
 */
export function registerRoutes(
  app: Express,
  registry: RouteRegistry,
  store: TaskBoardStore,
  config: Config
): void {
  const projects = projectsController(store);
  const tasks = tasksController(store);
  const auth = authMiddleware(config.apiToken);

  const health: RequestHandler = (_req, res) => {
    res.json({ ok: true });
  };

  const definitions: RouteDefinition[] = [
    { method: "get", path: "/health", handlers: [health] }, // public
    { method: "get", path: "/projects", handlers: [auth, projects.list] },
    { method: "post", path: "/projects", handlers: [auth, projects.create] },
    { method: "get", path: "/projects/:projectId", handlers: [auth, projects.get] },
    { method: "delete", path: "/projects/:projectId", handlers: [auth, projects.remove] },
    { method: "get", path: "/projects/:projectId/tasks", handlers: [auth, tasks.list] },
    { method: "post", path: "/projects/:projectId/tasks", handlers: [auth, tasks.create] },
    { method: "get", path: "/projects/:projectId/tasks/:taskId", handlers: [auth, tasks.get] },
    { method: "patch", path: "/projects/:projectId/tasks/:taskId", handlers: [auth, tasks.update] },
    { method: "delete", path: "/projects/:projectId/tasks/:taskId", handlers: [auth, tasks.remove] },
  ];

  for (const { method, path, handlers } of definitions) {
    const fullPath = `${API_PREFIX}${path}`;
    registry.add(method.toUpperCase(), fullPath);
    const register = app[method].bind(app) as (
      routePath: string,
      ...routeHandlers: RequestHandler[]
    ) => void;
    register(fullPath, ...handlers);
  }
}
```

```typescript
// src/app.ts
import cors from "cors";
import express, { Express } from "express";
import { Config } from "./config";
import { errorHandler, notFoundHandler } from "./http/errors";
import { requestLogger } from "./http/requestLogger";
import { RouteRegistry } from "./http/routeRegistry";
import { registerRoutes } from "./routes";
import { TaskBoardStore } from "./store/taskBoardStore";

export function createApp(config: Config, store: TaskBoardStore): Express {
  const app = express();
  const registry = new RouteRegistry();

  app.disable("x-powered-by");

  // Order matters: logging first so even early failures are recorded,
  // CORS before auth so browser preflight (OPTIONS) is answered without a token.
  app.use(requestLogger());
  app.use(cors({ origin: config.corsOrigin, maxAge: 600 }));
  app.use(express.json({ limit: "1mb" }));

  registerRoutes(app, registry, store, config);

  app.use(notFoundHandler(registry));
  app.use(errorHandler);

  return app;
}
```

```typescript
// src/index.ts
import "dotenv/config";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { InMemoryTaskBoardStore } from "./store/inMemoryTaskBoardStore";

const config = loadConfig();
const store = new InMemoryTaskBoardStore();
const app = createApp(config, store);

const server = app.listen(config.port, () => {
  console.log(`task-board API listening on port ${config.port}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; closing HTTP server...`);
  server.close(() => process.exit(0));
  setTimeout(() => {
    console.error("Forced shutdown after 10s timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

## Notes on decisions

- **Express + zod**: Express is the most battle-tested option with stable typings; zod gives schema validation for bodies *and* the query string (`status`, `page`, `pageSize` coerced to numbers, `pageSize` capped at 100).
- **405 handling**: Express has no built-in 405, so routes are registered from a single table that also feeds a `RouteRegistry`; the unmatched-request middleware then decides between 405 (with an `Allow` header) and 404.
- **CORS**: the `cors` middleware answers preflight (`OPTIONS`) requests before auth runs, so browsers never need a token for the preflight flight. Origin allow-list comes from `CORS_ORIGIN` (`*`/unset = any origin, comma-separated list otherwise).
- **Auth**: constant-time comparison via `crypto.timingSafeEqual`, with a deliberately ambiguous 401 message.
- **Store seam**: `TaskBoardStore` is entirely async, and `createApp` takes the store as a parameter — a Postgres/Dynamo implementation can be injected in `index.ts` without touching controllers.
- **Graceful shutdown** in `index.ts`, JSON body limit of 1 MB, and `x-powered-by` disabled.

To run: `npm install`, copy `.env.example` to `.env`, then `npm run dev` (or `npm run build && npm start`).