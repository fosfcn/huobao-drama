/**
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'
import { createOpenAI } from '@ai-sdk/openai'

export type ServiceType = 'text' | 'image' | 'video' | 'audio'

export interface AIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

export function getTextProviderBaseUrl(config: AIConfig) {
  const provider = config.provider.toLowerCase()

  if (provider === 'openai' || provider === 'openrouter' || provider === 'chatfire') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  if (provider === 'volcengine') {
    return joinProviderUrl(config.baseUrl, '/api/v3', '')
  }

  if (provider === 'ali') {
    return joinProviderUrl(config.baseUrl, '/api/v1', '')
  }

  return config.baseUrl
}

export function getActiveConfig(serviceType: ServiceType): AIConfig | null {
  const rows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
    .all()
    .filter(r => r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0)) // 高优先级优先

  const active = rows[0]
  if (!active) {
    logTaskWarn('AIConfig', 'active-config-missing', { serviceType })
    return null
  }

  const models = active.model ? JSON.parse(active.model) : []
  logTaskProgress('AIConfig', 'active-config-selected', {
    serviceType,
    configId: active.id,
    provider: active.provider,
    model: models[0] || '',
    priority: active.priority,
  })
  return {
    provider: active.provider || '',
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: models[0] || '',
  }
}

export function getTextConfig(): AIConfig {
  const config = getActiveConfig('text')
  if (!config) throw new Error('No active text AI config')
  return config
}

export function getAudioConfig(): AIConfig {
  const config = getActiveConfig('audio')
  if (!config) throw new Error('No active audio AI config — 请在设置中添加音频服务')
  return config
}

export function getAudioConfigById(id?: number | null): AIConfig {
  if (id) {
    const config = getConfigById(id)
    if (config) return config
  }
  return getAudioConfig()
}

export function getConfigById(id: number): AIConfig | null {
  const [row] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id)).all()
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id })
    return null
  }
  const models = row.model ? JSON.parse(row.model) : []
  logTaskProgress('AIConfig', 'config-by-id-selected', {
    configId: id,
    provider: row.provider,
    model: models[0] || '',
    serviceType: row.serviceType,
  })
  return {
    provider: row.provider || '',
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
  }
}


/** 获取某个服务类型的所有活跃配置，按优先级降序排列 */
export function getAllActiveConfigs(serviceType: ServiceType): AIConfig[] {
  const rows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
    .all()
    .filter(r => r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))

  return rows.map(row => {
    const models = row.model ? JSON.parse(row.model) : []
    return {
      provider: row.provider || '',
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      model: models[0] || '',
    }
  })
}

/** 判断错误是否可重试（限流、服务端错误、网络超时等） */
export function isRetryableError(err: any): boolean {
  if (!err) return false

  // AI SDK 的 APICallError 带 statusCode
  const statusCode = err.statusCode || err.status || err.code
  if (typeof statusCode === 'number') {
    return statusCode === 429 || statusCode >= 500
  }

  // OpenRouter 429 限流
  const msg = (err.message || '').toLowerCase()
  if (msg.includes('rate-limit') || msg.includes('rate_limited') || msg.includes('429')) return true
  if (msg.includes('provider returned error')) return true
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnreset')) return true
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true

  // AI_APICallError 标记
  if (err.isRetryable === true) return true

  return false
}

/** 根据 AIConfig 创建 OpenAI provider 和 model */
export function createModelFromConfig(config: AIConfig) {
  const resolvedBaseURL = getTextProviderBaseUrl(config)
  const provider = createOpenAI({
    baseURL: resolvedBaseURL,
    apiKey: config.apiKey,
  } as any)
  return provider.chat(config.model)
}
