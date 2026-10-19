'use client';

// Chrome de l'espace Ventes : onglets et frontière d'accès (ADR-0022, chantier D2 ;
// onglet Factures et droit `sales.invoice` : ADR-0023, chantier E3).
//
// Les permissions sont lues UNE fois (`GET /me/permissions`) et partagées avec
// les pages par un contexte : la liste des clients et celle du catalogue en ont
// besoin pour savoir si elles proposent d'écrire.
//
// Rien ici n'autorise quoi que ce soit — `PermissionsGuard` refuse côté API de
// toute façon. Masquer un bouton est un confort ; un rôle sans `sales.read` lit
// un refus explicite plutôt qu'une page vide.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';

import { api, type OrgAction } from '@/lib/api';

import { peutConsulter, peutGerer, SALES_TABS, segmentVentes, VENTES_BASE } from './sales-model';

type EtatPermissions = 'chargement' | 'pret' | 'echec';

interface AccesVentes {
  etat: EtatPermissions;
  /** `true` seulement quand le serveur a confirmé `sales.manage`. */
  gerer: boolean;
  /** `true` seulement quand le serveur a confirmé `sales.invoice` (ADR-0023 § S25e.11). */
  facturer: boolean;
}

const Contexte = createContext<AccesVentes>({ etat: 'chargement', gerer: false, facturer: false });

/**
 * Onglets de l'espace, dans l'ordre d'affichage : « Factures » en premier
 * (ADR-0023, chantier E3), puis les données maîtres d'ADR-0022.
 */
const ONGLETS: readonly { segment: string; label: string; action: OrgAction }[] = [
  { segment: 'factures', label: 'Factures', action: 'sales.read' },
  ...SALES_TABS,
];

export function useAccesVentes(): AccesVentes {
  return useContext(Contexte);
}

export function SalesChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const [actions, setActions] = useState<OrgAction[] | null>(null);
  const [etat, setEtat] = useState<EtatPermissions>('chargement');

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

  // Permissions illisibles (panne réseau, organisation absente) : on montre les
  // deux onglets plutôt qu'un espace sans navigation. Chaque page lit alors la
  // réponse du serveur et l'explique — un 403 y devient une phrase, pas une panne.
  const onglets =
    etat === 'echec'
      ? [...ONGLETS]
      : actions === null
        ? []
        : ONGLETS.filter((t) => actions.includes(t.action));
  const courant = segmentVentes(pathname);

  if (etat === 'pret' && !peutConsulter(actions)) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
        <p className="text-sm font-medium">Les ventes ne sont pas ouvertes à votre rôle</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
          Le fichier clients contient des données personnelles : il n’est consultable que par les
          rôles qui en ont l’usage. Si vous en avez besoin, demandez à un Propriétaire ou un
          Administrateur de l’organisation de revoir votre rôle.
        </p>
      </div>
    );
  }

  return (
    <Contexte.Provider
      value={{
        etat,
        gerer: peutGerer(actions),
        facturer: actions !== null && actions.includes('sales.invoice'),
      }}
    >
      {onglets.length > 0 ? (
        <nav
          aria-label="Sections des ventes"
          className="flex flex-wrap gap-1 border-b border-[var(--border)]"
        >
          {onglets.map((tab) => {
            const actif = courant === tab.segment;
            return (
              <Link
                key={tab.segment}
                href={`${VENTES_BASE}/${tab.segment}`}
                aria-current={actif ? 'page' : undefined}
                className={
                  actif
                    ? 'font-mono -mb-px border-b-2 border-[var(--accent)] px-3.5 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)] transition'
                    : 'font-mono -mb-px border-b-2 border-transparent px-3.5 py-2.5 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]'
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : (
        // Hauteur réservée : la page ne saute pas quand les onglets arrivent.
        <div aria-hidden="true" className="h-[2.6rem] border-b border-[var(--border)]" />
      )}
      {children}
    </Contexte.Provider>
  );
}
