'use strict';
/* ===== 暗渊 DARK ABYSS —— 程序化音效（WebAudio 合成，零素材） ===== */
let AC=null, MASTER=null, NOISEBUF=null, DRONE_GAIN=null;
let _pendingSfx=[];

function initAudio(){
  if(AC) return;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx) return;
    AC=new Ctx();
    MASTER=AC.createGain(); MASTER.gain.value=0.5; MASTER.connect(AC.destination);
    const len=AC.sampleRate|0;
    NOISEBUF=AC.createBuffer(1,len,AC.sampleRate);
    const d=NOISEBUF.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
    startDrone();
  }catch(e){ AC=null; }
}
function resumeAudio(){ try{ if(AC&&AC.state==='suspended') AC.resume(); }catch(e){} }

/* 低沉地窟氛围 drone：两只失谐锯齿 + 慢速滤波起伏 */
function startDrone(){
  try{
    DRONE_GAIN=AC.createGain(); DRONE_GAIN.gain.value=0.028; DRONE_GAIN.connect(MASTER);
    const filt=AC.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=220; filt.Q.value=6;
    filt.connect(DRONE_GAIN);
    [55,55.9,82.4].forEach((f,i)=>{
      const o=AC.createOscillator(); o.type='sawtooth'; o.frequency.value=f;
      const g=AC.createGain(); g.gain.value=i===2?0.35:0.6;
      o.connect(g); g.connect(filt); o.start();
    });
    const lfo=AC.createOscillator(), lg=AC.createGain();
    lfo.frequency.value=0.07; lg.gain.value=90;
    lfo.connect(lg); lg.connect(filt.frequency); lfo.start();
  }catch(e){}
}
function setDroneMute(m){ try{ if(DRONE_GAIN) DRONE_GAIN.gain.value=m?0:0.028; }catch(e){} }

function blip(f0,f1,dur,type,vol,delay){
  if(!AC) return;
  try{
    const t=AC.currentTime+(delay||0);
    const o=AC.createOscillator(), g=AC.createGain();
    o.type=type||'sine';
    o.frequency.setValueAtTime(Math.max(1,f0),t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(vol,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(MASTER);
    o.start(t); o.stop(t+dur+0.03);
  }catch(e){}
}
function noiseHit(dur,freq,vol,type,delay){
  if(!AC||!NOISEBUF) return;
  try{
    const t=AC.currentTime+(delay||0);
    const s=AC.createBufferSource(); s.buffer=NOISEBUF; s.loop=true;
    const f=AC.createBiquadFilter(); f.type=type||'lowpass'; f.frequency.value=freq; f.Q.value=1;
    const g=AC.createGain();
    g.gain.setValueAtTime(vol,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    s.connect(f); f.connect(g); g.connect(MASTER);
    s.start(t); s.stop(t+dur+0.03);
  }catch(e){}
}

function sfx(n){
  if(!AC||typeof G!=='undefined'&&G.mute) return;
  switch(n){
    case 'swing':  noiseHit(0.1,1100,0.20,'bandpass'); break;
    case 'hit':    noiseHit(0.07,500,0.35); blip(160,60,0.1,'triangle',0.25); break;
    case 'crit':   noiseHit(0.09,700,0.4); blip(260,70,0.14,'square',0.2); break;
    case 'hurt':   blip(190,80,0.2,'square',0.28); noiseHit(0.12,300,0.2); break;
    case 'fire':   blip(240,70,0.32,'sawtooth',0.22); noiseHit(0.28,420,0.22); break;
    case 'boom':   noiseHit(0.45,190,0.55); blip(95,38,0.4,'sine',0.5); break;
    case 'nova':   blip(280,980,0.42,'sine',0.22); noiseHit(0.35,2400,0.14,'highpass'); blip(560,1800,0.3,'sine',0.1,0.05); break;
    case 'heal':   blip(430,650,0.16,'sine',0.22); blip(650,900,0.18,'sine',0.22,0.12); break;
    case 'coin':   blip(950,1450,0.08,'square',0.12); blip(1250,1900,0.09,'square',0.1,0.06); break;
    case 'potion': blip(300,170,0.12,'sine',0.3); blip(260,150,0.12,'sine',0.25,0.09); break;
    case 'equip':  noiseHit(0.08,900,0.25,'bandpass'); blip(500,300,0.1,'triangle',0.15); break;
    case 'sell':   blip(700,1100,0.1,'sine',0.15); blip(1100,1600,0.1,'sine',0.12,0.08); break;
    case 'level':  [523,659,784,1046].forEach((f,i)=>blip(f,f,0.16,'triangle',0.2,i*0.09)); break;
    case 'die':    blip(280,55,0.7,'sawtooth',0.35); noiseHit(0.5,220,0.3); break;
    case 'roar':   blip(130,55,0.85,'sawtooth',0.4); noiseHit(0.7,180,0.35); break;
    case 'stairs': blip(220,660,0.5,'sine',0.2); noiseHit(0.4,800,0.1,'bandpass',0.1); break;
    case 'click':  blip(620,520,0.05,'square',0.1); break;
    case 'buy':    blip(520,780,0.12,'sine',0.18); blip(780,1040,0.14,'sine',0.15,0.1); break;
    case 'deny':   blip(200,140,0.16,'square',0.15); break;
  }
}
