/* Optional anonymous catalogue publishing. Called only after the owner chooses Share. */
(function(global){
 'use strict';
 let widgetId=null,scriptPromise=null;
 function config(){const c=global.LET_IT_GO_CONFIG||{};if(!c.storageApiUrl)return null;const url=new URL(c.storageApiUrl);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Storage must use an https:// service URL.');return {base:url.href.replace(/\/$/,''),siteKey:c.turnstileSiteKey||''};}
 function ready(){try{const c=config();return !!(c?.base&&c.siteKey);}catch{return false;}}
 async function request(path,options={}){const c=config();if(!c)throw new Error('Short-link storage is not connected. Follow the storage setup guide first.');const response=await fetch(c.base+path,{...options,credentials:'omit',mode:'cors',referrerPolicy:'no-referrer'});let data;try{data=await response.json();}catch{throw new Error('Storage returned an unexpected response. Check its URL and allowed website origin.');}if(!response.ok){const e=new Error(data.error||data.message||'The catalogue could not be shared.');e.status=response.status;throw e;}return data;}
 function loadTurnstile(){if(global.turnstile)return Promise.resolve(global.turnstile);if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=()=>global.turnstile?resolve(global.turnstile):reject(new Error('The visitor check did not load.'));script.onerror=()=>{scriptPromise=null;reject(new Error('The visitor check could not load. Check your connection.'));};document.head.appendChild(script);});return scriptPromise;}
 async function mount(element){const c=config();if(!c?.siteKey||!element)return;const turnstile=await loadTurnstile();if(!element.isConnected)return;widgetId=turnstile.render(element,{sitekey:c.siteKey,action:'publish_catalogue',theme:'light'});}
 function token(){if(widgetId===null||!global.turnstile)throw new Error('Complete the visitor check before publishing.');const result=global.turnstile.getResponse(widgetId);if(!result)throw new Error('Please wait for or complete the visitor check.');return result;}
 function reset(){if(widgetId!==null&&global.turnstile){try{global.turnstile.remove(widgetId);}catch{}}widgetId=null;}
 async function publish(catalogue,items,photos,turnstileToken,onProgress){
  const confirmed=items.filter(p=>p.approved===true&&p.status!=='draft');if(!confirmed.length)throw new Error('Confirm at least one item before publishing.');
  const photoIds=new Set(confirmed.flatMap(p=>p.photoIds));const selected=photos.filter(p=>photoIds.has(p.id));const blobs=[];let total=0;
  for(const p of selected){if(!/^data:image\/(jpeg|png|webp);base64,/i.test(p.dataUrl))throw new Error('Publishing needs photos available in this browser. Download a PDF from an existing shared catalogue instead.');const blob=await(await fetch(p.dataUrl)).blob();if(blob.size>1024*1024)throw new Error('A photo is larger than the shared-storage limit of1MB. Use a smaller photo.');total+=blob.size;blobs.push({photo:p,blob});}
  if(total>10*1024*1024)throw new Error('This catalogue exceeds10MB of photos. Share a smaller category or use a PDF/HTML file.');
  const cleanItems=confirmed.map(p=>{const output={};for(const key of ['id','title','category','brand','model','condition','age','productUrl','description','price','status','approved','photoIds','thumbnailId'])output[key]=p[key];return output;});
  const draft=await request('/v1/catalogues',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({catalogue,items:cleanItems,photos:blobs.map(({photo:p,blob})=>({id:p.id,width:p.width,height:p.height,size:blob.size,type:blob.type})),turnstileToken})});
  try{for(let i=0;i<blobs.length;i++){onProgress?.(`Uploading photo ${i+1} of ${blobs.length}…`);const {photo,blob}=blobs[i];await request(`/v1/catalogues/${encodeURIComponent(draft.id)}/photos/${encodeURIComponent(photo.id)}`,{method:'PUT',headers:{'Content-Type':blob.type,Authorization:'Bearer '+draft.ownerToken},body:blob});}
   onProgress?.('Publishing your catalogue…');await request(`/v1/catalogues/${encodeURIComponent(draft.id)}/publish`,{method:'POST',headers:{Authorization:'Bearer '+draft.ownerToken}});return draft;
  }catch(error){try{await request(`/v1/catalogues/${encodeURIComponent(draft.id)}`,{method:'DELETE',headers:{Authorization:'Bearer '+draft.ownerToken}});}catch{}throw error;}
 }
 async function read(id){if(!/^[a-f0-9-]{20,80}$/i.test(id))throw new Error('This catalogue link is invalid.');return request('/v1/catalogues/'+encodeURIComponent(id));}
 async function remove(id,ownerToken){if(!/^[a-f0-9-]{20,80}$/i.test(id)||!ownerToken)throw new Error('This owner link is invalid.');return request('/v1/catalogues/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+ownerToken}});}
 global.LetItGoHosted={ready,mount,token,reset,publish,read,remove,config};
})(window);
