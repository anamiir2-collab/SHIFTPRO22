"""Mero local neural TTS service (Piper).

Privacy contract for this server:
  * Binds to 127.0.0.1 by default. Never exposes itself to the LAN.
  * Never calls an external service. All speech is generated on this device.
  * Never logs request text; error details are redacted against the request.
  * Audio is cached locally under CACHE_DIR and can be listed/cleared via /cache.

Endpoints (identical names are used by js/mero-tts.js):
  GET    /health   -> engine + readiness report
  GET    /voices   -> installed voices with language metadata
  POST   /tts      -> {text, voice, speed, speaker?} -> audio/wav
  GET    /cache    -> cache statistics
  DELETE /cache    -> clear the audio cache

Configuration (environment variables):
  MERO_TTS_HOST            default 127.0.0.1 (loopback only; change is discouraged)
  MERO_TTS_PORT            default 8765
  PIPER_MODEL_DIR          default ./models
  PIPER_CACHE_DIR          default ./cache
  PIPER_BIN                piper CLI fallback executable (default "piper")
  MERO_TTS_MAX_TEXT        max characters per request (default 2000)
  MERO_TTS_CACHE_MB        audio cache cap in MB, oldest files evicted (default 200)
  MERO_TTS_MAX_CONCURRENT  concurrent synthesis jobs (default 2)
  MERO_TTS_TIMEOUT         synthesis timeout seconds (default 120)
  MERO_TTS_RATE_PER_MIN    max /tts requests per client per minute (default 60)
  MERO_TTS_ALLOWED_ORIGINS optional comma-separated CORS origin override

Synthesis prefers the piper Python package (pip install piper-tts). If that
import fails, it falls back to the piper command-line executable.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

SERVICE_VERSION = "1.2.0"
START_TIME = time.time()

ROOT = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get("PIPER_MODEL_DIR", str(ROOT / "models"))).resolve()
CACHE_DIR = Path(os.environ.get("PIPER_CACHE_DIR", str(ROOT / "cache"))).resolve()
PIPER_BIN = os.environ.get("PIPER_BIN", "piper")
MAX_TEXT = max(1, min(10000, int(os.environ.get("MERO_TTS_MAX_TEXT", "2000"))))
CACHE_LIMIT_BYTES = max(1, int(os.environ.get("MERO_TTS_CACHE_MB", "200"))) * 1024 * 1024
MAX_CONCURRENT = max(1, int(os.environ.get("MERO_TTS_MAX_CONCURRENT", "2")))
SYNTH_TIMEOUT = max(5, int(os.environ.get("MERO_TTS_TIMEOUT", "120")))
RATE_PER_MIN = max(1, int(os.environ.get("MERO_TTS_RATE_PER_MIN", "60")))
BODY_LIMIT = max(1024, int(os.environ.get("MERO_TTS_BODY_LIMIT", str(64 * 1024))))
HOST = os.environ.get("MERO_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("MERO_TTS_PORT", "8765"))

DEFAULT_ORIGINS = [
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:8080", "http://127.0.0.1:8080",
    "https://anamiir2-collab.github.io",
    "capacitor://localhost", "http://localhost",
    "http://localhost:3000", "http://127.0.0.1:3000",
]
_env_origins = os.environ.get("MERO_TTS_ALLOWED_ORIGINS", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in _env_origins.split(",") if o.strip()] or DEFAULT_ORIGINS

VOICE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
_ZERO_WIDTH = re.compile(r"[\u200b\u200c\u200d\u200e\u200f\u2066-\u2069\ufeff]")
_ARABIC_INDIC = {"\u0660": "0", "\u0661": "1", "\u0662": "2", "\u0663": "3", "\u0664": "4",
                 "\u0665": "5", "\u0666": "6", "\u0667": "7", "\u0668": "8", "\u0669": "9"}
_EXT_ARABIC_INDIC = {"\u06f0": "0", "\u06f1": "1", "\u06f2": "2", "\u06f3": "3", "\u06f4": "4",
                     "\u06f5": "5", "\u06f6": "6", "\u06f7": "7", "\u06f8": "8", "\u06f9": "9"}
_WS = re.compile(r"\s+")

CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Mutable engine state (guarded by locks)
# ---------------------------------------------------------------------------
_state_lock = threading.Lock()
_voice_scan: dict = {"voices": {}, "scanned_at": 0.0}
_loaded_voices: dict = {}
_voice_load_locks: dict = {}
_synth_slots = threading.BoundedSemaphore(MAX_CONCURRENT)
_rate_lock = threading.Lock()
_rate_hits: dict = {}
_piper_api = None  # lazily imported piper module


def _redact(detail: object, text: str) -> str:
    """Strip request text and absolute paths from anything we might return."""
    safe = str(detail or "Piper failed")
    if text:
        safe = safe.replace(text.strip(), "[redacted]")
        if text.strip():
            safe = re.sub(re.escape(text.strip()[:60]), "[redacted]", safe)
    safe = re.sub(r"[A-Za-z]:\\[^\"'\s]+", "[path]", safe)
    safe = re.sub(r"/(?:home|Users|root|tmp|var)/[^\s\"']+", "[path]", safe)
    return safe[-500:].strip() or "Piper failed"


def normalize_text(text: str) -> str:
    """Light, engine-agnostic cleanup so Piper receives clean input.

    Piper 1.3+ already diacritizes Arabic (tashkeel) internally, so we only
    remove noise: zero-width characters, Arabic-Indic digits (models read
    Western digits more reliably), the tatweel kashida, and control chars.
    """
    text = _ZERO_WIDTH.sub("", text)
    text = "".join(_ARABIC_INDIC.get(ch, _EXT_ARABIC_INDIC.get(ch, ch)) for ch in text)
    text = text.replace("\u0640", "")  # tatweel
    text = "".join(ch for ch in text if ch == "\n" or ord(ch) >= 32)
    text = _WS.sub(" ", text).strip()
    return text


def scan_voices(force: bool = False) -> dict:
    """Discover installed .onnx voices plus metadata from their .onnx.json."""
    now = time.time()
    with _state_lock:
        if not force and _voice_scan["voices"] and now - _voice_scan["scanned_at"] < 15.0:
            return dict(_voice_scan["voices"])
    found: dict = {}
    try:
        models = sorted(MODEL_DIR.glob("*.onnx"))
    except OSError:
        models = []
    for model in models:
        try:
            if model.stat().st_size < 1024 * 1024:  # ignore junk/placeholder files
                continue
        except OSError:
            continue
        info = {
            "id": model.stem,
            "name": model.stem,
            "path": model,
            "size_bytes": model.stat().st_size,
            "language": {"code": "unknown", "family": "unknown"},
            "sample_rate": 22050,
            "quality": "unknown",
            "num_speakers": 1,
        }
        cfg_path = model.with_suffix(".onnx.json")
        try:
            if cfg_path.exists():
                cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
                lang = cfg.get("language") or {}
                info["language"] = {
                    "code": str(lang.get("code", "unknown")),
                    "family": str(lang.get("family", "unknown")),
                }
                audio = cfg.get("audio") or {}
                info["sample_rate"] = int(audio.get("sample_rate", 22050))
                info["quality"] = str(audio.get("quality", "unknown"))
                info["num_speakers"] = max(1, int(cfg.get("num_speakers", 1)))
        except (OSError, ValueError, TypeError):
            pass  # config unreadable; voice still usable via defaults
        found[model.stem] = info
    with _state_lock:
        _voice_scan["voices"] = found
        _voice_scan["scanned_at"] = now
    return dict(found)


def _load_voice_python(voice_id: str, model_path: Path):
    """Load a voice with the piper Python package (thread-safe, lazy)."""
    global _piper_api
    if _piper_api is None:
        import piper  # imported lazily so /health works without the package
        _piper_api = piper
    with _voice_load_locks.setdefault(voice_id, threading.Lock()):
        if voice_id in _loaded_voices:
            return _loaded_voices[voice_id]
        voice = _piper_api.PiperVoice.load(str(model_path))
        _loaded_voices[voice_id] = voice
        return voice


def _synthesize_python(voice, text: str, speed: float, speaker, out_path: Path) -> None:
    from piper import SynthesisConfig
    syn_config = SynthesisConfig(length_scale=max(0.1, 1.0 / speed))
    if speaker is not None:
        try:
            syn_config.speaker_id = int(speaker)
        except (TypeError, ValueError):
            pass
    with wave.open(str(out_path), "wb") as wav_file:
        voice.synthesize_wav(text, wav_file, syn_config=syn_config)


def _synthesize_cli(model_path: Path, text: str, speed: float, speaker, out_path: Path) -> None:
    """Fallback: the piper executable (or python -m piper) if the package API is absent."""
    command = [PIPER_BIN, "--model", str(model_path), "--output_file", str(out_path),
               "--length_scale", str(round(1.0 / speed, 3))]
    if speaker is not None:
        command += ["--speaker", str(int(speaker))]
    completed = subprocess.run(command, input=text, text=True, capture_output=True,
                               timeout=SYNTH_TIMEOUT, check=False)
    if completed.returncode != 0:
        raise RuntimeError(_redact(completed.stderr, text) or "piper CLI failed")


def _validate_wav(path: Path) -> bool:
    try:
        if path.stat().st_size < 44:
            return False
        with wave.open(str(path), "rb") as wav:
            return wav.getnframes() > 0 and wav.getframerate() > 0
    except (OSError, wave.Error):
        return False


def cache_stats() -> dict:
    count, total = 0, 0
    try:
        for f in CACHE_DIR.glob("*.wav"):
            count += 1
            total += f.stat().st_size
    except OSError:
        pass
    return {"count": count, "bytes": total, "limit_bytes": CACHE_LIMIT_BYTES,
            "dir": str(CACHE_DIR), "max_text_chars": MAX_TEXT}


def enforce_cache_limit() -> None:
    """Evict oldest cached audio until the cache fits its configured cap."""
    try:
        files = sorted(CACHE_DIR.glob("*.wav"), key=lambda f: f.stat().st_mtime)
        total = sum(f.stat().st_size for f in files)
        for f in files:
            if total <= CACHE_LIMIT_BYTES:
                break
            size = f.stat().st_size
            try:
                f.unlink(missing_ok=True)
                total -= size
            except OSError:
                pass
    except OSError:
        pass


def check_rate_limit(client: str) -> None:
    now = time.time()
    with _rate_lock:
        window = [t for t in _rate_hits.get(client, []) if now - t < 60.0]
        if len(window) >= RATE_PER_MIN:
            _rate_hits[client] = window
            raise HTTPException(status_code=429, detail="Too many speech requests; slow down.")
        window.append(now)
        _rate_hits[client] = window
        if len(_rate_hits) > 512:  # keep the map bounded
            _rate_hits.clear()

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Mero Local TTS", version=SERVICE_VERSION, docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=600,
)


@app.middleware("http")
async def guard_body_size(request: Request, call_next):
    if request.method == "POST":
        length = request.headers.get("content-length")
        try:
            if length and int(length) > BODY_LIMIT:
                return JSONResponse(status_code=413, content={"detail": "Request body too large."})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length."})
    return await call_next(request)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    voice: str = Field(default="", min_length=0, max_length=80)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    speaker: int | None = Field(default=None, ge=0, le=8191)


@app.get("/health")
def health():
    voices = scan_voices()
    piper_ready = True
    try:
        _load_piper_module()
    except HTTPException:
        piper_ready = False
    return {
        "ok": True,
        "engine": "piper",
        "mode": "python-api" if piper_ready else "cli-fallback",
        "service_version": SERVICE_VERSION,
        "ready": bool(voices) and piper_ready,
        "voices": sorted(voices.keys()),
        "voice_count": len(voices),
        "model_dir": str(MODEL_DIR),
        "cache": cache_stats(),
        "uptime_s": int(time.time() - START_TIME),
        "max_text_chars": MAX_TEXT,
    }


def _load_piper_module():
    global _piper_api
    if _piper_api is None:
        try:
            import piper
            _piper_api = piper
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="piper-tts package is not installed. Run: pip install -r requirements.txt")
    return _piper_api


def _voice_payload(voices: dict) -> list:
    out = []
    for v in sorted(voices.values(), key=lambda x: x["id"]):
        out.append({
            "id": v["id"],
            "name": v["name"],
            "language": v["language"],
            "sample_rate": v["sample_rate"],
            "quality": v["quality"],
            "num_speakers": v["num_speakers"],
            "size_mb": round(v["size_bytes"] / (1024 * 1024), 1),
        })
    return out


@app.get("/voices")
def voices():
    return {"voices": _voice_payload(scan_voices())}


@app.post("/tts")
def tts(req: TTSRequest, request: Request):
    client = request.client.host if request.client else "unknown"
    check_rate_limit(client)

    raw_text = req.text
    text = normalize_text(raw_text)
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty after normalization.")
    if len(text) > MAX_TEXT:
        raise HTTPException(status_code=400, detail=f"Text exceeds {MAX_TEXT} characters.")

    voices = scan_voices()
    if not voices:
        raise HTTPException(status_code=503,
                            detail="No Piper voice model installed in the models folder. "
                                   "Run: python download-models.py --voice ar_JO-kareem-medium")
    voice_id = req.voice.strip() or _pick_voice_for_text(text, voices)
    if not VOICE_ID_RE.match(voice_id) or voice_id not in voices:
        raise HTTPException(status_code=400,
                            detail="Unknown voice for this service. Refresh the voice list.")
    model_path: Path = voices[voice_id]["path"]
    num_speakers = voices[voice_id]["num_speakers"]
    speaker = req.speaker if (num_speakers > 1 and req.speaker is not None) else None

    speed = float(req.speed)
    key = hashlib.sha256(
        f"{text}\0{voice_id}\0{speed:.2f}\0{speaker if speaker is not None else ''}".encode("utf-8")
    ).hexdigest()
    cached = CACHE_DIR / f"{key}.wav"
    if cached.exists() and _validate_wav(cached):
        return FileResponse(cached, media_type="audio/wav", filename="mero-reply.wav",
                            headers={"Cache-Control": "no-store", "X-TTS-Engine": "piper-local",
                                     "X-TTS-Cache": "hit", "X-TTS-Voice": voice_id})

    if not _synth_slots.acquire(timeout=SYNTH_TIMEOUT):
        raise HTTPException(status_code=503, detail="Speech engine is busy; try again shortly.")
    fd, temp_name = tempfile.mkstemp(suffix=".wav", dir=CACHE_DIR, prefix="tts-")
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        started = time.time()
        try:
            voice_obj = _load_voice_python(voice_id, model_path)
            synthesis = ThreadPoolExecutor(max_workers=1).submit(
                _synthesize_python, voice_obj, text, speed, speaker, temp_path)
            synthesis.result(timeout=SYNTH_TIMEOUT)
        except ImportError:
            _synthesize_cli(model_path, text, speed, speaker, temp_path)
        except FutureTimeout:
            # Orphan temp file is reclaimed shortly; the worker thread is abandoned.
            threading.Timer(30.0, lambda: temp_path.unlink(missing_ok=True)).start()
            raise HTTPException(status_code=504, detail="Speech generation timed out.")
        except HTTPException:
            raise
        except Exception as exc:  # piper runtime errors
            raise HTTPException(status_code=500, detail=_redact(exc, text))
        if not _validate_wav(temp_path):
            raise HTTPException(status_code=500, detail=_redact(
                "Piper produced no usable audio", text))
        os.replace(temp_path, cached)  # atomic publish into the cache
        enforce_cache_limit()
        return FileResponse(cached, media_type="audio/wav", filename="mero-reply.wav",
                            headers={"Cache-Control": "no-store", "X-TTS-Engine": "piper-local",
                                     "X-TTS-Cache": "miss", "X-TTS-Voice": voice_id,
                                     "X-TTS-Generation-Ms": str(int((time.time() - started) * 1000))})
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        _synth_slots.release()


def _pick_voice_for_text(text: str, voices: dict) -> str:
    """Pick a voice whose language family matches the text (Arabic first)."""
    arabic_chars = sum(1 for ch in text if "\u0600" <= ch <= "\u06ff")
    wanted = "ar" if arabic_chars >= max(1, len(text) // 10) else "en"
    for family in (wanted, "ar", "en"):
        for v in sorted(voices.values(), key=lambda x: x["id"]):
            if v["language"]["family"] == family:
                return v["id"]
    return sorted(voices.keys())[0]


@app.get("/cache")
def cache_info():
    return cache_stats()


@app.delete("/cache")
def cache_clear():
    removed = 0
    try:
        for f in CACHE_DIR.glob("*.wav"):
            try:
                f.unlink(missing_ok=True)
                removed += 1
            except OSError:
                pass
    except OSError:
        pass
    return {"cleared": True, "removed": removed, **cache_stats()}


def _startup_banner() -> None:
    if HOST not in ("127.0.0.1", "localhost", "::1"):
        print(f"WARNING: Mero TTS is bound to {HOST}. Loopback (127.0.0.1) is strongly recommended.",
              flush=True)
    voices = scan_voices(force=True)
    print(f"Mero local TTS {SERVICE_VERSION} on http://{HOST}:{PORT}", flush=True)
    print(f"  voices: {', '.join(sorted(voices)) or 'NONE - run download-models.py first'}", flush=True)


if __name__ == "__main__":
    import uvicorn
    _startup_banner()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning", access_log=False)
