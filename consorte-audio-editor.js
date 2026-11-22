/* Biblioteca Consort — editor de audio no destructivo con marcas por segundo.
   Funciona con el reproductor y la base de datos existentes. */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const player=byId('player'), host=document.querySelector('.stickyAudio');
if(!player||!host)return;
const bridge=()=>window.consorteAudioEditorBridge;
const toggle=document.createElement('button');
toggle.type='button';toggle.id='consorte-editor-toggle';toggle.textContent='✂ Abrir editor de audio';toggle.setAttribute('aria-expanded','false');
host.append(toggle);
const panel=document.createElement('section');
panel.id='consorte-audio-editor';panel.hidden=true;
panel.setAttribute('aria-label','Editor de audio');
panel.innerHTML=[
'<h3>Editor de audio</h3>',
'<p>Corta, añade audio, crea marcas y guarda tus cambios. El original no se altera hasta que confirmes reemplazarlo.</p>',
'<canvas class="ce-wave" id="ce-wave" role="img" aria-label="Forma de onda. Pulsa para elegir el segundo de reproducción"></canvas>',
'<div class="ce-row"><span class="ce-helper" id="ce-duration">0:00</span><button type="button" id="ce-start-now">Inicio = segundo actual</button><button type="button" id="ce-end-now">Final = segundo actual</button></div>',
'<div class="ce-selection"><label>Inicio del tramo <span id="ce-start-label">0:00</span><input type="range" id="ce-start" min="0" max="1000" value="0"></label><label>Fin del tramo <span id="ce-end-label">0:00</span><input type="range" id="ce-end" min="0" max="1000" value="1000"></label></div>',
'<div class="ce-row"><button type="button" id="ce-cut">✂ Conservar selección</button><button type="button" id="ce-remove">Eliminar selección</button><button type="button" id="ce-silence">Silenciar tramo</button><button type="button" id="ce-fade">Fundido de entrada/salida</button><button type="button" id="ce-normalize">Normalizar volumen</button><button type="button" id="ce-reverse">Invertir tramo</button></div>',
'<div class="ce-row"><button type="button" id="ce-append">＋ Agregar audio al final</button><input type="file" id="ce-append-file" accept="audio/*,.wav,.mp3,.m4a,.ogg" hidden><button type="button" id="ce-undo">↶ Deshacer última edición</button><button type="button" id="ce-original">Restablecer original</button></div>',
'<div class="ce-row"><button type="button" class="ce-primary" id="ce-mark">🔖 Crear marca en este segundo</button><span class="ce-helper">Pulsa una marca para escuchar desde ese segundo.</span></div>',
'<h3>Lista de marcas <span id="ce-count">(0)</span></h3><div class="ce-mark-list" id="ce-marks"></div>',
'<div class="ce-actions"><button type="button" class="ce-primary" id="ce-copy">Guardar copia en la biblioteca</button><button type="button" class="ce-danger" id="ce-replace">Reemplazar audio original</button><button type="button" id="ce-mp3">Descargar en MP3</button></div>',
'<p class="ce-helper">La exportación MP3 requiere descargar el codificador la primera vez. Las marcas quedan asociadas a este audio en este navegador.</p>',
'<div class="ce-status" id="ce-status" role="status" aria-live="polite"></div>'
].join('');
host.append(panel);
const el=id=>panel.querySelector('#'+id);
const canvas=el('ce-wave');
let original=null,working=null,record=null,dirty=false,busy=false,undo=null,previewUrl=null,markData=[];
let start=0,end=0,loading=null;
const status=t=>el('ce-status').textContent=t;
const sec=t=>Math.max(0,Number(t)||0);
const time=t=>{t=Math.floor(sec(t));return Math.floor(t/60)+':'+String(t%60).padStart(2,'0')};
const key=id=>'consorte_audio_cues_v1_'+String(id);
function readMarks(){try{const data=JSON.parse(localStorage.getItem(key(record.id))||'[]');return Array.isArray(data)?data.filter(x=>Number.isFinite(x.time)).map(x=>({id:String(x.id||crypto.randomUUID()),time:x.time,name:String(x.name||'Marca')})):[]}catch(_){return []}}
function saveMarks(){if(!record)return;try{localStorage.setItem(key(record.id),JSON.stringify(markData))}catch(e){status('No se pudieron guardar las marcas en este navegador: '+e.message)}}
function draw(){
 const ctx=canvas.getContext('2d');if(!ctx)return;
 const width=Math.max(250,canvas.clientWidth||550),height=110;
 const ratio=Math.min(2,devicePixelRatio||1);
 canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
 ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
 ctx.fillStyle='#edf3fb';ctx.fillRect(0,0,width,height);
 if(!working)return;
 const data=working.getChannelData(0),length=data.length,duration=working.duration;
 const bins=Math.floor(width/3),center=height/2;
 for(let x=0;x<bins;x++){
  const a=Math.floor(x*length/bins),b=Math.max(a+1,Math.floor((x+1)*length/bins));
  const stride=Math.max(1,Math.floor((b-a)/65));let peak=0;
  for(let j=a;j<b;j+=stride)peak=Math.max(peak,Math.abs(data[j]));
  const px=x*width/bins,h=Math.max(1,peak*(height-23));
  ctx.fillStyle=x/bins>=start/duration&&x/bins<=end/duration?'#2563eb':'#adc2dd';
  ctx.fillRect(px,center-h/2,Math.max(2,width/bins-1),h);
 }
 const sX=start/duration*width,eX=end/duration*width;
 ctx.strokeStyle='#1d4ed8';ctx.lineWidth=2;
 for(const x of [sX,eX]){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke()}
 markData.forEach(m=>{
  const x=Math.min(width,Math.max(0,m.time/duration*width));
  ctx.fillStyle='#173c86';ctx.fillRect(x-1,0,2,19);
  ctx.beginPath();ctx.moveTo(x-5,0);ctx.lineTo(x+5,0);ctx.lineTo(x+5,9);ctx.lineTo(x,13);ctx.lineTo(x-5,9);ctx.fill()
 });
 const x=sec(player.currentTime)/duration*width;
 if(Number.isFinite(x)){ctx.strokeStyle='#e67e22';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke()}
}
function rangeLabels(){if(!working)return;el('ce-start-label').textContent=time(start);el('ce-end-label').textContent=time(end);el('ce-duration').textContent='Duración '+time(working.duration)+' · Selección '+time(Math.max(0,end-start));draw()}
function syncSliders(){if(!working)return;el('ce-start').value=Math.round(start/working.duration*1000);el('ce-end').value=Math.round(end/working.duration*1000);rangeLabels()}
function setSelection(which,value){if(!working)return;const t=sec(value)/1000*working.duration,limit=1/working.sampleRate;if(which==='start')start=Math.min(t,end-limit);else end=Math.max(t,start+limit);syncSliders()}
el('ce-start').oninput=e=>setSelection('start',e.target.value);
el('ce-end').oninput=e=>setSelection('end',e.target.value);
el('ce-start-now').onclick=()=>{if(working){start=Math.min(sec(player.currentTime),end-1/working.sampleRate);syncSliders()}};
el('ce-end-now').onclick=()=>{if(working){end=Math.max(sec(player.currentTime),start+1/working.sampleRate);syncSliders()}};
canvas.addEventListener('click',e=>{if(!working)return;const rect=canvas.getBoundingClientRect();player.currentTime=Math.min(working.duration,Math.max(0,(e.clientX-rect.left)/rect.width*working.duration));draw()});
player.addEventListener('timeupdate',()=>{if(!panel.hidden)draw()});
function encodeWav(buffer){
 const channels=Math.min(2,buffer.numberOfChannels),frames=buffer.length;
 const output=new ArrayBuffer(44+frames*channels*2),v=new DataView(output);
 const write=(offset,value)=>{for(let i=0;i<value.length;i++)v.setUint8(offset+i,value.charCodeAt(i))};
 write(0,'RIFF');v.setUint32(4,36+frames*channels*2,true);write(8,'WAVE');write(12,'fmt ');
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);
 v.setUint32(28,buffer.sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);write(36,'data');v.setUint32(40,frames*channels*2,true);
 let offset=44;const arrays=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));
 for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){const sample=Math.max(-1,Math.min(1,arrays[c][i]));v.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2}
 return new Blob([output],{type:'audio/wav'});
}
function copyBuffer(src){const out=new AudioBuffer({numberOfChannels:src.numberOfChannels,length:src.length,sampleRate:src.sampleRate});for(let c=0;c<src.numberOfChannels;c++)out.copyToChannel(src.getChannelData(c),c);return out}
function sliceBuffer(src,begin,finish){const a=Math.max(0,Math.floor(begin*src.sampleRate)),b=Math.min(src.length,Math.ceil(finish*src.sampleRate));if(b<=a)throw Error('Selecciona un tramo con duración.');const out=new AudioBuffer({numberOfChannels:src.numberOfChannels,length:b-a,sampleRate:src.sampleRate});for(let c=0;c<src.numberOfChannels;c++)out.getChannelData(c).set(src.getChannelData(c).subarray(a,b));return out}
function joinBuffers(a,b){const out=new AudioBuffer({numberOfChannels:a.numberOfChannels,length:a.length+b.length,sampleRate:a.sampleRate});for(let c=0;c<a.numberOfChannels;c++){out.getChannelData(c).set(a.getChannelData(c),0);out.getChannelData(c).set(b.getChannelData(Math.min(c,b.numberOfChannels-1)),a.length)}return out}
async function decode(blob){const ctx=new (window.AudioContext||window.webkitAudioContext)();try{return await ctx.decodeAudioData(await blob.arrayBuffer())}finally{await ctx.close()}}
async function resample(buffer,sampleRate,channels){
 const offline=new OfflineAudioContext(channels,Math.ceil(buffer.duration*sampleRate),sampleRate);
 const src=offline.createBufferSource();src.buffer=buffer;src.connect(offline.destination);src.start(0);return offline.startRendering()
}
function shiftMarks(fn){markData=markData.map(m=>({...m,time:fn(m.time)})).filter(m=>m.time>=0&&m.time<=working.duration+0.001);saveMarks();renderMarks()}
async function refreshPreview(){if(!working)return;const blob=encodeWav(working),url=URL.createObjectURL(blob);const previous=previewUrl;previewUrl=url;player.pause();player.src=url;player.load();if(previous)URL.revokeObjectURL(previous)}
async function edit(fn,msg,move){if(!working||busy)return;try{
 busy=true;status('Aplicando edición…');undo={audio:copyBuffer(working),marks:markData.map(m=>({...m}))};
 const result=fn(working);working=result;dirty=true;start=0;end=working.duration;
 if(move)shiftMarks(move);else{markData=markData.filter(m=>m.time<=working.duration);saveMarks();renderMarks()}
 syncSliders();await refreshPreview();status(msg)
 }catch(e){status('Error al editar: '+e.message)}finally{busy=false}}
el('ce-cut').onclick=()=>{const a=start,b=end;edit(buf=>sliceBuffer(buf,a,b),'Se conservó el tramo seleccionado.',t=>t-a)};
el('ce-remove').onclick=()=>{const a=start,b=end;edit(buf=>{if(b-a>=buf.duration)throw Error('No puedes eliminar todo el audio');return joinBuffers(sliceBuffer(buf,0,a),sliceBuffer(buf,b,buf.duration))},'Tramo eliminado.',t=>t>=b?t-(b-a):t>=a?-1:t)};
el('ce-silence').onclick=()=>{const a=start,b=end;edit(buf=>{const out=copyBuffer(buf);for(let c=0;c<out.numberOfChannels;c++)out.getChannelData(c).fill(0,Math.floor(a*out.sampleRate),Math.ceil(b*out.sampleRate));return out},'Tramo silenciado.')};
el('ce-fade').onclick=()=>{const a=start,b=end;edit(buf=>{const out=copyBuffer(buf),i0=Math.floor(a*out.sampleRate),i1=Math.ceil(b*out.sampleRate),len=i1-i0;for(let c=0;c<out.numberOfChannels;c++){const d=out.getChannelData(c);for(let i=i0;i<i1;i++){const x=(i-i0)/Math.max(1,len-1);d[i]*=Math.min(1,4*x,4*(1-x))}}return out},'Fundido de entrada y salida aplicado.')};
el('ce-normalize').onclick=()=>edit(buf=>{const out=copyBuffer(buf);let max=0;for(let c=0;c<out.numberOfChannels;c++)for(const v of out.getChannelData(c))max=Math.max(max,Math.abs(v));if(max>0)for(let c=0;c<out.numberOfChannels;c++){const d=out.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=.95/max}return out},'Volumen normalizado.');
el('ce-reverse').onclick=()=>{const a=start,b=end;edit(buf=>{const out=copyBuffer(buf),i0=Math.floor(a*out.sampleRate),i1=Math.ceil(b*out.sampleRate);for(let c=0;c<out.numberOfChannels;c++){const d=out.getChannelData(c);for(let i=0;i<(i1-i0)/2;i++){const j=i1-1-i,temp=d[i0+i];d[i0+i]=d[j];d[j]=temp}}return out},'Tramo invertido.')};
el('ce-append').onclick=()=>el('ce-append-file').click();
el('ce-append-file').onchange=async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file||!working||busy)return;
 try{busy=true;status('Leyendo '+file.name+'…');let addition=await decode(file);
 if(addition.sampleRate!==working.sampleRate||addition.numberOfChannels!==working.numberOfChannels)addition=await resample(addition,working.sampleRate,working.numberOfChannels);
 undo={audio:copyBuffer(working),marks:markData.map(m=>({...m}))};working=joinBuffers(working,addition);dirty=true;start=0;end=working.duration;syncSliders();await refreshPreview();status('Audio agregado al final.')}
 catch(err){status('No se pudo agregar: '+err.message)}finally{busy=false}
};
el('ce-undo').onclick=async()=>{if(!undo)return;working=undo.audio;markData=undo.marks;undo=null;dirty=true;start=0;end=working.duration;syncSliders();saveMarks();renderMarks();await refreshPreview();status('Última edición deshecha.')};
el('ce-original').onclick=async()=>{if(!original)return;if(dirty&&!confirm('¿Descartar los cambios realizados al audio?'))return;working=copyBuffer(original);undo=null;dirty=false;start=0;end=working.duration;syncSliders();await bridge().load(record);if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}status('Audio original restaurado.');draw()};
function renderMarks(){
 const list=el('ce-marks');list.replaceChildren();el('ce-count').textContent='('+markData.length+')';
 markData.sort((a,b)=>a.time-b.time);
 if(!markData.length){const msg=document.createElement('p');msg.textContent='Todavía no hay marcas. Reproduce o busca un segundo y pulsa «Crear marca». ';list.append(msg)}
 for(const m of markData){
  const row=document.createElement('div');row.className='ce-mark';
  const t=document.createElement('span');t.className='ce-time';t.textContent=time(m.time);
  const field=document.createElement('input');field.type='text';field.value=m.name;field.maxLength=100;field.setAttribute('aria-label','Nombre de marca en '+time(m.time));
  field.addEventListener('change',()=>{m.name=field.value.trim()||'Marca';saveMarks()});
  const listen=document.createElement('button');listen.type='button';listen.textContent='▶ Escuchar';listen.title='Reproducir desde '+time(m.time);
  listen.onclick=async()=>{try{player.currentTime=m.time;await player.play()}catch(e){status('No se pudo reproducir: '+e.message)}};
  const remove=document.createElement('button');remove.type='button';remove.className='ce-del';remove.textContent='×';remove.title='Eliminar marca';
  remove.onclick=()=>{markData=markData.filter(x=>x.id!==m.id);saveMarks();renderMarks();draw()};
  row.append(t,field,listen,remove);list.append(row)
 }
 draw()
}
el('ce-mark').onclick=()=>{
 if(!working||!record){status('Selecciona primero un audio.');return}
 const current=Math.min(working.duration,sec(player.currentTime));
 const suggested='Marca '+time(current);const name=prompt('Nombre de la marca en '+time(current),suggested);
 if(name===null)return;
 markData.push({id:crypto.randomUUID?.()||String(Date.now()+Math.random()),time:current,name:name.trim()||suggested});
 saveMarks();renderMarks();status('Marca creada en '+time(current)+'.')
};
async function handleSave(mode){
 if(!working||busy)return;const api=bridge();if(!api)return;
 try{busy=true;status('Preparando audio…');const blob=encodeWav(working);const name=String(record?.name||'audio').replace(/\.[^.]+$/,'')+(mode==='copy'?' - copia editada':'')+'.wav';
 if(mode==='copy'){
  const result=await api.saveCopy(blob,name);
  // New copy gets a new identity; preserve its cue points.
  try{localStorage.setItem(key(result.id),JSON.stringify(markData))}catch(_){}
  record=result;original=copyBuffer(working);dirty=false;undo=null;await api.load(result);status('Copia WAV guardada en la biblioteca.');
 }else{
  if(!record||String(record.id).startsWith('direct_'))throw Error('El archivo no está en la biblioteca. Utiliza «Guardar copia».');
  if(!confirm('¿Reemplazar el archivo original «'+record.name+'»? Esta acción modifica el archivo de la biblioteca.')){status('Reemplazo cancelado.');return}
  const result=await api.replace(blob,name);record=result;original=copyBuffer(working);dirty=false;undo=null;status('Audio original reemplazado por el archivo editado en formato WAV.');
 }
 if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}
 }catch(e){status('No se pudo guardar: '+e.message)}finally{busy=false}
}
el('ce-copy').onclick=()=>handleSave('copy');
el('ce-replace').onclick=()=>handleSave('replace');
async function getLame(){
 if(window.lamejs?.Mp3Encoder)return window.lamejs;
 const url='https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
 await new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=()=>reject(Error('No se pudo cargar el codificador MP3. Comprueba tu conexión.'));document.head.append(script)
 });
 if(!window.lamejs?.Mp3Encoder)throw Error('El codificador MP3 no está disponible.');
 return window.lamejs
}
el('ce-mp3').onclick=async()=>{
 if(!working||busy)return;
 try{
  busy=true;status('Cargando codificador MP3…');const lame=await getLame();
  const rate=44100,channels=Math.min(2,working.numberOfChannels);
  const b=working.sampleRate===rate?working:await resample(working,rate,channels);
  const enc=new lame.Mp3Encoder(channels,rate,192),chunk=1152,parts=[];
  const pcm=Array.from({length:channels},(_,c)=>b.getChannelData(c));
  const convert=(arr,start,n)=>{const out=new Int16Array(n);for(let i=0;i<n;i++){const v=Math.max(-1,Math.min(1,arr[start+i]));out[i]=v<0?v*32768:v*32767}return out};
  for(let i=0;i<b.length;i+=chunk){
   const n=Math.min(chunk,b.length-i),left=convert(pcm[0],i,n),right=channels===2?convert(pcm[1],i,n):null;
   const part=channels===2?enc.encodeBuffer(left,right):enc.encodeBuffer(left);
   if(part.length)parts.push(new Uint8Array(part));
   if(i%(chunk*220)===0){status('Codificando MP3: '+Math.round(100*i/b.length)+'%');await new Promise(r=>setTimeout(r,0))}
  }
  const tail=enc.flush();if(tail.length)parts.push(new Uint8Array(tail));
  const blob=new Blob(parts,{type:'audio/mpeg'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=String(record?.name||'Audio').replace(/\.[^.]+$/,'')+' - editado.mp3';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  status('MP3 descargado. Los archivos originales no se modificaron.')
 }catch(e){status('No se pudo exportar MP3: '+e.message)}finally{busy=false}
};
async function loadSelected(){
 const r=bridge()?.current();if(!r?.blob){status('Selecciona un audio de la biblioteca para editar.');return}
 if(record?.id===r.id&&working)return;
 if(dirty&&record?.id!==r.id&&!confirm('Cambiaste de audio. ¿Descartar los cambios sin guardar?'))return;
 loading=r.id;status('Cargando forma de onda…');
 try{
  const buffer=await decode(r.blob);if(loading!==r.id)return;
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}
  record=r;original=buffer;working=copyBuffer(buffer);dirty=false;undo=null;start=0;end=buffer.duration;
  markData=readMarks();renderMarks();syncSliders();status('Audio listo: '+r.name)
 }catch(e){status('No se pudo abrir el audio: '+e.message)}
}
toggle.onclick=async()=>{
 panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));toggle.textContent=panel.hidden?'✂ Abrir editor de audio':'✂ Cerrar editor de audio';
 if(!panel.hidden)await loadSelected()
};
const originalSrcObserver=new MutationObserver(()=>{
 if(panel.hidden)return;
 const r=bridge()?.current();
 if(r&&r.id!==record?.id)loadSelected()
});
originalSrcObserver.observe(player,{attributes:true,attributeFilter:['src']});
window.addEventListener('resize',()=>{if(!panel.hidden)draw()});
})();
