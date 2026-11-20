# Roblox AI Builder

Meine eigene Roblox-KI: Spielwelt in Roblox Studio öffnen, ein Klick – und die KI baut die Welt mit
eigenen Modellen und eigenen Skripten in Studio nach.

Alles auf Deutsch, dunkles Design mit blauen und violetten Akzenten, große Buttons.

## Was die App wirklich macht

1. **Anmeldung mit einem Klick** – kein Passwort, keine Formulare. Optional lässt sich eine echte
   Roblox-OAuth-Anmeldung über Zugangsdaten aktivieren (siehe unten).
2. **Roblox Studio erkennen** – ein echtes Roblox-Studio-Plugin (Luau) meldet sich alle 6 Sekunden per
   Heartbeat. Die App zeigt Projektname, Place-ID und Bauteilanzahl live an.
3. **Spiel erkennen** – das Plugin scannt den Workspace (Position, Größe, Farbe, Material, Form) und
   lädt die Welt hoch. Danach erscheint der Dialog **„Möchtest du dieses Spiel nachbauen?“** mit
   **„Ja, nachbauen“** und **„Nein“**.
4. **KI-Nachbau** – die Analyse-Engine erkennt Gebäude, Straßen, Wege, Landschaften, Gegenstände,
   Spielflächen und Grundflächen, gruppiert sie räumlich zu Modellen und erzeugt daraus eigene
   Roblox-Modelle plus passende eigene Luau-Skripte.
5. **Fortschrittsbalken** mit genau diesen fünf Schritten: Spiel wird erkannt · Spielwelt wird
   analysiert · Modelle werden erstellt · Spielwelt wird gebaut · Nachbau ist fertig.
6. **Zurück in Studio** – das Plugin holt den fertigen Bauauftrag ab, legt einen Ordner
   `Roblox AI Builder – Datum` im Workspace an, fügt alle Modelle und Skripte ein, setzt
   Änderungsmarken (Rückgängig möglich) und meldet den Fortschritt zurück. Das Ergebnis ist normal
   bearbeitbar und testbar.

## Schnellstart

```bash
npm install
npm run build      # baut den Client nach dist/
npm start          # Server auf http://localhost:3000
```

Für die Entwicklung: `npm run dev` (Server) und `npx vite` im zweiten Terminal.

## Roblox Studio verbinden

1. In der App den angezeigten **Kopplungscode** kopieren.
2. **Plugin herunterladen**: `/plugin/RobloxAIBuilder.lua` (die Server-Adresse ist bereits eingetragen).
3. Die Datei in den lokalen Roblox-Studio-Plugin-Ordner legen: Studio → Reiter **Plugins** →
   **Plugins Folder** → Datei dort ablegen → Studio neu starten.
4. In Studio: **Home → Game Settings → Security → Allow HTTP Requests** aktivieren.
5. Plugin-Button **Nachbau-Panel** öffnen, Server-Adresse prüfen, Kopplungscode eingeben,
   **Verbinden** drücken.

Sobald die Verbindung steht, scannt das Plugin die geöffnete Welt automatisch. In der Web-App
erscheint der Nachbau-Dialog.

Ohne installiertes Studio lässt sich der komplette Ablauf mit **„Ohne Studio testen (Demo-Welt)“**
durchspielen – dieselbe Engine, derselbe Fortschritt.

## Eigene Inhalte statt Kopien

Der Nachbau entsteht ausschließlich aus Geometrie- und Farbdaten der eigenen Szene:

- keine fremden Modelle, Meshes, Texturen oder Assets,
- keine Übernahme privater oder fremder Skripte,
- Skripte werden als eigene Vorlagen neu erzeugt (Beleuchtung, Spawnpunkt, Checkpoints,
  Tag-/Nachtwechsel, Gegenstandseffekte),
- Bauteile werden auf ein eigenes Raster gerundet und farblich leicht eigenständig abgestimmt.

Die Oberfläche weist darauf hin, dass es ein eigener, ähnlicher Nachbau ist – keine Kopie
geschützter Inhalte.

## Roblox-OAuth (optional)

Ohne Zugangsdaten funktioniert die Ein-Klick-Anmeldung sofort. Für eine echte
Roblox-Konto-Verknüpfung in den Einstellungen (Environment variables) setzen:

- `ROBLOX_CLIENT_ID`
- `ROBLOX_CLIENT_SECRET`
- optional `ROBLOX_REDIRECT_URI` (Standard: `<App-URL>/api/auth/roblox/callback`)

Die Callback-URL muss in der Roblox-App-Registrierung eingetragen sein.

## API-Überblick

| Route | Zweck |
| --- | --- |
| `POST /api/auth/login` | Anmeldung mit einem Klick (Sitzungscookie) |
| `GET /api/auth/me` | aktuelle Sitzung |
| `GET /api/auth/roblox/start` | optionale Roblox-OAuth-Anmeldung |
| `POST /api/pairing` | Kopplungscode für Roblox Studio |
| `POST /api/plugin/pair` | Plugin tauscht Code gegen Token |
| `POST /api/plugin/heartbeat` | Studio-Erkennung |
| `POST /api/plugin/world` | Welt-Scan des Plugins |
| `GET /api/plugin/commands` | Plugin holt Bauauftrag |
| `POST /api/plugin/progress` / `complete` | Baufortschritt aus Studio |
| `GET /api/state` | kompletter App-Zustand (Polling alle 2 s) |
| `POST /api/jobs` / `POST /api/jobs/decline` | „Ja, nachbauen“ / „Nein“ |
| `POST /api/demo/studio` | Demo-Welt ohne Studio |
| `GET /plugin/RobloxAIBuilder.lua` | Plugin-Download mit eingetragener Server-Adresse |

## Tests

```bash
npm test
```

`tests/engine.test.mjs` prüft Analyse und Nachbau-Planer (Kategorien, Grenzen, Farbbereiche,
Determinismus). `tests/api.test.mjs` spielt den kompletten Ablauf durch: Anmeldung, Kopplung,
Welt-Upload, Bestätigungsdialog, Auftragsabholung durch das Plugin, Fortschritt, Abschluss sowie
Ablehnung und Zugriffsschutz.

## Hinweise

- Der Speicher ist in-memory ausgelegt (Sitzungen, Welten, Jobs). Nach einem Neustart des Servers
  muss neu gekoppelt werden.
- Der Workspace-Scan ist auf 2000 Bauteile pro Übertragung begrenzt, um Studio und Netzwerk zu
  schonen.
- Der Fortschritt „Spielwelt wird gebaut“ wird live vom Plugin gemeldet.
