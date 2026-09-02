/* ==================== 问道长生 · 游戏引擎 ==================== */
'use strict';

/* ---------- 小工具 ---------- */
const $ = s => document.querySelector(s);
const fmt = n => {
  n = Math.floor(n);
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
  return String(n);
};
const rnd = (a, b) => a + Math.random() * (b - a);
const now = () => Date.now();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h) return `${h}时${m}分`;
  if (m) return `${m}分${s}秒`;
  return `${s}秒`;
}

/* ---------- 经验表（1~99 级） ---------- */
const MAX_LV = 99;
const XP_TABLE = [0, 0];
for (let l = 2; l <= MAX_LV; l++) XP_TABLE[l] = XP_TABLE[l - 1] + Math.floor(10 * Math.pow(l - 1, 1.8) + 15 * (l - 1));
function levelFromXp(xp) { let l = 1; while (l < MAX_LV && xp >= XP_TABLE[l + 1]) l++; return l; }

/* ---------- 状态与存档 ---------- */
const SAVE_KEY = 'wendao_changsheng_v1';
let S = null;
let curPage = 'home';

function defaultState() {
  const skills = {};
  for (const k in SKILLS) skills[k] = { xp: 0 };
  return {
    ver: 1, gp: 0, hp: 100,
    items: {},
    gear: [], gearSeq: 0,            // 装备实例（随机词条），uid 自增
    equip: { weapon: null, body: null, accessory: null },   // 槽位存 gear uid
    skills, active: null, progress: 0,
    buffs: {},                       // {pillId: untilTs}
    autoEat: true, autoFight: true,
    combat: { enemyId: null, ehp: 0, pt: 0, et: 0, respT: 0 },
    fightLog: [], logs: [],
    lastSaved: now(),
  };
}

function load() {
  let d = null;
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) d = JSON.parse(raw); } catch (e) { d = null; }
  S = defaultState();
  if (d) {
    for (const k in S) if (d[k] !== undefined) S[k] = d[k];
    for (const k in S.skills) if (d.skills && d.skills[k]) S.skills[k].xp = d.skills[k].xp || 0;
    for (const k in S.equip) if (!(k in (d.equip || {}))) S.equip[k] = null;
  }
  S.hp = Math.min(S.hp, playerMaxHp());
  if (S.hp <= 0) S.hp = playerMaxHp();
  migrateGear();
}

/* 旧档兼容：items/槽位中的静态装备 id 迁移为寻常品质装备实例 */
function migrateGear() {
  if (!Array.isArray(S.gear)) S.gear = [];
  if (!S.gearSeq) S.gearSeq = 0;
  for (const id of Object.keys(S.items)) {
    if (ITEMS[id] && ITEMS[id].type === 'equip' && S.items[id] > 0) {
      for (let i = 0; i < S.items[id]; i++) makeGear(id, 'common');
      delete S.items[id];
    }
  }
  for (const slot in S.equip) {
    const old = S.equip[slot];
    if (old && ITEMS[old] && ITEMS[old].type === 'equip') {
      S.equip[slot] = makeGear(old, 'common').uid;
    }
  }
}

/* ---------- 装备实例 ---------- */
function rollRarity(lvBonus) {     // 寻常70% 精良20% 罕见8% 绝世2%；lvBonus 为炼器等级微调
  const r = Math.random() - (lvBonus || 0);
  return r < .02 ? 'epic' : r < .10 ? 'rare' : r < .30 ? 'fine' : 'common';
}
function affixVal(id, stat) {      // 词条量级随装备档次缩放
  const eq = ITEMS[id].equip || {};
  const base = Math.max(eq.atk || 0, eq.def || 0, (eq.hp || 0) / 5, (eq.crit || 0) * 0.8, 3);
  const k = { atk: 0.3, def: 0.3, hp: 1.5, crit: 0.25 }[stat];
  return Math.max(1, Math.round(base * k * (0.8 + Math.random() * 0.4)));
}
function makeGear(id, forceRarity) {
  const rarity = forceRarity || rollRarity(levelFromXp(S.skills.smith.xp) * 0.0004);
  const affixes = [];
  if (RARITY[rarity].affix > 0) {
    const used = {};
    let guard = 0;
    while (affixes.length < RARITY[rarity].affix && guard++ < 20) {
      const a = AFFIXES[Math.floor(Math.random() * AFFIXES.length)];
      if (used[a.stat]) continue;
      used[a.stat] = 1;
      affixes.push({ name: a.name, stat: a.stat, val: affixVal(id, a.stat) });
    }
  }
  const g = { uid: ++S.gearSeq, id, rarity, affixes };
  S.gear.push(g);
  return g;
}
const gearByUid = uid => S.gear.find(g => g.uid === uid);
const gearName = g => RARITY[g.rarity].name + '·' + ITEMS[g.id].name;
function gearStats(g) {
  const m = RARITY[g.rarity].mult;
  const eq = ITEMS[g.id].equip;
  const out = { atk: Math.round((eq.atk || 0) * m), def: Math.round((eq.def || 0) * m), hp: Math.round((eq.hp || 0) * m), crit: Math.round((eq.crit || 0) * m) };
  for (const a of g.affixes) out[a.stat] = (out[a.stat] || 0) + a.val;
  return out;
}
const gearSell = g => Math.max(1, Math.round(ITEMS[g.id].sell * RARITY[g.rarity].sell));
function affixText(a) {
  const unit = a.stat === 'crit' ? '%' : '';
  const label = { atk: '攻', def: '防', hp: '血', crit: '暴' }[a.stat];
  return `<span class="txt-dim">${a.name}</span> ${label}+${a.val}${unit}`;
}

function save() { S.lastSaved = now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { } }
function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
function importSave(str) {
  try {
    const d = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
    if (!d || !d.skills) throw 0;
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
    load(); S.lastSaved = now() - 1e9; applyOffline(); renderAll();
    toast('读档成功，前尘记忆涌入识海');
  } catch (e) { toast('存档破损，无法读取', true); }
}

/* ---------- 物品 ---------- */
const cnt = id => S.items[id] || 0;
function addItem(id, n) {
  S.items[id] = (S.items[id] || 0) + n;
  if (S.items[id] <= 0) delete S.items[id];
}
function hasMats(mats) { for (const id in mats) if (cnt(id) < mats[id]) return false; return true; }
function consumeMats(mats) { for (const id in mats) addItem(id, -mats[id]); }

/* ---------- 属性计算 ---------- */
function equipBonus() {
  const b = { atk: 0, def: 0, hp: 0, crit: 0 };
  for (const slot in S.equip) {
    const uid = S.equip[slot]; if (!uid) continue;
    const g = gearByUid(uid); if (!g) continue;
    const st = gearStats(g);
    b.atk += st.atk || 0; b.def += st.def || 0; b.hp += st.hp || 0; b.crit += st.crit || 0;
  }
  return b;
}
function buffList() {
  const out = [];
  for (const id in S.buffs) if (S.buffs[id] > now()) out.push(id); else delete S.buffs[id];
  return out;
}
function buffMult(key) {
  let m = 1;
  for (const id of buffList()) { const eff = PILL_EFFECTS[id]; if (eff && eff.mult && eff.mult[key]) m *= eff.mult[key]; }
  return m;
}
function buffCrit() {
  let c = 0;
  for (const id of buffList()) { const eff = PILL_EFFECTS[id]; if (eff && eff.crit) c += eff.crit; }
  return c;
}
const clv = () => S.skills.combat.xp !== undefined ? levelFromXp(S.skills.combat.xp) : 1;
function playerAtk() { return Math.round((8 + clv() * 3 + equipBonus().atk) * buffMult('atk')); }
function playerDef() { return Math.round((2 + clv() * 1.2 + equipBonus().def) * buffMult('def')); }
function playerMaxHp() { return 100 + clv() * 12 + equipBonus().hp; }
function playerCrit() { return Math.min(75, 5 + equipBonus().crit + buffCrit()); }
function realmName() {
  const l = clv(); let name = REALMS[0][1];
  for (const [lv, n] of REALMS) if (l >= lv) name = n;
  return name;
}

/* ---------- 提示与日志 ---------- */
function toast(msg, err) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3000);
  while (box.children.length > 5) box.firstChild.remove();
}
function glog(msg, cls) {
  S.logs.unshift({ t: now(), msg, cls });
  if (S.logs.length > 60) S.logs.length = 60;
}
let flogSeq = 0;                                 // 日志版本号：满 40 条 shift 后长度不变，须用序号检测变化
function flog(msg, cls) {
  S.fightLog.push({ msg, cls });
  if (S.fightLog.length > 40) S.fightLog.shift();
  flogSeq++;
}

/* ---------- 经验与升级 ---------- */
function addXp(skill, n) {
  if (n <= 0) return;
  const before = levelFromXp(S.skills[skill].xp);
  S.skills[skill].xp += n;
  const after = levelFromXp(S.skills[skill].xp);
  if (after > before) {
    if (skill === 'combat') {
      const beforeMax = 100 + before * 12 + equipBonus().hp;
      S.hp = Math.min(playerMaxHp(), S.hp + Math.max(0, playerMaxHp() - beforeMax));
    }
    toast(`【${SKILLS[skill].name}】修为精进，升至 ${after} 层`);
    glog(`【${SKILLS[skill].name}】升至 ${after} 层`, 'gold');
    renderPage();
  }
}

/* ---------- 活动控制 ---------- */
function stopActive(silent) {
  if (!S.active) return;
  S.active = null; S.progress = 0;
  S.combat = { enemyId: null, ehp: 0, pt: 0, et: 0, respT: 0 };
  if (!silent) { renderPage(); }
}
function startGather(skill, idx) {
  const a = GATHER_ACTIONS[skill][idx];
  if (levelFromXp(S.skills[skill].xp) < a.lv) return toast('修为不足，无法行此法', true);
  stopActive(true);
  S.active = { type: 'gather', skill, idx };
  S.progress = 0;
  renderPage();
}
function startCraft(kind, idx) {
  const r = kind === 'alchemy' ? RECIPES_ALCHEMY[idx] : RECIPES_SMITH[idx];
  if (levelFromXp(S.skills[kind].xp) < r.lv) return toast('修为不足，无法炼制', true);
  if (!hasMats(r.mats)) return toast('材料不齐，巧妇难为无米之炊', true);
  stopActive(true);
  S.active = { type: 'craft', kind, idx };
  S.progress = 0;
  renderPage();
}
function startFight(id) {
  const e = ENEMIES.find(x => x.id === id);
  if (!e) return;
  if (clv() + 2 < e.lv) return toast('境界太低，恐有性命之虞', true);
  if (S.hp < playerMaxHp() * 0.3) return toast('气血未复，先调息片刻', true);
  stopActive(true);
  S.active = { type: 'combat' };
  S.combat = { enemyId: id, ehp: e.hp, pt: 0, et: 0, respT: 0 };
  S.fightLog = [];
  flog(`剑拔弩张——你与【${e.name}】战至一处`, 'sys');
  curPage = 'combat';
  renderPage();
}

/* ---------- 战斗 ---------- */
function calcDmg(atk, def) {
  return Math.max(1, Math.round(atk * rnd(0.9, 1.1) * (1 - def / (def + 120))));
}

/* ---------- 战斗文案（片段化模板 + 词库抽取，适配自 SexyMUD combat-text） ---------- */
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function hitTierOf(dmg, atk, def) {            // 伤害档：相对期望伤害（已计防御减免）
  const expected = Math.max(1, atk * (1 - def / (def + 120)));
  const r = dmg / expected;
  return r < 0.95 ? 'light' : r < 1.05 ? 'mid' : r < 1.5 ? 'heavy' : 'deadly';
}
function hpTierOf(hp, max) {                   // 剩余生命档（仅用于致命一击门控）
  return hp / max <= 0.15 ? 'critical' : 'ok';
}
function playerHitText(e, dmg, crit) {
  const tier = hitTierOf(dmg, playerAtk(), e.def);
  const wg = S.equip.weapon ? gearByUid(S.equip.weapon) : null;   // 佩戴中的武器实例（槽位存 uid）
  const kind = wg ? 'sword' : 'fist';
  const wName = wg ? ITEMS[wg.id].name : '拳脚';
  const ve = pick(CTEXT.verbs[kind]);
  const limb = pick(ve.limbs);
  const move = pick(CTEXT.moves[wg ? wg.id : 'fist'] || CTEXT.moves.fist);   // 兜底：未注册招式的武器回退拳脚
  let line;
  if (tier === 'deadly' || crit) line = `${pick(CTEXT.critIntro)}——「${move}」倏然施出，${wName}${ve.v}向${e.name}的${limb}！`;
  else if (tier === 'heavy') line = `${pick(CTEXT.openings)}——一招「${move}」，${wName}${ve.v}向${e.name}的${limb}。`;
  else line = `你一招「${move}」，${wName}${ve.v}向${e.name}的${limb}。`;
  const hpCrit = hpTierOf(Math.max(0, S.combat.ehp), e.hp);
  let cons;
  if (hpCrit === 'critical' && (tier === 'heavy' || tier === 'deadly')) cons = CTEXT.fatal.hit;
  else cons = pick(CTEXT.cons.hit[tier]);
  return line + cons.replace('{defender}', e.name).replace('{d}', dmg);
}
function enemyHitText(e, dmg) {
  const tier = hitTierOf(dmg, e.atk, playerDef());
  const ve = pick(CTEXT.verbs[e.kind || 'claw']);
  const limb = pick(ve.limbs);
  const move = pick(CTEXT.moves[e.id] || ['扑击']);
  let line;
  if (tier === 'heavy' || tier === 'deadly') line = `${e.name}凶性大发——「${move}」猛然施出，${ve.v}向你的${limb}！`;
  else line = `${e.name}一式「${move}」，${ve.v}向你的${limb}。`;
  const hpCrit = hpTierOf(Math.max(0, S.hp - dmg), playerMaxHp());
  let cons;
  if (hpCrit === 'critical' && (tier === 'heavy' || tier === 'deadly')) cons = CTEXT.fatal.hurt;
  else cons = pick(CTEXT.cons.hurt[tier]);
  return line + cons.replace('{d}', dmg);
}
function combatTick(dt) {
  const c = S.combat;
  const e = ENEMIES.find(x => x.id === c.enemyId);
  if (!e) return stopActive(true);
  if (c.respT > 0) {                       // 胜利后短暂休整
    c.respT -= dt;
    if (c.respT <= 0) {
      if (S.autoFight) { c.ehp = e.hp; c.pt = 0; c.et = 0; flog(`你略定心神，再度向【${e.name}】出手`, 'sys'); }
      else { flog('你见好就收，飘然离场', 'sys'); return stopActive(); }
    }
    return;
  }
  // 自动嗑丹
  if (S.autoEat && S.hp < playerMaxHp() * 0.5 && cnt('pill_heal') > 0) eatPill('pill_heal', true);
  c.pt += dt;
  if (c.pt >= 2.2) {
    c.pt -= 2.2;
    let dmg = calcDmg(playerAtk(), e.def);
    const crit = Math.random() * 100 < playerCrit();
    if (crit) dmg = Math.round(dmg * 1.6);
    c.ehp -= dmg;
    flog(playerHitText(e, dmg, crit), crit ? 'gold' : 'good');
    if (c.ehp <= 0) return victory(e);
  }
  c.et += dt;
  if (c.et >= e.atkTime) {
    c.et -= e.atkTime;
    const dmg = calcDmg(e.atk, playerDef());
    S.hp -= dmg;
    flog(enemyHitText(e, dmg), 'bad');
    if (S.hp <= 0) return defeat(e);
  }
}
function victory(e) {
  const gp = Math.round(rnd(e.gp[0], e.gp[1]));
  S.gp += gp;
  const loot = [];
  let lootCls = 'gold';
  for (const [id, chance] of e.drops) if (Math.random() < chance) { addItem(id, 1); loot.push(ITEMS[id].name); }
  const gd = GEAR_DROPS[e.id];
  if (gd && Math.random() < gd.chance) {
    const g = makeGear(pick(gd.pool));
    loot.push('【' + gearName(g) + '】');
    if (g.rarity === 'epic') { lootCls = 'gold'; toast(`天降异宝！妖物遗落【${gearName(g)}】`); glog(`于${e.name}手中夺得【${gearName(g)}】`, 'gold'); }
    else if (g.rarity === 'rare') { lootCls = 'sys'; toast(`妖物遗落【${gearName(g)}】`); }
  }
  flog(`【${e.name}】轰然倒地！你得灵石 ${gp}${loot.length ? '，缴获 ' + loot.join('、') : ''}`, lootCls);
  addXp('combat', e.xp);
  S.combat.respT = 1.5;
  renderPage();
}
function defeat(e) {
  flog(`你不敌【${e.name}】，真元耗尽，被同门救回`, 'bad');
  toast('斗法落败，幸得同门相救', true);
  S.hp = Math.max(1, Math.round(playerMaxHp() * 0.3));
  stopActive();
}

/* ---------- 丹药 ---------- */
function eatPill(id, silent) {
  if (cnt(id) <= 0) return toast('丹药已尽', true);
  if (id === 'pill_heal') {
    const max = playerMaxHp();
    if (S.hp >= max && !silent) return toast('气血充盈，无需服药', true);
    S.hp = Math.min(max, S.hp + Math.round(max * 0.3));
  } else {
    const eff = PILL_EFFECTS[id]; if (!eff) return;
    S.buffs[id] = now() + eff.dur * 1000;
  }
  addItem(id, -1);
  if (!silent) { toast(`服下【${ITEMS[id].name}】`); renderPage(); }
  else flog(`你服下一枚【${ITEMS[id].name}】，气息稍定`, 'sys');
}

/* ---------- 挂机推进 ---------- */
function advance(dt) {
  // 脱战回血
  if (!S.active || S.active.type !== 'combat') {
    const max = playerMaxHp();
    if (S.hp < max) S.hp = Math.min(max, S.hp + max * 0.04 * dt);
  }
  if (!S.active) return;
  if (S.active.type === 'gather') {
    const a = GATHER_ACTIONS[S.active.skill][S.active.idx];
    S.progress += dt;
    while (S.progress >= a.time) {
      S.progress -= a.time;
      let xp = a.xp;
      if (GATHER_SKILLS.includes(S.active.skill)) xp *= buffMult('gatherXp');
      addItem(a.item, a.count);
      if (a.bonus && Math.random() < a.bonus.chance) addItem(a.bonus.item, 1);   // 副产出（如采药偶得灵蚕丝）
      addXpQuiet(S.active.skill, xp);
    }
  } else if (S.active.type === 'craft') {
    const kind = S.active.kind, idx = S.active.idx;
    const r = kind === 'alchemy' ? RECIPES_ALCHEMY[idx] : RECIPES_SMITH[idx];
    if (!hasMats(r.mats)) { toast('材料耗尽，炼制中止', true); return stopActive(); }
    S.progress += dt;
    while (S.progress >= r.time && hasMats(r.mats)) {
      S.progress -= r.time;
      consumeMats(r.mats);
      if (kind === 'alchemy') {
        const rate = Math.min(0.99, r.base + levelFromXp(S.skills.alchemy.xp) * 0.004);
        if (Math.random() < rate) { addItem(r.item, 1); addXpQuiet('alchemy', r.xp); }
        else { addXpQuiet('alchemy', Math.round(r.xp * 0.25)); }
      } else {
        const g = makeGear(r.item);
        if (g.rarity === 'epic') { toast(`神兵天成！炼得【${gearName(g)}】`); glog(`炼得【${gearName(g)}】`, 'gold'); }
        else if (g.rarity === 'rare') toast(`炼得【${gearName(g)}】`);
        addXpQuiet('smith', r.xp);
      }
    }
    if (!hasMats(r.mats)) { toast('材料耗尽，炼制中止', true); return stopActive(); }
  } else if (S.active.type === 'combat') {
    combatTick(dt);
  }
}
function addXpQuiet(skill, n) { if (n > 0) addXp(skill, n); }

/* ---------- 离线收益 ---------- */
function applyOffline() {
  const dt = Math.min((now() - S.lastSaved) / 1000, 8 * 3600);
  if (dt < 60) return;
  if (S.active && S.active.type === 'gather') {
    const a = GATHER_ACTIONS[S.active.skill][S.active.idx];
    const c = Math.floor(dt / a.time);
    if (c > 0) {
      let xp = a.xp * c; // 离线不加成，凭实力
      addItem(a.item, a.count * c);
      if (a.bonus) { const b = Math.floor(c * a.bonus.chance); if (b > 0) addItem(a.bonus.item, b); }  // 副产出按期望折算
      addXpQuiet(S.active.skill, xp);
      toast(`离线 ${fmtTime(dt)}：${a.name} ×${c}，修为 +${fmt(xp)}`);
      glog(`离线修炼 ${fmtTime(dt)}，${a.name} ×${c}`, 'gold');
    }
  } else {
    toast(`你闭关 ${fmtTime(dt)}，精神焕发`);
  }
}

/* ---------- 商店 ---------- */
function buyItem(item, n) {
  const shop = SHOP.find(s => s.item === item); if (!shop) return;
  const cost = shop.price * n;
  if (S.gp < cost) return toast('灵石不足', true);
  S.gp -= cost; addItem(item, n);
  toast(`购得【${ITEMS[item].name}】×${n}`);
  renderPage();
}
function sellItem(id, n) {
  const have = cnt(id); if (have <= 0) return;
  const num = n === 'all' ? have : Math.min(1, have);
  addItem(id, -num);
  S.gp += ITEMS[id].sell * num;
  renderPage();
}

/* ---------- 装备 ---------- */
const isWorn = uid => S.equip.weapon === uid || S.equip.body === uid || S.equip.accessory === uid;
function equipItem(uid) {
  const g = gearByUid(uid); if (!g) return;
  if (isWorn(uid)) return;                       // 实例常驻 S.gear，槽位仅记 uid
  S.equip[ITEMS[g.id].slot] = uid;
  clampHp();
  toast(`已佩【${gearName(g)}】`);
  renderPage();
}
function unequip(slot) {
  const uid = S.equip[slot]; if (!uid) return;
  S.equip[slot] = null;
  clampHp();
  renderPage();
}
function sellGear(uid) {
  const g = gearByUid(uid); if (!g) return;
  if (isWorn(uid)) return toast('佩戴中的法器不可卖出', true);
  const v = gearSell(g);
  S.gear = S.gear.filter(x => x.uid !== uid);
  S.gp += v;
  toast(`卖出【${gearName(g)}】，得 ${v} 灵石`);
  renderPage();
}

/* ==================== UI ==================== */
const NAV = [
  ['home', '主', '总览'],
  ['qi', '气', '炼气'],
  ['herb', '药', '采药'],
  ['mine', '矿', '挖矿'],
  ['alchemy', '丹', '炼丹'],
  ['smith', '器', '炼器'],
  ['combat', '斗', '斗法'],
  ['bag', '袋', '乾坤袋'],
  ['shop', '市', '坊市'],
  ['settings', '设', '设置'],
];
function renderNav() {
  $('#nav').innerHTML = NAV.map(([id, ic, label]) => {
    const lv = SKILLS[id] ? `<span class="nlv">${levelFromXp(S.skills[id].xp)}层</span>` : '';
    return `<div class="nav-item${curPage === id ? ' active' : ''}" data-act="nav" data-arg="${id}">
      <span class="ni">${ic}</span><span class="nl">${label}</span>${lv}</div>`;
  }).join('');
}
function renderTop() {
  const max = playerMaxHp();
  const buffs = buffList().map(id => {
    const left = Math.ceil((S.buffs[id] - now()) / 1000);
    return `<span class="buff-chip">${ITEMS[id].icon} ${ITEMS[id].name} ${fmtTime(left)}</span>`;
  }).join('');
  $('#top').innerHTML = `
    <div class="stat"><span class="realm-name">${realmName()}</span></div>
    <div class="stat">斗法 <b>${clv()} 层</b></div>
    <div class="stat">灵石 <b>${fmt(S.gp)}</b></div>
    <div class="hp-wrap"><span class="stat">气血</span>
      <div class="bar"><div class="bar-fill hp" style="width:${S.hp / max * 100}%"></div>
      <span>${Math.ceil(S.hp)} / ${max}</span></div>
    </div>
    <div id="buffs">${buffs}</div>`;
}
function renderAll() { renderNav(); renderTop(); renderPage(); }
function renderPage() {
  renderNav(); renderTop();
  $('#page').innerHTML = pageHtml(curPage);
  const fl = $('#flog');                         // 页面重建会丢滚动位置，战斗日志须恢复到底部
  if (fl) fl.scrollTop = fl.scrollHeight;
}

/* ---------- 页面模板 ---------- */
function pageHtml(page) {
  if (page === 'home') return homeHtml();
  if (GATHER_SKILLS.includes(page)) return gatherHtml(page);
  if (page === 'alchemy') return alchemyHtml();
  if (page === 'smith') return smithHtml();
  if (page === 'combat') return combatHtml();
  if (page === 'bag') return bagHtml();
  if (page === 'shop') return shopHtml();
  if (page === 'settings') return settingsHtml();
  return '<p>迷路了……</p>';
}

function homeHtml() {
  const totalLv = Object.keys(SKILLS).reduce((s, k) => s + levelFromXp(S.skills[k].xp), 0);
  const skillCards = Object.keys(SKILLS).map(k => `
    <div class="card" data-act="nav" data-arg="${k}" style="cursor:pointer">
      <div class="card-head"><span class="ic">${SKILLS[k].icon}</span>
        <div><div class="card-title">${SKILLS[k].name}</div><div class="card-sub">${levelFromXp(S.skills[k].xp)} / ${MAX_LV} 层</div></div>
      </div>
      <div class="card-rows">${SKILLS[k].desc}</div>
      <div class="bar" style="height:6px"><div class="bar-fill prog" style="width:${xpPct(k)}%"></div></div>
    </div>`).join('');
  const logs = S.logs.slice(0, 12).map(l => `<div class="${l.cls || ''}">· ${esc(l.msg)}</div>`).join('') || '<div class="hint">初入道途，尚无事迹。去修炼第一门功法吧。</div>';
  const act = S.active ? activeName() : '闲置中';
  return `
    <div class="hero">
      <span class="ic lg">${realmName()[0]}</span>
      <div class="hero-info">
        <h2>${realmName()}</h2>
        <p>${SKILLS.combat.desc}。当前正：${act}</p>
        <div class="kv">
          <div><div class="k">总修为</div><div class="v">${totalLv} 层</div></div>
          <div><div class="k">灵石</div><div class="v">${fmt(S.gp)}</div></div>
          <div><div class="k">攻 / 防 / 暴</div><div class="v">${playerAtk()} / ${playerDef()} / ${playerCrit()}%</div></div>
        </div>
      </div>
    </div>
    <div class="section-title">功法</div>
    <div class="grid">${skillCards}</div>
    <div class="section-title">道途记事</div>
    <div class="loglist">${logs}</div>`;
}
function xpPct(skill) {
  const l = levelFromXp(S.skills[skill].xp);
  if (l >= MAX_LV) return 100;
  const cur = S.skills[skill].xp - XP_TABLE[l], need = XP_TABLE[l + 1] - XP_TABLE[l];
  return Math.min(100, cur / need * 100);
}
/* 技能页顶部状态卡：当前等级 + 经验条 */
function skillHeaderHtml(skill) {
  const sk = SKILLS[skill];
  const lv = levelFromXp(S.skills[skill].xp);
  const pct = xpPct(skill);
  const full = lv >= MAX_LV;
  const cur = S.skills[skill].xp - XP_TABLE[lv];
  const need = full ? 0 : XP_TABLE[lv + 1] - XP_TABLE[lv];
  const next = full ? '已臻化境，此道登峰造极' : `距下一层还需 <b>${fmt(need - cur)}</b> 修为`;
  return `
  <div class="card" style="margin-bottom:16px">
    <div class="card-head"><span class="ic">${sk.icon}</span>
      <div><div class="card-title">${sk.name} · ${lv} / ${MAX_LV} 层</div>
      <div class="card-sub">${sk.desc}</div></div>
    </div>
    <div class="bar" style="height:12px">
      <div class="bar-fill prog" style="width:${pct}%"></div>
      <span>${full ? '此道圆满' : fmt(cur) + ' / ' + fmt(need) + '（' + pct.toFixed(1) + '%）'}</span>
    </div>
    <div class="hint" style="margin:6px 0 0">${next}</div>
  </div>`;
}
function activeName() {
  const a = S.active;
  if (a.type === 'gather') return GATHER_ACTIONS[a.skill][a.idx].name;
  if (a.type === 'craft') return (a.kind === 'alchemy' ? RECIPES_ALCHEMY : RECIPES_SMITH)[a.idx].name;
  if (a.type === 'combat') return '与妖缠斗';
  return '闲置中';
}

function gatherHtml(skill) {
  const sk = SKILLS[skill], lv = levelFromXp(S.skills[skill].xp);
  const cards = GATHER_ACTIONS[skill].map((a, i) => {
    const locked = lv < a.lv;
    const on = S.active && S.active.type === 'gather' && S.active.skill === skill && S.active.idx === i;
    return `
    <div class="card${on ? ' active' : ''}${locked ? ' locked' : ''}">
      ${on ? '<span class="badge">修炼中</span>' : ''}
      <div class="card-head"><span class="ic">${ITEMS[a.item].icon}</span>
        <div><div class="card-title">${a.name}</div>
        <div class="card-sub lvreq ${locked ? 'no' : 'ok'}">需 ${sk.name} ${a.lv} 层</div></div>
      </div>
      <div class="card-rows">产出 <b>${ITEMS[a.item].name}</b> ×${a.count}${a.bonus ? `<span class="txt-dim">，偶得 ${ITEMS[a.bonus.item].name}</span>` : ''}<br>耗时 <b>${a.time}s</b> · 修为 <b>${a.xp}</b></div>
      ${on ? '<div class="card-prog"><div class="bar"><div class="bar-fill prog" id="progbar" style="width:0%"></div></div></div>' : ''}
      <div class="card-actions">${locked ? '' :
      `<button class="btn ${on ? 'danger' : 'gold'}" data-act="${on ? 'stop' : 'gather'}" data-arg="${skill}:${i}">${on ? '收功' : '开始'}</button>`}
      </div>
    </div>`;
  }).join('');
  return `<div class="section-title">${sk.name}</div>
    ${skillHeaderHtml(skill)}
    <p class="hint">选择一处修炼，人物会自动循环，离线亦不辍。</p>
    <div class="grid">${cards}</div>`;
}

function craftCard(kind, idx) {
  const r = kind === 'alchemy' ? RECIPES_ALCHEMY[idx] : RECIPES_SMITH[idx];
  const lv = levelFromXp(S.skills[kind].xp);
  const locked = lv < r.lv;
  const on = S.active && S.active.type === 'craft' && S.active.kind === kind && S.active.idx === idx;
  const mats = Object.keys(r.mats).map(id => {
    const ok = cnt(id) >= r.mats[id];
    return `<span class="mat ${ok ? 'ok' : 'no'}">${ITEMS[id].icon} ${ITEMS[id].name} ${cnt(id)}/${r.mats[id]}</span>`;
  }).join('');
  const rate = kind === 'alchemy' ? `成功率 <b>${Math.min(99, Math.round((r.base + lv * 0.004) * 100))}%</b>（失败损料）<br>` : '必定成功<br>';
  return `
  <div class="card${on ? ' active' : ''}${locked ? ' locked' : ''}">
    ${on ? '<span class="badge">炼制中</span>' : ''}
    <div class="card-head"><span class="ic">${ITEMS[r.item].icon}</span>
      <div><div class="card-title">${r.name}</div>
      <div class="card-sub lvreq ${locked ? 'no' : 'ok'}">需 ${SKILLS[kind].name} ${r.lv} 层</div></div>
    </div>
    <div class="mats">${mats}</div>
    <div class="card-rows">${rate}耗时 <b>${r.time}s</b> · 修为 <b>${r.xp}</b></div>
    ${on ? '<div class="card-prog"><div class="bar"><div class="bar-fill prog" id="progbar" style="width:0%"></div></div></div>' : ''}
    <div class="card-actions">${locked ? '' :
    `<button class="btn ${on ? 'danger' : 'gold'}" data-act="${on ? 'stop' : 'craft'}" data-arg="${kind}:${idx}">${on ? '收炉' : '开炉'}</button>`}
    </div>
  </div>`;
}
function alchemyHtml() {
  return `<div class="section-title">炼丹</div>
  ${skillHeaderHtml('alchemy')}
  <p class="hint">丹成可续命、可增益。丹术越高，成丹率越高（+0.4%/层）。</p>
  <div class="grid">${RECIPES_ALCHEMY.map((r, i) => craftCard('alchemy', i)).join('')}</div>`;
}
function smithHtml() {
  return `<div class="section-title">炼器</div>
  ${skillHeaderHtml('smith')}
  <p class="hint">以矿石与灵气锻法器、织法衣。器成必得，佩于乾坤袋中可穿戴；炼器之道越高，越易出绝世之器。</p>
  <div class="grid">${RECIPES_SMITH.map((r, i) => craftCard('smith', i)).join('')}</div>`;
}

function combatHtml() {
  const inFight = S.active && S.active.type === 'combat';
  let html = `<div class="section-title">斗法</div>`;
  if (inFight) {
    const e = ENEMIES.find(x => x.id === S.combat.enemyId);
    const resp = S.combat.respT > 0;
    html += `
    <div class="combat-wrap">
      <div class="fighter">
        <div class="fh"><span class="ic">我</span><div><div class="fname">道友</div><div class="flv">${realmName()} · ${clv()} 层</div></div></div>
        <div class="bar" style="height:18px"><div class="bar-fill hp" style="width:${Math.max(0, S.hp / playerMaxHp() * 100)}%"></div>
          <span>${Math.max(0, Math.ceil(S.hp))} / ${playerMaxHp()}</span></div>
        <div class="frows">攻 <b>${playerAtk()}</b> · 防 <b>${playerDef()}</b> · 暴击 <b>${playerCrit()}%</b><br>出手间隔 <b>2.2s</b></div>
      </div>
      <div class="vs">对</div>
      <div class="fighter foe">
        <div class="fh"><span class="ic">${e.icon}</span><div><div class="fname">${e.name}</div><div class="flv">${e.lv} 层妖物</div></div></div>
        <div class="bar" style="height:18px"><div class="bar-fill ehp" style="width:${Math.max(0, S.combat.ehp / e.hp * 100)}%"></div>
          <span>${Math.max(0, Math.ceil(S.combat.ehp))} / ${e.hp}</span></div>
        <div class="frows">攻 <b>${e.atk}</b> · 防 <b>${e.def}</b><br>出手间隔 <b>${e.atkTime}s</b></div>
      </div>
    </div>
    <div class="card-actions" style="margin-bottom:12px">
      ${resp ? '<span class="hint">妖兽重整旗鼓中……</span>' : ''}
      <label class="toggle-row"><input type="checkbox" data-act="toggle" data-arg="autoEat" ${S.autoEat ? 'checked' : ''}> 自动嗑丹（气血低于五成服回气丹）</label>
      <label class="toggle-row"><input type="checkbox" data-act="toggle" data-arg="autoFight" ${S.autoFight ? 'checked' : ''}> 自动再战</label>
      <button class="btn danger" data-act="stop">遁走</button>
    </div>
    <div class="section-title" style="font-size:13px">随身丹药</div>
    <div class="card-actions" style="margin-bottom:12px">
      ${Object.keys(ITEMS).filter(id => ITEMS[id].type === 'pill' && cnt(id) > 0)
        .map(id => `<button class="btn sm" data-act="use" data-arg="${id}">${ITEMS[id].name}×${cnt(id)}</button>`).join('') || '<span class="hint">身无丹药。</span>'}
    </div>
    <div class="flog" id="flog">${S.fightLog.map(l => `<div class="${l.cls || ''}">${esc(l.msg)}</div>`).join('')}</div>`;
  } else {
    html += `${skillHeaderHtml('combat')}
    <p class="hint">胜妖可得灵石、妖丹与炼丹之材，更有机缘夺其随身异宝（皆不可炼制，稀有度随缘）。斗法修为越高，气血与攻击越强。败则重伤被救，无性命之忧。</p>
    <div class="grid">${ENEMIES.map(e => {
      const locked = clv() + 2 < e.lv;
      const gd = GEAR_DROPS[e.id];
      const gearRow = gd ? `<br>异宝：${gd.pool.map(id => `<span class="txt-gold">${ITEMS[id].name}</span>`).join('、')} <b>${Math.round(gd.chance * 100)}%</b>` : '';
      return `
      <div class="card${locked ? ' locked' : ''}">
        <div class="card-head"><span class="ic">${e.icon}</span>
          <div><div class="card-title">${e.name}</div>
          <div class="card-sub lvreq ${locked ? 'no' : 'ok'}">${locked ? `需斗法 ${e.lv - 2} 层` : `${e.lv} 层妖物`}</div></div>
        </div>
        <div class="card-rows">气血 <b>${e.hp}</b> · 攻 <b>${e.atk}</b> · 防 <b>${e.def}</b><br>修为 <b>${e.xp}</b> · 灵石 <b>${e.gp[0]}~${e.gp[1]}</b><br>
        掉落：${e.drops.map(([id, c]) => `${ITEMS[id].name} ${Math.round(c * 100)}%`).join('、')}${gearRow}</div>
        <div class="card-actions">${locked ? '' : `<button class="btn gold" data-act="fight" data-arg="${e.id}">挑战</button>`}</div>
      </div>`;
    }).join('')}</div>`;
  }
  return html;
}

function bagHtml() {
  const worn = SLOTS.map(([slot, label]) => {
    const uid = S.equip[slot];
    const g = uid ? gearByUid(uid) : null;
    const head = `<div class="card-head"><span class="ic ${g ? RARITY[g.rarity].cls : ''}">${g ? ITEMS[g.id].icon : '空'}</span>
      <div><div class="card-title ${g ? RARITY[g.rarity].cls : ''}">${label} · ${g ? esc(gearName(g)) : '无'}</div>
      <div class="card-sub">${g ? fmtEquip(gearStats(g)) : '未佩戴'}</div></div></div>`;
    const aff = g && g.affixes.length ? `<div class="card-rows">${g.affixes.map(affixText).join('　')}</div>` : '';
    return `<div class="card">${head}${aff}${g ? `<div class="card-actions"><button class="btn sm danger" data-act="unequip" data-arg="${slot}">取下</button></div>` : ''}</div>`;
  }).join('');
  const gearCards = S.gear.filter(g => !isWorn(g.uid)).map(g => {
    const r = RARITY[g.rarity];
    return `
    <div class="card">
      <div class="card-head"><span class="ic ${r.cls}">${ITEMS[g.id].icon}</span>
        <div><div class="card-title ${r.cls}">${esc(gearName(g))}</div>
        <div class="card-sub">价值 ${gearSell(g)} 灵石</div></div>
      </div>
      <div class="card-rows">属性：<b>${fmtEquip(gearStats(g))}</b>${g.affixes.length ? '<br>' + g.affixes.map(affixText).join('　') : ''}</div>
      <div class="card-actions">
        <button class="btn sm gold" data-act="equip" data-arg="${g.uid}">佩戴</button>
        <button class="btn sm" data-act="sell-gear" data-arg="${g.uid}">卖出</button>
      </div>
    </div>`;
  }).join('');
  const ids = Object.keys(ITEMS).filter(id => cnt(id) > 0 && ITEMS[id].type !== 'equip');
  const order = { mat: 0, pill: 1 };
  ids.sort((a, b) => order[ITEMS[a].type] - order[ITEMS[b].type]);
  const cards = ids.map(id => {
    const it = ITEMS[id];
    return `
    <div class="card">
      <div class="card-head"><span class="ic-wrap"><span class="ic">${it.icon}</span></span>
        <div><div class="card-title">${it.name} ×${fmt(cnt(id))}</div>
        <div class="card-sub">价值 ${it.sell} 灵石</div></div>
      </div>
      <div class="card-rows">${it.desc || ''}</div>
      <div class="card-actions">
        ${it.type === 'pill' ? `<button class="btn sm gold" data-act="use" data-arg="${id}">服用</button>` : ''}
        <button class="btn sm" data-act="sell" data-arg="${id}:1">卖 1</button>
        <button class="btn sm" data-act="sell" data-arg="${id}:all">全卖</button>
      </div>
    </div>`;
  }).join('');
  const hasBag = S.gear.length || ids.length;
  return `<div class="section-title">随身法器</div><div class="grid">${worn}</div>
    <div class="section-title">乾坤袋</div>
    ${hasBag ? `<div class="grid">${gearCards}${cards}</div>` : '<p class="hint">袋中空空，一无所有。</p>'}`;
}
function fmtEquip(e) {
  const p = [];
  if (e.atk) p.push(`攻+${e.atk}`);
  if (e.def) p.push(`防+${e.def}`);
  if (e.hp) p.push(`血+${e.hp}`);
  if (e.crit) p.push(`暴+${e.crit}%`);
  return p.join(' ') || '无';
}

function shopHtml() {
  const cards = SHOP.map(({ item, price }) => `
    <div class="card">
      <div class="card-head"><span class="ic">${ITEMS[item].icon}</span>
        <div><div class="card-title">${ITEMS[item].name}</div><div class="card-sub">持有 ${cnt(item)}</div></div>
      </div>
      <div class="card-rows">${ITEMS[item].desc}<br>单价 <b>${price}</b> 灵石</div>
      <div class="card-actions">
        <button class="btn sm gold" data-act="buy" data-arg="${item}:1">买 1</button>
        <button class="btn sm" data-act="buy" data-arg="${item}:10">买 10</button>
      </div>
    </div>`).join('');
  return `<div class="section-title">坊市</div>
  <p class="hint">散修坊市，以灵石易物。材料与多余法器可在乾坤袋中卖出来钱。</p>
  <div class="grid">${cards}</div>`;
}

function settingsHtml() {
  return `<div class="section-title">设置</div>
  <div class="grid">
    <div class="card">
      <div class="card-title" style="margin-bottom:8px">存档</div>
      <p class="hint">游戏每 15 秒自动保存于本机浏览器。关闭页面不影响进度；离线时挂机修炼照常结算（上限 8 小时）。</p>
      <div class="card-actions">
        <button class="btn gold" data-act="save">立即保存</button>
        <button class="btn danger" data-act="reset">散功重修（清档）</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:8px">携档云游</div>
      <p class="hint">复制下方密文可备份存档；将密文粘贴至输入框可读档。</p>
      <textarea id="exp-box" readonly>${exportSave()}</textarea>
      <div class="card-actions"><button class="btn sm" data-act="copy">复制密文</button></div>
      <textarea id="imp-box" placeholder="将存档密文粘贴于此" style="margin-top:8px"></textarea>
      <div class="card-actions"><button class="btn sm gold" data-act="import">读档</button></div>
    </div>
  </div>
  <div class="section-title">玩法说明</div>
  <p class="hint">炼气、采药、挖矿：点击开始即自动循环产出材料与修为；<br>
  炼丹：草木妖丹入炉，炼出回气丹与增益丹（丹术越高成丹率越高）；<br>
  炼器：以矿石灵气锻剑织甲，佩于乾坤袋增强斗法；<br>
  斗法：挑战妖物，自动战斗、自动嗑丹、自动再战；妖丹与材料用于炼丹炼器；<br>
  境界：随斗法修为从练气一路修至大乘。愿你大道可期。</p>`;
}

/* ---------- 动态更新（不打断交互） ---------- */
function updateDynamic() {
  renderTop();
  if (S.active && S.active.type === 'combat' && curPage === 'combat') updateCombatView();
  else if (S.active && (S.active.type === 'gather' || S.active.type === 'craft')) {
    const bar = $('#progbar');
    if (bar) {
      let total = 0;
      if (S.active.type === 'gather') total = GATHER_ACTIONS[S.active.skill][S.active.idx].time;
      else total = (S.active.kind === 'alchemy' ? RECIPES_ALCHEMY : RECIPES_SMITH)[S.active.idx].time;
      bar.style.width = Math.min(100, S.progress / total * 100) + '%';
    }
  }
}
let lastFlogSeq = -1;
function updateCombatView() {
  const e = ENEMIES.find(x => x.id === S.combat.enemyId);
  if (!e) return;
  const eb = document.querySelector('.fighter.foe .bar-fill');
  if (eb) {
    eb.style.width = Math.max(0, S.combat.ehp / e.hp * 100) + '%';
    const sp = eb.parentElement.querySelector('span');
    if (sp) sp.textContent = `${Math.max(0, Math.ceil(S.combat.ehp))} / ${e.hp}`;
  }
  const pb = document.querySelector('.fighter:not(.foe) .bar-fill');
  if (pb) {
    pb.style.width = Math.max(0, S.hp / playerMaxHp() * 100) + '%';
    const sp = pb.parentElement.querySelector('span');
    if (sp) sp.textContent = `${Math.max(0, Math.ceil(S.hp))} / ${playerMaxHp()}`;
  }
  const fl = $('#flog');
  if (fl && flogSeq !== lastFlogSeq) {
    lastFlogSeq = flogSeq;
    fl.innerHTML = S.fightLog.map(l => `<div class="${l.cls || ''}">${esc(l.msg)}</div>`).join('');
    fl.scrollTop = fl.scrollHeight;
  }
}

/* ---------- 事件 ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const act = el.dataset.act, arg = el.dataset.arg;
  lastFlogSeq = -1;
  switch (act) {
    case 'nav': curPage = arg; renderPage(); break;
    case 'gather': { const [s, i] = arg.split(':'); startGather(s, +i); break; }
    case 'craft': { const [k, i] = arg.split(':'); startCraft(k, +i); break; }
    case 'fight': startFight(arg); break;
    case 'stop': stopActive(); break;
    case 'use': eatPill(arg); break;
    case 'equip': equipItem(+arg); break;
    case 'unequip': unequip(arg); break;
    case 'sell': { const [id, n] = arg.split(':'); sellItem(id, n === 'all' ? 'all' : 1); break; }
    case 'sell-gear': sellGear(+arg); break;
    case 'buy': { const [id, n] = arg.split(':'); buyItem(id, +n); break; }
    case 'toggle': break; // checkbox 用 change 事件
    case 'save': save(); toast('已保存'); break;
    case 'copy': { const b = $('#exp-box'); b.select(); document.execCommand && document.execCommand('copy'); toast('密文已复制'); break; }
    case 'import': { const v = $('#imp-box').value; if (v.trim()) { if (confirm('读档将覆盖当前进度，确定？')) importSave(v); } break; }
    case 'reset': if (confirm('散功重修将清除全部进度，确定？')) { if (confirm('真的要斩断前尘吗？')) { localStorage.removeItem(SAVE_KEY); S = defaultState(); renderAll(); toast('前尘尽散，重入道途'); } } break;
  }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-act="toggle"]');
  if (el) { S[el.dataset.arg] = el.checked; }
});

function clampHp() { const m = playerMaxHp(); if (S.hp > m) S.hp = m; if (S.hp < 1) S.hp = 1; }

/* ---------- 主循环 ---------- */
let lastTick = now();
setInterval(function () {
  const t = now();
  const dt = Math.min(1, (t - lastTick) / 1000);   // 单步上限 1s，防止休眠后瞬杀
  lastTick = t;
  try { advance(dt); }
  catch (err) { console.error('advance 异常（已跳过本拍）:', err); }   // 单次内容异常不中断挂机
}, 100);
function bindScroll() { const p = $('#page'); if (p) p.scrollTop = 0; }

/* ---------- 启动 ---------- */
load();
applyOffline();
renderAll();
setInterval(save, 15000);
setInterval(updateDynamic, 250);
window.addEventListener('beforeunload', save);
