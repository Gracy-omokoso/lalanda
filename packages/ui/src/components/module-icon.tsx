// Icônes des trois modules (ADR-0038 § 4).
//
// Dessinées à la main, dans le style outline des icônes de navigation de
// l'application : viewBox 24 × 24, trait `currentColor` de 1,75, extrémités et
// jonctions arrondies. Aucune bibliothèque : trois tracés suffisent.
//
//   BUILD — blocs empilés : la fondation sur laquelle on construit.
//   RUN   — engrenage : la machine qui tourne au quotidien.
//   GROW  — pousse sur une courbe montante : ce qui croît.
//
// Décoratives (`aria-hidden`) : le nom du module est toujours écrit à côté, ou
// porté par l'`aria-label` du contrôle qui les contient.

import { cn } from '../utils.js';
import type { ModuleId } from './modules.js';

const TRACES: Record<ModuleId, React.ReactNode> = {
  build: (
    <>
      <rect x="3" y="15" width="18" height="5" rx="1" />
      <rect x="6" y="9.5" width="12" height="4.5" rx="1" />
      <rect x="9" y="4" width="6" height="4.5" rx="1" />
    </>
  ),
  run: (
    <>
      {/* Huit dents, rayon intérieur 7, extérieur 9,5. */}
      <path d="M18.55 9.53 L21.31 10.11 L21.31 13.89 L18.55 14.47 L18.38 14.89 L19.92 17.25 L17.25 19.92 L14.89 18.38 L14.47 18.55 L13.89 21.31 L10.11 21.31 L9.53 18.55 L9.11 18.38 L6.75 19.92 L4.08 17.25 L5.62 14.89 L5.45 14.47 L2.69 13.89 L2.69 10.11 L5.45 9.53 L5.62 9.11 L4.08 6.75 L6.75 4.08 L9.11 5.62 L9.53 5.45 L10.11 2.69 L13.89 2.69 L14.47 5.45 L14.89 5.62 L17.25 4.08 L19.92 6.75 L18.38 9.11Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  grow: (
    <>
      {/* La courbe qui monte, de gauche à droite. */}
      <path d="M3 20c6 0 11-2.5 18-8" />
      {/* La tige, plantée sur la courbe, et ses deux feuilles. */}
      <path d="M11 18.6V10" />
      <path d="M11 13.5c-3.5 0-5.5-2-5.5-5 3 0 5.5 2 5.5 5Z" />
      <path d="M11 11c0-3 2-5 5.5-5 0 3-2 5-5.5 5Z" />
    </>
  ),
};

/** Icône d'un module, dans la couleur du texte courant (`currentColor`). */
export function ModuleIcon({
  module,
  className,
  strokeWidth = 1.75,
}: {
  module: ModuleId;
  className?: string;
  /** Trait plus fin pour les grands formats (cartes de l'accueil). */
  strokeWidth?: number;
}): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-module={module}
      className={cn('shrink-0', className)}
    >
      {TRACES[module]}
    </svg>
  );
}

/** Classe de couleur du module (texte), écrite en entier pour Tailwind. */
export const COULEUR_ICONE_MODULE: Readonly<Record<ModuleId, string>> = {
  build: 'text-[var(--module-build)]',
  run: 'text-[var(--module-run)]',
  grow: 'text-[var(--module-grow)]',
};
