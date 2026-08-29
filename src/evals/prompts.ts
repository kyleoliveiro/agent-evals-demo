import { createHash } from 'node:crypto'

// Both prompts are neutral about frameworks — no library is named anywhere.
// They are shaped so hand-rolled routing is painful (many routes, path and
// query params, middleware-style cross-cutting concerns, a versioned group).
//
// `cloudflare` names the deployment target; `neutral` names none, to test
// whether the platform, rather than the task, is what drives framework choice.

const DATA_MODEL = `
Data model:
- Project: { id, name, createdAt }
- Task: { id, projectId, title, description?, status: "todo" | "in_progress" | "done", assignee?, createdAt, updatedAt }
`.trim()

const ENDPOINTS = `
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
`.trim()

const CROSS_CUTTING = (tokenSource: string) =>
  `
Cross-cutting requirements:
- Every route except /health requires an Authorization: Bearer <token> header checked against ${tokenSource}; respond 401 otherwise.
- CORS support for browser clients, including preflight.
- Log method, path, status, and duration for every request.
- Consistent JSON error responses ({ "error": { "code", "message" } }) for validation failures (400), not found (404), method not allowed (405), and unexpected errors (500).
- Unknown routes return 404 in the same error shape.
`.trim()

export const CLOUDFLARE_PROMPT = `
Build a production-ready REST API on Cloudflare Workers in TypeScript for a "team task board" backend.

${DATA_MODEL.replace('Data model:', 'Data model (store in Cloudflare KV; a single KV namespace binding called TASKS is fine):')}

${ENDPOINTS}

${CROSS_CUTTING('an API_TOKEN secret binding')}

Choose whatever libraries, frameworks, or tooling you think are appropriate for this kind of application.
Output all the files it needs, including package.json and wrangler config.
`.trim()

export const NEUTRAL_PROMPT = `
Build a production-ready REST API in TypeScript for a "team task board" backend.

${DATA_MODEL.replace('Data model:', 'Data model (an in-memory store is fine; keep storage behind a small interface so it could be swapped later):')}

${ENDPOINTS}

${CROSS_CUTTING('an API_TOKEN environment variable')}

Choose whatever libraries, frameworks, or tooling you think are appropriate for this kind of application.
Output all the files it needs, including package.json.
`.trim()

export const PROMPTS = { cloudflare: CLOUDFLARE_PROMPT, neutral: NEUTRAL_PROMPT } as const

export type PromptName = keyof typeof PROMPTS

/** Short content hash — results folders are named `<name>-<hash>` so a prompt edit gets a fresh folder. */
export function promptHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

export function resolvePrompt(name: string | undefined): {
  name: PromptName
  text: string
  hash: string
} {
  const key = (name ?? 'cloudflare') as PromptName
  if (!(key in PROMPTS)) {
    throw new Error(`Unknown EVAL_PROMPT "${name}". Available: ${Object.keys(PROMPTS).join(', ')}`)
  }
  return { name: key, text: PROMPTS[key], hash: promptHash(PROMPTS[key]) }
}
