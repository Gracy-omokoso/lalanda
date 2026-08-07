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

## Exports

Excel conserve les formules ou pistes d’audit nécessaires selon le modèle choisi; PDF présente les tableaux, hypothèses, diagnostics et avertissements. Chaque export porte version, pays, devise, période et date.

## Réconciliation avec le classeur source

Les feuilles « Données à saisir », « Plan financier SUCCESS » et « Besoin » doivent être inventoriées. Chaque entrée et sortie reçoit un identifiant Lalanda, une règle, une unité et au moins un cas de référence.
