'use client';

// Lecture d'une route de l'API comptable, sans jamais rejeter : `null` pendant le
// chargement, puis `{ ok, valeur }` ou `{ ok: false, erreur }` (404 : « bientôt
// disponible »). La lecture repart quand `cle` change.

import { useEffect, useState } from 'react';

import { lire, type Lecture } from './comptabilite-model';

export function useLecture<T>(charger: () => Promise<T>, cle: unknown): Lecture<T> | null {
  const [l, setL] = useState<Lecture<T> | null>(null);
  useEffect(() => {
    let annule = false;
    setL(null);
    void lire(charger()).then((r) => {
      if (!annule) setL(r);
    });
    return () => {
      annule = true;
    };
    // `charger` change à chaque rendu ; seule la clé relance la lecture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
  return l;
}
