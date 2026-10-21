// Modules BUILD · RUN · GROW et natures de données (ADR-0018, ADR-0030 § 4).
//
// La couleur d'une nature de donnée est celle du module qui la PRODUIT :
// hypothèse et prévision viennent de BUILD, réalisé de RUN, suggestion de l'IA
// de GROW. Mais la couleur n'est jamais seule : chaque nature a son libellé et
// sa forme (cercle vide, demi-cercle, cercle plein, étoile), lisibles en
// niveaux de gris comme par un daltonien.

import { cn } from '../utils.js';

export type ModuleId = 'build' | 'run' | 'grow';

export const MODULES: Readonly<
  Record<ModuleId, { nom: string; verbe: string; description: string }>
> = {
  build: {
    nom: 'BUILD',
    verbe: 'Concevoir',
    description: 'Modèle économique, plan financier, prévisionnel.',
  },
  run: {
    nom: 'RUN',
    verbe: 'Exploiter',
    description: 'Ventes, factures, facture normalisée DGI, fiscalité.',
  },
  grow: {
    nom: 'GROW',
    verbe: 'Croître',
    description: 'Pilotage, écarts prévu / réalisé, analyses expliquées par l’IA.',
  },
};

const COULEUR_MODULE: Record<ModuleId, string> = {
  build: 'text-[var(--module-build)]',
  run: 'text-[var(--module-run)]',
  grow: 'text-[var(--module-grow)]',
};

/** Surtitre de module : « RUN · Exploiter ». Texte en capitales mono, couleur en renfort. */
export function ModuleMark({
  module,
  suffix,
  className,
}: {
  module: ModuleId;
  /** Remplace le verbe du module (ex. « Ventes »). */
  suffix?: string;
  className?: string;
}): React.ReactElement {
  const m = MODULES[module];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em]',
        COULEUR_MODULE[module],
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.nom}
      <span className="font-medium text-[var(--foreground-muted)]">· {suffix ?? m.verbe}</span>
    </span>
  );
}

export type DataNatureId = 'hypothese' | 'prevision' | 'realise' | 'suggestion';

export const DATA_NATURES: Readonly<
  Record<DataNatureId, { label: string; definition: string; module: ModuleId }>
> = {
  hypothese: {
    label: 'Hypothèse',
    definition: 'Valeur saisie par vous, servant de base au calcul.',
    module: 'build',
  },
  prevision: {
    label: 'Prévision',
    definition: 'Valeur calculée par le moteur financier à partir des hypothèses.',
    module: 'build',
  },
  realise: {
    label: 'Réalisé',
    definition: 'Valeur constatée, issue de vos ventes et de votre activité réelle.',
    module: 'run',
  },
  suggestion: {
    label: 'Suggestion IA',
    definition: 'Proposition de l’assistant, jamais appliquée sans votre accord.',
    module: 'grow',
  },
};

const COULEUR_NATURE: Record<DataNatureId, string> = {
  hypothese: 'text-[var(--nature-hypothese)] border-[var(--border)]',
  prevision: 'text-[var(--module-build)] border-[var(--border)]',
  realise: 'text-[var(--module-run)] border-[var(--border)]',
  // Pointillés : une suggestion n'est pas encore une donnée du dossier.
  suggestion: 'text-[var(--module-grow)] border-dashed border-[var(--module-grow)]',
};

function Glyphe({ nature }: { nature: DataNatureId }): React.ReactElement {
  const commun = {
    width: 10,
    height: 10,
    viewBox: '0 0 10 10',
    'aria-hidden': true,
    focusable: false,
  } as const;
  switch (nature) {
    case 'hypothese':
      return (
        <svg {...commun}>
          <circle cx="5" cy="5" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'prevision':
      return (
        <svg {...commun}>
          <circle cx="5" cy="5" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 1.25a3.75 3.75 0 0 1 0 7.5z" fill="currentColor" />
        </svg>
      );
    case 'realise':
      return (
        <svg {...commun}>
          <circle cx="5" cy="5" r="4.25" fill="currentColor" />
        </svg>
      );
    case 'suggestion':
      return (
        <svg {...commun}>
          <path d="M5 0.5 6.1 3.9 9.5 5 6.1 6.1 5 9.5 3.9 6.1 0.5 5 3.9 3.9z" fill="currentColor" />
        </svg>
      );
  }
}

/**
 * Étiquette de nature d'une donnée. `title` porte la définition au survol ; le
 * libellé, lui, est toujours écrit — on ne devine pas une nature à sa couleur.
 */
export function DataNature({
  nature,
  compact = false,
  className,
}: {
  nature: DataNatureId;
  /** Glyphe seul, libellé réservé au lecteur d'écran (dans un tableau dense, avec légende). */
  compact?: boolean;
  className?: string;
}): React.ReactElement {
  const n = DATA_NATURES[nature];
  return (
    <span
      title={n.definition}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-[var(--surface)] px-2 py-0.5 text-[0.7rem] font-medium leading-4',
        COULEUR_NATURE[nature],
        compact && 'border-transparent px-0.5',
        className,
      )}
    >
      <Glyphe nature={nature} />
      <span className={compact ? 'sr-only' : undefined}>{n.label}</span>
    </span>
  );
}

/** Légende des quatre natures, à poser sous un tableau qui les mélange. */
export function DataNatureLegend({ className }: { className?: string }): React.ReactElement {
  return (
    <ul
      aria-label="Nature des données"
      className={cn('flex flex-wrap gap-x-4 gap-y-2 text-xs', className)}
    >
      {(Object.keys(DATA_NATURES) as DataNatureId[]).map((n) => (
        <li key={n} className="flex items-center gap-2">
          <DataNature nature={n} />
          <span className="text-[var(--foreground-muted)]">{DATA_NATURES[n].definition}</span>
        </li>
      ))}
    </ul>
  );
}
