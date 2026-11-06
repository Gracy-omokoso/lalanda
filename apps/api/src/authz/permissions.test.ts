// Test de matrice — LE garde-fou du RBAC (ADR-0012 § Plan de validation).
//
// ── Pourquoi la matrice est REDÉCLARÉE ici ───────────────────────────────────
//
// Les tableaux ci-dessous ne sont PAS importés de `permissions.ts`. Ils sont
// retranscrits à la main depuis ADR-0012 §3 et §4 (et ADR-0021 §8 pour `fiscal.manage`,
// ADR-0022 § S25c.1 pour `sales.read` et `sales.manage`, ADR-0023 § S25e.11 pour
// `sales.invoice`, ADR-0031 § 4 pour `sales.receipt`, ADR-0034 § 8 pour `treasury.read` et
// `treasury.manage`, ADR-0035 § 3 pour `crm.read` et `crm.manage`, ADR-0039 § 7 pour `work.read`,
// `work.update` et `work.manage`, ADR-0040 § 4 pour `sales.quote` et le rôle `sales_rep`,
// ADR-0044 § 4.1 pour `purchase.*` et `payables.pay`, ADR-0045 § 4 pour `hr.*`, `leave.*` et
// le rôle `hr_manager`, ADR-0046 § 8 pour `stock.*`, `assets.*`, `docs.*` et le rôle
// `storekeeper`, ADR-0049 § 8 pour `accounting.*` et le rôle `external_accountant`,
// ADR-0050 § 8 pour `sales.contract` et `sales.contract.approve`, ADR-0051 § 5 pour
// `expenses.*`, `attendance.clock` et `performance.read`).
// C'est délibéré : un test qui
// importerait la matrice de production vérifierait seulement qu'elle est égale à
// elle-même. Ici, toute modification d'une case de production casse le test, ce
// qui force une mise à jour CONSCIENTE de l'ADR et de docs/12.
//
// 16 rôles × 57 actions + 6 rôles plateforme × 57 actions = 1254 cases vérifiées.

import { describe, expect, it } from 'vitest';

import { ACCOUNTING_ACTIVATION_MISSING_CODES } from '@lalanda/shared/accounting';
import { DOCUMENT_LINK_ENTITY_TYPES } from '@lalanda/shared/documents';
import {
  HR_ADVANCES_ERROR_CODES,
  HR_ATTENDANCE_ERROR_CODES,
  HR_EXPENSES_ERROR_CODES,
  HR_PERFORMANCE_ERROR_CODES,
} from '@lalanda/shared/hr';
import { SALES_CONTRACT_ERROR_CODES } from '@lalanda/shared/sales-contracts';

import {
  ACTIONS,
  ASSIGNABLE_ORG_ROLES,
  DEFAULT_INVITATION_ROLE,
  NO_OVERRIDES,
  ORG_PERMISSION_MATRIX,
  PROJECT_SCOPED_ROLES,
  requiredActionsOf,
  SELF_ASSIGN_ONLY_ROLES,
  ORG_ROLES,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  ORG_ROLE_RANK,
  OWNER_ROLE,
  PLATFORM_FORBIDDEN_ACTIONS,
  PLATFORM_PERMISSION_MATRIX,
  PLATFORM_ROLES,
  APPROVAL_ACTIONS,
  APPROVER_ROLES,
  can,
  canGrantRole,
  canPlatform,
  effectiveActions,
  grantableRoles,
  isAssignableRole,
  isOwnerRole,
  leaveApprovalDecision,
  normalizeOrgRole,
  OWNER_ONLY_ROLES,
  purchaseApprovalDecision,
  sodDecision,
  canSeeStockValues,
  documentReadDecision,
  DOCUMENT_LINK_READ_ACTION,
  folderAccessDecision,
  stockCountDecision,
  VALUE_READ_ACTIONS,
  ACCOUNTING_ACTIVATION_ACTIONS,
  ACTION_DEPENDENCIES,
  accountingActivationDecision,
  accountingReopenDecision,
  canActivateAccounting,
  contractApprovalDecision,
  type ContractApprovalInput,
  SOD_PAIRS,
  attendanceCorrectionDecision,
  expenseApprovalDecision,
  reimbursementDecision,
  reviewCloseDecision,
  type AttendanceCorrectionInput,
  type ExpenseApprovalInput,
  type ReimbursementInput,
  type ReviewCloseInput,
  manualEntryDecision,
  ruleSetDecision,
  type AccountingActivationInput,
  type AccountingActivationMissing,
  type ManualEntryValidationInput,
  type RuleSetValidationInput,
  type DocumentLinkEntityType,
  type FolderAccessRules,
  type StockCountValidationInput,
  type LeaveApprovalInput,
  type PurchaseApprovalInput,
  type Action,
  type OrgPermissionContext,
  type OrgRole,
  type PlatformRole,
} from './permissions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Transcription d'ADR-0012 §3 — matrice organisation
//
// Légende (identique à celle de l'ADR) :
//   A = ✓  autorisé            S = ✓ⓢ autorisé, séparation des tâches
//   . = ✗  refusé              P = ✓P autorisé, projets assignés
//   C = ⚙  conditionnel (droit explicite à accorder)
// ─────────────────────────────────────────────────────────────────────────────

const ORDRE_ORG: readonly OrgRole[] = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'project_manager',
  'advisor',
  'viewer',
  // ADR-0040 § 4.3 : neuvième, en fin de liste.
  'sales_rep',
  // ADR-0045 § 4.2 : dixième, en fin de liste.
  'hr_manager',
  // ADR-0046 § 8.2 : onzième, en fin de liste.
  'storekeeper',
  // ADR-0049 § 8.2 : douzième, en fin de liste.
  'external_accountant',
  // ADR-0059 § 2 : treizième à seizième, en fin de liste.
  'employee',
  'team_manager',
  'intern',
  'guest',
];

// ADR-0059 § 2 : quatre colonnes de plus — Salarié (SAL), Manager / Chef d'équipe (MGR),
// Stagiaire (STA), Invité externe (INV). Aucune finance ; le Manager gouverne les projets.
//                                        PRO ADM DIR CPT ANA CDP CON LEC COM RH  MAG EXP SAL MGR STA INV
const ATTENDU_ORG: Record<Action, string> = {
  'organization.manage': 'A   A   .   .   .   .   .   .   .   .   .   .   .   .   .   .',
  'billing.manage': 'A   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .',
  'members.invite': 'A   A   .   .   .   .   .   .   .   .   .   .   .   .   .   .',
  'project.create': 'A   A   A   .   .   .   .   .   .   .   .   .   .   .   .   .',
  'project.read': 'A   A   A   A   A   P   A   A   .   .   .   .   .   .   .   .',
  'project.update': 'A   A   A   .   .   P   .   .   .   .   .   .   .   .   .   .',
  'canvas.update': 'A   A   A   .   A   P   .   .   .   .   .   .   .   .   .   .',
  'inputs.update': 'A   A   A   .   A   P   .   .   .   .   .   .   .   .   .   .',
  'plan.calculate': 'A   A   A   .   A   P   .   .   .   .   .   .   .   .   .   .',
  'plan.approve': 'S   .   S   .   .   .   .   .   .   .   .   .   .   .   .   .',
  'actuals.import': 'A   A   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  'period.close': 'A   .   A   C   .   .   .   .   .   .   .   .   .   .   .   .',
  'analytics.read': 'A   A   A   A   A   P   A   A   A   A   A   A   A   A   A   A',
  'report.export': 'A   A   A   A   A   P   .   .   .   .   .   .   .   .   .   .',
  'audit.read': 'A   A   A   .   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0021 §8 : autorité financière seulement (Propriétaire, Directeur financier).
  'fiscal.manage': 'A   .   A   .   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0022 § S25c.1 : données maîtres de vente. Analyste et Lecteur consultent ;
  // le Conseiller, externe, ne voit pas le fichier clients ; le Chef de projet n'a rien.
  'sales.read': 'A   A   A   A   A   .   .   A   A   .   .   .   .   .   .   .',
  'sales.manage': 'A   A   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0023 § S25e.11 : émettre et normaliser engagent le contribuable. Propriétaire,
  // Directeur financier et Comptable ; l'Administrateur prépare mais n'émet pas.
  'sales.invoice': 'A   .   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0031 § 4 : enregistrer l'argent reçu, même population que `sales.invoice`.
  'sales.receipt': 'A   .   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0034 § 8 : trésorerie. Le Conseiller (externe) ne voit pas le détail des
  // dépenses ; l'Administrateur consulte mais n'enregistre pas de décaissement.
  'treasury.read': 'A   A   A   A   A   .   .   A   .   .   .   .   .   .   .   .',
  'treasury.manage': 'A   .   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0035 § 3 : le CRM suit la répartition de `sales.read` / `sales.manage`.
  'crm.read': 'A   A   A   A   A   .   .   A   A   .   .   .   .   .   .   .',
  'crm.manage': 'A   A   A   A   .   .   .   .   A   .   .   .   .   .   .   .',
  // ADR-0039 § 7 : projets et tâches du RUN. Le Lecteur lit ; Comptable et Analyste
  // travaillent sans gouverner ; le Conseiller (externe) et le Chef de projet n'ont rien.
  'work.read': 'A   A   A   A   A   .   .   A   A   A   A   .   A   A   A   A',
  'work.update': 'A   A   A   A   A   .   .   .   A   A   A   .   A   A   A   A',
  'work.manage': 'A   A   A   .   .   .   .   .   .   .   .   .   .   A   .   .',
  // ADR-0040 § 4.1 : préparer les devis. Iso-privilège avec `sales.manage`, plus
  // le Commercial (COM) ; convertir un devis exige en plus `sales.manage`.
  'sales.quote': 'A   A   A   A   .   .   .   .   A   .   .   .   .   .   .   .',
  // ADR-0044 § 4.1 : achats et fournisseurs. `purchase.read` suit `treasury.read`
  // (sans le Commercial) ; demander est ouvert à tout rôle interne qui travaille ;
  // préparer suit `sales.manage` ; approuver est une autorité de dépense (ⓢ) ;
  // payer suit `treasury.manage`.
  'purchase.read': 'A   A   A   A   A   .   .   A   .   .   .   .   .   .   .   .',
  'purchase.request': 'A   A   A   A   A   .   .   .   .   .   .   .   .   .   .   .',
  'purchase.manage': 'A   A   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  'purchase.approve': 'S   .   S   .   .   .   .   .   .   .   .   .   .   .   .   .',
  'payables.pay': 'A   .   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0045 § 4.1 : ressources humaines. Le registre (lecture, gestion) : Propriétaire,
  // Administrateur, Directeur financier, Responsable RH ; les données sensibles : le moins
  // de personnes possible (ni Administrateur, ni Comptable) ; demander une absence : tout
  // rôle interne ; valider : autorité RH (ⓢ). Le manager n'a besoin d'aucune action.
  'hr.read': 'A   A   A   .   .   .   .   .   .   A   .   .   .   .   .   .',
  'hr.manage': 'A   A   A   .   .   .   .   .   .   A   .   .   .   .   .   .',
  'hr.sensitive.read': 'A   .   A   .   .   .   .   .   .   A   .   .   .   .   .   .',
  'leave.request': 'A   A   A   A   A   .   .   A   A   A   A   .   A   A   A   .',
  'leave.approve': 'S   .   S   .   .   .   .   .   .   S   .   .   .   .   .   .',
  // ADR-0046 § 8.1 : stocks, équipements, documents. Les quantités ne révèlent ni prix ni
  // dette (le Commercial les lit pour promettre une livraison) ; mouvementer est un geste
  // opérationnel (pas le Comptable : séparation garde / enregistrement) ; compter : ceux
  // qui sortent la marchandise et le Comptable ; `stock.manage` change des valeurs (ⓢ, pas
  // le Magasinier) ; la bibliothèque à tout rôle interne, le Conseiller externe exclu.
  'stock.read': 'A   A   A   A   A   .   .   A   A   .   A   .   .   .   .   .',
  'stock.move': 'A   A   A   .   .   .   .   .   .   .   A   .   .   .   .   .',
  'stock.count': 'A   A   A   A   .   .   .   .   .   .   A   .   .   .   .   .',
  'stock.manage': 'S   S   S   S   .   .   .   .   .   .   .   .   .   .   .   .',
  'assets.read': 'A   A   A   A   A   .   .   A   .   A   A   .   .   .   .   .',
  'assets.manage': 'A   A   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  'docs.read': 'A   A   A   A   A   .   .   A   A   A   A   .   .   .   .   .',
  'docs.manage': 'A   A   A   A   .   .   .   .   .   A   .   .   .   .   .   .',
  // ADR-0049 § 8.1 : comptabilité. La lecture agrège ce que ces rôles lisent déjà
  // (`sales.read`, `treasury.read`, `purchase.read`) ; ni Commercial, ni Responsable RH, ni
  // Magasinier (sans trésorerie), ni Conseiller (externe, sans les livres). Écrire et
  // paramétrer : Propriétaire, Directeur financier, Comptable (ⓢ) ; clôturer : les mêmes,
  // sans ⚙ (la réouverture est au Propriétaire) ; exporter : les mêmes et l'Expert-comptable.
  'accounting.read': 'A   A   A   A   A   .   .   A   .   .   .   A   .   .   .   .',
  'accounting.post': 'S   .   S   S   .   .   .   .   .   .   .   .   .   .   .   .',
  'accounting.close': 'A   .   A   A   .   .   .   .   .   .   .   .   .   .   .   .',
  'accounting.export': 'A   .   A   A   .   .   .   .   .   .   .   A   .   .   .   .',
  'accounting.manage': 'S   .   S   S   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0050 § 8.1 : préparer contrats, avenants et commandes — iso-privilège avec
  // `sales.quote` (le Commercial prépare le contrat de l'affaire qu'il a gagnée) ;
  // approuver, constater une reconduction, résilier : Propriétaire et Directeur financier (ⓢ).
  'sales.contract': 'A   A   A   A   .   .   .   .   A   .   .   .   .   .   .   .',
  'sales.contract.approve': 'S   .   S   .   .   .   .   .   .   .   .   .   .   .   .   .',
  // ADR-0051 § 5.1 : déclarer ses frais et pointer suivent `leave.request` (tout rôle
  // interne qui travaille) ; valider frais et avances suit `purchase.approve` (autorité de
  // dépense, ⓢ) ; lire objectifs et évaluations : Propriétaire et Responsable RH seuls —
  // ni Directeur financier, ni Administrateur (décision ouverte n° 12).
  'expenses.claim': 'A   A   A   A   A   .   .   A   A   A   A   .   A   A   A   .',
  'expenses.approve': 'S   .   S   .   .   .   .   .   .   .   .   .   .   .   .   .',
  'attendance.clock': 'A   A   A   A   A   .   .   A   A   A   A   .   A   A   A   .',
  'performance.read': 'A   .   .   .   .   .   .   .   .   A   .   .   .   .   .   .',
};

const CODE_VERS_GRANT: Record<string, string> = {
  A: 'allow',
  '.': 'deny',
  S: 'allow_sod',
  P: 'allow_project',
  C: 'conditional',
};

// ─────────────────────────────────────────────────────────────────────────────
// Transcription d'ADR-0012 §4 — matrice plateforme
//
//   N = ✓   natif        D = ⚙D  sous accès délégué seulement
//   . = ✗   interdit, y compris au super-administrateur
// ─────────────────────────────────────────────────────────────────────────────

const ORDRE_PLATEFORME: readonly PlatformRole[] = [
  'platform_super_admin',
  'platform_admin',
  'platform_support',
  'platform_billing',
  'platform_template_editor',
  'platform_country_pack_manager',
];

//                                              SA  PA  SUP FAC TPL CPK
const ATTENDU_PLATEFORME: Record<Action, string> = {
  'organization.manage': 'N   N   .   .   .   .',
  'billing.manage': 'N   .   .   N   .   .',
  'members.invite': 'N   N   .   .   .   .',
  'project.create': 'D   .   .   .   .   .',
  'project.read': 'D   D   D   .   .   .',
  'project.update': 'D   .   .   .   .   .',
  'canvas.update': 'D   .   .   .   .   .',
  'inputs.update': 'D   .   .   .   .   .',
  'plan.calculate': 'D   .   .   .   .   .',
  'plan.approve': '.   .   .   .   .   .',
  'actuals.import': 'D   .   .   .   .   .',
  'period.close': '.   .   .   .   .   .',
  'analytics.read': 'D   .   D   .   .   .',
  'report.export': '.   .   .   .   .   .',
  'audit.read': 'N   N   D   .   .   .',
  // ADR-0021 §8 : quatrième interdit absolu, super-administrateur compris.
  'fiscal.manage': '.   .   .   .   .   .',
  // ADR-0022 § S25c.1 : sous accès délégué seulement, comme `project.read` et
  // `project.update`. Aucune des deux n'est un interdit absolu.
  'sales.read': 'D   .   D   .   .   .',
  'sales.manage': 'D   .   .   .   .   .',
  // ADR-0023 § S25e.11 : cinquième interdit absolu, super-administrateur compris.
  'sales.invoice': '.   .   .   .   .   .',
  // ADR-0031 § 4 : interdite à tous les rôles plateforme, sans être un interdit absolu.
  'sales.receipt': '.   .   .   .   .   .',
  // ADR-0034 § 8 : sous accès délégué, comme `sales.read` et `sales.manage`.
  'treasury.read': 'D   .   D   .   .   .',
  'treasury.manage': 'D   .   .   .   .   .',
  // ADR-0035 § 3 : comme `sales.read` / `sales.manage`, sous accès délégué.
  'crm.read': 'D   .   D   .   .   .',
  'crm.manage': 'D   .   .   .   .   .',
  // ADR-0039 § 7 : comme `crm.read` / `crm.manage`, sous accès délégué.
  'work.read': 'D   .   D   .   .   .',
  'work.update': 'D   .   .   .   .   .',
  'work.manage': 'D   .   .   .   .   .',
  // ADR-0040 § 4.1 : comme `sales.manage`, sous accès délégué ; pas un interdit absolu.
  'sales.quote': 'D   .   .   .   .   .',
  // ADR-0044 § 4.1 : lecture déléguée (SA, support), demande et gestion déléguées (SA
  // seul) ; approuver et payer refusés à tous, sans être des interdits absolus.
  'purchase.read': 'D   .   D   .   .   .',
  'purchase.request': 'D   .   .   .   .   .',
  'purchase.manage': 'D   .   .   .   .   .',
  'purchase.approve': '.   .   .   .   .   .',
  'payables.pay': '.   .   .   .   .   .',
  // ADR-0045 § 4.1 : registre sous accès délégué pour le seul super-administrateur (pas
  // le support : données personnelles) ; `hr.sensitive.read`, sixième interdit absolu ;
  // demander et valider une absence refusés à tous, sans être des interdits absolus.
  'hr.read': 'D   .   .   .   .   .',
  'hr.manage': 'D   .   .   .   .   .',
  'hr.sensitive.read': '.   .   .   .   .   .',
  'leave.request': '.   .   .   .   .   .',
  'leave.approve': '.   .   .   .   .   .',
  // ADR-0046 § 8.1 : lecture sous accès délégué (SA, support) ; gestes délégués au seul
  // super-administrateur ; aucun interdit absolu nouveau (un document sensible n'est
  // jamais servi à un acteur plateforme : règle de service).
  'stock.read': 'D   .   D   .   .   .',
  'stock.move': 'D   .   .   .   .   .',
  'stock.count': 'D   .   .   .   .   .',
  'stock.manage': 'D   .   .   .   .   .',
  'assets.read': 'D   .   D   .   .   .',
  'assets.manage': 'D   .   .   .   .   .',
  'docs.read': 'D   .   D   .   .   .',
  'docs.manage': 'D   .   .   .   .   .',
  // ADR-0049 § 8.1 : lecture des livres sous accès délégué (SA, support) ; écrire,
  // clôturer, exporter et paramétrer : septième à dixième interdits absolus.
  'accounting.read': 'D   .   D   .   .   .',
  'accounting.post': '.   .   .   .   .   .',
  'accounting.close': '.   .   .   .   .   .',
  'accounting.export': '.   .   .   .   .   .',
  'accounting.manage': '.   .   .   .   .   .',
  // ADR-0050 § 8.1 : préparer sous accès délégué (SA seul), comme `sales.quote` ; approuver,
  // onzième interdit absolu.
  'sales.contract': 'D   .   .   .   .   .',
  'sales.contract.approve': '.   .   .   .   .   .',
  // ADR-0051 § 5.1 : refusées à tous ; `performance.read`, douzième interdit absolu.
  'expenses.claim': '.   .   .   .   .   .',
  'expenses.approve': '.   .   .   .   .   .',
  'attendance.clock': '.   .   .   .   .   .',
  'performance.read': '.   .   .   .   .   .',
};

const CODE_VERS_GRANT_PLATEFORME: Record<string, string> = {
  N: 'native',
  D: 'delegated',
  '.': 'forbidden',
};

function cellules(ligne: string): string[] {
  return ligne.trim().split(/\s+/);
}

describe('matrice rôle organisation × action (ADR-0012 §3)', () => {
  it('déclare exactement les 16 rôles et les 57 actions de docs/12', () => {
    expect([...ORG_ROLES]).toEqual([...ORDRE_ORG]);
    expect(ACTIONS).toHaveLength(57);
    // Ajoutée en fin de liste, comme dans docs/12 (ADR-0021 §8).
    expect(ACTIONS[15]).toBe('fiscal.manage');
    // Dix-septième et dix-huitième, en fin de liste (ADR-0022 § S25c.1).
    expect(ACTIONS[16]).toBe('sales.read');
    expect(ACTIONS[17]).toBe('sales.manage');
    // Dix-neuvième, en fin de liste (ADR-0023 § S25e.11).
    expect(ACTIONS[18]).toBe('sales.invoice');
    // Vingtième, en fin de liste (ADR-0031 § 4).
    expect(ACTIONS[19]).toBe('sales.receipt');
    // Vingt et unième et vingt-deuxième, en fin de liste (ADR-0034 § 8, ordre de fusion).
    expect(ACTIONS[20]).toBe('treasury.read');
    expect(ACTIONS[21]).toBe('treasury.manage');
    // Vingt-troisième et vingt-quatrième, en fin de liste (ADR-0035 § 3, ordre de
    // fusion — amendement du 27 oct. 2026).
    expect(ACTIONS[22]).toBe('crm.read');
    expect(ACTIONS[23]).toBe('crm.manage');
    // Vingt-cinquième à vingt-septième, en fin de liste (ADR-0039 § 7).
    expect(ACTIONS[24]).toBe('work.read');
    expect(ACTIONS[25]).toBe('work.update');
    expect(ACTIONS[26]).toBe('work.manage');
    // Vingt-huitième, en fin de liste (ADR-0040 § 4.1).
    expect(ACTIONS[27]).toBe('sales.quote');
    // Vingt-neuvième à trente-troisième, en fin de liste (ADR-0044 § 4.1).
    expect(ACTIONS.slice(28, 33)).toEqual([
      'purchase.read',
      'purchase.request',
      'purchase.manage',
      'purchase.approve',
      'payables.pay',
    ]);
    // Trente-quatrième à trente-huitième, en fin de liste (ADR-0045 § 4.1).
    expect(ACTIONS.slice(33, 38)).toEqual([
      'hr.read',
      'hr.manage',
      'hr.sensitive.read',
      'leave.request',
      'leave.approve',
    ]);
    // Trente-neuvième à quarante-sixième (ADR-0046 § 8.1).
    expect(ACTIONS.slice(38, 46)).toEqual([
      'stock.read',
      'stock.move',
      'stock.count',
      'stock.manage',
      'assets.read',
      'assets.manage',
      'docs.read',
      'docs.manage',
    ]);
    // Quarante-septième à cinquante et unième (ADR-0049 § 8.1).
    expect(ACTIONS.slice(46, 51)).toEqual([
      'accounting.read',
      'accounting.post',
      'accounting.close',
      'accounting.export',
      'accounting.manage',
    ]);
    // Cinquante-deuxième et cinquante-troisième, en fin de liste (ADR-0050 § 8.1, ordre de
    // fusion).
    expect(ACTIONS.slice(51, 53)).toEqual(['sales.contract', 'sales.contract.approve']);
    // Cinquante-quatrième à cinquante-septième, en fin de liste (ADR-0051 § 5.1, recalées
    // après ADR-0050).
    expect(ACTIONS.slice(53)).toEqual([
      'expenses.claim',
      'expenses.approve',
      'attendance.clock',
      'performance.read',
    ]);
    expect(Object.keys(ATTENDU_ORG).sort()).toEqual([...ACTIONS].sort());
  });

  // 11 × 46 = 506 cases.
  for (const action of ACTIONS) {
    const attendus = cellules(ATTENDU_ORG[action]);
    it(`« ${action} » : les 11 cases correspondent à l'ADR`, () => {
      expect(attendus).toHaveLength(ORDRE_ORG.length);
      ORDRE_ORG.forEach((role, i) => {
        const attendu = CODE_VERS_GRANT[attendus[i]!];
        expect(attendu, `code inconnu « ${attendus[i]} »`).toBeDefined();
        expect(
          ORG_PERMISSION_MATRIX[role][action],
          `${role} × ${action} devrait être ${attendu}`,
        ).toBe(attendu);
      });
    });
  }
});

// ADR-0041 — A1 : écart vide ⇒ effectif = ligne du rôle, sur les 506 cases organisation.
// Ce qui fonde « comportement strictement identique » tant qu'aucun écart n'est stocké.
describe('ADR-0041 — écart vide : les droits effectifs sont la ligne du rôle', () => {
  const VIDES: readonly OrgPermissionContext[] = [NO_OVERRIDES, {}, { grants: [], revokes: [] }];
  for (const role of ORDRE_ORG) {
    it(`« ${role} » : 46 cases identiques à la matrice, avec et sans droit de clôture`, () => {
      for (const canClosePeriods of [false, true]) {
        const attendu = ACTIONS.filter((a) => {
          const g = ORG_PERMISSION_MATRIX[role][a];
          return g === 'conditional' ? canClosePeriods : g !== 'deny';
        });
        for (const vide of VIDES) {
          const ctx = { ...vide, canClosePeriods };
          expect(effectiveActions(role, ctx), role).toEqual(attendu);
          for (const action of ACTIONS) {
            expect(can(role, action, ctx), `${role} × ${action}`).toBe(attendu.includes(action));
          }
        }
      }
    });
  }
});

describe('matrice rôle plateforme × action (ADR-0012 §4)', () => {
  it('déclare exactement les 6 rôles plateforme, tous préfixés `platform_`', () => {
    expect([...PLATFORM_ROLES]).toEqual([...ORDRE_PLATEFORME]);
    for (const role of PLATFORM_ROLES) expect(role.startsWith('platform_')).toBe(true);
  });

  // 6 × 46 = 276 cases.
  for (const action of ACTIONS) {
    const attendus = cellules(ATTENDU_PLATEFORME[action]);
    it(`« ${action} » : les 6 cases plateforme correspondent à l'ADR`, () => {
      expect(attendus).toHaveLength(ORDRE_PLATEFORME.length);
      ORDRE_PLATEFORME.forEach((role, i) => {
        const attendu = CODE_VERS_GRANT_PLATEFORME[attendus[i]!];
        expect(attendu, `code inconnu « ${attendus[i]} »`).toBeDefined();
        expect(
          PLATFORM_PERMISSION_MATRIX[role][action],
          `${role} × ${action} devrait être ${attendu}`,
        ).toBe(attendu);
      });
    });
  }
});

describe('interdits absolus de la plateforme (ADR-0012 §4, ADR-0021 §8, ADR-0023 § S25e.11, ADR-0045 § 4.1, ADR-0049 § 8.1, ADR-0050 § 8.1, ADR-0051 § 5.1)', () => {
  const interdits: Action[] = [
    'plan.approve',
    'period.close',
    'report.export',
    'fiscal.manage',
    'sales.invoice',
    'hr.sensitive.read',
    // ADR-0049 § 8.1 : écrire, clôturer, exporter et paramétrer les livres d'un client.
    'accounting.post',
    'accounting.close',
    'accounting.export',
    'accounting.manage',
    // ADR-0050 § 8.1 : approuver, constater une reconduction, résilier un contrat client.
    'sales.contract.approve',
    // ADR-0051 § 5.1 : objectifs et évaluations du personnel d'un client.
    'performance.read',
  ];

  it('sont exactement ceux annoncés, au nombre de douze', () => {
    expect(PLATFORM_FORBIDDEN_ACTIONS).toHaveLength(12);
    expect([...PLATFORM_FORBIDDEN_ACTIONS].sort()).toEqual([...interdits].sort());
  });

  it('aucun rôle plateforme ne les obtient, même avec un accès délégué actif', () => {
    for (const role of PLATFORM_ROLES) {
      for (const action of interdits) {
        expect(canPlatform(role, action, { hasActiveGrant: true }), `${role} × ${action}`).toBe(
          false,
        );
      }
    }
  });

  it('la matrice elle-même ne contredit jamais la liste', () => {
    for (const role of PLATFORM_ROLES) {
      for (const action of interdits) {
        expect(PLATFORM_PERMISSION_MATRIX[role][action]).toBe('forbidden');
      }
    }
  });

  it("le super-administrateur n'échappe pas à la règle", () => {
    expect(canPlatform('platform_super_admin', 'report.export', { hasActiveGrant: true })).toBe(
      false,
    );
    // …alors qu'il détient bien ses droits de portée plateforme.
    expect(canPlatform('platform_super_admin', 'audit.read')).toBe(true);
  });
});

describe('accès délégué (⚙D)', () => {
  it('une case `delegated` est refusée SANS grant et accordée AVEC', () => {
    expect(canPlatform('platform_support', 'project.read')).toBe(false);
    expect(canPlatform('platform_support', 'project.read', { hasActiveGrant: true })).toBe(true);
  });

  it('un grant ne crée jamais un droit là où la case est `forbidden`', () => {
    expect(canPlatform('platform_billing', 'project.read', { hasActiveGrant: true })).toBe(false);
  });
});

describe('droit conditionnel ⚙ (docs/12 « clôture selon permission »)', () => {
  it('le comptable ne clôture pas sans le droit explicite', () => {
    expect(can('accountant', 'period.close', NO_OVERRIDES)).toBe(false);
    expect(can('accountant', 'period.close', { canClosePeriods: false })).toBe(false);
  });

  it('le comptable clôture une fois le droit accordé', () => {
    expect(can('accountant', 'period.close', { canClosePeriods: true })).toBe(true);
  });

  it("le drapeau n'élargit AUCUN autre rôle ni aucune autre action", () => {
    // C'est l'invariant qui empêche `canClosePeriods` de devenir une porte dérobée.
    for (const role of ORG_ROLES) {
      for (const action of ACTIONS) {
        const sans = can(role, action, { canClosePeriods: false });
        const avec = can(role, action, { canClosePeriods: true });
        if (role === 'accountant' && action === 'period.close') {
          expect(sans).toBe(false);
          expect(avec).toBe(true);
        } else {
          expect(avec, `${role} × ${action} ne doit pas dépendre du drapeau`).toBe(sans);
        }
      }
    }
  });

  it("`conditional` n'apparaît qu'une seule fois dans toute la matrice", () => {
    const cases = ORG_ROLES.flatMap((r) =>
      ACTIONS.filter((a) => ORG_PERMISSION_MATRIX[r][a] === 'conditional').map((a) => `${r}:${a}`),
    );
    expect(cases).toEqual(['accountant:period.close']);
  });
});

describe('R2 — séparation validation / saisie (docs/12 § Règles critiques)', () => {
  it('`plan.approve` et `inputs.update` sont deux actions distinctes', () => {
    expect(ACTIONS).toContain('plan.approve');
    expect(ACTIONS).toContain('inputs.update');
  });

  it('seuls `owner` et `finance_director` peuvent approuver un plan', () => {
    const approbateurs = ORG_ROLES.filter((r) => can(r, 'plan.approve', NO_OVERRIDES));
    expect(approbateurs).toEqual(['owner', 'finance_director']);
  });

  it('`admin`, `analyst` et `project_manager` saisissent sans jamais approuver', () => {
    for (const role of ['admin', 'analyst', 'project_manager'] as const) {
      expect(can(role, 'inputs.update', NO_OVERRIDES), `${role} doit pouvoir saisir`).toBe(true);
      expect(can(role, 'plan.approve', NO_OVERRIDES), `${role} ne doit pas approuver`).toBe(false);
    }
  });

  it('le comptable constate mais ne projette pas', () => {
    expect(can('accountant', 'actuals.import', NO_OVERRIDES)).toBe(true);
    expect(can('accountant', 'inputs.update', NO_OVERRIDES)).toBe(false);
    expect(can('accountant', 'plan.calculate', NO_OVERRIDES)).toBe(false);
  });

  it('toute case `plan.approve` autorisée porte la marque ⓢ', () => {
    for (const role of ORG_ROLES) {
      const cell = ORG_PERMISSION_MATRIX[role]['plan.approve'];
      expect(cell === 'deny' || cell === 'allow_sod').toBe(true);
    }
  });

  describe('décision dynamique', () => {
    it('approbateur différent du dernier saisisseur → séparé', () => {
      expect(
        sodDecision({
          approverUserId: 'u1',
          lastInputAuthorUserId: 'u2',
          approverCountInOrg: 2,
        }),
      ).toBe('separated');
    });

    it("auto-approbation avec d'autres approbateurs disponibles → refus", () => {
      expect(
        sodDecision({
          approverUserId: 'u1',
          lastInputAuthorUserId: 'u1',
          approverCountInOrg: 2,
        }),
      ).toBe('self_forbidden');
    });

    it('entrepreneur SEUL : auto-approbation autorisée mais marquée', () => {
      // Le cas majoritaire en RDC. Sans cette échappatoire, une organisation
      // d'une personne ne pourrait JAMAIS valider son plan.
      expect(
        sodDecision({
          approverUserId: 'u1',
          lastInputAuthorUserId: 'u1',
          approverCountInOrg: 1,
        }),
      ).toBe('sole_approver');
    });

    it('auteur des entrées inconnu (projet antérieur à S20a) → séparé', () => {
      expect(
        sodDecision({
          approverUserId: 'u1',
          lastInputAuthorUserId: null,
          approverCountInOrg: 1,
        }),
      ).toBe('separated');
    });
  });
});

describe('R3 — clôture et réouverture exigent des permissions distinctes', () => {
  it('un comptable habilité clôture mais ne peut pas rouvrir', () => {
    const ctx = { canClosePeriods: true };
    expect(can('accountant', 'period.close', ctx)).toBe(true);
    // La réouverture exige les DEUX; il lui manque `plan.approve`.
    expect(can('accountant', 'plan.approve', ctx)).toBe(false);
  });

  it('`owner` et `finance_director` détiennent bien les deux', () => {
    for (const role of ['owner', 'finance_director'] as const) {
      expect(can(role, 'period.close', NO_OVERRIDES)).toBe(true);
      expect(can(role, 'plan.approve', NO_OVERRIDES)).toBe(true);
    }
  });

  it('un `admin` ne peut ni clôturer ni rouvrir', () => {
    expect(can('admin', 'period.close', NO_OVERRIDES)).toBe(false);
    expect(can('admin', 'plan.approve', NO_OVERRIDES)).toBe(false);
  });
});

describe('R4 — exports', () => {
  it("`advisor` et `viewer` n'ont pas `report.export`", () => {
    expect(can('advisor', 'report.export', NO_OVERRIDES)).toBe(false);
    expect(can('viewer', 'report.export', NO_OVERRIDES)).toBe(false);
  });

  it('`advisor` conserve la consultation en ligne', () => {
    expect(can('advisor', 'project.read', NO_OVERRIDES)).toBe(true);
    expect(can('advisor', 'analytics.read', NO_OVERRIDES)).toBe(true);
  });
});

describe('R7 — attribution de rôles sans élévation de privilège', () => {
  it('un `owner` peut attribuer tous les rôles attribuables', () => {
    expect(grantableRoles('owner').sort()).toEqual(
      ORG_ROLES.filter(isAssignableRole).slice().sort(),
    );
  });

  it('un `admin` ne peut pas attribuer `finance_director` (qui approuve)', () => {
    expect(canGrantRole('admin', 'finance_director')).toBe(false);
  });

  it('un `admin` ne peut pas attribuer `accountant` (clôture conditionnelle)', () => {
    // Conséquence assumée d'ADR-0012 §6 R7 : le sous-ensemble se calcule sur les
    // actions POTENTIELLES, drapeau ⚙ compris. Sinon un `admin` accorderait un
    // rôle capable d'une action qu'il n'a pas, en pariant sur le défaut `false`.
    expect(canGrantRole('admin', 'accountant')).toBe(false);
  });

  it('un `admin` peut attribuer les rôles strictement plus faibles que lui', () => {
    for (const role of ['analyst', 'advisor', 'viewer', 'admin', 'sales_rep'] as const) {
      expect(canGrantRole('admin', role), `admin → ${role}`).toBe(true);
    }
  });

  it("un `viewer` ne peut attribuer que des rôles sans aucun droit d'écriture", () => {
    // L'ensemble d'actions d'`advisor` ({project.read, analytics.read}) est
    // contenu dans celui de `viewer` (qui y ajoute `sales.read`, ADR-0022, `crm.read`, ADR-0035, et `work.read`, ADR-0039) : la
    // règle du sous-ensemble laisse donc `viewer` « attribuer » `advisor`.
    // C'est sans conséquence — d'abord parce qu'aucun droit n'est gagné, ensuite
    // parce qu'un `viewer` n'a pas `members.invite` et que le guard le refuse
    // bien avant que R7 soit consulté. Ce que le test doit garantir, c'est
    // qu'aucune ÉCRITURE ne fuit par ce chemin.
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
    for (const cible of grantableRoles('viewer')) {
      for (const action of ACTIONS) {
        // Les sept actions de lecture du Lecteur ; tout le reste est une écriture.
        // `leave.request` (ADR-0045 § 4.1) n'écrit que la demande du membre lui-même,
        // jamais une donnée de l'organisation.
        if (
          action === 'leave.request' ||
          action === 'purchase.read' ||
          action === 'project.read' ||
          action === 'analytics.read' ||
          action === 'sales.read' ||
          action === 'treasury.read' ||
          action === 'crm.read' ||
          action === 'work.read' ||
          // ADR-0046 § 8.1 : lectures des stocks, du registre et de la bibliothèque.
          action === 'stock.read' ||
          action === 'assets.read' ||
          action === 'docs.read' ||
          // ADR-0049 § 8.1 : lecture des livres.
          action === 'accounting.read' ||
          // ADR-0051 § 5.1 : comme `leave.request`, déclarer ses frais et pointer n'écrivent
          // que pour le membre lui-même, jamais une donnée de l'organisation.
          action === 'expenses.claim' ||
          action === 'attendance.clock'
        ) {
          continue;
        }
        expect(can(cible, action, { canClosePeriods: true }), `${cible} × ${action}`).toBe(false);
      }
    }
    expect(can('viewer', 'members.invite', NO_OVERRIDES)).toBe(false);
  });

  it('personne ne peut attribuer `owner` sauf un `owner`', () => {
    for (const role of ORG_ROLES) {
      expect(canGrantRole(role, 'owner'), `${role} → owner`).toBe(role === 'owner');
    }
  });

  it("aucun rôle ne peut attribuer un rôle détenant une action qu'il n'a pas", () => {
    // L'invariant général, vérifié exhaustivement plutôt que cas par cas.
    for (const acteur of ORG_ROLES) {
      for (const cible of grantableRoles(acteur)) {
        for (const action of ACTIONS) {
          if (ORG_PERMISSION_MATRIX[cible][action] !== 'deny') {
            expect(
              ORG_PERMISSION_MATRIX[acteur][action],
              `${acteur} attribue ${cible} qui détient ${action}`,
            ).not.toBe('deny');
          }
        }
      }
    }
  });

  it("`project_manager` n'est attribuable par personne tant que les projets ne sont pas assignables", () => {
    expect(isAssignableRole('project_manager')).toBe(false);
    for (const role of ORG_ROLES) {
      expect(grantableRoles(role)).not.toContain('project_manager');
    }
  });
});

describe('rang de privilège (correction du tri de l’organisation primaire)', () => {
  it('`owner` est le rang 0', () => {
    expect(ORG_ROLE_RANK.owner).toBe(0);
  });

  it('couvre les 16 rôles avec des rangs distincts', () => {
    const rangs = ORG_ROLES.map((r) => ORG_ROLE_RANK[r]);
    expect(new Set(rangs).size).toBe(ORG_ROLES.length);
  });

  it('`owner` gagne contre tout autre rôle — ce que le tri alphabétique ne faisait PAS', () => {
    // Le bug d'origine : 'project_manager' > 'owner' et 'viewer' > 'owner' en
    // ordre alphabétique. Le rang explicite inverse ces comparaisons.
    for (const role of ORG_ROLES) {
      if (role === 'owner') continue;
      expect(ORG_ROLE_RANK.owner).toBeLessThan(ORG_ROLE_RANK[role]);
      // Preuve que le tri naïf se serait trompé sur ces deux-là :
      if (role === 'project_manager' || role === 'viewer') {
        expect(role > 'owner').toBe(true);
      }
    }
  });
});

describe('compatibilité N-1 des anciens rôles', () => {
  it('`member` devient `finance_director` (iso-privilège, ADR-0012 §7)', () => {
    expect(normalizeOrgRole('member')).toBe('finance_director');
  });

  it('`owner` traverse la migration inchangé', () => {
    expect(normalizeOrgRole('owner')).toBe('owner');
  });

  it('les 16 slugs se normalisent en eux-mêmes', () => {
    for (const role of ORG_ROLES) expect(normalizeOrgRole(role)).toBe(role);
  });

  it('une valeur inconnue ne se normalise pas en un rôle par défaut', () => {
    // Renvoyer `viewer` ici serait tentant et dangereux : une faute de frappe
    // deviendrait un accès silencieux au lieu d'une erreur.
    expect(normalizeOrgRole('root')).toBeUndefined();
    expect(normalizeOrgRole('')).toBeUndefined();
    expect(normalizeOrgRole(undefined)).toBeUndefined();
    expect(normalizeOrgRole(null)).toBeUndefined();
    expect(normalizeOrgRole(42)).toBeUndefined();
  });
});

describe('cohérence structurelle de la matrice', () => {
  it('chaque rôle déclare une décision pour CHACUNE des 57 actions', () => {
    for (const role of ORG_ROLES) {
      for (const action of ACTIONS) {
        expect(ORG_PERMISSION_MATRIX[role][action], `${role} × ${action}`).toBeDefined();
      }
    }
  });

  it('`viewer` ne détient aucune action d’écriture', () => {
    const ecritures: Action[] = [
      'organization.manage',
      'billing.manage',
      'members.invite',
      'project.create',
      'project.update',
      'canvas.update',
      'inputs.update',
      'plan.approve',
      'actuals.import',
      'period.close',
    ];
    for (const action of ecritures) expect(can('viewer', action, NO_OVERRIDES)).toBe(false);
  });

  it('`owner` détient les 57 actions', () => {
    for (const action of ACTIONS) expect(can('owner', action, NO_OVERRIDES)).toBe(true);
  });

  it('`billing.manage` est réservé au seul `owner`', () => {
    expect(ORG_ROLES.filter((r) => can(r, 'billing.manage', NO_OVERRIDES))).toEqual(['owner']);
  });

  it('`fiscal.manage` est réservé à `owner` et `finance_director` (ADR-0021 §8)', () => {
    expect(ORG_ROLES.filter((r) => can(r, 'fiscal.manage', NO_OVERRIDES))).toEqual([
      'owner',
      'finance_director',
    ]);
    // L'Administrateur gère l'organisation, pas son identité fiscale.
    expect(can('admin', 'organization.manage', NO_OVERRIDES)).toBe(true);
    expect(can('admin', 'fiscal.manage', NO_OVERRIDES)).toBe(false);
  });

  it('`fiscal.manage` ne donne pas de nouveau rôle attribuable à un `admin`', () => {
    // ADR-0021 §8 « conséquences vérifiées sur grantableRoles » : l'Administrateur
    // ne pouvait déjà pas attribuer `finance_director` (`plan.approve`).
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
  });

  it('`sales.manage` implique `sales.read` pour chaque rôle (ADR-0022 § S25c.1)', () => {
    // Gérer sans pouvoir consulter n'aurait aucun sens : l'écran de gestion lit
    // la liste avant d'écrire.
    for (const role of ORG_ROLES) {
      if (can(role, 'sales.manage', NO_OVERRIDES))
        expect(can(role, 'sales.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) {
      if (PLATFORM_PERMISSION_MATRIX[role]['sales.manage'] !== 'forbidden') {
        expect(PLATFORM_PERMISSION_MATRIX[role]['sales.read'], role).not.toBe('forbidden');
      }
    }
  });

  it('`sales.read` et `sales.manage` ne changent pas les rôles attribuables (R7)', () => {
    // L'Administrateur détient les deux actions : il peut toujours attribuer
    // exactement les mêmes rôles qu'avant ADR-0022.
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.read');
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.manage');
  });

  it('`sales.invoice` implique `sales.manage` et ne change pas les rôles attribuables (ADR-0023)', () => {
    // Émettre suppose de pouvoir préparer le brouillon.
    for (const role of ORG_ROLES) {
      if (can(role, 'sales.invoice', NO_OVERRIDES))
        expect(can(role, 'sales.manage', NO_OVERRIDES), role).toBe(true);
    }
    // L'Administrateur ne l'a pas : il ne pouvait déjà attribuer ni `finance_director`
    // ni `accountant`, ses rôles attribuables sont inchangés.
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
  });

  it('`sales.receipt` implique `sales.read`, n’est pas un interdit absolu et ne change pas les rôles attribuables (ADR-0031)', () => {
    // Lettrer un encaissement suppose de lire les factures.
    for (const role of ORG_ROLES) {
      if (can(role, 'sales.receipt', NO_OVERRIDES))
        expect(can(role, 'sales.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) expect(canPlatform(role, 'sales.receipt')).toBe(false);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.receipt');
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
  });

  it('`treasury.manage` implique `treasury.read` et ne change pas les rôles attribuables (ADR-0034)', () => {
    for (const role of ORG_ROLES) {
      if (can(role, 'treasury.manage', NO_OVERRIDES))
        expect(can(role, 'treasury.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) {
      if (PLATFORM_PERMISSION_MATRIX[role]['treasury.manage'] !== 'forbidden') {
        expect(PLATFORM_PERMISSION_MATRIX[role]['treasury.read'], role).not.toBe('forbidden');
      }
    }
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('treasury.read');
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('treasury.manage');
    // L'Administrateur lit sans enregistrer : ses rôles attribuables sont inchangés,
    // le Lecteur aussi (il lit la trésorerie, le Conseiller non).
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
  });

  it('`crm.manage` implique `crm.read` et ne change pas les rôles attribuables (ADR-0035)', () => {
    for (const role of ORG_ROLES) {
      if (can(role, 'crm.manage', NO_OVERRIDES))
        expect(can(role, 'crm.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) {
      if (PLATFORM_PERMISSION_MATRIX[role]['crm.manage'] !== 'forbidden') {
        expect(PLATFORM_PERMISSION_MATRIX[role]['crm.read'], role).not.toBe('forbidden');
      }
    }
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('crm.read');
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('crm.manage');
  });

  it('`work.manage` ⇒ `work.update` ⇒ `work.read`, sans changer les rôles attribuables (ADR-0039)', () => {
    // Trois niveaux emboîtés : gouverner suppose de travailler, travailler suppose de lire.
    for (const role of ORG_ROLES) {
      if (can(role, 'work.manage', NO_OVERRIDES))
        expect(can(role, 'work.update', NO_OVERRIDES), role).toBe(true);
      if (can(role, 'work.update', NO_OVERRIDES))
        expect(can(role, 'work.read', NO_OVERRIDES), role).toBe(true);
    }
    for (const role of PLATFORM_ROLES) {
      const m = PLATFORM_PERMISSION_MATRIX[role];
      if (m['work.manage'] !== 'forbidden') expect(m['work.update'], role).not.toBe('forbidden');
      if (m['work.update'] !== 'forbidden') expect(m['work.read'], role).not.toBe('forbidden');
    }
    // Aucune n'est un interdit absolu (ADR-0039 § 7).
    for (const action of ['work.read', 'work.update', 'work.manage'] as const) {
      expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain(action);
    }
    // Le Chef de projet reste non attribuable et sans accès (décision ouverte n° 1).
    expect(can('project_manager', 'work.read', NO_OVERRIDES)).toBe(false);
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
  });
});

describe('ADR-0040 § 4 — rôle Commercial et action `sales.quote`', () => {
  it('`sales.quote` : exactement les détenteurs de `sales.manage`, plus le Commercial', () => {
    const quote = ORG_ROLES.filter((r) => can(r, 'sales.quote', NO_OVERRIDES));
    const manage = ORG_ROLES.filter((r) => can(r, 'sales.manage', NO_OVERRIDES));
    expect(quote).toEqual([...manage, 'sales_rep']);
    // Préparer un devis suppose de lire les ventes.
    for (const role of quote) expect(can(role, 'sales.read', NO_OVERRIDES), role).toBe(true);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.quote');
    for (const role of PLATFORM_ROLES) {
      expect(PLATFORM_PERMISSION_MATRIX[role]['sales.quote'], role).toBe(
        PLATFORM_PERMISSION_MATRIX[role]['sales.manage'],
      );
    }
  });

  it('le Commercial détient dix actions sur quarante-six, et seulement celles-là', () => {
    expect(ACTIONS.filter((a) => can('sales_rep', a, { canClosePeriods: true }))).toEqual([
      'analytics.read',
      'sales.read',
      'crm.read',
      'crm.manage',
      'work.read',
      'work.update',
      'sales.quote',
      // ADR-0045 § 4.1 : demander une absence, comme tout rôle interne.
      'leave.request',
      // ADR-0046 § 8.1 : les quantités (sans valeurs) et la bibliothèque.
      'stock.read',
      'docs.read',
      // ADR-0050 § 8.1 : il prépare le contrat de l'affaire qu'il a gagnée, sans l'approuver.
      'sales.contract',
      // ADR-0051 § 5.1 : ses frais de terrain et son pointage, comme `leave.request`.
      'expenses.claim',
      'attendance.clock',
    ]);
  });

  it('le Commercial ne voit ni la trésorerie, ni le réalisé, ni n’émet ou n’encaisse (D3)', () => {
    for (const action of [
      'treasury.read',
      'treasury.manage',
      'project.read',
      'sales.manage',
      'sales.invoice',
      'sales.receipt',
      'work.manage',
      'members.invite',
    ] as const) {
      expect(can('sales_rep', action, NO_OVERRIDES), action).toBe(false);
    }
  });

  it('rang 5, entre l’Analyste et le Chef de projet ; libellé « Commercial »', () => {
    expect(ORG_ROLE_RANK.analyst).toBe(4);
    expect(ORG_ROLE_RANK.sales_rep).toBe(5);
    // ADR-0045 § 4.2 : le Responsable RH s'insère au rang 6 ; ADR-0046 § 8.2 : le
    // Magasinier au rang 7 ; ADR-0049 § 8.2 : l'Expert-comptable au rang 8 ; les suivants
    // glissent.
    // ADR-0059 § 3 : Manager, Salarié et Stagiaire aux rangs 8 à 10 ; les suivants glissent
    // de trois crans.
    expect(ORG_ROLE_RANK.project_manager).toBe(12);
    expect(ORG_ROLE_RANK.advisor).toBe(13);
    expect(ORG_ROLE_RANK.viewer).toBe(14);
    expect(ORG_ROLE_LABELS.sales_rep).toBe('Commercial');
    expect(ORG_ROLE_DESCRIPTIONS.sales_rep.length).toBeGreaterThan(20);
  });

  it('attribuable : l’Administrateur l’invite, le Commercial n’attribue rien d’autre que lui-même', () => {
    expect(isAssignableRole('sales_rep')).toBe(true);
    expect(canGrantRole('owner', 'sales_rep')).toBe(true);
    expect(canGrantRole('admin', 'sales_rep')).toBe(true);
    // Le Comptable détient les huit actions mais n'a pas `members.invite` : le
    // guard le refuse avant R7 (critère d'acceptation n° 3, vérifié en e2e).
    expect(can('accountant', 'members.invite', NO_OVERRIDES)).toBe(false);
    expect(can('sales_rep', 'members.invite', NO_OVERRIDES)).toBe(false);
    expect(grantableRoles('viewer')).not.toContain('sales_rep');
  });

  it('`member` historique n’est pas un alias du Commercial', () => {
    expect(normalizeOrgRole('member')).toBe('finance_director');
    expect(normalizeOrgRole('sales_rep')).toBe('sales_rep');
  });
});

describe('ADR-0044 § 4 — achats et fournisseurs (lot P0)', () => {
  const ACHATS = [
    'purchase.read',
    'purchase.request',
    'purchase.manage',
    'purchase.approve',
    'payables.pay',
  ] as const;
  const detenteurs = (action: Action): OrgRole[] =>
    ORG_ROLES.filter((r) => can(r, action, NO_OVERRIDES));

  it('`purchase.read` suit `treasury.read`, sans le Commercial (D3)', () => {
    expect(detenteurs('purchase.read')).toEqual(
      detenteurs('treasury.read').filter((r) => r !== 'sales_rep'),
    );
    expect(detenteurs('purchase.read')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'viewer',
    ]);
  });

  it('demander : tout rôle interne qui travaille ; ni Lecteur, ni Commercial (décision n° 4)', () => {
    expect(detenteurs('purchase.request')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
    ]);
  });

  it('préparer suit `sales.manage` ; payer suit `treasury.manage`', () => {
    expect(detenteurs('purchase.manage')).toEqual(detenteurs('sales.manage'));
    expect(detenteurs('payables.pay')).toEqual(detenteurs('treasury.manage'));
  });

  it('approuver : Propriétaire et Directeur financier seulement, case ⓢ', () => {
    expect(detenteurs('purchase.approve')).toEqual(['owner', 'finance_director']);
    for (const role of ORG_ROLES) {
      const cell = ORG_PERMISSION_MATRIX[role]['purchase.approve'];
      expect(cell === 'deny' || cell === 'allow_sod', role).toBe(true);
    }
    // Le Comptable paie sans autoriser ; l'Administrateur prépare sans autoriser ni payer.
    expect(can('accountant', 'payables.pay', NO_OVERRIDES)).toBe(true);
    expect(can('accountant', 'purchase.approve', NO_OVERRIDES)).toBe(false);
    expect(can('admin', 'purchase.manage', NO_OVERRIDES)).toBe(true);
    expect(can('admin', 'purchase.approve', NO_OVERRIDES)).toBe(false);
    expect(can('admin', 'payables.pay', NO_OVERRIDES)).toBe(false);
  });

  it('chaque action d’approbation n’a que des cases ✗ ou ⓢ ; `APPROVER_ROLES` inchangé', () => {
    expect([...APPROVAL_ACTIONS]).toEqual([
      'plan.approve',
      'purchase.approve',
      'leave.approve',
      'stock.manage',
      // ADR-0049 § 8.3 : opérations diverses et jeux de règles.
      'accounting.post',
      'accounting.manage',
      // ADR-0050 § 8.3 : contrats, avenants et constats de reconduction.
      'sales.contract.approve',
      // ADR-0051 § 5.2 : notes de frais et avances (étape `finance`).
      'expenses.approve',
    ]);
    for (const action of APPROVAL_ACTIONS) {
      for (const role of ORG_ROLES) {
        expect(['deny', 'allow_sod']).toContain(ORG_PERMISSION_MATRIX[role][action]);
      }
    }
    expect(APPROVER_ROLES).toEqual(['owner', 'finance_director']);
  });

  it('plateforme : aucune n’est un interdit absolu ; approuver et payer refusés à tous', () => {
    for (const action of ACHATS) expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain(action);
    for (const role of PLATFORM_ROLES) {
      for (const action of ['purchase.approve', 'payables.pay'] as const) {
        expect(canPlatform(role, action, { hasActiveGrant: true }), `${role} × ${action}`).toBe(
          false,
        );
      }
    }
    expect(canPlatform('platform_super_admin', 'purchase.manage', { hasActiveGrant: true })).toBe(
      true,
    );
    expect(canPlatform('platform_support', 'purchase.read', { hasActiveGrant: true })).toBe(true);
    expect(canPlatform('platform_support', 'purchase.read')).toBe(false);
  });

  it('aucun rôle nouveau, R7 inchangé : l’Administrateur attribue les mêmes rôles', () => {
    // ADR-0044 n'ajoute aucun rôle ; le dixième, `hr_manager`, vient d'ADR-0045.
    // ADR-0046 ajoute le onzième, `storekeeper` ; ADR-0049 le douzième, `external_accountant`.
    expect(
      ORG_ROLES.filter(
        (r) =>
          r !== 'hr_manager' &&
          r !== 'storekeeper' &&
          r !== 'external_accountant' &&
          // ADR-0059 § 2.
          r !== 'employee' &&
          r !== 'team_manager' &&
          r !== 'intern' &&
          r !== 'guest',
      ),
    ).toHaveLength(9);
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
    expect(canGrantRole('admin', 'accountant')).toBe(false);
    expect(canGrantRole('admin', 'finance_director')).toBe(false);
  });
});

describe('ADR-0044 § 2.3 — `purchaseApprovalDecision` (séparation des tâches des achats)', () => {
  const base: PurchaseApprovalInput = {
    decision: 'approve',
    approverUserId: 'dir',
    requestedBy: 'ana',
    createdBy: 'ana',
    priorApproverUserIds: [],
    requiredApprovals: 1,
    approverCountInOrg: 2,
    allowSoleApprover: true,
  };
  const decide = (over: Partial<PurchaseApprovalInput>) =>
    purchaseApprovalDecision({ ...base, ...over });

  it('approbateur distinct du demandeur : approuvé, palier 1 atteint', () => {
    expect(decide({})).toEqual({
      ok: true,
      soleApprover: false,
      effectiveRequired: 1,
      complete: true,
    });
  });

  it('critère 2 — le demandeur n’approuve pas sa demande quand d’autres approbateurs existent', () => {
    expect(decide({ approverUserId: 'ana' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    // Ni le créateur quand il diffère du demandeur.
    expect(decide({ approverUserId: 'pro', createdBy: 'pro' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    // Le refus suit la même règle d’éligibilité.
    expect(decide({ decision: 'reject', approverUserId: 'ana' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('critère 2 — palier 2 : deux personnes distinctes ; la même n’approuve pas deux fois', () => {
    const premiere = decide({ requiredApprovals: 2 });
    expect(premiere).toEqual({
      ok: true,
      soleApprover: false,
      effectiveRequired: 2,
      complete: false,
    });
    expect(decide({ requiredApprovals: 2, priorApproverUserIds: ['dir'] })).toEqual({
      ok: false,
      code: 'APPROVER_ALREADY_APPROVED',
    });
    expect(
      decide({ requiredApprovals: 2, approverUserId: 'pro', priorApproverUserIds: ['dir'] }),
    ).toEqual({ ok: true, soleApprover: false, effectiveRequired: 2, complete: true });
  });

  it('critère 2 — approbateur unique : il approuve sa demande, marquée, palier réduit à 1', () => {
    expect(
      decide({
        approverUserId: 'pro',
        requestedBy: 'pro',
        createdBy: 'pro',
        approverCountInOrg: 1,
        requiredApprovals: 2,
      }),
    ).toEqual({ ok: true, soleApprover: true, effectiveRequired: 1, complete: true });
    // Demande d’autrui, palier 1 : rien d’exceptionnel, pas de marque.
    expect(decide({ approverCountInOrg: 1 })).toEqual({
      ok: true,
      soleApprover: false,
      effectiveRequired: 1,
      complete: true,
    });
    // Demande d’autrui, palier 2 réduit : l’échappatoire sert, le geste est marqué.
    expect(decide({ approverCountInOrg: 1, requiredApprovals: 2 })).toEqual({
      ok: true,
      soleApprover: true,
      effectiveRequired: 1,
      complete: true,
    });
  });

  it('`allowSoleApprover: false` ferme l’échappatoire, même seul', () => {
    expect(
      decide({ approverUserId: 'ana', approverCountInOrg: 1, allowSoleApprover: false }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
    expect(
      decide({ approverCountInOrg: 1, allowSoleApprover: false, requiredApprovals: 2 }),
    ).toMatchObject({ ok: true, effectiveRequired: 2, complete: false, soleApprover: false });
  });

  it('un refus recevable ne complète jamais la demande', () => {
    expect(
      decide({ decision: 'reject', requiredApprovals: 2, priorApproverUserIds: ['pro'] }),
    ).toEqual({ ok: true, soleApprover: false, effectiveRequired: 2, complete: false });
    expect(
      decide({ decision: 'reject', approverUserId: 'ana', approverCountInOrg: 1 }),
    ).toMatchObject({ ok: true, soleApprover: true, complete: false });
  });

  it('ne lit aucun rôle : seul le nombre de détenteurs effectifs décide de l’échappatoire', () => {
    // Deux détenteurs effectifs (par exemple un Lecteur ayant reçu l’autorisation) :
    // le Propriétaire seul de son titre ne s’auto-approuve plus.
    expect(
      decide({
        approverUserId: 'pro',
        requestedBy: 'pro',
        createdBy: 'pro',
        approverCountInOrg: 2,
      }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
  });
});

describe('ADR-0045 § 4 — ressources humaines et rôle Responsable RH (lot H0)', () => {
  const RH = [
    'hr.read',
    'hr.manage',
    'hr.sensitive.read',
    'leave.request',
    'leave.approve',
  ] as const;
  const detenteurs = (action: Action): OrgRole[] =>
    ORG_ROLES.filter((r) => can(r, action, NO_OVERRIDES));

  it('registre : Propriétaire, Administrateur, Directeur financier, Responsable RH', () => {
    for (const action of ['hr.read', 'hr.manage'] as const) {
      expect(detenteurs(action), action).toEqual([
        'owner',
        'admin',
        'finance_director',
        'hr_manager',
      ]);
    }
  });

  it('données sensibles : ni Administrateur ni Comptable (décision ouverte n° 3)', () => {
    expect(detenteurs('hr.sensitive.read')).toEqual(['owner', 'finance_director', 'hr_manager']);
  });

  it('demander une absence : tout rôle interne, ni Conseiller ni Chef de projet', () => {
    expect(detenteurs('leave.request')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'viewer',
      'sales_rep',
      'hr_manager',
      // ADR-0046 § 8.2 : le Magasinier demande ses absences, comme tout membre interne.
      'storekeeper',
      // ADR-0059 § 2 : Salarié, Manager et Stagiaire aussi ; pas l'Invité externe.
      'employee',
      'team_manager',
      'intern',
    ]);
  });

  it('valider : autorité RH en case ⓢ ; l’Administrateur ne valide pas', () => {
    expect(detenteurs('leave.approve')).toEqual(['owner', 'finance_director', 'hr_manager']);
    for (const role of ORG_ROLES) {
      expect(['deny', 'allow_sod']).toContain(ORG_PERMISSION_MATRIX[role]['leave.approve']);
    }
    expect(APPROVAL_ACTIONS).toContain('leave.approve');
    // `APPROVER_ROLES` reste celui des plans.
    expect(APPROVER_ROLES).toEqual(['owner', 'finance_director']);
  });

  it('le Responsable RH détient onze actions sur quarante-six, et seulement celles-là', () => {
    expect(ACTIONS.filter((a) => can('hr_manager', a, { canClosePeriods: true }))).toEqual([
      'analytics.read',
      'work.read',
      'work.update',
      'hr.read',
      'hr.manage',
      'hr.sensitive.read',
      'leave.request',
      'leave.approve',
      // ADR-0046 § 8.1 : le matériel remis et repris (sans coûts), la bibliothèque
      // (règlement intérieur, politiques).
      'assets.read',
      'docs.read',
      'docs.manage',
      // ADR-0051 § 5.1 : ses frais, son pointage ; objectifs et évaluations de tous. Il ne
      // valide pas une dépense (`expenses.approve`, décision ouverte n° 2).
      'expenses.claim',
      'attendance.clock',
      'performance.read',
    ]);
    // Disjoint de la finance et de la gouvernance (O6).
    for (const action of [
      'organization.manage',
      'members.invite',
      'treasury.read',
      'sales.read',
      'purchase.read',
      'crm.read',
      'project.read',
      'report.export',
      'audit.read',
    ] as const) {
      expect(can('hr_manager', action, NO_OVERRIDES), action).toBe(false);
    }
  });

  it('rang 6, après le Commercial ; libellé et description du § 4.2', () => {
    expect(ORG_ROLE_RANK.sales_rep).toBe(5);
    expect(ORG_ROLE_RANK.hr_manager).toBe(6);
    // ADR-0046 § 8.2 : le Magasinier s'insère au rang 7 ; ADR-0049 § 8.2 : l'Expert-comptable
    // au rang 8 (11 depuis ADR-0059 § 3, qui insère trois rôles aux rangs 8 à 10).
    expect(ORG_ROLE_RANK.project_manager).toBe(12);
    expect(ORG_ROLE_LABELS.hr_manager).toBe('Responsable RH');
    expect(ORG_ROLE_DESCRIPTIONS.hr_manager).toBe(
      'Dossiers du personnel, absences et documents RH. Ne voit ni la trésorerie, ni les ventes, ni les achats.',
    );
    expect(normalizeOrgRole('hr_manager')).toBe('hr_manager');
    expect(isOwnerRole('hr_manager')).toBe(false);
  });

  it('R7 — attribuable par le seul Propriétaire (critère 2, décision ouverte n° 2)', () => {
    expect(isAssignableRole('hr_manager')).toBe(true);
    // ADR-0049 § 8.2 : l'Expert-comptable (externe) aussi.
    expect(OWNER_ONLY_ROLES).toEqual(['hr_manager', 'external_accountant']);
    for (const role of ORG_ROLES) {
      expect(canGrantRole(role, 'hr_manager'), `${role} → hr_manager`).toBe(role === 'owner');
    }
    // Même un acteur qui réunirait les huit actions par ajouts ne l'attribue pas.
    const toutAjoute: OrgPermissionContext = {
      grants: ACTIONS.filter(
        (a) => ORG_PERMISSION_MATRIX.admin[a] === 'deny' && a !== 'billing.manage',
      ),
    };
    expect(grantableRoles('admin', toutAjoute)).not.toContain('hr_manager');
    expect(grantableRoles('admin', toutAjoute)).toContain('finance_director');
    // L'Administrateur attribue les mêmes rôles qu'avant.
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      // ADR-0046 § 8.2 : l'Administrateur détient les neuf actions du Magasinier.
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
    expect(grantableRoles('owner')).toContain('hr_manager');
  });

  it('plateforme : registre délégué au seul super-administrateur ; sensibles interdites absolument', () => {
    expect(canPlatform('platform_super_admin', 'hr.read', { hasActiveGrant: true })).toBe(true);
    expect(canPlatform('platform_super_admin', 'hr.manage', { hasActiveGrant: true })).toBe(true);
    expect(canPlatform('platform_super_admin', 'hr.read')).toBe(false);
    expect(canPlatform('platform_support', 'hr.read', { hasActiveGrant: true })).toBe(false);
    for (const role of PLATFORM_ROLES) {
      for (const action of ['hr.sensitive.read', 'leave.request', 'leave.approve'] as const) {
        expect(canPlatform(role, action, { hasActiveGrant: true }), `${role} × ${action}`).toBe(
          false,
        );
      }
    }
    expect(PLATFORM_FORBIDDEN_ACTIONS).toContain('hr.sensitive.read');
    for (const action of RH.filter((a) => a !== 'hr.sensitive.read')) {
      expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain(action);
    }
  });
});

describe('ADR-0045 § 4.3 — `leaveApprovalDecision` (séparation des tâches des absences)', () => {
  // A manager de B ; RH détient `leave.approve` ; C n'est ni l'un ni l'autre.
  const base: LeaveApprovalInput = {
    decision: 'approve',
    approverUserId: 'A',
    beneficiaryUserId: 'B',
    step: 'manager',
    isDesignatedManager: true,
    holdsLeaveApprove: false,
    priorApproverUserIds: [],
    approverCountInOrg: 2,
    allowSoleApprover: true,
  };
  const decide = (over: Partial<LeaveApprovalInput>) => leaveApprovalDecision({ ...base, ...over });

  it('critère 9 — le manager désigné valide l’étape manager', () => {
    expect(decide({})).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
  });

  it('critère 9 — B ne valide pas sa propre demande, à aucune étape', () => {
    for (const step of ['manager', 'hr'] as const) {
      expect(
        decide({ approverUserId: 'B', step, isDesignatedManager: false, holdsLeaveApprove: true }),
      ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
    }
    expect(decide({ decision: 'reject', approverUserId: 'B' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('critère 9 — C, ni manager ni détenteur : 403 LEAVE_NOT_YOUR_STEP', () => {
    for (const step of ['manager', 'hr'] as const) {
      expect(decide({ approverUserId: 'C', step, isDesignatedManager: false })).toEqual({
        ok: false,
        code: 'LEAVE_NOT_YOUR_STEP',
      });
    }
    // Le manager désigné ne tient pas l'étape RH sans `leave.approve`.
    expect(decide({ step: 'hr' })).toEqual({ ok: false, code: 'LEAVE_NOT_YOUR_STEP' });
  });

  it('ADR-0066 § 1 — le responsable d’équipe tient l’étape manager, jamais l’étape RH ni la sienne', () => {
    const lead = { approverUserId: 'L', isDesignatedManager: false, isTeamLead: true };
    expect(decide(lead)).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
    expect(decide({ ...lead, step: 'hr' })).toEqual({ ok: false, code: 'LEAVE_NOT_YOUR_STEP' });
    expect(decide({ ...lead, beneficiaryUserId: 'L' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(decide({ ...lead, isTeamLead: false })).toEqual({
      ok: false,
      code: 'LEAVE_NOT_YOUR_STEP',
    });
  });

  it('suppléance : un détenteur de `leave.approve` tient l’étape manager, marquée', () => {
    expect(
      decide({ approverUserId: 'RH', isDesignatedManager: false, holdsLeaveApprove: true }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: true });
  });

  it('critère 9 — deux étapes, deux personnes', () => {
    // A, manager ET détenteur, a validé l'étape manager : il ne tient pas l'étape RH.
    expect(decide({ step: 'hr', holdsLeaveApprove: true, priorApproverUserIds: ['A'] })).toEqual({
      ok: false,
      code: 'APPROVER_ALREADY_APPROVED',
    });
    expect(
      decide({
        approverUserId: 'RH',
        step: 'hr',
        isDesignatedManager: false,
        holdsLeaveApprove: true,
        priorApproverUserIds: ['A'],
      }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
    // Un refus clôt la demande à toute étape, même par qui a validé l'étape précédente.
    expect(
      decide({
        decision: 'reject',
        step: 'hr',
        holdsLeaveApprove: true,
        priorApproverUserIds: ['A'],
      }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
  });

  it('critère 9 — approbateur unique : la Propriétaire valide sa propre absence, marquée', () => {
    const seule = {
      approverUserId: 'PRO',
      beneficiaryUserId: 'PRO',
      step: 'hr' as const,
      isDesignatedManager: false,
      holdsLeaveApprove: true,
      approverCountInOrg: 1,
    };
    expect(decide(seule)).toEqual({ ok: true, soleApprover: true, onBehalfOfManager: false });
    // Et l'étape RH qu'elle a déjà tenue comme manager d'autrui.
    expect(decide({ ...seule, beneficiaryUserId: 'B', priorApproverUserIds: ['PRO'] })).toEqual({
      ok: true,
      soleApprover: true,
      onBehalfOfManager: false,
    });
    // Une décision ordinaire n'est pas marquée.
    expect(decide({ ...seule, beneficiaryUserId: 'B' })).toEqual({
      ok: true,
      soleApprover: false,
      onBehalfOfManager: false,
    });
  });

  it('l’échappatoire exige le réglage, un seul détenteur, et que ce soit lui', () => {
    const soi = {
      approverUserId: 'PRO',
      beneficiaryUserId: 'PRO',
      step: 'hr' as const,
      isDesignatedManager: false,
      holdsLeaveApprove: true,
    };
    expect(decide({ ...soi, approverCountInOrg: 1, allowSoleApprover: false })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(decide({ ...soi, approverCountInOrg: 2 })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(decide({ ...soi, approverCountInOrg: 1, holdsLeaveApprove: false })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('un collaborateur sans compte n’est le « soi » de personne', () => {
    expect(
      decide({
        approverUserId: 'RH',
        beneficiaryUserId: null,
        step: 'hr',
        isDesignatedManager: false,
        holdsLeaveApprove: true,
      }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
  });
});

describe('ADR-0046 § 8 — stocks, équipements, documents et rôle Magasinier (lot S0)', () => {
  const detenteurs = (action: Action): OrgRole[] =>
    ORG_ROLES.filter((r) => can(r, action, NO_OVERRIDES));

  it('détenteurs de chaque action, ligne du § 8.1', () => {
    expect(detenteurs('stock.read')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'viewer',
      'sales_rep',
      'storekeeper',
    ]);
    expect(detenteurs('stock.move')).toEqual(['owner', 'admin', 'finance_director', 'storekeeper']);
    expect(detenteurs('stock.count')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'storekeeper',
    ]);
    expect(detenteurs('stock.manage')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
    ]);
    expect(detenteurs('assets.manage')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
    ]);
    expect(detenteurs('docs.manage')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'hr_manager',
    ]);
    // Le Commercial lit les quantités, pas le registre ; le Responsable RH l'inverse.
    expect(can('sales_rep', 'assets.read', NO_OVERRIDES)).toBe(false);
    expect(can('hr_manager', 'stock.read', NO_OVERRIDES)).toBe(false);
    // Le Conseiller (externe) et le Chef de projet n'ont rien (décision ouverte n° 17).
    for (const role of ['advisor', 'project_manager'] as const) {
      for (const action of ACTIONS.slice(38, 46)) {
        expect(can(role, action, NO_OVERRIDES), `${role} × ${action}`).toBe(false);
      }
    }
  });

  it('`stock.manage` : cases ⓢ, dans `APPROVAL_ACTIONS` ; aucune paire nouvelle', () => {
    for (const role of ORG_ROLES) {
      expect(['deny', 'allow_sod']).toContain(ORG_PERMISSION_MATRIX[role]['stock.manage']);
    }
    expect(APPROVAL_ACTIONS).toContain('stock.manage');
    expect(APPROVER_ROLES).toEqual(['owner', 'finance_director']);
  });

  it('le Magasinier détient neuf actions sur quarante-six, et seulement celles-là', () => {
    expect(ACTIONS.filter((a) => can('storekeeper', a, { canClosePeriods: true }))).toEqual([
      'analytics.read',
      'work.read',
      'work.update',
      'leave.request',
      'stock.read',
      'stock.move',
      'stock.count',
      'assets.read',
      'docs.read',
      // ADR-0051 § 5.1 : ses frais et son pointage, comme `leave.request`.
      'expenses.claim',
      'attendance.clock',
    ]);
    // Ni valeurs, ni validation d'écart, ni achats, ni trésorerie, ni ventes (O6).
    for (const action of [
      'stock.manage',
      'purchase.read',
      'purchase.manage',
      'treasury.read',
      'sales.read',
      'assets.manage',
      'docs.manage',
      'members.invite',
    ] as const) {
      expect(can('storekeeper', action, NO_OVERRIDES), action).toBe(false);
    }
    expect(canSeeStockValues('storekeeper', NO_OVERRIDES)).toBe(false);
  });

  it('rang 7, après le Responsable RH ; libellé et description du § 8.2', () => {
    expect(ORG_ROLE_RANK.hr_manager).toBe(6);
    expect(ORG_ROLE_RANK.storekeeper).toBe(7);
    // ADR-0049 § 8.2 : l'Expert-comptable s'insère au rang 8.
    // ADR-0059 § 3 : Manager, Salarié et Stagiaire aux rangs 8 à 10 ; les suivants glissent
    // de trois crans.
    expect(ORG_ROLE_RANK.project_manager).toBe(12);
    expect(ORG_ROLE_RANK.advisor).toBe(13);
    expect(ORG_ROLE_RANK.viewer).toBe(14);
    expect(ORG_ROLE_LABELS.storekeeper).toBe('Magasinier');
    expect(ORG_ROLE_DESCRIPTIONS.storekeeper).toBe(
      'Réceptionne, range, sort et compte le stock ; consulte le matériel et les documents. Ne voit ni les prix d’achat, ni la valeur du stock, ni la trésorerie, ni les ventes.',
    );
    expect(normalizeOrgRole('storekeeper')).toBe('storekeeper');
    expect(isOwnerRole('storekeeper')).toBe(false);
  });

  it('R7 — attribuable par Propriétaire, Administrateur et Directeur financier ; pas réservé au Propriétaire', () => {
    expect(isAssignableRole('storekeeper')).toBe(true);
    expect(OWNER_ONLY_ROLES).not.toContain('storekeeper');
    // R7 seul : le Magasinier « s'attribue » son propre titre (inclusion), mais n'a pas
    // `members.invite` — le guard le refuse avant R7, comme pour le Lecteur.
    expect(ORG_ROLES.filter((r) => canGrantRole(r, 'storekeeper'))).toEqual([
      'owner',
      'admin',
      'finance_director',
      'storekeeper',
    ]);
    expect(
      ORG_ROLES.filter(
        (r) => canGrantRole(r, 'storekeeper') && can(r, 'members.invite', NO_OVERRIDES),
      ),
    ).toEqual(['owner', 'admin']);
    // Le Magasinier n'attribue que des rôles inclus dans les siens : aucun qui écrive.
    // ADR-0059 § 2 : Salarié, Stagiaire et Invité externe sont des sous-ensembles stricts de
    // sa ligne ; sans `members.invite`, il ne les attribue pas pour autant.
    expect(grantableRoles('storekeeper')).toEqual(['storekeeper', 'employee', 'intern', 'guest']);
  });

  it('dépendances satisfaites par chaque ligne de la matrice', () => {
    for (const role of ORG_ROLES) {
      if (can(role, 'stock.move', NO_OVERRIDES) || can(role, 'stock.count', NO_OVERRIDES)) {
        expect(can(role, 'stock.read', NO_OVERRIDES), role).toBe(true);
      }
      if (can(role, 'stock.manage', NO_OVERRIDES)) {
        expect(can(role, 'stock.read', NO_OVERRIDES), role).toBe(true);
      }
      if (can(role, 'assets.manage', NO_OVERRIDES)) {
        expect(can(role, 'assets.read', NO_OVERRIDES), role).toBe(true);
      }
      if (can(role, 'docs.manage', NO_OVERRIDES)) {
        expect(can(role, 'docs.read', NO_OVERRIDES), role).toBe(true);
      }
    }
  });

  it('plateforme : lectures déléguées (SA, support), gestes au seul SA ; aucun interdit absolu nouveau', () => {
    for (const action of ACTIONS.slice(38, 46)) {
      expect(canPlatform('platform_super_admin', action, { hasActiveGrant: true }), action).toBe(
        true,
      );
      expect(canPlatform('platform_super_admin', action), action).toBe(false);
      expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain(action);
    }
    for (const action of ['stock.read', 'assets.read', 'docs.read'] as const) {
      expect(canPlatform('platform_support', action, { hasActiveGrant: true }), action).toBe(true);
    }
    for (const action of [
      'stock.move',
      'stock.count',
      'stock.manage',
      'assets.manage',
      'docs.manage',
    ] as const) {
      expect(canPlatform('platform_support', action, { hasActiveGrant: true }), action).toBe(false);
    }
  });

  it('§ 5 — valeurs visibles avec `purchase.read` ou `treasury.read`, en droits effectifs', () => {
    expect([...VALUE_READ_ACTIONS]).toEqual(['purchase.read', 'treasury.read']);
    const voient = ORG_ROLES.filter((r) => canSeeStockValues(r, NO_OVERRIDES));
    expect(voient).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'viewer',
    ]);
    // Le Commercial lit les quantités sans les valeurs (critère 1).
    expect(can('sales_rep', 'stock.read', NO_OVERRIDES)).toBe(true);
    expect(canSeeStockValues('sales_rep', NO_OVERRIDES)).toBe(false);
    // Le Responsable RH lit le registre sans les coûts (critère 1).
    expect(canSeeStockValues('hr_manager', NO_OVERRIDES)).toBe(false);
    // Un ajout ou un retrait change la réponse : la règle lit les droits EFFECTIFS.
    expect(canSeeStockValues('storekeeper', { grants: ['purchase.read'] })).toBe(true);
    expect(canSeeStockValues('viewer', { revokes: ['purchase.read', 'treasury.read'] })).toBe(
      false,
    );
  });
});

describe('ADR-0046 § 2.7 — `stockCountDecision` (validation d’inventaire)', () => {
  const base: StockCountValidationInput = {
    validatorUserId: 'V',
    counterUserIds: ['M'],
    approverCountInOrg: 2,
  };
  const decide = (over: Partial<StockCountValidationInput>) =>
    stockCountDecision({ ...base, ...over });

  it('critère 2 — qui n’a rien compté valide', () => {
    expect(decide({})).toEqual({ ok: true, soleApprover: false });
    expect(decide({ counterUserIds: [] })).toEqual({ ok: true, soleApprover: false });
  });

  it('critère 2 — qui a compté une ligne ne valide pas : 409 COUNT_SELF_VALIDATION', () => {
    expect(decide({ counterUserIds: ['M', 'V'] })).toEqual({
      ok: false,
      code: 'COUNT_SELF_VALIDATION',
    });
    expect(decide({ counterUserIds: ['V'], approverCountInOrg: 5 })).toEqual({
      ok: false,
      code: 'COUNT_SELF_VALIDATION',
    });
  });

  it('critère 2 — approbateur unique : il valide son propre comptage, marqué', () => {
    expect(decide({ counterUserIds: ['V'], approverCountInOrg: 1 })).toEqual({
      ok: true,
      soleApprover: true,
    });
    // Seul détenteur, mais n'a pas compté : décision ordinaire, non marquée.
    expect(decide({ approverCountInOrg: 1 })).toEqual({ ok: true, soleApprover: false });
  });
});

describe('ADR-0046 § 4.1, § 4.2 — `folderAccessDecision` et `documentReadDecision`', () => {
  const ouvert: FolderAccessRules = { read: 'all', write: 'managers', inherit: true };
  const fiscal: FolderAccessRules = {
    read: { action: 'treasury.read' },
    write: 'managers',
    inherit: true,
  };
  const restreint: FolderAccessRules = {
    read: { userIds: ['A', 'B'] },
    write: { userIds: ['A'] },
    inherit: true,
  };
  const acteur = (role: OrgRole, userId = 'X') => ({
    userId,
    actions: effectiveActions(role, NO_OVERRIDES),
    isOwner: isOwnerRole(role),
  });
  const decide = (chain: FolderAccessRules[], who: ReturnType<typeof acteur>) =>
    folderAccessDecision({ chain, ...who });

  it('dossier ouvert : lu par tout détenteur de `docs.read`, écrit par `docs.manage`', () => {
    expect(decide([ouvert], acteur('storekeeper'))).toEqual({ read: true, write: false });
    expect(decide([ouvert], acteur('hr_manager'))).toEqual({ read: true, write: true });
    expect(decide([ouvert], acteur('advisor'))).toEqual({ read: false, write: false });
  });

  it('critère 15 — « Fiscal » (`treasury.read`) est invisible d’un Magasinier', () => {
    expect(decide([fiscal], acteur('storekeeper'))).toEqual({ read: false, write: false });
    expect(decide([fiscal], acteur('viewer'))).toEqual({ read: true, write: false });
    expect(decide([fiscal], acteur('accountant'))).toEqual({ read: true, write: true });
    // `docs.manage` sans `treasury.read` n'ouvre pas un dossier réservé par nature.
    expect(decide([fiscal], acteur('hr_manager'))).toEqual({ read: false, write: false });
  });

  it('critère 15 — un dossier restreint à deux personnes est invisible de l’Administrateur', () => {
    expect(decide([restreint], acteur('admin'))).toEqual({ read: false, write: false });
    expect(decide([restreint], acteur('viewer', 'A'))).toEqual({ read: true, write: true });
    expect(decide([restreint], acteur('viewer', 'B'))).toEqual({ read: true, write: false });
    // Visible du Propriétaire (titre), et `docs.manage` lui ouvre l'écriture.
    expect(decide([restreint], acteur('owner'))).toEqual({ read: true, write: true });
  });

  it('un sous-dossier n’élargit jamais la lecture de son parent, même sans héritage', () => {
    const sousOuvert: FolderAccessRules = { read: 'all', write: 'managers', inherit: false };
    expect(decide([fiscal, sousOuvert], acteur('storekeeper')).read).toBe(false);
    expect(decide([restreint, sousOuvert], acteur('admin')).read).toBe(false);
    expect(decide([ouvert, restreint], acteur('admin')).read).toBe(false);
  });

  it('écriture : héritée (le parent restreint aussi), ou propre au dossier sans héritage', () => {
    const sousEcritB: FolderAccessRules = { read: 'all', write: { userIds: ['B'] }, inherit: true };
    // Héritage : B n'écrit pas au parent (géré par `managers`), il n'écrit donc pas ici.
    expect(decide([ouvert, sousEcritB], acteur('viewer', 'B')).write).toBe(false);
    // Sans héritage : la règle d'écriture du dossier seule.
    expect(decide([ouvert, { ...sousEcritB, inherit: false }], acteur('viewer', 'B')).write).toBe(
      true,
    );
    // Les gestionnaires écrivent partout où ils lisent.
    expect(decide([ouvert, sousEcritB], acteur('admin')).write).toBe(true);
  });

  it('sans `docs.read` (retrait), rien ; chaîne vide : rien n’est accordé par un dossier', () => {
    const sansLecture = {
      userId: 'A',
      actions: effectiveActions('owner', { revokes: ['docs.read', 'docs.manage'] }),
      isOwner: true,
    };
    expect(decide([ouvert], sansLecture)).toEqual({ read: false, write: false });
    expect(decide([], acteur('owner'))).toEqual({ read: false, write: false });
  });

  it('critère 15 — un document lié à un fournisseur n’est pas lu sans `purchase.read`', () => {
    const lecture = (role: OrgRole, liens: DocumentLinkEntityType[], dossier: boolean | null) =>
      documentReadDecision({
        folder: dossier === null ? null : { read: dossier, write: false },
        linkEntityTypes: liens,
        actions: effectiveActions(role, NO_OVERRIDES),
      });
    expect(lecture('sales_rep', ['supplier'], true)).toBe(false);
    expect(lecture('viewer', ['supplier'], true)).toBe(true);
    // L'intersection : chaque lien compte.
    expect(lecture('viewer', ['supplier', 'stock_item'], true)).toBe(true);
    expect(lecture('hr_manager', ['asset', 'stock_item'], true)).toBe(false);
    // Dossier illisible : rien, même avec les liens.
    expect(lecture('owner', ['supplier'], false)).toBe(false);
    // Sans dossier : lu par ses liens seulement, et jamais sans lien.
    expect(lecture('viewer', ['customer'], null)).toBe(true);
    expect(lecture('owner', [], null)).toBe(false);
  });

  it('chaque nature de lien du contrat partagé a sa permission de lecture', () => {
    expect(Object.keys(DOCUMENT_LINK_READ_ACTION).sort()).toEqual(
      [...DOCUMENT_LINK_ENTITY_TYPES].sort(),
    );
    expect(Object.keys(DOCUMENT_LINK_READ_ACTION)).not.toContain('employee');
    for (const action of Object.values(DOCUMENT_LINK_READ_ACTION)) {
      expect(ACTIONS).toContain(action);
      expect(action.endsWith('.read')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Identité du rôle propriétaire
//
// Ces six cas viennent de `account/owner-role.test.ts` (S20b). Le fichier
// `account/owner-role.ts` qu'ils couvraient isolait provisoirement le slug
// propriétaire en attendant cette matrice; il a été supprimé et son unique
// consommateur (`account.service.ts`, règle « dernier propriétaire ») importe
// désormais `isOwnerRole` d'ici. Le contrat qu'ils fixent est inchangé.
// ─────────────────────────────────────────────────────────────────────────────

describe('R1 — identité du rôle propriétaire (repris de S20b)', () => {
  it('reconnaît le slug propriétaire', () => {
    expect(isOwnerRole(OWNER_ROLE)).toBe(true);
    expect(isOwnerRole('owner')).toBe(true);
  });

  it('ne reconnaît AUCUN des sept autres rôles d’organisation d’ADR-0012', () => {
    // Si l'un d'eux passait pour propriétaire, un compte pourrait être supprimé
    // en laissant une organisation sans personne pour la gouverner.
    for (const role of [
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'project_manager',
      'advisor',
      'viewer',
      'sales_rep',
    ]) {
      expect(isOwnerRole(role)).toBe(false);
    }
    // Redondant aujourd'hui, protecteur demain : un neuvième rôle ajouté à
    // `ORG_ROLES` sans être ajouté à la liste ci-dessus est quand même vérifié.
    for (const role of ORG_ROLES.filter((r) => r !== OWNER_ROLE)) {
      expect(isOwnerRole(role), role).toBe(false);
    }
  });

  it('ne confond pas les rôles PLATEFORME avec le rôle propriétaire d’organisation', () => {
    // Les deux espaces de noms cohabitent (ADR-0012 §2) ; le préfixe est ce qui
    // les sépare, et il doit suffire.
    for (const role of PLATFORM_ROLES) expect(isOwnerRole(role), role).toBe(false);
  });

  it('reste vrai malgré une casse ou des espaces inattendus venus de la base', () => {
    // La valeur vient d'un document Mongo, pas d'un type TypeScript : mieux vaut
    // refuser une suppression de trop que d'en autoriser une de trop.
    for (const role of ['Owner', 'OWNER', ' owner ', 'owner\n']) {
      expect(isOwnerRole(role), JSON.stringify(role)).toBe(true);
    }
  });

  it('traite comme non-propriétaire toute valeur absente ou non textuelle', () => {
    for (const value of [null, undefined, '', '   ', 0, 1, {}, [], true]) {
      expect(isOwnerRole(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('n’accepte pas un rôle qui CONTIENT « owner » sans en être un', () => {
    for (const role of ['co_owner', 'owner_delegate', 'not-owner']) {
      expect(isOwnerRole(role), role).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0049 — K0 : comptabilité et rôle Expert-comptable (externe)
// ─────────────────────────────────────────────────────────────────────────────

const COMPTABILITE: readonly Action[] = [
  'accounting.read',
  'accounting.post',
  'accounting.close',
  'accounting.export',
  'accounting.manage',
];

describe('ADR-0049 § 8 — comptabilité et rôle Expert-comptable (lot K0)', () => {
  const detenteurs = (action: Action): OrgRole[] =>
    ORG_ROLES.filter((r) => can(r, action, NO_OVERRIDES));

  it('détenteurs de chaque action, ligne du § 8.1', () => {
    expect(detenteurs('accounting.read')).toEqual([
      'owner',
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'viewer',
      'external_accountant',
    ]);
    for (const action of ['accounting.post', 'accounting.close', 'accounting.manage'] as const) {
      expect(detenteurs(action), action).toEqual(['owner', 'finance_director', 'accountant']);
    }
    expect(detenteurs('accounting.export')).toEqual([
      'owner',
      'finance_director',
      'accountant',
      'external_accountant',
    ]);
  });

  it('la lecture n’ouvre rien de plus : chaque lecteur interne lit déjà trésorerie et achats', () => {
    for (const role of detenteurs('accounting.read')) {
      if (role === 'external_accountant') continue;
      for (const lu of ['sales.read', 'treasury.read', 'purchase.read'] as const) {
        expect(can(role, lu, NO_OVERRIDES), `${role} × ${lu}`).toBe(true);
      }
    }
  });

  it('critère 1 — Commercial, Responsable RH, Magasinier, Conseiller, Chef de projet : rien', () => {
    for (const role of [
      'sales_rep',
      'hr_manager',
      'storekeeper',
      'advisor',
      'project_manager',
    ] as const) {
      for (const action of COMPTABILITE) {
        expect(can(role, action, { canClosePeriods: true }), `${role} × ${action}`).toBe(false);
      }
    }
  });

  it('critère 1 — l’Administrateur lit, n’écrit, ne clôt, n’exporte ni ne paramètre', () => {
    expect(can('admin', 'accounting.read', NO_OVERRIDES)).toBe(true);
    for (const action of COMPTABILITE.slice(1)) {
      expect(can('admin', action, NO_OVERRIDES), action).toBe(false);
    }
  });

  it('écrire et paramétrer : cases ⓢ, dans `APPROVAL_ACTIONS` ; clôturer sans ⚙ ; aucune paire nouvelle', () => {
    for (const role of ORG_ROLES) {
      expect(['deny', 'allow_sod']).toContain(ORG_PERMISSION_MATRIX[role]['accounting.post']);
      expect(['deny', 'allow_sod']).toContain(ORG_PERMISSION_MATRIX[role]['accounting.manage']);
      expect(['deny', 'allow']).toContain(ORG_PERMISSION_MATRIX[role]['accounting.close']);
    }
    expect(APPROVAL_ACTIONS).toContain('accounting.post');
    expect(APPROVAL_ACTIONS).toContain('accounting.manage');
    expect(APPROVAL_ACTIONS).not.toContain('accounting.close');
    expect(APPROVER_ROLES).toEqual(['owner', 'finance_director']);
  });

  it('l’Expert-comptable détient trois actions sur cinquante et une, et seulement celles-là', () => {
    expect(ACTIONS.filter((a) => can('external_accountant', a, { canClosePeriods: true }))).toEqual(
      ['analytics.read', 'accounting.read', 'accounting.export'],
    );
    // Critère 1 : ni ventes, ni trésorerie, ni achats ; il voit la copie d'affichage de la
    // pièce portée par l'écriture (décision ouverte n° 3).
    for (const action of [
      'sales.read',
      'treasury.read',
      'purchase.read',
      'accounting.post',
      'accounting.close',
      'accounting.manage',
      'report.export',
      'project.read',
      'work.read',
      'leave.request',
      'docs.read',
    ] as const) {
      expect(can('external_accountant', action, NO_OVERRIDES), action).toBe(false);
    }
  });

  it('comme le Conseiller, externe : il n’a ni projets, ni tâches, ni absences', () => {
    for (const action of ACTIONS) {
      if (action === 'analytics.read' || action.startsWith('accounting.')) continue;
      expect(ORG_PERMISSION_MATRIX.external_accountant[action], action).toBe('deny');
      // Ce que le Conseiller n'a pas, l'Expert-comptable ne l'a pas non plus.
      if (ORG_PERMISSION_MATRIX.advisor[action] === 'deny') {
        expect(can('external_accountant', action, NO_OVERRIDES), action).toBe(false);
      }
    }
  });

  it('rang 8, après le Magasinier ; libellé et description du § 8.2', () => {
    expect(ORG_ROLE_RANK.storekeeper).toBe(7);
    // ADR-0059 § 3 : glissé au rang 11.
    expect(ORG_ROLE_RANK.external_accountant).toBe(11);
    // ADR-0059 § 3 : Manager, Salarié et Stagiaire aux rangs 8 à 10 ; les suivants glissent
    // de trois crans.
    expect(ORG_ROLE_RANK.project_manager).toBe(12);
    expect(ORG_ROLE_RANK.advisor).toBe(13);
    expect(ORG_ROLE_RANK.viewer).toBe(14);
    expect(ORG_ROLE_LABELS.external_accountant).toBe('Expert-comptable (externe)');
    expect(ORG_ROLE_DESCRIPTIONS.external_accountant).toBe(
      "Consulte et exporte la comptabilité de l'organisation pour la réviser. N'écrit rien : ni écriture, ni vente, ni paiement. Externe à l'organisation.",
    );
    expect(normalizeOrgRole('external_accountant')).toBe('external_accountant');
    expect(isOwnerRole('external_accountant')).toBe(false);
  });

  it('critère 1, R7 — attribuable par le seul Propriétaire', () => {
    expect(isAssignableRole('external_accountant')).toBe(true);
    expect(OWNER_ONLY_ROLES).toContain('external_accountant');
    for (const role of ORG_ROLES) {
      expect(canGrantRole(role, 'external_accountant'), `${role} → EXP`).toBe(role === 'owner');
    }
    // R7 seul laisserait le Directeur financier et le Comptable l'attribuer (inclusion) :
    // c'est `OWNER_ONLY_ROLES` qui ferme, même avec `members.invite` ajouté.
    expect(canGrantRole('finance_director', 'external_accountant')).toBe(false);
    expect(canGrantRole('accountant', 'external_accountant', { grants: ['members.invite'] })).toBe(
      false,
    );
    const toutAjoute: OrgPermissionContext = {
      grants: ACTIONS.filter(
        (a) => ORG_PERMISSION_MATRIX.admin[a] === 'deny' && a !== 'billing.manage',
      ),
    };
    expect(grantableRoles('admin', toutAjoute)).not.toContain('external_accountant');
    // L'Expert-comptable n'attribue aucun rôle qui écrive.
    expect(grantableRoles('external_accountant')).toEqual([]);
    expect(grantableRoles('owner')).toContain('external_accountant');
  });

  it('R7 inchangé pour l’Administrateur : il attribue les mêmes rôles qu’avant', () => {
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
  });

  it('dépendances : chaque geste exige la lecture ; chaque ligne de la matrice les satisfait', () => {
    for (const action of COMPTABILITE.slice(1)) {
      expect(ACTION_DEPENDENCIES[action], action).toEqual(['accounting.read']);
    }
    expect(ACTION_DEPENDENCIES['accounting.read']).toBeUndefined();
    for (const role of ORG_ROLES) {
      for (const action of COMPTABILITE.slice(1)) {
        if (can(role, action, NO_OVERRIDES)) {
          expect(can(role, 'accounting.read', NO_OVERRIDES), `${role} × ${action}`).toBe(true);
        }
      }
    }
  });

  it('critère 1 — plateforme : lecture déléguée (SA, support) ; quatre interdits absolus', () => {
    for (const role of ['platform_super_admin', 'platform_support'] as const) {
      expect(canPlatform(role, 'accounting.read', { hasActiveGrant: true }), role).toBe(true);
      expect(canPlatform(role, 'accounting.read'), role).toBe(false);
    }
    expect(canPlatform('platform_admin', 'accounting.read', { hasActiveGrant: true })).toBe(false);
    for (const action of COMPTABILITE.slice(1)) {
      expect(PLATFORM_FORBIDDEN_ACTIONS).toContain(action);
      for (const role of PLATFORM_ROLES) {
        expect(canPlatform(role, action, { hasActiveGrant: true }), `${role} × ${action}`).toBe(
          false,
        );
      }
    }
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('accounting.read');
  });
});

describe('ADR-0049 § 3.1 — activation (`accountingActivationDecision`)', () => {
  const pret: AccountingActivationInput = {
    chartPackStatus: 'approved',
    bookCurrency: 'CDF',
    cutoverDate: '2026-11-01',
    validatedRuleSet: { expertReviewDeclared: true },
    hasOpenFiscalYear: true,
  };
  const decide = (over: Partial<AccountingActivationInput>) =>
    accountingActivationDecision({ ...pret, ...over });

  it('toutes les conditions réunies : activable, pack `approved` ou `active`', () => {
    expect(decide({})).toEqual({ ok: true });
    expect(decide({ chartPackStatus: 'active' })).toEqual({ ok: true });
  });

  it('critère 2 — sans pack approuvé : `CHART_PACK_NOT_APPROVED` (décision ouverte n° 5)', () => {
    for (const status of ['draft', 'review', 'retired', null] as const) {
      expect(decide({ chartPackStatus: status }), String(status)).toEqual({
        ok: false,
        code: 'ACCOUNTING_ACTIVATION_PRECONDITION',
        missing: ['CHART_PACK_NOT_APPROVED'],
      });
    }
  });

  it('toutes les conditions manquantes rendues ensemble, dans l’ordre de l’assistant', () => {
    expect(
      decide({
        chartPackStatus: 'draft',
        bookCurrency: null,
        cutoverDate: '  ',
        validatedRuleSet: null,
        hasOpenFiscalYear: false,
      }),
    ).toEqual({
      ok: false,
      code: 'ACCOUNTING_ACTIVATION_PRECONDITION',
      missing: [
        'CHART_PACK_NOT_APPROVED',
        'BOOK_CURRENCY_REQUIRED',
        'CUTOVER_DATE_REQUIRED',
        'RULE_SET_NOT_VALIDATED',
        'FISCAL_YEAR_NOT_OPEN',
      ],
    });
  });

  it('aucune monnaie de tenue par défaut ; règles validées sans déclaration de relecture refusées', () => {
    expect(decide({ bookCurrency: null })).toMatchObject({ missing: ['BOOK_CURRENCY_REQUIRED'] });
    expect(decide({ validatedRuleSet: { expertReviewDeclared: false } })).toMatchObject({
      missing: ['EXPERT_REVIEW_NOT_DECLARED'],
    });
  });

  it('les codes sont ceux du contrat partagé (`@lalanda/shared/accounting`)', () => {
    const codes: readonly AccountingActivationMissing[] = ACCOUNTING_ACTIVATION_MISSING_CODES;
    const tout = decide({
      chartPackStatus: null,
      bookCurrency: null,
      cutoverDate: null,
      validatedRuleSet: { expertReviewDeclared: false },
      hasOpenFiscalYear: false,
    });
    const sansRegles = decide({ validatedRuleSet: null });
    const rendus = new Set([
      ...(tout.ok ? [] : tout.missing),
      ...(sansRegles.ok ? [] : sansRegles.missing),
    ]);
    expect([...rendus].sort()).toEqual([...codes].sort());
  });

  it('critère 2 — l’activation exige `accounting.manage` ET `fiscal.manage` : pas le Comptable', () => {
    expect([...ACCOUNTING_ACTIVATION_ACTIONS]).toEqual(['accounting.manage', 'fiscal.manage']);
    expect(ORG_ROLES.filter((r) => canActivateAccounting(r, NO_OVERRIDES))).toEqual([
      'owner',
      'finance_director',
    ]);
    expect(canActivateAccounting('accountant', NO_OVERRIDES)).toBe(false);
    // Droits EFFECTIFS : un retrait de `fiscal.manage` ferme l'activation au Directeur.
    expect(canActivateAccounting('finance_director', { revokes: ['fiscal.manage'] })).toBe(false);
    // Le cumul n'est pas une dépendance : `accounting.manage` n'exige pas `fiscal.manage`.
    expect(ACTION_DEPENDENCIES['accounting.manage']).not.toContain('fiscal.manage');
  });
});

describe('ADR-0049 § 6.9 — `manualEntryDecision` (opération diverse)', () => {
  const base: ManualEntryValidationInput = {
    status: 'draft',
    validatorUserId: 'V',
    authorUserId: 'A',
    approverCountInOrg: 2,
  };
  const decide = (over: Partial<ManualEntryValidationInput>) =>
    manualEntryDecision({ ...base, ...over });

  it('critère 11 — un autre détenteur valide', () => {
    expect(decide({})).toEqual({ ok: true, soleApprover: false });
  });

  it('critère 11 — l’auteur ne valide pas sa propre écriture : 409 SELF_APPROVAL_FORBIDDEN', () => {
    expect(decide({ validatorUserId: 'A' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(decide({ validatorUserId: 'A', approverCountInOrg: 7 })).toMatchObject({ ok: false });
  });

  it('critère 11 — approbateur unique : il valide, marqué `soleApprover`', () => {
    expect(decide({ validatorUserId: 'A', approverCountInOrg: 1 })).toEqual({
      ok: true,
      soleApprover: true,
    });
    expect(decide({ approverCountInOrg: 1 })).toEqual({ ok: true, soleApprover: false });
  });

  it('critère 10 — une écriture non brouillon ne se valide plus : 409 ENTRY_NOT_DRAFT', () => {
    for (const status of ['posted', 'awaiting_rate'] as const) {
      expect(decide({ status }), status).toEqual({ ok: false, code: 'ENTRY_NOT_DRAFT' });
      expect(decide({ status, approverCountInOrg: 1, validatorUserId: 'A' })).toEqual({
        ok: false,
        code: 'ENTRY_NOT_DRAFT',
      });
    }
  });
});

describe('ADR-0049 § 2.4 — `ruleSetDecision` (validation d’un jeu de règles)', () => {
  const base: RuleSetValidationInput = {
    status: 'draft',
    validatorUserId: 'V',
    lastAuthorUserId: 'A',
    approverCountInOrg: 2,
    expertReviewDeclared: true,
  };
  const decide = (over: Partial<RuleSetValidationInput>) => ruleSetDecision({ ...base, ...over });

  it('un autre détenteur valide, déclaration cochée', () => {
    expect(decide({})).toEqual({ ok: true, soleApprover: false });
  });

  it('critère 11 — le dernier auteur ne valide pas, sauf approbateur unique (marqué)', () => {
    expect(decide({ validatorUserId: 'A' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(decide({ validatorUserId: 'A', approverCountInOrg: 1 })).toEqual({
      ok: true,
      soleApprover: true,
    });
  });

  it('décision ouverte n° 6 — la déclaration de relecture est exigée', () => {
    expect(decide({ expertReviewDeclared: false })).toEqual({
      ok: false,
      code: 'EXPERT_REVIEW_DECLARATION_REQUIRED',
    });
    expect(
      decide({ expertReviewDeclared: false, validatorUserId: 'A', approverCountInOrg: 1 }),
    ).toEqual({ ok: false, code: 'EXPERT_REVIEW_DECLARATION_REQUIRED' });
  });

  it('une version validée ou remplacée est immuable ; ce refus passe en premier', () => {
    for (const status of ['validated', 'superseded'] as const) {
      expect(decide({ status, validatorUserId: 'A', expertReviewDeclared: false })).toEqual({
        ok: false,
        code: 'RULE_SET_IMMUTABLE',
      });
    }
  });
});

describe('ADR-0049 § 4 — `accountingReopenDecision` (réouverture, Propriétaire seul)', () => {
  it('le Propriétaire rouvre avec un motif, nettoyé des espaces de bord', () => {
    expect(accountingReopenDecision({ actorRole: 'owner', reason: '  erreur de date ' })).toEqual({
      ok: true,
      reason: 'erreur de date',
    });
    // Valeur venue de la base : casse et espaces tolérés, comme R1.
    expect(accountingReopenDecision({ actorRole: ' Owner ', reason: 'x' })).toMatchObject({
      ok: true,
    });
  });

  it('critère 12 — aucun autre titre ne rouvre, pas même ceux qui clôturent', () => {
    for (const role of ORG_ROLES.filter((r) => r !== 'owner')) {
      expect(accountingReopenDecision({ actorRole: role, reason: 'motif' }), role).toEqual({
        ok: false,
        code: 'REOPEN_OWNER_ONLY',
      });
    }
    for (const role of PLATFORM_ROLES) {
      expect(accountingReopenDecision({ actorRole: role, reason: 'motif' })).toMatchObject({
        code: 'REOPEN_OWNER_ONLY',
      });
    }
    // `accounting.close` ne suffit pas : Directeur financier et Comptable clôturent.
    expect(can('finance_director', 'accounting.close', NO_OVERRIDES)).toBe(true);
    expect(can('accountant', 'accounting.close', NO_OVERRIDES)).toBe(true);
  });

  it('le titre est jugé avant le motif ; motif absent ou blanc : REOPEN_REASON_REQUIRED', () => {
    expect(accountingReopenDecision({ actorRole: 'admin', reason: '' })).toEqual({
      ok: false,
      code: 'REOPEN_OWNER_ONLY',
    });
    for (const reason of ['', '   ', null, undefined]) {
      expect(accountingReopenDecision({ actorRole: 'owner', reason }), String(reason)).toEqual({
        ok: false,
        code: 'REOPEN_REASON_REQUIRED',
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0050 — V0 : contrats clients, commandes clients, avenants
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0050 § 8 — contrats et commandes clients (lot V0)', () => {
  const CONTRATS = ['sales.contract', 'sales.contract.approve'] as const;

  it('critère 1 — préparer : iso-privilège avec `sales.quote` (Propriétaire, Administrateur, Directeur financier, Comptable, Commercial)', () => {
    const preparent = ORG_ROLES.filter((r) => can(r, 'sales.contract', NO_OVERRIDES));
    expect(preparent).toEqual(['owner', 'admin', 'finance_director', 'accountant', 'sales_rep']);
    expect(preparent).toEqual(ORG_ROLES.filter((r) => can(r, 'sales.quote', NO_OVERRIDES)));
  });

  it('critère 1 — approuver : Propriétaire et Directeur financier seulement, cases ⓢ (décision ouverte n° 2)', () => {
    expect(ORG_ROLES.filter((r) => can(r, 'sales.contract.approve', NO_OVERRIDES))).toEqual([
      'owner',
      'finance_director',
    ]);
    for (const role of ORG_ROLES) {
      expect(['deny', 'allow_sod']).toContain(
        ORG_PERMISSION_MATRIX[role]['sales.contract.approve'],
      );
    }
    expect(APPROVAL_ACTIONS).toContain('sales.contract.approve');
    expect(APPROVAL_ACTIONS).not.toContain('sales.contract');
    // `APPROVER_ROLES` compte les approbateurs de plan : inchangé.
    expect(APPROVER_ROLES).toEqual(['owner', 'finance_director']);
  });

  it('critère 1 — le Commercial, le Comptable et l’Administrateur préparent sans approuver ; ni facture ni acompte pour le Commercial', () => {
    for (const role of ['sales_rep', 'accountant', 'admin'] as const) {
      expect(can(role, 'sales.contract', NO_OVERRIDES), role).toBe(true);
      expect(can(role, 'sales.contract.approve', NO_OVERRIDES), role).toBe(false);
    }
    // `prepare-deposit` exige `sales.manage` (§ 3) : le Commercial ne l'a pas, le Comptable si.
    expect(can('sales_rep', 'sales.manage', NO_OVERRIDES)).toBe(false);
    expect(can('accountant', 'sales.manage', NO_OVERRIDES)).toBe(true);
  });

  it('critère 1 — Lecteur et Analyste lisent sans écrire ; Conseiller, RH, Magasinier, Expert-comptable ne lisent pas les ventes', () => {
    for (const role of ['viewer', 'analyst'] as const) {
      expect(can(role, 'sales.read', NO_OVERRIDES), role).toBe(true);
      for (const action of CONTRATS) expect(can(role, action, NO_OVERRIDES), role).toBe(false);
    }
    for (const role of [
      'advisor',
      'hr_manager',
      'storekeeper',
      'external_accountant',
      'project_manager',
    ] as const) {
      expect(can(role, 'sales.read', { canClosePeriods: true }), role).toBe(false);
      for (const action of CONTRATS) {
        expect(can(role, action, { canClosePeriods: true }), `${role} × ${action}`).toBe(false);
      }
    }
  });

  it('dépendances vers `sales.read`, satisfaites par chaque ligne de la matrice', () => {
    for (const action of CONTRATS) {
      expect(ACTION_DEPENDENCIES[action], action).toEqual(['sales.read']);
      for (const role of ORG_ROLES) {
        if (can(role, action, NO_OVERRIDES)) {
          expect(can(role, 'sales.read', NO_OVERRIDES), `${role} × ${action}`).toBe(true);
        }
      }
    }
  });

  it('critère 1 — plateforme : préparer délégué au seul super-administrateur ; approuver, interdit absolu', () => {
    expect(canPlatform('platform_super_admin', 'sales.contract', { hasActiveGrant: true })).toBe(
      true,
    );
    expect(canPlatform('platform_super_admin', 'sales.contract')).toBe(false);
    expect(canPlatform('platform_support', 'sales.contract', { hasActiveGrant: true })).toBe(false);
    expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain('sales.contract');
    expect(PLATFORM_FORBIDDEN_ACTIONS).toContain('sales.contract.approve');
    for (const role of PLATFORM_ROLES) {
      expect(canPlatform(role, 'sales.contract.approve', { hasActiveGrant: true }), role).toBe(
        false,
      );
    }
  });

  it('§ 8.2 — aucun rôle nouveau ; R7 inchangé', () => {
    // ADR-0059 ajoute les treizième à seizième (Salarié, Manager, Stagiaire, Invité).
    expect(ORG_ROLES).toHaveLength(16);
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
    // L'Administrateur, qui prépare, attribue toujours le Commercial (qui prépare aussi) ;
    // le Comptable, qui prépare aussi, reste hors de sa portée (clôture conditionnelle).
    expect(canGrantRole('admin', 'sales_rep')).toBe(true);
    expect(canGrantRole('admin', 'accountant')).toBe(false);
    expect(canGrantRole('sales_rep', 'admin')).toBe(false);
  });
});

describe('ADR-0050 § 8.3 — `contractApprovalDecision` (séparation dynamique)', () => {
  const base: ContractApprovalInput = {
    approverUserId: 'dir',
    submittedBy: 'com',
    createdBy: 'com',
    holdersCount: 2,
    allowSoleApprover: true,
  };

  it('critère 2 — un autre détenteur approuve, sans marque', () => {
    expect(contractApprovalDecision(base)).toEqual({ ok: true, soleApprover: false });
  });

  it('critère 2 — celui qui a soumis n’approuve pas quand un autre détenteur existe', () => {
    expect(
      contractApprovalDecision({
        ...base,
        approverUserId: 'pro',
        submittedBy: 'pro',
        createdBy: 'com',
      }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('le créateur non plus, même si un autre a soumis', () => {
    expect(
      contractApprovalDecision({
        ...base,
        approverUserId: 'pro',
        submittedBy: 'com',
        createdBy: 'pro',
      }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('critère 2 — seul détenteur avec `allowSoleApprover` : approuve, marqué `soleApprover`', () => {
    expect(
      contractApprovalDecision({
        ...base,
        approverUserId: 'pro',
        submittedBy: 'pro',
        createdBy: 'pro',
        holdersCount: 1,
      }),
    ).toEqual({ ok: true, soleApprover: true });
  });

  it('critère 2 — réglage à `false` : 409, même seul', () => {
    expect(
      contractApprovalDecision({
        ...base,
        approverUserId: 'pro',
        submittedBy: 'pro',
        createdBy: 'pro',
        holdersCount: 1,
        allowSoleApprover: false,
      }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('seul détenteur qui n’a ni créé ni soumis : approbation ordinaire, sans marque', () => {
    expect(contractApprovalDecision({ ...base, holdersCount: 1 })).toEqual({
      ok: true,
      soleApprover: false,
    });
  });

  it('reconduction proposée par le moteur (personne ne l’a préparée) : tout détenteur la constate', () => {
    expect(
      contractApprovalDecision({
        ...base,
        approverUserId: 'pro',
        submittedBy: null,
        createdBy: null,
      }),
    ).toEqual({ ok: true, soleApprover: false });
  });

  it('table de vérité : seule la personne et le nombre de détenteurs comptent', () => {
    for (const isSubmitter of [false, true]) {
      for (const isCreator of [false, true]) {
        for (const holdersCount of [0, 1, 2, 5]) {
          for (const allowSoleApprover of [false, true]) {
            const input: ContractApprovalInput = {
              approverUserId: 'x',
              submittedBy: isSubmitter ? 'x' : 'a',
              createdBy: isCreator ? 'x' : 'b',
              holdersCount,
              allowSoleApprover,
            };
            const self = isSubmitter || isCreator;
            const sole = allowSoleApprover && holdersCount <= 1;
            const attendu = !self
              ? { ok: true, soleApprover: false }
              : sole
                ? { ok: true, soleApprover: true }
                : { ok: false, code: 'SELF_APPROVAL_FORBIDDEN' };
            expect(contractApprovalDecision(input), JSON.stringify(input)).toEqual(attendu);
          }
        }
      }
    }
  });

  it('le code est celui du contrat partagé (`@lalanda/shared/sales-contracts`)', () => {
    expect(SALES_CONTRACT_ERROR_CODES).toContain('SELF_APPROVAL_FORBIDDEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0051 — H8 : RH, second volet (frais, avances, présences, évaluations)
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0051 § 5 — frais, avances, présences, évaluations (lot H8)', () => {
  const NOUVELLES = [
    'expenses.claim',
    'expenses.approve',
    'attendance.clock',
    'performance.read',
  ] as const;

  it('critère 1 — déclarer et pointer : iso-privilège avec `leave.request` (tout rôle interne qui travaille)', () => {
    const declarent = ORG_ROLES.filter((r) => can(r, 'expenses.claim', NO_OVERRIDES));
    expect(declarent).toEqual(ORG_ROLES.filter((r) => can(r, 'leave.request', NO_OVERRIDES)));
    expect(ORG_ROLES.filter((r) => can(r, 'attendance.clock', NO_OVERRIDES))).toEqual(declarent);
    // Externes et rôle non attribuable : rien (`403` sur `POST /hr/expense-reports`).
    for (const role of ['advisor', 'external_accountant', 'project_manager'] as const) {
      for (const action of NOUVELLES) {
        expect(can(role, action, { canClosePeriods: true }), `${role} × ${action}`).toBe(false);
      }
    }
  });

  it('critère 1 — valider : Propriétaire et Directeur financier, cases ⓢ ; ni Comptable, ni Responsable RH', () => {
    expect(ORG_ROLES.filter((r) => can(r, 'expenses.approve', NO_OVERRIDES))).toEqual([
      'owner',
      'finance_director',
    ]);
    expect(ORG_ROLES.filter((r) => can(r, 'expenses.approve', NO_OVERRIDES))).toEqual(
      ORG_ROLES.filter((r) => can(r, 'purchase.approve', NO_OVERRIDES)),
    );
    for (const role of ORG_ROLES) {
      expect(['deny', 'allow_sod']).toContain(ORG_PERMISSION_MATRIX[role]['expenses.approve']);
    }
    expect(APPROVAL_ACTIONS).toContain('expenses.approve');
    // Le Comptable rembourse (`payables.pay`) sans valider ; le Responsable RH lit la liste
    // (`hr.read`) sans valider ni rembourser.
    expect(can('accountant', 'expenses.approve', NO_OVERRIDES)).toBe(false);
    expect(can('accountant', 'payables.pay', NO_OVERRIDES)).toBe(true);
    expect(can('hr_manager', 'hr.read', NO_OVERRIDES)).toBe(true);
    expect(can('hr_manager', 'expenses.approve', NO_OVERRIDES)).toBe(false);
    expect(can('hr_manager', 'payables.pay', NO_OVERRIDES)).toBe(false);
  });

  it('critère 1 — confidentialité : `performance.read` au Propriétaire et au Responsable RH seuls ; ni Directeur financier ni Administrateur', () => {
    expect(ORG_ROLES.filter((r) => can(r, 'performance.read', NO_OVERRIDES))).toEqual([
      'owner',
      'hr_manager',
    ]);
    // Le Directeur financier lit les salaires, pas les entretiens (O6).
    expect(can('finance_director', 'hr.sensitive.read', NO_OVERRIDES)).toBe(true);
    expect(can('finance_director', 'performance.read', NO_OVERRIDES)).toBe(false);
    expect(can('admin', 'performance.read', { canClosePeriods: true })).toBe(false);
    // `hr.read` ou `hr.sensitive.read` seuls n'ouvrent pas les évaluations.
    for (const role of ORG_ROLES) {
      if (can(role, 'performance.read', NO_OVERRIDES)) {
        expect(can(role, 'hr.manage', NO_OVERRIDES), role).toBe(true);
      }
    }
  });

  it('dépendances (§ 5.2), satisfaites par chaque ligne de la matrice', () => {
    expect(ACTION_DEPENDENCIES['expenses.claim']).toBeUndefined();
    expect(ACTION_DEPENDENCIES['attendance.clock']).toBeUndefined();
    expect(ACTION_DEPENDENCIES['expenses.approve']).toEqual(['hr.read', 'treasury.read']);
    expect(ACTION_DEPENDENCIES['performance.read']).toEqual(['hr.read']);
    for (const action of NOUVELLES) {
      for (const role of ORG_ROLES) {
        if (!can(role, action, NO_OVERRIDES)) continue;
        for (const dep of ACTION_DEPENDENCIES[action] ?? []) {
          expect(can(role, dep, NO_OVERRIDES), `${role} × ${action} → ${dep}`).toBe(true);
        }
      }
    }
  });

  it('§ 5.2 — paire `expenses.approve` + `payables.pay` ; Propriétaire et Directeur financier la cumulent nativement', () => {
    expect(SOD_PAIRS).toContainEqual(['expenses.approve', 'payables.pay']);
    expect(
      ORG_ROLES.filter(
        (r) => can(r, 'expenses.approve', NO_OVERRIDES) && can(r, 'payables.pay', NO_OVERRIDES),
      ),
    ).toEqual(['owner', 'finance_director']);
    // `payables.pay` : population et dépendances inchangées (décision ouverte n° 2).
    expect(ORG_ROLES.filter((r) => can(r, 'payables.pay', NO_OVERRIDES))).toEqual([
      'owner',
      'finance_director',
      'accountant',
    ]);
    expect(ACTION_DEPENDENCIES['payables.pay']).toEqual(['purchase.read', 'treasury.read']);
  });

  it('critère 2 — plateforme : les quatre refusées à tous, même sous accès délégué ; `performance.read` interdit absolu', () => {
    expect(PLATFORM_FORBIDDEN_ACTIONS).toContain('performance.read');
    for (const action of ['expenses.claim', 'expenses.approve', 'attendance.clock'] as const) {
      expect(PLATFORM_FORBIDDEN_ACTIONS).not.toContain(action);
    }
    for (const role of PLATFORM_ROLES) {
      for (const action of NOUVELLES) {
        expect(PLATFORM_PERMISSION_MATRIX[role][action], `${role} × ${action}`).toBe('forbidden');
        expect(canPlatform(role, action, { hasActiveGrant: true }), `${role} × ${action}`).toBe(
          false,
        );
      }
    }
  });

  it('§ 5.2 — aucun rôle nouveau ; R7 : l’Administrateur attribue les mêmes rôles', () => {
    // ADR-0059 ajoute les treizième à seizième (Salarié, Manager, Stagiaire, Invité).
    expect(ORG_ROLES).toHaveLength(16);
    expect(grantableRoles('admin').sort()).toEqual([
      'admin',
      'advisor',
      'analyst',
      // ADR-0059 § 2 : l'Administrateur détient les actions du Salarié, du Manager, du
      // Stagiaire et de l'Invité externe.
      'employee',
      'guest',
      'intern',
      'sales_rep',
      'storekeeper',
      'team_manager',
      'viewer',
    ]);
    expect(grantableRoles('viewer').sort()).toEqual(['advisor', 'viewer']);
    // Le Responsable RH reste attribuable par le seul Propriétaire.
    expect(canGrantRole('admin', 'hr_manager')).toBe(false);
    expect(canGrantRole('finance_director', 'hr_manager')).toBe(false);
    expect(canGrantRole('owner', 'hr_manager')).toBe(true);
  });
});

describe('ADR-0051 § 3.1, § 3.2 — `expenseApprovalDecision`', () => {
  const base: ExpenseApprovalInput = {
    decision: 'approve',
    approverUserId: 'dir',
    beneficiaryUserId: 'b',
    createdBy: 'b',
    step: 'finance',
    salaryAdvance: false,
    isDesignatedManager: false,
    holdsExpensesApprove: true,
    holdsHrSensitiveRead: true,
    priorApproverUserIds: ['a'],
    approverCountInOrg: 2,
    allowSoleApprover: true,
  };

  it('critère 3 — le bénéficiaire ne valide pas sa note', () => {
    expect(expenseApprovalDecision({ ...base, approverUserId: 'b' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
    expect(expenseApprovalDecision({ ...base, approverUserId: 'b', decision: 'reject' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('critère 3 — l’auteur d’une saisie pour autrui (chauffeur sans compte) ne la valide pas', () => {
    expect(
      expenseApprovalDecision({
        ...base,
        approverUserId: 'rh',
        beneficiaryUserId: null,
        createdBy: 'rh',
      }),
    ).toEqual({ ok: false, code: 'CREATOR_APPROVAL_FORBIDDEN' });
  });

  it('ADR-0066 § 1 — le responsable d’équipe tient l’étape manager, ni la finance ni une avance sur salaire', () => {
    const lead = {
      ...base,
      approverUserId: 'l',
      step: 'manager' as const,
      isTeamLead: true,
      holdsExpensesApprove: false,
      holdsHrSensitiveRead: false,
      priorApproverUserIds: [],
    };
    expect(expenseApprovalDecision(lead)).toEqual({
      ok: true,
      soleApprover: false,
      onBehalfOfManager: false,
    });
    expect(expenseApprovalDecision({ ...lead, step: 'finance' })).toEqual({
      ok: false,
      code: 'EXPENSE_NOT_YOUR_STEP',
    });
    expect(expenseApprovalDecision({ ...lead, salaryAdvance: true })).toEqual({
      ok: false,
      code: 'ADVANCE_SALARY_NOT_YOUR_STEP',
    });
    expect(expenseApprovalDecision({ ...lead, beneficiaryUserId: 'l', createdBy: 'l' })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('critère 3 — le manager tient l’étape manager, puis ne tient pas l’étape finance', () => {
    expect(
      expenseApprovalDecision({
        ...base,
        approverUserId: 'a',
        step: 'manager',
        isDesignatedManager: true,
        holdsExpensesApprove: false,
        holdsHrSensitiveRead: false,
        priorApproverUserIds: [],
      }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
    expect(expenseApprovalDecision({ ...base, approverUserId: 'a' })).toEqual({
      ok: false,
      code: 'APPROVER_ALREADY_APPROVED',
    });
    // La Directrice financière valide l'étape finance.
    expect(expenseApprovalDecision(base)).toEqual({
      ok: true,
      soleApprover: false,
      onBehalfOfManager: false,
    });
  });

  it('étape manager : suppléance par un détenteur d’`expenses.approve`, marquée ; un collègue sans droit : 403', () => {
    expect(expenseApprovalDecision({ ...base, step: 'manager', priorApproverUserIds: [] })).toEqual(
      { ok: true, soleApprover: false, onBehalfOfManager: true },
    );
    expect(
      expenseApprovalDecision({
        ...base,
        approverUserId: 'c',
        step: 'manager',
        holdsExpensesApprove: false,
        priorApproverUserIds: [],
      }),
    ).toEqual({ ok: false, code: 'EXPENSE_NOT_YOUR_STEP' });
    // Le manager désigné n'a aucune autorité à l'étape finance.
    expect(
      expenseApprovalDecision({
        ...base,
        approverUserId: 'a',
        isDesignatedManager: true,
        holdsExpensesApprove: false,
        priorApproverUserIds: [],
      }),
    ).toEqual({ ok: false, code: 'EXPENSE_NOT_YOUR_STEP' });
  });

  it('critère 8 — avance sur salaire : ni le manager, ni un validateur sans `hr.sensitive.read`', () => {
    expect(
      expenseApprovalDecision({
        ...base,
        approverUserId: 'a',
        salaryAdvance: true,
        step: 'finance',
        isDesignatedManager: true,
        holdsExpensesApprove: false,
        holdsHrSensitiveRead: false,
        priorApproverUserIds: [],
      }),
    ).toEqual({ ok: false, code: 'ADVANCE_SALARY_NOT_YOUR_STEP' });
    expect(
      expenseApprovalDecision({
        ...base,
        salaryAdvance: true,
        holdsHrSensitiveRead: false,
        priorApproverUserIds: [],
      }),
    ).toEqual({ ok: false, code: 'ADVANCE_SALARY_NOT_YOUR_STEP' });
    expect(
      expenseApprovalDecision({ ...base, salaryAdvance: true, priorApproverUserIds: [] }),
    ).toEqual({ ok: true, soleApprover: false, onBehalfOfManager: false });
  });

  it('critère 4 — approbatrice unique, sans manager : elle valide sa propre note, marquée', () => {
    expect(
      expenseApprovalDecision({
        ...base,
        approverUserId: 'pro',
        beneficiaryUserId: 'pro',
        createdBy: 'pro',
        priorApproverUserIds: [],
        approverCountInOrg: 1,
      }),
    ).toEqual({ ok: true, soleApprover: true, onBehalfOfManager: false });
    // Réglage coupé : 409 même seule.
    expect(
      expenseApprovalDecision({
        ...base,
        approverUserId: 'pro',
        beneficiaryUserId: 'pro',
        createdBy: 'pro',
        priorApproverUserIds: [],
        approverCountInOrg: 1,
        allowSoleApprover: false,
      }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('un refus clôt la note à toute étape, sans contrôle des étapes déjà tenues', () => {
    expect(expenseApprovalDecision({ ...base, approverUserId: 'a', decision: 'reject' })).toEqual({
      ok: true,
      soleApprover: false,
      onBehalfOfManager: false,
    });
  });

  it('table de vérité : seules les personnes, les droits effectifs et le nombre de détenteurs comptent', () => {
    for (const isSelf of [false, true]) {
      for (const isCreator of [false, true]) {
        for (const already of [false, true]) {
          for (const holders of [1, 2]) {
            for (const allowSoleApprover of [false, true]) {
              for (const decision of ['approve', 'reject'] as const) {
                const input: ExpenseApprovalInput = {
                  ...base,
                  decision,
                  approverUserId: 'x',
                  beneficiaryUserId: isSelf ? 'x' : 'b',
                  createdBy: isCreator ? 'x' : 'b',
                  priorApproverUserIds: already ? ['x'] : ['a'],
                  approverCountInOrg: holders,
                  allowSoleApprover,
                };
                const sole = allowSoleApprover && holders <= 1;
                const personal = isSelf || isCreator;
                const attendu =
                  isSelf && !sole
                    ? { ok: false, code: 'SELF_APPROVAL_FORBIDDEN' }
                    : isCreator && !sole
                      ? { ok: false, code: 'CREATOR_APPROVAL_FORBIDDEN' }
                      : decision === 'reject'
                        ? { ok: true, soleApprover: sole && personal, onBehalfOfManager: false }
                        : already && !sole
                          ? { ok: false, code: 'APPROVER_ALREADY_APPROVED' }
                          : {
                              ok: true,
                              soleApprover: sole && (personal || already),
                              onBehalfOfManager: false,
                            };
                expect(expenseApprovalDecision(input), JSON.stringify(input)).toEqual(attendu);
              }
            }
          }
        }
      }
    }
  });

  it('les codes sont ceux des contrats partagés (`@lalanda/shared/hr`)', () => {
    for (const code of [
      'SELF_APPROVAL_FORBIDDEN',
      'CREATOR_APPROVAL_FORBIDDEN',
      'APPROVER_ALREADY_APPROVED',
      'EXPENSE_NOT_YOUR_STEP',
      'SELF_PAYMENT_FORBIDDEN',
      'APPROVER_CANNOT_PAY',
    ]) {
      expect(HR_EXPENSES_ERROR_CODES as readonly string[]).toContain(code);
    }
    expect(HR_ADVANCES_ERROR_CODES).toContain('ADVANCE_SALARY_NOT_YOUR_STEP');
  });
});

describe('ADR-0051 § 3.1 point 5 — `reimbursementDecision`', () => {
  const base: ReimbursementInput = {
    payerUserId: 'cpt',
    beneficiaryUserId: 'b',
    financeApproverUserId: 'dir',
    payerCountInOrg: 3,
    allowSoleApprover: true,
  };

  it('critère 3 — le Comptable rembourse ; la Directrice qui a validé ne rembourse pas si un autre payeur existe', () => {
    expect(reimbursementDecision(base)).toEqual({ ok: true, soleApprover: false });
    expect(reimbursementDecision({ ...base, payerUserId: 'dir' })).toEqual({
      ok: false,
      code: 'APPROVER_CANNOT_PAY',
    });
  });

  it('le bénéficiaire ne se rembourse pas', () => {
    expect(reimbursementDecision({ ...base, payerUserId: 'b' })).toEqual({
      ok: false,
      code: 'SELF_PAYMENT_FORBIDDEN',
    });
  });

  it('critère 4 — payeuse unique : elle rembourse sa note qu’elle a validée, marquée', () => {
    expect(
      reimbursementDecision({
        payerUserId: 'pro',
        beneficiaryUserId: 'pro',
        financeApproverUserId: 'pro',
        payerCountInOrg: 1,
        allowSoleApprover: true,
      }),
    ).toEqual({ ok: true, soleApprover: true });
    expect(
      reimbursementDecision({
        payerUserId: 'pro',
        beneficiaryUserId: 'pro',
        financeApproverUserId: 'pro',
        payerCountInOrg: 1,
        allowSoleApprover: false,
      }),
    ).toEqual({ ok: false, code: 'SELF_PAYMENT_FORBIDDEN' });
  });

  it('collaborateur sans compte, approbateur inconnu : tout payeur, sans marque', () => {
    expect(
      reimbursementDecision({ ...base, beneficiaryUserId: null, financeApproverUserId: null }),
    ).toEqual({ ok: true, soleApprover: false });
  });

  it('table de vérité', () => {
    for (const isSelf of [false, true]) {
      for (const isApprover of [false, true]) {
        for (const count of [1, 2]) {
          for (const allowSoleApprover of [false, true]) {
            const input: ReimbursementInput = {
              payerUserId: 'x',
              beneficiaryUserId: isSelf ? 'x' : 'b',
              financeApproverUserId: isApprover ? 'x' : 'a',
              payerCountInOrg: count,
              allowSoleApprover,
            };
            const sole = allowSoleApprover && count <= 1;
            const attendu =
              isSelf && !sole
                ? { ok: false, code: 'SELF_PAYMENT_FORBIDDEN' }
                : isApprover && !sole
                  ? { ok: false, code: 'APPROVER_CANNOT_PAY' }
                  : { ok: true, soleApprover: sole && (isSelf || isApprover) };
            expect(reimbursementDecision(input), JSON.stringify(input)).toEqual(attendu);
          }
        }
      }
    }
  });
});

describe('ADR-0051 § 3.4 — `attendanceCorrectionDecision`', () => {
  const base: AttendanceCorrectionInput = {
    decision: 'approve',
    deciderUserId: 'a',
    beneficiaryUserId: 'b',
    requestedBy: 'b',
    isDesignatedManager: true,
    hasOtherDesignatedManager: false,
    holdsHrManage: false,
    hrManagerCountInOrg: 2,
    allowSoleApprover: true,
  };

  it('critère 11 — la correction demandée par B est refusée à B, acceptée par A (manager)', () => {
    expect(attendanceCorrectionDecision(base)).toEqual({ ok: true, soleApprover: false });
    expect(
      attendanceCorrectionDecision({
        ...base,
        deciderUserId: 'b',
        isDesignatedManager: false,
        hasOtherDesignatedManager: true,
        holdsHrManage: true,
      }),
    ).toEqual({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('ni manager ni `hr.manage` : 403', () => {
    expect(
      attendanceCorrectionDecision({ ...base, deciderUserId: 'c', isDesignatedManager: false }),
    ).toEqual({ ok: false, code: 'ATTENDANCE_CORRECTION_NOT_YOURS' });
  });

  it('l’auteur d’une correction saisie pour autrui ne la décide pas', () => {
    expect(attendanceCorrectionDecision({ ...base, requestedBy: 'a' })).toEqual({
      ok: false,
      code: 'CREATOR_APPROVAL_FORBIDDEN',
    });
  });

  it('approbateur unique : seul détenteur de `hr.manage`, sans autre manager, marqué', () => {
    const seul: AttendanceCorrectionInput = {
      ...base,
      deciderUserId: 'rh',
      beneficiaryUserId: 'rh',
      requestedBy: 'rh',
      isDesignatedManager: false,
      holdsHrManage: true,
      hrManagerCountInOrg: 1,
    };
    expect(attendanceCorrectionDecision(seul)).toEqual({ ok: true, soleApprover: true });
    // Un manager existe : il décide, pas d'échappatoire.
    expect(attendanceCorrectionDecision({ ...seul, hasOtherDesignatedManager: true })).toEqual({
      ok: false,
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('les codes sont ceux des contrats partagés', () => {
    for (const code of [
      'ATTENDANCE_CORRECTION_NOT_YOURS',
      'SELF_APPROVAL_FORBIDDEN',
      'CREATOR_APPROVAL_FORBIDDEN',
    ]) {
      expect(HR_ATTENDANCE_ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

describe('ADR-0051 § 3.5 — `reviewCloseDecision`', () => {
  const base: ReviewCloseInput = {
    closerUserId: 'rh',
    employeeUserId: 'b',
    reviewerUserId: 'a',
    closerCountInOrg: 2,
    allowSoleApprover: true,
  };

  it('critère 14 — l’évaluateur ne clôt pas ; la RH le peut', () => {
    expect(reviewCloseDecision(base)).toEqual({ ok: true, soleApprover: false });
    expect(reviewCloseDecision({ ...base, closerUserId: 'a' })).toEqual({
      ok: false,
      code: 'REVIEW_CLOSE_FORBIDDEN',
    });
  });

  it('l’évalué ne clôt pas sa propre évaluation', () => {
    expect(reviewCloseDecision({ ...base, closerUserId: 'b' })).toEqual({
      ok: false,
      code: 'REVIEW_CLOSE_FORBIDDEN',
    });
  });

  it('détenteur unique : marqué ; réglage coupé : 409', () => {
    expect(reviewCloseDecision({ ...base, closerUserId: 'a', closerCountInOrg: 1 })).toEqual({
      ok: true,
      soleApprover: true,
    });
    expect(
      reviewCloseDecision({
        ...base,
        closerUserId: 'a',
        closerCountInOrg: 1,
        allowSoleApprover: false,
      }),
    ).toEqual({ ok: false, code: 'REVIEW_CLOSE_FORBIDDEN' });
  });

  it('table de vérité', () => {
    for (const isEmployee of [false, true]) {
      for (const isReviewer of [false, true]) {
        for (const count of [1, 2]) {
          for (const allowSoleApprover of [false, true]) {
            const input: ReviewCloseInput = {
              closerUserId: 'x',
              employeeUserId: isEmployee ? 'x' : 'b',
              reviewerUserId: isReviewer ? 'x' : 'a',
              closerCountInOrg: count,
              allowSoleApprover,
            };
            const personal = isEmployee || isReviewer;
            const sole = allowSoleApprover && count <= 1;
            const attendu = !personal
              ? { ok: true, soleApprover: false }
              : sole
                ? { ok: true, soleApprover: true }
                : { ok: false, code: 'REVIEW_CLOSE_FORBIDDEN' };
            expect(reviewCloseDecision(input), JSON.stringify(input)).toEqual(attendu);
          }
        }
      }
    }
    expect(HR_PERFORMANCE_ERROR_CODES).toContain('REVIEW_CLOSE_FORBIDDEN');
  });
});

describe('ADR-0059 — rôles de l’équipe : Salarié, Manager, Stagiaire, Invité externe', () => {
  const tenues = (role: OrgRole): Action[] =>
    ACTIONS.filter((a) => can(role, a, { canClosePeriods: true }));
  const SALARIE: readonly Action[] = [
    'analytics.read',
    'work.read',
    'work.update',
    'leave.request',
    'expenses.claim',
    'attendance.clock',
  ];
  // Familles financières : aucune n'est ouverte aux quatre rôles (§ 2).
  const FINANCE = (a: Action): boolean =>
    a.startsWith('sales.') ||
    a.startsWith('treasury.') ||
    a.startsWith('purchase.') ||
    a.startsWith('accounting.') ||
    a.startsWith('crm.') ||
    a === 'payables.pay' ||
    a === 'fiscal.manage' ||
    a === 'billing.manage' ||
    a === 'report.export' ||
    a === 'actuals.import' ||
    a === 'period.close' ||
    a.startsWith('plan.') ||
    a === 'inputs.update' ||
    a === 'canvas.update' ||
    a.startsWith('project.') ||
    a.startsWith('stock.') ||
    a === 'expenses.approve' ||
    a === 'hr.sensitive.read';

  it('Salarié : six actions — tâches, libre-service RH, socle — et rien d’autre', () => {
    expect(tenues('employee')).toEqual(SALARIE);
  });

  it('Manager / Chef d’équipe : Salarié + `work.manage`, sans validation RH (v1.15)', () => {
    expect(tenues('team_manager')).toEqual([
      'analytics.read',
      'work.read',
      'work.update',
      'work.manage',
      'leave.request',
      'expenses.claim',
      'attendance.clock',
    ]);
    expect(can('team_manager', 'leave.approve', NO_OVERRIDES)).toBe(false);
    expect(can('team_manager', 'hr.read', NO_OVERRIDES)).toBe(false);
  });

  it('Stagiaire : la même ligne que le Salarié (§ 2, décision ouverte n° 3)', () => {
    expect(ORG_PERMISSION_MATRIX.intern).toEqual(ORG_PERMISSION_MATRIX.employee);
  });

  it('Invité externe : projets et tâches, socle compris ; ni RH ni pointage', () => {
    expect(tenues('guest')).toEqual(['analytics.read', 'work.read', 'work.update']);
    expect(PROJECT_SCOPED_ROLES).toEqual(['guest']);
  });

  it('ADR-0066 § 2 — le Stagiaire seul n’assigne qu’à lui-même (règle du module work)', () => {
    expect(SELF_ASSIGN_ONLY_ROLES).toEqual(['intern']);
    expect(tenues('intern')).toEqual(tenues('employee'));
  });

  it('aucune donnée financière pour les quatre rôles', () => {
    for (const role of ['employee', 'team_manager', 'intern', 'guest'] as const) {
      for (const action of ACTIONS.filter(FINANCE)) {
        expect(can(role, action, NO_OVERRIDES), `${role} × ${action}`).toBe(false);
      }
      expect(canSeeStockValues(role, NO_OVERRIDES), role).toBe(false);
    }
  });

  it('dépendances satisfaites par chaque nouvelle ligne', () => {
    for (const role of ['employee', 'team_manager', 'intern', 'guest'] as const) {
      const set = new Set(tenues(role));
      for (const a of set) {
        for (const r of requiredActionsOf(a))
          expect(set.has(r), `${role} : ${a} ⇒ ${r}`).toBe(true);
      }
    }
  });

  it('attribuables ; Propriétaire et Administrateur les attribuent (R7), pas réservés', () => {
    for (const role of ['employee', 'team_manager', 'intern', 'guest'] as const) {
      expect(ASSIGNABLE_ORG_ROLES).toContain(role);
      expect(OWNER_ONLY_ROLES).not.toContain(role);
      expect(canGrantRole('owner', role), role).toBe(true);
      expect(canGrantRole('admin', role), role).toBe(true);
      // Le Directeur financier aussi (sous-ensemble), mais sans `members.invite`.
      expect(canGrantRole('finance_director', role), role).toBe(true);
    }
    // Le Lecteur ne travaille pas sur les tâches : il n'attribue aucun de ces rôles.
    expect(canGrantRole('viewer', 'employee')).toBe(false);
    // Le Salarié n'attribue pas le Manager (il n'a pas `work.manage`).
    expect(canGrantRole('employee', 'team_manager')).toBe(false);
  });

  it('aucun n’est approbateur ; aucune case ⓢ, ⚙ ni P', () => {
    for (const role of ['employee', 'team_manager', 'intern', 'guest'] as const) {
      expect(APPROVER_ROLES).not.toContain(role);
      for (const action of ACTIONS) {
        expect(['allow', 'deny']).toContain(ORG_PERMISSION_MATRIX[role][action]);
      }
    }
  });

  it('rôle par défaut à l’invitation : le Salarié, qui expose moins que le Lecteur', () => {
    expect(DEFAULT_INVITATION_ROLE).toBe('employee');
    const lecteur = new Set(tenues('viewer'));
    const lus = ACTIONS.filter((a) => a.endsWith('.read') && FINANCE(a));
    expect(lus.filter((a) => lecteur.has(a)).length).toBeGreaterThan(0);
    expect(lus.filter((a) => can('employee', a, NO_OVERRIDES))).toEqual([]);
  });

  it('rangs 8 à 10 après le Magasinier, l’Invité externe en dernier ; libellés et descriptions', () => {
    expect(ORG_ROLE_RANK.storekeeper).toBe(7);
    expect(ORG_ROLE_RANK.team_manager).toBe(8);
    expect(ORG_ROLE_RANK.employee).toBe(9);
    expect(ORG_ROLE_RANK.intern).toBe(10);
    expect(ORG_ROLE_RANK.guest).toBe(15);
    expect(Math.max(...ORG_ROLES.map((r) => ORG_ROLE_RANK[r]))).toBe(ORG_ROLE_RANK.guest);
    expect(ORG_ROLE_LABELS.employee).toBe('Salarié');
    expect(ORG_ROLE_LABELS.team_manager).toBe('Manager / Chef d’équipe');
    expect(ORG_ROLE_LABELS.intern).toBe('Stagiaire');
    expect(ORG_ROLE_LABELS.guest).toBe('Invité externe');
    for (const role of ['employee', 'team_manager', 'intern', 'guest'] as const) {
      expect(ORG_ROLE_DESCRIPTIONS[role].length, role).toBeGreaterThan(40);
    }
  });
});
