@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  py -3 -m venv .venv
  if errorlevel 1 goto :error
)
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 goto :error

if not exist "models" mkdir models
dir /b "models\*.onnx" 2>nul | findstr . >nul
if errorlevel 1 (
  echo.
  echo No voice model is installed yet. Mero needs one to speak.
  choice /C YN /M "Download the Arabic voice 'ar_JO-kareem-medium' now (about 63 MB)"
  if errorlevel 2 goto :skipdownload
  python download-models.py --voice ar_JO-kareem-medium --yes
)
:skipdownload

echo.
echo Starting Mero local TTS on http://127.0.0.1:8765 (loopback only)
echo Keep this window open while Mero speaks. Stop with Ctrl+C.
python app.py
goto :eof

:error
echo.
echo Setup failed. Install Python 3.10+ from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH" during setup) and run this file again.
pause
