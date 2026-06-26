/**
 * FFmpeg 单镜头合成 — 保留 Agnes 原声 + 语速变速 + 视频同步 + 烧录字幕
 */
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { v4 as uuid } from 'uuid'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')
const DATA_ROOT = path.resolve(__dirname, '../../../data')
let subtitleFilterSupport: boolean | null = null
const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
}

function supportsSubtitleFilter(): boolean {
  if (subtitleFilterSupport != null) return subtitleFilterSupport
  try {
    const output = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' })
    subtitleFilterSupport = /\bsubtitles\b/.test(output)
  } catch {
    subtitleFilterSupport = false
  }
  return subtitleFilterSupport
}

function parseDialogueForTTS(dialogue?: string | null) {
  const raw = dialogue?.trim() || ''
  if (!raw) return { speaker: '', pureText: '', ignorable: true }
  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = speakerMatch ? speakerMatch[1].replace(/[（(].+?[)）]/g, '').trim() : ''
  const pureText = raw.replace(/^.+?[:：]\s*/, '').replace(/[（(].+?[)）]/g, '').trim()
  const ignorable = (!!speaker && IGNORE_TTS_SPEAKERS.test(speaker)) || !pureText || IGNORE_TTS_TEXT.test(pureText)
  return { speaker, pureText, ignorable }
}

/**
 * Get effective voice speed for a storyboard.
 * Priority: storyboard.ttsSpeed > character.voiceSpeed > 1.0
 */
function getEffectiveVoiceSpeed(sb: typeof schema.storyboards.$inferSelect): number {
  // 1. Storyboard-level speed takes priority
  const sbSpeed = (sb as any).ttsSpeed
  if (sbSpeed && sbSpeed !== 1.0) return sbSpeed

  // 2. Character-level speed from voice assignment
  if (sb.dialogue) {
    const parsed = parseDialogueForTTS(sb.dialogue)
    if (parsed.speaker) {
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
      if (ep) {
        const chars = db.select().from(schema.characters)
          .where(eq(schema.characters.dramaId, ep.dramaId)).all()
        const found = chars.find(c => c.name === parsed.speaker)
        if (found?.voiceSpeed && found.voiceSpeed !== 1.0) return found.voiceSpeed
      }
    }
  }

  return 1.0
}

/**
 * Build atempo filter chain for a given speed factor.
 * FFmpeg atempo range is [0.5, 100.0]; chain multiple for out-of-range values.
 */
function buildAtempoFilter(speed: number): string {
  if (speed <= 0) return 'atempo=1.0'
  const filters: string[] = []
  let remaining = speed
  while (remaining < 0.5 || remaining > 100.0) {
    const step = remaining > 100.0 ? 100.0 : 0.5
    filters.push(`atempo=${step}`)
    remaining /= step
  }
  filters.push(`atempo=${remaining}`)
  return filters.join(',')
}

/**
 * 合成单个镜头：保留 Agnes 原声 + 语速变速 + 视频同步 + 烧录字幕
 *
 * 新逻辑：
 * - 保留视频原始中文音频（Agnes Video V2.0 生成）
 * - 根据 voiceSpeed 对音视频同步变速（atempo + setpts）
 * - 只烧录字幕，不用 TTS 替换音频
 */
export async function composeStoryboard(storyboardId: number): Promise<string> {
  const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId)).all()
  if (!sb) throw new Error(`Storyboard ${storyboardId} not found`)
  if (!sb.videoUrl) throw new Error(`Storyboard ${storyboardId} has no video`)
  db.update(schema.storyboards)
    .set({ status: 'compose_processing', composedVideoUrl: null, updatedAt: now() })
    .where(eq(schema.storyboards.id, storyboardId))
    .run()

  logTaskStart('ComposeTask', 'storyboard-compose', {
    storyboardId,
    storyboardNumber: sb.storyboardNumber,
    episodeId: sb.episodeId,
  })

  const videoPath = toAbsPath(sb.videoUrl)
  let subtitlePath: string | null = null
  const parsedDialogue = parseDialogueForTTS(sb.dialogue)
  const voiceSpeed = getEffectiveVoiceSpeed(sb)

  try {
    // 1. 生成字幕文件（SRT）
    if (!parsedDialogue.ignorable) {
      const srtDir = path.join(STORAGE_ROOT, 'subtitles')
      fs.mkdirSync(srtDir, { recursive: true })
      const srtFilename = `${uuid()}.srt`
      subtitlePath = path.join(srtDir, srtFilename)

      // Adjust subtitle timing based on voice speed
      const rawDuration = sb.duration || 10
      const adjustedDuration = voiceSpeed !== 1.0 ? Math.round(rawDuration / voiceSpeed) : rawDuration
      const endSeconds = Math.min(adjustedDuration - 1, 59)
      const pureText = parsedDialogue.pureText
      const srtContent = `1\n00:00:00,500 --> 00:00:${String(endSeconds).padStart(2, '0')},000\n${pureText}\n`
      fs.writeFileSync(subtitlePath, srtContent, 'utf-8')

      const srtRelative = `static/subtitles/${srtFilename}`
      db.update(schema.storyboards).set({ subtitleUrl: srtRelative, updatedAt: now() })
        .where(eq(schema.storyboards.id, storyboardId)).run()
    }

    // 2. FFmpeg 合成 — 保留原声 + 语速变速 + 字幕烧录
    const outputDir = path.join(STORAGE_ROOT, 'composed')
    fs.mkdirSync(outputDir, { recursive: true })
    const outputFilename = `${uuid()}.mp4`
    const outputPath = path.join(outputDir, outputFilename)

    await new Promise<void>((resolve, reject) => {
      // Build filter chains for video and audio
      const videoFilters: string[] = []
      const audioFilters: string[] = []

      // Video speed: setpts=PTS/speed (faster speed = shorter video)
      if (voiceSpeed !== 1.0) {
        videoFilters.push(`setpts=PTS/${voiceSpeed}`)
        audioFilters.push(buildAtempoFilter(voiceSpeed))
      }

      // Subtitle burn-in (applied after speed change so timing stays in sync)
      if (subtitlePath && supportsSubtitleFilter()) {
        const escapedPath = subtitlePath
          .replace(/\\/g, '/')
          .replace(/:/g, '\\:')
          .replace(/'/g, "\\'")
        const forceStyle = 'FontSize=20\\,PrimaryColour=&HFFFFFF&\\,OutlineColour=&H000000&\\,Outline=2'
        videoFilters.push(`subtitles=filename='${escapedPath}':force_style='${forceStyle}'`)
      } else if (subtitlePath) {
        logTaskProgress('ComposeTask', 'subtitle-filter-unavailable', {
          storyboardId,
          subtitlePath,
        })
      }

      const hasVideoFilter = videoFilters.length > 0
      const hasAudioFilter = audioFilters.length > 0

      if (hasVideoFilter || hasAudioFilter) {
        // Use filter_complex for synchronized audio+video processing
        const filterParts: string[] = []

        if (hasVideoFilter) {
          filterParts.push(`[0:v]${videoFilters.join(',')}[v]`)
        }
        if (hasAudioFilter) {
          filterParts.push(`[0:a]${audioFilters.join(',')}[a]`)
        }

        const filterComplex = filterParts.join(';')

        const outputOptions = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '23']

        // Map the filtered streams
        if (hasVideoFilter) {
          outputOptions.push('-map', '[v]')
        }
        if (hasAudioFilter) {
          outputOptions.push('-map', '[a]')
          outputOptions.push('-c:a', 'aac', '-b:a', '192k')
        } else {
          // No audio filter but video was filtered — keep original audio stream
          outputOptions.push('-map', '0:a', '-c:a', 'aac', '-b:a', '192k')
        }

        ffmpeg(videoPath)
          .complexFilter(filterComplex)
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run()
      } else {
        // No filters — simple re-encode preserving original audio
        ffmpeg(videoPath)
          .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k'])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run()
      }
    })

    const composedRelative = `static/composed/${outputFilename}`
    db.update(schema.storyboards).set({ composedVideoUrl: composedRelative, status: 'compose_completed', updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId)).run()

    logTaskSuccess('ComposeTask', 'storyboard-compose', {
      storyboardId,
      storyboardNumber: sb.storyboardNumber,
      voiceSpeed,
      output: composedRelative,
    })
    return composedRelative
  } catch (err) {
    db.update(schema.storyboards)
      .set({ status: 'compose_failed', composedVideoUrl: null, updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId))
      .run()
    throw err
  }
}
