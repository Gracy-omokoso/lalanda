# Lalanda

Lalanda est un SaaS de planification et de pilotage financier destiné aux entrepreneurs et PME (RDC-first, extensible), avec Business Model Canvas dynamique, plan financier 5 ans, prévisionnel/réalisé, Country Packs SYSCOHADA et exports Excel/PDF bancables.

## Démarrage

Prérequis : Node 20, pnpm 9, Docker Desktop.

```bash
corepack enable
pnpm install
docker compose up -d       # MongoDB (replica set), Redis, MinIO
pnpm dev                   # web + api en parallèle
```

Endpoints de santé :

- API : http://localhost:3001/health
- Web : http://localhost:3000

## Documentation

- **Charte produit** : [`docs/00-CHARTE-PRODUIT.md`](docs/00-CHARTE-PRODUIT.md)
- **Décisions** : [`docs/adr/`](docs/adr/) (ADR) + [`docs/decisions.md`](docs/decisions.md) (micro-décisions)
- **Brief fondateur** (source directrice, immuable) : [`sources/brief/lalanda-brief.md`](sources/brief/lalanda-brief.md)
- **Documentation complète** : [`docs/README.md`](docs/README.md)

Claude Code lit aussi [`CLAUDE.md`](CLAUDE.md), qui impose les règles de travail essentielles.

## Structure

```
lalanda/
├── apps/
│   ├── web/               # Next.js 15 + Tailwind + shadcn/ui
│   └── api/               # NestJS 10 + Mongoose (jobs BullMQ inclus)
├── packages/
│   ├── engine/            # Compilateur DSL + moteur (HyperFormula) + export xlsx
│   ├── templates/         # Manifestes YAML + seeds sectoriels
│   ├── shared/            # Types, Zod, Money, env config, logger Pino
│   └── ui/                # Composants partagés shadcn
├── sources/               # Brief et classeur (lecture seule)
├── docs/
└── docker-compose.yml
```

## Principes non négociables

- Une seule source de vérité pour les calculs (`packages/engine`).
- Résultats déterministes, auditables, testés (golden files + round-trip LibreOffice).
- Séparation stricte prévisionnel / scénarios / réalisé.
- L'IA explique et conseille ; **elle ne calcule jamais** les états financiers.
- Country Packs versionnés, datés, sourcés.
- Isolation multi-tenant par `organizationId` de bout en bout.

## Plan d'exécution

Voir [`sources/brief/lalanda-brief.md`](sources/brief/lalanda-brief.md) §11 (S0 → S14). Statut d'avancement dans [`docs/25-SPRINTS.md`](docs/25-SPRINTS.md).
