'use client';

// Frontière d'accès de l'application Stocks (ADR-0046 § 5.1, § 8), sur le modèle
// des Achats. Sans rangée d'onglets : la colonne de gauche est la seule
// navigation (ADR-0038 § 3).
//
// Condition d'entrée : `stock.read`. Les droits viennent de la coquille
// (`useShell().actions`), jamais du nom du rôle. Le contexte ajoute l'identité
// (`useProfil` : « vous », séparation des tâches affichée), les membres
// (`GET /work/members`, lecture `work.read`) et les emplacements
// (`GET /stock/locations`), partagés par tous les écrans.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { stockApi, type StockLocationView } from '@/lib/api-stock';
import { workApi } from '@/lib/work-api';

import { useProfil } from '../../_components/profile-context';
import { useShell } from '../../_components/shell-context';

import { lire, peutLireStocks, type Lecture, type Membre } from './stocks-model';

type Etat = 'chargement' | 'pret' | 'echec';

interface AccesStocks {
  etat: Etat;
  actions: OrgAction[] | null;
  membres: Membre[];
  moi: string | null;
  /** Emplacements actifs ; `null` tant qu'ils ne sont pas lus. */
  emplacements: Lecture<StockLocationView[]> | null;
  rechargerEmplacements: () => void;
}

const Contexte = createContext<AccesStocks>({
  etat: 'chargement',
  actions: null,
  membres: [],
  moi: null,
  emplacements: null,
  rechargerEmplacements: () => undefined,
});

export function useAccesStocks(): AccesStocks {
  return useContext(Contexte);
}

export function StocksChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const { actions, chargees } = useShell();
  const { profil } = useProfil();
  const [membres, setMembres] = useState<Membre[]>([]);
  const [emplacements, setEmplacements] = useState<Lecture<StockLocationView[]> | null>(null);
  const [version, setVersion] = useState(0);
  const lireMembres = actions !== null && actions.includes('work.read');
  const lireStocks = peutLireStocks(actions);

  useEffect(() => {
    if (!lireMembres) return;
    let annule = false;
    workApi
      .listMembers()
      .then((items) => {
        if (!annule) setMembres(items.map((m) => ({ userId: m.userId, name: m.name })));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [lireMembres]);

  useEffect(() => {
    if (!lireStocks) return;
    let annule = false;
    void lire(stockApi.listLocations({ active: 'true' }).then((p) => p.items)).then((l) => {
      if (!annule) setEmplacements(l);
    });
    return () => {
      annule = true;
    };
  }, [lireStocks, version]);

  const rechargerEmplacements = useCallback(() => setVersion((v) => v + 1), []);
  const etat: Etat = !chargees ? 'chargement' : actions === null ? 'echec' : 'pret';
  const moi = profil?.id ?? null;
  const valeur = useMemo<AccesStocks>(
    () => ({ etat, actions, membres, moi, emplacements, rechargerEmplacements }),
    [etat, actions, membres, moi, emplacements, rechargerEmplacements],
  );

  if (etat === 'pret' && !lireStocks) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
        <p className="text-sm font-medium">Les stocks ne sont pas ouverts à votre rôle</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
          Si vous en avez besoin, demandez à un Propriétaire ou un Administrateur de l’organisation
          de revoir vos droits.
        </p>
      </div>
    );
  }

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
