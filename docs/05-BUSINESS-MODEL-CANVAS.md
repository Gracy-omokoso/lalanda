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

## Préremplissage par le questionnaire de cadrage (S23b)

Le modèle générique `custom` (« mon secteur n'est pas dans la liste ») propose, à
la création du projet, un questionnaire de cadrage d'une quinzaine d'écrans dont
les réponses en texte **préremplissent le Canvas**.

**La règle qui gouverne ce préremplissage.** Le questionnaire mélange deux
natures de réponse, et les confondre serait une faute grave :

- une réponse **en texte** alimente le Canvas, et lui seul. Elle ne produit
  **aucun chiffre** — conformément à « le Canvas guide les hypothèses sans
  générer silencieusement des montants » (§ Relations financières);
- un chiffre du plan financier est **demandé comme un nombre**, dans un champ
  numérique porté par le driver du moteur, avec son unité et ses bornes.

Aucun montant n'est jamais extrait d'une phrase libre, ni par expression
régulière, ni par l'IA. « Mon coût de revient tourne autour de 12 000 » ne
devient pas `cout_revient: 12000`. La séparation est portée par les types
(`apps/web/src/app/(app)/projects/_components/custom-questionnaire-model.ts` :
une question en texte n'a pas de champ `driverId`) et vérifiée par un test qui
soumet des réponses en texte truffées de chiffres et exige un dictionnaire de
drivers vide.

**Correspondance question → bloc.**

| Question | Bloc |
|---|---|
| Produit, service ou les deux ? | `revenus` |
| Le problème rencontré aujourd'hui | `proposition_valeur` |
| Votre solution | `proposition_valeur` |
| Ce qu'on achète concrètement | `proposition_valeur` |
| À qui vendez-vous | `segments_clients` |
| Par où vous vendez et livrez | `canaux` |
| Ce dont vous avez besoin pour démarrer | `ressources_cles` |
| Fournisseurs et partenaires | `partenaires_cles` |
| Ce qui coûtera le plus cher | `couts` |

`relations_clients` et `activites_cles` ne sont **pas** couverts : ils restent
vides et se remplissent dans l'écran Canvas. Arbitrage assumé — mieux vaut un
questionnaire qu'on termine et un Canvas à compléter qu'un questionnaire de vingt
écrans abandonné au tiers.

**Écriture.** Un seul `PUT /projects/:id/canvas` à la sortie du questionnaire,
avec les neuf blocs (les non couverts en `[]`). Ids de cartes déterministes
(`cadrage-<question>`), textes tronqués à 500 caractères. Aucun `PUT` si aucune
carte n'a été produite : pas de version ni de révision inutile. Une question
passée ne produit pas de carte, et l'ordre des suivantes se resserre.

**Ce qui est annoncé à l'écran.** L'assistant de saisie affiche, à l'arrivée, le
nombre de cartes écrites et un lien vers le Canvas — en rappelant qu'aucun
montant n'en a été tiré.

### Reste à faire

Priorité, hypothèses/preuves, statut à valider/validé/rejeté, liens entre cartes, liens confirmés vers les hypothèses financières, glisser-déposer, filtres, mode atelier, vue cohérence, restauration d’une révision, export A4 paysage et signalement des incohérences par le wizard.
