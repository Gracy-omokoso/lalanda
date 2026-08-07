# Prévisionnel, réalisé et projection

**Statut :** Draft  
**Version :** 0.1

## Séparation des concepts

- **Plan** : référence validée et immuable.
- **Réalisé** : données observées.
- **Projection** : estimation actualisée de la fin de période.
- **Scénario** : jeu alternatif d’hypothèses.

Aucune saisie du réalisé ne modifie rétroactivement le plan.

## Périodes

Une période passe par : ouverte, en révision, clôturée, rouverte. La réouverture exige une permission, un motif et une trace d’audit.

## Saisie et import

Sources possibles :

- saisie manuelle agrégée;
- import CSV/Excel mappé;
- intégration comptable ou bancaire future;
- ajustement autorisé.

Chaque donnée conserve source, auteur, date, pièce éventuelle, devise, taux de conversion, catégorie et statut de validation.

## Rapprochement

Le mapping relie une catégorie réalisée à une ligne du plan. Les éléments non mappés restent dans une file de traitement. Les doublons potentiels et incohérences de période sont signalés.

## Écarts

Pour chaque métrique :

- valeur planifiée;
- valeur réalisée;
- écart absolu;
- écart relatif si la base est non nulle;
- cumul annuel;
- tendance;
- commentaire;
- responsable et action.

Les écarts favorables et défavorables tiennent compte du type de métrique : une charge inférieure peut être favorable, un revenu inférieur ne l’est pas.

## Projection

La projection combine réalisé clôturé et hypothèses restantes. La méthode utilisée est affichée. L’utilisateur peut remplacer une suggestion par une hypothèse explicite.

## Alertes

- trésorerie sous le minimum;
- revenu en retard;
- coût ou charge au-dessus du seuil;
- marge en dégradation;
- retard d’encaissement;
- dette ou taxe à échéance;
- objectif devenu improbable.

Une alerte possède gravité, preuve, période, cause probable, recommandation, responsable, échéance et statut.

## Critères d’acceptation

- Les périodes clôturées sont protégées.
- Les écarts sont reproductibles.
- Le mapping est versionné.
- Les imports peuvent être annulés sans effacer d’autres données.
- Toute projection distingue clairement observation et estimation.

## Implémenté (S18b)

Livré : saisie mensuelle du réalisé, clôture et réouverture motivée, écarts vs dernier plan validé, projection actualisée. Module `apps/api/src/actuals/` (collection `actual_periods`) et onglet web « Réalisé » (`?vue=realise`). Le plan validé (S16c) reste en lecture seule : aucune écriture du réalisé ne le touche.

### Endpoints

Pas de préfixe `/v1` — cohérence avec les contrôleurs existants (ADR-0011 Contrat 4). `AuthGuard`, scope organisation systématique, **404** pour un projet d’une autre organisation (jamais 403).

| Méthode | Chemin | Effet |
| --- | --- | --- |
| `PUT` | `/projects/:id/actual-periods/:year/:month` | Fusionne les montants soumis avec ceux déjà saisis. Refusé si la période est clôturée (`409 PERIOD_CLOSED`). |
| `POST` | `/projects/:id/actual-periods/:year/:month/close` | `open → closed`. Un mois jamais saisi peut être clôturé (mois sans activité). |
| `POST` | `/projects/:id/actual-periods/:year/:month/reopen` | `closed → open`. **Owner de l’organisation uniquement**, motif obligatoire, journalisé en append-only dans `reopenedLog`. |
| `GET` | `/projects/:id/actual-periods?year=N` | Périodes de l’exercice, triées par mois. |
| `GET` | `/projects/:id/variances?year=N` | Écarts cumulés vs le dernier plan `approved`. |
| `GET` | `/projects/:id/updated-projection?year=N` | Estimation de fin d’exercice. |

Codes d’erreur (SCREAMING_SNAKE_CASE) : `INVALID_PERIOD`, `INVALID_VALUES`, `PERIOD_CLOSED`, `PERIOD_ALREADY_CLOSED`, `PERIOD_NOT_CLOSED`, `PERIOD_CONFLICT`, `REOPEN_REASON_REQUIRED`, `REOPEN_OWNER_ONLY`, `NO_APPROVED_PLAN`.

### Conventions MVP assumées

1. **Exercice, pas calendrier.** `year` est l’année d’exercice (1 à 5) et `month` le mois d’exercice (1 à 12) — le plan n’est pas ancré sur une date de démarrage.
2. **Prorata mensuel = plan annuel ÷ 12.** Répartition linéaire, sans saisonnalité : c’est le choix MVP, annoncé dans la réponse API via `convention: 'annuel/12'`. La feuille `activite` des templates est exprimée en moyenne mensuelle, donc plan annuel = valeur de la ligne × 12.
3. **Lignes de référence = lignes monétaires de la feuille `activite`** du plan validé comparé, c’est-à-dire le compte d’exploitation.
4. **Sens de la ligne.** Faute de métadonnée `sens` dans la DSL, il est déduit de l’identifiant : préfixe de solde ou de produit d’abord (`ca_`, `marge_`, `resultat_`, `excedent_`…), mots-clés de charge ensuite (`cout_`, `achats_`, `salaires_`, `_impot`…), produit par défaut. Une charge **sous** le prévu est favorable ; un produit sous le prévu est défavorable. Un écart nul est favorable (aucune dérive).
5. **Non comparable.** Une ligne saisie au réalisé sans contrepartie dans le plan comparé — cas des plans validés antérieurs à FIN-001 — est renvoyée avec `comparable: false` et une `raison` (`LIGNE_ABSENTE_DU_PLAN` ou `LIGNE_HORS_COMPTE_EXPLOITATION`), tous les champs de comparaison à `null`. **Jamais un écart de 100 %**, jamais de ré-exécution du moteur sur un plan historique (ADR-0011, friction n°3 ; docs/07 § Limite connue).
6. **Écart relatif** rendu en fraction (`0.05` = +5 %), `null` si la base prévue est nulle.
7. **Projection** = réalisé des mois **clôturés** + (plan annuel ÷ 12) × mois restants. Un mois saisi mais non clôturé compte comme estimation : seule la clôture transforme une saisie en observation ferme.
8. **Comparaison à périmètre identique** : le prévu cumulé ne couvre que les mois effectivement saisis, jamais l’exercice entier.

### Reste à faire

- **Import bancaire et CSV/Excel mappé** (§ Saisie et import) : aujourd’hui la saisie est manuelle et agrégée. La machine d’état `uploaded → mapped → validated → processing → completed` (docs/22 § Import) et l’annulation d’import ne sont pas implémentées.
- **Mapping automatique** catégorie réalisée → ligne du plan, versionné, avec file des éléments non mappés et détection de doublons (§ Rapprochement). Aujourd’hui la saisie se fait directement sur les `lineId` du plan.
- **Alertes** (§ Alertes) : aucune règle de gravité, preuve, cause probable ni recommandation n’est produite.
- **Métadonnées par donnée** (§ Saisie et import) : source, auteur, pièce, devise et taux de conversion ne sont pas encore stockés ligne à ligne — seule la période porte un horodatage et l’auteur de la clôture.
- **États intermédiaires** `review` et commentaire/responsable/action par écart (docs/22 § Période réalisée, § Écarts) : la machine d’état livrée est réduite à `open ↔ closed`.
- **Saisonnalité** : remplacer `annuel/12` par une mensualisation issue de la DSL temporelle, et le sens déduit par une métadonnée `sens` explicite (les deux relèvent de `packages/engine`).
