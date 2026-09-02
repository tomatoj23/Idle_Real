# SmallRpg（《问道长生》）

放置修仙游戏（双端路线：桌面 Electron / 移动 Capacitor），工程为 npm workspaces + TypeScript + vite：`packages/engine`（零内容感知的机制核心）、`packages/content`（内容包 schema + 校验 + 默认数值，见 `packages/content/src/content/default.json`）、`packages/editor`（内容编辑器）、`packages/app-desktop`（游戏壳）。旧版 `js/`、`index.html` 仅作设计参考，不再维护（ADR-003/008）。

## Agent skills

### Issue tracker

GitHub Issues，用 `gh` CLI 读写。远端：`tomatoj23/Idle_Real`（main）。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五标签：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

single-context 布局：根目录 `CONTEXT.md` + `docs/adr/`（按需懒创建，不存在时静默跳过）。见 `docs/agents/domain.md`。
