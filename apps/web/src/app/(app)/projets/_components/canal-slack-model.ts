// Canal Slack d'un projet — règles d'écran pures (ADR-0064 § 3), testées.

import type { StatusTone } from '@lalanda/ui';
import type { WorkProjectSlackChannelView } from '@lalanda/shared/work';

/** État affiché du canal d'un projet, et l'avertissement éventuel. */
export function etatCanalSlack(v: WorkProjectSlackChannelView): {
  ton: StatusTone;
  libelle: string;
  avertissement: string | null;
} {
  if (!v.connected) return { ton: 'draft', libelle: 'Slack non connecté', avertissement: null };
  if (!v.channel) return { ton: 'draft', libelle: 'Aucun canal', avertissement: null };
  if (v.publishing) return { ton: 'ok', libelle: 'Publie', avertissement: null };
  if (v.projectPrivate && !v.channel.privateConfirmed) {
    return {
      ton: 'wait',
      libelle: 'En pause',
      avertissement:
        'Le projet est devenu privé : le canal ne reçoit plus rien tant que vous n’avez pas confirmé à nouveau.',
    };
  }
  return { ton: 'wait', libelle: 'En pause', avertissement: null };
}

/** Identifiant de canal public saisi (`C…`, majuscules), ou `null` s'il n'en est pas un. */
export function valeurCanalSaisi(v: string): string | null {
  const t = v.trim().toUpperCase();
  return /^C[A-Z0-9]{6,20}$/.test(t) ? t : null;
}
