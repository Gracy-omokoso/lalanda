# API

**Statut :** Draft  
**Version :** 0.1

## Principes

- API versionnée;
- contrats typés et documentés;
- validation stricte;
- erreurs stables;
- pagination par curseur;
- idempotence pour calculs, imports, paiements et exports;
- autorisation côté serveur;
- identifiant de corrélation.

## Ressources principales

```text
/v1/organizations
/v1/organizations/{id}/members
/v1/projects
/v1/projects/{id}/canvas
/v1/projects/{id}/objectives
/v1/projects/{id}/scenarios
/v1/scenarios/{id}/inputs
/v1/scenarios/{id}/calculations
/v1/plans/{id}
/v1/projects/{id}/actual-periods
/v1/projects/{id}/analytics
/v1/projects/{id}/reports
/v1/country-packs
/v1/admin/country-packs
/v1/subscriptions
/v1/audit-events
```

## Calcul

`POST /v1/scenarios/{id}/calculations`

Entrée : version d’entrées, granularité, clé d’idempotence.  
Sortie : tâche ou résultat, version moteur, avertissements et identifiant.

Le serveur refuse une version obsolète ou incohérente.

## Validation du plan

`POST /v1/calculations/{id}/approve`

Exige la permission, une confirmation des avertissements autorisés et crée un plan immuable.

## Imports

1. créer un lot;
2. envoyer le fichier;
3. prévisualiser le mapping;
4. valider;
5. traiter;
6. consulter erreurs et résultats;
7. annuler le lot si possible.

## Erreurs

```json
{
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "Certaines données sont invalides.",
    "details": [],
    "correlationId": "..."
  }
}
```

Les messages ne divulguent ni secrets ni ressources d’une autre organisation.

## Copilote IA — actions correctives (S14a)

`POST /ai/corrective-actions`

Entrée :

```json
{
  "templateSlug": "prestation-services",
  "drivers": { "prix_jour": 500 },
  "devise": "USD",
  "lines": [
    {
      "sheetId": "ratios",
      "lineId": "dscr",
      "label": "DSCR (couverture du service de la dette)",
      "value": 0.9,
      "format": "number",
      "seuil": { "valeur": 1.25, "direction": "min", "statut": "rouge" }
    }
  ]
}
```

Sortie :

```json
{
  "source": "fallback",
  "actions": [
    {
      "ratio": "dscr",
      "severity": "rouge",
      "suggestion": "Réduire le service de la dette ou renforcer l'EBE …",
      "expected_impact": "Amener le DSCR à au moins 1,25 (actuellement 0,90)."
    }
  ]
}
```

Contraintes :

- l’IA ne recalcule rien et ne modifie aucune feuille officielle;
- 0 à 4 actions retournées, priorisées rouge → orange;
- fallback déterministe automatique si `OPENAI_API_KEY` est absente ou si la
  réponse du LLM est invalide;
- le champ `source` vaut `"llm"` ou `"fallback"` pour tracer l’origine.

## Webhooks

Paiements et intégrations utilisent signatures, tolérance temporelle, anti-rejeu, journal et traitement idempotent.

## API publique

Réservée aux offres compatibles. Clés à portée limitée, rotation, quotas, journal d’utilisation et documentation séparée. Aucune API publique avant stabilisation des contrats internes.
