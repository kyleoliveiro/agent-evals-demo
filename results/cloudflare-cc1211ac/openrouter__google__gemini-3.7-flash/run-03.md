<!-- model: openrouter/google/gemini-3.7-flash | run: 3 | framework: Hono -->

Here is a complete, production-ready REST API for Cloudflare Workers built with TypeScript, [Hono](https://hono.dev), [Zod](https://zod.dev), and Cloudflare KV.

---

### Project Structure

```text
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── src/
    ├── index.ts
    ├── types.ts
    ├── schemas.ts
    ├── middleware/
    │   ├── auth.ts
    │   ├── logger.ts
    │   └── errorHandler.ts
    ├── services/
    │   └── storage.ts
    └── routes/
        ├── health.ts
        ├── projects.ts
        └── tasks.ts
```

---

### 1. `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Production-ready Team Task Board REST API on Cloudflare Workers",
  "main": "src/index.ts",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/zod-validator": "^0.4.2",
    "hono": "^4.6.14",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241230.0",
    "typescript": "^5.7.2",
    "wrangler": "^3.99.0"
  }
}
```

---

### 2. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

---

### 3. `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "team-task-board-api",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-30",
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [
    {
      "binding": "TASKS",
      "id": "YOUR_KV_NAMESPACE_ID",
      "preview_id": "YOUR_PREVIEW_KV_NAMESPACE_ID"
    }
  ],
  "vars": {
    "ENVIRONMENT": "production"
  }
}
```

> **Note:** Set the `API_TOKEN` secret using `npx wrangler secret put API_TOKEN` or define it in `.dev.vars` for local development.

---

### 4. `src/types.ts`

```typescript
export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
  ENVIRONMENT?: string;
}

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

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

---

### 5. `src/schemas.ts`

```typescript
import { z } from 'zod';

export const TaskStatusEnum = z.enum(['todo', 'in_progress', 'done']);

// Project Schemas
export const CreateProjectSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name must be 100 characters or fewer'),
});

// Task Schemas
export const CreateTaskSchema = z.object({
  title: z
    .string({ required_error: 'Title is required' })
    .trim()
    .min(1, 'Title cannot be empty')
    .max(200, 'Title must be 200 characters or fewer'),
  description: z.string().trim().max(2000, 'Description must be 2000 characters or fewer').optional(),
  status: TaskStatusEnum.default('todo'),
  assignee: z.string().trim().max(100, 'Assignee must be 100 characters or fewer').optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Title cannot be empty').max(200).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    status: TaskStatusEnum.optional(),
    assignee: z.string().trim().max(100).optional().nullable(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field (title, description, status, or assignee) must be provided for update' }
  );

// Query Schemas
export const ListTasksQuerySchema = z.object({
  status: TaskStatusEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type ListTasksQueryInput = z.infer<typeof ListTasksQuerySchema>;
```

---

### 6. `src/services/storage.ts`

```typescript
import { Project, Task, TaskStatus } from '../types';

/**
 * Key Patterns in KV:
 * - Project: `project:${projectId}`
 * - Task:    `task:${projectId}:${taskId}`
 */
export class StorageService {
  constructor(private kv: KVNamespace) {}

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  async getProject(projectId: string): Promise<Project | null> {
    const raw = await this.kv.get(`project:${projectId}`, 'text');
    if (!raw) return null;
    return JSON.parse(raw) as Project;
  }

  async listProjects(): Promise<Project[]> {
    const listResult = await this.kv.list({ prefix: 'project:' });
    if (listResult.keys.length === 0) return [];

    const projects = await Promise.all(
      listResult.keys.map(async (key) => {
        const data = await this.kv.get(key.name, 'text');
        return data ? (JSON.parse(data) as Project) : null;
      })
    );

    return projects
      .filter((p): p is Project => p !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createProject(name: string): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };

    await this.kv.put(`project:${project.id}`, JSON.stringify(project));
    return project;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const project = await this.getProject(projectId);
    if (!project) return false;

    // Cascade delete all tasks associated with this project
    const taskList = await this.kv.list({ prefix: `task:${projectId}:` });
    const deletePromises = taskList.keys.map((k) => this.kv.delete(k.name));
    deletePromises.push(this.kv.delete(`project:${projectId}`));

    await Promise.all(deletePromises);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    const raw = await this.kv.get(`task:${projectId}:${taskId}`, 'text');
    if (!raw) return null;
    return JSON.parse(raw) as Task;
  }

  async listTasks(
    projectId: string,
    filter?: { status?: TaskStatus; page?: number; pageSize?: number }
  ): Promise<{ tasks: Task[]; total: number }> {
    const listResult = await this.kv.list({ prefix: `task:${projectId}:` });
    if (listResult.keys.length === 0) {
      return { tasks: [], total: 0 };
    }

    const tasksRaw = await Promise.all(
      listResult.keys.map(async (key) => {
        const data = await this.kv.get(key.name, 'text');
        return data ? (JSON.parse(data) as Task) : null;
      })
    );

    let allTasks = tasksRaw
      .filter((t): t is Task => t !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filter?.status) {
      allTasks = allTasks.filter((t) => t.status === filter.status);
    }

    const total = allTasks.length;
    const page = filter?.page ?? 1;
    const pageSize = filter?.pageSize ?? 20;
    const startIndex = (page - 1) * pageSize;
    const paginatedTasks = allTasks.slice(startIndex, startIndex + pageSize);

    return {
      tasks: paginatedTasks,
      total,
    };
  }

  async createTask(
    projectId: string,
    data: { title: string; description?: string; status?: TaskStatus; assignee?: string }
  ): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      projectId,
      title: data.title,
      description: data.description,
      status: data.status ?? 'todo',
      assignee: data.assignee,
      createdAt: now,
      updatedAt: now,
    };

    await this.kv.put(`task:${projectId}:${task.id}`, JSON.stringify(task));
    return task;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    updates: {
      title?: string;
      description?: string | null;
      status?: TaskStatus;
      assignee?: string | null;
    }
  ): Promise<Task | null> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return null;

    const updatedTask: Task = {
      ...existing,
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.description !== undefined && {
        description: updates.description === null ? undefined : updates.description,
      }),
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.assignee !== undefined && {
        assignee: updates.assignee === null ? undefined : updates.assignee,
      }),
      updatedAt: new Date().toISOString(),
    };

    await this.kv.put(`task:${projectId}:${taskId}`, JSON.stringify(updatedTask));
    return updatedTask;
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;

    await this.kv.delete(`task:${projectId}:${taskId}`);
    return true;
  }
}
```

---

### 7. `src/middleware/auth.ts`

```typescript
import { createMiddleware } from 'hono/factory';
import { Env } from '../types';

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const expectedToken = c.env.API_TOKEN;

  if (!expectedToken) {
    return c.json(
      {
        error: {
          code: 'SERVER_CONFIGURATION_ERROR',
          message: 'API_TOKEN is not configured on the server',
        },
      },
      500
    );
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header. Expected Bearer token.',
        },
      },
      401
    );
  }

  const token = authHeader.slice(7).trim();

  if (!timingSafeEqual(token, expectedToken)) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API token provided',
        },
      },
      401
    );
  }

  await next();
});
```

---

### 8. `src/middleware/logger.ts`

```typescript
import { createMiddleware } from 'hono/factory';
import { Env } from '../types';

export const requestLogger = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const start = performance.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const durationMs = (performance.now() - start).toFixed(2);
  const status = c.res.status;

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      method,
      path,
      status,
      duration: `${durationMs}ms`,
    })
  );
});
```

---

### 9. `src/middleware/errorHandler.ts`

```typescript
import { Context } from 'hono';
import { ZodError } from 'zod';

export function handleCustomError(err: Error, c: Context) {
  console.error('[Unhandled Error]', err);

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'Input validation failed',
          details: err.flatten().fieldErrors,
        },
      },
      400
    );
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'Malformed JSON payload in request body',
        },
      },
      400
    );
  }

  return c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal error occurred',
      },
    },
    500
  );
}

export function handleNotFound(c: Context) {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404
  );
}
```

---

### 10. `src/routes/health.ts`

```typescript
import { Hono } from 'hono';
import { Env } from '../types';

export const healthRouter = new Hono<{ Bindings: Env }>();

healthRouter.get('/', (c) => {
  return c.json({ ok: true });
});
```

---

### 11. `src/routes/projects.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Env } from '../types';
import { StorageService } from '../services/storage';
import { CreateProjectSchema } from '../schemas';

export const projectsRouter = new Hono<{ Bindings: Env }>();

// GET /api/v1/projects - List all projects
projectsRouter.get('/', async (c) => {
  const storage = new StorageService(c.env.TASKS);
  const projects = await storage.listProjects();
  return c.json({ data: projects });
});

// POST /api/v1/projects - Create a new project
projectsRouter.post(
  '/',
  zValidator('json', CreateProjectSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Validation failed',
            details: result.error.flatten().fieldErrors,
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const body = c.req.valid('json');
    const storage = new StorageService(c.env.TASKS);
    const project = await storage.createProject(body.name);
    return c.json({ data: project }, 201);
  }
);

// GET /api/v1/projects/:projectId - Get single project
projectsRouter.get('/:projectId', async (c) => {
  const projectId = c.req.param('projectId');
  const storage = new StorageService(c.env.TASKS);
  const project = await storage.getProject(projectId);

  if (!project) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Project with ID '${projectId}' was not found`,
        },
      },
      404
    );
  }

  return c.json({ data: project });
});

// DELETE /api/v1/projects/:projectId - Delete project & cascaded tasks
projectsRouter.delete('/:projectId', async (c) => {
  const projectId = c.req.param('projectId');
  const storage = new StorageService(c.env.TASKS);
  const deleted = await storage.deleteProject(projectId);

  if (!deleted) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Project with ID '${projectId}' was not found`,
        },
      },
      404
    );
  }

  return c.json({ data: { message: 'Project and associated tasks deleted successfully' } });
});
```

---

### 12. `src/routes/tasks.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Env } from '../types';
import { StorageService } from '../services/storage';
import { CreateTaskSchema, UpdateTaskSchema, ListTasksQuerySchema } from '../schemas';

export const tasksRouter = new Hono<{ Bindings: Env }>();

// Middleware to ensure the parent project exists for all sub-routes
tasksRouter.use('/:projectId/*', async (c, next) => {
  const projectId = c.req.param('projectId');
  const storage = new StorageService(c.env.TASKS);
  const project = await storage.getProject(projectId);

  if (!project) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Project with ID '${projectId}' was not found`,
        },
      },
      404
    );
  }

  await next();
});

// GET /api/v1/projects/:projectId/tasks - List tasks with pagination and status filter
tasksRouter.get(
  '/:projectId/tasks',
  zValidator('query', ListTasksQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid query parameters',
            details: result.error.flatten().fieldErrors,
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const projectId = c.req.param('projectId');
    const { status, page, pageSize } = c.req.valid('query');
    const storage = new StorageService(c.env.TASKS);

    const { tasks, total } = await storage.listTasks(projectId, { status, page, pageSize });
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 1 : 0);

    return c.json({
      data: tasks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  }
);

// POST /api/v1/projects/:projectId/tasks - Create task under project
tasksRouter.post(
  '/:projectId/tasks',
  zValidator('json', CreateTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Validation failed',
            details: result.error.flatten().fieldErrors,
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const projectId = c.req.param('projectId');
    const body = c.req.valid('json');
    const storage = new StorageService(c.env.TASKS);

    const task = await storage.createTask(projectId, body);
    return c.json({ data: task }, 201);
  }
);

// GET /api/v1/projects/:projectId/tasks/:taskId - Get single task
tasksRouter.get('/:projectId/tasks/:taskId', async (c) => {
  const { projectId, taskId } = c.req.param();
  const storage = new StorageService(c.env.TASKS);
  const task = await storage.getTask(projectId, taskId);

  if (!task) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Task with ID '${taskId}' was not found in project '${projectId}'`,
        },
      },
      404
    );
  }

  return c.json({ data: task });
});

// PATCH /api/v1/projects/:projectId/tasks/:taskId - Partial update task
tasksRouter.patch(
  '/:projectId/tasks/:taskId',
  zValidator('json', UpdateTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Validation failed',
            details: result.error.flatten().fieldErrors,
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const { projectId, taskId } = c.req.param();
    const body = c.req.valid('json');
    const storage = new StorageService(c.env.TASKS);

    const updatedTask = await storage.updateTask(projectId, taskId, body);

    if (!updatedTask) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Task with ID '${taskId}' was not found in project '${projectId}'`,
          },
        },
        404
      );
    }

    return c.json({ data: updatedTask });
  }
);

// DELETE /api/v1/projects/:projectId/tasks/:taskId - Delete task
tasksRouter.delete('/:projectId/tasks/:taskId', async (c) => {
  const { projectId, taskId } = c.req.param();
  const storage = new StorageService(c.env.TASKS);
  const deleted = await storage.deleteTask(projectId, taskId);

  if (!deleted) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Task with ID '${taskId}' was not found in project '${projectId}'`,
        },
      },
      404
    );
  }

  return c.json({ data: { message: 'Task deleted successfully' } });
});
```

---

### 13. `src/index.ts`

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { requestLogger } from './middleware/logger';
import { authMiddleware } from './middleware/auth';
import { handleCustomError, handleNotFound } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { projectsRouter } from './routes/projects';
import { tasksRouter } from './routes/tasks';

const app = new Hono<{ Bindings: Env }>();

// 1. Global Request Logger (logs method, path, status, duration for every request)
app.use('*', requestLogger);

// 2. CORS Support (including automatic OPTIONS preflight handling)
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

// 3. Mount API v1 router
const api = new Hono<{ Bindings: Env }>();

// Public route: Health Check
api.route('/health', healthRouter);

// Protected routes: Require Bearer token authentication
api.use('/projects/*', authMiddleware);
api.use('/projects', authMiddleware);

api.route('/projects', projectsRouter);
api.route('/projects', tasksRouter);

// Mount under base prefix /api/v1
app.route('/api/v1', api);

// 4. Global 404 & Error Handling
app.notFound(handleNotFound);
app.onError(handleCustomError);

export default app;
```

---

### 14. Local Development & Deployment

#### 1. Setup Local Environment
Create a `.dev.vars` file for local development tokens:
```bash
echo 'API_TOKEN="my-secret-token"' > .dev.vars
```

#### 2. Run Locally
```bash
npm install
npm run dev
```

#### 3. Deploy to Cloudflare
```bash
# Create the KV namespace on Cloudflare
npx wrangler kv:namespace create TASKS

# Update the `id` in wrangler.jsonc with the generated namespace ID

# Set your API token secret in Cloudflare
npx wrangler secret put API_TOKEN

# Deploy
npm run deploy
```

---

### 15. Example API Requests

```bash
# Health check (public)
curl http://localhost:8787/api/v1/health

# Create a project (authenticated)
curl -X POST http://localhost:8787/api/v1/projects \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"name": "Frontend Redesign"}'

# Create a task
curl -X POST http://localhost:8787/api/v1/projects/<PROJECT_ID>/tasks \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build Kanban component",
    "description": "Implement drag-and-drop task cards",
    "status": "in_progress",
    "assignee": "Alex"
  }'

# List tasks with filters & pagination
curl "http://localhost:8787/api/v1/projects/<PROJECT_ID>/tasks?status=in_progress&page=1&pageSize=10" \
  -H "Authorization: Bearer my-secret-token"

# Partial update task
curl -X PATCH http://localhost:8787/api/v1/projects/<PROJECT_ID>/tasks/<TASK_ID> \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
```