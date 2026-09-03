# 引擎/内容隔离审计（2026-09-03）

> 触发：用户质疑"装备稀有度被直接写进了引擎是否违反铁律"。
> 方法：三轮递进——① 稀有度专项；② 引擎全源码逐行 + 全库字符串/常量扫描；③ 全文档（CONTEXT.md / SPEC / research / agents 文档 / ADR 简表）+ 测试 + 工程配置交叉核对。
> 状态：**纯分析，未改动任何代码**。供 #14/#5/#11 动工前裁决。

## 一、结论摘要

1. **稀有度违规成立，且不是实现疏忽，而是决策记录层的分裂**：SPEC 总纲明文"参数与数据全部来自 content 包""稀有度/词条/伤害档等'档位词表'也是 content"（SPEC.md:55/63），调研适配方案也写了"稀有度/槽位作为 config 节数据化"（rebuild-research.md §1.4）；但 #4 实现时稀有度表/词条池/概率全部落进引擎（gear.ts），并写下了反向定调的注释（"属引擎机制侧，不进内容包"），该注释又被调研文档 §1.1 引用为"已定调"。**文档与实现互相引用对方的矛盾说法**，必须先 ADR 裁决再动代码。
2. 同病者：战斗叙事词库（TIER_FLAVOR/对照语/兜底句/句式骨架——SPEC:58 明文要求模板片段进 content）、game.ts 33+ 处用户文案、statBase 曲线等数值参数族。
3. 已豁免/灰区之外，**架构骨架高度干净**：聚合管线、系别接缝、依赖图（engine 零 workspace 依赖）、内容视图、schema 校验器、UI（零机制复算）、编辑器（占位）均无越界。
4. 未完成部分（#15/#5/#14/#11/转生秘境成就）**无新违规预埋**，但 #14 有三个前置必须先清偿（见 §七）。

## 二、判定标准

铁律（CONTEXT.md 硬原则 1）：引擎零内容感知——玩法参数、文案词库由 content 定义；检验法：**改这个内容要不要动 engine 源码**（新内容 = 新 JSON）。

尺子（两条线）：

| 必然耦合（不违规） | 不允许（违规） |
|---|---|
| 内容包**形状**：item.type 枚举、Modifier 三区、combatText 六键等 schema 契约 | 具体**条目**：有哪些装备/敌人/丹药 |
| 机制**算法**：聚合管线、掷点算法、伤害公式形状 | 玩法**参数值**：概率/倍率/阈值/曲线系数 |
| 安全**兜底路径**：缺内容不崩（ADR-010 fist 约定） | 兜底**内容值**：兜底句子的具体中文文案 |

## 三、违规清单

### P0-1 稀有度族（gear.ts 全文件）

| 内容 | 位置 | 性质 |
|---|---|---|
| 档位枚举 `common/fine/rare/epic` + 中文名'寻常/精良/罕见/绝世' | `packages/engine/src/gear.ts:15,27-32` | 枚举 + 文案 |
| 倍率 mult 1/1.15/1.3/1.5、词条数 0/1/2/3、卖价 ×1/2/4/10 | 同上 | 玩法参数 |
| roll 概率 70/20/8/2 硬编码函数体 | `gear.ts:76-79` | 玩法参数 |
| 词条池'锐锋/罡气/浑厚/通明'+ stat 映射 | `gear.ts:42-47` | 文案词库 |
| 量级系数 {atk:.3,def:.3,hp:1.5,crit:.25} + ±20% 波动 + baseScale 标尺(hp÷5/crit×0.8/兜底3) | `gear.ts:82-91` | 玩法参数 |
| `gearName` 把中文档名拼进展示串 | `gear.ts:122-124` | 文案 |

**违反的明文**：SPEC.md:55（"参数与数据全部来自 content 包"）、SPEC.md:63（"稀有度/词条/伤害档等'档位词表'也是 content"）、rebuild-research.md §1.4（"稀有度/槽位作为 config 节数据化"）。旧版这些值都在 `js/data.js:156-169`（**内容文件**），重写时被搬进引擎。
**扩散面**：`state.ts:209`（存档规范化 `entry.rarity in RARITIES`）、`index.ts:100-110`（导出表）、`app-desktop/ui.ts:540-541`（rarityClass 白名单 + '寻常' 兜底）、`ui.ts:548`（gearCard 用引擎表**计算** mult 展示值——不只是名字/class，运行时数值依赖）、`ui.ts:182`（'天降异宝' epic 特判）、#11 编辑器（schema 无稀有度 → 表单永远做不了）。
**源注释问题**：`gear.ts:4-6`"稀有度表与词条池属引擎机制侧"——把"实例化机制（掷点管线，设计正确）"与"档位表/词池/概率（应属内容）"混为一谈；`content/src/types.ts:114` 注释同病。**两处注释在修复前须先废**。
**内容表达力缺口（同族论据）**：`gearDrops` 表只有 enemy/chance/pool，无稀有度权重——内容包表达不了"这把异宝必出罕见/掉率偏高档"；且旧版 rollRarity 本有"炼器等级抬稀有度"的外部加权输入（加权调用与系数在 js/game.js:84-95，research §1.1 引用；round3 B3 勘误：data.js:156-161 是 RARITY 表定义本身），引擎版丢失了参数位——佐证 rollRarity 本该是"接收权重表 + 外部加权的参数化机制"，而非常量封装。

### P0-2 战斗叙事词库（combat.ts）

| 内容 | 位置 | SPEC 依据 |
|---|---|---|
| 句式骨架：出招句/受击句/暴击起势拼接模板 | `combat.ts:179-192` | SPEC.md:58"模板片段+槽位+按伤害档分池的词库全部进 content 包" |
| 兜底句：'击'/'要害'/'搏兔一击'/'你气机鼓荡'/'你灵机鼓荡'/受创模板 | `combat.ts:131,147,181-183,201` | 同上；'搏兔一击'正是 default.json fist 池首句的冻结副本 |
| 战后画像 TIER_FLAVOR 四句 | `combat.ts:216-221` | combatText schema **无对应节，无处可迁** |
| 对照语四句（'前番不敌…雪耻'等） | `combat.ts:246-252` | 同上 |
| 战后摘要骨架：'N 合击倒 · …'/'N 次会心'拼接（summarizeRounds） | `combat.ts:226-234` | 同 SPEC:58 模板片段；与 TIER_FLAVOR 同函数，修复时一并出池 |

### P0-3 game.ts 用户文案 33+ 处

单引号串 26 处 + 反引号模板串 7 处：reject 展示文案（'此非丹药'/'坊市未售此物'/'查无此妖'…）、combat-note 叙事（'剑拔弩张——你与【X】战至一处'/'你略定心神，再度向【X】出手'/'你见好就收，飘然离场'…）、'拳脚' 展示名、'修为不足…''灵石不足…''境界太低…' 等（`game.ts:353-997` 散布）。协议 code（'not-found' 等）属引擎没问题；**展示文案应由内容/UI 层渲染**。

### P1-1 战斗与成长数值参数族（引擎常量，无内容覆盖路径）

- `combat.ts:18-42`：PLAYER_ATTACK_INTERVAL 2200、DEFENSE_K 120、DAMAGE_VARIANCE 0.1、CRIT_MULTIPLIER 1.6、CRIT_CAP 75、CRITICAL_HP_FRACTION 0.15、LOW_HP_FRACTION 0.3、AUTO_EAT_HP_FRACTION 0.5、VICTORY_REST_MS 1500。
- `game.ts:196-200` `statBase()`：atk 8+3·clv / def 2+1.2·clv / crit 5——**闭包内硬编码，连命名常量都没有**。
- `game.ts:854` 开战门控 `clv + 2` 的 2；`:609` 敌人缺省攻击间隔 = 玩家 2200ms；`combat.ts:61-65` 伤害档阈值 0.95/1.05/1.5。
- `progression.ts`：MAX_LEVEL 99、HP_BASE 100、HP_PER_LEVEL 12、经验曲线 10·L^1.8+15L、回血 4%/s——**已自注"参数暂由引擎常量承载，内容化随后续票据"（已登记债务）**，combat.ts/game.ts 未见同类登记。
- 旧版出处均为 data.js（内容文件）。config 节目前只有 slots（schema `additionalProperties:false`），参数无处安放。

### P1-2 verbStyle 键域封死 + 玩家映射强绑

- 玩家武器→`'sword'`/无武器→`'fist'` 是引擎内嵌规则（`game.ts:424`），`Item` 无 verbStyle 字段——**内容包做不出"法杖走 magic 池"**。
- verbs 池键域被 schema 封死四键（combat-text.schema.json required + additionalProperties:false）；`EnemyKind = 'claw'|'magic'` 二值枚举（enemy.schema.json:43-44）。新增动词风格 = 改 schema + engine 类型 + validate 三处。
- 敌人缺省 `'claw'`（`game.ts:455`、contentView:154）。

### P1-3 'weapon' 槽位语义双写死（已登记债务，非隐形口子）

`game.ts:155` `state.equips['weapon']`（找武器定招式键）+ `pack.ts:228` `item.slot === 'weapon'`（moves 注册检查）。SlotDef 只有 id/name/icon 无 role 字段。**docs/agents/content.md:84-85 已登记**："武器招式注册锚定槽位 id weapon；若未来槽位改名/多武器槽，须同步放宽（#14 消费时处理）"。修复随 #14。

### P2-1 schema 魔法数与引擎常量双写（无单一来源）

enemy schema `level maximum 99` ↔ 引擎 `MAX_LEVEL=99`；item schema `crit maximum 100` ↔ 引擎 `CRIT_CAP=75`（校验放行、引擎钳制，语义靠人脑对齐）；item schema `multipliers` 键域封死 gatherXp/atk/def 而引擎 `game.ts:184` 遍历任意 stat（引擎开放、schema 过紧，加"气血倍率丹"须动三处）。

### P2-2 ADR-015"三处同步"清单缺引擎消费点

content.md 定义三处同步（schemas / types.ts / content.md），但 engine 消费视图（contentView 的 View 类型、state.ts 规范化）不在清单内。实证：enemy schema 已含 `affinities`，engine `EnemyView` 无该字段投影——目前靠票驱动（schema 由 #16 交付、消费随 #15；round3 A2 勘误），纪律文档应注明"引擎消费点随消费票同步"。

## 四、文档层发现（第三轮核心增量）

1. **决策记录分裂链**（P0-1 的根因）：SPEC.md:55/63 与 rebuild-research §1.4 说"稀有度是 content"；gear.ts/types.ts 注释与 rebuild-research §1.1:24 引用的 types.ts 定调说"不属于内容包"。**research 文档自身 §1.1 与 §1.4 矛盾**。CONTEXT.md 边界示例"引擎提供：……稀有度 roll……"（机制侧，本身没错）+ 词汇表 :25 把具体档位数值（'寻常/精良/罕见/绝世 ×1.0/1.15/1.3/1.5'）写进领域词汇（内容值进词汇，加剧混淆）。→ **修复前置：开 ADR 裁决一次**，然后修订 CONTEXT.md 两处、gear.ts:4-6 / types.ts:114 / combat.ts:1-13（"纯机制层……全部由参数驱动"——export const 常量下的自我安慰，批 2 重写）三处注释、research §1.1 加"已被 ADR-xxx 裁决"标注。
2. SPEC.md:58 明文要求"模板片段"进 content——P0-2 的直接依据。
3. SPEC.md:61 首批 schema 清单含 rebirth/dungeons/bosses/achievements，现缺——**分期未到，非漂移**；SPEC:102 的 #7 补 recommendedPower、#9 补最快击杀纪录为将来票检查点。
4. content.md 与 schemas/types.ts 当前**零漂移**（8 节清单、五形态、Modifier 约定、config 可选、系别字段、prototype 三检逐项核对一致）；'weapon' 锚定已登记。
5. domain.md 说 docs/adr/ 懒创建——现状不存在，**合规**（ADR 全在 CONTEXT.md 简表）。
6. 旧版 `js/data.js` 是全部硬编码数值的源头（research §1.1 逐行引用）——"旧版数值沿革"注释的实质是**内容从旧版内容文件搬进了新引擎**。

## 五、已豁免与灰区（不动）

| 项 | 定性 | 依据 |
|---|---|---|
| `'fist'` 兜底键（combat.ts:128,146、game.ts:162） | 受控例外 | ADR-010 + content 校验 `checkFistFallback` 保证恒在；引擎感知的是"约定键" |
| 兜底句的存在 | 机制合法（防御深度：绕过校验的内容包如测试 fixtures 只有 fist/claw 两池时引擎不崩） | 值属内容（归入 P0-2 修复），路径本身保留 |
| item.type 五形态枚举、Modifier 三区、DamageTier 四档枚举 | schema 形状契约 | 引擎必然感知形状 |
| EventBus limit 256、EventBus 吞监听器异常 | 基础设施参数 | events.ts |
| Date.now（clock.ts）/ setInterval（save.ts） | 三禁的注入点豁免 | ADR-013；均为显式注入的基础设施层 |
| main.ts TICK_MS 250 / MAX_CATCHUP_MS 5000 / AUTOSAVE_MS 15000、save.ts 缺省 15000 | 应用层参数 | 不在引擎 |
| autoFight / autoEat 缺省 `true`（state.ts:100-101 初建、:284-285 恢复缺省两处落点） | 灰区（玩法缺省值硬编码） | 量级小，暂可接受；随批 3 config 化时一并考虑 |
| 引擎防死循环 guard 上限：settleActivity/settleCombat 1_000_000（game.ts:341,565）、makeGear 词条去重 20（gear.ts:110） | 基础设施保护参数 | 二轮 N5 建议登记（2026-09-03 已登记，与 EventBus limit 256 同族） |
| UI 平凡比较：`level >= a.unlockLevel`（ui.ts:395）、`st.gp >= entry.price`（ui.ts:615）、血条/敌血/进度比例（ui.ts:283/477/634） | 灰区判例：UI 可平凡比较内容字段，不得复制引擎私有参数或公式 | 二轮 N6 建议登记（2026-09-03 已登记）；越界反例=N1，健康对照=ui.ts:12-14 走引擎导出函数 |

## 六、干净面（复核通过）

- **依赖图**（工程保障成立）：`@wendao/engine` 零 workspace 依赖；`content` 零依赖；`app-desktop → {engine, content}`；`editor` 零依赖（占位页，无 schema 复制风险）。engine 不 import @wendao/content，contentView 按形状读。
- **聚合管线**（modifiers.ts）：stat/zone/kind 全开放，`conditionMatches` 纯字符串比较——#15 系别接缝零感知（engine 全库无金木水火土/metal 等值）。
- **contentView.ts / state.ts / save.ts / events / rng / clock**：按形状读、缺节兜底、逐键规范化、透明透传未知键；slots 由 config 驱动（"加减槽零改动"在列表层面成立）。
- **pack.ts 语义校验**：xref/形态/区间方向/原型三检/fist 兜底，质量高；validate.ts 通用校验器零内容。
- **UI 无机制复算**：ui.ts/main.ts 对 calcDmg/hitTier/CRIT_* 等引擎常量零引用（搜索验证）；UI 只消费事件流与 snapshot（SPEC:77 落实）。**【二轮复核修正，见 §十一 N1/N2】**：原验证法"搜索引擎常量名零引用"有盲区——UI 虽不引用引擎常量，但 `ui.ts:504` **复制了开战门控公式**（clv+2）、`ui.ts:458` **硬编码了内容 id 'combat'**。修正表述："UI 无引擎常量引用；存在门控公式复算（N1）与内容 id 感知（N2）两处越界，其余维持干净"。
- **content 侧测试**（90 用例）不涉稀有度；engine 测试的 fixtures 自备**引擎消费形状**的内容包（注意：其 combatText 只有 fist/claw 两池，并不满足 combat-text schema 的四键 required——"合规"指引擎消费形状而非包校验形状，恰好演练了引擎兜底路径，见 §五 兜底句行）。
- **正面零感知范例**：自动嗑丹目标 = 背包首个 heal 形状丹药（`game.ts:597-604`，不硬编码 pill_heal）；活动恢复的稳定引用校验（存档活动名须与内容定义一致才收编，`state.ts:173-183`，ADR-015 落实）；存档恢复过滤原型污染键（`state.ts:132`）。
- engine/content 包级 tsconfig 均仅 `lib: ES2022`、无 DOM/node——`save.ts:9`"不含宿主类型库"的跨平台声明**验证成立**。
- SPEC:84 已知坑回归集落实确认：未注册招式不崩（fist 兜底）、日志容量受控（flog 60 条 + EventBus 256）、槽位 uid 严格解析（readUidPayload，旧版 uid/id 混用教训）、伤害档可达（相对期望算法 + 500 场回归断言重/濒死）。
- 装备贡献投影走 ADR-011 管线唯一出口；丹药 buff crit 走 flat（#13 定版）。

## 七、未完成部分接缝检查

| 票 | 现状 | 前置/风险 |
|---|---|---|
| **#15 系别**（schema 由 #16 交付——round3 A2 勘误） | schema 预留完成（element/affinities + condition/Modifier + patternProperties 七系）；engine 零感知 | 缺口清单：① `EnemyView` 补 affinities 投影；② 雷金水风四系的机制原语（暴击加成/破防 debuff 位/攻击间隔 modifier——research §2.4 说清了是引擎**原语池**而非系别分支）；③ elementFlavor 词库节（combatText 扩节，三处同步）；④ **实现纪律：禁 `switch(element)` 分发**——element→primitive 绑定必须走 content Feature |
| **#5 craft** | 无违规预埋（Recipe 成功率/耗时/产出全在内容） | 引擎补 craft 活动循环（successRate roll / 失败耗料 / 产出走 makeGear 或 addItem）——低风险；勿把"炼器必成"类规则写进引擎 |
| **#14 装备构筑** | blocked by #4(已关)+#5 | **三个前置**：① P0-1 裁决 + 稀有度/词条池数据化（否则引擎 AFFIX_POOL 与内容铭纹体系两套词缀并存）；② GearBonuses（flat 四键）与 Modifier（三区带 condition）形状统一决策；③ 'weapon' 锚定放宽（content.md 已登记）。research §1.4 分期"第一波内容扩铭纹池是纯内容"只有在前置①后成立 |
| **#11 编辑器** | 占位页（main.ts 11 行） | schema 完整性依赖 P0-1（稀有度不在 schema → 表单做不了） |
| **转生/秘境/Boss/成就** | schema 未建（SPEC 清单内） | 转生天赋已预留接缝（`createGame({contributions})` + content.md:72）；秘境 floorRange/层数段已随器胚预留；无预埋违规 |
| 铭纹 socket / 灵兽 / Mastery | SPEC backlog | "落地时随票加 schema，避免闲置字段"——纪律良好 |

## 八、修复路线图（供裁决，未实施）

- **批 0 · 文档裁决（前置，半天）**：开 ADR（如 ADR-016）定"档位词表归 content"；修订 CONTEXT.md 边界示例与词汇表 :25 条目、gear.ts:4-6 / types.ts:114 注释、research §1.1 标注；content.md 三处同步扩注"引擎消费点随消费票同步"。
- **批 1 · 词表数据化（P0-1）**：content 新增 `rarities` + `affixPool` 节（{id,name,weight,mult,affix,sell} / {name,stat,scale}）+ schema + types + content.md；引擎 makeGear/rollRarity 改读视图，`Rarity` 开放为 string；state.ts 规范化解引用内容表（缺档回退第一档）；UI rarityClass/rarityName/epic 特判改由 def 驱动；测试连锁见 §九。**缺省表策略二选一（随批 0 ADR 一并裁决）**：(a) 引擎保留内置默认表并登记为约定（渐进，兼容现有存档与 UI，先例 moves.fist）；(b) 引擎零默认、validate 强制节恒在（纯净，default.json 即官方包）——倾向 (b)。validate 职责：权重归一化 + affix.stat 引用合法 +（可选）掉落表稀有度权重（见 P0-1 表达力缺口，gearDrops 扩字段时同步）。
- **批 2 · 文案收编（P0-2/P0-3）**：combatText 扩节（summary 画像池/对照语池/系统 note 池/句式模板）或独立节；reject 改"code + 内容映射"或 UI 渲染；兜底句策略登记（引擎最小兜底 or 校验强制恒在）。
- **批 3 · 参数数据化（P1-1）**：config 节扩 combat/progression 子节（schema additionalProperties 解锁 + 三处同步）；引擎缺省值 = 现基线（与 ADR-010"缺内容零崩溃"同构，登记约定）；progression 的已登记债务一并清偿。
- **批 4 · 语义键域（P1-2/P1-3/P2-1）**：SlotDef.role + 'weapon' 放宽（随 #14）；Item.verbStyle? 字段解绑玩家映射；VerbStyle/EnemyKind 开放 vs 封死的裁决；schema 魔法数与引擎常量的单一来源策略。

顺序理由：批 0 是一切前提（未裁决前批 1 方向可能被翻案）；批 1/2 相互独立可并行；批 3 波及全部数值断言，靠后；批 4 中 'weapon' 已登记随 #14，其余可独立小票。

## 九、修复连锁面清单（改动时必须同步的测试断言）

- `combat.test.ts:108,143` '搏兔一击'（兜底句）；`:156-158` summary 三断言（'11 合'/'大开大合'/'2 次会心'）；`:163-166` 对照语四句；`:97-140` 句式模板断言。
- `combat.game.test.ts:47-49` rare 1.3 倍率 + '锐锋/通明'语义；`:61-64` 基线 atk 8+3·clv / crit 5；`:98` '合击倒'；`:166` `includes('点')`（后果句模板）。
- `ui.ts:548` mult 展示计算（读引擎表）→ 批 1 后改读内容 def，与 :540-541 同批。
- `fixtures.ts`：verbStyle 只配 fist/claw 两池（依赖引擎兜底）；`equips: { weapon: 1 }`；`combat.game.test.ts:51` 同。
- `state.ts:209` rarity 规范化解引用 RARITIES → 改内容表后此处联动。
- `ui.ts:540-541` rarityClass/寻常兜底、`:182` 天降异宝。
- 存档兼容：`Rarity` 开放为 string 后旧档枚举值天然合法；stats 断言若批 3 改基线须整批重算。

## 十、检查覆盖清单

- engine：src 13 文件全读 + tests 9 文件（重点 combat/combat.game/fixtures，其余扫描硬编码依赖）。
- content：src 全读（types/validate/pack/index/schemas×8/default.json 全文）+ tests×4（rarity 扫描 + reservedForms 抽读）。
- app-desktop：main.ts + ui.ts（机制词扫描 + 稀有度段精读）；editor：main.ts（占位）。
- 文档：CONTEXT.md、AGENTS.md、SPEC.md（.scratch/rebuild/）、docs/agents×4、docs/research/rebuild-research.md；docs/adr/ 不存在（懒创建合规）。
- 工程：根/四包 package.json、tsconfig.base/根 tsconfig、engine/content 包级 tsconfig（依赖图 + lib 无 DOM/node 核验；app-desktop/editor 包级 tsconfig 未读，不含在结论内）。
- 未覆盖：js/ 与 index.html 旧版（ADR-003 仅设计参考）、engine/content 的 dist（构建产物）、GitHub 全部票正文（仅核 #11）。

## 十一、二轮全量复核增量（2026-09-03 同日第二轮）

> 触发：用户要求"再次全量搜索核对，不放过每一个角落，发现新问题直接落入文档"。
> 方法：全库中文字符逐文件分拣（engine 13 文件 / app-desktop 3 / editor 1，区分注释与字符串）；引擎全源码重读（combat/gear/game/contentView/state/modifiers/index）；app-desktop ui.ts（683 行全文逐段）/main.ts、editor main.ts 全读；content schemas×8 全读 + pack.ts/validate.ts 复核；测试 fixtures/combat.test/combat.game.test 断言行号抽查；app-desktop/editor 包级 tsconfig 补读（一轮未覆盖）；系别词全库扫描；文档层行号复验（SPEC:55/58/63/77、CONTEXT.md:25、content.md:84-85）。

### 复核结果总览

1. **既有清单（§三/§四）逐条核对：行号与内容全部准确，无一漂移**。复核通过项：gear.ts:15/27-32/42-47/76-79/82-91/122-124/4-6、combat.ts:18-42/61-65/131/147/179-192/201/216-221/226-234/246-252、game.ts 文案精确计数 **26 单引号 + 7 模板 = 33 处**（含 '拳脚'，grep 精确复核）、game.ts:196-200/321/424/455/609/854、state.ts:208-211（'common' 兜底字面量同属 P0-1 感知）、index.ts:100-110、ui.ts:182/539-541/548（乘算实际在 :551）、pack.ts:228、content/types.ts:114、enemy.schema.json:41+43-44+51-63、combat-text schema 六键 required + verbs 四键封死、config additionalProperties:false、P2-1 三组双写（level 99 / crit 100↔75 / multipliers 键域）、§九 测试断言行号（combat.test.ts:108/143/156-158/163-166、combat.game.test.ts:47-51/61-66）、fixtures verbStyle 两池。
2. **§六"UI 无机制复算"结论修正**（已在 §六 原地标注）：原验证法"搜索引擎常量名零引用"存在盲区——UI 不引用引擎常量但**复制公式**、且**硬编码内容 id**，见 N1/N2。
3. 其余干净面复核全部维持：引擎系别值零感知（全库扫描仅 contentView.ts:165 注释'凡击'一词）、modifiers 聚合管线 stat/zone/kind 开放、validate.ts 零内容键名感知、style.css 中文全在注释、包依赖图不变（app-desktop/editor tsconfig lib 含 DOM 属应用层合规）。

### 新发现

#### N1 · P1 · UI 复算开战门控公式——"+2" 偏移共四处副本

| 副本 | 位置 | 一轮是否已知 |
|---|---|---|
| 判定 | `game.ts:854` `clv + 2 < enemy.level` | 已知（P1-1） |
| reject 文案 | `game.ts:855` `需 ${enemy.level - 2} 层` | **新**：偏移量在文案中二次硬编码 |
| UI 判定 | `ui.ts:504` `const locked = clv + 2 < enemy.level` | **新**：UI 复制公式（敌人卡锁定态） |
| UI 文案 | `ui.ts:520` `需 ${enemy.level - 2} 层` | **新**：同上 |

风险：批 3 参数化门控偏移时四处必须联动，漏任何一处即 UI/文案与引擎判定漂移（UI 显示可挑战但引擎 reject，或反之）。UI 锁定态是 UI 自算的预测而非引擎快照给出，违反 SPEC:77"UI 只消费事件流与 snapshot"的精神——**这正是一轮"搜索常量名零引用"验证法漏网的原因**：公式是抄的，常量没引。
修复方向（供裁决）：引擎在敌人视图/snapshot 暴露 locked 判定（引擎消费点随消费票同步）；或偏移参数化后 UI 与引擎读同一 config。UI 文案与 reject 文案同根，批 2 文案收编时一并处理。

#### N2 · P1 · UI 硬编码内容 id 'combat'（当前环境碰巧不炸）

`ui.ts:458` `st.skills['combat']?.xp ?? 0` 以**字面量内容 id** 索引存档技能；而同文件 `:54`/`:222` 已有正确做法（`content.skills.find(kind === 'combat')` 动态取 id，事件比较用 combatSkillId）——同一文件两种做法并存。当前 default.json:56 斗法技能 id 恰为 'combat'、engine fixtures.ts:33 亦同，故未暴露；该约束**从未在任何 schema/校验/文档中声明**，纯属碰巧：内容包改 id（schema 允许任意 `^[a-z]` 开头 id）→ 斗法页修为恒 0 层、敌人全锁、UI 与引擎修为读数分裂。触犯铁律检验法（改内容要改 UI 源码）。
修复：一行可修（复用 :54 的 combatSkillId 变量），不依赖批 0 裁决，可立即做；修复后建议顺手将 fixtures 的技能 id 改名（如 'fight'）验证无硬编码残留。

#### N3 · P2 · 装备数值 stat 键域五处同构封死（§七 #14 前置② 的全量副本面）

装备基础加成只能 atk/def/hp/crit 四键，完整副本清单：

| # | 位置 | 形态 |
|---|---|---|
| 1 | item.schema.json:149-159（bonuses，additionalProperties:false） | schema 键域 |
| 2 | content/types.ts:115-120（Bonuses 接口） | content 类型 |
| 3 | engine gear.ts:66-71（GearBonuses 同形接口） | engine 类型 |
| 4 | engine gear.ts:147（gearContributions 投影循环 `['atk','def','hp','crit'] as const`） | **消费封死**：超四键的模板加成被静默丢弃 |
| 5 | engine gear.ts:83（rollAffixVal 量级系数表 k 四键，未知 stat 兜底 0.3） | 参数封死 |

内容包做不出"会心伤害/攻速/幸运"类装备（除非同时动 schema+types+engine 三层五处）。定性：schema↔engine **一致地封死**（当前无漂移，双方同一形状），与 P2-1 双写族同罪；§七 #14 前置② 已点名形状统一决策，本条补全副本清单，单一来源策略随批 4。

#### N4 · P2 · gatherXp 键名引擎消费点写死（P2-1 的另一半）

`game.ts:321` `aggregateStats({ gatherXp: 1 }, ...)` 把"采集经验加成"的 stat 键名硬编码进引擎活动循环。P2-1 已录 schema multipliers 键域封死三键并定性"引擎开放、schema 过紧"——**该表述需精度修正**：三键各有引擎消费点（atk/def→面板 statBase、gatherXp→:321），聚合管线开放、**消费点封闭**；schema 键域实际是"消费点清单"。推论：新增倍率 stat（如"气血倍率丹"）不止动 schema 三处，还须引擎新增消费点——批 4 单一来源裁决时把"消费点注册表"一并纳入。

#### N5 · 灰区登记 · 引擎防死循环 guard 上限

`game.ts:341`（settleActivity `guard < 1_000_000`）、`game.ts:565`（settleCombat 同值）、`gear.ts:110`（makeGear 词条去重 guard 20）。与 EventBus limit 256 同族的基础设施保护参数，建议补入 §五 豁免表。

#### N6 · 豁免表补充 · UI 展示预判边界判例

以下 UI 平凡比较**不**计违规（读内容字段或快照字段 + 不含引擎私有参数，判定偏差由引擎 reject/幂等兜底）：

- `ui.ts:395` `level >= a.unlockLevel`（活动解锁按钮态；unlockLevel 是内容字段本身）
- `ui.ts:615` `st.gp >= entry.price`（购买 afford 置灰）
- `ui.ts:283/477/634` 血条/敌血条/进度条比例

由此得出 UI 层灰区判例：**UI 可平凡比较内容字段，不得复制引擎私有参数或公式**（N1 即越界案例）。另 `ui.ts:12-14` 经验条走引擎导出函数 expBase/expToNext/levelFromXp（单一来源，健康做法，与 N2 形成对照）。

### 测试连锁增补（对 §九）

- N1：ui.ts:504/520 当前无渲染烟测覆盖锁定态；若改为引擎暴露 locked，engine 测试须补快照断言。
- N2：改用 combatSkillId 后，建议 fixtures 技能 id 改名一次作为回归验证。

### 修复路线图影响（对 §八）

- 批 2 增补：game.ts:855 门控文案与 :854 判定联动（N1 的引擎侧两处）。
- 批 3 增补：门控偏移 +2 参数化后，N1 四处副本收敛为单一来源读数。
- 批 4 增补：N3 五处副本、N4 消费点注册表一并纳入"单一来源"裁决。
- 独立小票（不依赖裁决，可立即做）：N2 一行修复；N5/N6 仅文档登记。

### 二轮覆盖清单（对 §十 补遗）

- 本轮新覆盖：app-desktop/editor 包级 tsconfig；editor main.ts；ui.ts 全文；fixtures.ts 全文；validate.ts 内容键名扫描（零命中）；style.css 扫描（中文全在注释）；系别词全库扫描；combat.test.ts/combat.game.test.ts 行号复核；game.ts 中文字符串 grep 精确计数。
- 仍未覆盖（与 §十 相同）：dist 构建产物、js/ 旧版（ADR-003 豁免）、GitHub 票正文。
