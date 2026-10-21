'use client';

// Lit les faits de la mise en route sur le serveur (ADR-0030 § 8).
//
// Trois lectures existantes, rien de nouveau côté API. Une étape fermée au rôle
// n'est pas lue (son refus se déduit des actions) ; un 403/404 inattendu est
// traduit en refus ; toute autre erreur laisse le fait INCONNU — jamais « fait ».

import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

import { useShell } from '../../_components/shell-context';

import {
  FAITS_INCONNUS,
  fiscalFait,
  identiteFaite,
  pointsDeVenteFaits,
  refusDepuisActions,
  type FaitEtape,
  type FaitsMiseEnRoute,
} from './onboarding-model';
import { estRefus } from './organization-model';

async function lire<T>(appel: () => Promise<T>, fait: (v: T) => boolean): Promise<FaitEtape> {
  try {
    return fait(await appel());
  } catch (err) {
    return estRefus(err) ? 'refus' : null;
  }
}

export function useMiseEnRoute(): {
  faits: FaitsMiseEnRoute;
  pret: boolean;
  relire: () => Promise<void>;
} {
  const { actions, modulesChoisis } = useShell();
  const [faits, setFaits] = useState<FaitsMiseEnRoute>(FAITS_INCONNUS);
  const [pret, setPret] = useState(false);

  const relire = useCallback(async (): Promise<void> => {
    // Permissions inconnues : on attend plutôt que de lancer des appels au hasard.
    if (actions === null) return;
    const refus = refusDepuisActions(actions);
    const [identite, fiscal, pointsDeVente] = await Promise.all([
      refus.identite ?? lire(api.getBrand, identiteFaite),
      refus.fiscal ?? lire(api.getFiscalProfile, fiscalFait),
      refus['points-de-vente'] ?? lire(api.getNormalizedInvoicing, pointsDeVenteFaits),
    ]);
    setFaits({ identite, fiscal, 'points-de-vente': pointsDeVente, modules: modulesChoisis });
    setPret(true);
  }, [actions, modulesChoisis]);

  useEffect(() => {
    void relire();
  }, [relire]);

  return { faits, pret, relire };
}
