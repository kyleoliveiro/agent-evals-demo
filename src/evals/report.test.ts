import { expect, it } from 'vitest'
import { renderSummaryHtml } from './report.ts'

it('renders every model, column and run link', () => {
  const html = renderSummaryHtml({
    runs: 3,
    prompt: 'Build <an> API',
    frameworks: ['Hono', 'Elysia'],
    results: {
      'openrouter/a/x': { Hono: 2, 'None/Other': 1 },
      'openrouter/b/y': { Error: 3 },
    },
  })
  expect(html).toContain('openrouter/a/x')
  expect(html).toContain('<th>Elysia</th>')
  expect(html).toContain('<th>Error</th>')
  expect(html).toContain('href="./openrouter__b__y/run-03.md"')
  expect(html).toContain('Build &lt;an&gt; API')
})
