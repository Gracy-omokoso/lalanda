// Étiquette colorée (ADR-0039 § 2.1) : palette FERMÉE (`TAG_COLORS`), jamais un
// code couleur libre. Lisible par un daltonien : la couleur n'est jamais seule —
// le libellé est toujours écrit, et le repère change de FORME d'une couleur à
// l'autre (rond, carré, triangle…), si bien que deux étiquettes de teintes
// voisines se distinguent même sans percevoir la teinte.

import type { TagColor } from '../tokens.js';
import { cn } from '../utils.js';

/** Forme du repère, une par couleur. */
const FORMES: Record<TagColor, React.ReactNode> = {
  gray: <circle cx="5" cy="5" r="3.5" />,
  red: <rect x="1.5" y="1.5" width="7" height="7" />,
  orange: <path d="M5 1 9 9H1Z" />,
  yellow: <path d="M5 .8 9.2 5 5 9.2.8 5Z" />,
  green: <path d="M5 9 1 1h8Z" />,
  teal: <path d="M3 1h4l2.5 4L7 9H3L.5 5Z" />,
  blue: <rect x="1" y="2.5" width="8" height="5" rx="1" />,
  purple: <path d="M5 .8 6.3 3.7 9.3 4 7 6.1 7.7 9.2 5 7.6 2.3 9.2 3 6.1.7 4l3-.3Z" />,
  pink: <path d="M5 9 1.3 5.2A2.2 2.2 0 0 1 5 2.4a2.2 2.2 0 0 1 3.7 2.8Z" />,
};

export function Tag({
  color,
  children,
  className,
  title,
}: {
  color: TagColor;
  children: React.ReactNode;
  className?: string;
  title?: string;
}): React.ReactElement {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{
        background: `var(--label-${color}-bg)`,
        color: `var(--label-${color}-fg)`,
      }}
    >
      <svg
        viewBox="0 0 10 10"
        width={10}
        height={10}
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
        style={{ fill: `var(--label-${color}-dot)` }}
      >
        {FORMES[color]}
      </svg>
      <span className="truncate">{children}</span>
    </span>
  );
}
