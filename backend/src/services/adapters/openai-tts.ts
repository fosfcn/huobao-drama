/**
 * OpenAI 兼容 TTS Adapter (支持 Edge TTS 等)
 * 端点: /v1/audio/speech
 * 响应: 二进制音频数据 (mp3)
 */
import type { TTSProviderAdapter } from './types'
import { joinProviderUrl } from './url'

export interface TTSParams {
  text: string
  voice: string
  speed?: number
  model?: string
  emotion?: string
}

export interface TTSResult {
  audioHex: string
  audioLength: number
  sampleRate: number
  bitrate: number
  format: string
  channel: number
}

export class OpenAITTSAdapter implements TTSProviderAdapter {
  readonly provider = 'openai'

  buildGenerateRequest(config: any, params: TTSParams): {
    url: string
    method: string
    headers: Record<string, string>
    body: any
  } {
    const url = joinProviderUrl(config.baseUrl, '/v1', '/audio/speech')

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (config.apiKey && config.apiKey !== 'edge-tts') {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }

    const body: any = {
      model: params.model || config.model || 'tts-1',
      input: params.text,
      voice: params.voice || 'alloy',
      response_format: 'mp3',
    }

    if (params.speed && params.speed !== 1) {
      body.speed = params.speed
    }

    return { url, method: 'POST', headers, body }
  }

  parseResponse(_result: any): TTSResult {
    // OpenAI TTS returns binary, not JSON
    // The TTS service should check isBinaryResponse() and handle accordingly
    throw new Error('OpenAI TTS adapter returns binary data. Use isBinaryResponse() check instead.')
  }

  /**
   * Mark that this adapter returns binary audio data, not JSON hex
   */
  isBinaryResponse(): boolean {
    return true
  }
}
