#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
mkdir -p models
echo "Place an Arabic Piper .onnx model and matching .onnx.json in: $(pwd)/models"
echo "Starting Mero TTS on http://127.0.0.1:8765"
python app.py
