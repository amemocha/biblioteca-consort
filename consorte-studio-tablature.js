/* Consort Studio: tablature view generated from MusicXML pitches.
   A simplified visual notation system, not MuseScore engraving. */
(function(){
"use strict";
const $=id=>document.getElementById(id),ns="http://www.w3.org/2000/svg";
const root=$("scoreTabSection");
if(!root)return;
let page=0;
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
function groupNotes(score,id){return (score.notes||[]).filter(n=>n.group===id&&Number.isFinite(n.start)).sort((a,b)=>a.start-b.start||b.midi-a.midi)}
function selectFrets(chord,open){
 const reversed=open.map((pitch,string)=>({pitch,string})).reverse();
 const used=new Set();
 return chord.map(note=>{
  const candidates=reversed.map(({pitch,string})=>({string,fret:note.midi-pitch}))
   .filter(x=>x.fret>=0&&x.fret<=24)
   .sort((a,b)=>(used.has(a.string)?100:0)+a.fret-(used.has(b.string)?100:0)-b.fret);
  const best=candidates[0]||null;
  if(best)used.add(best.string);
  return {note,best};
 });
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
 const layout=$("tabLayout").value,open=tunings[$("tabTuning").value]||tunings.guitar;
 const strings=[...open].reverse(),both=layout==="both";
 const svg=el("svg",{viewBox:both?"0 0 1100 380":"0 0 1100 245",width:1100,
  role:"img","aria-label":"Tablatura de "+g.name+", página "+(page+1)});
 svg.append(el("rect",{x:0,y:0,width:1100,height:both?380:245,fill:"#ffffff"}));
 label(svg,36,32,g.name+" · "+(both?"Partitura y tablatura":"Tablatura"),{"font-size":19,"font-weight":"700"});
 label(svg,36,55,"Cifras = trastes · Línea superior = cuerda más aguda",{"font-size":12,fill:"#64748b"});
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
    const E4=4*7+2,y=staffTop+60-(noteStaffStep(note.midi)-E4)*7.5;
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
  " · "+byStart.size+" posiciones musicales"+(omitted?" · "+omitted+" notas fuera del rango de esta afinación":"")+".";
 container.append(foot);
}
function refresh(){page=0;render()}
$("tabInstrument").onchange=refresh;
$("tabLayout").onchange=refresh;
$("tabTuning").onchange=refresh;
$("tabPrev").onclick=()=>{page=Math.max(0,page-1);render()};
$("tabNext").onclick=()=>{page++;render()};
$("tabPrint").onclick=()=>window.print();
window.addEventListener("consorte-studio-score-ready",refresh);
if(window.consorteStudioGetScore?.())refresh();
})();