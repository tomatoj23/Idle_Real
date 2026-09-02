'use strict';
/* =====================================================================
   暗渊 DARK ABYSS —— 2D 俯视角 Diablo-like 单机 ARPG 原型
   零依赖 · 纯 Canvas 程序化美术 · 本地存档
   ===================================================================== */

/* ---------------- 工具 ---------------- */
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const rand=(a,b)=>a+Math.random()*(b-a);
const irand=(a,b)=>Math.floor(rand(a,b+1));
const lerp=(a,b,t)=>a+(b-a)*t;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function hash2(x,y){let h=(x*374761393+y*668265263)|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}

/* ---------------- 常量 ---------------- */
const TILE=40, MW=44, MH=44;
const SAVE_KEY='darkabyss_v1';
const ICONS={weapon:'ic-sword',helm:'ic-helm',armor:'ic-armor',ring:'ic-ring'};

/* ---------------- 全局状态 ---------------- */
const G={
  state:'title', floor:1, cam:{x:0,y:0}, shake:0, hurtT:0, paused:false, mute:false,
  transT:-1, transMid:false, time:0, saveT:0, tutorialT:14, boss:null,
  mouse:{x:0,y:0,down:false}, keys:{}
};
let player=null, enemies=[], projectiles=[], drops=[], particles=[], texts=[];
let map=null, rooms=[], torches=[], stairs=null, altar=null;

/* ---------------- Canvas ---------------- */
const cv=$('cv'), ctx=cv.getContext('2d');
const lightCv=document.createElement('canvas'), lctx=lightCv.getContext('2d');
const miniCv=document.createElement('canvas'); miniCv.width=MW; miniCv.height=MH;
const mctx=miniCv.getContext('2d');
let VW=window.innerWidth||1280, VH=window.innerHeight||720, DPR=1;

function resize(){
  DPR=Math.min(window.devicePixelRatio||1,1.5);
  VW=window.innerWidth; VH=window.innerHeight;
  cv.width=Math.round(VW*DPR); cv.height=Math.round(VH*DPR);
  cv.style.width=VW+'px'; cv.style.height=VH+'px';
  lightCv.width=cv.width; lightCv.height=cv.height;
}

/* ---------------- 敌人模板 ---------------- */
const EMOBS={
  skeleton:{n:'骷髅兵', hp:26, atk:6,  def:0, spd:78,  r:12, ai:'melee',  exp:11,  gold:4,   c:'#e8e4d4'},
  bat:     {n:'洞穴蝠', hp:14, atk:4,  def:0, spd:132, r:9,  ai:'bat',    exp:8,   gold:2,   c:'#8a6ab8'},
  zombie:  {n:'腐尸',   hp:55, atk:9,  def:2, spd:46,  r:13, ai:'melee',  exp:18,  gold:6,   c:'#6a7d4a'},
  cultist: {n:'邪教徒', hp:30, atk:8,  def:0, spd:66,  r:12, ai:'ranged', exp:20,  gold:8,   c:'#9a5ae0'},
  brute:   {n:'石窟巨兽',hp:95,atk:14, def:4, spd:56,  r:16, ai:'melee',  exp:32,  gold:12,  c:'#b07840'},
  demon:   {n:'深渊魔君',hp:560,atk:22,def:6, spd:64,  r:26, ai:'boss',   exp:240, gold:140, c:'#c03030'}
};
const ELITES=[
  {id:'swift',  n:'迅捷', c:'#6fd8ff', mod:e=>{e.spd*=1.5;}},
  {id:'tough',  n:'坚韧', c:'#ffa040', mod:e=>{e.maxHp=Math.round(e.maxHp*2.2);e.hp=e.maxHp;e.def=Math.round(e.def*1.5+2);}},
  {id:'burning',n:'炽焰', c:'#ff5050', mod:e=>{e.boom=true;}},
  {id:'regen',  n:'再生', c:'#6fe86f', mod:e=>{e.regen=0.03;}}
];

/* ---------------- 地图生成 ---------------- */
function isWallTile(tx,ty){ return tx<0||ty<0||tx>=MW||ty>=MH||map[ty][tx]===0; }

function genFloor(f){
  map=[]; rooms=[]; torches=[]; enemies=[]; projectiles=[]; drops=[]; particles=[]; texts=[];
  stairs=null; altar=null; G.boss=null;
  for(let y=0;y<MH;y++){ map.push(new Array(MW).fill(0)); }
  // 随机不重叠房间
  for(let i=0;i<70&&rooms.length<9;i++){
    const w=irand(4,9), h=irand(4,8);
    const x=irand(2,MW-w-3), y=irand(2,MH-h-3);
    let ok=true;
    for(const r of rooms){ if(x<r.x+r.w+2&&x+w+2>r.x&&y<r.y+r.h+2&&y+h+2>r.y){ok=false;break;} }
    if(!ok) continue;
    rooms.push({x,y,w,h,cx:x+(w>>1),cy:y+(h>>1)});
    for(let ty=y;ty<y+h;ty++)for(let tx=x;tx<x+w;tx++) map[ty][tx]=1;
  }
  // L 型走廊连接
  const dig=(x,y)=>{ if(x>0&&y>0&&x<MW-1&&y<MH-1) map[y][x]=1; };
  for(let i=1;i<rooms.length;i++){
    const a=rooms[i-1], b=rooms[i];
    let x=a.cx, y=a.cy;
    if(Math.random()<0.5){
      while(x!==b.cx){ dig(x,y); x+=Math.sign(b.cx-x); }
      while(y!==b.cy){ dig(x,y); y+=Math.sign(b.cy-y); }
    }else{
      while(y!==b.cy){ dig(x,y); y+=Math.sign(b.cy-y); }
      while(x!==b.cx){ dig(x,y); x+=Math.sign(b.cx-x); }
    }
    dig(b.cx,b.cy);
  }
  // 回环走廊
  for(let i=0;i<2&&rooms.length>3;i++){
    const a=rooms[irand(0,rooms.length-1)], b=rooms[irand(0,rooms.length-1)];
    if(a===b) continue;
    let x=a.cx,y=a.cy;
    while(x!==b.cx){ dig(x,y); x+=Math.sign(b.cx-x); }
    while(y!==b.cy){ dig(x,y); y+=Math.sign(b.cy-y); }
  }
  // 火把：地板上方的墙面
  for(let y=1;y<MH;y++)for(let x=0;x<MW;x++){
    if(map[y][x]===0&&map[y+1]&&map[y+1][x]===1&&hash2(x*7+f,y*13)<0.10)
      torches.push({x:x*TILE+TILE/2, y:y*TILE+TILE+4, ph:rand(0,6.28)});
  }
  // 出生点与楼梯（最远房间）
  const start=rooms[0];
  player.x=start.cx*TILE+TILE/2; player.y=start.cy*TILE+TILE/2;
  let far=rooms[0], fd=0;
  for(const r of rooms){ const d=Math.hypot(r.cx-start.cx,r.cy-start.cy); if(d>fd){fd=d;far=r;} }
  stairs={x:far.cx*TILE+TILE/2, y:far.cy*TILE+TILE/2, locked:(f%5===0)};
  // 祭坛
  if(rooms.length>2){
    const mid=rooms[irand(1,rooms.length-1)];
    altar={x:mid.cx*TILE+TILE/2+20, y:mid.cy*TILE+TILE/2+20};
  }
  // 怪物
  const bossFloor=(f%5===0);
  const pool=[];
  pool.push('skeleton','bat');
  if(f>=2) pool.push('zombie');
  if(f>=3) pool.push('cultist');
  if(f>=4) pool.push('brute','cultist');
  for(let i=1;i<rooms.length;i++){
    const r=rooms[i];
    if(r===far&&bossFloor) continue;
    const n=(r===far)?irand(3,5):irand(2,4);
    for(let j=0;j<n;j++){
      const tx=irand(r.x,r.x+r.w-1), ty=irand(r.y,r.y+r.h-1);
      spawnEnemy(pool[irand(0,pool.length-1)], tx*TILE+TILE/2, ty*TILE+TILE/2, f, Math.random()<0.13);
    }
  }
  if(bossFloor){
    spawnEnemy('demon', far.cx*TILE+TILE/2, far.cy*TILE+TILE/2, f, false);
  }
  buildMinimap();
  G.cam.x=player.x; G.cam.y=player.y;
  G.saveT=0;
}

function spawnEnemy(type,x,y,f,elite){
  const t=EMOBS[type];
  const hpS=1+0.42*(f-1), atkS=1+0.3*(f-1);
  const e={type, n:t.n, ai:t.ai, c:t.c, x, y, r:t.r,
    maxHp:Math.round(t.hp*hpS), hp:0, atk:Math.round(t.atk*atkS), def:t.def,
    spd:t.spd*rand(0.9,1.1), exp:Math.round(t.exp*(1+0.2*(f-1))), gold:t.gold,
    atkCd:rand(0.3,1), shootCd:rand(1,2.2), animT:rand(0,9), hitFlash:0, hpBarT:0,
    aggro:false, slowT:0, dead:false, elite:null, vx:0, vy:0, cast:0, rageT:0};
  e.hp=e.maxHp;
  if(elite&&type!=='demon'){
    e.elite=ELITES[irand(0,ELITES.length-1)];
    e.elite.mod(e); e.n=e.elite.n+'·'+e.n; e.exp=Math.round(e.exp*2.4);
  }
  enemies.push(e);
  return e;
}

/* ---------------- 小地图底图 ---------------- */
function buildMinimap(){
  mctx.fillStyle='#060508'; mctx.fillRect(0,0,MW,MH);
  for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){
    if(map[y][x]===1){ mctx.fillStyle='#4a4458'; mctx.fillRect(x,y,1,1); }
  }
}

/* ---------------- 玩家 ---------------- */
function newPlayer(){
  return {x:0,y:0,r:11,face:1,walkT:0,swingT:0,swingCd:0,moving:false,
    level:1,exp:0,statPts:0,str:5,agi:5,vit:5,en:5,
    gold:30,killCount:0,
    potions:{hp:3,mp:2}, inv:[], equip:{weapon:null,helm:null,armor:null,ring:null},
    hp:1,maxHp:1,mp:1,maxMp:1,atk:0,armor:0,crit:5,as:100,ms:175,ls:0,sp:0,fire:0,range:52,
    skills:{fire:{cd:0},nova:{cd:0},heal:{cd:0}}, outCombat:0};
}
function recomputeStats(){
  const p=player;
  const g={};
  for(const k in p.equip){ const it=p.equip[k]; if(it){ for(const s in it.stats) g[s]=(g[s]||0)+it.stats[s]; } }
  const oHp=p.maxHp, oMp=p.maxMp;
  p.maxHp=Math.round(40+p.vit*6+p.level*5+(g.hp||0));
  p.maxMp=Math.round(20+p.en*2+(g.mp||0));
  p.atk=Math.round(4+p.str*0.8+(g.atk||0));
  p.armor=Math.round(g.armor||0);
  p.crit=Math.min(60,5+p.agi*0.3+(g.crit||0));
  p.as=clamp(100+p.agi+(g.as||0),40,230);
  p.ms=clamp(175+(g.ms||0),110,280);
  p.ls=Math.max(0,g.ls||0); p.sp=g.sp||0; p.fire=g.fire||0;
  p.range=50+(p.equip.weapon?8:0);
  if(oHp>1){ p.hp=clamp(p.hp+(p.maxHp-oHp),1,p.maxHp); p.mp=clamp(p.mp+(p.maxMp-oMp),0,p.maxMp); }
  else { p.hp=p.maxHp; p.mp=p.maxMp; }
}
function expNeed(lv){ return Math.round(45*Math.pow(lv,1.55)); }
function grantExp(n){
  const p=player; p.exp+=n;
  while(p.exp>=expNeed(p.level)){
    p.exp-=expNeed(p.level); p.level++; p.statPts+=3;
    p.hp=p.maxHp=recomputeAndFull('hp'); p.mp=p.maxMp;
    burst(p.x,p.y,26,'#ffd75e',2.4); ringFx(p.x,p.y,'#ffd75e');
    sfx('level'); addMsg('等级提升至 '+p.level+'！获得 3 属性点（按 C 分配）','#ffd75e');
  }
}
function recomputeAndFull(){ recomputeStats(); player.hp=player.maxHp; player.mp=player.maxMp; return player.maxHp; }

/* ---------------- 背包 / 装备 ---------------- */
function invAdd(it){
  if(player.inv.length>=40){ addMsg('行囊已满！','#ff7a5a'); sfx('deny'); return false; }
  player.inv.push(it); return true;
}
function equipFromInv(idx){
  const it=player.inv[idx]; if(!it) return;
  const cur=player.equip[it.slot];
  player.inv.splice(idx,1);
  player.equip[it.slot]=it;
  if(cur) player.inv.push(cur);
  recomputeStats(); sfx('equip'); renderInv(); save();
}
function unequip(slot){
  const it=player.equip[slot]; if(!it) return;
  if(player.inv.length>=40){ addMsg('行囊已满，无法卸下','#ff7a5a'); return; }
  player.equip[slot]=null; player.inv.push(it);
  recomputeStats(); sfx('equip'); renderInv(); save();
}
function sellFromInv(idx){
  const it=player.inv[idx]; if(!it) return;
  const v=Math.round(it.value*0.6);
  player.inv.splice(idx,1); player.gold+=v;
  sfx('sell'); addMsg('售出 '+it.name+'，获得 '+v+' 金币','#c9a55c');
  renderInv(); save();
}
function usePotion(kind){
  const p=player;
  if(kind==='hp'){
    if(p.potions.hp<=0){ sfx('deny'); return; }
    if(p.hp>=p.maxHp){ return; }
    p.potions.hp--; p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.45);
    burst(p.x,p.y,10,'#6fe86f',1.6); sfx('potion');
  }else{
    if(p.potions.mp<=0){ sfx('deny'); return; }
    if(p.mp>=p.maxMp){ return; }
    p.potions.mp--; p.mp=Math.min(p.maxMp,p.mp+p.maxMp*0.55);
    burst(p.x,p.y,10,'#6fa8ff',1.6); sfx('potion');
  }
}

/* ---------------- 战斗 ---------------- */
function mouseWorld(){ return {x:G.cam.x-VW/2+G.mouse.x, y:G.cam.y-VH/2+G.mouse.y}; }

function findMeleeTarget(mw){
  let best=null, bd=1e9;
  for(const e of enemies){
    const dm=Math.hypot(e.x-mw.x,e.y-mw.y);
    if(dm<46+e.r){
      const dp=dist(player,e);
      if(dp<=player.range+e.r&&dm<bd){ bd=dm; best=e; }
    }
  }
  return best;
}
function tryMelee(t){
  const p=player;
  if(p.swingCd>0) return;
  p.swingCd=0.8*100/p.as; p.swingT=0.22; p.outCombat=0;
  sfx('swing');
  let dmg=p.atk+p.fire*0.6+rand(0,p.atk*0.15);
  const crit=Math.random()*100<p.crit;
  if(crit) dmg*=2;
  const dx=t.x-p.x, dy=t.y-p.y, dd=Math.hypot(dx,dy)||1;
  hurtEnemy(t,dmg,crit,dx/dd*90,dy/dd*90);
}
function hurtEnemy(e,dmg,crit,kx,ky){
  if(e.dead) return;
  const real=Math.max(1,Math.round(dmg*100/(100+e.def)));
  e.hp-=real; e.hitFlash=0.12; e.hpBarT=3; e.aggro=true;
  e.x+=(kx||0)*0.016; e.y+=(ky||0)*0.016;
  addText(e.x+rand(-6,6), e.y-e.r-8, real, crit?'#ffd75e':'#f0f0f0', crit?17:13, crit);
  burst(e.x,e.y,crit?9:5,'#ffca7a',crit?2.2:1.5);
  sfx(crit?'crit':'hit');
  if(e.hp<=0) killEnemy(e);
}
function hurtPlayer(raw){
  const p=player;
  const real=Math.max(1,Math.round(raw*100/(100+p.armor)));
  p.hp-=real; p.outCombat=0; G.hurtT=0.35; G.shake=Math.min(1,G.shake+0.5);
  addText(p.x,p.y-18,real,'#ff6a5a',14,false);
  burst(p.x,p.y,6,'#c03030',1.8); sfx('hurt');
  if(p.hp<=0) die();
}
function killEnemy(e){
  if(e.dead) return;
  e.dead=true; player.killCount++;
  burst(e.x,e.y,14,e.c,2.4); burst(e.x,e.y,6,'#801818',2);
  grantExp(e.exp);
  dropLoot(e);
  if(e.boom){ // 炽焰精英死亡爆炸
    boomFx(e.x,e.y,80,'#ff6a3a');
    if(dist(player,e)<80+player.r) hurtPlayer(e.atk*1.2);
  }
  if(e.ai==='boss'){
    G.boss=null; $('bossbar').classList.add('hidden');
    stairs.locked=false;
    for(let i=0;i<2;i++) drops.push(makeDrop(e.x+rand(-30,30),e.y+rand(-30,30),'item',makeItem(G.floor,3)));
    addMsg('深渊魔君已被讨伐！下行通道已开启','#ffd75e');
    G.shake=1; sfx('roar');
  }
  sfx('die');
}
function enemiesCleanup(){ enemies=enemies.filter(e=>!e.dead); }

/* ---------------- 技能 ---------------- */
const SKILLS={
  fire:{mp:8, cd:0.55},
  nova:{mp:18, cd:6},
  heal:{mp:25, cd:12}
};
function castFireball(wx,wy){
  const p=player, s=SKILLS.fire;
  if(p.skills.fire.cd>0||p.mp<s.mp){ if(p.mp<s.mp) sfx('deny'); return; }
  p.mp-=s.mp; p.skills.fire.cd=s.cd; p.outCombat=0;
  const dx=wx-p.x, dy=wy-p.y, d=Math.hypot(dx,dy)||1;
  projectiles.push({x:p.x+dx/d*14, y:p.y+dy/d*14, vx:dx/d*340, vy:dy/d*340,
    r:7, dmg:16+p.sp*2.4+p.level*1.2, friendly:true, type:'fire', life:2.2, aoe:58});
  sfx('fire');
}
function castNova(){
  const p=player, s=SKILLS.nova;
  if(p.skills.nova.cd>0||p.mp<s.mp){ if(p.mp<s.mp) sfx('deny'); return; }
  p.mp-=s.mp; p.skills.nova.cd=s.cd; p.outCombat=0;
  sfx('nova'); ringFx(p.x,p.y,'#7fd8ff'); G.shake=Math.min(1,G.shake+0.3);
  for(const e of enemies){
    if(dist(player,e)<140+e.r){
      hurtEnemy(e,14+p.sp*2+p.level,false,(e.x-p.x)*1.4,(e.y-p.y)*1.4);
      if(!e.dead) e.slowT=3;
    }
  }
}
function castHeal(){
  const p=player, s=SKILLS.heal;
  if(p.skills.heal.cd>0||p.mp<s.mp){ if(p.mp<s.mp) sfx('deny'); return; }
  if(p.hp>=p.maxHp){ return; }
  p.mp-=s.mp; p.skills.heal.cd=s.cd;
  p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.35+p.sp*2);
  burst(p.x,p.y,16,'#9fffa0',1.8); sfx('heal');
  addText(p.x,p.y-22,'+'+Math.round(p.maxHp*0.35),'#7fff7f',14,false);
}
function castSkill(n,wx,wy){
  if(n===1) castFireball(wx,wy);
  else if(n===2) castNova();
  else if(n===3) castHeal();
}

/* ---------------- 掉落 ---------------- */
function makeDrop(x,y,kind,item,amount){
  const a=rand(0,6.28), sp=rand(40,110);
  return {x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,kind,item,amount:amount||0,t:0,life:60};
}
function dropLoot(e){
  const g=Math.round(e.gold*rand(0.7,1.4));
  drops.push(makeDrop(e.x,e.y,'gold',null,g));
  if(e.ai!=='boss'){
    if(Math.random()<0.11) drops.push(makeDrop(e.x+rand(-14,14),e.y+rand(-14,14),'potion',null,Math.random()<0.5?'hp':'mp'));
    const chance=e.elite?0.55:0.13;
    if(Math.random()<chance) drops.push(makeDrop(e.x+rand(-14,14),e.y+rand(-14,14),'item',makeItem(G.floor)));
  }
}
function pickupDrop(d){
  if(d.kind==='gold'){ player.gold+=d.amount; sfx('coin'); }
  else if(d.kind==='potion'){
    player.potions[d.item]++; sfx('potion');
    addMsg(d.item==='hp'?'拾取 生命药水':'拾取 法力药水','#a8c8e8');
  }else{
    if(!invAdd(d.item)){ return false; }
    const r=RARITY_META[d.item.rarity];
    sfx('equip'); addMsg('拾取 ['+d.item.name+']',r.c);
  }
  return true;
}

/* ---------------- 特效 ---------------- */
function burst(x,y,n,color,pow){
  for(let i=0;i<n;i++){
    const a=rand(0,6.28), sp=rand(30,150)*pow;
    particles.push({type:'dot',x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-40,grav:220,
      life:rand(0.25,0.6),maxLife:0.6,size:rand(1.5,3.5),color});
  }
  if(particles.length>420) particles.splice(0,particles.length-420);
}
function ringFx(x,y,color){
  particles.push({type:'ring',x,y,r:12,vr:420,life:0.42,maxLife:0.42,color,lw:4});
}
function boomFx(x,y,r,color){
  ringFx(x,y,color); burst(x,y,16,color,2.2); G.shake=Math.min(1,G.shake+0.35); sfx('boom');
}
function addText(x,y,txt,color,size,crit){
  texts.push({x,y,vy:-46,txt:String(txt),color,size:size||13,crit:!!crit,life:0.9});
  if(texts.length>60) texts.shift();
}
function addMsg(txt,color){
  const log=$('msglog'), d=document.createElement('div');
  d.textContent=txt; if(color) d.style.color=color;
  log.appendChild(d);
  while(log.children.length>7) log.removeChild(log.firstChild);
  setTimeout(()=>{ try{ log.removeChild(d); }catch(e){} },6100);
}

/* ---------------- 更新 ---------------- */
function moveCircle(o,dx,dy){
  const nx=o.x+dx;
  if(!circleHitsWall(nx,o.y,o.r)) o.x=nx;
  const ny=o.y+dy;
  if(!circleHitsWall(o.x,ny,o.r)) o.y=ny;
}
function circleHitsWall(x,y,r){
  const t0x=Math.floor((x-r)/TILE), t1x=Math.floor((x+r)/TILE);
  const t0y=Math.floor((y-r)/TILE), t1y=Math.floor((y+r)/TILE);
  for(let ty=t0y;ty<=t1y;ty++)for(let tx=t0x;tx<=t1x;tx++){
    if(isWallTile(tx,ty)){
      const cx=clamp(x,tx*TILE,tx*TILE+TILE), cy=clamp(y,ty*TILE,ty*TILE+TILE);
      const dx=x-cx, dy=y-cy;
      if(dx*dx+dy*dy<r*r) return true;
    }
  }
  return false;
}

function update(dt){
  G.time+=dt;
  G.saveT+=dt; if(G.saveT>15){ G.saveT=0; save(); }
  if(G.tutorialT>0){ G.tutorialT-=dt; if(G.tutorialT<=0) $('tips').style.opacity=0; }
  if(G.shake>0) G.shake=Math.max(0,G.shake-dt*2.4);
  if(G.hurtT>0) G.hurtT-=dt;
  // 层间过渡
  if(G.transT>=0){
    G.transT+=dt*1.9;
    if(!G.transMid&&G.transT>=1){ G.transMid=true; doFloorChange(); }
    if(G.transMid&&G.transT>=2){ G.transT=-1; G.transMid=false; }
    return;
  }
  updatePlayer(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateDrops(dt);
  updateFx(dt);
  updateCamera(dt);
  updateHint();
  enemiesCleanup();
}

function updatePlayer(dt){
  const p=player, mw=mouseWorld();
  p.aimX=mw.x; p.aimY=mw.y;
  let mvx=0,mvy=0;
  const k=G.keys;
  if(k.w||k.arrowup) mvy-=1;
  if(k.s||k.arrowdown) mvy+=1;
  if(k.a||k.arrowleft) mvx-=1;
  if(k.d||k.arrowright) mvx+=1;
  if(G.mouse.down){
    const tgt=findMeleeTarget(mw);
    if(tgt){
      p.face=tgt.x<p.x?-1:1;
      tryMelee(tgt);
    }else{
      const d=Math.hypot(mw.x-p.x,mw.y-p.y);
      if(d>10){ mvx+=(mw.x-p.x)/d; mvy+=(mw.y-p.y)/d; }
    }
  }
  const ml=Math.hypot(mvx,mvy);
  if(ml>0){
    mvx/=ml; mvy/=ml;
    moveCircle(p,mvx*p.ms*dt,mvy*p.ms*dt);
    p.walkT+=dt; p.moving=true;
    if(Math.abs(mvx)>0.1) p.face=mvx>0?1:-1;
  }else p.moving=false;
  p.swingT=Math.max(0,p.swingT-dt); p.swingCd=Math.max(0,p.swingCd-dt);
  for(const sk in p.skills) p.skills[sk].cd=Math.max(0,p.skills[sk].cd-dt);
  // 脱战恢复
  p.outCombat+=dt;
  if(p.outCombat>3){
    p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.012*dt);
    p.mp=Math.min(p.maxMp,p.mp+p.maxMp*0.025*dt);
  }
}

function updateEnemies(dt){
  const p=player;
  for(const e of enemies){
    e.animT+=dt; e.hitFlash=Math.max(0,e.hitFlash-dt);
    e.atkCd-=dt; e.shootCd-=dt; e.slowT=Math.max(0,e.slowT-dt);
    e.hpBarT=Math.max(0,e.hpBarT-dt); e.cast=Math.max(0,e.cast-dt);
    if(e.regen) e.hp=Math.min(e.maxHp,e.hp+e.maxHp*e.regen*dt);
    const d=dist(e,p);
    if(!e.aggro&&d<(e.ai==='boss'?420:280)) e.aggro=true;
    if(!e.aggro) continue;
    const spd=e.spd*(e.slowT>0?0.35:1)*(e.rageT>0?1.3:1);
    e.rageT=Math.max(0,e.rageT-dt);
    const dx=p.x-e.x, dy=p.y-e.y, dd=d||1;
    if(e.ai==='melee'||e.ai==='boss'){
      if(d>e.r+p.r+6){ moveCircle(e,dx/dd*spd*dt,dy/dd*spd*dt); e.moving=true; }
      else{
        e.moving=false;
        if(e.atkCd<=0){ e.atkCd=1.15; hurtPlayer(e.atk); }
      }
      if(e.ai==='boss'){
        if(e.shootCd<=0){
          e.shootCd=e.hp<e.maxHp*0.4?3:4.5;
          if(e.hp<e.maxHp*0.4) e.rageT=3;
          for(let i=0;i<8;i++){
            const a=i/8*6.283;
            projectiles.push({x:e.x,y:e.y,vx:Math.cos(a)*180,vy:Math.sin(a)*180,
              r:8,dmg:e.atk*0.8,friendly:false,type:'bfire',life:3,aoe:0});
          }
          e.cast=0.3; sfx('fire');
        }
      }
    }else if(e.ai==='ranged'){
      e.moving=false;
      if(d<130){ moveCircle(e,-dx/dd*spd*dt,-dy/dd*spd*dt); }
      else if(d>300){ moveCircle(e,dx/dd*spd*dt,dy/dd*spd*dt); }
      if(e.shootCd<=0&&d<380){
        e.shootCd=2.3; e.cast=0.35;
        projectiles.push({x:e.x,y:e.y,vx:dx/dd*230,vy:dy/dd*230,
          r:6,dmg:e.atk,friendly:false,type:'ember',life:2.6,aoe:0});
        sfx('fire');
      }
    }else if(e.ai==='bat'){
      const sway=Math.sin(e.animT*6)*0.6;
      moveCircle(e,(dx/dd+(-dy/dd)*sway)*spd*dt,(dy/dd+(dx/dd)*sway)*spd*dt);
      e.moving=true;
      if(d<e.r+p.r+6&&e.atkCd<=0){ e.atkCd=0.9; hurtPlayer(e.atk); }
    }
  }
  // 分离
  for(let i=0;i<enemies.length;i++)for(let j=i+1;j<enemies.length;j++){
    const a=enemies[i], b=enemies[j];
    const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy);
    const min=a.r+b.r;
    if(d>0&&d<min){
      const push=(min-d)/d*0.5;
      a.x-=dx*push; a.y-=dy*push; b.x+=dx*push; b.y+=dy*push;
    }
  }
}

function updateProjectiles(dt){
  for(const pr of projectiles){
    pr.life-=dt;
    pr.x+=pr.vx*dt; pr.y+=pr.vy*dt;
    if(pr.type==='fire'&&Math.random()<0.6)
      particles.push({type:'dot',x:pr.x,y:pr.y,vx:rand(-20,20),vy:rand(-20,20),grav:0,life:0.3,maxLife:0.3,size:rand(1.5,3),color:'#ff9a3c'});
    if(pr.life<=0||isWallTile(Math.floor(pr.x/TILE),Math.floor(pr.y/TILE))){
      if(pr.friendly) fireballBoom(pr);
      pr.life=-1; continue;
    }
    if(pr.friendly){
      for(const e of enemies){
        if(!e.dead&&dist(pr,e)<pr.r+e.r){ fireballBoom(pr); pr.life=-1; break; }
      }
    }else if(dist(pr,player)<pr.r+player.r){
      hurtPlayer(pr.dmg); pr.life=-1;
    }
  }
  projectiles=projectiles.filter(p=>p.life>0);
}
function fireballBoom(pr){
  boomFx(pr.x,pr.y,pr.aoe,'#ff9a3c');
  if(!pr.aoe) return;
  for(const e of enemies){
    if(!e.dead&&dist(pr,e)<pr.aoe+e.r){
      const fall=1-Math.min(1,dist(pr,e)/pr.aoe)*0.4;
      hurtEnemy(e,pr.dmg*fall,false,(e.x-pr.x)*2,(e.y-pr.y)*2);
    }
  }
}

function updateDrops(dt){
  const p=player;
  for(const d of drops){
    d.t+=dt; d.life-=dt;
    d.x+=d.vx*dt; d.y+=d.vy*dt;
    d.vx*=Math.pow(0.02,dt); d.vy*=Math.pow(0.02,dt);
    const dd=dist(d,p);
    if(dd<110&&d.t>0.35){ // 磁吸
      const dx=p.x-d.x, dy=p.y-d.y;
      d.x+=dx/dd*380*dt; d.y+=dy/dd*380*dt;
    }
    if(dd<24&&d.t>0.25){
      if(pickupDrop(d)) d.life=-1;
      else d.t=0.1; // 背包满时稍后再试
    }
  }
  drops=drops.filter(d=>d.life>0);
}

function updateFx(dt){
  for(const pa of particles){
    pa.life-=dt;
    if(pa.type==='dot'){ pa.x+=pa.vx*dt; pa.y+=pa.vy*dt; pa.vy+=(pa.grav||0)*dt; }
    else if(pa.type==='ring'){ pa.r+=pa.vr*dt; }
  }
  particles=particles.filter(p=>p.life>0);
  for(const t of texts){ t.life-=dt; t.y+=t.vy*dt; t.vy*=Math.pow(0.1,dt); }
  texts=texts.filter(t=>t.life>0);
}

function updateCamera(dt){
  const p=player;
  G.cam.x=lerp(G.cam.x,p.x,Math.min(1,8*dt));
  G.cam.y=lerp(G.cam.y,p.y,Math.min(1,8*dt));
  const hw=Math.min(VW,MW*TILE)/2, hh=Math.min(VH,MH*TILE)/2;
  if(MW*TILE>VW) G.cam.x=clamp(G.cam.x,hw,MW*TILE-hw); else G.cam.x=MW*TILE/2;
  if(MH*TILE>VH) G.cam.y=clamp(G.cam.y,hh,MH*TILE-hh); else G.cam.y=MH*TILE/2;
}

function updateHint(){
  const hint=$('hint');
  let txt=null;
  if(stairs&&!stairs.locked&&dist(player,stairs)<80) txt='按 F 进入下行通道';
  else if(stairs&&stairs.locked&&dist(player,stairs)<110) txt='封印中……讨伐此层的魔君以解封';
  else if(altar&&dist(player,altar)<80) txt='按 F 使用血汁祭坛';
  if(txt){ hint.textContent=txt; hint.classList.remove('hidden'); }
  else hint.classList.add('hidden');
}

/* ---------------- 交互 ---------------- */
function interact(){
  if(stairs&&!stairs.locked&&dist(player,stairs)<80){ nextFloor(); return; }
  if(altar&&dist(player,altar)<80){ openShop(); }
}
function doFloorChange(){
  G.floor++;
  genFloor(G.floor);
  addMsg('进入暗渊第 '+G.floor+' 层','#c9a55c');
  save();
}
function nextFloor(){
  if(G.transT>=0) return;
  G.transT=0; sfx('stairs');
}

/* ---------------- 渲染 ---------------- */
function render(){
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle='#050408'; ctx.fillRect(0,0,VW,VH);
  if(G.state==='title') return;
  const sx=(Math.random()*2-1)*G.shake*7, sy=(Math.random()*2-1)*G.shake*7;
  ctx.save();
  ctx.translate(Math.round(VW/2-G.cam.x+sx), Math.round(VH/2-G.cam.y+sy));
  drawTiles();
  drawStairs();
  drawAltar();
  drawTorchBodies();
  drawDrops();
  // 实体按 y 排序
  const ents=enemies.slice(); ents.push(player);
  ents.sort((a,b)=>a.y-b.y);
  for(const e of ents){ if(e===player) drawPlayer(); else drawEnemy(e); }
  drawProjectiles();
  drawParticles();
  drawTexts();
  drawAim();
  ctx.restore();
  drawLighting();
  drawVignette();
  if(G.hurtT>0){
    ctx.fillStyle='rgba(160,20,20,'+(G.hurtT*0.9)+')'; ctx.fillRect(0,0,VW,VH);
  }
  drawMinimap();
  if(G.transT>=0){
    const a=G.transT<1?G.transT:2-G.transT;
    ctx.fillStyle='rgba(0,0,0,'+clamp(a,0,1)+')'; ctx.fillRect(0,0,VW,VH);
  }
  if(G.paused){
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,0,VW,VH);
    ctx.fillStyle='#c9a55c'; ctx.font='28px Georgia'; ctx.textAlign='center';
    ctx.fillText('已 暂 停',VW/2,VH/2-8);
    ctx.font='14px Georgia'; ctx.fillStyle='#8a7448';
    ctx.fillText('按 ESC 继续',VW/2,VH/2+22);
    ctx.textAlign='left';
  }
}

function drawTiles(){
  const x0=Math.max(0,Math.floor((G.cam.x-VW/2)/TILE)-1), x1=Math.min(MW-1,Math.ceil((G.cam.x+VW/2)/TILE)+1);
  const y0=Math.max(0,Math.floor((G.cam.y-VH/2)/TILE)-1), y1=Math.min(MH-1,Math.ceil((G.cam.y+VH/2)/TILE)+1);
  for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){
    const px=tx*TILE, py=ty*TILE;
    if(map[ty][tx]===1){
      const h=hash2(tx,ty);
      const v=Math.floor(h*3)*4;
      ctx.fillStyle='rgb('+(44+v)+','+(40+v)+','+(54+v)+')';
      ctx.fillRect(px,py,TILE,TILE);
      ctx.strokeStyle='rgba(0,0,0,0.16)';
      ctx.strokeRect(px+0.5,py+0.5,TILE,TILE);
      if(h>0.88){ // 裂纹
        ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.beginPath();
        ctx.moveTo(px+h*30,py+6); ctx.lineTo(px+h*20+8,py+h*24); ctx.stroke();
      }
      if(h<0.03){ // 血渍
        ctx.fillStyle='rgba(96,14,14,0.4)';
        ctx.beginPath(); ctx.ellipse(px+20,py+22,9,6,h*9,0,6.283); ctx.fill();
      }
    }else{
      ctx.fillStyle='#141019'; ctx.fillRect(px,py,TILE,TILE);
      if(ty+1<MH&&map[ty+1][tx]===1){ // 面向地板的墙面（伪高度）
        ctx.fillStyle='#251f33'; ctx.fillRect(px,py+10,TILE,TILE-10);
        ctx.fillStyle='#3d3556'; ctx.fillRect(px,py+10,TILE,3);
        const h=hash2(tx*3,ty*5);
        if(h>0.6){ ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(px+8+h*14,py+16,3,12); }
      }
      if(ty>0&&map[ty-1][tx]===1){ ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.fillRect(px,py,TILE,7); }
    }
  }
}

function drawTorchBodies(){
  const x0=G.cam.x-VW/2-60, x1=G.cam.x+VW/2+60, y0=G.cam.y-VH/2-60, y1=G.cam.y+VH/2+60;
  for(const t of torches){
    if(t.x<x0||t.x>x1||t.y<y0||t.y>y1) continue;
    const fl=Math.sin(G.time*11+t.ph)*0.5+0.5;
    ctx.fillStyle='#3a2a18'; ctx.fillRect(t.x-2,t.y-6,4,9);
    ctx.fillStyle='rgba(255,140,40,'+(0.10+fl*0.05)+')';
    ctx.beginPath(); ctx.arc(t.x,t.y-10,26+fl*4,0,6.283); ctx.fill();
    ctx.fillStyle='#ff8a2a';
    ctx.beginPath(); ctx.ellipse(t.x,t.y-11,3.5,6+fl*2.5,0,0,6.283); ctx.fill();
    ctx.fillStyle='#ffd75e';
    ctx.beginPath(); ctx.ellipse(t.x,t.y-10,1.8,3.4,0,0,6.283); ctx.fill();
  }
}

function drawStairs(){
  if(!stairs) return;
  const s=stairs, t=G.time;
  ctx.save(); ctx.translate(s.x,s.y);
  if(s.locked){
    ctx.fillStyle='rgba(120,30,30,0.35)';
    ctx.beginPath(); ctx.arc(0,0,24,0,6.283); ctx.fill();
    ctx.strokeStyle='#7a2020'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(0,0,18,0,6.283); ctx.stroke();
    ctx.fillStyle='#a03030'; ctx.fillRect(-3,-9,6,12); ctx.fillRect(-7,-2,14,5);
  }else{
    ctx.fillStyle='rgba(40,120,130,0.25)';
    ctx.beginPath(); ctx.arc(0,0,26,0,6.283); ctx.fill();
    for(let i=0;i<3;i++){
      ctx.strokeStyle='rgba(90,216,216,'+(0.7-i*0.18)+')'; ctx.lineWidth=2.5;
      ctx.beginPath();
      const a0=t*(1.6+i*0.5)+i*2.1;
      ctx.arc(0,0,20-i*5,a0,a0+4.2); ctx.stroke();
    }
    ctx.fillStyle='#06282c';
    ctx.beginPath(); ctx.arc(0,0,8,0,6.283); ctx.fill();
    for(let i=0;i<6;i++){
      const a=t*0.8+i*1.047;
      ctx.fillStyle='#7fe8e0';
      ctx.fillRect(Math.cos(a)*30-1.5,Math.sin(a)*30-1.5,3,3);
    }
  }
  ctx.restore();
}

function drawAltar(){
  if(!altar) return;
  const a=altar, t=G.time;
  ctx.save(); ctx.translate(a.x,a.y);
  ctx.fillStyle='#2a2438'; ctx.beginPath(); ctx.ellipse(0,6,20,10,0,0,6.283); ctx.fill();
  ctx.fillStyle='#3a3450'; ctx.beginPath(); ctx.ellipse(0,2,16,8,0,0,6.283); ctx.fill();
  const bob=Math.sin(t*2)*3;
  ctx.fillStyle='rgba(232,201,106,0.15)';
  ctx.beginPath(); ctx.arc(0,-14+bob,20,0,6.283); ctx.fill();
  ctx.save(); ctx.translate(0,-14+bob); ctx.rotate(t*1.2);
  ctx.fillStyle='#e8c96a';
  ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(5,0); ctx.lineTo(0,8); ctx.lineTo(-5,0); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawDrops(){
  for(const d of drops){
    const bl=Math.sin(G.time*4+d.x)*0.5+0.5;
    if(d.kind==='gold'){
      ctx.fillStyle='#8a6a1c';
      ctx.beginPath(); ctx.ellipse(d.x,d.y+2,6,3,0,0,6.283); ctx.fill();
      ctx.fillStyle='#e8c96a';
      for(let i=0;i<3;i++){
        ctx.beginPath(); ctx.arc(d.x-4+i*4,d.y-1+((i%2)*2-1),2.4,0,6.283); ctx.fill();
      }
    }else if(d.kind==='potion'){
      const c=d.item==='hp'?'#e0472e':'#3f7fd6';
      ctx.fillStyle='rgba(255,255,255,0.06)';
      ctx.fillRect(d.x-6,d.y-30,12,30);
      ctx.fillStyle=c;
      ctx.fillRect(d.x-4,d.y-8,8,8);
      ctx.fillStyle='#c8b284'; ctx.fillRect(d.x-2,d.y-11,4,3);
    }else{
      const r=RARITY_META[d.item.rarity];
      // 光柱
      const gr=ctx.createLinearGradient(0,d.y-90,0,d.y+4);
      gr.addColorStop(0,'rgba(0,0,0,0)');
      gr.addColorStop(1,r.c);
      ctx.globalAlpha=0.16+bl*0.08;
      ctx.fillStyle=gr;
      ctx.fillRect(d.x-7,d.y-90,14,94);
      ctx.globalAlpha=1;
      ctx.save(); ctx.translate(d.x,d.y-6); ctx.rotate(0.785);
      ctx.fillStyle=r.c; ctx.fillRect(-5,-5,10,10);
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillRect(-2,-2,4,4);
      ctx.restore();
    }
  }
}

function drawShadow(x,y,r){
  ctx.fillStyle='rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(x,y+r*0.85,r*0.95,r*0.4,0,0,6.283); ctx.fill();
}

function drawPlayer(){
  const p=player, t=p.walkT*10;
  const bob=p.moving?Math.sin(t)*1.6:0;
  drawShadow(p.x,p.y,p.r);
  ctx.save(); ctx.translate(p.x,p.y+bob);
  // 斗篷
  const sw=p.moving?Math.sin(t*0.9)*2:Math.sin(G.time*2)*1;
  ctx.fillStyle='#33405c';
  ctx.beginPath();
  ctx.moveTo(-p.face*4,-9);
  ctx.quadraticCurveTo(-p.face*11,2,-p.face*8+sw*0.4,12);
  ctx.lineTo(-p.face*2,10); ctx.closePath(); ctx.fill();
  // 双腿
  if(p.moving){
    ctx.strokeStyle='#2c3040'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(-3,8); ctx.lineTo(-3+Math.sin(t)*4,14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3,8); ctx.lineTo(3-Math.sin(t)*4,14); ctx.stroke();
  }
  // 躯干护甲
  ctx.fillStyle='#6a7a92';
  ctx.beginPath(); ctx.ellipse(0,0,7.5,9.5,0,0,6.283); ctx.fill();
  ctx.fillStyle='#8a9ab2'; ctx.fillRect(-5,-4,10,3);
  ctx.fillStyle='#b8945a'; ctx.fillRect(-2,-2,4,6);
  // 头
  ctx.fillStyle='#e0c0a0'; ctx.beginPath(); ctx.arc(0,-12,5.5,0,6.283); ctx.fill();
  ctx.fillStyle='#6a4a2a';
  ctx.beginPath(); ctx.arc(p.face*1,-14,5.2,3.4,6.1); ctx.fill();
  // 剑
  let ang=-0.9*p.face;
  if(p.swingT>0){
    const pr=1-p.swingT/0.22;
    ang=(-1.7+pr*3.1)*p.face;
  }
  ctx.save(); ctx.translate(p.face*6,1); ctx.rotate(ang);
  ctx.strokeStyle='#c8ccd8'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(16*p.face,-9*p.face); ctx.stroke();
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(3*p.face,-1.5*p.face); ctx.lineTo(15*p.face,-8.5*p.face); ctx.stroke();
  ctx.strokeStyle='#8a6a2a'; ctx.lineWidth=3.4;
  ctx.beginPath(); ctx.moveTo(-1*p.face,1*p.face); ctx.lineTo(-3.5*p.face,3.5*p.face); ctx.stroke();
  ctx.restore();
  // 挥砍弧光
  if(p.swingT>0.06){
    const pr=1-p.swingT/0.22;
    ctx.strokeStyle='rgba(255,255,255,'+(0.7-pr*0.7)+')'; ctx.lineWidth=3;
    ctx.beginPath();
    ctx.arc(0,0,26,(-2+pr*2.6)*p.face+0.4,(-2+pr*2.6+0.9)*p.face+0.4,p.face<0);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEnemy(e){
  const t=e.animT*(e.moving?7:2);
  const bob=Math.sin(t)*1.5;
  drawShadow(e.x,e.y,e.r);
  // 精英光环
  if(e.elite){
    ctx.strokeStyle=e.elite.c; ctx.globalAlpha=0.65; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(e.x,e.y+e.r*0.85,e.r+4,(e.r+4)*0.42,0,0,6.283); ctx.stroke();
    ctx.globalAlpha=1;
  }
  if(e.ai==='boss'){
    ctx.fillStyle='rgba(200,40,30,0.14)';
    ctx.beginPath(); ctx.ellipse(e.x,e.y+e.r*0.8,e.r+14,(e.r+14)*0.4,0,0,6.283); ctx.fill();
  }
  ctx.save(); ctx.translate(e.x,e.y+bob);
  const fl=e.hitFlash>0;
  if(fl){ ctx.filter='brightness(2.4)'; }
  const face=p_x(e);
  if(e.type==='skeleton') drawSkeleton(e,face,t);
  else if(e.type==='bat') drawBat(e,face,t);
  else if(e.type==='zombie') drawZombie(e,face,t);
  else if(e.type==='cultist') drawCultist(e,face,t);
  else if(e.type==='brute') drawBrute(e,face,t);
  else if(e.type==='demon') drawDemon(e,face,t);
  if(fl){ ctx.filter='none'; }
  ctx.restore();
  // 血条与名字
  if(e.hpBarT>0||e.ai==='boss'||e.elite){
    const w=e.ai==='boss'?54:30;
    ctx.fillStyle='rgba(0,0,0,0.6)';
    ctx.fillRect(e.x-w/2,e.y-e.r-16,w,4);
    ctx.fillStyle=e.ai==='boss'?'#d8452f':'#7ec850';
    ctx.fillRect(e.x-w/2,e.y-e.r-16,w*Math.max(0,e.hp/e.maxHp),4);
  }
  if(e.elite||e.ai==='boss'){
    ctx.font='11px Georgia'; ctx.textAlign='center';
    ctx.fillStyle=e.elite?e.elite.c:'#ff8a6a';
    ctx.fillText(e.n,e.x,e.y-e.r-20);
    ctx.textAlign='left';
  }
}
function p_x(e){ return player.x<e.x?-1:1; }

function drawSkeleton(e,f,t){
  ctx.strokeStyle='#d8d4c4'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(-f*2,4); ctx.lineTo(-f*2+Math.sin(t)*4,12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(f*2,4); ctx.lineTo(f*2-Math.sin(t)*4,12); ctx.stroke();
  ctx.fillStyle='#e8e4d4';
  ctx.beginPath(); ctx.ellipse(0,0,6,8.5,0,0,6.283); ctx.fill();
  ctx.strokeStyle='#a8a494';
  for(let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(-4,-3+i*3); ctx.lineTo(4,-3+i*3); ctx.stroke(); }
  ctx.fillStyle='#e8e4d4';
  ctx.beginPath(); ctx.arc(0,-11,5,0,6.283); ctx.fill();
  ctx.fillStyle='#181410';
  ctx.beginPath(); ctx.arc(f*2-1,-11.5,1.4,0,6.283); ctx.fill();
  ctx.beginPath(); ctx.arc(f*2+2,-11.5,1.4,0,6.283); ctx.fill();
  ctx.strokeStyle='#8a6a4a'; ctx.lineWidth=2.4;
  ctx.save(); ctx.translate(f*6,0); ctx.rotate(Math.sin(t)*0.3-0.5);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(f*11,-7); ctx.stroke();
  ctx.restore();
}
function drawBat(e,f,t){
  const w=Math.sin(t*2.6)*0.8;
  ctx.fillStyle='#4a3a5e';
  ctx.beginPath(); ctx.moveTo(-2,0); ctx.quadraticCurveTo(-12,-6-w*6,-15,2-w*4); ctx.quadraticCurveTo(-8,2,-2,3); ctx.fill();
  ctx.beginPath(); ctx.moveTo(2,0); ctx.quadraticCurveTo(12,-6-w*6,15,2-w*4); ctx.quadraticCurveTo(8,2,2,3); ctx.fill();
  ctx.fillStyle='#6a4a8a';
  ctx.beginPath(); ctx.ellipse(0,0,4.5,5.5,0,0,6.283); ctx.fill();
  ctx.fillStyle='#ffd75e';
  ctx.beginPath(); ctx.arc(f*2-1,-1,1,0,6.283); ctx.fill();
  ctx.beginPath(); ctx.arc(f*2+1.5,-1,1,0,6.283); ctx.fill();
}
function drawZombie(e,f,t){
  ctx.fillStyle='#4a5538';
  ctx.beginPath(); ctx.ellipse(0,2,8,9,0.1*f,0,6.283); ctx.fill();
  ctx.strokeStyle='#4a5538'; ctx.lineWidth=3.4;
  ctx.beginPath(); ctx.moveTo(-4,7); ctx.lineTo(-4+Math.sin(t)*3,13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4,7); ctx.lineTo(4-Math.sin(t)*3,13); ctx.stroke();
  ctx.strokeStyle='#5a6845'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(f*3,-3); ctx.lineTo(f*11,1+Math.sin(t)*1.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(f*2,-1); ctx.lineTo(f*10,4-Math.sin(t)*1.5); ctx.stroke();
  ctx.fillStyle='#6a7d4a';
  ctx.beginPath(); ctx.arc(f*2,-11,5.5,0,6.283); ctx.fill();
  ctx.fillStyle='#181410';
  ctx.beginPath(); ctx.arc(f*3,-12,1.3,0,6.283); ctx.fill();
  ctx.fillStyle='#c8c0a0'; ctx.fillRect(f*4,-9,3,1.6);
}
function drawCultist(e,f,t){
  const cast=e.cast>0;
  ctx.fillStyle='#3a2450';
  ctx.beginPath();
  ctx.moveTo(0,-14); ctx.quadraticCurveTo(-9,-4,-7,12); ctx.lineTo(7,12); ctx.quadraticCurveTo(9,-4,0,-14);
  ctx.fill();
  ctx.fillStyle='#553a78';
  ctx.beginPath(); ctx.arc(0,-12,5,0,6.283); ctx.fill();
  ctx.fillStyle='#2a1838';
  ctx.beginPath(); ctx.moveTo(-5,-12); ctx.lineTo(0,-20); ctx.lineTo(5,-12); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#ff5a5a';
  ctx.beginPath(); ctx.arc(f*1.5,-11,1.2,0,6.283); ctx.fill();
  ctx.strokeStyle='#5a4a6a'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(f*7,-10); ctx.lineTo(f*9,10); ctx.stroke();
  ctx.fillStyle=cast?'#ffd0ff':'#b070ff';
  ctx.beginPath(); ctx.arc(f*7,-11,cast?4:2.4,0,6.283); ctx.fill();
}
function drawBrute(e,f,t){
  ctx.fillStyle='#7a5230';
  ctx.beginPath(); ctx.ellipse(0,0,13,12,0,0,6.283); ctx.fill();
  ctx.fillStyle='#8a5a33';
  ctx.beginPath(); ctx.arc(f*3,-12,7,0,6.283); ctx.fill();
  ctx.fillStyle='#f0e8d0';
  ctx.beginPath(); ctx.moveTo(f*5,-9); ctx.lineTo(f*7,-5); ctx.lineTo(f*3,-7); ctx.fill();
  ctx.fillStyle='#181410';
  ctx.beginPath(); ctx.arc(f*5,-14,1.6,0,6.283); ctx.fill();
  ctx.strokeStyle='#7a5230'; ctx.lineWidth=6;
  const pu=Math.sin(t)*3;
  ctx.beginPath(); ctx.moveTo(f*8,-2); ctx.lineTo(f*13,3+pu); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-f*8,-2); ctx.lineTo(-f*12,4-pu); ctx.stroke();
}
function drawDemon(e,f,t){
  const w=Math.sin(t*1.4)*0.5;
  ctx.fillStyle='#5a1414';
  ctx.beginPath(); ctx.moveTo(-6,-6); ctx.quadraticCurveTo(-30,-20-w*8,-34,4+w*5); ctx.quadraticCurveTo(-20,-2,-6,4); ctx.fill();
  ctx.beginPath(); ctx.moveTo(6,-6); ctx.quadraticCurveTo(30,-20-w*8,34,4+w*5); ctx.quadraticCurveTo(20,-2,6,4); ctx.fill();
  ctx.fillStyle='#8a1c1c';
  ctx.beginPath(); ctx.ellipse(0,0,18,20,0,0,6.283); ctx.fill();
  ctx.fillStyle='#a02222';
  ctx.beginPath(); ctx.ellipse(0,6,13,13,0,0,6.283); ctx.fill();
  ctx.strokeStyle='#2a0a0a'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(-8,12); ctx.lineTo(-8+Math.sin(t)*4,22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8,12); ctx.lineTo(8-Math.sin(t)*4,22); ctx.stroke();
  ctx.fillStyle='#a02222';
  ctx.beginPath(); ctx.arc(0,-16,10,0,6.283); ctx.fill();
  ctx.fillStyle='#f0e0c0';
  ctx.beginPath(); ctx.moveTo(-8,-22); ctx.quadraticCurveTo(-16,-32,-9,-34); ctx.quadraticCurveTo(-11,-27,-5,-23); ctx.fill();
  ctx.beginPath(); ctx.moveTo(8,-22); ctx.quadraticCurveTo(16,-32,9,-34); ctx.quadraticCurveTo(11,-27,5,-23); ctx.fill();
  ctx.fillStyle='#ffd75e';
  ctx.beginPath(); ctx.arc(f*4,-17,2.2,0,6.283); ctx.fill();
  ctx.beginPath(); ctx.arc(f*-2,-17,2.2,0,6.283); ctx.fill();
}

function drawProjectiles(){
  for(const pr of projectiles){
    if(pr.type==='fire'){
      ctx.fillStyle='rgba(255,140,40,0.25)';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,13,0,6.283); ctx.fill();
      ctx.fillStyle='#ff8a2a'; ctx.beginPath(); ctx.arc(pr.x,pr.y,6,0,6.283); ctx.fill();
      ctx.fillStyle='#ffe08a'; ctx.beginPath(); ctx.arc(pr.x,pr.y,3,0,6.283); ctx.fill();
    }else if(pr.type==='ember'){
      ctx.fillStyle='rgba(160,80,255,0.3)';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,10,0,6.283); ctx.fill();
      ctx.fillStyle='#b070ff'; ctx.beginPath(); ctx.arc(pr.x,pr.y,4.5,0,6.283); ctx.fill();
    }else if(pr.type==='bfire'){
      ctx.fillStyle='rgba(255,80,30,0.3)';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,14,0,6.283); ctx.fill();
      ctx.fillStyle='#ff5a2a'; ctx.beginPath(); ctx.arc(pr.x,pr.y,7,0,6.283); ctx.fill();
      ctx.fillStyle='#ffd75e'; ctx.beginPath(); ctx.arc(pr.x,pr.y,3,0,6.283); ctx.fill();
    }
  }
}

function drawParticles(){
  for(const pa of particles){
    const a=clamp(pa.life/pa.maxLife,0,1);
    if(pa.type==='dot'){
      ctx.globalAlpha=a; ctx.fillStyle=pa.color;
      ctx.fillRect(pa.x-pa.size/2,pa.y-pa.size/2,pa.size,pa.size);
    }else if(pa.type==='ring'){
      ctx.globalAlpha=a; ctx.strokeStyle=pa.color; ctx.lineWidth=pa.lw*a;
      ctx.beginPath(); ctx.arc(pa.x,pa.y,pa.r,0,6.283); ctx.stroke();
    }
  }
  ctx.globalAlpha=1;
}

function drawTexts(){
  ctx.textAlign='center';
  for(const t of texts){
    const a=clamp(t.life/0.9,0,1);
    ctx.globalAlpha=a;
    ctx.font=(t.crit?'bold ':'')+t.size+'px Georgia';
    ctx.strokeStyle='rgba(0,0,0,0.8)'; ctx.lineWidth=3;
    ctx.strokeText(t.txt,t.x,t.y);
    ctx.fillStyle=t.color;
    ctx.fillText(t.txt,t.x,t.y);
  }
  ctx.globalAlpha=1; ctx.textAlign='left';
}

function drawAim(){
  const mw=mouseWorld();
  ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.arc(mw.x,mw.y,5,0,6.283); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mw.x-9,mw.y); ctx.lineTo(mw.x-3,mw.y);
  ctx.moveTo(mw.x+3,mw.y); ctx.lineTo(mw.x+9,mw.y);
  ctx.moveTo(mw.x,mw.y-9); ctx.lineTo(mw.x,mw.y-3);
  ctx.moveTo(mw.x,mw.y+3); ctx.lineTo(mw.x,mw.y+9);
  ctx.stroke();
}

function drawLighting(){
  const w=cv.width, h=cv.height;
  lctx.setTransform(DPR,0,0,DPR,0,0);
  lctx.globalCompositeOperation='source-over';
  lctx.fillStyle='rgba(5,3,14,0.90)';
  lctx.clearRect(0,0,VW,VH);
  lctx.fillRect(0,0,VW,VH);
  lctx.globalCompositeOperation='destination-out';
  const cut=(wx,wy,r,core)=>{
    const sx=wx-G.cam.x+VW/2, sy=wy-G.cam.y+VH/2;
    if(sx<-r||sy<-r||sx>VW+r||sy>VH+r) return;
    const g=lctx.createRadialGradient(sx,sy,0,sx,sy,r);
    g.addColorStop(0,'rgba(0,0,0,'+(core||1)+')');
    g.addColorStop(0.55,'rgba(0,0,0,'+((core||1)*0.6)+')');
    g.addColorStop(1,'rgba(0,0,0,0)');
    lctx.fillStyle=g;
    lctx.beginPath(); lctx.arc(sx,sy,r,0,6.283); lctx.fill();
  };
  const fl=Math.sin(G.time*9)*0.5+0.5;
  cut(player.x,player.y,270+fl*14,1);
  for(const t of torches) cut(t.x,t.y-10,105+fl*10,0.92);
  if(stairs&&!stairs.locked) cut(stairs.x,stairs.y,95,0.8);
  if(altar) cut(altar.x,altar.y,85,0.8);
  for(const pr of projectiles) cut(pr.x,pr.y,55,0.85);
  if(G.boss) cut(G.boss.x,G.boss.y,140,0.7);
  ctx.drawImage(lightCv,0,0,VW,VH);
  // 玩家暖光
  const px=player.x-G.cam.x+VW/2, py=player.y-G.cam.y+VH/2;
  const wg=ctx.createRadialGradient(px,py,0,px,py,240);
  wg.addColorStop(0,'rgba(255,170,80,0.07)');
  wg.addColorStop(1,'rgba(255,170,80,0)');
  ctx.fillStyle=wg; ctx.fillRect(px-240,py-240,480,480);
}

function drawVignette(){
  const g=ctx.createRadialGradient(VW/2,VH/2,Math.min(VW,VH)*0.36,VW/2,VH/2,Math.max(VW,VH)*0.72);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(1,'rgba(0,0,0,0.55)');
  ctx.fillStyle=g; ctx.fillRect(0,0,VW,VH);
}

function drawMinimap(){
  const S=150, pad=12, x0=VW-S-pad, y0=pad;
  const sc=S/MW;
  ctx.save();
  ctx.globalAlpha=0.88;
  rr(ctx,x0-4,y0-4,S+8,S+8,6);
  ctx.fillStyle='rgba(0,0,0,0.62)'; ctx.fill();
  ctx.strokeStyle='#55411f'; ctx.lineWidth=1.4; ctx.stroke();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(miniCv,x0,y0,S,S);
  ctx.imageSmoothingEnabled=true;
  const dot=(wx,wy,c,r)=>{
    ctx.fillStyle=c;
    ctx.beginPath(); ctx.arc(x0+wx/TILE*sc,y0+wy/TILE*sc,r,0,6.283); ctx.fill();
  };
  for(const e of enemies) dot(e.x,e.y,e.ai==='boss'?'#ff4030':'#c03030',e.ai==='boss'?3.4:1.6);
  if(stairs) dot(stairs.x,stairs.y,stairs.locked?'#7a4040':'#5ad8d8',3);
  if(altar) dot(altar.x,altar.y,'#e8c96a',2.4);
  dot(player.x,player.y,'#ffffff',2.6);
  ctx.restore();
}

/* ---------------- HUD ---------------- */
let _hudT=0;
function updateHUD(){
  const p=player; if(!p) return;
  $('hpfill').style.height=clamp(p.hp/p.maxHp*100,0,100)+'%';
  $('mpfill').style.height=clamp(p.mp/p.maxMp*100,0,100)+'%';
  $('hptext').textContent=Math.ceil(Math.max(0,p.hp))+' / '+p.maxHp;
  $('mptext').textContent=Math.ceil(Math.max(0,p.mp))+' / '+p.maxMp;
  $('xpfill').style.width=clamp(p.exp/expNeed(p.level)*100,0,100)+'%';
  $('uiFloor').textContent=G.floor;
  $('uiGold').textContent=p.gold;
  $('uiLevel').textContent=p.level;
  $('cntHp').textContent=p.potions.hp;
  $('cntMp').textContent=p.potions.mp;
  const cds=[['cd1',p.skills.fire.cd,SKILLS.fire.cd],['cd2',p.skills.nova.cd,SKILLS.nova.cd],['cd3',p.skills.heal.cd,SKILLS.heal.cd]];
  for(const [id,cur,max] of cds){
    const el=$(id);
    if(cur>0){
      const pc=cur/max*360;
      el.style.background='conic-gradient(rgba(0,0,0,0.78) '+pc+'deg, transparent 0)';
    }else el.style.background='none';
  }
  if(G.boss){
    $('bossfill').style.width=clamp(G.boss.hp/G.boss.maxHp*100,0,100)+'%';
  }
}

/* ---------------- 面板 ---------------- */
function anyPanelOpen(){
  return !$('panelInv').classList.contains('hidden')||!$('panelChar').classList.contains('hidden')||!$('panelShop').classList.contains('hidden');
}
function closePanels(){
  $('panelInv').classList.add('hidden');
  $('panelChar').classList.add('hidden');
  $('panelShop').classList.add('hidden');
  hideTooltip();
}
function togglePanel(id){
  const el=$(id), was=el.classList.contains('hidden');
  closePanels();
  if(was){ el.classList.remove('hidden'); sfx('click'); if(id==='panelInv') renderInv(); if(id==='panelChar') renderChar(); }
}

function itemIconSvg(it){
  return '<svg class="ic" style="color:'+RARITY_META[it.rarity].c+'"><use href="#'+ICONS[it.icon]+'"/></svg>';
}
function renderInv(){
  const p=player;
  let eq='';
  for(const slot of ['weapon','helm','armor','ring']){
    const it=p.equip[slot];
    eq+='<div class="eslot'+(it?' filled':'')+'" data-slot="'+slot+'"'+(it?' style="color:'+RARITY_META[it.rarity].c+'"':'')+'>'+
      (it?itemIconSvg(it):'<svg class="ic" style="opacity:0.18"><use href="#'+ICONS[slot]+'"/></svg>')+
      '<small>'+SLOT_NAMES[slot]+'</small></div>';
  }
  $('eqSlots').innerHTML=eq;
  let g='';
  for(let i=0;i<40;i++){
    const it=p.inv[i];
    if(it) g+='<div class="islot" data-uid="'+it.uid+'" data-idx="'+i+'" style="color:'+RARITY_META[it.rarity].c+'">'+itemIconSvg(it)+'</div>';
    else g+='<div class="islot"></div>';
  }
  $('invGrid').innerHTML=g;
}

function renderChar(){
  const p=player;
  const row=(n,v,st)=>'<div class="statrow"><span class="sn">'+n+'</span><span><span class="sv">'+v+'</span>'+
    (p.statPts>0?'<button class="plusbtn" data-stat="'+st+'">+</button>':'')+'</span></div>';
  $('charStats').innerHTML=
    '<div class="statrow"><span class="sn" style="color:#ffd75e">可用属性点</span><span class="sv">'+p.statPts+'</span></div>'+
    row('力量',''+p.str,'str')+row('敏捷',''+p.agi,'agi')+row('活力',''+p.vit,'vit')+row('精力',''+p.en,'en')+
    '<div class="derived">'+
    '攻击 <b>'+p.atk+'</b><br>护甲 <b>'+p.armor+'</b><br>暴击率 <b>'+p.crit.toFixed(0)+'%</b><br>'+
    '攻速 <b>'+p.as.toFixed(0)+'%</b><br>移速 <b>'+p.ms.toFixed(0)+'</b><br>吸血 <b>'+p.ls+'%</b><br>'+
    '法强 <b>'+p.sp+'</b><br>火焰伤害 <b>'+p.fire+'</b><br>生命 <b>'+Math.ceil(p.hp)+'/'+p.maxHp+'</b><br>法力 <b>'+Math.ceil(p.mp)+'/'+p.maxMp+'</b><br><br>'+
    '击杀 <b>'+p.killCount+'</b><br>金币 <b>'+p.gold+'</b>'+
    '</div>';
  const btns=$('charStats').querySelectorAll('.plusbtn');
  for(const b of btns){
    b.addEventListener('click',()=>{
      if(player.statPts<=0) return;
      player.statPts--; player[b.dataset.stat]++;
      recomputeStats(); sfx('click'); renderChar(); save();
    });
  }
}

/* ---------------- 祭坛商店 ---------------- */
let shopItems=[];
function openShop(){
  shopItems=[makeGambleItem(G.floor),makeGambleItem(G.floor),makeGambleItem(G.floor)];
  renderShop(); togglePanel('panelShop');
}
function renderShop(){
  $('shopGold').textContent='持有金币 '+player.gold;
  let h='';
  shopItems.forEach((it,i)=>{
    const price=Math.round(it.value*1.6);
    h+='<div class="shopitem" data-i="'+i+'"><div class="sic" style="color:'+RARITY_META[it.rarity].c+'">'+itemIconSvg(it)+'</div>'+
      '<div class="snm" style="color:'+RARITY_META[it.rarity].c+'">'+it.name+'</div><div class="spr">'+price+' 金币</div></div>';
  });
  $('shopGrid').innerHTML=h;
}
$('shopGrid').addEventListener('click',ev=>{
  const el=ev.target.closest('.shopitem'); if(!el) return;
  const i=+el.dataset.i, it=shopItems[i]; if(!it) return;
  const price=Math.round(it.value*1.6);
  if(player.gold<price){ sfx('deny'); addMsg('金币不足','#ff7a5a'); return; }
  if(!invAdd(it)) return;
  player.gold-=price; shopItems[i]=makeGambleItem(G.floor);
  sfx('buy'); addMsg('购得 ['+it.name+']',RARITY_META[it.rarity].c);
  renderShop(); save();
});

/* ---------------- Tooltip ---------------- */
function findItemByUid(uid){
  for(const it of player.inv) if(it.uid===uid) return {it,where:'inv'};
  for(const s in player.equip) if(player.equip[s]&&player.equip[s].uid===uid) return {it:player.equip[s],where:s};
  return null;
}
function showTooltipFor(it, where){
  const r=RARITY_META[it.rarity];
  let h='<div class="tname" style="color:'+r.c+'">'+it.name+'</div>'+
    '<div class="ttype">'+SLOT_NAMES[it.slot]+' · '+r.n+' · 第 '+it.tier+' 层造物</div>';
  for(const k in it.stats){
    const v=it.stats[k];
    h+='<div class="taff">'+(v>0?'+':'')+v+' '+STAT_NAMES[k]+'</div>';
  }
  h+='<div class="tval">价值 '+it.value+' 金币</div>';
  const cur=player.equip[it.slot];
  if(where!=='eq'&&cur&&cur.uid!==it.uid)
    h+='<div class="tcmp">已装备：'+cur.name+'</div>';
  if(where==='inv') h+='<div class="thelp">左键装备 · 右键出售</div>';
  else if(where==='eq') h+='<div class="thelp">点击卸下</div>';
  else if(where==='shop') h+='<div class="thelp">点击购买</div>';
  const tp=$('tooltip');
  tp.innerHTML=h; tp.classList.remove('hidden');
  moveTooltip();
}
function moveTooltip(){
  const tp=$('tooltip');
  let x=G.mouse.x+18, y=G.mouse.y+14;
  const w=tp.offsetWidth||240, h=tp.offsetHeight||120;
  if(x+w>window.innerWidth-8) x=G.mouse.x-w-14;
  if(y+h>window.innerHeight-8) y=G.mouse.y-h-10;
  tp.style.left=x+'px'; tp.style.top=y+'px';
}
function hideTooltip(){ $('tooltip').classList.add('hidden'); }

$('invGrid').addEventListener('click',ev=>{
  const el=ev.target.closest('.islot'); if(!el||!el.dataset.uid) return;
  equipFromInv(+el.dataset.idx); hideTooltip();
});
$('invGrid').addEventListener('contextmenu',ev=>{
  ev.preventDefault();
  const el=ev.target.closest('.islot'); if(!el||!el.dataset.uid) return;
  sellFromInv(+el.dataset.idx); hideTooltip();
});
$('eqSlots').addEventListener('click',ev=>{
  const el=ev.target.closest('.eslot'); if(!el||!el.dataset.slot) return;
  unequip(el.dataset.slot); hideTooltip();
});
for(const pid of ['invGrid','eqSlots','shopGrid']){
  $(pid).addEventListener('mouseover',ev=>{
    const el=ev.target.closest('[data-uid]'); if(!el){ hideTooltip(); return; }
    const f=findItemByUid(+el.dataset.uid); if(!f) return;
    showTooltipFor(f.it, pid==='shopGrid'?'shop':(pid==='eqSlots'?'eq':'inv'));
  });
  $(pid).addEventListener('mouseleave',hideTooltip);
}
document.addEventListener('mousemove',ev=>{
  G.mouse.x=ev.clientX; G.mouse.y=ev.clientY;
  if(!$('tooltip').classList.contains('hidden')) moveTooltip();
});
document.addEventListener('click',ev=>{
  if(ev.target.classList&&ev.target.classList.contains('close')) closePanels();
});

/* ---------------- 输入 ---------------- */
cv.addEventListener('mousedown',ev=>{
  initAudio(); resumeAudio();
  if(G.state!=='play') return;
  if(ev.button===0){ G.mouse.down=true; }
  else if(ev.button===2){
    const mw=mouseWorld();
    castFireball(mw.x,mw.y);
  }
});
window.addEventListener('mouseup',ev=>{ if(ev.button===0) G.mouse.down=false; });
cv.addEventListener('contextmenu',ev=>ev.preventDefault());
window.addEventListener('blur',()=>{ G.mouse.down=false; G.keys={}; });

window.addEventListener('keydown',ev=>{
  initAudio();
  const k=ev.key.toLowerCase();
  G.keys[k]=true;
  if(G.state!=='play') return;
  if(k==='i') togglePanel('panelInv');
  else if(k==='c') togglePanel('panelChar');
  else if(k==='q') usePotion('hp');
  else if(k==='e') usePotion('mp');
  else if(k==='f') interact();
  else if(k==='m'){ G.mute=!G.mute; setDroneMute(G.mute); addMsg(G.mute?'音效已关闭':'音效已开启','#a8a090'); }
  else if(k==='1'||k==='2'||k==='3'){
    const mw=mouseWorld();
    castSkill(+k,mw.x,mw.y);
  }
  else if(k==='escape'){
    if(anyPanelOpen()) closePanels();
    else G.paused=!G.paused;
  }
  if(k===' '||k==='tab') ev.preventDefault();
});
window.addEventListener('keyup',ev=>{ G.keys[ev.key.toLowerCase()]=false; });

/* ---------------- 存档 ---------------- */
function save(){
  try{
    const p=player; if(!p) return;
    localStorage.setItem(SAVE_KEY,JSON.stringify({
      v:1, floor:G.floor,
      p:{level:p.level,exp:p.exp,statPts:p.statPts,str:p.str,agi:p.agi,vit:p.vit,en:p.en,
        gold:p.gold,killCount:p.killCount,potions:p.potions,inv:p.inv,equip:p.equip}
    }));
  }catch(e){}
}
function hasSave(){ try{ return !!localStorage.getItem(SAVE_KEY); }catch(e){ return false; } }
function loadGame(){
  try{
    const d=JSON.parse(localStorage.getItem(SAVE_KEY));
    if(!d||!d.p) return false;
    player=newPlayer();
    Object.assign(player,d.p);
    player.skills={fire:{cd:0},nova:{cd:0},heal:{cd:0}};
    G.floor=d.floor||1;
    recomputeStats(); player.hp=player.maxHp; player.mp=player.maxMp;
    return true;
  }catch(e){ return false; }
}
window.addEventListener('beforeunload',()=>{ if(G.state==='play') save(); });

/* ---------------- 流程 ---------------- */
function enterGame(){
  closePanels();
  $('titleScreen').classList.add('hidden');
  $('deathScreen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('tips').style.opacity=1; G.tutorialT=14;
  G.state='play'; G.paused=false; G.transT=-1;
  G.cam.x=player.x; G.cam.y=player.y;
}
function startNew(){
  try{ localStorage.removeItem(SAVE_KEY); }catch(e){}
  player=newPlayer(); recomputeStats();
  G.floor=1; genFloor(1);
  addMsg('你坠入了暗渊……清理怪物，寻找下行通道','#c9a55c');
  enterGame(); save();
}
function continueGame(){
  if(!loadGame()){ startNew(); return; }
  genFloor(G.floor);
  addMsg('欢迎回到暗渊 · 第 '+G.floor+' 层','#c9a55c');
  enterGame();
}
function die(){
  const p=player;
  p.hp=0;
  G.state='dead'; G.mouse.down=false;
  burst(p.x,p.y,30,'#c03030',3); sfx('die');
  const loss=Math.round(p.gold*0.15);
  p.gold-=loss;
  $('deathInfo').textContent='黑暗吞噬了你的灵魂……损失 '+loss+' 金币。怪物已在此层重生。';
  $('deathScreen').classList.remove('hidden');
  save();
}
function revive(){
  player.gold=Math.round(player.gold);
  player.hp=player.maxHp; player.mp=player.maxMp;
  player.potions.hp=Math.max(player.potions.hp,1);
  genFloor(G.floor);
  addMsg('你从黑暗中苏醒，暗渊再度翻涌……','#a08890');
  enterGame(); save();
}

$('btnNew').addEventListener('click',()=>{ initAudio(); sfx('click'); startNew(); });
$('btnContinue').addEventListener('click',()=>{ initAudio(); sfx('click'); continueGame(); });
$('btnRevive').addEventListener('click',()=>{ sfx('click'); revive(); });

/* ---------------- 主循环 ---------------- */
let _lastT=0;
function loop(t){
  requestAnimationFrame(loop);
  const dt=Math.min(((t-_lastT)||0)/1000,0.05);
  _lastT=t;
  if(G.state==='play'&&!G.paused) update(dt);
  if(G.state!=='title'){ render(); if(G.state==='play') updateHUD(); }
}

/* ---------------- 启动 ---------------- */
function init(){
  resize();
  window.addEventListener('resize',resize);
  if(hasSave()) $('btnContinue').disabled=false;
  requestAnimationFrame(loop);
}
init();
