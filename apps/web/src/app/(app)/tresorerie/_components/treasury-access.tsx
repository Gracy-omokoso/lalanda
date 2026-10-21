'use client';

// Chrome de l'espace Trésorerie (ADR-0034) : onglets et frontière d'accès.
//
// Les permissions sont lues une fois (`GET /me/permissions`) et partagées par un
// contexte. Rien ici n'autorise quoi que ce soit — `PermissionsGuard` refuse côté
// API de toute façon ; masquer un bouton est un confort, et un rôle sans
// `treasury.read` lit un refus explicite plutôt qu'une page vide.

import { TabsNav } from '@lalanda/ui';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';

import { renderNextLink } from '@/components/next-link';
import { api, type OrgAction } from '@/lib/api';

import {
  peutConsulterTresorerie,
  peutGererTresorerie,
  peutRelier,
  segmentTresorerie,
  TREASURY_TABS,
  TRESORERIE_BASE,
} from './treasury-model';

interface AccesTresorerie {
  etat: 'chargement' | 'pret' | 'echec';
  gerer: boolean;
  relier: boolean;
}

const Contexte = createContext<AccesTresorerie>({
  etat: 'chargement',
  gerer: false,
  relier: false,
});

export function useAccesTresorerie(): AccesTresorerie {
  return useContext(Contexte);
}

export function TreasuryChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const [actions, setActions] = useState<OrgAction[] | null>(null);
  const [etat, setEtat] = useState<AccesTresorerie['etat']>('chargement');

  useEffect(() => {
    let annule = false;
    void api
      .getMyPermissions()
      .then((p) => {
        if (annule) return;
        setActions(p.actions);
        setEtat('pret');
      })
      .catch(() => {
        if (!annule) setEtat('echec');
      });
    return () => {
      annule = true;
    };
  }, []);

  const courant = segmentTresorerie(pathname);
  const onglets =
    etat === 'echec'
      ? [...TREASURY_TABS]
      : actions === null
        ? []
        : TREASURY_TABS.filter((t) => actions.includes(t.action));

  if (etat === 'pret' && !peutConsulterTresorerie(actions)) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
        <p className="text-sm font-medium">La trésorerie n’est pas ouverte à votre rôle</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
          Le détail des dépenses et des fournisseurs n’est consultable que par les rôles qui en ont
          l’usage. Si vous en avez besoin, demandez à un Propriétaire de revoir votre rôle.
        </p>
      </div>
    );
  }

  return (
    <Contexte.Provider
      value={{ etat, gerer: peutGererTresorerie(actions), relier: peutRelier(actions) }}
    >
      {onglets.length > 0 ? (
        // ADR-0030 : une seule ligne qui défile sur téléphone, comme les Ventes.
        <TabsNav
          label="Sections de la trésorerie"
          renderLink={renderNextLink}
          items={onglets.map((tab) => ({
            href: `${TRESORERIE_BASE}/${tab.segment}`,
            label: tab.label,
            current: courant === tab.segment,
          }))}
        />
      ) : (
        <div aria-hidden="true" className="h-[2.75rem] border-b border-[var(--border)]" />
      )}
      {children}
    </Contexte.Provider>
  );
}

/** Bandeau d'erreur ou d'information. */
export function Bandeau({
  ton = 'info',
  children,
}: {
  ton?: 'info' | 'erreur' | 'alerte';
  children: React.ReactNode;
}): React.ReactElement {
  const couleurs =
    ton === 'erreur'
      ? 'border-[var(--danger)]/40 bg-[var(--danger-bg)] text-[var(--danger)]'
      : ton === 'alerte'
        ? 'border-[var(--warning,#b45309)]/40 bg-[var(--warning-bg,#fef3c7)]'
        : 'border-[var(--border)] bg-[var(--surface,transparent)]';
  return (
    <div
      role={ton === 'erreur' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${couleurs}`}
    >
      {children}
    </div>
  );
}

/** Carte de section. */
export function Section({
  titre,
  description,
  actions,
  children,
}: {
  titre: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{titre}</h2>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-sm text-[var(--foreground-muted)]">{description}</p>
          ) : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
