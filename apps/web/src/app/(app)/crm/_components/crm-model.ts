// Logique pure des écrans CRM — ADR-0035 § 5.
//
// Isolée du rendu pour être testée sans DOM. Deux règles, vérifiées par un test
// qui lit cette source :
// 1. AUCUN CALCUL DE MONTANT : montants estimés, totaux par devise et
//    probabilités viennent de l'API (moteur) ; ici, mise en forme de chaînes.
// 2. RIEN N'AUTORISE : masquer un bouton est un confort, l'API reste seule juge.

import type {
  ActivityBody,
  AmountSource,
  ActivityKind,
  ContactBody,
  ContactView,
  OpportunityBody,
  OpportunitySummary,
  PipelineStage,
  PipelineView,
  StageWinRate,
} from '@/lib/api-crm';
import type { DocumentCurrency, OrgAction } from '@/lib/api';

import { formatMontant, lireMontantSaisi } from '../../ventes/_components/sales-model';

/** Application CRM, sortie de Ventes (ADR-0040 § 8.1). */
export const CRM_BASE = '/crm';

/** Fiche 360° d'un compte : `/crm/comptes/<id>` (ADR-0040 § 8.1). */
export function lienCompte(id: string): string {
  return `${CRM_BASE}/comptes/${encodeURIComponent(id)}`;
}

/** Liste des activités, ouverte sur une activité : `/crm/activites?activite=<id>` (§ 5.2). */
export function lienActivite(id: string): string {
  return `${CRM_BASE}/activites?activite=${encodeURIComponent(id)}`;
}

/** Fiche d'une opportunité : `/crm/opportunites/<id>` (ADR-0040 § 8.1). */
export function lienOpportunite(id: string): string {
  return `${CRM_BASE}/opportunites/${encodeURIComponent(id)}`;
}

export function peutLireCrm(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('crm.read');
}

export function peutGererCrm(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('crm.manage');
}

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  call: 'Appel',
  meeting: 'Réunion',
  note: 'Note',
  follow_up: 'Relance',
};

export const ACTIVITY_KINDS: readonly ActivityKind[] = ['call', 'meeting', 'follow_up', 'note'];

/** « 1 500,00 USD · 3 opp. » par devise ; jamais d'addition entre devises. */
export function totauxColonne(totals: PipelineView['stages'][number]['totals']): string[] {
  return totals.map((t) => `${formatMontant(t.total, t.currency)} · ${t.count} opp.`);
}

/** Libellé de la probabilité historique — jamais un pourcentage sans échantillon suffisant. */
export function libelleProbabilite(r: StageWinRate | null): string | null {
  if (r === null) return null;
  if (r.status === 'available') {
    return `Probabilité historique : ${r.ratePercent} % (${r.won} gagnées sur ${r.sample})`;
  }
  return `Probabilité indisponible : ${r.sample} opportunité${r.sample > 1 ? 's' : ''} clôturée${r.sample > 1 ? 's' : ''} sur ${r.requiredSample} nécessaires`;
}

export function montantEstime(o: Pick<OpportunitySummary, 'amount' | 'currency'>): string {
  return o.amount === null
    ? 'Montant non estimé'
    : `${formatMontant(o.amount, o.currency)} (estimé)`;
}

export function interlocuteur(
  o: Pick<OpportunitySummary, 'customerName' | 'prospectName'> &
    Partial<Pick<OpportunitySummary, 'accountName'>>,
): string {
  if (o.customerName) return o.customerName;
  const nom = o.accountName ?? o.prospectName;
  return nom ? `${nom} (prospect)` : '—';
}

/** Préparer un devis (ADR-0040 § 4.1) : « Créer un devis » de l'opportunité. */
export function peutPreparerDevis(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('sales.quote');
}

/** Convertir un prospect en client : `crm.manage` ET `sales.manage` (§ 3.1.1). */
export function peutConvertirCompte(actions: readonly OrgAction[] | null): boolean {
  return peutGererCrm(actions) && actions !== null && actions.includes('sales.manage');
}

/**
 * Étapes voisines pour déplacer une carte au clavier (« ← » et « → ») : on
 * n'avance pas au-delà de la première étape close, on n'en recule pas vers
 * une autre étape close.
 */
export function etapesVoisines(
  stages: readonly PipelineStage[],
  courante: string,
): { precedente: PipelineStage | null; suivante: PipelineStage | null } {
  const ouvertes = stages.filter((s) => s.kind === 'open');
  const i = ouvertes.findIndex((s) => s.key === courante);
  if (i === -1) return { precedente: ouvertes.at(-1) ?? null, suivante: null };
  return {
    precedente: i > 0 ? ouvertes[i - 1]! : null,
    suivante:
      i < ouvertes.length - 1 ? ouvertes[i + 1]! : (stages.find((s) => s.kind === 'won') ?? null),
  };
}

export function tonEtape(kind: PipelineStage['kind']): 'neutre' | 'succes' | 'echec' {
  return kind === 'won' ? 'succes' : kind === 'lost' ? 'echec' : 'neutre';
}

// ── Formulaires ─────────────────────────────────────────────────────────────

export interface FormulaireOpportunite {
  title: string;
  /** ADR-0040 — C2 : le compte visé (prospect ou client). */
  accountId: string;
  contactId: string;
  montant: string;
  currency: DocumentCurrency;
  expectedCloseDate: string;
  /** Responsable ; `''` : inchangé (création : le créateur). */
  ownerId: string;
}

export function formulaireOpportunite(
  o: Partial<OpportunitySummary> | null = null,
): FormulaireOpportunite {
  return {
    title: o?.title ?? '',
    accountId: o?.accountId ?? '',
    contactId: o?.contactId ?? '',
    montant: o?.amount ? o.amount.replace('.', ',') : '',
    currency: o?.currency ?? 'CDF',
    expectedCloseDate: o?.expectedCloseDate ?? '',
    ownerId: o?.ownerId ?? '',
  };
}

export type Preparation<C> = { ok: true; corps: C } | { ok: false; champs: Record<string, string> };

/**
 * Corps d'une opportunité. `amountSource` vaut `lines` quand le montant est tiré
 * des lignes : la saisie du montant est alors ignorée (l'API le calcule).
 */
export function preparerOpportunite(
  f: FormulaireOpportunite,
  amountSource: AmountSource = 'manual',
): Preparation<OpportunityBody> {
  const champs: Record<string, string> = {};
  if (f.title.trim() === '') champs['title'] = 'Le titre est obligatoire.';
  if (f.accountId === '') champs['accountId'] = 'Choisissez un compte (prospect ou client).';
  let amount: string | null = null;
  if (amountSource === 'manual' && f.montant.trim() !== '') {
    const m = lireMontantSaisi(f.montant);
    if (m.ok) amount = m.valeur;
    else champs['amount'] = m.erreur;
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      title: f.title.trim(),
      accountId: f.accountId,
      contactId: f.contactId === '' ? null : f.contactId,
      amount,
      currency: f.currency,
      expectedCloseDate: f.expectedCloseDate === '' ? null : f.expectedCloseDate,
      ...(f.ownerId === '' ? {} : { ownerId: f.ownerId }),
      amountSource,
    },
  };
}

export interface FormulaireContact {
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  /** ADR-0040 — C1 : compte de rattachement ; `''` : personne sans entreprise. */
  accountId: string;
  notes: string;
}

export function formulaireContact(c: ContactView | null = null): FormulaireContact {
  return {
    name: c?.name ?? '',
    jobTitle: c?.jobTitle ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    accountId: c?.accountId ?? '',
    notes: c?.notes ?? '',
  };
}

const ouNul = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function preparerContact(f: FormulaireContact): Preparation<ContactBody> {
  const champs: Record<string, string> = {};
  if (f.name.trim() === '') champs['name'] = 'Le nom est obligatoire.';
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      name: f.name.trim(),
      jobTitle: ouNul(f.jobTitle),
      email: ouNul(f.email),
      phone: ouNul(f.phone),
      accountId: f.accountId === '' ? null : f.accountId,
      notes: ouNul(f.notes),
    },
  };
}

/** Rattachement lisible d'un contact : « ACME (compte) » ou « Sans entreprise ». */
export function rattachementContact(
  c: Pick<ContactView, 'accountName' | 'customerName' | 'companyName'>,
): string {
  return c.accountName ?? c.customerName ?? c.companyName ?? 'Sans entreprise';
}

export interface FormulaireActivite {
  kind: ActivityKind;
  subject: string;
  notes: string;
  /** `AAAA-MM-JJ` saisi ; envoyé tel quel (fin de journée à Kinshasa côté API). */
  echeance: string;
  /** ADR-0040 — C4 : assigné ; `''` (ou absent) : le créateur. */
  assigneeUserId?: string;
}

export function preparerActivite(
  f: FormulaireActivite,
  opportunityId: string | null,
): Preparation<ActivityBody> {
  const champs: Record<string, string> = {};
  if (f.subject.trim() === '') champs['subject'] = 'L’objet est obligatoire.';
  if (f.kind === 'follow_up' && f.echeance === '') {
    champs['dueAt'] = 'Une relance a une échéance.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      kind: f.kind,
      subject: f.subject.trim(),
      notes: ouNul(f.notes),
      dueAt: f.kind === 'note' || f.echeance === '' ? null : f.echeance,
      opportunityId,
      contactId: null,
      customerId: null,
      ...(f.assigneeUserId ? { assigneeUserId: f.assigneeUserId } : {}),
    },
  };
}

/** Échéance lisible : « 22 oct. 2026 » (fuseau de Kinshasa). */
export function formatEcheance(iso: string | null): string {
  if (!iso) return 'Sans échéance';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Kinshasa',
  });
}

const MESSAGES_CRM: Record<string, string> = {
  CRM_STAGE_IN_USE:
    'Une étape encore utilisée par des opportunités ne peut pas être retirée : déplacez-les d’abord.',
  CRM_STAGE_KIND_CHANGED:
    'La nature d’une étape existante ne change pas : créez une nouvelle étape à la place.',
  CRM_CONTACT_IN_USE: 'Ce contact est rattaché à des opportunités : changez leur contact d’abord.',
  CRM_OPPORTUNITY_HAS_QUOTES:
    'Des devis sont rattachés à cette opportunité : passez-la plutôt en « perdu ».',
  CSV_IMPORT_INVALID: 'Le fichier contient des erreurs : rien n’a été importé.',
  CSV_UNREADABLE: 'Le fichier CSV est illisible.',
  CRM_LOST_REASON_REQUIRED: 'Choisissez le motif de la perte : il est obligatoire.',
  CRM_LOST_REASON_IN_USE:
    'Ce motif est déjà utilisé par des opportunités perdues : désactivez-le plutôt que de le retirer.',
  CRM_OWNER_NOT_ELIGIBLE: 'Ce membre ne peut pas être responsable : il ne gère pas le CRM.',
  CRM_ASSIGNEE_NOT_ELIGIBLE: 'Ce membre ne peut pas recevoir d’activité : il ne gère pas le CRM.',
  CRM_OPPORTUNITY_HAS_NO_LINES:
    'Cette opportunité n’a pas de ligne d’articles : ajoutez-en, ou créez un devis vierge.',
  CRM_LINE_CURRENCY_MISMATCH:
    'Cet article n’est pas dans la devise de l’opportunité : aucune conversion n’est faite.',
  CRM_ACCOUNT_IN_USE:
    'Ce compte a encore des contacts, des opportunités ou des activités : fusionnez-le plutôt.',
  CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER:
    'Le nom d’un compte client vient de sa fiche client : modifiez-le dans Ventes.',
  CRM_ACCOUNT_FOLLOWS_CUSTOMER:
    'Un compte client suit sa fiche client : archivez ou réactivez la fiche dans Ventes.',
  CUSTOMER_NIF_EXISTS:
    'Une fiche client porte déjà ce NIF : rattachez plutôt le prospect à cette fiche.',
  STALE_REVISION:
    'Cet élément a été modifié par quelqu’un d’autre entre-temps : rechargez la page, puis recommencez.',
};

/** Message à afficher pour une erreur de l'API du CRM. */
export function messageCrm(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const e = err as { status?: unknown; detail?: unknown; message?: unknown };
  if (e.status === 403) return 'Votre rôle ne permet pas cette action sur le CRM.';
  const detail =
    typeof e.detail === 'object' && e.detail !== null
      ? (e.detail as Record<string, unknown>)
      : null;
  const code = typeof detail?.['code'] === 'string' ? (detail['code'] as string) : null;
  if (code && MESSAGES_CRM[code]) return MESSAGES_CRM[code]!;
  if (typeof detail?.['message'] === 'string') return detail['message'] as string;
  return repli;
}

/** Lignes refusées d'un import (`details.errors`), au format « ligne N : … ». */
export function erreursImport(err: unknown): string[] {
  const detail = (err as { detail?: { details?: { errors?: unknown } } } | null)?.detail;
  const errors = detail?.details?.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .filter(
      (e): e is { line: number; message: string } =>
        typeof e === 'object' && e !== null && 'line' in e && 'message' in e,
    )
    .map((e) => `Ligne ${e.line} : ${e.message}`);
}
