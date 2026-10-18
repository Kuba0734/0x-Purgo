<p align="center">
  <img src="src/ui/icon.png" width="96" alt="Purgo">
</p>

<h1 align="center">Purgo</h1>

<p align="center">
  Apps entfernen, Speicher bereinigen, Windows optimieren – in einer App.<br>
  Dunkles, monochromes Design · Windows 10 / 11 · portable EXE
</p>

<p align="center">
  <a href="https://github.com/Kuba0734/0x-Purgo/releases/latest"><b>⬇ Download (Releases)</b></a>
</p>

---

## Funktionen

### Apps
- **Bulk-Deinstallation** – beliebig viele Programme auf einmal entfernen, mit Fortschritt und Live-Log
- Findet **Desktop-Programme**, **Microsoft-Store-Apps** und **Apps ohne Registry-Eintrag** (Steam- und Epic-Spiele, Ordner mit EXE)
- **Still deinstallieren**, wo möglich (MSI, Inno Setup, NSIS, Silent-Befehl des Herstellers), sonst mit Hersteller-Dialog
- **Reste entfernen** – sucht danach zugehörige Ordner, Verknüpfungen und Registry-Schlüssel auf allen Laufwerken; vor dem Löschen gibt es eine Vorschau
- Hängender Uninstaller? **Überspringen** per Klick
- Filter nach Typ und Laufwerk, Sortierung nach Name, Größe, Datum, Herausgeber

### Speicher
- Belegung aller Laufwerke
- **Sicher bereinigen**: Temp-Dateien, Papierkorb, Windows-Update-Cache, Browser-Caches (Logins bleiben), GPU-/Shader-Caches, Absturzberichte, Thumbnail-Cache, Windows.old, alte Systemkomponenten (DISM)
- **Reste deinstallierter Apps** – verwaiste Ordner, Registry-Schlüssel, kaputte Verknüpfungen und Programm-Einträge
- **Große Dateien finden** – gelöschte Dateien landen im Papierkorb

### Optimieren
- **Bloatware entfernen** (vorinstallierte Store-Apps, Microsoft-Extras, Widgets, OneDrive), optional mit Schutz vor Neuinstallation
- **Datenschutz**: Telemetrie, Werbung & Tipps, Bing-Websuche, Copilot & Recall
- **Leistung**: Energieplan „Ultimative Leistung“, Gaming-Tweaks, visuelle Effekte
- **Explorer**: Dateiendungen, versteckte Dateien, klassisches Kontextmenü
- **Dienste** einzeln abschalten
- **Autostart-Manager** – wie im Task-Manager, Programme bleiben installiert
- Jeder Schalter ist **umkehrbar**: Die ursprünglichen Registry-Werte werden vorher gesichert

## Installation

1. Neueste `Purgo.exe` unter [**Releases**](https://github.com/Kuba0734/0x-Purgo/releases/latest) herunterladen
2. Starten – keine Installation nötig. Purgo fragt per UAC nach Adminrechten (für Deinstallationen und System-Tweaks nötig)

> Die EXE ist nicht signiert. Windows SmartScreen warnt deshalb beim ersten Start: **Weitere Informationen → Trotzdem ausführen**.

## Wichtig zu wissen

- Reste-Ordner und Registry-Schlüssel werden **endgültig** gelöscht, nicht in den Papierkorb. Prüfe die Vorschau, vor allem bei „bitte prüfen“-Treffern.
- Die Reste-Suche arbeitet mit Namensabgleich. Systemordner, Treiber und bekannte Windows-Komponenten sind geschützt, Fehltreffer sind trotzdem möglich.
- Manche Optimierungen wirken erst nach einem Neustart oder Explorer-Neustart.
- Die Widgets-Richtlinie lässt sich wegen des Windows-Schutzdienstes **UCPD** nicht per Registry setzen – Widgets entfernst du deshalb über die Bloatware-Liste.

## Entwicklung

Voraussetzung: [Node.js](https://nodejs.org) 18 oder neuer, Windows.

```bash
npm install        # Abhängigkeiten
npm start          # App starten (fragt nach Adminrechten)
npm start -- --no-elevate   # ohne Adminrechte starten
npm test           # Selbsttest der Sicherheits- und Befehlslogik
npm run dist       # portable EXE nach release/Purgo.exe bauen
```

`deploy.bat` committet, pusht und kann danach die EXE bauen und als GitHub-Release hochladen (braucht die [GitHub CLI](https://cli.github.com)).

### Aufbau

| Datei | Inhalt |
|---|---|
| `main.js` | Electron-Hauptprozess, IPC, Adminrechte |
| `preload.js` | Schnittstelle zwischen Oberfläche und Hauptprozess |
| `uninstaller.js` | App-Liste, Deinstallation, Reste-Suche, Schutzlisten |
| `cleaner.js` | Bereinigungs-Kategorien, große Dateien |
| `optimizer.js` | Bloatware, Registry-Tweaks mit Rückgängig, Energieplan, Autostart |
| `src/ui/` | Oberfläche (HTML, CSS, JS), Design-Tokens in `tokens.css`, Schrift Inter |
| `tools/make-icon.js` | erzeugt das App-Icon |
| `test.js` | Tests für Pfad-/Registry-Schutz und Uninstall-Befehle |

## Danksagung

- Schrift [Inter](https://github.com/rsms/inter) von Rasmus Andersson, lizenziert unter der SIL Open Font License 1.1 (`src/ui/fonts/OFL-LICENSE.txt`)
- Gebaut mit [Electron](https://www.electronjs.org) und [electron-builder](https://www.electron.build)
