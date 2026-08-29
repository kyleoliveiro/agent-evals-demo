<!-- model: openrouter/openai/gpt-5.6-sol | run: 1 | framework: Fastify -->

Below is a complete Fastify-based TypeScript implementation. It uses Zod validation, an interchangeable storage interface, structured logging, bearer-token authentication, CORS, pagination, graceful shutdown, and consistent JSON errors.

## Project structure

```text
team-task-board-api/
├── src/
│   ├── app.ts
│   ├── config.ts
│   ├── errors.ts
│   ├── server.ts
│   ├── types.ts
│   ├── validation.ts
│   └── storage/
│       ├── memory-store.ts
│       └── store.ts
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
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "fastify": "^5.2.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.4",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3"
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
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
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

export interface TaskUpdates {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}
```

## `src/config.ts`

```ts
export interface AppConfig {
  apiToken: string;
  host: string;
  port: number;
  logLevel: string;
  corsOrigin: string | string[];
  bodyLimit: number;
}

function readPositiveInteger(
  name: string,
  defaultValue: number,
  maximum?: number,
): number {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  if (maximum !== undefined && value > maximum) {
    throw new Error(`${name} must not exceed ${maximum}`);
  }

  return value;
}

function readCorsOrigin(): string | string[] {
  const value = process.env.CORS_ORIGIN?.trim();

  if (!value || value === "*") {
    return "*";
  }

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return "*";
  }

  return origins.length === 1 ? origins[0]! : origins;
}

export function loadConfig(): AppConfig {
  const apiToken = process.env.API_TOKEN?.trim();

  if (!apiToken) {
    throw new Error("API_TOKEN environment variable is required");
  }

  return {
    apiToken,
    host: process.env.HOST?.trim() || "0.0.0.0",
    port: readPositiveInteger("PORT", 3000, 65535),
    logLevel: process.env.LOG_LEVEL?.trim() || "info",
    corsOrigin: readCorsOrigin(),
    bodyLimit: readPositiveInteger("BODY_LIMIT", 1_048_576),
  };
}
```

## `src/errors.ts`

```ts
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;

    Error.captureStackTrace(this, AppError);
  }
}

export function errorResponse(
  code: string,
  message: string,
): ErrorResponse {
  return {
    error: {
      code,
      message,
    },
  };
}

export function badRequest(message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message);
}

export function unauthorized(): AppError {
  return new AppError(
    401,
    "UNAUTHORIZED",
    "A valid Bearer token is required",
  );
}

export function notFound(resource: string): AppError {
  return new AppError(404, "NOT_FOUND", `${resource} not found`);
}
```

## `src/validation.ts`

```ts
import { z } from "zod";
import { badRequest } from "./errors.js";
import { TASK_STATUSES } from "./types.js";

const trimmedRequiredString = (field: string, maximum: number) =>
  z
    .string({
      required_error: `${field} is required`,
      invalid_type_error: `${field} must be a string`,
    })
    .trim()
    .min(1, `${field} cannot be empty`)
    .max(maximum, `${field} must not exceed ${maximum} characters`);

const optionalString = (field: string, maximum: number) =>
  z
    .string({
      invalid_type_error: `${field} must be a string`,
    })
    .trim()
    .max(maximum, `${field} must not exceed ${maximum} characters`)
    .optional();

export const createProjectSchema = z
  .object({
    name: trimmedRequiredString("name", 120),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: trimmedRequiredString("title", 200),
    description: optionalString("description", 5_000),
    status: z.enum(TASK_STATUSES).optional().default("todo"),
    assignee: optionalString("assignee", 200),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: trimmedRequiredString("title", 200).optional(),
    description: optionalString("description", 5_000).nullable(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: optionalString("assignee", 200).nullable(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const taskListQuerySchema = z
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
      .default(20),
  })
  .strict();

export function parseInput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const issue = result.error.issues[0];
  const path = issue?.path.join(".");
  const message = issue?.message ?? "Invalid request";

  throw badRequest(path ? `${path}: ${message}` : message);
}
```

## `src/storage/store.ts`

```ts
import type {
  PaginatedTasks,
  Project,
  Task,
  TaskListOptions,
  TaskUpdates,
} from "../types.js";

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status: Task["status"];
  assignee?: string;
}

export interface TaskBoardStore {
  listProjects(): Promise<Project[]>;

  createProject(input: CreateProjectInput): Promise<Project>;

  getProject(projectId: string): Promise<Project | undefined>;

  deleteProject(projectId: string): Promise<boolean>;

  listTasks(
    projectId: string,
    options: TaskListOptions,
  ): Promise<PaginatedTasks>;

  createTask(
    projectId: string,
    input: CreateTaskInput,
  ): Promise<Task>;

  getTask(
    projectId: string,
    taskId: string,
  ): Promise<Task | undefined>;

  updateTask(
    projectId: string,
    taskId: string,
    updates: TaskUpdates,
  ): Promise<Task | undefined>;

  deleteTask(
    projectId: string,
    taskId: string,
  ): Promise<boolean>;
}
```

## `src/storage/memory-store.ts`

```ts
import { randomUUID } from "node:crypto";
import type {
  PaginatedTasks,
  Project,
  Task,
  TaskListOptions,
  TaskUpdates,
} from "../types.js";
import type {
  CreateProjectInput,
  CreateTaskInput,
  TaskBoardStore,
} from "./store.js";

function cloneProject(project: Project): Project {
  return { ...project };
}

function cloneTask(task: Task): Task {
  return { ...task };
}

export class MemoryTaskBoardStore implements TaskBoardStore {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values(), cloneProject);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };

    this.projects.set(project.id, project);

    return cloneProject(project);
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    return project ? cloneProject(project) : undefined;
  }

  async deleteProject(projectId: string): Promise<boolean> {
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

  async listTasks(
    projectId: string,
    options: TaskListOptions,
  ): Promise<PaginatedTasks> {
    const matchingTasks = Array.from(this.tasks.values())
      .filter((task) => {
        if (task.projectId !== projectId) {
          return false;
        }

        return options.status === undefined || task.status === options.status;
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    const total = matchingTasks.length;
    const offset = (options.page - 1) * options.pageSize;

    return {
      items: matchingTasks
        .slice(offset, offset + options.pageSize)
        .map(cloneTask),
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / options.pageSize),
    };
  }

  async createTask(
    projectId: string,
    input: CreateTaskInput,
  ): Promise<Task> {
    const now = new Date().toISOString();

    const task: Task = {
      id: randomUUID(),
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

    this.tasks.set(task.id, task);

    return cloneTask(task);
  }

  async getTask(
    projectId: string,
    taskId: string,
  ): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);

    if (!task || task.projectId !== projectId) {
      return undefined;
    }

    return cloneTask(task);
  }

  async updateTask(
    projectId: string,
    taskId: string,
    updates: TaskUpdates,
  ): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);

    if (!task || task.projectId !== projectId) {
      return undefined;
    }

    if (Object.hasOwn(updates, "title")) {
      task.title = updates.title!;
    }

    if (Object.hasOwn(updates, "status")) {
      task.status = updates.status!;
    }

    if (Object.hasOwn(updates, "description")) {
      if (updates.description === undefined) {
        delete task.description;
      } else {
        task.description = updates.description;
      }
    }

    if (Object.hasOwn(updates, "assignee")) {
      if (updates.assignee === undefined) {
        delete task.assignee;
      } else {
        task.assignee = updates.assignee;
      }
    }

    task.updatedAt = new Date().toISOString();

    return cloneTask(task);
  }

  async deleteTask(
    projectId: string,
    taskId: string,
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);

    if (!task || task.projectId !== projectId) {
      return false;
    }

    return this.tasks.delete(taskId);
  }
}
```

## `src/app.ts`

```ts
import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import type { AppConfig } from "./config.js";
import {
  AppError,
  errorResponse,
  notFound,
  unauthorized,
} from "./errors.js";
import { MemoryTaskBoardStore } from "./storage/memory-store.js";
import type { TaskBoardStore } from "./storage/store.js";
import type { TaskUpdates } from "./types.js";
import {
  createProjectSchema,
  createTaskSchema,
  parseInput,
  taskListQuerySchema,
  updateTaskSchema,
} from "./validation.js";

interface ProjectParams {
  projectId: string;
}

interface TaskParams extends ProjectParams {
  taskId: string;
}

interface BuildAppOptions {
  config: AppConfig;
  store?: TaskBoardStore;
}

const routeDefinitions = [
  {
    pattern: /^\/api\/v1\/health$/,
    methods: ["GET"],
  },
  {
    pattern: /^\/api\/v1\/projects$/,
    methods: ["GET", "POST"],
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+$/,
    methods: ["GET", "DELETE"],
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+\/tasks$/,
    methods: ["GET", "POST"],
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+$/,
    methods: ["GET", "PATCH", "DELETE"],
  },
] as const;

function getRequestPath(request: FastifyRequest): string {
  const path = new URL(request.raw.url ?? "/", "http://localhost").pathname;

  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function authenticate(
  request: FastifyRequest,
  expectedToken: string,
): void {
  const authorization = request.headers.authorization;

  if (!authorization) {
    throw unauthorized();
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!match?.[1] || !tokensMatch(match[1], expectedToken)) {
    throw unauthorized();
  }
}

function normalizeUnexpectedClientError(
  error: Error & { statusCode?: number; code?: string },
): AppError | undefined {
  if (error.statusCode === 400) {
    return new AppError(
      400,
      "VALIDATION_ERROR",
      "The request body or parameters are invalid",
    );
  }

  if (error.statusCode === 413) {
    return new AppError(
      413,
      "PAYLOAD_TOO_LARGE",
      "The request body is too large",
    );
  }

  if (error.statusCode === 415) {
    return new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "The request Content-Type is not supported",
    );
  }

  return undefined;
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const { config } = options;
  const store = options.store ?? new MemoryTaskBoardStore();
  const requestStartedAt = new WeakMap<FastifyRequest, bigint>();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ["req.headers.authorization"],
        censor: "[REDACTED]",
      },
    },
    disableRequestLogging: true,
    bodyLimit: config.bodyLimit,
    requestTimeout: 15_000,
    connectionTimeout: 10_000,
    keepAliveTimeout: 72_000,
    exposeHeadRoutes: false,
    routerOptions: {
      ignoreTrailingSlash: true,
    },
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 86_400,
    strictPreflight: true,
  });

  app.addHook("onRequest", async (request) => {
    requestStartedAt.set(request, process.hrtime.bigint());
  });

  app.addHook("onRequest", async (request) => {
    const path = getRequestPath(request);

    if (request.method === "OPTIONS" || path === "/api/v1/health") {
      return;
    }

    authenticate(request, config.apiToken);
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    const durationMs =
      startedAt === undefined
        ? 0
        : Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    request.log.info(
      {
        method: request.method,
        path: getRequestPath(request),
        status: reply.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
      },
      "request completed",
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(errorResponse(error.code, error.message));
    }

    const clientError = normalizeUnexpectedClientError(error);

    if (clientError) {
      return reply
        .status(clientError.statusCode)
        .send(errorResponse(clientError.code, clientError.message));
    }

    request.log.error({ err: error }, "unexpected request error");

    return reply
      .status(500)
      .send(errorResponse("INTERNAL_ERROR", "An unexpected error occurred"));
  });

  app.setNotFoundHandler((request, reply) => {
    const path = getRequestPath(request);
    const definition = routeDefinitions.find((candidate) =>
      candidate.pattern.test(path),
    );

    if (definition) {
      reply.header("Allow", definition.methods.join(", "));

      return reply
        .status(405)
        .send(
          errorResponse(
            "METHOD_NOT_ALLOWED",
            `Method ${request.method} is not allowed for this resource`,
          ),
        );
    }

    return reply
      .status(404)
      .send(errorResponse("NOT_FOUND", "Route not found"));
  });

  app.get("/api/v1/health", async () => {
    return { ok: true };
  });

  app.get("/api/v1/projects", async () => {
    return store.listProjects();
  });

  app.post("/api/v1/projects", async (request, reply) => {
    const input = parseInput(createProjectSchema, request.body);
    const project = await store.createProject(input);

    return reply.status(201).send(project);
  });

  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:projectId",
    async (request) => {
      const project = await store.getProject(request.params.projectId);

      if (!project) {
        throw notFound("Project");
      }

      return project;
    },
  );

  app.delete<{ Params: ProjectParams }>(
    "/api/v1/projects/:projectId",
    async (request, reply) => {
      const deleted = await store.deleteProject(request.params.projectId);

      if (!deleted) {
        throw notFound("Project");
      }

      return reply.status(204).send();
    },
  );

  app.get<{
    Params: ProjectParams;
    Querystring: {
      status?: string;
      page?: string;
      pageSize?: string;
    };
  }>(
    "/api/v1/projects/:projectId/tasks",
    async (request) => {
      const project = await store.getProject(request.params.projectId);

      if (!project) {
        throw notFound("Project");
      }

      const query = parseInput(taskListQuerySchema, request.query);

      return store.listTasks(request.params.projectId, query);
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/v1/projects/:projectId/tasks",
    async (request, reply) => {
      const project = await store.getProject(request.params.projectId);

      if (!project) {
        throw notFound("Project");
      }

      const input = parseInput(createTaskSchema, request.body);
      const task = await store.createTask(
        request.params.projectId,
        input,
      );

      return reply.status(201).send(task);
    },
  );

  app.get<{ Params: TaskParams }>(
    "/api/v1/projects/:projectId/tasks/:taskId",
    async (request) => {
      const project = await store.getProject(request.params.projectId);

      if (!project) {
        throw notFound("Project");
      }

      const task = await store.getTask(
        request.params.projectId,
        request.params.taskId,
      );

      if (!task) {
        throw notFound("Task");
      }

      return task;
    },
  );

  app.patch<{ Params: TaskParams }>(
    "/api/v1/projects/:projectId/tasks/:taskId",
    async (request) => {
      const project = await store.getProject(request.params.projectId);

      if (!project) {
        throw notFound("Project");
      }

      const input = parseInput(updateTaskSchema, request.body);
      const updates: TaskUpdates = {};

      if ("title" in input) {
        updates.title = input.title;
      }

      if ("status" in input) {
        updates.status = input.status;
      }

      if ("description" in input) {
        updates.description = input.description ?? undefined;
      }

      if ("assignee" in input) {
        updates.assignee = input.assignee ?? undefined;
      }

      const task = await store.updateTask(
        request.params.projectId,
        request.params.taskId,
        updates,
      );

      if (!task) {
        throw notFound("Task");
      }

      return task;
    },
  );

  app.delete<{ Params: TaskParams }>(
    "/api/v1/projects/:projectId/tasks/:taskId",
    async (request, reply) => {
      const project = await store.getProject(request.params.projectId);

      if (!project) {
        throw notFound("Project");
      }

      const deleted = await store.deleteTask(
        request.params.projectId,
        request.params.taskId,
      );

      if (!deleted) {
        throw notFound("Task");
      }

      return reply.status(204).send();
    },
  );

  return app;
}
```

## `src/server.ts`

```ts
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });

  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ signal }, "shutdown requested");

    const forceShutdownTimer = setTimeout(() => {
      app.log.error("graceful shutdown timed out");
      process.exit(1);
    }, 10_000);

    forceShutdownTimer.unref();

    try {
      await app.close();
      clearTimeout(forceShutdownTimer);
      app.log.info("server stopped");
      process.exit(0);
    } catch (error) {
      clearTimeout(forceShutdownTimer);
      app.log.error({ err: error }, "failed to stop server");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.on("unhandledRejection", (error) => {
    app.log.fatal({ err: error }, "unhandled promise rejection");
    void shutdown("SIGTERM");
  });

  process.on("uncaughtException", (error) => {
    app.log.fatal({ err: error }, "uncaught exception");
    void shutdown("SIGTERM");
  });

  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });

    app.log.info(
      {
        host: config.host,
        port: config.port,
      },
      "server listening",
    );
  } catch (error) {
    app.log.fatal({ err: error }, "failed to start server");
    process.exit(1);
  }
}

void main();
```

## `.env.example`

```dotenv
API_TOKEN=replace-with-a-long-random-secret
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info

# Use "*" for all origins, one origin, or a comma-separated list.
CORS_ORIGIN=http://localhost:5173,http://localhost:3001

# Maximum JSON request body size in bytes.
BODY_LIMIT=1048576
```

## `.gitignore`

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
*.log
.DS_Store
.idea/
.vscode/
```

## `.dockerignore`

```dockerignore
node_modules
dist
coverage
.git
.gitignore
.env
.env.*
npm-debug.log*
README.md
```

## `Dockerfile`

```dockerfile
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
```

## `README.md`

````markdown
# Team Task Board API

A TypeScript REST API built with Fastify and Zod.

## Requirements

- Node.js 20 or newer
- An `API_TOKEN` environment variable

## Install and run

```bash
npm install
export API_TOKEN='replace-with-a-long-random-secret'
npm run dev
```

The API listens on `http://localhost:3000` by default.

For a production build:

```bash
npm run build
API_TOKEN='replace-with-a-long-random-secret' npm start
```

## Configuration

| Variable | Required | Default | Description |
|---|---:|---:|---|
| `API_TOKEN` | Yes | — | Bearer token required by protected endpoints |
| `HOST` | No | `0.0.0.0` | Listen address |
| `PORT` | No | `3000` | Listen port |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `CORS_ORIGIN` | No | `*` | Allowed origin or comma-separated origins |
| `BODY_LIMIT` | No | `1048576` | Maximum request body size in bytes |

## Authentication

Every endpoint except the health endpoint requires:

```http
Authorization: Bearer <API_TOKEN>
```

CORS preflight requests do not require authentication.

## Endpoints

All endpoints are under `/api/v1`.

```text
GET    /health
GET    /projects
POST   /projects
GET    /projects/:projectId
DELETE /projects/:projectId
GET    /projects/:projectId/tasks
POST   /projects/:projectId/tasks
GET    /projects/:projectId/tasks/:taskId
PATCH  /projects/:projectId/tasks/:taskId
DELETE /projects/:projectId/tasks/:taskId
```

Task listing supports:

```text
?status=todo&page=1&pageSize=20
```

`pageSize` has a maximum of 100.

The task listing response is:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0,
  "totalPages": 0
}
```

## Examples

Check health:

```bash
curl http://localhost:3000/api/v1/health
```

Create a project:

```bash
curl -X POST http://localhost:3000/api/v1/projects \
  -H 'Authorization: Bearer replace-with-a-long-random-secret' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Platform"}'
```

Create a task:

```bash
curl -X POST http://localhost:3000/api/v1/projects/PROJECT_ID/tasks \
  -H 'Authorization: Bearer replace-with-a-long-random-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Deploy API",
    "description": "Deploy the first production release",
    "status": "todo",
    "assignee": "alex@example.com"
  }'
```

Update a task:

```bash
curl -X PATCH http://localhost:3000/api/v1/projects/PROJECT_ID/tasks/TASK_ID \
  -H 'Authorization: Bearer replace-with-a-long-random-secret' \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'
```

Set `description` or `assignee` to `null` in a PATCH request to remove it:

```json
{
  "description": null,
  "assignee": null
}
```

## Errors

Errors use a consistent shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found"
  }
}
```

Representative codes include:

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `NOT_FOUND`
- `METHOD_NOT_ALLOWED`
- `PAYLOAD_TOO_LARGE`
- `UNSUPPORTED_MEDIA_TYPE`
- `INTERNAL_ERROR`

## Docker

Build:

```bash
docker build -t team-task-board-api .
```

Run:

```bash
docker run --rm \
  -p 3000:3000 \
  -e API_TOKEN='replace-with-a-long-random-secret' \
  team-task-board-api
```

## Storage

Storage is accessed through `TaskBoardStore` in `src/storage/store.ts`. The included implementation is in-memory and can be replaced with a database-backed implementation without changing the HTTP route layer.

Deleting a project also deletes all of its tasks.
````