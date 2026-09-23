@echo off
setlocal
cd /d "%~dp0"
title RoleRadar - Local Job Dashboard
where py >nul 2>&1
if not errorlevel 1 (
    py -3 app.py
    goto finished
)
where python >nul 2>&1
if not errorlevel 1 (
    python app.py
    goto finished
)
echo Python was not found. Install Python 3.10 or newer from https://www.python.org/downloads/
echo On Windows, select Add Python to PATH during installation.
echo Then double-click this file again. See START-HERE.html for help.
:finished
echo.
echo RoleRadar has stopped. Your saved data stays in the data folder.
pause
