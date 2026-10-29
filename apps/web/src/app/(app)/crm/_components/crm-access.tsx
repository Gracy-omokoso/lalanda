'use client';

// Frontière d'accès de l'application CRM (ADR-0040 § 8.1), sortie de Ventes.
// Même patron que `ventes/_components/sales-access.tsx`, sans rangée d'onglets :
// Pipeline, Contacts et Réglages sont dans la colonne de gauche (ADR-0038 § 3,
// révision du 29 oct. 2026).
//
// La condition d'entrée est `crm.read`, et non plus `sales.read` : le CRM a sa
// propre lecture depuis ADR-0035. Les permissions sont lues UNE fois
// (`GET /me/permissions`) et partagées avec les écrans par un contexte.
//
// Rien ici n'autorise quoi que ce soit — `PermissionsGuard` refuse côté API de
// toute façon. Un rôle sans `crm.read` lit un refus explicite plutôt qu'une page
// vide.

import { createContext, useContext, useEffect, useState } from 'react';

import { api, type OrgAction } from '@/lib/api';

import { peutLireCrm } from './crm-model';

type EtatPermissions = 'chargement' | 'pret' | 'echec';

interface AccesCrm {
  etat: EtatPermissions;
  /** Actions détenues (`null` tant qu'elles ne sont pas connues). */
  actions: OrgAction[] | null;
  /**
   * `true` seulement quand le serveur a confirmé `sales.manage` : la fiche
   * d'opportunité propose alors « Créer un devis ».
   */
  gererVentes: boolean;
}

const Contexte = createContext<AccesCrm>({ etat: 'chargement', actions: null, gererVentes: false });

export function useAccesCrm(): AccesCrm {
  return useContext(Contexte);
}

export function CrmChrome({ children }: { children: React.ReactNode }): React.ReactElement {
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

  if (etat === 'pret' && !peutLireCrm(actions)) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
        <p className="text-sm font-medium">Le CRM n’est pas ouvert à votre rôle</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
          Le pipeline et les contacts contiennent des données personnelles : ils ne sont
          consultables que par les rôles qui en ont l’usage. Si vous en avez besoin, demandez à un
          Propriétaire ou un Administrateur de l’organisation de revoir votre rôle.
        </p>
      </div>
    );
  }

  return (
    <Contexte.Provider
      value={{
        etat,
        actions,
        gererVentes: actions !== null && actions.includes('sales.manage'),
      }}
    >
      {children}
    </Contexte.Provider>
  );
}
