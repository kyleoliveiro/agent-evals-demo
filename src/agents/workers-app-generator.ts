'use agent'
import { useInitialData, useModel } from '@flue/runtime'
import * as v from 'valibot'

export function WorkersAppGenerator() {
  const { model } = useInitialData<v.InferOutput<typeof WorkersAppGenerator.initialData>>()
  useModel(model)
  return 'You are a software engineer. When asked to build an application, output all the source code and config files it needs in code blocks.'
}
WorkersAppGenerator.initialData = v.object({ model: v.string() })
