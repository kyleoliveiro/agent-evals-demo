<!-- model: openrouter/anthropic/claude-sonnet-5 | run: 1 | framework: Express -->

# Team Task Board API

A production-ready REST API built with **TypeScript + Express + Zod**, using a pluggable in-memory data store behind a small interface (so it can later be swapped for Postgres/Mongo/etc. without touching route code).

## Project layout

```
team-task-board-api/
├── package.json
├── tsconfig.json
├── jest.config.js
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── config.ts
│   ├── types.ts
│   ├── errors.ts
│   ├── utils/
│   │   └── asyncHandler.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── requestLogger.ts
│   │   └── errorHandler.ts
│   ├── validation/
│   │   └── schemas.ts
│   ├── store/
│   │   ├── interface.ts
│   │   └── memoryStore.ts
│   └── routes/
│       ├── health.ts
│       ├── projects.ts
│       └── tasks.ts
└── tests/
    ├── health.test.ts
    ├── projects.test.ts
    └── tasks.test.ts
```

---

## `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board",
  "main": "dist/index.js",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "test": "jest --runInBand",
    "test:watch": "jest --watch",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.9",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.1.5",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.5.3"
  }
}
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src", "tests"],
  "exclude": ["node_modules", "dist"]
}
```

---

## `jest.config.js`

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
};
```

---

## `.env.example`

```
PORT=3000
API_TOKEN=change-me-to-a-long-random-secret
NODE_ENV=development
```

---

## `.gitignore`

```
node_modules
dist
.env
coverage
```

---

## `src/config.ts`

```ts
import 'dotenv/config';

interface Config {
  port: number;
  apiToken: string;
  nodeEnv: string;
}

function loadConfig(): Config {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const apiToken = process.env.API_TOKEN ?? '';
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (!apiToken) {
    // Do not crash local/dev tooling, but make the omission loud.
    // eslint-disable-next-line no-console
    console.warn(
      '[config] WARNING: API_TOKEN is not set. All authenticated routes will reject every request.'
    );
  }

  return { port, apiToken, nodeEnv };
}

export const config = loadConfig();
```

---

## `src/types.ts`

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

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TaskFilter {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}
```

---

## `src/errors.ts`

```ts
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(message = 'Method not allowed') {
    super(405, 'METHOD_NOT_ALLOWED', message);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, 'INTERNAL_ERROR', message);
  }
}
```

---

## `src/utils/asyncHandler.ts`

```ts
import { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Wraps an async route handler so rejected promises are forwarded
 * to Express's error-handling middleware instead of crashing the process.
 */
export const asyncHandler = (fn: AsyncRouteHandler): RequestHandler => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};
```

---

## `src/store/interface.ts`

```ts
import {
  CreateProjectInput,
  CreateTaskInput,
  Paginated,
  Project,
  Task,
  TaskFilter,
  UpdateTaskInput,
} from '../types';

/**
 * Storage abstraction. Swap MemoryStore for a database-backed
 * implementation without touching route/controller code.
 */
export interface Store {
  // Projects
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | undefined>;
  deleteProject(projectId: string): Promise<boolean>;

  // Tasks
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  listTasks(projectId: string, filter: TaskFilter): Promise<Paginated<Task>>;
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  updateTask(
    projectId: string,
    taskId: string,
    patch: UpdateTaskInput
  ): Promise<Task | undefined>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

---

## `src/store/memoryStore.ts`

```ts
import { randomUUID } from 'crypto';
import {
  CreateProjectInput,
  CreateTaskInput,
  Paginated,
  Project,
  Task,
  TaskFilter,
  UpdateTaskInput,
} from '../types';
import { Store } from './interface';

export class MemoryStore implements Store {
  private projects = new Map<string, Project>();
  private tasks = new Map<string, Task>();

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
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
      id: randomUUID(),
      projectId,
      title: input.title,
      description: input.description,
      status: input.status ?? 'todo',
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async listTasks(projectId: string, filter: TaskFilter): Promise<Paginated<Task>> {
    let items = Array.from(this.tasks.values()).filter(
      (t) => t.projectId === projectId
    );

    if (filter.status) {
      items = items.filter((t) => t.status === filter.status);
    }

    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const total = items.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / filter.pageSize);
    const start = (filter.page - 1) * filter.pageSize;
    const pageItems = items.slice(start, start + filter.pageSize);

    return {
      items: pageItems,
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      totalPages,
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
    patch: UpdateTaskInput
  ): Promise<Task | undefined> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return undefined;

    const updated: Task = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;
    this.tasks.delete(taskId);
    return true;
  }
}

// Singleton instance used by the route layer.
export const store: Store = new MemoryStore();
```

---

## `src/validation/schemas.ts`

```ts
import { z } from 'zod';

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200, 'name is too long'),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(200, 'title is too long'),
  description: z.string().max(5000).optional(),
  status: taskStatusSchema.optional(),
  assignee: z.string().trim().min(1).max(100).optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    status: taskStatusSchema,
    assignee: z.string().trim().min(1).max(100),
  })
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field (title, description, status, assignee) must be provided',
  });

export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 1 : Number(v)))
    .pipe(z.number().int('page must be an integer').min(1, 'page must be >= 1')),
  pageSize: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 20 : Number(v)))
    .pipe(
      z
        .number()
        .int('pageSize must be an integer')
        .min(1, 'pageSize must be >= 1')
        .max(100, 'pageSize must be <= 100')
    ),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type CreateTaskDto = z.infer<typeof createTaskSchema>;
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;
export type ListTasksQueryDto = z.infer<typeof listTasksQuerySchema>;
```

---

## `src/middleware/auth.ts`

```ts
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { UnauthorizedError } from '../errors';

const BEARER_PREFIX = 'Bearer ';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? req.header('Authorization');

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  if (!token || !config.apiToken || token !== config.apiToken) {
    throw new UnauthorizedError('Invalid API token');
  }

  next();
}
```

---

## `src/middleware/requestLogger.ts`

```ts
import { NextFunction, Request, Response } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // eslint-disable-next-line no-console
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`
    );
  });

  next();
}
```

---

## `src/middleware/errorHandler.ts`

```ts
import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, NotFoundError } from '../errors';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function sendError(res: Response, statusCode: number, code: string, message: string, details?: unknown) {
  const body: ErrorBody = { error: { code, message, ...(details ? { details } : {}) } };
  res.status(statusCode).json(body);
}

/** 404 handler for any route that didn't match a defined endpoint. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`No route found for ${req.method} ${req.originalUrl}`));
}

/** Central error-handling middleware. Must be registered last. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    sendError(
      res,
      400,
      'BAD_REQUEST',
      'Request validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
    return;
  }

  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  // Malformed JSON bodies thrown by express.json()
  if (err instanceof SyntaxError && 'body' in (err as Record<string, unknown>)) {
    sendError(res, 400, 'BAD_REQUEST', 'Malformed JSON body');
    return;
  }

  // eslint-disable-next-line no-console
  console.error('[unhandled error]', err);
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
}
```

---

## `src/routes/health.ts`

```ts
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.status(200).json({ ok: true });
});
```

---

## `src/routes/projects.ts`

```ts
import { Router } from 'express';
import { store } from '../store/memoryStore';
import { asyncHandler } from '../utils/asyncHandler';
import { createProjectSchema } from '../validation/schemas';
import { MethodNotAllowedError, NotFoundError } from '../errors';
import { tasksRouter } from './tasks';

export const projectsRouter = Router();

projectsRouter
  .route('/')
  .get(
    asyncHandler(async (_req, res) => {
      const projects = await store.listProjects();
      res.status(200).json({ items: projects });
    })
  )
  .post(
    asyncHandler(async (req, res) => {
      const input = createProjectSchema.parse(req.body);
      const project = await store.createProject(input);
      res.status(201).json(project);
    })
  )
  .all(() => {
    throw new MethodNotAllowedError();
  });

projectsRouter
  .route('/:projectId')
  .get(
    asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) throw new NotFoundError('Project not found');
      res.status(200).json(project);
    })
  )
  .delete(
    asyncHandler(async (req, res) => {
      const project = await store.getProject(req.params.projectId);
      if (!project) throw new NotFoundError('Project not found');
      await store.deleteProject(req.params.projectId);
      res.status(204).send();
    })
  )
  .all(() => {
    throw new MethodNotAllowedError();
  });

// Nested task routes: /projects/:projectId/tasks...
projectsRouter.use('/:projectId/tasks', tasksRouter);
```

---

## `src/routes/tasks.ts`

```ts
import { Router } from 'express';
import { store } from '../store/memoryStore';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from '../validation/schemas';
import { MethodNotAllowedError, NotFoundError } from '../errors';

// mergeParams so :projectId from the parent router is available here.
export const tasksRouter = Router({ mergeParams: true });

async function ensureProjectExists(projectId: string): Promise<void> {
  const project = await store.getProject(projectId);
  if (!project) throw new NotFoundError('Project not found');
}

tasksRouter
  .route('/')
  .get(
    asyncHandler(async (req, res) => {
      const { projectId } = req.params;
      await ensureProjectExists(projectId);

      const query = listTasksQuerySchema.parse(req.query);
      const result = await store.listTasks(projectId, {
        status: query.status,
        page: query.page,
        pageSize: query.pageSize,
      });
      res.status(200).json(result);
    })
  )
  .post(
    asyncHandler(async (req, res) => {
      const { projectId } = req.params;
      await ensureProjectExists(projectId);

      const input = createTaskSchema.parse(req.body);
      const task = await store.createTask(projectId, input);
      res.status(201).json(task);
    })
  )
  .all(() => {
    throw new MethodNotAllowedError();
  });

tasksRouter
  .route('/:taskId')
  .get(
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = req.params;
      await ensureProjectExists(projectId);

      const task = await store.getTask(projectId, taskId);
      if (!task) throw new NotFoundError('Task not found');
      res.status(200).json(task);
    })
  )
  .patch(
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = req.params;
      await ensureProjectExists(projectId);

      const patch = updateTaskSchema.parse(req.body);
      const updated = await store.updateTask(projectId, taskId, patch);
      if (!updated) throw new NotFoundError('Task not found');
      res.status(200).json(updated);
    })
  )
  .delete(
    asyncHandler(async (req, res) => {
      const { projectId, taskId } = req.params;
      await ensureProjectExists(projectId);

      const deleted = await store.deleteTask(projectId, taskId);
      if (!deleted) throw new NotFoundError('Task not found');
      res.status(204).send();
    })
  )
  .all(() => {
    throw new MethodNotAllowedError();
  });
```

---

## `src/app.ts`

```ts
import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { healthRouter } from './routes/health';
import { projectsRouter } from './routes/projects';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.options('*', cors());

  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  const API_PREFIX = '/api/v1';

  // Public route - no auth required.
  app.use(`${API_PREFIX}/health`, healthRouter);

  // Everything else under /api/v1 requires a bearer token.
  app.use(`${API_PREFIX}/projects`, requireAuth, projectsRouter);

  // Any other /api/v1/* path, or any path outside the API namespace, is a 404.
  app.use(notFoundHandler);

  // Central error handler - must be registered last.
  app.use(errorHandler);

  return app;
}
```

---

## `src/index.ts`

```ts
import { createApp } from './app';
import { config } from './config';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Team Task Board API listening on port ${config.port} (${config.nodeEnv})`);
});

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

---

## `tests/health.test.ts`

```ts
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /api/v1/health', () => {
  it('returns ok:true without auth', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('Unknown routes', () => {
  it('returns a 404 in the standard error shape', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
```

---

## `tests/projects.test.ts`

```ts
import request from 'supertest';
import { createApp } from '../src/app';

process.env.API_TOKEN = 'test-token';
const AUTH = { Authorization: 'Bearer test-token' };

describe('Projects API', () => {
  const app = createApp();

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('validates project creation payload', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(AUTH)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('creates, lists, fetches and deletes a project', async () => {
    const create = await request(app)
      .post('/api/v1/projects')
      .set(AUTH)
      .send({ name: 'Website Revamp' });
    expect(create.status).toBe(201);
    const { id } = create.body;

    const list = await request(app).get('/api/v1/projects').set(AUTH);
    expect(list.status).toBe(200);
    expect(list.body.items.some((p: { id: string }) => p.id === id)).toBe(true);

    const get = await request(app).get(`/api/v1/projects/${id}`).set(AUTH);
    expect(get.status).toBe(200);
    expect(get.body.name).toBe('Website Revamp');

    const del = await request(app).delete(`/api/v1/projects/${id}`).set(AUTH);
    expect(del.status).toBe(204);

    const getAfterDelete = await request(app).get(`/api/v1/projects/${id}`).set(AUTH);
    expect(getAfterDelete.status).toBe(404);
  });

  it('returns 405 for unsupported methods on a known collection route', async () => {
    const res = await request(app).put('/api/v1/projects').set(AUTH);
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });
});
```

---

## `tests/tasks.test.ts`

```ts
import request from 'supertest';
import { createApp } from '../src/app';

process.env.API_TOKEN = 'test-token';
const AUTH = { Authorization: 'Bearer test-token' };

describe('Tasks API', () => {
  const app = createApp();
  let projectId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(AUTH)
      .send({ name: 'Mobile App' });
    projectId = res.body.id;
  });

  it('404s for tasks under a non-existent project', async () => {
    const res = await request(app)
      .get('/api/v1/projects/does-not-exist/tasks')
      .set(AUTH);
    expect(res.status).toBe(404);
  });

  it('creates a task with default status todo', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(AUTH)
      .send({ title: 'Design login screen' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('todo');
  });

  it('lists tasks with pagination and status filter', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set(AUTH)
        .send({ title: `Task ${i}`, status: 'in_progress' });
    }

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks?status=in_progress&page=1&pageSize=2`)
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.total).toBe(3);
  });

  it('partially updates a task', async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(AUTH)
      .send({ title: 'Write tests' });

    const patch = await request(app)
      .patch(`/api/v1/projects/${projectId}/tasks/${created.body.id}`)
      .set(AUTH)
      .send({ status: 'done', assignee: 'ada' });

    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe('done');
    expect(patch.body.assignee).toBe('ada');
  });

  it('rejects empty patch bodies', async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(AUTH)
      .send({ title: 'Something' });

    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/tasks/${created.body.id}`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
  });

  it('deletes a task', async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(AUTH)
      .send({ title: 'Temp task' });

    const del = await request(app)
      .delete(`/api/v1/projects/${projectId}/tasks/${created.body.id}`)
      .set(AUTH);
    expect(del.status).toBe(204);

    const get = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks/${created.body.id}`)
      .set(AUTH);
    expect(get.status).toBe(404);
  });
});
```

---

## `README.md`

```markdown
# Team Task Board API

A REST API for managing projects and tasks, built with Express + TypeScript,
Zod for validation, and a swappable in-memory store.

## Setup

    npm install
    cp .env.example .env
    # edit .env and set API_TOKEN to a long random secret

## Run

    npm run dev     # development, hot reload
    npm run build && npm start   # production build

## Test

    npm test

## Authentication

Every endpoint except `GET /api/v1/health` requires:

    Authorization: Bearer <API_TOKEN>

## Endpoints

- `GET    /api/v1/health`
- `GET    /api/v1/projects`
- `POST   /api/v1/projects`                       body: `{ "name": "..." }`
- `GET    /api/v1/projects/:projectId`
- `DELETE /api/v1/projects/:projectId`
- `GET    /api/v1/projects/:projectId/tasks?status=&page=&pageSize=`
- `POST   /api/v1/projects/:projectId/tasks`      body: `{ "title": "...", "description"?, "status"?, "assignee"? }`
- `GET    /api/v1/projects/:projectId/tasks/:taskId`
- `PATCH  /api/v1/projects/:projectId/tasks/:taskId`  body: any subset of `title/description/status/assignee`
- `DELETE /api/v1/projects/:projectId/tasks/:taskId`

## Error shape

    { "error": { "code": "BAD_REQUEST", "message": "...", "details"?: [...] } }

Codes: `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404),
`METHOD_NOT_ALLOWED` (405), `INTERNAL_ERROR` (500).

## Swapping the storage layer

Implement `src/store/interface.ts`'s `Store` interface against your database
of choice and export it in place of `MemoryStore` from `src/store/memoryStore.ts`
(or wire up a factory in `app.ts`). No route/controller code needs to change.
```

---

### Notes on design decisions

- **Validation**: Zod schemas validate bodies and query params; failures surface as `400 BAD_REQUEST` with a `details` array of `{ path, message }`.
- **Auth**: applied only to `/api/v1/projects/**`, so unknown paths under `/api/v1` correctly fall through to the 404 handler without requiring a token first.
- **405 vs 404**: each router uses `.route(path).get(...).post(...).all(() => throw MethodNotAllowed)` so a *known* path hit with a *wrong* verb returns 405, while genuinely unknown paths hit the global 404 handler.
- **Pagination**: `page` (default 1) and `pageSize` (default 20, max 100) are coerced/validated by Zod; response includes `total` and `totalPages`.
- **Logging**: `requestLogger` logs `METHOD PATH STATUS DURATIONms` for every request via `res.on('finish', …)`, guaranteeing it fires even on errors.
- **CORS**: global `cors()` middleware plus explicit `OPTIONS *` handling for preflight.
- **Security headers**: `helmet()` is included for sane defaults in production.
- **Testability**: `createApp()` returns a fresh Express app instance so tests (via `supertest`) don't need a running server or shared global state across test files.