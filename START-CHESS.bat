@echo off
title CHESS - Analysis board
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required. Install Node.js and run this launcher again.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing dependencies...
    call npm ci
    if errorlevel 1 (
        echo Dependency installation failed. Check your connection and try again.
        pause
        exit /b 1
    )
)

echo Opening CHESS at http://localhost:4655
echo Keep this window open while using the board. Press Ctrl+C to stop.
node "%~dp0server.js"
if errorlevel 1 pause
