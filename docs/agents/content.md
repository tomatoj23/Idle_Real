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
| `combatText` | 是 | combat-text.schema.json | CTEXT 战斗文案词库 |
| `shop` | 是 | shop.schema.json | 坊市货架（无 id 关系行） |
| `config` | **否** | config.schema.json | 全局配置；缺省=无槽位数据（引擎安全兜底） |

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

## config 槽位数据化（#16）

```json
"config": { "slots": [ { "id": "weapon", "name": "法器", "icon": "兵" } ] }
```

- 槽位 id 数据化，新槽 = 新 JSON（法宝/外袍留门）；`items[].slot` 引用槽位 id。
- `config` 为**可选节**：缺省时跳过槽位 xref 检查（既有包零破坏），引擎按无槽位兜底。
- 起步三槽：`weapon` 法器 / `body` 护体 / `accessory` 灵饰。
- 注意：武器招式注册（`combatText.moves` 键）目前锚定槽位 id `weapon`；
  若未来槽位改名/多武器槽，须同步放宽该锚定（#14 装备票消费时处理）。

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
