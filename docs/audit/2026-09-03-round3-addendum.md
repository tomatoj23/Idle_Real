# 引擎/内容隔离审计 · 第三轮增补（2026-09-03）

> 触发：主审计（`2026-09-03-engine-content-isolation-audit.md`，下称"主审计"）§十 明列三块未覆盖角落（GitHub 票正文、js/ 旧版、dist），外加 smoke.yaml 与 .scratch 全目录清点两项新增指令。
> 方法：16 张票 JSON 全文通读（含全部关票评论）；js/ 两文件逐行 + data.js→default.json 逐节收编对照；.gitignore/dist/vite/五份 package.json 核验；.scratch 全目录清点；SPEC.md 交叉核实。
> 状态：**纯分析，未改动任何代码**。本文是主审计的增补，不独立成篇；判定尺子沿用主审计 §二 两条线表。

## 一、结论摘要

1. **无新违规**。前两轮违规清单（主审计 §三）与豁免/灰区表（§五）经本轮交叉核对**全部维持**；P0/P1 级新违规件数为 0。
2. **唯一"同方向定调"票已找到并点名：#14**。其票面"引擎：rollGear 补全掉落管线步①⑦（掉不掉/掷纹阶）——口诀：稀有度是因（词条数），纹阶是果（质量）"与 `gear.ts:4-6` 注释同方向（把掷稀有度整体表述为引擎管线步），但同票验收又要求"新增一条带 tags 的铭纹 = 纯 content JSON，引擎零改动"——**#14 票内两说并存**，是主审计 P0-1"决策记录分裂链"的第三环（SPEC:55 ↔ gear.ts:4-6/types.ts:114 ↔ 票 #14）。批 0 ADR 裁决时必须显式回应该票口诀（划界：掷点管线=机制归引擎；档位表/权重/词池=参数归 content）。
3. **审计未提及的 #16（已关）是多项"schema 预留"的真实交付票**：enemies element/affinities、config.slots、prototype 字段、item blank/inscription 五形态均出自 #16 而非主审计 §七/P2-2 所指的 #15/#2——溯源修正见 §三·A2。
4. js/ 旧版豁免**复核成立**（不参与任何构建）；数值沿革对照找到唯一漏网内容值 **REALMS 境界词表**（未收编、未实现，属功能缺口非违规，登记防将来硬编码）；另发现主审计 P0-1 一处出处引用精度问题（外部加权系数在旧引擎 game.js 而非 data.js）。
5. dist、五份 package.json、vite 配置、.scratch 清点：**复核通过，零发现**。根目录 smoke.yaml 为浏览器冒烟残留物（非配置），建议删除。

## 二、逐角落发现

### A · GitHub 票正文与评论（16 票全读）

原始件：`.scratch/audit3/issues/issue-1..16.json`（含 comments 字段）；清单：`.scratch/audit3/issues-list.json`（#4/#13/#16 CLOSED，其余 OPEN）。

**A1 ·（P1，对 P0-1 的票面定调增补）#14 与 gear.ts:4-6 同方向**

- 票面原文（issue-14.json body"引擎"节）："引擎：`rollGear` 补全掉落管线步 ①⑦（掉不掉 / 掷纹阶）——口诀：**稀有度是因（词条数），纹阶是果（质量）**"。
- 该口诀把"掷稀有度"整体叙述为引擎掉落管线的一步，方向上与 `packages/engine/src/gear.ts:4-6`（"稀有度表与词条池属引擎机制侧"）一致——这是全部 16 票中**唯一**一处与 gear.ts 注释同方向的定调（其余票无稀有度归属陈述；#4 交付评论"稀有度倍率在投影时折算"是机制描述而非归属定调）。
- 但 #14 同票验收明确："新增一条带 tags 的铭纹 = 纯 content JSON，引擎零改动"——**铭纹池归 content 是票面硬要求**，与引擎现行 `AFFIX_POOL`（主审计 P0-1）直接冲突；"稀有度是因（词条数）"若按"档位表/概率在引擎"解读，则批 1 落地时该票文字会成为反向依据。
- 处置：A1 不是新违规，是分裂链的新证据环。批 0 ADR（主审计 §八）应逐字回应 #14 口诀，把"rollRarity 接收权重表+外部加权的参数化机制归引擎；权重表/概率/档名/卖价系数归 content"写成票面可引用的判例，避免 #14 动工时再次各说各话。

**A2 ·（P2，勘误）#16（已关）是"schema 预留"的真实交付票，主审计未提及此票**

- issue-16.json：标题"content 预留字段（调研合入）：器胚×铭纹 schema + 槽位 config 节"，state CLOSED，交付评论（a37f0ac）确认落地：item.schema 重构为 **oneOf 五形态**（mat/pill/equip/blank/inscription）、**enemies element 七系枚举 + affinities patternProperties（值 −100~100）**、**config.slots 节**（默认包配法器/护体/灵饰三槽）、**prototypeKey/prototypeParent 字段先行**（key=自身 id、父须显式声明 key、父链查环），并立"默认包暂不放器胚/铭纹内容（无机制消费方，避免污染数值快照）"约束。
- 溯源修正：主审计 §七 #15 行"schema 预留完成（element/affinities + condition/Modifier + patternProperties 七系）"与 P2-2"enemy schema 已含 affinities……目前靠票驱动（#15）"的预留出处应更正为 **#16**（#15 是消费票；#16 范围里 enemies 可选字段本就是"只给 Boss 配"的预留）。§七 各行结论不变，仅票号溯源修正。
- 对批 1 的引用价值：#16 立的"默认包不放无消费方内容"与批 1 缺省表策略二选一（主审计 §八）不冲突——稀有度表有消费方（makeGear/rollRarity），不属该约束的适用面；但 ADR 行文可引用该先例，说明"缺省表"与"闲置内容"的区别。

**A3 ·（P2，文档根因增补）#3 关票评论是"引擎常量承载参数"做法的票面起点；SPEC:55 单句内部存在张力**

- issue-3.json 交付评论"已知欠账（记录）"节："经验曲线/气血/回血参数暂为引擎常量（**SPEC 定性为引擎机制**，参数内容化随后续票据）"。
- 核实：SPEC.md:55 原文为一句两面——"挂机循环、战斗解算（含暴击/减伤公式）、稀有度 roll、经验曲线、转生结算、秘境层推进、成就判定，全部是引擎机制；**参数与数据全部来自 content 包**"。#3 评论只引前半句为引擎常量背书，后半句（参数归 content）被略去。
- 定性：这不是新违规（P1-1 已覆盖代码面，progression.ts 亦有自注登记），但补全了主审计 §四.1"决策记录分裂链"的上游：**分裂不止发生在 SPEC↔gear.ts 注释之间，SPEC:55 自身"机制归引擎 + 参数归 content"的一句两面结构就是被选择性引用的文本基础**（gear.ts:4-6 与 #3 评论是同一种引用方式的两次实例）。批 0 修订文档时建议把 SPEC:55 拆句或加注"机制=算法形状归引擎，算法的系数=参数归 content"，杜绝第三次选择性引用。

**A4 ·（P2，接缝预警）#5 动工时的参数位清单（防新 P1 预埋）**

- issue-5.json body："配方执行（**炼丹成功率随等级**、失败损料；**炼器必得+稀有度 roll 受炼器等级加成**）"。
- 旧版对应参数位（新架构尚未实现，无现行违规）：成功率加成 `+0.004/层`（`js/game.js:410` `r.base + levelFromXp(...)*0.004`）、成功率上限 `0.99`（同处 `Math.min(0.99, ...)`）、失败返还 25% 修为（`js/game.js:412` `Math.round(r.xp * 0.25)`）、UI 文案二次硬编码 `+0.4%/层`（`js/game.js:666`）。
- 与主审计 P0-1 表达力缺口互补：#5 票面确认"稀有度 roll 受炼器等级加成"要恢复——即 rollRarity 必须保留**外部加权输入参数位**（旧版调用+系数在 `js/game.js:95` `levelFromXp(S.skills.smith.xp) * 0.0004`）；该加成系数本身是玩法参数，届时应随批 3 config 化，勿写死函数体。
- 建议把本清单并入主审计 §七 #5 行的注意点（"勿把'炼器必成'类规则写进引擎"的参数位细化）。

**A5 ·（复核通过/互补）其余 11 票与审计结论的关系**

| 票 | 与审计结论的关系 |
|---|---|
| #1（已关） | 互补：交付评论"旧版 js/css/index.html 未改动（按 ADR-003 仅作设计参考）""workspace 内包以源码消费（exports 指向 src）"——分别佐证本轮 B1 豁免复核与 C1 dist 结论 |
| #2（已关） | 互补：迁移纪律良好——"以旧版数值为参考基线迁移"、`heal.percent=0.3` 数据化（原引擎硬编码 game.js:372）、`defaultPack.test.ts` 数值快照"全表手抄自旧 js/data.js 防迁移走样"；节名 combatText/gearDrops 定版。无矛盾 |
| #3（已关） | 见 A3 |
| #4（已关） | 复核维持：票面"文案：combat-text 词库抽取器……引擎提供通用'过滤后随机抽取'"——抽取机制归引擎与主审计判定一致；稀有度归属票面未定调（其违规面已由主审计 P0-1 覆盖） |
| #13（已关） | 复核维持："槽位列表驱动引擎遍历，替代硬编码"已落地（contentView slotsOf）；评论采纳项"combatText.moves 槽位锚定注记移交 #14"与主审计 P1-3（'weapon' 锚定随 #14）一致 |
| #6/#7/#8/#9（OPEN） | 无预埋违规复核维持：#6"道韵公式全部来自 content.rebirth""天赋树数据 100% 来自 content"、#7"层表驱动+recommendedPower 软提示字段"（与 SPEC:102 检查点一致）、#8"阶段脚本 100% content 定义"、#9"条件=content、统计由事件流累积"。互补：#6"效果=**引擎标准修饰词**（采集速度/攻/防/血/暴击/离线上限/经验倍率…）"是封闭原语词表——N4 同族的消费点注册表，#6 动工时随批 4 裁决（见 §三·E3） |
| #10/#12（OPEN） | 打包/分发议题，无内容感知陈述，无发现 |
| #11（OPEN） | 表单/LLM/导入导出，无归属类陈述；"复用 content 包的 validateContent（同一份代码）"与主审计干净面一致 |

### B · js/ 旧版（ADR-003 豁免）复核 + 数值沿革对照

**B1 ·（复核通过）豁免成立性**

- 构建不触及旧版：vite 仅存在于 `packages/app-desktop/vite.config.ts` 与 `packages/editor/vite.config.ts`（各 5 行，仅 `base:'./'`），入口是两包各自的 index.html；根 `index.html:7,25-26` 引用的 `css/style.css`、`js/data.js`、`js/game.js` 仅被旧版自身引用。
- 脚本不触及旧版：五份 package.json（根 + engine/content/app-desktop/editor）的 scripts（dev/dev:editor/test/build/check）无一涉及根 index.html/js/css。
- 票面佐证：#1 交付评论"旧版 js/css/index.html 未改动"。

**B2 ·（P2，功能缺口登记）REALMS 境界词表——唯一未收编、未实现的 data.js 内容值**

- 旧版：`js/data.js:141-144`（八档：练气期/筑基期/金丹期/元婴期/化神期/炼虚期/合体期/大乘期 + 门槛 1/10/20/35/50/65/80/93）、`js/game.js:179-183`（realmName 按 clv 查表）。
- 新架构去向：**零实现**——engine 全源码无 realm 计算（全库 `realm` 搜索仅 `packages/engine/tests/createGame.test.ts:32,39` 的存档未知键透传 fixture，走主审计 §六"透明透传未知键"路径）；app-desktop 无"境界"字样；content schema/config 无承载节；default.json 无对应数据。
- 定性：**功能缺口，非违规**（没有实现就没有感知）。登记目的：该词表是典型的"档位词表+阈值"（主审计 §二 右列内容），将来实现时（大概率随 #6 rebirth 或 UI 主页重做）必须进 content（建议 rebirth 节或 combatText/config 扩节），防止重演 P0-1。主审计 §七"转生"行可加注此缺口。

**B3 ·（P2，勘误）主审计 P0-1"外部加权"出处引用精度修正**

- 主审计 §三 P0-1 表达力缺口条写："旧版 rollRarity 本有'炼器等级抬稀有度'的外部加权输入（**js/data.js:156-161**，research §1.1 引用）"。
- 实况：`js/data.js:156-161` 是 RARITY 表定义（四档数值）；外部加权的调用与系数在**旧引擎**——`js/game.js:84-87`（`rollRarity(lvBonus)` 函数体）与 `js/game.js:95`（`makeGear` 内 `rollRarity(levelFromXp(S.skills.smith.xp) * 0.0004)`）。
- 结论不变（"引擎版丢失外部加权参数位"成立，A4 票面佐证），但出处应改指 game.js:84-95；research §1.1 的行号引用如需复用请同步核对。

**B4 ·（对 §四.6 表述的精度修正）"数值沿革"应二分：词库/表值 vs 公式系数**

- 主审计 §四.6："旧版 js/data.js 是全部硬编码数值的源头……内容从旧版内容文件搬进了新引擎"——逐项对照后需二分：
  - **词库/表值类**（SKILLS/ITEMS/PILL_EFFECTS/GATHER_ACTIONS/RECIPES/ENEMIES/SHOP/GEAR_DROPS/CTEXT/SLOTS/RARITY/AFFIXES）：旧版确实全部在 data.js；其中除 RARITY/AFFIXES（P0-1）与 REALMS（B2）外均已收编 default.json（逐节核对一致，含数值换算记录：耗时 ×1000、回气丹 percent 数据化、炼器显式 successRate=1）。
  - **公式系数类**（statBase 曲线 8+3clv/2+1.2clv/crit5、MAX_LV 99、经验曲线、DEFENSE_K 120、VARIANCE 0.1、暴击 1.6/75、伤害档阈值、门控 +2、回血 4%、间隔 2200）：旧版**就在引擎** `js/game.js:24-27,175-178,250,263,268-275,321-327,387`，并非搬自 data.js。
- 对批 1/批 3 的意义：批 1（稀有度词表）是"把旧版内容值从引擎**还回**内容"；批 3（战斗/成长参数）是"把旧版**从未内容化**的参数首次内容化"——两者性质不同，修复叙事与存档兼容评估都应分开表述。
- game.js（非 data.js 文件）内容感知扫描结论：其数据引用全部指向 data.js 常量或上述公式系数，无独立词库/数值定义（除 `js/game.js:123` affixText 的 stat→'攻/防/血/暴' 展示 label 与 `js/game.js:8-9` 万/亿格式化，均属旧版 UI 层展示文案，不构成新架构问题）。

### C · dist 构建产物 + smoke.yaml

**C1 ·（复核通过）dist**

- `.gitignore:4` 全局忽略 `dist/`——任何层级的 dist 均不入库。
- 实存 dist 仅两处：`packages/engine/dist`（52 文件：13 js + 13 .d.ts + 26 map）与 `packages/content/dist`（25 文件，含 default.json 副本）；根目录与 app-desktop/editor 当前无 dist。均被 gitignore 覆盖。
- 非消费路径：engine/content 的 package.json exports 指向 `./src/index.ts`（源码消费，#1 交付评论"无构建顺序耦合"），dist 内的 default.json 副本无任何引用方。
- 构建脚本健康：engine/content `tsc -b`、app-desktop/editor `tsc --noEmit && vite build`，根 `npm run build/check/test --workspaces --if-present`。无内容感知痕迹。

**C2 ·（P2，卫生登记）根目录 smoke.yaml 是冒烟残留物**

- 全文 5 行，是 example.com 的无障碍树快照（heading "Example Domain"…）——即 2026-09-03 agent-browser 冒烟验证时误存到根目录的输出残留，**不是冒烟/测试配置**，与审计议题无关，无内容感知。
- 处置建议：直接删除（未跟踪文件，不影响 git 状态）；或纳入 .gitignore 之外的本地清理习惯。不构成违规。

### D · .scratch/ 全目录清点

- `.scratch/rebuild/`：已知 `SPEC.md`；新发现 `issues/001-016` 共 16 份本地票草稿 md——与 GitHub 票正文**逐字一致**（抽 #16 全文比对一致，其余同构生成），是草稿镜像而非独立决策文档，无新增引用价值。
- `.scratch/rebuild/` 之外无其他决策/调研文档（rebuild-research.md 在 docs/research/，主审计已覆盖）。
- `.scratch/audit3/`：本轮自建调查件（16 份票 JSON + issues-list.json，任务预取），按纪律用后即清。
- 结论：**无遗漏的决策文档**，复核通过。

### E · 五份 package.json + vite 配置

- scripts/dependencies 无内容值内嵌、无内容文件被非 content 包引用；依赖图与主审计 §六 一致（engine 零 workspace 依赖、content 零依赖、app-desktop → {engine, content}、editor 零依赖）。复核通过。
- vite 配置各 5 行（`base:'./'`），无插件/别名/内联常量。复核通过。

## 三、对既有章节的影响增补

### 对 §三（违规清单）

- **P0 新增 0；P1 新增 0；P2 新增 5**（A2 勘误、A3 文档根因、A4 接缝预警、B2 功能缺口、B3 勘误；另 C2 卫生项不计违规档）。
- P0-1 增补两点：① 出处勘误（B3）；② 票面定调新证据 #14（A1，与 gear.ts:4-6 同方向的唯一一票，批 0 须逐字回应）。
- P1-1 增补：文档根因上溯至 #3 评论对 SPEC:55 的选择性引用（A3）。

### 对 §五（豁免表）

- 无新增豁免项。game.js 旧版参数不进豁免表（该表只针对新架构现状）。

### 对 §七（未完成部分接缝）

- #15 行：schema 预留出处由"#2/#15"更正为 **#16**（A2）；缺口清单四项不变，复核维持。
- #5 行：并入 A4 参数位清单（+0.004/层、0.99 上限、25% 返还、UI 文案联动、lvBonus 加权参数位恢复且系数随批 3 config 化）。
- #14 行：增补"A1 票内两说"提示——动工前 ADR 已裁决则票文不构成障碍，但 ADR 结论应回写到 #14 票评，固化判例。
- #6 行：增补"天赋效果原语词表 = 消费点注册表"（N4 同族），原语清单首次出现在票面（含'离线上限''经验倍率'两个当前 schema 无承载的新 stat 键），动工时随批 4 单一来源裁决。
- 转生/秘境/Boss/成就行：增补 REALMS 境界词表功能缺口（B2），实现时须进 content。

### 对 §八（修复路线图）

- 批 0：ADR 议程新增两项——①逐字回应 #14 口诀并回写票评（A1）；②修订 SPEC.md:55 一句两面结构（A3），与 CONTEXT.md/三处注释修订同批。
- 批 1：缺省表策略裁决可引用 #16"默认包不放无消费方内容"先例厘清"缺省表 ≠ 闲置内容"（A2）。
- 批 3：新增 #5 成功率公式参数位清单（A4）。
- 批 4：新增 #6 天赋原语词表=消费点注册表（A5）。

### 对 §九（测试连锁面）

- 无新增断言面（本轮未发现新代码副本）。B2 登记的 REALMS 若将来实现，届时补快照断言（现在无代码，无连锁）。

### 对 §十/§十一（覆盖清单与二轮增量）

- §十"未覆盖"三项全部闭合（票正文/js/dist），另覆盖 smoke.yaml 与 .scratch 全目录。
- §十一 P0-1 表达力缺口条的 js/data.js:156-161 引用按 B3 更正为 js/game.js:84-95。
- §十一 N1 增补旧版佐证：开战门控四处副本在旧版同构存在（`js/game.js:250` 判定、`:714` UI 判定、`:721` UI 文案"需斗法 N-2 层"），N1 是整块搬运的产物而非新架构原创——修复时四处收敛为单一来源的必要性更强。

## 四、本轮覆盖清单

**查了什么 / 怎么查的：**

1. GitHub 票：16 份 JSON 全文通读（body + comments 逐字），交叉核对 issues-list.json 状态；关键票（#14/#16/#3/#5）与 SPEC.md/主审计条目逐条比对。
2. js/ 旧版：data.js（295 行）与 game.js（923 行）全文精读；data.js 十二个常量节 → default.json（301 行全文）逐节收编对照；REALMS/realm 全库（packages/）正则搜索；旧版公式系数 ↔ 新引擎常量（主审计 P1-1 清单）逐项溯源。
3. dist/.gitignore/构建：直接读 `.gitignore`；list_dir 三层（根/包/包内 dist）；五份 package.json 全文；两份 vite.config 全文。
4. smoke.yaml：全文 5 行判定性质。
5. .scratch：全目录清点 + 票草稿镜像抽查（#16 全文比对）。
6. 票面 ↔ 文档交叉：#3 评论声称的"SPEC 定性"回落到 SPEC.md:55 原文核实。

**复核通过（明确记录）：** dist/C1、js 豁免/B1、.scratch/D1、package.json+vite/E1、#1/#2/#4/#13/#6-#12 票面与审计一致性（A5）、default.json 词库/表值收编完整性（B4 前半）。

**仍未覆盖：**

- 主审计 §十 其余未覆盖项中，app-desktop/editor 包级 tsconfig 已在二轮补读；本轮无新增未覆盖块。
- 边缘说明：`packages/content/dist` 内的 default.json 副本仅确认存在与无引用方，未逐字节比对（被 gitignore、非消费路径，无风险面）。
- 票草稿镜像（.scratch/rebuild/issues/*.md）仅抽查 #16 与 GitHub 全文一致；其余 15 份按同构生成推定一致，未逐份比对（镜像非权威源，无审计风险）。
