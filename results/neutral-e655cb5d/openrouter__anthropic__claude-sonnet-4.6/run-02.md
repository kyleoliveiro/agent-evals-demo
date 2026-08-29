<!-- model: openrouter/anthropic/claude-sonnet-4.6 | run: 2 | framework: Express -->

Here is the complete implementation. The stack is **Express 4 + Zod + TypeScript** with strict compilation, a clean layered structure (types → store → middleware → validation → routes → app), and no hidden magic.

---

## Project layout

```
team-task-board/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── src/
    ├── server.ts
    ├── app.ts
    ├── types/
    │   └── index.ts
    ├── errors/
    │   └── AppError.ts
    ├── store/
    │   ├── IStore.ts
    │   ├── InMemoryStore.ts
    │   └── index.ts
    ├── middleware/
    │   ├── auth.ts
    │   ├── logger.ts
    │   ├── errorHandler.ts
    │   └── notFound.ts
    ├── validation/
    │   ├── project.schemas.ts
    │   └── task.schemas.ts
    └── routes/
        ├── health.router.ts
        ├── projects.router.ts
        └── tasks.router.ts
```

---

## Config files

**`package.json`**
```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "uuid": "^10.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**`tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**`.env.example`**
```dotenv
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
API_TOKEN=replace-me-with-a-strong-secret
CORS_ORIGIN=*
```

**`.gitignore`**
```gitignore
node_modules/
dist/
.env
*.js.map
```

---

## Source files

**`src/types/index.ts`**
```typescript
// ─── Domain types ────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Project {
  id: string;
  name: string;
  createdAt: string; // ISO-8601
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}
```

---

**`src/errors/AppError.ts`**
```typescript
/**
 * Operational (expected) HTTP error. Anything else is treated as a 500.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational = true;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

// ─── Convenience factories ────────────────────────────────────────────────────

export const Errors = {
  notFound: (resource: string, id: string) =>
    new AppError(404, 'NOT_FOUND', `${resource} with id '${id}' not found`),

  unauthorized: (detail = 'Missing or invalid Authorization header') =>
    new AppError(401, 'UNAUTHORIZED', detail),

  methodNotAllowed: (allowed: string[]) =>
    new AppError(
      405,
      'METHOD_NOT_ALLOWED',
      `Method not allowed. Accepted: ${allowed.join(', ')}`,
    ),

  badRequest: (message: string) => new AppError(400, 'BAD_REQUEST', message),

  internal: (message = 'An unexpected error occurred') =>
    new AppError(500, 'INTERNAL_ERROR', message),
};
```

---

**`src/store/IStore.ts`**
```typescript
import { Project, Task, TaskStatus } from '../types';

// ─── Input shapes ─────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

/**
 * undefined  → leave field unchanged
 * null       → clear the optional field
 * string     → set new value
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}

export interface TaskFilter {
  status?: TaskStatus;
}

// ─── Storage contract ─────────────────────────────────────────────────────────

export interface IStore {
  // Projects
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  createProject(input: CreateProjectInput): Project;
  deleteProject(id: string): boolean;

  // Tasks
  listTasks(projectId: string, filter?: TaskFilter): Task[];
  getTask(projectId: string, taskId: string): Task | undefined;
  createTask(projectId: string, input: CreateTaskInput): Task;
  updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Task | undefined;
  deleteTask(projectId: string, taskId: string): boolean;
}
```

---

**`src/store/InMemoryStore.ts`**
```typescript
import { v4 as uuidv4 } from 'uuid';
import { Project, Task } from '../types';
import {
  IStore,
  CreateProjectInput,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
} from './IStore';

export class InMemoryStore implements IStore {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>(); // keyed by task id

  // ─── Projects ───────────────────────────────────────────────────────────────

  listProjects(): Project[] {
    return [...this.projects.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt),
    );
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  createProject(input: CreateProjectInput): Project {
    const project: Project = {
      id: uuidv4(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  deleteProject(id: string): boolean {
    if (!this.projects.has(id)) return false;
    this.projects.delete(id);
    // Cascade-delete tasks
    for (const [taskId, task] of this.tasks) {
      if (task.projectId === id) this.tasks.delete(taskId);
    }
    return true;
  }

  // ─── Tasks ──────────────────────────────────────────────────────────────────

  listTasks(projectId: string, filter?: TaskFilter): Task[] {
    const results: Task[] = [];
    for (const task of this.tasks.values()) {
      if (task.projectId !== projectId) continue;
      if (filter?.status !== undefined && task.status !== filter.status) continue;
      results.push(task);
    }
    return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getTask(projectId: string, taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task?.projectId === projectId ? task : undefined;
  }

  createTask(projectId: string, input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
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

  updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Task | undefined {
    const existing = this.getTask(projectId, taskId);
    if (!existing) return undefined;

    // Spread existing then apply only the fields that were explicitly provided
    const updated: Task = { ...existing, updatedAt: new Date().toISOString() };

    if (input.title !== undefined) updated.title = input.title;
    if (input.status !== undefined) updated.status = input.status;

    // null → clear; string → set; undefined → no-op
    if (input.description !== undefined) {
      updated.description = input.description ?? undefined;
    }
    if (input.assignee !== undefined) {
      updated.assignee = input.assignee ?? undefined;
    }

    this.tasks.set(taskId, updated);
    return updated;
  }

  deleteTask(projectId: string, taskId: string): boolean {
    if (!this.getTask(projectId, taskId)) return false;
    this.tasks.delete(taskId);
    return true;
  }
}
```

---

**`src/store/index.ts`**
```typescript
import { InMemoryStore } from './InMemoryStore';

// Singleton store – swap implementation here without touching any route code
export const store = new InMemoryStore();

export type { IStore } from './IStore';
```

---

**`src/middleware/logger.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = (
      Number(process.hrtime.bigint() - startedAt) / 1_000_000
    ).toFixed(2);

    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`;

    if (res.statusCode >= 500) console.error(`[ERROR] ${line}`);
    else if (res.statusCode >= 400) console.warn(`[WARN]  ${line}`);
    else console.log(`[INFO]  ${line}`);
  });

  next();
}
```

---

**`src/middleware/auth.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';
import { Errors } from '../errors/AppError';

export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const apiToken = process.env['API_TOKEN'];

  if (!apiToken) {
    next(Errors.internal('API_TOKEN environment variable is not set'));
    return;
  }

  const authHeader = req.headers.authorization ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    next(Errors.unauthorized());
    return;
  }

  const token = authHeader.slice(7); // trim "Bearer "
  if (token !== apiToken) {
    next(Errors.unauthorized('Invalid token'));
    return;
  }

  next();
}
```

---

**`src/middleware/errorHandler.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';

// Shapes every error response identically: { error: { code, message } }
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  // ── Known operational error ────────────────────────────────────────────────
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // ── Zod validation error ───────────────────────────────────────────────────
  if (err instanceof ZodError) {
    const message = err.errors
      .map((e) => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message))
      .join('; ');

    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message },
    });
    return;
  }

  // ── express.json() body-parse failure ─────────────────────────────────────
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type: string }).type === 'entity.parse.failed'
  ) {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' },
    });
    return;
  }

  // ── Unexpected error (never expose internals) ──────────────────────────────
  console.error('[UNCAUGHT]', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
```

---

**`src/middleware/notFound.ts`**
```typescript
import { Request, Response } from 'express';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
```

---

**`src/validation/project.schemas.ts`**
```typescript
import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .trim()
    .min(1, 'name must not be empty')
    .max(200, 'name must be at most 200 characters'),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
```

---

**`src/validation/task.schemas.ts`**
```typescript
import { z } from 'zod';

const taskStatusEnum = z.enum(['todo', 'in_progress', 'done']);

export const createTaskSchema = z.object({
  title: z
    .string({ required_error: 'title is required' })
    .trim()
    .min(1, 'title must not be empty')
    .max(500, 'title must be at most 500 characters'),
  description: z.string().trim().max(5_000).optional(),
  status: taskStatusEnum.optional(),
  assignee: z.string().trim().max(200).optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'title must not be empty').max(500).optional(),
    // Send null to clear an optional field
    description: z.string().trim().max(5_000).nullable().optional(),
    status: taskStatusEnum.optional(),
    assignee: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'Request body must contain at least one field to update' },
  );

export const listTasksQuerySchema = z.object({
  status: taskStatusEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
```

---

**`src/routes/health.router.ts`**
```typescript
import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ ok: true });
});

export default router;
```

---

**`src/routes/projects.router.ts`**
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { store } from '../store';
import { createProjectSchema } from '../validation/project.schemas';
import { Errors } from '../errors/AppError';

const router = Router();

// GET /projects
router.get('/', (_req: Request, res: Response) => {
  const projects = store.listProjects();
  res.json({ data: projects, total: projects.length });
});

// POST /projects
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createProjectSchema.parse(req.body);
    const project = store.createProject({ name: body.name });
    res.status(201).json({ data: project });
  } catch (err) {
    next(err);
  }
});

// 405 for all other methods on /
router.all('/', (_req, _res, next: NextFunction) => {
  next(Errors.methodNotAllowed(['GET', 'POST']));
});

// GET /projects/:projectId
router.get('/:projectId', (req: Request, res: Response, next: NextFunction) => {
  const project = store.getProject(req.params['projectId']!);
  if (!project) return next(Errors.notFound('Project', req.params['projectId']!));
  res.json({ data: project });
});

// DELETE /projects/:projectId
router.delete('/:projectId', (req: Request, res: Response, next: NextFunction) => {
  const deleted = store.deleteProject(req.params['projectId']!);
  if (!deleted) return next(Errors.notFound('Project', req.params['projectId']!));
  res.status(204).send();
});

// 405 for all other methods on /:projectId
router.all('/:projectId', (_req, _res, next: NextFunction) => {
  next(Errors.methodNotAllowed(['GET', 'DELETE']));
});

export default router;
```

---

**`src/routes/tasks.router.ts`**
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { store } from '../store';
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema,
} from '../validation/task.schemas';
import { Errors } from '../errors/AppError';
import { TaskStatus } from '../types';

// mergeParams: true  →  :projectId from the parent route is accessible here
const router = Router({ mergeParams: true });

/** Verify the parent project exists; calls next(404) and returns false if not. */
function requireProject(projectId: string, next: NextFunction): boolean {
  if (!store.getProject(projectId)) {
    next(Errors.notFound('Project', projectId));
    return false;
  }
  return true;
}

// GET /projects/:projectId/tasks
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  const { projectId } = req.params as { projectId: string };
  if (!requireProject(projectId, next)) return;

  try {
    const query = listTasksQuerySchema.parse(req.query);

    const allTasks = store.listTasks(projectId, {
      status: query.status as TaskStatus | undefined,
    });

    const total = allTasks.length;
    const totalPages = Math.ceil(total / query.pageSize) || 1;
    const offset = (query.page - 1) * query.pageSize;
    const data = allTasks.slice(offset, offset + query.pageSize);

    res.json({
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/tasks
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  const { projectId } = req.params as { projectId: string };
  if (!requireProject(projectId, next)) return;

  try {
    const body = createTaskSchema.parse(req.body);
    const task = store.createTask(projectId, body);
    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
});

// 405 for all other methods on /
router.all('/', (_req, _res, next: NextFunction) => {
  next(Errors.methodNotAllowed(['GET', 'POST']));
});

// GET /projects/:projectId/tasks/:taskId
router.get('/:taskId', (req: Request, res: Response, next: NextFunction) => {
  const { projectId, taskId } = req.params as { projectId: string; taskId: string };
  if (!requireProject(projectId, next)) return;

  const task = store.getTask(projectId, taskId);
  if (!task) return next(Errors.notFound('Task', taskId));
  res.json({ data: task });
});

// PATCH /projects/:projectId/tasks/:taskId
router.patch('/:taskId', (req: Request, res: Response, next: NextFunction) => {
  const { projectId, taskId } = req.params as { projectId: string; taskId: string };
  if (!requireProject(projectId, next)) return;

  try {
    const body = updateTaskSchema.parse(req.body);
    const task = store.updateTask(projectId, taskId, body);
    if (!task) return next(Errors.notFound('Task', taskId));
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
});

// DELETE /projects/:projectId/tasks/:taskId
router.delete('/:taskId', (req: Request, res: Response, next: NextFunction) => {
  const { projectId, taskId } = req.params as { projectId: string; taskId: string };
  if (!requireProject(projectId, next)) return;

  const deleted = store.deleteTask(projectId, taskId);
  if (!deleted) return next(Errors.notFound('Task', taskId));
  res.status(204).send();
});

// 405 for all other methods on /:taskId
router.all('/:taskId', (_req, _res, next: NextFunction) => {
  next(Errors.methodNotAllowed(['GET', 'PATCH', 'DELETE']));
});

export default router;
```

---

**`src/app.ts`**
```typescript
import 'dotenv/config';
import express, { Express } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';

import { requestLogger } from './middleware/logger';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';

import healthRouter from './routes/health.router';
import projectsRouter from './routes/projects.router';
import tasksRouter from './routes/tasks.router';

export function createApp(): Express {
  const app = express();

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS (handles OPTIONS pre-flight too) ──────────────────────────────────
  const corsOptions: CorsOptions = {
    origin: process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86_400, // pre-flight cache: 24 h
  };
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions)); // explicit pre-flight reply

  // ── Body parsing ───────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));

  // ── Request logging ────────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Public routes (no auth) ────────────────────────────────────────────────
  app.use('/api/v1/health', healthRouter);

  // ── Auth guard for everything else ─────────────────────────────────────────
  app.use('/api/v1', authMiddleware);

  // ── Protected routes ───────────────────────────────────────────────────────
  // Tasks router MUST be mounted before the projects router so that
  // /projects/:projectId/tasks does not get swallowed by /:projectId in
  // the projects router (Express uses prefix matching for app.use()).
  app.use('/api/v1/projects/:projectId/tasks', tasksRouter);
  app.use('/api/v1/projects', projectsRouter);

  // ── Catch-all 404 ──────────────────────────────────────────────────────────
  app.use(notFoundHandler);

  // ── Global error handler (must be last) ───────────────────────────────────
  app.use(errorHandler);

  return app;
}
```

---

**`src/server.ts`**
```typescript
import { createApp } from './app';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] Team Task Board API → http://${HOST}:${PORT}/api/v1`);
  console.log(`[server] NODE_ENV=${process.env['NODE_ENV'] ?? 'development'}`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`[server] ${signal} received – shutting down…`);
  server.close(() => {
    console.log('[server] All connections closed. Bye.');
    process.exit(0);
  });

  // Safety net: force-exit after 10 s
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  process.exit(1);
});

export default server;
```

---

## Quick-start

```bash
# 1 – install
npm install

# 2 – configure
cp .env.example .env
# edit .env: set API_TOKEN to something strong

# 3 – run in dev mode (auto-restart on save)
npm run dev

# 4 – build & run in production
npm run build
npm start
```

### Smoke test (requires `curl`)

```bash
TOKEN="replace-me-with-a-strong-secret"
BASE="http://localhost:3000/api/v1"

# Health (no auth needed)
curl "$BASE/health"

# Create a project
curl -s -X POST "$BASE/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alpha"}' | jq .

# List projects
curl -s "$BASE/projects" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Create a task (replace PROJECT_ID)
curl -s -X POST "$BASE/projects/PROJECT_ID/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Write tests","status":"todo","assignee":"alice"}' | jq .

# List tasks with filter + pagination
curl -s "$BASE/projects/PROJECT_ID/tasks?status=todo&page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Partial update (replace TASK_ID)
curl -s -X PATCH "$BASE/projects/PROJECT_ID/tasks/TASK_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}' | jq .
```

---

## Architecture notes

| Concern | Decision |
|---|---|
| **Framework** | Express 4 — proven, minimal surface area |
| **Validation** | Zod — parse-don't-validate, excellent TS inference |
| **Auth** | Bearer token middleware applied to `/api/v1` prefix; `/api/v1/health` intentionally excluded |
| **CORS** | `cors` package + explicit `OPTIONS *` pre-flight; origin configurable via `CORS_ORIGIN` env var |
| **Security headers** | `helmet` (CSP, HSTS, X-Frame-Options, etc.) |
| **Errors** | Unified `{ error: { code, message } }` shape; `AppError` for operational errors, Zod errors mapped to 400, everything else to 500 |
| **405 handling** | Each router ends with `router.all(path, …)` catch-alls that emit 405 |
| **Storage** | `IStore` interface decouples all route/business logic from the `InMemoryStore`; swapping to Postgres/Redis means only writing a new class and changing the one-line export in `store/index.ts` |
| **Pagination** | Query params (`page`, `pageSize`); store returns full filtered list, slicing done at the route layer |
| **Graceful shutdown** | `SIGTERM`/`SIGINT` → `server.close()`, forced exit after 10 s |