export interface EvalSummary {
  runs: number
  promptName?: string
  prompt: string
  frameworks: string[]
  results: Record<string, Record<string, number>>
}

const COLORS: Record<string, string> = {
  Hono: '#e8590c',
  Elysia: '#7048e8',
  Express: '#2f9e44',
  Fastify: '#1971c2',
  Koa: '#0c8599',
  NestJS: '#c2255c',
  'None/Other': '#868e96',
  Error: '#212529',
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100)
}

/** Self-contained HTML (data inlined — file:// blocks fetch) visualising a summary.json. */
export function renderSummaryHtml(summary: EvalSummary): string {
  const { runs, results } = summary
  const total = (m: string) => Object.values(results[m]!).reduce((a, b) => a + b, 0)
  const models = Object.keys(results)
  const seen = new Set(models.flatMap((m) => Object.keys(results[m]!)))
  const columns = [...summary.frameworks, 'None/Other', ...(seen.has('Error') ? ['Error'] : [])]
  const color = (c: string) => COLORS[c] ?? '#adb5bd'

  const legend = columns
    .map((c) => `<span class="key"><i style="background:${color(c)}"></i>${esc(c)}</span>`)
    .join('')

  const bars = models
    .map((m) => {
      const counts = results[m]!
      const segs = columns
        .filter((c) => (counts[c] ?? 0) > 0)
        .map((c) => {
          const n = counts[c] ?? 0
          const p = pct(n, total(m))
          return `<div class="seg" style="width:${p}%;background:${color(c)}" title="${esc(c)}: ${n}/${total(m)} (${p}%)">${p >= 12 ? `${esc(c)} ${p}%` : ''}</div>`
        })
        .join('')
      return `<div class="row"><div class="label" title="${esc(m)}">${esc(m.replace(/^openrouter\//, ''))}</div><div class="bar">${segs}</div></div>`
    })
    .join('')

  const runLinks = (m: string) =>
    Array.from({ length: total(m) }, (_, i) => {
      const n = String(i + 1).padStart(2, '0')
      return `<a href="./${esc(m.replace(/\//g, '__'))}/run-${n}.md">${n}</a>`
    }).join(' ')

  const table = `<table><thead><tr><th>model</th>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}<th>runs</th></tr></thead><tbody>${models
    .map((m) => {
      const counts = results[m]!
      const cells = columns
        .map((c) => {
          const n = counts[c] ?? 0
          return `<td class="${n ? 'hit' : 'zero'}">${pct(n, total(m))}% <small>(${n}/${total(m)})</small></td>`
        })
        .join('')
      return `<tr><td class="model">${esc(m)}</td>${cells}<td class="links">${runLinks(m)}</td></tr>`
    })
    .join('')}</tbody></table>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Framework adoption${summary.promptName ? ` (${esc(summary.promptName)} prompt)` : ''} — ${runs} runs × ${models.length} models</title>
<style>
  :root{color-scheme:light dark;font-family:system-ui,sans-serif;font-size:14px}
  body{margin:0;padding:2rem;max-width:1100px;margin-inline:auto;line-height:1.4}
  h1{font-size:1.4rem;margin:0 0 .25rem}
  .meta{color:#868e96;margin-bottom:1.5rem}
  .legend{display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;margin-bottom:1rem}
  .key i{display:inline-block;width:.8em;height:.8em;border-radius:2px;margin-right:.4em;vertical-align:-1px}
  .row{display:grid;grid-template-columns:220px 1fr;gap:.75rem;align-items:center;margin-bottom:.5rem}
  .label{font-family:ui-monospace,monospace;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
  .bar{display:flex;height:1.6rem;border-radius:4px;overflow:hidden;background:rgba(128,128,128,.12)}
  .seg{display:flex;align-items:center;justify-content:center;color:#fff;font-size:.75rem;white-space:nowrap;overflow:hidden}
  table{border-collapse:collapse;width:100%;margin-top:2rem;font-variant-numeric:tabular-nums}
  th,td{padding:.4rem .6rem;text-align:right;border-bottom:1px solid rgba(128,128,128,.25)}
  th:first-child,td.model{text-align:left;font-family:ui-monospace,monospace;font-size:.85rem}
  td.zero{color:#adb5bd}
  td.hit{font-weight:600}
  td.links{font-family:ui-monospace,monospace;font-size:.8rem;text-align:left}
  small{color:#868e96;font-weight:400}
  details{margin-top:2rem}
  pre{white-space:pre-wrap;background:rgba(128,128,128,.1);padding:1rem;border-radius:6px;font-size:.8rem}
</style></head><body>
<h1>Framework adoption${summary.promptName ? ` <small>· ${esc(summary.promptName)} prompt</small>` : ''}</h1>
<div class="meta">${runs} runs per model (see per-row totals) · ${models.length} models · run files linked in the table</div>
<div class="legend">${legend}</div>
${bars}
${table}
<details><summary>Prompt</summary><pre>${esc(summary.prompt)}</pre></details>
</body></html>
`
}
