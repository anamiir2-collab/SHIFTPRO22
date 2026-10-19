"""Mero local Piper TTS service. No outbound requests are made by this server."""
from __future__ import annotations
import hashlib, os, subprocess, tempfile, threading
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get("PIPER_MODEL_DIR", ROOT / "models")).resolve()
CACHE_DIR = Path(os.environ.get("PIPER_CACHE_DIR", ROOT / "cache")).resolve()
PIPER_BIN = os.environ.get("PIPER_BIN", "piper")
MAX_TEXT = 2000
CACHE_DIR.mkdir(parents=True, exist_ok=True)
_lock = threading.Lock()
app = FastAPI(title="Mero Local TTS", docs_url=None, redoc_url=None)

ALLOWED_ORIGINS = [
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:8080", "http://127.0.0.1:8080",
    "https://anamiir2-collab.github.io",
    "capacitor://localhost", "http://localhost",
]
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    voice: str = Field(default="ar", min_length=1, max_length=80)
    speed: float = Field(default=1.0, ge=0.6, le=1.5)

def voice_models():
    found = {}
    if MODEL_DIR.exists():
        for model in MODEL_DIR.glob("*.onnx"):
            # Never accept arbitrary paths from a request.
            found[model.stem] = model
    return found

@app.get("/health")
def health():
    return {"ok": True, "engine": "piper", "voices": sorted(voice_models().keys()),
            "model_dir": str(MODEL_DIR), "ready": bool(voice_models())}

@app.get("/voices")
def voices():
    return {"voices": [{"id": key, "label": key} for key in sorted(voice_models())]}

@app.post("/tts")
def tts(req: TTSRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")
    models = voice_models()
    model = models.get(req.voice)
    if model is None:
        if not models:
            raise HTTPException(status_code=503, detail="No Piper .onnx voice model installed in the models folder")
        raise HTTPException(status_code=400, detail="Unknown voice; refresh /voices")
    # Cache key includes all parameters that affect Piper output.
    key = hashlib.sha256(f"{text}\0{model.name}\0{req.speed:.2f}".encode("utf-8")).hexdigest()
    cached = CACHE_DIR / f"{key}.wav"
    if not cached.exists():
        with _lock:
            if not cached.exists():
                fd, temp_name = tempfile.mkstemp(suffix=".wav", dir=CACHE_DIR)
                os.close(fd)
                try:
                    command = [PIPER_BIN, "--model", str(model), "--output_file", temp_name,
                               "--length_scale", str(1.0 / req.speed)]
                    try:
                        completed = subprocess.run(command, input=text, text=True,
                            capture_output=True, timeout=90, check=False)
                    except FileNotFoundError:
                        raise HTTPException(status_code=503, detail="Piper executable not found. Install piper-tts first.")
                    except subprocess.TimeoutExpired:
                        raise HTTPException(status_code=504, detail="Piper speech generation timed out")
                    if completed.returncode != 0 or not Path(temp_name).exists() or Path(temp_name).stat().st_size < 44:
                        detail = (completed.stderr or "Piper failed").strip()[-800:]
                        raise HTTPException(status_code=500, detail=detail)
                    os.replace(temp_name, cached)
                finally:
                    try: Path(temp_name).unlink(missing_ok=True)
                    except OSError: pass
    return FileResponse(cached, media_type="audio/wav", filename="mero-reply.wav",
                        headers={"Cache-Control": "no-store", "X-TTS-Engine": "piper-local"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("MERO_TTS_PORT", "8765")), log_level="warning")
