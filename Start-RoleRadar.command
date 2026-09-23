#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
    python3 app.py
else
    printf '%s\n' 'Install Python 3.10 or newer from https://www.python.org/downloads/, then try again.'
fi
printf '%s\n' 'RoleRadar has stopped. Press Enter to close.'
read -r roleradar_done
