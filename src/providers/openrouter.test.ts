import { expect, it } from 'vitest'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { openrouter } from './openrouter.ts'

const TARGETS = [
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
  'moonshotai/kimi-k3',
  'x-ai/grok-4.6',
  'google/gemini-3.7-flash',
]

it('exposes every eval target model', () => {
  const ids = new Set(openrouter.getModels().map((m) => m.id))
  for (const id of TARGETS) expect(ids.has(id), id).toBe(true)
})

it('keeps the full builtin catalog', () => {
  const builtin = openrouterProvider().getModels().length
  expect(openrouter.getModels().length).toBeGreaterThanOrEqual(builtin)
})
