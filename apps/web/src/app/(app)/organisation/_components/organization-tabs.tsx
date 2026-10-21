'use client';

// Onglets de l'espace organisation (S21a) : Tableau de bord · Paramètres ·
// Facturation · Journal.
//
// Même pattern déclaratif que `PROJECT_TABS` et `ACCOUNT_TABS` — la liste vit
// dans `organization-model.ts`, le rendu ne connaît aucun cas particulier.
//
// Différence avec l'espace compte : ici, tous les onglets ne s'adressent pas à
// tout le monde. La liste est filtrée par les permissions RÉELLES de l'appelant
// (`GET /me/permissions`), pas par une copie de la matrice côté client — ADR-0012
// §8. Masquer reste un confort : le serveur refuse de toute façon, et la page
// atteinte par URL directe l'explique.

import { TabsNav } from '@lalanda/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { renderNextLink } from '@/components/next-link';
import { api, type OrgAction } from '@/lib/api';

import { ORGANIZATION_BASE, ongletsVisibles, segmentActif } from './organization-model';

export function OrganizationTabs(): React.ReactElement {
  const pathname = usePathname();
  const [actions, setActions] = useState<OrgAction[] | null>(null);

  useEffect(() => {
    let annule = false;
    void api
      .getMyPermissions()
      .then((p) => {
        if (!annule) setActions(p.actions);
      })
      // Un échec laisse `actions` à `null` : seul le tableau de bord reste
      // proposé. Mieux vaut une navigation réduite qu'une navigation qui promet
      // des pages inaccessibles.
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  const courant = segmentActif(pathname);
  const onglets = ongletsVisibles(actions);

  return (
    // `aria-current="page"` sur l'onglet courant (posé par `TabsNav`) : il est
    // annoncé au lecteur d'écran, l'information ne repose pas sur la bordure.
    <TabsNav
      label="Sections de l’organisation"
      renderLink={renderNextLink}
      items={onglets.map((tab) => ({
        href: tab.segment ? `${ORGANIZATION_BASE}/${tab.segment}` : ORGANIZATION_BASE,
        // ADR-0030 : la racine est le pilotage (module GROW de la navigation).
        label: tab.segment === '' ? 'Pilotage' : tab.label,
        current: courant === tab.segment,
      }))}
    />
  );
}
