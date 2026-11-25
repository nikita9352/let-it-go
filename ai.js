/* Let It Go! Local image suggestions. Model files download; selected photos stay in the browser. */
(function (global) {
  'use strict';
  const TRANSFORMERS_VERSION = '3.8.1';
  const assetBase = new URL('./ai-assets/', typeof document !== 'undefined' ? document.baseURI : 'https://localhost/');
  const MODEL_ID = 'Xenova/clip-vit-base-patch32';
  const MODEL_REVISION = 'd15189d7028b43f1d3e65039190477f6af591c2a';
  const MODEL_INFO = Object.freeze({ id: MODEL_ID, library: 'Transformers.js 3.8.1', dtype: 'q8', device: 'wasm', approximateWeightDownloadMB: 154, source: 'this-website', identityVerification: false });
  const INVENTORY = {
    Furniture: ['Armchair','Dining chair','Office chair','Stool','Sofa','Dining table','Coffee table','Side table','Desk','Bookshelf','Wardrobe','Chest of drawers','Bed frame','Mattress','Shoe rack','TV stand','Bench','Folding table'],
    Electronics: ['Laptop','Mobile phone','Tablet','Computer monitor','Keyboard','Computer mouse','Headphones','Earphones','Speaker','Camera','Camera lens','Television','Game console','Wi-Fi router','Printer','Projector','Smartwatch','Power bank','Phone charger','Electrical cable','Remote control','Hair dryer','Electric fan','Vacuum cleaner','Iron','Air purifier'],
    'Home & living': ['Table lamp','Floor lamp','Ceiling light','Mirror','Wall clock','Picture frame','Artwork','Vase','Plant pot','Houseplant','Cushion','Blanket','Rug','Curtain','Bedsheet','Pillow','Laundry basket','Storage basket','Storage box','Suitcase','Candle holder','Decorative figurine','Coat hanger'],
    Kitchen: ['Coffee machine','Electric kettle','Toaster','Blender','Food processor','Rice cooker','Microwave oven','Air fryer','Refrigerator','Cooking pot','Frying pan','Pressure cooker','Dinner plate','Bowl','Mug','Drinking glass','Cutlery set','Water bottle','Lunch box','Serving tray','Chopping board','Kitchen utensil','Baking tin'],
    Fashion: ['Shirt','T-shirt','Dress','Jacket','Coat','Trousers','Jeans','Skirt','Sweater','Scarf','Handbag','Backpack','Wallet','Shoes','Trainers','Sandals','Boots','Wristwatch','Sunglasses','Necklace','Hat','Belt'],
    Books: ['Hardcover book','Paperback book','Textbook','Magazine','Notebook','Set of books'],
    'Sports & outdoors': ['Bicycle','Exercise bike','Treadmill','Yoga mat','Dumbbell','Tennis racket','Badminton racket','Football','Basketball','Cricket bat','Camping tent','Sleeping bag','Helmet','Skateboard','Roller skates','Outdoor folding chair','Hiking backpack'],
    'Toys & games': ['Teddy bear','Doll','Toy car','Building blocks','Board game','Jigsaw puzzle','Baby stroller','Baby high chair','Baby cot','Musical toy'],
    Tools: ['Electric drill','Hammer','Screwdriver','Spanner','Toolbox','Ladder','Sewing machine','Gardening tools'],
    Other: ['Guitar','Electronic keyboard instrument','Painting supplies','Craft supplies','Stationery','Pet carrier','Pet bed'],
  };
  const LABELS = Object.entries(INVENTORY).flatMap(([category, labels]) => labels.map(title => ({ label: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, category, prompt: `a photo of a ${title.toLowerCase()}` })));
  const MIXED = { label: 'mixed-collection', title: 'Several items in one photo', category: 'Other', prompt: 'a photo of several different household objects, a mixed collection of products or a cluttered room' };
  const UNKNOWN = { label: 'unknown-item', title: 'Item to review', category: 'Other', prompt: 'an unrecognisable object, a document, an empty scene, a person or something that is not a product' };
  const CANDIDATES = [...LABELS, MIXED, UNKNOWN];
  const VIEW_PROMPTS = ['a clear complete view of one product, fully visible and centered', 'a close-up photograph of a small detail or label on a product', 'a dark, blurry, obstructed or poorly framed photograph of an object'];
  let enginePromise = null, loadAttempt = 0, lastProgress = null;
  const progressListeners = new Set();
  function reportProgress(value) {
    lastProgress = value;
    for (const listener of progressListeners) { try { listener(value); } catch {} }
  }
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : lo));
  function abortError() { const error = new Error('Photo analysis was cancelled.'); error.name = 'AbortError'; error.code = 'ANALYSIS_CANCELLED'; return error; }
  function checkSignal(signal) { if (signal?.aborted) throw abortError(); }
  function normalise(vector) {
    const values = Array.from(vector || [], Number);
    if (!values.length || values.some(v => !Number.isFinite(v))) return [];
    const norm = Math.hypot(...values);
    return norm > 0 ? values.map(v => v / norm) : [];
  }
  function cosine(a, b) {
    if (!a?.length || a.length !== b?.length) return -1;
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return -1; dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return aa && bb ? clamp(dot / Math.sqrt(aa * bb), -1, 1) : -1;
  }
  function softmax(values, scale = 30) {
    const max = Math.max(...values), exps = values.map(v => Math.exp((v - max) * scale)), total = exps.reduce((a, b) => a + b, 0);
    return exps.map(v => total ? v / total : 0);
  }
  function classifyEmbedding(embedding, candidateVectors) {
    if (!embedding?.length || candidateVectors.length !== CANDIDATES.length) throw new Error('The image model returned incompatible embeddings.');
    const scores = candidateVectors.map(v => cosine(embedding, v));
    const probabilities = softmax(scores);
    const ranked = scores.map((score, index) => ({ ...CANDIDATES[index], score, confidence: probabilities[index] })).sort((a, b) => b.score - a.score);
    const top = ranked[0], runnerUp = ranked[1], mixed = ranked.find(r => r.label === MIXED.label);
    const multipleItemsPossible = top.label === MIXED.label || (mixed.score >= top.score - .025 && mixed.score > .16);
    const ambiguous = top.label === UNKNOWN.label || top.score < .16 || (top.category !== runnerUp.category && top.score - runnerUp.score < .012);
    const label = multipleItemsPossible ? MIXED : ambiguous ? UNKNOWN : top;
    return { label: label.label, titleSuggested: label.title, category: label.category, confidence: clamp(top.confidence), cosineScore: top.score, margin: top.score - runnerUp.score, confidenceType: 'relative-candidate-ranking', multipleItemsPossible, needsReview: true, alternatives: ranked.slice(0, 3).map(r => ({ label: r.label, title: r.title, category: r.category, score: r.score })) };
  }
  function qualityScore(photo) {
    if (typeof photo.quality === 'number') return clamp(photo.quality);
    if (Number.isFinite(photo.quality?.score)) return clamp(photo.quality.score);
    const width = Math.max(0, Number(photo.width) || 0), height = Math.max(0, Number(photo.height) || 0);
    return width && height ? clamp(Math.sqrt(width * height) / 1400) * .6 : .3;
  }
  function thumbnailRanking(photos) {
    if (!photos.length) return [];
    const dimension = photos.find(p => p.embedding?.length)?.embedding.length || 0;
    const centroid = dimension ? normalise(Array.from({ length: dimension }, (_, i) => photos.reduce((sum, p) => sum + (p.embedding?.[i] || 0), 0) / photos.length)) : [];
    return photos.map((p, index) => {
      const quality = qualityScore(p), fullView = Number.isFinite(p.viewScore) ? clamp(p.viewScore) : .5;
      const representative = centroid.length && p.embedding?.length ? clamp((cosine(p.embedding, centroid) + 1) / 2) : .5;
      return { id: p.id, index, score: quality * .5 + fullView * .35 + representative * .15, quality, fullView, representative };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
  }
  function chooseThumbnail(photos) { return thumbnailRanking(photos || [])[0]?.id || null; }
  function clusterPhotos(photos, options = {}) {
    const threshold = clamp(options.threshold ?? .9, .8, .995), maxPhotos = Math.max(1, Math.min(8, Number(options.maxPhotosPerItem) || 8));
    const groups = [];
    for (const photo of photos || []) {
      const mergeable = !!photo.embedding?.length && photo.label && !['unknown-item', 'mixed-collection'].includes(photo.label) && !photo.multipleItemsPossible;
      let best = null, bestMinimum = -1;
      if (mergeable) for (const group of groups) {
        if (group.photos.length >= maxPhotos || group.photos.some(p => p.label !== photo.label || p.category !== photo.category || p.multipleItemsPossible)) continue;
        const minimum = Math.min(...group.photos.map(p => cosine(photo.embedding, p.embedding)));
        if (minimum >= threshold && minimum > bestMinimum) { best = group; bestMinimum = minimum; }
      }
      if (best) best.photos.push(photo); else groups.push({ photos: [photo] });
    }
    return groups.map((group, index) => {
      const first = group.photos[0], photoIds = group.photos.map(p => p.id), thumbnailId = chooseThumbnail(group.photos);
      const pairwise = [];
      for (let i = 0; i < group.photos.length; i++) for (let j = i + 1; j < group.photos.length; j++) pairwise.push(cosine(group.photos[i].embedding, group.photos[j].embedding));
      return { id: `suggested-${index + 1}-${String(first.id)}`, photoIds, title: first.titleSuggested || 'Item to review', category: first.category || 'Other', thumbnailId, similarity: pairwise.length ? Math.min(...pairwise) : null, needsReview: true, confirmed: false, multipleItemsPossible: group.photos.some(p => p.multipleItemsPossible), thumbnailReason: 'Suggested using clarity, a complete-view image ranking and how representative the photo is of this group. You can change it.' };
    });
  }
  function disposeTensors(container) { if (!container || typeof container !== 'object') return; for (const value of Object.values(container)) if (value && typeof value.dispose === 'function') { try { value.dispose(); } catch {} } }
  async function checkAssets() {
    const setupMessage = 'The AI files are missing or incomplete on this website. In GitHub Settings → Pages, select GitHub Actions, then run the included Deploy Let It Go workflow. Downloading the ZIP alone does not install the model.';
    if (assetBase.protocol !== 'https:' && assetBase.hostname !== 'localhost' && assetBase.hostname !== '127.0.0.1') {
      const error = new Error('Open the published HTTPS GitHub Pages website to use AI. Opening index.html directly from a downloaded folder cannot load the model.');
      error.code = 'AI_ASSETS_MISSING'; throw error;
    }
    let response;
    try { response = await fetch(new URL('manifest.json', assetBase).href, { cache: 'no-cache', credentials: 'same-origin' }); }
    catch { throw new Error('The AI files on this website could not be reached. Check your connection and reload the published page.'); }
    if (!response.ok) { const error = new Error(setupMessage); error.code = 'AI_ASSETS_MISSING'; throw error; }
    let manifest;
    try { manifest = await response.json(); } catch { const error = new Error(setupMessage); error.code = 'AI_ASSETS_MISSING'; throw error; }
    if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1 || manifest.modelId !== MODEL_ID || manifest.modelRevision !== MODEL_REVISION || manifest.transformersVersion !== TRANSFORMERS_VERSION) {
      const error = new Error(setupMessage); error.code = 'AI_ASSETS_MISSING'; throw error;
    }
    return manifest;
  }
  function warmEngine() {
    if (enginePromise) return enginePromise;
    let step = 'checking the AI files';
    enginePromise = (async () => {
      reportProgress({ stage: 'loading', message: 'Checking the AI files on this website…' });
      await checkAssets();
      step = 'loading the AI program';
      reportProgress({ stage: 'loading', message: 'Loading the browser AI from this website…' });
      const libraryUrl = new URL('runtime/transformers.min.js', assetBase);
      libraryUrl.searchParams.set('v', TRANSFORMERS_VERSION);
      libraryUrl.searchParams.set('attempt', String(++loadAttempt));
      const transformers = await import(libraryUrl.href);
      transformers.env.allowLocalModels = true;
      transformers.env.allowRemoteModels = false;
      transformers.env.localModelPath = new URL('models/', assetBase).href;
      transformers.env.backends.onnx.wasm.wasmPaths = new URL('runtime/', assetBase).href;
      transformers.env.backends.onnx.wasm.numThreads = 1;
      transformers.env.backends.onnx.wasm.proxy = false;
      const progress_callback = event => reportProgress({ stage: 'downloading', message: event.file ? `Downloading AI file ${event.file.split('/').pop()} from this website…` : 'Preparing the local image model…', progress: Number.isFinite(event.progress) ? clamp(event.progress, 0, 100) : undefined });
      const options = { dtype: 'q8', device: 'wasm', progress_callback };
      step = 'loading the label settings';
      const tokenizer = await transformers.AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
      step = 'loading the photo settings';
      const processor = await transformers.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
      step = 'downloading the label model';
      const textModel = await transformers.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, options);
      const prompts = [...CANDIDATES.map(c => c.prompt), ...VIEW_PROMPTS];
      const vectors = [], textBatchSize = 16;
      try {
        step = 'preparing item labels';
        for (let offset = 0; offset < prompts.length; offset += textBatchSize) {
          const batch = prompts.slice(offset, offset + textBatchSize);
          reportProgress({ stage: 'loading', message: `Preparing item labels ${offset + 1}–${offset + batch.length} of ${prompts.length}…`, progress: offset / prompts.length * 100 });
          let tokens, textOutput;
          try {
            tokens = tokenizer(batch, { padding: true, truncation: true });
            textOutput = await textModel(tokens);
            const tensor = textOutput.text_embeds;
            if (!tensor || tensor.dims?.[1] !== 512 || tensor.dims[0] !== batch.length) throw new Error('Unexpected text embedding dimensions.');
            for (let i = 0; i < tensor.dims[0]; i++) vectors.push(normalise(Array.from(tensor.data.slice(i * 512, (i + 1) * 512))));
          } finally { disposeTensors(tokens); disposeTensors(textOutput); }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } finally { await textModel.dispose(); }
      step = 'downloading the image model';
      const visionModel = await transformers.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, options);
      return { processor, visionModel, RawImage: transformers.RawImage, vectors: vectors.slice(0, CANDIDATES.length), viewVectors: vectors.slice(CANDIDATES.length) };
    })().catch(error => {
      enginePromise = null;
      if (error.code === 'AI_ASSETS_MISSING') throw error;
      const wrapped = new Error(`The browser AI could not load while ${step}. ${error.message || ''} Check your connection and try again. If this continues, download a project backup before reloading, or continue editing manually.`);
      wrapped.code = 'MODEL_UNAVAILABLE'; throw wrapped;
    });
    return enginePromise;
  }
  async function loadEngine(onProgress, signal) {
    checkSignal(signal);
    const listener = value => { if (!signal?.aborted) onProgress?.(value); };
    progressListeners.add(listener);
    if (lastProgress) listener(lastProgress);
    let abort;
    try {
      const pending = warmEngine();
      if (!signal) return await pending;
      return await Promise.race([pending, new Promise((_, reject) => {
        abort = () => reject(abortError());
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })]);
    } finally {
      progressListeners.delete(listener);
      if (abort) signal.removeEventListener('abort', abort);
    }
  }
  async function analysePhotos(photos, onProgress, options = {}) {
    checkSignal(options.signal);
    if (!Array.isArray(photos) || !photos.length) return { photos: [], groups: [], model: MODEL_INFO };
    if (photos.some(p => !p || !p.id || typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/'))) throw new Error('Provide valid local photo data before analysing.');
    const engine = await loadEngine(onProgress, options.signal);
    checkSignal(options.signal);
    const analysed = [];
    for (let index = 0; index < photos.length; index++) {
      checkSignal(options.signal);
      const photo = photos[index];
      onProgress?.({ stage: 'analysing', message: `Sorting photo ${index + 1} of ${photos.length}…`, current: index + 1, total: photos.length, progress: index / photos.length * 100 });
      let inputs, output;
      try {
        const image = await engine.RawImage.read(photo.dataUrl);
        inputs = await engine.processor(image);
        output = await engine.visionModel(inputs);
        const tensor = output.image_embeds;
        if (!tensor || tensor.dims?.[1] !== 512) throw new Error('Unexpected image embedding dimensions.');
        const embedding = normalise(Array.from(tensor.data.slice(0, 512)));
        const classification = classifyEmbedding(embedding, engine.vectors);
        const views = softmax(engine.viewVectors.map(v => cosine(embedding, v)), 20);
        analysed.push({ ...photo, embedding, ...classification, viewScore: views[0], viewConfidence: views[0], model: MODEL_ID });
      } catch (error) {
        const wrapped = new Error(`Photo ${index + 1} could not be analysed. ${error.message || ''}`); wrapped.code = 'INFERENCE_FAILED'; throw wrapped;
      } finally { disposeTensors(inputs); disposeTensors(output); }
      checkSignal(options.signal);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const groups = clusterPhotos(analysed, options);
    onProgress?.({ stage: 'analysing', message: `${analysed.length} photos organised into ${groups.length} suggested items. Please review the groups and thumbnails.`, current: photos.length, total: photos.length, progress: 100 });
    return { photos: analysed, groups, model: MODEL_INFO };
  }
  global.LetItGoAI = Object.freeze({ analysePhotos, clusterPhotos, chooseThumbnail, thumbnailRanking, normalise, cosine, classifyEmbedding, candidates: CANDIDATES.map(c => ({ ...c })), model: MODEL_INFO });
})(typeof window !== 'undefined' ? window : globalThis);
