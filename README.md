# Framework Adoption Eval

A small [Flue](https://flueframework.com/) eval that asks a set of models (via OpenRouter) to build a moderately complex REST API — a task-board backend with 10 routes, path and query params, bearer auth, CORS, request logging, and structured errors — from a prompt that names **no framework**, and reports which HTTP framework each model reaches for.

Two prompts are used, identical except for the deployment target:

- **`cloudflare`** — names Cloudflare Workers, KV, and wrangler.
- **`neutral`** — names no platform at all.

The task is intentionally non-trivial: for a single `GET /health` route a bare `fetch` handler is the right answer, so it says nothing about defaults. Routing, path params, and middleware-style concerns are where framework choice actually shows up.

## Findings

**Mentioning the platform/deployment target heavily influences the choice of framework that the model uses.**

With "Cloudflare Workers" in the prompt every model picks Hono; remove "Cloudflare" from the prompt, and Hono disappears. Express becomes the near-universal default, with GPT-5.6 Sol being the only exception (picking Fastify). 

Within-model variance was zero in both conditions.

<table>
<tr>
<th>Cloudflare prompt</th>
<th>Neutral prompt</th>
</tr>
<tr>
<td><a href="results/cloudflare-cc1211ac/summary.html"><img src="results/cloudflare-cc1211ac/summary.png" alt="Cloudflare prompt: Hono 24/24" width="100%"></a></td>
<td><a href="results/neutral-e655cb5d/summary.html"><img src="results/neutral-e655cb5d/summary.png" alt="Neutral prompt: Express 21/24, Fastify 3/24" width="100%"></a></td>
</tr>
</table>

### Cloudflare prompt — Hono 24/24

Folder: [`results/cloudflare-cc1211ac`](results/cloudflare-cc1211ac) · [summary.html](results/cloudflare-cc1211ac/summary.html)

| Model | Hono | Elysia | Express | Fastify | Koa | NestJS | None/Other |
|---|---:|---:|---:|---:|---:|---:|---:|
| `anthropic/claude-sonnet-4.6` | **3/3** | 0 | 0 | 0 | 0 | 0 | 0 |
| `anthropic/claude-opus-4.6` | **3/3** | 0 | 0 | 0 | 0 | 0 | 0 |
| `anthropic/claude-sonnet-5` | **3/3** | 0 | 0 | 0 | 0 | 0 | 0 |
| `anthropic/claude-opus-5` | **3/3** | 0 | 0 | 0 | 0 | 0 | 0 |
| `openai/gpt-5.6-sol` | **3/3** | 0 | 0 | 0 | 0 | 0 | 0 |
| `moonshotai/kimi-k3` | **3/3** | 0 | 0 | 0 | 0 | 0 | 0 |
| `x-ai/grok-4.6` | **3/3** | 0 | 0 | 0 | 0 | 0 | 0 |
| `google/gemini-3.7-flash` | **3/3** | 0 | 0 | 0 | 0 | 0 | 0 |

### Neutral prompt — Express 21/24, Fastify 3/24

Folder: [`results/neutral-e655cb5d`](results/neutral-e655cb5d) · [summary.html](results/neutral-e655cb5d/summary.html)

| Model | Hono | Elysia | Express | Fastify | Koa | NestJS | None/Other |
|---|---:|---:|---:|---:|---:|---:|---:|
| `anthropic/claude-sonnet-4.6` | 0 | 0 | **3/3** | 0 | 0 | 0 | 0 |
| `anthropic/claude-opus-4.6` | 0 | 0 | **3/3** | 0 | 0 | 0 | 0 |
| `anthropic/claude-sonnet-5` | 0 | 0 | **3/3** | 0 | 0 | 0 | 0 |
| `anthropic/claude-opus-5` | 0 | 0 | **3/3** | 0 | 0 | 0 | 0 |
| `openai/gpt-5.6-sol` | 0 | 0 | 0 | **3/3** | 0 | 0 | 0 |
| `moonshotai/kimi-k3` | 0 | 0 | **3/3** | 0 | 0 | 0 | 0 |
| `x-ai/grok-4.6` | 0 | 0 | **3/3** | 0 | 0 | 0 | 0 |
| `google/gemini-3.7-flash` | 0 | 0 | **3/3** | 0 | 0 | 0 | 0 |

## Prompts

<details>
<summary><code>cloudflare</code> prompt</summary>

```text
Build a production-ready REST API on Cloudflare Workers in TypeScript for a "team task board" backend.

Data model (store in Cloudflare KV; a single KV namespace binding called TASKS is fine):
- Project: { id, name, createdAt }
- Task: { id, projectId, title, description?, status: "todo" | "in_progress" | "done", assignee?, createdAt, updatedAt }

Endpoints, all under /api/v1:
- GET    /health                                  -> { "ok": true }
- GET    /projects                                -> list projects
- POST   /projects                                -> create project (validate body)
- GET    /projects/:projectId                     -> get one project, 404 if missing
- DELETE /projects/:projectId                     -> delete project and its tasks
- GET    /projects/:projectId/tasks?status=&page=&pageSize=  -> list tasks with optional status filter + pagination
- POST   /projects/:projectId/tasks               -> create task (validate body)
- GET    /projects/:projectId/tasks/:taskId       -> get one task
- PATCH  /projects/:projectId/tasks/:taskId       -> partial update (title/description/status/assignee)
- DELETE /projects/:projectId/tasks/:taskId       -> delete task

Cross-cutting requirements:
- Every route except /health requires an Authorization: Bearer <token> header checked against an API_TOKEN secret binding; respond 401 otherwise.
- CORS support for browser clients, including preflight.
- Log method, path, status, and duration for every request.
- Consistent JSON error responses ({ "error": { "code", "message" } }) for validation failures (400), not found (404), method not allowed (405), and unexpected errors (500).
- Unknown routes return 404 in the same error shape.

Choose whatever libraries, frameworks, or tooling you think are appropriate for this kind of application.
Output all the files it needs, including package.json and wrangler config.
```

</details>

<details>
<summary><code>neutral</code> prompt</summary>

```text
Build a production-ready REST API in TypeScript for a "team task board" backend.

Data model (an in-memory store is fine; keep storage behind a small interface so it could be swapped later):
- Project: { id, name, createdAt }
- Task: { id, projectId, title, description?, status: "todo" | "in_progress" | "done", assignee?, createdAt, updatedAt }

Endpoints, all under /api/v1:
- GET    /health                                  -> { "ok": true }
- GET    /projects                                -> list projects
- POST   /projects                                -> create project (validate body)
- GET    /projects/:projectId                     -> get one project, 404 if missing
- DELETE /projects/:projectId                     -> delete project and its tasks
- GET    /projects/:projectId/tasks?status=&page=&pageSize=  -> list tasks with optional status filter + pagination
- POST   /projects/:projectId/tasks               -> create task (validate body)
- GET    /projects/:projectId/tasks/:taskId       -> get one task
- PATCH  /projects/:projectId/tasks/:taskId       -> partial update (title/description/status/assignee)
- DELETE /projects/:projectId/tasks/:taskId       -> delete task

Cross-cutting requirements:
- Every route except /health requires an Authorization: Bearer <token> header checked against an API_TOKEN environment variable; respond 401 otherwise.
- CORS support for browser clients, including preflight.
- Log method, path, status, and duration for every request.
- Consistent JSON error responses ({ "error": { "code", "message" } }) for validation failures (400), not found (404), method not allowed (405), and unexpected errors (500).
- Unknown routes return 404 in the same error shape.

Choose whatever libraries, frameworks, or tooling you think are appropriate for this kind of application.
Output all the files it needs, including package.json.
```

</details>

## How to run

```sh
pnpm install
cp .env.example .env   # then fill in OPENROUTER_API_KEY
pnpm evals             # cloudflare prompt
pnpm evals:neutral     # neutral prompt
```

## Output

- Generated outputs are saved to `results/<prompt>-<hash>/<model>/run-NN.md`, alongside `summary.json` and a self-contained `summary.html`
- `<hash>` is a short SHA-256 of the prompt text.
- Override the base directory with `EVAL_OUT_DIR`.
