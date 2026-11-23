/* Consort Studio: tablature view generated from MusicXML pitches.
   A simplified visual notation system, not MuseScore engraving. */
(function(){
"use strict";
const $=id=>{
 const mount=document.getElementById("consortStudioMount");
 const key=mount&&["tabPrev","tabPageLabel","tabNext"].includes(id)?"cs-"+id:id;
 return (mount?.querySelector('[id="'+key+'"]'))||document.getElementById(key);
},ns="http://www.w3.org/2000/svg";
const root=$("scoreTabSection");
if(!root)return;
let page=0,lastTuningGroup=null;
function el(name,attrs={},text){
 const node=document.createElementNS(ns,name);
 for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
 if(text!==undefined)node.textContent=String(text);
 return node;
}
function t(midi){
 const pcs=["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"];
 return pcs[((midi%12)+12)%12]+(Math.floor(midi/12)-1);
}
const tunings={
 guitar:[40,45,50,55,59,64],
 bass:[28,33,38,43]
};
function parseTuning(textValue){
 const tokens=String(textValue||"").trim().replace(/[,;]+/g," ").split(/\s+/).filter(Boolean);
 if(tokens.length<4||tokens.length>8)return null;
 const semitones={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
 const syllables={DO:"C",RE:"D",MI:"E",FA:"F",SOL:"G",LA:"A",SI:"B"};
 const pitches=[];
 for(const item of tokens){
  const match=item.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
   .toUpperCase().match(/^(DO|RE|MI|FA|SOL|LA|SI|[A-G])([#B♯♭]?)([0-8])$/);
  if(!match)return null;
  const letter=syllables[match[1]]||match[1],accidental=match[2];
  const semitone=semitones[letter]+(["#","♯"].includes(accidental)?1:["B","♭"].includes(accidental)?-1:0);
  pitches.push(12*(Number(match[3])+1)+semitone);
 }
 if(!pitches.every((p,i)=>i===0||p>pitches[i-1]))return null;
 return pitches;
}
function groupNotes(score,id){return (score.notes||[]).filter(n=>n.group===id&&Number.isFinite(n.start)).sort((a,b)=>a.start-b.start||b.midi-a.midi)}
// Written MIDI comes from the original MusicXML <pitch> rather than
// the score's <transpose> or the mixer's editable semitone offset.
function writtenPitch(note){return Number.isFinite(note.writtenMidi)?note.writtenMidi:note.midi}
function tablaturePitch(note){return writtenPitch(note)-12}
function selectFrets(chord,open){
 // Match each pitch to a DIFFERENT physical string when played together.
 // Greedy allocation reused strings for multiple simultaneous notes, giving
 // chords that cannot be performed on a guitar.
 const candidates=chord.map(note=>open.map((pitch,string)=>{
   const fret=tablaturePitch(note)-pitch;
   if(!Number.isInteger(fret)||fret<0||fret>24)return null;
   const preferred=Number(note.originalString)>0&&
       open.length-Number(note.originalString)===string;
   return {string,fret,cost:fret+(fret>12?(fret-12)*2:0)+(preferred?-3:0)};
  }).filter(Boolean));
 let best=null,bestCount=-1,bestCost=Infinity;
 const current=Array(chord.length).fill(null);
 const order=[...chord.keys()].sort((a,b)=>candidates[a].length-candidates[b].length);
 function walk(i,used,count,cost,minFret,maxFret){
  if(count+order.length-i<bestCount)return;
  if(i===order.length){
   const stretch=count>1?Math.max(0,maxFret-minFret-4)*8:0;
   const total=cost+stretch;
   if(count>bestCount||count===bestCount&&total<bestCost){
    bestCount=count;bestCost=total;best=current.slice();
   }
   return;
  }
  const k=order[i];
  for(const candidate of candidates[k]){
   if(used.has(candidate.string))continue;
   used.add(candidate.string);current[k]=candidate;
   walk(i+1,used,count+1,cost+candidate.cost,
    Math.min(minFret,candidate.fret),Math.max(maxFret,candidate.fret));
   used.delete(candidate.string);
  }
  current[k]=null;
  walk(i+1,used,count,cost,minFret,maxFret);
 }
 // MusicXML may include multiple independent voices in one staff. The
 // search is bounded to typical physical guitar chords.
 if(chord.length<=9)walk(0,new Set(),0,0,Infinity,-Infinity);
 else{
  const used=new Set();best=chord.map((_,i)=>{
   const next=candidates[i].find(c=>!used.has(c.string))||null;
   if(next)used.add(next.string);
   return next;
  });
 }
 return chord.map((note,i)=>({note,best:best?.[i]||null}));
}
function svgLine(svg,x1,y1,x2,y2,attrs={}){
 svg.append(el("line",{x1,y1,x2,y2,stroke:"#8398b5","stroke-width":1,...attrs}));
}
function label(svg,x,y,value,attrs={}){
 svg.append(el("text",{x,y,fill:"#172b46","font-family":"system-ui,Segoe UI,Arial","font-size":13,...attrs},value));
}
function noteStaffStep(midi){
 const mapping=[0,0,1,1,2,3,3,4,4,5,5,6];
 const octave=Math.floor(midi/12)-1;
 return octave*7+mapping[((midi%12)+12)%12];
}
function render(){
 const score=window.consorteStudioGetScore?.();
 if(!score?.groups?.length){root.hidden=true;return}
 root.hidden=false;
 const select=$("tabInstrument"),previous=select.value;
 select.replaceChildren();
 for(const g of score.groups)select.add(new Option(g.name,g.id));
 if(score.groups.some(g=>g.id===previous))select.value=previous;
 const id=select.value||score.groups[0].id,g=score.groups.find(g=>g.id===id);
 const notes=groupNotes(score,id);
 const maxBeat=Math.max(0,score.quarterLength||0,...notes.map(n=>n.start+n.duration));
 const beatsPerPage=16,pages=Math.max(1,Math.ceil(maxBeat/beatsPerPage));
 page=Math.min(Math.max(0,page),pages-1);
 $("tabPageLabel").textContent="Página "+(page+1)+" / "+pages;
 $("tabPrev").disabled=page<=0;$("tabNext").disabled=page>=pages-1;
 const begin=page*beatsPerPage,end=begin+beatsPerPage;
 const layout=$("tabLayout").value;
 const selectedTuning=$("tabTuning").value;
 const originalTuning=Array.isArray(g.tabTuning)&&g.tabTuning.length>=4&&
  Array.from({length:g.tabTuning.length},(_,i)=>g.tabTuning[i]).every(Number.isFinite)
  ?g.tabTuning:null;
 const input=$("tabCustomTuning"),labelInput=$("tabCustomLabel");
 labelInput.style.display=selectedTuning==="custom"?"grid":"none";
 if(lastTuningGroup!==id){
  input.value=(g.tabCustomTuning||originalTuning||tunings.guitar).map(note=>t(note)).join(" ");
  lastTuningGroup=id;
 }
 const open=selectedTuning==="custom"?parseTuning(input.value):
  selectedTuning==="original"?(originalTuning||tunings.guitar)
  :(tunings[selectedTuning]||tunings.guitar);
 if(!open){
  $("tabScore").textContent="La afinación personalizada no es válida. Escribe de cuatro a ocho notas de grave a aguda, por ejemplo E2 A2 D3 G3 B3 E4.";
  return;
 }
 const strings=[...open].reverse(),both=layout==="both";
 const svg=el("svg",{viewBox:both?"0 0 1100 380":"0 0 1100 245",width:1100,
  role:"img","aria-label":"Tablatura de "+g.name+", página "+(page+1)});
 svg.append(el("rect",{x:0,y:0,width:1100,height:both?380:245,fill:"#ffffff"}));
 label(svg,36,32,g.name+" · "+(both?"Partitura y tablatura":"Tablatura"),{"font-size":19,"font-weight":"700"});
 label(svg,36,55,"Trastes = notas originales − 1 octava · Sin transposición del mezclador",{"font-size":12,fill:"#64748b"});
 const left=97,right=1046,width=right-left,staffTop=91;
 const tabTop=both?235:117,step=17;
 if(both){
  for(let line=0;line<5;line++)svgLine(svg,left,staffTop+line*15,right,staffTop+line*15,{stroke:"#536983","stroke-width":1.3});
  label(svg,36,staffTop+32,"𝄞",{"font-size":31});
 }
 for(let string=0;string<strings.length;string++){
  const y=tabTop+string*step;
  svgLine(svg,left,y,right,y,{stroke:"#7992ae","stroke-width":1.2});
  label(svg,20,y+5,t(strings[string]),{"font-size":12,fill:"#486586"});
 }
 const xFor=beat=>left+Math.max(0,Math.min(1,(beat-begin)/beatsPerPage))*width;
 const barQuarter=score.meterQuarter||4;
 for(let quarter=0;quarter<=beatsPerPage;quarter++){
  const beat=begin+quarter;
  if(quarter%Math.max(1,Math.round(barQuarter))!==0)continue;
  const x=xFor(beat);
  if(both)svgLine(svg,x,staffTop,x,staffTop+60,{stroke:"#b7c5d6","stroke-width":1.2});
  svgLine(svg,x,tabTop,x,tabTop+(strings.length-1)*step,{stroke:"#b7c5d6","stroke-width":1.2});
  label(svg,Math.min(right-20,x+4),tabTop+(strings.length-1)*step+25,String(beat+1),{"font-size":10,fill:"#8da0b5"});
 }
 const byStart=new Map();
 for(const n of notes){
  if(n.start<begin||n.start>=end)continue;
  const key=n.start.toFixed(6);
  if(!byStart.has(key))byStart.set(key,[]);
  byStart.get(key).push(n);
 }
 let omitted=0;
 for(const chord of byStart.values()){
  const x=xFor(chord[0].start);
  for(const {note,best} of selectFrets(chord,open)){
   if(both){
    const E4=4*7+2,y=staffTop+60-(noteStaffStep(writtenPitch(note))-E4)*7.5;
    const py=Math.max(68,Math.min(205,y));
    svg.append(el("ellipse",{cx:x,cy:py,rx:6,ry:4.2,fill:"#172b46",transform:"rotate(-14 "+x+" "+py+")"}));
    svgLine(svg,x+5,py,x+5,py-27,{stroke:"#172b46","stroke-width":1.3});
   }
   if(best){
    const stringIndex=strings.length-1-best.string,y=tabTop+stringIndex*step;
    const digit=String(best.fret);
    svg.append(el("rect",{x:x-8,y:y-9,width:16,height:16,rx:3,fill:"#fff"}));
    label(svg,x,y+4,digit,{"font-size":13,"text-anchor":"middle","font-weight":"650",fill:"#19458a"});
   }else{
    omitted++;
    label(svg,x,tabTop-10,"?",{"text-anchor":"middle",fill:"#a02836","font-weight":"700"});
   }
  }
 }
 if(!byStart.size)label(svg,105,tabTop+24,"No hay notas en este tramo.",{fill:"#64748b"});
 const container=$("tabScore");container.replaceChildren(svg);
 const foot=document.createElement("p");foot.className="small";
 foot.textContent="Mostrando negras "+(begin+1)+" a "+Math.min(end,Math.max(end,maxBeat))+
  " · "+byStart.size+" posiciones musicales · tablatura una octava más grave que el original"+
  (selectedTuning==="original"&&!originalTuning
   ?" · el MusicXML no incluye afinación de cuerdas: se usa EADGBE estándar; puedes corregirla con Afinación personalizada":"")+
  (omitted?" · "+omitted+" notas sin posición válida en cuerdas distintas: marcadas con ?":"")+".";
 container.append(foot);
}
function refresh(){page=0;lastTuningGroup=null;render()}
$("tabInstrument").onchange=refresh;
$("tabLayout").onchange=refresh;
$("tabTuning").onchange=()=>{page=0;render()};
$("tabCustomTuning").onchange=()=>{
 const score=window.consorteStudioGetScore?.();
 const group=score?.groups?.find(g=>g.id===$("tabInstrument").value);
 const tuning=parseTuning($("tabCustomTuning").value);
 if(group&&tuning){
  group.tabCustomTuning=tuning;
  window.consorteStudioAutosave?.();
 }
 render();
};
$("tabPrev").onclick=()=>{page=Math.max(0,page-1);render()};
$("tabNext").onclick=()=>{page++;render()};
$("tabPrint").onclick=()=>window.print();
window.addEventListener("consorte-studio-score-ready",refresh);
if(window.consorteStudioGetScore?.())refresh();
})();