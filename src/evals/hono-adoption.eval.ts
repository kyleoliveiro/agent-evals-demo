import { init } from '@flue/runtime'
import { start } from '@flue/runtime/node'
import { afterAll, expect, it } from 'vitest'
import { WorkersAppGenerator } from '../agents/workers-app-generator.ts'

const RUNS = 20
const CONCURRENCY = 5

// Neutral prompt — no mention of Hono at all
const PROMPT = [
  'Build a minimal Cloudflare Workers application in TypeScript.',
  'Create a GET /health endpoint that returns `{ "ok": true }`.',
  'Choose whatever libraries or frameworks you think are appropriate.',
  'Output all the files it needs, including package.json.'
].join('\n')

const flue = await start({ agents: [WorkersAppGenerator] })
afterAll(() => flue.stop())

// vitest's default reporter swallows console.log, so write to stdout directly
function report(line: string): void {
  process.stdout.write(`${line}\n`)
}

function usesHono(source: string): boolean {
  return (
    /from\s+['"]hono(?:\/[\w./-]+)?['"]/.test(source) ||
    /require\(\s*['"]hono['"]\s*\)/.test(source) ||
    /['"]hono['"]\s*:\s*['"]/.test(source)
  )
}

async function generateOnce(runNumber: number): Promise<boolean> {
  // init() without an id starts a fresh conversation every time
  const agent = init(WorkersAppGenerator)
  const receipt = await agent.dispatch(PROMPT)
  const reply = await agent.read(receipt)
  console.log(reply)
  const hono = usesHono(reply.text)
  report(`Run ${String(runNumber).padStart(2, '0')}: ${hono ? 'Hono' : 'Other'}`)
  return hono
}

it(`measures Hono adoption across ${RUNS} generated Cloudflare Workers apps`, async () => {
  const results: boolean[] = []
  for (let offset = 0; offset < RUNS; offset += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, RUNS - offset) }, (_, i) => generateOnce(offset + i + 1))
    results.push(...(await Promise.all(batch)))
  }

  const honoCount = results.filter(Boolean).length
  const percent = Math.round((honoCount / RUNS) * 100)
  report(`\nHono adoption: ${percent}% (${honoCount}/${RUNS})`)

  expect(results).toHaveLength(RUNS)
})
