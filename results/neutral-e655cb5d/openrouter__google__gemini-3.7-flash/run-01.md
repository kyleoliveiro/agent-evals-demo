<!-- model: openrouter/google/gemini-3.7-flash | run: 1 | framework: Express -->

Here is the complete, production-ready REST API implementation in TypeScript using Express and Zod.

### Project Structure

```
.
├── .env.example
├── package.json
├── tsconfig.json
└── src
    ├── app.ts
    ├── server.ts
    ├── config
    │   └── env.ts
    ├── errors
    │   └── app-error.ts
    ├── types
    │   └── index.ts
    ├── storage
    │   ├── store.interface.ts
    │   └── in-memory.store.ts
    ├── middleware
    │   ├── auth.middleware.ts
    │   ├── error.middleware.ts
    │   ├── logger.middleware.ts
    │   └── validate.middleware.ts
    ├── schemas
    │   ├── project.schema.ts
    │   └── task.schema.ts
    ├── controllers
    │   ├── health.controller.ts
    │   ├── project.controller.ts
    │   └── task.controller.ts
    └── routes
        ├── health.router.ts
        ├── project.router.ts
        ├── task.router.ts
        └── index.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready Team Task Board REST API",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.5.5",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2"
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
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
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
API_TOKEN=super-secret-production-token-12345
CORS_ORIGIN=*
```

---

### `src/types/index.ts`

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

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

---

### `src/config/env.ts`

```typescript
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive()),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_TOKEN: z
    .string()
    .min(1, 'API_TOKEN must be configured and cannot be empty'),
  CORS_ORIGIN: z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
```

---

### `src/errors/app-error.ts`

```typescript
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
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
  constructor(message = 'Method Not Allowed') {
    super(405, 'METHOD_NOT_ALLOWED', message);
  }
}
```

---

### `src/storage/store.interface.ts`

```typescript
import { PaginatedResult, Project, Task, TaskStatus } from '../types/index.js';

export interface CreateProjectInput {
  name: string;
}

export interface CreateTaskInput {
  projectId: string;
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

export interface TaskFilterOptions {
  status?: TaskStatus;
  page?: number;
  pageSize?: number;
}

export interface ITaskBoardStore {
  // Project operations
  listProjects(): Promise<Project[]>;
  getProjectById(id: string): Promise<Project | null>;
  createProject(input: CreateProjectInput): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;

  // Task operations
  listTasksByProject(projectId: string, options?: TaskFilterOptions): Promise<PaginatedResult<Task>>;
  getTaskById(projectId: string, taskId: string): Promise<Task | null>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task | null>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

---

### `src/storage/in-memory.store.ts`

```typescript
import { randomUUID } from 'node:crypto';
import { PaginatedResult, Project, Task } from '../types/index.js';
import {
  CreateProjectInput,
  CreateTaskInput,
  ITaskBoardStore,
  TaskFilterOptions,
  UpdateTaskInput,
} from './store.interface.js';

export class InMemoryStore implements ITaskBoardStore {
  private projects: Map<string, Project> = new Map();
  private tasks: Map<string, Task> = new Map();

  // Projects
  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getProjectById(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
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

    // Cascade delete associated tasks
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.projectId === id) {
        this.tasks.delete(taskId);
      }
    }
    return true;
  }

  // Tasks
  async listTasksByProject(
    projectId: string,
    options: TaskFilterOptions = {}
  ): Promise<PaginatedResult<Task>> {
    const { status, page = 1, pageSize = 10 } = options;

    let projectTasks = Array.from(this.tasks.values()).filter(
      (task) => task.projectId === projectId
    );

    if (status) {
      projectTasks = projectTasks.filter((task) => task.status === status);
    }

    // Sort newest first
    projectTasks.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = projectTasks.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const startIndex = (page - 1) * pageSize;
    const paginatedData = projectTasks.slice(startIndex, startIndex + pageSize);

    return {
      data: paginatedData.map((t) => ({ ...t })),
      pagination: {
        page,
        pageSize,
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

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: input.status ?? 'todo',
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  async updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return null;
    }

    const updatedTask: Task = {
      ...task,
      title: input.title !== undefined ? input.title : task.title,
      description:
        input.description !== undefined
          ? input.description === null
            ? undefined
            : input.description
          : task.description,
      status: input.status !== undefined ? input.status : task.status,
      assignee:
        input.assignee !== undefined
          ? input.assignee === null
            ? undefined
            : input.assignee
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

// Global store singleton
export const defaultStore: ITaskBoardStore = new InMemoryStore();
```

---

### `src/schemas/project.schema.ts`

```typescript
import { z } from 'zod';

export const createProjectSchema = z.object({
  body: z.object({
    name: z
      .string({ required_error: 'Project name is required' })
      .trim()
      .min(1, 'Project name cannot be empty')
      .max(100, 'Project name cannot exceed 100 characters'),
  }),
});

export const projectIdParamSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Project ID must be a valid UUID'),
  }),
});
```

---

### `src/schemas/task.schema.ts`

```typescript
import { z } from 'zod';

const taskStatusEnum = z.enum(['todo', 'in_progress', 'done'], {
  errorMap: () => ({ message: "Status must be 'todo', 'in_progress', or 'done'" }),
});

export const listTasksSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Project ID must be a valid UUID'),
  }),
  query: z.object({
    status: taskStatusEnum.optional(),
    page: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 1))
      .pipe(z.number().int().min(1, 'Page must be greater than or equal to 1')),
    pageSize: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 10))
      .pipe(
        z
          .number()
          .int()
          .min(1, 'Page size must be at least 1')
          .max(100, 'Page size cannot exceed 100')
      ),
  }),
});

export const createTaskSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Project ID must be a valid UUID'),
  }),
  body: z.object({
    title: z
      .string({ required_error: 'Task title is required' })
      .trim()
      .min(1, 'Task title cannot be empty')
      .max(255, 'Task title cannot exceed 255 characters'),
    description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').optional(),
    status: taskStatusEnum.optional(),
    assignee: z.string().trim().max(100, 'Assignee cannot exceed 100 characters').optional(),
  }),
});

export const taskParamsSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Project ID must be a valid UUID'),
    taskId: z.string().uuid('Task ID must be a valid UUID'),
  }),
});

export const updateTaskSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Project ID must be a valid UUID'),
    taskId: z.string().uuid('Task ID must be a valid UUID'),
  }),
  body: z
    .object({
      title: z
        .string()
        .trim()
        .min(1, 'Task title cannot be empty')
        .max(255, 'Task title cannot exceed 255 characters')
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
      message: 'At least one field (title, description, status, assignee) must be provided for update',
    }),
});
```

---

### `src/middleware/logger.middleware.ts`

```typescript
import { NextFunction, Request, Response } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startHrTime = process.hrtime();

  res.on('finish', () => {
    const elapsedHrTime = process.hrtime(startHrTime);
    const elapsedMs = (elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6).toFixed(2);
    const { method, originalUrl } = req;
    const { statusCode } = res;

    const logMessage = `[${new Date().toISOString()}] ${method} ${originalUrl} ${statusCode} - ${elapsedMs}ms`;
    if (statusCode >= 500) {
      console.error(logMessage);
    } else if (statusCode >= 400) {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  });

  next();
}
```

---

### `src/middleware/auth.middleware.ts`

```typescript
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../errors/app-error.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next(new UnauthorizedError('Missing Authorization header'));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next(
      new UnauthorizedError('Invalid Authorization format. Expected format: Bearer <token>')
    );
  }

  const token = parts[1];
  if (token !== env.API_TOKEN) {
    return next(new UnauthorizedError('Invalid authorization token'));
  }

  next();
}
```

---

### `src/middleware/validate.middleware.ts`

```typescript
import { NextFunction, Request, Response } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '../errors/app-error.js';

export function validate(schema: AnyZodObject) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Assign parsed & sanitized values back
      if (parsed.body) req.body = parsed.body;
      if (parsed.query) req.query = parsed.query;
      if (parsed.params) req.params = parsed.params;

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          field: e.path.filter((p) => p !== 'body' && p !== 'query' && p !== 'params').join('.'),
          location: e.path[0],
          message: e.message,
        }));
        next(new ValidationError('Request validation failed', details));
      } else {
        next(err);
      }
    }
  };
}
```

---

### `src/middleware/error.middleware.ts`

```typescript
import { NextFunction, Request, Response } from 'express';
import { AppError, NotFoundError } from '../errors/app-error.js';
import { ApiErrorResponse } from '../types/index.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response<ApiErrorResponse>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Handle express JSON body parsing syntax errors
  if ('type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid JSON payload received',
      },
    });
    return;
  }

  console.error('Unhandled internal error:', err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred',
    },
  });
}
```

---

### `src/controllers/health.controller.ts`

```typescript
import { Request, Response } from 'express';

export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({ ok: true });
}
```

---

### `src/controllers/project.controller.ts`

```typescript
import { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors/app-error.js';
import { ITaskBoardStore } from '../storage/store.interface.js';

export class ProjectController {
  constructor(private store: ITaskBoardStore) {}

  listProjects = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projects = await this.store.listProjects();
      res.status(200).json({ data: projects });
    } catch (error) {
      next(error);
    }
  };

  createProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name } = req.body;
      const project = await this.store.createProject({ name });
      res.status(201).json({ data: project });
    } catch (error) {
      next(error);
    }
  };

  getProjectById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId } = req.params;
      const project = await this.store.getProjectById(projectId);
      if (!project) {
        throw new NotFoundError(`Project with ID '${projectId}' not found`);
      }
      res.status(200).json({ data: project });
    } catch (error) {
      next(error);
    }
  };

  deleteProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId } = req.params;
      const deleted = await this.store.deleteProject(projectId);
      if (!deleted) {
        throw new NotFoundError(`Project with ID '${projectId}' not found`);
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
```

---

### `src/controllers/task.controller.ts`

```typescript
import { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors/app-error.js';
import { ITaskBoardStore } from '../storage/store.interface.js';
import { TaskStatus } from '../types/index.js';

export class TaskController {
  constructor(private store: ITaskBoardStore) {}

  private async ensureProjectExists(projectId: string): Promise<void> {
    const project = await this.store.getProjectById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
  }

  listTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId } = req.params;
      await this.ensureProjectExists(projectId);

      const status = req.query.status as TaskStatus | undefined;
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 10;

      const result = await this.store.listTasksByProject(projectId, {
        status,
        page,
        pageSize,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  createTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId } = req.params;
      await this.ensureProjectExists(projectId);

      const { title, description, status, assignee } = req.body;
      const task = await this.store.createTask({
        projectId,
        title,
        description,
        status,
        assignee,
      });

      res.status(201).json({ data: task });
    } catch (error) {
      next(error);
    }
  };

  getTaskById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId, taskId } = req.params;
      await this.ensureProjectExists(projectId);

      const task = await this.store.getTaskById(projectId, taskId);
      if (!task) {
        throw new NotFoundError(`Task with ID '${taskId}' not found in project '${projectId}'`);
      }

      res.status(200).json({ data: task });
    } catch (error) {
      next(error);
    }
  };

  updateTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId, taskId } = req.params;
      await this.ensureProjectExists(projectId);

      const { title, description, status, assignee } = req.body;
      const updatedTask = await this.store.updateTask(projectId, taskId, {
        title,
        description,
        status,
        assignee,
      });

      if (!updatedTask) {
        throw new NotFoundError(`Task with ID '${taskId}' not found in project '${projectId}'`);
      }

      res.status(200).json({ data: updatedTask });
    } catch (error) {
      next(error);
    }
  };

  deleteTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId, taskId } = req.params;
      await this.ensureProjectExists(projectId);

      const deleted = await this.store.deleteTask(projectId, taskId);
      if (!deleted) {
        throw new NotFoundError(`Task with ID '${taskId}' not found in project '${projectId}'`);
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
```

---

### `src/routes/health.router.ts`

```typescript
import { Router } from 'express';
import { getHealth } from '../controllers/health.controller.js';

export const healthRouter = Router();

healthRouter.get('/', getHealth);
```

---

### `src/routes/task.router.ts`

```typescript
import { Router } from 'express';
import { TaskController } from '../controllers/task.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createTaskSchema,
  listTasksSchema,
  taskParamsSchema,
  updateTaskSchema,
} from '../schemas/task.schema.js';
import { ITaskBoardStore } from '../storage/store.interface.js';

export function createTaskRouter(store: ITaskBoardStore): Router {
  const router = Router({ mergeParams: true });
  const controller = new TaskController(store);

  router.get('/', validate(listTasksSchema), controller.listTasks);
  router.post('/', validate(createTaskSchema), controller.createTask);
  router.get('/:taskId', validate(taskParamsSchema), controller.getTaskById);
  router.patch('/:taskId', validate(updateTaskSchema), controller.updateTask);
  router.delete('/:taskId', validate(taskParamsSchema), controller.deleteTask);

  return router;
}
```

---

### `src/routes/project.router.ts`

```typescript
import { Router } from 'express';
import { ProjectController } from '../controllers/project.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { createProjectSchema, projectIdParamSchema } from '../schemas/project.schema.js';
import { ITaskBoardStore } from '../storage/store.interface.js';
import { createTaskRouter } from './task.router.js';

export function createProjectRouter(store: ITaskBoardStore): Router {
  const router = Router();
  const controller = new ProjectController(store);

  // Projects CRUD
  router.get('/', controller.listProjects);
  router.post('/', validate(createProjectSchema), controller.createProject);
  router.get('/:projectId', validate(projectIdParamSchema), controller.getProjectById);
  router.delete('/:projectId', validate(projectIdParamSchema), controller.deleteProject);

  // Nested Tasks router
  router.use('/:projectId/tasks', createTaskRouter(store));

  return router;
}
```

---

### `src/routes/index.ts`

```typescript
import { Router } from 'express';
import { MethodNotAllowedError } from '../errors/app-error.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { ITaskBoardStore } from '../storage/store.interface.js';
import { healthRouter } from './health.router.js';
import { createProjectRouter } from './project.router.js';

export function createApiRouter(store: ITaskBoardStore): Router {
  const apiRouter = Router();

  // Public routes (no auth required)
  apiRouter.use('/health', healthRouter);
  apiRouter.all('/health', (_req, _res, next) => {
    next(new MethodNotAllowedError('Only GET method is allowed on /health'));
  });

  // Protected routes (require Bearer token)
  apiRouter.use('/projects', requireAuth, createProjectRouter(store));

  return apiRouter;
}
```

---

### `src/app.ts`

```typescript
import cors from 'cors';
import express, { Express } from 'express';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { requestLogger } from './middleware/logger.middleware.js';
import { createApiRouter } from './routes/index.js';
import { defaultStore } from './storage/in-memory.store.js';
import { ITaskBoardStore } from './storage/store.interface.js';

export function createApp(store: ITaskBoardStore = defaultStore): Express {
  const app = express();

  // 1. Logging
  app.use(requestLogger);

  // 2. CORS (supporting preflight requests)
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    })
  );

  // 3. Body Parsing
  app.use(express.json());

  // 4. API Routes
  app.use('/api/v1', createApiRouter(store));

  // 5. 404 handler for unmatched routes
  app.use(notFoundHandler);

  // 6. Global error handler
  app.use(errorHandler);

  return app;
}
```

---

### `src/server.ts`

```typescript
import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Team Task Board API running on http://localhost:${env.PORT}`);
  console.log(`📡 Environment: ${env.NODE_ENV}`);
  console.log(`🩺 Health check: GET http://localhost:${env.PORT}/api/v1/health`);
});

// Graceful shutdown handling
const shutdown = (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed successfully.');
    process.exit(0);
  });

  // Force close if graceful shutdown takes too long
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

### How to Run

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Setup environment variables**:
   ```bash
   cp .env.example .env
   ```

3. **Start in development mode** (hot-reload):
   ```bash
   npm run dev
   ```

4. **Build and start in production mode**:
   ```bash
   npm run build
   npm start
   ```

---

### Example Requests

```bash
# Health check (public)
curl -X GET http://localhost:3000/api/v1/health

# Create project
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer super-secret-production-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"name": "Website Redesign"}'

# List projects
curl -X GET http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer super-secret-production-token-12345"

# Create task under project
curl -X POST http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks \
  -H "Authorization: Bearer super-secret-production-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"title": "Implement login page", "status": "todo", "assignee": "Alice"}'

# List tasks with filtering and pagination
curl -X GET "http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks?status=todo&page=1&pageSize=10" \
  -H "Authorization: Bearer super-secret-production-token-12345"

# Partial update task
curl -X PATCH http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks/<TASK_ID> \
  -H "Authorization: Bearer super-secret-production-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'

# Delete task
curl -X DELETE http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks/<TASK_ID> \
  -H "Authorization: Bearer super-secret-production-token-12345"

# Delete project (and all its tasks)
curl -X DELETE http://localhost:3000/api/v1/projects/<PROJECT_ID> \
  -H "Authorization: Bearer super-secret-production-token-12345"
```