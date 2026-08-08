# Business Model Canvas dynamique

**Statut :** Draft  
**Version :** 0.1

## Blocs

1. Segments de clients.
2. Propositions de valeur.
3. Canaux.
4. Relations clients.
5. Sources de revenus.
6. Ressources clés.
7. Activités clés.
8. Partenaires clés.
9. Structure des coûts.

## Élément de Canvas

Chaque élément possède :

- identifiant et bloc;
- titre et description;
- priorité;
- hypothèses et preuves;
- statut à valider/validé/rejeté;
- auteur et historique;
- liens vers d’autres éléments;
- liens facultatifs vers des hypothèses financières;
- commentaires et pièces jointes.

## Relations financières

Le Canvas guide les hypothèses sans générer silencieusement des montants.

| Bloc | Lien financier possible |
|---|---|
| Segments | volumes, panier, saisonnalité |
| Valeur | prix, gamme, marge cible |
| Canaux | acquisition, commissions, logistique |
| Relations | support, fidélisation, coûts commerciaux |
| Revenus | produits, services, fréquence, conditions de paiement |
| Ressources | investissements, personnel, licences |
| Activités | capacité, coûts variables, sous-traitance |
| Partenaires | achats, délais fournisseurs, partage de revenus |
| Coûts | charges fixes et variables |

Une relation est une proposition visible. Elle devient une entrée du scénario uniquement après confirmation.

## Interactions

- ajout rapide de cartes;
- glisser-déposer au sein d’un bloc;
- liens entre cartes;
- filtres par priorité et statut;
- mode atelier collaboratif;
- suggestions de questions;
- vue cohérence montrant les éléments sans hypothèse financière;
- export A4 paysage.

## Validation

Le Canvas peut rester incomplet, mais le wizard signale les incohérences : revenu sans segment, canal sans coût, ressource clé non financée ou activité sans capacité.

## Versionnement

Chaque validation du Canvas crée un instantané. Les exports et plans peuvent référencer cet instantané. Une restauration crée une nouvelle version; elle ne supprime pas l’historique.

## Critères d’acceptation

- Les neuf blocs sont modifiables et exportables.
- Un membre ne voit et ne modifie que les projets autorisés.
- Les liens financiers sont traçables et confirmés.
- La suppression d’une carte ne supprime pas automatiquement une hypothèse déjà validée.
- L’historique indique auteur, date et changement.

## Implémenté (S18d)

Première tranche : les neuf blocs éditables, versionnés et isolés par organisation. Les fonctions collaboratives et les liens carte ↔ hypothèse financière restent à faire (voir « Reste à faire »).

- **Modèle `Canvas`** (collection `canvases`, module `apps/api/src/canvas/`) : un document par projet, `blocs` = les neuf blocs de la section « Blocs » (ids `segments_clients`, `proposition_valeur`, `canaux`, `relations_clients`, `revenus`, `ressources_cles`, `activites_cles`, `partenaires_cles`, `couts`), chaque bloc étant une liste ordonnée de cartes `{ id, texte, ordre }`. `version`, `updatedBy`, `_schemaVersion`, index unique `{projectId}`.
- **Aucun montant dans le Canvas** (§ Relations financières) : le modèle ne porte aucune donnée chiffrée et ne participe à aucun calcul. Le Canvas guide les hypothèses ; les chiffres restent la propriété du moteur financier.
- **Versionnement** (§ Versionnement) : chaque `PUT` incrémente `version` et écrit un instantané dans `canvas_revisions` (`version`, `blocs`, `savedBy`, `createdAt`). Rétention **bornée aux 20 dernières révisions** par projet — les plus anciennes sont purgées à l’écriture. Index unique `{projectId, version}` : deux écritures concurrentes ne peuvent pas produire deux instantanés de la même version.
- **Endpoints** (AuthGuard + scope organisation, 404 cross-tenant — jamais 403) : `GET /projects/:id/canvas` (un projet sans canvas renvoie neuf blocs vides et `version: 0`, pas un 404), `PUT /projects/:id/canvas` (remplacement complet des neuf blocs), `GET /projects/:id/canvas/revisions` (20 dernières révisions, plus récentes en premier).
- **Validation zod** (`canvas.dto.ts`, schéma dérivé de la liste des blocs pour éviter toute divergence) : objet `.strict()` — un **bloc inconnu** ou un **champ de carte inconnu** est refusé en `400 INVALID_REQUEST` ; `texte` de 1 à **500 caractères** ; **20 cartes maximum par bloc** ; ids de cartes uniques dans un bloc et conformes à `^[a-z0-9][a-z0-9_-]*$`.
- **Pas de suppression par omission** : les neuf blocs sont **requis** dans le corps du `PUT`. Un bloc omis est une erreur `400`, jamais un effacement silencieux — sans quoi un `PUT {}` viderait tout le canvas en consommant une version et une révision, ce qui contredirait le critère « la suppression d’une carte ne cascade pas ». Vider un bloc reste possible explicitement, en envoyant `[]`. Une mise à jour partielle relèverait d’un `PATCH` dédié.
- **Web** : onglet « Canvas » de la vue projet (`/projects/:id/canvas`) — grille des neuf blocs disposée en nappe BMC sur grand écran, édition **inline** des cartes, **auto-save au blur** (aucune écriture si le contenu utile est inchangé : pas de révision inutile), indicateur de version permanent et historique des révisions dépliable.
- **Isolation** : toutes les routes passent par le projet scopé à l’organisation ; testé de bout en bout (`apps/api/src/__tests__/canvas.e2e.test.ts`).

### Reste à faire

Priorité, hypothèses/preuves, statut à valider/validé/rejeté, liens entre cartes, liens confirmés vers les hypothèses financières, glisser-déposer, filtres, mode atelier, vue cohérence, restauration d’une révision, export A4 paysage et signalement des incohérences par le wizard.
