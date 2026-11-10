@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the current Node.js LTS version first.
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo Created backend\.env from the example.
  echo Open backend\.env and fill in your local settings, then run this file again.
  notepad .env
  pause
  exit /b 0
)
if not exist node_modules (
  echo Installing Companion dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm start
pause
