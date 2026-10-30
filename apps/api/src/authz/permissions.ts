// ─────────────────────────────────────────────────────────────────────────────
// SOURCE DE VÉRITÉ DES PERMISSIONS
// docs/12-ROLES-PERMISSIONS.md · ADR-0012 (Accepted, 2026-08-08)
//
// Ce fichier — et lui seul — décide « qui a le droit de faire quoi ». ADR-0012 §8 :
// « Aucun `if (role === …)` hors de `permissions.ts` ». Les guards, les contrôleurs
// et l'interface consomment `can()` / `canPlatform()`.
//
// Trois ensembles fermés (docs/26 « états représentés par unions fermées ») :
//   1. ORG_ROLES       — les 10 rôles d'organisation (ADR-0012 §1 ; le neuvième,
//                        `sales_rep`, d'ADR-0040 § 4.2 ; le dixième, `hr_manager`,
//                        d'ADR-0045 § 4.2);
//   2. PLATFORM_ROLES  — les 6 rôles plateforme, préfixés `platform_` (§2);
//   3. ACTIONS         — les 38 actions granulaires, dans l'ordre de docs/12
//                        (la seizième, `fiscal.manage`, vient d'ADR-0021 §8 ;
//                        la dix-septième et la dix-huitième, `sales.read` et
//                        `sales.manage`, d'ADR-0022 § S25c.1 ; la dix-neuvième,
//                        `sales.invoice`, d'ADR-0023 § S25e.11 ; la vingtième,
//                        `sales.receipt`, d'ADR-0031 § 4 ; les vingt-et-unième et
//                        vingt-deuxième, `treasury.read` et `treasury.manage`,
//                        d'ADR-0034 § 8 ; les vingt-troisième et vingt-quatrième,
//                        `crm.read` et `crm.manage`, d'ADR-0035 § 3 — ordre de
//                        fusion, amendement du 27 oct. 2026 ; les vingt-cinquième
//                        à vingt-septième, `work.read`, `work.update` et
//                        `work.manage`, d'ADR-0039 § 7 ; la vingt-huitième,
//                        `sales.quote`, d'ADR-0040 § 4.1 ; les vingt-neuvième à
//                        trente-troisième, `purchase.read`, `purchase.request`,
//                        `purchase.manage`, `purchase.approve` et `payables.pay`,
//                        d'ADR-0044 § 4.1 ; les trente-quatrième à
//                        trente-huitième, `hr.read`, `hr.manage`,
//                        `hr.sensitive.read`, `leave.request` et `leave.approve`,
//                        d'ADR-0045 § 4.1).
//
// Refus par défaut (docs/17 § Autorisation) : les matrices sont exhaustives, une
// case absente ne compile pas, et une case `deny` est un refus.
//
// Note d'implémentation — emplacement. ADR-0012 §8 situe ce fichier dans
// `apps/api/src/auth/`. Il vit dans `apps/api/src/authz/` : `auth/` porte
// l'AUTHENTIFICATION (better-auth, session, organisation active) et `authz/`
// l'AUTORISATION. Les deux répertoires appartiennent au même propriétaire
// (ADR-0012 §9, « Dev RBAC »), la frontière d'écriture est donc inchangée.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les 10 rôles d'organisation (ADR-0012 §1). Le neuvième, `sales_rep` (« Commercial »),
 * vient d'ADR-0040 § 4.2 ; le dixième, `hr_manager` (« Responsable RH »), d'ADR-0045
 * § 4.2 : ajoutés EN FIN de liste (ordre de fusion, comme les actions).
 *
 * Slugs en anglais `snake_case` (docs/26 « noms de code en anglais »). `owner`
 * conserve la valeur de l'ancien modèle : la migration S20a n'a donc aucun
 * document `owner` à réécrire, seulement `member`.
 */
export const ORG_ROLES = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'project_manager',
  'advisor',
  'viewer',
  // ADR-0040 — C0 : CRM, devis et suivi des clients ; ni trésorerie ni facture.
  'sales_rep',
  // ADR-0045 — H0 : dossiers du personnel, absences et documents RH ; ni trésorerie,
  // ni ventes, ni achats.
  'hr_manager',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * Rang de privilège explicite — `owner` = 0 (le plus privilégié).
 *
 * Existe pour une raison précise (ADR-0012 §7, « piège découvert ») :
 * `organizations.service.ts` sélectionnait l'organisation primaire avec un
 * `.sort({ role: -1 })` qui reposait sur l'ordre ALPHABÉTIQUE des deux anciennes
 * valeurs (`'owner' > 'member'`). Avec huit slugs cette astuce se retourne :
 * `'viewer' > 'project_manager' > 'owner'`. Un utilisateur propriétaire d'une org
 * et lecteur d'une autre basculait silencieusement sur la mauvaise. Le rang est
 * désormais une donnée, pas un accident de tri.
 *
 * Ne PAS dériver ce rang de la matrice : deux rôles peuvent avoir des ensembles
 * d'actions incomparables (un `accountant` n'est ni au-dessus ni en dessous d'un
 * `analyst`). Le rang est un ordre total arbitraire mais stable, utilisé
 * uniquement pour choisir une organisation par défaut et trier un affichage.
 */
export const ORG_ROLE_RANK: Readonly<Record<OrgRole, number>> = {
  owner: 0,
  admin: 1,
  finance_director: 2,
  accountant: 3,
  analyst: 4,
  // ADR-0040 § 4.3 : le Commercial s'insère au rang 5 ; les suivants glissent d'un
  // cran. Le rang n'est pas un droit : aucun accès ne change.
  sales_rep: 5,
  // ADR-0045 § 4.2 : le Responsable RH s'insère au rang 6 ; les suivants glissent
  // d'un cran. Le rang n'est pas un droit : aucun accès ne change.
  hr_manager: 6,
  project_manager: 7,
  advisor: 8,
  viewer: 9,
};

/**
 * Les 6 rôles plateforme (ADR-0012 §2). Le préfixe `platform_` est OBLIGATOIRE :
 * les deux espaces de noms cohabitent dans le même code, la collision doit être
 * impossible à écrire.
 */
export const PLATFORM_ROLES = [
  'platform_super_admin',
  'platform_admin',
  'platform_support',
  'platform_billing',
  'platform_template_editor',
  'platform_country_pack_manager',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Les 38 actions granulaires (docs/12 § Actions granulaires, ordre du document).
 *
 * `fiscal.manage` (ADR-0021 §8) est ajoutée EN FIN de liste, et non à côté
 * d'`organization.manage` : l'ordre est celui de docs/12, que l'interface et les
 * tests reprennent tel quel. L'insérer ailleurs déplacerait des lignes sans rien
 * changer au sens. `sales.read` et `sales.manage` (ADR-0022 § S25c.1) suivent la
 * même règle : dix-septième et dix-huitième, en fin de liste. `sales.invoice`
 * (ADR-0023 § S25e.11) est la dix-neuvième, `sales.receipt` (ADR-0031 § 4) la vingtième,
 * `treasury.read` et `treasury.manage` (ADR-0034 § 8) les vingt et unième et vingt-deuxième,
 * `crm.read` et `crm.manage` (ADR-0035 § 3) les vingt-troisième et vingt-quatrième,
 * `work.read`, `work.update` et `work.manage` (ADR-0039 § 7) les vingt-cinquième à
 * vingt-septième, `sales.quote` (ADR-0040 § 4.1) la vingt-huitième, `purchase.read`,
 * `purchase.request`, `purchase.manage`, `purchase.approve` et `payables.pay`
 * (ADR-0044 § 4.1) les vingt-neuvième à trente-troisième, `hr.read`, `hr.manage`,
 * `hr.sensitive.read`, `leave.request` et `leave.approve` (ADR-0045 § 4.1) les
 * trente-quatrième à trente-huitième.
 */
export const ACTIONS = [
  'organization.manage',
  'billing.manage',
  'members.invite',
  'project.create',
  'project.read',
  'project.update',
  'canvas.update',
  'inputs.update',
  'plan.calculate',
  'plan.approve',
  'actuals.import',
  'period.close',
  'analytics.read',
  'report.export',
  'audit.read',
  'fiscal.manage',
  'sales.read',
  'sales.manage',
  'sales.invoice',
  'sales.receipt',
  // ADR-0034 § 8 : dépenses, comptes de trésorerie, prévision.
  'treasury.read',
  'treasury.manage',
  // ADR-0035 § 3 : CRM minimal (contacts, prospects, opportunités, activités).
  'crm.read',
  'crm.manage',
  // ADR-0039 § 7 : projets et tâches du RUN (module `work`).
  'work.read',
  'work.update',
  'work.manage',
  // ADR-0040 § 4.1 : préparer les devis, séparé de `sales.manage` (clients, catalogue,
  // brouillons de facture). Convertir un devis exige les deux.
  'sales.quote',
  // ADR-0044 — P0 : achats et fournisseurs (§ 4.1). Demander, préparer, autoriser et
  // payer sont quatre actions distinctes : l'autorisation de dépense (`purchase.approve`)
  // ne se cumule pas avec le paiement par ajout (`SOD_PAIRS`).
  'purchase.read',
  'purchase.request',
  'purchase.manage',
  'purchase.approve',
  'payables.pay',
  // ADR-0045 — H0 : ressources humaines (§ 4.1). Le dossier non sensible, sa gestion,
  // les données sensibles (salaire, banque, identité, coordonnées personnelles), la
  // demande d'absence pour soi et la validation des absences (étape RH, suppléance).
  'hr.read',
  'hr.manage',
  'hr.sensitive.read',
  'leave.request',
  'leave.approve',
] as const;

export type Action = (typeof ACTIONS)[number];

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/**
 * Slug du rôle propriétaire (ADR-0012 §1, libellé « Propriétaire »).
 *
 * Nommé plutôt qu'écrit en dur parce que quelques règles portent sur l'IDENTITÉ du
 * rôle et non sur ses actions : « le dernier propriétaire ne peut être ni retiré
 * ni rétrogradé » (docs/12 § Règles critiques, R1) ne se déduit d'aucune case de
 * la matrice — un `admin` détenant les mêmes actions ne gouvernerait pas pour
 * autant l'abonnement ni le transfert.
 */
export const OWNER_ROLE: OrgRole = 'owner';

/**
 * Ce rôle est-il celui d'un propriétaire ?
 *
 * Volontairement plus tolérant qu'`isOrgRole` : la valeur vient d'un document
 * Mongo, pas d'un type TypeScript. Une casse inattendue ou des espaces de bord ne
 * doivent pas faire passer un propriétaire pour un simple membre — ce serait
 * autoriser la suppression d'un compte qui laisserait derrière lui une
 * organisation sans gouvernance, exactement ce que R1 interdit. Le faux négatif
 * est ici plus grave que le faux positif : refuser une suppression de trop se
 * rattrape, en autoriser une de trop non.
 *
 * Provient de `account/owner-role.ts` (S20b), fichier temporaire qui isolait ce
 * fait en attendant cette matrice; il a été supprimé au rebase de S20a.
 */
export function isOwnerRole(role: unknown): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === OWNER_ROLE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrice organisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nature d'une case de la matrice organisation. Reprend la légende d'ADR-0012 §3
 * au lieu d'un simple booléen : les annotations ⚙ / P / ⓢ portent des règles
 * métier qu'un `true` écraserait silencieusement.
 *
 * - `allow`         (✓) — autorisé sans condition.
 * - `deny`          (✗) — refusé. Aucun contournement, même plateforme.
 * - `allow_sod`     (✓ⓢ) — autorisé, mais soumis à la séparation des tâches :
 *                    l'approbateur ne peut pas être le dernier auteur des entrées
 *                    (R2). Le guard laisse passer; le service applique la règle,
 *                    car elle dépend de la RESSOURCE, pas du seul rôle.
 * - `allow_project` (✓P) — autorisé, mais restreint aux projets assignés. Les
 *                    assignations (`project_assignments`) n'existent pas encore :
 *                    non implémenté, et c'est pourquoi `project_manager` n'est pas
 *                    attribuable (voir `ROLE_NOT_ASSIGNABLE`). Se comporte comme
 *                    `allow` pour tout rôle qui l'obtiendrait malgré tout.
 * - `conditional`   (⚙) — exige un droit explicite porté par le membership,
 *                    `false` par défaut. Seule occurrence : `accountant` +
 *                    `period.close` (docs/12 « clôture selon permission »).
 */
export type OrgGrant = 'allow' | 'deny' | 'allow_sod' | 'allow_project' | 'conditional';

/**
 * MATRICE RÔLE ORGANISATION × ACTION — transcription littérale d'ADR-0012 §3.
 *
 * Le type impose 10 rôles × 38 actions : oublier une case ne compile pas.
 * `permissions.test.ts` redéclare cette matrice en littéral (elle n'est PAS
 * importée d'ici) : toute modification de production casse le test et force une
 * mise à jour consciente de l'ADR et de docs/12. C'est le garde-fou central.
 */
export const ORG_PERMISSION_MATRIX: Readonly<Record<OrgRole, Readonly<Record<Action, OrgGrant>>>> =
  {
    // Propriétaire — « abonnement, membres, suppression et transfert » (docs/12).
    // Seul rôle à détenir `billing.manage`. Détient aussi `inputs.update` ET
    // `plan.approve` : c'est ce qui rend l'organisation solo (entrepreneur seul,
    // cas majoritaire en RDC) utilisable — voir `soleApprover` dans les plans.
    owner: {
      'organization.manage': 'allow',
      'billing.manage': 'allow',
      'members.invite': 'allow',
      'project.create': 'allow',
      'project.read': 'allow',
      'project.update': 'allow',
      'canvas.update': 'allow',
      'inputs.update': 'allow',
      'plan.calculate': 'allow',
      'plan.approve': 'allow_sod',
      'actuals.import': 'allow',
      'period.close': 'allow',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'allow',
      // ADR-0021 §8 : saisir le jeton e-MCF et basculer le régime de facturation
      // engagent le contribuable devant la DGI — autorité financière seulement.
      'fiscal.manage': 'allow',
      // ADR-0022 § S25c.1 : clients et catalogue sont des données maîtres
      // opérationnelles, sans engagement fiscal (l'émission d'une facture aura
      // sa propre action au lot S25e).
      'sales.read': 'allow',
      'sales.manage': 'allow',
      // ADR-0023 § S25e.11 : émettre ou normaliser une facture ou un avoir engage
      // le contribuable — action distincte de la préparation (`sales.manage`).
      'sales.invoice': 'allow',
      // ADR-0031 § 4 : enregistrer l'argent reçu est un acte de trésorerie — même
      // population que `sales.invoice`, action distincte (un caissier pourra un jour
      // encaisser sans émettre).
      'sales.receipt': 'allow',
      // ADR-0034 § 8 : dépenses, comptes et prévision de trésorerie.
      'treasury.read': 'allow',
      'treasury.manage': 'allow',
      // ADR-0035 § 3 : le CRM (contacts, prospects, opportunités, activités) suit
      // la répartition de `sales.*` — données personnelles, sans engagement fiscal.
      'crm.read': 'allow',
      'crm.manage': 'allow',
      // ADR-0039 § 7 : gestionnaire de projets et de tâches du RUN (module `work`).
      // Lire, travailler (cocher, commenter, saisir son temps), gouverner (créer,
      // archiver, supprimer un projet, colonnes, étiquettes, temps d'autrui).
      'work.read': 'allow',
      'work.update': 'allow',
      'work.manage': 'allow',
      // ADR-0040 § 4.1 : préparer les devis. Iso-privilège : tous les détenteurs de
      // `sales.manage` la reçoivent ; le Commercial la reçoit seul en plus.
      'sales.quote': 'allow',
      // ADR-0044 § 4.1 : achats. `purchase.approve` est une autorité de dépense (ⓢ :
      // le demandeur n'approuve pas sa demande, sauf approbateur unique).
      'purchase.read': 'allow',
      'purchase.request': 'allow',
      'purchase.manage': 'allow',
      'purchase.approve': 'allow_sod',
      'payables.pay': 'allow',
      // ADR-0045 — H0 (§ 4.1) : ressources humaines. `leave.approve` est une autorité RH (ⓢ :
      // on ne valide pas sa propre absence, sauf approbateur unique).
      'hr.read': 'allow',
      'hr.manage': 'allow',
      'hr.sensitive.read': 'allow',
      'leave.request': 'allow',
      'leave.approve': 'allow_sod',
    },
    // Administrateur — « membres, projets, paramètres ». Gouvernance technique,
    // pas autorité financière : ni `billing.manage`, ni `plan.approve`, ni
    // `period.close` (ADR-0012 §3, justifications).
    admin: {
      'organization.manage': 'allow',
      'billing.manage': 'deny',
      'members.invite': 'allow',
      'project.create': 'allow',
      'project.read': 'allow',
      'project.update': 'allow',
      'canvas.update': 'allow',
      'inputs.update': 'allow',
      'plan.calculate': 'allow',
      'plan.approve': 'deny',
      'actuals.import': 'allow',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'allow',
      // Gouvernance technique : l'identité fiscale et la facture normalisée
      // engagent le contribuable, comme `plan.approve` (ADR-0021 §8, O2).
      'fiscal.manage': 'deny',
      // Les données maîtres de vente n'engagent pas le contribuable : l'Administrateur
      // les tient, contrairement à `fiscal.manage` (ADR-0022 § S25c.1).
      'sales.read': 'allow',
      'sales.manage': 'allow',
      // Prépare les brouillons mais n'émet pas : émettre engage le contribuable
      // (ADR-0023 § S25e.11, décision ouverte n° 1).
      'sales.invoice': 'deny',
      // N'enregistre pas d'encaissement (ADR-0031, décision ouverte n° 9).
      'sales.receipt': 'deny',
      // Consulte la trésorerie ; n'enregistre pas de décaissement — acte de
      // trésorerie, comme un encaissement (ADR-0034, décision ouverte n° 7).
      'treasury.read': 'allow',
      'treasury.manage': 'deny',
      'crm.read': 'allow',
      'crm.manage': 'allow',
      // ADR-0039 § 7 : organiser le travail est de la gouvernance, pas un acte financier.
      'work.read': 'allow',
      'work.update': 'allow',
      'work.manage': 'allow',
      'sales.quote': 'allow',
      // ADR-0044 § 4.1 : prépare (fiches, commandes, factures) sans approuver ni payer,
      // comme il prépare une facture sans l'émettre.
      'purchase.read': 'allow',
      'purchase.request': 'allow',
      'purchase.manage': 'allow',
      'purchase.approve': 'deny',
      'payables.pay': 'deny',
      // ADR-0045 — H0 (§ 4.1) : tient le registre (fiches, services, dates) sans les données
      // sensibles ; ne valide pas les absences (décision ouverte n° 3).
      'hr.read': 'allow',
      'hr.manage': 'allow',
      'hr.sensitive.read': 'deny',
      'leave.request': 'allow',
      'leave.approve': 'deny',
    },
    // Directeur financier — « plans, validation, réalisé, rapports ». L'autorité
    // financière : approuve et clôture. Cible de la migration des anciens `member`
    // (iso-privilège, ADR-0012 §7).
    finance_director: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'allow',
      'project.read': 'allow',
      'project.update': 'allow',
      'canvas.update': 'allow',
      'inputs.update': 'allow',
      'plan.calculate': 'allow',
      'plan.approve': 'allow_sod',
      'actuals.import': 'allow',
      'period.close': 'allow',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'allow',
      'fiscal.manage': 'allow',
      'sales.read': 'allow',
      'sales.manage': 'allow',
      'sales.invoice': 'allow',
      'sales.receipt': 'allow',
      'treasury.read': 'allow',
      'treasury.manage': 'allow',
      'crm.read': 'allow',
      'crm.manage': 'allow',
      'work.read': 'allow',
      'work.update': 'allow',
      'work.manage': 'allow',
      'sales.quote': 'allow',
      // ADR-0044 § 4.1 : autorité de dépense, comme le Propriétaire.
      'purchase.read': 'allow',
      'purchase.request': 'allow',
      'purchase.manage': 'allow',
      'purchase.approve': 'allow_sod',
      'payables.pay': 'allow',
      // ADR-0045 — H0 (§ 4.1) : le salaire est un engagement financier ; autorité RH.
      'hr.read': 'allow',
      'hr.manage': 'allow',
      'hr.sensitive.read': 'allow',
      'leave.request': 'allow',
      'leave.approve': 'allow_sod',
    },
    // Comptable — « réalisé, mapping, clôture selon permission ». Constate, ne
    // projette pas : ni `inputs.update`, ni `plan.calculate`. Contrepartie de R2.
    accountant: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow',
      'project.update': 'deny',
      'canvas.update': 'deny',
      'inputs.update': 'deny',
      'plan.calculate': 'deny',
      'plan.approve': 'deny',
      'actuals.import': 'allow',
      'period.close': 'conditional',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'deny',
      'fiscal.manage': 'deny',
      // Le Comptable tient la facturation au quotidien (ADR-0022 § S25c.1, O2).
      'sales.read': 'allow',
      'sales.manage': 'allow',
      // Émet et normalise au quotidien (ADR-0023 § S25e.11).
      'sales.invoice': 'allow',
      'sales.receipt': 'allow',
      // Tient les dépenses et la caisse au quotidien (ADR-0034 § 8).
      'treasury.read': 'allow',
      'treasury.manage': 'allow',
      'crm.read': 'allow',
      'crm.manage': 'allow',
      // ADR-0039 § 7 : contribue sans gouverner (décision ouverte n° 3).
      'work.read': 'allow',
      'work.update': 'allow',
      'work.manage': 'deny',
      'sales.quote': 'allow',
      // ADR-0044 § 4.1 : constate et paie ; n'autorise pas la dépense (motif de `plan.approve`).
      'purchase.read': 'allow',
      'purchase.request': 'allow',
      'purchase.manage': 'allow',
      'purchase.approve': 'deny',
      'payables.pay': 'allow',
      // ADR-0045 — H0 (§ 4.1) : paie exclue, aucun accès au dossier du personnel
      // (décision ouverte n° 3) ; demande ses propres absences.
      'hr.read': 'deny',
      'hr.manage': 'deny',
      'hr.sensitive.read': 'deny',
      'leave.request': 'allow',
      'leave.approve': 'deny',
    },
    // Analyste — « scénarios, analyses, commentaires ». Modélise et calcule,
    // n'approuve ni n'importe le réalisé.
    analyst: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow',
      'project.update': 'deny',
      'canvas.update': 'allow',
      'inputs.update': 'allow',
      'plan.calculate': 'allow',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'allow',
      'audit.read': 'deny',
      'fiscal.manage': 'deny',
      // Consulte le fichier clients et le catalogue, ne les modifie pas.
      'sales.read': 'allow',
      'sales.manage': 'deny',
      'sales.invoice': 'deny',
      'sales.receipt': 'deny',
      // Analyse la prévision, n'enregistre rien.
      'treasury.read': 'allow',
      'treasury.manage': 'deny',
      'crm.read': 'allow',
      'crm.manage': 'deny',
      // ADR-0039 § 7 : contribue sans gouverner (décision ouverte n° 3).
      'work.read': 'allow',
      'work.update': 'allow',
      'work.manage': 'deny',
      'sales.quote': 'deny',
      // ADR-0044 § 4.1 : exprime un besoin ; ne prépare, n'approuve ni ne paie.
      'purchase.read': 'allow',
      'purchase.request': 'allow',
      'purchase.manage': 'deny',
      'purchase.approve': 'deny',
      'payables.pay': 'deny',
      // ADR-0045 — H0 (§ 4.1) : minimisation ; demande ses propres absences.
      'hr.read': 'deny',
      'hr.manage': 'deny',
      'hr.sensitive.read': 'deny',
      'leave.request': 'allow',
      'leave.approve': 'deny',
    },
    // Chef de projet — « projets autorisés et saisie ». Tout est `allow_project` :
    // le rôle n'a de sens qu'avec des assignations de projet, qui n'existent pas
    // encore — il est donc NON ATTRIBUABLE en S20a (`ROLE_NOT_ASSIGNABLE`).
    project_manager: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow_project',
      'project.update': 'allow_project',
      'canvas.update': 'allow_project',
      'inputs.update': 'allow_project',
      'plan.calculate': 'allow_project',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow_project',
      'report.export': 'allow_project',
      'audit.read': 'deny',
      'fiscal.manage': 'deny',
      // Rôle borné aux projets et non attribuable : rien sur les ventes.
      'sales.read': 'deny',
      'sales.manage': 'deny',
      'sales.invoice': 'deny',
      'sales.receipt': 'deny',
      'treasury.read': 'deny',
      'treasury.manage': 'deny',
      'crm.read': 'deny',
      'crm.manage': 'deny',
      // ADR-0039 § 7 : refusé en R1 — rôle non attribuable, borné aux plans BUILD
      // (décision ouverte n° 1 : l'ouvrir au module dans un lot suivant).
      'work.read': 'deny',
      'work.update': 'deny',
      'work.manage': 'deny',
      'sales.quote': 'deny',
      // ADR-0044 § 4.1 : rôle non attribuable, rien sur les achats.
      'purchase.read': 'deny',
      'purchase.request': 'deny',
      'purchase.manage': 'deny',
      'purchase.approve': 'deny',
      'payables.pay': 'deny',
      // ADR-0045 — H0 (§ 4.1) : rôle non attribuable, rien sur les RH.
      'hr.read': 'deny',
      'hr.manage': 'deny',
      'hr.sensitive.read': 'deny',
      'leave.request': 'deny',
      'leave.approve': 'deny',
    },
    // Conseiller — « consultation, commentaires, recommandations ». Typiquement
    // EXTERNE (mentor, banquier invité) : pas de `report.export`, on lui ouvre la
    // consultation en ligne, pas l'exfiltration de fichier (docs/17).
    advisor: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow',
      'project.update': 'deny',
      'canvas.update': 'deny',
      'inputs.update': 'deny',
      'plan.calculate': 'deny',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'deny',
      'audit.read': 'deny',
      'fiscal.manage': 'deny',
      // Externe (banquier, mentor) : le fichier clients contient des données
      // personnelles, il ne lui est pas ouvert (ADR-0022 § S25c.1).
      'sales.read': 'deny',
      'sales.manage': 'deny',
      'sales.invoice': 'deny',
      'sales.receipt': 'deny',
      // Externe : le détail des dépenses et des fournisseurs ne lui est pas ouvert.
      'treasury.read': 'deny',
      'treasury.manage': 'deny',
      'crm.read': 'deny',
      'crm.manage': 'deny',
      // ADR-0039 § 7 : externe ; un projet client porte des données de clients.
      'work.read': 'deny',
      'work.update': 'deny',
      'work.manage': 'deny',
      'sales.quote': 'deny',
      // ADR-0044 § 4.1 : externe ; fournisseurs, prix et dettes ne lui sont pas ouverts.
      'purchase.read': 'deny',
      'purchase.request': 'deny',
      'purchase.manage': 'deny',
      'purchase.approve': 'deny',
      'payables.pay': 'deny',
      // ADR-0045 — H0 (§ 4.1) : externe, ni dossier du personnel ni demande d'absence.
      'hr.read': 'deny',
      'hr.manage': 'deny',
      'hr.sensitive.read': 'deny',
      'leave.request': 'deny',
      'leave.approve': 'deny',
    },
    // Lecteur — lecture seulement. `analytics.read` est conservé : le refuser
    // viderait le rôle de son sens (ADR-0012 §3).
    viewer: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'allow',
      'project.update': 'deny',
      'canvas.update': 'deny',
      'inputs.update': 'deny',
      'plan.calculate': 'deny',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'deny',
      'audit.read': 'deny',
      'fiscal.manage': 'deny',
      'sales.read': 'allow',
      'sales.manage': 'deny',
      'sales.invoice': 'deny',
      'sales.receipt': 'deny',
      'treasury.read': 'allow',
      'treasury.manage': 'deny',
      'crm.read': 'allow',
      'crm.manage': 'deny',
      // ADR-0039 § 7 : lecture seulement, comme `crm.read`.
      'work.read': 'allow',
      'work.update': 'deny',
      'work.manage': 'deny',
      'sales.quote': 'deny',
      // ADR-0044 § 4.1 : lecture seulement, comme `treasury.read`.
      'purchase.read': 'allow',
      'purchase.request': 'deny',
      'purchase.manage': 'deny',
      'purchase.approve': 'deny',
      'payables.pay': 'deny',
      // ADR-0045 — H0 (§ 4.1) : demander une absence ne lit que la sienne.
      'hr.read': 'deny',
      'hr.manage': 'deny',
      'hr.sensitive.read': 'deny',
      'leave.request': 'allow',
      'leave.approve': 'deny',
    },
    // Commercial — « CRM, devis et suivi des clients » (ADR-0040 § 4.2, D3). Huit
    // actions sur trente-huit : il gère le CRM et prépare les devis, consulte clients,
    // catalogue et factures, travaille sur les tâches qu'on lui confie, demande ses
    // absences (ADR-0045). Il ne voit ni
    // la trésorerie ni les dépenses (`treasury.*`, et le correctif § 4.4 qui ferme les
    // chemins détournés par `analytics.read`), ne touche ni aux fiches client ni aux
    // prix (`sales.manage`), n'émet ni n'encaisse. BUILD et le plan ne le concernent pas.
    sales_rep: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'deny',
      'project.update': 'deny',
      'canvas.update': 'deny',
      'inputs.update': 'deny',
      'plan.calculate': 'deny',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'deny',
      'audit.read': 'deny',
      'fiscal.manage': 'deny',
      'sales.read': 'allow',
      'sales.manage': 'deny',
      'sales.invoice': 'deny',
      'sales.receipt': 'deny',
      'treasury.read': 'deny',
      'treasury.manage': 'deny',
      'crm.read': 'allow',
      'crm.manage': 'allow',
      'work.read': 'allow',
      // Décision ouverte n° 3 : cocher, commenter, saisir son temps ; pas de projet.
      'work.update': 'allow',
      'work.manage': 'deny',
      'sales.quote': 'allow',
      // ADR-0044 § 4.1, décision ouverte n° 4 : ni prix d'achat ni fournisseurs (D3).
      'purchase.read': 'deny',
      'purchase.request': 'deny',
      'purchase.manage': 'deny',
      'purchase.approve': 'deny',
      'payables.pay': 'deny',
      // ADR-0045 — H0 (§ 4.1) : demande ses propres absences, rien d'autre des RH.
      'hr.read': 'deny',
      'hr.manage': 'deny',
      'hr.sensitive.read': 'deny',
      'leave.request': 'allow',
      'leave.approve': 'deny',
    },
    // Responsable RH — « dossiers du personnel, absences et documents RH » (ADR-0045 § 4.2,
    // O6). Huit actions sur trente-huit, socle compris : la fonction RH est DISJOINTE de la
    // finance — ni trésorerie, ni ventes, ni achats, ni CRM, ni BUILD, ni gouvernance de
    // l'organisation. `work.read` et `work.update` : suivre les projets internes et saisir
    // son temps, comme tout membre qui travaille.
    hr_manager: {
      'organization.manage': 'deny',
      'billing.manage': 'deny',
      'members.invite': 'deny',
      'project.create': 'deny',
      'project.read': 'deny',
      'project.update': 'deny',
      'canvas.update': 'deny',
      'inputs.update': 'deny',
      'plan.calculate': 'deny',
      'plan.approve': 'deny',
      'actuals.import': 'deny',
      'period.close': 'deny',
      'analytics.read': 'allow',
      'report.export': 'deny',
      'audit.read': 'deny',
      'fiscal.manage': 'deny',
      'sales.read': 'deny',
      'sales.manage': 'deny',
      'sales.invoice': 'deny',
      'sales.receipt': 'deny',
      'treasury.read': 'deny',
      'treasury.manage': 'deny',
      'crm.read': 'deny',
      'crm.manage': 'deny',
      'work.read': 'allow',
      'work.update': 'allow',
      'work.manage': 'deny',
      'sales.quote': 'deny',
      'purchase.read': 'deny',
      'purchase.request': 'deny',
      'purchase.manage': 'deny',
      'purchase.approve': 'deny',
      'payables.pay': 'deny',
      'hr.read': 'allow',
      'hr.manage': 'allow',
      'hr.sensitive.read': 'allow',
      'leave.request': 'allow',
      'leave.approve': 'allow_sod',
    },
  };

// ─────────────────────────────────────────────────────────────────────────────
// Matrice plateforme
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nature d'une case de la matrice plateforme (ADR-0012 §4).
 *
 * - `native`    (✓)  — droit propre au rôle, portée plateforme.
 * - `delegated` (⚙D) — possible UNIQUEMENT sous un accès délégué actif
 *                (`support_grants`), avec consentement d'un propriétaire pour les
 *                données financières. Sans grant : refus.
 * - `forbidden` (✗)  — interdit, y compris au super-administrateur, y compris
 *                sous accès délégué.
 */
export type PlatformGrant = 'native' | 'delegated' | 'forbidden';

/**
 * MATRICE RÔLE PLATEFORME × ACTION — transcription littérale d'ADR-0012 §4.
 *
 * Principe : un rôle plateforme n'a AUCUN droit implicite sur les données d'une
 * organisation cliente. Tout ce qui touche au contenu d'un projet est `delegated`.
 */
export const PLATFORM_PERMISSION_MATRIX: Readonly<
  Record<PlatformRole, Readonly<Record<Action, PlatformGrant>>>
> = {
  platform_super_admin: {
    'organization.manage': 'native',
    'billing.manage': 'native',
    'members.invite': 'native',
    'project.create': 'delegated',
    'project.read': 'delegated',
    'project.update': 'delegated',
    'canvas.update': 'delegated',
    'inputs.update': 'delegated',
    'plan.calculate': 'delegated',
    'plan.approve': 'forbidden',
    'actuals.import': 'delegated',
    'period.close': 'forbidden',
    'analytics.read': 'delegated',
    'report.export': 'forbidden',
    'audit.read': 'native',
    'fiscal.manage': 'forbidden',
    // ADR-0022 § S25c.1 : lecture et gestion sous accès délégué seulement, comme
    // `project.read` et `project.update`.
    'sales.read': 'delegated',
    'sales.manage': 'delegated',
    // ADR-0023 § S25e.11 : un acteur Lalanda n'émet jamais au nom d'un
    // contribuable, même sous accès délégué — interdit absolu.
    'sales.invoice': 'forbidden',
    'sales.receipt': 'forbidden',
    // ADR-0034 § 8 : sous accès délégué, comme `sales.read` et `sales.manage`.
    'treasury.read': 'delegated',
    'treasury.manage': 'delegated',
    // ADR-0035 § 3 : comme `sales.read` et `sales.manage`, sous accès délégué.
    'crm.read': 'delegated',
    'crm.manage': 'delegated',
    // ADR-0039 § 7 : comme `crm.read` et `crm.manage`, sous accès délégué.
    'work.read': 'delegated',
    'work.update': 'delegated',
    'work.manage': 'delegated',
    // ADR-0040 § 4.1 : comme `sales.manage`, sous accès délégué ; pas un interdit absolu.
    'sales.quote': 'delegated',
    // ADR-0044 § 4.1 : lecture, demande et gestion sous accès délégué ; approuver une
    // dépense et payer un fournisseur refusés par la matrice (motif de `sales.receipt`),
    // sans être des interdits absolus.
    'purchase.read': 'delegated',
    'purchase.request': 'delegated',
    'purchase.manage': 'delegated',
    'purchase.approve': 'forbidden',
    'payables.pay': 'forbidden',
    // ADR-0045 — H0 (§ 4.1) : registre du personnel sous accès délégué ; données sensibles
    // interdites absolument (`PLATFORM_FORBIDDEN_ACTIONS`) ; demander et valider une absence
    // refusés par la matrice.
    'hr.read': 'delegated',
    'hr.manage': 'delegated',
    'hr.sensitive.read': 'forbidden',
    'leave.request': 'forbidden',
    'leave.approve': 'forbidden',
  },
  platform_admin: {
    'organization.manage': 'native',
    'billing.manage': 'forbidden',
    'members.invite': 'native',
    'project.create': 'forbidden',
    'project.read': 'delegated',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'forbidden',
    'report.export': 'forbidden',
    'audit.read': 'native',
    'fiscal.manage': 'forbidden',
    'sales.read': 'forbidden',
    'sales.manage': 'forbidden',
    'sales.invoice': 'forbidden',
    'sales.receipt': 'forbidden',
    'treasury.read': 'forbidden',
    'treasury.manage': 'forbidden',
    'crm.read': 'forbidden',
    'crm.manage': 'forbidden',
    'work.read': 'forbidden',
    'work.update': 'forbidden',
    'work.manage': 'forbidden',
    'sales.quote': 'forbidden',
    'purchase.read': 'forbidden',
    'purchase.request': 'forbidden',
    'purchase.manage': 'forbidden',
    'purchase.approve': 'forbidden',
    'payables.pay': 'forbidden',
    'hr.read': 'forbidden',
    'hr.manage': 'forbidden',
    'hr.sensitive.read': 'forbidden',
    'leave.request': 'forbidden',
    'leave.approve': 'forbidden',
  },
  // « Le support ne voit jamais les données financières sans consentement
  // explicite, durée limitée et audit » (docs/12) — d'où trois `delegated` et
  // aucun `native` sur le contenu client.
  platform_support: {
    'organization.manage': 'forbidden',
    'billing.manage': 'forbidden',
    'members.invite': 'forbidden',
    'project.create': 'forbidden',
    'project.read': 'delegated',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'delegated',
    'report.export': 'forbidden',
    'audit.read': 'delegated',
    'fiscal.manage': 'forbidden',
    // Lecture sous accès délégué, comme `project.read` (ADR-0022 § S25c.1).
    'sales.read': 'delegated',
    'sales.manage': 'forbidden',
    'sales.invoice': 'forbidden',
    'sales.receipt': 'forbidden',
    'treasury.read': 'delegated',
    'treasury.manage': 'forbidden',
    'crm.read': 'delegated',
    'crm.manage': 'forbidden',
    // ADR-0039 § 7 : lecture sous accès délégué, comme `crm.read`.
    'work.read': 'delegated',
    'work.update': 'forbidden',
    'work.manage': 'forbidden',
    'sales.quote': 'forbidden',
    // ADR-0044 § 4.1 : lecture sous accès délégué seulement.
    'purchase.read': 'delegated',
    'purchase.request': 'forbidden',
    'purchase.manage': 'forbidden',
    'purchase.approve': 'forbidden',
    'payables.pay': 'forbidden',
    // ADR-0045 — H0 (§ 4.1) : données personnelles du personnel, jamais pour le support.
    'hr.read': 'forbidden',
    'hr.manage': 'forbidden',
    'hr.sensitive.read': 'forbidden',
    'leave.request': 'forbidden',
    'leave.approve': 'forbidden',
  },
  platform_billing: {
    'organization.manage': 'forbidden',
    'billing.manage': 'native',
    'members.invite': 'forbidden',
    'project.create': 'forbidden',
    'project.read': 'forbidden',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'forbidden',
    'report.export': 'forbidden',
    'audit.read': 'forbidden',
    'fiscal.manage': 'forbidden',
    'sales.read': 'forbidden',
    'sales.manage': 'forbidden',
    'sales.invoice': 'forbidden',
    'sales.receipt': 'forbidden',
    'treasury.read': 'forbidden',
    'treasury.manage': 'forbidden',
    'crm.read': 'forbidden',
    'crm.manage': 'forbidden',
    'work.read': 'forbidden',
    'work.update': 'forbidden',
    'work.manage': 'forbidden',
    'sales.quote': 'forbidden',
    'purchase.read': 'forbidden',
    'purchase.request': 'forbidden',
    'purchase.manage': 'forbidden',
    'purchase.approve': 'forbidden',
    'payables.pay': 'forbidden',
    'hr.read': 'forbidden',
    'hr.manage': 'forbidden',
    'hr.sensitive.read': 'forbidden',
    'leave.request': 'forbidden',
    'leave.approve': 'forbidden',
  },
  // Vides sur cette matrice : opèrent sur des ressources de portée plateforme
  // (templates, Country Packs) qui n'ont pas d'action granulaire dans docs/12 —
  // lacune n°2 d'ADR-0012, à arbitrer.
  platform_template_editor: {
    'organization.manage': 'forbidden',
    'billing.manage': 'forbidden',
    'members.invite': 'forbidden',
    'project.create': 'forbidden',
    'project.read': 'forbidden',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'forbidden',
    'report.export': 'forbidden',
    'audit.read': 'forbidden',
    'fiscal.manage': 'forbidden',
    'sales.read': 'forbidden',
    'sales.manage': 'forbidden',
    'sales.invoice': 'forbidden',
    'sales.receipt': 'forbidden',
    'treasury.read': 'forbidden',
    'treasury.manage': 'forbidden',
    'crm.read': 'forbidden',
    'crm.manage': 'forbidden',
    'work.read': 'forbidden',
    'work.update': 'forbidden',
    'work.manage': 'forbidden',
    'sales.quote': 'forbidden',
    'purchase.read': 'forbidden',
    'purchase.request': 'forbidden',
    'purchase.manage': 'forbidden',
    'purchase.approve': 'forbidden',
    'payables.pay': 'forbidden',
    'hr.read': 'forbidden',
    'hr.manage': 'forbidden',
    'hr.sensitive.read': 'forbidden',
    'leave.request': 'forbidden',
    'leave.approve': 'forbidden',
  },
  platform_country_pack_manager: {
    'organization.manage': 'forbidden',
    'billing.manage': 'forbidden',
    'members.invite': 'forbidden',
    'project.create': 'forbidden',
    'project.read': 'forbidden',
    'project.update': 'forbidden',
    'canvas.update': 'forbidden',
    'inputs.update': 'forbidden',
    'plan.calculate': 'forbidden',
    'plan.approve': 'forbidden',
    'actuals.import': 'forbidden',
    'period.close': 'forbidden',
    'analytics.read': 'forbidden',
    'report.export': 'forbidden',
    'audit.read': 'forbidden',
    'fiscal.manage': 'forbidden',
    'sales.read': 'forbidden',
    'sales.manage': 'forbidden',
    'sales.invoice': 'forbidden',
    'sales.receipt': 'forbidden',
    'treasury.read': 'forbidden',
    'treasury.manage': 'forbidden',
    'crm.read': 'forbidden',
    'crm.manage': 'forbidden',
    'work.read': 'forbidden',
    'work.update': 'forbidden',
    'work.manage': 'forbidden',
    'sales.quote': 'forbidden',
    'purchase.read': 'forbidden',
    'purchase.request': 'forbidden',
    'purchase.manage': 'forbidden',
    'purchase.approve': 'forbidden',
    'payables.pay': 'forbidden',
    'hr.read': 'forbidden',
    'hr.manage': 'forbidden',
    'hr.sensitive.read': 'forbidden',
    'leave.request': 'forbidden',
    'leave.approve': 'forbidden',
  },
};

/**
 * Les six interdits absolus de la plateforme (ADR-0012 §4, amendé par ADR-0021 §8,
 * ADR-0023 § S25e.11 et ADR-0045 § 4.1).
 *
 * Aucun rôle plateforme, super-administrateur compris, et aucun accès délégué ne
 * peut approuver un plan, clôturer une période, exporter un rapport client ni
 * gérer son identité fiscale, ni émettre ou normaliser ses factures. Approuver et clôturer engagent le client vis-à-vis
 * de sa banque; exporter produit un fichier de ses données financières;
 * `fiscal.manage` engage le contribuable devant la DGI — un acteur Lalanda ne
 * saisit jamais son jeton e-MCF et ne bascule jamais son régime de facturation ;
 * `sales.invoice` attribue un numéro de facture et engage de même le contribuable ;
 * `hr.sensitive.read` (ADR-0045 § 4.1) : un employé de Lalanda ne lit jamais le salaire,
 * les coordonnées bancaires ni la pièce d'identité du personnel d'un client.
 *
 * Cette constante n'est pas décorative : `canPlatform()` la vérifie AVANT la
 * matrice, et un test s'assure qu'aucune case de la matrice ne la contredit.
 */
export const PLATFORM_FORBIDDEN_ACTIONS: readonly Action[] = [
  'plan.approve',
  'period.close',
  'report.export',
  'fiscal.manage',
  'sales.invoice',
  // ADR-0045 — H0 : interdit absolu, même sous accès délégué.
  'hr.sensitive.read',
];

// ─────────────────────────────────────────────────────────────────────────────
// Décision
// ─────────────────────────────────────────────────────────────────────────────

/** Conditions dépendant du membership, pas du seul rôle (cases ⚙). */
export interface OrgPermissionContext {
  /**
   * Droit explicite `canClosePeriods` porté par le membership. Seul droit
   * conditionnel du modèle (docs/12 « clôture selon permission »), `false` par
   * défaut, accordable par un `owner` ou un `admin`.
   */
  canClosePeriods?: boolean;
  // ADR-0041 — A1 : l'écart du membre par rapport à son titre (§ 1). Absents ou vides,
  // le membre détient exactement la ligne de son rôle. Le retrait l'emporte toujours ;
  // un ajout est accordé pleinement (`allow`), jamais avec une portée.
  /** Ajouts : actions que la ligne du rôle refuse et que ce membre détient. */
  grants?: readonly Action[];
  /** Retraits : actions que la ligne du rôle accorde et que ce membre ne détient pas. */
  revokes?: readonly Action[];
}

/**
 * ADR-0041 — A1 : contexte d'une décision qui n'a AUCUN membre derrière elle, ou dont
 * l'appelant ne lit pas encore l'écart (lot A3). Le paramètre `ctx` de `can()` est
 * obligatoire : passer `NO_OVERRIDES` est un choix écrit, jamais un oubli. Sans écart
 * ni droit de clôture, la décision est exactement la ligne du rôle.
 */
export const NO_OVERRIDES: OrgPermissionContext = Object.freeze({});

/**
 * Autorisation atomique d'un rôle d'organisation — l'unique lecture légitime de
 * la matrice organisation.
 *
 * `allow_sod` et `allow_project` renvoient `true` : ce sont des autorisations, et
 * leurs restrictions (séparation des tâches, projets assignés) dépendent de la
 * RESSOURCE visée, que ce module ne connaît pas. Elles sont appliquées par les
 * services concernés — voir `sodDecision()`.
 */
export function can(role: OrgRole, action: Action, ctx: OrgPermissionContext): boolean {
  // ADR-0041 — A1 : retrait d'abord (il l'emporte), puis ajout (accordé pleinement).
  if (ctx.revokes?.includes(action) === true) return false;
  if (ctx.grants?.includes(action) === true) return true;
  switch (ORG_PERMISSION_MATRIX[role][action]) {
    case 'allow':
    case 'allow_sod':
    case 'allow_project':
      return true;
    case 'conditional':
      return ctx.canClosePeriods === true;
    case 'deny':
      return false;
  }
}

/** Autorisation conjonctive : toutes les actions demandées doivent être détenues. */
export function canAll(
  role: OrgRole,
  actions: readonly Action[],
  ctx: OrgPermissionContext,
): boolean {
  return actions.every((a) => can(role, a, ctx));
}

/** Première action refusée — renseigne `action` dans la réponse 403. */
export function firstDeniedAction(
  role: OrgRole,
  actions: readonly Action[],
  ctx: OrgPermissionContext,
): Action | undefined {
  return actions.find((a) => !can(role, a, ctx));
}

/** Actions effectivement détenues — exposé à l'UI pour masquer ce qui serait refusé. */
export function actionsOf(role: OrgRole, ctx: OrgPermissionContext): Action[] {
  return ACTIONS.filter((a) => can(role, a, ctx));
}

/**
 * ADR-0041 — A1 : droits effectifs d'un membre, dans l'ordre d'`ACTIONS`.
 *
 *   effectif = ( ligne du rôle, case ⚙ selon `canClosePeriods` ∪ ajouts ) − retraits
 *
 * Même calcul qu'`actionsOf` (qui en hérite via `can`) ; le nom dit l'intention.
 */
export function effectiveActions(role: OrgRole, ctx: OrgPermissionContext): Action[] {
  return actionsOf(role, ctx);
}

/**
 * ADR-0041 — A1 : ensemble POTENTIEL d'un membre — ses droits effectifs, la case ⚙
 * comptée comme détenue (sauf retrait). C'est l'ensemble que R7 compare : accorder
 * plus tard le droit de clôture ne doit jamais faire dépasser l'acteur ni compléter
 * une paire de séparation des tâches en silence.
 */
export function potentialEffectiveActions(role: OrgRole, ctx: OrgPermissionContext): Action[] {
  return actionsOf(role, { ...ctx, canClosePeriods: true });
}

/** Contexte d'un principal plateforme sur une organisation cible. */
export interface PlatformPermissionContext {
  /** Un `support_grants` actif (non expiré, non révoqué) couvre-t-il cette requête ? */
  hasActiveGrant?: boolean;
}

/**
 * Autorisation d'un rôle plateforme. Les six interdits absolus sont vérifiés
 * en premier : aucune case de matrice ni aucun grant ne peut les lever.
 */
export function canPlatform(
  role: PlatformRole,
  action: Action,
  ctx: PlatformPermissionContext = {},
): boolean {
  if (PLATFORM_FORBIDDEN_ACTIONS.includes(action)) return false;
  switch (PLATFORM_PERMISSION_MATRIX[role][action]) {
    case 'native':
      return true;
    case 'delegated':
      return ctx.hasActiveGrant === true;
    case 'forbidden':
      return false;
  }
}

/** Un utilisateur peut détenir plusieurs rôles plateforme : l'un suffit. */
export function canAnyPlatform(
  roles: readonly PlatformRole[],
  action: Action,
  ctx: PlatformPermissionContext = {},
): boolean {
  return roles.some((r) => canPlatform(r, action, ctx));
}

// ─────────────────────────────────────────────────────────────────────────────
// Attribution de rôles (R7 — pas d'élévation de privilège)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Actions qu'un rôle peut POTENTIELLEMENT détenir, conditionnelles comprises.
 *
 * Distinct d'`actionsOf()` : on compare ici des rôles, pas des situations. Un
 * `accountant` peut potentiellement clôturer (⚙), donc `period.close` compte —
 * sinon un `admin` pourrait attribuer un rôle capable d'une action qu'il ne
 * détient pas, en comptant sur le fait que le droit est désactivé par défaut.
 */
function potentialActionsOf(role: OrgRole): Set<Action> {
  return new Set(ACTIONS.filter((a) => ORG_PERMISSION_MATRIX[role][a] !== 'deny'));
}

/**
 * ADR-0045 — H0 (§ 4.2, décision ouverte n° 2, défaut « attribuable par le seul
 * Propriétaire ») : titres que seul un Propriétaire attribue, en plus de R7. R7 suffit
 * nativement (l'Administrateur n'a ni `hr.sensitive.read` ni `leave.approve`) ; cette
 * liste ferme le cas d'un acteur qui réunirait les huit actions par ajouts (ADR-0041).
 * Comme R1, elle porte sur l'IDENTITÉ du titre `owner`, pas sur une action.
 */
export const OWNER_ONLY_ROLES: readonly OrgRole[] = ['hr_manager'];

/**
 * Rôles qu'un acteur peut attribuer (invitation ou changement de rôle) — R7.
 *
 * Règle : un acteur ne peut attribuer qu'un rôle dont l'ensemble d'actions est un
 * SOUS-ENSEMBLE du sien. Sinon `403 ROLE_ESCALATION`.
 *
 * Conséquences opérationnelles assumées (ADR-0012 §6 R7) :
 * - un `admin` ne peut pas attribuer `finance_director` (qui détient `plan.approve`);
 * - un `admin` ne peut pas non plus attribuer `accountant`, à cause du `period.close`
 *   conditionnel. Seul un `owner` le peut. C'est volontaire : l'alternative (liste
 *   blanche par rôle) est plus souple mais ouvre une escalade par composition.
 *
 * `project_manager` est exclu tant que les assignations de projet n'existent pas
 * (voir `isAssignableRole`) : il apparaîtrait ici sans restreindre quoi que ce soit.
 */
export function grantableRoles(actorRole: OrgRole, actorCtx?: OrgPermissionContext): OrgRole[] {
  // ADR-0041 — A1 : avec le contexte de l'acteur, R7 se juge sur ses droits EFFECTIFS
  // (décision ouverte n° 5, défaut : le titre reste soumis à R7). Sans contexte, sur la
  // ligne potentielle de son rôle, comme avant : les appelants passent au contexte au lot A4.
  const mine =
    actorCtx === undefined
      ? potentialActionsOf(actorRole)
      : new Set(effectiveActions(actorRole, actorCtx));
  return ORG_ROLES.filter((candidate) => {
    if (!isAssignableRole(candidate)) return false;
    // ADR-0045 — H0 (§ 4.2, décision ouverte n° 2) : nommer qui lit les salaires est un
    // acte du Propriétaire, même pour un acteur qui détiendrait les huit actions par écart.
    if (OWNER_ONLY_ROLES.includes(candidate) && !isOwnerRole(actorRole)) return false;
    for (const action of potentialActionsOf(candidate)) {
      if (!mine.has(action)) return false;
    }
    return true;
  });
}

export function canGrantRole(
  actorRole: OrgRole,
  target: OrgRole,
  actorCtx?: OrgPermissionContext,
): boolean {
  return grantableRoles(actorRole, actorCtx).includes(target);
}

/**
 * Rôles réellement attribuables en S20a.
 *
 * `project_manager` est présent dans l'enum et la matrice mais REFUSÉ à
 * l'attribution (`409 ROLE_NOT_ASSIGNABLE`) : toutes ses cases sont `allow_project`
 * et les assignations de projet (`project_assignments`) n'existent pas encore.
 * L'attribuer aujourd'hui donnerait un rôle qui ne restreint rien — ADR-0012 §7 :
 * « mieux vaut un rôle documenté et bloqué qu'un rôle qui ne restreint rien ».
 */
export function isAssignableRole(role: OrgRole): boolean {
  return role !== 'project_manager';
}

export const ASSIGNABLE_ORG_ROLES: readonly OrgRole[] = ORG_ROLES.filter(isAssignableRole);

// ─────────────────────────────────────────────────────────────────────────────
// Séparation des tâches (R2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résultat de l'évaluation de la séparation des tâches sur une approbation de plan.
 *
 * - `separated`      — approbateur ≠ dernier auteur des entrées. Cas nominal.
 * - `sole_approver`  — l'organisation ne compte qu'UN seul principal détenant
 *                      `plan.approve` : l'auto-approbation est autorisée mais
 *                      marquée. C'est l'échappatoire d'ADR-0012 §6 R2, sans
 *                      laquelle une organisation d'une personne — le cas
 *                      majoritaire en RDC — ne pourrait jamais valider un plan.
 * - `self_forbidden` — auto-approbation alors que d'autres approbateurs existent :
 *                      refus `409 SELF_APPROVAL_FORBIDDEN`.
 */
export type SodDecision = 'separated' | 'sole_approver' | 'self_forbidden';

export function sodDecision(input: {
  approverUserId: string;
  lastInputAuthorUserId: string | null;
  approverCountInOrg: number;
}): SodDecision {
  const isSelf =
    input.lastInputAuthorUserId !== null && input.lastInputAuthorUserId === input.approverUserId;
  if (!isSelf) return 'separated';
  return input.approverCountInOrg <= 1 ? 'sole_approver' : 'self_forbidden';
}

/** Rôles capables d'approuver un plan — sert à compter les approbateurs d'une org. */
export const APPROVER_ROLES: readonly OrgRole[] = ORG_ROLES.filter(
  (r) => ORG_PERMISSION_MATRIX[r]['plan.approve'] !== 'deny',
);

/**
 * ADR-0044 — P0 : actions d'approbation soumises à la séparation des tâches dynamique,
 * dont on compte les détenteurs EFFECTIFS pour décider de l'échappatoire « approbateur
 * unique » (`AuthzService.countApprovers(organizationId, action)`, ADR-0041 G4
 * généralisée à une action). Toute case non `deny` de ces actions porte la marque ⓢ.
 */
// ADR-0045 — H0 (§ 4.3) : `leave.approve` rejoint la liste (cases ⓢ).
export const APPROVAL_ACTIONS = ['plan.approve', 'purchase.approve', 'leave.approve'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0044 — P0 : séparation des tâches des achats (§ 2.3, § 4.3)
// ─────────────────────────────────────────────────────────────────────────────

/** Entrée de `purchaseApprovalDecision` : faits déjà lus par le service, rien d'autre. */
export interface PurchaseApprovalInput {
  /** Le geste demandé : approuver, ou refuser (commentaire exigé par le service). */
  readonly decision: 'approve' | 'reject';
  readonly approverUserId: string;
  /** Membre qui exprime le besoin (`requestedBy`). */
  readonly requestedBy: string;
  /** Créateur de la demande (`createdBy`), s'il diffère du demandeur. */
  readonly createdBy: string;
  /**
   * Approbations DÉJÀ portées par la demande (décision `approved`), sans celle en cours.
   * Seuls les identifiants comptent : la fonction ne lit ni rôle ni date.
   */
  readonly priorApproverUserIds: readonly string[];
  /** `requiredApprovals` figé à la soumission (0, 1 ou 2, moteur des achats). */
  readonly requiredApprovals: number;
  /**
   * Nombre de détenteurs EFFECTIFS de `purchase.approve` dans l'organisation
   * (`AuthzService.countApprovers(org, 'purchase.approve')`, ajouts compris, retraits
   * déduits — ADR-0041 G4). Jamais un compte par rôle.
   */
  readonly approverCountInOrg: number;
  /** Réglage `purchase_settings.allowSoleApprover` (défaut `true`). */
  readonly allowSoleApprover: boolean;
}

/**
 * Résultat typé ; le service le traduit en réponse HTTP. Ce module ne lève jamais
 * d'exception HTTP.
 *
 * - `SELF_APPROVAL_FORBIDDEN` (409) — l'approbateur est le demandeur ou le créateur,
 *   et l'organisation compte d'autres approbateurs (ou l'échappatoire est coupée).
 * - `APPROVER_ALREADY_APPROVED` (409) — il a déjà approuvé cette demande : deux
 *   approbations exigent deux personnes distinctes.
 * - `ok` — le geste est recevable. `soleApprover` marque l'approbation (ou le refus)
 *   rendue possible par l'échappatoire ; `effectiveRequired` est le palier appliqué
 *   (réduit à 1 pour un approbateur unique) ; `complete` dit si, ce geste compris,
 *   la demande est entièrement approuvée (toujours `false` pour un refus).
 */
export type PurchaseApprovalDecision =
  | { readonly ok: false; readonly code: 'SELF_APPROVAL_FORBIDDEN' | 'APPROVER_ALREADY_APPROVED' }
  | {
      readonly ok: true;
      readonly soleApprover: boolean;
      readonly effectiveRequired: number;
      readonly complete: boolean;
    };

/**
 * ADR-0044 § 2.3 — séparation des tâches d'une demande d'achat, sans aucun
 * `if (role === …)` : la détention de `purchase.approve` est vérifiée en amont par le
 * guard (droits effectifs) ; cette fonction ne juge que les PERSONNES.
 *
 * Règles :
 *   1. l'approbateur n'est ni le demandeur ni le créateur, sauf **approbateur unique** :
 *      `allowSoleApprover` et un seul détenteur effectif de `purchase.approve` ;
 *   2. pour approuver, il n'a pas déjà approuvé (deux approbations = deux personnes) ;
 *   3. approbateur unique : un palier à deux approbations se réduit à une (personne ne
 *      pourrait apporter la seconde), et le geste qui use de l'échappatoire est marqué
 *      `soleApprover` (auto-approbation, ou palier réduit).
 *
 * Un palier à 0 approbation ne passe pas par ici : la soumission vaut approbation.
 */
export function purchaseApprovalDecision(input: PurchaseApprovalInput): PurchaseApprovalDecision {
  const isSelf =
    input.approverUserId === input.requestedBy || input.approverUserId === input.createdBy;
  const soleApproverOrg = input.allowSoleApprover && input.approverCountInOrg <= 1;
  if (isSelf && !soleApproverOrg) return { ok: false, code: 'SELF_APPROVAL_FORBIDDEN' };

  const required = Math.max(0, Math.trunc(input.requiredApprovals));
  const effectiveRequired = soleApproverOrg ? Math.min(required, 1) : required;
  const reduced = effectiveRequired < required;
  const soleApprover = soleApproverOrg && (isSelf || reduced);

  if (input.decision === 'reject') {
    return {
      ok: true,
      soleApprover: soleApproverOrg && isSelf,
      effectiveRequired,
      complete: false,
    };
  }

  const prior = new Set(input.priorApproverUserIds);
  if (prior.has(input.approverUserId)) return { ok: false, code: 'APPROVER_ALREADY_APPROVED' };
  return {
    ok: true,
    soleApprover,
    effectiveRequired,
    complete: prior.size + 1 >= effectiveRequired,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0045 — H0 : séparation des tâches des absences (§ 4.3)
// ─────────────────────────────────────────────────────────────────────────────

/** Étapes d'un circuit de validation d'absence (§ 2.7), figées à la soumission. */
export type LeaveApprovalStep = 'manager' | 'hr';

/** Entrée de `leaveApprovalDecision` : faits déjà lus par le service, rien d'autre. */
export interface LeaveApprovalInput {
  /** Le geste demandé : valider, ou refuser (commentaire exigé par le service). */
  readonly decision: 'approve' | 'reject';
  readonly approverUserId: string;
  /**
   * Compte relié à la fiche du bénéficiaire (`hr_employees.userId`), `null` pour un
   * collaborateur sans compte. Le créateur d'une demande saisie pour autrui n'est PAS
   * le bénéficiaire : il peut la valider.
   */
  readonly beneficiaryUserId: string | null;
  /** Étape en cours de la demande. */
  readonly step: LeaveApprovalStep;
  /**
   * L'approbateur est l'utilisateur relié au `managerEmployeeId` du bénéficiaire
   * (relation vérifiée par le service sur la fiche, jamais un rôle).
   */
  readonly isDesignatedManager: boolean;
  /** L'approbateur détient `leave.approve` dans ses droits EFFECTIFS (ADR-0041). */
  readonly holdsLeaveApprove: boolean;
  /** Validations DÉJÀ portées par la demande (étapes précédentes), sans celle en cours. */
  readonly priorApproverUserIds: readonly string[];
  /**
   * Nombre de détenteurs EFFECTIFS de `leave.approve` dans l'organisation
   * (`AuthzService.countApprovers(org, 'leave.approve')`). Jamais un compte par rôle.
   */
  readonly approverCountInOrg: number;
  /** Réglage `hr_settings.allowSoleApprover` (défaut `true`). */
  readonly allowSoleApprover: boolean;
}

/**
 * Résultat typé ; le service le traduit en réponse HTTP. Ce module ne lève jamais
 * d'exception HTTP.
 *
 * - `SELF_APPROVAL_FORBIDDEN` (409) — l'approbateur est le bénéficiaire, à n'importe
 *   quelle étape, hors approbateur unique.
 * - `LEAVE_NOT_YOUR_STEP` (403) — ni manager désigné (étape `manager`), ni détenteur
 *   effectif de `leave.approve`.
 * - `APPROVER_ALREADY_APPROVED` (409) — il a déjà validé une étape de cette demande :
 *   deux étapes, deux personnes (hors approbateur unique).
 * - `ok` — le geste est recevable. `soleApprover` marque la décision rendue possible par
 *   l'échappatoire ; `onBehalfOfManager` marque la suppléance d'un manager par un
 *   détenteur de `leave.approve` (journalisée par le service).
 */
export type LeaveApprovalDecision =
  | {
      readonly ok: false;
      readonly code:
        'SELF_APPROVAL_FORBIDDEN' | 'LEAVE_NOT_YOUR_STEP' | 'APPROVER_ALREADY_APPROVED';
    }
  | { readonly ok: true; readonly soleApprover: boolean; readonly onBehalfOfManager: boolean };

/**
 * ADR-0045 § 4.3 — séparation des tâches d'une demande d'absence, motif de
 * `purchaseApprovalDecision`, sans aucun `if (role === …)` : l'autorité vient de la
 * RELATION (manager désigné) ou des droits EFFECTIFS (`leave.approve`), jamais du titre.
 *
 * Ordre des contrôles (le premier refus gagne) :
 *   1. on ne valide (ni ne refuse) pas sa propre absence, sauf **approbateur unique** :
 *      `allowSoleApprover`, un seul détenteur effectif de `leave.approve`, et c'est lui ;
 *   2. étape `manager` : le manager désigné, ou un détenteur de `leave.approve` en
 *      suppléance ; étape `hr` : un détenteur de `leave.approve` ;
 *   3. pour valider, il n'a pas déjà validé une étape de la demande, sauf approbateur
 *      unique (il tient alors l'étape RH qu'il a déjà tenue comme manager, marqué).
 * Un refus clôt la demande à n'importe quelle étape : le contrôle 3 ne s'y applique pas.
 */
export function leaveApprovalDecision(input: LeaveApprovalInput): LeaveApprovalDecision {
  const isSelf =
    input.beneficiaryUserId !== null && input.beneficiaryUserId === input.approverUserId;
  const soleApproverOrg =
    input.allowSoleApprover && input.holdsLeaveApprove && input.approverCountInOrg <= 1;
  if (isSelf && !soleApproverOrg) return { ok: false, code: 'SELF_APPROVAL_FORBIDDEN' };

  let onBehalfOfManager = false;
  if (input.step === 'manager') {
    if (!input.isDesignatedManager) {
      if (!input.holdsLeaveApprove) return { ok: false, code: 'LEAVE_NOT_YOUR_STEP' };
      onBehalfOfManager = true;
    }
  } else if (!input.holdsLeaveApprove) {
    return { ok: false, code: 'LEAVE_NOT_YOUR_STEP' };
  }

  if (input.decision === 'reject') {
    return { ok: true, soleApprover: soleApproverOrg && isSelf, onBehalfOfManager };
  }

  const already = input.priorApproverUserIds.includes(input.approverUserId);
  if (already && !soleApproverOrg) return { ok: false, code: 'APPROVER_ALREADY_APPROVED' };
  return { ok: true, soleApprover: soleApproverOrg && (isSelf || already), onBehalfOfManager };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0041 — A1 : autorisations par membre (titre + écart)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Actions réservées au Propriétaire : jamais dans un ajout (G3,
 * `400 PERMISSION_NOT_DELEGABLE`). Le transfert de propriété, la suppression de
 * l'organisation, R1 et le consentement à un accès délégué ne sont pas des actions :
 * ils restent attachés au TITRE `owner` et ne peuvent donc pas être ajoutés.
 */
export const NON_DELEGABLE_ACTIONS: readonly Action[] = ['billing.manage'];

/**
 * Paires incompatibles par ajout (G4). Trois (ADR-0044 § 4.3 ajoute la paire des
 * achats ; ADR-0045 § 4.5 n'en ajoute aucune : ne pas valider sa propre absence est une
 * séparation DYNAMIQUE, `leaveApprovalDecision`) ; la paire facturation
 * `sales.invoice` + `fiscal.manage` a été REFUSÉE par la dirigeante le 29 oct. 2026
 * (décision ouverte n° 3) — une seule personne peut émettre et piloter la fiscalité.
 */
export const SOD_PAIRS: readonly (readonly [Action, Action])[] = [
  // R2 statique (ADR-0012 § 6) : saisir et valider.
  ['inputs.update', 'plan.approve'],
  // R3 : la réouverture d'une période exige les deux.
  ['period.close', 'plan.approve'],
  // ADR-0044 — P0 (§ 4.3) : celui qui autorise la dépense et celui qui la paie ne se
  // cumulent pas par ajout (un Comptable ne reçoit pas `purchase.approve`). Propriétaire
  // et Directeur financier les cumulent nativement ; la séparation dynamique
  // (`purchaseApprovalDecision`) s'y applique.
  ['purchase.approve', 'payables.pay'],
];

/**
 * Socle (décision ouverte n° 4) : tableau de bord, brief, cloche. Non retirable tant
 * que le membre détient une autre action — c'est une dépendance de toutes les actions.
 */
export const BASE_ACTION: Action = 'analytics.read';

/**
 * Dépendances DIRECTES entre actions (ADR-0041 § 4). Le socle `analytics.read` s'y
 * ajoute pour toute action (voir `requiredActionsOf`). Le cumul exigé par certaines
 * routes (marge d'un projet, conversion d'un devis) n'est PAS une dépendance.
 * Un test vérifie que chaque ligne de la matrice les satisfait déjà.
 */
export const ACTION_DEPENDENCIES: Readonly<Partial<Record<Action, readonly Action[]>>> = {
  'project.create': ['project.read'],
  'project.update': ['project.read'],
  'canvas.update': ['project.read'],
  'inputs.update': ['project.read'],
  'plan.calculate': ['project.read'],
  'actuals.import': ['project.read'],
  'period.close': ['project.read'],
  // On valide ce qu'un autre a calculé : `plan.calculate` n'est pas exigé.
  'plan.approve': ['project.read'],
  'report.export': ['project.read', 'analytics.read'],
  'sales.manage': ['sales.read'],
  'sales.quote': ['sales.read'],
  'sales.receipt': ['sales.read'],
  'sales.invoice': ['sales.manage'],
  'treasury.manage': ['treasury.read'],
  'crm.manage': ['crm.read'],
  'work.update': ['work.read'],
  'work.manage': ['work.update'],
  // ADR-0044 — P0 (§ 4.3) : tout geste d'achat suppose de lire les achats ; payer crée
  // une dépense que le payeur doit pouvoir relire, d'où `treasury.read`.
  'purchase.request': ['purchase.read'],
  'purchase.manage': ['purchase.read'],
  'purchase.approve': ['purchase.read'],
  'payables.pay': ['purchase.read', 'treasury.read'],
  // ADR-0045 — H0 (§ 4.5) : tout geste RH d'autorité suppose de lire le dossier ;
  // `leave.request` n'exige que le socle (on ne demande que pour soi).
  'hr.manage': ['hr.read'],
  'hr.sensitive.read': ['hr.read'],
  'leave.approve': ['hr.read'],
};

/**
 * Toutes les actions qu'exige `action`, dépendances transitives et socle compris,
 * dans l'ordre d'`ACTIONS`. `analytics.read` n'exige rien.
 */
export function requiredActionsOf(action: Action): Action[] {
  const required = new Set<Action>();
  const pending: Action[] = [...(ACTION_DEPENDENCIES[action] ?? [])];
  if (action !== BASE_ACTION) pending.push(BASE_ACTION);
  while (pending.length > 0) {
    const next = pending.pop() as Action;
    if (required.has(next)) continue;
    required.add(next);
    pending.push(...(ACTION_DEPENDENCIES[next] ?? []));
  }
  return ACTIONS.filter((a) => required.has(a));
}

/**
 * Les neuf domaines de l'écran (ADR-0041 § 5), dans l'ordre d'affichage. Le huitième,
 * « Achats et fournisseurs », vient d'ADR-0044 § 4.3 ; le neuvième, « Ressources
 * humaines », d'ADR-0045 § 4.5.
 */
export const ACTION_DOMAINS: readonly {
  readonly key: string;
  readonly label: string;
  readonly actions: readonly Action[];
}[] = [
  {
    key: 'organization',
    label: 'Organisation et équipe',
    actions: ['organization.manage', 'members.invite', 'billing.manage', 'audit.read'],
  },
  {
    key: 'plan',
    label: 'Initiatives et plan financier',
    actions: [
      'project.read',
      'project.create',
      'project.update',
      'canvas.update',
      'inputs.update',
      'plan.calculate',
      'plan.approve',
    ],
  },
  {
    key: 'actuals',
    label: 'Réalisé et rapports',
    actions: ['analytics.read', 'actuals.import', 'period.close', 'report.export'],
  },
  {
    key: 'sales',
    label: 'Ventes et facturation',
    actions: [
      'sales.read',
      'sales.manage',
      'sales.quote',
      'sales.invoice',
      'sales.receipt',
      'fiscal.manage',
    ],
  },
  { key: 'treasury', label: 'Trésorerie', actions: ['treasury.read', 'treasury.manage'] },
  { key: 'crm', label: 'CRM', actions: ['crm.read', 'crm.manage'] },
  {
    key: 'work',
    label: 'Projets et tâches',
    actions: ['work.read', 'work.update', 'work.manage'],
  },
  // ADR-0044 — P0 (§ 4.3).
  {
    key: 'purchases',
    label: 'Achats et fournisseurs',
    actions: [
      'purchase.read',
      'purchase.request',
      'purchase.manage',
      'purchase.approve',
      'payables.pay',
    ],
  },
  // ADR-0045 — H0 (§ 4.5).
  {
    key: 'hr',
    label: 'Ressources humaines',
    actions: ['hr.read', 'hr.manage', 'hr.sensitive.read', 'leave.request', 'leave.approve'],
  },
];

/** Libellés français des actions (ADR-0041 § 5) — « autorisation », jamais « action ». */
export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  'organization.manage': "Gérer l'organisation et les membres",
  'members.invite': 'Inviter des membres',
  'billing.manage': "Gérer l'abonnement",
  'audit.read': "Consulter le journal d'audit",
  'project.read': 'Consulter les initiatives',
  'project.create': 'Créer une initiative',
  'project.update': 'Modifier une initiative',
  'canvas.update': "Rédiger le modèle économique, l'Idea Lab et le business plan",
  'inputs.update': 'Saisir les hypothèses',
  'plan.calculate': 'Calculer le plan',
  'plan.approve': 'Valider un plan',
  'analytics.read': 'Consulter le tableau de bord, le brief et les analyses',
  'actuals.import': 'Saisir et importer le réalisé',
  'period.close': 'Clôturer une période',
  'report.export': 'Exporter des rapports',
  'sales.read': 'Consulter clients, catalogue, devis, factures et encaissements',
  'sales.manage': 'Gérer les clients, le catalogue et les brouillons de facture',
  'sales.quote': 'Préparer et envoyer les devis',
  'sales.invoice': 'Émettre et normaliser les factures et les avoirs',
  'sales.receipt': 'Enregistrer les encaissements',
  'fiscal.manage': "Gérer l'identité fiscale et la facture normalisée",
  'treasury.read': 'Consulter les dépenses, les comptes et la prévision de trésorerie',
  'treasury.manage': 'Enregistrer les dépenses, les comptes et les virements',
  'crm.read': 'Consulter le CRM',
  'crm.manage': 'Gérer prospects, contacts, opportunités et relances',
  'work.read': 'Consulter les projets et les tâches',
  'work.update': 'Travailler sur les tâches',
  'work.manage': 'Gérer les projets',
  // ADR-0044 — P0 (§ 4.1).
  'purchase.read': 'Consulter les achats et les fournisseurs',
  'purchase.request': 'Demander un achat',
  'purchase.manage': 'Gérer les fournisseurs, commandes, réceptions et factures fournisseurs',
  'purchase.approve': "Approuver les demandes d'achat",
  'payables.pay': 'Payer les fournisseurs',
  // ADR-0045 — H0 (§ 4.1).
  'hr.read': 'Consulter les dossiers du personnel',
  'hr.manage': 'Gérer les dossiers du personnel',
  'hr.sensitive.read': 'Consulter les données sensibles du personnel',
  'leave.request': 'Demander une absence',
  'leave.approve': 'Valider les absences',
};

/**
 * Refus typé de `validateOverrides` — le code est celui de la réponse HTTP que le
 * service (lot A4) renverra ; ce module ne lève jamais d'exception HTTP.
 */
export type OverrideViolation =
  /** G2 — 403. */
  | { readonly code: 'SELF_PERMISSIONS_FORBIDDEN' }
  /** G3 — 409 : l'écart d'un Propriétaire reste vide. */
  | { readonly code: 'OWNER_PERMISSIONS_FIXED' }
  /** G3 — 400. */
  | { readonly code: 'PERMISSION_NOT_DELEGABLE'; readonly actions: readonly Action[] }
  /** § 1 — 400 : doublon, ajout et retrait de la même action, ajout ou retrait sans objet. */
  | { readonly code: 'PERMISSION_OVERRIDE_REDUNDANT'; readonly actions: readonly Action[] }
  /** G1 — 403 : actions de la cible (avant ou après) que l'acteur ne détient pas. */
  | { readonly code: 'PERMISSION_ESCALATION'; readonly actions: readonly Action[] }
  /** G4 — 409. */
  | { readonly code: 'SOD_CONFLICT'; readonly pair: readonly [Action, Action] }
  /** § 4 — 400 : l'ensemble demandé est incohérent ; rien n'est complété en silence. */
  | {
      readonly code: 'PERMISSION_DEPENDENCY_MISSING';
      readonly action: Action;
      readonly missing: readonly Action[];
    };

export type OverrideValidation =
  | {
      readonly ok: true;
      /** Ajouts et retraits triés dans l'ordre d'`ACTIONS` (forme de stockage). */
      readonly grants: readonly Action[];
      readonly revokes: readonly Action[];
      /** Droits effectifs de la cible après l'opération. */
      readonly effective: readonly Action[];
    }
  | ({ readonly ok: false } & OverrideViolation);

export interface ValidateOverridesInput {
  readonly actorRole: OrgRole;
  /** Contexte EFFECTIF actuel de l'acteur (son propre écart et son droit de clôture). */
  readonly actorCtx: OrgPermissionContext;
  readonly targetRole: OrgRole;
  /**
   * Contexte de la cible AVANT l'opération (modification d'un membre) ; absent pour
   * une invitation. Son `canClosePeriods` est conservé par l'opération.
   */
  readonly targetCtxBefore?: OrgPermissionContext;
  /** Écart demandé, ENTIER (pas de fusion). */
  readonly grants: readonly Action[];
  readonly revokes: readonly Action[];
  readonly actorIsTarget: boolean;
}

function sortedActions(actions: Iterable<Action>): Action[] {
  const set = new Set(actions);
  return ACTIONS.filter((a) => set.has(a));
}

/**
 * Valide un écart (ajouts et retraits) demandé par un acteur pour une cible —
 * garde-fous G1 à G5 et dépendances d'ADR-0041. Fonction pure : le service des
 * membres et celui des invitations la rappellent côté serveur (lot A4), l'écran ne
 * fait que l'anticiper.
 *
 * Ordre des contrôles (le premier refus gagne, pour que le code soit prévisible) :
 *   1. G2 — l'acteur est la cible ;
 *   2. G3 — Propriétaire non personnalisable ;
 *   3. G3 — action non délégable ajoutée ;
 *   4. § 1 — forme : doublon, ajout ∩ retrait, ajout d'une case non `deny`, retrait
 *      d'une case `deny`, `period.close` d'un Comptable (stocké dans `canClosePeriods`) ;
 *   5. G1 — ensemble potentiel de la cible, avant puis après, inclus dans les droits
 *      effectifs de l'acteur ;
 *   6. G4 — paire de séparation des tâches complétée par ajout ;
 *   7. § 4 — dépendances et socle, sur l'ensemble potentiel après l'opération.
 *
 * Le TITRE reste soumis à R7 par `canGrantRole` (décision ouverte n° 5) : ce contrôle
 * n'est pas répété ici. G5 découle de la forme : une case `allow_project` n'est pas
 * `deny`, son ajout est donc refusé comme redondant.
 */
export function validateOverrides(input: ValidateOverridesInput): OverrideValidation {
  const { actorRole, actorCtx, targetRole, targetCtxBefore, grants, revokes } = input;

  if (input.actorIsTarget) return { ok: false, code: 'SELF_PERMISSIONS_FORBIDDEN' };

  if (isOwnerRole(targetRole) && (grants.length > 0 || revokes.length > 0)) {
    return { ok: false, code: 'OWNER_PERMISSIONS_FIXED' };
  }

  const notDelegable = sortedActions(grants.filter((a) => NON_DELEGABLE_ACTIONS.includes(a)));
  if (notDelegable.length > 0) {
    return { ok: false, code: 'PERMISSION_NOT_DELEGABLE', actions: notDelegable };
  }

  const row = ORG_PERMISSION_MATRIX[targetRole];
  const redundant = new Set<Action>();
  const seen = new Set<Action>();
  for (const a of [...grants, ...revokes]) {
    if (seen.has(a)) redundant.add(a);
    seen.add(a);
  }
  for (const a of grants) if (row[a] !== 'deny') redundant.add(a);
  for (const a of revokes) {
    if (row[a] === 'deny') redundant.add(a);
    // § 1 : la case ⚙ du Comptable est stockée dans `canClosePeriods`, jamais dans l'écart.
    if (row[a] === 'conditional') redundant.add(a);
  }
  if (redundant.size > 0) {
    return { ok: false, code: 'PERMISSION_OVERRIDE_REDUNDANT', actions: sortedActions(redundant) };
  }

  const after: OrgPermissionContext = {
    canClosePeriods: targetCtxBefore?.canClosePeriods === true,
    grants: sortedActions(grants),
    revokes: sortedActions(revokes),
  };

  const actorHolds = new Set(effectiveActions(actorRole, actorCtx));
  if (targetCtxBefore !== undefined) {
    const beyondBefore = potentialEffectiveActions(targetRole, targetCtxBefore).filter(
      (a) => !actorHolds.has(a),
    );
    if (beyondBefore.length > 0) {
      return { ok: false, code: 'PERMISSION_ESCALATION', actions: beyondBefore };
    }
  }
  const potentialAfter = potentialEffectiveActions(targetRole, after);
  const beyondAfter = potentialAfter.filter((a) => !actorHolds.has(a));
  if (beyondAfter.length > 0) {
    return { ok: false, code: 'PERMISSION_ESCALATION', actions: beyondAfter };
  }

  const nativePotential = potentialActionsOf(targetRole);
  const potentialSet = new Set(potentialAfter);
  for (const pair of SOD_PAIRS) {
    const native = nativePotential.has(pair[0]) && nativePotential.has(pair[1]);
    if (!native && potentialSet.has(pair[0]) && potentialSet.has(pair[1])) {
      return { ok: false, code: 'SOD_CONFLICT', pair };
    }
  }

  for (const action of potentialAfter) {
    const missing = requiredActionsOf(action).filter((a) => !potentialSet.has(a));
    if (missing.length > 0) {
      return { ok: false, code: 'PERMISSION_DEPENDENCY_MISSING', action, missing };
    }
  }

  return {
    ok: true,
    grants: after.grants ?? [],
    revokes: after.revokes ?? [],
    effective: effectiveActions(targetRole, after),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compatibilité et libellés
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rôle cible de la migration des anciens `member` (ADR-0012 §7).
 *
 * `finance_director` par ISO-PRIVILÈGE : avant S20a un `member` pouvait créer et
 * modifier des projets, saisir, calculer, approuver un plan, importer le réalisé,
 * clôturer et exporter — tout sauf gérer l'organisation, l'abonnement et les
 * invitations. C'est exactement le périmètre de `finance_director`. La migration
 * ne retire ni n'ajoute aucun droit.
 */
export const LEGACY_MEMBER_ROLE: OrgRole = 'finance_director';

/**
 * Traduit l'ancienne valeur `member` encore présente en base ou acceptée en
 * entrée d'API (compatibilité N-1 pendant le déploiement progressif — docs/24
 * règle 3, ADR-0012 §7). `owner` n'a pas changé de valeur et passe tel quel.
 *
 * Retourne `undefined` si la valeur n'est ni un rôle actuel ni un alias connu.
 */
export function normalizeOrgRole(value: unknown): OrgRole | undefined {
  if (isOrgRole(value)) return value;
  if (value === 'member') return LEGACY_MEMBER_ROLE;
  return undefined;
}

/** Libellés français — UI et messages d'erreur (docs/12 § Rôles organisation). */
export const ORG_ROLE_LABELS: Readonly<Record<OrgRole, string>> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  finance_director: 'Directeur financier',
  accountant: 'Comptable',
  analyst: 'Analyste',
  project_manager: 'Chef de projet',
  advisor: 'Conseiller',
  viewer: 'Lecteur',
  sales_rep: 'Commercial',
  hr_manager: 'Responsable RH',
};

/** Description courte d'un rôle — affichée sous le sélecteur de rôle. */
export const ORG_ROLE_DESCRIPTIONS: Readonly<Record<OrgRole, string>> = {
  owner: 'Abonnement, membres, suppression et transfert. Valide les plans.',
  admin: 'Membres, initiatives et paramètres. Ne valide pas les plans.',
  finance_director: 'Plans, validation, réalisé et rapports.',
  accountant: 'Réalisé et mapping. Clôture si le droit lui est accordé.',
  analyst: 'Scénarios, hypothèses et analyses. Ne valide pas.',
  project_manager: 'Projets assignés et saisie. Indisponible sans assignation de projet.',
  advisor: 'Consultation et recommandations. Sans export.',
  viewer: 'Lecture seule.',
  sales_rep:
    "CRM, devis et suivi des clients. Ne voit ni la trésorerie ni les dépenses ; n'émet pas de facture.",
  // ADR-0045 § 4.2.
  hr_manager:
    'Dossiers du personnel, absences et documents RH. Ne voit ni la trésorerie, ni les ventes, ni les achats.',
};

export const PLATFORM_ROLE_LABELS: Readonly<Record<PlatformRole, string>> = {
  platform_super_admin: 'Super administrateur',
  platform_admin: 'Administrateur plateforme',
  platform_support: 'Support',
  platform_billing: 'Finance et facturation',
  platform_template_editor: 'Éditeur de templates',
  platform_country_pack_manager: 'Gestionnaire comptable et fiscal',
};
