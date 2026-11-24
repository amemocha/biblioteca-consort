/* Consort Studio — editor de audio centralizado. La biblioteca ya no edita audios. */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const player=byId('studioAudioPlayer'), host=document.querySelector('.studio-audio-edit-host');
if(!player||!host)return;
const bridge=()=>window.consorteStudioAudioBridge;
const toggle=document.createElement('button');
toggle.type='button';toggle.id='consorte-editor-toggle';toggle.textContent='Abrir editor de audio';toggle.setAttribute('aria-expanded','false');
host.append(toggle);
const panel=document.createElement('section');
panel.id='consorte-audio-editor';panel.hidden=true;
panel.setAttribute('aria-label','Editor de audio');
panel.innerHTML=[
'<h3>Editor de audio</h3>',
'<p>Recorta, elimina fragmentos, agrega audio, normaliza, aplica fundidos y guarda. El original solo se modifica si confirmas reemplazarlo.</p>',
'<canvas class="ce-wave" id="ce-wave" role="img" aria-label="Forma de onda. Pulsa para elegir el segundo de reproducción"></canvas>',
'<div class="ce-row"><span class="ce-helper" id="ce-duration">0:00</span><button type="button" id="ce-start-now">Inicio = segundo actual</button><button type="button" id="ce-end-now">Final = segundo actual</button></div>',
'<div class="ce-selection"><label>Inicio del tramo <span id="ce-start-label">0:00</span><input type="range" id="ce-start" min="0" max="1000" value="0"></label><label>Fin del tramo <span id="ce-end-label">0:00</span><input type="range" id="ce-end" min="0" max="1000" value="1000"></label></div>',
'<div class="ce-row"><button type="button" id="ce-cut">✂ Conservar selección</button><button type="button" id="ce-remove">Eliminar selección</button><button type="button" id="ce-silence">Silenciar tramo</button><button type="button" id="ce-fade">Fundido de entrada/salida</button><button type="button" id="ce-normalize">Normalizar volumen</button><button type="button" id="ce-reverse">Invertir tramo</button></div>',
'<div class="ce-row"><button type="button" id="ce-append">＋ Agregar audio al final</button><input type="file" id="ce-append-file" accept="audio/*,.wav,.mp3,.m4a,.ogg" hidden><button type="button" id="ce-undo">↶ Deshacer última edición</button><button type="button" id="ce-original">Restablecer original</button></div>',
'<h3>Dividir audio en partes</h3>',
'<p>Marca un intervalo con los controles de inicio y fin y pulsa «Crear parte». Para dividir en dos por el cursor, sitúa la reproducción en el punto de corte. Puedes escuchar, descargar, reordenar y guardar cada fragmento por separado sin modificar el original.</p>',
'<div class="ce-row"><button type="button" id="ce-create-part">Crear parte con selección</button><button type="button" id="ce-split-cursor">Dividir en dos en el segundo actual</button></div>',
'<div class="ce-part-list" id="ce-parts"></div>',
'<div class="ce-row"><label style="flex:1">Guardar fragmentos en <select id="ce-folder"><option value="">Inicio de Biblioteca</option></select></label><button type="button" class="ce-primary" id="ce-save-all-parts">Guardar todas las partes</button></div>',
'<div class="ce-row"><button type="button" class="ce-primary" id="ce-mark">🔖 Crear marca en este segundo</button><span class="ce-helper">Pulsa una marca para escuchar desde ese segundo.</span></div>',
'<h3>Lista de marcas <span id="ce-count">(0)</span></h3><div class="ce-mark-list" id="ce-marks"></div>',
'<div class="ce-actions"><button type="button" class="ce-primary" id="ce-copy">Guardar copia en la biblioteca</button><button type="button" class="ce-danger" id="ce-replace">Reemplazar audio original</button><button type="button" id="ce-mp3">Descargar en MP3</button></div>',
'<p class="ce-helper">La exportación MP3 requiere descargar el codificador la primera vez. Las marcas quedan asociadas a este audio en este navegador.</p>',
'<div class="ce-status" id="ce-status" role="status" aria-live="polite"></div>'
].join('');
host.append(panel);
const playerUI=document.getElementById('consorte-player-plus');
if(playerUI)playerUI.after(toggle,panel);
const el=id=>panel.querySelector('#'+id);
const canvas=el('ce-wave');
const daw=document.createElement('section');daw.id='ce-daw';
daw.innerHTML='<style>#ce-daw{background:#20242c;color:#eee;border-radius:10px;overflow:hidden;margin:12px 0;font:13px system-ui}#ce-daw button{background:#353b46;color:#fff;border:1px solid #505866;border-radius:4px;padding:7px 10px;cursor:pointer}#ce-daw button:disabled{opacity:.4}#ce-daw .daw-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px;background:#292e38}#ce-daw .daw-scroll{overflow:auto;max-height:500px}#ce-daw .daw-row{display:flex;min-height:76px;border-bottom:1px solid #404550}#ce-daw .daw-label{position:sticky;left:0;z-index:3;flex:0 0 152px;background:#292e38;padding:8px;box-sizing:border-box;display:grid;gap:4px}#ce-daw .daw-lane{position:relative;flex:none;background:repeating-linear-gradient(90deg,#242832 0,#242832 79px,#3c424d 80px);min-height:76px}#ce-daw .daw-clip{position:absolute;top:6px;height:64px;border:1px solid #ffffff66;border-radius:5px;overflow:hidden;color:#fff;cursor:grab;touch-action:none;box-sizing:border-box;user-select:none}#ce-daw .daw-clip.active{outline:2px solid white;z-index:2}#ce-daw .daw-clip span{display:block;padding:2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}#ce-daw .daw-clip canvas{display:block;width:100%;height:42px;pointer-events:none}#ce-daw .daw-head{position:absolute;top:0;bottom:0;width:2px;background:#fff;pointer-events:none;z-index:2}#ce-daw .daw-ruler{height:28px;min-height:28px;cursor:crosshair}#ce-daw .daw-ruler span{position:absolute;font-size:10px;top:7px;white-space:nowrap}#ce-daw input[type=range]{width:95px}#ce-daw .daw-label button{padding:3px 6px}#ce-daw .daw-label strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style><div class="daw-bar"><button data-d="add">＋ Pista de audio</button><input data-d="file" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg" hidden multiple><button data-d="play">▶</button><button data-d="stop">■</button><button data-d="split">✂ Dividir</button><button data-d="delete">Eliminar clip</button><button data-d="undo">↶ Deshacer</button><strong data-d="clock">0:00.0</strong><label>Zoom <input data-d="zoom" type="range" min="5" max="80" value="16"></label><button data-d="export">Exportar mezcla WAV</button><button data-d="save">Guardar mezcla</button></div><div class="daw-scroll" data-d="scroll"></div><div class="daw-bar" data-d="hint">Pulsa la regla para situar el cursor. Selecciona un bloque y arrástralo para moverlo en el tiempo o a otra pista.</div>';
canvas.before(daw);
const d=q=>daw.querySelector('[data-d="'+q+'"]');
let tracks=[],clips=[],chosen=null,cursor=0,scale=16,history=[],ctxD=null,sources=[],playing=false,origin=0,raf=0,session=0;
const colors=['#b64e58','#9954a2','#729e49','#b68b26','#387cae','#288d87'];
const total=()=>Math.max(0,...clips.map(c=>c.at+c.audio.duration));
const clock=t=>Math.floor(t/60)+':'+(t%60).toFixed(1).padStart(4,'0');
const snapshot=()=>{history.push({tracks:tracks.map(t=>({...t})),clips:clips.map(c=>({...c})),chosen});if(history.length>20)history.shift()};
function stopD(){if(playing&&ctxD)cursor=Math.min(total(),Math.max(0,ctxD.currentTime-origin));playing=false;cancelAnimationFrame(raf);for(const source of sources){try{source.stop();source.disconnect()}catch(_){}}sources=[];heads()}
function heads(){d('clock').textContent=clock(cursor);daw.querySelectorAll('.daw-head').forEach(h=>h.style.left=cursor*scale+'px')}
function resetD(){stopD();session++;tracks=[];clips=[];chosen=null;cursor=0;history=[];if(working){tracks.push({name:record?.name||'Audio',volume:1,mute:false,solo:false});const c={audio:working,at:0,track:0,name:record?.name||'Audio'};clips.push(c);chosen=c}renderD()}
function waveD(c,cv){const w=Math.max(1,Math.min(1600,Math.ceil(c.audio.duration*scale)));cv.width=w;cv.height=42;const x=cv.getContext('2d'),a=c.audio.getChannelData(0);x.fillStyle='#ffffff88';for(let i=0;i<w;i++){const lo=Math.floor(i*a.length/w),hi=Math.max(lo+1,Math.floor((i+1)*a.length/w));let p=0;for(let j=lo;j<hi;j+=Math.max(1,Math.floor((hi-lo)/40)))p=Math.max(p,Math.abs(a[j]||0));x.fillRect(i,21-p*20,1,Math.max(1,p*40))}}
function renderD(){const sc=d('scroll'),left=sc.scrollLeft,top=sc.scrollTop;sc.replaceChildren();const width=Math.max(650,Math.ceil((total()+15)*scale));const row=(label,rule=false)=>{const r=document.createElement('div');r.className='daw-row';if(rule)r.style.minHeight='28px';const l=document.createElement('div');l.className='daw-label';l.textContent=label;const lane=document.createElement('div');lane.className='daw-lane'+(rule?' daw-ruler':'');lane.style.width=width+'px';const head=document.createElement('i');head.className='daw-head';lane.append(head);r.append(l,lane);sc.append(r);return {l,lane}};
const ruler=row('Tiempo',true);const step=scale<12?10:scale<35?5:2;for(let t=0;t*scale<width;t+=step){const tick=document.createElement('span');tick.style.left=t*scale+'px';tick.textContent=clock(t);ruler.lane.append(tick)}
const seek=e=>{stopD();cursor=Math.max(0,Math.min(total(),(e.clientX-e.currentTarget.getBoundingClientRect().left)/scale));heads()};ruler.lane.onclick=seek;
tracks.forEach((tr,i)=>{const {l,lane}=row('');lane.dataset.track=i;lane.onclick=e=>{if(e.target===lane)seek(e)};const name=document.createElement('strong');name.textContent=tr.name;const controls=document.createElement('div');for(const [key,label] of [['mute','M'],['solo','S']]){const b=document.createElement('button');b.textContent=label;b.title=key==='mute'?'Silenciar':'Solo';b.setAttribute('aria-pressed',String(tr[key]));if(tr[key])b.style.background='#a8702c';b.onclick=()=>{stopD();tr[key]=!tr[key];renderD()};controls.append(b)}const volume=document.createElement('input');volume.type='range';volume.min=0;volume.max=1;volume.step=.01;volume.value=tr.volume;volume.title='Volumen';volume.oninput=()=>{stopD();tr.volume=Number(volume.value)};l.append(name,controls,volume);
for(const c of clips.filter(c=>c.track===i)){const b=document.createElement('div');b.className='daw-clip'+(c===chosen?' active':'');b.style.left=c.at*scale+'px';b.style.width=Math.max(5,c.audio.duration*scale)+'px';b.style.background=colors[i%colors.length];b.tabIndex=0;const title=document.createElement('span');title.textContent=c.name;const cv=document.createElement('canvas');b.append(title,cv);lane.append(b);waveD(c,cv);
b.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();stopD();chosen=c;daw.querySelectorAll('.daw-clip').forEach(n=>n.classList.remove('active'));b.classList.add('active');const x=e.clientX,old=c.at;let moved=false;b.setPointerCapture(e.pointerId);b.onpointermove=ev=>{if(Math.abs(ev.clientX-x)>3)moved=true;if(moved)b.style.left=Math.max(0,old+(ev.clientX-x)/scale)*scale+'px'};b.onpointerup=ev=>{b.onpointermove=null;b.onpointerup=null;if(moved){snapshot();c.at=Math.max(0,Math.round((old+(ev.clientX-x)/scale)*100)/100);const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.daw-lane[data-track]');if(target)c.track=Number(target.dataset.track)}else cursor=Math.max(0,Math.min(total(),c.at+(ev.clientX-b.getBoundingClientRect().left)/scale));renderD()};b.onpointercancel=()=>renderD()};b.onkeydown=e=>{if(e.key==='Enter'){chosen=c;renderD()}}}
});sc.scrollLeft=left;sc.scrollTop=top;heads()}
function audible(c){const tr=tracks[c.track];return tr&&!tr.mute&&(!tracks.some(t=>t.solo)||tr.solo)}
d('play').onclick=async()=>{if(playing){stopD();return}if(!clips.length)return;try{player.pause();if(partPreview)partPreview.pause();ctxD=ctxD||new (window.AudioContext||window.webkitAudioContext)();await ctxD.resume();if(cursor>=total())cursor=0;const now=ctxD.currentTime+.04;origin=now-cursor;for(const c of clips){if(!audible(c)||c.at+c.audio.duration<=cursor)continue;const src=ctxD.createBufferSource(),gain=ctxD.createGain();src.buffer=c.audio;gain.gain.value=tracks[c.track].volume;src.connect(gain);gain.connect(ctxD.destination);src.start(now+Math.max(0,c.at-cursor),Math.max(0,cursor-c.at));sources.push(src)}playing=true;const tick=()=>{if(!playing)return;cursor=Math.max(0,ctxD.currentTime-origin);if(cursor>=total()){stopD();return}heads();raf=requestAnimationFrame(tick)};tick()}catch(e){stopD();status(e.message)}};
d('stop').onclick=()=>{stopD();cursor=0;heads()};
d('zoom').oninput=e=>{scale=Number(e.target.value);renderD()};
d('add').onclick=()=>d('file').click();d('file').onchange=async e=>{const files=[...e.target.files];e.target.value='';const id=session;for(const f of files){try{const audio=await decode(f);if(id!==session)return;stopD();snapshot();const track=tracks.length;tracks.push({name:f.name,volume:1,mute:false,solo:false});chosen={audio,at:0,track,name:f.name};clips.push(chosen);renderD()}catch(err){status(err.message)}}};
d('split').onclick=()=>{stopD();const c=chosen;if(!c||cursor<=c.at+.025||cursor>=c.at+c.audio.duration-.025){status('Selecciona un clip y sitúa el cursor dentro de él.');return}const n=Math.round((cursor-c.at)*c.audio.sampleRate);const cut=(a,b)=>{const o=new AudioBuffer({numberOfChannels:c.audio.numberOfChannels,length:b-a,sampleRate:c.audio.sampleRate});for(let i=0;i<o.numberOfChannels;i++)o.copyToChannel(c.audio.getChannelData(i).subarray(a,b),i);return o};try{const a={...c,audio:cut(0,n),name:c.name+' A'},b={...c,audio:cut(n,c.audio.length),at:c.at+n/c.audio.sampleRate,name:c.name+' B'};snapshot();clips.splice(clips.indexOf(c),1,a,b);chosen=b;renderD()}catch(e){status(e.message)}};
d('delete').onclick=()=>{if(!chosen)return;stopD();snapshot();clips=clips.filter(c=>c!==chosen);chosen=null;renderD()};
d('undo').onclick=()=>{stopD();const h=history.pop();if(!h)return;const idx=h.clips.findIndex(c=>c.audio===h.chosen?.audio&&c.at===h.chosen?.at&&c.track===h.chosen?.track);tracks=h.tracks;clips=h.clips;chosen=clips[idx]||null;cursor=Math.min(cursor,total());renderD()};
async function mixD(save){if(!clips.length)return;stopD();const duration=total();if(duration>900){status('La mezcla supera el límite de 15 minutos.');return}try{const offline=new OfflineAudioContext(2,Math.ceil(duration*44100),44100);for(const c of clips){if(!audible(c))continue;const src=offline.createBufferSource(),gain=offline.createGain();src.buffer=c.audio;gain.gain.value=tracks[c.track].volume;src.connect(gain);gain.connect(offline.destination);src.start(c.at)}const blob=encodeWav(await offline.startRendering());const name=String(record?.name||'Audio').replace(/\.[^.]+$/,'')+' - mezcla.wav';if(save){await window.consorteStudioLibrary.saveCopy(blob,name,record,el('ce-folder').value||null);status('Mezcla guardada en Biblioteca.')}else{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Mezcla WAV exportada.')}}catch(e){status('No se pudo exportar: '+e.message)}}
d('save').onclick=()=>mixD(true);d('export').onclick=()=>mixD(false);

let original=null,working=null,record=null,dirty=false,busy=false,undo=null,previewUrl=null,markData=[];
let start=0,end=0,loading=null;let parts=[];let partPreview=null,partPreviewUrl=null;
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

async function updateFolderChoices(){
 const select=el("ce-folder"),previous=select.value;
 select.replaceChildren(new Option("Inicio de Biblioteca",""));
 try{
  const folders=await window.consorteStudioLibrary?.folderOptions?.()||[];
  for(const f of folders)select.add(new Option(f.label,f.id));
  if([...select.options].some(x=>x.value===previous))select.value=previous;
  else if(record?.parent&&[...select.options].some(x=>x.value===record.parent))select.value=record.parent;
 }catch(err){status("No se pueden cargar las carpetas: "+(err.message||err))}
}
function renderParts(){
 const list=el("ce-parts");list.replaceChildren();
 if(!parts.length){
  const empty=document.createElement("p");empty.className="ce-helper";
  empty.textContent="Aún no hay partes separadas.";list.append(empty);return;
 }
 for(const [index,part] of parts.entries()){
  const line=document.createElement("div");line.className="ce-part-row";
  const label=document.createElement("strong");label.textContent="Parte "+(index+1)+" · "+time(part.audio.duration);
  const field=document.createElement("input");field.value=part.name;field.maxLength=120;
  field.setAttribute("aria-label","Nombre de parte "+(index+1));field.onchange=()=>part.name=field.value.trim()||part.name;
  const save=document.createElement("button");save.type="button";save.textContent="Guardar parte";
  save.onclick=()=>saveAudioPart(part,save);
  const remove=document.createElement("button");remove.type="button";remove.textContent="×";
  remove.title="Quitar de la lista";remove.onclick=()=>{parts.splice(index,1);renderParts()};
  const listen=document.createElement("button");listen.type="button";listen.textContent="▶ Escuchar";
  listen.onclick=async()=>{try{if(partPreview){partPreview.pause();URL.revokeObjectURL(partPreviewUrl)}player.pause();partPreviewUrl=URL.createObjectURL(encodeWav(part.audio));partPreview=new Audio(partPreviewUrl);await partPreview.play();status("Reproduciendo "+part.name)}catch(e){status("No se pudo reproducir: "+e.message)}};
  const stop=document.createElement("button");stop.type="button";stop.textContent="■ Detener";stop.onclick=()=>{if(partPreview)partPreview.pause()};
  const download=document.createElement("button");download.type="button";download.textContent="Descargar WAV";download.onclick=()=>{const url=URL.createObjectURL(encodeWav(part.audio));const a=document.createElement("a");a.href=url;a.download=part.name.replace(/\.wav$/i,"")+".wav";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)};
  const up=document.createElement("button");up.type="button";up.textContent="↑";up.title="Mover antes";up.disabled=index===0;up.onclick=()=>{[parts[index-1],parts[index]]=[parts[index],parts[index-1]];renderParts()};
  const down=document.createElement("button");down.type="button";down.textContent="↓";down.title="Mover después";down.disabled=index===parts.length-1;down.onclick=()=>{[parts[index+1],parts[index]]=[parts[index],parts[index+1]];renderParts()};
  line.style.flexWrap="wrap";line.append(label,field,listen,stop,download,up,down,save,remove);list.append(line);
 }
}
function addPart(begin,finish){
 if(!working||busy)return;
 if(parts.length>=30){status("Máximo 30 partes por sesión.");return}
 try{
  if(finish-begin<.025)throw Error("Selecciona al menos 0,025 segundos de audio.");
  const audio=sliceBuffer(working,begin,finish);
  const base=String(record?.name||"Audio").replace(/\.[^.]+$/,"");
  parts.push({name:base+" - parte "+(parts.length+1)+".wav",audio});
  renderParts();status("Parte creada. Puedes seguir separando otras secciones.");
 }catch(err){status("No se pudo separar: "+(err.message||err))}
}
el("ce-create-part").onclick=()=>addPart(start,end);
el("ce-split-cursor").onclick=()=>{
 if(!working)return;
 const position=Math.min(working.duration,Math.max(0,sec(player.currentTime)));
 if(position<=.025||position>=working.duration-.025){
  status("Sitúa el cursor en un punto interior del audio antes de dividir.");return;
 }
 if(parts.length>28){status("Solo caben 30 partes por sesión.");return}
 if(busy)return;
 player.pause();
 try{
  const frame=Math.round(position*working.sampleRate);
  const make=(a,b)=>{const out=new AudioBuffer({numberOfChannels:working.numberOfChannels,length:b-a,sampleRate:working.sampleRate});for(let c=0;c<working.numberOfChannels;c++)out.getChannelData(c).set(working.getChannelData(c).subarray(a,b));return out};
  const base=String(record?.name||"Audio").replace(/\.[^.]+$/,"");
  const first=make(0,frame),second=make(frame,working.length);
  parts.push({name:base+" - parte "+(parts.length+1)+".wav",audio:first},{name:base+" - parte "+(parts.length+2)+".wav",audio:second});
  renderParts();status("Audio dividido en dos fragmentos independientes. El original se conserva.");
 }catch(e){status("No se pudo dividir: "+e.message)}
};
async function saveAudioPart(part,button){
 const api=window.consorteStudioLibrary;
 if(!api){status("No se pudo conectar con Biblioteca Consort.");return false}
 button.disabled=true;
 try{
  const destination=el("ce-folder").value||null;
  const blob=encodeWav(part.audio);
  await api.saveCopy(blob,part.name,record,destination);
  status("Fragmento «"+part.name+"» guardado en Biblioteca.");
  return true;
 }catch(err){status("No se pudo guardar «"+part.name+"»: "+(err.message||err));return false}
 finally{button.disabled=false}
}
el("ce-save-all-parts").onclick=async()=>{
 if(!parts.length){status("Primero crea una o varias partes.");return}
 const button=el("ce-save-all-parts");button.disabled=true;
 let saved=0;
 try{
  for(const part of parts){
   status("Guardando parte "+(saved+1)+" de "+parts.length+"…");
   const ok=await saveAudioPart(part,button);
   if(!ok)break;
   saved++;
  }
  status(saved+" de "+parts.length+" partes guardadas en Biblioteca Consort.");
 }finally{button.disabled=false}
};
renderParts();

el('ce-start').oninput=e=>setSelection('start',e.target.value);
el('ce-end').oninput=e=>setSelection('end',e.target.value);
el('ce-start-now').onclick=()=>{if(working){start=Math.min(sec(player.currentTime),end-1/working.sampleRate);syncSliders()}};
el('ce-end-now').onclick=()=>{if(working){end=Math.max(sec(player.currentTime),start+1/working.sampleRate);syncSliders()}};
canvas.addEventListener('click',e=>{if(!working)return;const rect=canvas.getBoundingClientRect();player.currentTime=Math.min(working.duration,Math.max(0,(e.clientX-rect.left)/rect.width*working.duration));draw()});
player.addEventListener('play',()=>{stopD();if(partPreview)partPreview.pause()});
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
el('ce-remove').onclick=()=>{const a=start,b=end;edit(buf=>{if(b-a>=buf.duration)throw Error('No puedes eliminar todo el audio');if(a<=0)return sliceBuffer(buf,b,buf.duration);if(b>=buf.duration)return sliceBuffer(buf,0,a);return joinBuffers(sliceBuffer(buf,0,a),sliceBuffer(buf,b,buf.duration))},'Tramo eliminado.',t=>t>=b?t-(b-a):t>=a?-1:t)};
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
  record=r;original=buffer;working=copyBuffer(buffer);dirty=false;undo=null;start=0;end=buffer.duration;parts=[];if(partPreview){partPreview.pause();URL.revokeObjectURL(partPreviewUrl);partPreview=null;partPreviewUrl=null}renderParts();await updateFolderChoices();
  markData=readMarks();renderMarks();syncSliders();resetD();status('Audio listo: '+r.name)
 }catch(e){status('No se pudo abrir el audio: '+e.message)}
}
toggle.onclick=async()=>{
 panel.hidden=!panel.hidden;if(panel.hidden)stopD();toggle.setAttribute('aria-expanded',String(!panel.hidden));toggle.textContent=panel.hidden?'Abrir editor de audio':'Cerrar editor de audio';
 if(!panel.hidden)await loadSelected()
};
const originalSrcObserver=new MutationObserver(()=>{
 if(panel.hidden)return;
 const r=bridge()?.current();
 if(r&&r.id!==record?.id)loadSelected()
});
originalSrcObserver.observe(player,{attributes:true,attributeFilter:['src']});
window.addEventListener('resize',()=>{if(!panel.hidden)draw()});
window.addEventListener('consorte-studio-audio-ready',async()=>{
 const next=bridge()?.current();
 if(!next?.blob)return;
 if(panel.hidden){
  panel.hidden=false;toggle.setAttribute('aria-expanded','true');
  toggle.textContent='Cerrar editor de audio';
 }
 await loadSelected();
 host.scrollIntoView({behavior:'smooth',block:'start'});
});
})();
