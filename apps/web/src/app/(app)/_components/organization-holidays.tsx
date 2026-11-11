'use client';

// Fériés de l'organisation dans TOUS les calendriers de l'application
// (ADR-0074, décision n° 1 du 11 nov. 2026, à revoir avec Gracy).
//
// Lus UNE fois par organisation (changer d'organisation recharge la page,
// `lib/bascule-organisation.ts`) par la route existante `GET /hr/holidays`
// (`analytics.read`, module RH de l'offre ; isolée par organisation, e2e
// `hr-leave`). Aucune route ajoutée : la lecture n'exige pas `hr.read`. Transmis
// aux `DatePicker`/`DateRangePicker` par `DateMarksProvider` : point discret et
// nom en infobulle, jamais bloquant. En cas d'échec, ou sans droit, aucun jour
// n'est marqué et rien d'autre ne change.

import { DateMarksProvider, type DateMark } from '@lalanda/ui';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { hrAdminApi } from '@/lib/api-hr-admin';

import { marquesDesFeries, peutLireFeries } from './feries-marques';
import { useShell } from './shell-context';

export function OrganizationHolidays({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { actions, organizationId } = useShell();
  const [marks, setMarks] = useState<DateMark[] | null>(null);
  const lisible = actions !== null && actions.includes('analytics.read');

  useEffect(() => {
    if (!lisible || organizationId === null) {
      setMarks(null);
      return;
    }
    let annule = false;
    void (async () => {
      try {
        const offre = await api.getMyFeatures();
        const rh = offre.features.find((f) => f.key === 'hr')?.status ?? null;
        if (annule || !peutLireFeries(actions, rh)) return;
        const liste = await hrAdminApi.listHolidays();
        if (!annule) setMarks(marquesDesFeries(liste.items));
      } catch {
        if (!annule) setMarks(null);
      }
    })();
    return () => {
      annule = true;
    };
    // Une lecture par organisation : les relectures de permissions n'en relancent pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lisible, organizationId]);

  return <DateMarksProvider marks={marks}>{children}</DateMarksProvider>;
}
