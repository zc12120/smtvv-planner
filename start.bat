@echo off
cd /d "%~dp0"
where wsl.exe >nul 2>nul
if %errorlevel%==0 (
  wsl.exe --cd "%CD%" --exec python3 launch.py
) else (
  py -3 launch.py
)
if errorlevel 1 pause
