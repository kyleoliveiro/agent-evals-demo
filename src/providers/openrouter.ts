import { createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'

// Pi's bundled OpenRouter catalog lags behind OpenRouter itself. Models that
// exist upstream but not in the catalog are added here; metadata mirrors the
// shape of neighbouring catalog entries. Pricing is informational only.
const EXTRA_MODELS: Model<'openai-completions'>[] = [
  {
    id: 'x-ai/grok-4.6',
    name: 'xAI: Grok 4.6',
    api: 'openai-completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    provider: 'openrouter',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
    contextWindow: 500_000,
    maxTokens: 32_768,
    compat: { supportsDeveloperRole: false, thinkingFormat: 'openrouter' },
  },
  {
    id: 'google/gemini-3.7-flash',
    name: 'Google: Gemini 3.7 Flash',
    api: 'openai-completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    provider: 'openrouter',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0.083333 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    compat: { supportsDeveloperRole: false, thinkingFormat: 'openrouter' },
  },
]

const builtinModels = openrouterProvider().getModels()
const known = new Set(builtinModels.map((m) => m.id))

export const openrouter = createProvider({
  id: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  auth: { apiKey: envApiKeyAuth('OpenRouter API key', ['OPENROUTER_API_KEY']) },
  models: [...builtinModels, ...EXTRA_MODELS.filter((m) => !known.has(m.id))],
  api: openAICompletionsApi(),
})
