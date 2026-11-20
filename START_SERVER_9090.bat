@echo off
title VR Video Player - Server (port 9090)
cls
set PYTHON="C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe"
if not exist %PYTHON% set PYTHON="python"
echo Starting on port 9090...
%PYTHON% "%~dp0server.py" --port 9090 --scan
pause
