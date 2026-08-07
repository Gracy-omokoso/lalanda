# Plan financier

**Statut :** Draft  
**Version :** 0.1

## Horizon et granularité

- horizon standard : 5 exercices;
- vue annuelle obligatoire;
- vue mensuelle au minimum pour les 12 premiers mois lorsque les hypothèses le permettent;
- agrégations trimestrielles et semestrielles dérivées;
- calendrier configurable avec exercice décalé à terme.

## États attendus

### Compte de résultat

Chiffre d’affaires, coûts variables, marge brute, charges d’exploitation, EBITDA/EBE selon présentation, dotations, résultat financier, impôts et résultat net.

### Trésorerie

Solde initial, encaissements, décaissements d’exploitation, investissements, financements, taxes, variation et solde final.

### Plan de financement

Besoins durables, ressources durables, variation de BFR et équilibre de financement.

### Bilan prévisionnel

Actif immobilisé, actif circulant, trésorerie, capitaux propres, dettes financières, fournisseurs, dettes fiscales/sociales et contrôles d’équilibre.

### Indicateurs complémentaires

- BFR;
- capacité d’autofinancement;
- seuil de rentabilité et point mort;
- marge brute, opérationnelle et nette;
- DSCR si dette;
- VAN et TRI si les hypothèses nécessaires existent;
- burn rate et runway si pertinents;
- ratios de liquidité, solvabilité et endettement.

## Invariants

- bilan équilibré dans la tolérance d’arrondi;
- trésorerie finale d’une période égale à l’ouverture suivante;
- dette cohérente avec échéancier, intérêts et remboursements;
- immobilisations cohérentes avec acquisitions, cessions et amortissements;
- résultat reporté conformément à la règle du scénario;
- aucun total financier calculé par l’interface.

## Scénarios

Au minimum : base, prudent et ambitieux. Ils partagent le même projet mais possèdent leurs propres entrées et résultats. Une comparaison affiche valeur, écart et variables modifiées.

## Version validée

Une validation fige entrées, moteur, Country Pack, date, auteur et résultats. Elle reçoit un identifiant lisible. Toute modification crée un brouillon dérivé.

### Implémenté (S16c — FIN-003)

- **Modèle `FinancialPlan`** (collection `financial_plans`, module `apps/api/src/plans/`) : snapshot immuable par version — drivers **résolus** (user > pack > défaut template), `templateSlug` + `templateVersion`, `parameterPackSlug` + `packVersion` (année de référence du pack, faute de semver), `engineVersion`, résultat moteur complet (`lines` + `amortissements`), `approvedAt`, `approvedBy`, `_schemaVersion`. Versions incrémentales par projet (v1, v2, …), index unique `{projectId, version}`.
- **Cycle de vie** : `approved → superseded` uniquement (docs/22 § Plan). La validation de vN+1 bascule vN en `superseded` ; aucun autre champ n'est jamais modifié ni supprimé par une opération ordinaire.
- **Empreinte** : SHA-256 du JSON canonique (clés triées récursivement) des entrées — drivers résolus + template (slug, version) + pack (slug, version) + `ENGINE_VERSION`. Si l'empreinte est identique à celle du dernier plan du projet, `POST /projects/:id/plans` répond `409 { code: 'PLAN_UNCHANGED' }` : un chiffre déjà montré à une banque n'est jamais « re-figé » sous un autre numéro.
- **Endpoints** (AuthGuard + scope organisation, 404 cross-tenant) : `POST /projects/:id/plans` (fige vN+1), `GET /projects/:id/plans` (liste légère), `GET /projects/:id/plans/:version` (détail complet).
- **Exports figés** : `?planVersion=N` sur `/projects/:id/report/pdf` et `/report/xlsx` repart du snapshot **sans aucun recalcul moteur** ; le PDF affiche « Plan validé v{N} du {date} ». Sans paramètre, l'export reste un recalcul live marqué « BROUILLON — non validé ».
- **Limite connue** : on ne ré-exécute pas les moteurs historiques. Les chiffres exportés viennent exclusivement du snapshot ; en revanche la mise en forme (labels des hypothèses, formules Excel reconstruites) s'appuie sur la version **courante** du template au moment de l'export. Si un template évolue fortement, les formules Excel d'un vieux plan peuvent diverger de celles d'origine — les valeurs, elles, restent figées.

## Implémenté (S18a — FIN-001)

Horizon, bilan prévisionnel, BFR, CAF et seuil de rentabilité sont livrés. Le
module `packages/engine/src/etats-financiers/` calcule ces états hors
HyperFormula — même parti pris que la feuille `amortissements` (S14c) : un
déroulé pluriannuel avec report de stocks d'un exercice sur l'autre ne se
modélise pas en lignes/formules ponctuelles du DSL.

- **Horizon 5 exercices.** `horizon_projection_annees` passe par défaut de 3 à 5
  et les 3 templates sectoriels déclinent leur projection sur 5 exercices
  (`ca_annuel_1..5`, `resultat_annuel_1..5`). La ligne `resultat_cumule_3ans`
  est conservée telle quelle ; `resultat_cumule_5ans` s'y ajoute.
- **Activation par template.** Un bloc DSL **optionnel** `structure_financiere`
  désigne les lignes et drivers du modèle (achats variables, charges fixes,
  délais). Il n'introduit aucune règle de calcul. Un template sans ce bloc est
  strictement inchangé — compatibilité S6→S14 préservée.
- **BFR.** Trois drivers par template (`delai_clients_jours`,
  `delai_fournisseurs_jours`, `rotation_stock_jours`) avec des défauts
  sectoriels. Détail annuel exposé en `pf_bfr_*` dans `plan_financement`
  (ADR-0011 § Contrat 2 : pas de feuille dédiée). La variation de BFR alimente
  la trésorerie.
- **CAF.** Feuille `caf` : `caf_resultat_net_annuel_N` + `caf_dotations_annuel_N`
  = `caf_totale_annuel_N`, par exercice. Les dotations sont réintégrées : charge
  comptable, pas sortie de trésorerie.
- **Bilan prévisionnel.** Feuille `bilan` : actif (immobilisations nettes via VNC,
  stocks, créances, trésorerie) et passif (capitaux propres + résultats cumulés,
  dettes financières via échéancier PMT, fournisseurs, dettes fiscales et
  sociales), plus un bilan d'ouverture et l'échéancier détaillé de la dette.
- **Seuil de rentabilité.** Feuille `seuil_rentabilite` : ventilation
  fixe / variable, CA au seuil, point mort en mois et en jours, marge de
  sécurité.
- **Feux tricolores.** `bilan_autonomie_financiere_annuel_N` porte un feu quand
  le pack fournit `ratio_autonomie_financiere_min` ; sinon la ligne reste
  informative. Les autres nouvelles lignes sont informatives (aucun paramètre de
  seuil correspondant dans les packs à ce jour).

### Invariant « bilan équilibré » — comment il est obtenu

**Aucun poste d'ajustement.** L'égalité actif = passif est obtenue par
construction : la trésorerie de clôture est le déroulé du tableau de flux
(méthode indirecte), jamais un solde de bouclage.

```
Actif_N  = VNC_N + Stocks_N + Créances_N + Trésorerie_N
Passif_N = Capitaux propres_N + Dettes financières_N + Fournisseurs_N + DFS_N

VNC_N   = VNC_{N-1} − DAP_N
BFR_N   = Stocks_N + Créances_N − Fournisseurs_N − DFS_N
Tréso_N = Tréso_{N-1} + CAF_N − ΔBFR_N − Remboursement capital_N
CP_N    = CP_{N-1} + Résultat net_N
Dette_N = Dette_{N-1} − Remboursement capital_N
CAF_N   = Résultat net_N + DAP_N
```

Par récurrence : `Actif_N − Passif_N = (Actif_{N-1} − Passif_{N-1}) − DAP_N +
CAF_N − RN_N = 0`. L'écart exposé par `bilan_ecart_equilibre_*` n'est donc que
du bruit d'arrondi flottant. Il est testé à 0,01 près sur les 3 templates × 5
exercices, et rejoué sur 7 scénarios déformants.

### Conventions retenues — à revalider par un expert-comptable

1. **Année commerciale de 360 jours** pour convertir les délais en montants.
2. **Économie d'impôt non modélisée.** Le résultat net du bilan est le résultat
   du compte d'exploitation (déjà net d'IBP) diminué des dotations et des
   intérêts d'emprunt ; l'IBP reste assis sur l'EBE. Hypothèse volontairement
   **prudente** : le résultat net, les capitaux propres et la trésorerie sont
   minorés.
3. **Dettes fiscales et sociales non modélisées** (IBP supposé réglé sur
   l'exercice). La ligne existe, à zéro, pour que l'ajout futur reste additif.
4. **Fournisseurs assis sur les seuls achats variables** ; les charges fixes sont
   supposées réglées comptant. Hypothèse **prudente** : le BFR est majoré.
5. **Immobilisations brutes = driver `investissements_initiaux`** (pilotable par
   l'utilisateur). La liste `immobilisations` ne sert qu'à calculer les
   dotations ; l'écart éventuel est exposé et ne rompt pas l'équilibre.
6. **BFR d'ouverture = driver `bfr_initial`**, présenté en bloc. Le driver était
   intitulé « Trésorerie de sécurité (BFR) » alors que son identifiant et son
   usage en font du fonds de roulement : le libellé est aligné en
   « Fonds de roulement de démarrage ». La trésorerie d'ouverture du bilan reste
   égale à la ligne existante `tresorerie_initiale`.

### Limites connues

- Les scénarios (base / prudent / ambitieux) ne sont toujours pas implémentés.
- La feuille `tresorerie` reste une vue mensuelle simplifiée de l'année 1 : elle
  ignore la variation de BFR et les intérêts, contrairement au bilan. Les deux
  vues ne se recoupent donc qu'à l'ouverture. À unifier quand la mensualisation
  réelle (extension DSL temporelle) arrivera.
- DSCR, VAN, TRI, burn rate et runway restent à faire.

## Exports

Excel conserve les formules ou pistes d’audit nécessaires selon le modèle choisi; PDF présente les tableaux, hypothèses, diagnostics et avertissements. Chaque export porte version, pays, devise, période et date.

## Réconciliation avec le classeur source

Les feuilles « Données à saisir », « Plan financier SUCCESS » et « Besoin » doivent être inventoriées. Chaque entrée et sortie reçoit un identifiant Lalanda, une règle, une unité et au moins un cas de référence.
