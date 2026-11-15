/* Biblioteca Consort – Reproductor de Estudio 2026-11-15.
   Usa el reloj del archivo de audio; para un MP3 sin mapa de pulsos es necesario
   ajustar BPM y alinear el primer pulso. No modifica ni borra archivos guardados. */
(function () {
  'use strict';
  function init() {
    const audio=document.getElementById('player');
    const card=audio&&audio.closest('.stickyAudio');
    const meter=document.getElementById('metronome');
    const bpm=document.getElementById('bpm');
    const beats=document.getElementById('beats');
    const speed=document.getElementById('speed');
    const speedText=document.getElementById('speedText');
    const lamp=document.getElementById('meterLamp');
    if(!audio||!card||!meter||!bpm||!beats||!speed||!speedText||!lamp||
       document.getElementById('consorte-player-plus'))return;

    const ui=document.createElement('section');
    ui.id='consorte-player-plus';
    ui.className='consorte-player-plus';
    ui.innerHTML='<div class="cp-hero"><span class="cp-disc" aria-hidden="true">♫</span><div class="cp-titles"><strong id="cp-song">Elige una canción</strong><span id="cp-status">Lista para practicar</span></div><span class="cp-signal" aria-hidden="true">▥ ▥ ▥</span></div>'+
      '<div class="cp-transport"><button type="button" id="cp-back" aria-label="Retroceder 10 segundos">↶ 10s</button><button type="button" id="cp-play" class="cp-play" aria-label="Reproducir">▶</button><button type="button" id="cp-forward" aria-label="Adelantar 10 segundos">10s ↷</button></div>'+
      '<div class="cp-timeline"><span id="cp-current">0:00</span><input id="cp-progress" type="range" min="0" max="1000" value="0" aria-label="Posición de reproducción"><span id="cp-duration">0:00</span></div>'+
      '<div class="cp-row"><label>Volumen canción <input id="cp-volume" type="range" min="0" max="100" value="100"></label><button id="cp-mute" type="button">🔊 Audio</button></div>'+
      '<div class="cp-group"><span>Sonido</span><div class="cp-presets" role="group" aria-label="Ecualización"><button type="button" data-eq="warm">Cálido</button><button type="button" data-eq="natural" class="cp-selected">Natural</button><button type="button" data-eq="bright">Brillante</button></div></div>'+
      '<div class="cp-row cp-speed-shortcuts"><span>Velocidad rápida</span><button type="button" data-speed="0.75">0,75×</button><button type="button" data-speed="1">1×</button><button type="button" data-speed="1.25">1,25×</button></div>';
    const originalAudioRow=audio.previousElementSibling;
    if(originalAudioRow&&originalAudioRow.classList.contains('flex'))originalAudioRow.after(ui);
    else card.insertBefore(ui,audio);
    audio.classList.add('cp-native-audio');
    audio.controls=false;

    speed.min='50'; speed.max='175'; speed.step='5';
    const meterCard=meter.closest('.card');
    if(meterCard&&meterCard!==card){
      meterCard.classList.add('cp-meter-card');
      card.append(meterCard);
    }
    const meterInfo=document.createElement('div');
    meterInfo.className='cp-meter-info';
    meterInfo.innerHTML='<span id="cp-beat-indicator" class="cp-beat-indicator" aria-hidden="true">● ● ● ●</span>'+
      '<strong id="cp-meter-state">Metrónomo automático · en silencio</strong>'+
      '<span>El clic se prepara al reproducir. Pulsa «Escuchar» para subir su volumen.</span>'+
      '<div class="cp-row"><button type="button" id="cp-align">🎯 Alinear primer pulso aquí</button><label>Volumen clic <input id="cp-click-volume" type="range" min="0" max="100" value="50"></label></div>'+
      '<small>Para un MP3 común, ajusta el BPM y alinea el primer pulso. La sincronización exacta no se detecta automáticamente.</small>';
    meterCard.append(meterInfo);

    const $=id=>document.getElementById(id);
    const playBtn=$('cp-play'),progress=$('cp-progress'),current=$('cp-current'),duration=$('cp-duration');
    const status=$('cp-status'),song=$('cp-song'),meterState=$('cp-meter-state');
    const volume=$('cp-volume'),mute=$('cp-mute'),clickVolume=$('cp-click-volume');
    const indicator=$('cp-beat-indicator'),align=$('cp-align');
    const sample=(Number(localStorage.getItem('consorte_bpm')||'100')||100);
    bpm.value=String(Math.max(30,Math.min(260,sample)));
    let ctx=null,low=null,high=null,graphReady=false,eq='natural';
    let audible=false,offset=0,lastScheduled=-1,timer=null,raf=null,nodes=[];
    let previousTime=-1,wasPlaying=false;
    const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    const fmt=t=>Number.isFinite(t)?Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0'):'0:00';
    const interval=()=>60/clamp(Number(bpm.value)||100,30,260);
    const count=()=>clamp(Number(beats.value)||4,2,6);
    const actualRate=()=>audio.playbackRate||1;
    const playing=()=>!audio.paused&&!audio.ended&&!!audio.currentSrc;
    function setStatus(){status.textContent=playing()?'Reproduciendo · '+Math.round(actualRate()*100)+'%':audio.ended?'Pista terminada':audio.currentSrc?'Pausada':'Lista para practicar';}
    function updateUI(){
      const name=$('audioName')?.textContent?.trim();
      song.textContent=name&&name!=='Sin seleccionar'?name:'Elige una canción';
      current.textContent=fmt(audio.currentTime);
      duration.textContent=fmt(audio.duration);
      progress.value=Number.isFinite(audio.duration)&&audio.duration>0?String(Math.round(audio.currentTime/audio.duration*1000)):'0';
      playBtn.textContent=playing()?'❚❚':'▶';
      playBtn.setAttribute('aria-label',playing()?'Pausar':'Reproducir');
      setStatus();
      const label=playing()?(audible?'🔊 Metrónomo audible':'🔇 Metrónomo activo en silencio'):'Metrónomo preparado en silencio';
      meterState.textContent=label;
      meter.textContent=audible?'🔇 Silenciar clic':'🔊 Escuchar clic';
      meter.classList.toggle('cp-click-on',audible);
      const n=count();
      const beat=audio.currentTime-offset;
      const phase=interval()>0?(beat/interval()):0;
      const beatNum=Math.round(phase);
      let light=-1;
      if(playing()&&beat>=0&&Math.abs(phase-beatNum)<0.13)light=((beatNum%n)+n)%n;
      indicator.innerHTML=Array.from({length:n},(_,i)=>'<span class="'+(i===light?'cp-beat-lit':'')+'">'+(i===0?'◆':'●')+'</span>').join(' ');
      lamp.classList.toggle('on',light===0);
    }
    function cancelScheduled(){
      lastScheduled=-1;
      if(ctx){const now=ctx.currentTime;for(const node of nodes){try{node.stop(now)}catch(e){}}}
      nodes=[];
    }
    async function unlock(){
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!AudioCtx)return false;
      if(!ctx)ctx=new AudioCtx();
      if(!graphReady){
        try{
          const src=ctx.createMediaElementSource(audio);
          low=ctx.createBiquadFilter();low.type='lowshelf';low.frequency.value=270;
          high=ctx.createBiquadFilter();high.type='highshelf';high.frequency.value=3000;
          src.connect(low).connect(high).connect(ctx.destination);
          graphReady=true;
          applyEQ();
        }catch(err){console.warn('Ecualizador no disponible:',err)}
      }
      try{if(ctx.state==='suspended')await ctx.resume()}catch(err){console.warn('Audio bloqueado:',err)}
      return ctx.state==='running';
    }
    function applyEQ(){
      if(!low||!high)return;
      low.gain.value=eq==='warm'?3:eq==='bright'?-1:0;
      high.gain.value=eq==='bright'?4:eq==='warm'?-2:0;
      document.querySelectorAll('#consorte-player-plus [data-eq]').forEach(b=>b.classList.toggle('cp-selected',b.dataset.eq===eq));
    }
    function chirp(when,index){
      if(!ctx||ctx.state!=='running'||!audible)return;
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type='sine';o.frequency.value=index%count()===0?1100:800;
      const gain=0.0005+Math.pow(Number(clickVolume.value)/100,1.4)*0.20;
      g.gain.setValueAtTime(0.0001,when);
      g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),when+.004);
      g.gain.exponentialRampToValueAtTime(.0001,when+.065);
      o.connect(g).connect(ctx.destination);
      o.onended=()=>{o.disconnect();g.disconnect();nodes=nodes.filter(x=>x!==o)};
      o.start(when);o.stop(when+.07);nodes.push(o);
    }
    function schedule(){
      if(!playing()||!audible||!ctx||ctx.state!=='running')return;
      const now=audio.currentTime,step=interval(),rate=actualRate(),lead=.12;
      let first=Math.max(0,Math.ceil((now-offset-.006)/step));
      let end=now+lead*rate;
      for(let i=first;i<first+4;i++){
        const t=offset+i*step;
        if(t>end)break;
        if(t<now-.045||i<=lastScheduled)continue;
        const when=ctx.currentTime+Math.max(.003,(t-now)/rate);
        chirp(when,i);lastScheduled=i;
      }
      if(previousTime>=0&&(now+0.12<previousTime||now-previousTime>1.0))cancelScheduled();
      previousTime=now;
    }
    function startClock(){
      if(timer)clearInterval(timer);
      timer=setInterval(()=>{schedule();updateUI()},25);
      if(raf)cancelAnimationFrame(raf);
      function animate(){updateUI();if(playing())raf=requestAnimationFrame(animate);else raf=null}
      raf=requestAnimationFrame(animate);
    }
    function pauseClock(){
      if(timer)clearInterval(timer);timer=null;
      if(raf)cancelAnimationFrame(raf);raf=null;
      cancelScheduled();updateUI();
    }
    function resetTrack(){
      audible=false;offset=0;previousTime=-1;cancelScheduled();updateUI();
    }
    playBtn.addEventListener('click',async()=>{
      if(!audio.currentSrc){document.getElementById('chooseAudio')?.click();return}
      if(playing()){audio.pause();return}
      await unlock();
      try{await audio.play()}catch(err){status.textContent='No se pudo reproducir el audio';console.warn(err)}
    });
    $('cp-back').onclick=()=>{audio.currentTime=Math.max(0,audio.currentTime-10)};
    $('cp-forward').onclick=()=>{if(Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,audio.currentTime+10)};
    progress.addEventListener('input',()=>{if(Number.isFinite(audio.duration)&&audio.duration>0){audio.currentTime=audio.duration*Number(progress.value)/1000;cancelScheduled();}});
    volume.oninput=()=>{audio.volume=Number(volume.value)/100;mute.textContent=audio.volume===0?'🔇 Audio':'🔊 Audio';};
    mute.onclick=()=>{audio.muted=!audio.muted;mute.textContent=audio.muted?'🔇 Audio':'🔊 Audio';};
    ui.querySelectorAll('[data-eq]').forEach(b=>b.onclick=async()=>{await unlock();eq=b.dataset.eq;applyEQ()});
    ui.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>{
      const p=Math.round(Number(b.dataset.speed)*100);
      speed.value=String(p);speed.dispatchEvent(new Event('input',{bubbles:true}));
      audio.playbackRate=p/100;cancelScheduled();updateUI();
    });
    speed.addEventListener('input',()=>{audio.playbackRate=Number(speed.value)/100;speedText.textContent=speed.value+'%';cancelScheduled();updateUI();});
    meter.onclick=async()=>{
      if(!audio.currentSrc){document.getElementById('chooseAudio')?.click();return}
      await unlock();
      audible=!audible;cancelScheduled();schedule();updateUI();
    };
    bpm.addEventListener('change',()=>{
      bpm.value=String(clamp(Number(bpm.value)||100,30,260));
      try{localStorage.setItem('consorte_bpm',bpm.value)}catch(e){}
      cancelScheduled();updateUI();
    });
    beats.addEventListener('change',()=>{cancelScheduled();updateUI()});
    align.onclick=()=>{
      if(!audio.currentSrc)return;
      offset=audio.currentTime;
      cancelScheduled();schedule();updateUI();
      align.textContent='✓ Primer pulso alineado';
      setTimeout(()=>{align.textContent='🎯 Alinear primer pulso aquí'},1600);
    };
    audio.addEventListener('play',()=>{previousTime=-1;startClock();});
    audio.addEventListener('pause',pauseClock);
    audio.addEventListener('ended',pauseClock);
    audio.addEventListener('seeking',()=>{cancelScheduled();previousTime=-1});
    audio.addEventListener('seeked',()=>{cancelScheduled();schedule()});
    audio.addEventListener('ratechange',()=>{cancelScheduled();updateUI()});
    audio.addEventListener('loadedmetadata',updateUI);
    audio.addEventListener('loadstart',resetTrack);
    audio.addEventListener('emptied',resetTrack);
    audio.addEventListener('volumechange',()=>{mute.textContent=audio.muted||audio.volume===0?'🔇 Audio':'🔊 Audio'});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=null;}else if(playing())startClock()});
    updateUI();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
