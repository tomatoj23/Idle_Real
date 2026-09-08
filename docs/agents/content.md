# Content 字段约定

content 包的字段级约定。**schema 变更三处同步纪律（ADR-015）**：任何字段变更须同步
`packages/content/src/schema/*.schema.json`、`packages/content/src/schema/types.ts`、
本文件，三者缺一即返工。**引擎消费点（contentView 的 View 类型、state.ts 规范化）
不在三处清单内，随消费票同步**（P2-2 教训：enemy schema 先行预留的 `affinities`
曾滞后于引擎投影，#15 票已补齐——新预留字段落地时同律）。

## 节清单

| 节 | 必填 | schema | 说明 |
|---|---|---|---|
| `version` | 是 | （pack.ts 语义关卡，无独立 schema 文件） | **包版本（#12）**：semver 三段（可带 prerelease/build 后缀），游戏内页脚版本行展示 + 发版追踪；改内容 = 改版本 |
| `skills` | 是 | skill.schema.json | 技艺定义（gather 带 activities） |
| `items` | 是 | item.schema.json | 物品，oneOf 五形态分流（见下） |
| `recipes` | 是 | recipe.schema.json | 配方（无 id 的关系行，不参与原型继承） |
| `enemies` | 是 | enemy.schema.json | 敌人 |
| `gearDrops` | 是 | gear-drop.schema.json | 异宝掉落表（无 id 关系行） |
| `elements` | 是 | element.schema.json | 系别键域注册表（#25 键域开放，ADR-017 裁决 8）：id+name，空数组=无系别玩法 |
| `rarities` | 是 | rarity.schema.json | 稀有度档位词表（#018，ADR-016 词表零默认） |
| `affixPool` | 是 | affix-pool.schema.json | 装备随机词条池（同上） |
| `combatText` | 是 | combat-text.schema.json | CTEXT 战斗文案词库（#019 批 2 扩十键：+句式模板/系统 note/战后摘要/对照语） |
| `texts` | 是 | texts.schema.json | 系统展示文案（#019 批 2）：兵刃兜底名 + reject 协议 code → 文案映射；#26 起含 `shell` 子节（壳层全部题材文案） |
| `shop` | 是 | shop.schema.json | 坊市货架（无 id 关系行） |
| `config` | **否** | config.schema.json | 全局配置：槽位（#16）+ 玩法参数四子节 combat/progression/affix（#020，缺省=引擎基线）+ crafting（#5） |
| `rebirth` | **否** | rebirth.schema.json | 转生系统（#6）：重置/保留清单 + 道韵公式 + 天赋树 + 解锁表 + 境界词表；省略 = 无转生玩法（引擎零降级路径，壳不渲染转生页签） |
| `dungeons` | **否** | dungeon.schema.json | 秘境分层爬塔（#7）：秘境定义 + 层表（敌人权重/层数倍率/层奖励/推荐战力软提示）+ 进入条件（道韵/钥匙）；省略 = 无秘境玩法（引擎零降级路径，壳不渲染秘境页签） |
| `bosses` | **否** | boss.schema.json | Boss 战阶段脚本（#8）：敌人条目 + 阶段数组（阈值/阶段名/属性修正/变招/叙事）+ 专属掉落表；省略 = 无 Boss 玩法（全部敌人按普通敌人战斗，零降级路径） |
| `achievements` | **否** | achievements.schema.json | 成就表（#9）：条件（阈值型/布尔型/反向阈值）+ 奖励（gold/daoYun/items）+ 隐藏；判定只读引擎统计 snapshot；省略 = 无成就玩法（壳不渲染成就页签） |

## items 五形态（#16 起 oneOf 分流，判别式 = `type`）

| type | 语义 | 分支必填 | 分支专有可选 |
|---|---|---|---|
| `mat` | 材料 | 公共字段（id/name/icon/type/sell） | — |
| `consumable` | 消耗品（丹药等） | 公共字段 | effect、heal（至少其一，语义检查） |
| `equip` | 装备 | 公共字段 | slot、bonuses（须都有，语义检查）、verbStyle（#021 批 4） |
| `blank` | **器胚**（装备底材模板） | 公共字段 + slot + floorRange + tierRange | preferredTags、inherentModifiers、element（#15） |
| `inscription` | **铭纹**（装备词缀模板） | 公共字段 + tiers | feature、tags |

- 跨形态字段由 oneOf 分支 `additionalProperties:false` 在 schema 关卡拒绝；
  分支内规则（equip 缺 bonuses、consumable 无 effect/heal、区间方向、修饰符区约束）
  由 `validateContentPack` 语义检查补全（ADR-010 分工）。
- **`element`（#15，equip/blank 分支可选）**：系别键，须在 elements 节注册（xref）。
  引擎只消费**武器槽**物品的 element——佩戴后玩家攻击携带该系（机制签名/亲和度/
  风味句路由的攻方来源）；其余槽位为未来留门，不配系（见下「系别机制签名」）。
- **空集合合法**：`preferredTags: []`、`inherentModifiers: []`、`tags: []` 均合法；
  `items: []` 仍被拒（#2 定下的节下限不放宽，每包至少一个物品）。
- 器胚/铭纹机制消费方已随 **#14 落地**（rollGear 掉落管线 + 熔炼/重铸）：
  题材包可以（修仙包已）配器胚/铭纹内容；模板类（blank/inscription）**禁入袋流**
  （activity 产出/副产出、配方产出与材料、敌人掉落、货架、成就奖励引用即 xref 拒绝
  ——两类是实例化模板，进袋只会成不可见死物并可按 sell 套利）。

### 器胚字段（CONTEXT.md 词汇：器胚/胚纹/纹阶；#14 机制落地）

| 字段 | 形态 | 约定 |
|---|---|---|
| `slot` | string | 槽位 id，须在 config.slots 有定义（xref）；weapon 槽器胚与 equip 武器同律（佩戴后承担武器语义，须在 combatText.moves 注册招式名） |
| `floorRange` | `{min,max}` | 掉落层数段（秘境层数，1 起）：掉落管线 ②按当前层筛选器胚池，同池跨层段即分层掉胚（E5/E6 混池样例）；否决 itemLevel 缩放 |
| `tierRange` | `{min,max}` | 纹阶天花板区间 T1~T3：实例化掷阶与重铸铭纹都不得突破 |
| `preferredTags` | string[] | 偏好标签：铭纹抽取权重 = 基础 × (1+匹配数×`config.gear.tagWeightPerMatch`) |
| `inherentModifiers` | Modifier[] | **胚纹**：固有词条，固定非随机，投影时直接入聚合管线（不进实例存档——可由 itemId 随时从内容读出） |

### 铭文字段（CONTEXT.md 词汇：铭纹/纹阶；#14 机制落地）

| 字段 | 形态 | 约定 |
|---|---|---|
| `tiers` | `[Modifier[], Modifier[], Modifier[]]` | 三阶数值表，下标 0/1/2 = 纹阶 T1/T2/T3，定长 3；实例只存 `{id, tier}`，数值投影时按 tiers[tier] 从内容读 |
| `feature` | `{primitive, condition?, value?}` | 机制型特色铭纹：condition+primitive 表达，引擎原语池零新增（未注册原语忽略，tiers 数值表照常生效） |
| `tags` | string[] | 标签加权抽取归类（tags/flags 分工：归类批量捞，裸布尔走 flags）；引擎 `buildTagIndex` 倒排索引消费 |

### Modifier（修饰符，#13 聚合管线已消费）

```json
{ "stat": "atk", "zone": "flat", "value": 5, "condition": { "element": "fire" } }
```

- `zone`: `flat` → `addPct` → `mult` 三区按序结算（ADR-011），禁绕管直改。
- `value`: 乘法区须 > 0；加法%区 ≥ −100（语义检查）。flat/addPct 可为负。
- `condition`: `{element?, moveId?}` 至少一维（minProperties），命中才生效；
  `element` 键域开放（#25）：须在包 elements 节注册（语义校验 xref）。

**引擎聚合公式（#13 定版）**：`value = (base + Σflat) × (1 + ΣaddPct/100) × Πmult`，
负值钳到 0；倍率类属性（gatherXp 等以 1 为基线）基线由消费方给定，百分点型
增量（暴击率 +25）走 flat。引擎侧 `packages/engine/src/modifiers.ts` 提供
`aggregateStat/aggregateStats/conditionMatches`；每条贡献自带来源语境
`source{id,kind,uid?,name?}`，聚合快照 breakdown.applied 保留命中明细——
事件流消费属性效果时第一天就携带完整语境（SexyMUD ADR-0006 教训）。
引擎接缝：`playerMaxHp(content, skills, contributions?, context?)` 已走管线；
静态全局产出方（宗门加成等）经 `createGame({contributions})` 注入；
转生天赋（#6）为状态派生产出方，引擎内部经 `talentContributionsOf` 从
`state.talents` 投影（单一来源，引擎与壳/测试共用）；装备/丹药 buff（#4）
在引擎内部从状态派生 Contribution，禁止另开直算路径。

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
| `smelt` | integer（≥ 0，可选，#14） | 熔炼产出：熔炼该档装备所得器屑数量；缺省 = 引擎基线 1（config.gear.shardItem 未配置时无意义） |
| `showcase` | bool（可选） | **UI 特判开关（裁决 ④）**：true 时 UI 作「天降异宝」级特判；UI 不再用 id 字面量（如 `'epic'`）特判 |

数组顺序即档位顺序：缺档回退取**第一项**；旧档位从词表移除后，存量存档的该档
装备恢复时自动回退第一档（存档不炸，数值按第一档重投影）。

### affixPool（随机词条池）

| 字段 | 形态 | 约定 |
|---|---|---|
| `name` | string（1~6 字） | 词条名，随词条值展示 |
| `stat` | string（`^[a-z][a-zA-Z0-9_]*$`） | **stat id，键域开放（#021 批 4）**：与装备 `bonuses` 键域同源，schema 只钉键形态；hp/crit 参与词条标尺折算（hp÷hpDivider / crit×critScale），其余 stat 原值参与；生效须引擎消费点（见下「stat 消费点注册表」）。UI 展示缺键回退 stat id |
| `scale` | number（> 0） | 量级系数：词条值 = max(1, round(基础标尺 × scale × 随机波动))；波动幅度与标尺折算系数（hp÷5/crit×0.8/兜底 3）已随 #020 config 化（`config.affix` 子节） |

实例化按稀有度 `affix` 数量掷**不重复 stat** 词条；同 stat 多条目合法（掷点去重
发生在运行时）。

### stat 消费点注册表（#021 批 4 单一来源裁决，N3/N4 收口）

**键域 = 引擎消费点清单**。装备 `bonuses`、消耗品 `multipliers`、词条池
`affixPool.stat` 三处键域已全部开放为 stat id（schema patternProperties，键形态
`^[a-z][a-zA-Z0-9_]*$`：小写字母开头，允许驼峰/下划线——`gatherXp` 先例，旧
`[a-z0-9_]` 形态会误拒驼峰键），写入零改动；**stat 生效必须有引擎消费点**：

| stat | 消费点 | 说明 |
|---|---|---|
| `atk` / `def` | engine `game.ts` statBase → playerStats | 战斗面板攻/防 |
| `hp` | 同上（气血曲线基线上叠加） | 词条标尺按 hp÷hpDivider 折算 |
| `crit` | 同上（钳 `config.combat.critCap`） | 百分点；标尺按 crit×critScale 折算 |
| `gatherXp` | engine `game.ts` completeActivityOnce / settleOffline（倍率基线 1） | 采集修为加成（离线/在线同式） |
| `gatherSpeed` | engine `game.ts` settleActivity / settleOffline + snapshot `activityInterval`（#6） | 采集轮间隔缩放：有效间隔 = 基础间隔 ÷ 速度（`effectiveIntervalOf` 单一来源）；速度 ≤ 0 = 采集冻结 |
| `xpMult` | engine `game.ts` grantExp（#6，倍率基线 1） | 全经验倍率：采集/炼制/斗法/离线同路单点，与 gatherXp 叠乘 |
| `offlineCap` | engine `game.ts` settleOffline（#6，flat 毫秒累计） | 离线结算时长上限：Σ ≤ 0 = 不设限，超限部分不入账 |

- 全新 stat（如"幸运"）：bonuses/multipliers/affixPool **纯 JSON 写入即被投影**
  （引擎零拦截，词条可掷、贡献入管线），但**面板生效须引擎新增消费点**（改码）
  并在本表登记——这是固有约束：无消费点的属性是死数据。
- `bonuses` 与 Modifier 的形状统一决策（审计 §七 #14 前置②）：bonuses 是装备
  模板的 **flat 简写**（省 zone/condition，投影时折算稀有度倍率后走 ADR-011
  单管线），键域与 `Modifier.stat` 同一注册表；不改为 Modifier[] 数组（避免
  无谓的内容格式迁移）。
- UI `STAT_LABEL` 缺键回退 stat id（键域开放的可接受降级）。

### 引擎判例（round3 A1；加权位已随 #5 落地）

`rollRarity`（权重掷点机制）与 `makeGear`（词条实例化管线）归引擎，接收内容表
为参数位；权重表/概率/档名/卖价系数/量级系数归 content。"炼器等级抬稀有度"的
外部加权输入位已随 #5 接入 `rollRarity(content, random, bias?)`：bias 正值上移
掷点 → 档位表数组序后段（高档位）实际占比单调上升；系数归
`config.crafting.rarityBiasPerLevel`（引擎基线 0.0004），craft 循环传
`技艺层 × 系数`，#14 掉落管线复用同签名、不传（=0）时与旧签名逐点同分布。

## combatText 扩节与 texts 系统文案（#019 批 2，ADR-016 裁决 ④）

**文案零引擎硬编码**：战斗叙事/系统提示改文案 = 纯 JSON 改动。引擎对缺失内容
一律非文案占位降级（键名回显或空串跳过；如招式名兜底回显注册键、模板缺失
退化为伤害数字），防御路径保留但不再内置中文兜底句。

### 动词池与动词风格开放键域（#021 批 4，ADR-016 裁决 ⑦）

- `combatText.verbs`：键域开放——**新增动词风格 = 新 JSON 键**（如 `staff`）；
  schema 仅强制引擎兜底键 `basic` 恒需（required + minItems），其余键在被引用时
  由语义校验强制存在。sword/basic/claw/magic 只是官方包约定。
- 动词风格声明（P1-2 玩家映射解绑）：
  - **玩家** = 佩戴武器（weapon 槽 equip）的 `verbStyle` 字段（开放键域，validate
    强制 verbs 池存在）；缺声明/非法回落引擎兜底键 `basic` 池。引擎内嵌的
    引擎内嵌的硬编码动词映射已清退——"法杖走 magic 池" = 纯 JSON 改动。
    官方包全部武器显式声明 `"verbStyle": "sword"`。
  - **敌人** = `kind` 字段（开放键域，validate 强制 verbs 池存在）；引擎不再内嵌
    缺省 'claw'（防御路径回落 basic 池）。'claw'/'magic' 是官方包约定而非引擎词汇。
  - 槽位 role 推断（有武器→读槽位 role）已随 #14 落地：`weaponSlotOf`
    先查 role === 'weapon'，未声明按槽位 id 兜底。
- 键形态：`^[a-z][a-zA-Z0-9_]*$`（与 stat 键形态统一）。

### combatText 扩节（六键 → 十键，schema required）

| 键 | 形状 | 说明 |
|---|---|---|
| `templates` | 五池：playerLight/playerHeavy/playerCrit/enemyLight/enemyHeavy | 出招句式模板。槽位：`{move}` 招式名、`{weapon}` 兵刃名、`{verb}` 动词、`{defender}` 受击妖名、`{enemy}` 妖名、`{limb}` 部位、`{opening}` 起势（heavy 池）、`{critIntro}` 暴击起势（crit 池）。schema pattern 强制必要槽位 |
| `notes` | 七池：retreat/retreatToGather/retreatWounded/retreatVictory/reengage/start/autoConsume | 系统 combat-note 叙事。start/reengage 带 `{enemy}`、autoConsume 带 `{item}` |
| `summary` | tiers（四档画句池）+ base/crit 整行模板 | 战后一行签名画像：引擎按主导伤害档取画句填 `{flavor}`，`{rounds}`/`{crits}` 填数值 |
| `compare` | 四池：revenge/faster/slower/even | 同对手再战对照语：`{rounds}` 今番、`{prev}` 前番回合数；无从对照返回空（事件不带 compare） |
| `elementFlavor`（#15，可选节） | 键 = elements 注册系别（xref）→ 四池：attacks/crits/counters/resists | 系别风味句池（只读日志盲测的文案载体，ADR-012）。引擎按「被克 resists（受击者亲和 < 0）/ 克制 counters（亲和 > 0）> 暴击专属 crits（雷·霆爆金框文案）> 普通 attacks」路由，抽一条**追加为独立句**；槽位 `{defender}`/`{enemy}`/`{d}`（敌方出招侧 {defender} 指向敌人自身，宜用无主语句式）；全缺省句不造（裁决 ④）。缺节 = 该包无系别风味（战斗文案零扰动） |

### texts（系统展示文案 + 壳层文案）

| 字段 | 形状 | 说明 |
|---|---|---|
| `basicName` | string（1~18 字，#027 按 CJK 密度假设放宽） | 无佩戴武器时的兵刃展示名（weaponName 槽兜底值） |
| `reject` | 动作协议键 → 理由 code → 文案模板 | 展示文案映射。动作键域 schema 钉死：activity:start / bag:sell / shop:buy / combat:start / consumable:eat / dungeon:enter（#7）/ gear:equip / gear:sell / rebirth:perform / talent:buy（#6）/ `'*'`（跨动作兜底，bad-payload 等通用文案）；理由 code 键域开放 |
| `reject` 槽位 | `{level}` `{activity}` `{item}` `{owned}` `{cost}` `{gold}` `{daoYun}` `{need}` `{xp}` | 由引擎按协议语境填入； combat:start 的 `{level}` = `enemy.level − 门控偏移`（偏移量只在引擎判定处单一来源，文案侧零副本——N1 文案侧裁决）；rebirth:perform 的 no-progress 带 `{need}/{xp}`、rebirth-locked 与 talent:buy 的 no-daoyun 带 `{daoYun}`/`{cost}`；dungeon:enter 的 locked 带 `{daoYun}`、no-key 带 `{item}`（#7） |
| `shell`（#26） | ShellTexts 结构化节 | **壳层全部题材文案**（ADR-017 裁决 9：壳零题材字符串）：brand（sigil/name/locale/bootError）、topbar、tabs、side、stats.labels、units、icons、common、events（40 键，#9 起含 achievementToast/achievementLog）、pages（skills/craft/combat/dungeon/bag/shop/rebirth/talents/achievements，#9 起九页）。schema required + additionalProperties:false 全程钉死 |

- 命中序：精确动作 → `'*'` → **键名回显**（`{action}/{reason}`，防御可见）。
- 协议 code 本体归引擎，本节只承载展示文案；code 未命中/缺节绝不崩，toast
  退化为协议键名。

### texts.shell（壳层文案，#26）

- **模板约定**：与 texts.reject / combatText 模板同一 `{slot}` 语法，壳用引擎
  `fillTemplate` 填槽；缺键回显键名（裁决 ④ 同策略，诊断可见）。
- **stat 展示标签**（`shell.stats.labels`）：键 = stat id（开放键域，与
  bonuses/affixPool.stat 同一注册表，键形态 `^[a-z][a-zA-Z0-9_]*$`）；
  未注册 stat 由壳回退 stat 键名展示。
- **量纲标记**（#26 票评，循 ADR-016 裁决 ④ 显式 bool 先例）：
  `shell.stats.labels.<stat>.percent = true` 表示百分比量纲（展示值后缀 `%`）；
  缺省 = 点数量纲。壳零量纲特判——`crit` 等是否带 `%` 由内容数据决定。
- **brand.locale**：数字千分位格式化与文档 lang 的单一来源（`^[a-z]{2}(-[A-Z]{2})?$`）。
- **brand.bootError**：启动失败兜底页模板，槽位 `{message}`；壳在内容包可用时
  读取，内容包缺失时降级键名回显。
- 键分组语义：`events.*` 键 = 引擎事件类型协议面（loot/victory/defeat/
  consumable:eat/equip:wear/levelup/sell/buy/reject/offline-settled；
  #5 起含 craft-fail/craft-halt 的 craftFail/craftHalt 与 loot source=craft
  的 lootCraft；#6 起含 rebirth 事件的 rebirthToast/rebirthLog 与
  talent:buy 事件的 talentBuyToast/talentBuyLog；#7 起含 dungeon:enter/floor/
  clear/leave 事件的 dungeonEnter/dungeonFloor/dungeonDaoYun/dungeonClear/
  dungeonLeave）；
  `pages.*` 键 = 壳 TabId 协议面（skills/craft/combat/dungeon/bag/shop/rebirth/
  talents/achievements，#5 起五页、#6 起七页、#7 起八页、#9 起九页）；
  `units.*` 承载层级/时长读数的单位模板（`{v}` 数值、`{m}` 分、`{h}` 时）；
  `topbar.*Sigil` 承载顶栏资源图章字；`common.itemListSep` 为物品名列表
  分隔符（掉落预览/离线产出共用）；`pages.combat.selfStats` 的属性行数值
  槽（{atk}/{def}/{crit}）由壳按 statLabels 量纲填入，模板不写字面 `%`。
- **footer.versionLine（#12）**：页脚版本行模板，槽位 `{name}`（brand.name）、
  `{content}`（包顶层 `version`）、`{engine}`（引擎 `ENGINE_VERSION`，
  `packages/engine/src/version.ts`，与 engine package.json version 由测试钉住一致）。
  发版流程：改包 version → 页脚玩家可见 → `npm run dist` 重打包。

## config 槽位数据化（#16）与玩法参数数据化（#020）

```json
"config": {
  "slots": [ { "id": "weapon", "name": "法器", "icon": "兵" } ],
  "combat": { "playerAttackInterval": 2200, "levelGateOffset": 2, "...": "…" },
  "progression": { "maxLevel": 99, "xpPowCoef": 10, "...": "…" },
  "affix": { "hpDivider": 5, "variance": 0.2 },
  "crafting": { "successPerLevel": 0.004, "failExpRefund": 0.25 }
}
```

- 槽位 id 数据化，新槽 = 新 JSON（法宝/外袍留门）；`items[].slot` 引用槽位 id。
- `config` 为**可选节**：缺省时跳过槽位 xref 检查（既有包零破坏），引擎按无槽位兜底。
  `progression.maxLevel` 存在时同时作为敌人层数上限的**单一来源**（#021 批 4：
  enemy.schema 魔法数 99 已清退，语义校验对照该值；config 缺省时无从取得，跳过对照）。
- 起步三槽：`weapon` 法器 / `body` 护体 / `accessory` 灵饰。
- **SlotDef.role 已随 #14 落地**（可选，开放键域）：引擎武器槽解析走
  `weaponSlotOf`（先查 role === 'weapon' 的槽位，未声明 role 的包按槽位 id
  `weapon` 兜底识别）——自定义武器槽改名 = 纯 JSON 改动，'weapon' 键不再是
  引擎硬编码；招式注册键域随之放行 weapon 槽的 equip/器胚武器 id。

### config.gear 装备构筑循环参数（#14）

```json
"gear": { "shardItem": "gear_shard", "reforgeCost": 3, "tagWeightPerMatch": 1 }
```

- `shardItem`：器屑物品 id（**语义校验 xref items 且须为 mat 类**）；缺省 =
  无器屑经济——引擎 `gear:smelt`/`gear:reforge` 拒绝 not-available（零降级路径）。
- `reforgeCost`：单条铭纹重铸消耗（器屑数量），引擎基线 1。
- `tagWeightPerMatch`：标签加权系数（权重 = 基础 × (1+匹配数×该值)），引擎基线 1。
- 熔炼产出按稀有度：`rarities[].smelt`（整数 ≥ 0，缺省基线 1）——器屑经济
  的档位梯度归词表。

### 掉落管线与实例形状（#14 机制定版）

- **rollGear 八步管线**（engine gear.ts 单一来源）：①掉不掉（chance）→
  ②按秘境层数筛器胚池（equip 条目不受层筛，兼容旧池）→ ③均匀选底材 →
  ④掷稀有度（掉落侧不传 bias，与旧签名逐点同分布，#5 接缝）→ ⑤按稀有度
  affix 数定铭纹条数 → ⑥标签加权抽铭纹（倒排索引查 preferredTags ∩ tags
  交集；同实例不重复铭纹 id）→ ⑦按器胚 tierRange 掷纹阶 → ⑧胚纹随投影附加。
  口诀：**稀有度是因（词条数），纹阶是果（质量）**。
- **实例形状**：`GearInstance` 增可选 `inscriptions: [{id, tier}]`（器胚实例
  专用；空/缺省不落盘，ADR-013）。数值/胚纹不进实例——展示与投影按内容表
  读（改 tiers 表 = 改全部同纹阶实例）。旧存档不迁移（ADR-008）。
- **熔炼** `gear:smelt {uid}`：囊中装备 → 器屑 ×`rarities[].smelt`；
  **重铸** `gear:reforge {uid, index}`：耗 `reforgeCost` 器屑，重随该铭纹纹阶
  （tierRange 天花板数据锁死）。佩戴中一律拒绝（reason `worn`，与卖出同律）。
  reject 动作键 `gear:smelt`/`gear:reforge` 已入 texts.schema pattern；壳文案
  `events.gearSmelt`（`{name}/{shard}/{count}`）与 `events.gearReforge`
  （`{name}/{tier}`）+ `pages.bag.smeltBtn/reforgeBtn/inscTier/inscCondition`。

### 玩法参数三子节（#020 批 3，ADR-016 裁决 ① 分策）

**缺省策略 = 引擎基线 + config 覆盖**：三个子节与其字段全部可选，缺省字段逐项回落
引擎基线（基线即旧版 data.js 数值）；非法值（类型错/NaN）在引擎侧逐字段回落基线，
数值**边界**（min/max/互斥）由 schema 与包校验关卡拒绝（ADR-010 分工：schema 管边界、
引擎管形状防御），引擎使用点仅对除零类参数防崩（如 affix.hpDivider ≤ 0 回落基线）——
改战斗/成长/词条参数 = 纯 JSON 改动，引擎零改动。
修仙包**显式写出全部基线值**（数值回归内容文件，作参数调档的起点）。

| 子节 | 字段域 | 引擎基线 |
|---|---|---|
| `combat` | playerAttackInterval / defenseK / damageVariance / critMultiplier / critCap / criticalHpFraction / lowHpFraction / autoEatHpFraction / victoryRestMs / levelGateOffset / tierLightMax / tierMidMax / tierHeavyMax / statAtkBase / statAtkPerLevel / statDefBase / statDefPerLevel / statCritBase / autoFight / autoEat | 2200ms / 120 / ±10% / ×1.6 / 75 / 15% / 30% / 50% / 1500ms / +2 / 0.95·1.05·1.5 / 攻 8+3·层 / 防 2+1.2·层 / 暴 5 / true / true |
| `progression` | maxLevel / xpPowCoef / xpExponent / xpLinearCoef / hpBase / hpPerLevel / hpRegenPerSec | 99 / 10 / 1.8 / 15（升层需 floor(10·L^1.8+15·L)）/ 100 / 12（气血 100+12·层）/ 4%/s |
| `affix` | hpDivider / critScale / baseScaleFloor / variance | 5 / 0.8 / 3（基础标尺 = max(攻防原值, hp÷5, crit×0.8, 3)）/ ±20% |
| `crafting`（#5） | successPerLevel / successCap / failExpRefund / rarityBiasPerLevel | +0.004/层 / 0.99 / 25% / 0.0004/层 |

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

### 炼制参数 crafting 子节（#5）

旧版 craft 参数位（#5 票评 round3 A4 清单）全部 config 化（ADR-016 裁决 ① 分策），
非法值逐字段回落引擎基线；per-recipe 差异（基础成功率/耗时/产出/修为）归
`recipes[]` 本体。

| 字段 | 约定 |
|---|---|
| `successPerLevel` | 成功率层加成：每层技艺 +该值，炼丹/炼器通用 |
| `successCap` | 成功率上限：层级加成抬升的天花板。公式 = min(cap, base + perLevel×层) 但**不低于 base**——否则 `successRate: 1` 的「炼器必得」被 0.99 击穿（票评裁决点：必得由内容表达，引擎只保证上限只作用于抬升段） |
| `failExpRefund` | 失败修为返还比例：失败仍得 round(配方修为 × 该值)，**材料全损**（旧版 js/game.js:412 语义：返还的是修为非材料） |
| `rarityBiasPerLevel` | 装备产出稀有度偏置：掷档点数上移 `技艺层 × 该值`（高档位占比单调上升；见上「引擎判例」） |

- 配方执行单一来源：引擎 `craftSuccessRateOf`（掷点与 UI 展示同调）、
  `craftMissingOf`（停炉判定与 UI 材料着色同调）；壳禁另写公式。
- 开炉门控（旧版 startCraft 语义）：`activity:start` 对 craft 类技能按
  `unlockLevel` 层数门控 + 开炉前验料（不足 reject `no-materials`，文案挂
  `texts.reject['activity:start']`）；炉内材料耗尽 → 自动停炉（活动清空 +
  `craft-halt` 事件，旧版踩坑回归）。
- 离线补偿 O(1) 统计式：成功数 = floor(轮数 × 成功率) + 余数无偏掷定
  （副产出同式先例）；材料按完整轮数扣减、只够部分轮数即停炉；装备产出
  逐件掷定（离散唯一实体，有界）。

## rebirth 转生节（#6：兵解重修 / 道韵 / 天赋树）

**可选节**：省略 = 该题材无转生玩法（引擎一切消费点零降级路径，壳不渲染转生/道韵页签）。

```json
"rebirth": {
  "reset": ["skills", "items", "gold", "buffs", "lastEncounter"],
  "keep": ["gear"],
  "formula": { "base": 0, "coef": 0.0002, "exp": 1, "minProgress": 5000 },
  "talents": [ { "id": "t_x", "name": "…", "cost": 2, "requires": [], "effects": [Modifier] } ],
  "unlocks": [ { "requires": { "daoYun": 10 }, "enemies": ["e8"] } ],
  "realms": [ { "level": 1, "name": "练气期" } ]
}
```

### 重置/保留清单（引擎注册表闭集）

| 清单 | 键域（闭集） | 引擎语义 |
|---|---|---|
| `reset` | `skills` / `items` / `gold` / `buffs` / `lastEncounter` | 兵解时逐键清零（键域合法性由语义校验对照注册表收口，schema 只钉字符串形态——#021/#25 先例） |
| `keep` | `gear` | 装备实例仓库保留（佩戴表 `equips` 与 uid 序列器 `gearSeq` 语义随动） |

- 两集必须互斥（同一资产不能既重置又保留，语义校验 shape）；
- **未登记的资产键 default-keep**（兵解不吞资产，未来新键安全）；
- 瞬态（活动/战斗/气血）由引擎一律清空回满，不进清单；
- 道韵入账：`state.daoYun`（余额，天赋购买消耗）+ `state.daoYunEarned`
  （累计，只增不减）+ `state.rebirths`（次数）+ `state.talents`（节点 id 稳定引用，ADR-015）。

### 道韵公式（形状归引擎机制，系数归 content）

`入账 = floor(base + coef × 总修为^exp)`，总修为 = 全技艺当前累计修为之和；
兵解门槛 = 总修为 ≥ `minProgress`。缺省字段逐项回落引擎基线
`BASE_REBIRTH_FORMULA`（0 / 0.0002 / 1 / 5000，#020 同款分策）。
确认页预览与 `rebirth:perform` 判定同调引擎 `rebirthPreviewOf`，壳禁另写公式。

### 天赋树（数据 100% 来自 content）

- 节点：`id`（存档键，发布后不可变）/ `name` / `icon?` / `description?` /
  `cost`（道韵余额，≥1）/ `requires?`（前置节点 id，语义校验 xref + DFS 查环，
  菱形依赖合法）/ `effects?`（Modifier[]，点亮后常驻）；
- 效果走 ADR-011 聚合管线（来源 `kind: 'talent'`），**生效须引擎消费点**
  （上方 stat 消费点注册表；无消费点的效果是死数据）；
- 换包可换整棵树：树形状/名称/消耗/效果全部随包（修仙包与魔幻包两棵树互异为样张）。

### 解锁表（道韵门槛 → 新内容）

- 门槛按**累计道韵** `daoYunEarned` 判定（只增不减——花掉的道韵不回锁）；
- 目标：`enemies`（开战门控）/ `skills`（activity:start 门控），语义校验 xref，
  同目标重复登记拒绝；引擎 `rebirthGateOf` 是锁定判定与展示的单一来源（N1 同款收敛）；
- reject 协议 code：`rebirth-locked`（文案槽 `{daoYun}`）。

### 境界词表（B2 功能缺口收编）

`realms` 按斗法层数映射称号，引擎 `realmOf` 取 `level ≤ clv` 的最后一档
（无命中回退第一档）；缺词表 = 壳不显示境界（词表零默认，ADR-016 延伸）。
修仙包八档收编自旧版 `js/data.js` REALMS（数值沿革对照见审计 round3 B2）。

### 引擎事件与协议

- 事件：`rebirth`（`{daoYun, totalXp, rebirths}`）、`talent:buy`
  （`{nodeId, name, cost, daoYun}`）；
- 动作：`rebirth:perform`（reject：not-available / in-combat / no-progress）、
  `talent:buy`（reject：not-available / not-found / prereq / no-daoyun，已点亮幂等）；
- snapshot 展示投影：`stats`（含天赋贡献）+ `activityInterval`（有效采集轮间隔，
  gatherSpeed 消费点的壳面投影，恢复侧忽略）。

## dungeons 秘境节（#7：分层爬塔 / 层序列战斗）

**可选节**：省略 = 该题材无秘境玩法（引擎一切消费点零降级路径，壳不渲染秘境页签）。

```json
"dungeons": [
  {
    "id": "yaoku", "name": "妖窟秘境", "icon": "窟",
    "floors": 10,
    "entry": { "daoYun": 10 },
    "layers": [
      {
        "floor": { "min": 1, "max": 3 },
        "enemies": [ { "enemy": "e1", "weight": 6 }, { "enemy": "e2", "weight": 3 } ],
        "mult": { "hp": 1.2, "atk": 1.1, "gold": 1.2 },
        "rewards": { "gold": 20 },
        "recommendedPower": { "min": 20, "max": 45 }
      }
    ]
  }
]
```

### 归属划界（ADR-017：机制归引擎，参数归 content）

| 归 content | 归引擎 |
|---|---|
| 秘境定义（floors/entry/layers）、敌人权重、层数倍率、层奖励（gold/daoYun/items）、推荐战力区间（软提示） | 层序列战斗（胜利推进/败退离境）、层表解析、层敌人加权抽取、层倍率投影、进入门控判定、最高层记录 |

### 字段约定

| 字段 | 形态 | 约定 |
|---|---|---|
| `id` | string（`^[a-z][a-z0-9_]*$`） | 秘境 id，**发布后不可变**：`state.dungeonBest` 存档键（最高层记录）+ 攻略稳定引用；id 去重（语义检查） |
| `name` / `icon` | string（≤12 / ≤2 字） | 展示名与图章字（壳/编辑器消费，引擎零感知） |
| `floors` | integer（≥ 1） | 总层数 = 攻略生命周期；层表须**无缝覆盖 1..floors**（缺口 = 攻略中断点、重叠 = 同层双行歧义，语义校验皆拒绝——区间算术，无逐层步进） |
| `entry` | `{daoYun?, key?}`（皆可选） | 进入条件：`daoYun` 按**累计道韵**判定（花掉不回锁，与 rebirth 解锁表同律）；`key` = 钥匙道具 id（须持有 ≥1，**不消耗**），xref items。判定单一来源 = 引擎 `dungeonGateOf`（与壳锁定态同调，N1 同款收敛） |
| `layers[].floor` | `{min,max}` | 层数段（含端点，min ≥ 1；超 floors 拒绝） |
| `layers[].enemies` | `{enemy, weight}[]` | 层敌人权重池：按占比归一化加权抽取（注入 RNG，ADR-013）；enemy xref enemies；weight > 0（schema 关卡） |
| `layers[].mult` | `{hp?,atk?,def?,gold?,exp?}` | 层数倍率：相对敌人定义值缩放，引擎投影 round 取整（hp/atk 下限 1）；缺省字段 = 原值。投影单一来源 = 引擎 `dungeonFloorEnemyOf`（战斗结算与壳展示同调，禁壳内复制缩放式） |
| `layers[].rewards` | `{gold?, daoYun?, items?}` | 层奖励：通关该层时入账，**每轮推塔重复可得**（挂机长线消耗方）；`daoYun` 入账走余额 + 累计双键（与 rebirth 同律——深层秘境供养兵解，票面联动点）；items xref items |
| `layers[].recommendedPower` | `{min,max}` | **推荐战力区间（软提示字段，第一天预留）**：引擎不消费、不门控；UI 与玩家战力读数（引擎 `powerOf` = atk+def+maxHp/10+crit，单一来源）同量纲对照展示；方向性 min ≤ max（语义校验） |

### 引擎事件与协议

- 事件：`dungeon:enter`（`{dungeonId, dungeonName, floor, floors}`）、`dungeon:floor`
  （`{dungeonId, dungeonName, floor, floors, gold, daoYun, items}`，层奖励入账承载体）、
  `dungeon:clear`（`{dungeonId, dungeonName, floors}`）、`dungeon:leave`
  （`{dungeonId, dungeonName, floor, best}`）；
- 动作：`dungeon:enter`（reject：not-found / in-dungeon / in-combat / locked `{daoYun}` /
  no-key `{item}` / low-hp / no-layer）、`dungeon:leave`（幂等，未在秘境静默）；
- **层序列与既有战斗机制复用同一状态机**：胜利休整到期自动进层（与 autoFight 开关
  无关，爬塔即挂机）；残血退避同律（hp < lowHpFraction×cap → 离境保留最高层）；
  落败即离境；斗法页开野战 / 兵解在攻略战斗中一律拒绝（in-dungeon / in-combat）；
- **离线不可续跑**：`settleOffline` 就地离境（最高层已随进层登记，欠账不丢）；
- 瞬态/资产分界：进行中攻略（`state.dungeon`）为瞬态（恢复需战斗在身，战斗散 =
  攻略作废）；最高层记录（`state.dungeonBest`）为记录资产——兵解 default-keep 长存。

## bosses Boss 节（#8：阶段脚本）

**可选节**：省略 = 该包无 Boss 玩法（全部敌人按普通敌人战斗，引擎/壳零降级路径）。

```json
"bosses": [
  {
    "enemy": "e8",
    "drops": [ { "item": "core3", "chance": 1 } ],
    "phases": [
      {
        "threshold": 0.6, "name": "血目暴睁",
        "mods": { "atk": 1.3, "attackInterval": 0.85 },
        "narration": [ "饕餮血目暴睁，凶性大发！" ]
      },
      { "threshold": 0.35, "name": "吞天之相", "mods": { "atk": 1.6 }, "moveKey": "e8_devour", "narration": ["…"] },
      { "threshold": 0.15, "name": "饕餮真身", "mods": { "atk": 2, "attackInterval": 0.6 }, "narration": ["…"] }
    ]
  }
]
```

### 归属划界与机制语义

| 归 content | 归引擎 |
|---|---|
| 阶段数组（阈值/阶段名/属性修正/变招 moveKey/叙事池）、专属掉落表 | 阈值判定与阶段推进（跳级逐级补发事件/叙事）、阶段属性修正投影、bossPhase 随战斗态持久（自动再战重置归位） |

### 字段约定

| 字段 | 形态 | 约定 |
|---|---|---|
| `enemy` | string（`^[a-z][a-z0-9_]*$`） | Boss 敌人 id（xref enemies）；**每敌人至多一条 Boss 定义**（去重，战斗引用无歧义） |
| `phases[].threshold` | number（0 < t < 1） | 血量比例阈值（≤ 即进入该阶段）；全数组**严格递减**（递进顺序，语义校验 shape） |
| `phases[].name` | string（1~12 字） | 阶段名（boss:phase 事件载荷 / 壳徽标展示，content 数据直出） |
| `phases[].mods` | `{atk?, def?, attackInterval?}`（乘区 > 0） | 阶段属性修正；键域 schema 钉死（additionalProperties）——阶段是战斗过程修正，**hp/gold/exp 不随阶段投影**（阈值分母恒定的前提） |
| `phases[].moveKey` | string（`^[a-z][a-z0-9_]*$`，可选） | 变招：该阶段敌方出招名注册键（xref combatText.moves + 招式注册表随之放行）；未声明回退敌人 id 键 |
| `phases[].narration` | string[]（1~80 字/条，可选） | 阶段转场叙事池（{enemy}/{phase} 槽）：per-boss-per-phase 脚本数据归 bosses 节本地（talents.description 先例），不进 combatText 共享词库 |
| `drops[]` | `{item, chance}`（可选） | 专属掉落表：victory 与 enemy.drops 同机制叠加掷点（items xref） |

- **阈值语义**：敌人血量比例 ≤ `threshold` 进入该阶段；全数组须**严格递减**
  （递进顺序，语义校验 shape）；单击跨多阈值逐级补发（每级一次
  `boss:phase` 事件 + 叙事 combat-note，`{enemy}/{phase}` 槽）。
- **阶段修正**：`mods` 乘区键钉 `atk/def/attackInterval`（schema
  additionalProperties 钉死——阶段是战斗过程修正，hp/gold/exp 不随阶段
  投影）；投影单一来源 = 引擎 `bossEnemyOf`（与战斗结算、壳生效视图同调，
  禁壳内复制缩放式）。
- **变招**：`moveKey` 覆盖该阶段敌方出招名注册键（须在 combatText.moves
  注册，xref + 招式注册表随之放行该键；未声明回退敌人 id 键）。
- **专属掉落**：`drops` 与 `enemy.drops` 同机制在 victory 叠加掷点（items xref）。
- **复合语义**：Boss 阶段修正与秘境层倍率**叠乘**（先层倍率后阶段修正，
  resolveEnemy 单点组合）——秘境每 10 层插 Boss（#7/#8 联动）零特判；
  修仙包妖窟顶 层 / 鬼庙第 10 层即饕餮三阶段 Boss。
- **持久/重置**：`bossPhase` 存 CombatState 随档（中途存档续演）；自动再战
  重置归位（Boss 重生从头演阶段）；普通敌人（未注册 Boss）恒 -1 零扰动。
- **召唤原语不实施**：需多敌战斗状态机，另开票（裁决见 #8 票评）；
  本票阶段脚本词表 = 变招 / 狂暴（属性修正）/ 专属掉落。

### 引擎事件与协议

- 事件：`boss:phase`（`{enemyId, enemyName, phase: 1 起序号, name: 阶段名}`）；
- UI 呈现：阶段徽标（阶段名 content 直出）+ 血条分段刻度（刻度位置 =
  阈值），生效数值走 `combatEnemyView` 组合投影（秘境 × Boss 单点组合）。

## achievements 成就节（#9：统计 snapshot 驱动）

**可选节**：省略 = 该题材无成就玩法（引擎零降级路径，壳不渲染成就页签）。
成就表 100% 来自 content：**换包即换成就，引擎零改动**（票面验收 ②）。
判定只读引擎事件流累积的统计 snapshot（`state.stats`），与平台（Steam）解耦（票面设计约定）。

```json
"achievements": [
  {
    "id": "kill_100", "name": "百战妖氛", "icon": "战",
    "description": "累计斩杀一百只妖物。",
    "condition": { "stat": "kills", "target": 100 },
    "reward": { "gold": 200 }
  },
  { "id": "fast_kill_3", "name": "三合速胜", "condition": { "stat": "fastestKill", "op": "lte", "target": 3 } },
  { "id": "first_death", "name": "败中求生", "hidden": true, "condition": { "stat": "deaths" } }
]
```

### 归属划界（ADR-017：机制归引擎，数据归 content）

| 归 content | 归引擎 |
|---|---|
| 成就表本体（条件目标/奖励/隐藏/文案）、统计区呈现面（shell.statLabels） | 统计累积（事件流 → snapshot）、条件判定、进度投影、解锁幂等（一次且仅一次）、奖励入账 |

### 字段约定

| 字段 | 形态 | 约定 |
|---|---|---|
| `id` | string（`^[a-z][a-zA-Z0-9_]*$`） | 成就 id，**发布后不可变**：`state.achievements` 存档键（ADR-015）；id 去重（语义检查） |
| `name` / `icon` / `description` | string（≤18 / ≤2 / ≤60 字） | 展示文案，unlock 事件载荷与壳卡片 content 数据直出 |
| `hidden` | bool（可选） | 隐藏成就：解锁前壳以占位文案展示（不剧透条件），引擎透传 |
| `condition.stat` | string | **统计键 = 引擎注册表闭集**（下表），键域合法性由语义校验对照镜像收口（REBIRTH_RESET_KEYS 先例），死条件加载期拒绝 |
| `condition.target` | integer（≥ 1，可选） | 缺省 = 布尔型（stat 有记录且 > 0） |
| `condition.op` | `gte`（缺省）/ `lte` | gte = stat ≥ target（进度按比值投影）；lte = stat ≤ target（反向阈值，进度按反比投影） |
| `reward` | `{gold?, daoYun?, items?}`（可选） | 解锁奖励，引擎入账并随事件承载；`daoYun` 走余额+累计双键（与转生同律）；items 只引用 mat/consumable 类（xref items，装备实例走掉落/炼制管线不入袋） |

### 引擎统计键注册表（闭集，单源于 engine `src/stats.ts` STAT_KEYS）

| 键 | 累积语义 | 事件源 |
|---|---|---|
| `kills` | Σ 击杀数 | victory +1 |
| `deaths` | Σ 落败数 | defeat +1 |
| `rebirths` | Σ 兵解次数 | rebirth +1 |
| `cycles` | Σ 采集/炼制轮数（在线/离线同路） | activity-complete +1 / offline-settled +cycles |
| `dungeonFloorBest` | 历史最高到达秘境层（max） | dungeon:enter/floor/leave |
| `maxHit` | 历史最大单次伤害（玩家侧，max） | attack(side=player) |
| `fastestKill` | 最快击杀回合数（min；未击杀过 = 无记录） | victory(rounds) |

- **持久语义**：`stats`/`achievements` 为记录资产，兵解 default-keep（未登记进
  重置清单即保留，兵解不吞资产的既有约定）；
- **解锁一次且仅一次**：引擎在 tick/dispatch/settleOffline 末尾统一评估，
  `state.achievements` 成员幂等；存档往返/换包回装同 id 不重触发；
- **壳零公式复算**：进度百分比由引擎 `achievementProgressOf` 投影（percent
  0~100），统计区呈现面 = `texts.shell.pages.achievements.statLabels`
  （键 = 上表闭集，包决定呈现哪些统计）。

### 引擎事件与协议

- 事件：`achievement:unlock`（`{id, name, gold?, daoYun?, items?}`，奖励入账承载体）；
- 壳文案：`events.achievementToast/achievementLog`（槽位 `{name}`）+
  `pages.achievements` 页面组（title/subtitle `{unlocked}/{total}`/statLabels/
  hiddenName/hiddenDesc/unlockedBadge/progress `{current}/{target}`/
  rewardGold/rewardDaoYun/rewardItems）。

## elements 系别键域注册表（#25 键域开放 + #15 机制签名，ADR-017 裁决 8）

循 #21 VerbStyle 先例：schema 不钉死七系枚举，系别键域由包自声明——`elements`
节是包内系别键域的唯一注册表；`enemy.element`、`affinities` 键、铭纹条件
`condition.element`、武器 `element`（equip/blank，#15）、`elementFlavor` 池键
（#15）的引用合法性由语义校验对照本节强制（xref，坏包加载期拒绝，报错逐字段可定位）。

| 字段 | 形态 | 约定 |
|---|---|---|
| `id` | string（`^[a-z][a-zA-Z0-9_]*$`） | 系别键，键形态与 stat/verbStyle 统一（#021 批 4）；一经发布不可变；id 去重（语义检查） |
| `name` | string（1~6 字） | 展示名，词表归 content（ADR-016 延伸）；引擎零感知，壳层/编辑器消费 |
| `signature`（#15，可选） | `{primitive, value?, duration?}` | 机制签名（见下节）；缺省 = 该系无机械原语（纯风味/纯亲和系） |

- 金木水火土风雷七系只是官方包内容约定（ADR-012：每系一个可观测机制签名，
  拒绝纯数值系——自定义系别同样应满足结构签名判据）。
- `elements: []` 合法 = 无系别玩法（敌人缺省凡击）。
- **缺省/兜底行为**：敌人/武器不填 `element` = 凡击；聚合语境无 element 维度时
  `condition.element` 修饰符不生效（引擎 `conditionMatches` 语义不变）；
  引用未注册系别键 = 加载期拒绝（不静默降级）。
- 引擎零感知：系别只是条件匹配的不透明键（engine `modifiers.ts` 为 `string`）；
  `affinities`/`element` 的引擎消费已随 **#15 落地**（EnemyView/ItemView 投影 +
  战斗解算接线）。

### 系别机制签名（#15，ADR-012 第一波：雷/金/水/风）

**归属划界**：机制原语归引擎（闭集注册表），数值/时长/相克关系全归 content
（换包改系数引擎零改动）。

| 原语（引擎闭集） | 机制语义 | 参数 |
|---|---|---|
| `defenseBreak`（金·破防） | 命中即给受击者挂「破防」临时态：在效期间其 def ×(1−value)，伤害档对**未破防期望**判档 → 档位跃迁可见 | value = 缩减比例（0~1）；duration 毫秒 |
| `slow`（水·滞缓） | 命中即挂「滞缓」：在效期间敌方攻击间隔 ×(1+value) | 同上 |
| `swift`（风·迅疾） | 命中即挂「迅疾」：在效期间自身（玩家）攻击间隔 ×(1−value) | 同上 |
| （无原语，雷·霆爆） | 复用既有暴击体系：暴击时走 `elementFlavor.crits` 专属风味句（金框文案的载体），零机械参数 | — |

**机制约定**：

- **攻击系别来源**：玩家 = 佩戴武器（weapon 槽 equip/器胚）的 `element`；
  敌人 = 敌人 `element`（第一波只路由风味句，敌方机械签名（打玩家挂临时态）未启）。
- **临时态不落盘**（票面裁决：抗性/临时态不进存档新字段）：只在引擎闭包内，
  命中即续（时间 = 当前 + duration）；开战/自动再战/秘境进层/离线离场一律归零，
  存档恢复即散尽。修仙包时长 8000ms ≈ 3~4 击，持续输出即近乎常驻。
- **亲和度**：`enemy.affinities[element]`（百分点，−100~100，schema 关卡）作用于
  玩家攻敌伤害：dmg ×(1 + aff/100)，下限 1。负 = 抗性被克（`resists` 句 +
  档位读轻），正 = 易伤克制（`counters` 句 + 档位读高）。五行相克由 content 配
  （修仙包样例：饕餮 fire，`{water: +50, metal: -50}`——水克火、火克金），
  引擎零相克表。**亲和度只给 Boss/特色怪配**。
- **玩家抗性** = 铭纹/胚纹条件修饰符（`condition:{element}`），走 ADR-011 管线：
  防侧（def/hp）条件匹配**来袭**系别（敌人 element），攻侧（atk/crit）条件匹配
  **自身攻击**系别（武器 element）——同一个 condition 字段，按聚合一侧解释语境。
  修仙包样例：逆鳞（受火系 def+）、掌心雷（雷系攻击 atk+%）。
- **伤害链**：减伤解算（可含破防）→ 亲和乘区 → 暴击乘区；RNG 抽取顺序与旧版
  逐点一致（波动 → 暴击），无系内容零漂移。
- **事件面**：attack 事件 data 增可选 `element`（攻方系别，凡击不带）——四系签名
  的断言锚点（破防档位跃迁 / 间隔变化 / 暴击专属文案）皆在既有 attack 流内可断言。

## enemies 系别字段（#16，可选零破坏）

| 字段 | 形态 | 约定 |
|---|---|---|
| `kind` | string（`^[a-z][a-zA-Z0-9_]*$`） | 动词池键（#021 批 4 开放键域）：须在 `combatText.verbs` 注册（语义校验 xref）；'claw'/'magic' 为官方包约定 |
| `level` | integer（≥ 1） | 层数；上限**单一来源** = `config.progression.maxLevel`（#021 批 4：语义校验对照，config 缺省时跳过；schema 魔法数 99 已清退）。另一有效上限来自开战门控 `clv + levelGateOffset ≥ level` |
| `element` | string（`^[a-z][a-zA-Z0-9_]*$`） | 系别键（#25 键域开放）：须在 `elements` 节注册（语义校验 xref）；**不填=凡击无系别**；只给 Boss/特色怪配。#15 起：风味句按攻方系别路由（敌方机械签名未启，见「系别机制签名」） |
| `affinities` | `{[系别]: −100~100}` | 系别亲和（#15 起引擎消费）：受该系攻击的伤害 ×(1+值/100)（负=抗性被克读轻档，正=易伤克制读高档）；键域开放（#25）：系别键须在 `elements` 节注册（语义校验 xref）；**只给 Boss 配** |

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
