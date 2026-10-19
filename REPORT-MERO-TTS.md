# Final Report — Mero Local Neural TTS (ShiftPro)

Deliverable for: https://github.com/anamiir2-collab/SHIFTPRO22/
Branch: `feature/mero-local-neural-tts` @ commit `4fd9c3e`

---

## 1. Branch & PR URL

- **Branch worked on:** `feature/mero-local-neural-tts` (the pre-existing remote feature branch was checked out and extended — no duplicate branch created, per the task rules).
- **Final commit:** `4fd9c3e` — *"Harden Mero local neural TTS: piper API, real tests, honest fallback"* (1 unpushed commit ahead of `origin/feature/mero-local-neural-tts`).
- **PR URL:** none exists yet. The sandbox has no GitHub push credentials, so the commit could not be pushed. The branch **was not pushed, not merged, and no release was made**. To publish: apply `0001-Harden-Mero-local-neural-TTS-*.patch` with `git am` on that branch and push, or push the included full tree (see §11).

## 2. File Manifest (15 files changed, +2080 / −282)

| File | Change | Purpose |
|---|---|---|
| `local-tts/app.py` | rewritten (~505 lines delta) | Local Piper TTS service v1.2.0: `/health`, `/voices`, `/tts`, `GET/DELETE /cache` |
| `local-tts/download-models.py` | **new** | Consent-based voice downloader (std-lib only, size preview, y/N prompt, `--yes`, `--list`, post-download validation) |
| `local-tts/requirements.txt` | updated | `piper-tts>=1.3`, fastapi, uvicorn pinned |
| `local-tts/start-tts.bat` | updated | Windows launcher; first-run explicit Arabic model offer |
| `local-tts/start-tts.sh` | updated | Linux/macOS launcher; same first-run offer |
| `local-tts/README.md` | rewritten (+217) | Architecture, platform matrix, install, verify, troubleshooting, privacy, Android status, API reference |
| `js/mero-tts.js` | rewritten (~993 lines delta) | Full frontend TTS module (settings v2, voices, queue, stop, replay, fallbacks, notices) |
| `js/ai-assistant.js` | +16 | Dispatches `mero:assistant-message` once per rendered assistant reply (single render path, no DOM observer) |
| `css/ai-assistant.css` | +36 | Voice controls styling: a11y focus rings, speaking pulse (reduced-motion aware), muted state, notice severities, RTL logical props, ≤360px layout |
| `index.html` | +6 | Loads `mero-tts.js` with cache-buster `v=6.1.0-tts2` (app version untouched) |
| `service-worker.js` | +2 | Cache version bump `shiftpro-shell-v6.1.0-mero-tts2`; `mero-tts.js` already in APP_SHELL |
| `tests/mero-tts.test.js` | **new** | Pure-helper unit tests |
| `tests/mero-tts.integration.test.js` | **new** | jsdom lifecycle tests (real modules, stubbed fetch/Audio/URL) |
| `.gitignore` | **new** | `node_modules/` (none existed); model binaries stay out of git |
| `README.md` | +10 | Voice feature section + storage note |

Voice model binaries (121 MB) are intentionally **not** in git or the zip — fetched via `local-tts/download-models.py`.

## 3. Implemented Features

- **Truly local neural engine:** Piper (Python API first, CLI fallback). No external TTS API, no API keys. Backend binds `127.0.0.1` only and warns if overridden.
- **Endpoints:** `GET /health`, `GET /voices`, `POST /tts` (WAV), `GET /cache`, `DELETE /cache`. Frontend payload shape verified against the live backend.
- **Real voices:** Arabic `ar_JO-kareem-medium` + English `en_US-lessac-medium` (HuggingFace `rhasspy/piper-voices`); voice metadata (language/quality/sample-rate) exposed in `/voices`; Arabic-Indic digit + tatweel + zero-width normalization.
- **Caching:** SHA-256(text + voice + speed) keyed WAV cache with size cap + eviction, configurable and clearable (`DELETE /cache`).
- **Security:** body-size 413 guard, per-client rate limit 429, concurrency semaphore, synthesis timeout with orphan-temp cleanup, path-traversal rejection, redacted error messages, access logging disabled.
- **Mero voice controls UI:** mute, auto-speak, Stop, Replay, real grouped voice selector (per-language memory), language preference, speed, pitch (browser engine only, where supported), speaking indicator, engine-unavailable state, honest fallback notices, local-only mode.
- **Playback behavior:** speaks new Mero replies only (message-seq event, never user text, never history, no streaming duplication — app has no streaming path); Stop cancels pending fetch + queue + audio via generation token and always wins; overlap prevented; pagehide/panel-close/Escape stop; visibility self-heal.
- **Fallback:** `auto` (local → browser) / `local` (never silently falls back, honest notice) / `browser` (Web Speech API with privacy notice that browser voices are not guaranteed offline; "no Arabic browser voice" state handled).
- **Settings persistence:** versioned settings v2 with v1 migration, sanitize/clamp, stored in `localStorage` (`shiftpro.meroTts.v2`), fault-tolerant.
- **i18n / RTL / themes / a11y:** labels via existing `SPi18n` subscribe (no reload), RTL logical properties, light/dark via existing CSS variables, focus-visible, 38–40px touch targets, `prefers-reduced-motion` respected.

## 4. Tests Actually Run

- **Jest: 148/148 pass (5 suites)** — re-confirmed on this final tree (`npx jest`): 129 pre-existing tests stay green + 19 new (`mero-tts.test.js`, `mero-tts.integration.test.js`: controls injection, muted default, dedup by message id, user-message filter, replay, stop, local-only no-fallback, chunking).
- **Syntax gates:** `python3 -m py_compile` (app.py, download-models.py), `node --check` (mero-tts.js, ai-assistant.js, service-worker.js), `bash -n` (start-tts.sh) — all pass on the final tree.
- **Live backend verification (real server on 127.0.0.1:8765, real models):**
  - Arabic TTS → 440 KB WAV, 9.98 s audio, 22050 Hz / 16-bit / mono, non-silent (rms 4733), 2.6 s synthesis.
  - English TTS OK; cache hit byte-identical; speed 0.7× → 7.28 s vs 1.4× → 4.27 s; auto voice pick by language; Arabic-Indic digits normalize to the same cache entry; `DELETE /cache` removed 5 entries.
  - Errors: unknown voice 400, empty text 400, path traversal 400, oversized 413; CORS: `github.io` origin allowed, unknown origin blocked.

## 5. Arabic / English Tested With Real Models?

**Yes — both, with real Piper models, live:**
- Arabic: `ar_JO-kareem-medium` — real WAV generated, validated (format + non-silence), sample included: `sample-mero-arabic-kareem.wav`.
- English: `en_US-lessac-medium` — real WAV generated, sample included: `sample-mero-english-lessac.wav`.
- Caveat (honest): validation was programmatic (WAV headers, RMS, duration). No human-audible playback or real browser click-through was possible in this sandbox — see §6.

## 6. Incomplete / Not Done (honest list)

- **Not pushed:** no GitHub credentials in sandbox → no PR exists; commit is local only.
- **No human-audible playback test** and **no real-browser click-through** of the UI (no audio device / display in sandbox; UI verified via jsdom integration tests instead).
- **Android PWA TTS:** not verified on a device (requires Chrome + local server on the same network or a loopback-capable setup — documented honestly in `local-tts/README.md`).
- **Capacitor Android native integration:** deliberately **not added** (no fake support claimed); documented as not implemented.
- **GitHub Pages note (documented, not fixable):** the hosted page cannot start a local Python service; local engine works on Windows/Linux/macOS desktop, browser fallback elsewhere.

## 7. Windows Installation Steps

1. Install Python 3.9–3.12 from python.org (check "Add to PATH").
2. Copy or clone the repo; open a terminal in `local-tts/`.
3. `python -m venv .venv` → `.venv\Scripts\activate`
4. `pip install -r requirements.txt`
5. Double-click **`start-tts.bat`** — first run offers to download the Arabic voice (`ar_JO-kareem-medium`, ~60 MB) explicitly (y/N); models land in `local-tts/models/`.
6. Wait for `Uvicorn running on http://127.0.0.1:8765`; open the app, open Mero → voice panel → it should show "Local engine ready" with the real voices.
7. Verify: `curl http://127.0.0.1:8765/health`. Troubleshooting table is in `local-tts/README.md`.

## 8. Android Testing Steps

- **PWA (browser):** serve the app (e.g. GitHub Pages or a local static server on the PC) and open it in Chrome on Android. The local engine **cannot** run on the phone from the web build; use Settings → speech → **Browser** fallback (privacy notice shown) or verify the "engine unavailable" state is honest.
- **Desktop-paired check (optional):** run `start-tts.sh` on a PC on the same LAN bound temporarily to `0.0.0.0` (service warns) and point a debug build at it — confirms voices list + speech on-device audio path.
- **Capacitor build:** `npx cap sync android` → Android Studio → run on device; TTS section should show the unavailable-state UI (native Piper integration intentionally not implemented in this change).

## 9. Limitations

- The web app on GitHub Pages can never start the local service — by platform design, documented everywhere the user looks.
- Browser Web Speech voices depend on the OS/browser; offline and Arabic availability are not guaranteed (UI says so explicitly).
- Piper speed on low-end hardware: first synthesis after start is slower (model warm-up).
- One voice per language is bundled by default; more can be added by dropping `.onnx` + `.onnx.json` into `local-tts/models/`.
- Pitch control is only exposed for the browser engine (Piper exposes speed only — honest UI).

## 10. Merge Status

- **NOT merged** into `main`, **NOT pushed**, **NOT released** — awaiting explicit approval, per the task rules. Local branch is exactly 1 commit ahead of the remote feature branch; a clean patch + full tree are provided for review.

## 11. How To Apply / Review This Package

- Review the diff: `mero-local-tts-full-vs-main.diff` (feature branch vs `main`).
- Apply the commit on the existing branch: `git checkout feature/mero-local-neural-tts && git am 0001-Harden-Mero-local-neural-TTS-*.patch && git push`.
- Or use the full tree: `SHIFTPRO22-mero-tts-branch.zip` (root file named by the commit hash marks the exact tree).
- Then install voices: `python local-tts/download-models.py` (or let `start-tts.bat`/`start-tts.sh` do it).
- Listen to the proof samples: `sample-mero-arabic-kareem.wav`, `sample-mero-english-lessac.wav`.
