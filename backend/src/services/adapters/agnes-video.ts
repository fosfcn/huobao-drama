/**
 * Agnes AI Video Adapter
 * Compatible with Agnes Video V2.0 API
 * 
 * API Endpoints (per Agnes Video V2.0 docs):
 * - POST /v1/videos -> { id, task_id, video_id, status: "queued", progress: 0 }
 * - GET  /agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-v2.0 (recommended)
 * - GET  /v1/videos/{task_id} (compatibility)
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

    // Calculate num_frames: must follow 8n+1 rule, max 441
    const duration = Number(record.duration) || 5
    const frameRate = 24
    let numFrames = Math.round((duration * frameRate - 1) / 8) * 8 + 1
    numFrames = Math.min(441, Math.max(41, numFrames))

    const body: any = {
      model,
      prompt: record.prompt || '',
      num_frames: numFrames,
      frame_rate: frameRate,
      width: 1152,
      height: 768,
    }

    // Reference image modes
    if (record.referenceMode === 'single' && record.imageUrl) {
      body.image = record.imageUrl
    } else if (record.referenceMode === 'first_last' && record.firstFrameUrl) {
      const images = [record.firstFrameUrl]
      if (record.lastFrameUrl) images.push(record.lastFrameUrl)
      body.extra_body = {
        image: images,
        mode: 'keyframes',
      }
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      let urls: string[] = []
      try { urls = JSON.parse(record.referenceImageUrls) } catch { urls = [] }
      if (urls.length > 0) {
        body.extra_body = {
          image: urls,
        }
      }
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/videos'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result.task_id || result.id
    const videoId = result.video_id

    if (taskId || videoId) {
      return { isAsync: true, taskId: videoId || taskId }
    }
    const videoUrl = result.remixed_from_video_id || result.video_url || result.data?.video_url
    if (videoUrl) {
      return { isAsync: false, videoUrl }
    }
    throw new Error('No task_id or video_id in agnes video response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const baseUrl = (config.baseUrl || '').replace(/\/+$/, '')

    if (taskId.startsWith('video_')) {
      // Build URL manually to avoid URL constructor encoding ? and = in query string
      const pollUrl = `${baseUrl}/agnesapi?video_id=${taskId}&model_name=agnes-video-v2.0`
      return {
        url: pollUrl,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: undefined,
      }
    }
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/videos/' + taskId),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = result.status

    if (status === 'completed') {
      const videoUrl = result.remixed_from_video_id
        || result.video_url
        || result.data?.video_url
        || null
      return {
        status: 'completed',
        videoUrl,
      }
    }
    if (status === 'failed') {
      const error = result.error?.message || result.error || result.error_msg || 'Video generation failed'
      return { status: 'failed', error: String(error) }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.remixed_from_video_id
      || result.video_url
      || result.data?.video_url
      || null
  }
}
