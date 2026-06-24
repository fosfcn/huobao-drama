/**
 * Agent 聊天路由 — 非流式版本
 */
import { Hono } from 'hono'
import { validAgentTypes, runAgentWithFallback } from '../agents/index.js'
import { success, badRequest } from '../utils/response.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'

const app = new Hono()

function normalizeToolName(entry: any) {
  // Mastra structure: { type, payload: { toolName, args } }
  if (entry?.payload?.toolName) return entry.payload.toolName
  return entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || null
}

function normalizeToolResult(entry: any) {
  // Mastra structure: { type, payload: { toolName, result } }
  const payload = entry?.payload
  const result = payload?.result ?? entry?.result ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

// POST /agent/:type/chat — 非流式 Agent 对话
app.post('/:type/chat', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `Invalid agent type: ${agentType}`)
  }

  const body = await c.req.json()
  const { message, drama_id, episode_id } = body

  logTaskStart('Agent', agentType, {
    dramaId: drama_id,
    episodeId: episode_id,
    message,
  })
  logTaskPayload('Agent', `${agentType} input`, body)

  if (!episode_id || !drama_id) {
    logTaskError('Agent', agentType, { reason: 'missing drama_id or episode_id' })
    return badRequest(c, 'drama_id and episode_id are required')
  }

  const startTime = performance.now()

  try {
    const result = await runAgentWithFallback(
      agentType,
      episode_id,
      drama_id,
      [{ role: 'user', content: message }],
      { maxSteps: 20 },
    )

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })

    // 收集所有 tool calls 和 results
    const toolCalls = result.toolCalls || []
    const toolResults = result.toolResults || []
    const normalizedToolCalls = toolCalls.map((tc: any) => ({
      toolName: normalizeToolName(tc),
      args: tc?.args ?? tc?.input ?? null,
    }))
    const normalizedToolResults = toolResults.map((tr: any) => ({
      toolName: normalizeToolName(tr),
      result: normalizeToolResult(tr),
    }))

    logTaskProgress('Agent', 'tool-summary', {
      agentType,
      toolCalls: normalizedToolCalls.map((tc: any) => tc.toolName),
      toolResults: normalizedToolResults.map((tr: any) => tr.toolName),
    })
    logTaskPayload('Agent', `${agentType} tool-results`, normalizedToolResults)

    // 自动保存：如果 agent 是 script_rewriter 且返回了文本，但 episode 的 script_content 仍为空
    // 说明 LLM 没有调用 save_script 工具，直接在 text 中输出了改写结果
    let autoSaved = false
    if (agentType === 'script_rewriter' && result.text && episode_id) {
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episode_id)).all()
      if (ep && !ep.scriptContent) {
        db.update(schema.episodes)
          .set({ scriptContent: result.text, updatedAt: new Date().toISOString() })
          .where(eq(schema.episodes.id, episode_id))
          .run()
        autoSaved = true
        logTaskProgress('Agent', 'auto-saved-script', { episodeId: episode_id, textLength: result.text.length })
      }
    }

    return success(c, {
      type: 'done',
      text: result.text || '',
      toolCalls: normalizedToolCalls,
      toolResults: normalizedToolResults,
      autoSaved,
    })
  } catch (err: any) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskError('Agent', agentType, { elapsedSeconds: elapsed, error: err.message })
    console.error(err.stack || err)
    return badRequest(c, err.message || 'Agent execution failed')
  }
})

// GET /agent/:type/debug
app.get('/:type/debug', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, 'Invalid agent type')
  return success(c, { agent_type: agentType, valid: true })
})

export default app
