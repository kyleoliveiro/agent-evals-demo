<!-- model: openrouter/google/gemini-3.7-flash | run: 2 | framework: Hono -->

Here is a complete, production-ready REST API for the Team Task Board backend built with TypeScript and [Hono](https://hono.dev/) on Cloudflare Workers.

---

### Project Structure

```
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── .gitignore
├── README.md
└── src/
    ├── index.ts
    ├── types.ts
    ├── schemas.ts
    ├── middleware/
    │   ├── auth.ts
    │   └── logger.ts
    ├── services/
    │   ├── project.service.ts
    │   └── task.service.ts
    └── routes/
        ├── health.ts
        ├── projects.ts
        └── tasks.ts
```

---

### `package.json`

```json
{
  "name": "team-task-board-api",
  "version": "1.0.0",
  "description": "Cloudflare Workers REST API for team task board backend",
  "main": "src/index.ts",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "types": "wrangler types"
  },
  "dependencies": {
    "@hono/zod-validator": "^0.4.3",
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
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true
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
  "compatibility_date": "2024-11-01",
  "kv_namespaces": [
    {
      "binding": "TASKS",
      "id": "YOUR_KV_NAMESPACE_ID_HERE",
      "preview_id": "YOUR_PREVIEW_KV_NAMESPACE_ID_HERE"
    }
  ],
  "vars": {
    // Override in production using: wrangler secret put API_TOKEN
    "API_TOKEN": "dev-secret-token"
  }
}
```

---

### `.gitignore`

```gitignore
node_modules/
.wrangler/
dist/
.dev.vars
```

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

export interface AppEnv {
  Bindings: {
    TASKS: KVNamespace;
    API_TOKEN: string;
  };
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

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done']);

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(100, 'Project name must be <= 100 characters'),
});

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required').max(200, 'Task title must be <= 200 characters'),
  description: z.string().trim().max(2000, 'Description must be <= 2000 characters').optional(),
  status: TaskStatusSchema.default('todo'),
  assignee: z.string().trim().max(100, 'Assignee name must be <= 100 characters').optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Task title cannot be empty').max(200, 'Task title must be <= 200 characters').optional(),
    description: z.string().trim().max(2000, 'Description must be <= 2000 characters').nullable().optional(),
    status: TaskStatusSchema.optional(),
    assignee: z.string().trim().max(100, 'Assignee name must be <= 100 characters').nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field (title, description, status, or assignee) must be provided for update',
  });

export const ListTasksQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  page: z
    .string()
    .optional()
    .default('1')
    .transform((val) => parseInt(val, 10))
    .refine((val) => Number.isInteger(val) && val >= 1, {
      message: 'page must be an integer >= 1',
    }),
  pageSize: z
    .string()
    .optional()
    .default('20')
    .transform((val) => parseInt(val, 10))
    .refine((val) => Number.isInteger(val) && val >= 1 && val <= 100, {
      message: 'pageSize must be an integer between 1 and 100',
    }),
});
```

---

### `src/middleware/logger.ts`

```typescript
import { MiddlewareHandler } from 'hono';
import { AppEnv } from '../types';

export const requestLogger = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const start = performance.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Math.round((performance.now() - start) * 100) / 100;
    const status = c.res.status;

    console.log(`[${new Date().toISOString()}] ${method} ${path} ${status} - ${duration}ms`);
  };
};
```

---

### `src/middleware/auth.ts`

```typescript
import { MiddlewareHandler } from 'hono';
import { AppEnv } from '../types';

export const bearerAuth = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing Authorization header with Bearer token',
          },
        },
        401
      );
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid Authorization header format. Expected "Bearer <token>"',
          },
        },
        401
      );
    }

    const expectedToken = c.env.API_TOKEN;
    if (!expectedToken || token !== expectedToken) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired authentication token',
          },
        },
        401
      );
    }

    await next();
  };
};
```

---

### `src/services/project.service.ts`

```typescript
import { Project } from '../types';
import { TaskService } from './task.service';

const PROJECT_PREFIX = 'project:';

export class ProjectService {
  constructor(private kv: KVNamespace) {}

  private projectKey(id: string): string {
    return `${PROJECT_PREFIX}${id}`;
  }

  async list(): Promise<Project[]> {
    let listComplete = false;
    let cursor: string | undefined = undefined;
    const keys: string[] = [];

    while (!listComplete) {
      const res = await this.kv.list({ prefix: PROJECT_PREFIX, cursor });
      keys.push(...res.keys.map((k) => k.name));
      listComplete = res.list_complete;
      if (!listComplete) {
        cursor = res.cursor;
      }
    }

    if (keys.length === 0) return [];

    const projects = await Promise.all(
      keys.map(async (key) => {
        const data = await this.kv.get(key, 'text');
        return data ? (JSON.parse(data) as Project) : null;
      })
    );

    return projects
      .filter((p): p is Project => p !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getById(id: string): Promise<Project | null> {
    const raw = await this.kv.get(this.projectKey(id), 'text');
    if (!raw) return null;
    return JSON.parse(raw) as Project;
  }

  async create(name: string): Promise<Project> {
    const id = crypto.randomUUID();
    const project: Project = {
      id,
      name,
      createdAt: new Date().toISOString(),
    };

    await this.kv.put(this.projectKey(id), JSON.stringify(project));
    return project;
  }

  async delete(id: string): Promise<boolean> {
    const project = await this.getById(id);
    if (!project) return false;

    // Delete associated tasks first
    const taskService = new TaskService(this.kv);
    await taskService.deleteAllByProject(id);

    // Delete the project
    await this.kv.delete(this.projectKey(id));
    return true;
  }
}
```

---

### `src/services/task.service.ts`

```typescript
import { Task, TaskStatus } from '../types';

const TASK_PREFIX = 'task:';

export class TaskService {
  constructor(private kv: KVNamespace) {}

  private taskKey(projectId: string, taskId: string): string {
    return `${TASK_PREFIX}${projectId}:${taskId}`;
  }

  private taskPrefixForProject(projectId: string): string {
    return `${TASK_PREFIX}${projectId}:`;
  }

  async list(
    projectId: string,
    filters?: { status?: TaskStatus; page: number; pageSize: number }
  ): Promise<{ tasks: Task[]; total: number }> {
    let listComplete = false;
    let cursor: string | undefined = undefined;
    const keys: string[] = [];
    const prefix = this.taskPrefixForProject(projectId);

    while (!listComplete) {
      const res = await this.kv.list({ prefix, cursor });
      keys.push(...res.keys.map((k) => k.name));
      listComplete = res.list_complete;
      if (!listComplete) {
        cursor = res.cursor;
      }
    }

    if (keys.length === 0) {
      return { tasks: [], total: 0 };
    }

    const tasksRaw = await Promise.all(
      keys.map(async (key) => {
        const raw = await this.kv.get(key, 'text');
        return raw ? (JSON.parse(raw) as Task) : null;
      })
    );

    let tasks = tasksRaw.filter((t): t is Task => t !== null);

    if (filters?.status) {
      tasks = tasks.filter((t) => t.status === filters.status);
    }

    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = tasks.length;
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 20;
    const startIndex = (page - 1) * pageSize;
    const paginated = tasks.slice(startIndex, startIndex + pageSize);

    return { tasks: paginated, total };
  }

  async getById(projectId: string, taskId: string): Promise<Task | null> {
    const raw = await this.kv.get(this.taskKey(projectId, taskId), 'text');
    if (!raw) return null;
    return JSON.parse(raw) as Task;
  }

  async create(
    projectId: string,
    input: { title: string; description?: string; status: TaskStatus; assignee?: string }
  ): Promise<Task> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const task: Task = {
      id,
      projectId,
      title: input.title,
      description: input.description,
      status: input.status,
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now,
    };

    await this.kv.put(this.taskKey(projectId, id), JSON.stringify(task));
    return task;
  }

  async update(
    projectId: string,
    taskId: string,
    patch: { title?: string; description?: string | null; status?: TaskStatus; assignee?: string | null }
  ): Promise<Task | null> {
    const task = await this.getById(projectId, taskId);
    if (!task) return null;

    if (patch.title !== undefined) {
      task.title = patch.title;
    }
    if (patch.description !== undefined) {
      task.description = patch.description === null ? undefined : patch.description;
    }
    if (patch.status !== undefined) {
      task.status = patch.status;
    }
    if (patch.assignee !== undefined) {
      task.assignee = patch.assignee === null ? undefined : patch.assignee;
    }

    task.updatedAt = new Date().toISOString();

    await this.kv.put(this.taskKey(projectId, taskId), JSON.stringify(task));
    return task;
  }

  async delete(projectId: string, taskId: string): Promise<boolean> {
    const task = await this.getById(projectId, taskId);
    if (!task) return false;

    await this.kv.delete(this.taskKey(projectId, taskId));
    return true;
  }

  async deleteAllByProject(projectId: string): Promise<void> {
    let listComplete = false;
    let cursor: string | undefined = undefined;
    const prefix = this.taskPrefixForProject(projectId);

    while (!listComplete) {
      const res = await this.kv.list({ prefix, cursor });
      await Promise.all(res.keys.map((k) => this.kv.delete(k.name)));
      listComplete = res.list_complete;
      if (!listComplete) {
        cursor = res.cursor;
      }
    }
  }
}
```

---

### `src/routes/health.ts`

```typescript
import { Hono } from 'hono';
import { AppEnv } from '../types';

export const healthRoute = new Hono<AppEnv>();

healthRoute.get('/', (c) => {
  return c.json({ ok: true }, 200);
});
```

---

### `src/routes/projects.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AppEnv } from '../types';
import { CreateProjectSchema } from '../schemas';
import { ProjectService } from '../services/project.service';

export const projectsRoute = new Hono<AppEnv>();

// GET /api/v1/projects - list all projects
projectsRoute.get('/', async (c) => {
  const service = new ProjectService(c.env.TASKS);
  const projects = await service.list();
  return c.json({ data: projects }, 200);
});

// POST /api/v1/projects - create project
projectsRoute.post(
  '/',
  zValidator('json', CreateProjectSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid project creation payload',
            details: result.error.flatten().fieldErrors,
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const body = c.req.valid('json');
    const service = new ProjectService(c.env.TASKS);
    const project = await service.create(body.name);
    return c.json({ data: project }, 201);
  }
);

// GET /api/v1/projects/:projectId - get project by id
projectsRoute.get('/:projectId', async (c) => {
  const projectId = c.req.param('projectId');
  const service = new ProjectService(c.env.TASKS);
  const project = await service.getById(projectId);

  if (!project) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Project with id '${projectId}' not found`,
        },
      },
      404
    );
  }

  return c.json({ data: project }, 200);
});

// DELETE /api/v1/projects/:projectId - delete project & cascade its tasks
projectsRoute.delete('/:projectId', async (c) => {
  const projectId = c.req.param('projectId');
  const service = new ProjectService(c.env.TASKS);
  const deleted = await service.delete(projectId);

  if (!deleted) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Project with id '${projectId}' not found`,
        },
      },
      404
    );
  }

  return c.json(
    {
      data: {
        id: projectId,
        deleted: true,
      },
    },
    200
  );
});
```

---

### `src/routes/tasks.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AppEnv } from '../types';
import { CreateTaskSchema, UpdateTaskSchema, ListTasksQuerySchema } from '../schemas';
import { ProjectService } from '../services/project.service';
import { TaskService } from '../services/task.service';

export const tasksRoute = new Hono<AppEnv>();

// Middleware: ensure the parent project exists for all /projects/:projectId/tasks routes
tasksRoute.use('/:projectId/tasks/*', async (c, next) => {
  const projectId = c.req.param('projectId');
  const projectService = new ProjectService(c.env.TASKS);
  const project = await projectService.getById(projectId);

  if (!project) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Parent project '${projectId}' not found`,
        },
      },
      404
    );
  }

  await next();
});

// Also check project exists when hitting the base collection endpoint
tasksRoute.use('/:projectId/tasks', async (c, next) => {
  const projectId = c.req.param('projectId');
  const projectService = new ProjectService(c.env.TASKS);
  const project = await projectService.getById(projectId);

  if (!project) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Parent project '${projectId}' not found`,
        },
      },
      404
    );
  }

  await next();
});

// GET /api/v1/projects/:projectId/tasks - list tasks with optional status filter & pagination
tasksRoute.get(
  '/:projectId/tasks',
  zValidator('query', ListTasksQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
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
    const taskService = new TaskService(c.env.TASKS);

    const { tasks, total } = await taskService.list(projectId, { status, page, pageSize });
    const totalPages = Math.ceil(total / pageSize);

    return c.json(
      {
        data: tasks,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
        },
      },
      200
    );
  }
);

// POST /api/v1/projects/:projectId/tasks - create a new task
tasksRoute.post(
  '/:projectId/tasks',
  zValidator('json', CreateTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid task creation payload',
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
    const taskService = new TaskService(c.env.TASKS);

    const task = await taskService.create(projectId, body);
    return c.json({ data: task }, 201);
  }
);

// GET /api/v1/projects/:projectId/tasks/:taskId - get single task
tasksRoute.get('/:projectId/tasks/:taskId', async (c) => {
  const projectId = c.req.param('projectId');
  const taskId = c.req.param('taskId');
  const taskService = new TaskService(c.env.TASKS);

  const task = await taskService.getById(projectId, taskId);
  if (!task) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Task '${taskId}' not found in project '${projectId}'`,
        },
      },
      404
    );
  }

  return c.json({ data: task }, 200);
});

// PATCH /api/v1/projects/:projectId/tasks/:taskId - partial update
tasksRoute.patch(
  '/:projectId/tasks/:taskId',
  zValidator('json', UpdateTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid task update payload',
            details: result.error.flatten().fieldErrors,
          },
        },
        400
      );
    }
  }),
  async (c) => {
    const projectId = c.req.param('projectId');
    const taskId = c.req.param('taskId');
    const body = c.req.valid('json');
    const taskService = new TaskService(c.env.TASKS);

    const updatedTask = await taskService.update(projectId, taskId, body);
    if (!updatedTask) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Task '${taskId}' not found in project '${projectId}'`,
          },
        },
        404
      );
    }

    return c.json({ data: updatedTask }, 200);
  }
);

// DELETE /api/v1/projects/:projectId/tasks/:taskId - delete a task
tasksRoute.delete('/:projectId/tasks/:taskId', async (c) => {
  const projectId = c.req.param('projectId');
  const taskId = c.req.param('taskId');
  const taskService = new TaskService(c.env.TASKS);

  const deleted = await taskService.delete(projectId, taskId);
  if (!deleted) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Task '${taskId}' not found in project '${projectId}'`,
        },
      },
      404
    );
  }

  return c.json(
    {
      data: {
        id: taskId,
        deleted: true,
      },
    },
    200
  );
});
```

---

### `src/index.ts`

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AppEnv } from './types';
import { requestLogger } from './middleware/logger';
import { bearerAuth } from './middleware/auth';
import { healthRoute } from './routes/health';
import { projectsRoute } from './routes/projects';
import { tasksRoute } from './routes/tasks';

const app = new Hono<AppEnv>();

// 1. CORS Middleware (handles standard requests & preflight OPTIONS)
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

// 2. Logging Middleware (Method, Path, Status, Duration)
app.use('*', requestLogger());

// 3. Health Check Routes (Unprotected)
app.route('/health', healthRoute);
app.route('/api/v1/health', healthRoute);

// 4. API v1 Protected Sub-App
const apiV1 = new Hono<AppEnv>();

// Apply Bearer Authentication to all /api/v1/* routes
apiV1.use('*', bearerAuth());

// Mount Project and Task routes
apiV1.route('/projects', projectsRoute);
apiV1.route('/projects', tasksRoute);

// Mount under main app
app.route('/api/v1', apiV1);

// 5. 404 Not Found Handler for unknown routes
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

// 6. Global Error Handler (500 unexpected errors / 405 Method Not Allowed)
app.onError((err, c) => {
  console.error('Unhandled Application Error:', err);

  const status = 'status' in err && typeof err.status === 'number' ? (err.status as any) : 500;
  const message = status === 405 ? 'Method Not Allowed' : err.message || 'An unexpected error occurred';
  const code = status === 405 ? 'METHOD_NOT_ALLOWED' : 'INTERNAL_SERVER_ERROR';

  return c.json(
    {
      error: {
        code,
        message,
      },
    },
    status
  );
});

export default app;
```

---

### `README.md`

```markdown
# Team Task Board REST API (Cloudflare Workers + KV)

A production-grade REST API backend for managing team projects and tasks, deployed on Cloudflare Workers using Hono and Cloudflare KV.

## Features
- **Fast & Lightweight:** Built on Cloudflare Workers edge runtime.
- **Data Persistence:** KV storage with relational cleanup (cascade deletion on project delete).
- **Authentication:** Bearer token authorization on all `/api/v1/*` routes (except `/health`).
- **Validation:** Type-safe schema validation powered by Zod.
- **Observability & Resilience:** Standardized JSON error formats and request logging (method, path, status, duration).
- **CORS:** Pre-configured for browser clients.

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure KV Namespace
Create your KV namespace with Wrangler:
```bash
npx wrangler kv namespace create TASKS
npx wrangler kv namespace create TASKS --preview
```
Update `wrangler.jsonc` with the returned namespace IDs.

### 3. Local Development
```bash
npm run dev
```

The server will start at `http://localhost:8787`.

---

## API Endpoints & Examples

### Health Check (No Auth Required)
```bash
curl http://localhost:8787/api/v1/health
```

### Projects API (Requires `Authorization: Bearer dev-secret-token`)

**Create Project:**
```bash
curl -X POST http://localhost:8787/api/v1/projects \
  -H "Authorization: Bearer dev-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"name": "Frontend Redesign"}'
```

**List Projects:**
```bash
curl http://localhost:8787/api/v1/projects \
  -H "Authorization: Bearer dev-secret-token"
```

**Get Project by ID:**
```bash
curl http://localhost:8787/api/v1/projects/:projectId \
  -H "Authorization: Bearer dev-secret-token"
```

**Delete Project (and its tasks):**
```bash
curl -X DELETE http://localhost:8787/api/v1/projects/:projectId \
  -H "Authorization: Bearer dev-secret-token"
```

---

### Tasks API

**Create Task:**
```bash
curl -X POST http://localhost:8787/api/v1/projects/:projectId/tasks \
  -H "Authorization: Bearer dev-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Set up design system",
    "description": "Initialize Tailwind and Shadcn UI tokens",
    "status": "todo",
    "assignee": "Alice"
  }'
```

**List Tasks (with filters and pagination):**
```bash
curl "http://localhost:8787/api/v1/projects/:projectId/tasks?status=todo&page=1&pageSize=10" \
  -H "Authorization: Bearer dev-secret-token"
```

**Get Single Task:**
```bash
curl http://localhost:8787/api/v1/projects/:projectId/tasks/:taskId \
  -H "Authorization: Bearer dev-secret-token"
```

**Update Task:**
```bash
curl -X PATCH http://localhost:8787/api/v1/projects/:projectId/tasks/:taskId \
  -H "Authorization: Bearer dev-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "assignee": "Bob"}'
```

**Delete Task:**
```bash
curl -X DELETE http://localhost:8787/api/v1/projects/:projectId/tasks/:taskId \
  -H "Authorization: Bearer dev-secret-token"
```

---

## Deployment

1. Set the production secret:
   ```bash
   npx wrangler secret put API_TOKEN
   ```
2. Deploy the worker:
   ```bash
   npm run deploy
   ```
```