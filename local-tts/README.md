# Mero Local Neural TTS (Piper)

This optional service generates speech on the same computer as ShiftPro. It binds only to `127.0.0.1`; it does not call a hosted TTS service and contains no API keys. The web app sends reply text only to `http://127.0.0.1:8765/tts`.

## Requirements

- Python 3.10 or newer.
- A Piper-compatible voice model, including both its `.onnx` file and matching `.onnx.json` config.
- Internet is needed only if you choose to install Python packages/download the model. Speech generation itself is local and can work offline afterward.

## Install a voice

1. Download a Piper voice model from the official Piper voice catalog/repository on a trusted connection. Choose an Arabic voice if one is available and verify its language/quality before relying on it; English voices can be added the same way.
2. Place the model and its matching config together in `local-tts/models/`, for example `models/<voice-name>.onnx` and `models/<voice-name>.onnx.json`. Do not commit large model files to Git.
3. The service discovers every `.onnx` file in that folder. The voice dropdown uses each model's filename.

## Windows quick start

Double-click `start-tts.bat`. It creates a virtual environment, installs dependencies, then starts the service at `http://127.0.0.1:8765`. First install requires package access. Stop it with Ctrl+C.

## Linux / macOS quick start

Run `chmod +x start-tts.sh && ./start-tts.sh`. Stop with Ctrl+C.

## Verify

- Open `http://127.0.0.1:8765/health`; `ready` should be `true` and `voices` should list model IDs.
- Open ShiftPro over localhost or GitHub Pages, open Mero, enable voice, and send a message.
- If the local service is stopped or no model is installed, Mero announces that it is using the browser's Web Speech fallback when available.
- `POST /tts` returns a WAV file. Repeated text/voice/speed combinations are cached under `cache/`.

## Privacy and limits

- The API binds to loopback, not the LAN. CORS is restricted to the ShiftPro GitHub Pages origin, localhost development origins, and Capacitor's local origin.
- No request is sent to an external TTS endpoint by this code. Browser fallback uses the device's installed speech engine; depending on the OS/browser, its implementation may use platform services, so use **local Piper only** if a strict no-network guarantee is required.
- Piper exposes speaking rate, but not a standard pitch control in its command-line interface. Mero's pitch setting is applied to Web Speech fallback only; Piper pitch is unchanged.
- Voice quality and Arabic support depend on the model actually installed. No Arabic model is bundled in this repository.
- WAV caching is local to this service. Delete `cache/` to clear it. Keep model files and generated speech out of source control.
- The service deliberately does not provide arbitrary file paths, remote URLs, microphone input, or voice cloning endpoints.
