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

## Espace compte — implémenté (S20b)

`apps/api/src/account/`. Écrans correspondants : docs/04 § Implémenté (S20b).

```text
GET    /account/profile                 identité + langue + fuseau + demande d'email en attente
PUT    /account/profile                 nom affiché, langue, fuseau
GET    /account/preferences             thème, devise par défaut, notifications, valeurs acceptées
PUT    /account/preferences             écriture des mêmes (remplacement total)
GET    /account/sessions                sessions actives, la courante marquée
DELETE /account/sessions/{id}           révocation d'une session
POST   /account/sessions/revoke-others  révocation de toutes les autres
GET    /account/email/change            demande de changement en attente
POST   /account/email/change            ouvre une demande — 202, changement NON appliqué
DELETE /account/email/change            annule la demande
GET    /account/deletion                éligibilité à la suppression
POST   /account/delete                  suppression définitive
POST   /account-email/verify            applique un changement depuis son token
```

**Portée par la session, sans organisation.** Le propriétaire des données est toujours l’utilisateur de la session : aucune route n’accepte d’identifiant d’utilisateur, ni en URL, ni en query, ni dans le corps. Les schémas zod sont `.strict()`, si bien qu’un `userId` glissé dans un corps produit `400 INVALID_REQUEST` au lieu d’être ignoré en silence — un champ ignoré donnerait un `200` trompeur.

Ces routes passent par `AccountAuthGuard` et non `AuthGuard` : elles résolvent la session sans exiger d’organisation active (ADR-0012 §9). C’est ce qui rend l’espace compte joignable pour un utilisateur sans organisation.

**Sessions.** Le `token` d’une session vaut le cookie de connexion : il ne sort jamais de l’API. La liste n’expose qu’un `id` opaque et la révocation résout `id → token` côté serveur. Un `id` appartenant à un autre utilisateur est simplement introuvable dans la liste de l’appelant → `404 SESSION_NOT_FOUND`.

**Codes d’erreur propres à cet espace** : `400 INVALID_PASSWORD`, `400 EMAIL_MISMATCH`, `400 EMAIL_UNCHANGED`, `400 INVALID_TOKEN`, `404 SESSION_NOT_FOUND`, `409 EMAIL_TAKEN`, `409 LAST_OWNER`.

**Bloqué par l’absence de SMTP.** `POST /account/email/change` répond `202` : la demande est *acceptée*, le changement n’est **pas** appliqué. Le lien de vérification est généré mais n’est envoyé nulle part, faute de fournisseur d’envoi d’emails (docs/17 § Restant). La réponse le dit explicitement — `pending.verificationDelivered: false` et un `reason` lisible — plutôt que de laisser croire à un email parti. Un utilisateur final ne peut donc pas terminer un changement d’adresse aujourd’hui. L’alternative, appliquer le changement sans vérification, ouvrirait un chemin de prise de compte (docs/17 § Menaces prioritaires) : elle est refusée.

## Webhooks

Paiements et intégrations utilisent signatures, tolérance temporelle, anti-rejeu, journal et traitement idempotent.

## API publique

Réservée aux offres compatibles. Clés à portée limitée, rotation, quotas, journal d’utilisation et documentation séparée. Aucune API publique avant stabilisation des contrats internes.
