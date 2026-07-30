# ADR-0001 — Autorité du brief sur `docs/` en cas de contradiction

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

Le repo Lalanda contient deux sources normatives :

- `docs/` — cadrage produit rédigé initialement, principalement en statut *Draft*, avec plusieurs points explicitement « à confirmer par ADR » (14-ARCHITECTURE.md:36, 26-CONVENTIONS.md:24, adr/README.md:22-32).
- `sources/brief/lalanda-brief.md` — brief fondateur du porteur du projet, ultra-directif, qui fige la stack, la structure du monorepo, le plan de sprints et l'écosystème.

Certaines décisions du brief contredisent des propositions ouvertes de `docs/` (structure du monorepo, présence d'un `apps/worker`, découpage des sprints, noms de packages).

`docs/SOURCES-ET-TRACABILITE.md:44-53` impose de ne jamais résoudre silencieusement une contradiction entre sources.

## Options considérées

1. **`docs/` prime, le brief est une source informative.** Impose de re-décider tout ce qui est déjà tranché par le brief.
2. **Le brief prime pour tout ce qu'il tranche, `docs/` prime pour tout le reste.** Chaque écart fait l'objet d'un ADR spécifique.
3. **Fusion manuelle document par document.** Coûteux, source d'incohérences.

## Décision

**Option 2.** Le brief `sources/brief/lalanda-brief.md` fait autorité pour toute décision de stack, structure et planning explicitement tranchée en son sein. `docs/` reste la source de vérité pour la vision, les règles métier, les processus et tout ce que le brief ne couvre pas. Chaque contradiction concrète est enregistrée par un ADR dédié.

## Conséquences

- Les ADR 0002-0009 figent formellement les choix du brief §4.
- `docs/` sera mis à jour progressivement pour s'aligner (retrait des « à confirmer » devenus obsolètes).
- Toute évolution future du brief passera par un nouvel ADR : le brief est **immuable** en tant que source historique.

## Plan de validation

- Créer les ADR 0002-0009.
- Créer `docs/00-CHARTE-PRODUIT.md` référençant le brief comme source directrice.

## Liens

- `sources/brief/lalanda-brief.md`
- `docs/SOURCES-ET-TRACABILITE.md`
- `CLAUDE.md`
