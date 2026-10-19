# Mero Local Neural TTS (Piper)

Optional, privacy-first neural speech for the Mero assistant in ShiftPro.
Speech is generated **on your own device** by a small local service. The web
app sends assistant reply text only to `http://127.0.0.1:8765` (loopback) —
never to a cloud TTS provider. There are no API keys and no outbound requests
in this service.

## Architecture and data flow

```
ShiftPro web app (browser / PWA)
  └─ js/ai-assistant.js      renders each assistant reply once
        └─ "mero:assistant-message" event (assistant replies only)
  └─ js/mero-tts.js          voice controls + playback queue
        ├─ POST http://127.0.0.1:8765/tts   {text, voice, speed}
        ├─ GET  http://127.0.0.1:8765/voices
        └─ DELETE http://127.0.0.1:8765/cache (optional, user-triggered)

local-tts/app.py (FastAPI + piper-tts, binds 127.0.0.1 only)
  └─ models/*.onnx + *.onnx.json   (installed by you, never committed)
  └─ cache/*.wav                   (hashed audio cache, size-capped, clearable)
```

- The assistant dispatches one event per rendered reply; `mero-tts.js` never
  watches the DOM, so user messages, system text, and historical messages are
  never spoken, and a message id is never spoken twice.
- Long replies are split into sentence-bounded chunks and played sequentially;
  Stop cancels the queue, the pending request, and the audio immediately.
- If Piper is unavailable, behavior follows the selected engine mode:
  **auto** (explicit, labeled browser fallback), **local only** (actionable
  error, never silently switches), or **browser** (Web Speech API).

## Platform support (be realistic)

| Environment | Works? | Notes |
|---|---|---|
| Desktop browser + local service (Windows/Linux/macOS) | Yes | The primary supported setup. Start `start-tts.bat` / `start-tts.sh`, then use ShiftPro. |
| Hosted website (GitHub Pages) in a phone browser | Partial | The page cannot start a Python service on the visitor's device. Without the local service only the labeled browser fallback is possible (if the device has a suitable voice). |
| Android browser / PWA | Partial | Same as above; a web page cannot launch a localhost service on Android. The UI states this honestly instead of pretending. |
| Capacitor Android app | Not implemented | Real native support needs a bundled native engine or a managed local service (NDK/onnxruntime integration, Android storage/lifecycle/permissions work). Nothing fake was added; see "Android notes" below. |

## Requirements

- Python **3.10+** (Windows, Linux, or macOS).
- `pip install -r requirements.txt` → installs `fastapi`, `uvicorn`, and
  `piper-tts` (which includes ONNX Runtime and espeak-ng data). Internet is
  needed **only** for installation and for downloading voice models. Speech
  generation itself runs fully offline afterwards.

## Install a voice model (explicit, never silent)

The service never downloads models by itself. Use the bundled downloader:

```bash
cd local-tts
python download-models.py --list                       # browse suggestions
python download-models.py --voice ar_JO-kareem-medium  # Arabic (about 63 MB)
python download-models.py --voice en_US-lessac-medium  # English (about 63 MB)
```

Each download shows the source URL, size, and license pointer, then asks for
confirmation (`--yes` skips the prompt for scripted setups). Files land in
`local-tts/models/` as `<voice>.onnx` + `<voice>.onnx.json`. The `.bat`/`.sh`
launchers also offer the Arabic download on first run (your choice).

You can also download models manually from the official Piper voices
repository at <https://huggingface.co/rhasspy/piper-voices> and drop both
files into `models/`. Any Piper `.onnx` voice works; the service reads each
model's language metadata from its `.onnx.json`, so the Mero voice selector
groups voices under العربية / English correctly and the assistant
auto-selects a voice matching the reply language (Arabic replies are detected
in text and routed to an `ar` voice, English to an `en` voice).

**Licensing:** Piper's code is MIT. Each *voice* has its own training-dataset
license documented on its Hugging Face page and at
<https://rhasspy.github.io/piper-samples/> — review it before commercial
redistribution. No model files are committed to ShiftPro's repository.

## Windows quick start

1. Install Python 3.10+ from <https://www.python.org/downloads/> (tick
   **Add python.exe to PATH**).
2. Double-click `local-tts\start-tts.bat`.
   - First run: creates `.venv`, installs dependencies, and offers to
     download the Arabic voice.
3. Keep the window open. The service listens on `http://127.0.0.1:8765`.
4. Stop: press `Ctrl+C` in that window (or just close it).

Manual alternative:

```bat
cd local-tts
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python download-models.py --voice ar_JO-kareem-medium
python app.py
```

## Linux / macOS quick start

```bash
cd local-tts
chmod +x start-tts.sh
./start-tts.sh          # offers the Arabic model download on first run
```

Stop with `Ctrl+C`. Manual steps mirror the Windows section using
`python3 -m venv .venv && source .venv/bin/activate`.

## Verify the service is healthy

```bash
curl http://127.0.0.1:8765/health
```

`ready: true` means piper is importable and at least one model is installed.
`voices` lists installed model ids; `cache` shows cached audio count/size.
Then open ShiftPro, open Mero, enable voice, and send a message — the status
line shows "المحرك الصوتي العصبي المحلي جاهز" when connected.

Quick audio sanity check without the app:

```bash
curl -X POST http://127.0.0.1:8765/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"مرحبًا، أنا ميرو","voice":"ar_JO-kareem-medium","speed":1.0}' \
  -o out.wav    # then play out.wav
```

## Using voice in Mero

Controls live at the top of the Mero panel (they do not redesign anything):

- **تشغيل الصوت / كتم الصوت** — master enable/mute (muted by default).
- **نطق الردود الجديدة تلقائيًا** — automatic speech for new replies.
- **إيقاف** — immediately stops playback, cancels pending requests.
- **أعد آخر رد** — replays the latest assistant reply.
- **المحرك** — `محلي مع بديل النظام` / `Piper محلي فقط` / `صوت النظام (بديل)`.
- **لغة الردود** — auto-detect per reply, or force Arabic/English.
- **الصوت** — populated ONLY from genuinely installed voices (grouped by
  language); preference is remembered per language.
- **سرعة الكلام** — 0.6×–1.5× (applied by Piper's length scale).
- **درجة النبرة** — enabled only for the browser fallback, because Piper has
  no pitch control (labeled "غير مدعوم محليًا" otherwise).
- **مسح ذاكرة الصوت** — clears the local WAV cache (also: `DELETE /cache`).
- A pulsing status dot + "جارٍ النطق…" indicate active speech (not
  color-alone; disabled via `prefers-reduced-motion`).

The voice selector is disabled with an honest label when the local service is
down or no model is installed — unavailable voices are never listed.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "الخدمة المحلية غير متاحة" | Service not started, or wrong port. Start `start-tts.bat`, check `curl 127.0.0.1:8765/health`. |
| "لا يوجد نموذج صوتي مثبت" | `models/` has no `.onnx`. Run `python download-models.py --voice ar_JO-kareem-medium`. |
| Arabic replies silent, English works | No `ar` model installed. The auto-detected language has no matching voice; install kareem. |
| Browser-fallback says no Arabic voice | The OS/browser has no Arabic TTS voice. This is stated honestly rather than faked; install the Piper Arabic model. |
| CORS error in console | Only `https://anamiir2-collab.github.io`, `capacitor://localhost`, and localhost dev origins (8000/8080/3000) are allowed. Override with `MERO_TTS_ALLOWED_ORIGINS="https://your.origin"`. |
| Audio plays but is silent/garbled | Re-download the model (validation runs at download time); check `X-TTS-*` response headers. |
| Port already in use | Set `MERO_TTS_PORT` and restart; keep frontend and backend consistent. |
| "Speech engine is busy" | Concurrency limit hit; retry. Tune with `MERO_TTS_MAX_CONCURRENT`. |

## Privacy, security, and cache

- The server binds to `127.0.0.1` by default (`MERO_TTS_HOST` override prints
  a loud warning; don't expose it).
- CORS is an explicit allowlist; other origins get no `Access-Control-Allow-Origin`.
- Request body limit (64 KB), text length cap (2000 chars by default), rate
  limit (60/min/client), concurrency cap, synthesis timeout, per-request
  unique temp files with safe cleanup, path-traversal-proof voice selection
  (ids are matched against installed models, never used as paths).
- Error details are redacted: request text never appears in responses or logs;
  access logging is disabled.
- Audio cache: `cache/*.wav` keyed by normalized text + voice + speed, capped
  (`MERO_TTS_CACHE_MB`, default 200 MB, oldest evicted). Clear it from the
  Mero panel or `DELETE /cache`. Settings live in `localStorage` under
  `shiftpro_mero_tts_v2` (legacy v1 migrated); no conversation text or audio
  is stored in settings.
- Installation (packages + models) needs internet; generation afterwards is
  offline. The rest of ShiftPro's offline status is unchanged and separately
  documented — this feature does not make the whole app "fully offline".
- Browser fallback (Web Speech) is labeled in the UI: depending on OS/browser
  it may use platform services and is not guaranteed offline. **Piper local
  only** is the strict-privacy mode.

## Android notes (honest status)

- A GitHub Pages site or Android browser cannot spawn this Python service;
  in those environments only the labeled system fallback may exist.
- A Capacitor build could integrate a real local engine natively (e.g.
  onnxruntime + piper C++ sources, or a managed loopback service inside the
  app process). That requires native code, Android NDK/Gradle work, model
  storage (≈60 MB+ per voice), and lifecycle handling. It is **not** included
  here — nothing in this branch pretends otherwise.

## Local API reference

| Endpoint | Method | Notes |
|---|---|---|
| `/health` | GET | readiness, engine mode, voice ids, cache stats, uptime |
| `/voices` | GET | installed voices with `language.code`/`language.family`, sample rate, quality, size |
| `/tts` | POST | `{text, voice, speed, speaker?}` → `audio/wav`; `X-TTS-Cache: hit/miss`, `X-TTS-Generation-Ms` |
| `/cache` | GET / DELETE | cache stats / clear cache |

Environment knobs: `MERO_TTS_HOST`, `MERO_TTS_PORT`, `PIPER_MODEL_DIR`,
`PIPER_CACHE_DIR`, `PIPER_BIN`, `MERO_TTS_MAX_TEXT`, `MERO_TTS_CACHE_MB`,
`MERO_TTS_MAX_CONCURRENT`, `MERO_TTS_TIMEOUT`, `MERO_TTS_RATE_PER_MIN`,
`MERO_TTS_ALLOWED_ORIGINS`, `MERO_TTS_BODY_LIMIT`.
