# ADR-0009 — Infrastructure : DigitalOcean + Caddy + Docker + GitHub Actions

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

Le brief §4 impose **Docker + DigitalOcean + Caddy + GitHub Actions**. `docs/24-INFRASTRUCTURE.md` ne fixait pas le fournisseur. Le stockage objet est **DigitalOcean Spaces** (compatible S3).

## Décision

- **Runtime containers** : Docker (Dockerfiles multi-stage par service).
- **Hébergement** : DigitalOcean (Droplets pour app + Spaces pour stockage objet).
- **Reverse proxy + TLS** : Caddy (HTTPS automatique).
- **CI/CD** : GitHub Actions (lint, typecheck, tests unitaires + round-trip LibreOffice, build, déploiement).
- **File d'attente** : BullMQ sur **Redis** (Managed DO ou container).
- **Stockage objet** : DigitalOcean Spaces via `@aws-sdk/client-s3`.
- **Résidence des données** : région Amsterdam (`ams3`) par défaut, à réévaluer si résidence Afrique disponible.
- **Environnements** : `local` (docker compose), `staging` (Droplet dédié), `production` (Droplet dédié) — `docs/24-INFRASTRUCTURE.md:6-11`.

## Conséquences

- Le `docker-compose.yml` de S0 démarre MongoDB (replica set), Redis, et MinIO (mock Spaces en local).
- Le workflow CI installe LibreOffice pour les golden files (ADR-0007).
- Les secrets (`OPENAI_API_KEY`, `MONGODB_URI`, credentials Spaces, PawaPay, Stripe, PayPal) sont dans les secrets GitHub et jamais commités.

## Liens

- `sources/brief/lalanda-brief.md` §4
- `docs/24-INFRASTRUCTURE.md`
- `docs/17-SECURITE.md`
