'use client';

// Chargement des chiffres d'un écran (ADR-0067, ADR-0071) : un échec ne bloque
// jamais la liste ; « Réessayer » relance la lecture ; `cle` la relance aussi
// (mois affiché, enregistrement réussi).

import { useCallback, useEffect, useState } from 'react';

import type { EtatTableau } from './briques';

export function useTableau<T>(
  lire: () => Promise<T>,
  cle: string,
): { stats: T | null; etat: EtatTableau; reessayer: () => void } {
  const [stats, setStats] = useState<T | null>(null);
  const [etat, setEtat] = useState<EtatTableau>('chargement');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let annule = false;
    setEtat((e) => (e === 'pret' ? e : 'chargement'));
    lire()
      .then((s) => {
        if (annule) return;
        setStats(s);
        setEtat('pret');
      })
      .catch(() => {
        if (!annule) setEtat('erreur');
      });
    return () => {
      annule = true;
    };
    // `lire` est recréée à chaque rendu : la relecture suit `cle` et `version`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, version]);
  const reessayer = useCallback(() => setVersion((v) => v + 1), []);
  return { stats, etat, reessayer };
}
