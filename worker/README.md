# ShiftPro Smart Assistant — secure backend setup

The ShiftPro frontend is hosted as a static GitHub Pages PWA. GitHub Pages cannot run a private server or keep an AI key secret, so the assistant API is scaffolded as a Cloudflare Worker.

## Security rules

- **Never** put `CODECRAFT_API_KEY` in `index.html`, JavaScript, CSS, GitHub Pages variables exposed to the browser, or any committed file.
- The Worker reads the CodeCraft API key from a Cloudflare secret.
- Requests are limited to the `/api/assistant` endpoint, accept only POST/OPTIONS, validate the configured Origin, and limit messages to 2,000 characters.
- The current version is **conversation-only**. It cannot access the app's local data or execute tasks. Do not describe it as task execution until an explicit allow-listed action layer with confirmation and tests has been implemented.
- Before public launch, configure CodeCraft API usage limits and add a durable rate limiter / abuse protection for the Worker.

## Deploy

1. Install Node.js and Wrangler, then authenticate with Cloudflare:
   `npm install -g wrangler`
   `wrangler login`
2. From this folder, configure `ALLOWED_ORIGIN` in `wrangler.toml` to the exact origin of the deployed ShiftPro site. Do not add a trailing slash. For a GitHub Pages project site, the origin is typically `https://anamiir2-collab.github.io`.
3. Add the API key as a Cloudflare Worker secret (run from this folder):
   `wrangler secret put CODECRAFT_API_KEY`
   Paste the key only into Wrangler's interactive prompt. Never commit it.
4. Deploy:
   `wrangler deploy`
5. Copy the deployed Worker URL, e.g. `https://shiftpro-smart-assistant.<your-subdomain>.workers.dev/api/assistant`.
6. In `js/ai-assistant.js`, replace `https://YOUR-WORKER.workers.dev/api/assistant` with that URL, then commit and publish the frontend.

## Current limitations

- The AI connection stays disabled until deployment and URL configuration are complete.
- The assistant receives only the typed message and selected locale; it does not receive salary, attendance, employee details, or wallet data.
- The current system prompt explicitly prohibits claiming to perform actions.
- To enable actions later, add a strict schema of supported actions, validate every field on the client, show a preview, request explicit confirmation for sensitive actions, then call existing ShiftPro modules. Never let model-generated JavaScript run in the browser.
