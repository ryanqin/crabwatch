# CrabWatch 🦀

本地桌面工具：把本机所有 Claude Code session 显示为像素地图上的小螃蟹（状态动画 + 对话窗），核心是按项目把 session 串成可审计的任务时间线（默认折叠、按需人话解释、可跳回原始记录），左上角常显 5h / weekly 用量。

## 开发

```bash
npm install
npm run cli watch     # 实时打印本机 session 活动（Phase 0 验证）
npm run cli canary    # 扫描全部 transcripts，输出行类型统计（schema 基线）
npm run typecheck
```

数据源：`~/.claude/sessions/*.json`（活跃 session）、`~/.claude/projects/**/*.jsonl`（transcript，增量 tail）、Claude Code hooks（实时事件，Phase 1）。
