/* ==================== 问道长生 · 游戏数据定义 ==================== */
'use strict';

/* ---------- 技能 ---------- */
const SKILLS = {
  qi:      { name: '炼气', icon: '气', desc: '吐纳天地灵气，是修行之基' },
  herb:    { name: '采药', icon: '药', desc: '寻访灵草异卉，以备丹炉' },
  mine:    { name: '挖矿', icon: '矿', desc: '凿取山川金石，锻器之资' },
  alchemy: { name: '炼丹', icon: '丹', desc: '以丹炉炼化草木妖丹' },
  smith:   { name: '炼器', icon: '器', desc: '锻法器利剑，以助斗法' },
  combat:  { name: '斗法', icon: '斗', desc: '斩妖除魔，问道长生' },
};
const GATHER_SKILLS = ['qi', 'herb', 'mine'];

/* ---------- 物品 ---------- */
const ITEMS = {
  qi1:   { name: '散灵',     icon: '灵', type: 'mat',   sell: 2,   desc: '最粗浅的天地灵气' },
  qi2:   { name: '凝灵',     icon: '灵', type: 'mat',   sell: 9,   desc: '凝练成团的精纯灵气' },
  qi3:   { name: '天罡灵气', icon: '罡', type: 'mat',   sell: 30,  desc: '九天罡风中孕育的灵气之精' },
  herb1: { name: '青灵草',   icon: '青', type: 'mat',   sell: 4,   desc: '常见灵草，药性温和' },
  herb2: { name: '紫云花',   icon: '紫', type: 'mat',   sell: 15,  desc: '生于紫云崖畔，见光则隐' },
  herb3: { name: '玄冰莲',   icon: '冰', type: 'mat',   sell: 45,  desc: '寒潭深处千年一开' },
  herb4: { name: '万年灵芝', icon: '芝', type: 'mat',   sell: 120, desc: '吸纳万年月华的灵芝王' },
  silk:   { name: '灵蚕丝',   icon: '蚕', type: 'mat',   sell: 6,   desc: '灵蚕食灵草所吐之丝，可织法衣' },
  bingsilk: { name: '冰蚕丝', icon: '冰', type: 'mat',   sell: 60,  desc: '冰蚕食玄冰莲而生，丝寒韧如钢' },
  ore1:  { name: '凡铁',     icon: '铁', type: 'mat',   sell: 5,   desc: '凡间铁矿，勉强可用' },
  ore2:  { name: '玄铁',     icon: '玄', type: 'mat',   sell: 20,  desc: '色黑如墨，坚逾精钢' },
  ore3:  { name: '星辰砂',   icon: '星', type: 'mat',   sell: 60,  desc: '陨星碎屑，隐有星辉' },
  ore4:  { name: '灵晶',     icon: '晶', type: 'mat',   sell: 180, desc: '天地灵气凝结之晶' },
  core1: { name: '浊妖丹',   icon: '丹', type: 'mat',   sell: 25,  desc: '低阶妖兽内丹' },
  core2: { name: '煞妖丹',   icon: '煞', type: 'mat',   sell: 90,  desc: '中阶妖兽内丹，煞气凝然' },
  core3: { name: '魔妖丹',   icon: '魔', type: 'mat',   sell: 320, desc: '大妖内丹，魔气冲霄' },

  pill_heal: { name: '回气丹',   icon: '回', type: 'pill', sell: 18,  desc: '服用后恢复三成气血' },
  pill_qi:   { name: '聚气丹',   icon: '聚', type: 'pill', sell: 50,  desc: '五分钟内采集类经验 +25%' },
  pill_atk:  { name: '破煞丹',   icon: '破', type: 'pill', sell: 130, desc: '五分钟内攻击 +20%' },
  pill_def:  { name: '凝神丹',   icon: '凝', type: 'pill', sell: 180, desc: '五分钟内防御 +30%' },
  pill_gold: { name: '九转金丹', icon: '金', type: 'pill', sell: 700, desc: '五分钟内攻防 +40%、暴击 +10%' },

  sword1: { name: '青锋剑',     icon: '剑', type: 'equip', slot: 'weapon',    sell: 30,   equip: { atk: 6 } },
  sword2: { name: '玄铁重剑',   icon: '剑', type: 'equip', slot: 'weapon',    sell: 120,  equip: { atk: 18 } },
  sword3: { name: '星辰剑',     icon: '剑', type: 'equip', slot: 'weapon',    sell: 400,  equip: { atk: 45 } },
  sword4: { name: '诛仙剑',     icon: '剑', type: 'equip', slot: 'weapon',    sell: 1500, equip: { atk: 105 } },
  body1:  { name: '布道袍',     icon: '衣', type: 'equip', slot: 'body',      sell: 35,   equip: { def: 6, hp: 25 } },
  body2:  { name: '玄铁甲',     icon: '甲', type: 'equip', slot: 'body',      sell: 140,  equip: { def: 16, hp: 70 } },
  body3:  { name: '星辰法衣',   icon: '袍', type: 'equip', slot: 'body',      sell: 450,  equip: { def: 40, hp: 180 } },
  body4:  { name: '不灭金身甲', icon: '铠', type: 'equip', slot: 'body',      sell: 1600, equip: { def: 90, hp: 450 } },
  acc1:   { name: '聚灵玉佩',   icon: '玉', type: 'equip', slot: 'accessory', sell: 100,  equip: { crit: 5 } },
  acc2:   { name: '破妄金瞳',   icon: '瞳', type: 'equip', slot: 'accessory', sell: 320,  equip: { crit: 10 } },
  acc3:   { name: '混沌钟铃',   icon: '铃', type: 'equip', slot: 'accessory', sell: 1200, equip: { crit: 18, atk: 15, def: 15 } },

  /* ---- 妖物专属掉落（不可炼制，仅掉落） ---- */
  scorp_tail:  { name: '蝎尾刺',     icon: '刺', type: 'equip', slot: 'weapon',    sell: 25,   equip: { atk: 5 } },
  wolf_fang:   { name: '妖狼牙坠',   icon: '坠', type: 'equip', slot: 'accessory', sell: 60,   equip: { crit: 4, atk: 2 } },
  corpse_nail: { name: '尸骨魔爪',   icon: '爪', type: 'equip', slot: 'weapon',    sell: 130,  equip: { atk: 15 } },
  ghost_mask:  { name: '鬼面傩具',   icon: '面', type: 'equip', slot: 'accessory', sell: 160,  equip: { def: 8, crit: 6 } },
  blood_gourd: { name: '血魔血葫',   icon: '葫', type: 'equip', slot: 'weapon',    sell: 420,  equip: { atk: 40 } },
  luo_shayi:   { name: '阴罗纱衣',   icon: '纱', type: 'equip', slot: 'body',      sell: 460,  equip: { def: 30, hp: 220 } },
  mojun_blade: { name: '魔君残刃',   icon: '刃', type: 'equip', slot: 'weapon',    sell: 780,  equip: { atk: 70 } },
  mojun_guan:  { name: '魔君骨冠',   icon: '冠', type: 'equip', slot: 'accessory', sell: 1250, equip: { atk: 10, def: 10, crit: 8 } },
  taotie_fang: { name: '饕餮獠牙',   icon: '牙', type: 'equip', slot: 'weapon',    sell: 1550, equip: { atk: 95, crit: 5 } },
  taotie_pi:   { name: '饕餮皮裘',   icon: '裘', type: 'equip', slot: 'body',      sell: 1650, equip: { def: 75, hp: 500 } },
};

/* 丹药增益效果（持续秒） */
const PILL_EFFECTS = {
  pill_qi:   { dur: 300, mult: { gatherXp: 1.25 } },
  pill_atk:  { dur: 300, mult: { atk: 1.20 } },
  pill_def:  { dur: 300, mult: { def: 1.30 } },
  pill_gold: { dur: 300, mult: { atk: 1.40, def: 1.40 }, crit: 10 },
};

/* ---------- 采集活动 ---------- */
const GATHER_ACTIONS = {
  qi: [
    { name: '吐纳聚灵', lv: 1,  time: 2.0, xp: 5,   item: 'qi1', count: 1 },
    { name: '凝灵成雾', lv: 20, time: 3.5, xp: 14,  item: 'qi2', count: 1 },
    { name: '摘星引罡', lv: 45, time: 5.5, xp: 36,  item: 'qi3', count: 1 },
  ],
  herb: [
    { name: '采青灵草', lv: 1,  time: 3.0, xp: 6,   item: 'herb1', count: 1, bonus: { item: 'silk', chance: .5 } },
    { name: '采紫云花', lv: 15, time: 4.0, xp: 15,  item: 'herb2', count: 1, bonus: { item: 'silk', chance: .4 } },
    { name: '采玄冰莲', lv: 35, time: 6.0, xp: 40,  item: 'herb3', count: 1, bonus: { item: 'bingsilk', chance: .5 } },
    { name: '采万年灵芝', lv: 60, time: 9.0, xp: 90, item: 'herb4', count: 1, bonus: { item: 'bingsilk', chance: .35 } },
  ],
  mine: [
    { name: '凿凡铁',   lv: 1,  time: 2.5, xp: 6,   item: 'ore1', count: 1 },
    { name: '采玄铁',   lv: 18, time: 4.0, xp: 16,  item: 'ore2', count: 1 },
    { name: '取星辰砂', lv: 40, time: 6.5, xp: 42,  item: 'ore3', count: 1 },
    { name: '采灵晶',   lv: 65, time: 9.5, xp: 100, item: 'ore4', count: 1 },
  ],
};

/* ---------- 炼丹配方（有失败率，失败损失材料） ---------- */
const RECIPES_ALCHEMY = [
  { name: '炼制回气丹',   lv: 1,  item: 'pill_heal', mats: { herb1: 2 },                base: 0.75, time: 3.0,  xp: 8 },
  { name: '炼制聚气丹',   lv: 12, item: 'pill_qi',   mats: { herb1: 1, herb2: 1 },      base: 0.65, time: 4.5,  xp: 20 },
  { name: '炼制破煞丹',   lv: 28, item: 'pill_atk',  mats: { herb2: 2, core1: 1 },      base: 0.60, time: 6.0,  xp: 45 },
  { name: '炼制凝神丹',   lv: 42, item: 'pill_def',  mats: { herb3: 2 },                base: 0.55, time: 7.5,  xp: 80 },
  { name: '炼制九转金丹', lv: 65, item: 'pill_gold', mats: { herb4: 2, ore4: 1, core2: 1 }, base: 0.45, time: 12.0, xp: 220 },
];

/* ---------- 炼器配方（必定成功） ---------- */
const RECIPES_SMITH = [
  { name: '锻青锋剑',     lv: 1,  item: 'sword1', mats: { ore1: 4, qi1: 5 },            time: 4.0,  xp: 10 },
  { name: '缝布道袍',     lv: 5,  item: 'body1',  mats: { silk: 3, qi1: 6 },            time: 4.5,  xp: 12 },
  { name: '琢聚灵玉佩',   lv: 12, item: 'acc1',   mats: { qi1: 12, ore1: 3 },           time: 5.0,  xp: 20 },
  { name: '锻玄铁重剑',   lv: 20, item: 'sword2', mats: { ore2: 6, qi1: 18 },           time: 6.0,  xp: 35 },
  { name: '锻玄铁甲',     lv: 26, item: 'body2',  mats: { ore2: 5, qi1: 16 },           time: 6.0,  xp: 38 },
  { name: '琢破妄金瞳',   lv: 36, item: 'acc2',   mats: { qi2: 15, ore2: 6 },           time: 7.0,  xp: 60 },
  { name: '锻星辰剑',     lv: 45, item: 'sword3', mats: { ore3: 8, qi2: 20 },           time: 8.0,  xp: 100 },
  { name: '织星辰法衣',   lv: 52, item: 'body3',  mats: { bingsilk: 4, qi2: 18 },       time: 8.5,  xp: 120 },
  { name: '铸混沌钟铃',   lv: 66, item: 'acc3',   mats: { qi3: 20, ore4: 5 },           time: 10.0, xp: 220 },
  { name: '锻诛仙剑',     lv: 75, item: 'sword4', mats: { ore4: 10, qi3: 20, core3: 2 }, time: 14.0, xp: 380 },
  { name: '锻不灭金身甲', lv: 82, item: 'body4',  mats: { ore4: 8, qi3: 16 },           time: 15.0, xp: 420 },
];

/* ---------- 敌人（kind = 攻击方式：claw 爪牙 / magic 阴风法术） ---------- */
const ENEMIES = [
  { id: 'e1', name: '青鬃狼',       icon: '狼', lv: 1,  kind: 'claw',  hp: 60,   atk: 9,   def: 2,   atkTime: 2.8, xp: 16,   gp: [4, 10],     drops: [['core1', .25], ['herb1', .40]] },
  { id: 'e2', name: '赤尾妖蝎',     icon: '蝎', lv: 8,  kind: 'claw',  hp: 140,  atk: 17,  def: 6,   atkTime: 2.6, xp: 40,   gp: [12, 24],    drops: [['core1', .35], ['herb2', .30]] },
  { id: 'e3', name: '鬼面修士',     icon: '鬼', lv: 18, kind: 'magic', hp: 280,  atk: 32,  def: 14,  atkTime: 2.4, xp: 95,   gp: [28, 55],    drops: [['core1', .50], ['pill_heal', .15], ['herb2', .25]] },
  { id: 'e4', name: '尸傀',         icon: '尸', lv: 30, kind: 'claw',  hp: 560,  atk: 55,  def: 26,  atkTime: 2.6, xp: 190,  gp: [55, 95],    drops: [['core2', .30], ['ore2', .35]] },
  { id: 'e5', name: '血魔',         icon: '血', lv: 45, kind: 'magic', hp: 1050, atk: 88,  def: 46,  atkTime: 2.4, xp: 380,  gp: [110, 190],  drops: [['core2', .45], ['herb3', .25]] },
  { id: 'e6', name: '阴罗妖将',     icon: '罗', lv: 60, kind: 'magic', hp: 2000, atk: 135, def: 82,  atkTime: 2.2, xp: 700,  gp: [220, 380],  drops: [['core3', .30], ['herb4', .15]] },
  { id: 'e7', name: '魔君残魂',     icon: '魔', lv: 78, kind: 'magic', hp: 3800, atk: 205, def: 145, atkTime: 2.2, xp: 1300, gp: [420, 720],  drops: [['core3', .45], ['ore4', .20]] },
  { id: 'e8', name: '上古凶兽·饕餮', icon: '凶', lv: 92, kind: 'claw',  hp: 6000, atk: 240, def: 150, atkTime: 2.4, xp: 2600, gp: [850, 1500], drops: [['core3', .80], ['pill_gold', .20]] },
];

/* ---------- 坊市（可购买） ---------- */
const SHOP = [
  { item: 'pill_heal', price: 45 },
  { item: 'pill_qi',   price: 120 },
  { item: 'pill_atk',  price: 320 },
  { item: 'pill_def',  price: 450 },
  { item: 'silk',      price: 15 },
  { item: 'bingsilk',  price: 90 },
];

/* ---------- 境界（按斗法等级） ---------- */
const REALMS = [
  [1, '练气期'], [10, '筑基期'], [20, '金丹期'], [35, '元婴期'],
  [50, '化神期'], [65, '炼虚期'], [80, '合体期'], [93, '大乘期'],
];

/* ---------- 装备槽位 ---------- */
const SLOTS = [
  ['weapon', '法器'],
  ['body', '护体'],
  ['accessory', '灵饰'],
];

/* ==================== 装备实例体系 ====================
 * 稀有度四档与命名借鉴 SexyMUD（寻常/精良/罕见/绝世），适配为属性倍率 + 词条数
 */
const RARITY = {
  common: { name: '寻常', mult: 1.0,  affix: 0, cls: '',        sell: 1 },
  fine:   { name: '精良', mult: 1.15, affix: 1, cls: 'txt-good', sell: 2 },
  rare:   { name: '罕见', mult: 1.3,  affix: 2, cls: 'txt-blue', sell: 4 },
  epic:   { name: '绝世', mult: 1.5,  affix: 3, cls: 'txt-gold', sell: 10 },
};

/* 随机词条池：val 按装备档次缩放，stat 对应攻/防/血/暴 */
const AFFIXES = [
  { name: '锐锋', stat: 'atk' },
  { name: '罡气', stat: 'def' },
  { name: '浑厚', stat: 'hp' },
  { name: '通明', stat: 'crit' },
];

/* 妖物装备掉落表：chance 掉率，pool 专属掉落装备（不可炼制，与炼器体系互补） */
const GEAR_DROPS = {
  e1: { chance: .10, pool: ['scorp_tail', 'wolf_fang'] },
  e2: { chance: .10, pool: ['scorp_tail', 'wolf_fang'] },
  e3: { chance: .09, pool: ['corpse_nail', 'ghost_mask'] },
  e4: { chance: .09, pool: ['corpse_nail', 'ghost_mask'] },
  e5: { chance: .08, pool: ['blood_gourd', 'luo_shayi'] },
  e6: { chance: .08, pool: ['blood_gourd', 'luo_shayi'] },
  e7: { chance: .07, pool: ['mojun_blade', 'mojun_guan'] },
  e8: { chance: .15, pool: ['taotie_fang', 'taotie_pi'] },
};

/* ==================== 战斗文案词库 ====================
 * 借鉴 SexyMUD combat-text 系统（ADR-0011）并适配修仙语境：
 * - 模板片段 + 槽位：出招句 + 后果句，后果句以受击者为主语独立成句
 * - 词库按伤害档（轻/中/重/濒死）分池，数值经 {d} 槽嵌入叙事，不干瘪直出
 * - 兵器/作用方式决定动词池，动词条目自带部位白名单
 * - 门控：剩余生命=危 且 伤害=重/濒死 时启用「致命一击」专属词库
 */
const CTEXT = {
  /* 动词池：sword 剑修 / fist 拳脚 / claw 妖兽爪牙 / magic 阴风法术 */
  verbs: {
    sword: [
      { v: '刺', limbs: ['咽喉', '胸口', '后心', '小腹'] },
      { v: '点', limbs: ['咽喉', '眉心', '腕脉'] },
      { v: '撩', limbs: ['面门', '下颌'] },
      { v: '抹', limbs: ['咽喉', '小腹'] },
      { v: '扫', limbs: ['腰肋', '下盘', '双膝'] },
      { v: '劈', limbs: ['面门', '肩头', '天灵'] },
    ],
    fist: [
      { v: '击', limbs: ['面门', '胸口', '小腹'] },
      { v: '推', limbs: ['胸口', '肩头'] },
      { v: '拍', limbs: ['天灵', '后心'] },
    ],
    claw: [
      { v: '抓', limbs: ['面门', '肩头', '胸口'] },
      { v: '撕', limbs: ['腰肋', '手臂'] },
      { v: '扑', limbs: ['咽喉', '胸口'] },
      { v: '咬', limbs: ['手臂', '小腿'] },
      { v: '扫', limbs: ['下盘', '腰肋'] },
    ],
    magic: [
      { v: '摄', limbs: ['眉心', '胸口'] },
      { v: '卷', limbs: ['周身', '双足'] },
      { v: '蚀', limbs: ['护体灵光', '周身灵机'] },
      { v: '罩', limbs: ['周身要害'] },
      { v: '点', limbs: ['眉心', '咽喉'] },
    ],
  },
  /* 招式名：剑按法器等级，妖物各自成式 */
  moves: {
    fist:   ['搏兔一击', '石破天惊'],
    sword1: ['青虹一闪', '春草拂浪'],
    sword2: ['玄铁崩山', '力劈华山'],
    sword3: ['星河倒卷', '流光七杀'],
    sword4: ['诛仙一线', '万剑归宗'],
    /* 妖物专属掉落武器 */
    scorp_tail:  ['毒尾点穴'],
    corpse_nail: ['白骨摧心'],
    blood_gourd: ['血河翻浪'],
    mojun_blade: ['残月断魂'],
    taotie_fang: ['吞天一咬'],
    e1: ['饿虎扑食'], e2: ['毒尾横扫'], e3: ['摄魂指'], e4: ['腐骨尸爪'],
    e5: ['血遁噬魂'], e6: ['阴罗鬼爪'], e7: ['万魔噬心'], e8: ['吞天噬地'],
  },
  /* 起势（重伤时加一段）与暴击起势 */
  openings: [
    '你渊渟岳峙，气机先锁对方周身要害',
    '你灵力灌体，剑身嗡然轻鸣',
    '你足尖一点，身形快若惊鸿',
    '你屏息凝神，周身灵压骤然一沉',
  ],
  critIntro: [
    '你气机鼓荡，一式全力施为',
    '你剑随身走，灵光暴涨',
  ],
  /* 后果词库：hit 打妖物 / hurt 玩家挨打，按伤害档分池，受击者为主语独立成句，{d} 填数值 */
  cons: {
    hit: {
      light: [
        '{defender}浑不在意，身上只添了一道浅痕，受创{d}点。',
        '{defender}侧身欲避，终究慢了半分，受创{d}点。',
        '剑气及体，{defender}闷哼一声，受创{d}点。',
      ],
      mid: [
        '{defender}闷哼一声，连退两步，受创{d}点。',
        '{defender}踉跄半步，嘴角渗血，受创{d}点。',
        '{defender}护体灵光一阵涟漪，受创{d}点。',
      ],
      heavy: [
        '{defender}喷出一口鲜血，倒退丈许，受创{d}点。',
        '{defender}脸色煞白，踉跄几立不稳，受创{d}点。',
      ],
      deadly: [
        '{defender}气血翻涌，摇摇欲坠，这一击受创{d}点。',
        '{defender}元气如潮水般溃散，受创{d}点。',
      ],
    },
    hurt: {
      light: [
        '你灵机微转仍被扫中，受创{d}点。',
        '你侧身避开大半，仍受创{d}点。',
      ],
      mid: [
        '你闷哼一声，气血微乱，受创{d}点。',
        '你横剑格挡，仍被震得气血翻涌，受创{d}点。',
      ],
      heavy: [
        '你护体灵光剧震，喷出一口鲜血，受创{d}点。',
        '你倒退数步方才稳住身形，受创{d}点。',
      ],
      deadly: [
        '你真元溃散，眼前阵阵发黑，受创{d}点。',
        '你丹府震荡，摇摇欲坠，受创{d}点。',
      ],
    },
  },
  /* 致命一击专属（剩余生命=危 且 伤害=重/濒死） */
  fatal: {
    hit: '{defender}发出一声哀鸣，浑身灵光溃散如雪——这致命一击受创{d}点！',
    hurt: '你眼前一黑，五脏如遭锤击，受创{d}点——再挨一下只怕要道消身殒！',
  },
};
