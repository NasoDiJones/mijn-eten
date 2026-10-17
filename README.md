# Mijn Eten

Persoonlijke voedings- en calorie-app (PWA, Nederlands, iPhone-first). Vanilla JS, geen build-stap.

- **Dagboek**: ontbijt, lunch, diner, tussendoortjes; kcal-ring en balken voor eiwit, koolhydraten en vet; datumnavigatie.
- **Zoeken** in Open Food Facts (alleen Nederlandse producten, `countries_tags` = en:netherlands; barcode zoekt overal), **barcode scannen** (ZXing, lokaal in `vendor/`), **zelf aanmaken** (per 100 g of per portie), **snel kcal**.
- **Zoeken robuust** (v3): alleen op Zoek-knop (min. 2 letters), resultaten 12 uur gecachet, max. 8 OFF-zoekverzoeken per minuut, 1 herkansing, time-out 15 s, oude zoekopdracht wordt afgebroken. Ingelogd eerst via Supabase-functie `eten_off_search` (search.openfoodfacts.org, snel; geeft geen CORS-header aan browsers), anders/daarna `cgi/search.pl`. Aparte meldingen voor offline / OFF druk / te vaak gezocht.
- **Basisproducten (NEVO)** (v5): `data/nevo.json` = NEVO-online versie 2025/9.0 (RIVM), 2.328 producten, waarden ongewijzigd (naam, synoniem, groep, kcal, eiwit, koolhydraten, vet, vezel en sinds v9 suikers (`SUGAR`, mono- en disachariden) per 100 g/ml). Wordt bij de eerste zoekopdracht geladen, werkt offline (service-worker-cache) en staat boven de Open Food Facts-resultaten. Portiegroottes (`p`) zijn schattingen van Mijn Eten, geen NEVO-gegevens. Opnieuw bouwen: `/workspace/nevo/build.py`. Bron: NEVO-online versie 2025/9.0, RIVM, Bilthoven.
- **Aantal** (v6): op het portiescherm een stepper (− / +, halven, ook typen) zodat je bijv. 3 × 35 g of 3 × snee in één keer toevoegt. Dagboekregel bewaart `grams` (totaal), `qty` (totaal), `count`, `unitQty` en `unitGrams`; oude regels zonder `count` tellen als 1 ×. Laatst gebruikte portie (eenheid, hoeveelheid, aantal) wordt per product onthouden (`lastPortion`). Bij Zelf aanmaken kun je een portie opgeven (bijv. snee = 35 g).
- **Widget** (v7, aangepast in v8): `widget/mijn-eten-widget.js` is een script voor de gratis iOS-app **Scriptable** (klein, middel en vergrendelscherm). Toont gegeten / doel / over (rood bij te veel), ring en (middel) eiwit/koolh./vet, licht en donker. Eén keer inloggen in Scriptable met het Mijn Eten-account (`grant_type=password`); alleen het verversingstoken staat in de Scriptable-sleutelhanger, niet het wachtwoord. Alleen de publieke anon-sleutel; RLS geeft ieder alleen zijn eigen `eten_*`-rijen. Zelfde rekenlogica als `calc`/`targets` in app.js. Tikken opent nooit Safari of een website (v8 / widget v2): de widget-URL is `scriptable:///run/<naam>?actie=ververs`; Scriptable opent even, haalt de cijfers stil op (geen menu) en is klaar. Middel: "⚡ Snel kcal toevoegen" draait het script (`scriptable:///run/<naam>?actie=snel`) en schrijft direct een snel-kcal-regel in `eten_diary`. Geen widget-parameter meer (de experimentele `webapp`-optie is weg). Offline: laatste stand van vandaag met "offline · uu:mm". Uitleg + kopieerknop op Profiel.
- **Deep links** (v7): `?actie=toevoegen` (of `#toevoegen`) opent het zoek/toevoegscherm voor de maaltijd van nu, `?actie=snel` Snel kcal, `?actie=scan` de barcode-scanner. Wordt daarna uit de adresbalk gehaald; zonder profiel wacht het tot na inloggen. De widget gebruikt deze links niet meer (een widget kan alleen Safari openen, niet de beginscherm-app); ze blijven bruikbaar voor handmatige links.
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
- **Dagboek-koppen** (v9): maaltijdkop als getinte balk met icoon, grote titel, kcal groot en vet in groen, macro's als chips (E/K/V/S). De knop "Toevoegen aan …" staat direct onder de kop, boven de producten.
- **Suiker** (v9): "Waarvan suikers" (g) bij zelf aanmaken/bewerken en snel kcal; uit Open Food Facts (`sugars_100g`) en NEVO (`SUGAR`). Zichtbaar in zoekresultaten, portiescherm, dagboekregels, maaltijdchips en dagtotaal. Opslag in de bestaande `data`-JSON-kolom (`per100.sugar`, `sugar`), dus geen SQL nodig. Onbekend = `null` (oude regels): toont "–"; een deels bekend totaal krijgt een "*".
