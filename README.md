# Let It Go!

A no-login decluttering tool for a personal GitHub Pages site.

Drop a batch of photos. A browser-based CLIP model suggests product names, categories, which photos may belong to the same item, and a cover photo for each group. Review the suggestions, add details, then export a PDF, a complete HTML catalogue, or a shareable catalogue link.

## What runs without an account or server

- Up to40 photos per workspace, JPG/PNG/WebP up to15MB input each. Images are resized in the browser for storage and inference.
- Real CLIP model integration through pinned Transformers.js3.8.1, using quantized WASM inference. No API key or user login.
- Conservative image-embedding grouping within a matching product label, at most8 photos per item. Groups, categories and thumbnails always need review.
- Thumbnail ranking combines sharpness/exposure/resolution, CLIP whole-product-view ranking and how representative a photo is of its group.
- Merge groups, separate photos, duplicate a photo group for another item, choose a different cover, and correct any suggested detail.
- Only explicitly confirmed, non-private items enter the catalogue or public exports.
- Category/all-items PDFs; complete standalone HTML catalogues with galleries and filters; project backups for continuing on another device.
- Browser-local saving through IndexedDB. No automatic cloud upload of photos.

The model downloads approximately154MB of weights plus runtime files on first use. Code and model files come from jsDelivr and Hugging Face. Inference takes place on the visitor's device; performance and model caching depend on the browser. If loading or inference fails, the app preserves a manually reviewable workspace and never labels that fallback as AI analysis.

## Publish the webpage on your GitHub

1. Create a public repository in your personal GitHub account, for example `let-it-go`.
2. Upload the **contents** of this folder into the repository root. `index.html` must be at the root, with `app.js`, `styles.css`, the other scripts and `assets/` alongside it. Do not upload only the ZIP or nest these files one extra folder down.
3. In repository **Settings → Pages**, choose **Deploy from a branch**, select `main`, and select **/(root)**. Save.
4. Open the Pages URL GitHub provides, usually `https://YOUR-USERNAME.github.io/let-it-go/`.
5. Test photo intake, the first AI download, correcting groups, choosing a cover, saving a backup, and downloading a PDF on your actual desktop/mobile browsers.

There is no build step or dependency installation for the page. All app resource paths are relative so a project subpath works. Do not commit private user photos, catalogue exports, API keys or a storage owner link into the repository. The included sample image sheet is illustrative.

GitHub Pages hosts the static app; it does not execute the optional Worker or provide catalogue storage. GitHub also restricts Pages use for primarily commercial transactions/commercial SaaS. This package is a personal-tool prototype; choose suitable hosting before turning it into a paid service. See the official Pages terms below.

## Short catalogue links — the option you selected

A complete normal-sized photo catalogue needs hosted storage to have a short URL. The no-login storage service is prepared in **`storage-worker/`**, but is not deployed or connected to any account yet.

Follow **`storage-worker/README.md`** to:

1. Create a private R2 bucket in a Cloudflare account you control.
2. Deploy the included Worker with its rate-limit binding.
3. Configure a Turnstile widget for your GitHub Pages hostname and set the secret on the Worker.
4. Set the allowed GitHub Pages origin on the Worker.
5. Put only the public Worker URL and Turnstile **site key** in `config.js`:

```js
window.LET_IT_GO_CONFIG = Object.freeze({
  storageApiUrl: 'https://YOUR-STORAGE-WORKER.YOUR-SUBDOMAIN.workers.dev',
  turnstileSiteKey: 'YOUR-PUBLIC-TURNSTILE-SITE-KEY'
});
```

Never put the Turnstile secret, Cloudflare API token or R2 access key in browser code.

After this setup, a visitor chooses **Export & share → Publish & get a link**. A managed visitor check protects anonymous publishing; this is not a login. Only the selected confirmed items and their photos are uploaded. A short read-only link is returned. A separate owner link contains a private deletion token; anyone with it can remove that shared catalogue, so save it privately and do not forward it with the public link.

Shared snapshots expire after30 days. The service limits40 photos/50 items,1MiB per photo and10MiB total per catalogue. It checks upload ownership, file signatures and publication state, accepts immutable snapshots, and has cleanup plus the required bucket lifecycle rule documented in its setup guide. Free allowances are finite; this is not an unlimited/free-storage guarantee.

The published link uses your GitHub Pages URL with `?catalogue=...`. Opening it requires no account. Updates are separate publications; no automatic updating of an earlier snapshot occurs. Deleting a hosted link does not recall copies already downloaded.

## Other sharing options

- **PDF:** photos, confirmed details and prices; ready to send as an attachment. The PDF uses each item's chosen cover photo.
- **Standalone HTML:** a single file containing all confirmed item photos, filters and galleries. It can be sent as a file, viewed offline or hosted as a static file.
- **Self-contained link:** all data is packed into the fragment, without a storage service. The app deliberately refuses links over12,000 characters; normal photo batches usually exceed this. No image is silently removed. Use hosted sharing, PDF or HTML instead.
- **Project backup:** JSON preserving drafts, confirmed items, photos and chosen covers. Use it to restore work on another device. It may contain private information; store it accordingly.

## Model limits

CLIP classifies whole photos and compares visual similarity. It does not establish that two photos depict the same physical item, prove authenticity, read a reliable serial number, infer an item's age, test its function or independently verify condition. Similar-looking products can merge, and different views can stay separate. A photo of several products is flagged heuristically for review rather than cropped into guaranteed separate objects. Use separate photos for the best automatic results, or duplicate a group and edit the item names manually.

Brand, model, age, product links and hidden condition are left to the owner. Classification scores are relative to the candidate labels, not calibrated probabilities that a product identity is correct.

## Testing status

Dependency-free logic tests cover grouping, thumbnails, confirmation, imports, escaping and share limits. PDF bytes/links and the portable HTML generation were tested. Optional storage tests exercise its protocol with in-memory R2; it has not been deployed to a real personal Cloudflare account.

Actual model weights could not be downloaded in the authoring environment: the CDN request returned HTTP403. Thus **full real-model inference, browser layout and mobile compatibility remain to be verified in your deployed browser**. The code uses the documented projection-model APIs; it includes real inference calls, not a simulated classification result.

Tests included here can be run with Node22 or newer:

```sh
node checks/ai.test.cjs
node checks/local-share.mjs
node storage-worker/worker.test.mjs
```

## References and third-party components

- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Pages terms: https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#pages
- Transformers.js: https://huggingface.co/docs/transformers.js/v3.8.1/index
- Browser model: https://huggingface.co/Xenova/clip-vit-base-patch32
- pdf-lib: https://github.com/Hopding/pdf-lib — its license notice is retained in the bundled file.

The previous Rehome account/subscription/transaction service is not required by this folder and is not part of the GitHub Pages build.
