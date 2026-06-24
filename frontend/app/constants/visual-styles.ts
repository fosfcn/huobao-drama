/**
 * 视觉风格映射定义
 * value: 存储到数据库的英文标识符
 * label: 前端显示的中文名称
 * prompt: 生成图片时拼入 prompt 的英文关键词
 */
export const VISUAL_STYLES = [
  { value: "realistic",    label: "写实风格",   prompt: "realistic photography, photorealistic" },
  { value: "cinematic",    label: "电影风格",   prompt: "cinematic, film still, movie scene" },
  { value: "anime",        label: "动漫风格",   prompt: "anime illustration, anime art style" },
  { value: "ghibli",       label: "吉卜力风格", prompt: "ghibli style, studio ghibli, miyazaki" },
  { value: "comic",        label: "漫画风格",   prompt: "comic book style, graphic novel art" },
  { value: "watercolor",   label: "水彩风格",   prompt: "watercolor painting, watercolor illustration" },
  { value: "cyberpunk",    label: "赛博朋克",   prompt: "cyberpunk, neon-lit futuristic, dystopian" },
  { value: "xianxia",      label: "古风仙侠",   prompt: "xianxia, chinese fantasy art, cultivation" },
  { value: "ink-wash",     label: "国风水墨",   prompt: "chinese ink wash painting, traditional ink" },
  { value: "oil-painting", label: "油画风格",   prompt: "oil painting, classical art, rich texture" },
  { value: "pixel",        label: "像素风格",   prompt: "pixel art, 8-bit, retro game" },
  { value: "steampunk",    label: "蒸汽朋克",   prompt: "steampunk, victorian sci-fi, brass gears" },
  { value: "gothic",       label: "哥特风格",   prompt: "gothic, dark fantasy, ornate architecture" },
  { value: "dark",         label: "暗黑风格",   prompt: "dark fantasy, moody atmosphere, dramatic shadows" },
  { value: "minimalist",   label: "极简风格",   prompt: "minimalist, clean design, simple composition" },
  { value: "j-fresh",      label: "日系清新",   prompt: "japanese fresh style, soft pastel, light airy" },
  { value: "3d-render",    label: "3D渲染",     prompt: "3D render, CGI, digital art, octane render" },
  { value: "claymation",   label: "黏土动画",   prompt: "claymation, clay art, stop motion style" },
] as const

export type VisualStyleValue = typeof VISUAL_STYLES[number]["value"]

/** value -> 中文 label 映射 */
export const STYLE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  VISUAL_STYLES.map(s => [s.value, s.label])
)

/** value -> prompt 英文关键词映射 */
export const STYLE_PROMPT_MAP: Record<string, string> = Object.fromEntries(
  VISUAL_STYLES.map(s => [s.value, s.prompt])
)

/** 获取 style 的中文显示名，未知值原样返回 */
export function getStyleLabel(value: string | undefined | null): string {
  if (!value) return ""
  return STYLE_LABEL_MAP[value] || value
}

/** 获取 style 的 prompt 关键词，未知值回退到 cinematic */
export function getStylePrompt(value: string | undefined | null): string {
  if (!value) return "cinematic, film still, movie scene"
  return STYLE_PROMPT_MAP[value] || value
}

/** 生成 BaseSelect 的 options 数组 */
export function getStyleSelectOptions() {
  return VISUAL_STYLES.map(s => ({ label: s.label, value: s.value }))
}
