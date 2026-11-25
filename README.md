# Let It Go! — GitHub Pages, browser AI and category PDFs

Upload a batch of photos, review suggested product groups/categories/covers, add details and download a PDF for one category or all confirmed items. No accounts, cloud photo storage, subscription or payment details are required for this version.

## Launch on nikita9352.github.io

1. Extract the ZIP. In your public GitHub repository `nikita9352/let-it-go`, upload its contents with `index.html` at the top level. Include the `assets`, `scripts` and `checks` folders. Replace old app files. Old `storage-worker`, `config.js`, `hosted-share.js` and `local-share.js` files are no longer needed and can be deleted.
2. Add the deployment workflow. The ZIP includes `.github/workflows/deploy-pages.yml`. If Finder hides `.github` or the upload skips it, use **Add file → Create new file** on GitHub, name it `.github/workflows/deploy-pages.yml`, and paste the contents of the visible `deploy-pages.yml` file from this ZIP. Commit the file. The root copy is just a convenient template; only the file inside `.github/workflows` runs.
3. In **Settings → Pages → Source**, choose **GitHub Actions**. This replaces the earlier “Deploy from a branch” setup.
4. Open **Actions → Deploy Let It Go → Run workflow**, choose `main` and run. Wait for both build and deploy to turn green. Public repositories can use standard GitHub-hosted runners without purchasing a plan; no provider API keys are required by this workflow.
5. Open **https://nikita9352.github.io/let-it-go/**. Reload after deployment. If the repository has a different name, use the URL shown by GitHub Pages instead.
6. Test with a few photos. The first AI load downloads about154MB of model weights plus about21MB of WASM and the JavaScript/metadata. Keep the tab open. Subsequent browser caching depends on device/browser settings.
7. Review suggested groups, choose a cover, enter any details and confirm. Use **Download PDF** to choose one category or all categories. Attach the PDF in WhatsApp, email or another app yourself.

Uploading only source files and using “Deploy from a branch” will load the page, but will not include its AI model. The workflow above is required for the automatic AI installation. It leaves the previously deployed site unchanged if preparation fails.

There is no Terminal setup for the normal GitHub launch. A custom domain is optional. Use the published HTTPS website, not a double-clicked `index.html` file, for AI.

## Where the AI comes from

- **Model:** CLIP, originally developed by OpenAI, distributed as `Xenova/clip-vit-base-patch32` in browser-compatible ONNX format.
- **Runtime:** Transformers.js3.8.1 with ONNX Runtime Web, q8 quantized inference on the browser CPU/WASM.
- **Hosting:** the GitHub deployment workflow downloads a pinned model revision and the matching runtime. It verifies the exact size and SHA256 of both model weight files, bundles them into the published site, and creates a readiness manifest only on success.
- **Visitor requests:** model files, AI runtime, PDF library and illustrations come from the same GitHub Pages website. The app does not contact Hugging Face/jsDelivr from a visitor's browser and has no remote-model fallback.
- **Photo processing:** happens on the user's device. There is no paid AI API or ChatGPT login. The model is downloaded to the browser; photos are not sent to an AI service.

Pinned model revision: `d15189d7028b43f1d3e65039190477f6af591c2a`.

CLIP compares whole photos with a fixed set of product prompts and with other photos. It suggests categories and visually similar photo groups; it does not establish that two photographs show the same physical item. Similar products can merge, different views may stay separate, and scenes containing several items need manual review. Brand, age, price, authenticity and hidden condition must be supplied or confirmed by the user.

## Phones and multiple visitors

The layout adapts to phone, tablet and desktop widths. Use Choose photos for a gallery batch or Take a photo for the rear-camera picker where supported. JPG/PNG/WebP inputs are resized to a maximum1200px edge before saving. Images are processed sequentially and temporary decoded images/canvases are released after each photo. Device/browser memory can still limit the on-device AI, so begin with a small batch on a phone. If your camera photo uses an unsupported format, export it as JPEG first.

Multiple people can use the app simultaneously: every device has its own photo workspace and runs its own AI/PDF work. There is no shared online catalogue or collaboration session. GitHub Pages bandwidth/rate limits still apply, especially to first-time model downloads. A user will need to move a private backup manually to continue on another device.

Responsive rules and logic are checked here, but real iPhone/Android browser testing remains required after deployment.

## What is saved

Photos and drafts are kept only in this browser's local IndexedDB storage. Browser data clearing, private browsing limits or changing devices can remove access to that local collection. There is no catalogue server or hosted catalogue link.

In **How it works**, optional **Save private backup / Restore private backup** moves your complete working collection as a local JSON file. That backup can contain private items; keep it separate from the PDF you send to others.

Only confirmed, non-private items enter PDFs. A chosen category exports that category; All categories includes all confirmed categories with an internal category index. Item names, descriptions, prices, cover photos and optional product references are included. Download a new PDF after editing details.

No project photos are committed to GitHub. GitHub hosts the public application files and the public model; each visitor's own photo workspace stays on their device.

## If AI cannot load

- **Missing AI files:** choose GitHub Actions in Pages settings and run Deploy Let It Go. Both jobs must finish successfully. The deployed `ai-assets/manifest.json` should be accessible beneath your website URL.
- **Build fails downloading public model files:** open the failed Actions step, check the error and rerun the workflow. No API key/card is required for the included public model. A failed build does not publish incomplete model files.
- **Network/memory error after deployment:** keep the website open, try fewer photos and retry. Save a private backup before reloading if browser saving is unavailable.
- **Stop:** cancels that sorting request promptly. Shared model preparation may finish in the background and can be reused by Retry AI.

You can always review/group photos manually and download a PDF. Manual results are never labelled as AI analysis.

## Validation

Run from the extracted source directory with Node22+ and Python3:

```sh
node checks/ai.test.cjs
node checks/ai-loader.test.cjs
node checks/pdf-only.test.cjs
node checks/mobile.test.cjs
python3 -m unittest discover -s checks -p '*_test.py'
```

For a local build with real assets and internet access:

```sh
python3 scripts/prepare_site.py
```

This produces `_site/`. The workflow publishes only a whitelist of public app/model assets; checks, source scripts and old storage integrations are not published.

The automated tests cover local-only AI configuration, missing-assets errors, model-load retry, cancellation, PDF category selection, confirmation/private filtering and preparation/verification failures. Model downloads in the authoring environment are blocked, so a real browser inference run and the GitHub workflow must still be verified after publication. No live deployment to your GitHub account is claimed here.

## References and attribution

- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- CLIP model: https://huggingface.co/Xenova/clip-vit-base-patch32
- Original CLIP: https://github.com/openai/CLIP
- Transformers.js local assets: https://huggingface.co/docs/transformers.js/v3.8.1/custom_usage
- ONNX Runtime configuration: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- pdf-lib: https://github.com/Hopding/pdf-lib (license retained in the bundled file)

Public model/runtime files retain their upstream notices. The runtime's bundled license files and model README are included by the deployment script. This is a personal-tool prototype; review hosting terms before changing it into a paid service.
