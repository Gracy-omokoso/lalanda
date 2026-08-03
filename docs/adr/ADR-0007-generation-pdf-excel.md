# ADR-0007 — Génération PDF/Excel : ExcelJS + Puppeteer + SheetJS

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

Le brief §4 impose :
- **ExcelJS** pour la génération `.xlsx` (formules natives, styles, validation, graphiques).
- **SheetJS (`xlsx`)** pour la lecture et le diff à l'import.
- **Puppeteer** pour le rendu HTML → PDF.

`docs/23-RAPPORTS-EXPORTS.md` et brief §11 S8 précisent la mise en page attendue par les banques RDC (Rawbank, Equity BCDC, TMB, PADMPME).

## Décision

- **Écriture Excel** : ExcelJS avec formules Excel natives (aucun nombre en dur, brief §3-2).
- **Lecture Excel** : SheetJS pour l'import et la détection des cellules modifiées (brief §11 S11).
- **PDF** : Puppeteer (rendu Next.js dédié → PDF) exécuté en tâche BullMQ.
- **Validation** : test de round-trip via **LibreOffice headless** (`soffice --headless --convert-to csv`) en CI, tolérance 0,01 (brief §10).

## Conséquences

- La CI installe `libreoffice-calc` et `puppeteer` (Chromium managé).
- Les golden files vivent dans `packages/engine/__golden__/<slug>/`.
- Ces choix rendent le CI plus lent (installation LibreOffice + Chromium) — acceptable, gain fiabilité produit majeur.

## Alternative rejetée

**ExcelJS + Playwright** — Playwright a un runner de test plus riche mais Puppeteer est spécifié par le brief et suffit pour le rendu PDF unique.

## Liens

- `sources/brief/lalanda-brief.md` §4, §10, §11 S2/S8/S11
- `docs/23-RAPPORTS-EXPORTS.md`
- `docs/18-TESTS.md`
