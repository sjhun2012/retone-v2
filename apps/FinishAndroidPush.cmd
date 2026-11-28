@echo off
python "%~dp0finish-android-push.py"
if errorlevel 1 exit /b 1
