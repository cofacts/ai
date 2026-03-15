import { LangfuseWeb } from 'langfuse'

export const langfuse = new LangfuseWeb({
  publicKey: import.meta.env.VITE_LANGFUSE_PUBLIC_KEY,
  baseUrl: import.meta.env.VITE_LANGFUSE_BASE_URL,
})
