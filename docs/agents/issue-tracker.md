# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <path>`. Use a UTF-8 body file for multi-line bodies; fill the two sections below before publishing.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

**本仓库远端**：`https://github.com/tomatoj23/Idle_Real.git`（main 分支，2026-09-02 接入）。

## 开票与交付骨架（agent / gh CLI）

GitHub web UI 使用 [工程任务模板](../../.github/ISSUE_TEMPLATE/engineering-task.yml)；`gh issue create` 不校验模板，agent 开票必须主动包含以下两栏。规则以 [compliance-soft-layers.md](compliance-soft-layers.md) §2 为准，查阅入口见 [锚点卡](reference-snapshots-anchors.md) 与 [直达纪律](reference-snapshots-usage.md)。

```markdown
## 目标

描述问题、预期行为、实施范围与不做的内容。

## 查证锚点

- 本地快照路径：
- 卡内直达锚点名：
- 卡外检索简报：问题 / 入口 / 停止条件（卡内直达或无需查阅时写不适用及理由）
- 快照引用标注：快照名 + 内部版本 + 取档日期
- [ ] breaking-changes / migration 已查（升级票必填；非升级票说明不适用理由）

## 验收清单

- [ ] 本票行为验收：
- [ ] check + test 通过（记录命令与结果）
- [ ] 真实浏览器首跑：环境 / 操作 / 结果（纯文档票写不适用及理由）
- [ ] 查证锚点与直达痕迹已核对（无快照查阅时说明理由）
```

- 卡外检索简报须在搜索前填入票面、票评或产出物；卡内直达注明锚点名即可。无快照查阅或非升级票写不适用及理由，不留空冒充已查。
- 开票时验收清单保持待办；交付时逐项核销并附证据。不适用项注明理由，不把未执行写成通过；真实浏览器首跑在涉 UI / 运行时改动中不可由 happy-dom 或 CI 替代。
- 既有票若缺这两栏，实施时在票评补齐。提交、推送后附核销评论并关闭票；无失败证据、无未决项才可核销，未执行的验收如实保留。
- 多会话并行：动手前读票面与全部评论并核对 assignees；未认领才执行 `gh issue edit <number> --add-assignee @me`，认领后再写文件。已有认领不等于本会话授权。

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
