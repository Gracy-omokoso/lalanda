# ADR-0052 — Mise en route d'une société : une organisation = une entreprise distincte, configurée complètement à sa création, avec statut de complétude, verrous sourcés avant facture et comptabilité, aucune copie implicite et isolation vérifiée de bout en bout

Statut : Proposed
Date : 2026-11-02
Décideurs : Gracy Omokoso (dirigeante) — **besoin exprimé**, en ses mots : « normalement nouvelle
organisation c'est nouvelle entreprise il faut mettre en place un nouvel onboarding de configuration de
société, fisc… ». Elle venait de constater que changer d'organisation ne changeait pas les données ; la
cause, un cookie d'organisation active invisible pour l'API en production, est **corrigée à part**
(commit `eeef21f`, fusion `7ecaff0`). Elle attend désormais que **chaque organisation soit une entreprise
distincte, configurée complètement à sa création**. CTO Lalanda (contrat technique). Le cadrage est
**proposé** : chaque choix qui appartient à la dirigeante porte une valeur par défaut, la plus prudente,
appliquée tant qu'elle ne tranche pas autrement (§ Décisions ouvertes). **Aucune règle fiscale ni
juridique n'est posée par cet ADR** : formes juridiques admises en RDC, régimes fiscaux, identifiants
obligatoires sur une facture ou à l'immatriculation sont des **questions** pour l'expert-comptable et le
juriste (§ Questions). Les seuls verrous retenus sont ceux que le dépôt applique déjà, chacun cité à sa
source.

> **Étend [ADR-0030](ADR-0030-refonte-ui-ux.md) § 8** (mise en route en quatre étapes) sans en changer le
> principe : progression **déduite des données enregistrées**, étapes **reprenables**, écrans des étapes =
> **panneaux existants**, une étape fermée au rôle se laisse passer. Elle passe de quatre à neuf étapes
> et **tranche sa décision D3** (le choix des modules quitte le navigateur pour le serveur, § 4).
> **S'appuie sans les modifier** sur [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) (fiche
> fiscale, facture normalisée, prérequis R1), [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md)
> (identité visuelle), [ADR-0034](ADR-0034-depenses-et-tresorerie.md) (comptes de trésorerie),
> [ADR-0049](ADR-0049-comptabilite-syscohada.md) (modes `off`/`simulation`/`active`, prérequis § 3.1),
> [ADR-0044](ADR-0044-achats-et-fournisseurs.md), [ADR-0045](ADR-0045-ressources-humaines.md),
> [ADR-0046](ADR-0046-stocks-equipements-documents.md), [ADR-0050](ADR-0050-contrats-commandes-acomptes-abonnements.md)
> (réglages de module) et [ADR-0041](ADR-0041-autorisations-par-membre.md) (droits effectifs).
> **N'ajoute aucune action RBAC** (amende rien dans [ADR-0012](ADR-0012-modele-rbac-complet.md) ni docs/12).
> **Distinct d'ADR-0053** (séparation administration plateforme / espace organisation, rédigé en
> parallèle) : cet ADR ne touche que l'**espace organisation** et la création d'organisation par un
> utilisateur ; il ne déplace aucun écran d'administration plateforme.

## Contexte

Une organisation Lalanda est le **tenant** : `organizations` porte nom, slug, type, pays et propriétaire
(`apps/api/src/organizations/organization.schema.ts`), et toute donnée cliente est isolée par
organisation (CLAUDE.md, docs/17). Dans la pratique, une organisation **est** une entreprise : elle a sa
fiche fiscale, son NIF, ses points de vente e-MCF, ses comptes, ses clients, sa comptabilité. Mais rien,
à la création, ne le dit ni ne le guide : la fenêtre « Nouvelle organisation » ne demande qu'un **nom**
(`org-switcher.tsx`, `CreateOrgModal`), le pays prend `CD` par défaut, et la configuration de la société
est **dispersée** dans six espaces (Organisation, Fiscalité, Trésorerie, Comptabilité, réglages de
chaque module, Souscription).

### Faits du dépôt qui commandent les décisions (vérifiés le 2 nov. 2026, commit `7ecaff0`)

**La mise en route d'ADR-0030 § 8 existe et fonctionne**, route `/organisation/mise-en-route` :

| Étape actuelle | Panneau réutilisé | « Faite » quand | Fichier |
|---|---|---|---|
| 1. Identité visuelle | `BrandIdentityPanel` | un logo principal ou une couleur | `organisation/_components/onboarding-model.ts` |
| 2. Profil fiscal | `FiscalProfilePanel` | une fiche existe | idem |
| 3. Points de vente | `NormalizedInvoicingPanel` | au moins un point de vente | idem |
| 4. Vos modules | `ChoixModules` | un choix est mémorisé **dans le navigateur** (D3) | `mise-en-route.tsx` |

- La progression est lue par trois appels existants (`use-mise-en-route.ts`) ; une étape fermée au rôle
  n'est pas lue et compte comme « refus ». L'accueil affiche « Mise en route · n/4 »
  (`accueil/page.tsx`, l. 346). La création d'une organisation mène directement à la mise en route
  (`org-switcher.tsx`, l. 177).
- **Ce qui manque** au regard de la demande : le **pays** et le **type** (modifiables seulement après
  coup, dans Paramètres, `organization-space.dto.ts`) ; les **devises** (devise d'affichage
  `organization_settings.deviseAffichage`, monnaie de tenue `accounting_settings.bookCurrency`) ;
  l'**exercice** (`accounting_settings.fiscalYearStartMonth`, défaut 1, « à confirmer par l'expert »,
  ADR-0049 § 2.2, question E6) ; la **trésorerie** (comptes `cash`, `bank`, `mobile_money` avec solde
  d'ouverture, `treasury_accounts`) ; la **comptabilité** (mode, pack, bascule) ; les **réglages des
  modules** ; les **membres** ; l'**offre**. Et surtout : aucune distinction entre ce qui est
  **obligatoire avant un acte** (émettre, normaliser, tenir les livres) et ce qui est **facultatif**.
- **Libellé à corriger** : l'étape 2 annonce « Raison sociale, NIF, RCCM et siège : les mentions
  obligatoires de chaque facture » (`onboarding-model.ts`, l. 38). Or ADR-0021 § 2 tient le RCCM, la
  forme juridique et l'identification nationale pour **facultatifs**, « aucune source disponible ne les
  rend obligatoires ». L'interface pose ici une règle que la documentation refuse de poser.

**Verrous déjà appliqués par le serveur** (les seuls que cet ADR reprend) :

| Acte | Exigé aujourd'hui | Source |
|---|---|---|
| Émettre une facture (ordinaire ou normalisée) | fiche fiscale enregistrée | `invoice-freezing.service.ts` l. 365–371, `FISCAL_PROFILE_REQUIRED` ; `invoice-drafts.service.ts` l. 336 |
| Normaliser une facture | facture normalisée activée ; point de vente `active` de l'environnement | même fichier, `NORMALIZATION_NOT_ENABLED`, `POINT_OF_SALE_REQUIRED`, `POINT_OF_SALE_NOT_ACTIVE` |
| Activer la facture normalisée | fiche fiscale ; siège en RDC ; point de vente actif ; production ouverte ; NIF non déjà activé ailleurs | ADR-0021 § 3, R1, `409 NORMALIZED_INVOICING_PREREQUISITES`, `missing[]` |
| Passer la comptabilité en `active` | pack `approved`/`active` ; `bookCurrency` ; `cutoverDate` ; jeu de règles validé et relu ; premier exercice ouvert ; `accounting.manage` **et** `fiscal.manage` | ADR-0049 § 3.1, `409 ACCOUNTING_ACTIVATION_PRECONDITION`, `missing[]` ; `accounting-settings.service.ts` l. 369 |
| Passer la comptabilité en `simulation` | rien (pack `draft` admis) | ADR-0049 § 3.1 |

**Création d'une organisation par un utilisateur qui en a déjà une**
(`organizations.service.ts`, `createForUser`, l. 137–165) : un document `organizations` et une
appartenance `owner`, **rien d'autre**. Aucun réglage n'est créé (chaque collection de réglages traite
« aucun document » comme l'état par défaut), aucune donnée n'est copiée. L'abonnement est synthétique
(`free`) tant qu'aucun document n'existe (`billing.service.ts` l. 150–157), et l'essai est suivi **par
organisation** (`trialUsed`), alors que docs/13 l. 124 vise « une seule période d'essai par organisation
économique selon règles antifraude ».

**Invitation d'une personne qui a déjà son organisation** (`invitations.service.ts`, `acceptByToken`) :
une appartenance est ajoutée, rien n'est déplacé ; la page d'acceptation et le bandeau posent le cookie
de l'organisation invitante puis mènent à `/accueil` (`invitations/accept/page.tsx` l. 34–40,
`pending-invitations-banner.tsx` l. 37–40). À l'inscription, **toute** personne reçoit une organisation
personnelle « X's Workspace » (`auth.module.ts` l. 28, `provisionPersonalOrgForUser`), y compris quand
elle s'inscrit pour rejoindre une organisation qui l'a invitée.

### Audit d'isolation : aucune donnée rattachée à l'utilisateur au lieu de l'organisation

Méthode : (1) relevé des **151 collections** déclarées dans `apps/api/src` et de leur champ de
rattachement ; (2) lecture outillée de **tous les appels** `find`, `findOne`, `findOneAndUpdate`,
`updateOne/Many`, `deleteOne/Many`, `countDocuments`, `exists`, `distinct`, `aggregate` hors tests, en
signalant chaque filtre sans `organizationId` ; (3) lecture de la résolution de l'organisation active
(`auth.guard.ts` l. 65–80) et des lectures BUILD, RUN et GROW.

**Résultat : aucune fuite de données entre organisations n'a été trouvée.**

- Toutes les collections **métier** portent `organizationId`, y compris celles qui portent aussi un
  `userId` (notifications et leurs préférences, abonnements au brief du matin, sessions vocales de Lala,
  journaux d'usage IA et d'export PDF : clé `{ organizationId, userId }`).
- Les collections **sans** `organizationId` sont toutes de portée utilisateur ou plateforme, à juste
  titre : `user`, `session`, `account`, `verification` (better-auth), `user_preferences`,
  `user_avatars`, `email_change_requests`, `terms_acceptances`, `platform_roles`, `platform_reauth`,
  `organizations`, `scheduled_jobs`, `edef_reference_snapshots`, `accounting_chart_packs` ;
  `integrations` porte `organizationId: null` pour la portée plateforme.
- BUILD (`projects`, `canvases`, `financial_plans`, `business_plans`, `idea_lab_ideas`,
  `financial_objectives`), RUN (ventes, achats, trésorerie, travail, RH, stocks, comptabilité) et GROW
  (`grow_profiles`, `grow-reader.service.ts`) filtrent tous par l'organisation de la session ; « Mes
  tâches » filtre par `{ organizationId, assigneeUserId }` (`work-tasks.service.ts` l. 441–448).
- Les filtres sans `organizationId` restants sont : relecture d'un document que l'on vient de créer par
  son `_id` ; tâches planifiées qui parcourent toutes les organisations (normalisation, rappels,
  synchronisation comptable) ; logo servi par jeton de capacité (`branding.service.ts` l. 399, relié à
  l'identité de son organisation).

**Couplages et défauts relevés** (ce ne sont pas des fuites de données, mais ils contredisent « une
organisation = une entreprise » ; chacun est traité par un lot) :

| # | Fichier, ligne | Constat | Lot |
|---|---|---|---|
| F1 | `apps/api/src/hr/private/hr-private.service.ts` l. 247–255 | la limite horaire de révélation des données privées RH compte `{ actorUserId, action }` **toutes organisations confondues** : une personne membre de deux sociétés voit son quota de l'une consommé par l'autre. Aucune donnée n'est exposée. | O6 |
| F2 | `apps/web/src/app/(app)/_components/org-switcher.tsx` l. 63–66 | sans cookie (nouvel appareil), le sélecteur **affiche** la première appartenance par ancienneté, tandis que l'API **sert** l'organisation principale par rang de rôle (`organizations.service.ts` l. 73–88). L'étiquette peut ne pas correspondre aux données affichées. | O1 |
| F3 | `apps/web/src/app/(app)/organisation/_components/onboarding-model.ts` l. 38 | RCCM présenté comme mention obligatoire, contraire à ADR-0021 § 2. | O2 |
| F4 | `apps/api/src/auth/auth.module.ts` l. 28 | une inscription venue d'une invitation crée tout de même une organisation personnelle vide. | O5 |
| F5 | `apps/web/src/app/(app)/organisation/_components/mise-en-route.tsx` (`ChoixModules`) | le choix des modules vit dans le `localStorage`, par organisation **et par navigateur** (ADR-0030 D3) : il ne suit ni la personne ni la société. | O3 |
| F6 | `apps/api/src/account/user-preferences.schema.ts` l. 62 | une devise d'affichage **personnelle** coexiste avec celle de l'organisation (`organization_settings.deviseAffichage`). C'est une préférence de présentation, aucun calcul ne la lit ; à afficher sans ambiguïté. | O2 |

Le test e2e existant `__tests__/isolation.e2e.test.ts` couvre deux utilisateurs de deux organisations
et, pour un même utilisateur, **les projets seulement** (l. 168). Il ne couvre ni le reste du BUILD, ni le
RUN, ni le GROW : c'est le critère 16.

## Options considérées

### O1 — Où vit l'état de la mise en route ?

- (a) Un drapeau « mise en route terminée » par organisation. Rejeté : il ment dès qu'une donnée est
  effacée ou qu'un point de vente expire ; ADR-0030 l'a déjà écarté.
- (b) **Déduit des données**, comme aujourd'hui, mais **calculé par le serveur** en un seul appel qui lit
  les mêmes services que les verrous. Retenu : une seule vérité, lisible par tout membre (booléens et
  codes, jamais les valeurs), et les verrous affichés sont **ceux** que le serveur appliquera.
- (c) Déduit côté navigateur en multipliant les appels. Rejeté : un membre sans `fiscal.manage` ne peut
  pas lire la fiche, donc ne sait pas si la société peut facturer.

### O2 — Faut-il ajouter des prérequis avant d'émettre une facture ?

- (a) Exiger aussi identité visuelle, compte de trésorerie, forme juridique, RCCM. Rejeté : aucune source
  du dépôt ne les rend obligatoires (ADR-0021 § 2) ; ce serait inventer une règle.
- (b) **Reprendre exactement les verrous existants** et marquer le reste « recommandé » ou
  « facultatif ». Retenu. Un verrou nouveau ne pourra venir que d'une réponse sourcée de l'expert ou du
  juriste, par un ADR.

### O3 — Nouvelle organisation : partir de zéro ou hériter ?

- (a) Copier par défaut la configuration de l'organisation courante. Rejeté : une autre organisation est
  une autre entreprise ; copier la fiche fiscale ou les points de vente fabriquerait une identité fausse
  (et ADR-0021 R1 refuse déjà un même NIF activé deux fois).
- (b) **Rien n'est copié ; une reprise explicite, élément par élément, limitée à la présentation**, sur
  demande. Retenu, avec la reprise reportée à un lot ultérieur (décision ouverte n° 4).

### O4 — Invitation d'une personne qui a déjà son organisation

- (a) Fusionner ou déplacer quoi que ce soit. Rejeté.
- (b) **Ajouter l'appartenance, basculer sur l'organisation invitante, ne rien toucher à l'autre.**
  Retenu ; c'est déjà le comportement, à compléter (§ 6).

### O5 — Permissions : action nouvelle `organization.setup` ?

- Rejeté. Chaque étape est gouvernée par l'action qui gouverne déjà son écran ; la lecture du statut de
  complétude est ouverte à tout membre et ne renvoie que des booléens et des codes.

## Décision

### 1. Principe

**Une organisation est une entreprise distincte.** Elle naît vide ; elle se configure par un parcours
unique, reprenable, qui rassemble ce qui est aujourd'hui dispersé ; chaque étape **est** le panneau
existant de son domaine ; l'interface dit, pour chaque acte engageant (émettre, normaliser, tenir les
livres), ce qui manque encore — en reprenant la liste `missing[]` que le serveur renverrait.

### 2. Parcours de mise en route (`/organisation/mise-en-route`, neuf étapes)

Légende : **Bloquant** = le serveur refuse l'acte cité tant que l'étape n'est pas faite (source dans la
colonne) ; **Recommandé** = utile, jamais exigé ; **Facultatif** = selon l'activité.

| # | Étape | Contenu (panneau réutilisé) | Statut | Action RBAC | Faite quand (lu sur le serveur) |
|---|---|---|---|---|---|
| 1 | **Société** | nom, pays (ISO-2), type d'organisation (`PUT /organizations/current/settings`, `settings-panel.tsx`) | Recommandé ; le **pays** conditionne la facture normalisée (siège en RDC, ADR-0021 R1) | `organization.manage` | le pays a été **confirmé** (§ 4) |
| 2 | **Identité légale et fiscale** | dénomination, enseigne, forme juridique, NIF, RCCM, identification nationale, assujettissement à la TVA, siège, téléphone, e-mail (`FiscalProfilePanel`, ADR-0021 § 2) | **Bloquant pour émettre toute facture** (`FISCAL_PROFILE_REQUIRED`) | `fiscal.manage` | une fiche existe (écriture toujours complète) |
| 3 | **Devises** | devise d'affichage par défaut des projets (`organization_settings.deviseAffichage`) ; rappel que la monnaie de tenue se choisit à l'étape 7 | Recommandé | `organization.manage` | réglage enregistré ou confirmé |
| 4 | **Identité visuelle et modèle de facture** | logos, couleurs, police, modèle (ADR-0028, ADR-0029) | Recommandé | `organization.manage` | un logo principal ou une couleur |
| 5 | **Facture normalisée DGI** | points de vente e-MCF, environnement, activation (`NormalizedInvoicingPanel`) | **Facultatif** (choix de l'entreprise, ADR-0021 § 1 et § 3) ; **bloquant pour normaliser** (R1, R2) | `fiscal.manage` | facture normalisée activée **ou** étape déclarée « pas maintenant » |
| 6 | **Trésorerie** | comptes bancaires, caisses, mobile money, devise et solde d'ouverture (écran Trésorerie, ADR-0034) | Recommandé | `treasury.manage` | au moins un compte **ou** « pas maintenant » |
| 7 | **Comptabilité et exercice** | mode (`off` par défaut), pack, monnaie de tenue, date de bascule, mois de début d'exercice, premier exercice (écran Comptabilité, ADR-0049) | **Facultatif** ; **bloquant pour passer en `active`** (ADR-0049 § 3.1) ; `simulation` toujours permise | `accounting.manage` (+ `fiscal.manage` pour `active`) | mode `active` **ou** `simulation` **ou** « pas maintenant » |
| 8 | **Équipe** | membres, invitations, rôles (écran Membres, ADR-0041) | Facultatif | `members.invite` | au moins une invitation envoyée **ou** « je travaille seul » |
| 9 | **Modules, réglages et offre** | modules affichés (tranche ADR-0030 D3) ; liens vers les réglages existants de Ventes (contrats, ADR-0050), Achats (approbations, ADR-0044), RH (ADR-0045), Stocks (ADR-0046) ; offre et essai (Souscription) | Facultatif ; l'offre ouvre ou ferme l'accès (ADR-0018), jamais la mise en route | tout membre pour les modules ; `billing.manage` pour l'offre ; `*.manage` du module pour ses réglages | un choix de modules enregistré |

Règles du parcours :

- **Reprenable** : la progression reste déduite des données (ADR-0030 § 8) ; seules les **déclarations**
  (« pays confirmé », « pas maintenant », « je travaille seul », modules) sont mémorisées, côté serveur
  (§ 4). Chaque étape est une URL (`?etape=`), on revient où l'on s'était arrêté, sur tout appareil.
- **Ordre libre**, ordre conseillé ci-dessus ; « Passer pour l'instant » n'enregistre rien.
- **Aucune valeur par défaut fiscale ou comptable n'est posée par le parcours** : pas de forme
  juridique présélectionnée, pas d'assujettissement à la TVA coché, pas de monnaie de tenue choisie
  (ADR-0049 : « aucun défaut »), pas de mois d'exercice affirmé (le défaut technique `1` reste affiché
  « à confirmer par l'expert-comptable », question E6 d'ADR-0049).
- **Libellés** : l'étape 2 dit « les informations qui figurent sur vos factures » ; elle n'emploie le mot
  « obligatoire » que pour les champs que le serveur exige (F3 corrigé). Les champs facultatifs portent
  « facultatif — à confirmer avec votre juriste s'il doit figurer sur vos factures ».
- Une étape **fermée au rôle** se présente comme aujourd'hui (« faite par … ») et se laisse passer.

### 3. Statut de complétude

**Contrat** : `GET /organizations/current/setup` (`AuthGuard`, organisation de la session, **tout
membre**). Réponse (schéma zod dans `packages/shared/src/organization-setup/`) :

```ts
type OrganizationSetupView = {
  organizationId: string;
  steps: Array<{
    id: 'societe' | 'fiscal' | 'devises' | 'identite' | 'normalisation'
      | 'tresorerie' | 'comptabilite' | 'equipe' | 'modules';
    state: 'done' | 'todo' | 'deferred';     // deferred = « pas maintenant » déclaré
    requiredFor: Array<'invoice' | 'normalize' | 'accounting_active'>;
    canAct: boolean;                          // droits EFFECTIFS de l'appelant (ADR-0041)
  }>;
  capabilities: {
    invoice:           { ready: boolean; missing: string[] };  // ['fiscal_profile']
    normalize:         { ready: boolean; missing: string[] };  // codes R1 d'ADR-0021
    accounting_active: { ready: boolean; missing: string[] };  // codes d'ADR-0049 § 3.1
  };
};
```

- Les `missing[]` sont **produits par les fonctions qui gardent les actes** (fiche fiscale lue par
  `FiscalProfileService`, prérequis R1 par `NormalizedInvoicingService`, `activationMissing` par
  `AccountingSettingsService`), jamais recopiés à la main : un verrou ajouté plus tard apparaît seul.
- **Aucune valeur** n'est renvoyée (ni NIF, ni solde, ni nom de membre) : un Commercial sait que la
  société « ne peut pas encore émettre — fiche fiscale manquante », sans voir la fiche.
- **Accueil** : la carte « Mise en route · n/9 » devient une carte **« Votre société »** : trois
  pastilles (Facturer · Normaliser · Comptabilité) prêtes ou non, avec ce qui manque et qui peut le
  faire ; un lien vers l'étape. Elle disparaît quand toutes les étapes sont `done` ou `deferred`, et
  reste accessible depuis Organisation › Mise en route. Une étape `deferred` n'est jamais présentée
  comme une faute.
- **Au moment de l'acte** : l'éditeur de facture, l'écran de normalisation et l'écran Comptabilité
  affichent la même phrase et le même lien vers l'étape quand le serveur refuse (`409` existants) ; aucun
  nouveau refus n'est créé.

### 4. Déclarations mémorisées : `organization_setup` (une par organisation)

| Champ | Règle |
|---|---|
| `organizationId` | unique |
| `countryConfirmedAt`, `countryConfirmedBy` | posés quand un détenteur d'`organization.manage` valide l'étape 1 |
| `deferred` | `{ normalisation?, tresorerie?, comptabilite?, equipe? }` → `{ at, by }` ; retiré dès que l'étape devient `done` |
| `modules` | `('build' \| 'run' \| 'grow')[]` ou `null` (= tous) — **tranche ADR-0030 D3** : remplace le `localStorage` (F5), lu au premier rendu, l'ancienne valeur locale reprise une fois puis effacée |
| `createdFrom` | `null` (création à vide) ; réservé à la reprise explicite (§ 5, décision ouverte n° 4) |
| `updatedBy`, `_schemaVersion: 1`, horodatage | |

Écrivain unique : le module `organization-setup`. Aucun document = rien de déclaré. Audit `record` :
`organization_setup.deferred`, `organization_setup.modules_changed`.

### 5. Organisation créée par un utilisateur qui en a déjà une

- **La fenêtre de création demande** : nom ; pays (liste ISO-2, `CD` proposé, avertissement « la facture
  normalisée DGI n'est disponible que pour un siège en RDC » quand un autre pays est choisi — ADR-0021
  R1) ; type d'organisation. Elle dit en une phrase : « Une organisation est une entreprise distincte :
  elle commence vide, avec ses propres fiche fiscale, clients, comptes et membres. »
- **Rien n'est copié.** Ni fiche fiscale, ni NIF, ni points de vente, ni jetons e-MCF ni secrets
  (ADR-0013), ni clients, catalogue, fournisseurs, salariés, stocks, comptes de trésorerie, écritures,
  projets, plans, idées, membres, préférences de notification, abonnement ou essai. Le créateur est seul
  `owner`. Un test le vérifie (critère 9).
- **Reprise explicite (lot ultérieur, décision ouverte n° 4)** : une case par élément, décochée par
  défaut, limitée à la **présentation** — identité visuelle et modèle de facture, colonnes de travail,
  étapes du pipeline CRM, devise d'affichage. Exige `organization.manage` dans **les deux**
  organisations ; la copie est un nouveau document (jamais une référence partagée) ; `createdFrom`
  garde la trace ; audit dans les deux organisations.
- **Bascule** : la nouvelle organisation devient active (cookie), l'utilisateur arrive sur l'étape 1.
- **Offre** : l'organisation neuve est en `free` (comportement actuel). L'essai par organisation
  économique (docs/13) est la décision ouverte n° 6.

### 6. Invitation d'une personne qui a déjà son organisation

- L'acceptation **ajoute** une appartenance ; aucune donnée ne bouge, l'autre organisation reste
  intacte et accessible depuis le sélecteur.
- **Bascule propre** (déjà en place, à garder sous test) : cookie de l'organisation invitante posé,
  navigation vers `/accueil`, rafraîchissement complet du coquillage (actions, offre, modules relus pour
  la nouvelle organisation). Les clés locales du navigateur restent suffixées par organisation.
- L'invité **n'est pas envoyé dans la mise en route** : l'accueil lui montre la carte « Votre société »
  en lecture (ce qui manque et qui peut le faire) ; il n'agit que sur les étapes que ses droits ouvrent.
- **Inscription venue d'une invitation** (F4) : décision ouverte n° 5 ; par défaut, l'organisation
  personnelle reste créée (aucune personne ne doit se retrouver sans organisation, `NO_ORGANIZATION`),
  mais la personne atterrit sur l'organisation invitante et l'organisation personnelle n'ouvre pas sa
  mise en route tant qu'elle n'y entre pas.
- **Sélecteur** (F2) : l'organisation **affichée** est celle que l'API sert. `GET /organizations` ajoute
  `activeOrganizationId` (la valeur de `req.orgId`) ; le sélecteur l'affiche au lieu de la première
  appartenance.

### 7. RBAC

Aucune action nouvelle, aucun rôle nouveau.

| Geste | Action exigée (droits effectifs, ADR-0041) |
|---|---|
| Lire le statut de complétude, ouvrir la mise en route | être membre |
| Étapes 1, 3, 4 ; confirmer le pays ; « pas maintenant » de ces étapes | `organization.manage` |
| Étapes 2 et 5 | `fiscal.manage` (ré-authentification déjà exigée pour activer, ADR-0021 § 8) |
| Étape 6 | `treasury.manage` |
| Étape 7 | `accounting.manage` ; `active` exige en plus `fiscal.manage` (ADR-0049 § 3.1) |
| Étape 8 | `members.invite` (règles d'attribution d'ADR-0041 inchangées) |
| Étape 9 : modules | tout membre (rangement de la navigation, n'ouvre aucun accès) — décision ouverte n° 3 |
| Étape 9 : offre ; réglages de module | `billing.manage` ; `sales.manage`, `purchase.manage`, `hr.manage`, `stock.manage` selon le module |
| Déclarer « pas maintenant » pour une étape | l'action de l'étape |
| Reprise explicite depuis une autre organisation | `organization.manage` dans la source **et** la cible |

`canAct` est calculé avec les droits **effectifs** (titre + écarts par membre). Le rôle Expert-comptable
externe garde ses limites d'ADR-0049 § 8.2.

### 8. Ce que cet ADR n'invente pas

- Aucune liste de formes juridiques « valides en RDC » : la liste technique `LEGAL_FORMS`
  (`fiscal-profile.schema.ts`) reste inchangée et facultative ; sa conformité est une question au
  juriste (JU1).
- Aucun régime fiscal : la fiche ne connaît que `vatRegistered`. Aucun champ « régime » n'est ajouté tant
  que l'expert n'a pas dit lesquels Lalanda doit connaître et ce qu'ils changent (EC1).
- Aucun identifiant rendu obligatoire au-delà de ce que le serveur exige déjà (NIF, dans la fiche, pour
  la facture normalisée — ADR-0021 § 2).
- Aucun format de NIF ou de RCCM (ADR-0021 : seule la concordance avec la DGI fait foi).
- Aucune date d'exercice affirmée ; aucune monnaie de tenue imposée.

## Hors périmètre (v1), dit explicitement

- Vérification de l'existence légale de la société (registre, DGI) au-delà du test de jeton e-MCF.
- Import en masse d'une configuration (fichier), modèles sectoriels de configuration.
- Suppression ou archivage d'une organisation, transfert de propriété (inchangés).
- Rattachement de plusieurs organisations à un groupe (consolidation).
- Pays autres que la RDC pour la facture normalisée.

## Conséquences

- La configuration d'une société se lit **en un endroit**, et chaque membre sait ce qui empêche de
  facturer ou de tenir les livres, sans voir de donnée qu'il n'a pas le droit de lire.
- Les verrous restent **ceux du serveur** : la mise en route ne peut pas promettre un acte que le
  serveur refusera, ni en refuser un qu'il accepte.
- ADR-0030 D3 est tranchée : le choix des modules suit la société, sur tout appareil.
- Un test d'isolation couvre enfin BUILD, RUN et GROW pour un même utilisateur ; un test de structure
  empêche qu'une collection métier naisse sans `organizationId`.
- Coût : un module API de lecture (agrégation de services existants), une collection de déclarations,
  une refonte du modèle de mise en route et de la carte d'accueil. Aucune ligne des factures, de la
  normalisation, de la trésorerie ni de la comptabilité ne change.

## Critères d'acceptation (testables)

1. `GET /organizations/current/setup` répond à **tout membre** de l'organisation active, avec neuf
   étapes et trois capacités ; 401 sans session ; jamais de données d'une autre organisation.
2. La réponse ne contient **aucune valeur** (NIF, raison sociale, solde, nom de membre) : test de forme
   sur le JSON.
3. `capabilities.invoice.missing` vaut `['fiscal_profile']` tant qu'aucune fiche n'existe et `[]` après
   `PUT /organizations/current/fiscal-profile` ; à l'identique, `POST …/issue` répond
   `409 FISCAL_PROFILE_REQUIRED` puis réussit (cohérence verrou ↔ statut).
4. `capabilities.normalize.missing` est **égal** à la liste `missing` de
   `409 NORMALIZED_INVOICING_PREREQUISITES` pour la même organisation au même instant.
5. `capabilities.accounting_active.missing` est **égal** à `details.missing` de
   `409 ACCOUNTING_ACTIVATION_PRECONDITION`.
6. Une étape passe `done` dès que sa donnée existe, sans autre geste ; elle redevient `todo` si la donnée
   disparaît (ex. dernier compte de trésorerie archivé) ; `deferred` est retiré quand l'étape devient
   `done`.
7. « Pas maintenant » exige l'action de l'étape (403 sinon) et n'est pas offert pour l'étape 2.
8. `canAct` reflète les droits **effectifs** : un Administrateur a `canAct: false` sur l'étape 2, un
   Administrateur à qui `fiscal.manage` a été accordée par écart (ADR-0041) a `canAct: true`.
9. **Création à vide** : après `POST /organizations` par un utilisateur propriétaire de A, la nouvelle
   organisation B n'a **aucun** document dans les collections de réglages, d'identité, de fiscalité, de
   trésorerie, de comptabilité, de ventes, d'achats, de RH, de stocks, de travail, de BUILD et de GROW ;
   une seule appartenance (`owner`, le créateur) ; abonnement synthétique `free`.
10. La fenêtre de création envoie `name`, `pays`, `type` ; un pays autre que `CD` affiche l'avertissement
    sur la facture normalisée ; la création mène à `/organisation/mise-en-route?etape=societe` avec B
    active.
11. Le choix des modules est enregistré dans `organization_setup.modules` ; il se retrouve sur un autre
    navigateur ; l'ancienne valeur du `localStorage` est reprise une fois puis effacée.
12. Invitation acceptée par une personne déjà propriétaire de A : appartenance ajoutée dans B, aucune
    écriture dans A, cookie sur B, `/accueil` montre la carte « Votre société » de B, le sélecteur montre
    A et B ; repasser sur A montre les données de A seulement.
13. Sans cookie, l'organisation **affichée** par le sélecteur est `activeOrganizationId` renvoyé par
    `GET /organizations` (F2) ; test du cas « lecteur de l'ancienne B, propriétaire de la récente A ».
14. Le libellé de l'étape 2 ne qualifie d'« obligatoire » aucun champ que le serveur n'exige pas (F3) ;
    test du modèle.
15. La limite de révélation des données privées RH (`HR_LIMITS.revealsPerHour`) est comptée **par organisation** (F1) : atteindre le plafond
    dans A ne réduit pas le quota dans B.
16. **e2e d'isolation, même utilisateur, deux organisations** (`org-isolation-same-user.e2e.test.ts`) :
    Alice possède A et B. Dans A, elle crée au moins une donnée de chaque famille — BUILD (idée, projet,
    Canvas, plan approuvé, business plan, objectifs, réalisé), RUN (client, article, devis, brouillon et
    facture émise, encaissement, fournisseur, bon de commande, dépense, compte de trésorerie, projet et
    tâche de travail, salarié, article de stock, réglages comptables), GROW (profil GROW). Avec le cookie
    sur B : **chaque** liste correspondante est vide ; **chaque** identifiant de A lu, modifié ou
    supprimé via B répond **404** ; « Mes tâches », notifications, brief du matin, tableau de bord
    d'organisation et indicateurs GROW de B ne contiennent rien de A ; `GET /organizations/current/setup`
    de B montre toutes les étapes `todo`. Le même parcours, cookie sur A, retrouve tout.
17. **Test de structure** : toute collection déclarée dans `apps/api/src` porte `organizationId`, sauf
    une liste blanche nommée (utilisateur et plateforme, § Audit) ; ajouter une collection sans
    `organizationId` hors liste fait échouer le test.
18. Accueil : la carte « Votre société » affiche les trois capacités et disparaît quand toutes les étapes
    sont `done` ou `deferred` ; vue mobile sans défilement horizontal (docs/04).
19. Aucune ligne de `sales/invoices/`, `sales/normalization/`, `fiscal/`, `treasury/`, `accounting/` ne
    change hors exports de lecture ajoutés en une ligne (revue de diff).

## Plan de validation

- Tests unitaires du modèle de mise en route (`onboarding-model.test.ts` refait : neuf étapes, états,
  reprise, libellés).
- e2e API : critères 1 à 9, 12, 13, 15, 16 ; test de structure 17.
- Recette manuelle par la dirigeante sur la préproduction : créer une deuxième organisation, la
  configurer jusqu'à « peut facturer », basculer, constater que rien ne passe d'une société à l'autre.
- Relecture des libellés de l'étape 2 et de la carte d'accueil par la dirigeante.

## Questions pour l'expert-comptable

- **EC1** — Quels régimes fiscaux une entreprise cliente de Lalanda peut-elle relever en RDC, et
  lesquels changent ce que Lalanda doit faire (mentions, taux, déclarations) ? Faut-il un champ
  « régime » dans la fiche fiscale ? (Aucun n'est ajouté avant réponse.)
- **EC2** — L'assujettissement à la TVA (`vatRegistered`) suffit-il à décrire la situation TVA d'une
  société pour la facturation, ou faut-il d'autres informations ?
- **EC3** — Mois de début d'exercice : le défaut technique « janvier » est-il juste pour toutes les
  sociétés visées (rejoint E6 d'ADR-0049) ? Doit-on le demander dès la mise en route ?
- **EC4** — Monnaie de tenue : faut-il conseiller un choix à la création d'une société, ou le laisser à
  l'activation de la comptabilité ?
- **EC5** — Deux organisations Lalanda peuvent-elles légitimement partager un même NIF (établissements,
  activités séparées) ? (Rejoint la décision ouverte n° 4 d'ADR-0021.)

## Questions pour le juriste (s'ajoutent à docs/28 § 1.3)

- **JU1** — Quelles formes juridiques sont admises en RDC pour les clients visés ? La liste technique
  `LEGAL_FORMS` est-elle exacte, incomplète, ou à remplacer ?
- **JU2** — Quelles mentions (RCCM, identification nationale, forme juridique, capital, siège) doivent
  figurer sur une facture de société en droit OHADA et congolais ? (ADR-0021 les tient pour facultatives
  faute de source.)
- **JU3** — Une organisation créée dans Lalanda engage-t-elle une responsabilité de l'utilisateur
  créateur vis-à-vis de l'entreprise réelle (déclaration d'exactitude de la fiche fiscale) ? Faut-il une
  case d'attestation à l'étape 2 ?
- **JU4** — La reprise de l'identité visuelle d'une organisation vers une autre soulève-t-elle une
  question de droit des marques si les deux sociétés sont distinctes ?

## Découpage en lots parallélisables (worktrees séparés)

Règle d'ADR-0011 et d'ADR-0012 § 9 : **un fichier = un seul écrivain** par lot ; les fichiers partagés ne
reçoivent que des **ajouts** d'une ligne ou d'un bloc, sous un commentaire `// ADR-0052 — <lot>`.

| Lot | Contenu | Fichiers possédés (probables) | Critères | Tests | Dépend de |
|---|---|---|---|---|---|
| **O0 — Contrats partagés et statut de complétude** | schéma zod de la vue ; module `organization-setup` (lecture) ; collection `organization_setup` et routes de déclaration | `packages/shared/src/organization-setup/**`, **une ligne** dans `packages/shared/package.json` ; `apps/api/src/organization-setup/**` (crée) ; **une ligne** dans `apps/api/src/app.module.ts` ; **une ligne d'export** au besoin dans `fiscal.module.ts`, `accounting/…module.ts`, `treasury/…module.ts` ; `apps/web/src/lib/api.ts` (**un bloc**) | 1 à 8 | e2e `organization-setup.e2e` | — |
| **O1 — Création d'organisation et sélecteur** | fenêtre de création (nom, pays, type, phrase), `activeOrganizationId`, affichage F2 | `apps/web/src/app/(app)/_components/org-switcher.tsx` ; `apps/api/src/organizations/organizations.controller.ts` (réponse de `GET`) | 10, 13 | e2e `invitations`/`organization-space` étendus ; modèle web | O0 (types) |
| **O2 — Parcours web à neuf étapes** | modèle, composant, lecture par `/setup`, libellés (F3, F6), reprise des panneaux existants | `apps/web/src/app/(app)/organisation/_components/{onboarding-model.ts,onboarding-model.test.ts,mise-en-route.tsx,use-mise-en-route.ts}` ; panneaux réutilisés **en lecture** (import seulement) | 6, 7, 14 | modèle pur | O0 |
| **O3 — Modules côté serveur** | lecture/écriture `organization_setup.modules`, reprise du `localStorage` | `apps/web/src/app/(app)/_components/shell-context.tsx` (**le bloc modules seulement**) ; `nav-model.ts` inchangé | 11 | modèle ; e2e | O0 |
| **O4 — Carte « Votre société » à l'accueil** | carte, trois capacités, liens, disparition | `apps/web/src/app/(app)/accueil/{page.tsx (un bloc), _components/votre-societe*.ts(x)}` | 18 | modèle pur | O0 |
| **O5 — Invitation et inscription** | atterrissage sur l'organisation invitante, carte en lecture, comportement F4 selon la décision n° 5 | `apps/web/src/app/(app)/invitations/accept/page.tsx`, `pending-invitations-banner.tsx` ; `apps/api/src/auth/auth.module.ts` (**`onUserCreated` seulement**, si la décision change le défaut) | 12 | e2e `invitations` étendu | O0 |
| **O6 — Isolation** | e2e même utilisateur deux organisations ; test de structure ; quota RH par organisation (F1) | `apps/api/src/__tests__/org-isolation-same-user.e2e.test.ts`, `__tests__/tenant-collections.e2e.test.ts` (créent) ; `apps/api/src/hr/private/hr-private.service.ts` (**méthode `reveal`, une ligne de filtre**) ; `__tests__/hr-private.e2e.test.ts` (un cas) | 15, 16, 17 | e2e | — (parallèle à tout) |
| **O7 — Reprise explicite** (après décision n° 4) | copie élément par élément, `createdFrom`, audit double | `apps/api/src/organization-setup/copy/**` ; fenêtre de création (**un bloc**) | à écrire avec la décision | e2e | O0, O1 |

### Zones de conflit entre lots

| Fichier | Lots | Règle |
|---|---|---|
| `apps/web/src/app/(app)/_components/org-switcher.tsx` | **O1 seul** ; **conflit probable avec ADR-0053** (séparation administration plateforme / espace organisation) si celui-ci touche le menu ou le sélecteur | fusionner ADR-0053 d'abord s'il modifie ce fichier ; O1 rebase et garde ses blocs |
| `apps/api/src/organizations/**` | **O1 seul** (périmètre à écrivain unique, ADR-0012 § 9) | un champ ajouté à la réponse de `GET /organizations`, aucun service modifié |
| `apps/web/src/app/(app)/_components/shell-context.tsx` | **O3 seul** ; zone touchée par ADR-0053 si l'espace d'administration change le coquillage | bloc « modules » seulement |
| `apps/web/src/lib/api.ts` | **O0** (un bloc), O1 (un type) | ajouts en fin de section ; conflit habituel avec tout ADR qui ajoute des appels |
| `apps/api/src/app.module.ts`, `packages/shared/package.json` | **O0 seul** | une ligne chacun |
| `apps/web/src/app/(app)/accueil/page.tsx` | **O4 seul** ; zone partagée avec les cartes « Mes tâches » (ADR-0039 et suivants) | un bloc, sans toucher aux autres cartes |
| `apps/api/src/hr/private/hr-private.service.ts` | **O6 seul** ; zone d'ADR-0051 (RH) | une ligne dans le filtre de `reveal` |
| `apps/api/src/{sales,fiscal,treasury,accounting}/**` | **aucun** | lecture seule par services exportés ; une ligne d'export dans le module propriétaire si nécessaire, revue à part |
| docs/04, docs/12 (aucun amendement de matrice), docs/15, docs/16, index des ADR | O0 (documentation) | une section par lot ; ligne « proposé » passée à « implémenté » lot par lot |

### Ordre de fusion conseillé

```
O6 ─────────────────────────────── (indépendant, dès maintenant)
O0 ──┬── O2 ──┬── O4
     ├── O1   └── O5
     ├── O3
     └── O7 (après décision n° 4)
```

1. **O6** tout de suite : il protège tout le reste et ne dépend de rien.
2. **O0**, puis **O1**, **O2**, **O3** en parallèle.
3. **O4** et **O5**.
4. **O7** seulement si la dirigeante retient la reprise.

Chemin critique : O0 → O2 → O4.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, la plus prudente, appliquée si rien n'est tranché.

1. **Neuf étapes, dans cet ordre.** *Défaut : oui, ordre conseillé mais libre.*
2. **Ce qui bloque l'émission d'une facture.** *Défaut : la fiche fiscale seule, comme aujourd'hui ;
   tout autre verrou attend une réponse sourcée de l'expert-comptable ou du juriste (EC1, JU2).*
3. **Qui choisit les modules affichés** (désormais pour toute l'organisation). *Défaut : tout membre
   peut ranger **sa** vue ; le choix de l'organisation, proposé à tous, est enregistré par un détenteur
   d'`organization.manage` ; un membre peut toujours « afficher tous les modules ».*
4. **Reprise explicite depuis une autre organisation.** *Défaut : pas en v1 (lot O7 non lancé) ; une
   organisation neuve part toujours de zéro.*
5. **Inscription venue d'une invitation : créer l'organisation personnelle ?** *Défaut : oui (aucun
   compte sans organisation), mais atterrissage sur l'organisation invitante et pas de mise en route de
   l'organisation personnelle tant que la personne n'y entre pas.*
6. **Essai gratuit : par organisation ou par « organisation économique » (docs/13) ?** *Défaut : aucun
   changement du comportement actuel (un essai par organisation) ; aucune règle antifraude inventée ;
   à reprendre dans l'ADR qui fixera la tarification de RUN (ADR-0021, décision ouverte n° 2).*
7. **Attestation d'exactitude à l'étape 2** (JU3). *Défaut : non, en attente du juriste.*
8. **Nombre d'organisations qu'un utilisateur peut créer.** *Défaut : pas de limite nouvelle (aucune
   aujourd'hui) ; le sujet rejoint la décision n° 6.*
9. **Quota de révélation RH par organisation (F1).** *Défaut : oui, compté par organisation, même
   plafond qu'aujourd'hui.*

## Liens

- [ADR-0030](ADR-0030-refonte-ui-ux.md) § 8 et décision D3 — mise en route actuelle.
- [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) — fiche fiscale, facture normalisée, R1.
- [ADR-0049](ADR-0049-comptabilite-syscohada.md) § 2.2 et § 3.1 — réglages et activation de la
  comptabilité.
- [ADR-0034](ADR-0034-depenses-et-tresorerie.md) — comptes de trésorerie.
- [ADR-0041](ADR-0041-autorisations-par-membre.md) — droits effectifs.
- [ADR-0012](ADR-0012-modele-rbac-complet.md) § 9 — écrivain unique de `organizations/`.
- docs/09 (Country Packs), docs/12 (rôles), docs/13 (essai), docs/17 (isolation), docs/28 § 1.3
  (questions au juriste).
- `apps/api/src/__tests__/isolation.e2e.test.ts` — test d'isolation existant, étendu par le critère 16.
