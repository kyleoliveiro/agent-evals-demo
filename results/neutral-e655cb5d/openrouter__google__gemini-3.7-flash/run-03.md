<!-- model: openrouter/google/gemini-3.7-flash | run: 3 | framework: Express -->

Here is the complete, production-ready REST API implementation in TypeScript using Express and Zod.

### Project Structure

```text
├── .env.example
├── package.json
├── tsconfig.json
└── src
    ├── config.ts
    ├── server.ts
    ├── app.ts
    ├── types
    │   ├── api.ts
    │   └── models.ts
    ├── errors
    │   └── AppError.ts
    ├── storage
    │   ├── interface.ts
    │   └── memoryStore.ts
    ├── schemas
    │   ├── common.schema.ts
    │   ├── project.schema.ts
    │   └── task.schema.ts
    ├── middlewares
    │   ├── auth.ts
    │   ├── errorHandler.ts
    │   ├── logger.ts
    │   └── validate.ts
    └── routes
        ├── index.ts
        ├── health.routes.ts
        ├── project.routes.ts
        └── task.routes.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready Team Task Board REST API in TypeScript",
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
    "express": "^4.21.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.5",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `.env.example`

```env
PORT=3000
NODE_ENV=development
API_TOKEN=secret-task-board-token-123
CORS_ORIGIN=*
```

---

### `src/config.ts`

```typescript
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiToken: process.env.API_TOKEN || 'secret-task-board-token-123',
  corsOrigin: process.env.CORS_ORIGIN || '*',
} as const;

if (config.nodeEnv === 'production' && (!process.env.API_TOKEN || process.env.API_TOKEN.length < 16)) {
  console.warn('[WARNING] Weak or default API_TOKEN in production environment.');
}
```

---

### `src/types/models.ts`

```typescript
export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Project {
  id: string;
  name: string;
  createdAt: string; // ISO 8601 string
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string; // ISO 8601 string
  updatedAt: string; // ISO 8601 string
}
```

---

### `src/types/api.ts`

```typescript
export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ErrorPayload;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}
```

---

### `src/errors/AppError.ts`

```typescript
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static validation(details: unknown): AppError {
    return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
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
    return new AppError(500, 'INTERNAL_SERVER_ERROR', message);
  }
}
```

---

### `src/storage/interface.ts`

```typescript
import { Project, Task, TaskStatus } from '../types/models';
import { PaginatedResult } from '../types/api';

export interface CreateProjectDTO {
  name: string;
}

export interface CreateTaskDTO {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
}

export interface UpdateTaskDTO {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assignee?: string | null;
}

export interface ListTasksFilter {
  status?: TaskStatus;
  page: number;
  pageSize: number;
}

export interface ITaskBoardStore {
  // Project operations
  getAllProjects(): Promise<Project[]>;
  getProjectById(id: string): Promise<Project | null>;
  createProject(data: CreateProjectDTO): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;

  // Task operations
  getTasksByProject(projectId: string, filter: ListTasksFilter): Promise<PaginatedResult<Task>>;
  getTaskById(projectId: string, taskId: string): Promise<Task | null>;
  createTask(projectId: string, data: CreateTaskDTO): Promise<Task>;
  updateTask(projectId: string, taskId: string, data: UpdateTaskDTO): Promise<Task | null>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

---

### `src/storage/memoryStore.ts`

```typescript
import { randomUUID } from 'crypto';
import { Project, Task } from '../types/models';
import { PaginatedResult } from '../types/api';
import {
  ITaskBoardStore,
  CreateProjectDTO,
  CreateTaskDTO,
  UpdateTaskDTO,
  ListTasksFilter,
} from './interface';

export class InMemoryTaskBoardStore implements ITaskBoardStore {
  private projects: Map<string, Project> = new Map();
  private tasks: Map<string, Task> = new Map();

  async getAllProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getProjectById(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async createProject(data: CreateProjectDTO): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: data.name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return { ...project };
  }

  async deleteProject(id: string): Promise<boolean> {
    if (!this.projects.has(id)) {
      return false;
    }

    this.projects.delete(id);

    // Cascade delete: remove all tasks associated with this project
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.projectId === id) {
        this.tasks.delete(taskId);
      }
    }

    return true;
  }

  async getTasksByProject(
    projectId: string,
    filter: ListTasksFilter
  ): Promise<PaginatedResult<Task>> {
    let filtered = Array.from(this.tasks.values()).filter((t) => t.projectId === projectId);

    if (filter.status) {
      filtered = filtered.filter((t) => t.status === filter.status);
    }

    // Sort newest to oldest
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const totalPages = Math.ceil(total / filter.pageSize) || 1;
    const startIndex = (filter.page - 1) * filter.pageSize;
    const paginated = filtered.slice(startIndex, startIndex + filter.pageSize);

    return {
      data: paginated.map((t) => ({ ...t })),
      pagination: {
        page: filter.page,
        pageSize: filter.pageSize,
        total,
        totalPages,
      },
    };
  }

  async getTaskById(projectId: string, taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return null;
    }
    return { ...task };
  }

  async createTask(projectId: string, data: CreateTaskDTO): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId,
      title: data.title,
      description: data.description,
      status: data.status ?? 'todo',
      assignee: data.assignee,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    return { ...task };
  }

  async updateTask(
    projectId: string,
    taskId: string,
    data: UpdateTaskDTO
  ): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return null;
    }

    const updatedTask: Task = {
      ...task,
      title: data.title !== undefined ? data.title : task.title,
      description:
        data.description === null
          ? undefined
          : data.description !== undefined
          ? data.description
          : task.description,
      status: data.status !== undefined ? data.status : task.status,
      assignee:
        data.assignee === null
          ? undefined
          : data.assignee !== undefined
          ? data.assignee
          : task.assignee,
      updatedAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, updatedTask);
    return { ...updatedTask };
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return false;
    }
    return this.tasks.delete(taskId);
  }
}

export const store = new InMemoryTaskBoardStore();
```

---

### `src/schemas/common.schema.ts`

```typescript
import { z } from 'zod';

export const uuidParamSchema = z.string().uuid('Must be a valid UUID');
```

---

### `src/schemas/project.schema.ts`

```typescript
import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z
    .string({ required_error: 'Project name is required' })
    .trim()
    .min(1, 'Project name must not be empty')
    .max(100, 'Project name cannot exceed 100 characters'),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
```

---

### `src/schemas/task.schema.ts`

```typescript
import { z } from 'zod';

export const taskStatusEnum = z.enum(['todo', 'in_progress', 'done'], {
  errorMap: () => ({ message: "Status must be one of 'todo', 'in_progress', 'done'" }),
});

export const createTaskSchema = z.object({
  title: z
    .string({ required_error: 'Title is required' })
    .trim()
    .min(1, 'Title must not be empty')
    .max(200, 'Title cannot exceed 200 characters'),
  description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').optional(),
  status: taskStatusEnum.optional(),
  assignee: z.string().trim().max(100, 'Assignee cannot exceed 100 characters').optional(),
});

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title must not be empty')
      .max(200, 'Title cannot exceed 200 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, 'Description cannot exceed 2000 characters')
      .nullable()
      .optional(),
    status: taskStatusEnum.optional(),
    assignee: z
      .string()
      .trim()
      .max(100, 'Assignee cannot exceed 100 characters')
      .nullable()
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const taskParamsSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  taskId: z.string().min(1, 'Task ID is required'),
});

export const listTasksQuerySchema = z.object({
  status: taskStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQueryInput = z.infer<typeof listTasksQuerySchema>;
```

---

### `src/middlewares/auth.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { AppError } from '../errors/AppError';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw AppError.unauthorized('Missing Authorization header');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw AppError.unauthorized('Invalid Authorization format. Expected "Bearer <token>"');
  }

  const token = parts[1];
  if (token !== config.apiToken) {
    throw AppError.unauthorized('Invalid or expired API token');
  }

  next();
}
```

---

### `src/middlewares/logger.ts`

```typescript
import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = (Number(end - start) / 1_000_000).toFixed(2);
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration: `${durationMs}ms`,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.get('user-agent'),
    };

    console.log(JSON.stringify(logEntry));
  });

  next();
}
```

---

### `src/middlewares/validate.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { AppError } from '../errors/AppError';

type ValidationTarget = 'body' | 'query' | 'params';

export function validate(schema: AnyZodObject, target: ValidationTarget = 'body') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req[target]);
      req[target] = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        next(AppError.validation(issues));
      } else {
        next(error);
      }
    }
  };
}
```

---

### `src/middlewares/errorHandler.ts`

```typescript
import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '../errors/AppError';
import { ApiErrorResponse } from '../types/api';

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

export const globalErrorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    const response: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Handle SyntaxError for bad JSON request payloads
  if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
    const response: ApiErrorResponse = {
      error: {
        code: 'MALFORMED_JSON',
        message: 'Request payload contains malformed JSON',
      },
    };
    res.status(400).json(response);
    return;
  }

  // Unexpected errors (500)
  console.error('[UNHANDLED_ERROR]', err);

  const response: ApiErrorResponse = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
    },
  };
  res.status(500).json(response);
};
```

---

### `src/routes/health.routes.ts`

```typescript
import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

export const healthRoutes = router;
```

---

### `src/routes/project.routes.ts`

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { store } from '../storage/memoryStore';
import { validate } from '../middlewares/validate';
import { createProjectSchema, projectIdParamSchema } from '../schemas/project.schema';
import { AppError } from '../errors/AppError';

const router = Router();

// GET /api/v1/projects
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await store.getAllProjects();
    res.status(200).json({ data: projects });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/projects
router.post(
  '/',
  validate(createProjectSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = await store.createProject(req.body);
      res.status(201).json({ data: project });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/projects/:projectId
router.get(
  '/:projectId',
  validate(projectIdParamSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = await store.getProjectById(req.params.projectId!);
      if (!project) {
        throw AppError.notFound(`Project with id "${req.params.projectId}" was not found`);
      }
      res.status(200).json({ data: project });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/projects/:projectId
router.delete(
  '/:projectId',
  validate(projectIdParamSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await store.deleteProject(req.params.projectId!);
      if (!deleted) {
        throw AppError.notFound(`Project with id "${req.params.projectId}" was not found`);
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export const projectRoutes = router;
```

---

### `src/routes/task.routes.ts`

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { store } from '../storage/memoryStore';
import { validate } from '../middlewares/validate';
import {
  createTaskSchema,
  updateTaskSchema,
  taskParamsSchema,
  listTasksQuerySchema,
} from '../schemas/task.schema';
import { projectIdParamSchema } from '../schemas/project.schema';
import { AppError } from '../errors/AppError';

// mergeParams: true allows access to :projectId from parent router
const router = Router({ mergeParams: true });

// Helper to assert project exists before task operations
async function assertProjectExists(projectId: string): Promise<void> {
  const project = await store.getProjectById(projectId);
  if (!project) {
    throw AppError.notFound(`Project with id "${projectId}" was not found`);
  }
}

// GET /api/v1/projects/:projectId/tasks?status=&page=&pageSize=
router.get(
  '/',
  validate(projectIdParamSchema, 'params'),
  validate(listTasksQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      await assertProjectExists(projectId!);

      const { status, page, pageSize } = req.query as unknown as {
        status?: 'todo' | 'in_progress' | 'done';
        page: number;
        pageSize: number;
      };

      const result = await store.getTasksByProject(projectId!, { status, page, pageSize });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/projects/:projectId/tasks
router.post(
  '/',
  validate(projectIdParamSchema, 'params'),
  validate(createTaskSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      await assertProjectExists(projectId!);

      const task = await store.createTask(projectId!, req.body);
      res.status(201).json({ data: task });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/projects/:projectId/tasks/:taskId
router.get(
  '/:taskId',
  validate(taskParamsSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, taskId } = req.params;
      await assertProjectExists(projectId!);

      const task = await store.getTaskById(projectId!, taskId!);
      if (!task) {
        throw AppError.notFound(`Task with id "${taskId}" was not found in this project`);
      }

      res.status(200).json({ data: task });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/projects/:projectId/tasks/:taskId
router.patch(
  '/:taskId',
  validate(taskParamsSchema, 'params'),
  validate(updateTaskSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, taskId } = req.params;
      await assertProjectExists(projectId!);

      const updatedTask = await store.updateTask(projectId!, taskId!, req.body);
      if (!updatedTask) {
        throw AppError.notFound(`Task with id "${taskId}" was not found in this project`);
      }

      res.status(200).json({ data: updatedTask });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/projects/:projectId/tasks/:taskId
router.delete(
  '/:taskId',
  validate(taskParamsSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, taskId } = req.params;
      await assertProjectExists(projectId!);

      const deleted = await store.deleteTask(projectId!, taskId!);
      if (!deleted) {
        throw AppError.notFound(`Task with id "${taskId}" was not found in this project`);
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export const taskRoutes = router;
```

---

### `src/routes/index.ts`

```typescript
import { Router } from 'express';
import { healthRoutes } from './health.routes';
import { projectRoutes } from './project.routes';
import { taskRoutes } from './task.routes';
import { authenticate } from '../middlewares/auth';

const apiV1Router = Router();

// Unauthenticated routes
apiV1Router.use('/health', healthRoutes);

// Authenticated routes
apiV1Router.use('/projects', authenticate, projectRoutes);
apiV1Router.use('/projects/:projectId/tasks', authenticate, taskRoutes);

export { apiV1Router };
```

---

### `src/app.ts`

```typescript
import express, { Application } from 'express';
import cors from 'cors';
import { config } from './config';
import { requestLogger } from './middlewares/logger';
import { notFoundHandler, globalErrorHandler } from './middlewares/errorHandler';
import { apiV1Router } from './routes';

export function createApp(): Application {
  const app = express();

  // Basic security and parsing middlewares
  app.disable('x-powered-by');

  // CORS support with preflight handling
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
      maxAge: 86400,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Request logging middleware
  app.use(requestLogger);

  // Mount API v1
  app.use('/api/v1', apiV1Router);

  // Fallback 404 for unknown routes
  app.use(notFoundHandler);

  // Centralized Error Handling
  app.use(globalErrorHandler);

  return app;
}
```

---

### `src/server.ts`

```typescript
import { createApp } from './app';
import { config } from './config';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[SERVER] Task Board API running on http://localhost:${config.port}`);
  console.log(`[SERVER] Environment: ${config.nodeEnv}`);
});

// Graceful shutdown handling
const shutdown = (signal: string) => {
  console.log(`\n[SERVER] Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    console.log('[SERVER] HTTP server closed. Process terminating cleanly.');
    process.exit(0);
  });

  // Force close if ongoing requests hang
  setTimeout(() => {
    console.error('[SERVER] Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

### Running the API

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run in development mode** (hot-reloading with `tsx`):
   ```bash
   npm run dev
   ```

3. **Build & Run production**:
   ```bash
   npm run build
   npm start
   ```

4. **Example cURL Requests**:
   ```bash
   # 1. Health check (No Auth)
   curl -i http://localhost:3000/api/v1/health

   # 2. Create a project (Requires Auth)
   curl -i -X POST http://localhost:3000/api/v1/projects \
     -H "Authorization: Bearer secret-task-board-token-123" \
     -H "Content-Type: application/json" \
     -d '{"name": "Infrastructure Migration"}'

   # 3. Create a task in the project
   curl -i -X POST http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks \
     -H "Authorization: Bearer secret-task-board-token-123" \
     -H "Content-Type: application/json" \
     -d '{"title": "Setup VPC Peering", "status": "todo", "assignee": "alice"}'

   # 4. List tasks with filtering & pagination
   curl -i "http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks?status=todo&page=1&pageSize=10" \
     -H "Authorization: Bearer secret-task-board-token-123"
   ```