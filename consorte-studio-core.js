(()=>{
"use strict";
// One Studio core serves the standalone page and the native in-app mount.
const STUDIO_COLLISIONS=new Set(["library","drop","player","tabPrev","tabPageLabel","tabNext"]);
const $=id=>{
 const host=document.getElementById("consortStudioMount");
 if(host){
  const target=STUDIO_COLLISIONS.has(id)?"cs-"+id:id;
  const found=host.querySelector('[id="'+target+'"]');
  if(found)return found;
 }
 return document.getElementById(id);
};
const state={score:null,url:null,blob:null,busy:false,exporting:false,stems:new Map(),
 sampleRate:22050,duration:0,context:null,sources:[],gains:new Map(),
 playing:false,startedAt:0,pauseOffset:0,animationFrame:0,
 projectId:null,projectName:"",dbPromise:null,saveTimer:0,sourceXML:null};

// Proyectos editables guardados localmente en IndexedDB (no almacenamiento en la nube).
function openProjectDatabase(){
 if(state.dbPromise)return state.dbPromise;
 state.dbPromise=new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(Error("IndexedDB no disponible"));return}
  const req=indexedDB.open("consort-studio-projects",1);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains("projects"))db.createObjectStore("projects",{keyPath:"id"});
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error("No se puede abrir la biblioteca de proyectos"));
 });
 return state.dbPromise;
}
async function projectOperation(mode,method,value){
 const db=await openProjectDatabase();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction("projects",mode);
  const store=tx.objectStore("projects");
  const req=method==="getAll"?store.getAll():method==="get"?store.get(value):method==="delete"?store.delete(value):store.put(value);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error("Error al acceder al proyecto"));
  tx.onerror=()=>reject(tx.error||Error("Error en la base de proyectos"));
 });
}
function projectDate(timestamp){
 try{return new Date(timestamp).toLocaleDateString("es-CL",{day:"2-digit",month:"short",year:"numeric"})}
 catch(_){return ""}
}
function projectNotice(text){
 const el=$("saveStatus");
 if(el)el.textContent=text;
}
async function renderProjects(){
 const root=$("projectsList");
 try{
  const projects=(await projectOperation("readonly","getAll")).sort((a,b)=>b.updatedAt-a.updatedAt);
  root.replaceChildren();
  $("projectCounter").textContent=projects.length+" "+(projects.length===1?"proyecto":"proyectos");
  if(!projects.length){
   const empty=document.createElement("p");empty.className="small";
   empty.textContent="Aún no hay proyectos. Importa una partitura y aparecerá aquí automáticamente.";
   root.append(empty);return;
  }
  for(const record of projects){
   const box=document.createElement("article");box.className="project-entry"+(record.id===state.projectId?" is-current":"");
   const info=document.createElement("div");
   const name=document.createElement("strong");name.textContent=record.title||"Partitura";
   const details=document.createElement("small");
   details.textContent=projectDate(record.updatedAt)+" · "+(record.score?.groups?.length||0)+" instrumentos";
   info.append(name,details);
   const actions=document.createElement("div");actions.className="actions";
   const open=document.createElement("button");open.type="button";open.className="primary";open.textContent=record.id===state.projectId?"Editando":"Abrir y editar";
   open.onclick=()=>openSavedProject(record.id);
   const rename=document.createElement("button");rename.type="button";rename.textContent="Renombrar";
   rename.onclick=()=>renameSavedProject(record.id);
   const remove=document.createElement("button");remove.type="button";remove.textContent="Eliminar";
   remove.onclick=()=>removeSavedProject(record.id);
   actions.append(open,rename,remove);box.append(info,actions);root.append(box);
  }
 }catch(err){
  root.replaceChildren();
  const problem=document.createElement("p");problem.className="small";
  problem.textContent="No se puede acceder a los proyectos guardados en este navegador: "+(err.message||err);
  root.append(problem);
 }
}
async function saveCurrentProject(expectedId=state.projectId){
 if(!state.score||!expectedId||expectedId!==state.projectId)return;
 const record={id:expectedId,title:state.projectName||state.score.title||"Partitura",
  updatedAt:Date.now(),tempo:clamp(int($("tempo").value,100),30,240),
  sourceXML:state.sourceXML,score:state.score};
 await projectOperation("readwrite","put",record);
 if(expectedId===state.projectId)projectNotice("Proyecto guardado en este navegador.");
 await renderProjects();
}
function scheduleProjectSave(){
 if(!state.score||!state.projectId)return;
 if(state.saveTimer)clearTimeout(state.saveTimer);
 const expectedId=state.projectId;
 state.saveTimer=setTimeout(()=>{
  state.saveTimer=0;
  saveCurrentProject(expectedId).catch(err=>projectNotice("No se pudo guardar: "+(err.message||err)));
 },500);
}
async function flushProjectSave(){
 if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=0}
 if(state.score&&state.projectId)await saveCurrentProject();
}
async function openSavedProject(id){
 if(state.busy||state.exporting)return;
 try{
  await flushProjectSave();
  const record=await projectOperation("readonly","get",id);
  if(!record||!record.score)throw Error("Proyecto no encontrado.");
  clearAudio();
  let restoredScore=record.score,wasMigrated=false;
  if(record.sourceXML&&record.score.timingVersion!==11){
   restoredScore=parse(record.sourceXML,record.title||"Partitura");
   for(const group of restoredScore.groups){
    const previous=record.score.groups.find(g=>g.name===group.name)||
                   record.score.groups.find(g=>g.id===group.id);
    if(previous){
     group.offset=previous.offset;group.volume=previous.volume;
     group.instrument=previous.instrument;
    }
   }
   wasMigrated=true;
  }
  // Restore source pitches for older saved projects without changing any
  // mixer volume, instrument, semitone, note or user-edited voice settings.
  if(record.sourceXML&&restoredScore.notes?.some(n=>!Number.isFinite(n.writtenMidi))){
   try{
    const fromDocument=parse(record.sourceXML,record.title||"Partitura");
    const pitchKey=n=>n.midi+"|"+n.start.toFixed(7)+"|"+n.duration.toFixed(7);
    const sourceGroups=new Map(fromDocument.groups.map(g=>[g.id,g.name]));
    const targetGroups=new Map(restoredScore.groups.map(g=>[g.id,g.name]));
    const byKey=new Map();
    for(const note of fromDocument.notes){
     const key=pitchKey(note),entries=byKey.get(key)||[];
     entries.push({name:sourceGroups.get(note.group),writtenMidi:note.writtenMidi});
     byKey.set(key,entries);
    }
    for(const note of restoredScore.notes){
     if(Number.isFinite(note.writtenMidi))continue;
     const candidates=byKey.get(pitchKey(note))||[];
     const name=targetGroups.get(note.group);
     const exact=candidates.find(c=>c.name===name);
     const chosen=exact||(candidates.length===1?candidates[0]:null);
     if(chosen)note.writtenMidi=chosen.writtenMidi;
    }
    if(restoredScore.notes.every(n=>Number.isFinite(n.writtenMidi)))
     wasMigrated=true;
   }catch(err){console.warn("No se pudo restaurar la afinación escrita del MusicXML original",err)}
  }
  state.score=restoredScore;state.sourceXML=record.sourceXML||null;
  state.projectId=record.id;state.projectName=record.title||record.score.title;
  $("tempo").value=clamp(int(record.tempo,100),30,240);
  $("info").hidden=false;
  $("info").textContent=projectInfoText(state.score,state.projectName);
  $("settings").hidden=false;
  makeVoiceRows();updateDurationEstimate();
  window.dispatchEvent(new Event("consorte-studio-score-ready"));
  projectNotice(record.sourceXML
   ?"Proyecto abierto. Se conservan tus ajustes; genera el audio cuando quieras."
   :"Este proyecto se guardó antes de la corrección de compases. Para corregir su ritmo, vuelve a importar el MusicXML original.");

  await renderProjects();
  if(wasMigrated)scheduleProjectSave();
  $("settings").scrollIntoView({behavior:"smooth",block:"start"});
 }catch(err){problem("No se pudo abrir el proyecto: "+(err.message||err))}
}
async function removeSavedProject(id){
 if(!confirm("¿Eliminar definitivamente este proyecto guardado en este navegador?"))return;
 try{
  if(state.projectId===id){
   if(state.saveTimer)clearTimeout(state.saveTimer);state.saveTimer=0;
   clearAudio();state.projectId=null;state.projectName="";state.score=null;state.sourceXML=null;
   $("settings").hidden=true;$("info").hidden=true;
  }
  await projectOperation("readwrite","delete",id);
  await renderProjects();
 }catch(err){problem("No se pudo eliminar: "+(err.message||err))}
}
async function renameSavedProject(id){
 try{
  await flushProjectSave();
  const project=await projectOperation("readonly","get",id);
  if(!project)return;
  const name=prompt("Nuevo nombre del proyecto:",project.title);
  if(name===null||!name.trim())return;
  project.title=name.trim().slice(0,120);project.updatedAt=Date.now();
  await projectOperation("readwrite","put",project);
  if(state.projectId===id){state.projectName=project.title;
   $("info").textContent=state.projectName+" · "+state.score.groups.length+" instrumentos · "+state.score.notes.length+" notas"}
  await renderProjects();
 }catch(err){problem("No se pudo renombrar: "+(err.message||err))}
}
$("saveProject").onclick=()=>{
 if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=0}
 saveCurrentProject().catch(err=>projectNotice("No se pudo guardar: "+(err.message||err)));
};
renderProjects();

const semis={C:0,D:2,E:4,F:5,G:7,A:9,B:11};

const INSTRUMENTS=[
 ["piano","Piano acústico"],["electric-piano","Piano eléctrico"],["guitar-nylon","Guitarra clásica (nylon)"],
 ["guitar-steel","Guitarra acústica (acero)"],["guitar-clean","Guitarra eléctrica limpia"],
 ["guitar-muted","Guitarra eléctrica apagada"],["guitar-drive","Guitarra eléctrica distorsionada"],
 ["flute","Flauta traversa"],["recorder","Flauta dulce"],["panflute","Flauta de pan"],
 ["violin","Violín"],["cello","Violonchelo"],["clarinet","Clarinete"],
 ["trumpet","Trompeta"],["organ","Órgano"],["bass","Bajo eléctrico"]
];
// Identificación de familias de guitarra; G.S se reserva para contrabajo según la nomenclatura solicitada.
// Normalización de partes: no confundir pentagramas, rótulos cortos y voces instrumentales.
const GUITAR_ROLES={
 soprano:{name:"Guitarra soprano",short:"G.S",sound:"guitar-nylon"},
 alto:{name:"Guitarra alto",short:"G.A",sound:"guitar-nylon"},
 tenor:{name:"Guitarra tenor",short:"G.T",sound:"guitar-nylon"},
 bajo:{name:"Guitarra bajo",short:"G.B",sound:"guitar-nylon"},
 contra:{name:"Guitarra contrabajo",short:"G.C",sound:"bass"},
 prima:{name:"Guitarra prima",short:"G.P",sound:"guitar-nylon"}
};
function compactInstrumentName(value){
 return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
  .replace(/[_\-.]+/g," ").replace(/\s+/g," ").trim();
}
function codeOf(value){return compactInstrumentName(value).replace(/[^a-z0-9]/g,"")}
function instrumentRole(value,hasGuitarContra=false){
 const n=compactInstrumentName(value);
 let c=codeOf(value);
 // Los paréntesis de abreviaturas MusicXML a veces producen etiquetas "(G.S.".
 if(/^\(?[g3]\s*[.\s-]*[s5]\.?\)?$/i.test(String(value||"").trim()))c="gs";
 if(/^guitarra\s+(?:contra\s*bajo|contrabajo)$/.test(n)||/^(gc|cc)$/.test(c))return "contra";
 if(/^(guitarra\s+)?(?:soprano)$/.test(n)||/^(gs|sc|cs)$/.test(c))
  return c==="gs"&&!hasGuitarContra?"contra":"soprano";
 if(/^(guitarra\s+)?alto$/.test(n)||/^(ga|ca)$/.test(c))return "alto";
 if(/^(guitarra\s+)?tenor$/.test(n)||/^(gt|ct)$/.test(c))return "tenor";
 if(/^(guitarra\s+)?(?:bajo|bass)$/.test(n)||/^(gb|cb)$/.test(c))return "bajo";
 if(/^(guitarra\s+)?prima$/.test(n)||c==="gp")return "prima";
 if(n==="contrabajo"||n==="contra bajo")return "contra";
 return null;
}
function voiceIdentity(value,contextHasGuitarContra=false){
 const role=instrumentRole(value,contextHasGuitarContra);
 return role?GUITAR_ROLES[role]:null;
}
function meaningfulName(name){return !!name&&!/^(voice|voz|instrumento|instrument|part|parte|staff|pentagrama)(?:\s*\d+)?$/i.test(String(name).trim())}
function identityLabel(name){
 const match=voiceIdentity(name,true);
 return match?match.name+" ("+match.short+")":name;
}
function inferPartName(raw,filename,metadata){
 const candidate=[raw,...metadata,filename.replace(/\.[^.]+$/,"").replace(/^\d+[\s_-]*/,"")];
 if(meaningfulName(raw)){
  const match=voiceIdentity(raw,true);
  return match?match.name:raw;
 }
 for(const value of candidate){
  const match=voiceIdentity(value,true);
  if(match)return match.name;
 }
 return meaningfulName(raw)?raw:"Instrumento sin identificar";
}
function combineInstrumentVoices(groups,notes){
 // Detecta si la partitura usa la nomenclatura G.S (soprano), G.C (contrabajo).
 // Sin G.C, G.S puede ser contrabajo según otras nomenclaturas.
 const hasGuitarContra=groups.some(g=>instrumentRole(g.name,true)==="contra"||
  /guitarra\s+contrabajo/i.test(g.name));
 const byKey=new Map(),idMap=new Map(),combined=[];
 for(const group of groups){
  const role=instrumentRole(group.name,hasGuitarContra);
  const canonical=role?GUITAR_ROLES[role]:null;
  const normalized=canonical?canonical.name:group.name;
  const key=canonical?"role:"+role:meaningfulName(normalized)
    ?"name:"+compactInstrumentName(normalized):"unknown:"+group.part;
  let target=byKey.get(key);
  if(!target){
   target={...group,id:"mix-"+combined.length,voice:"",staff:"",name:normalized,
     count:0,sourceCount:0,
     instrument:canonical?canonical.sound:group.instrument};
   byKey.set(key,target);combined.push(target);
  }
  target.sourceCount++;
  idMap.set(group.id,target.id);
 }
 for(const note of notes)note.group=idMap.get(note.group)||note.group;
 const unique=[],seen=new Set(),counts=new Map();
 for(const note of notes){
  const key=note.group+"|"+note.midi+"|"+note.start.toFixed(7)+"|"+note.duration.toFixed(7);
  if(seen.has(key))continue;
  seen.add(key);unique.push(note);
  counts.set(note.group,(counts.get(note.group)||0)+1);
 }
 for(const group of combined)group.count=counts.get(group.id)||0;
 // Orden musical: soprano, alto, tenor, bajo, contrabajo.
 const order={soprano:0,alto:1,tenor:2,bajo:3,contra:4,prima:5};
 combined.sort((a,b)=>(order[instrumentRole(a.name,true)]??20)-(order[instrumentRole(b.name,true)]??20));
 return {groups:combined,notes:unique};
}

function inferInstrument(name){
 const n=String(name).toLowerCase();
 if(/dulce|recorder/.test(n))return "recorder";
 if(/flauta|flute/.test(n))return "flute";
 if(/guitarra el[eé]ctrica|electric guitar/.test(n))return "guitar-clean";
 if(/guitarra|guitar/.test(n))return "guitar-nylon";
 if(/piano el[eé]ctrico/.test(n))return "electric-piano";
 if(/piano|teclado|keyboard/.test(n))return "piano";
 if(/viol[ií]n|violin/.test(n))return "violin";
 if(/violonchelo|cello/.test(n))return "cello";
 if(/clarinete|clarinet/.test(n))return "clarinet";
 if(/trompeta|trumpet/.test(n))return "trumpet";
 if(/[oó]rgano|organ/.test(n))return "organ";
 if(/contrabajo|bajo|bass/.test(n))return "bass";
 return "piano";
}
const PATCH={
 "piano":{h:[1,.42,.22,.11,.04],a:.007,d:1.4,r:.15,pluck:true},
 "electric-piano":{h:[1,.31,.16,.08],a:.012,d:2.2,r:.23,pluck:true,trem:4},
 "guitar-nylon":{h:[1,.36,.13,.05],a:.004,d:.64,r:.09,pluck:true},
 "guitar-steel":{h:[1,.7,.43,.19,.08],a:.002,d:.95,r:.11,pluck:true},
 "guitar-clean":{h:[1,.53,.30,.12,.05],a:.009,d:1.5,r:.15,pluck:true},
 "guitar-muted":{h:[1,.5,.24,.1],a:.003,d:.23,r:.06,pluck:true},
 "guitar-drive":{h:[1,.87,.69,.52,.35,.24,.12],a:.008,d:2.4,r:.17,pluck:true},
 "flute":{h:[1,.075,.028],a:.085,d:4,r:.14},
 "recorder":{h:[1,.17,.05],a:.047,d:4,r:.12},
 "panflute":{h:[1,.1,.045],a:.065,d:3,r:.17},
 "violin":{h:[1,.72,.42,.3,.18,.11],a:.11,d:4,r:.18,vib:5},
 "cello":{h:[1,.62,.43,.23,.12],a:.14,d:4,r:.22,vib:4.8},
 "clarinet":{h:[1,.08,.48,.06,.23,.02,.08],a:.045,d:4,r:.13},
 "trumpet":{h:[1,.66,.5,.31,.19,.08],a:.053,d:4,r:.14},
 "organ":{h:[1,.35,.24,.1,.06],a:.014,d:4,r:.09},
 "bass":{h:[1,.42,.18,.08],a:.009,d:.95,r:.15,pluck:true}
};

const int=(v,def=0)=>{const x=Number(v);return Number.isFinite(x)?x:def};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const kids=(n,t)=>Array.from(n?.children||[]).filter(x=>x.localName===t);
const one=(n,t)=>kids(n,t)[0]||null;
const text=(n,t,def="")=>one(n,t)?.textContent?.trim()??def;
function problem(msg){$("error").textContent=msg||""}
function status(msg){$("status").textContent=msg||""}
function clearAudio(){
 stopPlayback(true);
 state.stems.clear();state.duration=0;state.sampleRate=22050;
 if(state.url)URL.revokeObjectURL(state.url);
 state.url=null;state.blob=null;
 $("result").hidden=true;
 updatePlaybackDisplay();
}
function formatDuration(seconds){
 const rounded=Math.max(0,Math.floor(seconds||0));
 return Math.floor(rounded/60)+":"+String(rounded%60).padStart(2,"0");
}
function updatePlaybackDisplay(){
 const p=state.playing&&state.context?Math.max(0,state.context.currentTime-state.startedAt):state.pauseOffset;
 const elapsed=Math.min(state.duration,p);
 $("timeReadout").textContent=formatDuration(elapsed)+" / "+formatDuration(state.duration);
 $("seek").value=state.duration>0?String(Math.round(elapsed/state.duration*1000)):"0";
 $("playToggle").textContent=state.playing?"Pausar":"Reproducir";
 $("playToggle").setAttribute("aria-label",state.playing?"Pausar reproducción":"Reproducir mezcla");
}
function playbackFrame(){
 if(!state.playing)return;
 if(state.context.currentTime-state.startedAt>=state.duration){
  stopPlayback(true);return;
 }
 updatePlaybackDisplay();
 state.animationFrame=requestAnimationFrame(playbackFrame);
}
function stopPlayback(reset=false){
 if(state.animationFrame){cancelAnimationFrame(state.animationFrame);state.animationFrame=0}
 if(state.playing&&state.context)state.pauseOffset=Math.min(state.duration,Math.max(0,state.context.currentTime-state.startedAt));
 for(const source of state.sources){
  try{source.stop()}catch(_){}
  source.disconnect();
 }
 state.sources=[];state.gains.clear();state.playing=false;
 if(reset)state.pauseOffset=0;
 updatePlaybackDisplay();
}
function adjustRenderedVolume(group){
 if(state.stems.has(group.id)&&state.context){
  const gain=state.gains.get(group.id);
  if(gain)gain.gain.setTargetAtTime(group.volume/100,state.context.currentTime,.012);
 }
}
async function togglePlayback(){
 if(!state.stems.size)return;
 if(state.playing){stopPlayback(false);return}
 try{
  if(!state.context)state.context=new (window.AudioContext||window.webkitAudioContext)();
  if(state.context.state==="suspended")await state.context.resume();
  const ctx=state.context;
  if(state.pauseOffset>=state.duration-.03)state.pauseOffset=0;
  const offset=state.pauseOffset;
  const master=ctx.createDynamicsCompressor();
  master.threshold.value=-7;master.knee.value=12;master.ratio.value=4;
  master.attack.value=.003;master.release.value=.18;
  master.connect(ctx.destination);
  state.sources=[];state.gains.clear();
  for(const group of state.score.groups){
   const stem=state.stems.get(group.id);
   if(!stem)continue;
   const source=ctx.createBufferSource(),gain=ctx.createGain();
   source.buffer=stem;gain.gain.value=group.volume/100;
   source.connect(gain);gain.connect(master);source.start(0,offset);
   state.sources.push(source);state.gains.set(group.id,gain);
  }
  state.startedAt=ctx.currentTime-offset;state.playing=true;
  updatePlaybackDisplay();state.animationFrame=requestAnimationFrame(playbackFrame);
 }catch(err){
  stopPlayback(false);problem("No se pudo reproducir la mezcla: "+(err.message||err));
 }
}
$("playToggle").onclick=togglePlayback;
$("seek").onchange=()=>{
 if(!state.duration)return;
 const next=clamp(Number($("seek").value)/1000*state.duration,0,state.duration);
 const playing=state.playing;stopPlayback(false);state.pauseOffset=next;
 updatePlaybackDisplay();if(playing)togglePlayback();
};

// Índice de compases compartido por todos los pentagramas.
// MusicXML usa divisiones locales y "backup" para voces simultáneas.
function sharedMeasureStarts(parts){
 const lengths=[],counts=parts.map(p=>kids(p,"measure"));
 const singlePart=parts.length===1;
 let partialBars=0;
 for(const measures of counts){
  let divisions=1,meter=4;
  for(const [i,measure] of measures.entries()){
   let cursor=0,lastOnset=0,furthest=0;
   for(const e of Array.from(measure.children)){
    const tag=e.localName;
    if(tag==="attributes"){
     // Si <divisions> no aparece, MusicXML conserva el valor anterior.
     const divisionNode=one(e,"divisions");
     if(divisionNode)divisions=clamp(int(divisionNode.textContent,divisions),1,1000000);
     const time=one(e,"time");
     if(time){
      const beats=text(time,"beats","4").split("+").reduce((sum,part)=>sum+Math.max(0,int(part,0)),0);
      const beatType=Math.max(1,int(text(time,"beat-type","4"),4));
      if(beats>0)meter=clamp(beats*4/beatType,.125,64);
     }
     continue;
    }
    if(tag==="backup"||tag==="forward"){
     const d=clamp(int(text(e,"duration","0"),0)/divisions,0,1000);
     cursor=Math.max(0,cursor+(tag==="backup"?-d:d));
     furthest=Math.max(furthest,cursor);
     continue;
    }
    if(tag!=="note")continue;
    const chord=!!one(e,"chord"),grace=!!one(e,"grace");
    const d=grace?0:clamp(int(text(e,"duration","0"),0)/divisions,0,1000);
    const at=chord?lastOnset:cursor;
    if(!chord){lastOnset=cursor;cursor+=d}
    furthest=Math.max(furthest,cursor,at+d);
   }
   // Restablecer la duración escrita en cada compás tanto en partituras
   // individuales como generales. Los silencios finales escritos se respetan.
   // En una parte individual, un compás completamente vacío y sin duración
   // explícita no crea artificialmente otro compás entero de silencio.
   const length=furthest>0?furthest:(singlePart?0:meter);
   if(furthest>0&&furthest<meter-0.001)partialBars++;
   lengths[i]=Math.max(lengths[i]||0,length);
  }
 }
 let position=0;
 const starts=lengths.map(len=>{const start=position;position+=len;return start});
 starts.shortBars=partialBars;starts.lastLength=lengths[lengths.length-1]||0;
 return starts;
}


// Lee los signos MusicXML de repetición y las casillas 1.ª / 2.ª.
// Los compases tienen un índice compartido por todos los instrumentos.
function musicXMLPlaybackPlan(parts,measureStarts){
 const count=measureStarts.length;
 if(!count)return null;
 const marks=Array.from({length:count},()=>({forward:false,backward:false,times:2}));
 const starts=Array.from({length:count},()=>new Set());
 const closes=new Set();
 const measures=parts.map(p=>kids(p,"measure"));
 let hasNavigation=false;
 const parseNumbers=value=>{
  const result=new Set();
  for(const section of String(value||"").split(/[;,]/)){
   const range=section.trim().match(/^(\d+)\s*-\s*(\d+)$/);
   if(range){
    for(let n=Number(range[1]);n<=Math.min(10,Number(range[2]));n++)result.add(n);
   }else{
    const n=Number.parseInt(section,10);
    if(n>=1&&n<=10)result.add(n);
   }
  }
  return [...result];
 };
 for(let i=0;i<count;i++){
  for(const part of measures){
   const measure=part[i];
   if(!measure)continue;
   for(const barline of kids(measure,"barline")){
    const side=barline.getAttribute("location")||"right";
    for(const repeat of kids(barline,"repeat")){
     const dir=repeat.getAttribute("direction");
     if(dir==="forward"){
      const at=side==="right"?i+1:i;
      if(at<count)marks[at].forward=true;
      hasNavigation=true;
     }else if(dir==="backward"){
      const at=side==="left"?i-1:i;
      if(at>=0){
       marks[at].backward=true;
       marks[at].times=Math.max(2,Math.min(6,int(repeat.getAttribute("times"),2)));
       hasNavigation=true;
      }
     }
    }
    for(const ending of kids(barline,"ending")){
     const type=ending.getAttribute("type");
     if(type==="start"){
      const at=side==="right"?i+1:i;
      if(at>=0&&at<count){
       for(const n of parseNumbers(ending.getAttribute("number")))starts[at].add(n);
       hasNavigation=true;
      }
     }else if(type==="stop"||type==="discontinue"){
      const at=side==="left"?i-1:i;
      if(at>=0){closes.add(at);hasNavigation=true}
     }
    }
   }
  }
 }
 if(!hasNavigation)return null;
 // Algunos exportadores escriben la segunda casilla como "1" por error.
 // Si aparece inmediatamente después de un cierre de repetición y otra
 // casilla "1" estaba activa, la tratamos como segunda casilla.
 let activeNumbers=[],firstEndingBeforeRepeat=false,correctedEndings=0;
 const endings=Array.from({length:count},()=>[]);
 for(let i=0;i<count;i++){
  let opening=[...starts[i]].sort((a,b)=>a-b);
  if(opening.length===1&&opening[0]===1&&i>0&&marks[i-1].backward&&firstEndingBeforeRepeat){
   opening=[2];correctedEndings++;
  }
  if(opening.length)activeNumbers=opening;
  endings[i]=activeNumbers.slice();
  if(marks[i].backward){
   firstEndingBeforeRepeat=activeNumbers.includes(1)||endings.slice(0,i+1).some(x=>x.includes(1));
   // Un salto de repetición cierra la primera casilla incluso si el
   // exportador omitió <ending type="stop">.
   activeNumbers=[];
  }else if(closes.has(i)){
   activeNumbers=[];
  }
 }
 const lengths=measureStarts.map((start,i)=>i+1<count?Math.max(0,measureStarts[i+1]-start):measureStarts.lastLength||0);
 const order=[],jumpCounts=new Map();
 let index=0,quarter=0,sectionStart=0,pass=1,steps=0,jumpCount=0;
 const maxSteps=Math.min(60000,Math.max(200,count*15+50));
 while(index<count&&steps++<maxSteps){
  const mark=marks[index];
  if(mark.forward&&sectionStart!==index){
   sectionStart=index;pass=1;
  }
  if(endings[index].length&&!endings[index].includes(pass)){
   index++;
   continue;
  }
  order.push({index,start:quarter,pass});
  quarter+=lengths[index]||0;
  if(mark.backward){
   const key=sectionStart+"-"+index;
   const attempts=jumpCounts.get(key)||1;
   if(attempts<mark.times){
    jumpCounts.set(key,attempts+1);
    jumpCount++;pass=attempts+1;index=sectionStart;continue;
   }
  }
  index++;
 }
 if(steps>=maxSteps)throw Error("La partitura contiene repeticiones cíclicas o no válidas.");
 return {
  order,quarterLength:quarter,jumps:jumpCount,
  repeatSections:marks.filter(m=>m.backward).length,
  endings:starts.reduce((n,opening)=>n+(opening.size>0?1:0),0),
  correctedEndings
 };
}

function unfoldMusicXMLNotes(parts,measureStarts,notes){
 const plan=musicXMLPlaybackPlan(parts,measureStarts);
 if(!plan)return {notes,quarterLength:0,jumps:0};
 const byMeasure=new Map();
 for(const note of notes){
  if(!Number.isInteger(note.measureIndex))continue;
  if(!byMeasure.has(note.measureIndex))byMeasure.set(note.measureIndex,[]);
  byMeasure.get(note.measureIndex).push(note);
 }
 const expanded=[];
 for(const event of plan.order){
  for(const note of byMeasure.get(event.index)||[]){
   expanded.push({...note,start:event.start+Math.max(0,note.start-measureStarts[event.index])});
  }
 }
 return {notes:expanded,quarterLength:plan.quarterLength,jumps:plan.jumps,
   repeatSections:plan.repeatSections,endings:plan.endings,correctedEndings:plan.correctedEndings};
}

function parse(xml,filename=""){
 const doc=new DOMParser().parseFromString(xml,"application/xml");
 if(doc.querySelector("parsererror"))throw Error("El XML no tiene una estructura válida.");
 const root=doc.documentElement;
 if(root.localName!=="score-partwise")throw Error("Se necesita una partitura MusicXML score-partwise (no un XML genérico).");
 const partNames=new Map();
 for(const part of kids(one(root,"part-list"),"score-part")){
  partNames.set(part.getAttribute("id"),{
   name:text(part,"part-name",""),
   abbr:text(part,"part-abbreviation",""),
   instrument:text(one(part,"score-instrument"),"instrument-name","")
  });
 }
 const metadata=kids(one(root,"identification"),"creator").map(c=>c.textContent?.trim()).filter(Boolean);
 const scoreParts=kids(root,"part");
 const measureStarts=sharedMeasureStarts(scoreParts);
 const groups=[],notes=[],tempi=[];
 for(const [pi,part] of scoreParts.entries()){
  const pid=part.getAttribute("id")||String(pi);
  const entry=partNames.get(pid)||{};
  const rawName=entry.name||"";
  const explicit=[rawName,entry.abbr,entry.instrument];
  const identified=explicit.map(t=>voiceIdentity(t,true)).find(Boolean);
  const name=identified?identified.name:inferPartName(rawName,scoreParts.length===1?filename:"",scoreParts.length===1?metadata:[]);
 
  const byId=new Map(),ties=new Map(),staffTunings=new Map();
  let divisions=1,offset=0;
  for(const [measureIndex,measure] of kids(part,"measure").entries()){
   const measureStart=measureStarts[measureIndex]||0;
   let cursor=measureStart,lastOnset=cursor;
   for(const e of Array.from(measure.children)){
    const tag=e.localName;
    if(tag==="attributes"){
     const divisionNode=one(e,"divisions");
     if(divisionNode)divisions=clamp(int(divisionNode.textContent,divisions),1,1000000);
     const trans=one(e,"transpose");
     if(trans)offset=int(text(trans,"chromatic","0"))+12*int(text(trans,"octave-change","0"));
     // MusicXML may specify the real open pitches of each string.
     // line="1" is the lowest staff line / lowest string. Use these
     // before assuming six-string EADGBE, especially for guitar consorts.
     for(const details of kids(e,"staff-details")){
      const staffNumber=details.getAttribute("number")||"1";
      const openStrings=[];
      for(const tuning of kids(details,"staff-tuning")){
       const line=int(tuning.getAttribute("line"),0);
       const step=text(tuning,"tuning-step");
       const octave=int(text(tuning,"tuning-octave","-1"),-1);
       const alter=int(text(tuning,"tuning-alter","0"),0);
       if(line>=1&&line<=12&&step in semis&&octave>=0&&octave<=8)
        openStrings[line-1]=12*(octave+1)+semis[step]+alter;
      }
      if(openStrings.length>=4&&openStrings.every(Number.isFinite)){
       staffTunings.set(staffNumber,openStrings);
       for(const g of byId.values())if(g.staff===staffNumber)g.tabTuning=openStrings.slice();
      }
     }
     continue;
    }
    if(tag==="direction"){
     const sound=one(e,"sound");
     let bpm=Number(sound?.getAttribute("tempo"))||0;
     if(!(bpm>0)){
      const metronome=one(one(e,"direction-type"),"metronome");
      const perMinute=Number(text(metronome,"per-minute","0"));
      if(perMinute>0){
       const noteUnit=text(metronome,"beat-unit","quarter").toLowerCase();
       const unit={whole:4,half:2,quarter:1,eighth:.5,"16th":.25,"32nd":.125}[noteUnit]||1;
       const dotted=one(metronome,"beat-unit-dot")?1.5:1;
       bpm=perMinute*unit*dotted;
      }
     }
     if(pi===0&&bpm>0)tempi.push({quarter:cursor,bpm});
     continue;
    }
    if(tag==="backup"||tag==="forward"){
     const duration=clamp(int(text(e,"duration","0"))/divisions,0,1000);
     cursor=Math.max(measureStart,cursor+(tag==="backup"?-duration:duration));
     continue;
    }
    if(tag!=="note")continue;
    const chord=!!one(e,"chord"),grace=!!one(e,"grace");
    const duration=grace?0:clamp(int(text(e,"duration","0"))/divisions,0,1000);
    const at=chord?lastOnset:cursor;
    if(!chord){lastOnset=cursor;cursor+=duration}
    if(grace||duration<=0||one(e,"rest")||one(e,"unpitched"))continue;
    const pitch=one(e,"pitch");
    if(!pitch)continue;
    const step=text(pitch,"step");
    if(!(step in semis))continue;
    // Written pitch comes directly from <pitch> in the original MusicXML.
    // Playback pitch may include the document's <transpose>, but tablature
    // must use written pitch, one octave lower, without mixer transposition.
    const writtenMidi=12*(int(text(pitch,"octave","4"))+1)+semis[step]+int(text(pitch,"alter","0"));
    const midi=writtenMidi+offset;
    if(midi<12||midi>120)continue;
    const staff=text(e,"staff","1"),voice=text(e,"voice","1"),gid=pid+"|"+staff+"|"+voice;
    if(!byId.has(gid)){const g={id:gid,part:pi,name,staff,voice,offset:0,volume:100,instrument:inferInstrument(name),count:0,tabTuning:staffTunings.get(staff)?.slice()||null};byId.set(gid,g);groups.push(g)}
    const tieTypes=kids(e,"tie").map(t=>t.getAttribute("type"));
    const key=gid+"|"+midi;
    if(tieTypes.includes("stop")&&ties.has(key)){
     const n=ties.get(key);n.duration=Math.max(n.duration,at+duration-n.start);
     if(!tieTypes.includes("start"))ties.delete(key);
    }else{
     const technical=one(one(e,"notations"),"technical");
     const originalString=int(text(technical,"string","0"),0);
     const originalFret=int(text(technical,"fret","-1"),-1);
     const n={group:gid,midi,writtenMidi,start:at,duration,measureIndex,
      originalString:originalString>0?originalString:null,
      originalFret:originalFret>=0?originalFret:null};notes.push(n);byId.get(gid).count++;
     if(tieTypes.includes("start"))ties.set(key,n);
    }
   }
  }
 }
 if(!notes.length)throw Error("La partitura no contiene notas musicales compatibles.");
 if(notes.length>13000)throw Error("La partitura supera las 13.000 notas admitidas en esta versión.");
 groups.sort((a,b)=>a.part-b.part||int(a.staff)-int(b.staff)||int(a.voice)-int(b.voice));
 const title=text(one(root,"work"),"work-title")||text(root,"movement-title")||"Partitura";
 const merged=combineInstrumentVoices(groups,notes);
 const performance=unfoldMusicXMLNotes(scoreParts,measureStarts,merged.notes);
 if(performance.notes.length>30000)throw Error("Las repeticiones producen más de 30.000 notas; divide la partitura.");
 const noteCounts=new Map();
 for(const note of performance.notes)noteCounts.set(note.group,(noteCounts.get(note.group)||0)+1);
 for(const group of merged.groups)group.count=noteCounts.get(group.id)||0;
 return {title,groups:merged.groups,notes:performance.notes,
   tempo:tempi[0]?.bpm||100,
   originalVoices:groups.length,originalParts:scoreParts.length,
   shortBars:measureStarts.shortBars,
   quarterLength:performance.quarterLength,repeatJumps:performance.jumps,
   timingVersion:11,continuousSolo:false,
   repeatSections:performance.repeatSections||0,
   alternateEndings:performance.endings||0,
   correctedEndings:performance.correctedEndings||0};
}
function projectInfoText(score,name){
 const repeatInfo=score.repeatSections
  ?" · "+score.repeatSections+" repetición(es) · "+score.alternateEndings+" casillas detectadas"
  :" · sin repeticiones MusicXML detectadas";
 return (name||score.title||"Partitura")+" · "+score.groups.length+
  " instrumentos · "+score.notes.length+" notas"+repeatInfo+
  (score.correctedEndings?" · "+score.correctedEndings+" casilla(s) numerada(s) incorrectamente: corregidas":"");
}

function makeVoiceRows(){
 const root=$("voices");
 root.replaceChildren();
 root.className="mixer-grid";
 for(const group of state.score.groups){
  const row=document.createElement("article");
  row.className="voice mixer-channel";
  const displayName=identityLabel(group.name);
  const header=document.createElement("div");header.className="channel-heading";
  const symbol=document.createElement("div");symbol.className="channel-symbol";symbol.textContent="♫";symbol.setAttribute("aria-hidden","true");
  const title=document.createElement("div");title.className="channel-title";
  const name=document.createElement("strong");name.textContent=displayName;
  const count=document.createElement("small");count.textContent=group.count+" notas"+(group.sourceCount>1?" · "+group.sourceCount+" pistas combinadas":"");
  title.append(name,count);header.append(symbol,title);
  const pitch=document.createElement("div");pitch.className="channel-control channel-pitch";
  const pitchTitle=document.createElement("div");pitchTitle.className="control-caption";pitchTitle.textContent="TONO";
  const steps=document.createElement("div");steps.className="stepper";
  const minus=document.createElement("button");minus.type="button";minus.textContent="−";minus.setAttribute("aria-label","Bajar un semitono: "+displayName);
  const plus=document.createElement("button");plus.type="button";plus.textContent="+";plus.setAttribute("aria-label","Subir un semitono: "+displayName);
  const n=document.createElement("output");n.textContent=(group.offset>0?"+":"")+group.offset;n.title="Semitonos";
  function change(delta){group.offset=clamp(group.offset+delta,-24,24);n.textContent=(group.offset>0?"+":"")+group.offset;clearAudio();updateMixerSummary();scheduleProjectSave()}
  minus.onclick=()=>change(-1);plus.onclick=()=>change(1);
  steps.append(minus,n,plus);pitch.append(pitchTitle,steps);
  const volume=document.createElement("div");volume.className="channel-control channel-volume";
  const volHeader=document.createElement("div");volHeader.className="volume-heading";
  const volTitle=document.createElement("span");volTitle.className="control-caption";volTitle.textContent="VOLUMEN";
  const val=document.createElement("span");val.className="volume-value";val.textContent=group.volume+"%";
  volHeader.append(volTitle,val);
  const range=document.createElement("input");range.type="range";range.min="0";range.max="100";range.step="1";range.value=String(group.volume);
  range.setAttribute("aria-label","Volumen de "+displayName);
  range.oninput=()=>{group.volume=int(range.value);val.textContent=group.volume+"%";adjustRenderedVolume(group);updateMixerSummary();scheduleProjectSave()};
  volume.append(volHeader,range);
  const instBox=document.createElement("label");instBox.className="channel-control channel-instrument";
  const instTitle=document.createElement("span");instTitle.className="control-caption";instTitle.textContent="INSTRUMENTO";
  const sel=document.createElement("select");sel.setAttribute("aria-label","Sonido de "+displayName);
  for(const [id,labelText] of INSTRUMENTS){
   const opt=document.createElement("option");opt.value=id;opt.textContent=labelText;sel.append(opt);
  }
  sel.value=group.instrument;
  sel.onchange=()=>{group.instrument=sel.value;clearAudio();scheduleProjectSave()};
  instBox.append(instTitle,sel);
  row.append(header,pitch,volume,instBox);
  const reassign=document.createElement("label");reassign.className="channel-reassign";
  const reassignTitle=document.createElement("span");reassignTitle.className="control-caption";reassignTitle.textContent="CORREGIR IDENTIFICACIÓN";
  const reassignSelect=document.createElement("select");
  const current=document.createElement("option");current.value="";current.textContent="Cambiar o unir con otro instrumento…";
  reassignSelect.append(current);
  for(const role of ["soprano","alto","tenor","bajo","contra"]){
   const opt=document.createElement("option");opt.value=role;opt.textContent=GUITAR_ROLES[role].name;
   reassignSelect.append(opt);
  }
  reassignSelect.setAttribute("aria-label","Corregir instrumento de "+displayName);
  reassignSelect.onchange=()=>{
   if(!reassignSelect.value)return;
   const role=reassignSelect.value,canonical=GUITAR_ROLES[role];
   if(group.name===canonical.name){reassignSelect.value="";return}
   const target=state.score.groups.find(g=>g!==group&&g.name===canonical.name);
   if(target){
    for(const note of state.score.notes)if(note.group===group.id)note.group=target.id;
    const dedup=new Set();
    state.score.notes=state.score.notes.filter(note=>{
     const key=note.group+"|"+note.midi+"|"+note.start.toFixed(7)+"|"+note.duration.toFixed(7);
     if(dedup.has(key))return false;dedup.add(key);return true;
    });
    target.sourceCount+=group.sourceCount;
    state.score.groups=state.score.groups.filter(g=>g!==group);
   }else{
    group.name=canonical.name;group.instrument=canonical.sound;
   }
   for(const g of state.score.groups)g.count=state.score.notes.filter(note=>note.group===g.id).length;
   const order={soprano:0,alto:1,tenor:2,bajo:3,contra:4};
   state.score.groups.sort((a,b)=>(order[instrumentRole(a.name,true)]??10)-(order[instrumentRole(b.name,true)]??10));
   clearAudio();makeVoiceRows();scheduleProjectSave();
   $("info").textContent=state.score.title+" · "+state.score.originalVoices+" pistas del XML reunidas en "+state.score.groups.length+" instrumentos · "+state.score.notes.length+" notas";
  };
  reassign.append(reassignTitle,reassignSelect);row.append(reassign);
  root.append(row);
 }
 updateMixerSummary();
}
function updateMixerSummary(){
 if(!state.score)return;
 const active=state.score.groups.filter(g=>g.volume>0).length;
 const label=$("mixerSummary");
 if(label)label.textContent=state.score.groups.length+" instrumentos · "+active+" con sonido";
}

// Lector MXL ZIP integrado: funciona sin bibliotecas externas.
async function unpackMxl(file){
 const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);
 const u16=p=>view.getUint16(p,true),u32=p=>view.getUint32(p,true);
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(u32(p)===0x06054b50){end=p;break}}
 if(end<0)throw Error("El .mxl no tiene una estructura ZIP válida.");
 const total=u16(end+10);let p=u32(end+16);
 if(total>2500||p>bytes.length)throw Error("Archivo .mxl incompatible.");
 const decode=new TextDecoder("utf-8"),entries=new Map();
 for(let i=0;i<total;i++){
  if(p+46>bytes.length||u32(p)!==0x02014b50)throw Error("Índice ZIP dañado.");
  const e={flags:u16(p+8),method:u16(p+10),length:u32(p+20),local:u32(p+42)};
  const fn=u16(p+28),ex=u16(p+30),comment=u16(p+32);
  const name=decode.decode(bytes.subarray(p+46,p+46+fn));
  entries.set(name,e);p+=46+fn+ex+comment;
 }
 async function extract(entry){
  const at=entry.local;
  if(at+30>bytes.length||u32(at)!==0x04034b50)throw Error("Contenido ZIP dañado.");
  if(entry.flags&1)throw Error("Archivo ZIP protegido por contraseña.");
  const a=at+30+u16(at+26)+u16(at+28),b=a+entry.length;
  if(b>bytes.length)throw Error("Archivo ZIP incompleto.");
  const packed=bytes.slice(a,b);
  let raw=packed;
  if(entry.method===8){
   if(typeof DecompressionStream!=="function")throw Error("Este navegador no puede descomprimir .mxl. Prueba Chrome actualizado.");
   try{raw=new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer())}
   catch(e){throw Error("Error al descomprimir .mxl: "+(e.message||e))}
  }else if(entry.method!==0)throw Error("Compresión ZIP no admitida: "+entry.method);
  if(raw.length>12*1024*1024)throw Error("XML descomprimido demasiado grande.");
  return decode.decode(raw);
 }
 let preferred="";
 if(entries.has("META-INF/container.xml")){
  const meta=new DOMParser().parseFromString(await extract(entries.get("META-INF/container.xml")),"application/xml");
  preferred=meta.querySelector("rootfile")?.getAttribute("full-path")||"";
 }
 const key=(preferred&&entries.has(preferred)?preferred:null)||Array.from(entries.keys()).find(n=>/\.(musicxml|xml)$/i.test(n)&&!n.startsWith("META-INF/"));
 if(!key)throw Error("No se encontró una partitura dentro del .mxl.");
 return extract(entries.get(key));
}

async function readMusicXML(file){
 const lower=file.name.toLowerCase();
 if(/\.(mscz|mscx)$/.test(lower))throw Error("Este es un archivo de proyecto de MuseScore. Abre la partitura en MuseScore Studio y usa Archivo → Exportar → MusicXML (.mxl o .musicxml).");
 if(/\.mxl$/.test(lower))return unpackMxl(file);
 if(/\.(xml|musicxml)$/i.test(lower))return file.text();
 throw Error("El archivo seleccionado no es una partitura MusicXML. Admite .xml, .musicxml o .mxl. Si es .mscz, expórtalo desde MuseScore.");
}
async function load(file){
 if(!file)return;
 if(file.size>12*1024*1024){problem("Archivo demasiado grande (máximo 12 MB).");return}
 try{
  problem("");status("");
  await flushProjectSave();
  const xml=await readMusicXML(file);
  const score=parse(xml,file.name);
  clearAudio();
  state.sourceXML=xml;state.score=score;
  state.projectId="project-"+Date.now()+"-"+Math.random().toString(36).slice(2);
  state.projectName=score.title&&score.title!=="Partitura"?score.title:file.name.replace(/\.(mxl|musicxml|xml)$/i,"");
  $("tempo").value=clamp(Math.round(score.tempo),30,240);
  $("info").hidden=false;$("info").textContent=projectInfoText(score,state.projectName);
  makeVoiceRows();$("settings").hidden=false;updateDurationEstimate();
  window.dispatchEvent(new Event("consorte-studio-score-ready"));
  if(score.shortBars)status("Partitura importada. "+score.shortBars+
    " compases parciales identificados; no se añaden pausas al final de ellos.");
  try{await saveCurrentProject();}catch(err){projectNotice("No se pudo guardar el proyecto automáticamente: "+(err.message||err))}
  return score;
 }catch(err){problem(err.message||String(err));return null}
}
$("chooseMxl").onclick=()=>$("file").click();
$("chooseAny").onclick=()=>$("fileAny").click();
for(const id of ["file","fileAny"])$(id).addEventListener("change",e=>{load(e.target.files[0]);e.target.value=""});
const drop=$("drop");
drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag")});
drop.addEventListener("dragleave",()=>drop.classList.remove("drag"));
drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("drag");load(e.dataTransfer.files[0])});
$("reset").onclick=()=>{if(!state.score)return;for(const g of state.score.groups){g.offset=0;g.volume=100;g.instrument=inferInstrument(g.name)}makeVoiceRows();clearAudio();scheduleProjectSave()};
$("stop").onclick=()=>stopPlayback(true);
function encodeWav(samples,rate){
 const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
 function str(off,s){for(let i=0;i<s.length;i++)view.setUint8(off+i,s.charCodeAt(i))}
 str(0,"RIFF");view.setUint32(4,36+samples.length*2,true);str(8,"WAVE");str(12,"fmt ");
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 str(36,"data");view.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const v=clamp(samples[i],-1,1);view.setInt16(44+i*2,Math.round(v<0?v*32768:v*32767),true)}
 return new Blob([buffer],{type:"audio/wav"});
}
function updateDurationEstimate(){
 if(!state.score)return;
 const tempo=clamp(int($("tempo").value,100),30,240);
 const beats=Math.max(state.score.quarterLength||0,...state.score.notes.map(n=>n.start+n.duration));
 const secs=Math.round(beats*60/tempo);
 const minutes=Math.floor(secs/60),rest=String(secs%60).padStart(2,"0");
 status("Duración estimada: "+minutes+":"+rest+" a "+tempo+" negras/minuto. Pulsa Generar audio.");
}
$("tempo").addEventListener("input",()=>{if(state.score){clearAudio();updateDurationEstimate();scheduleProjectSave()}});
async function synthesize(){
 if(state.busy||state.exporting||!state.score)return;
 const tempo=clamp(int($("tempo").value,100),30,240);
 const groups=new Map(state.score.groups.map(g=>[g.id,g]));
 const maxQuarter=Math.max(state.score.quarterLength||0,...state.score.notes.map(n=>n.start+n.duration));
 const lengthSeconds=maxQuarter*60/tempo+1;
 if(!Number.isFinite(lengthSeconds)||lengthSeconds<=0){problem("La duración calculada de la partitura no es válida.");return}
 if(lengthSeconds>1200){problem("La partitura supera los 20 minutos a esta velocidad. Divide la partitura en secciones.");return}
 const rate=lengthSeconds>480?12000:22050;
 const total=Math.ceil(lengthSeconds*rate);
 const memory=state.score.groups.length*total*4;
 if(memory>320*1024*1024){
  problem("Esta mezcla requiere demasiada memoria para conservar las voces separadas. Prueba una partitura más corta o divide la obra.");return;
 }
 state.busy=true;$("render").disabled=true;problem("");status("Generando pistas de instrumentos...");
 try{
  const stems=new Map();
  for(const group of state.score.groups){
   const buffer=new AudioBuffer({numberOfChannels:1,length:total,sampleRate:rate});
   stems.set(group.id,buffer);
  }
  let count=0;
  for(const note of state.score.notes){
   const g=groups.get(note.group);if(!g)continue;
   const midi=note.midi+g.offset;
   if(midi<20||midi>115)continue;
   const freq=440*Math.pow(2,(midi-69)/12);
   const start=Math.max(0,Math.round(note.start*60/tempo*rate));
   const maxDur=note.duration*60/tempo;
   const dur=Math.min(maxDur,5*60);
   // No apagues la nota antes de terminar su figura. Deja una cola corta
   // DESPUÉS del final escrito (sin rellenar silencios reales).
   const tail=Math.min(.07,Math.max(.025,dur*.12));
   const len=Math.min(Math.round((dur+tail)*rate),total-start);
   if(len<=0)continue;
   const patch=PATCH[g.instrument]||PATCH.piano;
   // Instrument samples are independent of current volume so muted voices
   // can be restored after rendering without regenerating the audio.
   const gain=.20;
   const dphase=2*Math.PI*freq/rate;
   const attack=Math.max(.002,Math.min(patch.a,dur*.3));
   const harmonicScale=patch.h.reduce((a,b)=>a+Math.abs(b),0);
   const buf=stems.get(g.id).getChannelData(0);
   let phase=0;
   for(let j=0;j<len;j++){
    const t=j/rate;
    const fadeIn=Math.min(1,t/attack);
    const fadeOut=t<=dur?1:Math.max(0,1-(t-dur)/tail);
    const pluck=patch.pluck?Math.exp(-t/Math.max(.06,patch.d)):1;
    const vibrato=patch.vib?1+.005*Math.sin(2*Math.PI*patch.vib*t):1;
    phase+=dphase*vibrato;
    let wave=0;
    for(let k=0;k<patch.h.length;k++)wave+=patch.h[k]*Math.sin(phase*(k+1));
    wave/=harmonicScale;
    if(g.instrument==="guitar-drive")wave=Math.tanh(wave*2.5);
    const trem=patch.trem?(.88+.12*Math.sin(2*Math.PI*patch.trem*t)):1;
    buf[start+j]+=wave*fadeIn*Math.max(0,fadeOut)*pluck*trem*gain;
   }
   count++;
   if(count%100===0){status("Generando instrumentos: "+Math.round(count/state.score.notes.length*100)+"%");await new Promise(resolve=>setTimeout(resolve,0))}
  }
  clearAudio();
  state.stems=stems;state.duration=lengthSeconds;state.sampleRate=rate;
  $("result").hidden=false;updatePlaybackDisplay();
  status("Pistas listas. Ajusta el volumen de cada instrumento y pulsa «Editar audio generado» para recortar o modificar la mezcla sin descargarla.");
 }catch(err){problem("No se pudo generar el audio: "+(err.message||err));status("")}
 finally{state.busy=false;$("render").disabled=false}
}
// Mezcla exclusivamente las pistas ya generadas: no vuelve a sintetizar notas.

// Reuse the previously synthesized instrument tracks for downloads, library
// saves and opening the audio in the editor, without rebuilding notes.
async function currentMixWav(){
 if(state.busy||!state.stems.size)throw Error("Primero genera audio desde MusicXML.");
 const volumes=state.score.groups.map(g=>({buffer:state.stems.get(g.id),amount:g.volume/100}));
 const len=Math.ceil(state.duration*state.sampleRate),mixed=new Float32Array(len);
 for(let i=0;i<len;i+=65536){
  const stop=Math.min(i+65536,len);
  for(const track of volumes){
   if(!track.buffer||!track.amount)continue;
   const pcm=track.buffer.getChannelData(0);
   for(let j=i;j<stop;j++)mixed[j]+=pcm[j]*track.amount;
  }
  if(i%(65536*8)===0){status("Preparando mezcla: "+Math.round(stop/len*100)+"%");await new Promise(resolve=>setTimeout(resolve,0))}
 }
 let peak=0;for(const x of mixed)peak=Math.max(peak,Math.abs(x));
 if(peak>.94){const factor=.94/peak;for(let i=0;i<mixed.length;i++)mixed[i]*=factor}
 return encodeWav(mixed,state.sampleRate);
}
function currentMixFilename(){
 return (state.projectName||state.score?.title||"Partitura").replace(/[^\w \-À-ÿ]/g,"").trim().slice(0,75).replace(/ +/g,"_")+"_consort.wav";
}
async function mixAction(button,action){
 if(state.busy||state.exporting||!state.stems.size)return;
 state.exporting=true;button.disabled=true;problem("");
 try{const wav=await currentMixWav();await action(wav,currentMixFilename())}
 catch(err){problem("No se pudo preparar la mezcla: "+(err.message||err))}
 finally{state.exporting=false;button.disabled=false}
}
async function downloadCurrentMix(){
 return mixAction($("download"),async(blob,name)=>{
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  status("Mezcla descargada con los volúmenes actuales.");
 });
}
async function refreshStudioLibrarySelects(){
 const api=window.consorteStudioLibrary;
 if(!api)return;
 const folder=$("studioSaveFolder"),previous=folder.value;
 folder.replaceChildren(new Option("Inicio de Biblioteca",""));
 for(const f of await api.folderOptions())folder.add(new Option(f.label,f.id));
 if([...folder.options].some(o=>o.value===previous))folder.value=previous;
 const records=await api.list();
 const scores=$("studioLibraryScores"),previousScore=scores.value;
 scores.replaceChildren(new Option("Selecciona una partitura de Biblioteca...",""));
 for(const item of records.filter(r=>r.type==="file"&&/\.(xml|musicxml|mxl)$/i.test(r.name||"")).sort((a,b)=>a.name.localeCompare(b.name,"es")))
  scores.add(new Option(item.name,item.id));
 if([...scores.options].some(o=>o.value===previousScore))scores.value=previousScore;
 $("studioOpenLibraryScore").disabled=scores.options.length<=1;
 const select=$("studioLibraryAudios"),selected=select.value;
 select.replaceChildren(new Option("Elegir un audio...",""));
 for(const item of records.filter(r=>r.type==="file"&&r.kind==="audio").sort((a,b)=>a.name.localeCompare(b.name,"es")))
  select.add(new Option(item.name,item.id));
 if([...select.options].some(o=>o.value===selected))select.value=selected;
}
async function openSelectedLibraryScore(id){
 const notice=$("studioScoreLibraryMessage"),button=$("studioOpenLibraryScore");
 if(!id){notice.textContent="Selecciona primero un archivo MusicXML.";return}
 if(state.busy||state.exporting){notice.textContent="Termina primero la generación o exportación actual.";return}
 button.disabled=true;notice.textContent="Cargando partitura desde Biblioteca...";
 try{
  const library=window.consorteStudioLibrary;
  if(!library?.musicXMLFile)throw Error("La conexión con Biblioteca no está disponible.");
  const file=await library.musicXMLFile(id);
  const score=await load(file);
  if(!score)throw Error("No se pudo interpretar como una partitura MusicXML. Comprueba el mensaje de error de arriba.");
  notice.textContent="«"+file.name+"» cargado desde Biblioteca. Puedes ajustar las voces y generar audio.";
  $("settings").scrollIntoView({behavior:"smooth",block:"start"});
 }catch(err){notice.textContent="Error al abrir el archivo de Biblioteca: "+(err.message||err)}
 finally{button.disabled=false}
}
$("studioOpenLibraryScore").onclick=()=>openSelectedLibraryScore($("studioLibraryScores").value);
$("studioRefreshLibraryScores").onclick=async()=>{
 const button=$("studioRefreshLibraryScores");
 button.disabled=true;
 try{
  await refreshStudioLibrarySelects();
  $("studioScoreLibraryMessage").textContent=$("studioLibraryScores").options.length>1
   ?"Lista de partituras actualizada.":"No hay archivos .xml, .musicxml o .mxl guardados en este navegador.";
 }catch(err){$("studioScoreLibraryMessage").textContent="No se pudo actualizar Biblioteca: "+(err.message||err)}
 finally{button.disabled=false}
};

$("saveMixLibrary").onclick=()=>mixAction($("saveMixLibrary"),async(blob,name)=>{
 const api=window.consorteStudioLibrary;
 if(!api)throw Error("Biblioteca Consort no está disponible.");
 const parent=$("studioSaveFolder").value||null;
 await api.saveCopy(blob,name,null,parent);
 $("studioSaveMessage").textContent="Guardado «"+name+"» en "+(parent?"la carpeta elegida":"el inicio de Biblioteca")+".";
 status("Audio guardado en Biblioteca Consort.");
 await refreshStudioLibrarySelects();
});
$("editCurrentMix").onclick=()=>mixAction($("editCurrentMix"),async(blob,name)=>{
 const api=window.consorteStudioLibrary;
 if(!api)throw Error("Editor no disponible.");
 await api.openGenerated(blob,name);
 $("studioAudioMessage").textContent="Mezcla cargada en el editor de audio.";
});
$("studioChooseAudio").onclick=()=>$("studioAudioFile").click();
$("studioAudioFile").onchange=async event=>{
 const file=event.target.files?.[0];event.target.value="";
 if(!file)return;
 try{
  await window.consorteStudioLibrary.openGenerated(file,file.name);
  $("studioAudioMessage").textContent="Audio «"+file.name+"» listo para editar.";
 }catch(err){$("studioAudioMessage").textContent="No se pudo importar el audio: "+(err.message||err)}
};
$("studioOpenLibraryAudio").onclick=async()=>{
 const id=$("studioLibraryAudios").value;
 if(!id){$("studioAudioMessage").textContent="Elige primero un audio.";return}
 try{
  await window.consorteStudioLibrary.openFromLibrary(id);
  $("studioAudioMessage").textContent="Audio de Biblioteca cargado.";
 }catch(err){$("studioAudioMessage").textContent=err.message||String(err)}
};
window.consorteStudioGetScore=()=>state.score;
window.consorteStudioOpenScore=openSelectedLibraryScore;
async function initializeStudioLibrary(){
 try{await refreshStudioLibrarySelects()}catch(err){
  $("studioSaveMessage").textContent="No se pudo consultar Biblioteca: "+(err.message||err)
 }
 const scoreId=new URLSearchParams(location.search).get("editScore");
 if(scoreId){
  $("studioLibraryScores").value=scoreId;
  await openSelectedLibraryScore(scoreId);
 }
}
if(document.getElementById("consortStudioMount"))
 window.addEventListener("consorte-studio-native-ready",initializeStudioLibrary,{once:true});
else if(document.readyState==="loading")
 window.addEventListener("DOMContentLoaded",initializeStudioLibrary,{once:true});
else initializeStudioLibrary();
$("render").onclick=synthesize;
$("download").onclick=downloadCurrentMix;
})();