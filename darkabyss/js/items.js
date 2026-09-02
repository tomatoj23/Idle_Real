'use strict';
/* ===== 暗渊 DARK ABYSS —— 物品 / 词缀 / 稀有度系统 ===== */
let UID=1;

const RARITY_META=[
  {n:'普通', c:'#c8c8c8', mult:1.0},
  {n:'魔法', c:'#6f9cff', mult:1.7},
  {n:'稀有', c:'#ffd75e', mult:2.6},
  {n:'传奇', c:'#ff9a3c', mult:4.2}
];
const SLOT_NAMES={weapon:'武器', helm:'头盔', armor:'护甲', ring:'戒指'};
const STAT_NAMES={
  atk:'攻击', armor:'护甲', hp:'生命', mp:'法力', crit:'暴击率%', as:'攻速%', ms:'移速%',
  ls:'吸血%', sp:'法强', fire:'火焰伤害'
};

const ITEM_BASE={
  weapon:[
    {n:'生锈短剑', atk:3,  tier:1},
    {n:'铁剑',     atk:5,  tier:1},
    {n:'弯刀',     atk:6,  crit:3, tier:2},
    {n:'战斧',     atk:9,  as:-10, tier:3},
    {n:'骑士长剑', atk:11, tier:4},
    {n:'巨剑',     atk:15, as:-16, tier:5},
    {n:'符文巨刃', atk:20, crit:4, tier:7}
  ],
  helm:[
    {n:'皮帽',     armor:1, hp:4,  tier:1},
    {n:'铁盔',     armor:3, tier:2},
    {n:'骑士战盔', armor:5, hp:8,  tier:4},
    {n:'恶魔骨盔', armor:7, crit:3, tier:6}
  ],
  armor:[
    {n:'布袍',     armor:1, mp:5,  tier:1},
    {n:'皮甲',     armor:3, tier:1},
    {n:'锁甲',     armor:5, ms:-4, tier:3},
    {n:'骑士板甲', armor:8, ms:-8, hp:12, tier:5},
    {n:'龙鳞铠',   armor:12, ms:-6, hp:20, tier:7}
  ],
  ring:[
    {n:'铜戒指',   hp:6,  tier:1},
    {n:'银戒指',   crit:3, tier:2},
    {n:'符文戒指', mp:10, tier:3},
    {n:'恶魔之眼', crit:4, sp:3, tier:6}
  ]
};

const AFFIX_P=[
  {n:'锋利', s:t=>({atk:s2(2,t)})},
  {n:'沉重', s:t=>({atk:s2(4,t), ms:-8})},
  {n:'烈焰', s:t=>({atk:s2(2,t), fire:s2(3,t)})},
  {n:'嗜血', s:t=>({ls:2+((t/4)|0)})},
  {n:'轻捷', s:t=>({ms:8, as:s2(4,t)})},
  {n:'野蛮', s:t=>({atk:s2(5,t), crit:-3})}
];
const AFFIX_S=[
  {n:'活力', s:t=>({hp:s2(12,t)})},
  {n:'灵狐', s:t=>({crit:s2(3,t)})},
  {n:'巨鲸', s:t=>({hp:s2(18,t), mp:s2(5,t)})},
  {n:'雄鹰', s:t=>({as:s2(6,t)})},
  {n:'庇护', s:t=>({armor:s2(4,t)})},
  {n:'法力', s:t=>({mp:s2(8,t), sp:s2(2,t)})}
];
const LEGEND_NAMES=['灰烬使者','弑君者','寒渊之牙','晨曦之怒','深渊低语','腐月','白骨之歌','龙灾','圣焰审判'];

function s2(v,t){ return Math.max(1, Math.round(v*(1+0.22*Math.max(0,t-1)))); }

function rollRarity(tier){
  const r=Math.random()+Math.max(0,tier)*0.012;
  if(r>1.16) return 3;
  if(r>0.87) return 2;
  if(r>0.52) return 1;
  return 0;
}

function makeItem(tier, forceRarity){
  tier=Math.max(1,tier|0);
  const slot=['weapon','helm','armor','ring'][irand(0,3)];
  const pool=ITEM_BASE[slot].filter(b=>b.tier<=tier);
  const base=pool[pool.length-1-Math.min(pool.length-1, irand(0,2))];
  const rarity=(forceRarity!=null)?forceRarity:rollRarity(tier);

  const stats={};
  for(const k in base){
    if(k==='n'||k==='tier') continue;
    if(k==='ms'||k==='as'||k==='crit') stats[k]=base[k];
    else stats[k]=s2(base[k],tier);
  }
  const affNames=[];
  let nAff=[0,1,2,3][rarity];
  if(rarity===3&&Math.random()<0.5) nAff=4;
  const pools=[AFFIX_P,AFFIX_S];
  for(let i=0;i<nAff;i++){
    const pl=pools[i%2];
    const p=pl[irand(0,pl.length-1)];
    if(affNames.includes(p.n)) continue;
    affNames.push(p.n);
    const st=p.s(tier);
    for(const k in st) stats[k]=(stats[k]||0)+st[k];
  }

  let name;
  if(rarity===3){
    name=LEGEND_NAMES[irand(0,LEGEND_NAMES.length-1)];
  }else{
    const pn=affNames.find(a=>AFFIX_P.some(p=>p.n===a));
    const sn=affNames.find(a=>AFFIX_S.some(p=>p.n===a));
    name=(pn?pn+'的':'')+base.n+(sn?'·'+sn:'');
  }
  const value=Math.max(5, Math.round((8+tier*6)*RARITY_META[rarity].mult*(0.85+Math.random()*0.3)));
  return {uid:UID++, slot, name, rarity, stats, value, tier, icon:slot};
}

/* 祭坛赌博：稀有度定向提升 */
function makeGambleItem(tier){
  return makeItem(tier, [1,2,2,3][irand(0,3)]);
}
