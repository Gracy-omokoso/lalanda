# @lalanda/templates

Manifestes YAML des templates sectoriels + scripts de seed.

## Statut

**S0** — squelette. Les 3 templates de lancement arrivent en **S6** (brief §11) :

1. `restaurant-kinshasa` — restauration
2. `quincaillerie-negoce` — négoce et distribution
3. `prestation-services` — conseil, agence, freelance

## Rappels (brief §3-4 + §7)

- Un template est une **donnée versionnée en base**, jamais du code. Ajouter un secteur ne doit jamais nécessiter un déploiement.
- Un template publié est **immuable**. Une correction = nouvelle version.
- Chaque manifest passe le validateur Zod du DSL défini dans `@lalanda/engine`.

## Structure attendue

```
src/
├── manifests/
│   ├── restaurant-kinshasa.yaml
│   ├── quincaillerie-negoce.yaml
│   └── prestation-services.yaml
└── seed.ts        # Charge les manifests en MongoDB au bootstrap
```
