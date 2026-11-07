# ADR-0070 — Paie RDC (proposition) : éléments variables, brut au net, IRPP (ex-IPR), CNSS, INPP, ONEM, bulletins, journal de paie vers la comptabilité, ordres de virement vers la trésorerie, états préparatoires des déclarations

Statut : Proposed
Date : 2026-11-07
Décideurs : Gracy Omokoso (dirigeante) — demande de cadrage de la paie à partir du référentiel RH
qu'elle a fourni (domaine 9 « Gestion de la paie », § VI « Particularités à prendre en compte en
RDC ») ; CTO Lalanda (contrat technique). Le cadrage est **proposé** : il ne lève pas, à lui seul,
l'exclusion de la paie posée par ADR-0045 et maintenue par ADR-0051 et ADR-0054 (D6). Cette levée
appartient à la dirigeante (§ Décisions ouvertes, n° 1).

> **Proposition de lever le refus d'[ADR-0045](ADR-0045-ressources-humaines.md) § Hors périmètre**
> (« Paie : bulletins, calcul du brut au net… Cotisations et impôts : CNSS, IPR, INPP, ONEM… ») et
> d'[ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md) § Hors périmètre, **sous
> conditions** : pack de paie sourcé, mode simulation par défaut, cas de référence validés par un
> expert-comptable avant tout bulletin réel.
> **Étend [ADR-0049](ADR-0049-comptabilite-syscohada.md)** : une source d'écritures nouvelle (la
> période de paie validée) et des clés d'opération `payroll.*`, sans aucun compte écrit ici.
> **Étend [ADR-0034](ADR-0034-depenses-et-tresorerie.md)** : une dépense de salaire **possédée par la
> paie** (`origin.kind = 'payroll_run'`), motif exact de la dépense possédée par les RH d'ADR-0051 § 7.1.
> **Reprend sans le modifier** le chiffrement des sections sensibles d'ADR-0045 § 2.4
> (`compensation`, `bankDetails`).
> **Propose d'amender ADR-0051 § 3.3 et ADR-0054 D6** : la régularisation d'une avance sur salaire
> deviendrait une **retenue calculée** sur un bulletin, au lieu de la déclaration « hors Lalanda ».
> **Ne présente aucun taux comme certifié.** Chaque taux, barème, seuil et assiette est une valeur
> d'un pack daté, sourcé, marqué « à confirmer par l'expert-comptable » tant qu'il n'a pas été relu
> (§ 3 et § Questions pour l'expert-comptable).

## Contexte

Le brief stratégique (§ 5.7) demande « une paie adaptée aux règles locales ». ADR-0045 l'a exclue
d'emblée, par prudence : une paie fausse expose l'employeur à des redressements (CNSS, DGI) et
l'éditeur à une mise en cause. Le référentiel RH fourni par la dirigeante classe pourtant la paie
parmi les processus **critiques** à automatiser (§ IV), et une PME congolaise qui tient son personnel
dans Lalanda calcule encore ses salaires dans un classeur, puis ressaisit les montants payés en
dépenses `personnel`.

### Faits du dépôt qui commandent les décisions

| Fait | Où | Conséquence |
|---|---|---|
| Le salaire de base est une **donnée déclarée**, chiffrée (AES-256-GCM, AAD organisation + collaborateur + section), historisée (`effectiveFrom`, `amount`, `currency`, `period`) ; lecture en clair par `reveal` journalisé, 30 par heure | ADR-0045 § 2.4, `apps/api/src/hr/private/` | le calcul de paie lit la section `compensation` **dans le service**, sans `reveal` interactif, sous une action dédiée et un audit par période (§ 6) |
| Les coordonnées de paiement (`bankDetails` : banque ou mobile money) sont chiffrées, et leur changement notifie et pose un bandeau de sept jours | ADR-0045 § 2.4 | l'ordre de virement **bloque** un bénéficiaire dont les coordonnées ont changé depuis moins de sept jours, sauf confirmation explicite par une seconde personne (§ 7) |
| Les avances sur salaire existent (`hr_advances.kind = 'salary'`), mais leur régularisation « sur la paie » est une **déclaration**, éteinte (`allowDeclaredPayrollSettlement: false`) | ADR-0051 § 2.2, § 3.3 ; ADR-0054 D6 | la paie fournit enfin le règlement naturel : une retenue calculée qui solde l'avance (§ 5.4) |
| Le pointage produit des paires d'entrée et de sortie et un constat de retard, **aucune heure supplémentaire** (« Aucune heure supplémentaire, aucune durée légale (J3) ») | `packages/engine/src/hr/attendance.ts` l. 16 | les heures supplémentaires entrent comme **élément variable saisi ou importé**, validé par un humain ; le pointage n'est qu'une aide (§ 5.2) |
| Les absences approuvées sont décomptées en jours ouvrés (`leaveDays`) ; les types sont paramétrés, sans droit légal | ADR-0045 § 2.5, § 5 | une absence « sans solde » ne réduit le brut que si son type porte une règle de paie explicite (§ 5.2) |
| Les jours fériés sont une **liste vide** saisie par l'organisation | ADR-0045 § 2.6 ; `hr_holidays` | dépend du lot « jours fériés RDC » d'ADR-0068 (en cours, non livré) |
| Le pack `cd-2026` porte `cnss_employeur_pct 0.05`, `cnss_salarie_pct 0.05`, `inpp_pct 0.02`, `onem_pct 0.002` et un `ipr_taux_moyen_estimatif 0.15` (`a_confirmer`) ; un test fige `cnss_employeur_pct = 0.05` | `packages/engine/src/parameter-packs/cd-2026.yaml`, `parameter-packs.test.ts` l. 33 | ces valeurs **divergent** des sources trouvées (§ 3) ; elles ne servent qu'au prévisionnel et **ne doivent pas** servir à la paie ; correction proposée au lot P0 |
| Les packs sont lus par `parameter-pack-registry.ts` depuis des YAML du moteur, avec `revisions`, `source`, `a_confirmer` ; une version active est immuable, l'erratum en place n'est permis que pour un paramètre qu'aucun modèle ne consomme | `apps/api/src/parameter-packs/`, docs/09 § Modèle de version | le pack de paie suit ce modèle, avec en plus une **date d'effet par paramètre** (§ 3.1) |
| Le pack comptable v2 (`syscohada-revise-2017-cd@2`) contient 421, 422, 661, mais **ni compte de sécurité sociale (43), ni compte d'impôts retenus à la source, ni compte de charges sociales** | `docs/comptabilite/relecture-pack-syscohada-v2.md` | les écritures de paie iraient au compte d'attente (471) tant qu'un pack v3 relu n'ajoute pas ces comptes (§ 8) |
| La dépense `personnel` « Salaires et charges sociales » est comptabilisée en une ligne, au montant payé | ADR-0049 § 6.3 | la paie remplace cette saisie par une dépense possédée, sans double comptage (§ 7, § 8.3) |
| Aucun budget de projet n'existe ; seuls le coût horaire `work_member_rates` et la marge des projets existent | `apps/api/src/work/`, brief § 5.6 | le coût de paie par projet reste **informatif** et ultérieur (§ 9) |

## Options considérées

### O1 — Faire la paie dans Lalanda, ou s'arrêter à l'export vers un logiciel tiers ?

1. **Export seulement** (éléments variables vers un logiciel de paie local). Écarté comme cible :
   aucun format d'échange n'est standard en RDC, et la PME qui démarre n'a pas de logiciel tiers.
   Retenu comme **premier livrable utile** (lot P2) : l'export des éléments variables sert même si le
   calcul reste éteint.
2. **Paie complète, certifiée.** Écarté : Lalanda ne certifie rien (ADR-0018, ADR-0049).
3. **Paie calculée par le moteur, en simulation par défaut, sur pack sourcé** : retenu. Les bulletins
   portent la mention « Simulation — non contractuel » tant que l'organisation n'a pas passé le mode
   `active` avec un pack au statut `approved` et la déclaration « relu par notre expert-comptable »
   (motif d'ADR-0049 § 3.1).

### O2 — Où vivent les taux ?

1. Dans le code du moteur. Écarté : un changement de taux exigerait une version du moteur.
2. Dans `cd-2026`. Écarté : ce pack sert au prévisionnel annuel, sans date d'effet par paramètre ;
   un barème qui change en cours d'année (ONEM, août 2025) ne s'y exprime pas.
3. **Un pack de paie dédié, versionné, avec date d'effet par paramètre** (`cd-paie`) : retenu (§ 3.1).

### O3 — Corriger un bulletin validé

1. Modifier le bulletin. Écarté : un bulletin remis au salarié est une pièce.
2. **Bulletin rectificatif** (annule et remplace, numéro nouveau, lien vers l'original) ou **rappel**
   sur la période suivante : retenu ; le choix entre les deux est une question à l'expert (P-C9).

### O4 — Heures supplémentaires : calculées depuis le pointage ou saisies ?

Le pointage d'ADR-0051 est désactivé par défaut et ne connaît aucune durée légale. Retenu : **saisie
ou import** des heures par tranche de majoration, avec une **proposition** calculée depuis le pointage
quand il est actif et que la durée de référence est réglée ; la validation reste humaine.

## Décision

### 1. Vocabulaire

| Terme | Sens dans Lalanda |
|---|---|
| **Période de paie** | un mois civil, pour une organisation et une devise de paie |
| **Rubrique** | une ligne type du bulletin (salaire de base, prime, heures supplémentaires, cotisation, impôt, retenue) avec sa règle de calcul |
| **Élément variable** | une valeur propre à un collaborateur et une période (heures, prime, absence non payée, retenue d'avance) |
| **Brut** | somme des gains soumis ou non, avant retenues |
| **Base imposable** | assiette de l'IRPP selon le pack ; **à confirmer** (P-C2) |
| **Net à payer** | brut − retenues salariales − impôt − autres retenues |
| **Coût employeur** | brut + cotisations patronales |
| **Pack de paie** | ensemble daté et sourcé des paramètres de paie d'un pays (§ 3.1) |

### 2. Périmètre

**Dans le périmètre (proposé)** : éléments variables ; calcul du brut au net ; IRPP retenu à la
source (ex-IPR) ; CNSS part salariale et parts patronales (pensions, risques professionnels,
prestations familiales) ; INPP ; ONEM ; allocations familiales payées par l'employeur **si** le pack
porte une règle validée ; heures supplémentaires par tranche ; retenue des avances sur salaire
d'ADR-0051 ; bulletins (PDF, portail « moi ») ; journal de paie ; écritures vers ADR-0049 ; ordres
de virement vers ADR-0034 ; **états préparatoires** des déclarations (CNSS, IRPP, INPP, ONEM).

**Hors périmètre** : dépôt ou télédéclaration auprès de la CNSS, de la DGI, de l'INPP ou de l'ONEM
(Lalanda **ne dépose rien**) ; paiement réel (aucune connexion bancaire ni mobile money) ; solde de
tout compte et indemnités de rupture (lot ultérieur, questions au juriste) ; expatriés et impôt
exceptionnel sur leurs rémunérations ; régimes conventionnels sectoriels ; paie multi-pays ;
conversion automatique de devises (taux saisi et figé par période, § 4.4).

### 3. Règles pays : pack de paie sourcé, daté, versionné

#### 3.1 Forme du pack `cd-paie`

Fichier `packages/engine/src/parameter-packs/cd-paie-<version>.yaml`, lu par le même registre
(`parameter-pack-registry.ts`) sous une famille distincte. Chaque paramètre porte :

| Champ | Règle |
|---|---|
| `valeur` | nombre, ou tableau de tranches `{ de, a \| null, taux }` pour un barème |
| `unite` | `taux`, `CDF/jour`, `CDF/an`, `heures/semaine`… |
| `effet` | `{ du: AAAA-MM-JJ, au: AAAA-MM-JJ \| null }` : un paramètre peut changer en cours d'année |
| `source` | `{ texte, emetteur, date, url, consulte_le, nature: 'officielle' \| 'secondaire' }` |
| `statut` | `a_confirmer` \| `confirme_expert` (nom, date, note) ; **jamais** « certifié » |
| `divergences` | liste des sources contraires, citées |

Statut du pack (docs/09) : `draft → review → approved → active → retired`. **Un pack dont un
paramètre consommé est `a_confirmer` ne peut pas passer `approved`** (contrôle `validatePayrollPack`,
code `PAYROLL_PARAM_UNCONFIRMED`). Le premier pack, `cd-paie-2026@1`, naît `draft`.

Une période de paie **fige** la version du pack et la valeur effective de chaque paramètre au dernier
jour de la période (§ 4.3) ; un changement de pack n'altère aucun bulletin validé.

#### 3.2 Valeurs trouvées le 7 nov. 2026 — aucune n'est certifiée

Niveau de certitude : **A** = texte officiel identifié et concordance de sources secondaires, texte
non relu en entier ; **B** = sources secondaires concordantes, texte officiel non consulté ;
**C** = sources divergentes ou incomplètes. **Toutes sont « à confirmer par l'expert-comptable ».**

| Paramètre | Valeur trouvée | Source (date de consultation : 2026-11-07) | Niveau |
|---|---|---|---|
| Impôt sur les salaires : **régime** | L'IPR est remplacé par l'**IRPP** (impôt sur le revenu des personnes physiques), retenu à la source par l'employeur, à compter du **1ᵉʳ janvier 2026** | Loi n° 23/053 du 30 novembre 2023 ; synthèses [Sage](https://communityhub.sage.com/za/sage-payroll-professional/f/announcements/257553/democratic-republic-of-congo-drc-tax-reforms-affecting-payroll-law-no-23-053), [PaySpace](https://support.payspace.com/portal/en/kb/articles/democratic-republic-of-congo-annual-amendments-effective-1-january-2026), [Droit-Numérique, janv. 2026](https://droitnumerique.cd/wp-content/uploads/2026/01/N°14-I-NEWS-JURITECH-1.pdf) ; la loi de finances 2026 l'aurait modifiée ([ACP](https://acp.cd/nation/legislation-du-regime-fiscal-au-senat-les-deux-amendements-majeurs-du-senateur-lwanga/)) | B |
| Barème progressif annuel | 3 % jusqu'à 1 944 000 CDF ; 15 % de 1 944 001 à 21 600 000 ; 30 % de 21 600 001 à 43 200 000 ; 40 % au-delà | [PwC Worldwide Tax Summaries](https://taxsummaries.pwc.com/democratic-republic-of-the-congo/individual/taxes-on-personal-income), revu le 21 avr. 2026 (barème IPR) ; PaySpace et Sage : « taux inchangés » sous l'IRPP | B |
| Plafond | l'impôt ne peut excéder 30 % du revenu imposable | PwC (au titre de l'IPR) ; **maintien sous l'IRPP non vérifié** | C |
| Réduction pour charges de famille | 2 % de l'impôt brut par personne à charge, au plus 9 ; aucune réduction au-delà de la troisième tranche | art. 123 de la loi n° 23/053 selon Sage et PaySpace ; texte non consulté | B |
| Arrondi | au CDF puis à la centaine de CDF | art. 150 selon Sage ; texte non consulté | B |
| Exonérations (allocations familiales, indemnités de logement et de transport) | allocations familiales exclues (art. 69 selon PaySpace) ; plafonds journaliers transport et logement « non modifiés » sans valeur donnée | PaySpace ; aucune valeur trouvée | C |
| Régimes particuliers anciens (occasionnels 15 %, indemnités de fin de contrat 10 %) | cités par PwC sous l'IPR ; **abrogés** par l'art. 152 selon Sage | divergence | C |
| Échéance de reversement IRPP | 15 du mois suivant ; déclaration mensuelle, y compris néante | Sage | B |
| **CNSS** — pensions | 5 % salarié + 5 % employeur | Décret n° 18/041 du 24 novembre 2018 fixant les taux de cotisations dues à la CNSS ([fiche NATLEX](https://natlex.ilo.org/dyn/natlex2/r/natlex/fe/details?p3_isn=110943)) ; taux rapportés par [PwC](https://taxsummaries.pwc.com/democratic-republic-of-the-congo/individual/other-taxes) (revu le 21 avr. 2026) | A |
| CNSS — risques professionnels | 1,5 % employeur | idem | A |
| CNSS — prestations familiales | 6,5 % employeur | idem | A |
| CNSS — total | **5 % salarié, 13 % employeur** | idem | A |
| CNSS — plafond et assiette | **non trouvés** (aucune source ne donne de plafond ; assiette « rémunération » sans liste des éléments exclus) | — | C |
| **INPP** | 3 % (entreprises publiques et privées jusqu'à 50 salariés) ; 2 % (51 à 300) ; 1 % (plus de 300) ; à la charge de l'employeur | [PwC](https://taxsummaries.pwc.com/democratic-republic-of-the-congo/individual/other-taxes), [Mercans](https://dsr.mercans.com/?p=867), [Accio](https://tradeportal.accio.gencat.cat/ca/mercats-potencials/republica-democratica-del-congo/condicions-treball) ; un changement de taux INPP annoncé pour janvier 2026 par [PaySpace](https://payspace.com/blog/drc-inpp-contribution-rate-changes) n'a pas pu être lu ; texte officiel non identifié | C |
| **ONEM** | 0,2 % employeur **jusqu'au 4 août 2025**, puis **0,5 %** à compter du 5 août 2025 | Arrêté ministériel n° 30/CAB/MIN.ET/EAN/JDO/8/2025 du 5 août 2025 modifiant l'arrêté n° 095/CAB/MINETAT/MTEPS/01/2018, art. 1, selon [PaySpace](https://support.payspace.com/portal/en/kb/articles/democratic-republic-of-congo-onem-contribution-rate-increase-effective-august-2025) ; PwC (revu en avr. 2026) indique encore 0,2 % | C |
| Échéance CNSS, INPP, ONEM | 15 du mois suivant le paiement du salaire | PwC | B |
| **SMIG** | 21 500 CDF par jour (manœuvre ordinaire), contre 14 500 CDF auparavant ; application progressive, taux plein annoncé à partir de la paie de janvier 2026 ; calendrier contesté (suspension annoncée puis débat au Conseil national du travail) | Décret n° 25/22 du 30 mai 2025, selon [Chambers](https://gpg-pdf.chambers.com/employment-2025/185), [Playroll](https://playroll.com/minimum-wage/democratic-republic-of-congo), [WageIndicator](https://wageindicator.org/fr-cd/travail-au-congo/droit-du-travail/travail-et-salaires), [Afrik](https://www.afrik.com/rdc-le-doublement-du-smig-suspendu-la-colere-gronde), [ACP](https://acp.cd/economie/rdc-le-conseil-national-du-travail-tremplin-pour-lequilibre-dans-lapplication-du-smig/) | C |
| Grille du SMIG par catégorie professionnelle | **non trouvée** | — | C |
| Durée de référence du travail | 45 heures par semaine, 8 heures par jour | Code du travail (loi n° 015/2002) selon [WageIndicator](https://wageindicator.org/fr-cd/travail-au-congo/droit-du-travail/remuneration-et-temps-de-travail) | B |
| **Heures supplémentaires** | +30 % pour les six premières heures au-delà de la durée hebdomadaire, +60 % au-delà, +100 % un jour de repos hebdomadaire | texte d'application de mai 1968 cité par un mémoire universitaire ([memoireonline](https://www.memoireonline.com/01/12/5059/m_Consequences-du-non-paiement-des-heures-supplementaires-sur-la-poursuite-du-contrat-de-travail8.html)) ; un autre guide donne d'autres taux ([Africarrières](https://africarrieres.com/index.php/dr-congo/en/guide/documents/85/download)) | C |
| **Allocations familiales** (versées par l'employeur au salarié) | montant minimal par enfant **non trouvé** ; un arrêté du 8 novembre 2018 sur leur paiement existe ([droitcongolais.info](https://droitcongolais.info/files/822.11.18.1-Arrete-du-8-novembre-2018_paiement-des-allocations-familiales.pdf)), non lu | — | C |
| Indemnités de logement et de transport | obligations et minima **non trouvés** | — | C |

**Écarts avec le pack `cd-2026` du dépôt** : CNSS employeur 5 % (sources : 13 %), INPP 2 % (sources :
3 % pour une PME de 50 salariés au plus), ONEM 0,2 % (0,5 % depuis le 5 août 2025 selon une source),
IPR décrit « 3 / 15 / 30 / 40 % » sans bornes et sans le passage à l'IRPP. Ces paramètres ne sont
consommés par aucun modèle (seul le test les lit) : le lot P0 propose une révision en place marquant
ces valeurs `a_confirmer` et corrigeant la description, puis leur valeur **après** réponse de l'expert
(P-C1, P-C4, P-C5).

#### 3.3 Ce que ce pack ne fera pas seul

- Aucun taux n'est appliqué à un bulletin réel tant que le pack n'est pas `approved` (§ 3.1).
- Un paramètre sans valeur (plafond CNSS, allocations familiales, logement, transport) **désactive** la
  rubrique qui en dépend ; le bulletin le signale (« Rubrique non calculée : paramètre non
  renseigné ») ; aucune valeur par défaut n'est inventée.
- Le SMIG sert à un **constat** (« salaire de base inférieur au SMIG du pack »), jamais à corriger un
  salaire.

### 4. Modèle de données

Toutes les collections portent `organizationId`, `createdAt`, `createdBy`, `revision` et sont isolées
par organisation (404 hors organisation).

#### 4.1 `payroll_settings` (une par organisation)

| Champ | Règle |
|---|---|
| `mode` | `off` (défaut) \| `simulation` \| `active` ; `active` exige un pack `approved` **et** des cas de référence validés (§ 10, critère 3) |
| `packSlug` | `cd-paie-<version>` choisi ; changement journalisé |
| `payCurrency` | `CDF` \| `USD` (décision ouverte n° 3) |
| `headcountBand` | dérivé de l'effectif actif à la date de la période (INPP), surchargeable avec motif |
| `paymentDay` | jour du mois annoncé (informatif) |
| `weeklyReferenceHours` | `null` (défaut) \| nombre : sans valeur, aucune proposition d'heures supplémentaires depuis le pointage |
| `approval` | `{ prepareAction: 'payroll.prepare', validateAction: 'payroll.validate', allowSoleApprover }` |
| `numbering` | préfixe des bulletins `BP`, séquence sans trou par organisation et année |

#### 4.2 `payroll_pay_items` (rubriques)

| Champ | Règle |
|---|---|
| `code`, `label` | unique par organisation ; rubriques système (préfixe `sys.`) non supprimables |
| `kind` | `earning` \| `employee_deduction` \| `employer_contribution` \| `tax` \| `other_deduction` \| `info` |
| `calc` | `fixed` (montant saisi) \| `rate` (`base × paramètre`) \| `hours` (`heures × taux horaire × (1 + majoration)`) \| `brackets` (barème) \| `from_advance` \| `from_leave` |
| `param` | clé du pack (`cnss.pension.salarie`, `irpp.bareme`…) pour `rate` et `brackets` |
| `bases` | appartenance aux assiettes : `cnss`, `irpp`, `inpp_onem` — **valeurs par défaut proposées `a_confirmer`** (P-C2, P-C3) |
| `accountingKey` | clé d'opération `payroll.*` (§ 8) |
| `active` | archivage, jamais d'effacement si un bulletin l'utilise |

Rubriques système créées à l'activation : salaire de base, heures supplémentaires (trois tranches),
prime (saisie), absence non payée, CNSS pensions salarié, CNSS pensions employeur, CNSS risques
professionnels, CNSS prestations familiales, INPP, ONEM, IRPP, retenue d'avance, allocations
familiales (inactive tant que le paramètre manque), indemnités de logement et de transport (inactives).

#### 4.3 `payroll_periods`

| Champ | Règle |
|---|---|
| `month` | `AAAA-MM`, unique par organisation et devise |
| `status` | `open` → `inputs_locked` → `calculated` → `validated` → `paid` → `closed` ; `cancelled` avant `validated` |
| `pack` | `{ slug, version, values }` : valeurs effectives **figées** au calcul |
| `rate` | `null` \| `{ usdCdf, source: 'entered', enteredBy, at }` : taux saisi si la paie est en USD et le barème en CDF (§ 4.4) |
| `engineVersion` | `PAYROLL_VERSION` du calcul |
| `totals` | brut, retenues salariales, IRPP, net, cotisations patronales, coût employeur — **calculés par le moteur** |
| `validation` | `{ preparedBy, validatedBy, soleApprover, at }` ; séparation dynamique : qui prépare ne valide pas, sauf approbateur unique marqué |
| `hash` | empreinte SHA-256 du contenu figé (bulletins + totaux), motif du plan figé |

#### 4.4 Devises

Le barème de l'IRPP est exprimé en CDF (§ 3.2). Une paie en USD convertit la base imposable au taux
**saisi et figé** sur la période, jamais au taux du jour lu en ligne ; la source attendue du taux
(BCC, taux fiscal) est une question (P-C6). Aucun écart de change n'est calculé par la paie.

#### 4.5 `payroll_employee_profiles`

Un document par collaborateur payé : `employeeId`, `payable` (booléen), `cnssNumber` (**chiffré**,
section nouvelle `payroll` d'`hr_employee_private`, même AAD), `dependents` (nombre, chiffré : il
révèle la situation familiale), `category` (libellé de catégorie professionnelle, pour le constat du
SMIG), `paymentTarget` (index d'un `bankDetails`), `standingItems` (rubriques permanentes : prime
fixe, indemnité). Le salaire de base **n'y est pas recopié** : il est lu dans `compensation` à la date
de la période.

#### 4.6 `payroll_variable_inputs`

`{ periodId, employeeId, itemCode, quantity | amount, origin: 'manual' | 'import' | 'attendance_proposal' | 'leave' | 'advance', originRef, note, enteredBy }`.
Import CSV (gabarit fixe, motif de l'import d'ADR-0068). Verrouillés à `inputs_locked`.

#### 4.7 `payroll_payslips`

| Champ | Règle |
|---|---|
| `number` | `BP-AAAA-NNNNN` à la validation |
| `lines[]` | `{ code, label, kind, base, rate, quantity, amount, paramRef }` figées |
| `gross`, `taxableBase`, `cnssBase`, `net`, `employerCost` | calculés par le moteur, chaînes décimales |
| `findings[]` | constats : `BELOW_SMIG`, `PARAM_MISSING`, `CAP_APPLIED`, `RATE_ENTERED`, `BANK_DETAILS_RECENTLY_CHANGED` |
| `status` | `draft` \| `validated` \| `superseded` (rectificatif) |
| `supersedes` | lien vers le bulletin annulé et remplacé |
| `pdfKey` | PDF généré à la validation, stockage chiffré `payroll-payslips/<objectId>` |

Les montants du bulletin sont des **données sensibles** : jamais dans une liste hors RH, un export
ouvert, une notification, le brief ni l'IA (motif d'ADR-0045 § 2.4).

#### 4.8 `payroll_payment_orders`

Un ordre par période et par compte de trésorerie payeur : lignes `{ employeeId, amount, currency,
target masqué, reference }`, statut `draft` → `approved` → `exported` → `executed` (déclaré, avec
date et référence) ; export CSV générique ; aucune transmission à une banque ni à un opérateur.

### 5. Calcul (moteur `packages/engine/src/payroll/`, `PAYROLL_VERSION = '0.1.0'`)

Le moteur est **pur** et déterministe : entrées (profil, salaire de base, éléments variables, valeurs
du pack, taux saisi) → bulletin. Arithmétique décimale du moteur (`divHalfUp`, chaînes), jamais de
flottants.

#### 5.1 Ordre de calcul proposé (à confirmer, P-C2)

1. Gains : salaire de base proratisé (entrée ou sortie en cours de mois : méthode **à confirmer**,
   P-C7) ; heures supplémentaires ; primes ; indemnités ; absences non payées en négatif.
2. Brut.
3. Assiette CNSS (rubriques marquées `cnss`, plafond si le pack en porte un) ; retenue CNSS salarié.
4. Base imposable = gains soumis − éléments déductibles selon le pack (P-C2), convertie en CDF si
   besoin, annualisée ou mensualisée selon la méthode du pack (P-C3).
5. IRPP : barème par tranches ; plafond s'il est confirmé ; réduction pour charges de famille ;
   arrondi du pack.
6. Autres retenues : avance sur salaire (§ 5.4), retenues autorisées saisies.
7. Net à payer ; constat si négatif (`NET_NEGATIVE`, bulletin non validable).
8. Cotisations patronales : CNSS (pensions, risques professionnels, prestations familiales), INPP
   selon la tranche d'effectif, ONEM ; coût employeur.

#### 5.2 Éléments variables venant des autres modules

| Source | Ce qui est repris | Validation |
|---|---|---|
| Absences (ADR-0045) | jours des demandes `approved` des types portant `payrollEffect: 'unpaid'` (champ nouveau de `hr_leave_types`, défaut `none`) | proposés, modifiables jusqu'à `inputs_locked` |
| Présences (ADR-0051) | **proposition** d'heures au-delà de `weeklyReferenceHours`, par semaine, si le pointage est actif | jamais reprises sans validation humaine |
| Avances sur salaire (ADR-0051) | encours `advanceOutstanding` des avances `disbursed` dont le mois annoncé est la période | montant modifiable, jamais au-delà de l'encours ; quotité maximale **à confirmer** (P-J1) |
| Notes de frais (ADR-0051) | **rien** : remboursées par la trésorerie, hors bulletin | — |

#### 5.3 Cas de référence

Un fichier `packages/engine/src/payroll/reference-cases.yaml` : au moins douze bulletins types
(salarié au SMIG, salaire moyen en CDF, salaire en USD, cadre dans la quatrième tranche, trois
personnes à charge, entrée en cours de mois, absence non payée, heures supplémentaires des trois
tranches, retenue d'avance, effectif de 51 salariés pour l'INPP, période à cheval sur un changement de
taux ONEM, paramètre manquant). Chaque cas porte le résultat **attendu calculé à la main par
l'expert-comptable**, son nom et sa date ; sans ces signatures, `mode: active` est refusé.

#### 5.4 Avances sur salaire (amende ADR-0051 § 3.3, ADR-0054 D6, si la paie est activée)

Nouvelle nature de régularisation `payroll_deduction` : posée **par la validation de la période**,
dans la même transaction, avec `payslipId` ; elle remplace la déclaration `declared_payroll`, qui
reste éteinte. Le constat `ADVANCE_SETTLED_ON_PAYROLL` d'ADR-0051 § 7.2 n'a plus lieu d'être pour les
organisations en paie active.

### 6. Permissions (amende ADR-0012, docs/12 ; étend ADR-0041)

| Action | Rôle proposé (défaut) | Note |
|---|---|---|
| `payroll.read` | Propriétaire, Directeur financier, Responsable RH | lit périodes, bulletins, journaux de sa portée |
| `payroll.prepare` | Responsable RH, Directeur financier | éléments variables, calcul ; dépend de `hr.sensitive.read` |
| `payroll.validate` | Propriétaire, Directeur financier | à séparation dynamique ; paire `SOD_PAIRS` `payroll.prepare` / `payroll.validate` |
| `payroll.pay` | Directeur financier, Comptable | ordres de virement ; dépend de `treasury.manage` ; ne voit que les coordonnées masquées |
| `payroll.manage` | Propriétaire | réglages, rubriques, choix du pack, mode |

Le salarié voit **ses** bulletins validés (`/rh/moi`) sans action nouvelle (motif du dossier « moi »).
L'expert-comptable externe (ADR-0049 § 8.2) lit le journal de paie et ses écritures, **pas** les
bulletins nominatifs, sauf décision contraire (décision ouverte n° 6). Chaque calcul et chaque
validation écrivent un audit strict (`payroll.period.calculated|validated`, sans montant).

### 7. Trésorerie (ADR-0034)

- À la déclaration `executed` d'un ordre de virement, la paie crée, par la méthode nouvelle
  `TreasuryExpensesService.recordOwnedByPayroll(session, input)`, **une dépense `personnel` par
  compte payeur**, au montant net total effectivement payé, `origin = { kind: 'payroll_run',
  periodId, orderId }` ; `PUT` et `cancel` par `/treasury/expenses/**` → `409 EXPENSE_OWNED_BY_PAYROLL`.
- Les cotisations et l'IRPP reversés sont des dépenses `impots_taxes` ou `personnel` **saisies** à leur
  paiement, reliées à la période (`origin.kind = 'payroll_remittance'`) ; la catégorie retenue est une
  question (P-C8).
- Prévision de trésorerie : composante « Paie à venir » (net et reversements estimés de la période
  calculée non payée), port `TREASURY_PAYROLL_SOURCE`, fournisseur nul par défaut.
- Coordonnées de paiement changées depuis moins de sept jours : ligne bloquée jusqu'à confirmation par
  une seconde personne détenant `payroll.validate` (§ 4.7, constat).

### 8. Comptabilité (ADR-0049)

#### 8.1 Source et clés

Source nouvelle : période `validated`, `sourceKey = payroll_period:<id>:v<revision>` ; un rectificatif
contre-passe et régénère. Une écriture par période (journal `OD` ou journal de paie `PA` proposé),
lignes agrégées par rubrique ; le détail nominatif reste dans la paie.

Clés d'opération proposées (catalogue du moteur, sans compte écrit ici) : `payroll.gross.base`,
`payroll.gross.overtime`, `payroll.gross.bonus`, `payroll.gross.allowance`,
`payroll.employee.cnss`, `payroll.tax.irpp`, `payroll.employer.cnss.pension`,
`payroll.employer.cnss.occupational`, `payroll.employer.cnss.family`, `payroll.employer.inpp`,
`payroll.employer.onem`, `payroll.advance.deducted`, `payroll.net.payable`, `payroll.payment`,
`payroll.remittance.<organisme>`.

#### 8.2 Comptes : propositions, toutes `requiresReview`

Le pack v2 ne contient que 421, 422 et 661 parmi les comptes utiles. Proposition pour un **pack v3**
relu par l'expert : comptes de charges sociales (classe 66), d'organismes sociaux (classe 43) et
d'impôts retenus à la source (classe 44), numéros et intitulés **à fournir par l'expert** (P-C10).
Sans règle validée, chaque clé va au compte d'attente 471 avec son motif (ADR-0049 § 6.0) ; l'écriture
reste équilibrée.

#### 8.3 Pas de double comptage

La dépense `personnel` possédée par la paie (§ 7) est **ignorée** par la comptabilité (filtre
d'ADR-0049 § 6.3 étendu à `origin.kind = 'payroll_run'`) : la période validée constate la charge, le
paiement solde le compte 422 par `payroll.payment`. Une dépense `personnel` saisie à la main pendant
une période de paie active déclenche le constat `PERSONNEL_EXPENSE_WITH_ACTIVE_PAYROLL`.

### 9. Dépendances

| Module | Dépendance | État |
|---|---|---|
| RH, dossier (ADR-0045) | fiche, `compensation`, `bankDetails`, types d'absence | livré |
| RH, second volet (ADR-0051) | avances, pointage | livré ; amendé § 5.4 |
| ADR-0068 | matricules jamais réutilisés (le bulletin et la CNSS s'y réfèrent), référentiel des postes (catégories), import CSV (gabarit), jours fériés RDC (prorata, heures du jour férié) | **en cours**, non livré : la paie ne démarre pas avant sa fusion |
| Comptabilité (ADR-0049) | pack v3 avec comptes sociaux et fiscaux, catalogue de clés, source nouvelle | pack v3 à écrire et à faire relire |
| Trésorerie (ADR-0034) | dépense possédée, port de prévision | livré ; méthode nouvelle |
| Projets, budgets (brief § 5.6) | coût de paie par projet | budgets de projet **non livrés** ; plus tard, informatif : coût employeur réparti au prorata des temps saisis, jamais écrit dans la marge sans ADR |
| Écrans trésorerie et comptabilité | marques « Paie » sur la dépense et l'écriture, lien vers la période | à ajouter dans les lots P4 et P5 |
| docs/28 | registre de traitement « paie » (finalité, catégories, destinataires, durée de conservation des bulletins : question P-J4) | à écrire au lot P1 |

### 10. Interface

Application RH, onglet « Paie » (`/rh/paie`) : périodes (statuts, totaux), éléments variables
(tableau par collaborateur, import), contrôle (constats), bulletins, ordres de virement, états
préparatoires. Bandeau permanent en simulation : « Simulation — non contractuel. Les taux du pack
sont à confirmer par votre expert-comptable. » `/rh/moi` : bulletins validés du salarié.

## Découpage en lots

| Lot | Contenu | Dépend de |
|---|---|---|
| **P0** | Révision de `cd-2026` (marquage `a_confirmer`, description) ; pack `cd-paie-2026@1` en `draft` avec les valeurs du § 3.2 et leurs sources ; `validatePayrollPack` | — |
| **P1** | Moteur `payroll/` pur, cas de référence (sans signature : tests de cohérence seulement) ; registre de traitement dans docs/28 | P0 |
| **P2** | Collections, réglages, rubriques, profils, éléments variables, import CSV, **export des éléments variables** (utile même paie éteinte) | ADR-0068 fusionné |
| **P3** | Calcul de période, validation à deux personnes, bulletins PDF, portail « moi », rectificatif | P1, P2 |
| **P4** | Source comptable, clés `payroll.*`, pack v3 proposé (`draft`) | P3, réponse P-C10 |
| **P5** | Ordres de virement, dépense possédée, prévision « Paie à venir » | P3 |
| **P6** | États préparatoires CNSS, IRPP, INPP, ONEM (tableaux et CSV, sans dépôt) | P3, réponse P-C11 |
| **P7** | Retenue d'avance (`payroll_deduction`), amendement d'ADR-0051 | P3, réponse P-J1 |

Un fichier = un seul écrivain par lot (règle d'ADR-0011). Zones de conflit : `permissions.ts`
(P2 seul), `treasury-expenses.service.ts` (P5 seul), `engine/src/accounting/` (P4 seul).

## Critères d'acceptation (testables)

1. `mode` vaut `off` à la création ; aucune route de calcul ne répond hors `simulation` ou `active`
   (`409 PAYROLL_DISABLED`).
2. Un pack dont un paramètre consommé est `a_confirmer` est refusé à `approved`
   (`PAYROLL_PARAM_UNCONFIRMED`).
3. `mode: active` est refusé sans pack `approved` et sans les douze cas de référence signés.
4. Chaque bulletin en simulation porte la mention « Simulation — non contractuel » dans le PDF et
   l'écran.
5. Le moteur reproduit chaque cas de référence au centime près (CDF) ; un test échoue si une valeur
   du pack consommée change sans nouvelle version.
6. Une période fige la version du pack et les valeurs effectives ; changer le pack ensuite ne change
   ni total ni empreinte d'une période validée.
7. Un paramètre effectif au 5 août dans le pack est appliqué à la période d'août selon la règle du
   dernier jour (ou la règle retenue par l'expert, P-C12) — test de bascule.
8. Une rubrique dont le paramètre manque n'est pas calculée et produit `PARAM_MISSING`.
9. Un salaire de base inférieur au SMIG du pack produit `BELOW_SMIG` sans rien corriger.
10. Qui a préparé ne valide pas (sauf approbateur unique, marqué) ; test de la paire `SOD_PAIRS`.
11. Un bulletin validé n'est jamais modifié ; un rectificatif porte `supersedes` et un numéro nouveau ;
    la numérotation est sans trou.
12. La retenue d'avance n'excède jamais l'encours et solde l'avance dans la même transaction.
13. La période validée produit une écriture équilibrée ; sans règle validée, les lignes vont au 471
    avec leur motif ; un rejeu n'écrit rien de plus.
14. La dépense possédée par la paie n'est pas recomptée en comptabilité ; `PUT` et `cancel` →
    `409 EXPENSE_OWNED_BY_PAYROLL`.
15. Une ligne d'ordre de virement dont les coordonnées ont changé depuis moins de sept jours est
    bloquée sans confirmation d'une seconde personne.
16. Aucun montant de bulletin dans les notifications, le brief, l'IA (test `ai-contexts.audit` étendu),
    les journaux d'exploitation ni les exports hors paie.
17. Le salarié ne voit que ses bulletins validés ; un autre salarié reçoit 404.
18. Aucun écran ni PDF ne contient « conforme », « certifié », « déclaré à la CNSS » ou « déposé ».

## Conséquences

- La paie devient possible sans rien promettre : simulation d'abord, taux sourcés et relus ensuite.
- La correction de `cd-2026` améliore aussi le prévisionnel (charges patronales sous-estimées :
  7,2 % dans le pack contre environ 16,5 % pour une PME si les sources du § 3.2 sont confirmées).
- Charge de maintenance : chaque loi de finances et chaque arrêté exige une veille et une version du
  pack ; sans veille, la paie doit repasser en simulation (décision ouverte n° 5).
- Responsabilité : l'organisation reste l'employeur déclarant ; Go freelance SARLU fournit un outil de
  calcul (qualification au juriste, P-J5).

## Questions pour l'expert-comptable

- **P-C1 — Impôt sur les salaires 2026.** L'IRPP de la loi n° 23/053 remplace-t-il bien l'IPR pour la
  retenue à la source des salaires depuis le 1ᵉʳ janvier 2026 ? Quel est le barème exact (tranches,
  annuel ou mensuel), après la loi de finances 2026 ? Le plafond de 30 % subsiste-t-il ?
- **P-C2 — Base imposable et ordre de calcul.** Quelles rubriques entrent dans la base de l'IRPP ? La
  CNSS salariale est-elle déduite avant l'impôt ? Quelles indemnités (logement, transport, allocations
  familiales) sont exonérées, et dans quelles limites ?
- **P-C3 — Retenue mensuelle.** Barème annuel divisé par douze, ou annualisation du mois ?
  Régularisation annuelle ? Une déclaration annuelle des revenus du salarié existe-t-elle désormais ?
- **P-C4 — CNSS.** Les taux du décret n° 18/041 (5 % salarié ; 5 %, 1,5 % et 6,5 % employeur) sont-ils
  ceux en vigueur ? Existe-t-il un plafond ? Quelle assiette exacte ?
- **P-C5 — INPP et ONEM.** Taux INPP en vigueur en 2026 et règle de la tranche d'effectif (effectif à
  quelle date) ; ONEM : confirmer le passage à 0,5 % au 5 août 2025 et son assiette.
- **P-C6 — Paie en USD.** Quel taux de conversion pour la base imposable et les cotisations (BCC du
  jour de paie, taux fiscal) ? Les déclarations se font-elles en CDF ?
- **P-C7 — Prorata.** Entrée ou sortie en cours de mois : jours calendaires, jours ouvrables, 26 jours ?
- **P-C8 — Reversements.** Catégorie de dépense et compte des cotisations et de l'IRPP reversés.
- **P-C9 — Correction.** Bulletin rectificatif ou rappel sur la période suivante ?
- **P-C10 — Comptes du pack v3.** Numéros et intitulés SYSCOHADA révisé pour les charges sociales
  patronales, la CNSS, l'INPP, l'ONEM, l'IRPP retenu, les rémunérations dues, les allocations
  familiales.
- **P-C11 — Déclarations.** Contenu attendu des bordereaux CNSS, INPP, ONEM et de la déclaration IRPP,
  pour que l'état préparatoire suive leur forme.
- **P-C12 — Changement de taux en cours de mois.** Le taux applicable est-il celui de la date de
  paiement, de la période travaillée, ou un prorata ?
- **P-C13 — Expatriés.** Régime de l'impôt exceptionnel sur les rémunérations des expatriés sous
  l'IRPP : maintenu, et à quel taux ?

## Questions pour le juriste

- **P-J1 — Retenues sur salaire.** Quotité maximale retenue au titre d'une avance ou d'un prêt, et
  conditions (Code du travail, loi n° 015/2002) — question J1 d'ADR-0051 maintenue.
- **P-J2 — SMIG.** Montant applicable à la date de chaque période (décret n° 25/22 du 30 mai 2025 et son
  calendrier), grille par catégorie professionnelle.
- **P-J3 — Heures supplémentaires et allocations familiales.** Majorations en vigueur ; montant minimal
  des allocations familiales par enfant ; obligations de logement et de transport.
- **P-J4 — Bulletin.** Mentions obligatoires du bulletin, remise électronique admise ou non, durée de
  conservation des bulletins et du journal de paie.
- **P-J5 — Responsabilité.** Qualification de Go freelance SARLU (sous-traitant de traitement, fournisseur
  d'outil) et clauses des CGV à ajouter pour la paie.

## Décisions ouvertes — elles appartiennent à la dirigeante

1. **Lever l'exclusion de la paie** d'ADR-0045 et ADR-0051, aux conditions du § O1. *Défaut : non,
   cet ADR reste proposé ; seul le lot P0 (correction du pack de prévision) est utile sans levée.*
2. **Choix de l'expert-comptable relecteur** du pack et des cas de référence. *Défaut : aucun ; sans lui
   le mode `active` est inaccessible.*
3. **Devise de paie par défaut.** *Défaut : CDF* (barème en CDF).
4. **Ordre des lots** après P0. *Défaut : P2 (export des éléments variables) avant le calcul.*
5. **Veille réglementaire** : qui la tient, à quel rythme. *Défaut : à chaque loi de finances et sur
   alerte ; un pack non revu depuis douze mois repasse les organisations en simulation.*
6. **Lecture des bulletins par l'expert-comptable externe.** *Défaut : non, journal agrégé seulement.*

## Liens

- [ADR-0045](ADR-0045-ressources-humaines.md), [ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md),
  [ADR-0054](ADR-0054-decisions-du-3-novembre.md) (D6), [ADR-0049](ADR-0049-comptabilite-syscohada.md),
  [ADR-0034](ADR-0034-depenses-et-tresorerie.md), [ADR-0012](ADR-0012-modele-rbac-complet.md),
  [ADR-0041](ADR-0041-autorisations-par-membre.md).
- [docs/09 — Country Packs](../09-COUNTRY-PACKS.md), [docs/28 — Conformité légale](../28-CONFORMITE-LEGALE.md),
  [docs/30 — Couverture RH et correspondance ISO](../30-COUVERTURE-RH-REFERENTIEL.md).
- Référentiel RH fourni par la dirigeante (domaine 9, § VI), hors dépôt.
