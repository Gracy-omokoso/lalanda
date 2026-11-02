// Journal plateforme et sécurité de la console (ADR-0053 § 6.5 — lot P5). Fonctions pures.
//
// L'écran filtre, pagine, exporte (motif obligatoire, réservé à `platform.audit.export`)
// et montre des COMPTES de sécurité par jour. Rien n'y désigne une personne au-delà de
// l'acteur d'un geste plateforme ; rien n'y vient d'une organisation cliente.

import {
  PLATFORM_SECURITY_EVENTS,
  PLATFORM_SECURITY_EVENT_KINDS,
  PLATFORM_VIEW_REASONS,
  PLATFORM_VIEW_REASON_LABELS,
  type PlatformAction,
  type PlatformSecurityEventKind,
  type PlatformSecuritySummaryView,
  type PlatformViewReason,
} from '@lalanda/shared/platform';

import type { PlatformAuditFilters } from '@/lib/api';

import { libelleAction } from './admin-model';

export interface FiltresJournal {
  action: string;
  actorUserId: string;
  targetType: string;
  targetId: string;
  from: string;
  to: string;
}

export const FILTRES_VIDES: FiltresJournal = {
  action: '',
  actorUserId: '',
  targetType: '',
  targetId: '',
  from: '',
  to: '',
};

/** Types de cible proposés au filtre (champ libre accepté aussi côté API). */
export const TYPES_CIBLE = ['organization', 'user', 'integration', 'platform_audit'] as const;

/** Filtres saisis → filtres envoyés : champs vides retirés, espaces rognés. */
export function filtresEnvoyes(f: FiltresJournal): PlatformAuditFilters {
  const out: PlatformAuditFilters = {};
  for (const cle of Object.keys(FILTRES_VIDES) as (keyof FiltresJournal)[]) {
    const v = f[cle].trim();
    if (v !== '') out[cle] = v;
  }
  return out;
}

/** Message d'erreur de saisie, ou `null` si les filtres peuvent partir. */
export function erreurFiltres(f: FiltresJournal): string | null {
  if (f.from && f.to && f.from > f.to) return 'Le début de la période doit précéder sa fin.';
  return null;
}

export function filtresActifs(f: FiltresJournal): number {
  return Object.keys(filtresEnvoyes(f)).length;
}

/** L'export est réservé à `platform.audit.export` (super-administrateur, § 5.2). */
export function peutExporter(actions: readonly PlatformAction[]): boolean {
  return actions.includes('platform.audit.export');
}

export const MOTIFS_EXPORT: { valeur: PlatformViewReason; libelle: string }[] =
  PLATFORM_VIEW_REASONS.map((v) => ({ valeur: v, libelle: PLATFORM_VIEW_REASON_LABELS[v] }));

/** Libellés des actions propres aux lots P2 et P5, absents de la table historique. */
const LIBELLES_SUPPLEMENTAIRES: Record<string, string> = {
  'platform.audit.exported': 'Journal plateforme exporté',
  'platform.organization.viewed': 'Fiche d’organisation consultée',
  'platform.user.viewed': 'Fiche de compte consultée',
};

export function libelleActionJournal(action: string): string {
  return LIBELLES_SUPPLEMENTAIRES[action] ?? libelleAction(action);
}

/** Note de minimisation d'une ligne : « 2 champs masqués », ou `null`. */
export function noteMasquage(redactedKeys: number | undefined): string | null {
  const n = redactedKeys ?? 0;
  if (n <= 0) return null;
  return `${n} champ${n > 1 ? 's' : ''} masqué${n > 1 ? 's' : ''} (montant, adresse, ou hors liste)`;
}

// ── Sécurité ─────────────────────────────────────────────────────────────────

export interface LigneSecurite {
  kind: PlatformSecurityEventKind;
  libelle: string;
  source: 'counter' | 'audit';
  total: number;
}

/** Une ligne par nature, dans l'ordre du catalogue. */
export function lignesSecurite(s: PlatformSecuritySummaryView): LigneSecurite[] {
  return PLATFORM_SECURITY_EVENT_KINDS.map((kind) => ({
    kind,
    libelle: PLATFORM_SECURITY_EVENTS[kind].label,
    source: PLATFORM_SECURITY_EVENTS[kind].source,
    total: s.totals[kind] ?? 0,
  }));
}

/** Jours où au moins un événement a été compté, du plus récent au plus ancien. */
export function joursActifs(
  s: PlatformSecuritySummaryView,
): { day: string; total: number; detail: { libelle: string; n: number }[] }[] {
  return s.days
    .map((d) => {
      const detail = PLATFORM_SECURITY_EVENT_KINDS.filter((k) => (d.counts[k] ?? 0) > 0).map(
        (k) => ({ libelle: PLATFORM_SECURITY_EVENTS[k].label, n: d.counts[k] }),
      );
      return { day: d.day, total: detail.reduce((a, b) => a + b.n, 0), detail };
    })
    .filter((d) => d.total > 0)
    .reverse();
}

/** Ce que l'écran dit ne pas encore compter (écart documenté du lot P5). */
export const LIMITE_SECURITE =
  'Les connexions refusées au formulaire de connexion ne sont pas encore comptées : elles passent par le service d’authentification, hors des routes observées.';
