<!-- model: openrouter/google/gemini-3.7-flash | run: 2 | framework: Express -->

Here is the complete production-ready REST API implementation in TypeScript using Express, Zod for validation, and a decoupled storage layer.

### Project Structure

```
.
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── src
    ├── config.ts
    ├── server.ts
    ├── app.ts
    ├── types
    │   └── index.ts
    ├── errors
    │   └── app-error.ts
    ├── storage
    │   ├── store.interface.ts
    │   └── memory-store.ts
    ├── schemas
    │   ├── common.schema.ts
    │   ├── project.schema.ts
    │   └── task.schema.ts
    ├── middlewares
    │   ├── auth.ts
    │   ├── cors.ts
    │   ├── error-handler.ts
    │   ├── logger.ts
    │   └── validate.ts
    ├── controllers
    │   ├── project.controller.ts
    │   └── task.controller.ts
    └── routes
        ├── index.ts
        ├── health.route.ts
        ├── project.route.ts
        └── task.route.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready REST API for a team task board backend",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "tsx": "^4.16.0",
    "typescript": "^5.5.2"
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
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `.env.example`

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
API_TOKEN=super-secret-production-token-123
CORS_ORIGIN=*
```

---

### `src/config.ts`

```typescript
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_TOKEN: z.string().min(1, 'API_TOKEN environment variable is required'),
  CORS_ORIGIN: z.string().default('*')
});

const parseConfig = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:', result.error.format());
    process.exit(1);
  }
  return result.data;
};

export const config = parseConfig();
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

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface TaskFilterParams extends PaginationParams {
  status?: TaskStatus;
}

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

---

### `src/errors/app-error.ts`

```typescript
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
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

export class MethodNotAllowedError extends AppError {
  constructor(message = 'Method not allowed') {
    super(405, 'METHOD_NOT_ALLOWED', message);
  }
}
```

---

### `src/storage/store.interface.ts`

```typescript
import { Project, Task, TaskFilterParams, PaginatedResult } from '../types/index.js';

export interface CreateProjectDTO {
  name: string;
}

export interface CreateTaskDTO {
  projectId: string;
  title: string;
  description?: string;
  status?: Task['status'];
  assignee?: string;
}

export interface UpdateTaskDTO {
  title?: string;
  description?: string | null;
  status?: Task['status'];
  assignee?: string | null;
}

export interface IStore {
  // Projects
  createProject(data: CreateProjectDTO): Promise<Project>;
  getProjectById(id: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  deleteProject(id: string): Promise<boolean>;

  // Tasks
  createTask(data: CreateTaskDTO): Promise<Task>;
  getTaskById(projectId: string, taskId: string): Promise<Task | null>;
  listTasks(projectId: string, filters: TaskFilterParams): Promise<PaginatedResult<Task>>;
  updateTask(projectId: string, taskId: string, updates: UpdateTaskDTO): Promise<Task | null>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;
}
```

---

### `src/storage/memory-store.ts`

```typescript
import { randomUUID } from 'crypto';
import { Project, Task, PaginatedResult, TaskFilterParams } from '../types/index.js';
import { CreateProjectDTO, CreateTaskDTO, IStore, UpdateTaskDTO } from './store.interface.js';

export class MemoryStore implements IStore {
  private projects: Map<string, Project> = new Map();
  private tasks: Map<string, Task> = new Map();

  async createProject(data: CreateProjectDTO): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: data.name,
      createdAt: new Date().toISOString()
    };
    this.projects.set(project.id, project);
    return { ...project };
  }

  async getProjectById(id: string): Promise<Project | null> {
    const project = this.projects.get(id);
    return project ? { ...project } : null;
  }

  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).map((p) => ({ ...p }));
  }

  async deleteProject(id: string): Promise<boolean> {
    if (!this.projects.has(id)) {
      return false;
    }

    // Cascade delete associated tasks
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.projectId === id) {
        this.tasks.delete(taskId);
      }
    }

    this.projects.delete(id);
    return true;
  }

  async createTask(data: CreateTaskDTO): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      status: data.status ?? 'todo',
      assignee: data.assignee,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  async getTaskById(projectId: string, taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return null;
    }
    return { ...task };
  }

  async listTasks(projectId: string, filters: TaskFilterParams): Promise<PaginatedResult<Task>> {
    let tasks = Array.from(this.tasks.values()).filter((t) => t.projectId === projectId);

    if (filters.status) {
      tasks = tasks.filter((t) => t.status === filters.status);
    }

    // Sort by createdAt descending
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = tasks.length;
    const page = filters.page;
    const pageSize = filters.pageSize;
    const totalPages = Math.ceil(total / pageSize) || 1;

    const offset = (page - 1) * pageSize;
    const paginatedData = tasks.slice(offset, offset + pageSize).map((t) => ({ ...t }));

    return {
      data: paginatedData,
      pagination: {
        total,
        page,
        pageSize,
        totalPages
      }
    };
  }

  async updateTask(projectId: string, taskId: string, updates: UpdateTaskDTO): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.projectId !== projectId) {
      return null;
    }

    const updatedTask: Task = {
      ...task,
      title: updates.title !== undefined ? updates.title : task.title,
      description: updates.description !== undefined ? (updates.description ?? undefined) : task.description,
      status: updates.status !== undefined ? updates.status : task.status,
      assignee: updates.assignee !== undefined ? (updates.assignee ?? undefined) : task.assignee,
      updatedAt: new Date().toISOString()
    };

    this.tasks.set(taskId, updatedTask);
    return { ...updatedTask };
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

---

### `src/schemas/common.schema.ts`

```typescript
import { z } from 'zod';

export const uuidParamSchema = (paramName: string) =>
  z.object({
    [paramName]: z.string().uuid(`Invalid ${paramName} format. Must be a valid UUID.`)
  });
```

---

### `src/schemas/project.schema.ts`

```typescript
import { z } from 'zod';

export const createProjectSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters')
  })
});

export const projectParamsSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Invalid projectId format')
  })
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>['body'];
```

---

### `src/schemas/task.schema.ts`

```typescript
import { z } from 'zod';

export const taskStatusEnum = z.enum(['todo', 'in_progress', 'done']);

export const createTaskSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Invalid projectId format')
  }),
  body: z.object({
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title cannot exceed 200 characters'),
    description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').optional(),
    status: taskStatusEnum.default('todo'),
    assignee: z.string().trim().max(100, 'Assignee name cannot exceed 100 characters').optional()
  })
});

export const updateTaskSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Invalid projectId format'),
    taskId: z.string().uuid('Invalid taskId format')
  }),
  body: z
    .object({
      title: z.string().trim().min(1, 'Title cannot be empty').max(200, 'Title cannot exceed 200 characters').optional(),
      description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').nullable().optional(),
      status: taskStatusEnum.optional(),
      assignee: z.string().trim().max(100, 'Assignee cannot exceed 100 characters').nullable().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field (title, description, status, or assignee) must be provided for update'
    })
});

export const getTaskParamsSchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Invalid projectId format'),
    taskId: z.string().uuid('Invalid taskId format')
  })
});

export const listTasksQuerySchema = z.object({
  params: z.object({
    projectId: z.string().uuid('Invalid projectId format')
  }),
  query: z.object({
    status: taskStatusEnum.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20)
  })
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>['body'];
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>['body'];
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>['query'];
```

---

### `src/middlewares/logger.ts`

```typescript
import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    const formattedDuration = durationMs.toFixed(2);
    const { method, originalUrl } = req;
    const { statusCode } = res;

    const logMessage = `[${new Date().toISOString()}] ${method} ${originalUrl} ${statusCode} - ${formattedDuration}ms`;
    
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

### `src/middlewares/cors.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.header('Access-Control-Allow-Origin', config.CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
}
```

---

### `src/middlewares/auth.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../errors/app-error.js';
import { config } from '../config.js';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next(new UnauthorizedError('Missing Authorization header'));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next(new UnauthorizedError('Invalid Authorization header format. Expected "Bearer <token>"'));
  }

  const token = parts[1];
  if (token !== config.API_TOKEN) {
    return next(new UnauthorizedError('Invalid API token'));
  }

  next();
}
```

---

### `src/middlewares/validate.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '../errors/app-error.js';

export const validate = (schema: AnyZodObject) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      });

      // Assign parsed/coerced values back
      if (parsed.body) req.body = parsed.body;
      if (parsed.query) req.query = parsed.query;
      if (parsed.params) req.params = parsed.params;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message
        }));
        return next(new ValidationError('Request validation failed', issues));
      }
      next(error);
    }
  };
};
```

---

### `src/middlewares/error-handler.ts`

```typescript
import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError, NotFoundError } from '../errors/app-error.js';
import { ErrorResponseBody } from '../types/index.js';

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};

export const errorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response<ErrorResponseBody>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {})
      }
    });
    return;
  }

  // Handle standard JSON parse errors from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid JSON payload in request body'
      }
    });
    return;
  }

  // Unexpected internal server errors
  console.error('[Unhandled Error]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred on the server'
    }
  });
};
```

---

### `src/controllers/project.controller.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { IStore } from '../storage/store.interface.js';
import { NotFoundError } from '../errors/app-error.js';

export class ProjectController {
  constructor(private readonly store: IStore) {}

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
      const project = await this.store.createProject({ name: req.body.name });
      res.status(201).json({ data: project });
    } catch (error) {
      next(error);
    }
  };

  getProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const project = await this.store.getProjectById(req.params.projectId);
      if (!project) {
        throw new NotFoundError(`Project with id '${req.params.projectId}' was not found`);
      }
      res.status(200).json({ data: project });
    } catch (error) {
      next(error);
    }
  };

  deleteProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deleted = await this.store.deleteProject(req.params.projectId);
      if (!deleted) {
        throw new NotFoundError(`Project with id '${req.params.projectId}' was not found`);
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
import { Request, Response, NextFunction } from 'express';
import { IStore } from '../storage/store.interface.js';
import { NotFoundError } from '../errors/app-error.js';

export class TaskController {
  constructor(private readonly store: IStore) {}

  private async ensureProjectExists(projectId: string): Promise<void> {
    const project = await this.store.getProjectById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with id '${projectId}' was not found`);
    }
  }

  listTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId } = req.params;
      await this.ensureProjectExists(projectId);

      const status = req.query.status as any;
      const page = Number(req.query.page) || 1;
      const pageSize = Number(req.query.pageSize) || 20;

      const result = await this.store.listTasks(projectId, { status, page, pageSize });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  createTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId } = req.params;
      await this.ensureProjectExists(projectId);

      const task = await this.store.createTask({
        projectId,
        title: req.body.title,
        description: req.body.description,
        status: req.body.status,
        assignee: req.body.assignee
      });

      res.status(201).json({ data: task });
    } catch (error) {
      next(error);
    }
  };

  getTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId, taskId } = req.params;
      await this.ensureProjectExists(projectId);

      const task = await this.store.getTaskById(projectId, taskId);
      if (!task) {
        throw new NotFoundError(`Task with id '${taskId}' was not found in project '${projectId}'`);
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

      const updatedTask = await this.store.updateTask(projectId, taskId, req.body);
      if (!updatedTask) {
        throw new NotFoundError(`Task with id '${taskId}' was not found in project '${projectId}'`);
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
        throw new NotFoundError(`Task with id '${taskId}' was not found in project '${projectId}'`);
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
```

---

### `src/routes/health.route.ts`

```typescript
import { Router } from 'express';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return router;
}
```

---

### `src/routes/project.route.ts`

```typescript
import { Router } from 'express';
import { ProjectController } from '../controllers/project.controller.js';
import { validate } from '../middlewares/validate.js';
import { createProjectSchema, projectParamsSchema } from '../schemas/project.schema.js';

export function createProjectRouter(controller: ProjectController): Router {
  const router = Router();

  router.get('/', controller.listProjects);
  router.post('/', validate(createProjectSchema), controller.createProject);
  router.get('/:projectId', validate(projectParamsSchema), controller.getProject);
  router.delete('/:projectId', validate(projectParamsSchema), controller.deleteProject);

  return router;
}
```

---

### `src/routes/task.route.ts`

```typescript
import { Router } from 'express';
import { TaskController } from '../controllers/task.controller.js';
import { validate } from '../middlewares/validate.js';
import {
  createTaskSchema,
  getTaskParamsSchema,
  listTasksQuerySchema,
  updateTaskSchema
} from '../schemas/task.schema.js';

export function createTaskRouter(controller: TaskController): Router {
  const router = Router({ mergeParams: true });

  router.get('/', validate(listTasksQuerySchema), controller.listTasks);
  router.post('/', validate(createTaskSchema), controller.createTask);
  router.get('/:taskId', validate(getTaskParamsSchema), controller.getTask);
  router.patch('/:taskId', validate(updateTaskSchema), controller.updateTask);
  router.delete('/:taskId', validate(getTaskParamsSchema), controller.deleteTask);

  return router;
}
```

---

### `src/routes/index.ts`

```typescript
import { Router } from 'express';
import { IStore } from '../storage/store.interface.js';
import { authenticate } from '../middlewares/auth.js';
import { createHealthRouter } from './health.route.js';
import { createProjectRouter } from './project.route.js';
import { createTaskRouter } from './task.route.js';
import { ProjectController } from '../controllers/project.controller.js';
import { TaskController } from '../controllers/task.controller.js';

export function createApiRouter(store: IStore): Router {
  const router = Router();

  const projectController = new ProjectController(store);
  const taskController = new TaskController(store);

  // Unauthenticated health check endpoint
  router.use(createHealthRouter());

  // Authenticated routes below this point
  router.use(authenticate);

  // Project routes
  router.use('/projects', createProjectRouter(projectController));

  // Nested Task routes mounted on /projects/:projectId/tasks
  router.use('/projects/:projectId/tasks', createTaskRouter(taskController));

  return router;
}
```

---

### `src/app.ts`

```typescript
import express, { Express } from 'express';
import { corsMiddleware } from './middlewares/cors.js';
import { requestLogger } from './middlewares/logger.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { createApiRouter } from './routes/index.js';
import { IStore } from './storage/store.interface.js';
import { MemoryStore } from './storage/memory-store.js';

export function createApp(store: IStore = new MemoryStore()): Express {
  const app = express();

  // Global Middlewares
  app.use(corsMiddleware);
  app.use(requestLogger);
  app.use(express.json());

  // Mount API v1 Router
  app.use('/api/v1', createApiRouter(store));

  // 404 Handler for undefined routes
  app.use(notFoundHandler);

  // Centralized JSON Error Handler
  app.use(errorHandler);

  return app;
}
```

---

### `src/server.ts`

```typescript
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`🚀 Team Task Board API is running on http://${config.HOST}:${config.PORT}`);
  console.log(`📡 Base path: http://${config.HOST}:${config.PORT}/api/v1`);
  console.log(`🔒 Authentication: Bearer Token required for all non-health routes`);
});

const gracefulShutdown = (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });

  // Force close if graceful shutdown takes too long
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
```

---

### `README.md`

```markdown
# Team Task Board API

A production-grade REST API backend for a Team Task Board built with Node.js, Express, TypeScript, and Zod.

## Requirements

- Node.js >= 18.0.0
- npm / pnpm / yarn

## Setup & Running

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Run in development mode:**
   ```bash
   npm run dev
   ```

4. **Build and run in production:**
   ```bash
   npm run build
   npm start
   ```

## Example cURL Requests

### 1. Health Check (No Auth Required)
```bash
curl -X GET http://localhost:3000/api/v1/health
```

### 2. Create a Project
```bash
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer super-secret-production-token-123" \
  -H "Content-Type: application/json" \
  -d '{"name": "Frontend Redesign"}'
```

### 3. List Projects
```bash
curl -X GET http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer super-secret-production-token-123"
```

### 4. Create a Task in Project
```bash
curl -X POST http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks \
  -H "Authorization: Bearer super-secret-production-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Design Figma Mockups",
    "description": "Create primary user flow screens",
    "status": "in_progress",
    "assignee": "Alex"
  }'
```

### 5. List Tasks with Pagination and Status Filter
```bash
curl -X GET "http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks?status=in_progress&page=1&pageSize=10" \
  -H "Authorization: Bearer super-secret-production-token-123"
```

### 6. Partial Update Task
```bash
curl -X PATCH http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks/<TASK_ID> \
  -H "Authorization: Bearer super-secret-production-token-123" \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
```

### 7. Delete Task
```bash
curl -X DELETE http://localhost:3000/api/v1/projects/<PROJECT_ID>/tasks/<TASK_ID> \
  -H "Authorization: Bearer super-secret-production-token-123"
```

### 8. Delete Project (Cascades to all project tasks)
```bash
curl -X DELETE http://localhost:3000/api/v1/projects/<PROJECT_ID> \
  -H "Authorization: Bearer super-secret-production-token-123"
```

## Error Shape

All validation failures, unauthorized requests, missing routes, and server errors adhere to a uniform JSON shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "body.name",
        "message": "Name is required"
      }
    ]
  }
}
```
```