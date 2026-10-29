'use client';

// Chrome de l'espace Ventes : frontière d'accès (ADR-0022, chantier D2 ; droit
// `sales.invoice` : ADR-0023, chantier E3 ; droit `sales.receipt` : ADR-0031).
// Les sections (Factures, Devis, Encaissements, Clients, Catalogue, Modèle
// de facture) sont dans la colonne de gauche du module RUN (ADR-0038 § 3) : plus
// de rangée d'onglets en double.
//
// Les permissions sont lues UNE fois (`GET /me/permissions`) et partagées avec
// les pages par un contexte : la liste des clients et celle du catalogue en ont
// besoin pour savoir si elles proposent d'écrire.
//
// Rien ici n'autorise quoi que ce soit — `PermissionsGuard` refuse côté API de
// toute façon. Masquer un bouton est un confort ; un rôle sans `sales.read` lit
// un refus explicite plutôt qu'une page vide.

import { createContext, useContext, useEffect, useState } from 'react';

import { api, type OrgAction } from '@/lib/api';

import { peutConsulter, peutGerer } from './sales-model';

type EtatPermissions = 'chargement' | 'pret' | 'echec';

interface AccesVentes {
  etat: EtatPermissions;
  /** `true` seulement quand le serveur a confirmé `sales.manage`. */
  gerer: boolean;
  /** `true` seulement quand le serveur a confirmé `sales.invoice` (ADR-0023 § S25e.11). */
  facturer: boolean;
  /** `true` seulement quand le serveur a confirmé `sales.receipt` (ADR-0031 § 4). */
  encaisser: boolean;
  /** `true` quand le serveur a confirmé `actuals.import` : régler le pont vers le réalisé. */
  importerRealise: boolean;
  /** Actions détenues (`null` tant qu'elles ne sont pas connues) — CRM, ADR-0035. */
  actions: OrgAction[] | null;
}

const Contexte = createContext<AccesVentes>({
  etat: 'chargement',
  gerer: false,
  facturer: false,
  encaisser: false,
  importerRealise: false,
  actions: null,
});

export function useAccesVentes(): AccesVentes {
  return useContext(Contexte);
}

export function SalesChrome({ children }: { children: React.ReactNode }): React.ReactElement {
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
        encaisser: actions !== null && actions.includes('sales.receipt'),
        importerRealise: actions !== null && actions.includes('actuals.import'),
        actions,
      }}
    >
      {children}
    </Contexte.Provider>
  );
}
