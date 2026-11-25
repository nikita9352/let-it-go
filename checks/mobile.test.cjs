/* Mobile input routing and real photo-preparation cleanup, without installing a browser. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const nodes=new Map(),images=[],canvases=[],revoked=[],encodes=[];
const controls={width:4000,height:3000,failDecode:false,failEncode:false};
function element(id){if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',checked:false,disabled:false,isConnected:true,children:[],style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},focus(){},select(){},setAttribute(){},getAttribute(){return null},getClientRects(){return[{}]},querySelector(){return element('button')},querySelectorAll(){return[]},appendChild(){},remove(){}});return nodes.get(id);}
class FormDataMock{constructor(form){this.data={...(form?.data||{})};}get(key){return this.data[key]??null;}append(key,value){this.data[key]=value;}[Symbol.iterator](){return Object.entries(this.data)[Symbol.iterator]();}}
class LocalURL extends URL{static createObjectURL(file){return 'blob:test-'+encodeURIComponent(file.name)+'-'+images.length;}static revokeObjectURL(url){revoked.push(url);}}
class FakeImage{
 constructor(){this.naturalWidth=controls.width;this.naturalHeight=controls.height;this.width=controls.width;this.height=controls.height;this._src='';images.push(this);}
 get src(){return this._src;}
 set src(value){this._src=value;if(!value)return;Promise.resolve().then(()=>{if(controls.failDecode)this.onerror?.(new Error('Decode failed'));else this.onload?.();});}
}
class FakeCanvas{
 constructor(){this.width=0;this.height=0;this.draws=[];canvases.push(this);}
 getContext(){const canvas=this;return{fillStyle:'',fillRect(){},drawImage(...args){canvas.draws.push(args);},getImageData(){const data=new Uint8ClampedArray(canvas.width*canvas.height*4);data.fill(128);return{data};}};}
 toDataURL(type,quality){encodes.push({type,quality,width:this.width,height:this.height});if(controls.failEncode)throw new Error('Canvas encoding failed');return 'data:image/jpeg;base64,YQ==';}
}
const location={origin:'https://example.github.io',pathname:'/let-it-go/',search:'',hash:'',href:'https://example.github.io/let-it-go/'};
const context={console,Intl,Date,URL:LocalURL,URLSearchParams,FormData:FormDataMock,File,Blob,Number,String,Map,Set,Array,JSON,Math,Error,Promise,Uint8Array,Uint8ClampedArray,ArrayBuffer,DOMException,AbortController,Image:FakeImage,crypto:webcrypto,location,navigator:{},setTimeout(){return 1},clearTimeout(){},document:{getElementById:element,querySelector(){return null},querySelectorAll(){return[]},addEventListener(){},activeElement:element('focus'),body:{style:{},appendChild(){}},createElement(tag){return tag==='canvas'?new FakeCanvas():element('created')},hidden:false},window:{addEventListener(){},scrollTo(){},open(){},LetItGoPdf:{}},history:{replaceState(){}},fetch(){throw new Error('Unexpected network request in mobile checks');}};
vm.createContext(context);
const filename=path.resolve(__dirname,'../app.js');
vm.runInContext(fs.readFileSync(filename,'utf8').replace(/\ninitialise\(\);\s*$/,'\n'),context,{filename});
const run=code=>vm.runInContext(code,context);
const html=run('uploader()');
const galleryInput=html.match(/<input\b[^>]*\bid="photo-input"[^>]*>/)?.[0];
const cameraInput=html.match(/<input\b[^>]*\bid="camera-input"[^>]*>/)?.[0];
assert(galleryInput&&cameraInput,'Gallery picker and camera must be separate controls');
assert(/\bmultiple\b/.test(galleryInput),'Gallery selection must allow multiple photos');
assert(!/\bcapture(?:=|\s|>)/.test(galleryInput),'Gallery picker must not force camera capture');
assert(/\bcapture="environment"/.test(cameraInput),'Camera control should prefer the rear camera');
assert(!/\bmultiple\b/.test(cameraInput),'Camera control handles one captured photo at a time');
run('busy=true');const busyHtml=run('uploader()');
assert(busyHtml.match(/<input\b[^>]*\bid="photo-input"[^>]*\bdisabled/));
assert(busyHtml.match(/<input\b[^>]*\bid="camera-input"[^>]*\bdisabled/));
run('busy=false');
context.photoRoutes=[];run('addPhotos=files=>photoRoutes.push(files.map(file=>file.name));bindPage()');
const fileA={name:'front.jpg',size:500,lastModified:1},fileB={name:'back.jpg',size:600,lastModified:2};
element('photo-input').onchange({target:{files:[fileA,fileB]}});
element('camera-input').onchange({target:{files:[fileA]}});
assert.deepEqual(Array.from(context.photoRoutes[0]),['front.jpg','back.jpg']);
assert.deepEqual(Array.from(context.photoRoutes[1]),['front.jpg']);
(async()=>{
 const testFile={name:'phone-photo.jpg',size:8000,lastModified:123};context.testFile=testFile;
 const result=await run('preparePhoto(testFile)');
 assert.equal(result.width,1200);assert.equal(result.height,900);
 assert.equal(result.dataUrl,'data:image/jpeg;base64,YQ==');
 assert(Number.isFinite(result.quality.score));
 assert.deepEqual(encodes[0],{type:'image/jpeg',quality:.78,width:1200,height:900});
 assert.equal(canvases.length,2);assert(canvases.every(c=>c.width===1&&c.height===1),'Temporary processing canvases must release their large buffers');
 assert.equal(images[0].src,'');assert.equal(images[0].onload,null);assert.equal(images[0].onerror,null);
 assert.equal(revoked.length,1);
 // Portrait camera photos keep their aspect ratio and use the same maximum edge.
 controls.width=3000;controls.height=5000;
 const portrait=await run('preparePhoto(testFile)');assert.equal(portrait.width,720);assert.equal(portrait.height,1200);
 // Small input should not be enlarged just to meet the maximum edge.
 controls.width=640;controls.height=480;
 const small=await run('preparePhoto(testFile)');assert.equal(small.width,640);assert.equal(small.height,480);
 // A failed image decode still clears the image request and object URL.
 controls.failDecode=true;const beforeDecode=canvases.length,decodeImage=images.length,decodeRevokes=revoked.length;
 await assert.rejects(run('preparePhoto(testFile)'),/could not be opened/);
 assert.equal(canvases.length,beforeDecode);assert.equal(images[decodeImage].src,'');
 assert.equal(images[decodeImage].onload,null);assert.equal(images[decodeImage].onerror,null);
 assert.equal(revoked.length,decodeRevokes+1);
 // Failure while encoding must also release both canvases and the decoded image.
 controls.failDecode=false;controls.failEncode=true;const beforeEncode=canvases.length,encodeImage=images.length,encodeRevokes=revoked.length;
 await assert.rejects(run('preparePhoto(testFile)'),/Canvas encoding failed/);
 assert.equal(canvases.length,beforeEncode+2);assert(canvases.slice(beforeEncode).every(c=>c.width===1&&c.height===1));
 assert.equal(images[encodeImage].src,'');assert.equal(images[encodeImage].onload,null);assert.equal(images[encodeImage].onerror,null);
 assert.equal(revoked.length,encodeRevokes+1);
 console.log('PASS: separate mobile gallery/rear-camera inputs, multi-photo routing,1200px photo bounds, aspect ratio, no upscaling and cleanup on success/decode/export failure.');
})().catch(error=>{console.error(error);process.exitCode=1;});
