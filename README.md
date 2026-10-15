# Mijn Eten

Persoonlijke voedings- en calorie-app (PWA, Nederlands, iPhone-first). Vanilla JS, geen build-stap.

- **Dagboek**: ontbijt, lunch, diner, tussendoortjes; kcal-ring en balken voor eiwit, koolhydraten en vet; datumnavigatie.
- **Zoeken** in Open Food Facts (alleen Nederlandse producten, `countries_tags` = en:netherlands; barcode zoekt overal), **barcode scannen** (ZXing, lokaal in `vendor/`), **zelf aanmaken** (per 100 g of per portie), **snel kcal**.
- **Zoeken robuust** (v3): alleen op Zoek-knop (min. 2 letters), resultaten 12 uur gecachet, max. 8 OFF-zoekverzoeken per minuut, 1 herkansing, time-out 15 s, oude zoekopdracht wordt afgebroken. Ingelogd eerst via Supabase-functie `eten_off_search` (search.openfoodfacts.org, snel; geeft geen CORS-header aan browsers), anders/daarna `cgi/search.pl`. Aparte meldingen voor offline / OFF druk / te vaak gezocht.
- **Basisproducten (NEVO)** (v5): `data/nevo.json` = NEVO-online versie 2025/9.0 (RIVM), 2.328 producten, waarden ongewijzigd (naam, synoniem, groep, kcal, eiwit, koolhydraten, vet, vezel per 100 g/ml). Wordt bij de eerste zoekopdracht geladen, werkt offline (service-worker-cache) en staat boven de Open Food Facts-resultaten. Portiegroottes (`p`) zijn schattingen van Mijn Eten, geen NEVO-gegevens. Opnieuw bouwen: `/workspace/nevo/build.py`. Bron: NEVO-online versie 2025/9.0, RIVM, Bilthoven.
- **Recent / favorieten / mijn producten**, **water**, **gewicht** met grafiek, 7-daags gemiddelde en prognose.
- **Profiel**: BMR (Mifflin-St Jeor), TDEE, doel (afvallen / op gewicht blijven / aankomen) met tempo; alle doelen handmatig aan te passen.
- **Login + sync** via Supabase (zelfde project als Mijn Geld, tabellen `eten_*`, RLS per account). Werkt ook offline.
- **Foto herkennen**: voorbereid via `window.MijnEtenPhotoRecognizer` (zie app.js), niet gebouwd (vereist betaalde AI-dienst).

## Publiceren (GitHub Pages)
1. Draai `mijn-eten.sql` één keer in de Supabase SQL Editor (en `mijn-eten-backups.sql`, `mijn-eten-zoeken.sql`).
2. Supabase → Authentication → URL Configuration → Redirect URLs: voeg `https://nasodijones.github.io/mijn-eten/` toe.
3. Maak repo `NasoDiJones/mijn-eten`, upload alle bestanden uit deze map (incl. `.nojekyll`), zet Pages aan op branch `main` / root.
4. Open `https://nasodijones.github.io/mijn-eten/` in Safari → Deel → "Zet op beginscherm".

Bij elke nieuwe versie: `CACHE` in `sw.js` ophogen (`mijn-eten-v2`, …) en `VERSION` in `app.js`.

Voedingsdata: NEVO-online versie 2025/9.0, RIVM, Bilthoven (ongewijzigd; geen kosten voor gebruik toegestaan) en © Open Food Facts-bijdragers, ODbL. Barcode-bibliotheek: ZXing-js (Apache 2.0, zie `vendor/zxing-LICENSE.txt`).
