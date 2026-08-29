<!-- model: openrouter/openai/gpt-5.6-sol | run: 3 | framework: Fastify -->

Below is a complete Fastify + TypeScript implementation with validation, authentication, CORS, structured logging, consistent errors, an interchangeable storage interface, tests, Docker support, and graceful shutdown.

## Project structure

```text
team-task-board-api/
├── src/
│   ├── app.ts
│   ├── config.ts
│   ├── errors.ts
│   ├── schemas.ts
│   ├── server.ts
│   ├── types.ts
│   └── storage/
│       ├── in-memory-store.ts
│       └── store.ts
├── test/
│   └── app.test.ts
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "Production-ready REST API for a team task board",
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "npm run typecheck && npm test"
  },
  "dependencies": {
    "@fastify/cors": "^11.0.0",
    "@fastify/helmet": "^13.0.0",
    "fastify": "^5.2.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.8"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    clearMocks: true
  }
});
```

### `.env.example`

```dotenv
API_TOKEN=replace-with-a-long-random-secret
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info

# Comma-separated browser origins, or "*" to allow all origins.
CORS_ORIGIN=*
```

### `.gitignore`

```gitignore
node_modules/
dist/
coverage/
.env
*.log
.DS_Store
```

### `.dockerignore`

```dockerignore
node_modules
dist
coverage
.git
.gitignore
.env
*.log
README.md
test
```

### `Dockerfile`

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

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist

USER app

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

### `src/types.ts`

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
  status?: TaskStatus;
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

### `src/storage/store.ts`

```ts
import type {
  CreateProjectInput,
  CreateTaskInput,
  PaginatedTasks,
  Project,
  Task,
  TaskListOptions,
  UpdateTaskInput
} from "../types.js";

export interface TaskBoardStore {
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
```

### `src/storage/in-memory-store.ts`

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
} from "../types.js";
import type { TaskBoardStore } from "./store.js";

function cloneProject(project: Project): Project {
  return { ...project };
}

function cloneTask(task: Task): Task {
  return { ...task };
}

export class InMemoryTaskBoardStore implements TaskBoardStore {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(cloneProject);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString()
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
    options: TaskListOptions
  ): Promise<PaginatedTasks> {
    const matchingTasks = Array.from(this.tasks.values())
      .filter((task) => task.projectId === projectId)
      .filter((task) => !options.status || task.status === options.status)
      .sort((a, b) => {
        const createdComparison = a.createdAt.localeCompare(b.createdAt);
        return createdComparison !== 0
          ? createdComparison
          : a.id.localeCompare(b.id);
      });

    const total = matchingTasks.length;
    const offset = (options.page - 1) * options.pageSize;
    const items = matchingTasks
      .slice(offset, offset + options.pageSize)
      .map(cloneTask);

    return {
      items,
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / options.pageSize)
    };
  }

  async createTask(
    projectId: string,
    input: CreateTaskInput
  ): Promise<Task> {
    const now = new Date().toISOString();

    const task: Task = {
      id: randomUUID(),
      projectId,
      title: input.title,
      status: input.status ?? "todo",
      createdAt: now,
      updatedAt: now
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
    taskId: string
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
    input: UpdateTaskInput
  ): Promise<Task | undefined> {
    const existing = this.tasks.get(taskId);

    if (!existing || existing.projectId !== projectId) {
      return undefined;
    }

    if (input.title !== undefined) {
      existing.title = input.title;
    }

    if (input.status !== undefined) {
      existing.status = input.status;
    }

    if (input.description === null) {
      delete existing.description;
    } else if (input.description !== undefined) {
      existing.description = input.description;
    }

    if (input.assignee === null) {
      delete existing.assignee;
    } else if (input.assignee !== undefined) {
      existing.assignee = input.assignee;
    }

    existing.updatedAt = new Date().toISOString();

    this.tasks.set(taskId, existing);
    return cloneTask(existing);
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);

    if (!task || task.projectId !== projectId) {
      return false;
    }

    return this.tasks.delete(taskId);
  }
}
```

### `src/config.ts`

```ts
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_TOKEN: z.string().min(1, "API_TOKEN must not be empty"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGIN: z.string().default("*")
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
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
  corsOrigins: "*" | string[];
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${message}`);
  }

  const corsOrigins =
    result.data.CORS_ORIGIN.trim() === "*"
      ? "*"
      : result.data.CORS_ORIGIN.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean);

  if (corsOrigins !== "*" && corsOrigins.length === 0) {
    throw new Error("CORS_ORIGIN must be '*' or contain at least one origin");
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    apiToken: result.data.API_TOKEN,
    host: result.data.HOST,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    corsOrigins
  };
}
```

### `src/errors.ts`

```ts
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function validationError(message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message);
}

export function unauthorizedError(): AppError {
  return new AppError(
    401,
    "UNAUTHORIZED",
    "A valid Bearer token is required"
  );
}

export function notFoundError(resource: string): AppError {
  return new AppError(404, "NOT_FOUND", `${resource} not found`);
}

export function methodNotAllowedError(): AppError {
  return new AppError(
    405,
    "METHOD_NOT_ALLOWED",
    "Method not allowed for this endpoint"
  );
}
```

### `src/schemas.ts`

```ts
import { z } from "zod";

import { TASK_STATUSES } from "./types.js";

const trimmedNonEmptyString = (fieldName: string, maxLength: number) =>
  z
    .string({
      required_error: `${fieldName} is required`,
      invalid_type_error: `${fieldName} must be a string`
    })
    .trim()
    .min(1, `${fieldName} must not be empty`)
    .max(maxLength, `${fieldName} must be at most ${maxLength} characters`);

const optionalText = (fieldName: string, maxLength: number) =>
  z
    .string({
      invalid_type_error: `${fieldName} must be a string`
    })
    .trim()
    .max(maxLength, `${fieldName} must be at most ${maxLength} characters`);

export const projectParamsSchema = z
  .object({
    projectId: z.string().uuid("projectId must be a valid UUID")
  })
  .strict();

export const taskParamsSchema = z
  .object({
    projectId: z.string().uuid("projectId must be a valid UUID"),
    taskId: z.string().uuid("taskId must be a valid UUID")
  })
  .strict();

export const createProjectSchema = z
  .object({
    name: trimmedNonEmptyString("name", 200)
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: trimmedNonEmptyString("title", 500),
    description: optionalText("description", 5000).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: optionalText("assignee", 200).optional()
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: trimmedNonEmptyString("title", 500).optional(),
    description: optionalText("description", 5000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assignee: optionalText("assignee", 200).nullable().optional()
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one field must be provided"
  });

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
      .max(100, "pageSize must be at most 100")
      .default(20)
  })
  .strict();
```

### `src/app.ts`

```ts
import { timingSafeEqual } from "node:crypto";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest
} from "fastify";
import { type ZodType, ZodError } from "zod";

import type { AppConfig } from "./config.js";
import {
  AppError,
  methodNotAllowedError,
  notFoundError,
  unauthorizedError,
  validationError
} from "./errors.js";
import {
  createProjectSchema,
  createTaskSchema,
  listTasksQuerySchema,
  projectParamsSchema,
  taskParamsSchema,
  updateTaskSchema
} from "./schemas.js";
import type { TaskBoardStore } from "./storage/store.js";

export interface BuildAppOptions {
  config: AppConfig;
  store: TaskBoardStore;
}

interface KnownRoute {
  pattern: RegExp;
  methods: string[];
}

const knownRoutes: KnownRoute[] = [
  {
    pattern: /^\/api\/v1\/health\/?$/,
    methods: ["GET"]
  },
  {
    pattern: /^\/api\/v1\/projects\/?$/,
    methods: ["GET", "POST"]
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+\/?$/,
    methods: ["GET", "DELETE"]
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/?$/,
    methods: ["GET", "POST"]
  },
  {
    pattern: /^\/api\/v1\/projects\/[^/]+\/tasks\/[^/]+\/?$/,
    methods: ["GET", "PATCH", "DELETE"]
  }
];

function parseWithSchema<T>(schema: ZodType<T>, value: unknown): T {
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

  throw validationError(message);
}

function pathnameOf(request: FastifyRequest): string {
  try {
    return new URL(request.raw.url ?? "/", "http://localhost").pathname;
  } catch {
    return request.raw.url?.split("?")[0] ?? "/";
  }
}

function tokensMatch(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function buildApp(
  options: BuildAppOptions
): Promise<FastifyInstance> {
  const { config, store } = options;

  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: ["req.headers.authorization"],
              censor: "[REDACTED]"
            }
          },
    ignoreTrailingSlash: true,
    exposeHeadRoutes: false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 30_000,
    connectionTimeout: 10_000
  });

  await app.register(helmet);

  await app.register(cors, {
    origin:
      config.corsOrigins === "*"
        ? true
        : (origin, callback) => {
            if (!origin || config.corsOrigins.includes(origin)) {
              callback(null, true);
              return;
            }

            callback(null, false);
          },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 86_400
  });

  app.addHook("onRequest", async (request) => {
    const pathname = pathnameOf(request);

    if (
      request.method === "OPTIONS" ||
      pathname === "/api/v1/health" ||
      pathname === "/api/v1/health/"
    ) {
      return;
    }

    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer[ \t]+(.+)$/i);

    if (!match?.[1] || !tokensMatch(match[1], config.apiToken)) {
      throw unauthorizedError();
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        path: pathnameOf(request),
        status: reply.statusCode,
        durationMs: Number(request.elapsedTime.toFixed(3))
      },
      "request completed"
    );
  });

  app.get("/api/v1/health", async () => {
    return { ok: true };
  });

  app.get("/api/v1/projects", async () => {
    return store.listProjects();
  });

  app.post("/api/v1/projects", async (request, reply) => {
    const input = parseWithSchema(createProjectSchema, request.body);
    const project = await store.createProject(input);

    return reply.code(201).send(project);
  });

  app.get("/api/v1/projects/:projectId", async (request) => {
    const { projectId } = parseWithSchema(
      projectParamsSchema,
      request.params
    );

    const project = await store.getProject(projectId);

    if (!project) {
      throw notFoundError("Project");
    }

    return project;
  });

  app.delete("/api/v1/projects/:projectId", async (request, reply) => {
    const { projectId } = parseWithSchema(
      projectParamsSchema,
      request.params
    );

    const deleted = await store.deleteProject(projectId);

    if (!deleted) {
      throw notFoundError("Project");
    }

    return reply.code(204).send();
  });

  app.get("/api/v1/projects/:projectId/tasks", async (request) => {
    const { projectId } = parseWithSchema(
      projectParamsSchema,
      request.params
    );
    const query = parseWithSchema(listTasksQuerySchema, request.query);

    const project = await store.getProject(projectId);

    if (!project) {
      throw notFoundError("Project");
    }

    return store.listTasks(projectId, query);
  });

  app.post(
    "/api/v1/projects/:projectId/tasks",
    async (request, reply) => {
      const { projectId } = parseWithSchema(
        projectParamsSchema,
        request.params
      );
      const input = parseWithSchema(createTaskSchema, request.body);

      const project = await store.getProject(projectId);

      if (!project) {
        throw notFoundError("Project");
      }

      const task = await store.createTask(projectId, input);
      return reply.code(201).send(task);
    }
  );

  app.get(
    "/api/v1/projects/:projectId/tasks/:taskId",
    async (request) => {
      const { projectId, taskId } = parseWithSchema(
        taskParamsSchema,
        request.params
      );

      const project = await store.getProject(projectId);

      if (!project) {
        throw notFoundError("Project");
      }

      const task = await store.getTask(projectId, taskId);

      if (!task) {
        throw notFoundError("Task");
      }

      return task;
    }
  );

  app.patch(
    "/api/v1/projects/:projectId/tasks/:taskId",
    async (request) => {
      const { projectId, taskId } = parseWithSchema(
        taskParamsSchema,
        request.params
      );
      const input = parseWithSchema(updateTaskSchema, request.body);

      const project = await store.getProject(projectId);

      if (!project) {
        throw notFoundError("Project");
      }

      const task = await store.updateTask(projectId, taskId, input);

      if (!task) {
        throw notFoundError("Task");
      }

      return task;
    }
  );

  app.delete(
    "/api/v1/projects/:projectId/tasks/:taskId",
    async (request, reply) => {
      const { projectId, taskId } = parseWithSchema(
        taskParamsSchema,
        request.params
      );

      const project = await store.getProject(projectId);

      if (!project) {
        throw notFoundError("Project");
      }

      const deleted = await store.deleteTask(projectId, taskId);

      if (!deleted) {
        throw notFoundError("Task");
      }

      return reply.code(204).send();
    }
  );

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = pathnameOf(request);
    const knownRoute = knownRoutes.find((route) =>
      route.pattern.test(pathname)
    );

    if (knownRoute && !knownRoute.methods.includes(request.method)) {
      reply.header("Allow", knownRoute.methods.join(", "));
      throw methodNotAllowedError();
    }

    throw new AppError(404, "NOT_FOUND", "Route not found");
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (reply.sent) {
      return;
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues.map((issue) => issue.message).join("; ")
        }
      });
    }

    const fastifyError = error as {
      statusCode?: number;
      code?: string;
      message?: string;
    };

    if (fastifyError.statusCode === 400) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: fastifyError.message ?? "Invalid request"
        }
      });
    }

    if (
      fastifyError.statusCode &&
      fastifyError.statusCode >= 400 &&
      fastifyError.statusCode < 500
    ) {
      return reply.code(fastifyError.statusCode).send({
        error: {
          code: fastifyError.code ?? "HTTP_ERROR",
          message: fastifyError.message ?? "Request could not be processed"
        }
      });
    }

    request.log.error({ err: error }, "unexpected request error");

    return reply.code(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred"
      }
    });
  });

  return app;
}
```

### `src/server.ts`

```ts
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { InMemoryTaskBoardStore } from "./storage/in-memory-store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new InMemoryTaskBoardStore();
  const app = await buildApp({ config, store });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
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
    app.log.error({ err: error }, "unhandled promise rejection");
    void shutdown("unhandledRejection");
  });

  process.on("uncaughtException", (error) => {
    app.log.fatal({ err: error }, "uncaught exception");
    void shutdown("uncaughtException");
  });

  await app.listen({
    host: config.host,
    port: config.port
  });
}

main().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
```

### `test/app.test.ts`

```ts
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { InMemoryTaskBoardStore } from "../src/storage/in-memory-store.js";

const TOKEN = "test-api-token";

const config: AppConfig = {
  nodeEnv: "test",
  apiToken: TOKEN,
  host: "127.0.0.1",
  port: 3000,
  logLevel: "silent",
  corsOrigins: "*"
};

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${TOKEN}`
  };
}

describe("team task board API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      config,
      store: new InMemoryTaskBoardStore()
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns public health status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("requires authorization for protected routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/projects"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "A valid Bearer token is required"
      }
    });
  });

  it("creates, reads, and deletes a project", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders(),
      payload: {
        name: "Platform"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const project = createResponse.json<{
      id: string;
      name: string;
      createdAt: string;
    }>();

    expect(project.name).toBe("Platform");

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders()
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual(project);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders()
    });

    expect(deleteResponse.statusCode).toBe(204);

    const missingResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders()
    });

    expect(missingResponse.statusCode).toBe(404);
  });

  it("validates project bodies", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders(),
      payload: {
        name: ""
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR"
      }
    });
  });

  it("supports task creation, filtering, pagination, and updates", async () => {
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders(),
      payload: {
        name: "Backend"
      }
    });

    const projectId = projectResponse.json<{ id: string }>().id;

    const firstTaskResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: authHeaders(),
      payload: {
        title: "Design API",
        status: "todo",
        assignee: "Alice"
      }
    });

    expect(firstTaskResponse.statusCode).toBe(201);
    const firstTask = firstTaskResponse.json<{ id: string }>();

    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: authHeaders(),
      payload: {
        title: "Deploy API",
        status: "done"
      }
    });

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/tasks?status=todo&page=1&pageSize=10`,
      headers: authHeaders()
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: firstTask.id,
          title: "Design API",
          status: "todo"
        }
      ]
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}/tasks/${firstTask.id}`,
      headers: authHeaders(),
      payload: {
        status: "in_progress",
        assignee: null
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: firstTask.id,
      status: "in_progress"
    });
    expect(updateResponse.json()).not.toHaveProperty("assignee");
  });

  it("deleting a project also deletes its tasks", async () => {
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders(),
      payload: {
        name: "Temporary"
      }
    });

    const projectId = projectResponse.json<{ id: string }>().id;

    const taskResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: authHeaders(),
      payload: {
        title: "Temporary task"
      }
    });

    const taskId = taskResponse.json<{ id: string }>().id;

    await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${projectId}`,
      headers: authHeaders()
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/tasks/${taskId}`,
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
  });

  it("returns 405 for unsupported methods on known routes", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/projects",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("GET, POST");
    expect(response.json()).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed for this endpoint"
      }
    });
  });

  it("returns a consistent 404 for unknown routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/unknown",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found"
      }
    });
  });

  it("supports unauthenticated CORS preflight requests", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/projects",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://example.com"
    );
  });
});
```

### `README.md`

```md
# Team Task Board API

A REST API built with Fastify, TypeScript, and Zod.

## Requirements

- Node.js 20 or newer
- npm

## Setup

```bash
cp .env.example .env
npm install
```

Export the environment variables before starting the server:

```bash
export API_TOKEN="replace-with-a-long-random-secret"
export PORT=3000
export HOST=0.0.0.0
export CORS_ORIGIN="*"
```

For a restricted browser-origin list:

```bash
export CORS_ORIGIN="https://app.example.com,https://admin.example.com"
```

## Development

```bash
npm run dev
```

## Build and run

```bash
npm run build
npm start
```

## Test

```bash
npm test
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

All endpoints except the health endpoint require:

```http
Authorization: Bearer <API_TOKEN>
```

CORS preflight requests do not require authentication.

## Endpoints

All endpoints use the `/api/v1` prefix.

| Method | Path |
|---|---|
| GET | `/health` |
| GET | `/projects` |
| POST | `/projects` |
| GET | `/projects/:projectId` |
| DELETE | `/projects/:projectId` |
| GET | `/projects/:projectId/tasks` |
| POST | `/projects/:projectId/tasks` |
| GET | `/projects/:projectId/tasks/:taskId` |
| PATCH | `/projects/:projectId/tasks/:taskId` |
| DELETE | `/projects/:projectId/tasks/:taskId` |

Task list query parameters:

- `status`: `todo`, `in_progress`, or `done`
- `page`: positive integer, default `1`
- `pageSize`: integer from `1` to `100`, default `20`

Task list responses use this shape:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0,
  "totalPages": 0
}
```

To clear a task's optional `description` or `assignee`, send `null` in a
PATCH request.

## Examples

Create a project:

```bash
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer replace-with-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Platform"}'
```

Create a task:

```bash
curl -X POST http://localhost:3000/api/v1/projects/PROJECT_ID/tasks \
  -H "Authorization: Bearer replace-with-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Deploy the API",
    "description":"Deploy the production image",
    "status":"todo",
    "assignee":"Alice"
  }'
```

Update a task:

```bash
curl -X PATCH \
  http://localhost:3000/api/v1/projects/PROJECT_ID/tasks/TASK_ID \
  -H "Authorization: Bearer replace-with-a-long-random-secret" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

## Error format

Errors use a consistent JSON structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title must not be empty"
  }
}
```

## Storage

Storage is accessed through `TaskBoardStore` in `src/storage/store.ts`.
`InMemoryTaskBoardStore` can be replaced with a database-backed
implementation without changing the HTTP routes.
```