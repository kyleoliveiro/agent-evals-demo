<!-- model: openrouter/openai/gpt-5.6-sol | run: 2 | framework: Fastify -->

Below is a complete Fastify/TypeScript implementation with Zod validation, pluggable storage, authentication, CORS, structured logging, consistent errors, graceful shutdown, and Docker support.

## Project structure

```text
team-task-board-api/
├── src/
│   ├── config.ts
│   ├── errors.ts
│   ├── routes.ts
│   ├── schemas.ts
│   ├── server.ts
│   ├── storage.ts
│   └── types.ts
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── package.json
├── README.md
└── tsconfig.json
```

## `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "Production-ready REST API for a team task board",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "@fastify/cors": "10.0.2",
    "fastify": "5.2.1",
    "zod": "3.24.2"
  },
  "devDependencies": {
    "@types/node": "22.13.10",
    "tsx": "4.19.3",
    "typescript": "5.8.2"
  }
}
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## `.env.example`

```dotenv
API_TOKEN=replace-with-a-long-random-secret
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info

# Optional comma-separated list. Defaults to "*".
# Example:
# CORS_ORIGIN=https://board.example.com,https://admin.example.com
CORS_ORIGIN=*
```

## `.gitignore`

```gitignore
node_modules/
dist/
.env
*.log
.DS_Store
coverage/
```

## `.dockerignore`

```dockerignore
node_modules
dist
.git
.gitignore
.env
*.log
coverage
README.md
```

## `Dockerfile`

```dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp

COPY --from=builder --chown=nodeapp:nodeapp /app/package.json ./package.json
COPY --from=builder --chown=nodeapp:nodeapp /app/node_modules ./node_modules
COPY --from=builder --chown=nodeapp:nodeapp /app/dist ./dist

USER nodeapp

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

## `src/types.ts`

```ts
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
  status: TaskStatus;
  assignee?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}

export interface TaskListOptions {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface PaginatedTasks {
  items: Task[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

## `src/config.ts`

```ts
import { z } from "zod";

const environmentSchema = z.object({
  API_TOKEN: z.string().min(1, "API_TOKEN must not be empty"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGIN: z.string().default("*")
});

export interface AppConfig {
  apiToken: string;
  host: string;
  port: number;
  logLevel:
    | "fatal"
    | "error"
    | "warn"
    | "info"
    | "debug"
    | "trace"
    | "silent";
  corsOrigin: string | string[];
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const originValue = result.data.CORS_ORIGIN.trim();

  const corsOrigin =
    originValue === "*"
      ? "*"
      : originValue
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean);

  return {
    apiToken: result.data.API_TOKEN,
    host: result.data.HOST,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    corsOrigin
  };
}
```

## `src/errors.ts`

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodType } from "zod";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function parseInput<T>(
  schema: ZodType<T>,
  input: unknown,
  target = "request"
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw validationError(result.error, target);
  }

  return result.data;
}

function validationError(error: ZodError, target: string): ApiError {
  const message = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : target;
      return `${path}: ${issue.message}`;
    })
    .join("; ");

  return new ApiError(400, "VALIDATION_ERROR", message);
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
): FastifyReply {
  const body: ErrorResponse = {
    error: {
      code,
      message
    }
  };

  return reply.code(statusCode).send(body);
}

export function registerErrorHandler(
  setErrorHandler: (
    handler: (
      error: Error & {
        statusCode?: number;
        code?: string;
      },
      request: FastifyRequest,
      reply: FastifyReply
    ) => void
  ) => void
): void {
  setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      sendError(reply, error.statusCode, error.code, error.message);
      return;
    }

    if (
      error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
    ) {
      sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Request body must contain valid JSON"
      );
      return;
    }

    request.log.error({ err: error }, "Unexpected request error");

    sendError(
      reply,
      500,
      "INTERNAL_SERVER_ERROR",
      "An unexpected error occurred"
    );
  });
}
```

## `src/schemas.ts`

```ts
import { z } from "zod";
import { TASK_STATUSES } from "./types.js";

const projectIdSchema = z.string().uuid("projectId must be a valid UUID");
const taskIdSchema = z.string().uuid("taskId must be a valid UUID");

const titleSchema = z
  .string()
  .trim()
  .min(1, "title must not be empty")
  .max(500, "title must be at most 500 characters");

const descriptionSchema = z
  .string()
  .max(5000, "description must be at most 5000 characters");

const assigneeSchema = z
  .string()
  .trim()
  .min(1, "assignee must not be empty")
  .max(200, "assignee must be at most 200 characters");

export const projectParamsSchema = z
  .object({
    projectId: projectIdSchema
  })
  .strict();

export const taskParamsSchema = z
  .object({
    projectId: projectIdSchema,
    taskId: taskIdSchema
  })
  .strict();

export const createProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name must not be empty")
      .max(200, "name must be at most 200 characters")
  })
  .strict();

export const listTasksQuerySchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    page: z.coerce
      .number()
      .int("page must be an integer")
      .min(1, "page must be at least 1")
      .default(1),
    pageSize: z.coerce
      .number()
      .int("pageSize must be an integer")
      .min(1, "pageSize must be at least 1")
      .max(100, "pageSize must not exceed 100")
      .default(20)
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.optional(),
    status: z.enum(TASK_STATUSES).default("todo"),
    assignee: assigneeSchema.optional()
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: assigneeSchema.nullable().optional()
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided"
  );
```

## `src/storage.ts`

```ts
import { randomUUID } from "node:crypto";
import type {
  CreateProjectInput,
  CreateTaskInput,
  PaginatedTasks,
  Project,
  Task,
  TaskListOptions,
  UpdateTaskInput
} from "./types.js";

export interface TaskBoardStorage {
  listProjects(): Promise<Project[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(projectId: string): Promise<Project | undefined>;
  deleteProject(projectId: string): Promise<boolean>;

  listTasks(
    projectId: string,
    options: TaskListOptions
  ): Promise<PaginatedTasks>;

  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;

  getTask(projectId: string, taskId: string): Promise<Task | undefined>;

  updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<Task | undefined>;

  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}

function cloneProject(project: Project): Project {
  return { ...project };
}

function cloneTask(task: Task): Task {
  return { ...task };
}

export class InMemoryTaskBoardStorage implements TaskBoardStorage {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  public async listProjects(): Promise<Project[]> {
    return [...this.projects.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(cloneProject);
  }

  public async createProject(
    input: CreateProjectInput
  ): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString()
    };

    this.projects.set(project.id, project);

    return cloneProject(project);
  }

  public async getProject(
    projectId: string
  ): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    return project ? cloneProject(project) : undefined;
  }

  public async deleteProject(projectId: string): Promise<boolean> {
    const deleted = this.projects.delete(projectId);

    if (!deleted) {
      return false;
    }

    for (const [taskId, task] of this.tasks.entries()) {
      if (task.projectId === projectId) {
        this.tasks.delete(taskId);
      }
    }

    return true;
  }

  public async listTasks(
    projectId: string,
    options: TaskListOptions
  ): Promise<PaginatedTasks> {
    let tasks = [...this.tasks.values()].filter(
      (task) => task.projectId === projectId
    );

    if (options.status !== undefined) {
      tasks = tasks.filter((task) => task.status === options.status);
    }

    tasks.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );

    const total = tasks.length;
    const offset = (options.page - 1) * options.pageSize;
    const items = tasks
      .slice(offset, offset + options.pageSize)
      .map(cloneTask);

    return {
      items,
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: Math.ceil(total / options.pageSize)
    };
  }

  public async createTask(
    projectId: string,
    input: CreateTaskInput
  ): Promise<Task> {
    const now = new Date().toISOString();

    const task: Task = {
      id: randomUUID(),
      projectId,
      title: input.title,
      status: input.status,
      createdAt: now,
      updatedAt: now,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.assignee !== undefined
        ? { assignee: input.assignee }
        : {})
    };

    this.tasks.set(task.id, task);

    return cloneTask(task);
  }

  public async getTask(
    projectId: string,
    taskId: string
  ): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);

    if (!task || task.projectId !== projectId) {
      return undefined;
    }

    return cloneTask(task);
  }

  public async updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);

    if (!task || task.projectId !== projectId) {
      return undefined;
    }

    if (input.title !== undefined) {
      task.title = input.title;
    }

    if (input.status !== undefined) {
      task.status = input.status;
    }

    if (input.description === null) {
      delete task.description;
    } else if (input.description !== undefined) {
      task.description = input.description;
    }

    if (input.assignee === null) {
      delete task.assignee;
    } else if (input.assignee !== undefined) {
      task.assignee = input.assignee;
    }

    task.updatedAt = new Date().toISOString();

    return cloneTask(task);
  }

  public async deleteTask(
    projectId: string,
    taskId: string
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);

    if (!task || task.projectId !== projectId) {
      return false;
    }

    return this.tasks.delete(taskId);
  }
}
```

## `src/routes.ts`

```ts
import type { FastifyInstance } from "fastify";
import { ApiError, parseInput } from "./errors.js";
import {
  createProjectSchema,
  createTaskSchema,
  listTasksQuerySchema,
  projectParamsSchema,
  taskParamsSchema,
  updateTaskSchema
} from "./schemas.js";
import type { TaskBoardStorage } from "./storage.js";

export interface RoutesOptions {
  storage: TaskBoardStorage;
}

async function requireProject(
  storage: TaskBoardStorage,
  projectId: string
): Promise<void> {
  const project = await storage.getProject(projectId);

  if (!project) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RoutesOptions
): Promise<void> {
  const { storage } = options;

  app.get("/health", async () => {
    return { ok: true };
  });

  app.get("/projects", async () => {
    return storage.listProjects();
  });

  app.post("/projects", async (request, reply) => {
    const input = parseInput(createProjectSchema, request.body, "body");
    const project = await storage.createProject(input);

    return reply.code(201).send(project);
  });

  app.get("/projects/:projectId", async (request) => {
    const { projectId } = parseInput(
      projectParamsSchema,
      request.params,
      "params"
    );

    const project = await storage.getProject(projectId);

    if (!project) {
      throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }

    return project;
  });

  app.delete("/projects/:projectId", async (request, reply) => {
    const { projectId } = parseInput(
      projectParamsSchema,
      request.params,
      "params"
    );

    const deleted = await storage.deleteProject(projectId);

    if (!deleted) {
      throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }

    return reply.code(204).send();
  });

  app.get("/projects/:projectId/tasks", async (request) => {
    const { projectId } = parseInput(
      projectParamsSchema,
      request.params,
      "params"
    );

    const query = parseInput(
      listTasksQuerySchema,
      request.query,
      "query"
    );

    await requireProject(storage, projectId);

    return storage.listTasks(projectId, query);
  });

  app.post("/projects/:projectId/tasks", async (request, reply) => {
    const { projectId } = parseInput(
      projectParamsSchema,
      request.params,
      "params"
    );

    const input = parseInput(createTaskSchema, request.body, "body");

    await requireProject(storage, projectId);

    const task = await storage.createTask(projectId, input);

    return reply.code(201).send(task);
  });

  app.get(
    "/projects/:projectId/tasks/:taskId",
    async (request) => {
      const { projectId, taskId } = parseInput(
        taskParamsSchema,
        request.params,
        "params"
      );

      await requireProject(storage, projectId);

      const task = await storage.getTask(projectId, taskId);

      if (!task) {
        throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
      }

      return task;
    }
  );

  app.patch(
    "/projects/:projectId/tasks/:taskId",
    async (request) => {
      const { projectId, taskId } = parseInput(
        taskParamsSchema,
        request.params,
        "params"
      );

      const input = parseInput(updateTaskSchema, request.body, "body");

      await requireProject(storage, projectId);

      const task = await storage.updateTask(projectId, taskId, input);

      if (!task) {
        throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
      }

      return task;
    }
  );

  app.delete(
    "/projects/:projectId/tasks/:taskId",
    async (request, reply) => {
      const { projectId, taskId } = parseInput(
        taskParamsSchema,
        request.params,
        "params"
      );

      await requireProject(storage, projectId);

      const deleted = await storage.deleteTask(projectId, taskId);

      if (!deleted) {
        throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
      }

      return reply.code(204).send();
    }
  );
}
```

## `src/server.ts`

```ts
import { timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest
} from "fastify";
import { loadConfig, type AppConfig } from "./config.js";
import {
  registerErrorHandler,
  sendError
} from "./errors.js";
import { registerRoutes } from "./routes.js";
import {
  InMemoryTaskBoardStorage,
  type TaskBoardStorage
} from "./storage.js";

const API_PREFIX = "/api/v1";
const requestStartedAt = Symbol("requestStartedAt");

declare module "fastify" {
  interface FastifyRequest {
    [requestStartedAt]?: number;
  }
}

interface RouteDescription {
  pattern: RegExp;
  methods: readonly string[];
}

const knownRoutes: RouteDescription[] = [
  {
    pattern: /^\/api\/v1\/health$/,
    methods: ["GET"]
  },
  {
    pattern: /^\/api\/v1\/projects$/,
    methods: ["GET", "POST"]
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+$/,
    methods: ["GET", "DELETE"]
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+\/tasks$/,
    methods: ["GET", "POST"]
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+$/,
    methods: ["GET", "PATCH", "DELETE"]
  }
];

function getRequestPath(request: FastifyRequest): string {
  return request.url.split("?", 1)[0] ?? request.url;
}

function isAuthorized(
  authorizationHeader: string | undefined,
  expectedToken: string
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }

  const suppliedToken = authorizationHeader.slice("Bearer ".length);

  if (!suppliedToken) {
    return false;
  }

  const suppliedBuffer = Buffer.from(suppliedToken, "utf8");
  const expectedBuffer = Buffer.from(expectedToken, "utf8");

  if (suppliedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export interface BuildApplicationOptions {
  config?: AppConfig;
  storage?: TaskBoardStorage;
}

export async function buildApplication(
  options: BuildApplicationOptions = {}
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const storage =
    options.storage ?? new InMemoryTaskBoardStorage();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "headers.authorization"
        ],
        censor: "[REDACTED]"
      }
    },
    disableRequestLogging: true,
    exposeHeadRoutes: false
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400
  });

  app.addHook("onRequest", async (request, reply) => {
    request[requestStartedAt] = performance.now();

    const path = getRequestPath(request);

    if (
      request.method === "OPTIONS" ||
      (request.method === "GET" &&
        path === `${API_PREFIX}/health`)
    ) {
      return;
    }

    if (
      !isAuthorized(
        request.headers.authorization,
        config.apiToken
      )
    ) {
      sendError(
        reply,
        401,
        "UNAUTHORIZED",
        "A valid Bearer token is required"
      );
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = request[requestStartedAt];
    const durationMs =
      startedAt === undefined
        ? 0
        : performance.now() - startedAt;

    request.log.info(
      {
        method: request.method,
        path: getRequestPath(request),
        status: reply.statusCode,
        durationMs: Number(durationMs.toFixed(2))
      },
      "Request completed"
    );
  });

  registerErrorHandler(app.setErrorHandler.bind(app));

  await app.register(registerRoutes, {
    prefix: API_PREFIX,
    storage
  });

  app.setNotFoundHandler((request, reply) => {
    const path = getRequestPath(request);
    const matchingRoute = knownRoutes.find((route) =>
      route.pattern.test(path)
    );

    if (
      matchingRoute &&
      !matchingRoute.methods.includes(request.method)
    ) {
      reply.header("Allow", matchingRoute.methods.join(", "));

      sendError(
        reply,
        405,
        "METHOD_NOT_ALLOWED",
        `Method ${request.method} is not allowed for this resource`
      );
      return;
    }

    sendError(
      reply,
      404,
      "NOT_FOUND",
      "The requested resource was not found"
    );
  });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApplication({ config });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down");

    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error({ err: error }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await app.listen({
      host: config.host,
      port: config.port
    });
  } catch (error) {
    app.log.fatal({ err: error }, "Failed to start server");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

## `README.md`

```md
# Team Task Board API

A REST API built with Fastify, TypeScript, and Zod.

## Requirements

- Node.js 20 or later
- An `API_TOKEN` environment variable

## Installation

```bash
npm install
cp .env.example .env
```

This application does not automatically load `.env` files. Export the
variables through your shell, process manager, container environment, or
deployment platform.

For local development:

```bash
export API_TOKEN="replace-with-a-long-random-secret"
npm run dev
```

The server listens on `http://localhost:3000` by default.

## Build and run

```bash
npm run build
API_TOKEN="replace-with-a-long-random-secret" npm start
```

## Docker

```bash
docker build -t team-task-board-api .
docker run --rm \
  -p 3000:3000 \
  -e API_TOKEN="replace-with-a-long-random-secret" \
  team-task-board-api
```

## Authentication

All endpoints except `GET /api/v1/health` require:

```http
Authorization: Bearer replace-with-a-long-random-secret
```

CORS preflight requests do not require authentication.

## Endpoints

- `GET /api/v1/health`
- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/:projectId`
- `DELETE /api/v1/projects/:projectId`
- `GET /api/v1/projects/:projectId/tasks`
- `POST /api/v1/projects/:projectId/tasks`
- `GET /api/v1/projects/:projectId/tasks/:taskId`
- `PATCH /api/v1/projects/:projectId/tasks/:taskId`
- `DELETE /api/v1/projects/:projectId/tasks/:taskId`

## Examples

### Health check

```bash
curl http://localhost:3000/api/v1/health
```

### Create a project

```bash
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer replace-with-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Website launch"}'
```

### Create a task

```bash
curl -X POST \
  http://localhost:3000/api/v1/projects/PROJECT_ID/tasks \
  -H "Authorization: Bearer replace-with-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Prepare release notes",
    "description": "Summarize the changes in version 1.0",
    "status": "todo",
    "assignee": "Alex"
  }'
```

If `status` is omitted when creating a task, it defaults to `todo`.

### List tasks with pagination and filtering

```bash
curl \
  "http://localhost:3000/api/v1/projects/PROJECT_ID/tasks?status=todo&page=1&pageSize=20" \
  -H "Authorization: Bearer replace-with-a-long-random-secret"
```

The response has this shape:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0,
  "totalPages": 0
}
```

The maximum `pageSize` is 100.

### Update a task

```bash
curl -X PATCH \
  http://localhost:3000/api/v1/projects/PROJECT_ID/tasks/TASK_ID \
  -H "Authorization: Bearer replace-with-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

Set `description` or `assignee` to `null` to remove the value:

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
    "code": "PROJECT_NOT_FOUND",
    "message": "Project not found"
  }
}
```

## Storage

Data is kept in memory and is lost when the process restarts.

The routes depend on the `TaskBoardStorage` interface in
`src/storage.ts`. A database-backed implementation can replace
`InMemoryTaskBoardStorage` without changing the HTTP route handlers.
```