# Architecture Decision Records

Les décisions structurantes sont enregistrées dans ce dossier.

## Format

```markdown
# ADR-NNN — Titre

Statut : Proposed | Accepted | Superseded
Date :
Décideurs :

## Contexte
## Options considérées
## Décision
## Conséquences
## Plan de validation
## Liens
```

## Décisions récentes

- [ADR-0030](ADR-0030-refonte-ui-ux.md) — refonte de l'interface (amendé par ADR-0038).
- [ADR-0038](ADR-0038-navigation-par-modules-et-initiatives.md) — navigation par modules
  (accueil, bureaux, colonne d'applications) et renommage « Initiative » — **Accepté**, 29 oct. 2026.

## Premières décisions attendues

- architecture du monorepo;
- base de données principale;
- moteur de formules;
- authentification;
- fournisseur de paiement;
- file de tâches et stockage;
- hébergement et résidence;
- fournisseur IA et politique de données;
- stratégie de génération PDF/Excel.

## Décisions récentes (RUN)

- [ADR-0039](ADR-0039-projets-et-taches-run.md) — Projets et tâches (RUN) : gestionnaire de
  travail (module interne `work`), notifications in-app communes, marge par projet calculée par
  le moteur. Statut : Proposed (29 oct. 2026).
- [ADR-0040](ADR-0040-crm-complet.md) — CRM complet (R2) : application RUN `/crm`, comptes
  360°, pipeline v2, relances dans « Mes tâches », rapports, rôle Commercial et action
  `sales.quote`. Statut : **proposé** (29 oct. 2026).
