/* Consort Studio · Composer of editable MusicXML 4.0 scores.
 * Uses structured events, MusicXML export, and VexFlow engraving if available.
 * No existing imported score is overwritten. */
(function(){
"use strict";
const root=document.getElementById("xmlComposerSection");
if(!root)return;
const $=id=>root.querySelector('[id="'+id+'"]');
const DIV=960, KEY="consorte_studio_musicxml_draft_v1";
const FIGURES={whole:{ticks:3840,name:"Redonda",code:"w"},half:{ticks:1920,name:"Blanca",code:"h"},
 quarter:{ticks:960,name:"Negra",code:"q"},eighth:{ticks:480,name:"Corchea",code:"8"},
 "16th":{ticks:240,name:"Semicorchea",code:"16"},"32nd":{ticks:120,name:"Fusa",code:"32"}};
const PITCHES={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const LATIN={DO:"C",RE:"D",MI:"E",FA:"F",SOL:"G",LA:"A",SI:"B"};
let counter=0,model,editing=-1,undoStack=[],redoStack=[],visibleBar=0,engine=null,engraverLoading=false;
function noteName(p){
 if(!p)return"Silencio";
 const names={C:"Do",D:"Re",E:"Mi",F:"Fa",G:"Sol",A:"La",B:"Si"};
 return names[p.step]+(p.alter>0?"#":p.alter<0?"♭":"")+p.octave;
}
function parsePitch(value){
 const clean=String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase();
 const match=clean.match(/^(DO|RE|MI|FA|SOL|LA|SI|[A-G])([#♯B♭]?)([0-8])$/);
 if(!match)throw Error("Altura inválida. Escribe, por ejemplo, Do4, Mi4, Fa#3 o Sib3.");
 const step=LATIN[match[1]]||match[1],acc=match[2];
 return {step,alter:(acc==="#"||acc==="♯")?1:(acc==="B"||acc==="♭")?-1:0,octave:Number(match[3])};
}
function escapeXML(value){
 return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function barTicks(){return model.beats*DIV*4/model.beatType}
function eventTicks(event){
 const base=FIGURES[event.type]?.ticks;
 if(!base)throw Error("Figura musical no admitida.");
 return base*(event.dot?1.5:1);
}
function blankPart(name){return {id:"p"+Date.now()+"_"+(counter++),name,events:[]}}
function fresh(){return {
 title:"Nueva composición",author:"",beats:4,beatType:4,tempo:100,
 selected:"",parts:[blankPart("Guitarra soprano")]
}}
function current(){return model.parts.find(p=>p.id===model.selected)||model.parts[0]}
function notify(message,negative=false){
 const node=$("xmlComposerStatus");node.textContent=message;node.style.color=negative?"#a52840":"#365875";
}
function clone(x){return JSON.parse(JSON.stringify(x))}
function restoreDraft(){
 try{
  const data=JSON.parse(localStorage.getItem(KEY)||"null");
  if(data&&Array.isArray(data.parts)&&data.parts.length&&
      data.parts.length<=12&&data.parts.every(p=>Array.isArray(p.events)&&p.events.length<=5000)){
   model=data;counter=data.parts.length+1;return;
  }
 }catch(e){console.warn("No se pudo restaurar el borrador",e)}
 model=fresh();model.selected=model.parts[0].id;
}
function saveDraft(){
 try{localStorage.setItem(KEY,JSON.stringify(model))}
 catch(e){notify("No se pudo guardar automáticamente el borrador: "+e.message,true)}
}
function checkpoint(){
 undoStack.push(clone(model));if(undoStack.length>40)undoStack.shift();redoStack.length=0;
}
function timeOf(part){
 return part.events.reduce((total,e)=>total+eventTicks(e),0);
}
function makeBarEvents(part){
 const max=barTicks();if(!Number.isInteger(max)||max<=0)throw Error("Compás no válido.");
 const bars=[[]];let used=0;
 for(const event of part.events){
  const d=eventTicks(event);
  if(d>max)throw Error("Una figura dura más que todo el compás. Elige una duración menor.");
  if(used+d>max){
   if(used<max)bars[bars.length-1].push(...fillRests(max-used));
   bars.push([]);used=0;
  }
  bars[bars.length-1].push(event);
  used+=d;
  if(used===max){bars.push([]);used=0}
 }
 if(!bars.at(-1).length&&bars.length>1)bars.pop();
 if(!bars.length)bars.push([]);
 return bars;
}
function fillRests(ticks){
 const out=[],values=Object.entries(FIGURES).sort((a,b)=>b[1].ticks-a[1].ticks);
 let remaining=ticks,guard=0;
 while(remaining>0&&guard++<200){
  const candidate=values.find(([,fig])=>fig.ticks<=remaining);
  if(!candidate)throw Error("Un silencio no puede representarse con estas figuras.");
  out.push({type:candidate[0],dot:false,rest:true,notes:[]});
  remaining-=candidate[1].ticks;
 }
 if(remaining!==0)throw Error("No es posible completar el compás.");
 return out;
}
function maxBars(){
 return Math.max(1,...model.parts.map(p=>makeBarEvents(p).length));
}
function measureList(part,total){
 const bars=makeBarEvents(part).map(items=>items.slice());
 while(bars.length<total)bars.push([]);
 for(const bar of bars){
  const used=bar.reduce((sum,e)=>sum+eventTicks(e),0);
  if(used<barTicks())bar.push(...fillRests(barTicks()-used));
 }
 return bars;
}
function buildXML(){
 if(!model.parts.length)throw Error("Agrega un instrumento.");
 const total=maxBars();
 if(total>700)throw Error("Máximo 700 compases por obra.");
 const heading='<?xml version="1.0" encoding="utf-8"?>\n'+
 '<!DOCTYPE score-partwise  PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'+
 '<score-partwise version="4.0"><work><work-title>'+escapeXML(model.title||"Nueva composición")+
 '</work-title></work><movement-title>'+escapeXML(model.title||"Nueva composición")+
 '</movement-title><identification><creator type="composer">'+escapeXML(model.author||"")+
 '</creator></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults>';
 let xml=heading+'<part-list>';
 for(const [i,part] of model.parts.entries()){
  const name=escapeXML(part.name||"Guitarra "+(i+1));
  xml+='<score-part id="P'+(i+1)+'"><part-name>'+name+'</part-name>'+
   '<part-abbreviation>'+name+'</part-abbreviation>'+
   '<score-instrument id="I'+(i+1)+'"><instrument-name>'+name+'</instrument-name>'+
   '</score-instrument></score-part>';
 }
 xml+='</part-list>';
 for(const [index,part] of model.parts.entries()){
  xml+='<part id="P'+(index+1)+'">';
  const measures=measureList(part,total);
  for(let j=0;j<measures.length;j++){
   xml+='<measure implicit="no" number="'+(j+1)+'">';
   if(j===0){
    xml+='<attributes><divisions>'+DIV+'</divisions><key><fifths>0</fifths></key>'+
     '<time><beats>'+model.beats+'</beats><beat-type>'+model.beatType+'</beat-type></time>'+
     '<clef><sign>G</sign><line>2</line></clef></attributes>';
    if(index===0)xml+='<direction placement="above"><direction-type>'+
     '<metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>'+model.tempo+
     '</per-minute></metronome></direction-type><sound tempo="'+model.tempo+'"/></direction>';
   }
   for(const event of measures[j]){
    const duration=eventTicks(event),durationXML='<duration>'+duration+'</duration>'+
      '<type>'+event.type+'</type>'+(event.dot?'<dot/>':'');
    if(event.rest){
     xml+='<note><rest/>'+durationXML+'</note>';continue;
    }
    for(const [k,pitch] of (event.notes||[]).entries()){
     xml+='<note>'+(k?'<chord/>':'')+
      '<pitch><step>'+pitch.step+'</step>'+
      (pitch.alter?'<alter>'+pitch.alter+'</alter>':'')+
      '<octave>'+pitch.octave+'</octave></pitch>'+
      durationXML+'</note>';
    }
   }
   xml+='</measure>';
  }
  xml+='</part>';
 }
 return xml+'</score-partwise>';
}
function validXML(){
 const content=buildXML();
 if(typeof DOMParser!=="undefined"){
  const parsed=new DOMParser().parseFromString(content,"text/xml");
  if(parsed.querySelector("parsererror"))throw Error("El archivo MusicXML generado no es XML válido.");
  if(parsed.documentElement.localName!=="score-partwise")throw Error("El archivo no tiene el formato MusicXML esperado.");
 }
 return content;
}
function fileName(){
 return (model.title||"Partitura").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^\w\- ]/g,"").trim().replace(/\s+/g,"_").slice(0,80)||"Partitura";
}
function makeFile(){
 const ext=$("xmlComposerExtension")?.value==="xml"?"xml":"musicxml";
 return new File([validXML()],fileName()+"."+ext,{type:"application/vnd.recordare.musicxml+xml"});
}
function refreshParts(){
 const select=$("xmlComposerPart");select.replaceChildren();
 for(const p of model.parts)select.add(new Option(p.name||"Instrumento",p.id));
 if(!model.parts.some(p=>p.id===model.selected))model.selected=model.parts[0].id;
 select.value=model.selected;
 $("xmlComposerPartName").value=current().name;
 $("xmlComposerRemovePart").disabled=model.parts.length===1;
}
function eventLabel(e){
 return (e.rest?"Silencio":(e.notes||[]).map(noteName).join(" + "))+" · "+FIGURES[e.type].name+
  (e.dot?" · puntillo":"");
}
function renderEvents(){
 const part=current(),container=$("xmlComposerEvents");container.replaceChildren();
 let elapsed=0,lastBar=-1;
 for(const [i,e] of part.events.entries()){
  const b=Math.floor(elapsed/barTicks())+1;
  if(b!==lastBar){const tag=document.createElement("span");tag.className="xml-composer-bar";tag.textContent="Compás "+b;container.append(tag);lastBar=b}
  const item=document.createElement("span");item.className="xml-composer-event";
  const edit=document.createElement("button");edit.type="button";
  edit.textContent=eventLabel(e);edit.title="Editar esta figura";
  edit.onclick=()=>startEdit(i);
  const del=document.createElement("button");del.type="button";del.className="delete";
  del.textContent="×";del.setAttribute("aria-label","Eliminar "+eventLabel(e));
  del.onclick=()=>{checkpoint();part.events.splice(i,1);editing=-1;update()};
  item.append(edit,del);container.append(item);
  elapsed+=eventTicks(e);
 }
 if(!part.events.length){
  const none=document.createElement("span");none.className="small";
  none.textContent="Todavía no hay notas. Añade la primera figura para empezar.";
  container.append(none);
 }
 $("xmlComposerCount").textContent=part.events.length+" figuras · "+makeBarEvents(part).length+" compases";
 $("xmlComposerPartTitle").textContent=part.name;
}
function startEdit(i){
 const event=current().events[i];if(!event)return;
 editing=i;$("xmlComposerFigure").value=event.type;
 $("xmlComposerKind").value=event.rest?"rest":"note";
 $("xmlComposerPitch").value=event.rest?"":noteName(event.notes[0]);
 $("xmlComposerDot").checked=!!event.dot;
 $("xmlComposerAddNote").textContent="Guardar cambio";
 notify("Editando figura "+(i+1)+". Cambia la altura o duración y pulsa Guardar cambio.");
}
function finishEdit(){
 editing=-1;$("xmlComposerAddNote").textContent="Añadir figura";
}
function readInput(){
 const type=$("xmlComposerFigure").value;
 if(!FIGURES[type])throw Error("Figura no admitida");
 const kind=$("xmlComposerKind").value;
 const rest=kind==="rest";
 return {type,dot:$("xmlComposerDot").checked,rest,
  notes:rest?[]:[parsePitch($("xmlComposerPitch").value)]};
}
function applyEvent(){
 try{
  const kind=$("xmlComposerKind").value,part=current(),e=readInput();
  if(eventTicks(e)>barTicks())throw Error("La figura es más larga que el compás. Elige otra figura o un compás mayor.");
  checkpoint();
  if(kind==="chord"){
   if(editing>=0)throw Error("Para editar un acorde, selecciona su nota y guarda el cambio.");
   const prev=part.events.at(-1);
   if(!prev||prev.rest)throw Error("Antes de añadir otra nota al acorde, escribe la primera nota.");
   const pitch=e.notes[0];
   if(prev.notes.some(n=>JSON.stringify(n)===JSON.stringify(pitch)))
    throw Error("Esa nota ya existe en el acorde.");
   prev.notes.push(pitch);
  }else if(editing>=0){
   part.events[editing]=e;
  }else{
   if(part.events.length>=5000)throw Error("Máximo 5000 figuras por instrumento.");
   part.events.push(e);
  }
  finishEdit();update();notify("Figura guardada. La partitura se actualizó.");
 }catch(err){
  if(undoStack.length&&!redoStack.length&&JSON.stringify(undoStack.at(-1))===JSON.stringify(model))undoStack.pop();
  notify(err.message||String(err),true);
 }
}
function update(){
 saveDraft();refreshParts();renderEvents();renderEngravingSoon();
}
function syncMetadata(){
 const previous=clone(model);
 model.title=$("xmlComposerTitle").value.slice(0,120);
 model.author=$("xmlComposerAuthor").value.slice(0,120);
 model.beats=Number($("xmlComposerBeats").value);
 model.beatType=Number($("xmlComposerBeatType").value);
 model.tempo=Math.min(240,Math.max(30,Math.round(Number($("xmlComposerTempo").value)||100)));
 try{
  maxBars();
  saveDraft();renderEvents();renderEngravingSoon();notify("Datos de la partitura actualizados.");
 }catch(err){
  model=previous;undoStack.pop();showForm();renderEvents();
  notify("No se puede cambiar el compás: "+(err.message||err),true);
 }
}
function showForm(){
 $("xmlComposerTitle").value=model.title;
 $("xmlComposerAuthor").value=model.author;
 $("xmlComposerBeats").value=String(model.beats);
 $("xmlComposerBeatType").value=String(model.beatType);
 $("xmlComposerTempo").value=model.tempo;
}
function addPart(name){
 if(model.parts.length>=12)throw Error("Máximo 12 instrumentos.");
 const part=blankPart(name||"Guitarra "+(model.parts.length+1));
 model.parts.push(part);model.selected=part.id;return part;
}
function doUndo(reverse=false){
 const from=reverse?redoStack:undoStack,to=reverse?undoStack:redoStack;
 if(!from.length){notify("No hay más cambios que "+(reverse?"rehacer":"deshacer")+".");return}
 to.push(clone(model));model=from.pop();finishEdit();showForm();update();
}
function clearCurrent(){
 if(!confirm("¿Vaciar todas las notas de "+current().name+"?"))return;
 checkpoint();current().events=[];finishEdit();update();
}
function fillBar(){
 const part=current(),done=timeOf(part),left=barTicks()-(done%barTicks()||barTicks());
 const needed=(done%barTicks())===0?0:left;
 if(needed<=0){notify("Estás al inicio del siguiente compás; no hay nada que completar.");return}
 try{checkpoint();part.events.push(...fillRests(needed));update();notify("Compás completado con silencios escritos.")}
 catch(e){notify(e.message,true)}
}
async function reloadFolders(){
 const select=$("xmlComposerFolder"),previous=select.value;
 select.replaceChildren(new Option("Inicio de Biblioteca",""));
 const library=window.consorteStudioLibrary;
 if(!library?.folderOptions)return;
 try{
  for(const folder of await library.folderOptions())select.add(new Option(folder.label,folder.id));
  if([...select.options].some(o=>o.value===previous))select.value=previous;
 }catch(err){notify("No fue posible consultar carpetas: "+(err.message||err),true)}
}
function fallbackStaff(message){
 const container=$("xmlComposerStaff");container.replaceChildren();
 const div=document.createElement("div");div.className="engraving-fallback";
 const title=document.createElement("strong");title.textContent=current().name+" · Vista básica de pentagrama";
 const lines=document.createElement("div");lines.className="staff-lines";
 const text=document.createElement("span");
 text.textContent=message||"La partitura se exporta a MusicXML. Esta vista muestra las figuras escritas debajo.";
 div.append(title,lines,text);container.append(div);
}
let renderQueued=false;
function renderEngravingSoon(){
 if(renderQueued)return;renderQueued=true;
 requestAnimationFrame(()=>{renderQueued=false;renderEngraving()});
}
function stavenote(event,VF){
 const keys=event.rest?["b/4"]:event.notes.map(p=>p.step.toLowerCase()+
   (p.alter===1?"#":p.alter===-1?"b":"")+"/"+p.octave);
 const duration=FIGURES[event.type].code+(event.rest?"r":"");
 const note=new VF.StaveNote({clef:"treble",keys,duration});
 if(event.dot&&VF.Dot?.buildAndAttach)VF.Dot.buildAndAttach([note],{all:true});
 if(!event.rest){
  event.notes.forEach((p,i)=>{
   if(p.alter&&VF.Accidental)note.addModifier(new VF.Accidental(p.alter>0?"#":"b"),i);
  });
 }
 return note;
}
function renderEngraving(){
 const target=$("xmlComposerStaff");
 const VF=window.VexFlow;
 if(!VF?.Renderer||!VF.Stave||!VF.StaveNote){
  fallbackStaff("Vista de pentagrama profesional disponible cuando se carga el motor de notación.");
  return;
 }
 try{
  const bars=measureList(current(),maxBars());
  const last=Math.max(0,bars.length-1),start=Math.min(visibleBar,last),end=Math.min(start+4,bars.length);
  const lines=bars.slice(start,end);
  const width=Math.max(650,Math.min(1050,target.clientWidth||850));
  const height=lines.length*175+35;
  target.replaceChildren();
  const renderer=new VF.Renderer(target,VF.Renderer.Backends.SVG);
  renderer.resize(width,height);
  const context=renderer.getContext();
  for(const [j,events] of lines.entries()){
   const i=start+j,stave=new VF.Stave(48,28+j*175,width-84);
   stave.addClef("treble");
   if(i===0)stave.addTimeSignature(model.beats+"/"+model.beatType);
   stave.setContext(context).draw();
   const notes=events.map(e=>stavenote(e,VF));
   const voice=new VF.Voice({num_beats:model.beats,beat_value:model.beatType});
   voice.addTickables(notes);
   const formatter=new VF.Formatter();
   formatter.joinVoices([voice]).format([voice],Math.max(350,width-160));
   voice.draw(context,stave);
   // Clicking a rendered note edits the actual MusicXML event, not merely
   // a decorative score picture.
   const sourceEvents=current().events;
   notes.forEach((drawn,k)=>{
    const eventIndex=sourceEvents.indexOf(events[k]);
    if(eventIndex<0)return; // generated rest padding is not editable
    const node=drawn.getSVGElement?.();
    if(!node)return;
    node.classList.add("xml-composer-clickable-note");
    node.setAttribute("role","button");
    node.setAttribute("tabindex","0");
    node.setAttribute("aria-label","Editar "+eventLabel(events[k]));
    const edit=event=>{
     event.stopPropagation();
     startEdit(eventIndex);
     target.querySelectorAll(".xml-composer-selected-note").forEach(n=>n.classList.remove("xml-composer-selected-note"));
     node.classList.add("xml-composer-selected-note");
    };
    node.addEventListener("click",edit);
    node.addEventListener("keydown",event=>{
     if(event.key==="Enter"||event.key===" "){event.preventDefault();edit(event)}
    });
   });
   context.setFont("Arial",10).fillText("Compás "+(i+1),48,25+j*175);
  }
  $("xmlComposerStaffPage").textContent="Compases "+(start+1)+"–"+end+" de "+bars.length;
 }catch(err){
  console.warn("No se pudo dibujar esta partitura con el motor de notación:",err);
  fallbackStaff("La vista de pentagrama no pudo dibujarse, pero puedes seguir editando y exportando MusicXML: "+err.message);
 }
}
function loadEngraver(){
 if(window.VexFlow){renderEngravingSoon();return}
 if(engraverLoading)return;
 engraverLoading=true;
 const script=document.createElement("script");
 script.src="https://cdn.jsdelivr.net/npm/vexflow@5.0.0/build/cjs/vexflow.js";
 script.async=true;
 script.onload=async()=>{
  try{
   if(window.VexFlow?.loadFonts){
    await window.VexFlow.loadFonts("Bravura","Academico");
    window.VexFlow.setFonts("Bravura","Academico");
   }
  }catch(err){console.warn("Fuentes de notación no disponibles",err)}
  engine=window.VexFlow||null;renderEngravingSoon();
 };
 script.onerror=()=>{notify("El motor visual de pentagramas requiere conexión; el MusicXML se puede crear y exportar igualmente.",true);fallbackStaff()};
 document.head.append(script);
}
function init(){
 restoreDraft();showForm();
 const head=$("xmlComposerStaff");
 if(!head){
  const preview=document.createElement("div");preview.id="xmlComposerStaff";preview.className="xml-composer-staff";
  const parent=$("xmlComposerEvents").parentElement;
  parent.insertBefore(preview,$("xmlComposerEvents"));
  const pager=document.createElement("div");pager.className="xml-composer-voices";pager.style.justifyContent="flex-end";
  const prev=document.createElement("button");prev.type="button";prev.textContent="‹ Compases anteriores";
  const info=document.createElement("span");info.id="xmlComposerStaffPage";info.className="small";info.textContent="Compás 1";
  const next=document.createElement("button");next.type="button";next.textContent="Compases siguientes ›";
  prev.onclick=()=>{visibleBar=Math.max(0,visibleBar-4);renderEngravingSoon()};
  next.onclick=()=>{visibleBar+=4;renderEngravingSoon()};
  pager.append(prev,info,next);parent.insertBefore(pager,$("xmlComposerEvents"));
 }
 const buttons=document.createElement("div");buttons.className="xml-composer-voices";
 buttons.innerHTML='<button id="xmlComposerUndo" type="button">↶ Deshacer</button>'+
  '<button id="xmlComposerRedo" type="button">↷ Rehacer</button>'+
  '<button id="xmlComposerCancel" type="button">Cancelar edición</button>'+
  '<button id="xmlComposerClear" type="button">Borrar figuras del instrumento</button>';
 $("xmlComposerEvents").after(buttons);
 $("xmlComposerUndo").onclick=()=>doUndo();
 $("xmlComposerRedo").onclick=()=>doUndo(true);
 $("xmlComposerCancel").onclick=()=>{finishEdit();notify("Edición cancelada.")};
 $("xmlComposerClear").onclick=clearCurrent;
 for(const id of ["xmlComposerTitle","xmlComposerAuthor","xmlComposerBeats","xmlComposerBeatType","xmlComposerTempo"])
  $(id).addEventListener("change",()=>{checkpoint();syncMetadata()});
 $("xmlComposerPart").onchange=()=>{model.selected=$("xmlComposerPart").value;editing=-1;update()};
 $("xmlComposerPartName").onchange=()=>{
  const part=current();checkpoint();part.name=$("xmlComposerPartName").value.trim().slice(0,80)||"Instrumento";
  update();
 };
 $("xmlComposerAddPart").onclick=()=>{
  try{checkpoint();addPart();editing=-1;update()}catch(e){notify(e.message,true)}
 };
 $("xmlComposerFiveGuitars").onclick=()=>{
  if(model.parts.some(p=>p.events.length)&&!confirm("¿Reemplazar los instrumentos actuales por cinco guitarras vacías?"))return;
  checkpoint();model.parts=["soprano","alto","tenor","bajo","contrabajo"]
   .map(t=>blankPart("Guitarra "+t));model.selected=model.parts[0].id;finishEdit();update();
 };
 $("xmlComposerRemovePart").onclick=()=>{
  if(model.parts.length===1)return;
  if(!confirm("¿Eliminar este instrumento y sus notas?"))return;
  checkpoint();model.parts=model.parts.filter(p=>p.id!==model.selected);
  model.selected=model.parts[0].id;finishEdit();update();
 };
 $("xmlComposerAddNote").onclick=applyEvent;
 $("xmlComposerFinishBar").onclick=fillBar;
 $("xmlComposerDownload").onclick=()=>{
  try{
   const file=makeFile(),url=URL.createObjectURL(file);
   const link=document.createElement("a");link.href=url;link.download=file.name;
   document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),30000);
   notify("Archivo "+file.name+" creado. Puedes abrirlo en MuseScore.");
  }catch(err){notify(err.message||String(err),true)}
 };
 $("xmlComposerSaveLibrary").onclick=async()=>{
  const btn=$("xmlComposerSaveLibrary");btn.disabled=true;
  try{
   const file=makeFile();
   if(!window.consorteStudioLibrary?.saveScore)throw Error("La conexión con Biblioteca no está disponible.");
   const record=await window.consorteStudioLibrary.saveScore(file,model.title,$("xmlComposerFolder").value||null);
   notify("Guardado «"+record.name+"» en Biblioteca. El documento original no se modificó.");
   await reloadFolders();
   window.dispatchEvent(new Event("consorte-studio-library-updated"));
  }catch(err){notify("No se pudo guardar el MusicXML: "+(err.message||err),true)}
  finally{btn.disabled=false}
 };
 $("xmlComposerUseAudio").onclick=async()=>{
  const btn=$("xmlComposerUseAudio");btn.disabled=true;
  try{
   const file=makeFile();
   if(!window.consorteStudioImportFile)throw Error("El generador de audio no está listo.");
   const score=await window.consorteStudioImportFile(file);
   if(!score)throw Error("El generador no pudo abrir este MusicXML.");
   notify("Partitura cargada en el generador de audio: "+score.groups.length+" instrumento(s).");
  }catch(err){notify("No se pudo cargar en el generador: "+(err.message||err),true)}
  finally{btn.disabled=false}
 };
 const folderRefresh=reloadFolders;
 window.addEventListener("consorte-studio-native-ready",folderRefresh);
 reloadFolders();refreshParts();renderEvents();renderEngravingSoon();
 if("IntersectionObserver" in window){
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(e=>e.isIntersecting)){observer.disconnect();loadEngraver()}
  },{rootMargin:"200px"});
  observer.observe(root);
 }else loadEngraver();
}
init();
})();