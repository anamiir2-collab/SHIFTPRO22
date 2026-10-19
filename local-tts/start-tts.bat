@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 goto :error
)
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements.txt
if not exist "models" mkdir models
echo.
echo Put your Arabic Piper .onnx model and matching .onnx.json file in: %CD%\models
echo Then the service starts on http://127.0.0.1:8765
python app.py
goto :eof
:error
echo Could not create Python virtual environment. Install Python 3.10+ and retry.
pause
