const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const nodes=new Map();
function element(id){if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',checked:false,disabled:false,isConnected:true,children:[],style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},focus(){},select(){},setAttribute(){},getAttribute(){return null},getClientRects(){return[{}]},querySelector(){return element('button')},querySelectorAll(){return[]},appendChild(){},remove(){}});return nodes.get(id);}
class FormDataMock{constructor(form){this.data={...(form?.data||{})};}get(key){return this.data[key]??null;}append(key,value){this.data[key]=value;}[Symbol.iterator](){return Object.entries(this.data)[Symbol.iterator]();}}
const location={origin:'https://example.github.io',pathname:'/let-it-go/',search:'',hash:'',href:'https://example.github.io/let-it-go/',reload(){}};
const context={console,Intl,Date,URL,URLSearchParams,FormData:FormDataMock,File,Blob,Number,String,Map,Set,Array,JSON,Math,Error,Promise,Uint8Array,ArrayBuffer,DOMException,AbortController,crypto:crypto.webcrypto,location,navigator:{},setTimeout(){return 1},clearTimeout(){},document:{getElementById:element,querySelector(){return null},querySelectorAll(){return[]},addEventListener(){},activeElement:element('focus'),body:{style:{},appendChild(){}},createElement(){return element('created')},hidden:false},window:{addEventListener(){},scrollTo(){},open(){},LetItGoPdf:{}},history:{replaceState(_a,_b,url){const u=new URL(url,location.href);Object.assign(location,{pathname:u.pathname,search:u.search,hash:u.hash,href:u.href});}},fetch(){throw new Error('Unexpected network/auth request in static UI smoke test');}};
vm.createContext(context);
const filename=path.resolve(__dirname,'../app.js');
const source=fs.readFileSync(filename,'utf8').replace(/\ninitialise\(\);\s*$/,'\n');
vm.runInContext(source,context,{filename});
const run=code=>vm.runInContext(code,context);
const dataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==';
function reset(){run(`state={version:1,catalogue:{title:'My <catalogue>',ownerName:'Asha',description:'A little collection.'},photos:[{id:'p1',dataUrl:${JSON.stringify(dataUrl)},width:10,height:10,quality:{score:.8}},{id:'p2',dataUrl:${JSON.stringify(dataUrl)},width:10,height:10,quality:{score:.9}},{id:'p3',dataUrl:${JSON.stringify(dataUrl)},width:10,height:10,quality:{score:.7}}],items:[{id:'one',photoIds:['p1','p2'],thumbnailId:'p2',title:'Oak chair',category:'Furniture',brand:'Maker',condition:'Gently used',description:'A chair with wear.',price:1000,status:'available',approved:true},{id:'two',photoIds:['p3'],thumbnailId:'p3',title:'Private draft',category:'Electronics',brand:'',condition:'Not specified',description:'Needs review.',price:null,status:'draft',approved:false}]};view='space';snapshot=false;busy=false;category='All categories';reviewFilter='all';query='';selected=new Set();analysisError='';`);}
reset();
assert.equal(run('price(null)'),'Ask for price');assert.equal(run('price(0)'),'Free');assert(run('price(1250)').includes('1,250'));
assert.equal(run('approvedItems().length'),1);
assert.equal(run('coverPhoto(state.items[0]).id'),'p2');
assert.deepEqual(JSON.parse(run('JSON.stringify(exportItems()[0].photos.map(p=>p.id))')),['p2','p1']);
assert.equal(run('exportItems()[0].image'),dataUrl);
assert.equal(run('filterItems().length'),2);
run("view='catalogue'");assert.equal(run('filterItems().length'),1);
run("view='space';snapshot=true");assert.equal(run('filterItems().length'),1);
run("snapshot=false;category='Electronics'");assert.equal(run('filterItems().length'),1);
run("category='All categories';query='maker'");assert.equal(run('filterItems().length'),1);
reset();
for(const page of ['space','catalogue','help']){run(`view='${page}';render()`);assert(element('app').innerHTML.length>400,`${page} renders`);}
run("view='catalogue';render()");assert(!element('app').innerHTML.includes('Private draft'));assert(element('app').innerHTML.includes('My &lt;catalogue&gt;'));
run("snapshot=true;view='catalogue';render()");assert(!element('app').innerHTML.includes('data-action="review"'));assert(!element('app').innerHTML.includes('data-action="catalogue-settings"'));assert(!element('app').innerHTML.includes('data-select='));
run(`modal('<img src=x onerror=alert(1)>','Safe content')`);assert(!element('modal-root').innerHTML.includes('<h2><img'));assert(element('modal-root').innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
reset();run(`state.items[0].title='<img src=x onerror=alert(1)>';render()`);assert(!element('app').innerHTML.includes('<h3><img'));assert(element('app').innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert(!/\/api\/|signin-with-chatgpt|oai-authenticated-user|localStorage\.getItem\(['"]rehome/.test(source),'GitHub UI must not retain account or API dependencies');
reset();run('state.items[0].price=\'\" autofocus onfocus=alert(1) x=\"\';editItem(\'one\')');
assert(!element('modal-root').innerHTML.includes('value="" autofocus onfocus='),'Imported prices must not inject attributes into the review form');
reset();


// Explicit item review is the only route from a suggestion to an exported item.
reset();
run("editItem('two')");
assert.equal(typeof element('review-form').onsubmit,'function');
const reviewValues={title:'My headphones',category:'Electronics',condition:'Gently used',brand:'',model:'',age:'',description:'Works, with a small mark on the cup.',price:'1250.50',status:'available',productUrl:'https://example.test/product'};
function submit(values){element('review-form').onsubmit({preventDefault(){},target:{data:values}});}
submit({...reviewValues});assert.equal(run("byItem('two').approved"),false);
submit({...reviewValues,confirmed:'on',price:'12.345'});assert.equal(run("byItem('two').approved"),false);
submit({...reviewValues,confirmed:'on',productUrl:'javascript:alert(1)'});assert.equal(run("byItem('two').approved"),false);
submit({...reviewValues,confirmed:'on'});assert.equal(run("byItem('two').approved"),true);assert.equal(run("byItem('two').price"),1250.5);
assert.equal(run("byItem('two').brand"),'');assert.equal(run("byItem('two').age"),'');
assert.equal(run('approvedItems().length'),2);
run("editItem('one');editingCover='p1'");submit({...reviewValues,title:'Chair',category:'Furniture',price:'',confirmed:'on'});assert.equal(run("byItem('one').thumbnailId"),'p1');assert.equal(run("byItem('one').price"),null);
assert.throws(()=>run("safeProductUrl('https://user:password@example.test/product')"));
// Merging preserves every photo and requires approval again; splitting has the same guard.
reset();context.window.LetItGoAI={chooseThumbnail:photos=>photos.find(p=>p.id==='p3')||photos[0]};
run("selected=new Set(['one','two']);mergeSelected()");
assert.equal(run('state.items.length'),1);assert.equal(run('state.items[0].approved'),false);assert.equal(run('state.items[0].thumbnailId'),'p3');
assert.deepEqual(JSON.parse(run('JSON.stringify([...state.items[0].photoIds].sort())')),['p1','p2','p3']);
run('splitItem(state.items[0].id)');assert.equal(run('state.items.length'),3);assert(run('state.items.every(p=>!p.approved&&p.photoIds.length===1&&p.thumbnailId===p.photoIds[0])'));
reset();run("snapshot=true;selected=new Set(['one','two']);mergeSelected();splitItem('one');editItem('one');removeSelected()");assert.equal(run('state.items.length'),2);assert.equal(run('editingId'),null);
// Import/export round trips preserve the cover-first image order and confirmation state.
reset();const exported=JSON.parse(run('JSON.stringify({catalogue:state.catalogue,items:exportItems()})'));
run(`loadImported(${JSON.stringify(exported)})`);assert.equal(run('state.items.length'),2);assert.equal(run('state.items[0].approved'),true);assert.equal(run('state.items[1].approved'),false);assert.equal(run('state.items[0].photoIds[0]'),run('state.items[0].thumbnailId'));
assert.equal(run('state.catalogue.title'),'My <catalogue>');assert.equal(run('snapshot'),false);
reset();run("selected=new Set(['two']);removeSelected()");assert.equal(run('state.items.length'),2,'remove requires an explicit second confirmation');
const actionButton={dataset:{action:'remove-confirmed'},disabled:false};
run("selected=new Set(['two'])");
context.removalEvent={preventDefault(){},target:{closest(){return actionButton;}}};
run('doAction(removalEvent)');assert.equal(run('state.items.length'),1);assert.equal(run('state.photos.length'),2);assert.equal(run('state.items[0].id'),'one');

// PDF-only outward export, with private backup tools kept in Help.
reset();run('shareModal()');
const exportModal=element('modal-root').innerHTML;
assert(exportModal.includes('All categories'));
assert(exportModal.includes('Furniture'));
assert(exportModal.includes('data-action="pdf"'));
for(const removed of ['data-action="html"','data-action="create-link"','data-action="publish-hosted"','data-action="backup"','data-action="import"'])assert(!exportModal.includes(removed),removed);
assert(!exportModal.includes('HTML'));
assert(!run('workspace()').includes('data-action="backup"'));
assert(!run('workspace()').includes('data-action="import"'));
assert(run('helpPage()').includes('Save private backup'));
assert(run('helpPage()').includes('Restore private backup'));
assert(run('helpPage()').includes('id="project-input"'));
assert.equal(run('Object.hasOwn(exportOptions(),"shareUrl")'),false);
assert(!/LetItGoHosted|LetItGoShare|publishHosted|createLink|loadHosted/.test(source));
assert(run(`localPhotoUrl(${JSON.stringify(dataUrl)})`));
assert(!run('localPhotoUrl("https://example.com/photo.jpg")'));
assert.throws(()=>run('validatePrivateBackup({version:1,catalogue:{},items:[{image:"https://example.com/p.png"}]})'),/locally/);
run(`validatePrivateBackup({version:1,catalogue:{},items:[{image:${JSON.stringify(dataUrl)}}]})`);
console.log('PASS: PDF-only export modal, category/all selection, private backups isolated in Help, no remote share dependencies.');
reset();
console.log('PASS: explicit review, price/URL validation, cover selection, grouping/splitting, snapshot guards, imports and confirmed deletion.');

console.log('PASS: Let It Go! prices, covers, explicit confirmation filtering, page rendering, snapshot privacy, escaping and no login/API dependency.');
const index=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const bootScripts=[...index.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match=>match[1].split('?')[0]);
assert(bootScripts.includes('app.js'));assert(bootScripts.includes('pdf.js'));assert(bootScripts.includes('ai.js'));
for(const script of ['hosted-share.js','local-share.js','config.js'])assert(!bootScripts.includes(script),`Boot must not require removed ${script}`);
for(const script of bootScripts)assert(fs.existsSync(path.resolve(__dirname,'..',script)),`Missing boot script ${script}`);
for(const page of ['space','catalogue','help']){reset();run(`view='${page}';render()`);const html=element('app').innerHTML;for(const action of ['data-action="html"','data-action="create-link"','data-action="publish-hosted"'])assert(!html.includes(action),`${page}: removed export action ${action}`);}

(async()=>{
 // The UI passes the actual category selection to the PDF exporter, not an obsolete share helper.
 reset();
 run(`state.items.push({id:'private-confirmed',photoIds:['p3'],thumbnailId:'p3',title:'Keep private marker',category:'Electronics',brand:'',condition:'Not specified',description:'Not for a PDF.',price:null,status:'draft',approved:true});state.items.push({id:'available-unconfirmed',photoIds:['p3'],thumbnailId:'p3',title:'Unconfirmed marker',category:'Electronics',brand:'',condition:'Not specified',description:'Needs confirmation.',price:null,status:'available',approved:false});state.items.push({id:'confirmed-electronic',photoIds:['p3'],thumbnailId:'p3',title:'Confirmed headphones',category:'Electronics',brand:'',condition:'Gently used',description:'Confirmed.',price:0,status:'available',approved:true});`);
 assert.deepEqual(JSON.parse(run('JSON.stringify(approvedItems().map(item=>item.id))')),['one','confirmed-electronic']);
 run("view='catalogue';category='All categories'");assert.equal(run('filterItems().length'),2);
 run("category='Electronics';shareModal()");
 assert(element('modal-root').innerHTML.includes('<option selected>Electronics</option>'));
 element('export-category').value='Electronics';
 assert.deepEqual(JSON.parse(run('JSON.stringify(selectedExports().map(item=>item.id))')),['confirmed-electronic']);
 let pdfCalls=[];
 context.window.LetItGoPdf={download:async(records,selectedCategory,options)=>{pdfCalls.push({records:JSON.parse(JSON.stringify(records)),category:selectedCategory,options:JSON.parse(JSON.stringify(options))});}};
 const pdfButton=element('pdf-button');pdfButton.textContent='Download PDF';
 await run('pdfExport(document.getElementById("pdf-button"))');
 assert.equal(pdfCalls.length,1);assert.equal(pdfCalls[0].category,'Electronics');
 assert.equal(pdfCalls[0].options.catalogueTitle,'My <catalogue>');
 assert.deepEqual(Object.keys(pdfCalls[0].options).sort(),['catalogueTitle','description','sellerName']);
 assert.equal(pdfButton.disabled,false);assert.equal(pdfButton.textContent,'Download PDF');
 assert.equal(pdfCalls[0].records.find(item=>item.id==='one').photos[0].id,'p2');
 element('export-category').value='All categories';
 await run('pdfExport(document.getElementById("pdf-button"))');
 assert.equal(pdfCalls[1].category,'All categories');
 element('export-category').value='';
 await run('pdfExport(document.getElementById("pdf-button"))');
 assert.equal(pdfCalls[2].category,'All categories','Empty selector falls back to all categories');
 // A failed exporter must restore the action and show the error, without falling back to a web link.
 context.window.LetItGoPdf={download:async()=>{throw new Error('PDF download failed in test');}};
 await run('pdfExport(document.getElementById("pdf-button"))');assert.equal(pdfButton.disabled,false);assert(element('toast').textContent.includes('PDF download failed in test'));
 console.log('PASS: category selection, all-category default, cover order and PDF-only export error recovery.');
 reset();
 let analysedIds=[];
 context.window.LetItGoAI={analysePhotos:async(photos,progress)=>{analysedIds=Array.from(photos,p=>p.id);progress({stage:'analysing',message:'Testing suggestions',current:1,total:1,progress:100});return{model:'test-model',photos,groups:[{id:'suggested',photoIds:['p3'],thumbnailId:'p3',title:'Headphones',category:'Electronics',needsReview:true}]};}};
 await run('startSort()');
 assert.deepEqual(analysedIds,['p3'],'confirmed item photos must not be regrouped');
 assert.equal(run('state.items.find(p=>p.id==="one").approved'),true);
 assert.equal(run('state.items.find(p=>p.id==="suggested").approved'),false);
 assert.equal(run('state.items.find(p=>p.id==="suggested").brand'),'');
 assert.equal(run('state.items.find(p=>p.id==="suggested").age'),'');
 assert.equal(run('busy'),false);
 reset();
 context.window.LetItGoAI={analysePhotos:async()=>{throw new Error('Model unavailable in test');}};
 await run('startSort()');
 assert.equal(run('state.items.length'),2,'model failure must preserve the manual tray');
 assert.equal(run('state.items[1].aiSuggested'),undefined,'manual items must not be labelled as model output');
 assert(run('analysisError').includes('Model unavailable in test'));
 assert.equal(run('busy'),false);
 console.log('PASS: model adapter preserves confirmed items, requires approval of suggestions, keeps unknown facts blank and retains work on AI failure.');
})().catch(error=>{console.error(error);process.exitCode=1;});
