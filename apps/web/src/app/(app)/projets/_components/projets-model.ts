// Logique pure des écrans Projets (ADR-0039 § 8) — module `work` du RUN.
//
// Même discipline que `nav-model.ts` : ce qui DÉCIDE vit ici et se teste sans
// DOM (vitest, environnement node) ; les `.tsx` assemblent. Deux règles :
// 1. RIEN N'AUTORISE : masquer un bouton est un confort, l'API reste seule juge
//    (`PermissionsGuard`, ADR-0012 § 8). Les conditions sont des ACTIONS servies
//    par `GET /me/permissions`, jamais un nom de rôle.
// 2. AUCUN MONTANT : ce lot n'affiche ni coût ni marge (lot L4a).
//
// Vocabulaire : « Projet » = `WorkProject` ; à ne pas confondre avec `project.*`
// (le plan BUILD, affiché « Initiative », ADR-0038).

import {
  CreateWorkProjectBody,
  WORK_LIMITS,
  kinshasaDayOf,
  type WorkColumnCategory,
  type WorkPriority,
  type WorkProjectKind,
  type WorkProjectStatus,
} from '@lalanda/shared/work';

import type { OrgAction } from '@/lib/api';

export const PROJETS_BASE = '/projets';
export const MES_TACHES_HREF = '/projets/mes-taches';

/** Paramètre de requête du panneau de tâche (`?tache=<id>`, ADR-0039 § 8). */
export const PARAM_TACHE = 'tache';

// ─── Permissions (confort d'affichage) ──────────────────────────────────────

export function peutLire(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('work.read');
}

/** Créer, modifier, déplacer, commenter, joindre, saisir son temps. */
export function peutTravailler(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('work.update');
}

/** Créer, archiver, supprimer un projet ; colonnes, étiquettes, réglages. */
export function peutGerer(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('work.manage');
}

// ─── Chemins ────────────────────────────────────────────────────────────────

export function hrefProjet(projectId: string, onglet = 'liste'): string {
  return `${PROJETS_BASE}/${encodeURIComponent(projectId)}/${onglet}`;
}

/**
 * Lien vers une tâche : le panneau s'ouvre par `?tache=` sur l'onglet donné.
 * Même forme que le `href` des notifications (`/projets/<id>?tache=<id>`,
 * § 2.11) — `/projets/<id>` redirige vers `liste` en gardant la requête.
 */
export function hrefTache(projectId: string, taskId: string, onglet = 'liste'): string {
  return `${hrefProjet(projectId, onglet)}?${PARAM_TACHE}=${encodeURIComponent(taskId)}`;
}

// ─── Libellés ───────────────────────────────────────────────────────────────

export const STATUTS_PROJET: Record<WorkProjectStatus, string> = {
  active: 'Actif',
  on_hold: 'En pause',
  completed: 'Terminé',
  archived: 'Archivé',
};

export const NATURES_PROJET: Record<WorkProjectKind, string> = {
  client: 'Projet client',
  internal: 'Projet interne',
};

/** Priorité : libellé et repère TEXTUEL (la couleur n'est jamais seule). */
export const PRIORITES: Record<WorkPriority, { label: string; court: string }> = {
  none: { label: 'Aucune', court: '' },
  low: { label: 'Basse', court: 'Basse' },
  medium: { label: 'Moyenne', court: 'Moyenne' },
  high: { label: 'Haute', court: 'Haute ▲' },
  urgent: { label: 'Urgente', court: 'Urgente ▲▲' },
};

export const CATEGORIES_COLONNE: Record<WorkColumnCategory, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  done: 'Terminé',
};

// ─── Dates et durées ────────────────────────────────────────────────────────

/** Jour de Kinshasa d'aujourd'hui (ADR-0027) — seul appel à l'horloge, isolé. */
export function aujourdhui(now: Date = new Date()): string {
  return kinshasaDayOf(now);
}

const MOIS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/**
 * Date civile `AAAA-MM-JJ` en français (« 3 nov. 2026 »), SANS passer par le
 * fuseau du navigateur : un `new Date('2026-11-03')` lu à Kinshasa donnerait le
 * bon jour, mais à Los Angeles la veille. `null` → tiret.
 */
export function formatJour(day: string | null, avecAnnee = true): string {
  if (!day) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return '—';
  const mois = MOIS[Number(m[2]) - 1];
  if (!mois) return '—';
  return `${Number(m[3])} ${mois}${avecAnnee ? ` ${m[1]}` : ''}`;
}

/** Horodatage ISO en français, date et heure de Kinshasa. */
export function formatInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Kinshasa',
  });
}

/** 90 → « 1 h 30 » ; 45 → « 45 min » ; 120 → « 2 h ». */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/**
 * Lit une durée saisie : « 90 » (minutes), « 1h30 », « 1 h 30 », « 2h »,
 * « 1,5 h », « 45 min ». Rend des minutes entières dans [1, 1 440], ou `null`.
 */
export function lireDuree(saisie: string): number | null {
  const s = saisie.trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
  if (s === '') return null;
  let minutes: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,4})(?:min|mn|m)?$/.exec(s))) minutes = Number(m[1]);
  else if ((m = /^(\d{1,2})h(\d{1,2})?(?:min|mn|m)?$/.exec(s)))
    minutes = Number(m[1]) * 60 + Number(m[2] ?? 0);
  else if ((m = /^(\d{1,2}(?:\.\d{1,2})?)h$/.exec(s))) minutes = Math.round(Number(m[1]) * 60);
  if (minutes === null || !Number.isInteger(minutes)) return null;
  if (minutes < WORK_LIMITS.timeEntryMinutesMin || minutes > WORK_LIMITS.minutesPerDayMax) {
    return null;
  }
  return minutes;
}

export type EtatEcheance = 'en_retard' | 'aujourdhui' | 'bientot' | null;

/**
 * État d'échéance d'une tâche NON terminée, lu au jour de Kinshasa : en retard,
 * aujourd'hui, ou dans `dueSoonDays` jours. Toujours doublé d'un texte.
 */
export function etatEcheance(
  t: { done: boolean; dueDate: string | null },
  today: string,
  dueSoonDays: number = WORK_LIMITS.dueSoonDaysDefault,
): EtatEcheance {
  if (t.done || t.dueDate === null) return null;
  if (t.dueDate < today) return 'en_retard';
  if (t.dueDate === today) return 'aujourdhui';
  const fin = new Date(`${today}T00:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + Math.max(0, dueSoonDays));
  return t.dueDate <= fin.toISOString().slice(0, 10) ? 'bientot' : null;
}

export const LIBELLES_ECHEANCE: Record<Exclude<EtatEcheance, null>, string> = {
  en_retard: 'En retard',
  aujourdhui: 'Aujourd’hui',
  bientot: 'Bientôt',
};

/** « 3 / 10 tâches terminées » ; rien si le projet n'a aucune tâche. */
export function progression(p: { openTaskCount: number; doneTaskCount: number }): {
  texte: string;
  pourcent: number;
} {
  const total = p.openTaskCount + p.doneTaskCount;
  if (total === 0) return { texte: 'Aucune tâche', pourcent: 0 };
  return {
    texte: `${p.doneTaskCount} / ${total} tâche${total > 1 ? 's' : ''} terminée${total > 1 ? 's' : ''}`,
    pourcent: Math.round((p.doneTaskCount / total) * 100),
  };
}

// ─── Erreurs ────────────────────────────────────────────────────────────────

const MESSAGES_WORK: Record<string, string> = {
  FORBIDDEN: 'Votre rôle ne permet pas cette action sur les projets.',
  NO_ORGANIZATION: 'Aucune organisation active. Créez-en une ou acceptez une invitation.',
  STALE_REVISION:
    'Quelqu’un a modifié cet élément entre-temps. La vue a été rechargée : refaites votre geste.',
  WORK_DATES_INVERTED: 'L’échéance précède la date de début.',
  WORK_MILESTONE_NEEDS_DATE: 'Un jalon exige une échéance.',
  WORK_MILESTONE_HAS_START: 'Un jalon n’a pas de date de début.',
  WORK_SUBTASK_DEPTH: 'Une sous-tâche ne peut pas avoir elle-même de sous-tâche.',
  WORK_ASSIGNEE_NOT_ELIGIBLE: 'Ce membre ne peut pas être responsable d’une tâche.',
  WORK_MENTION_NOT_ELIGIBLE: 'Une personne mentionnée n’a pas accès aux projets.',
  WORK_DEPENDENCY_CYCLE:
    'Cette dépendance fermerait une boucle : une tâche s’attendrait elle-même.',
  WORK_PROJECT_ARCHIVED: 'Ce projet est archivé : restaurez-le pour le modifier.',
  WORK_PROJECT_LIMIT: 'Limite technique atteinte : 500 projets non archivés.',
  WORK_TASK_LIMIT: 'Limite technique atteinte : 5 000 tâches dans ce projet.',
  WORK_TASK_HAS_TIME:
    'Du temps est saisi sur cette tâche : terminez-la plutôt que de la supprimer.',
  WORK_TASK_HAS_INVOICE:
    'Une facture est préparée pour ce jalon : terminez-le plutôt que de le supprimer.',
  WORK_PROJECT_NOT_EMPTY:
    'Ce projet porte du temps, une facture ou une dépense : archivez-le plutôt.',
  WORK_COLUMN_IN_USE: 'Cette colonne porte des tâches : déplacez-les avant de la retirer.',
  WORK_COLUMN_CATEGORY_CHANGED:
    'Cette colonne porte des tâches : sa catégorie ne peut pas changer.',
  WORK_COLUMNS_INVALID:
    'Il faut 2 à 12 colonnes, au moins une « à faire » et une seule « terminé ».',
  WORK_LABEL_IN_USE: 'Cette étiquette est posée sur des tâches : retirez-la d’abord.',
  WORK_TIME_IN_FUTURE: 'On ne saisit pas de temps pour un jour à venir.',
  WORK_TIME_DAY_OVERFLOW: 'Une journée compte 24 heures au plus pour une personne.',
  WORK_TIME_FOR_OTHER: 'Saisir le temps d’un autre membre est réservé aux gestionnaires.',
  WORK_ATTACHMENT_TYPE: 'Type de fichier refusé : images PNG, JPEG, WebP ou PDF seulement.',
  WORK_STORAGE_FULL: 'Espace des pièces jointes plein (1 Gio par organisation).',
  PAYLOAD_TOO_LARGE: 'Fichier trop lourd : 2 Mio pour une image, 10 Mio pour un PDF.',
  TOO_MANY_REQUESTS: 'Trop d’envois en une heure. Réessayez plus tard.',
  INVALID_REQUEST: 'Certaines valeurs sont refusées. Vérifiez les champs signalés.',
};

function detailDe(err: unknown): Record<string, unknown> | null {
  if (typeof err !== 'object' || err === null || !('detail' in err)) return null;
  const d = (err as { detail: unknown }).detail;
  if (typeof d !== 'object' || d === null) return null;
  // Deux formes tolérées : `{ code, message }` (contrôleurs existants) et
  // `{ error: { code, message } }` (format écrit dans l'ADR-0039 § 4).
  const inner = (d as { error?: unknown }).error;
  return typeof inner === 'object' && inner !== null
    ? (inner as Record<string, unknown>)
    : (d as Record<string, unknown>);
}

export function codeWork(err: unknown): string | null {
  const code = detailDe(err)?.['code'];
  return typeof code === 'string' ? code : null;
}

export function statutHttp(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

/** Message français d'un échec ; le repli si rien n'est lisible. */
export function messageWork(err: unknown, repli: string): string {
  const status = statutHttp(err);
  const code = codeWork(err);
  if (code && MESSAGES_WORK[code]) return MESSAGES_WORK[code]!;
  if (status === 403) return MESSAGES_WORK['FORBIDDEN']!;
  if (status === 404) return 'Introuvable : l’élément a peut-être été supprimé.';
  if (status === 413) return MESSAGES_WORK['PAYLOAD_TOO_LARGE']!;
  if (status === 415) return MESSAGES_WORK['WORK_ATTACHMENT_TYPE']!;
  if (status === 429) return MESSAGES_WORK['TOO_MANY_REQUESTS']!;
  const message = detailDe(err)?.['message'];
  return typeof message === 'string' ? message : repli;
}

// ─── Formulaire de projet ───────────────────────────────────────────────────

export interface FormulaireProjet {
  name: string;
  description: string;
  kind: WorkProjectKind;
  ownerUserId: string;
  startDate: string;
  dueDate: string;
  customerId: string;
  opportunityId: string;
  quoteId: string;
}

export function formulaireProjet(): FormulaireProjet {
  return {
    name: '',
    description: '',
    kind: 'client',
    ownerUserId: '',
    startDate: '',
    dueDate: '',
    customerId: '',
    opportunityId: '',
    quoteId: '',
  };
}

const vide = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Corps de `POST /work/projects`, validé par le MÊME schéma que le serveur
 * (`CreateWorkProjectBody`, `@lalanda/shared/work`). Erreurs par champ.
 * Les liens client / opportunité / devis ne sont posés que pour un projet client.
 */
export function preparerProjet(
  f: FormulaireProjet,
): { ok: true; corps: CreateWorkProjectBody } | { ok: false; champs: Record<string, string> } {
  const client = f.kind === 'client';
  const brut = {
    name: f.name,
    description: vide(f.description),
    kind: f.kind,
    ownerUserId: vide(f.ownerUserId),
    startDate: vide(f.startDate),
    dueDate: vide(f.dueDate),
    ...(client
      ? {
          links: {
            customerId: vide(f.customerId),
            opportunityId: vide(f.opportunityId),
            quoteIds: vide(f.quoteId) ? [f.quoteId.trim()] : [],
          },
        }
      : {}),
  };
  const r = CreateWorkProjectBody.safeParse(brut);
  if (r.success) return { ok: true, corps: r.data };
  const champs: Record<string, string> = {};
  for (const iss of r.error.issues) {
    const cle =
      iss.path[0] === 'links'
        ? String(iss.path[1] ?? 'links')
        : String(iss.path[0] ?? 'formulaire');
    champs[cle === 'quoteIds' ? 'quoteId' : cle] ??= iss.message;
  }
  return { ok: false, champs };
}

// ─── Clés stables (colonnes, étiquettes) ────────────────────────────────────

/**
 * Clé stable tirée d'un libellé (`^[a-z0-9_-]{1,32}$`, ADR-0039 § 2.1),
 * unique parmi `existantes` : « En revue client » → `en-revue-client`, puis
 * `en-revue-client-2`… Une clé ne change plus une fois posée (les tâches la
 * portent) ; seul le libellé se renomme.
 */
export function cleDepuisLibelle(libelle: string, existantes: readonly string[]): string {
  const base =
    libelle
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'cle';
  if (!existantes.includes(base)) return base;
  for (let i = 2; ; i += 1) {
    const c = `${base}-${i}`;
    if (!existantes.includes(c)) return c;
  }
}
