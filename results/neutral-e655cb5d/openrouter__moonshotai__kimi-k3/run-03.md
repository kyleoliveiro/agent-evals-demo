<!-- model: openrouter/moonshotai/kimi-k3 | run: 3 | framework: Express -->

Here's a complete, production-ready implementation. It uses **Express + zod** (works cleanly with Express's sync route handlers), a **store interface** with an in-memory implementation, structured request logging, bearer auth, CORS (incl. preflight), and a consistent error shape across 400/401/404/405/500.

```
team-task-board-api/
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── README.md
└── src/
    ├── server.ts
    ├── app.ts
    ├── config.ts
    ├── logger.ts
    ├── errors.ts
    ├── app.test.ts
    ├── store/
    │   ├── types.ts
    │   └── inMemoryStore.ts
    ├── http/
    │   ├── validate.ts
    │   ├── auth.ts
    │   ├── requestLogger.ts
    │   ├── routeFallback.ts
    │   └── errorHandler.ts
    └── routes/
        ├── projects.ts
        └── tasks.ts
```

## package.json

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "private": true,
  "description": "REST API for a team task board",
  "license": "MIT",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

## .gitignore

```
node_modules/
dist/
.env
*.log
```

## .env.example

```bash
# Required. Every route except /health needs "Authorization: Bearer <token>".
API_TOKEN=change-me-in-production

# Optional
PORT=3000
# Comma-separated list of allowed origins, or "*" (default)
CORS_ORIGIN=*
```

## src/config.ts

```typescript
export interface AppConfig {
  port: number;
  apiToken: string;
  corsOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    apiToken: env.API_TOKEN ?? '',
    corsOrigin: env.CORS_ORIGIN ?? '*',
  };
}
```

## src/logger.ts

```typescript
type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
```

## src/errors.ts

```typescript
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const unauthorized = (message = 'Missing or invalid bearer token') =>
  new ApiError(401, 'UNAUTHORIZED', message);

export const notFound = (message: string) => new ApiError(404, 'NOT_FOUND', message);
```

## src/store/types.ts

Storage is behind this interface so it can later be swapped for a real database without touching routes.

```typescript
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

export interface TaskBoardStore {
  createProject(input: CreateProjectInput): Project;
  listProjects(): Project[];
  findProject(id: string): Project | undefined;
  deleteProject(id: string): boolean;

  /** Returns undefined when the project does not exist. */
  createTask(projectId: string, input: CreateTaskInput): Task | undefined;
  listTasks(projectId: string): Task[] | undefined;
  findTask(projectId: string, taskId: string): Task | undefined;
  updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Task | undefined;
  deleteTask(projectId: string, taskId: string): boolean;
}
```

## src/store/inMemoryStore.ts

```typescript
import { randomUUID } from 'node:crypto';
import {
  CreateProjectInput,
  CreateTaskInput,
  Project,
  Task,
  TaskBoardStore,
  UpdateTaskInput,
} from './types';

export class InMemoryTaskBoardStore implements TaskBoardStore {
  private readonly projects = new Map<string, Project>();
  private readonly tasksByProject = new Map<string, Task[]>();

  createProject(input: CreateProjectInput): Project {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  listProjects(): Project[] {
    return [...this.projects.values()];
  }

  findProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  deleteProject(id: string): boolean {
    const existed = this.projects.delete(id);
    if (existed) {
      this.tasksByProject.delete(id); // cascade
    }
    return existed;
  }

  createTask(projectId: string, input: CreateTaskInput): Task | undefined {
    if (!this.projects.has(projectId)) return undefined;
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId,
      title: input.title,
      status: input.status ?? 'todo',
      createdAt: now,
      updatedAt: now,
    };
    if (input.description !== undefined) task.description = input.description;
    if (input.assignee !== undefined) task.assignee = input.assignee;

    const list = this.tasksByProject.get(projectId) ?? [];
    list.push(task);
    this.tasksByProject.set(projectId, list);
    return task;
  }

  listTasks(projectId: string): Task[] | undefined {
    if (!this.projects.has(projectId)) return undefined;
    return [...(this.tasksByProject.get(projectId) ?? [])];
  }

  findTask(projectId: string, taskId: string): Task | undefined {
    if (!this.projects.has(projectId)) return undefined;
    return (this.tasksByProject.get(projectId) ?? []).find((t) => t.id === taskId);
  }

  updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Task | undefined {
    if (!this.projects.has(projectId)) return undefined;
    const list = this.tasksByProject.get(projectId) ?? [];
    const task = list.find((t) => t.id === taskId);
    if (!task) return undefined;

    if (input.title !== undefined) task.title = input.title;
    if (input.description !== undefined) task.description = input.description;
    if (input.status !== undefined) task.status = input.status;
    if (input.assignee !== undefined) task.assignee = input.assignee;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  deleteTask(projectId: string, taskId: string): boolean {
    const list = this.tasksByProject.get(projectId);
    if (!list) return false;
    const index = list.findIndex((t) => t.id === taskId);
    if (index === -1) return false;
    list.splice(index, 1);
    return true;
  }
}
```

## src/http/validate.ts

```typescript
import { ZodType } from 'zod';
import { ApiError } from '../errors';

/** Parses with zod and converts failures into a 400 VALIDATION_ERROR. */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('; ');
    throw new ApiError(400, 'VALIDATION_ERROR', details);
  }
  return result.data;
}
```

## src/http/auth.ts

```typescript
import { RequestHandler } from 'express';
import crypto from 'node:crypto';
import { AppConfig } from '../config';
import { unauthorized } from '../errors';

export function auth(config: AppConfig): RequestHandler {
  const expected = `Bearer ${config.apiToken}`;
  return (req, _res, next) => {
    const header = req.get('authorization');
    if (!header || !timingSafeEqual(header, expected)) {
      next(unauthorized());
      return;
    }
    next();
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}
```

## src/http/requestLogger.ts

```typescript
import { RequestHandler } from 'express';
import { logger } from '../logger';

/** Logs method, path, status code, and duration for every request. */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info('http_request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  };
}
```

## src/http/routeFallback.ts

Decides between **404** (unknown path) and **405** (known path, wrong method), and sets the `Allow` header for 405s.

```typescript
import { RequestHandler } from 'express';
import { ApiError, notFound } from '../errors';

interface KnownRoute {
  pattern: string;
  methods: string[];
}

const KNOWN_ROUTES: KnownRoute[] = [
  { pattern: '/health', methods: ['GET'] },
  { pattern: '/projects', methods: ['GET', 'POST'] },
  { pattern: '/projects/:projectId', methods: ['GET', 'DELETE'] },
  { pattern: '/projects/:projectId/tasks', methods: ['GET', 'POST'] },
  { pattern: '/projects/:projectId/tasks/:taskId', methods: ['GET', 'PATCH', 'DELETE'] },
];

const compiled = KNOWN_ROUTES.map(({ pattern, methods }) => ({
  methods,
  regex: new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}$`),
}));

export const apiFallback: RequestHandler = (req, res, next) => {
  // req.path here is relative to the /api/v1 mount point.
  const match = compiled.find((c) => c.regex.test(req.path));
  if (match) {
    res.setHeader('Allow', match.methods.join(', '));
    next(new ApiError(405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on ${req.path}`));
    return;
  }
  next(notFound(`No route matches ${req.method} ${req.baseUrl}${req.path}`));
};
```

## src/http/errorHandler.ts

```typescript
import { ErrorRequestHandler } from 'express';
import { ApiError } from '../errors';
import { logger } from '../logger';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // Malformed JSON body (express.json SyntaxError)
  if (err instanceof SyntaxError && (err as { status?: unknown }).status === 400) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON' } });
    return;
  }

  logger.error('unhandled_error', {
    method: req.method,
    path: req.originalUrl,
    error: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};
```

## src/routes/projects.ts

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { TaskBoardStore } from '../store/types';
import { parse } from '../http/validate';
import { notFound } from '../errors';
import { tasksRouter } from './tasks';

const createProjectBody = z
  .object({
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export function projectsRouter(store: TaskBoardStore): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ data: store.listProjects() });
  });

  router.post('/', (req, res) => {
    const input = parse(createProjectBody, req.body);
    const project = store.createProject(input);
    res.status(201).json(project);
  });

  router.get('/:projectId', (req, res) => {
    const project = store.findProject(req.params.projectId);
    if (!project) throw notFound(`Project '${req.params.projectId}' was not found`);
    res.json(project);
  });

  router.delete('/:projectId', (req, res) => {
    if (!store.deleteProject(req.params.projectId)) {
      throw notFound(`Project '${req.params.projectId}' was not found`);
    }
    res.status(204).end();
  });

  router.use('/:projectId/tasks', tasksRouter(store));
  return router;
}
```

## src/routes/tasks.ts

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { TaskBoardStore } from '../store/types';
import { parse } from '../http/validate';
import { notFound } from '../errors';

const taskStatus = z.enum(['todo', 'in_progress', 'done']);

const createTaskBody = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(5000).optional(),
    status: taskStatus.optional(),
    assignee: z.string().trim().max(200).optional(),
  })
  .strict();

const updateTaskBody = createTaskBody.partial();

const listTasksQuery = z.object({
  status: taskStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function tasksRouter(store: TaskBoardStore): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const { projectId } = req.params;
    const query = parse(listTasksQuery, req.query);

    const tasks = store.listTasks(projectId);
    if (!tasks) throw notFound(`Project '${projectId}' was not found`);

    const filtered = query.status ? tasks.filter((t) => t.status === query.status) : tasks;
    const total = filtered.length;
    const offset = (query.page - 1) * query.pageSize;
    const data = filtered.slice(offset, offset + query.pageSize);

    res.json({
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  });

  router.post('/', (req, res) => {
    const { projectId } = req.params;
    const input = parse(createTaskBody, req.body);
    const task = store.createTask(projectId, input);
    if (!task) throw notFound(`Project '${projectId}' was not found`);
    res.status(201).json(task);
  });

  router.get('/:taskId', (req, res) => {
    const task = store.findTask(req.params.projectId, req.params.taskId);
    if (!task) throw notFound(`Task '${req.params.taskId}' was not found`);
    res.json(task);
  });

  router.patch('/:taskId', (req, res) => {
    const input = parse(updateTaskBody, req.body);
    const task = store.updateTask(req.params.projectId, req.params.taskId, input);
    if (!task) throw notFound(`Task '${req.params.taskId}' was not found`);
    res.json(task);
  });

  router.delete('/:taskId', (req, res) => {
    if (!store.deleteTask(req.params.projectId, req.params.taskId)) {
      throw notFound(`Task '${req.params.taskId}' was not found`);
    }
    res.status(204).end();
  });

  return router;
}
```

## src/app.ts

Kept separate from `server.ts` so tests can build an app without binding a port.

```typescript
import express, { Express, Router } from 'express';
import cors from 'cors';
import { AppConfig, loadConfig } from './config';
import { TaskBoardStore } from './store/types';
import { InMemoryTaskBoardStore } from './store/inMemoryStore';
import { requestLogger } from './http/requestLogger';
import { auth } from './http/auth';
import { projectsRouter } from './routes/projects';
import { apiFallback } from './http/routeFallback';
import { errorHandler } from './http/errorHandler';
import { notFound } from './errors';

export interface CreateAppOptions {
  config?: AppConfig;
  store?: TaskBoardStore;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const config = options.config ?? loadConfig();
  const store = options.store ?? new InMemoryTaskBoardStore();

  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger());

  const corsOrigin =
    config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((o) => o.trim());
  app.use(cors({ origin: corsOrigin })); // handles preflight automatically

  app.use(express.json({ limit: '100kb' }));

  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use(auth(config)); // everything below this line requires a bearer token
  api.use('/projects', projectsRouter(store));
  api.use(apiFallback); // 404 vs 405 for anything unmatched under /api/v1

  app.use('/api/v1', api);
  app.use((req, _res, next) => {
    next(notFound(`No route matches ${req.method} ${req.originalUrl}`));
  });
  app.use(errorHandler);

  return app;
}
```

## src/server.ts

```typescript
import { createApp } from './app';
import { loadConfig } from './config';
import { logger } from './logger';

const config = loadConfig();

if (!config.apiToken) {
  logger.error('API_TOKEN environment variable is required');
  process.exit(1);
}

const app = createApp({ config });
const server = app.listen(config.port, () => {
  logger.info('server_started', { port: config.port });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('shutting_down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
```

## src/app.test.ts

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from './app';
import { AppConfig } from './config';

const config: AppConfig = { port: 0, apiToken: 'test-token', corsOrigin: '*' };
const authHeader = { Authorization: 'Bearer test-token' };

let app: Express;
beforeEach(() => {
  app = createApp({ config });
});

describe('health', () => {
  it('is reachable without a token', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('auth', () => {
  it('rejects requests without a bearer token', async () => {
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with the wrong token', async () => {
    const res = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });
});

describe('projects', () => {
  it('validates the create body', async () => {
    const res = await request(app).post('/api/v1/projects').set(authHeader).send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(authHeader)
      .set('Content-Type', 'application/json')
      .send('{oops');
    expect(res.status).toBe(400);
  });

  it('cascades deletes to tasks', async () => {
    const created = await request(app)
      .post('/api/v1/projects')
      .set(authHeader)
      .send({ name: 'Board' });
    expect(created.status).toBe(201);
    const projectId = created.body.id as string;

    await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(authHeader)
      .send({ title: 'Task 1' });

    const del = await request(app).delete(`/api/v1/projects/${projectId}`).set(authHeader);
    expect(del.status).toBe(204);

    const listing = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks`)
      .set(authHeader);
    expect(listing.status).toBe(404);
    expect(listing.body.error.code).toBe('NOT_FOUND');
  });
});

describe('tasks', () => {
  async function createProject(): Promise<string> {
    const res = await request(app).post('/api/v1/projects').set(authHeader).send({ name: 'P' });
    return res.body.id as string;
  }

  it('supports CRUD, filtering, and pagination', async () => {
    const projectId = await createProject();

    for (let i = 0; i < 3; i++) {
      const created = await request(app)
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set(authHeader)
        .send({ title: `task-${i}` });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('todo');
    }

    const page2 = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks`)
      .set(authHeader)
      .query({ page: 2, pageSize: 2 });
    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });

    const taskId = page2.body.data[0].id as string;

    const patched = await request(app)
      .patch(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set(authHeader)
      .send({ status: 'done', assignee: 'ada' });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('done');
    expect(patched.body.assignee).toBe('ada');

    const filtered = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks`)
      .set(authHeader)
      .query({ status: 'done' });
    expect(filtered.body.data).toHaveLength(1);

    const one = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set(authHeader);
    expect(one.status).toBe(200);

    const del = await request(app)
      .delete(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set(authHeader);
    expect(del.status).toBe(204);

    const gone = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set(authHeader);
    expect(gone.status).toBe(404);
  });

  it('rejects invalid status values', async () => {
    const projectId = await createProject();
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(authHeader)
      .send({ title: 'x', status: 'nonsense' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('routing fallbacks', () => {
  it('returns a consistent 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope').set(authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 405 (+ Allow header) for a known path with the wrong method', async () => {
    const res = await request(app).put('/api/v1/projects').set(authHeader);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, POST');
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });
});
```

## README.md

````markdown
# Team Task Board API

REST API for a team task board: projects with tasks, filtered/paginated task
listing, bearer-token auth, and consistent JSON errors.

## Endpoints (all under `/api/v1`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/health` | Liveness probe (no auth) |
| GET    | `/projects` | List projects |
| POST   | `/projects` | Create project |
| GET    | `/projects/:projectId` | Get one project |
| DELETE | `/projects/:projectId` | Delete project + its tasks |
| GET    | `/projects/:projectId/tasks?status=&page=&pageSize=` | List tasks (filter + paginate) |
| POST   | `/projects/:projectId/tasks` | Create task |
| GET    | `/projects/:projectId/tasks/:taskId` | Get one task |
| PATCH  | `/projects/:projectId/tasks/:taskId` | Partial update |
| DELETE | `/projects/:projectId/tasks/:taskId` | Delete task |

## Auth

Every route except `GET /api/v1/health` requires:

```
Authorization: Bearer <API_TOKEN>
```

Otherwise the API responds `401 { "error": { "code": "UNAUTHORIZED", ... } }`.

## Error shape

All failures (validation, not found, method not allowed, unexpected) use:

```json
{ "error": { "code": "NOT_FOUND", "message": "Project 'abc' was not found" } }
```

Codes: `VALIDATION_ERROR` (400), `BAD_REQUEST` (400, malformed JSON),
`UNAUTHORIZED` (401), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405),
`INTERNAL_ERROR` (500).

## Setup

```bash
npm install
cp .env.example .env   # set API_TOKEN
npm run dev            # watch mode (tsx)
```

Production:

```bash
npm run build
API_TOKEN=... npm start
```

Tests / typecheck:

```bash
npm test
npm run typecheck
```

## Design notes

- **Storage is behind `TaskBoardStore`** (`src/store/types.ts`). The default is
  `InMemoryTaskBoardStore`; swapping in Postgres later means implementing that
  interface and passing it to `createApp({ store })`. Data persists only in
  process memory.
- **Validation** uses zod schemas; failures become `400 VALIDATION_ERROR`.
  Unknown body fields are rejected (`strict`), query params are lenient.
- **405 vs 404**: `src/http/routeFallback.ts` keeps a registry of known route
  patterns; a matched pattern with the wrong verb yields 405 + `Allow` header,
  otherwise 404.
- **CORS** origin is configurable via `CORS_ORIGIN` (comma-separated or `*`);
  preflight is handled by the `cors` middleware.
- **Logging**: every request logs method, path, status, and duration as
  JSON lines (`src/http/requestLogger.ts`), suitable for log shippers.
- **Graceful shutdown** on SIGINT/SIGTERM in `src/server.ts`.

## Example

```bash
curl -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Website"}' \
     localhost:3000/api/v1/projects

curl -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"title":"Wire up CI"}' \
     localhost:3000/api/v1/projects/<projectId>/tasks

curl -H "Authorization: Bearer $API_TOKEN" \
     "localhost:3000/api/v1/projects/<projectId>/tasks?status=todo&page=1&pageSize=20"
```
````

A couple of behavior notes worth knowing:

- **Unknown routes require auth first.** `GET /api/v1/nope` without a token returns 401, and with a token returns the consistent 404. This avoids exposing route structure to unauthenticated callers.
- **Pagination metadata** is returned as `{ data, pagination: { page, pageSize, total, totalPages } }`, with `pageSize` capped at 100 and invalid values rejected as 400s.
- **PATCH is a true partial update** — omitted fields keep their previous values; only `updatedAt` is bumped.