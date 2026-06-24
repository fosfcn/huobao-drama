# 更新日志

## v1.0.0 (2026-05-15)

### 新增功能
- 版本号显示: 前端 header 右侧展示版本徽章，从 health API 获取
- health API: 新增 version 和 buildHash 字段
- Dockerfile BUILD_HASH: 构建时自动注入 git commit hash
- Agnes Video 适配器: 支持 agnes-ai 视频生成 API（任务提交+轮询模式）
- OpenAI TTS 适配器: 支持二进制音频响应
- 适配器注册: 新适配器已注册到 registry

### 修复
- sharp 模块兼容性: 服务器 CPU 不支持 v2 microarchitecture，sharp 预编译二进制无法加载
  - grid-split.ts: sharp 改为异步懒加载
  - storage.ts: sharp 懒加载，失败时降级返回原始图片

### 配置定制
- AI 服务组合: OpenRouter (文本主) / Agnes AI (文本备+图片+视频) / Edge TTS (音频)
- docker-compose.yml: extra_hosts 和容器名配置
- tts-generation.ts: 支持二进制 TTS 音频响应

