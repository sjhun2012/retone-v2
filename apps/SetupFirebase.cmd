@echo off
node "%~dp0setup-firebase.cjs"
if errorlevel 1 exit /b 1
