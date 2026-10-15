# Mijn Eten

Persoonlijke voedings- en calorie-app (PWA, Nederlands, iPhone-first). Vanilla JS, geen build-stap.

- **Dagboek**: ontbijt, lunch, diner, tussendoortjes; kcal-ring en balken voor eiwit, koolhydraten en vet; datumnavigatie.
- **Zoeken** in Open Food Facts (NL/BE-producten eerst), **barcode scannen** (ZXing, lokaal in `vendor/`), **zelf invoeren** (per 100 g of per portie), **snel kcal**.
- **Recent / favorieten / mijn producten**, **water**, **gewicht** met grafiek, 7-daags gemiddelde en prognose.
- **Profiel**: BMR (Mifflin-St Jeor), TDEE, doel (afvallen / op gewicht blijven / aankomen) met tempo; alle doelen handmatig aan te passen.
- **Login + sync** via Supabase (zelfde project als Mijn Geld, tabellen `eten_*`, RLS per account). Werkt ook offline.
- **Foto herkennen**: voorbereid via `window.MijnEtenPhotoRecognizer` (zie app.js), niet gebouwd (vereist betaalde AI-dienst).

## Publiceren (GitHub Pages)
1. Draai `mijn-eten.sql` één keer in de Supabase SQL Editor.
2. Supabase → Authentication → URL Configuration → Redirect URLs: voeg `https://nasodijones.github.io/mijn-eten/` toe.
3. Maak repo `NasoDiJones/mijn-eten`, upload alle bestanden uit deze map (incl. `.nojekyll`), zet Pages aan op branch `main` / root.
4. Open `https://nasodijones.github.io/mijn-eten/` in Safari → Deel → "Zet op beginscherm".

Bij elke nieuwe versie: `CACHE` in `sw.js` ophogen (`mijn-eten-v2`, …) en `VERSION` in `app.js`.

Voedingsdata: © Open Food Facts-bijdragers, ODbL. Barcode-bibliotheek: ZXing-js (Apache 2.0, zie `vendor/zxing-LICENSE.txt`).
