// Icônes des trois modules (ADR-0038 § 4, révisé le 29 oct. 2026).
//
// Tirées de Lucide (`lucide-react`, licence ISC), la bibliothèque d'icônes
// outline de l'application : viewBox 24 × 24, trait `currentColor`, extrémités
// et jonctions arrondies.
//
//   BUILD — Sprout : l'idée qui germe, ce que l'on conçoit.
//   RUN   — Orbit  : ce qui tourne au quotidien.
//   GROW  — Rocket : ce qui décolle.
//
// Décoratives (`aria-hidden`) : le nom du module est toujours écrit à côté, ou
// porté par l'`aria-label` du contrôle qui les contient.

import { Orbit, Rocket, Sprout, type LucideIcon } from 'lucide-react';

import { cn } from '../utils.js';
import type { ModuleId } from './modules.js';

const ICONES: Record<ModuleId, LucideIcon> = {
  build: Sprout,
  run: Orbit,
  grow: Rocket,
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
  const Icone = ICONES[module];
  return (
    <Icone
      size={24}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
      data-module={module}
      className={cn('shrink-0', className)}
    />
  );
}

/** Classe de couleur du module (texte), écrite en entier pour Tailwind. */
export const COULEUR_ICONE_MODULE: Readonly<Record<ModuleId, string>> = {
  build: 'text-[var(--module-build)]',
  run: 'text-[var(--module-run)]',
  grow: 'text-[var(--module-grow)]',
};
