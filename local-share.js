/* Let It Go!: portable, browser-only catalogue snapshots. No upload or API key. */
(function () {
  'use strict';
  const VERSION = 1;
  const FORMAT = 'let-it-go';
  const MAX_ITEMS = 50;
  const MAX_PHOTOS = 200;
  const MAX_JSON_BYTES = 25 * 1024 * 1024;
  const MAX_LINK_LENGTH = 12000;
  const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const VALID_STATUSES = new Set(['draft', 'available', 'reserved', 'sold']);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  class ShareError extends Error {
    constructor(message, code = 'INVALID_CATALOGUE') { super(message); this.name = 'LetItGoShareError'; this.code = code; }
  }
  function fail(message, code) { throw new ShareError(message, code); }
  function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object.`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(`${name} is not a plain object.`);
    if (Object.keys(value).some(key => BAD_KEYS.has(key))) fail(`${name} contains an unsupported field.`);
    return value;
  }
  function text(value, name, length, fallback = '') {
    if (value == null) return fallback;
    if (typeof value !== 'string') fail(`${name} must be text.`);
    if (value.length > length) fail(`${name} is too long.`);
    return value.trim();
  }
  function bool(value, name) {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') fail(`${name} must be true or false.`);
    return value;
  }
  function approved(item) {
    if (Object.prototype.hasOwnProperty.call(item, 'approved')) return item.approved === true;
    if (Object.prototype.hasOwnProperty.call(item, 'confirmed')) return item.confirmed === true;
    return typeof item.approvedAt === 'string' && Number.isFinite(Date.parse(item.approvedAt));
  }
  function productUrl(value) {
    const source = text(value, 'Product reference', 1500);
    if (!source) return '';
    let url; try { url = new URL(source); } catch { fail('Use a complete https:// product reference.'); }
    if (url.protocol !== 'https:' || url.username || url.password) fail('Product references must use https:// without login details.');
    return url.href;
  }
  function raster(value) {
    if (typeof value !== 'string' || value.length > 10 * 1024 * 1024) fail('A photo is missing or too large.', 'INVALID_IMAGE');
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
    if (!match || !match[2] || match[2].length % 4 !== 0) fail('Photos must be embedded JPG, PNG or WebP data.', 'INVALID_IMAGE');
    let head; try { head = atob(match[2].slice(0, Math.min(40, match[2].length))); } catch { fail('A photo has invalid image data.', 'INVALID_IMAGE'); }
    const codes = Array.from(head, c => c.charCodeAt(0));
    const valid = match[1] === 'jpeg' ? codes.length >= 3 && codes[0] === 255 && codes[1] === 216 && codes[2] === 255
      : match[1] === 'png' ? codes.length >= 8 && [137,80,78,71,13,10,26,10].every((v, i) => codes[i] === v)
        : head.length >= 12 && head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
    if (!valid) fail('A photo does not match its image format.', 'INVALID_IMAGE');
    return value;
  }
  function optionalNumber(value, max) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined; }
  function photoQuality(value) {
    if (typeof value === 'number') return optionalNumber(value, 1000000000);
    if (value == null) return undefined;
    object(value, 'Photo quality');
    const result = {};
    for (const key of ['score', 'sharpness', 'exposure', 'resolution']) { const number = optionalNumber(value[key], 1000000000); if (number !== undefined) result[key] = number; }
    return Object.keys(result).length ? result : undefined;
  }
  function catalogueRecord(source) {
    object(source, 'Catalogue');
    return { title: text(source.title, 'Catalogue title', 150, 'Let It Go! catalogue') || 'Let It Go! catalogue', ownerName: text(source.ownerName ?? source.sellerName, 'Owner name', 100), description: text(source.description, 'Catalogue introduction', 2000) };
  }
  function itemRecord(source, index, project) {
    object(source, `Item ${index + 1}`);
    bool(source.approved, 'Approval'); bool(source.confirmed, 'Confirmation');
    const id = text(source.id, 'Item ID', 150, `item-${index + 1}`) || `item-${index + 1}`;
    const status = text(source.status, 'Item status', 20, approved(source) ? 'available' : 'draft');
    if (!VALID_STATUSES.has(status)) fail('An item has an unsupported status.');
    const price = source.price == null || source.price === '' ? null : source.price;
    if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 10000000 || Math.abs(Math.round(price * 100) - price * 100) > 0.000001)) fail('An item has an invalid asking price.');
    const rawPhotos = source.photos === undefined ? [] : source.photos;
    if (!Array.isArray(rawPhotos) || rawPhotos.length > MAX_PHOTOS) fail('An item has too many photos.', 'PAYLOAD_TOO_LARGE');
    const photos = rawPhotos.map((photo, i) => {
      object(photo, 'Photo');
      return { id: text(photo.id, 'Photo ID', 150, `${id}-photo-${i + 1}`) || `${id}-photo-${i + 1}`, dataUrl: raster(photo.dataUrl), width: optionalNumber(photo.width, 100000), height: optionalNumber(photo.height, 100000), quality: photoQuality(photo.quality) };
    });
    let images;
    if (source.images !== undefined) {
      if (!Array.isArray(source.images) || source.images.length > MAX_PHOTOS) fail('Item photos must be a list.', 'INVALID_IMAGE');
      images = source.images.map(raster);
    } else if (photos.length) images = photos.map(photo => photo.dataUrl);
    else images = source.image ? [raster(source.image)] : [];
    if (!images.length) fail('Each item needs at least one portable photo.', 'INVALID_IMAGE');
    if (new Set(images).size !== images.length) fail('An item contains repeated copies of the same photo.', 'INVALID_IMAGE');
    if (photos.length && (photos.length !== images.length || photos.some(photo => !images.includes(photo.dataUrl)))) fail('The photo list and item images do not match.', 'INVALID_IMAGE');
    let thumbnailId = text(source.thumbnailId, 'Thumbnail ID', 150);
    let orderedPhotos = photos.length ? images.map(image => photos.find(photo => photo.dataUrl === image)) : images.map((image, i) => ({ id: `${id}-photo-${i + 1}`, dataUrl: image }));
    if (new Set(orderedPhotos.map(photo => photo.id)).size !== orderedPhotos.length) fail('Photo IDs must be unique.');
    if (thumbnailId && !orderedPhotos.some(photo => photo.id === thumbnailId)) fail('The selected thumbnail does not match an item photo.');
    if (!thumbnailId) thumbnailId = orderedPhotos[0].id;
    const thumbnailIndex = orderedPhotos.findIndex(photo => photo.id === thumbnailId);
    if (thumbnailIndex > 0) orderedPhotos = [orderedPhotos[thumbnailIndex], ...orderedPhotos.filter((_, i) => i !== thumbnailIndex)];
    const item = { id, title: text(source.title, 'Item title', 150), category: text(source.category, 'Category', 100, 'Other') || 'Other', brand: text(source.brand, 'Brand', 150), model: text(source.model, 'Model', 150), condition: text(source.condition, 'Condition', 100), age: text(source.age, 'Age', 100), productUrl: productUrl(source.productUrl), description: text(source.description, 'Description', 5000), dimensions: text(source.dimensions, 'Dimensions', 200), price, status, approved: approved(source) };
    if (project) return { ...item, photos: orderedPhotos, thumbnailId };
    return { ...item, images: orderedPhotos.map(photo => photo.dataUrl) };
  }
  function envelope(catalogue, items, project) {
    if (!Array.isArray(items) || items.length > MAX_ITEMS) fail(`A catalogue can contain up to ${MAX_ITEMS} items.`, 'PAYLOAD_TOO_LARGE');
    const candidates = project ? items : items.filter(item => item && typeof item === 'object' && approved(item) && item.status !== 'draft');
    if (!project && !candidates.length) fail('Confirm at least one non-draft item before sharing.', 'EMPTY_CATALOGUE');
    const records = candidates.map((item, index) => itemRecord(item, index, project));
    if (new Set(records.map(item => item.id)).size !== records.length) fail('Item IDs must be unique.');
    const photoCount = records.reduce((sum, item) => sum + (item.photos || item.images).length, 0);
    if (photoCount > MAX_PHOTOS) fail(`A catalogue can contain up to ${MAX_PHOTOS} photos.`, 'PAYLOAD_TOO_LARGE');
    return { format: FORMAT, version: VERSION, kind: project ? 'project' : 'catalogue', catalogue: catalogueRecord(catalogue), items: records };
  }
  function serialise(value) {
    const bytes = encoder.encode(JSON.stringify(value));
    if (bytes.length > MAX_JSON_BYTES) fail('The catalogue is too large to export. Reduce photo sizes or export a smaller collection.', 'PAYLOAD_TOO_LARGE');
    return bytes;
  }
  function hydrated(value) {
    return { catalogue: value.catalogue, items: value.items.map((item, index) => {
      const stored = itemRecord(item, index, value.kind === 'project');
      const photos = stored.photos || stored.images.map((dataUrl, i) => ({ id: `${stored.id}-photo-${i + 1}`, dataUrl }));
      return { ...stored, photos, images: photos.map(photo => photo.dataUrl), image: photos[0].dataUrl, thumbnailId: stored.thumbnailId || photos[0].id };
    }) };
  }
  function parse(bytes, expectedKind) {
    if (bytes.length > MAX_JSON_BYTES) fail('This catalogue file is too large.', 'PAYLOAD_TOO_LARGE');
    let value; try { value = JSON.parse(decoder.decode(bytes)); } catch { fail('This is not a valid Let It Go! catalogue file.'); }
    object(value, 'Catalogue file');
    if (value.format !== FORMAT || value.version !== VERSION || !['catalogue', 'project'].includes(value.kind) || expectedKind && value.kind !== expectedKind) fail('This catalogue format or version is not supported.', 'UNSUPPORTED_FORMAT');
    return hydrated(envelope(value.catalogue, value.items, value.kind === 'project'));
  }
  async function readStream(stream, max = MAX_JSON_BYTES) {
    const reader = stream.getReader(), chunks = []; let length = 0;
    try { while (true) { const result = await reader.read(); if (result.done) break; length += result.value.byteLength; if (length > max) { await reader.cancel(); fail('The expanded catalogue is too large.', 'PAYLOAD_TOO_LARGE'); } chunks.push(result.value); } }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  }
  function base64url(bytes) { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function fromBase64url(value) { if (!/^[A-Za-z0-9_-]+$/.test(value)) fail('This catalogue link is malformed.', 'INVALID_LINK'); try { const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)); return Uint8Array.from(binary, c => c.charCodeAt(0)); } catch { fail('This catalogue link is malformed.', 'INVALID_LINK'); } }
  async function encodeLink(catalogue, items, baseUrl) {
    const bytes = serialise(envelope(catalogue, items, false)); let payload = bytes, method = 'json';
    if (typeof CompressionStream === 'function') { try { const compressed = await readStream(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), MAX_JSON_BYTES + 65536); if (compressed.length < bytes.length) { payload = compressed; method = 'gzip'; } } catch (error) { if (error.code === 'PAYLOAD_TOO_LARGE') throw error; } }
    let url; try { url = new URL(baseUrl || location.href); } catch { fail('Use a complete website address for the catalogue link.', 'INVALID_LINK'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('Use a normal website address for the catalogue link.', 'INVALID_LINK');
    url.search = ''; url.hash = `catalogue=${VERSION}.${method}.${base64url(payload)}`;
    if (url.href.length > MAX_LINK_LENGTH) fail('This photo collection is too large for a self-contained web link. Download a PDF or portable HTML catalogue instead.', 'LINK_TOO_LARGE');
    return url.href;
  }
  async function decodeLink(hash) {
    if (typeof hash !== 'string' || hash.length > MAX_LINK_LENGTH) fail('This catalogue link is too large.', 'INVALID_LINK');
    const fragment = hash.includes('#') ? hash.slice(hash.indexOf('#') + 1) : hash;
    const match = /^catalogue=(\d+)\.(gzip|json)\.([A-Za-z0-9_-]+)$/.exec(fragment);
    if (!match || Number(match[1]) !== VERSION) fail('This catalogue link is invalid or uses an unsupported version.', 'INVALID_LINK');
    let bytes = fromBase64url(match[3]);
    if (match[2] === 'gzip') {
      if (typeof DecompressionStream !== 'function') fail('This browser cannot open compressed catalogue links. Try an updated browser or ask for the PDF.', 'UNSUPPORTED_COMPRESSION');
      try { bytes = await readStream(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))); } catch (error) { if (error instanceof ShareError) throw error; fail('This catalogue link could not be opened.', 'INVALID_LINK'); }
    }
    return parse(bytes, 'catalogue');
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function createHtml(catalogue, items) {
    const data = envelope(catalogue, items, false); serialise(data);
    const encoded = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escapeHtml(data.catalogue.title)} · Let It Go!</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f8f4;color:#253f33;font:16px/1.6 system-ui,-apple-system,sans-serif}header,main,footer{max-width:1120px;margin:auto;padding:28px 24px}.brand{font-size:15px;letter-spacing:.04em;color:#697e69}h1{font:clamp(32px,6vw,54px)/1.12 Georgia,serif;font-weight:400;letter-spacing:-1px;margin:28px 0 15px}header p{max-width:730px;white-space:pre-wrap;color:#637662}header small{font-size:14px;color:#6d7c68}.controls{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}input,select,button{font:inherit;color:inherit}input,select{padding:12px 14px;background:white;border:1px solid #d8e1d1;border-radius:8px}input{flex:1;min-width:200px}select{max-width:100%}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:25px 20px}.card{cursor:pointer;min-width:0;text-align:left;border:0;padding:0;background:transparent}.card img{width:100%;height:235px;object-fit:cover;border-radius:10px;background:#e5e9de}.meta{font-size:13px;color:#77866e;margin-top:9px}.card h2{font-size:17px;font-weight:600;margin:5px 0}.price{font-size:17px;font-weight:600}.status{display:inline-block;font-size:12px;background:#e8eedf;padding:3px 7px;border-radius:4px;margin:7px 0}.empty{padding:45px 0;color:#71806c}footer{font-size:13px;color:#77856f;border-top:1px solid #e1e6d8;margin-top:35px}dialog{border:0;border-radius:14px;padding:25px;max-width:780px;width:calc(100% - 30px);max-height:90vh;overflow:auto;background:#fcfcf8;color:inherit}dialog::backdrop{background:#183525bc}.close{float:right;border:1px solid #d9e1d0;border-radius:6px;background:white;padding:7px 13px;font-size:14px}.detail-image{display:block;margin:20px auto 10px;width:100%;max-height:390px;object-fit:contain;border-radius:8px;background:#edf0e7}.thumbs{display:flex;gap:9px;overflow:auto;padding:5px 2px 12px}.thumbs button{padding:0;border:1px solid #d7dfcd;border-radius:6px;overflow:hidden;background:white;min-width:65px;height:65px}.thumbs img{width:65px;height:65px;object-fit:cover}.detail-title{font:32px/1.15 Georgia,serif;letter-spacing:-.5px;margin:20px 0 12px}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin:20px 0}dt{font-size:13px;color:#7d8b73}dd{margin:3px 0;font-size:15px;overflow-wrap:anywhere}.description{white-space:pre-wrap;color:#65755d}a{color:#3d6650}.dialog-price{font-size:24px;margin:10px 0}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #a7ba8a;outline-offset:4px}@media(max-width:560px){header,main,footer{padding:22px 18px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:23px 13px}.card img{height:190px}.card h2{font-size:15px}.meta{font-size:12px}.price{font-size:15px}dialog{padding:20px}.detail-title{font-size:27px}dl{grid-template-columns:1fr}}
</style></head><body><header><div class="brand">Let It Go! · A personal decluttering catalogue</div><h1 id="title"></h1><p id="intro"></p><small id="owner"></small></header><main><div class="controls"><input id="search" type="search" placeholder="Search this collection" aria-label="Search catalogue"><select id="category" aria-label="Filter by category"></select></div><div id="grid" class="grid"></div><p id="empty" class="empty" hidden>No items match this search.</p></main><footer>A portable snapshot made with Let It Go! Details were confirmed by the catalogue owner. Ask them about current availability, condition, collection and payment.</footer><dialog id="detail"><button id="close" class="close">Close</button><div id="detail-content"></div></dialog><script type="application/json" id="catalogue-data">${encoded}</script><script>
(function(){'use strict';const data=JSON.parse(document.getElementById('catalogue-data').textContent);const byId=id=>document.getElementById(id);const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};const price=v=>v===null?'Ask for price':v===0?'Free':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(v);const statuses={available:'Available',reserved:'Reserved',sold:'Rehomed'};byId('title').textContent=data.catalogue.title;byId('intro').textContent=data.catalogue.description;byId('owner').textContent=data.catalogue.ownerName?'Curated by '+data.catalogue.ownerName:'';const select=byId('category');['All categories',...new Set(data.items.map(item=>item.category))].forEach(category=>{const option=make('option',category);option.value=category;select.appendChild(option);});function show(item){const container=byId('detail-content');container.replaceChildren();const image=make('img');image.className='detail-image';image.alt=item.title;image.src=item.images[0];container.appendChild(image);if(item.images.length>1){const thumbs=make('div',undefined,'thumbs');item.images.forEach((source,index)=>{const button=make('button');button.type='button';button.setAttribute('aria-label','View photo '+(index+1));const thumbnail=make('img');thumbnail.src=source;thumbnail.alt='Item view '+(index+1);button.appendChild(thumbnail);button.addEventListener('click',()=>{image.src=source;});thumbs.appendChild(button);});container.appendChild(thumbs);}container.appendChild(make('h2',item.title,'detail-title'));container.appendChild(make('span',statuses[item.status]||'Available','status'));container.appendChild(make('div',price(item.price),'dialog-price'));container.appendChild(make('p',item.description,'description'));const facts=make('dl');[['Category',item.category],['Brand',item.brand||'Not specified'],['Model',item.model||'Not specified'],['Condition',item.condition||'Not specified'],['Age',item.age||'Unknown'],['Dimensions',item.dimensions]].forEach(([label,value])=>{if(!value)return;const row=make('div');row.appendChild(make('dt',label));row.appendChild(make('dd',value));facts.appendChild(row);});container.appendChild(facts);if(item.productUrl){const link=make('a','Product reference');link.href=item.productUrl;link.target='_blank';link.rel='noopener noreferrer';container.appendChild(link);}byId('detail').showModal();}function render(){const grid=byId('grid');grid.replaceChildren();const query=byId('search').value.toLocaleLowerCase();const selected=select.value;const items=data.items.filter(item=>(selected==='All categories'||item.category===selected)&&[item.title,item.brand,item.model,item.description,item.category].join(' ').toLocaleLowerCase().includes(query));items.forEach(item=>{const button=make('button',undefined,'card');button.type='button';const image=make('img');image.src=item.images[0];image.alt=item.title;image.loading='lazy';button.appendChild(image);button.appendChild(make('div',item.category,'meta'));button.appendChild(make('h2',item.title));button.appendChild(make('div',price(item.price),'price'));button.appendChild(make('span',statuses[item.status]||'Available','status'));button.addEventListener('click',()=>show(item));grid.appendChild(button);});byId('empty').hidden=items.length>0;}byId('search').addEventListener('input',render);select.addEventListener('change',render);byId('close').addEventListener('click',()=>byId('detail').close());render();})();
</script></body></html>`;
  }
  function slug(value) { return String(value || 'catalogue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'catalogue'; }
  function saveFile(content, type, filename) {
    const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { filename, bytes: blob.size };
  }
  function downloadHtml(catalogue, items) { const html = createHtml(catalogue, items); return saveFile(html, 'text/html;charset=utf-8', 'let-it-go-' + slug(catalogue.title) + '.html'); }
  function downloadProject(catalogue, items) { const bytes = serialise(envelope(catalogue, items, true)); return saveFile(bytes, 'application/json', 'let-it-go-' + slug(catalogue.title) + '-project.json'); }
  async function readProject(file) { if (!file || typeof file.arrayBuffer !== 'function' || file.size > MAX_JSON_BYTES) fail('Choose a Let It Go! project file of 25 MB or less.', 'PAYLOAD_TOO_LARGE'); return parse(new Uint8Array(await file.arrayBuffer())); }
  const api = Object.freeze({ encodeLink, decodeLink, downloadHtml, downloadProject, readProject, createHtml, createProject: (catalogue, items) => serialise(envelope(catalogue, items, true)), limits: Object.freeze({ maxItems: MAX_ITEMS, maxPhotos: MAX_PHOTOS, maxJsonBytes: MAX_JSON_BYTES, maxLinkLength: MAX_LINK_LENGTH }) });
  (typeof window !== 'undefined' ? window : globalThis).LetItGoShare = api;
})();
