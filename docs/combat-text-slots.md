# CombatText 槽位协议语义表（#27 / Batch1-T5）

> 审查对象：`packages/content/src/schema/combat-text.schema.json`（协议）+ `packages/engine/src/combat.ts`、`game.ts`（消费面）+ `packages/content/src/packs/xiuxian.json`（官方包实样）。
> 审查输入采用 Batch1/T2（#24）改名后的键名（`verbs` 池 required `basic`、`BASIC_KEY`）；基线为 #26 交付后（texts.shell 协议已钉）。
> 结论摘要：十键结构与战斗文案协议**不动**；协议面唯一确认的硬假设 = schema 长度上限隐含 CJK 字符密度（已最小解耦），其余全部假设为内容层自洽或既定 ADR 约定，逐条裁决见 §四。

## 一、十键总览

| 键 | 形状 | 引擎消费点 | 语义 | 缺失/非法防御路径（ADR-016 裁决 ④，一律非文案占位） |
|---|---|---|---|---|
| `verbs` | `Record<style, VerbEntry{v,limbs}[]>`；`basic` 恒需（schema required），其余键开放（被 item.verbStyle / enemy.kind 引用时语义校验强制） | `pickVerb` | 动词+部位**同 entry 配对**的白名单池（动宾搭配由包声明，引擎不猜） | style 未注册/池非法 → 回落 `basic` 池 → 全缺回显 `{v:'v'}, {limb:'limb'}` |
| `moves` | `Record<key, string[]>`；key = `basic` / 武器物品 id / 敌人 id | `extractMoveName` | 招式名注册表 | 未注册 key → 回落 `basic` → 全缺回显注册键 |
| `openings` | lines | 模板 `{opening}` 槽 | 起势段（玩家 heavy 专属，见 C7） | 缺池 → 空串跳槽 |
| `critIntro` | lines | 模板 `{critIntro}` 槽 | 暴击起势（玩家 crit/deadly 专属） | 缺池 → 空串跳槽 |
| `cons` | hit/hurt × light/mid/heavy/deadly | `makeAttackText` 后果句 | hit 主语 = `{defender}`（妖物）/ hurt 主语 = 玩家（"你"由文案自带，见 C4） | 缺池 → `{d}` 裸伤害占位 |
| `fatal` | hit/hurt 单串 | 同上（门控见 §三） | 致命一击专属句 | 缺串 → 落回 `cons` |
| `templates` | 五池 playerLight/playerHeavy/playerCrit/enemyLight/enemyHeavy | `makeAttackText` 出招句 | 出招句式模板（槽必需集由 schema pattern 钉死） | 池缺 → 出招句空串，仅余后果句 |
| `notes` | 七池 retreat/retreatToGather/retreatWounded/retreatVictory/reengage/start/autoConsume | `game.ts noteFrom` | 系统事件叙事（七键 = 引擎状态机事件面，见 C13） | 缺池/抽空 → 池键名回显 |
| `summary` | tiers×4 + base/crit 整行模板 | `summarizeRounds` | 战后一行画像（**仅 victory 侧**，defeat 不产；对照的 prev 记录 victory/defeat 都写） | 节缺 → `String(rounds)`；flavor 缺 → 空串（见 C10） |
| `compare` | 四池 revenge/faster/slower/even | `compareEncounterText` | 同对手再战对照语 | 无 prev（`rounds<=0`）/节缺 → `undefined`，事件不带 compare 段 |

## 二、槽位清单

**出招句模板槽（`makeAttackText` 填充，8 槽）**：

| 槽 | 值来源 | 语义与注意点 |
|---|---|---|
| `{move}` | `moves[moveKey] ?? moves.basic` 抽取 | 招式名；包裹符（「」）由模板文案决定，引擎零感知 |
| `{weapon}` | 兵刃展示名；无武器 = `texts.basicName` | vars 对 player/enemy **恒同集**：enemy 模板也可自由使用 `{weapon}` 槽（协议比修仙包用法宽——修仙包妖物不持兵刃，enemy 五池 pattern 亦不强制） |
| `{verb}` | `verbs[style] ?? verbs.basic` 的 `v` | 与 `{limb}` 同 entry 配对抽取（动宾搭配白名单） |
| `{limb}` | 同 entry 的 `limbs` 随机 | 部位名词短语 |
| `{defender}` | 敌名 | **恒 = 敌名**（见 C5 语义陷阱） |
| `{enemy}` | 敌名 | 与 `{defender}` 同值双槽名：defender=受击语境、enemy=主语语境 |
| `{opening}` | `openings` 抽取 | 仅 side=player 且 tier=heavy 时取池；crit 优先于 heavy（playerCrit 模板无起势段）；enemy 侧恒空串 |
| `{critIntro}` | `critIntro` 抽取 | side=player 且（暴击 或 tier=deadly）；enemy 侧恒空串 |

**其它槽**：notes 的 `{enemy}`（start/reengage，schema pattern 强制）、`{item}`（autoConsume）；summary 的 `{rounds}/{flavor}/{crits}`；compare 的 `{rounds}/{prev}`（even 仅强制 `{rounds}`——持平可不见前番数）。

**槽机制语义**（`fillTemplate`）：`replaceAll` 全局替换（同槽多次出现全填）；**槽值不递归展开**（先到先得，槽值内含 `{key}` 字样不会再替换——槽值拼入安全）；vars 传入顺序为固定字面量序。

## 三、伤害档位语义

- **档 = 相对期望伤害比**：`hitTierOf` 取 `r = dmg / expected`，`expected = max(1, atk × (1 − def/(def+defenseK)))`。阈值由 `config.combat` 可覆盖引擎基线：light `r<0.95`、mid `r<1.05`、heavy `r<1.5`、deadly `r≥1.5`（`BASE_DAMAGE_MECHANICS`）。**档名 `deadly` 指"伤害爆表"，与"濒死"无必然关系**（濒死是下面的危血门控）。
- **模板映射**：玩家 crit‖deadly → `playerCrit`（带 `{critIntro}`）；heavy → `playerHeavy`（带 `{opening}`）；light/mid 共用 `playerLight`。敌人 heavy‖deadly → `enemyHeavy`；light/mid 共用 `enemyLight`。**mid 无专属出招模板**（见 C9）。
- **危血门控（fatal）独立于伤害档**：受击者剩余生命 ≤ `criticalHpFraction`（基线 0.15）**且** tier ∈ {heavy, deadly} → 后果句改用 `fatal` 池；否则按档取 `cons[hit|hurt][tier]`。
- **战后画像主导档**：`summarizeRounds` 按四档计数取最大者（并列取更轻档），从 `summary.tiers[dominant]` 抽画句填 `{flavor}`；`crits>0` 走 `crit` 整行模板。

## 四、隐含中文语法假设逐条裁决

| # | 假设 | 位置 | 裁决 | 理由 |
|---|---|---|---|---|
| C1 | 长度上限隐含 CJK 字符密度：`v≤4` / `limbs≤6` / 招式名≤12 / 行≤60、后果行与模板≤80 / `texts.basicName≤6`——拉丁等义文本（约 2.5~3.5× 字符）会大面积超限 | 两张 schema | **解耦** | 唯一协议级硬假设。上限是纯校验上界，放宽零语义影响、十键不动、修仙包现值全部 ≤ 原上限（零行为变化）。按 ~3× 放宽：v 4→12、limb 6→18、招式名 12→36、行 60→180、后果行与模板 80→240、basicName 6→18 |
| C2 | `{verb}`+「向」、{limb} 承接「的」的句法连续性（"刺向…的咽喉"） | 修仙包模板 | 保留 | 纯内容层句式自洽，协议不锁自然语言搭配（`fillTemplate` 纯替换、槽序自由）；换题材 = 换模板文案 |
| C3 | `openings`/`critIntro` 文案以第二人称「你」起头、句尾无标点（衔接靠模板内「——」） | 修仙包 | 保留 | 内容层；协议只锁槽存在（schema pattern），不锁标点与人称 |
| C4 | `cons.hit`/`fatal.hit` 主语 = `{defender}`（pattern 已钉）；`cons.hurt`/`fatal.hurt` 的主语「你」由文案自带（pattern 只钉 `{d}`） | 协议 pattern + 修仙包 | 保留 | 受击者是玩家时无可填槽（没有 `{player}` 槽），第二人称只能文案自带；扩 PvP/召唤物需要新键，属重构，票面禁 |
| C5 | `{defender}` 槽名义是"受击者"，实现恒填敌名（受击者是玩家时不产槽）；enemy 模板若误用 `{defender}` 会填进妖名 | `makeAttackText` vars | 保留（文档化） | 改槽名 = 破坏协议 + 全包迁移，禁；语义澄清以本表为准：**两槽恒同值，敌模板请用 `{enemy}`** |
| C6 | `{d}/{rounds}/{prev}/{crits}` 直拼阿拉伯数字 | 引擎 | 保留 | 数字槽本就 locale 无关；本地化数字/千分位是壳层义务（`brand.locale`），非文案协议面 |
| C7 | `openings`/`critIntro` 为玩家专属池；enemy 侧 `{opening}/{critIntro}` 恒空串（enemy 模板带此槽会产出悬空破折号） | `combat.ts` | 保留 | 敌侧起势 = 新池键 = 重构，票面禁；内容侧不写该槽即可，schema 未禁（包自由） |
| C8 | deadly 档与暴击共用 `playerCrit` 池 + `critIntro`（濒死叙事并入暴击池） | 模板映射 | 保留 | 映射语义已由 schema 描述钉死（"crit 或 deadly"）；拆池 = 扩键 |
| C9 | mid 档无专属出招模板（与 light 共池）；`cons`/`summary.tiers` 则有 mid 池 | 协议五池 | 保留 | 五池键集由 schema required 钉死，mid 复用 light 是 #019 有意简化（档感由后果句承载） |
| C10 | `summary.base` 缺 `{flavor}` 池时画句退化空串 → "… · " 悬空分隔符 | `summarizeRounds` 防御路径 | 保留 | 仅非法内容可达（schema required tiers 恒在）；防御路径按裁决 ④ 不造句，不为不可达路径改运行时（保"修仙包行为逐点不变"） |
| C11 | 招式注册键 = 武器/敌人 id、未注册回退 `basic`、全缺回显键 | `extractMoveName` | 保留 | ADR-010 安全兜底约定既有裁决 |
| C12 | 壳以 `innerHTML` 重绘，战斗文案入 DOM | 壳层 | 保留 | 槽值经壳 `esc()` 转义后拼接（壳义务），协议面无注入假设；文档记录归属 |
| C13 | `notes` 七键 = 引擎状态机事件面（协议 code 本体归引擎） | `game.ts` | 保留 | 新系统事件 = 新协议键 + schema 扩展（`additionalProperties:false`），是既定扩展路径非硬假设 |

## 五、解耦改动明细（C1）

- `packages/content/src/schema/combat-text.schema.json`：`verbList.v` 4→12、`verbList.limbs` 6→18、`moveNames` 12→36、`lines` 60→180、`hitLines`/`hurtLines`/`templateLines` 80→240、`noteLines` 60→180。
- `packages/content/src/schema/texts.schema.json`：`basicName` 6→18（其为 `{weapon}` 槽兜底值，同一假设同批解耦）。
- 修仙包 JSON 零改动、引擎零改动、十键结构零改动。

## 六、扩展点备忘（非本次范围）

- PvP / 多方战斗：`side` 二分、cons hit/hurt 主语约定（C4）、`{defender}` 槽语义（C5）均需重审——触发条件 = 第二款游戏出现对称战斗。
- 敌侧起势 / 暴击起势池（C7）、mid 专属出招模板（C9）、SlotDef.role 推断 verbStyle（随 #14）。

> 三处同步状态（ADR-015）：schema 已改（本票）；`schema/types.ts` 无长度约束不动；`docs/agents/content.md` 的 `basicName` 字数记载已随本票同步（combatText 各键该文档未记长度，本表为槽位语义权威载体）。
