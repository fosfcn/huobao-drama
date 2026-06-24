/**
 * Agnes AI Video Adapter
 * 端点: /v1/video/generations (创建) -> /v1/video/generations/{taskId} (轮询)
 * 模型: agnes-video-v2.0
 *
 * API 格式 (基于 agnes-ai.com 文档和实测):
 * - POST /v1/video/generations -> { id: "task_xxx", task_id: "task_xxx", status: "queued" }
 * - GET  /v1/video/generations/{taskId} -> { code: "success", data: { status: "succeeded", ... } }
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'

export class AgnesVideoAdapter implements VideoProviderAdapter {
  provider = 'agnes'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'agnes-video-v2.0'

    const body: any = {
      model,
      prompt: record.prompt || '',
      seconds: String(this.normalizeDuration(record.duration)),
      size: this.normalizeSize(record.aspectRatio),
    }

    // 添加参考图
    if (record.referenceMode === 'single' && record.imageUrl) {
      body.image_url = record.imageUrl
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) body.first_frame_url = record.firstFrameUrl
      if (record.lastFrameUrl) body.last_frame_url = record.lastFrameUrl
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/video/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    // agnes-ai 返回 { id: "task_xxx", task_id: "task_xxx", status: "queued" }
    const taskId = result.task_id || result.id
    if (taskId) {
      return { isAsync: true, taskId }
    }
    // 同步返回
    const videoUrl = result.video_url || result.data?.video_url
    if (videoUrl) {
      return { isAsync: false, videoUrl }
    }
    throw new Error('No task_id or video_url in agnes video response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/video/generations/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    // agnes-ai 轮询返回格式:
    // { code: "success", data: { status: "succeeded", data: { ... } } }
    const wrapper = result.data || result
    // 嵌套的 data 字段
    const inner = wrapper.data || wrapper
    const status = inner.status || wrapper.status

    if (status === 'succeeded' || status === 'completed') {
      const videoUrl = inner.video_url
        || inner.output?.video_url
        || inner.content?.video_url
        || wrapper.video_url
        || null
      return {
        status: 'completed',
        videoUrl,
      }
    }
    if (status === 'failed') {
      return { status: 'failed', error: inner.error || inner.fail_reason || 'Video generation failed' }
    }
    // queued, NOT_START, processing 等
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const wrapper = result.data || result
    const inner = wrapper.data || wrapper
    return inner.video_url
      || inner.output?.video_url
      || inner.content?.video_url
      || wrapper.video_url
      || null
  }

  private normalizeDuration(duration?: number | null): number {
    const parsed = Math.round(Number(duration || 5))
    if (!Number.isFinite(parsed)) return 5
    return Math.min(10, Math.max(4, parsed))
  }

  private normalizeSize(aspectRatio?: string | null): string {
    if (!aspectRatio) return '1280x704'
    const map: Record<string, string> = {
      '16:9': '1280x704',
      '9:16': '704x1280',
      '1:1': '704x704',
      'adaptive': '1280x704',
    }
    return map[aspectRatio] || '1280x704'
  }
}
