/**
 * TTS 语音合成服务
 * 支持 MiniMax TTS (hex 音频响应) 和 OpenAI 兼容 /audio/speech (二进制响应)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { getAudioConfigById } from './ai.js'
import { getTTSAdapter } from './adapters/registry.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, redactUrl } from '../utils/task-logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

interface TTSParams {
  text: string
  voice: string
  model?: string
  speed?: number
  emotion?: string
  configId?: number | null
}

/**
 * 生成 TTS 音频，返回本地文件路径
 */
export async function generateTTS(params: TTSParams): Promise<string> {
  const config = getAudioConfigById(params.configId)
  const adapter = getTTSAdapter(config.provider)

  logTaskStart('AudioTask', 'tts-generate', {
    provider: config.provider,
    voice: params.voice,
    model: params.model || config.model,
    textPreview: params.text.slice(0, 50),
    textLength: params.text.length,
  })
  logTaskPayload('AudioTask', 'tts params', {
    config: {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    },
    params,
  })

  const { url, method, headers, body } = adapter.buildGenerateRequest(config, params)
  logTaskProgress('AudioTask', 'request', {
    provider: config.provider,
    voice: params.voice,
    method,
    url: redactUrl(url),
    model: params.model || config.model,
  })
  logTaskPayload('AudioTask', 'request payload', {
    method,
    url,
    headers,
    body,
  })

  const resp = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    logTaskError('AudioTask', 'tts-generate', { provider: config.provider, voice: params.voice, status: resp.status, error: errText })
    throw new Error(`TTS API error ${resp.status}: ${errText}`)
  }

  // 检查是否为二进制响应适配器 (OpenAI /v1/audio/speech)
  const isBinary = typeof (adapter as any).isBinaryResponse === 'function' && (adapter as any).isBinaryResponse()

  // 保存到本地
  const audioDir = path.join(STORAGE_ROOT, 'audio')
  fs.mkdirSync(audioDir, { recursive: true })

  let buffer: Buffer
  let format = 'mp3'

  if (isBinary) {
    // OpenAI 兼容 TTS 返回二进制音频数据
    const arrayBuffer = await resp.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)

    // 从 Content-Type 推断格式
    const contentType = resp.headers.get('content-type') || ''
    if (contentType.includes('wav')) format = 'wav'
    else if (contentType.includes('ogg')) format = 'ogg'
    else if (contentType.includes('webm')) format = 'webm'

    logTaskSuccess('AudioTask', 'tts-saved-binary', {
      provider: config.provider,
      voice: params.voice,
      format,
      bytes: buffer.length,
    })
  } else {
    // MiniMax TTS 返回 JSON hex 音频数据
    const result = await resp.json()
    const parsed = adapter.parseResponse(result)
    buffer = Buffer.from(parsed.audioHex, 'hex')
    format = parsed.format || 'mp3'

    logTaskSuccess('AudioTask', 'tts-saved-hex', {
      provider: config.provider,
      voice: params.voice,
      format,
      bytes: buffer.length,
      audioMs: parsed.audioLength,
    })
  }

  const filename = `${uuid()}.${format}`
  const filePath = path.join(audioDir, filename)
  fs.writeFileSync(filePath, buffer)

  const relativePath = `static/audio/${filename}`
  return relativePath
}

/**
 * 为角色生成试听音频
 */
export async function generateVoiceSample(characterName: string, voiceId: string, configId?: number | null): Promise<string> {
  const sampleText = `你好，我是${characterName}。很高兴认识你，这是我的声音试听。`
  return generateTTS({ text: sampleText, voice: voiceId, configId })
}
