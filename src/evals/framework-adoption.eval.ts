import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { init } from '@flue/runtime'
import { start } from '@flue/runtime/node'
import { afterAll, expect, it } from 'vitest'
import { WorkersAppGenerator } from '../agents/workers-app-generator.ts'
import { openrouter } from '../providers/openrouter.ts'
import { resolvePrompt } from './prompts.ts'
import { rebuildSummary } from './rebuild-summary.ts'

const RUNS = Number(process.env.EVAL_RUNS ?? 3)
const CONCURRENCY = 3
// A hung provider request must not stall the suite: abort the run and count it as Error. 0 disables.
const RUN_TIMEOUT_MS = Number(process.env.EVAL_RUN_TIMEOUT_MS ?? 10 * 60_000)

// All via OpenRouter. Override with EVAL_MODELS="openrouter/a,openrouter/b".
const DEFAULT_MODELS = [
  'openrouter/anthropic/claude-sonnet-4.6',
  'openrouter/anthropic/claude-opus-4.6',
  'openrouter/anthropic/claude-sonnet-5',
  'openrouter/anthropic/claude-opus-5',
  // "openrouter/anthropic/claude-fable-5",
  'openrouter/openai/gpt-5.6-sol',
  'openrouter/moonshotai/kimi-k3',
  'openrouter/x-ai/grok-4.6',
  'openrouter/google/gemini-3.7-flash',
]
const MODELS =
  process.env.EVAL_MODELS?.split(',')
    .map((m) => m.trim())
    .filter(Boolean) ?? DEFAULT_MODELS

// Select with EVAL_PROMPT=cloudflare|neutral (see prompts.ts).
const {
  name: PROMPT_NAME,
  text: PROMPT,
  hash: PROMPT_HASH,
} = resolvePrompt(process.env.EVAL_PROMPT)
// Every reply is written to results/<prompt>-<hash>/<model>/run-NN.md so runs can be audited.
// The folder is keyed by prompt content, so repeated runs append to it (numbering continues).
const OUT_DIR = path.join(process.env.EVAL_OUT_DIR ?? 'results', `${PROMPT_NAME}-${PROMPT_HASH}`)

// Only OpenRouter is registered; every model specifier must be `openrouter/...`.
const flue = await start({
  agents: [WorkersAppGenerator],
  providers: [openrouter],
})
afterAll(() => flue.stop())

// vitest's default reporter swallows console.log, so write to stdout directly
function report(line: string): void {
  process.stdout.write(`${line}\n`)
}

const FRAMEWORKS: ReadonlyArray<readonly [name: string, pkg: string]> = [
  ['Hono', 'hono'],
  ['Elysia', 'elysia'],
  ['Express', 'express'],
  ['Fastify', 'fastify'],
  ['Koa', 'koa'],
  ['NestJS', '@nestjs/core'],
]

function importsPackage(source: string, pkg: string): boolean {
  const p = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return (
    new RegExp(`from\\s+['"]${p}(?:/[\\w./-]+)?['"]`).test(source) ||
    new RegExp(`require\\(\\s*['"]${p}['"]\\s*\\)`).test(source) ||
    new RegExp(`['"]${p}['"]\\s*:\\s*['"]`).test(source)
  )
}

function detectFramework(source: string): string {
  for (const [name, pkg] of FRAMEWORKS) {
    if (importsPackage(source, pkg)) return name
  }
  return NONE
}

const NONE = 'None/Other'
const ERROR = 'Error'

// Flue wraps provider failures in AgentRunError; the useful text is on `cause`,
// which is a serialized { message, meta? } object rather than an Error.
function describeError(err: unknown): string {
  const parts: string[] = []
  let e: unknown = err
  while (e && typeof e === 'object') {
    const { message, meta, cause } = e as {
      message?: string
      meta?: { reason?: string }
      cause?: unknown
    }
    if (message) parts.push(meta?.reason ? `${message} (${meta.reason})` : message)
    e = cause
  }
  return parts.join(' <- ') || String(err)
}

function modelDir(model: string): string {
  return path.join(OUT_DIR, model.replace(/\//g, '__'))
}

async function existingRunCount(model: string): Promise<number> {
  const files = await readdir(modelDir(model)).catch(() => [] as string[])
  return files.filter((f) => /^run-\d+\.md$/.test(f)).length
}

async function saveReply(
  model: string,
  runNumber: number,
  framework: string,
  text: string
): Promise<void> {
  const dir = modelDir(model)
  await mkdir(dir, { recursive: true })
  const header = `<!-- model: ${model} | run: ${runNumber} | framework: ${framework} -->\n\n`
  await writeFile(path.join(dir, `run-${String(runNumber).padStart(2, '0')}.md`), header + text)
}

async function generateOnce(model: string, runNumber: number): Promise<string> {
  // init() without an id starts a fresh conversation every time
  const agent = init(WorkersAppGenerator)
  const startedAt = Date.now()
  let result: string
  try {
    const receipt = await agent.dispatch({ message: PROMPT, initialData: { model } })
    const reply = await agent.read(receipt, {
      signal: RUN_TIMEOUT_MS > 0 ? AbortSignal.timeout(RUN_TIMEOUT_MS) : undefined,
    })
    result = detectFramework(reply.text)
    await saveReply(model, runNumber, result, reply.text)
  } catch (err) {
    result = ERROR
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
    if (timedOut) void agent.abort().catch(() => {})
    const description = timedOut ? `timed out after ${RUN_TIMEOUT_MS / 1000}s` : describeError(err)
    report(`  [${model}] run ${runNumber} failed: ${description}`)
    await saveReply(model, runNumber, result, `Run failed:\n\n${description}\n`)
  }
  const secs = Math.round((Date.now() - startedAt) / 1000)
  report(`  ${model}  run ${String(runNumber).padStart(2, '0')}: ${result}  (${secs}s)`)
  return result
}

async function evaluateModel(model: string): Promise<Map<string, number>> {
  const results: string[] = []
  const offset = await existingRunCount(model)
  if (offset > 0)
    report(`  (${offset} existing run(s) on disk; numbering continues from ${offset + 1})`)
  for (let batchStart = 0; batchStart < RUNS; batchStart += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, RUNS - batchStart) }, (_, i) =>
      generateOnce(model, offset + batchStart + i + 1)
    )
    results.push(...(await Promise.all(batch)))
  }
  const counts = new Map<string, number>()
  for (const fw of results) counts.set(fw, (counts.get(fw) ?? 0) + 1)
  return counts
}

function pct(n: number, total: number): string {
  return `${String(Math.round((n / total) * 100)).padStart(3)}%`
}

// Rebuilt from the run files after every model, so a crash mid-suite still leaves usable results
// and earlier runs in the same folder are included.
async function writeSummary(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })
  await rebuildSummary(OUT_DIR, PROMPT_NAME)
}

it(`[${PROMPT_NAME}] measures framework adoption across ${MODELS.length} models × ${RUNS} generated Cloudflare Workers apps`, async () => {
  const byModel = new Map<string, Map<string, number>>()
  for (const model of MODELS) {
    report(`\n▶ ${model}`)
    byModel.set(model, await evaluateModel(model))
    await writeSummary()
  }

  const sawErrors = [...byModel.values()].some((c) => c.has(ERROR))
  const columns = [...FRAMEWORKS.map(([name]) => name), NONE, ...(sawErrors ? [ERROR] : [])]
  const col = Math.max(...MODELS.map((m) => m.length)) + 2
  const width = Math.max(14, ...columns.map((c) => c.length + 2))

  report('\nFramework adoption by model:')
  report(`  ${'model'.padEnd(col)}${columns.map((c) => c.padStart(width)).join('')}`)
  for (const [model, counts] of byModel) {
    const cells = columns.map((c) => {
      const n = counts.get(c) ?? 0
      return `${pct(n, RUNS)} (${n}/${RUNS})`.padStart(width)
    })
    report(`  ${model.padEnd(col)}${cells.join('')}`)
  }

  await writeSummary()
  report(`\nReplies, summary.json and summary.html written to ${OUT_DIR}`)

  for (const counts of byModel.values()) {
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(RUNS)
  }
})
