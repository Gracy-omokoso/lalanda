# ADR-0003 — Monorepo pnpm workspaces + Turborepo

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

Le brief §4 impose **pnpm workspaces + Turborepo**. `docs/26-CONVENTIONS.md:24` prévoyait de confirmer la structure par ADR S1.

## Décision

- **Gestionnaire de paquets** : `pnpm` ≥ 9 (activé via `corepack`, version épinglée dans `package.json > packageManager`).
- **Orchestrateur de tâches** : Turborepo ≥ 2.
- **Node** : 20 LTS (fixé par `.nvmrc` et `engines`).

## Structure retenue

La structure du brief §4 s'écarte de la proposition initiale de `docs/26-CONVENTIONS.md:7-22`. On applique celle du brief :

```
lalanda/
├── apps/
│   ├── web/               # Next.js 15
│   └── api/               # NestJS 10 (jobs BullMQ inclus, pas de worker séparé)
├── packages/
│   ├── engine/            # DSL + moteur de calcul + générateur xlsx
│   ├── templates/         # Manifestes YAML + seeds
│   ├── shared/            # Types, schémas Zod, Money, constantes, env
│   └── ui/                # Composants partagés (shadcn)
├── sources/               # Brief et classeur (lecture seule)
├── docs/
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

Écarts documentés vs `docs/26-CONVENTIONS.md` :

| Docs | Brief (retenu) | Motif |
|---|---|---|
| `packages/domain` | fusionné dans `packages/shared` + `packages/engine` | Le brief définit `shared` (types/Zod) et `engine` (métier + calcul). |
| `packages/financial-engine` | `packages/engine` | Simplification. |
| `packages/country-packs` | intégré à `packages/engine` (data) et `packages/templates` (manifestes) | Cohérent avec la vue « données versionnées en base ». |
| `packages/contracts` | à créer si besoin explicite dans un sprint ultérieur | Non requis en S0. |
| `packages/config` | intégré à `packages/shared` (env Zod) | Simplification. |
| `apps/worker` | supprimé, jobs BullMQ dans `apps/api` | Brief §4. |

## Conséquences

- `docs/26-CONVENTIONS.md` sera mis à jour pour refléter cette structure (patch séparé).
- Chaque nouveau package requiert un ADR.

## Liens

- `sources/brief/lalanda-brief.md` §4
- `docs/26-CONVENTIONS.md`
