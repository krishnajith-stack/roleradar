@echo off
setlocal
cd /d "%~dp0"
title RoleRadar - Optional PDF Support
echo This optional step downloads pypdf from the Python package index.
echo DOCX import and pasted CVs work without this step.
echo.
choice /c YN /m "Install optional PDF text extraction support"
if errorlevel 2 goto finished
where py >nul 2>&1
if not errorlevel 1 (
    py -3 -m pip install "pypdf>=5,<7"
    goto finished
)
where python >nul 2>&1
if not errorlevel 1 (
    python -m pip install "pypdf>=5,<7"
    goto finished
)
echo Install Python first. See START-HERE.html.
:finished
echo Restart RoleRadar after installation. Scanned PDFs require OCR elsewhere.
pause
