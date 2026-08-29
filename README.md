# Framework Adoption Eval

A tiny demo using [Flue](https://flueframework.com/). It asks a set of models (via OpenRouter) to build a moderately complex Cloudflare Workers REST API (a task-board backend with ~10 routes, path params, auth, CORS, logging, and structured errors) using a neutral prompt that names no framework, 20 times per model, and reports which HTTP framework each model reaches for.

The task is intentionally non-trivial: for a single `GET /health` route a bare `fetch` handler is the right answer, so it says nothing about defaults. Routing, path params, and middleware-style concerns are where framework choice actually shows up.

## How to run

```sh
pnpm install
cp .env.example .env   # then fill in OPENROUTER_API_KEY
pnpm evals
```

Two prompts live in `src/evals/prompts.ts`, identical except for the deployment target:

- `cloudflare` (default) — names Cloudflare Workers, KV, and wrangler.
- `neutral` — names no platform at all, to test whether the platform, not the task, drives framework choice.

```sh
pnpm evals            # cloudflare prompt
pnpm evals:neutral    # neutral prompt
```

Defaults: 9 models × 3 runs. Override with env vars:

```sh
EVAL_RUNS=10 EVAL_MODELS="openrouter/anthropic/claude-sonnet-5,openrouter/moonshotai/kimi-k3" pnpm evals
```

Models are OpenRouter IDs prefixed with `openrouter/`. Pi's bundled OpenRouter catalog lags upstream; models missing from it (currently `x-ai/grok-4.6`, `google/gemini-3.7-flash`) are added to the provider built in `src/providers/openrouter.ts`. `pnpm test` checks that every default model resolves.

Each run and a per-model summary are printed to the terminal:

```
▶ openrouter/anthropic/claude-sonnet-5
  openrouter/anthropic/claude-sonnet-5  run 01: Hono
  openrouter/anthropic/claude-sonnet-5  run 02: None/Other
...

Framework adoption by model:
  model                                        Hono        Elysia       Express       Fastify           Koa        NestJS    None/Other
  openrouter/anthropic/claude-sonnet-5   75% (15/20)     0% (0/20)     0% (0/20)     0% (0/20)     0% (0/20)     0% (0/20)    25% (5/20)
  openrouter/moonshotai/kimi-k3          40% (8/20)      0% (0/20)     5% (1/20)     0% (0/20)     0% (0/20)     0% (0/20)   55% (11/20)
```

Every generated reply is saved to `results/<prompt>-<hash>/<model>/run-NN.md` (with the detected framework in a header comment) alongside `summary.json` and a self-contained `summary.html` (open it in a browser for a chart + table with links to each run), so any classification can be audited. `<hash>` is a short SHA-256 of the prompt text, so editing a prompt starts a fresh folder while re-running the same prompt appends to the existing one (run numbering continues). Override the base directory with `EVAL_OUT_DIR`.

To merge folders or recover from an interrupted run, copy `<model>/` directories into one folder and rebuild its summary from the run headers: `pnpm report results/<folder>`.

`None/Other` means the generated code used no framework, or one not in the detection list (`FRAMEWORKS` in `src/evals/framework-adoption.eval.ts`). Runs that error (auth, rate limit, provider outage) or exceed `EVAL_RUN_TIMEOUT_MS` (default 10 min; `0` disables) get an extra `Error` column rather than aborting the suite. `summary.json`/`.html` are rewritten after each model finishes, so partial results survive an interrupted run.
