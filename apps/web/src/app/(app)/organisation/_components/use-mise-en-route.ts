'use client';

// Lit l'avancement de la mise en route sur le serveur (ADR-0052 § 3). ADR-0052 — O2.
//
// UN appel, `GET /organizations/current/setup`, ouvert à tout membre : plus de lectures
// multiples vouées au 403. En échec, la vue reste `null` — jamais une étape « faite » par
// défaut. Les déclarations (`organizationSetupApi`) renvoient la vue relue : `remplacer`
// l'installe sans second aller-retour.

import type { OrganizationSetupView } from '@lalanda/shared/organization-setup';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

import { useShell } from '../../_components/shell-context';

export function useMiseEnRoute(): {
  vue: OrganizationSetupView | null;
  pret: boolean;
  echec: boolean;
  relire: () => Promise<void>;
  remplacer: (vue: OrganizationSetupView) => void;
} {
  const { organizationId } = useShell();
  const [vue, setVue] = useState<OrganizationSetupView | null>(null);
  const [pret, setPret] = useState(false);
  const [echec, setEchec] = useState(false);

  const relire = useCallback(async (): Promise<void> => {
    try {
      setVue(await api.getOrganizationSetup());
      setEchec(false);
    } catch {
      setEchec(true);
    } finally {
      setPret(true);
    }
  }, []);

  useEffect(() => {
    // Relu à chaque changement d'organisation active : jamais l'avancement d'une autre.
    setVue(null);
    setPret(false);
    void relire();
  }, [relire, organizationId]);

  return { vue, pret, echec, relire, remplacer: setVue };
}
