// Petites briques d'affichage partagées par les vues Projets (liste, Kanban,
// panneau, Mes tâches). Aucune logique : les décisions sont dans les modèles.
// Règle d'accessibilité tenue partout : la couleur n'est jamais seule — chaque
// état (priorité, échéance, blocage, jalon) porte un TEXTE ou une forme.

import { Badge, Tag } from '@lalanda/ui';
import type { WorkLabel, WorkPriority, WorkTaskView } from '@lalanda/shared/work';

import { badgeAbsent, constatAbsentEcheance } from './absences-model';
import { initiales, pileAvatars, teinteAvatar, tonDate, type TonDate } from './liste-model';
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

/**
 * ADR-0045 — H5 (§ 6.2) : badge « Absent » de l'assigné et constat « absent à
 * l'échéance ». Des jours seulement, jamais le type d'absence ; texte et signe, pas
 * seulement une couleur.
 */
export function AbsenceBadges({
  t,
  details = false,
}: {
  t: Pick<WorkTaskView, 'assigneeAbsence' | 'dueDateAbsence' | 'done' | 'assignee'>;
  /** Phrase complète du constat (panneau), sinon pastille courte (listes). */
  details?: boolean;
}): React.ReactElement | null {
  const absent = t.assigneeAbsence ?? null;
  const echeance = t.done ? null : (t.dueDateAbsence ?? null);
  if (absent === null && echeance === null) return null;
  return (
    <>
      {absent ? (
        <span title={badgeAbsent(absent).complet}>
          <Badge tone="neutral">
            <span aria-hidden="true">⊘</span>{' '}
            <span className="sr-only">{badgeAbsent(absent).complet}</span>
            <span aria-hidden="true">{badgeAbsent(absent).court}</span>
          </Badge>
        </span>
      ) : null}
      {echeance ? (
        details ? (
          <p role="note" className="text-xs text-[var(--warning)]">
            <span aria-hidden="true">⚠</span>{' '}
            {constatAbsentEcheance(echeance, t.assignee?.name ?? null)}
          </p>
        ) : (
          <span title={constatAbsentEcheance(echeance, t.assignee?.name ?? null)}>
            <Badge tone="warning">
              <span aria-hidden="true">⚠</span> Absent à l’échéance
            </Badge>
          </span>
        )
      ) : null}
    </>
  );
}

// ─── Atomes « façon Asana » (ADR-0057) ──────────────────────────────────────

/**
 * Avatar rond aux initiales, teinte stable par membre (paires `--label-*`).
 * Le nom est toujours donné (`title` et texte masqué) : la couleur n'est jamais seule.
 */
export function Avatar({
  name,
  cle,
  taille = 24,
  className = '',
}: {
  name: string;
  /** Identifiant stable (userId) ; à défaut, le nom. */
  cle?: string;
  taille?: 20 | 24 | 28 | 32;
  className?: string;
}): React.ReactElement {
  const t = teinteAvatar(cle ?? name);
  const police = taille <= 20 ? 'text-[0.6rem]' : taille <= 24 ? 'text-[0.65rem]' : 'text-xs';
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${police} ${className}`}
      style={{
        width: taille,
        height: taille,
        background: `var(--label-${t}-bg)`,
        color: `var(--label-${t}-fg)`,
      }}
    >
      <span aria-hidden="true">{initiales(name)}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** Pile d'avatars qui se chevauchent, puis « +n ». */
export function PileAvatars({
  membres,
  max = 5,
  taille = 28,
}: {
  membres: readonly { userId: string; name: string }[];
  max?: number;
  taille?: 24 | 28 | 32;
}): React.ReactElement | null {
  if (membres.length === 0) return null;
  const { montres, reste } = pileAvatars(membres, max);
  return (
    <span className="flex items-center">
      {montres.map((m, i) => (
        <Avatar
          key={m.userId}
          name={m.name}
          cle={m.userId}
          taille={taille}
          className={`ring-2 ring-[var(--background)] ${i > 0 ? '-ml-1' : ''}`}
        />
      ))}
      {reste > 0 ? (
        <span
          className="-ml-1 inline-flex items-center justify-center rounded-full bg-[var(--surface-muted)] text-xs font-medium text-[var(--foreground-muted)] ring-2 ring-[var(--background)]"
          style={{ width: taille, height: taille }}
          title={`${reste} autre${reste > 1 ? 's' : ''} membre${reste > 1 ? 's' : ''}`}
        >
          +{reste}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Cercle à cocher : terminer en un clic. Coche dessinée en 180 ms
 * (`--motion-base`), fond qui passe au vert ; aucune animation sous
 * `prefers-reduced-motion` (règle globale). Pas de confettis.
 */
export function CercleCoche({
  coche,
  label,
  disabled,
  onClick,
  taille = 18,
}: {
  coche: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  taille?: 16 | 18 | 22;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={coche}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`group/coche inline-flex shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color] duration-[var(--motion-base)] ease-[var(--ease-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] disabled:cursor-default ${
        coche
          ? 'border-[var(--ok)] bg-[var(--ok)] text-[var(--surface)]'
          : 'border-[var(--border-strong)] bg-transparent text-[var(--foreground-muted)] enabled:hover:border-[var(--ok)] enabled:hover:text-[var(--ok)]'
      }`}
      style={{ width: taille, height: taille }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-[70%] w-[70%]">
        <path
          d="M3.5 8.5 6.5 11.5 12.5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          className={`transition-[stroke-dashoffset,opacity] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
            coche
              ? '[stroke-dashoffset:0]'
              : '[stroke-dashoffset:1] opacity-70 group-enabled/coche:group-hover/coche:[stroke-dashoffset:0]'
          }`}
        />
      </svg>
    </button>
  );
}

const TONS_DATE: Record<TonDate, string> = {
  retard: 'text-[var(--danger)] font-medium',
  aujourdhui: 'text-[var(--ok)] font-medium',
  demain: 'text-[var(--ok)]',
  normal: 'text-[var(--foreground-muted)]',
  terminee: 'text-[var(--foreground-muted)]',
};

/** Échéance compacte d'une ligne : « Aujourd'hui », « Demain », « 12 nov. » ; rouge en retard. */
export function DateEcheance({
  task,
  today,
}: {
  task: Pick<WorkTaskView, 'done' | 'dueDate' | 'isMilestone'>;
  today: string;
}): React.ReactElement | null {
  const ton = tonDate(task, today);
  if (ton === null || !task.dueDate) return null;
  const texte =
    ton === 'aujourdhui'
      ? 'Aujourd’hui'
      : ton === 'demain'
        ? 'Demain'
        : formatJour(task.dueDate, task.dueDate.slice(0, 4) !== today.slice(0, 4));
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${TONS_DATE[ton]}`}>
      {task.isMilestone ? (
        <span aria-hidden="true" title="Jalon">
          ◆
        </span>
      ) : null}
      <span className="sr-only">{task.isMilestone ? 'Jalon, échéance ' : 'Échéance '}</span>
      {texte}
      {ton === 'retard' ? <span className="sr-only"> (en retard)</span> : null}
    </span>
  );
}
