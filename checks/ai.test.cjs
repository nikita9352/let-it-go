const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context={console,Math,Number,Array,Object,Error,Promise,Set,Map,URL,setTimeout,globalThis:null};context.globalThis=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../ai.js'),'utf8'),context);
const ai=context.LetItGoAI;
assert.equal(ai.model.id,'Xenova/clip-vit-base-patch32');assert.equal(ai.model.device,'wasm');assert(ai.candidates.length>=85);
assert.deepEqual(Array.from(ai.normalise([3,4])),[.6,.8]);assert.deepEqual(Array.from(ai.normalise([0,0])),[]);assert.deepEqual(Array.from(ai.normalise([NaN])),[]);
assert.equal(ai.cosine([3,4],[6,8]),1);assert.equal(ai.cosine([1,0],[0,1]),0);assert.equal(ai.cosine([],[]),-1);
function photo(id,embedding,extra={}){return{id,embedding,label:'armchair',titleSuggested:'Armchair',category:'Furniture',quality:{score:.6},...extra};}
let groups=ai.clusterPhotos([photo('a',[1,0]),photo('b',[.995,.01]),photo('c',[0,1])]);
assert.equal(groups.length,2);assert.deepEqual(Array.from(groups[0].photoIds),['a','b']);assert(groups.every(g=>g.needsReview&&!g.confirmed));
// Same broad category alone never establishes the same item.
groups=ai.clusterPhotos([photo('a',[1,0]),photo('b',[1,0],{label:'dining-chair',titleSuggested:'Dining chair'})]);assert.equal(groups.length,2);
// Complete-link stops transitive chains from collapsing distinct objects.
const rad=d=>d*Math.PI/180;groups=ai.clusterPhotos([photo('a',[1,0]),photo('b',[Math.cos(rad(20)),Math.sin(rad(20))]),photo('c',[Math.cos(rad(40)),Math.sin(rad(40))])],{threshold:.9});assert.equal(groups.length,2);assert.equal(groups[0].photoIds.length,2);
// Mixed collections and unknown objects remain separate, even when visually identical.
groups=ai.clusterPhotos([photo('a',[1,0],{label:'mixed-collection',multipleItemsPossible:true}),photo('b',[1,0],{label:'mixed-collection',multipleItemsPossible:true})]);assert.equal(groups.length,2);
groups=ai.clusterPhotos([photo('a',[1,0],{label:'unknown-item'}),photo('b',[1,0],{label:'unknown-item'})]);assert.equal(groups.length,2);
groups=ai.clusterPhotos(Array.from({length:10},(_,i)=>photo('p'+i,[1,0])));assert.equal(groups.length,2);assert.equal(groups[0].photoIds.length,8);
assert.equal(ai.chooseThumbnail([]),null);
assert.equal(ai.chooseThumbnail([photo('blurred',[1,0],{quality:{score:.1},viewScore:.2}),photo('clear',[1,0],{quality:{score:.95},viewScore:.9})]),'clear');
assert.equal(ai.chooseThumbnail([photo('detail',[1,0],{quality:{score:.8},viewScore:.1}),photo('whole',[1,0],{quality:{score:.8},viewScore:.9})]),'whole');
const labels=ai.candidates;const vectors=labels.map(()=>[-1,0]);const chair=labels.findIndex(p=>p.label==='armchair');vectors[chair]=[1,0];let match=ai.classifyEmbedding([1,0],vectors);assert.equal(match.label,'armchair');assert.equal(match.category,'Furniture');assert.equal(match.needsReview,true);assert.equal(match.confidenceType,'relative-candidate-ranking');
const mixed=labels.findIndex(p=>p.label==='mixed-collection');vectors[chair]=[.8,.6];vectors[mixed]=[1,0];match=ai.classifyEmbedding([1,0],vectors);assert.equal(match.multipleItemsPossible,true);assert.equal(match.label,'mixed-collection');
(async()=>{await assert.rejects(ai.analysePhotos([{id:'a',dataUrl:'data:image/png;base64,x'}],()=>{}, {signal:{aborted:true}}),error=>error.name==='AbortError');const result=await ai.analysePhotos([],()=>{});assert.equal(result.groups.length,0);console.log('PASS: local-AI pure helpers, relative labels, conservative complete-link grouping, category separation, mixed-photo isolation, thumbnail ranking, limits and cancellation. Real model download/inference remains unverified here.');})().catch(error=>{console.error(error);process.exitCode=1;});
