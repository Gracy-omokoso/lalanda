'use client';

// Chrome de l'Idea Lab : onglets « Idées » et « Validation », droits affichés
// (ADR-0036 § 8). Les permissions sont lues une fois (`GET /me/permissions`) et
// partagées par contexte. Rien ici n'autorise : l'API refuse de toute façon.

import { TabsNav } from '@lalanda/ui';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';

import { renderNextLink } from '@/components/next-link';
import { api, type OrgAction } from '@/lib/api';

import { droitsIdees, IDEES_TABS, ongletIdees } from './idea-model';

interface AccesIdees {
  pret: boolean;
  modifier: boolean;
  reglerIa: boolean;
}

const Contexte = createContext<AccesIdees>({ pret: false, modifier: false, reglerIa: false });

export function useAccesIdees(): AccesIdees {
  return useContext(Contexte);
}

export function IdeesChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const [actions, setActions] = useState<OrgAction[] | null>(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    let annule = false;
    void api
      .getMyPermissions()
      .then((p) => {
        if (!annule) setActions(p.actions);
      })
      // Permissions illisibles : aucun bouton d'écriture ; les pages se chargent
      // et expliquent elles-mêmes un éventuel refus.
      .catch(() => undefined)
      .finally(() => {
        if (!annule) setPret(true);
      });
    return () => {
      annule = true;
    };
  }, []);

  const courant = ongletIdees(pathname);
  return (
    <Contexte.Provider value={{ pret, ...droitsIdees(actions) }}>
      <TabsNav
        label="Sections de l’Idea Lab"
        renderLink={renderNextLink}
        items={IDEES_TABS.map((tab) => ({
          href: tab.href,
          label: tab.label,
          current: courant === tab.segment,
        }))}
      />
      {children}
    </Contexte.Provider>
  );
}
