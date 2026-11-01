'use client';

// Frontière d'accès de l'application Comptabilité (ADR-0049 § 13), sur le modèle des
// Stocks. Sans rangée d'onglets : la colonne de gauche est la seule navigation.
//
// Condition d'entrée : `accounting.read`, lue dans la coquille (`useShell().actions`),
// jamais d'après le nom du rôle. Le contexte partage les réglages
// (`GET /accounting/settings`) : leur mode décide des bandeaux. Les bandeaux sont posés
// ICI, au-dessus de chaque écran et de chacun de ses états (chargement, vide, erreur,
// route pas encore livrée) : « Projet — à valider par un expert-comptable » toujours,
// « Simulation » en tête quand le mode l'est.

import type { AccountingMode } from '@lalanda/shared/accounting';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { OrgAction, OrgRole } from '@/lib/api';
import { accountingApi, type AccountingSettingsView } from '@/lib/api-accounting';

import { useShell } from '../../_components/shell-context';

import { bandeauxCompta, lire, peutLireCompta, type Lecture } from './comptabilite-model';
import { BandeauxCompta } from './comptabilite-ui';

type Etat = 'chargement' | 'pret' | 'echec';

interface AccesCompta {
  etat: Etat;
  actions: OrgAction[] | null;
  role: OrgRole | null;
  /** Réglages ; `null` tant qu'ils ne sont pas lus. */
  reglages: Lecture<AccountingSettingsView> | null;
  /** Mode connu, ou `null` (réglages illisibles ou pas encore servis). */
  mode: AccountingMode | null;
  recharger: () => void;
}

const Contexte = createContext<AccesCompta>({
  etat: 'chargement',
  actions: null,
  role: null,
  reglages: null,
  mode: null,
  recharger: () => undefined,
});

export function useAccesCompta(): AccesCompta {
  return useContext(Contexte);
}

export function ComptabiliteChrome({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { actions, chargees, permissions } = useShell();
  const [reglages, setReglages] = useState<Lecture<AccountingSettingsView> | null>(null);
  const [version, setVersion] = useState(0);
  const lecture = peutLireCompta(actions);

  useEffect(() => {
    if (!lecture) return;
    let annule = false;
    void lire(accountingApi.getSettings()).then((l) => {
      if (!annule) setReglages(l);
    });
    return () => {
      annule = true;
    };
  }, [lecture, version]);

  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  const etat: Etat = !chargees ? 'chargement' : actions === null ? 'echec' : 'pret';
  const mode = reglages?.ok ? reglages.valeur.mode : null;
  const role = permissions?.role ?? null;
  const valeur = useMemo<AccesCompta>(
    () => ({ etat, actions, role, reglages, mode, recharger }),
    [etat, actions, role, reglages, mode, recharger],
  );

  if (etat === 'pret' && !lecture) {
    return (
      <div className="flex flex-col gap-4">
        <BandeauxCompta bandeaux={bandeauxCompta(null)} />
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
          <p className="text-sm font-medium">La comptabilité n’est pas ouverte à votre rôle</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
            Si vous en avez besoin, demandez à un Propriétaire de l’organisation de revoir vos
            droits.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Contexte.Provider value={valeur}>
      <div className="flex min-w-0 flex-col gap-5">
        <BandeauxCompta bandeaux={bandeauxCompta(mode)} />
        {children}
      </div>
    </Contexte.Provider>
  );
}
