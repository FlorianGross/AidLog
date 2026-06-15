# Mobile / Native Apps (Android & iOS)

Aidlog kann als **native App für Android und iOS** ausgeliefert werden. Die
native App ist eine dünne [Capacitor](https://capacitorjs.com/)-Hülle um genau
denselben zero-knowledge Web-Client (`apps/web`) — es gibt **keine zweite
Codebasis**. Die statischen Assets werden in die App gebündelt, laufen offline
und reden mit demselben selbst-gehosteten API-Server wie die PWA.

> Die reine Web-/PWA-Auslieferung bleibt davon **unberührt**. Solange weder
> `VITE_API_BASE_URL` noch `VITE_RUNTIME_API_CONFIG` gesetzt ist, ist der
> Web-Build Byte-für-Byte identisch zu vorher.

---

## Was du bekommst

- **Android**: installierbare App, Verteilung über den Play Store (AAB) oder als
  signiertes APK (Seitenladen / MDM).
- **iOS**: installierbare App, Verteilung über App Store / TestFlight via Xcode.
- Beide umschließen denselben **zero-knowledge** Client: Ver-/Entschlüsselung
  passieren ausschließlich auf dem Gerät, der Server sieht nur Chiffrat.
- **Offline-fähig**: die App-Shell (inkl. libsodium-WASM) ist lokal gebündelt,
  Daten liegen verschlüsselt in IndexedDB.
- Läuft aus einem **Secure Context** (Android `https://localhost`, iOS
  `capacitor://localhost`) — Voraussetzung für `crypto.subtle` und das
  libsodium-WASM-Modul.

---

## Voraussetzungen

| Ziel    | Benötigt                                                                         |
| ------- | -------------------------------------------------------------------------------- |
| Android | [Android Studio](https://developer.android.com/studio) + Android SDK + JDK (17+) |
| iOS     | Ein **Mac** mit **Xcode** und **CocoaPods** (`sudo gem install cocoapods`)       |

Node 20+ und pnpm 9 (`corepack enable`) wie im Haupt-README.

> **Hinweis Bauumgebung:** Das Repo ist bereits build-ready konfiguriert und das
> `android/`-Projekt wurde mit `cap add android` erzeugt. Der **finale signierte
> Build** (APK/AAB bzw. IPA) erfolgt auf deiner Maschine mit installiertem
> Android SDK bzw. auf einem Mac — er ist nicht Teil des CI.

---

## Schritt 1 (kritisch): Server-Konfiguration

Die native App lädt ihre Oberfläche aus einem **lokalen** Origin, der API-Server
liegt aber auf einem **entfernten** Host — das ist aus Sicht des WebViews
**cross-origin**. Es gibt zwei Wege, der App den Server bekannt zu machen:

### Empfohlen: Server bei der **ersten Nutzung** festlegen (kein Rebuild pro Server)

Setze **eine** Build-Flag und lass die Server-Adresse die Nutzerin/den Nutzer
beim **ersten App-Start** eingeben:

```bash
export VITE_RUNTIME_API_CONFIG=1
```

Damit gilt:

1. Beim ersten Start zeigt die App einen Bildschirm **„Server festlegen"**
   (`/server`), auf dem die Server-Adresse eingegeben und getestet wird. Sie wird
   **lokal** auf dem Gerät gespeichert (nicht-geheime Betriebskonfiguration, kein
   Schlüsselmaterial) und kann später jederzeit geändert werden
   (`apps/web/src/lib/config/serverUrl.ts`).
2. Der Build weitet die CSP-Direktive `connect-src` auf **jeden `https:`-Origin**
   aus (siehe `apps/web/svelte.config.js`), da der konkrete Origin zur Build-Zeit
   noch nicht feststeht. TLS wird erzwungen — der WebView läuft in einem Secure
   Context und blockiert ohnehin Klartext-HTTP.

So lässt sich **ein** signiertes Binary an **beliebige** selbst-gehostete Server
verteilen, ohne pro Server neu zu bauen.

### Alternative: Server-URL fest einbacken (ein Server pro Build)

```bash
export VITE_API_BASE_URL=https://aidlog.example.org
```

Das bewirkt zwei Dinge gleichzeitig:

1. Der Client schickt seine `fetch`-Aufrufe an `https://aidlog.example.org/api/...`
   (siehe `apps/web/src/lib/api.ts`). Der „Server festlegen"-Bildschirm entfällt.
2. Der Build trägt **genau diesen** Origin in die CSP-Direktive `connect-src`
   ein (engste Variante).

Belegt durch drei Builds:

```text
# ohne Env (Web/PWA):
connect-src 'self'
# mit VITE_API_BASE_URL=https://aidlog.example.org (fest):
connect-src 'self' https://aidlog.example.org
# mit VITE_RUNTIME_API_CONFIG=1 (Laufzeit-Konfig):
connect-src 'self' https:
```

> Wird ein Wert zur Laufzeit gesetzt, hat er Vorrang vor einem eingebackenen
> `VITE_API_BASE_URL`.

> **Vor Veröffentlichung:** In `apps/web/capacitor.config.ts` `appId`
> (`org.aidlog.app`) und `appName` auf deine eigene Reverse-DNS-ID / Markenname
> ändern. `org.aidlog.app` ist nur ein neutraler Platzhalter.

---

## Schritt 2: Android bauen

```bash
# einmalig: natives Projekt erzeugen (falls android/ noch nicht existiert)
corepack pnpm --filter @aidlog/web cap:add:android

# bei jeder Änderung am Web-Client: bauen + in die native App synchronisieren
# empfohlen: Server-Konfiguration zur Laufzeit (Nutzer wählt beim ersten Start)
export VITE_RUNTIME_API_CONFIG=1
# ODER fest einbacken: export VITE_API_BASE_URL=https://aidlog.example.org
corepack pnpm --filter @aidlog/web cap:sync

# Android Studio öffnen
corepack pnpm --filter @aidlog/web cap:android
```

In Android Studio dann: **Build → Generate Signed Bundle / APK** → Keystore
anlegen/wählen → AAB (für Play Store) oder APK erzeugen.

`cap:sync` führt `vite build` aus **und** kopiert das frische `build/` in das
native Projekt. Die jeweilige Env (`VITE_RUNTIME_API_CONFIG` **oder**
`VITE_API_BASE_URL`) muss also bei `cap:sync` gesetzt sein.

---

## Schritt 3: iOS bauen (nur auf einem Mac)

iOS erfordert macOS, Xcode und CocoaPods — auf Windows/Linux **nicht möglich**.

```bash
# auf einem Mac, im Repo:
corepack enable
pnpm install

export VITE_RUNTIME_API_CONFIG=1                    # Server beim ersten Start wählen
# ODER fest: export VITE_API_BASE_URL=https://aidlog.example.org
corepack pnpm --filter @aidlog/web cap:add:ios     # einmalig
corepack pnpm --filter @aidlog/web cap:sync
corepack pnpm --filter @aidlog/web cap:ios          # öffnet Xcode
```

In Xcode: **Signing & Capabilities** → Team und Bundle Identifier setzen →
**Product → Archive** → über den Organizer an App Store Connect / TestFlight
verteilen.

---

## Konfiguration im Überblick

- `apps/web/capacitor.config.ts` — `appId`, `appName` (aus `branding.ts`),
  `webDir: 'build'`, Android-`scheme: 'https'`. **Kein** `server.url` — die App
  bündelt die statischen Assets und ruft die API cross-origin.
- `apps/web/svelte.config.js` — leitet den CSP-`connect-src` aus
  `VITE_API_BASE_URL` (fester Origin) bzw. `VITE_RUNTIME_API_CONFIG` (→ `https:`)
  ab (defensiv geparst).
- `apps/web/src/lib/config/serverUrl.ts` — Laufzeit-Server-URL: Auflösung
  (Laufzeit → Build-Zeit → same-origin), Validierung, Persistenz. Die Route
  `apps/web/src/routes/server/+page.svelte` ist der „Server festlegen"-Bildschirm.
- `apps/web/package.json` — Scripts `cap:sync`, `cap:add:android`,
  `cap:add:ios`, `cap:android`, `cap:ios`.
- `.gitignore` — `apps/web/android/` und `apps/web/ios/` sind ignoriert (groß,
  plattformspezifisch, jederzeit per `cap add` / `cap sync` regenerierbar). Eine
  Organisation, die native Signing-/Konfig-Anpassungen vornimmt, kann diese
  Verzeichnisse später bewusst einchecken.

---

## Ehrliche Einschränkungen / Hinweise

- **libsodium (WASM)** braucht einen Secure Context (Android `https://localhost`,
  iOS `capacitor://localhost` — beide konfiguriert) und CSP `wasm-unsafe-eval`
  (bereits gesetzt). Beides ist vorhanden.
- **Service Worker / PWA-Precache** ist innerhalb der nativen Hülle redundant
  (die Assets liegen bereits lokal). Das ist unkritisch und kann so bleiben.
  Falls es zu Update-/Caching-Eigenheiten kommt, kann der SW für native Builds
  deaktiviert werden.
- **Web Push** funktioniert im WebView **nicht** zuverlässig wie in einer
  Browser-PWA. Das vorhandene VAPID-Web-Push ist für die Browser-/PWA-Variante.
  Für verlässliche **native** Benachrichtigungen `@capacitor/push-notifications`
  (FCM auf Android, APNs auf iOS) ergänzen — außerhalb des aktuellen Umfangs,
  klarer Ausbaupfad.
- **Kamera / QR**: Der Browser-`BarcodeDetector` fehlt evtl. in iOS-WKWebView.
  Die manuelle Code-Eingabe funktioniert bereits; ein nativer Scanner
  (`@capacitor/barcode-scanner` o. ä.) ist der Ausbaupfad.
- **Speicher-Haltbarkeit**: In der Capacitor-WebView ist IndexedDB haltbarer als
  in einem mobilen Browser-Tab (mildert iOS-Eviction). Für gehärtete
  Schlüsselablage später ggf. `@capacitor/preferences` / Secure Storage prüfen.
- **Blobs**: Aidlog lädt Blobs über die same-origin API (`/api/blobs/...`) — kein
  zusätzlicher CSP-Origin nötig. Falls eine Organisation Blobs über **direkte /
  presigned MinIO-URLs** ausliefert, muss dieser Origin zusätzlich in
  `connect-src` **und** `img-src` in `apps/web/svelte.config.js` aufgenommen
  werden.
