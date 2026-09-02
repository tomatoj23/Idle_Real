'use strict';
/* 暗渊冒烟测试：DOM/Canvas 桩 + vm 驱动（用后即删） */
const fs=require('fs'), vm=require('vm'), path=require('path');

/* ---- 桩：Canvas 2D Context ---- */
function makeCtx(){
  return new Proxy({}, {
    get(t,p){
      if(p==='canvas') return {width:1280,height:720};
      return function(...a){
        if(p==='createLinearGradient'||p==='createRadialGradient') return {addColorStop(){}};
        if(p==='measureText') return {width:10};
        if(p==='getImageData') return {data:new Uint8ClampedArray(4)};
        return undefined;
      };
    },
    set(){ return true; }
  });
}
/* ---- 桩：DOM 元素 ---- */
function makeEl(tag){
  const listeners={};
  return {
    tag, style:{}, dataset:{}, hidden:false, innerHTML:'', textContent:'', children:[],
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)}, toggle(c){this._s.has(c)?this._s.delete(c):this._s.add(c)}, contains(c){return this._s.has(c)} },
    addEventListener(t,f){ (listeners[t]=listeners[t]||[]).push(f); },
    removeEventListener(){}, appendChild(c){this.children.push(c); return c;}, removeChild(c){const i=this.children.indexOf(c); if(i>=0)this.children.splice(i,1); return c;},
    remove(){}, querySelectorAll(){ return []; }, querySelector(){ return makeEl('div'); },
    getBoundingClientRect(){ return {left:0,top:0,width:1280,height:720}; },
    closest(){ return null; }, offsetWidth:200, offsetHeight:100,
    width:0, height:0, getContext:makeCtx, disabled:false,
    _fire(t,ev){ (listeners[t]||[]).forEach(f=>f(ev||{button:0,clientX:0,clientY:0,target:makeEl('div'),key:''})); }
  };
}
const els={};
global.els=els;
global.window=global;
global.innerWidth=1280; global.innerHeight=720;
global.devicePixelRatio=1;
global.addEventListener=()=>{};
global.localStorage={ _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} };
global.document={
  getElementById(id){ return els[id]||(els[id]=makeEl('div')); },
  createElement(t){ return makeEl(t); },
  addEventListener(){}, body:{appendChild(){}},
};
let RAFQ=[];
global.RAFQ=RAFQ; global.ELS=els;
global.requestAnimationFrame=cb=>{ RAFQ.push(cb); return 0; };

/* ---- 加载游戏代码 + 驱动脚本（同一 script 作用域） ---- */
const base=path.join(__dirname,'js');
const code=[
  fs.readFileSync(path.join(base,'audio.js'),'utf8'),
  fs.readFileSync(path.join(base,'items.js'),'utf8'),
  fs.readFileSync(path.join(base,'game.js'),'utf8')
].join('\n;\n');

let failures=0;
function step(name,fn){
  try{ fn(); console.log('  ok  - '+name); }
  catch(e){ failures++; console.log('  FAIL- '+name+' :: '+(e&&e.stack||e)); }
}

const drive=`
/* ===== 驱动 ===== */
let FAIL=0;
function step(name,fn){ try{ fn(); console.log('  ok  - '+name); }catch(e){ FAIL++; console.log('  FAIL- '+name+' :: '+(e&&e.stack||e)); } }
function pump(n){ for(let i=0;i<n;i++){ const q=RAFQ.splice(0); T+=16.7; q.forEach(cb=>cb(T)); } }
let T=0;
console.log('== 标题 -> 新游戏 ==');
step('btnNew 点击进入游戏', ()=>{ els['btnNew']._fire('click'); if(G.state!=='play') throw new Error('state='+G.state); });
step('首层生成', ()=>{ if(!map||!stairs||enemies.length<3) throw new Error('enemies='+enemies.length); });
console.log('== 基本循环 ==');
step('跑 300 帧（无输入）', ()=>pump(300));
step('鼠标按住移动', ()=>{ G.mouse.x=640; G.mouse.y=200; G.mouse.down=true; pump(240); G.mouse.down=false; });
step('左键朝敌人攻击', ()=>{ const e=enemies[0]; G.mouse.x=640+(e.x-player.x); G.mouse.y=360+(e.y-player.y); G.mouse.down=true; pump(120); G.mouse.down=false; });
step('右键火球', ()=>{ cv._fire('mousedown',{button:2,clientX:800,clientY:300}); pump(60); });
step('技能 2/3', ()=>{ G.keys['2']=true; window._kd&&0; pump(5); G.keys['2']=false; pump(30); });
step('药水 Q/E', ()=>{ const h=player.potions.hp; els['slotQ']&&0; player.hp=10; usePotion('hp'); if(player.potions.hp!==h-1) throw new Error('potion'); });
console.log('== 战斗/成长 ==');
step('直接击杀一只怪', ()=>{ const e=enemies[0]; hurtEnemy(e,99999,false,0,0); if(player.killCount<1) throw new Error('kill'); });
step('金币/掉落磁吸拾取', ()=>{ drops.push(makeDrop(player.x,player.y,'gold',null,50)); pump(90); if(drops.some(d=>dist(d,player)<20)) throw new Error('not picked'); });
step('强制掉一件装备并拾取', ()=>{ const it=makeItem(3); drops.push(makeDrop(player.x,player.y,'item',it)); pump(90); });
step('升级（经验灌满）', ()=>{ const lv=player.level; grantExp(expNeed(player.level)); if(player.level!==lv+1) throw new Error('level'); });
step('属性加点', ()=>{ player.statPts=3; player.str+=1; recomputeStats(); });
step('装备/卸下', ()=>{ const it=makeItem(2,2); player.inv.push(it); equipFromInv(player.inv.length-1); if(player.equip[it.slot]!==it) throw new Error('equip'); unequip(it.slot); if(player.equip[it.slot]) throw new Error('unequip'); });
step('出售', ()=>{ const it=makeItem(1,0); player.inv.push(it); const g0=player.gold; sellFromInv(player.inv.length-1); if(player.gold<=g0) throw new Error('gold'); });
console.log('== 面板/商店 ==');
step('打开背包渲染', ()=>{ togglePanel('panelInv'); if(els['panelInv'].classList.contains('hidden')) throw new Error('hidden'); renderInv(); });
step('打开角色面板', ()=>{ togglePanel('panelChar'); renderChar(); });
step('祭坛商店', ()=>{ openShop(); player.gold=9999; if(shopItems.length!==3) throw new Error('items'); });
step('关闭面板', ()=>closePanels());
console.log('== 层间流程 ==');
step('保存/读取', ()=>{ save(); if(!hasSave()) throw new Error('no save'); const f=G.floor; if(!loadGame()) throw new Error('load'); G.floor=f; });
step('下一层过渡', ()=>{ const f=G.floor; nextFloor(); pump(140); if(G.floor!==f+1) throw new Error('floor='+G.floor); pump(60); });
step('Boss 层生成', ()=>{ G.floor=5; genFloor(5); const b=enemies.find(e=>e.ai==='boss'); if(!b) throw new Error('no boss'); if(!stairs.locked) throw new Error('not locked'); G.boss=b; });
step('击杀 Boss -> 解封楼梯', ()=>{ const b=enemies.find(e=>e.ai==='boss'); hurtEnemy(b,999999,true,0,0); if(stairs.locked) throw new Error('still locked'); });
step('Boss 层跑帧', ()=>pump(180));
step('死亡 -> 复活', ()=>{ hurtPlayer(999999); if(G.state!=='dead') throw new Error('state='+G.state); els['btnRevive']._fire('click'); if(G.state!=='play') throw new Error('revive'); });
step('复活后跑帧', ()=>pump(240));
step('精英词缀', ()=>{ const e=spawnEnemy('skeleton',player.x+100,player.y,G.floor,true); if(!e.elite) throw new Error('no elite'); e.elite.mod(e); });
step('长时间压力跑帧 900', ()=>pump(900));
console.log(FAIL?('FAILURES: '+FAIL):'ALL PASS');
if(FAIL) process.exit(1);
`;

try{
  vm.runInThisContext(code+'\n;\n'+drive,{filename:'darkabyss_inline.js'});
}catch(e){
  console.log('LOAD/DRIVE ERROR: '+(e&&e.stack||e));
  process.exit(1);
}
