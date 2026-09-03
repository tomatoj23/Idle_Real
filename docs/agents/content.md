# Content 字段约定

content 包的字段级约定。**schema 变更三处同步纪律（ADR-015）**：任何字段变更须同步
`packages/content/src/schemas/*.schema.json`、`packages/content/src/types.ts`、
本文件，三者缺一即返工。**引擎消费点（contentView 的 View 类型、state.ts 规范化）
不在三处清单内，随消费票同步**（P2-2 教训：enemy schema 已含 `affinities` 而
engine `EnemyView` 未投影，靠 #15 票驱动补齐）。

## 节清单

| 节 | 必填 | schema | 说明 |
|---|---|---|---|
| `skills` | 是 | skill.schema.json | 技艺定义（gather 带 activities） |
| `items` | 是 | item.schema.json | 物品，oneOf 五形态分流（见下） |
| `recipes` | 是 | recipe.schema.json | 配方（无 id 的关系行，不参与原型继承） |
| `enemies` | 是 | enemy.schema.json | 敌人 |
| `gearDrops` | 是 | gear-drop.schema.json | 异宝掉落表（无 id 关系行） |
| `rarities` | 是 | rarity.schema.json | 稀有度档位词表（#018，ADR-016 词表零默认） |
| `affixPool` | 是 | affix-pool.schema.json | 装备随机词条池（同上） |
| `combatText` | 是 | combat-text.schema.json | CTEXT 战斗文案词库（#019 批 2 扩十键：+句式模板/系统 note/战后摘要/对照语） |
| `texts` | 是 | texts.schema.json | 系统展示文案（#019 批 2）：兵刃兜底名 + reject 协议 code → 文案映射 |
| `shop` | 是 | shop.schema.json | 坊市货架（无 id 关系行） |
| `config` | **否** | config.schema.json | 全局配置：槽位（#16）+ 玩法参数三子节 combat/progression/affix（#020，缺省=引擎基线） |

## items 五形态（#16 起 oneOf 分流，判别式 = `type`）

| type | 语义 | 分支必填 | 分支专有可选 |
|---|---|---|---|
| `mat` | 材料 | 公共字段（id/name/icon/type/sell） | — |
| `pill` | 丹药 | 公共字段 | effect、heal（至少其一，语义检查） |
| `equip` | 装备 | 公共字段 | slot、bonuses（须都有，语义检查） |
| `blank` | **器胚**（装备底材模板） | 公共字段 + slot + floorRange + tierRange | preferredTags、inherentModifiers |
| `inscription` | **铭纹**（装备词缀模板） | 公共字段 + tiers | feature、tags |

- 跨形态字段由 oneOf 分支 `additionalProperties:false` 在 schema 关卡拒绝；
  分支内规则（equip 缺 bonuses、pill 无 effect/heal、区间方向、修饰符区约束）
  由 `validateContentPack` 语义检查补全（ADR-010 分工）。
- **空集合合法**：`preferredTags: []`、`inherentModifiers: []`、`tags: []` 均合法；
  `items: []` 仍被拒（#2 定下的节下限不放宽，每包至少一个物品）。
- 默认包**不放**器胚/铭纹内容（无机制消费方时不进默认包，避免污染数值快照）。

### 器胚字段（CONTEXT.md 词汇：器胚/胚纹/纹阶）

| 字段 | 形态 | 约定 |
|---|---|---|
| `slot` | string | 槽位 id，须在 config.slots 有定义（xref） |
| `floorRange` | `{min,max}` | 掉落层数段（秘境层数，1 起）；分层掉不同器胚，否决 itemLevel 缩放 |
| `tierRange` | `{min,max}` | 纹阶天花板区间 T1~T3；重铸铭纹不得突破 |
| `preferredTags` | string[] | 偏好标签：铭纹抽取权重 = 基础 × (1+匹配数×加成) |
| `inherentModifiers` | Modifier[] | **胚纹**：固有词条，固定非随机，实例化时直接附加 |

### 铭文字段（CONTEXT.md 词汇：铭纹/纹阶）

| 字段 | 形态 | 约定 |
|---|---|---|
| `tiers` | `[Modifier[], Modifier[], Modifier[]]` | 三阶数值表，下标 0/1/2 = 纹阶 T1/T2/T3，定长 3 |
| `feature` | `{primitive, condition?, value?}` | 机制型特色铭纹：condition+primitive 表达，引擎原语池零新增（未注册原语忽略） |
| `tags` | string[] | 标签加权抽取归类（tags/flags 分工：归类批量捞，裸布尔走 flags） |

### Modifier（修饰符，#13 聚合管线已消费）

```json
{ "stat": "atk", "zone": "flat", "value": 5, "condition": { "element": "fire" } }
```

- `zone`: `flat` → `addPct` → `mult` 三区按序结算（ADR-011），禁绕管直改。
- `value`: 乘法区须 > 0；加法%区 ≥ −100（语义检查）。flat/addPct 可为负。
- `condition`: `{element?, moveId?}` 至少一维（minProperties），命中才生效。

**引擎聚合公式（#13 定版）**：`value = (base + Σflat) × (1 + ΣaddPct/100) × Πmult`，
负值钳到 0；倍率类属性（gatherXp 等以 1 为基线）基线由消费方给定，百分点型
增量（暴击率 +25）走 flat。引擎侧 `packages/engine/src/modifiers.ts` 提供
`aggregateStat/aggregateStats/conditionMatches`；每条贡献自带来源语境
`source{id,kind,uid?,name?}`，聚合快照 breakdown.applied 保留命中明细——
事件流消费属性效果时第一天就携带完整语境（SexyMUD ADR-0006 教训）。
引擎接缝：`playerMaxHp(content, skills, contributions?, context?)` 已走管线；
静态全局产出方（宗门/转生天赋）经 `createGame({contributions})` 注入；
装备/丹药 buff（#4）在引擎内部从状态派生 Contribution，禁止另开直算路径。

## rarities / affixPool 词表数据化（#018，ADR-016）

**ADR-016 裁决 ①（词表零默认）**：档名/概率/倍率/词条数/卖价/量级系数全部由
content 包定义，引擎不持任何默认表。两节均为**必需节**（validate 强制恒在）；
引擎对缺失档位按"回退第一档"安全兜底（兜底是路径不是数据），空表时按中性值
降级（mult/sell=1、零词条、展示名缺省省略前缀）——绝不因内容缺失崩溃。

### rarities（稀有度档位）

| 字段 | 形态 | 约定 |
|---|---|---|
| `id` | string（`^[a-z][a-z0-9_]*$`） | 档位 id，**发布后不可变**：存档键（`GearInstance.rarity`）+ UI `r-*` 着色类后缀；id 去重（语义检查） |
| `name` | string（1~6 字） | 档名；引擎拼「档名·物品名」展示 |
| `weight` | number（> 0） | 掷点权重，**按占比归一化**（引擎 rollRarity 除以总权重），无需配成 1；正数性由 schema 关卡保证（归一化掷点的前提） |
| `mult` | number（> 0） | 基础加成倍率：实例化投影 flat = round(基础 × mult)（ADR-011 单管线） |
| `affix` | integer（≥ 0） | 随机词条数；实例化时从 affixPool 掷不重复 stat 词条 |
| `sell` | number（> 0） | 卖价倍率：卖价 = max(1, round(物品卖价 × sell)) |
| `showcase` | bool（可选） | **UI 特判开关（裁决 ④）**：true 时 UI 作「天降异宝」级特判；UI 不再用 id 字面量（如 `'epic'`）特判 |

数组顺序即档位顺序：缺档回退取**第一项**；旧档位从词表移除后，存量存档的该档
装备恢复时自动回退第一档（存档不炸，数值按第一档重投影）。

### affixPool（随机词条池）

| 字段 | 形态 | 约定 |
|---|---|---|
| `name` | string（1~6 字） | 词条名，随词条值展示 |
| `stat` | enum：`atk`/`def`/`hp`/`crit` | **affix.stat 引用合法**的校验关卡（schema enum 钉死装备加成四键域；crit 为百分点）。扩域须同步 UI `STAT_LABEL` 与引擎 baseScale 标尺（单一来源裁决随批 4） |
| `scale` | number（> 0） | 量级系数：词条值 = max(1, round(基础标尺 × scale × 随机波动))；波动幅度与标尺折算系数（hp÷5/crit×0.8/兜底 3）已随 #020 config 化（`config.affix` 子节） |

实例化按稀有度 `affix` 数量掷**不重复 stat** 词条；同 stat 多条目合法（掷点去重
发生在运行时）。

### 引擎判例（round3 A1，#14 动工时引用）

`rollRarity`（权重掷点机制）与 `makeGear`（词条实例化管线）归引擎，接收内容表
为参数位；权重表/概率/档名/卖价系数/量级系数归 content。"炼器等级抬稀有度"的
外部加权输入位（旧版 js/game.js:84-95）留待 #5/#14 接入 rollRarity 签名，届时
系数本身随批 3 config 化，勿写死函数体。

## combatText 扩节与 texts 系统文案（#019 批 2，ADR-016 裁决 ④）

**文案零引擎硬编码**：战斗叙事/系统提示改文案 = 纯 JSON 改动。引擎对缺失内容
一律非文案占位降级（键名回显或空串跳过；如招式名兜底回显注册键、模板缺失
退化为伤害数字），防御路径保留但不再内置中文兜底句。

### combatText 扩节（六键 → 十键，schema required）

| 键 | 形状 | 说明 |
|---|---|---|
| `templates` | 五池：playerLight/playerHeavy/playerCrit/enemyLight/enemyHeavy | 出招句式模板。槽位：`{move}` 招式名、`{weapon}` 兵刃名、`{verb}` 动词、`{defender}` 受击妖名、`{enemy}` 妖名、`{limb}` 部位、`{opening}` 起势（heavy 池）、`{critIntro}` 暴击起势（crit 池）。schema pattern 强制必要槽位 |
| `notes` | 七池：retreat/retreatToGather/retreatWounded/retreatVictory/reengage/start/autoPill | 系统 combat-note 叙事。start/reengage 带 `{enemy}`、autoPill 带 `{item}` |
| `summary` | tiers（四档画句池）+ base/crit 整行模板 | 战后一行签名画像：引擎按主导伤害档取画句填 `{flavor}`，`{rounds}`/`{crits}` 填数值 |
| `compare` | 四池：revenge/faster/slower/even | 同对手再战对照语：`{rounds}` 今番、`{prev}` 前番回合数；无从对照返回空（事件不带 compare） |

### texts（系统展示文案）

| 字段 | 形状 | 说明 |
|---|---|---|
| `fistName` | string（1~6 字） | 无佩戴武器时的兵刃展示名（weaponName 槽兜底值） |
| `reject` | 动作协议键 → 理由 code → 文案模板 | 展示文案映射。动作键域 schema 钉死：activity:start / bag:sell / shop:buy / combat:start / pill:eat / gear:equip / gear:sell / `'*'`（跨动作兜底，bad-payload 等通用文案）；理由 code 键域开放 |
| `reject` 槽位 | `{level}` `{activity}` `{item}` `{owned}` `{cost}` `{gp}` | 由引擎按协议语境填入； combat:start 的 `{level}` = `enemy.level − 门控偏移`（偏移量只在引擎判定处单一来源，文案侧零副本——N1 文案侧裁决） |

- 命中序：精确动作 → `'*'` → **键名回显**（`{action}/{reason}`，防御可见）。
- 协议 code 本体归引擎，本节只承载展示文案；code 未命中/缺节绝不崩，toast
  退化为协议键名。

## config 槽位数据化（#16）与玩法参数数据化（#020）

```json
"config": {
  "slots": [ { "id": "weapon", "name": "法器", "icon": "兵" } ],
  "combat": { "playerAttackInterval": 2200, "levelGateOffset": 2, "...": "…" },
  "progression": { "maxLevel": 99, "xpPowCoef": 10, "...": "…" },
  "affix": { "hpDivider": 5, "variance": 0.2 }
}
```

- 槽位 id 数据化，新槽 = 新 JSON（法宝/外袍留门）；`items[].slot` 引用槽位 id。
- `config` 为**可选节**：缺省时跳过槽位 xref 检查（既有包零破坏），引擎按无槽位兜底。
- 起步三槽：`weapon` 法器 / `body` 护体 / `accessory` 灵饰。
- 注意：武器招式注册（`combatText.moves` 键）目前锚定槽位 id `weapon`；
  若未来槽位改名/多武器槽，须同步放宽该锚定（#14 装备票消费时处理）。

### 玩法参数三子节（#020 批 3，ADR-016 裁决 ① 分策）

**缺省策略 = 引擎基线 + config 覆盖**：三个子节与其字段全部可选，缺省字段逐项回落
引擎基线（基线即旧版 data.js 数值）；非法值（类型错/NaN）在引擎侧逐字段回落基线，
数值**边界**（min/max/互斥）由 schema 与包校验关卡拒绝（ADR-010 分工：schema 管边界、
引擎管形状防御），引擎使用点仅对除零类参数防崩（如 affix.hpDivider ≤ 0 回落基线）——
改战斗/成长/词条参数 = 纯 JSON 改动，引擎零改动。
默认包**显式写出全部基线值**（数值回归内容文件，作参数调档的起点）。

| 子节 | 字段域 | 引擎基线 |
|---|---|---|
| `combat` | playerAttackInterval / defenseK / damageVariance / critMultiplier / critCap / criticalHpFraction / lowHpFraction / autoEatHpFraction / victoryRestMs / levelGateOffset / tierLightMax / tierMidMax / tierHeavyMax / statAtkBase / statAtkPerLevel / statDefBase / statDefPerLevel / statCritBase / autoFight / autoEat | 2200ms / 120 / ±10% / ×1.6 / 75 / 15% / 30% / 50% / 1500ms / +2 / 0.95·1.05·1.5 / 攻 8+3·层 / 防 2+1.2·层 / 暴 5 / true / true |
| `progression` | maxLevel / xpPowCoef / xpExponent / xpLinearCoef / hpBase / hpPerLevel / hpRegenPerSec | 99 / 10 / 1.8 / 15（升层需 floor(10·L^1.8+15·L)）/ 100 / 12（气血 100+12·层）/ 4%/s |
| `affix` | hpDivider / critScale / baseScaleFloor / variance | 5 / 0.8 / 3（基础标尺 = max(攻防原值, hp÷5, crit×0.8, 3)）/ ±20% |

- 计量：毫秒与百分点；`damageVariance`/`variance` 为对称波动幅度 v（乘数 1−v ~ 1+v）。
- 跨字段语义检查：伤害档阈值须严格递增（tierLightMax < tierMidMax < tierHeavyMax，
  pack 校验 shape）；其余边界由 schema 关卡保证。
- statBase 语境：`statAtk*`/`statDef*`/`statCritBase` 按斗法层数线性成长，与
  progression 的气血曲线在引擎 statBase 处汇合（攻击/防御/暴击归 combat、气血归
  progression，按消费侧归属分节）。
- autoFight/autoEat 裁决（#020）：自动化开关的**缺省值**归 `config.combat`
  （新档初建与存档未写该字段两落点），玩家在局内的手动开关仍随档保存。
- N1 判定侧收敛：开战门控偏移 `levelGateOffset` 参数化；引擎 `enemyGateOf(content,
  skills, enemyId)` 是锁定判定/需层数展示的**单一来源**（与 combat:start 判定同公式），
  UI 禁止复制 clv+offset 公式（AUD 审计 N1 四处副本收敛为引擎一处）。

## enemies 系别字段（#16，可选零破坏）

| 字段 | 形态 | 约定 |
|---|---|---|
| `element` | enum：metal/wood/water/fire/earth/wind/thunder | 系别（金木水火土风雷，ADR-012）；**不填=凡击无系别**；只给 Boss/特色怪配 |
| `affinities` | `{[系别]: −100~100}` | 系别亲和：受该系攻击的伤害调整百分点（负=抗性，正=易伤）；键由 patternProperties 钉死七系 |

系别是结构签名不是数值皮肤（ADR-012）：配 `element` 的敌人应携带对应机制原语，
否则宁可不配（宁 4 真系勿 7 假系）。

## prototype 字段（#16 字段先行，ADR-015 / SexyMUD ADR-0030）

- 适用集合：**有 id 的条目集合**（skills / items / enemies）。recipes/gearDrops/shop
  是无 id 关系行，没有继承锚点，不参与。
- `prototypeKey`：声明本条目可被同集合继承；**值必须等于自身 id**（同 id 空间，
  唯一性免费；语义检查 `prototype` 关键字）。
- `prototypeParent`：继承同集合内**已声明 prototypeKey** 的条目；父不存在、父未声明
  即大声失败。
- 环检测：validateContentPack 沿父链查环（门禁侧保险）；加载期展平时注册表侧
  再查一道（双保险，展平实现留待后续票）。
- 现阶段字段**只校验不改写**：包校验后数据保持原样，展平（剥 prototypeParent、
  保留 prototypeKey、合并后字典序）由后续票落地。
