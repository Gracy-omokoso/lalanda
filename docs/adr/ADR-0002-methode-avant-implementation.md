# ADR-0002 — Méthode : présenter le plan avant d'implémenter

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

Deux règles de méthode s'affrontent :

- `CLAUDE.md` du repo : *« Avant d'implémenter, présenter : exigences couvertes, critères d'acceptation, fichiers probables, tests, décisions ouvertes »*.
- Brief §0 : *« Tu ne poses aucune question préalable. Tu ne demandes aucune validation. Tu codes. »*

Le brief §0 était rédigé pour un modèle démarrant sur repo vide sans humain dans la boucle. Le contexte actuel est différent : le porteur du projet est disponible pour trancher, et une matrice d'exigences reste à construire.

## Décision

**`CLAUDE.md` prime sur le brief §0.** Avant toute implémentation non triviale (nouveau module, nouvelle dépendance, nouvelle règle métier), l'agent présente : exigences, critères d'acceptation, fichiers impactés, tests, décisions ouvertes. Il attend un « GO » explicite avant d'écrire du code.

Exception : les corrections triviales, la mise à jour de docs, et l'exécution d'un plan déjà validé peuvent avancer sans nouvelle validation intermédiaire.

## Conséquences

- Chaque sprint commence par un plan validé.
- Les micro-décisions non structurantes (choix d'un nom de variable, ordre des imports…) restent tranchées à la volée et notées dans `docs/decisions.md` si elles ont un impact durable.

## Liens

- `CLAUDE.md`
- `sources/brief/lalanda-brief.md` §0
- ADR-0001
