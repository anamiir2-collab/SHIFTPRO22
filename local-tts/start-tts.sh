#!/usr/bin/env bash
# Mero local neural TTS - Linux/macOS launcher. Stop the service with Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "Python 3.10+ is required. Set PYTHON=/path/to/python3 and retry." >&2
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Creating Python virtual environment..."
  "$PYTHON" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
pip install -r requirements.txt

mkdir -p models
if ! ls models/*.onnx >/dev/null 2>&1; then
  echo
  echo "No voice model is installed yet. Mero needs one to speak."
  read -r -p "Download the Arabic voice 'ar_JO-kareem-medium' now (about 63 MB)? [y/N] " answer
  case "$answer" in
    y|Y) python download-models.py --voice ar_JO-kareem-medium --yes ;;
    *) echo "Skipped. Install a model later with: python download-models.py --list" ;;
  esac
fi

echo
echo "Starting Mero local TTS on http://127.0.0.1:8765 (loopback only)"
echo "Keep this terminal open while Mero speaks. Stop with Ctrl+C."
exec python app.py
