@echo off
title VR Video Player & OfflineTube Server
cls
echo ========================================================
echo   VR Video Player & OfflineTube - Universal Server
echo ========================================================
echo.

:: Detect Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python not found in PATH!
    echo Please install Python from https://www.python.org/
    pause
    exit /b 1
)

:: Install requirements
echo [1/3] Checking dependencies...
python -m pip install -r "%~dp0requirements.txt" --quiet

:: Open browser
echo [2/3] Opening browser at http://localhost:8080/
start http://localhost:8080/

:: Start Server
echo [3/3] Starting server...
echo.
python "%~dp0server.py" 8080

echo.
echo Server stopped.
pause
