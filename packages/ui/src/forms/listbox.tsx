// Briques communes aux listes déroulantes (`Select`, `EntityPicker`) : option
// WAI-ARIA, surlignage de la correspondance, cadre de la liste ouverte.

import { Check } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '../utils.js';

import { surligner } from './logic.js';
import { FEUILLE_BASSE } from './popover.js';

/** Texte avec la partie qui correspond à la recherche en gras (`<mark>`). */
export function Surligne({
  texte,
  requete,
}: {
  texte: string;
  requete: string;
}): React.ReactElement {
  return (
    <>
      {surligner(texte, requete).map((m, i) =>
        m.correspond ? (
          <mark
            key={i}
            className="rounded-[2px] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] font-semibold text-inherit"
          >
            {m.texte}
          </mark>
        ) : (
          <span key={i}>{m.texte}</span>
        ),
      )}
    </>
  );
}

export interface ListboxOptionProps {
  id: string;
  actif: boolean;
  selectionne: boolean;
  desactive?: boolean | undefined;
  onChoisir: () => void;
  onSurvol: () => void;
  children: React.ReactNode;
  /** Coche affichée à gauche (liste à choix unique). */
  coche?: boolean;
  className?: string;
}

export function ListboxOption({
  id,
  actif,
  selectionne,
  desactive,
  onChoisir,
  onSurvol,
  children,
  coche = true,
  className,
}: ListboxOptionProps): React.ReactElement {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selectionne}
      aria-disabled={desactive || undefined}
      data-actif={actif || undefined}
      // Le focus reste dans le champ : un clic ne doit pas le lui retirer.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        if (!desactive) onChoisir();
      }}
      onPointerMove={onSurvol}
      className={cn(
        'mx-1 flex cursor-pointer select-none items-start gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm text-[var(--foreground)] max-sm:min-h-11 max-sm:items-center max-sm:py-2.5 max-sm:text-base',
        actif && 'bg-[var(--accent-soft)]',
        desactive && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {coche ? (
        <Check
          aria-hidden="true"
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)] max-sm:mt-0',
            selectionne ? 'visible' : 'invisible',
          )}
        />
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** Ligne non sélectionnable (chargement, aucun résultat). */
export function ListboxMessage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div role="presentation" className="px-3 py-2.5 text-sm text-[var(--foreground-muted)]">
      {children}
    </div>
  );
}

/** Cadre de la liste ouverte : ancrée sous le champ, feuille basse sur téléphone. */
export const Popover = forwardRef<
  HTMLDivElement,
  {
    style: React.CSSProperties | undefined;
    className?: string;
    children: React.ReactNode;
    /** Feuille basse sur téléphone (défaut). `false` : reste ancrée sous le champ. */
    feuille?: boolean;
  }
>(function Popover({ style, className, children, feuille = true }, ref) {
  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        'z-50 flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-pop)]',
        // Premier rendu, avant la mesure : sous le champ, comme après.
        style ? null : 'absolute left-0 top-[calc(100%+6px)] w-full',
        feuille ? FEUILLE_BASSE : null,
        className,
      )}
    >
      {children}
    </div>
  );
});

/** Voile derrière la feuille basse (téléphone seulement). */
export function VoileTelephone({ onFermer }: { onFermer: () => void }): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      onPointerDown={(e) => {
        e.preventDefault();
        onFermer();
      }}
      className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--foreground)_35%,transparent)] sm:hidden"
    />
  );
}
