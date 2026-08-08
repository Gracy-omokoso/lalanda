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

Livré : saisie mensuelle du réalisé, clôture et réouverture motivée, écarts vs dernier plan validé, projection actualisée. Module `apps/api/src/actuals/` (collection `actual_periods`) et onglet web « Réalisé » — route `/projects/:id/realise`, déclarée dans `PROJECT_TABS` (navigation projet canonique, S18d). Le plan validé (S16c) reste en lecture seule : aucune écriture du réalisé ne le touche.

### Endpoints

Pas de préfixe `/v1` — cohérence avec les contrôleurs existants (ADR-0011 Contrat 4). `AuthGuard`, scope organisation systématique, **404** pour un projet d’une autre organisation (jamais 403).

| Méthode | Chemin | Effet |
| --- | --- | --- |
| `PUT` | `/projects/:id/actual-periods/:year/:month` | Fusionne les montants soumis avec ceux déjà saisis ; une valeur `null` **efface** la ligne du mois. Bornée aux lignes du compte d’exploitation du plan validé courant (`400 UNKNOWN_LINE`), et refusée sans plan validé (`409 NO_APPROVED_PLAN`) ou sur période clôturée (`409 PERIOD_CLOSED`). |
| `POST` | `/projects/:id/actual-periods/:year/:month/close` | `open → closed`. Un mois jamais saisi peut être clôturé (mois sans activité). |
| `POST` | `/projects/:id/actual-periods/:year/:month/reopen` | `closed → open`. **Owner de l’organisation uniquement**, motif obligatoire, journalisé en append-only dans `reopenedLog`. |
| `GET` | `/projects/:id/actual-periods?year=N` | Périodes de l’exercice, triées par mois. |
| `GET` | `/projects/:id/variances?year=N` | Écarts cumulés vs le dernier plan `approved`. |
| `GET` | `/projects/:id/updated-projection?year=N` | Estimation de fin d’exercice. |

Codes d’erreur (SCREAMING_SNAKE_CASE) : `INVALID_PERIOD`, `INVALID_VALUES`, `UNKNOWN_LINE`, `PERIOD_CLOSED`, `PERIOD_ALREADY_CLOSED`, `PERIOD_NOT_CLOSED`, `PERIOD_CONFLICT`, `REOPEN_REASON_REQUIRED`, `REOPEN_OWNER_ONLY`, `NO_APPROVED_PLAN`.

### Règle cardinale : ne jamais fabriquer un chiffre

Un écart présenté à côté d’un `planVersion` a valeur officielle. Quand la comparaison est impossible, la réponse le dit ; elle ne comble jamais le trou par un `0`, un `−100 %` ou une extrapolation. Trois états distincts, tous explicites côté API et côté interface :

| État | Champ | Signification |
| --- | --- | --- |
| Non comparable | `comparable: false` + `raison` | Le plan comparé n’offre aucune base pour cette ligne ou cet exercice. |
| Non saisi | `saisi: false` | La ligne existe au plan mais n’a été renseignée sur aucun mois de la période. |
| Comparé | `comparable: true, saisi: true` | Seul cas où `ecart`, `ecartPct` et `statut` sont renseignés. |

### Conventions MVP assumées

1. **Exercice, pas calendrier.** `year` est l’année d’exercice (1 à 5) et `month` le mois d’exercice (1 à 12) — le plan n’est pas ancré sur une date de démarrage.
2. **Base annuelle résolue par exercice.** La feuille `activite` est le compte d’exploitation de l’**exercice 1**, en moyenne mensuelle. La base annuelle de la ligne `L` pour l’exercice `N` est cherchée dans cet ordre : (a) ligne `L_annuel_N` **de la feuille `projection`** du plan comparé — c’est le chiffre que le plan publie lui-même pour cet exercice ; (b) à défaut, et **uniquement pour l’exercice 1**, `activite.L × 12`. L’origine retenue est renvoyée dans `base` (`projection` | `activite_x12`) et affichée dans l’interface. Si le plan comparé ne publie pas l’exercice demandé, la ligne est **non comparable** avec la raison `EXERCICE_ABSENT_DU_PLAN`. L’exercice 1 n’est **jamais** recopié sur un exercice ultérieur : avec un taux de croissance à 20 %, l’écart affiché serait faux de +44 % en année 3.

   La correspondance est **stricte** : même feuille (`projection`) et identifiant exact, sans alias ni recherche par « racine ». Depuis FIN-001 (S18a) c’est une exigence de justesse, pas une précaution de style — un plan validé contient désormais deux grandeurs homonymes pour le même exercice : `activite.resultat_net` (avant dotations et intérêts) et `caf.caf_resultat_net_annuel_N` (« Résultat net comptable, après dotations et intérêts »). Sur le template restaurant elles diffèrent d’environ 9 % (74 169 contre 67 434). Rattacher l’une à l’autre produirait un écart entièrement fictif présenté à côté d’un `planVersion`. Par la même règle, la série `resultat_annuel_N` (racine `resultat`) n’est pas rattachée à la ligne `resultat_net` : deviner l’équivalence serait une invention. Verrouillé par les tests `resolveAnnualBase — homonymes de FIN-001`.
3. **Prorata mensuel = base annuelle ÷ 12.** Répartition linéaire, sans saisonnalité : choix MVP, annoncé dans la réponse via `convention: 'annuel/12'`.
4. **Lignes de référence = lignes monétaires de la feuille `activite`** du plan validé comparé, c’est-à-dire le compte d’exploitation. Ce sont aussi les seules lignes que la saisie accepte (`UNKNOWN_LINE` sinon) : une ligne fantôme serait invisible dans la grille et donc impossible à corriger.
5. **Sens de la ligne.** Faute de métadonnée `sens` dans la DSL, il est déduit de l’identifiant : préfixe de solde ou de produit d’abord (`ca_`, `marge_`, `resultat_`, `excedent_`…), mots-clés de charge ensuite (`cout_`, `achats_`, `salaires_`, `_impot`…), produit par défaut. Une charge **sous** le prévu est favorable ; un produit sous le prévu est défavorable. Un écart nul est `conforme` — ni favorable, ni défavorable.
6. **Non comparable.** `comparable: false` + `raison` parmi `LIGNE_ABSENTE_DU_PLAN` (identifiant hérité d’un plan antérieur ou d’un autre template), `LIGNE_HORS_COMPTE_EXPLOITATION` (ligne du plan mais hors feuille `activite`) et `EXERCICE_ABSENT_DU_PLAN` (convention 2). Tous les champs de comparaison valent `null`. **Jamais un écart de 100 %**, jamais de ré-exécution du moteur sur un plan historique (ADR-0011 friction n°3 ; docs/07 § Limite connue). Le réalisé saisi, lui, reste affiché.
7. **Ligne jamais saisie ≠ ligne à zéro.** `saisi: false` ⇒ `realiseCumule`, `ecart`, `ecartPct` et `statut` sont `null`. Un montant `0` explicitement saisi reste, lui, une observation réelle. C’est aussi pourquoi la saisie accepte `null` comme sentinelle d’effacement : sans elle, une erreur de frappe serait irrattrapable.
8. **Comparaison à périmètre identique, ligne par ligne** : le prévu cumulé d’une ligne couvre exactement les mois où **cette ligne** est renseignée — pas tous les mois de la période, sans quoi une ligne saisie en retard afficherait un manque fictif.
9. **Écart relatif** rendu en fraction (`0.05` = +5 %), `null` si la base prévue est nulle.
10. **Projection** = réalisé des mois **clôturés** + (base annuelle ÷ 12) × mois restants. Un mois saisi mais non clôturé compte comme estimation : seule la clôture transforme une saisie en observation ferme. Si des mois sont clôturés mais que la ligne n’y figure pas, `realiseClos` et `totalProjete` valent `null` (observation manquante) ; sans aucun mois clôturé, `realiseClos` vaut bien `0` et la projection égale le plan.
11. **Soldes saisis, non recalculés.** Les soldes du compte d’exploitation (`marge_matiere`, `excedent_brut`, `resultat_net`…) sont calculés par le moteur dans le plan, mais **saisis à la main** dans le réalisé. L’API ne les recalcule pas à la place de l’utilisateur — le moteur reste l’unique source de vérité des calculs — mais signale l’incohérence : si la formule DSL de la ligne est une pure combinaison ± d’autres lignes de référence et que tous ses composants sont saisis, un écart au-delà de la tolérance d’arrondi produit un diagnostic `INCOHERENCE_SOLDE` portant les mois concernés. Les formules avec produit, division ou fonction (`ca * food_cost_pct`, `IF(...)`) sont hors contrôle : les réimplémenter créerait une seconde source de vérité de calcul.

### Reste à faire

- **Import bancaire et CSV/Excel mappé** (§ Saisie et import) : aujourd’hui la saisie est manuelle et agrégée. La machine d’état `uploaded → mapped → validated → processing → completed` (docs/22 § Import) et l’annulation d’import ne sont pas implémentées.
- **Mapping automatique** catégorie réalisée → ligne du plan, versionné, avec file des éléments non mappés et détection de doublons (§ Rapprochement). Aujourd’hui la saisie se fait directement sur les `lineId` du plan.
- **Alertes** (§ Alertes) : aucune règle de gravité, preuve, cause probable ni recommandation n’est produite.
- **Métadonnées par donnée** (§ Saisie et import) : source, auteur, pièce, devise et taux de conversion ne sont pas encore stockés ligne à ligne — seule la période porte un horodatage et l’auteur de la clôture.
- **États intermédiaires** `review` et commentaire/responsable/action par écart (docs/22 § Période réalisée, § Écarts) : la machine d’état livrée est réduite à `open ↔ closed`.
- **Saisonnalité** : remplacer `annuel/12` par une mensualisation issue de la DSL temporelle, et le sens déduit par une métadonnée `sens` explicite (les deux relèvent de `packages/engine`).
- **Couverture des exercices 2 à 5** (mis à jour après le merge de FIN-001). L’horizon de la feuille `projection` est bien passé de 3 à 5 exercices, et le suivi du **chiffre d’affaires** en a profité sans une ligne de code : `ca_annuel_4` et `ca_annuel_5` sont résolus automatiquement. En revanche, FIN-001 n’a pas élargi le *jeu de lignes* porteuses d’une série annuelle : la feuille `projection` publie toujours `ca_annuel_N` et `resultat_annuel_N`, et rien d’autre. Sur le template restaurant, six des sept lignes du compte d’exploitation (`cout_matiere`, `marge_matiere`, `charges_operationnelles`, `excedent_brut`, `ibp`, `resultat_net`) restent donc `EXERCICE_ABSENT_DU_PLAN` au-delà de l’exercice 1. Les rendre comparables suppose de publier `<ligne>_annuel_N` pour chaque ligne du compte d’exploitation — évolution `packages/engine`, hors périmètre du réalisé. Le jour où ces lignes existeront, le suivi les prendra tout seul.
- **Dérivation des soldes** : le contrôle `INCOHERENCE_SOLDE` ne couvre que les formules purement additives. Dériver les soldes du réalisé (au lieu de les faire saisir) suppose que le moteur sache évaluer un jeu de valeurs observées — évolution `packages/engine`, hors périmètre S18b.
