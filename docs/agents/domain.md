# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

**Single-context repo**（本仓库采用）：

```
/
├── CONTEXT.md                             # 硬原则 + 领域词汇 + ADR 简表（001–016 摘要在表内）+ 边界示例
├── AGENTS.md                              # 无 CLAUDE.md；skill 消费规则入口在「## Agent skills」节
├── docs/adr/                              # ADR 全文，按需懒创建
│   ├── 0017-engine-pivot.md
│   └── 0018-toolchain-alignment-policy.md
├── docs/agents/                           # 本目录：issue-tracker / triage-labels / domain / content
├── packages/                              # engine / content / editor / app-desktop，各带 src/
└── js/ css/ index.html steam/             # 旧版参考件，不再维护（ADR-003/008），不参与门禁
```

本仓有 npm workspaces + 多包的 monorepo 信号，但**已裁为单上下文**（2026-09-19 复核确认现状）：领域词汇是一张全局表、跨包共用，不拆 `CONTEXT-MAP.md`，也不建包内 `packages/<pkg>/CONTEXT.md`。再跑配置技能时不要重开这个问题。

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (...), but worth reopening because…_
