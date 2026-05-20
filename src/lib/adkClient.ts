import createClient from 'openapi-fetch'
import type { paths } from './adk-types.js'

const ADK_BASE_URL = process.env.ADK_URL || 'http://localhost:8000'

export const adkClient = createClient<paths>({ baseUrl: ADK_BASE_URL })
export const ADK_APP_NAME = 'cofacts_ai'
