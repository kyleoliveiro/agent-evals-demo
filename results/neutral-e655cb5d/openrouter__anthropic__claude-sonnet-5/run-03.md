<!-- model: openrouter/anthropic/claude-sonnet-5 | run: 3 | framework: Express -->

# Team Task Board API

A production-ready REST API built with **TypeScript**, **Express**, and **Zod** for validation. In-memory storage is abstracted behind a repository interface so it can be swapped for a real database later.

## Project Structure

```
team-task-board-api/
├── src/
│   ├── config/
│   │   └── env.ts
│   ├── errors/
│   │   └── AppError.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── requestLogger.ts
│   │   ├── errorHandler.ts
│   │   └── notFound.ts
│   ├── store/
│   │   ├── types.ts
│   │   └── memoryStore.ts
│   ├── validation/
│   │   ├── project.schemas.ts
│   │   └── task.schemas.ts
│   ├── routes/
│   │   ├── health.routes.ts
│   │   ├── project.routes.ts
│   │   └── task.routes.ts
│   ├── controllers/
│   │   ├── project.controller.ts
│   │   └── task.controller.ts
│   ├── utils/
│   │   ├── asyncHandler.ts
│   │   └── pagination.ts
│   ├── app.ts
│   └── server.ts
├── test/
│   └── api.test.ts
├── .env.example
├── .eslintrc.cjs
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## package.json

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board",
  "main": "dist/server.js",
  "type": "commonjs",
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "lint": "eslint \"src/**/*.ts\"",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "uuid": "^9.0.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "@types/supertest": "^6.0.2",
    "@types/uuid": "^9.0.8",
    "@typescript-eslint/eslint-plugin": "^7.16.0",
    "@typescript-eslint/parser": "^7.16.0",
    "eslint": "^8.57.0",
    "supertest": "^7.0.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.5.3",
    "vitest": "^1.6.0"
  }
}
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "lib": ["ES2021"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

## .env.example

```
PORT=3000
API_TOKEN=change-me-super-secret-token
NODE_ENV=development
CORS_ORIGIN=*
```

## .gitignore

```
node_modules
dist
.env
coverage
*.log
```

## .eslintrc.cjs

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  env: {
    node: true,
    es2021: true
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn'
  }
};
```

## src/config/env.ts

```ts
import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  apiToken: requireEnv('API_TOKEN', process.env.NODE_ENV === 'test' ? 'test-token' : undefined),
  corsOrigin: process.env.CORS_ORIGIN ?? '*'
};
```

## src/errors/AppError.ts

```ts
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

/**
 * Standard application error carrying an HTTP status and a machine-readable code.
 * Thrown anywhere in the request lifecycle and caught by the central error handler.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(401, 'UNAUTHORIZED', message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static methodNotAllowed(message = 'Method not allowed'): AppError {
    return new AppError(405, 'METHOD_NOT_ALLOWED', message);
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}
```

## src/store/types.ts

```ts
export type TaskStatus = 'todo' | 'in_progress' | 'done';

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
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Storage abstraction so the in-memory implementation can be swapped
 * for a real database (Postgres, Mongo, etc.) without touching controllers.
 */
export interface DataStore {
  // Projects
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | undefined>;
  deleteProject(projectId: string): Promise<boolean>;

  // Tasks
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  listTasks(projectId: string, filter: TaskFilter): Promise<PagedResult<Task>>;
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task | undefined>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

## src/store/memoryStore.ts

```ts
import { v4 as uuidv4 } from 'uuid';
import {
  DataStore,
  Project,
  Task,
  CreateProjectInput,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  PagedResult
} from './types';

/**
 * Simple in-memory implementation of DataStore.
 * Not suitable for multi-process deployments, but keeps the
 * same interface a real database-backed store would implement.
 */
export class MemoryStore implements DataStore {
  private projects: Map<string, Project> = new Map();
  private tasks: Map<string, Task> = new Map();

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: uuidv4(),
      name: input.name,
      createdAt: new Date().toISOString()
    };
    this.projects.set(project.id, project);
    return project;
  }

  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.projects.get(projectId);
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const existed = this.projects.delete(projectId);
    if (existed) {
      for (const [taskId, task] of this.tasks.entries()) {
        if (task.projectId === projectId) {
          this.tasks.delete(taskId);
        }
      }
    }
    return existed;
  }

  async createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      projectId,
      title: input.title,
      description: input.description,
      status: input.status ?? 'todo',
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async listTasks(projectId: string, filter: TaskFilter): Promise<PagedResult<Task>> {
    let items = Array.from(this.tasks.values()).filter((t) => t.projectId === projectId);

    if (filter.status) {
      items = items.filter((t) => t.status === filter.status);
    }

    items = items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / filter.pageSize));
    const start = (filter.page - 1) * filter.pageSize;
    const paged = items.slice(start, start + filter.pageSize);

    return {
      items: paged,
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      totalPages
    };
  }

  async getTask(projectId: string, taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) return undefined;
    return task;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<Task | undefined> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return undefined;

    const updated: Task = {
      ...existing,
      ...('title' in input ? { title: input.title as string } : {}),
      ...('description' in input ? { description: input.description } : {}),
      ...('status' in input ? { status: input.status as Task['status'] } : {}),
      ...('assignee' in input ? { assignee: input.assignee } : {}),
      updatedAt: new Date().toISOString()
    };

    this.tasks.set(taskId, updated);
    return updated;
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;
    return this.tasks.delete(taskId);
  }
}
```

## src/validation/project.schemas.ts

```ts
import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200, 'name is too long')
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
```

## src/validation/task.schemas.ts

```ts
import { z } from 'zod';

export const taskStatusEnum = z.enum(['todo', 'in_progress', 'done']);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(300, 'title is too long'),
  description: z.string().trim().max(5000).optional(),
  status: taskStatusEnum.optional(),
  assignee: z.string().trim().max(200).optional()
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).optional(),
    status: taskStatusEnum.optional(),
    assignee: z.string().trim().max(200).optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided'
  });

export const listTasksQuerySchema = z.object({
  status: taskStatusEnum.optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .pipe(z.number().int().min(1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100))
});

export type CreateTaskDto = z.infer<typeof createTaskSchema>;
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;
```

## src/utils/asyncHandler.ts

```ts
import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler so rejected promises are forwarded
 * to Express's error handling middleware instead of crashing the process.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
```

## src/utils/pagination.ts

```ts
import { PagedResult } from '../store/types';

export function toPaginationMeta<T>(result: PagedResult<T>) {
  return {
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages
  };
}
```

## src/middleware/auth.ts

```ts
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { env } from '../config/env';

/**
 * Requires `Authorization: Bearer <token>` matching API_TOKEN.
 * /health is mounted before this middleware and is therefore exempt.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('Authorization');

  if (!header || !header.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }

  const token = header.slice('Bearer '.length).trim();

  if (!token || token !== env.apiToken) {
    return next(AppError.unauthorized('Invalid API token'));
  }

  next();
}
```

## src/middleware/requestLogger.ts

```ts
import { Request, Response, NextFunction } from 'express';

/**
 * Logs method, path, status code, and duration (ms) for every request.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(2)}ms`;
    // eslint-disable-next-line no-console
    console.log(line);
  });

  next();
}
```

## src/middleware/notFound.ts

```ts
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';

/**
 * Catches any request that didn't match a route and turns it into
 * a consistent 404 JSON error.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}
```

## src/middleware/errorHandler.ts

```ts
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { env } from '../config/env';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Central error-handling middleware. Must be registered last.
 * Normalizes all thrown errors (AppError, Zod validation errors,
 * or anything unexpected) into a consistent JSON shape.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const body: ErrorResponseBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {})
      }
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      error: {
        code: 'BAD_REQUEST',
        message: 'Validation failed',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      }
    };
    res.status(400).json(body);
    return;
  }

  // Unexpected error
  // eslint-disable-next-line no-console
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);

  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message:
        env.nodeEnv === 'production'
          ? 'Internal server error'
          : err instanceof Error
            ? err.message
            : 'Internal server error'
    }
  };
  res.status(500).json(body);
}
```

## src/controllers/project.controller.ts

```ts
import { Request, Response } from 'express';
import { DataStore } from '../store/types';
import { AppError } from '../errors/AppError';
import { createProjectSchema } from '../validation/project.schemas';

export class ProjectController {
  constructor(private readonly store: DataStore) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    const projects = await this.store.listProjects();
    res.status(200).json({ data: projects });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const parsed = createProjectSchema.parse(req.body);
    const project = await this.store.createProject(parsed);
    res.status(201).json({ data: project });
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const project = await this.store.getProject(projectId);
    if (!project) {
      throw AppError.notFound(`Project ${projectId} not found`);
    }
    res.status(200).json({ data: project });
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const existing = await this.store.getProject(projectId);
    if (!existing) {
      throw AppError.notFound(`Project ${projectId} not found`);
    }
    await this.store.deleteProject(projectId);
    res.status(204).send();
  };
}
```

## src/controllers/task.controller.ts

```ts
import { Request, Response } from 'express';
import { DataStore } from '../store/types';
import { AppError } from '../errors/AppError';
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema
} from '../validation/task.schemas';
import { toPaginationMeta } from '../utils/pagination';

export class TaskController {
  constructor(private readonly store: DataStore) {}

  private async ensureProject(projectId: string): Promise<void> {
    const project = await this.store.getProject(projectId);
    if (!project) {
      throw AppError.notFound(`Project ${projectId} not found`);
    }
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    await this.ensureProject(projectId);

    const query = listTasksQuerySchema.parse(req.query);
    const result = await this.store.listTasks(projectId, {
      status: query.status,
      page: query.page,
      pageSize: query.pageSize
    });

    res.status(200).json({
      data: result.items,
      meta: toPaginationMeta(result)
    });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    await this.ensureProject(projectId);

    const parsed = createTaskSchema.parse(req.body);
    const task = await this.store.createTask(projectId, parsed);
    res.status(201).json({ data: task });
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { projectId, taskId } = req.params;
    await this.ensureProject(projectId);

    const task = await this.store.getTask(projectId, taskId);
    if (!task) {
      throw AppError.notFound(`Task ${taskId} not found in project ${projectId}`);
    }
    res.status(200).json({ data: task });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { projectId, taskId } = req.params;
    await this.ensureProject(projectId);

    const parsed = updateTaskSchema.parse(req.body);
    const updated = await this.store.updateTask(projectId, taskId, parsed);
    if (!updated) {
      throw AppError.notFound(`Task ${taskId} not found in project ${projectId}`);
    }
    res.status(200).json({ data: updated });
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { projectId, taskId } = req.params;
    await this.ensureProject(projectId);

    const existing = await this.store.getTask(projectId, taskId);
    if (!existing) {
      throw AppError.notFound(`Task ${taskId} not found in project ${projectId}`);
    }
    await this.store.deleteTask(projectId, taskId);
    res.status(204).send();
  };
}
```

## src/routes/health.routes.ts

```ts
import { Router } from 'express';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return router;
}
```

## src/routes/project.routes.ts

```ts
import { Router } from 'express';
import { DataStore } from '../store/types';
import { ProjectController } from '../controllers/project.controller';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../errors/AppError';
import { taskRoutes } from './task.routes';

export function projectRoutes(store: DataStore): Router {
  const router = Router();
  const controller = new ProjectController(store);

  router
    .route('/')
    .get(asyncHandler(controller.list))
    .post(asyncHandler(controller.create))
    .all(() => {
      throw AppError.methodNotAllowed();
    });

  router
    .route('/:projectId')
    .get(asyncHandler(controller.getOne))
    .delete(asyncHandler(controller.remove))
    .all(() => {
      throw AppError.methodNotAllowed();
    });

  router.use('/:projectId/tasks', taskRoutes(store));

  return router;
}
```

## src/routes/task.routes.ts

```ts
import { Router } from 'express';
import { DataStore } from '../store/types';
import { TaskController } from '../controllers/task.controller';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../errors/AppError';

export function taskRoutes(store: DataStore): Router {
  const router = Router({ mergeParams: true });
  const controller = new TaskController(store);

  router
    .route('/')
    .get(asyncHandler(controller.list))
    .post(asyncHandler(controller.create))
    .all(() => {
      throw AppError.methodNotAllowed();
    });

  router
    .route('/:taskId')
    .get(asyncHandler(controller.getOne))
    .patch(asyncHandler(controller.update))
    .delete(asyncHandler(controller.remove))
    .all(() => {
      throw AppError.methodNotAllowed();
    });

  return router;
}
```

## src/app.ts

```ts
import express, { Express } from 'express';
import cors from 'cors';
import { DataStore } from './store/types';
import { authMiddleware } from './middleware/auth';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';
import { healthRoutes } from './routes/health.routes';
import { projectRoutes } from './routes/project.routes';
import { env } from './config/env';

export function createApp(store: DataStore): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','),
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      preflightContinue: false,
      optionsSuccessStatus: 204
    })
  );
  app.use(requestLogger);

  const v1 = express.Router();

  // /health is public and mounted before auth middleware.
  v1.use(healthRoutes());

  // Everything else under /api/v1 requires a valid bearer token.
  v1.use(authMiddleware);
  v1.use('/projects', projectRoutes(store));

  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
```

## src/server.ts

```ts
import { createApp } from './app';
import { MemoryStore } from './store/memoryStore';
import { env } from './config/env';

const store = new MemoryStore();
const app = createApp(store);

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Team Task Board API listening on port ${env.port} [${env.nodeEnv}]`);
});
```

## test/api.test.ts

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store/memoryStore';

process.env.API_TOKEN = 'test-token';
const AUTH = { Authorization: 'Bearer test-token' };

function buildApp() {
  return createApp(new MemoryStore());
}

describe('health', () => {
  it('does not require auth', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('auth', () => {
  it('rejects requests without a token', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with a bad token', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });
});

describe('projects', () => {
  it('creates and lists projects', async () => {
    const app = buildApp();
    const createRes = await request(app)
      .post('/api/v1/projects')
      .set(AUTH)
      .send({ name: 'Apollo' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe('Apollo');

    const listRes = await request(app).get('/api/v1/projects').set(AUTH);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
  });

  it('validates project creation', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/v1/projects').set(AUTH).send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('404s for missing project', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/projects/does-not-exist').set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('deletes a project and its tasks', async () => {
    const app = buildApp();
    const project = (
      await request(app).post('/api/v1/projects').set(AUTH).send({ name: 'To Delete' })
    ).body.data;

    await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set(AUTH)
      .send({ title: 'Task 1' });

    const delRes = await request(app).delete(`/api/v1/projects/${project.id}`).set(AUTH);
    expect(delRes.status).toBe(204);

    const getRes = await request(app).get(`/api/v1/projects/${project.id}`).set(AUTH);
    expect(getRes.status).toBe(404);
  });
});

describe('tasks', () => {
  async function createProject(app: import('express').Express) {
    const res = await request(app).post('/api/v1/projects').set(AUTH).send({ name: 'Board' });
    return res.body.data;
  }

  it('creates, filters, and paginates tasks', async () => {
    const app = buildApp();
    const project = await createProject(app);

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/v1/projects/${project.id}/tasks`)
        .set(AUTH)
        .send({ title: `Task ${i}`, status: i % 2 === 0 ? 'todo' : 'done' });
    }

    const filtered = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks?status=done`)
      .set(AUTH);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(2);

    const paged = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks?page=1&pageSize=2`)
      .set(AUTH);
    expect(paged.body.data).toHaveLength(2);
    expect(paged.body.meta.total).toBe(5);
    expect(paged.body.meta.totalPages).toBe(3);
  });

  it('updates a task partially', async () => {
    const app = buildApp();
    const project = await createProject(app);
    const task = (
      await request(app)
        .post(`/api/v1/projects/${project.id}/tasks`)
        .set(AUTH)
        .send({ title: 'Fix bug' })
    ).body.data;

    const patchRes = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set(AUTH)
      .send({ status: 'in_progress', assignee: 'alice' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.status).toBe('in_progress');
    expect(patchRes.body.data.assignee).toBe('alice');
    expect(patchRes.body.data.title).toBe('Fix bug');
  });

  it('rejects empty patch body', async () => {
    const app = buildApp();
    const project = await createProject(app);
    const task = (
      await request(app)
        .post(`/api/v1/projects/${project.id}/tasks`)
        .set(AUTH)
        .send({ title: 'Fix bug' })
    ).body.data;

    const res = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
  });

  it('deletes a task', async () => {
    const app = buildApp();
    const project = await createProject(app);
    const task = (
      await request(app)
        .post(`/api/v1/projects/${project.id}/tasks`)
        .set(AUTH)
        .send({ title: 'Temp' })
    ).body.data;

    const delRes = await request(app)
      .delete(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set(AUTH);
    expect(delRes.status).toBe(204);

    const getRes = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set(AUTH);
    expect(getRes.status).toBe(404);
  });
});

describe('unknown routes', () => {
  it('returns consistent 404 shape', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/nope').set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
```

## README.md

```markdown
# Team Task Board API

A production-ready REST API for managing projects and tasks, built with
Node.js, TypeScript, Express, and Zod.

## Features

- Projects and tasks with an in-memory store hidden behind a `DataStore`
  interface (`src/store/types.ts`) — swap in Postgres/Mongo/etc. later
  without touching controllers or routes.
- Bearer-token auth on every route except `/api/v1/health`.
- CORS enabled, including preflight `OPTIONS` handling.
- Request logging: method, path, status code, duration.
- Consistent JSON error shape: `{ "error": { "code", "message" } }` for
  400 / 401 / 404 / 405 / 500, including unmatched routes.
- Zod-based request validation for bodies and query params.
- Pagination and status filtering on the tasks list endpoint.
- Unit/integration tests with Vitest + Supertest.

## Getting started

```bash
cp .env.example .env
# edit .env and set a real API_TOKEN
npm install
npm run dev
```

The server starts on `http://localhost:3000` by default.

## Build & run in production

```bash
npm run build
npm start
```

## Testing

```bash
npm test
```

## Environment variables

| Name         | Description                              | Default      |
|--------------|-------------------------------------------|--------------|
| PORT         | HTTP port to listen on                    | 3000         |
| API_TOKEN    | Required bearer token for all API routes  | *(required)* |
| NODE_ENV     | `development` \| `production` \| `test`   | development  |
| CORS_ORIGIN  | Allowed origin(s), comma-separated, or `*`| `*`          |

## API overview

All routes are prefixed with `/api/v1`. All routes except `/health` require:

```
Authorization: Bearer <API_TOKEN>
```

### Health

```
GET /api/v1/health
-> 200 { "ok": true }
```

### Projects

```
GET    /api/v1/projects                 List all projects
POST   /api/v1/projects                 Create a project { "name": string }
GET    /api/v1/projects/:projectId      Get a project
DELETE /api/v1/projects/:projectId      Delete a project (and its tasks)
```

### Tasks

```
GET    /api/v1/projects/:projectId/tasks
       ?status=todo|in_progress|done&page=1&pageSize=20

POST   /api/v1/projects/:projectId/tasks
       { "title": string, "description"?: string,
         "status"?: "todo"|"in_progress"|"done", "assignee"?: string }

GET    /api/v1/projects/:projectId/tasks/:taskId

PATCH  /api/v1/projects/:projectId/tasks/:taskId
       { "title"?, "description"?, "status"?, "assignee"? } (at least one field)

DELETE /api/v1/projects/:projectId/tasks/:taskId
```

### Error shape

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Task abc123 not found in project xyz789"
  }
}
```

Codes used: `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404),
`METHOD_NOT_ALLOWED` (405), `INTERNAL_ERROR` (500).

## Design notes

- **Storage abstraction**: `DataStore` in `src/store/types.ts` defines the
  contract; `MemoryStore` is the only implementation today. A future
  `PostgresStore` or `MongoStore` could implement the same interface and be
  swapped in `src/server.ts` with no other code changes.
- **Validation**: Zod schemas in `src/validation/*` validate bodies and
  query params before they reach store operations; failures throw
  `ZodError`, caught centrally and converted to `400 BAD_REQUEST`.
- **Errors**: `AppError` is the single error type controllers throw for
  expected failure modes (404, 401, 405, 400). Anything else bubbles up as
  a generic 500, with stack traces logged server-side but not leaked to
  clients in production.
- **Auth**: Simple static bearer-token check suitable for
  service-to-service or internal tools. Swap `authMiddleware` for JWT/OAuth
  as needed without touching routes.
```

### Notes on design choices

- **Express + Zod**: mature, well-understood, minimal magic — easy to review and extend.
- **Repository pattern** (`DataStore` interface): controllers and routes never touch `Map` directly, so a real DB adapter is a drop-in replacement.
- **`asyncHandler` wrapper**: avoids repetitive try/catch in every controller while still funneling errors into the centralized handler.
- **`AppError`** class with static factories keeps error creation terse and consistent across controllers.
- **Route-level `.all()` fallbacks** produce proper `405 METHOD_NOT_ALLOWED` for defined paths hit with the wrong verb, while the global `notFoundHandler` catches truly unknown paths as `404`.
- **`mergeParams: true`** on task router lets nested task routes access `:projectId` from the parent router.
- Tests use **Vitest + Supertest** against the exported `createApp()` factory (no network binding needed), keeping them fast and isolated per test with a fresh `MemoryStore`.