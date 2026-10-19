#!/usr/bin/env python3
"""Explicit downloader for Piper voice models (Mero local TTS).

This script is the ONLY supported way to obtain voice models for the Mero
local TTS service. Nothing is downloaded silently: the server never downloads
models, and this tool always shows what it will fetch and asks for consent
(use --yes for scripted installs).

Models come from the official Piper voices repository on Hugging Face:
  https://huggingface.co/rhasspy/piper-voices

Licensing: Piper's source code is MIT-licensed. Each VOICE has its own
training-dataset license (e.g. CC-0/CC-BY variants) documented on the voice's
page at https://huggingface.co/rhasspy/piper-voices/tree/main and on the
samples page https://rhasspy.github.io/piper-samples/. Review the license of
any voice you rely on, especially for commercial redistribution. Voice models
are NOT committed to the ShiftPro repository.

Usage:
  python download-models.py --list
  python download-models.py --voice ar_JO-kareem-medium
  python download-models.py --voice ar_JO-kareem-medium --yes
  python download-models.py --voice en_US-lessac-medium --dir models
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"

# Curated starter catalog. Arabic first: it is the primary Mero language.
CATALOG = {
    "ar_JO-kareem-medium": "Arabic (Jordan) male, 22050 Hz - the main Arabic voice used for Mero testing",
    "en_US-lessac-medium": "English (US) female, 22050 Hz - the English voice used for Mero testing",
    "en_US-amy-medium": "English (US) female, 22050 Hz",
    "en_GB-alan-medium": "English (UK) male, 22050 Hz",
    "ar_JO-kareem-low": "Arabic (Jordan) male, lower quality, smaller file",
}


def parse_slug(slug: str) -> tuple[str, str, str, str]:
    """'ar_JO-kareem-medium' -> ('ar', 'JO', 'kareem', 'medium')."""
    parts = slug.split("-")
    if len(parts) < 3 or "_" not in parts[0]:
        raise SystemExit(f"Unexpected voice slug format: {slug}")
    family, _, region = parts[0].partition("_")
    quality = parts[-1]
    name = "-".join(parts[1:-1])
    return family, region, name, quality


def remote_size(url: str) -> int | None:
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return int(resp.headers.get("Content-Length") or 0) or None
    except Exception:
        return None


def download(url: str, dest: Path) -> None:
    print(f"  downloading -> {dest.name}")
    with urllib.request.urlopen(url, timeout=600) as resp, open(dest, "wb") as out:
        done = 0
        total = int(resp.headers.get("Content-Length") or 0)
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                pct = min(100, done * 100 // total)
                print(f"\r  {pct:3d}%  ({done / (1024 * 1024):.1f} / {total / (1024 * 1024):.1f} MB)",
                      end="", flush=True)
    print()


def human(mb: float | None) -> str:
    return f"~{mb:.0f} MB" if mb else "unknown size"


def main() -> int:
    parser = argparse.ArgumentParser(description="Download Piper voices for Mero local TTS.")
    parser.add_argument("--voice", help="voice slug, e.g. ar_JO-kareem-medium")
    parser.add_argument("--dir", default=str(Path(__file__).resolve().parent / "models"),
                        help="target model directory (default: ./models)")
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    parser.add_argument("--list", action="store_true", help="list suggested voices")
    args = parser.parse_args()

    if args.list or not args.voice:
        print("Suggested Piper voices (Arabic first):\n")
        for slug, desc in CATALOG.items():
            print(f"  {slug:26s} {desc}")
        print("\nFull catalog: https://huggingface.co/rhasspy/piper-voices/tree/main")
        if not args.voice:
            print("\nRun again with --voice <slug> to install one.")
        return 0

    slug = args.voice.strip()
    family, region, name, quality = parse_slug(slug)
    base = f"{HF_BASE}/{family}/{family}_{region}/{name}/{quality}/{slug}"
    target_dir = Path(args.dir).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    onnx_dest = target_dir / f"{slug}.onnx"
    json_dest = target_dir / f"{slug}.onnx.json"

    if onnx_dest.exists() and json_dest.exists():
        print(f"Voice '{slug}' is already installed at {target_dir}")
        return 0

    onnx_url, json_url = f"{base}.onnx", f"{base}.onnx.json"
    print("\nAbout to download a voice model:")
    print(f"  voice:   {slug}")
    print(f"  source:  {onnx_url}")
    print(f"  target:  {target_dir}")
    print(f"  size:    {human(remote_size(onnx_url) and remote_size(onnx_url) / (1024 * 1024))} + config")
    print("  license: see https://huggingface.co/rhasspy/piper-voices (per-voice dataset license)")
    if not args.yes:
        answer = input("Proceed with download? [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            print("Aborted. Nothing was downloaded.")
            return 1

    ok = True
    try:
        download(onnx_url, onnx_dest)
        download(json_url, json_dest)
    except Exception as exc:
        print(f"Download failed: {exc}")
        ok = False

    # Validate before declaring success.
    if ok:
        try:
            if onnx_dest.stat().st_size < 1024 * 1024:
                raise ValueError("model file looks too small to be a real voice")
            cfg = json.loads(json_dest.read_text(encoding="utf-8"))
            print(f"\nInstalled '{slug}' ({cfg.get('language', {}).get('code', '?')}, "
                  f"{cfg.get('audio', {}).get('sample_rate', '?')} Hz) into {target_dir}")
            print("Restart the Mero TTS service (start-tts.bat / start-tts.sh), then refresh "
                  "the voice list inside Mero.")
        except Exception as exc:
            print(f"Downloaded files failed validation: {exc}")
            for f in (onnx_dest, json_dest):
                try:
                    f.unlink()
                except OSError:
                    pass
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
