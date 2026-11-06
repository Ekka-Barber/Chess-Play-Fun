@echo off
setlocal DisableDelayedExpansion
title CHESS - Analysis board
pushd "%~dp0" || (
    echo Could not open the CHESS folder.
    pause
    exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 (
    echo Node.js is required. Install Node.js 24 and run this launcher again.
    goto failed
)

node.exe -e "process.exit(process.features.require_module ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
    echo This Node.js runtime cannot load the app's ES modules. Use Node.js 24 or enable require module support.
    goto failed
)

node.exe -e "for (const name of Object.keys(require('./package.json').dependencies)) require.resolve('./node_modules/' + name)" >nul 2>&1
if errorlevel 1 (
    where npm.cmd >nul 2>&1
    if errorlevel 1 (
        echo npm is required to install dependencies. Reinstall Node.js with npm.
        goto failed
    )
    echo Installing dependencies...
    call npm.cmd ci
    if errorlevel 1 goto install_failed
)

if not defined STOCKFISH_EXE if not exist "stockfish\stockfish-windows-x86-64-universal.exe" (
    echo Stockfish is missing. Run npm run setup:engines in this folder to install the configured engines.
)
echo Keep this window open while using the board. Press Ctrl+C to stop.
node.exe server.js
set "status=%errorlevel%"
if not "%status%"=="0" echo CHESS exited with code %status%.
goto finish

:install_failed
set "status=%errorlevel%"
echo Dependency installation failed. Check the npm error above.
goto finish

:failed
set "status=1"

:finish
if not "%status%"=="0" pause
popd
exit /b %status%
