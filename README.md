# Hono Adoption Eval

A tiny demo using [Flue](https://flueframework.com/). It asks a Claude Sonnet agent to build a minimal Cloudflare Workers app with a neutral prompt (no mention of Hono), 20 times, and measures how often the generated code uses Hono.

## How to run

```sh
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...
pnpm evals
```

Each run and the final summary are printed to the terminal:

```
Run 01: Hono
Run 02: Other
...

Hono adoption: 75% (15/20)
```
