import assert from 'node:assert/strict';
import worker,{validateManifest,cleanup} from './worker.js';
const rawFetch=globalThis.fetch;
let siteverify={success:true,hostname:'owner.github.io',action:'publish_catalogue'};
globalThis.fetch=async url=>{assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json(siteverify);};
class Bucket{
 constructor(){this.map=new Map();this.counter=0;}
 async put(key,value,options={}){const old=this.map.get(key);if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);const entry={bytes,etag:String(++this.counter),httpMetadata:options.httpMetadata,customMetadata:options.customMetadata};this.map.set(key,entry);return{etag:entry.etag};}
 async get(key){const entry=this.map.get(key);if(!entry)return null;return{...entry,body:entry.bytes.slice(),size:entry.bytes.length,json:async()=>JSON.parse(new TextDecoder().decode(entry.bytes))};}
 async head(key){const entry=this.map.get(key);return entry?{...entry,size:entry.bytes.length}:null;}
 async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])this.map.delete(k);}
 async list(){return{objects:[...this.map].map(([key,e])=>({key,customMetadata:e.customMetadata})).filter(e=>e.key.startsWith('catalogues/')),truncated:false};}
}
const origin='https://owner.github.io',base='https://catalogues.example';
let allowed=true;
const env={CATALOGUES:new Bucket(),ALLOWED_ORIGINS:origin,TURNSTILE_SECRET:'test-private-secret',CREATE_LIMITER:{limit:async()=>({success:allowed})}};
const image=new Uint8Array([255,216,255,0,0,0,0,0]);
const manifest=()=>({catalogue:{title:'My collection',ownerName:'Owner',description:'Things ready for a new home.'},items:[{id:'item-a',title:'Chair',category:'Furniture',condition:'Gently used',description:'A wooden chair.',price:1000,status:'available',approved:true,photoIds:['photo-a'],thumbnailId:'photo-a'}],photos:[{id:'photo-a',type:'image/jpeg',size:image.length,width:100,height:100}],turnstileToken:'challenge-token'});
async function req(path,method='GET',body,token,customOrigin=origin){const headers={};if(customOrigin)headers.Origin=customOrigin;if(token)headers.Authorization='Bearer '+token;headers['CF-Connecting-IP']='203.0.113.2';let payload;if(body instanceof Uint8Array){headers['Content-Type']='image/jpeg';payload=body;}else if(body!==undefined){headers['Content-Type']='application/json';payload=JSON.stringify(body);}return worker.fetch(new Request(base+path,{method,headers,body:payload}),env);}
assert.equal((await req('/v1/catalogues','POST',manifest(),null,'https://evil.test')).status,403);
assert.equal((await req('/v1/catalogues','OPTIONS')).status,204);
const noSecret={...env,TURNSTILE_SECRET:''};assert.equal((await worker.fetch(new Request(base+'/v1/catalogues',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.2'},body:JSON.stringify(manifest())}),noSecret)).status,503);
siteverify={success:false};assert.equal((await req('/v1/catalogues','POST',manifest())).status,403);siteverify={success:true,hostname:'wrong.test',action:'publish_catalogue'};assert.equal((await req('/v1/catalogues','POST',manifest())).status,403);siteverify={success:true,hostname:'owner.github.io',action:'wrong'};assert.equal((await req('/v1/catalogues','POST',manifest())).status,403);siteverify={success:true,hostname:'owner.github.io',action:'publish_catalogue'};
allowed=false;assert.equal((await req('/v1/catalogues','POST',manifest())).status,429);allowed=true;
let bad=manifest();bad.items[0].approved=false;assert.throws(()=>validateManifest(bad));bad=manifest();bad.items[0].status='draft';assert.throws(()=>validateManifest(bad));bad=manifest();bad.items[0].productUrl='javascript:alert(1)';assert.throws(()=>validateManifest(bad));bad=manifest();bad.photos[0].type='image/svg+xml';assert.throws(()=>validateManifest(bad));bad=manifest();bad.photos[0].size=1024*1024+1;assert.throws(()=>validateManifest(bad));bad=manifest();bad.items[0].photoIds=['missing'];assert.throws(()=>validateManifest(bad));
let response=await req('/v1/catalogues','POST',manifest());assert.equal(response.status,201);const created=await response.json();assert.match(created.id,/^[a-f0-9]{32}$/);assert.match(created.ownerToken,/^[a-f0-9]{64}$/);
const path='/v1/catalogues/'+created.id;
assert.equal((await req(path)).status,404);assert.equal((await req(path+'/photos/photo-a')).status,404);
assert.equal((await req(path+'/photos/photo-a','PUT',image,'f'.repeat(64))).status,403);
assert.equal((await req(path+'/publish','POST',{},created.ownerToken)).status,409);
assert.equal((await req(path+'/photos/photo-a','PUT',new Uint8Array([1,2]),created.ownerToken)).status,400);
assert.equal((await req(path+'/photos/photo-a','PUT',image,created.ownerToken)).status,200);
assert.equal((await req(path+'/photos/photo-a','PUT',image,created.ownerToken)).status,200,'upload retries should be idempotent');
const changed=image.slice();changed[7]=1;assert.equal((await req(path+'/photos/photo-a','PUT',changed,created.ownerToken)).status,409);
assert.equal((await req(path+'/publish','POST',{},created.ownerToken)).status,200);
response=await req(path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const shared=await response.json();assert.equal(shared.items[0].approved,true);assert.equal(shared.photos[0].dataUrl,base+path+'/photos/photo-a');assert(!JSON.stringify(shared).includes(created.ownerToken));assert(!JSON.stringify(shared).includes('ownerHash'));assert(!JSON.stringify(shared).includes('turnstileToken'));
response=await req(path+'/photos/photo-a');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),image);
assert.equal((await req(path+'/photos/photo-a','PUT',image,created.ownerToken)).status,409);
assert.equal((await req(path,'DELETE',{},'e'.repeat(64))).status,403);assert.equal((await req(path,'DELETE',{},created.ownerToken)).status,200);assert.equal((await req(path)).status,404);assert.equal((await req(path+'/photos/photo-a')).status,404);
response=await req('/v1/catalogues','POST',manifest());const expiring=await response.json();const recordKey='catalogues/'+expiring.id+'/record.json';const record=await(await env.CATALOGUES.get(recordKey)).json();record.expiresAt=new Date(Date.now()-1000).toISOString();await env.CATALOGUES.put(recordKey,JSON.stringify(record),{customMetadata:{expiresAt:record.expiresAt}});assert.equal((await req('/v1/catalogues/'+expiring.id)).status,410);await cleanup(env);assert.equal(await env.CATALOGUES.get(recordKey),null);
// A delete between publication validation and record commit must not resurrect a share.
response=await req('/v1/catalogues','POST',manifest());const concurrent=await response.json(),concurrentPath='/v1/catalogues/'+concurrent.id;
await req(concurrentPath+'/photos/photo-a','PUT',image,concurrent.ownerToken);
const originalHead=env.CATALOGUES.head.bind(env.CATALOGUES);let deleteDuringPublish=true;
env.CATALOGUES.head=async key=>{const result=await originalHead(key);if(deleteDuringPublish&&key==='catalogues/'+concurrent.id+'/photos/photo-a'){deleteDuringPublish=false;await env.CATALOGUES.delete('catalogues/'+concurrent.id+'/record.json');}return result;};
assert.equal((await req(concurrentPath+'/publish','POST',{},concurrent.ownerToken)).status,409);
assert.equal((await req(concurrentPath)).status,404);env.CATALOGUES.head=originalHead;
globalThis.fetch=rawFetch;
console.log('PASS: anonymous storage validation, mandatory Turnstile/rate protection, origin checks, owner tokens, staged private uploads, immutable photos, publication, public projection, deletion and expiry.');
