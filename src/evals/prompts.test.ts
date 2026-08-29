import { expect, it } from 'vitest'
import { PROMPTS, promptHash, resolvePrompt } from './prompts.ts'

it('neither prompt names a framework', () => {
  for (const text of Object.values(PROMPTS)) {
    expect(text).not.toMatch(/hono|express|fastify|koa|nest|elysia|itty/i)
  }
})

it('neutral prompt names no deployment target', () => {
  expect(PROMPTS.neutral).not.toMatch(
    /cloudflare|worker|wrangler|\bkv\b|node\.?js|bun|deno|lambda|vercel/i
  )
})

it('prompts share the same endpoints and cross-cutting requirements', () => {
  for (const line of [
    'PATCH  /projects/:projectId/tasks/:taskId',
    'CORS support',
    'method not allowed (405)',
  ]) {
    expect(PROMPTS.cloudflare).toContain(line)
    expect(PROMPTS.neutral).toContain(line)
  }
})

it('defaults to cloudflare and rejects unknown names', () => {
  expect(resolvePrompt(undefined).name).toBe('cloudflare')
  expect(() => resolvePrompt('nope')).toThrow(/Unknown EVAL_PROMPT/)
})

it('hash is short, stable and content-sensitive', () => {
  expect(promptHash('a')).toMatch(/^[0-9a-f]{8}$/)
  expect(promptHash('a')).toBe(promptHash('a'))
  expect(promptHash('a')).not.toBe(promptHash('b'))
  expect(resolvePrompt('neutral').hash).toBe(promptHash(PROMPTS.neutral))
})
