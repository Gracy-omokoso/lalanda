// Petites briques d'affichage partagées par les vues Projets (liste, Kanban,
// panneau, Mes tâches). Aucune logique : les décisions sont dans les modèles.
// Règle d'accessibilité tenue partout : la couleur n'est jamais seule — chaque
// état (priorité, échéance, blocage, jalon) porte un TEXTE ou une forme.

import { Badge, Tag } from '@lalanda/ui';
import type { WorkLabel, WorkPriority, WorkTaskView } from '@lalanda/shared/work';

import { LIBELLES_ECHEANCE, PRIORITES, etatEcheance, formatJour } from './projets-model';

export {
  Alerte,
  BOUTON,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Champ,
  aria,
} from '../../ventes/_components/form-ui';

export function Etiquettes({
  keys,
  labels,
  max,
}: {
  keys: readonly string[];
  labels: readonly WorkLabel[];
  max?: number;
}): React.ReactElement | null {
  const parCle = new Map(labels.map((l) => [l.key, l]));
  const presentes = keys.map((k) => parCle.get(k)).filter((l): l is WorkLabel => !!l);
  if (presentes.length === 0) return null;
  const montrees = max ? presentes.slice(0, max) : presentes;
  const reste = presentes.length - montrees.length;
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {montrees.map((l) => (
        <Tag key={l.key} color={l.color}>
          {l.label}
        </Tag>
      ))}
      {reste > 0 ? <span className="text-xs text-[var(--foreground-muted)]">+{reste}</span> : null}
    </span>
  );
}

export function PrioriteBadge({ priority }: { priority: WorkPriority }): React.ReactElement | null {
  if (priority === 'none') return null;
  const tone = priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone}>
      <span className="sr-only">Priorité </span>
      {PRIORITES[priority].court}
    </Badge>
  );
}

/** Échéance avec son état écrit (« En retard », « Aujourd'hui », « Bientôt »). */
export function Echeance({
  task,
  today,
  dueSoonDays,
}: {
  task: Pick<WorkTaskView, 'done' | 'dueDate' | 'isMilestone'>;
  today: string;
  dueSoonDays: number;
}): React.ReactElement | null {
  if (!task.dueDate) return null;
  const etat = etatEcheance(task, today, dueSoonDays);
  const tone = etat === 'en_retard' ? 'danger' : etat === null ? 'neutral' : 'warning';
  return (
    <Badge tone={tone}>
      {task.isMilestone ? (
        <span aria-hidden="true" title="Jalon">
          ◆
        </span>
      ) : null}
      <span className="sr-only">{task.isMilestone ? 'Jalon, échéance ' : 'Échéance '}</span>
      {formatJour(task.dueDate, false)}
      {etat ? ` · ${LIBELLES_ECHEANCE[etat]}` : null}
    </Badge>
  );
}

export function BloqueeBadge(): React.ReactElement {
  return (
    <Badge tone="warning">
      <span aria-hidden="true">⛔</span> Bloquée
    </Badge>
  );
}

/** Initiales d'un membre, doublées de son nom pour les lecteurs d'écran. */
export function Responsable({
  name,
  compact = false,
}: {
  name: string | null;
  compact?: boolean;
}): React.ReactElement {
  if (!name) {
    return <span className="text-xs text-[var(--foreground-muted)]">Sans responsable</span>;
  }
  const initiales = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join('');
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs" title={name}>
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[0.65rem] font-semibold text-[var(--accent)]"
      >
        {initiales}
      </span>
      <span className={compact ? 'sr-only' : 'truncate'}>{name}</span>
    </span>
  );
}
