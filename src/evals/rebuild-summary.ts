// Rebuild summary.json + summary.html for a results folder from its run-*.md
// headers. Lets you merge folders (copy <model>/ dirs in, rerun this) or
// recover a summary after an interrupted run.
//
//   pnpm report results/<folder> [--prompt cloudflare|neutral]
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolvePrompt } from './prompts.ts'
import { renderSummaryHtml, type EvalSummary } from './report.ts'

const HEADER = /^<!-- model: (.+?) \| run: (\d+) \| framework: (.+?) -->/

export async function rebuildSummary(dir: string, promptName?: string): Promise<EvalSummary> {
  const existing = await readFile(path.join(dir, 'summary.json'), 'utf8')
    .then((s) => JSON.parse(s) as Partial<EvalSummary>)
    .catch(() => ({}) as Partial<EvalSummary>)
  const prompt = resolvePrompt(promptName ?? existing.promptName)

  const results: Record<string, Record<string, number>> = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const file of await readdir(path.join(dir, entry.name))) {
      if (!/^run-\d+\.md$/.test(file)) continue
      const head = (await readFile(path.join(dir, entry.name, file), 'utf8')).slice(0, 300)
      const m = HEADER.exec(head)
      if (!m) throw new Error(`No header in ${path.join(entry.name, file)}`)
      const [, model, , framework] = m
      results[model!] ??= {}
      results[model!]![framework!] = (results[model!]![framework!] ?? 0) + 1
    }
  }

  const summary: EvalSummary = {
    runs: Math.max(
      0,
      ...Object.values(results).map((c) => Object.values(c).reduce((a, b) => a + b, 0))
    ),
    promptName: prompt.name,
    prompt: prompt.text,
    frameworks: existing.frameworks ?? ['Hono', 'Elysia', 'Express', 'Fastify', 'Koa', 'NestJS'],
    results,
  }
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
  await writeFile(path.join(dir, 'summary.html'), renderSummaryHtml(summary))
  return summary
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const [dir, ...rest] = process.argv.slice(2)
  if (!dir) throw new Error('usage: pnpm report results/<folder> [--prompt name]')
  const promptName = rest[rest.indexOf('--prompt') + 1]
  const s = await rebuildSummary(dir, rest.includes('--prompt') ? promptName : undefined)
  for (const [model, counts] of Object.entries(s.results)) {
    console.log(model.padEnd(44), JSON.stringify(counts))
  }
  console.log(`\nwrote ${dir}/summary.{json,html} (${s.runs} runs, ${s.promptName} prompt)`)
}
