/* Let It Go! personal catalogues. Only confirmed, public item fields are exported. */
(function () {
  'use strict';
  const LIBRARY_PATH = './pdf-lib.min.js';
  let libraryPromise;
  const clean = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e\n]/g, '');
  const money = value => value === null || value === undefined || value === '' ? 'Ask for price' : Number(value) === 0 ? 'Free' : 'INR ' + Math.max(0, Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const slug = value => String(value || 'all-categories').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'catalogue';
  const categoryIsAll = value => /^(all|all items|all categories|everything)$/i.test(value || 'all');
  function publicRecords(products, category) {
    const selected = Array.isArray(category) ? category.map(String) : null;
    const all = selected ? selected.length === 0 || selected.some(categoryIsAll) : categoryIsAll(category);
    return (Array.isArray(products) ? products : []).filter(p => p && !p.archived && p.approved === true && ['available', 'reserved', 'sold', undefined, null, ''].includes(p.status) && (all || (selected ? selected.includes(String(p.category || 'Other')) : p.category === category))).map(p => ({
      id: String(p.id ?? ''), title: String(p.title || 'Pre-loved find'), category: String(p.category || 'Other'), brand: String(p.brand || ''), model: String(p.model || ''), condition: String(p.condition || 'Not specified'), age: String(p.age || 'Not specified'), productUrl: String(p.productUrl || ''), description: String(p.description || ''), price: p.price === null || p.price === undefined || p.price === '' ? null : Number(p.price), status: ['available', 'reserved', 'sold'].includes(p.status) ? p.status : 'available', dimensions: String(p.dimensions || ''), image: coverImage(p), sprite: Number.isInteger(p.sprite) ? p.sprite : Number.isInteger(p.demoSprite) ? p.demoSprite : undefined
    }));
  }
  function coverImage(item) {
    if (typeof item.image === 'string' && item.image) return item.image;
    if (typeof item.cover === 'string' && item.cover) return item.cover;
    const image = Array.isArray(item.images) ? item.images[0] : null;
    if (typeof image === 'string') return image;
    if (image && typeof image === 'object') return image.dataUrl || image.dataURL || image.url || '';
    return Number.isInteger(item.sprite) || Number.isInteger(item.demoSprite) ? './assets/products.png' : '';
  }
  async function library() {
    if (window.PDFLib) return window.PDFLib;
    if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LIBRARY_PATH;
      script.onload = () => window.PDFLib ? resolve(window.PDFLib) : reject(new Error('PDF library did not load.'));
      script.onerror = () => { libraryPromise = null; reject(new Error('Could not load the PDF library. Please retry while online.')); };
      document.head.appendChild(script);
    });
    return libraryPromise;
  }
  function fitText(text, font, size, width) {
    const original = clean(text).replace(/\s+/g, ' ').trim();
    let result = original;
    while (result.length && font.widthOfTextAtSize(result, size) > width) result = result.slice(0, -1);
    return result !== original ? result.slice(0, -3).trimEnd() + '...' : result;
  }
  function wrap(text, font, size, width, limit = 4) {
    const words = clean(text).replace(/\s+/g, ' ').trim().split(' '), lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const candidate = line ? line + ' ' + words[i] : words[i];
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        lines.push(line); line = words[i];
        if (lines.length === limit - 1) { lines.push(fitText(words.slice(i).join(' '), font, size, width)); return lines; }
      } else line = candidate;
    }
    if (line) lines.push(fitText(line, font, size, width));
    return lines.slice(0, limit);
  }
  function webUrl(value, base) {
    if (!value) return '';
    try { const u = new URL(value, base); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; }
  }
  function whatsappNumber(options) {
    if (options.whatsappEnabled !== true) return '';
    const raw = String(options.whatsapp || '').trim();
    if (!/^\+?[\d\s()-]+$/.test(raw)) return '';
    const digits = raw.replace(/\D/g, '');
    return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
  }
  function whatsappUrl(number, message) { return number ? 'https://wa.me/' + number + '?text=' + encodeURIComponent(message) : ''; }
  async function productImage(pdf, source, sprite) {
    if (!source || typeof fetch === 'undefined') return null;
    try {
      const response = await fetch(source, { signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (blob.size > 12 * 1024 * 1024) return null;
      if (!Number.isInteger(sprite) && blob.type.includes('png')) return await pdf.embedPng(await blob.arrayBuffer());
      if (!Number.isInteger(sprite) && (blob.type.includes('jpeg') || blob.type.includes('jpg'))) return await pdf.embedJpg(await blob.arrayBuffer());
      if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
      const src = URL.createObjectURL(blob);
      try {
        const picture = new Image();
        await new Promise((resolve, reject) => { picture.onload = resolve; picture.onerror = reject; picture.src = src; });
        const canvas = document.createElement('canvas');
        const spriteMode = Number.isInteger(sprite) && sprite >= 0 && sprite < 6;
        const sourceWidth = spriteMode ? picture.width / 3 : picture.width, sourceHeight = spriteMode ? picture.height / 2 : picture.height;
        const ratio = Math.min(1, 800 / Math.max(sourceWidth, sourceHeight));
        canvas.width = Math.max(1, Math.round(sourceWidth * ratio)); canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
        if (spriteMode) canvas.getContext('2d').drawImage(picture, (sprite % 3) * sourceWidth, Math.floor(sprite / 3) * sourceHeight, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        else canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
        return await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.84));
      } finally { URL.revokeObjectURL(src); }
    } catch (_) { return null; }
  }
  async function buildCataloguePdf(products, category = 'All categories', siteUrl = location.origin, options = {}) {
    const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = await library();
    const requested = Array.isArray(category) ? category.join(' + ') || 'All categories' : String(category || 'All categories'), records = publicRecords(products, category);
    if (!records.length) throw new Error('There are no confirmed items in this category to export. Drafts are excluded.');
    const title = String(options.catalogueTitle || options.title || 'My decluttering catalogue'), seller = String(options.sellerName || ''), description = String(options.description || 'Good things, ready for another chapter.');
    const number = whatsappNumber(options), sharedBase = webUrl(options.shareUrl, siteUrl);
    const catalogueContact = whatsappUrl(number, 'Hello' + (seller ? ' ' + seller : '') + ', I saw your Let It Go! catalogue "' + title + '" and would like to ask about an item.');
    const pdf = await PDFDocument.create();
    pdf.setTitle(clean(title) + ' | ' + clean(requested)); pdf.setAuthor(clean(seller || 'Let It Go!')); pdf.setSubject('Let It Go! personal catalogue'); pdf.setCreator('Let It Go! personal catalogue'); pdf.setCreationDate(new Date());
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), serif = await pdf.embedFont(StandardFonts.TimesRoman);
    const C = { cream: rgb(.973, .969, .946), green: rgb(.153, .267, .212), soft: rgb(.89, .92, .863), muted: rgb(.43, .46, .42), line: rgb(.85, .87, .83), white: rgb(1, 1, 1), orange: rgb(.62, .43, .27) };
    const W = 595.28, H = 841.89, M = 42;
    const groups = [...new Set(records.map(p => p.category))].map(name => ({ name, products: records.filter(p => p.category === name), pages: [] }));
    const indexPages = [];
    for (let i = 0; i < groups.length; i += 8) indexPages.push(pdf.addPage([W, H]));
    const imageCache = new Map(), imageKey = product => String(product.image || '') + ':' + String(product.sprite ?? '');
    for (const product of records) { const key = imageKey(product); if (!imageCache.has(key)) imageCache.set(key, productImage(pdf, product.image, product.sprite)); }
    const draw = (page, value, x, y, size = 11, face = font, color = C.green) => page.drawText(clean(value), { x, y, size, font: face, color });
    const background = page => page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.cream });
    const link = (page, rect, uri) => {
      if (!uri) return;
      const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: PDFName.of('URI'), URI: PDFString.of(uri) } });
      page.node.addAnnot(pdf.context.register(annotation));
    };
    const goto = (page, rect, destination) => {
      const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: PDFName.of('GoTo'), D: [destination.ref, PDFName.of('Fit')] } });
      page.node.addAnnot(pdf.context.register(annotation));
    };
    const itemUrl = item => { if (!sharedBase) return ''; const u = new URL(sharedBase); if (!u.hash) u.hash = 'item=' + encodeURIComponent(item.id); return u.href; };
    for (const group of groups) {
      for (let offset = 0; offset < group.products.length; offset += 4) {
        const page = pdf.addPage([W, H]); group.pages.push(page); background(page);
        draw(page, 'Let It Go!', M, H - 53, 27, serif);
        draw(page, fitText(title, font, 9, 300), M + 155, H - 47, 9, font, C.muted);
        draw(page, fitText(group.name, bold, 13, 285), M, H - 91, 13, bold);
        draw(page, 'A PERSONAL CATALOGUE. READY TO PASS ALONG.', M, H - 109, 8, font, C.muted);
        const subset = group.products.slice(offset, offset + 4);
        for (let i = 0; i < subset.length; i++) {
          const item = subset[i], col = i % 2, row = Math.floor(i / 2), x = M + col * 264, top = H - 133 - row * 316, width = 247, height = 298;
          page.drawRectangle({ x, y: top - height, width, height, color: C.white, borderColor: C.line, borderWidth: .6 });
          page.drawRectangle({ x: x + 10, y: top - 130, width: width - 20, height: 120, color: C.soft });
          const picture = await imageCache.get(imageKey(item));
          if (picture) {
            const scale = Math.min((width - 20) / picture.width, 120 / picture.height);
            page.drawImage(picture, { x: x + width / 2 - picture.width * scale / 2, y: top - 130 + (120 - picture.height * scale) / 2, width: picture.width * scale, height: picture.height * scale });
          } else draw(page, 'A little more possibility.', x + 28, top - 74, 13, serif, C.green);
          const itemTitle = wrap(item.title, bold, 11, width - 26, 2);
          itemTitle.forEach((line, n) => draw(page, line, x + 13, top - 148 - n * 13, 11, bold));
          const status = item.status === 'available' ? 'AVAILABLE' : item.status.toUpperCase();
          draw(page, status, x + 13, top - 180, 8, bold, item.status === 'available' ? C.green : C.orange);
          draw(page, fitText([item.brand, item.model].filter(Boolean).join(' / ') || 'Brand not specified', font, 9, width - 26), x + 13, top - 195, 9, font, C.muted);
          draw(page, fitText(item.condition + ' / Age: ' + item.age, font, 9, width - 26), x + 13, top - 208, 9, font, C.muted);
          const itemDescription = wrap(item.description || (item.dimensions ? 'Size: ' + item.dimensions : 'Ask the owner for more details.'), font, 9, width - 26, 2);
          itemDescription.forEach((line, n) => draw(page, line, x + 13, top - 224 - n * 12, 9, font, C.muted));
          draw(page, money(item.price), x + 13, top - 259, 14, bold);
          const liveLink = itemUrl(item), chatLink = whatsappUrl(number, 'Hello' + (seller ? ' ' + seller : '') + ', is "' + item.title + '" from your Let It Go! catalogue still available?' + (liveLink ? ' ' + liveLink : ''));
          if (liveLink) { draw(page, 'View item online >', x + 13, top - 281, 9, bold); link(page, [x + 10, top - 287, x + 122, top - 269], liveLink); }
          if (chatLink) { draw(page, 'WhatsApp owner >', x + (liveLink ? 131 : 13), top - 281, 9, bold); link(page, [x + (liveLink ? 128 : 10), top - 287, x + width - 10, top - 269], chatLink); }
          else if (!liveLink) draw(page, 'Offline catalogue snapshot', x + 13, top - 281, 9, font, C.muted);
          const productLink = webUrl(item.productUrl, siteUrl);
          if (productLink && /^https:\/\//i.test(productLink)) { draw(page, 'Product reference >', x + 137, top - 259, 7, font, C.muted); link(page, [x + 133, top - 264, x + width - 10, top - 250], productLink); }
        }
        draw(page, 'Details confirmed by the owner. Availability may change after export.', M, 76, 8, font, C.muted);
        draw(page, '< Back to categories', M, 48, 9, bold);
        goto(page, [M - 2, 43, M + 120, 62], indexPages[Math.floor(groups.indexOf(group) / 8)]);
      }
    }
    indexPages.forEach((page, index) => {
      background(page);
      draw(page, 'Let It Go!', M, H - 66, 36, serif);
      page.drawRectangle({ x: M, y: H - 94, width: W - M * 2, height: 1, color: C.line });
      const titleLines = wrap(title, serif, 29, W - M * 2, 2);
      titleLines.forEach((line, n) => draw(page, line, M, H - 146 - n * 35, 29, serif));
      draw(page, fitText(seller ? 'Curated by ' + seller : 'A personal decluttering catalogue', font, 11, W - M * 2), M, H - 218, 11, font, C.muted);
      draw(page, fitText(description, font, 10, W - M * 2), M, H - 239, 10, font, C.muted);
      draw(page, clean(requested) + ' / ' + records.length + ' confirmed items', M, H - 264, 11, bold);
      draw(page, 'Exported ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), M, H - 285, 8, font, C.muted);
      if (catalogueContact) { draw(page, 'Ask ' + (seller ? fitText(seller, bold, 9, 130) : 'the owner') + ' on WhatsApp >', M, H - 310, 9, bold); link(page, [M - 2, H - 316, M + 260, H - 299], catalogueContact); }
      else if (sharedBase) { draw(page, 'Open the live catalogue >', M, H - 310, 9, bold); link(page, [M - 2, H - 316, M + 190, H - 299], sharedBase); }
      draw(page, 'EXPLORE THE CATEGORIES', M, H - 351, 9, bold, C.muted);
      groups.slice(index * 8, index * 8 + 8).forEach((group, i) => {
        const y = H - 384 - i * 34;
        draw(page, fitText(group.name, font, 12, 360), M, y, 12);
        draw(page, group.products.length + ' items   >', W - M - 79, y, 9, bold);
        page.drawLine({ start: { x: M, y: y - 11 }, end: { x: W - M, y: y - 11 }, thickness: .6, color: C.line });
        goto(page, [M, y - 12, W - M, y + 16], group.pages[0]);
      });
      draw(page, 'Keep the good things moving.', M, 154, 11, bold);
      const note = 'This PDF is a snapshot of the owner-confirmed catalogue. Availability can change. Photos, prices and details remain readable offline; links and WhatsApp need internet access. Arrange any purchase, collection or delivery directly with the owner. No payment is taken through this catalogue.';
      wrap(note, font, 9, W - M * 2, 5).forEach((line, n) => draw(page, line, M, 134 - n * 13, 9, font, C.muted));
    });
    const pages = pdf.getPages();
    pages.forEach((page, i) => { draw(page, 'Let It Go! / personal catalogue', M, 25, 8, font, C.muted); draw(page, (i + 1) + ' / ' + pages.length, W - M - 33, 25, 8, font, C.muted); });
    return await pdf.save();
  }
  async function createCatalogueFile(products, category = 'All categories', siteUrl = location.origin, options = {}) {
    const bytes = await buildCataloguePdf(products, category, siteUrl, options);
    return new File([bytes], 'let-it-go-' + slug(category) + '-catalogue.pdf', { type: 'application/pdf' });
  }
  async function downloadCatalogue(products, category = 'All categories', siteUrl = location.origin, options = {}) {
    const bytes = await buildCataloguePdf(products, category, siteUrl, options);
    const blob = new Blob([bytes], { type: 'application/pdf' }), filename = 'let-it-go-' + slug(category) + '-catalogue.pdf';
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { filename, count: publicRecords(products, category).length, bytes: bytes.length };
  }
  function baseUrl(options) {
    return options.baseUrl || (typeof location !== 'undefined' ? location.href || location.origin : 'https://example.invalid/');
  }
  window.LetItGoPdf = {
    build(items, category = 'All categories', options = {}) { return buildCataloguePdf(items, category, baseUrl(options), options); },
    download(items, category = 'All categories', options = {}) { return downloadCatalogue(items, category, baseUrl(options), options); },
    file(items, category = 'All categories', options = {}) { return createCatalogueFile(items, category, baseUrl(options), options); }
  };
})();
