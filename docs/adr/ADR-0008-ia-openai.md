# ADR-0008 — Fournisseur IA : OpenAI (override du brief)

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

Le brief §4 impose l'**API Anthropic (Claude)**. Gracy Omokoso a explicitement demandé le 2026-07-30 d'utiliser **l'API OpenAI** à la place.

## Décision

- **Fournisseur** : OpenAI Platform API.
- **Modèles par défaut** :
  - **`gpt-4o`** pour tâches de raisonnement : proposition de valeurs de drivers, rédaction du mémo stratégique, aide contextuelle riche.
  - **`gpt-4o-mini`** pour tâches légères : reformulation, tooltips, aides courtes.
- Le choix concret par cas d'usage sera codé dans `packages/shared/src/ai/models.ts` avec possibilité de surcharge par variable d'environnement.

## Règles inchangées (brief §11 S10 + §12)

- **L'IA propose, elle ne calcule jamais.**
- Toute valeur produite par l'IA est marquée `origin: 'ai'` et modifiable.
- Aucune valeur produite par un LLM n'est jamais consommée directement par le moteur financier.
- Aucun secret, aucun classeur complet, aucun prompt avec données inutiles dans les logs (`docs/17-SECURITE.md:60`).

## Configuration

- Clé API stockée dans `OPENAI_API_KEY` (variable d'environnement), validée par Zod au démarrage.
- Jamais commitée. `.env.example` documente la variable, `.env` local et secrets GitHub Actions portent la valeur réelle.
- Rate limiting côté serveur pour maîtriser le coût.

## Conséquences

- Le package SDK utilisé est `openai` (npm).
- Un ADR ultérieur pourra ajouter un fournisseur de secours (Claude, Mistral) si nécessaire pour la résilience.
- Le brief §4 est **superseded** sur ce point ; le reste du brief §4 reste applicable.

## Liens

- `sources/brief/lalanda-brief.md` §4, §11 S10, §12
- `docs/11-ANALYTICS-IA.md`
- `docs/17-SECURITE.md`
