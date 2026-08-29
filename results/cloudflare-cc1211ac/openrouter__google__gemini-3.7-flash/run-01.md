<!-- model: openrouter/google/gemini-3.7-flash | run: 1 | framework: Hono -->

Here is a complete, production-ready REST API for the team task board backend built on **Cloudflare Workers** using **TypeScript**, **Hono**, and **Zod**.

---

### File Structure

```
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── src/
    ├── types.ts
    ├── schemas.ts
    ├── middleware/
    │   ├── auth.ts
    │   └── logger.ts
    ├── services/
    │   └── storage.ts
    ├── routes/
    │   ├── health.ts
    │   ├── projects.ts
    │   └── tasks.ts
    └── index.ts
```

---

### `package.json`

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
    "hono": "^4.7.2",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250224.0",
    "typescript": "^5.7.3",
    "wrangler": "^3.111.0"
  }
}
```

---

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*"]
}
```

---

### `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "team-task-board-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-29",
  "kv_namespaces": [
    {
      "binding": "TASKS",
      "id": "YOUR_KV_NAMESPACE_ID_HERE",
      "preview_id": "YOUR_PREVIEW_KV_NAMESPACE_ID_HERE"
    }
  ],
  "vars": {
    "ENVIRONMENT": "production"
  }
}
```

> **Note:** Set your `API_TOKEN` secret in Cloudflare using `npx wrangler secret put API_TOKEN` or in `.dev.vars` during local development (`API_TOKEN=your-secret-token`).

---

### `src/types.ts`

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

export interface Env {
  TASKS: KVNamespace;
  API_TOKEN: string;
  ENVIRONMENT?: string;
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

### `src/schemas.ts`

```typescript
import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z
    .string({ required_error: 'Project name is required' })
    .trim()
    .min(1, 'Project name cannot be empty')
    .max(100, 'Project name must be 100 characters or fewer'),
});

export const CreateTaskSchema = z.object({
  title: z
    .string({ required_error: 'Task title is required' })
    .trim()
    .min(1, 'Task title cannot be empty')
    .max(200, 'Task title must be 200 characters or fewer'),
  description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').optional(),
  status: z.enum(['todo', 'in_progress', 'done'] as const).default('todo'),
  assignee: z.string().trim().max(100, 'Assignee name cannot exceed 100 characters').optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Task title cannot be empty').max(200).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    status: z.enum(['todo', 'in_progress', 'done'] as const).optional(),
    assignee: z.string().trim().max(100).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const TaskQuerySchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done'] as const).optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1)),
  pageSize: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
});
```

---

### `src/middleware/logger.ts`

```typescript
import { MiddlewareHandler } from 'hono';
import { Env } from '../types';

export const requestLogger: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const start = performance.now();
  const { method, path } = c.req;

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
};
```

---

### `src/middleware/auth.ts`

```typescript
import { MiddlewareHandler } from 'hono';
import { Env } from '../types';

export const bearerAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const path = c.req.path;

  // Allow unauthenticated access to health check endpoints
  if (path === '/health' || path === '/api/v1/health') {
    return next();
  }

  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header. Format: Bearer <token>',
        },
      },
      401
    );
  }

  const token = authHeader.slice(7).trim();
  const expectedToken = c.env.API_TOKEN;

  if (!expectedToken || token !== expectedToken) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API token',
        },
      },
      401
    );
  }

  await next();
};
```

---

### `src/services/storage.ts`

```typescript
import { Project, Task, TaskStatus } from '../types';

const PROJECT_PREFIX = 'project:';
const TASK_PREFIX = 'task:';

export class StorageService {
  constructor(private kv: KVNamespace) {}

  // Key generators
  private projectKey(id: string): string {
    return `${PROJECT_PREFIX}${id}`;
  }

  private taskKey(projectId: string, taskId: string): string {
    return `${TASK_PREFIX}${projectId}:${taskId}`;
  }

  private taskPrefixForProject(projectId: string): string {
    return `${TASK_PREFIX}${projectId}:`;
  }

  // --- Project Operations ---

  async createProject(name: string): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    await this.kv.put(this.projectKey(project.id), JSON.stringify(project));
    return project;
  }

  async getProject(id: string): Promise<Project | null> {
    const data = await this.kv.get(this.projectKey(id));
    return data ? (JSON.parse(data) as Project) : null;
  }

  async listProjects(): Promise<Project[]> {
    const listResult = await this.kv.list({ prefix: PROJECT_PREFIX });
    const keys = listResult.keys.map((k) => k.name);

    if (keys.length === 0) return [];

    const rawProjects = await Promise.all(keys.map((key) => this.kv.get(key)));
    const projects: Project[] = [];

    for (const raw of rawProjects) {
      if (raw) {
        projects.push(JSON.parse(raw) as Project);
      }
    }

    return projects.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async deleteProject(id: string): Promise<boolean> {
    const project = await this.getProject(id);
    if (!project) return false;

    // Delete all associated tasks
    let cursor: string | undefined = undefined;
    do {
      const taskList = await this.kv.list({
        prefix: this.taskPrefixForProject(id),
        cursor,
      });

      await Promise.all(taskList.keys.map((k) => this.kv.delete(k.name)));
      cursor = taskList.list_complete ? undefined : taskList.cursor;
    } while (cursor);

    // Delete project record
    await this.kv.delete(this.projectKey(id));
    return true;
  }

  // --- Task Operations ---

  async createTask(
    projectId: string,
    data: {
      title: string;
      description?: string;
      status: TaskStatus;
      assignee?: string;
    }
  ): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      projectId,
      title: data.title,
      description: data.description,
      status: data.status,
      assignee: data.assignee,
      createdAt: now,
      updatedAt: now,
    };

    await this.kv.put(this.taskKey(projectId, task.id), JSON.stringify(task));
    return task;
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    const data = await this.kv.get(this.taskKey(projectId, taskId));
    return data ? (JSON.parse(data) as Task) : null;
  }

  async listTasks(
    projectId: string,
    filter?: {
      status?: TaskStatus;
      page?: number;
      pageSize?: number;
    }
  ): Promise<{ tasks: Task[]; total: number }> {
    const prefix = this.taskPrefixForProject(projectId);
    const keys: string[] = [];
    let cursor: string | undefined = undefined;

    do {
      const result = await this.kv.list({ prefix, cursor });
      keys.push(...result.keys.map((k) => k.name));
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    if (keys.length === 0) {
      return { tasks: [], total: 0 };
    }

    const rawTasks = await Promise.all(keys.map((key) => this.kv.get(key)));
    let tasks: Task[] = [];

    for (const raw of rawTasks) {
      if (raw) {
        tasks.push(JSON.parse(raw) as Task);
      }
    }

    // Apply status filter
    if (filter?.status) {
      tasks = tasks.filter((task) => task.status === filter.status);
    }

    // Sort descending by creation date
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = tasks.length;
    const page = filter?.page ?? 1;
    const pageSize = filter?.pageSize ?? 20;
    const startIndex = (page - 1) * pageSize;
    const paginatedTasks = tasks.slice(startIndex, startIndex + pageSize);

    return { tasks: paginatedTasks, total };
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

    await this.kv.put(this.taskKey(projectId, taskId), JSON.stringify(updatedTask));
    return updatedTask;
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(projectId, taskId);
    if (!existing) return false;

    await this.kv.delete(this.taskKey(projectId, taskId));
    return true;
  }
}
```

---

### `src/routes/health.ts`

```typescript
import { Hono } from 'hono';
import { Env } from '../types';

export const healthRouter = new Hono<{ Bindings: Env }>();

healthRouter.get('/', (c) => {
  return c.json({ ok: true }, 200);
});
```

---

### `src/routes/projects.ts`

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

// POST /api/v1/projects - Create project
projectsRouter.post(
  '/',
  zValidator('json', CreateProjectSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: result.error.errors[0]?.message ?? 'Invalid request body',
            details: result.error.format(),
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const { name } = c.req.valid('json');
    const storage = new StorageService(c.env.TASKS);
    const project = await storage.createProject(name);
    return c.json(project, 201);
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
          code: 'PROJECT_NOT_FOUND',
          message: `Project with ID '${projectId}' not found`,
        },
      },
      404
    );
  }

  return c.json(project);
});

// DELETE /api/v1/projects/:projectId - Delete project and all its tasks
projectsRouter.delete('/:projectId', async (c) => {
  const projectId = c.req.param('projectId');
  const storage = new StorageService(c.env.TASKS);
  const deleted = await storage.deleteProject(projectId);

  if (!deleted) {
    return c.json(
      {
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: `Project with ID '${projectId}' not found`,
        },
      },
      404
    );
  }

  return c.json({ ok: true, message: 'Project and associated tasks deleted successfully' });
});
```

---

### `src/routes/tasks.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Env, PaginatedResponse, Task } from '../types';
import { StorageService } from '../services/storage';
import { CreateTaskSchema, UpdateTaskSchema, TaskQuerySchema } from '../schemas';

export const tasksRouter = new Hono<{ Bindings: Env }>();

// GET /api/v1/projects/:projectId/tasks - List tasks with pagination and optional status filter
tasksRouter.get(
  '/',
  zValidator('query', TaskQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: result.error.errors[0]?.message ?? 'Invalid query parameters',
            details: result.error.format(),
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const projectId = c.req.param('projectId');
    const storage = new StorageService(c.env.TASKS);

    // Verify project exists
    const project = await storage.getProject(projectId);
    if (!project) {
      return c.json(
        {
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: `Project with ID '${projectId}' not found`,
          },
        },
        404
      );
    }

    const { status, page, pageSize } = c.req.valid('query');
    const { tasks, total } = await storage.listTasks(projectId, { status, page, pageSize });

    const response: PaginatedResponse<Task> = {
      data: tasks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || (total === 0 ? 0 : 1),
      },
    };

    return c.json(response);
  }
);

// POST /api/v1/projects/:projectId/tasks - Create task
tasksRouter.post(
  '/',
  zValidator('json', CreateTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: result.error.errors[0]?.message ?? 'Invalid request body',
            details: result.error.format(),
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const projectId = c.req.param('projectId');
    const storage = new StorageService(c.env.TASKS);

    const project = await storage.getProject(projectId);
    if (!project) {
      return c.json(
        {
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: `Project with ID '${projectId}' not found`,
          },
        },
        404
      );
    }

    const body = c.req.valid('json');
    const task = await storage.createTask(projectId, body);
    return c.json(task, 201);
  }
);

// GET /api/v1/projects/:projectId/tasks/:taskId - Get single task
tasksRouter.get('/:taskId', async (c) => {
  const projectId = c.req.param('projectId');
  const taskId = c.req.param('taskId');
  const storage = new StorageService(c.env.TASKS);

  const project = await storage.getProject(projectId);
  if (!project) {
    return c.json(
      {
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: `Project with ID '${projectId}' not found`,
        },
      },
      404
    );
  }

  const task = await storage.getTask(projectId, taskId);
  if (!task) {
    return c.json(
      {
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task with ID '${taskId}' not found in project '${projectId}'`,
        },
      },
      404
    );
  }

  return c.json(task);
});

// PATCH /api/v1/projects/:projectId/tasks/:taskId - Partial update task
tasksRouter.patch(
  '/:taskId',
  zValidator('json', UpdateTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: result.error.errors[0]?.message ?? 'Invalid request body',
            details: result.error.format(),
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const projectId = c.req.param('projectId');
    const taskId = c.req.param('taskId');
    const storage = new StorageService(c.env.TASKS);

    const project = await storage.getProject(projectId);
    if (!project) {
      return c.json(
        {
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: `Project with ID '${projectId}' not found`,
          },
        },
        404
      );
    }

    const body = c.req.valid('json');
    const updatedTask = await storage.updateTask(projectId, taskId, body);

    if (!updatedTask) {
      return c.json(
        {
          error: {
            code: 'TASK_NOT_FOUND',
            message: `Task with ID '${taskId}' not found in project '${projectId}'`,
          },
        },
        404
      );
    }

    return c.json(updatedTask);
  }
);

// DELETE /api/v1/projects/:projectId/tasks/:taskId - Delete task
tasksRouter.delete('/:taskId', async (c) => {
  const projectId = c.req.param('projectId');
  const taskId = c.req.param('taskId');
  const storage = new StorageService(c.env.TASKS);

  const project = await storage.getProject(projectId);
  if (!project) {
    return c.json(
      {
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: `Project with ID '${projectId}' not found`,
        },
      },
      404
    );
  }

  const deleted = await storage.deleteTask(projectId, taskId);
  if (!deleted) {
    return c.json(
      {
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task with ID '${taskId}' not found in project '${projectId}'`,
        },
      },
      404
    );
  }

  return c.json({ ok: true, message: 'Task deleted successfully' });
});
```

---

### `src/index.ts`

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { requestLogger } from './middleware/logger';
import { bearerAuth } from './middleware/auth';
import { healthRouter } from './routes/health';
import { projectsRouter } from './routes/projects';
import { tasksRouter } from './routes/tasks';

const app = new Hono<{ Bindings: Env }>();

// 1. CORS Middleware (Supports browser clients & preflight requests)
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

// 2. Structured Request Logger Middleware
app.use('*', requestLogger);

// 3. Bearer Token Authentication Middleware (Exempts /health and /api/v1/health)
app.use('*', bearerAuth);

// 4. Mount API Routes
const api = new Hono<{ Bindings: Env }>();

api.route('/health', healthRouter);
api.route('/projects', projectsRouter);
api.route('/projects/:projectId/tasks', tasksRouter);

// Mount under /api/v1
app.route('/api/v1', api);

// Convenience top-level /health redirect or direct route
app.route('/health', healthRouter);

// 5. Custom 404 Handler for Unknown Routes
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route '${c.req.method} ${c.req.path}' not found`,
      },
    },
    404
  );
});

// 6. Global Error Handler for Unexpected Errors (500)
app.onError((err, c) => {
  console.error('Unhandled Server Error:', err);

  return c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          c.env.ENVIRONMENT === 'production'
            ? 'An unexpected error occurred on the server'
            : err.message || 'An unexpected error occurred',
      },
    },
    500
  );
});

export default app;
```

---

### How to Run & Deploy

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up local development secrets:**
   Create a `.dev.vars` file in the root directory:
   ```ini
   API_TOKEN=your-dev-secret-token
   ```

3. **Run locally:**
   ```bash
   npm run dev
   ```

4. **Deploy to Cloudflare:**
   ```bash
   # 1. Create your KV namespace if not already created
   npx wrangler kv namespace create TASKS

   # 2. Add the generated KV ID to wrangler.jsonc

   # 3. Set the production secret
   npx wrangler secret put API_TOKEN

   # 4. Deploy
   npm run deploy
   ```