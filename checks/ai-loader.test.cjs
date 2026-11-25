/* Real ai.js loader regression tests, with Node-core VM modules replacing only model execution. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
if(!process.execArgv.includes('--experimental-vm-modules')){
 const result=spawnSync(process.execPath,['--experimental-vm-modules',__filename],{stdio:'inherit'});
 if(result.error)throw result.error;
 process.exit(result.status||0);
}
const MODEL='Xenova/clip-vit-base-patch32';
const MANIFEST={schemaVersion:1,modelId:MODEL,modelRevision:'d15189d7028b43f1d3e65039190477f6af591c2a',transformersVersion:'3.8.1'};
const BASE='https://owner.github.io/let-it-go/';
const PHOTO={id:'photo-one',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',width:300,height:300,quality:{score:.8}};
const source=fs.readFileSync(path.resolve(__dirname,'../ai.js'),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
async function until(predicate,message){const deadline=Date.now()+1000;while(!predicate()){if(Date.now()>deadline)throw new Error(message||'Expected loader stage did not run');await new Promise(resolve=>setTimeout(resolve,1));}}
function tensor(rows){const data=new Float32Array(rows*512);for(let i=0;i<rows;i++)data[i*512]=1;return{data,dims:[rows,512],dispose(){}};}
function harness(options={}){
 const fetches=[],imports=[],stages=[],disposals=[],callbacks=[];
 const env={backends:{onnx:{wasm:{}}}};
 const controls={manifestStatus:options.manifestStatus||200,manifest:Object.hasOwn(options,'manifest')?options.manifest:{...MANIFEST},importFailures:options.importFailures||0,stageFailures:{...(options.stageFailures||{})},gate:options.gate||null};
 const stage=async(name,id,config)=>{stages.push({name,id,config});if(controls.gate?.stage===name)await controls.gate.promise;if(controls.stageFailures[name]){controls.stageFailures[name]--;throw new TypeError(name+' fetch failed');}return null;};
 const fake={env,
  AutoTokenizer:{async from_pretrained(id,config){await stage('tokenizer',id,config);return batch=>({batchSize:batch.length,input_ids:{dispose(){}}});}},
  AutoProcessor:{async from_pretrained(id,config){await stage('processor',id,config);return async()=>({pixel_values:{dispose(){}}});}},
  CLIPTextModelWithProjection:{async from_pretrained(id,config){await stage('text',id,config);const model=async tokens=>({text_embeds:tensor(tokens.batchSize)});model.dispose=async()=>disposals.push('text');return model;}},
  CLIPVisionModelWithProjection:{async from_pretrained(id,config){await stage('vision',id,config);const model=async()=>({image_embeds:tensor(1)});model.dispose=async()=>disposals.push('vision');return model;}},
  RawImage:{async read(){return {};}}
 };
 const context={console,Math,Number,Array,Object,Error,TypeError,Promise,Set,Map,URL,Uint8Array,Float32Array,AbortController,DOMException,setTimeout,clearTimeout,document:{baseURI:BASE},location:{href:BASE,origin:new URL(BASE).origin},fetch:async(input,init)=>{const url=String(input?.url||input);fetches.push({url,init});assert(url.startsWith(BASE+'ai-assets/'),'AI loader must not request remote resources: '+url);return new Response(JSON.stringify(controls.manifest),{status:controls.manifestStatus,headers:{'content-type':'application/json'}});}};
 context.window=context;context.globalThis=context;
 vm.createContext(context);
 const script=new vm.Script(source,{filename:'ai.js',importModuleDynamically:async specifier=>{imports.push(specifier);if(controls.importFailures){controls.importFailures--;throw new TypeError('Failed to fetch dynamically imported module');}const module=new vm.SyntheticModule(Object.keys(fake),function(){for(const [key,value]of Object.entries(fake))this.setExport(key,value);},{context});await module.link(()=>{throw new Error('Fake runtime has no child imports');});await module.evaluate();return module;}});
 script.runInContext(context);
 return{ai:context.LetItGoAI,controls,fetches,imports,stages,disposals,callbacks,env};
}
(async()=>{
 // Missing or mismatched local assets fail before loading any runtime module.
 const missing=harness({manifestStatus:404});
 await assert.rejects(missing.ai.analysePhotos([PHOTO],()=>{}),error=>error.code==='AI_ASSETS_MISSING'&&/asset|download|deploy|publish|setup|build/i.test(error.message));
 assert.equal(missing.imports.length,0);
 const mismatch=harness({manifest:{...MANIFEST,transformersVersion:'0.0.0'}});
 await assert.rejects(mismatch.ai.analysePhotos([PHOTO],()=>{}),error=>error.code==='AI_ASSETS_MISSING');
 assert.equal(mismatch.imports.length,0);
 const nullManifest=harness({manifest:null});
 await assert.rejects(nullManifest.ai.analysePhotos([PHOTO],()=>{}),error=>error.code==='AI_ASSETS_MISSING');
 assert.equal(nullManifest.imports.length,0);
 const wrongRevision=harness({manifest:{...MANIFEST,modelRevision:'wrong-model-revision'}});
 await assert.rejects(wrongRevision.ai.analysePhotos([PHOTO],()=>{}),error=>error.code==='AI_ASSETS_MISSING');
 assert.equal(wrongRevision.imports.length,0);
 // A successful load resolves every configured asset below the project-relative local folder.
 const success=harness();
 const progress=[];
 const result=await success.ai.analysePhotos([PHOTO],value=>progress.push(value));
 assert.equal(result.photos.length,1);assert.equal(result.groups.length,1);
 assert(success.fetches.some(r=>r.url===BASE+'ai-assets/manifest.json'));
 assert(success.imports[0].startsWith(BASE+'ai-assets/runtime/transformers.min.js?'));
 assert(success.imports[0].includes('v=3.8.1'));
 assert.equal(success.env.allowRemoteModels,false);
 assert.equal(success.env.allowLocalModels,true);
 assert(String(success.env.localModelPath).startsWith(BASE+'ai-assets/models/'));
 assert(String(success.env.backends.onnx.wasm.wasmPaths).startsWith(BASE+'ai-assets/runtime/'));
 assert.equal(success.env.backends.onnx.wasm.numThreads,1);
 assert.deepEqual(success.stages.map(s=>s.name),['tokenizer','processor','text','vision']);
 assert.equal(success.disposals.filter(s=>s==='text').length,1);
 assert(progress.some(p=>p.stage==='loading'));
 // A failed runtime import can be retried with a distinct URL rather than a cached failed module record.
 const retry=harness({importFailures:1});
 await assert.rejects(retry.ai.analysePhotos([PHOTO],()=>{}),error=>error.code==='MODEL_UNAVAILABLE');
 const retryResult=await retry.ai.analysePhotos([PHOTO],()=>{});
 assert.equal(retryResult.photos.length,1);assert.equal(retry.imports.length,2);
 assert.notEqual(retry.imports[0],retry.imports[1]);
 // A model-file failure releases the shared engine promise so the next attempt reconstructs it.
 const stageRetry=harness({stageFailures:{processor:1}});
 await assert.rejects(stageRetry.ai.analysePhotos([PHOTO],()=>{}),error=>error.code==='MODEL_UNAVAILABLE'&&/processor/i.test(error.message));
 await stageRetry.ai.analysePhotos([PHOTO],()=>{});
 assert.equal(stageRetry.stages.filter(s=>s.name==='processor').length,2);
 // Cancellation detaches this caller promptly while shared model warmup may complete for a later run.
 const gate=deferred();const cancelled=harness({gate:{stage:'tokenizer',promise:gate.promise}});
 const controller=new AbortController(),cancelProgress=[];
 const cancelledRun=cancelled.ai.analysePhotos([PHOTO],p=>cancelProgress.push(p),{signal:controller.signal});
 await until(()=>cancelled.stages.some(s=>s.name==='tokenizer'),'Tokeniser warmup was not reached');
 controller.abort();
 await Promise.race([assert.rejects(cancelledRun,e=>e.name==='AbortError'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Cancellation waited for the model download')),100))]);
 const afterAbort=cancelProgress.length;
 gate.resolve();
 await until(()=>cancelled.stages.some(s=>s.name==='vision'),'Background warmup did not complete');
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(cancelProgress.length,afterAbort,'a cancelled caller must not receive later warmup progress');
 const resumed=await cancelled.ai.analysePhotos([PHOTO],()=>{});
 assert.equal(resumed.photos.length,1);assert.equal(cancelled.imports.length,1,'completed warmup can be reused after caller cancellation');
 console.log('PASS: local AI manifest validation, local-only runtime/model/WASM configuration, stage errors, clean retries, distinct import attempts and prompt cancellation without stale progress.');
})().catch(error=>{console.error(error);process.exitCode=1;});
