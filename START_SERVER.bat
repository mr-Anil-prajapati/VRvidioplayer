@echo off
title VR Video Player - Network Server
cls
echo.
echo  ========================================
echo   VR Video Player - Local Network Server
echo  ========================================
echo.
echo  Starting server...
echo.

set PYTHON="C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe"

:: Try common Python locations if above not found
if not exist %PYTHON% set PYTHON="python"

%PYTHON% "%~dp0server.py" --port 8000 --scan

echo.
echo  Server stopped.
pause
