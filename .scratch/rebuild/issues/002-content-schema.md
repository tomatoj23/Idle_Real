# 002 · content schema + 校验器 + 默认内容包迁移

**Blockers**: 001
**User stories**: US-16 US-18 US-22

## 范围
- Schema 全集（JSON Schema）：`skills`（含活动+副产出）、`items`（mat/pill/equip）、`recipes`（炼丹/炼器）、`enemies`（数值/掉落/招式名）、`drops`（装备掉落表）、`combat-text`（动词部位池/招式名/起势/按伤害档分池后果词库/致命一击）、`shop`
- 校验规则含跨引用检查：掉落池 id 必须存在于 items；武器 id 必须在 combat-text.moves 注册；配方材料必须存在（旧版 bug 教训固化为校验）
- 默认内容包：以旧版数值为**参考基线**迁移（发现不合理即重设并记录），含织物线（灵蚕丝/冰蚕丝采药副产出、布道袍用丝、甲胄用矿石）
- 引擎安全兜底约定：未注册招式回退拳脚动作（写入引擎约定，后续票实现）

## 验收
- [ ] `validateContent(默认包)` 通过；人为破坏任一跨引用 → 字段级错误信息
- [ ] 默认包数值快照测试（防迁移走样）
