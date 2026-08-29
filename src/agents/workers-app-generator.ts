'use agent'
import { useModel } from '@flue/runtime'

// Override with e.g. EVAL_MODEL=anthropic/claude-haiku-4-5
const MODEL = process.env.EVAL_MODEL ?? 'anthropic/claude-sonnet-4-6'

export function WorkersAppGenerator() {
  useModel(MODEL)
  return 'You are a software engineer. When asked to build an application, output all the source code and config files it needs in code blocks.'
}
