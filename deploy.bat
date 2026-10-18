@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Git Commit ^& Push

rem In den Ordner wechseln, in dem diese .bat liegt
cd /d "%~dp0"

rem --- Pruefungen ---------------------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Git wurde nicht gefunden. Ist Git installiert und im PATH?
    pause
    exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Dieser Ordner ist kein Git-Repository:
    echo %CD%
    pause
    exit /b 1
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"

echo ==========================================
echo  Ordner : %CD%
echo  Branch : %BRANCH%
echo ==========================================
echo.

rem --- Gibt es Aenderungen? ----------------------------------------------
git status --porcelain | findstr . >nul
if errorlevel 1 (
    echo Keine Aenderungen zum Committen.
    echo Pruefe trotzdem, ob noch etwas zu pushen ist...
    echo.
    goto push
)

echo Geaenderte Dateien:
git status --short
echo.

rem --- Commit-Nachricht abfragen -----------------------------------------
:ask
set "MSG="
set /p "MSG=Was wurde geaendert? "
if not defined MSG (
    echo Bitte eine Beschreibung eingeben.
    goto ask
)

rem Nachricht sicher in Datei schreiben (auch mit Sonderzeichen wie ^& ^| ^< ^> ")
set "MSGFILE=%TEMP%\git_commit_msg_%RANDOM%.txt"
setlocal EnableDelayedExpansion
> "!MSGFILE!" echo(!MSG!
endlocal

rem --- Commit ------------------------------------------------------------
git add -A
git commit -F "%MSGFILE%"
set "ERR=%ERRORLEVEL%"
del "%MSGFILE%" >nul 2>&1
if not "%ERR%"=="0" (
    echo.
    echo [FEHLER] Commit fehlgeschlagen.
    pause
    exit /b 1
)

rem --- Push --------------------------------------------------------------
:push
echo.
git rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>&1
if errorlevel 1 (
    echo Kein Upstream gesetzt - pushe nach origin/%BRANCH% ...
    git push -u origin "%BRANCH%"
) else (
    git push
)
if errorlevel 1 (
    echo.
    echo [FEHLER] Push fehlgeschlagen. Evtl. vorher "git pull" noetig?
    pause
    exit /b 1
)

echo.
echo ==========================================
echo  Alles committed und gepusht.
echo ==========================================
echo.

rem --- Optional: EXE bauen und als GitHub-Release hochladen --------------
set "REL="
set /p "REL=EXE bauen und als GitHub-Release hochladen? (j/N) "
if /i not "%REL%"=="j" goto done

where gh >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] GitHub CLI ^(gh^) nicht gefunden: https://cli.github.com
    pause
    exit /b 1
)
gh auth status >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] gh ist nicht angemeldet. Einmal "gh auth login" ausfuehren.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "CUR=%%v"
set "VER="
set /p "VER=Version (Enter = %CUR%): "
if not defined VER set "VER=%CUR%"

rem Neue Version: package.json anpassen, committen, pushen
if not "%VER%"=="%CUR%" (
    call npm version "%VER%" --no-git-tag-version >nul
    if errorlevel 1 (
        echo [FEHLER] Ungueltige Version: %VER%
        pause
        exit /b 1
    )
    git add package.json package-lock.json
    git commit -m "Version %VER%"
    git push
)

echo.
echo Baue Purgo.exe ...
call npm run dist
if errorlevel 1 (
    echo.
    echo [FEHLER] Build fehlgeschlagen.
    pause
    exit /b 1
)
if not exist "release\Purgo.exe" (
    echo [FEHLER] release\Purgo.exe wurde nicht erzeugt.
    pause
    exit /b 1
)

set "TAG=v%VER%"
gh release view "%TAG%" >nul 2>&1
if errorlevel 1 (
    echo Erstelle Release %TAG% ...
    gh release create "%TAG%" "release\Purgo.exe" --title "Purgo %VER%" --generate-notes --target "%BRANCH%"
) else (
    echo Release %TAG% gibt es schon - ersetze Purgo.exe ...
    gh release upload "%TAG%" "release\Purgo.exe" --clobber
)
if errorlevel 1 (
    echo.
    echo [FEHLER] Upload zu GitHub fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo Release: & gh release view "%TAG%" --json url -q .url

:done
echo.
echo ==========================================
echo  Fertig!
echo ==========================================
pause