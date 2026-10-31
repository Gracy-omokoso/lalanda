'use client';

// Briques visuelles des équipements (ADR-0046, lot S9) : celles des stocks, des
// achats et des RH (bandeaux teintés, panneaux, tuiles, cartes cliquables), un
// champ de montant qui sélectionne son contenu au focus, et la liste des
// catégories partagée par les écrans.

import { useEffect, useState } from 'react';

import { assetsApi, type AssetCategoryView } from '@/lib/api-assets';

import { Alerte, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import { lire, messageEquipements, type Lecture } from './equipements-model';

export { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';
export { enregistrerFichier } from '../../rh/_components/rh-ui';

export function Chargement({ texte = 'Chargement…' }: { texte?: string }): React.ReactElement {
  return (
    <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
      {texte}
    </p>
  );
}

export function CarteVide({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
      {children}
    </p>
  );
}

export function EchecLecture({
  erreur,
  repli,
  onReessayer,
}: {
  erreur: unknown;
  repli: string;
  onReessayer?: () => void;
}): React.ReactElement {
  return (
    <Alerte
      action={
        onReessayer ? (
          <button type="button" className={BOUTON_PETIT} onClick={onReessayer}>
            Réessayer
          </button>
        ) : undefined
      }
    >
      <p>{messageEquipements(erreur, repli)}</p>
    </Alerte>
  );
}

/** Carte entièrement cliquable (lien ou bouton). */
export const CARTE =
  'flex h-full w-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]';

/**
 * Champ numérique : clavier décimal au téléphone, contenu sélectionné au focus
 * (une valeur préremplie se remplace sans l'effacer chiffre par chiffre).
 */
export function ChampNombre(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> & {
    entier?: boolean;
  },
): React.ReactElement {
  const { entier, className, onFocus, ...reste } = props;
  return (
    <input
      {...reste}
      type="text"
      inputMode={entier ? 'numeric' : 'decimal'}
      autoComplete="off"
      className={`${CHAMP} tabular-nums ${className ?? ''}`}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
    />
  );
}

/** Catégories de l'organisation (`GET /assets/categories`), relues sur demande. */
export function useCategories(version = 0): Lecture<AssetCategoryView[]> | null {
  const [l, setL] = useState<Lecture<AssetCategoryView[]> | null>(null);
  useEffect(() => {
    let annule = false;
    void lire(assetsApi.listCategories().then((r) => r.items)).then((x) => {
      if (!annule) setL(x);
    });
    return () => {
      annule = true;
    };
  }, [version]);
  return l;
}
