
// Motor experimental de alineación partitura/audio. No modifica Biblioteca Consorte.
(()=>{
  const originalRender=render;
  let opticalByPage=new Map(),audioOnsets=[],timeAnchors=[],scoreEvents=[],xmlMeasures=[],alignmentReady=false;
  let analyzedFile=null,analysisBusy=false,analysisEpoch=0;
  const label=document.createElement('p');label.className='muted';label.id='syncMethod';
  label.textContent='La alineación compara ataques del audio con figuras reconocidas. En PDF es experimental; MusicXML permite duraciones exactas.';
  $('status').after(label);
  const xmlLabel=document.createElement('label');
  xmlLabel.textContent='Partitura MusicXML opcional (mayor precisión)';
  const xmlInput=document.createElement('input');xmlInput.type='file';xmlInput.accept='.musicxml,.xml,.mxl';xmlInput.id='xmlFile';
  xmlLabel.append(xmlInput);$('scoreFile').parentElement.after(xmlLabel);
  const detail=document.createElement('p');detail.className='muted';detail.id='syncDetail';
  $('scoreAnalysis').after(detail);
  const manual=document.createElement('div');manual.className='control';
  manual.innerHTML='<button type="button" id="syncNudgeBack">◀ 0,25 s</button><button type="button" id="syncNudgeFwd">0,25 s ▶</button>';
  $('setStart').parentElement.after(manual);
  const indicator=document.createElement('div');indicator.className='line';indicator.id='noteCursor';
  indicator.style.cssText='position:absolute;background:#2878d090;border:1px solid #1455a8;width:4px;z-index:5;pointer-events:none';
  function durationOfMeter(){
    const m=$('meter').value.split('/').map(Number);
    return m.length===2&&m.every(Number.isFinite)?m[0]*4/m[1]:null;
  }
  function parseXml(xmlText){
    const data=new DOMParser().parseFromString(xmlText,'text/xml');
    if(data.querySelector('parsererror'))throw Error('MusicXML no válido');
    const part=data.querySelector('score-partwise > part')||data.querySelector('part');
    if(!part)throw Error('MusicXML sin parte musical');
    let divisions=1,current=0,meterVal='',measures=[];
    for(const measure of [...part.children].filter(x=>x.localName==='measure')){
      let start=current,elapsed=0,events=[],lastStart=0,barDuration=0;
      const attrs=[...measure.children].filter(x=>x.localName==='attributes');
      for(const attr of attrs){
        const d=attr.querySelector('divisions');if(d)divisions=Number(d.textContent)||divisions;
        const beats=attr.querySelector('time > beats'),type=attr.querySelector('time > beat-type');
        if(beats&&type){const v=beats.textContent.trim()+'/'+type.textContent.trim();if(/^\d+\/\d+$/.test(v))meterVal=v}
      }
      for(const el of measure.children){
        if(el.localName==='backup'){elapsed=Math.max(0,elapsed-(Number(el.querySelector('duration')?.textContent)||0)/divisions);continue}
        if(el.localName==='forward'){elapsed+=(Number(el.querySelector('duration')?.textContent)||0)/divisions;continue}
        if(el.localName!=='note')continue;
        const dur=(Number(el.querySelector('duration')?.textContent)||0)/divisions;
        const chord=!!el.querySelector('chord');
        const startNote=chord?lastStart:elapsed;
        if(!chord)lastStart=elapsed;
        if(!el.querySelector('rest')&&!events.some(e=>Math.abs(e.q-startNote)<.001)){
          const noteType=el.querySelector('type')?.textContent||'';
          events.push({q:startNote,type:noteType,duration:dur});
        }
        if(!chord)elapsed+=dur;
        barDuration=Math.max(barDuration,elapsed);
      }
      let expected=durationOfMeter();
      if(meterVal){let [a,b]=meterVal.split('/').map(Number);expected=a*4/b}
      const length=Math.max(.1,barDuration||expected||4);
      measures.push({q:start,length,events:events.sort((a,b)=>a.q-b.q),meter:meterVal});
      current+=length;
    }
    return measures;
  }
  xmlInput.onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(/\.mxl$/i.test(file.name)){$('syncDetail').textContent='Los .mxl están comprimidos. Exporta la partitura como .musicxml sin comprimir.';return}
    try{
      xmlMeasures=parseXml(await file.text());
      const meter=xmlMeasures.find(x=>x.meter)?.meter;
      if(meter&&[...$('meter').options].some(o=>o.value===meter))setMeter(meter,'leído desde MusicXML');
      $('syncDetail').textContent='MusicXML leído: '+xmlMeasures.length+' compases y '+xmlMeasures.reduce((a,x)=>a+x.events.length,0)+' ataques musicales.';
      invalidate();
      if(audioOnsets.length)await analyzeBetter();
    }catch(error){xmlMeasures=[];$('syncDetail').textContent=error.message}
  };
  function scanNotes(canvas,syss){
    const w=canvas.width,h=canvas.height,c=canvas.getContext('2d',{willReadFrequently:true});
    const p=c.getImageData(0,0,w,h).data;
    const dark=(x,y)=>{if(x<0||x>=w||y<0||y>=h)return false;const i=(Math.floor(y)*w+Math.floor(x))*4;return p[i]+p[i+1]+p[i+2]<420};
    const all=[];
    for(const system of syss){
      const g=system.spacing||12;
      const lines=system.ys||[];
      for(const m of system.measures||[]){
        const left=Math.round(m.left*w),right=Math.round((m.left+m.width)*w);
        const y0=Math.max(0,Math.round(lines[0]-g*1.5)),y1=Math.min(h-1,Math.round(lines[4]+g*1.5));
        const x0=left+Math.ceil(g*.7),x1=right-Math.ceil(g*.6);
        if(x1<=x0){all.push({...m,notes:[]});continue}
        const scores=[];
        const radius=Math.max(2,Math.round(g*.35));
        for(let x=x0;x<=x1;x++){
          let mass=0,rows=0;
          for(let y=y0;y<=y1;y++){
            if(lines.some(ly=>Math.abs(y-ly)<=1.5))continue;
            let run=0;
            for(let xx=x-radius;xx<=x+radius;xx++)if(dark(xx,y))run++;
            // Filled noteheads are compact horizontal clusters; ignore single-pixel stems.
            if(run>radius*1.3){mass++;rows++}
          }
          scores.push({x,value:mass});
        }
        const peaks=[];
        const threshold=Math.max(3,g*.36);
        for(let i=2;i<scores.length-2;i++){
          const v=scores[i].value;
          if(v<threshold||v<scores[i-2].value||v<scores[i+2].value)continue;
          if(peaks.length&&scores[i].x-peaks.at(-1).x<g*.9){
            if(v>peaks.at(-1).value)peaks[peaks.length-1]=scores[i];
          }else peaks.push(scores[i]);
        }
        // Remove note-like marks too near the barline; cap implausible OCR counts.
        const notes=peaks.filter(x=>x.x>left+g*.8&&x.x<right-g*.55).slice(0,48).map(x=>({x:x.x/w,qFraction:(x.x-left)/Math.max(1,right-left),weight:x.value}));
        all.push({...m,notes});
      }
    }
    return all;
  }
  async function analyzeScorePage(p){
    if(opticalByPage.has(p))return opticalByPage.get(p);
    const canvas=document.createElement('canvas');
    if(doc){const pg=await doc.getPage(p),v=pg.getViewport({scale:1.25});
      canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);
      await pg.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;
    }else{const img=new Image();img.src=imgUrl;await img.decode();canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0)}
    const groups=detectStaffSystems(canvas);
    const measures=scanNotes(canvas,groups);
    const result={page:p,measures,groups};
    opticalByPage.set(p,result);scorePages.set(p,measures.length);
    return result;
  }
  function invalidate(){opticalByPage.clear();timeAnchors=[];scoreEvents=[];alignmentReady=false;}
  // Preserve the existing render and add a note indicator over the recognized measure.
  render=async function(){
    await originalRender();
    if(!count)return;
    const c=$('score').querySelector('canvas'),paper=$('score').querySelector('.paper');
    if(!c||!paper)return;
    try{
      let o=opticalByPage.get(page);
      if(!o){
        o={page,groups:systems,measures:scanNotes(c,systems)};
        opticalByPage.set(page,o);scorePages.set(page,o.measures.length);
      }
      $('scoreAnalysis').textContent=o.groups.length+' pentagramas, '+o.measures.length+' compases y '+o.measures.reduce((a,m)=>a+m.notes.length,0)+' posibles figuras detectadas en esta página.';
      const mark=indicator.cloneNode();paper.append(mark);mark.hidden=true;
    }catch(e){$('syncDetail').textContent='No se pudieron interpretar las figuras de esta página: '+e.message}
  };
  function onsetAnalysis(buffer){
    const sr=buffer.sampleRate;
    const hop=Math.max(256,Math.round(sr*.0116)),total=Math.floor(buffer.length/hop),channels=Math.min(buffer.numberOfChannels,2);
    const audio=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
    const energy=new Float32Array(total),treble=new Float32Array(total);
    for(let t=0;t<total;t++){
      let sum=0,fast=0;
      for(let k=0;k<hop;k+=2){
        const pos=t*hop+k;if(pos>=buffer.length)break;
        let a=0,b=0;
        for(let ch=0;ch<channels;ch++){a+=audio[ch][pos];b+=audio[ch][Math.max(0,pos-1)]}
        a/=channels;b/=channels;sum+=Math.abs(a);fast+=Math.abs(a-b);
      }
      energy[t]=sum;treble[t]=fast;
    }
    const novelty=new Float32Array(total);
    let avg=0,prev=energy[0]||0,prevFast=treble[0]||0,maxE=0;
    for(let i=1;i<total;i++){
      avg=avg*.99+energy[i]*.01;
      novelty[i]=Math.max(0,energy[i]-prev)*.55+Math.max(0,treble[i]-prevFast)*.65;
      maxE=Math.max(maxE,energy[i]);prev=energy[i];prevFast=treble[i];
    }
    const peaks=[];
    let running=0;
    const radius=Math.max(3,Math.round(.07*sr/hop));
    for(let i=radius+1;i<total-radius-1;i++){
      running=running*.97+novelty[i]*.03;
      const value=novelty[i];if(value<running*1.6||value<maxE*.025)continue;
      let winner=true;
      for(let k=-radius;k<=radius;k++)if(novelty[i+k]>value){winner=false;break}
      if(!winner)continue;
      const time=i*hop/sr;
      if(peaks.length&&time-peaks.at(-1).time<.085){
        if(value>peaks.at(-1).strength)peaks[peaks.length-1]={time,strength:value};
      }else peaks.push({time,strength:value});
    }
    return peaks;
  }
  function makeEvents(){
    const beat=durationOfMeter()||4;
    let q=0,bars=[];
    if(xmlMeasures.length){
      const visual=[...opticalByPage.values()].sort((a,b)=>a.page-b.page).flatMap(p=>p.measures.map(m=>({...m,page:p.page})));
      bars=xmlMeasures.map((m,i)=>{
        const shape=visual[i]||{},seen=shape.notes||[];
        return {...shape,q:m.q,length:m.length,barIndex:i,page:shape.page||1,
          notes:m.events.map((ev,j)=>{
            const fraction=Math.max(0,Math.min(.99,ev.q/Math.max(.01,m.length)));
            const observed=seen.length?seen[Math.min(seen.length-1,Math.round(j*seen.length/Math.max(1,m.events.length)))]:null;
            return {q:m.q+ev.q,type:ev.type,x:observed?.x??((shape.left||0)+(shape.width||0)*fraction)}
          })
        }
      });
      return bars;
    }
    for(let p=1;p<=count;p++){
      const pageData=opticalByPage.get(p);
      if(!pageData)continue;
      for(const measure of pageData.measures){
        bars.push({...measure,q,length:beat,page:p,barIndex:bars.length,notes:measure.notes.map(n=>({...n,q:q+n.qFraction*beat}))});
        q+=beat;
      }
    }
    return bars;
  }
  function matchTimeline(bars,onsets,estimatedBpm,initialOffset){
    if(!bars.length)throw Error('No se detectaron compases de la partitura');
    const secondsPerQuarter=60/estimatedBpm;
    const idealEvents=bars.flatMap((bar,i)=>[{q:bar.q,kind:'bar',bar:i},...bar.notes.map((n,j)=>({q:n.q,kind:'note',bar:i,index:j}))]).sort((a,b)=>a.q-b.q);
    const signal=onsets.map(x=>x.strength).sort((a,b)=>a-b);
    const median=signal[Math.floor(signal.length*.5)]||1;
    let previous=initialOffset-.04,shift=0,matches=[],anchors=[],priorQ=null,priorTime=null;
    for(const ev of idealEvents){
      if(priorQ!==null&&Math.abs(ev.q-priorQ)<.001){
        matches.push({time:priorTime,...ev});
        continue;
      }
      const ideal=initialOffset+ev.q*secondsPerQuarter;
      const prediction=ideal+shift;
      const spread=Math.min(.48,Math.max(.12,secondsPerQuarter*.65));
      let best=null,score=-1e10;
      for(const p of onsets){
        if(p.time<previous+.055||p.time<prediction-spread)continue;
        if(p.time>prediction+spread)break;
        const proximity=Math.abs(p.time-prediction)/spread;
        const volume=Math.min(2.5,p.strength/median);
        const value=.3*volume-proximity;
        if(value>score){score=value;best=p}
      }
      if(best&&score>-.65){
        const correction=best.time-prediction;
        shift+=Math.max(-.16,Math.min(.16,correction*.22));
        matches.push({time:best.time,...ev});
        previous=best.time;
      }else matches.push({time:Math.max(previous+.01,prediction),...ev});
      priorQ=ev.q;priorTime=matches.at(-1).time;
    }
    for(let i=0;i<bars.length;i++){
      const match=matches.find(x=>x.kind==='bar'&&x.bar===i);
      anchors.push({time:match?.time??initialOffset+bars[i].q*secondsPerQuarter,bar:i});
    }
    // Monotonicity is essential: never run backwards on a rubato audio.
    for(let i=1;i<anchors.length;i++)anchors[i].time=Math.max(anchors[i].time,anchors[i-1].time+.08);
    return {anchors,events:matches};
  }
  function nearestNotes(bar,beatFraction){
    const notes=bar?.notes||[];
    if(!notes.length)return null;
    const frac=Math.max(0,Math.min(.999,beatFraction));
    const idx=notes.findLastIndex(n=>((n.q-bar.q)/bar.length)<=frac+.0001);
    return notes[Math.max(0,idx)];
  }
  async function analyzeBetter(){
    if(analysisBusy)return;
    const file=$('audioFile').files?.[0];if(!file)return;
    analysisBusy=true;$('analyze').disabled=true;
    try{
      const epoch=++analysisEpoch;
      setStatus('Escuchando ataques, cambios y silencios del audio…');
      await new Promise(r=>setTimeout(r,30));
      const ctx=new (window.AudioContext||window.webkitAudioContext)();
      let buffer;
      try{buffer=await ctx.decodeAudioData(await file.arrayBuffer())}finally{await ctx.close()}
      const old=detect(buffer);tempo=old.bpm;offset=old.offset;
      audioOnsets=onsetAnalysis(buffer);
      if(!audioOnsets.length)throw Error("No se pudieron identificar ataques musicales suficientemente claros en esta grabación.");
      analyzedFile=file;
      $('bpm').textContent=tempo;
      $('confidence').textContent=old.confidence+'%';
      if(!count){setStatus('Analicé '+audioOnsets.length+' ataques. Carga una partitura para vincularlos.');return}
      if(!$('meter').value){
        setStatus('Selecciona el tipo de compás: no se reconoció en la partitura.');return
      }
      for(let p=1;p<=count;p++){
        if(epoch!==analysisEpoch)return;
        if(!opticalByPage.has(p)){
          setStatus('Leyendo figuras y barras · página '+p+' de '+count);
          await analyzeScorePage(p);
        }
      }
      const bars=makeEvents();
      if(!bars.length)throw Error('No se encontraron barras de compás en la partitura. Usa una imagen más nítida o MusicXML.');
      if(xmlMeasures.length&&bars.some(b=>b.width===undefined))$('syncDetail').textContent='Aviso: MusicXML y PDF tienen distinto número de compases; revisa que sean de la misma edición.';
      const result=matchTimeline(bars,audioOnsets,tempo,offset);
      timeAnchors=result.anchors;scoreEvents=result.events;alignmentReady=true;
      $('syncDetail').textContent=xmlMeasures.length?'MusicXML: tiempos de notas leídos; ajustes aproximados por ataques del audio.':'PDF: figuras estimadas por imagen; tiempos ajustados mediante ataques detectados. La identificación de figuras es limitada.';
      setStatus('Listo: '+bars.length+' compases, '+audioOnsets.length+' ataques de audio detectados. Reproduce y comprueba el resaltado.');
      update();
    }catch(e){alignmentReady=false;setStatus('No se pudo alinear: '+e.message)}
    finally{analysisBusy=false;$('analyze').disabled=false}
  }
  $('analyze').textContent='Analizar audio y sincronizar partitura';
  $('analyze').onclick=analyzeBetter;
  // Replace simplistic uniform-time stepping with a monotonically aligned timeline.
  const oldUpdate=update;
  update=function(){
    if(!alignmentReady||!timeAnchors.length){oldUpdate();return}
    const t=player.currentTime;
    let lo=0,hi=timeAnchors.length-1;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(timeAnchors[mid].time<=t)lo=mid;else hi=mid-1}
    const index=lo;
    const bars=makeEvents();
    const bar=bars[index];
    if(!bar)return;
    $('bar').textContent=String(index+1);
    const next=timeAnchors[index+1]?.time||timeAnchors[index].time+(bar.length*60/tempo);
    const fraction=Math.max(0,Math.min(.999,(t-timeAnchors[index].time)/Math.max(.05,next-timeAnchors[index].time)));
    const pulseCount=(()=>{const m=$('meter').value.split('/').map(Number);return m[1]===8&&m[0]%3===0?m[0]/3:m[0]||4})();
    const pulse=Math.min(pulseCount-1,Math.floor(fraction*pulseCount));
    $('beats').replaceChildren(...Array.from({length:pulseCount},(_,i)=>{const d=document.createElement('div');d.className='beat'+(i===pulse?' on':'');return d}));
    const desired=bar.page||1;
    if(desired!==page&&desired<=count){page=desired;render();return}
    const local=opticalByPage.get(page)?.measures;
    const entry=local?.find(x=>x===bar)||local?.[bars.slice(0,index+1).filter(x=>x.page===page).length-1];
    const rect=$('cursor');
    if(rect){
      if(!entry){rect.hidden=true}else{
        rect.hidden=false;rect.style.left=entry.left*100+'%';rect.style.width=entry.width*100+'%';
        rect.style.top=entry.top*100+'%';rect.style.height=entry.height*100+'%';
      }
    }
    const note=$('noteCursor'),current=nearestNotes(bar,fraction);
    if(note){
      note.hidden=!entry||!current;
      if(entry&&current){
        note.style.left=((current.x??entry.left+entry.width*fraction)*100)+'%';
        note.style.top=(entry.top*100)+'%';note.style.height=(entry.height*100)+'%';
      }
    }
  };
  // If a new file is selected, previous alignment must never silently carry over.
  $('scoreFile').addEventListener('change',()=>{invalidate();if(analyzedFile)analyzedFile=null},true);
  $('audioFile').addEventListener('change',()=>{invalidate();analyzedFile=null},true);
  $('meter').addEventListener('change',()=>{invalidate();setStatus('Compás cambiado. Pulsa Analizar audio y sincronizar.')});
  $('setStart').addEventListener('click',()=>{
    if(!audioOnsets.length||!count||!tempo||!$('meter').value)return;
    try{
      const result=matchTimeline(makeEvents(),audioOnsets,tempo,offset);
      timeAnchors=result.anchors;scoreEvents=result.events;alignmentReady=true;
      setStatus('Inicio ajustado en '+offset.toFixed(2)+' s. Seguimiento actualizado.');
      update();
    }catch(e){setStatus('No se pudo ajustar el inicio: '+e.message)}
  });
  $('syncNudgeBack').onclick=()=>{offset-=.25;if(alignmentReady){for(const a of timeAnchors)a.time-=.25}update()};
  $('syncNudgeFwd').onclick=()=>{offset+=.25;if(alignmentReady){for(const a of timeAnchors)a.time+=.25}update()};
})();
