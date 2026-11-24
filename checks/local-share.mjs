import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';
await import('../local-share.js');
const share=globalThis.LetItGoShare;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('small test photo')]).toString('base64');
const jpg=Buffer.concat([Buffer.from([255,216,255]),Buffer.from('another test photo')]).toString('base64');
const first='data:image/png;base64,'+png,second='data:image/jpeg;base64,'+jpg;
const catalogue={title:'Asha’s <collection>',ownerName:'Asha 日本',description:'Useful things for another home.',privateEmail:'secret@example.test'};
const item={id:'a & /日本',title:'<img src=x onerror=alert(1)>',category:'Home & living',brand:'Maker',model:'M1',condition:'Gently used',age:'Unknown',productUrl:'https://example.test/product?id=123&variant=2',description:'A description </script><script>alert(1)</script> & more.',price:12.5,status:'available',approved:true,photos:[{id:'front',dataUrl:first,width:100,height:100,quality:.8},{id:'back',dataUrl:second,width:90,height:90,quality:.6}],images:[first,second],thumbnailId:'back',minimumPrice:10,ownerId:'private-owner'};
const draft={...item,id:'draft',title:'Private draft marker',approved:false,status:'draft'};
const unconfirmed={...item,id:'unconfirmed',title:'Unconfirmed marker',approved:false,status:'available'};
const link=await share.encodeLink(catalogue,[item,draft,unconfirmed],'https://example.github.io/let-it-go/index.html?private=secret#owner');
assert(link.length<=share.limits.maxLinkLength);
const url=new URL(link);assert.equal(url.pathname,'/let-it-go/index.html');assert.equal(url.search,'');assert(url.hash.startsWith('#catalogue=1.'));
const decoded=await share.decodeLink(url.hash);
assert.equal(decoded.catalogue.title,catalogue.title);assert.equal(decoded.catalogue.ownerName,catalogue.ownerName);assert.equal(decoded.items.length,1);assert.equal(decoded.items[0].id,item.id);assert.equal(decoded.items[0].images.length,2);assert.equal(decoded.items[0].images[0],second);assert.equal(decoded.items[0].image,second);assert.equal(decoded.items[0].approved,true);assert.equal(decoded.items[0].minimumPrice,undefined);assert.equal(decoded.catalogue.privateEmail,undefined);
const html=share.createHtml(catalogue,[item,draft,unconfirmed]);
assert(html.includes('<title>Asha’s &lt;collection&gt; · Let It Go!</title>'));
assert(!html.includes('Private draft marker'));assert(!html.includes('Unconfirmed marker'));assert(!html.includes('private-owner'));assert(!html.includes('secret@example.test'));assert(!html.includes('<img src=x onerror=alert(1)>'));assert.equal((html.match(/<\/script>/g)||[]).length,2);
assert(!html.includes('minmax(0,1fr)))'));assert(!html.includes('minmax(230px,1fr)))'));
const dataMatch=html.match(/<script type="application\/json" id="catalogue-data">([\s\S]*?)<\/script>/);assert(dataMatch);const embedded=JSON.parse(dataMatch[1]);assert.equal(embedded.items[0].title,item.title);assert.equal(embedded.items[0].description,item.description);assert.equal(embedded.items[0].images[0],second);
const scriptMatch=html.match(/<script>\n([\s\S]*?)<\/script>/);assert(scriptMatch);new vm.Script(scriptMatch[1]);
const backup=share.createProject(catalogue,[item,draft,unconfirmed]);const backupText=new TextDecoder().decode(backup);assert(backupText.includes('Private draft marker'));assert(!backupText.includes('private-owner'));assert(!backupText.includes('minimumPrice'));assert.equal((backupText.match(/data:image\/png;base64,/g)||[]).length,3,'Each item stores one copy of each photo, not duplicate images arrays.');
const restored=await share.readProject(new Blob([backup],{type:'application/json'}));assert.equal(restored.items.length,3);assert.equal(restored.items[0].thumbnailId,'back');assert.equal(restored.items[0].photos[0].quality,.6);assert.equal(restored.items[1].approved,false);assert.equal(restored.items[1].status,'draft');assert.equal(restored.items[2].approved,false);
const errors=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
await errors(()=>share.encodeLink(catalogue,[draft],'https://example.test/tool/'),'EMPTY_CATALOGUE');
await errors(()=>share.decodeLink('#catalogue=2.json.abc'),'INVALID_LINK');
await errors(()=>share.decodeLink('#catalogue=1.gzip.invalid'),'INVALID_LINK');
await errors(()=>share.readProject(new Blob(['{"format":"let-it-go","version":1,"kind":"project","__proto__":{"polluted":true},"catalogue":{},"items":[]}'])),'INVALID_CATALOGUE');
assert.equal({}.polluted,undefined);
await errors(()=>share.readProject(new Blob([JSON.stringify({format:'let-it-go',version:2,kind:'project',catalogue,items:[]})])),'UNSUPPORTED_FORMAT');
assert.throws(()=>share.createProject(catalogue,[{...item,productUrl:'javascript:alert(1)'}]),e=>e.code==='INVALID_CATALOGUE');
assert.throws(()=>share.createProject(catalogue,[{...item,images:['data:image/svg+xml;base64,PHN2Zy8+'],photos:[],thumbnailId:''}]),e=>e.code==='INVALID_IMAGE');
assert.throws(()=>share.createProject(catalogue,[{...item,images:['/api/images/private'],photos:[],thumbnailId:''}]),e=>e.code==='INVALID_IMAGE');
assert.throws(()=>share.createProject(catalogue,[...Array(51)].map((_,i)=>({...item,id:String(i)}))),e=>e.code==='PAYLOAD_TOO_LARGE');
const noisy='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),randomBytes(30000)]).toString('base64');
await errors(()=>share.encodeLink(catalogue,[{...item,photos:[],images:[noisy],thumbnailId:''}],'https://example.test/tool/'),'LINK_TOO_LARGE');
// Limit decompression before parsing, including highly compressible malicious inputs.
const bomb=new TextEncoder().encode(' '.repeat(26*1024*1024));const compressed=new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const token=Buffer.from(compressed).toString('base64url');
// Larger gzip may hit the link-length guard first; both reject before JSON parsing.
await assert.rejects(()=>share.decodeLink('#catalogue=1.gzip.'+token),e=>['PAYLOAD_TOO_LARGE','INVALID_LINK'].includes(e.code));
// No-compression environments still produce JSON links and round-trip.
const native=globalThis.CompressionStream;globalThis.CompressionStream=undefined;try{const plain=await share.encodeLink(catalogue,[{...item,photos:[],images:[first],thumbnailId:''}],'https://example.test/app/');assert(plain.includes('.json.'));assert.equal((await share.decodeLink(new URL(plain).hash)).items.length,1);}finally{globalThis.CompressionStream=native;}
console.log('PASS: static share links, portable HTML, full project backup, thumbnail order, private draft filtering, import validation, link/decompression limits and injection resistance.');
