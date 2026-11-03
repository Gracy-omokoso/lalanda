// Étiquette de statut d'un document (ADR-0056) : pastille compacte de tableau,
// 22 px, un point de couleur ET un libellé écrit (la couleur n'est jamais seule).
// Tons fermés, sur les jetons d'étiquettes et d'accent : jamais un code libre.

import { cn } from '../utils.js';

export type StatusTone = 'ok' | 'open' | 'late' | 'wait' | 'draft';

const TONS: Record<StatusTone, { bg: string; fg: string; dot: string }> = {
  ok: { bg: 'var(--label-green-bg)', fg: 'var(--label-green-fg)', dot: 'var(--label-green-dot)' },
  open: { bg: 'var(--accent-soft)', fg: 'var(--accent)', dot: 'var(--accent)' },
  late: { bg: 'var(--label-red-bg)', fg: 'var(--label-red-fg)', dot: 'var(--label-red-dot)' },
  wait: {
    bg: 'var(--label-yellow-bg)',
    fg: 'var(--label-yellow-fg)',
    dot: 'var(--label-yellow-dot)',
  },
  draft: { bg: 'var(--label-gray-bg)', fg: 'var(--label-gray-fg)', dot: 'var(--label-gray-dot)' },
};

export function StatusPill({
  tone,
  children,
  title,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}): React.ReactElement {
  const t = TONS[tone];
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2 text-xs font-medium',
        className,
      )}
      style={{ background: t.bg, color: t.fg }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: t.dot }}
      />
      <span className="truncate">{children}</span>
    </span>
  );
}
