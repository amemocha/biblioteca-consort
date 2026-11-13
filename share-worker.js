const DB='consorte-share-inbox-v1';
function inbox(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id',autoIncrement:true});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
self.addEventListener('fetch',event=>{
 if(event.request.method!=='POST'||new URL(event.request.url).pathname!=='/share-target')return;
 event.respondWith((async()=>{
  try{
   const data=await event.request.formData();
   const files=data.getAll('files').filter(x=>x instanceof File&&x.size>0);
   if(files.length){
    const db=await inbox();
    await new Promise((resolve,reject)=>{const transaction=db.transaction('files','readwrite');const store=transaction.objectStore('files');for(const file of files)store.add({file,created:Date.now()});transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error)});
    db.close();
   }
   return Response.redirect('/?consorte_share=1',303);
  }catch(error){return Response.redirect('/?consorte_share_error=1',303)}
 })());
});
