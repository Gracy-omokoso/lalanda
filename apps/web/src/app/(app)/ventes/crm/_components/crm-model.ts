// Logique pure des écrans CRM — ADR-0035 § 5.
//
// Isolée du rendu pour être testée sans DOM. Deux règles, vérifiées par un test
// qui lit cette source :
// 1. AUCUN CALCUL DE MONTANT : montants estimés, totaux par devise et
//    probabilités viennent de l'API (moteur) ; ici, mise en forme de chaînes.
// 2. RIEN N'AUTORISE : masquer un bouton est un confort, l'API reste seule juge.

import type {
  ActivityBody,
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

import { formatMontant, lireMontantSaisi } from '../../_components/sales-model';

export const CRM_BASE = '/ventes/crm';

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
  o: Pick<OpportunitySummary, 'customerName' | 'prospectName'>,
): string {
  return o.customerName ?? (o.prospectName ? `${o.prospectName} (prospect)` : '—');
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
  cible: 'client' | 'prospect';
  customerId: string;
  prospectName: string;
  contactId: string;
  montant: string;
  currency: DocumentCurrency;
  expectedCloseDate: string;
}

export function formulaireOpportunite(
  o: Partial<OpportunitySummary> | null = null,
): FormulaireOpportunite {
  return {
    title: o?.title ?? '',
    cible: o?.prospectName ? 'prospect' : 'client',
    customerId: o?.customerId ?? '',
    prospectName: o?.prospectName ?? '',
    contactId: o?.contactId ?? '',
    montant: o?.amount ? o.amount.replace('.', ',') : '',
    currency: o?.currency ?? 'CDF',
    expectedCloseDate: o?.expectedCloseDate ?? '',
  };
}

export type Preparation<C> = { ok: true; corps: C } | { ok: false; champs: Record<string, string> };

export function preparerOpportunite(f: FormulaireOpportunite): Preparation<OpportunityBody> {
  const champs: Record<string, string> = {};
  if (f.title.trim() === '') champs['title'] = 'Le titre est obligatoire.';
  if (f.cible === 'client' && f.customerId === '') champs['customerId'] = 'Choisissez un client.';
  if (f.cible === 'prospect' && f.prospectName.trim() === '') {
    champs['prospectName'] = 'Nommez le prospect.';
  }
  let amount: string | null = null;
  if (f.montant.trim() !== '') {
    const m = lireMontantSaisi(f.montant);
    if (m.ok) amount = m.valeur;
    else champs['amount'] = m.erreur;
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      title: f.title.trim(),
      customerId: f.cible === 'client' ? f.customerId : null,
      prospectName: f.cible === 'prospect' ? f.prospectName.trim() : null,
      contactId: f.contactId === '' ? null : f.contactId,
      amount,
      currency: f.currency,
      expectedCloseDate: f.expectedCloseDate === '' ? null : f.expectedCloseDate,
    },
  };
}

export interface FormulaireContact {
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  rattachement: 'client' | 'prospect';
  customerId: string;
  companyName: string;
  notes: string;
}

export function formulaireContact(c: ContactView | null = null): FormulaireContact {
  return {
    name: c?.name ?? '',
    jobTitle: c?.jobTitle ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    rattachement: c?.customerId ? 'client' : 'prospect',
    customerId: c?.customerId ?? '',
    companyName: c?.companyName ?? '',
    notes: c?.notes ?? '',
  };
}

const ouNul = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function preparerContact(f: FormulaireContact): Preparation<ContactBody> {
  const champs: Record<string, string> = {};
  if (f.name.trim() === '') champs['name'] = 'Le nom est obligatoire.';
  if (f.rattachement === 'client' && f.customerId === '') {
    champs['customerId'] = 'Choisissez le client, ou rattachez la personne à un prospect.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      name: f.name.trim(),
      jobTitle: ouNul(f.jobTitle),
      email: ouNul(f.email),
      phone: ouNul(f.phone),
      customerId: f.rattachement === 'client' ? f.customerId : null,
      companyName: f.rattachement === 'prospect' ? ouNul(f.companyName) : null,
      notes: ouNul(f.notes),
    },
  };
}

export interface FormulaireActivite {
  kind: ActivityKind;
  subject: string;
  notes: string;
  /** `AAAA-MM-JJ` saisi ; envoyé tel quel (fin de journée à Kinshasa côté API). */
  echeance: string;
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
