# SmallRpg（《问道长生》）

纯前端零依赖零构建的放置修仙网页游戏：双击 `index.html` 即玩。数值集中在 `js/data.js`，引擎与 UI 在 `js/game.js`，样式在 `css/style.css`，另有 `darkabyss/` 子目录。

## Agent skills

### Issue tracker

GitHub Issues，用 `gh` CLI 读写。远端：`tomatoj23/Idle_Real`（main）。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五标签：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

single-context 布局：根目录 `CONTEXT.md` + `docs/adr/`（按需懒创建，不存在时静默跳过）。见 `docs/agents/domain.md`。
