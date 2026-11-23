/* Consort Studio ↔ Biblioteca Consort. Same-origin, local-first bridge.
   Does not move or erase any existing library file. */
(function(){
"use strict";
const DB="consorte_library_v2", STORE="files";
let dbPromise;
function database(){
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains(STORE)){
    const store=db.createObjectStore(STORE,{keyPath:"id"});
    store.createIndex("parent","parent");
   }
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error("No se pudo abrir la Biblioteca Consort"));
 });
 return dbPromise;
}
async function operate(method,value,mode="readonly"){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
  const req=method==="getAll"?store.getAll():method==="get"?store.get(value):store.put(value);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error("Falló la operación con Biblioteca Consort"));
  tx.onerror=()=>reject(tx.error||Error("La Biblioteca Consort no pudo guardar el archivo"));
 });
}
const get=id=>operate("get",id);
const list=()=>operate("getAll");
const put=row=>operate("put",row,"readwrite");
const uuid=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(36).slice(2);
function readJSON(key,fallback){
 try{return JSON.parse(localStorage.getItem(key)||"null")||fallback}catch(_){return fallback}
}
function registerSync(record){
 // Reuse the library's pending-operation queue so its existing cloud
 // synchronization can process saves made from the separate Studio page.
 const session=readJSON("consorte_cloud_session_v1",null);
 const id=session?.user?.id;
 const operationsKey=id?"consorte_operations_v3_"+id:"consorte_unbound_changes_v3";
 const versions=id?readJSON("consorte_remote_versions_"+id,{}):{};
 const revisions=id?readJSON("consorte_remote_tokens_v3_"+id,{}):{};
 const ops=readJSON(operationsKey,{});
 const previous=ops[record.id];
 const base=previous?.base??(id?versions[record.id]||null:null);
 const baseRev=previous?.baseRev??(id?revisions[record.id]||null:null);
 ops[record.id]={kind:"put",base,baseRev,token:uuid(),at:Date.now()};
 try{
  localStorage.setItem(operationsKey,JSON.stringify(ops));
  if(id){
   const pendingKey="consorte_pending_uploads_"+id;
   const pending=new Set(readJSON(pendingKey,[]));
   pending.add(record.id);
   localStorage.setItem(pendingKey,JSON.stringify([...pending]));
  }
 }catch(e){console.warn("No se pudo registrar la sincronización pendiente",e)}
 try{window.parent?.postMessage({type:"consorte-studio-library-updated"},window.location.origin)}catch(_){}
}
async function save(record){await put(record);registerSync(record);return record}
async function saveCopy(blob,name,original=null,parentOverride){
 const record={
  id:uuid(),parent:parentOverride===undefined?(original?.parent??null):parentOverride,
  type:"file",kind:"audio",name:String(name||"Audio editado.wav").slice(0,200),
  blob,created:Date.now(),song:original?.song||"",
  instrument:original?.instrument||"",category:original?.category||""
 };
 return save(record);
}
async function replaceAudio(original,blob,name){
 if(!original||String(original.id).startsWith("direct_"))throw Error("Solo se pueden reemplazar archivos guardados en Biblioteca");
 const current=await get(original.id);
 if(!current)throw Error("El archivo original ya no se encuentra en Biblioteca");
 return save({...current,name:String(name||current.name),blob,kind:"audio",
  cloudNeedsDownload:false,modified:Date.now()});
}
async function folderOptions(){
 const records=await list(),folders=records.filter(x=>x.type==="folder");
 const byId=new Map(records.map(x=>[x.id,x]));
 const hierarchy=folder=>{
  const pieces=[folder.name],visited=new Set([folder.id]);
  let parent=folder.parent;
  while(parent&&!visited.has(parent)){
   visited.add(parent);
   const p=byId.get(parent);if(!p)break;pieces.unshift(p.name);parent=p.parent;
  }
  return pieces.join(" / ");
 };
 return folders.map(f=>({id:f.id,label:hierarchy(f)}))
  .sort((a,b)=>a.label.localeCompare(b.label,"es"));
}
// Read library items in the same origin without asking users to re-upload.
// When Studio is embedded in Biblioteca, ask the parent library to hydrate
// files that are only stored in the user's synced cloud account.
async function readableRecord(id){
 let record=await get(id);
 if(!record||record.type!=="file")throw Error("El archivo ya no está en Biblioteca Consort.");
 if(record.blob instanceof Blob&&!record.cloudNeedsDownload)return record;
 try{
  if(window.parent&&window.parent!==window&&
     window.parent.location.origin===window.location.origin&&
     typeof window.parent.consorteEnsureCloudFile==="function"){
   const hydrated=await window.parent.consorteEnsureCloudFile(record);
   if(hydrated?.blob instanceof Blob)return hydrated;
  }
 }catch(err){
  if(!(record.blob instanceof Blob))throw Error("No se pudo recuperar el archivo sincronizado: "+(err.message||err));
 }
 if(record.blob instanceof Blob)return record;
 throw Error("El archivo está solo en la nube. Ábrelo primero en Biblioteca Consort para descargarlo en este dispositivo.");
}
async function musicXMLFile(id){
 const record=await readableRecord(id);
 if(!/\.(mxl|musicxml|xml)$/i.test(String(record.name||"")))
  throw Error("Selecciona un archivo .xml, .musicxml o .mxl.");
 if(record.blob.size>12*1024*1024)
  throw Error("La partitura supera el límite de 12 MB del generador.");
 return new File([record.blob],record.name,{type:record.blob.type||"application/octet-stream"});
}

let current=null;
const editorBridge={
 current:()=>current,
 async load(record){
  current=record;
  const player=document.getElementById("studioAudioPlayer");
  if(player){
   if(player.dataset.previewUrl)URL.revokeObjectURL(player.dataset.previewUrl);
   if(record?.blob instanceof Blob){
    const url=URL.createObjectURL(record.blob);
    player.dataset.previewUrl=url;player.src=url;player.load();
   }
  }
  return record;
 },
 async saveCopy(blob,name){return saveCopy(blob,name,current)},
 async replace(blob,name){const updated=await replaceAudio(current,blob,name);await this.load(updated);return updated}
};
window.consorteStudioAudioBridge=editorBridge;
window.consorteStudioLibrary={get,list,saveCopy,replaceAudio,folderOptions,musicXMLFile,
 async openFromLibrary(id){
  const record=await readableRecord(id);
  if(record.kind!=="audio"&&!/\.(wav|mp3|m4a|aac|ogg)$/i.test(record.name||""))
   throw Error("El archivo elegido no es un audio.");
  await editorBridge.load(record);
  window.dispatchEvent(new CustomEvent("consorte-studio-audio-ready"));
  return record;
 },
 async openGenerated(blob,name){
  const record={id:"direct_"+uuid(),name:name||"Mezcla de Consort Studio.wav",blob,kind:"audio",parent:null};
  await editorBridge.load(record);
  window.dispatchEvent(new CustomEvent("consorte-studio-audio-ready"));
  return record;
 }};
window.addEventListener("DOMContentLoaded",async()=>{
 const id=new URLSearchParams(window.location.search).get("editAudio");
 if(id){
  try{await window.consorteStudioLibrary.openFromLibrary(id)}
  catch(e){
   const message=document.getElementById("studioAudioMessage");
   if(message)message.textContent="No se pudo cargar automáticamente: "+(e.message||e);
  }
 }
});
})();