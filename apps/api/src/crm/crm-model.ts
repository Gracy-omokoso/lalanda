// Règles pures du CRM minimal — ADR-0035 § 2.
//
// Aucune base, aucune horloge implicite : l'instant de référence est passé en
// paramètre. Ce fichier ne manipule AUCUN montant (les sommes et probabilités
// viennent du moteur, `@lalanda/engine`).

export const STAGE_KINDS = ['open', 'won', 'lost'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export interface PipelineStage {
  key: string;
  label: string;
  kind: StageKind;
}

/** Pipeline par défaut (brief § 5.1) : Lead → Qualifié → Proposition → Négociation → Gagné/Perdu. */
export const DEFAULT_STAGES: readonly PipelineStage[] = Object.freeze([
  { key: 'lead', label: 'Lead', kind: 'open' },
  { key: 'qualified', label: 'Qualifié', kind: 'open' },
  { key: 'proposal', label: 'Proposition', kind: 'open' },
  { key: 'negotiation', label: 'Négociation', kind: 'open' },
  { key: 'won', label: 'Gagné', kind: 'won' },
  { key: 'lost', label: 'Perdu', kind: 'lost' },
]);

export const DEFAULT_STALE_AFTER_DAYS = 14;
export const MIN_STAGES = 3;
export const MAX_STAGES = 12;
export const STAGE_KEY_PATTERN = /^[a-z0-9_]{1,30}$/;

export const ACTIVITY_KINDS = ['call', 'meeting', 'note', 'follow_up'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  call: 'Appel',
  meeting: 'Réunion',
  note: 'Note',
  follow_up: 'Relance',
};

export const OPPORTUNITY_STATUSES = ['open', 'won', 'lost'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export interface StageIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Contrôle d'une configuration d'étapes : 3 à 12 étapes, clés uniques et
 * lisibles, exactement une étape « gagnée » et une « perdue », au moins une
 * étape ouverte. Tous les problèmes sont rendus, pas le premier.
 */
export function stageConfigIssues(stages: readonly PipelineStage[]): StageIssue[] {
  const issues: StageIssue[] = [];
  if (stages.length < MIN_STAGES || stages.length > MAX_STAGES) {
    issues.push({
      path: 'stages',
      code: 'STAGE_COUNT_INVALID',
      message: `De ${MIN_STAGES} à ${MAX_STAGES} étapes.`,
    });
  }
  const seen = new Set<string>();
  stages.forEach((s, i) => {
    if (!STAGE_KEY_PATTERN.test(s.key)) {
      issues.push({
        path: `stages.${i}.key`,
        code: 'STAGE_KEY_INVALID',
        message: 'Clé : minuscules, chiffres et « _ », 30 caractères au plus.',
      });
    } else if (seen.has(s.key)) {
      issues.push({
        path: `stages.${i}.key`,
        code: 'STAGE_KEY_DUPLICATE',
        message: `La clé « ${s.key} » est déjà utilisée.`,
      });
    }
    seen.add(s.key);
    const label = s.label.trim();
    if (label === '' || label.length > 40) {
      issues.push({
        path: `stages.${i}.label`,
        code: 'STAGE_LABEL_INVALID',
        message: 'Libellé : 1 à 40 caractères.',
      });
    }
  });
  const count = (k: StageKind) => stages.filter((s) => s.kind === k).length;
  if (count('won') !== 1) {
    issues.push({
      path: 'stages',
      code: 'STAGE_WON_REQUIRED',
      message: 'Exactement une étape « gagnée ».',
    });
  }
  if (count('lost') !== 1) {
    issues.push({
      path: 'stages',
      code: 'STAGE_LOST_REQUIRED',
      message: 'Exactement une étape « perdue ».',
    });
  }
  if (count('open') < 1) {
    issues.push({
      path: 'stages',
      code: 'STAGE_OPEN_REQUIRED',
      message: 'Au moins une étape en cours.',
    });
  }
  return issues;
}

/** Changements interdits quand une étape est utilisée : retrait, changement de nature. */
export function stageChangeConflicts(
  before: readonly PipelineStage[],
  after: readonly PipelineStage[],
  used: ReadonlySet<string>,
): { removed: string[]; kindChanged: string[] } {
  const next = new Map(after.map((s) => [s.key, s]));
  const removed: string[] = [];
  const kindChanged: string[] = [];
  for (const s of before) {
    const n = next.get(s.key);
    if (!n) {
      if (used.has(s.key)) removed.push(s.key);
    } else if (n.kind !== s.kind) {
      kindChanged.push(s.key);
    }
  }
  return { removed, kindChanged };
}

const DAY_MS = 86_400_000;

/** Jours entiers écoulés depuis `since` (plancher), jamais négatif. */
export function daysSince(since: Date, now: Date): number {
  const ms = now.getTime() - since.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / DAY_MS);
}

/** Opportunité ouverte sans activité depuis `staleAfterDays` jours ou plus. */
export function isStale(
  status: OpportunityStatus,
  lastActivityAt: Date,
  staleAfterDays: number,
  now: Date,
): boolean {
  return status === 'open' && daysSince(lastActivityAt, now) >= staleAfterDays;
}

/** Activité non faite dont l'échéance est passée. */
export function isOverdue(done: boolean, dueAt: Date | null, now: Date): boolean {
  return !done && dueAt !== null && dueAt.getTime() < now.getTime();
}

const KINSHASA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Kinshasa',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Jour civil `AAAA-MM-JJ` à Kinshasa (UTC+1, sans heure d'été). */
export function kinshasaDay(at: Date): string {
  return KINSHASA_DAY.format(at);
}

/** `AAAA-MM-JJ` + `days` jours (calendrier grégorien, sans fuseau). */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Jour civil réel `AAAA-MM-JJ` (le 31 février est refusé). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ── ADR-0040 — C2 : pipeline v2 ─────────────────────────────────────────────

/** Motif de perte paramétrable (ADR-0040 § 2.5). */
export interface LostReason {
  key: string;
  label: string;
  active: boolean;
}

export const LOST_REASON_KEY_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const MAX_LOST_REASONS = 30;

/** Six motifs par défaut (décision ouverte n° 7, valeur retenue par la dirigeante). */
export const DEFAULT_LOST_REASONS: readonly LostReason[] = Object.freeze([
  { key: 'price', label: 'Prix', active: true },
  { key: 'competitor', label: 'Concurrent retenu', active: true },
  { key: 'no_budget', label: 'Pas de budget', active: true },
  { key: 'no_response', label: 'Sans réponse', active: true },
  { key: 'need_dropped', label: 'Besoin abandonné', active: true },
  { key: 'other', label: 'Autre', active: true },
]);

/** Origine du montant estimé d'une opportunité (§ 2.3). */
export const AMOUNT_SOURCES = ['manual', 'lines'] as const;
export type AmountSource = (typeof AMOUNT_SOURCES)[number];

/** Au plus 50 lignes par opportunité (§ 2.3). */
export const MAX_OPPORTUNITY_LINES = 50;

/** Problèmes d'une liste de motifs : clés uniques et bien formées, libellés 1–60. */
export function lostReasonIssues(reasons: readonly LostReason[]): StageIssue[] {
  const issues: StageIssue[] = [];
  const seen = new Set<string>();
  reasons.forEach((r, i) => {
    if (!LOST_REASON_KEY_PATTERN.test(r.key)) {
      issues.push({
        path: `lostReasons.${i}.key`,
        code: 'LOST_REASON_KEY_INVALID',
        message: 'Clé : 1 à 32 caractères a-z, 0-9, « _ » ou « - ».',
      });
    } else if (seen.has(r.key)) {
      issues.push({
        path: `lostReasons.${i}.key`,
        code: 'LOST_REASON_KEY_DUPLICATE',
        message: `Clé en double : « ${r.key} ».`,
      });
    }
    seen.add(r.key);
    if (r.label.length < 1 || r.label.length > 60) {
      issues.push({
        path: `lostReasons.${i}.label`,
        code: 'LOST_REASON_LABEL_INVALID',
        message: 'Libellé : 1 à 60 caractères.',
      });
    }
  });
  return issues;
}
