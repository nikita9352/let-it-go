# Launch your updated Let It Go! tool

This version uses GitHub Pages only. People upload photos on their own device, review AI suggestions, and download a category PDF or all confirmed items. There are no user accounts or cloud catalogue/photo uploads.

1. Extract this ZIP. Upload the contents to your public GitHub repository `nikita9352/let-it-go`, with `index.html` at the top level. Include `assets/`, `scripts/` and `checks/`.
2. In GitHub, use **Add file → Create new file**. Set the filename to `.github/workflows/deploy-pages.yml`. Copy the entire contents of the visible `deploy-pages.yml` from the ZIP into it and commit. Skip this step only if that exact workflow file was already uploaded from the ZIP's hidden `.github` folder.
3. Open **Settings → Pages** and choose **GitHub Actions** as the Source.
4. Open **Actions → Deploy Let It Go → Run workflow**, select `main`, and run. Both build and deploy must turn green. This installs the public AI files into the deployed website; visitors download them from GitHub instead of external AI/CDN hosts.
5. Visit https://nikita9352.github.io/let-it-go/ and reload. If your repository uses another name, use the URL shown by GitHub Pages instead.
6. Choose a few photos or take a camera photo. Review and confirm the item details, then use **Download PDF** to choose a category or all categories.

The AI is the CLIP image model, distributed as Xenova/clip-vit-base-patch32 and run in the browser by Transformers.js. First use downloads about154MB of weights plus runtime files. It needs a capable browser and enough memory; start with a small batch on phones.

Multiple people can use the site at once; each browser processes its own collection. GitHub bandwidth limits apply. Phones get a responsive layout, touch controls, a camera option and resized photo processing. Real iPhone/Android testing and a full model run must still be checked after deployment.

If AI reports missing files, check step3 and that the workflow succeeded. PDF creation and manual item editing remain available. Read README.md for details, limitations and the optional private local backup.
