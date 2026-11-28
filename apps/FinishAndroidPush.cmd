@echo off
python "%~dp0build_apps.py" --only android --ci-artifact
if errorlevel 1 exit /b 1
