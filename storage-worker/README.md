# Optional no-login catalogue storage

This Worker turns a confirmed Let It Go! collection into a short, unlisted web link. Visitors do not create accounts. Photos are uploaded only after the owner explicitly chooses to share.

The GitHub Pages app remains the frontend. This service runs separately in **your own Cloudflare account** with one private R2 bucket, a managed Turnstile widget and the Workers Rate Limiting binding. Nothing here has been deployed or connected to an account automatically.

## Setup

1. Create a Cloudflare account. Activate R2 and create a private bucket named `let-it-go-catalogues`. Do not enable a public bucket URL.
2. Create a Turnstile widget for your actual GitHub Pages hostname, such as `your-name.github.io`. Keep the site key for the frontend; keep the secret key private.
3. Edit `wrangler.toml`: replace `ALLOWED_ORIGINS` with the exact HTTPS frontend origin (scheme + hostname, no repository path or trailing slash). Multiple origins can be comma-separated. Use a rate-limit namespace ID that is not already used by an unrelated Worker on your account.
4. Install a current Node.js runtime. From this folder, use the supported Cloudflare CLI:

   ```sh
   npx wrangler login
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler deploy
   ```

   The secret prompt is where you enter the Turnstile secret. It must never go in GitHub, `config.js`, a URL or browser JavaScript. Wrangler4.36.0 or later is required for the rate-limit binding.
5. Note the deployed Worker URL. In the frontend's `config.js`, set:

   ```js
   window.LET_IT_GO_CONFIG = {
     storageApiUrl: 'https://let-it-go-catalogues.YOUR-SUBDOMAIN.workers.dev',
     turnstileSiteKey: 'YOUR-PUBLIC-TURNSTILE-SITE-KEY'
   };
   ```

6. In the R2 bucket's settings, add an **object lifecycle** rule that deletes objects with prefix `catalogues/` after31days. The Worker also hides records after30days and runs a daily cleanup; the lifecycle rule provides cleanup if the Worker is paused. Keep the `_maintenance/` prefix outside that rule.
7. Deploy the frontend to GitHub Pages. Test a real Turnstile challenge, upload, public link and owner-link deletion before inviting other users. Local tests use mocks and do not verify your Cloudflare account configuration.

## Data flow

- Browser sends a small catalogue manifest and Turnstile token to `POST /v1/catalogues`.
- Server validates Turnstile with Cloudflare, checks its action/hostname, applies an approximate per-IP creation limit, and creates an unpublished record.
- The response contains `id`, `ownerToken`, `expiresAt` and `uploadExpiresAt`. Keep the owner token only on the owner's device or in the fragment of their private management link.
- Browser uploads each resized photo as its own binary request with the owner bearer token.
- Browser publishes only after every declared photo is present.
- Visitors use the GitHub Pages catalogue URL. The frontend reads the public manifest and image URLs from this Worker.
- The owner can delete the record and photos using their private owner link. Losing that link means there is no account-based recovery; the share expires automatically.

## API contract

### Create

`POST /v1/catalogues`, JSON:

```json
{
  "catalogue": {"title":"My catalogue","ownerName":"Asha","description":"Ready for another beginning."},
  "items": [{"id":"item-1","title":"Chair","category":"Furniture","condition":"Gently used","description":"A wooden chair.","price":1000,"status":"available","approved":true,"photoIds":["photo-1"],"thumbnailId":"photo-1"}],
  "photos": [{"id":"photo-1","type":"image/jpeg","size":123456,"width":1000,"height":800}],
  "turnstileToken":"VISITOR-CHALLENGE-TOKEN"
}
```

Returns201 `{id, ownerToken, expiresAt, uploadExpiresAt}`. Catalogue IDs are32lowercase hex characters; owner tokens are64lowercase hex characters. Item/photo IDs allow1–80letters, digits, `_` and `-`.

### Upload, publish and delete

All mutations require an allowed `Origin`. Owner operations additionally require `Authorization: Bearer OWNER_TOKEN`.

- `PUT /v1/catalogues/:id/photos/:photoId`: binary JPG/PNG/WebP body and matching `Content-Type`. Response JSON `{uploaded:true,id}`. Exact same-photo retries are allowed; replacing an uploaded photo requires a new share.
- `POST /v1/catalogues/:id/publish`: response JSON `{id,published:true,expiresAt}`.
- `DELETE /v1/catalogues/:id`: response JSON `{deleted:true}`. Record deletion revokes the catalogue first; photo deletion follows.

Uploading and publishing are allowed for60minutes after creation. Public reads expire after30days. Published shares are snapshots; create a new share for updates.

### Public reads

- `GET /v1/catalogues/:id`: `{catalogue,items,photos:[{id,dataUrl:ABSOLUTE_IMAGE_URL,width,height}],expiresAt}`. `items` retain `photoIds` and `thumbnailId`; only public display fields are returned.
- `GET /v1/catalogues/:id/photos/:photoId`: binary photo, only while its catalogue is published and unexpired.

No endpoint lists catalogues. Random unlisted links are **not access-controlled privacy**: anyone who receives a link can forward it, save images or export a copy. Deletion cannot recall those copies.

## Limits and protection

- Maximum50confirmed items and40unique photos per catalogue.
- Maximum8photos per item,1MiB per photo and10MiB total declared photo bytes.
- Only explicitly approved, non-private items and their referenced photos are accepted.
- Image type, signature, exact byte length and ownership token are checked. HTML and SVG uploads are rejected.
- Every new catalogue requires server-side Turnstile verification. The widget action must be `publish_catalogue`, and the verified hostname must match the allowed frontend origin.
- Default creation limit:5catalogues per minute per source IP, applied by Cloudflare's approximate per-location limiter. This is mitigation, not a global usage or spending guarantee.
- CORS is restricted to your configured frontend origins. It is not a substitute for the private owner bearer token.
- Private owner tokens are stored only as SHA-256 digests in the private record. Public responses never contain the token or its digest.
- Reads use `Cache-Control: no-store` so browser/API caches are not deliberately kept after deletion. Someone who already downloaded a photo still has their copy.

R2 and Workers allowances are finite. These per-catalogue controls do not guarantee a zero bill or prevent all abuse. Monitor usage and set account alerts; review the service before a broad public launch.

## Tests

```sh
node worker.test.mjs
```

Tests cover validation, origin protection, required Turnstile/rate binding, private draft uploads, token checks, upload retries, immutable photos, publication, public-field projection, deletion and expiry using mocked R2/Turnstile services. No live deployment or browser integration test is claimed.

Official references:

- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Workers rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
