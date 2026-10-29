'use client';

// Frontière d'accès de l'application CRM (ADR-0040 § 8.1), sortie de Ventes.
// Sans rangée d'onglets : la colonne de gauche est la seule navigation
// (ADR-0038 § 3, révision du 29 oct. 2026).
//
// La condition d'entrée est `crm.read`. Les droits viennent de la coquille
// (`useShell().actions`, lus UNE fois par `GET /me/permissions`) — jamais d'un
// test sur le nom du rôle. Le contexte ajoute les membres de l'organisation
// (`GET /work/members`, lecture `work.read`) pour afficher le nom d'un
// responsable ou d'un assigné ; sans cette lecture, l'écran dit « un membre ».
//
// Rien ici n'autorise quoi que ce soit — `PermissionsGuard` refuse côté API de
// toute façon. Un rôle sans `crm.read` lit un refus explicite plutôt qu'une page
// vide.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { workApi, type WorkMemberOption } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { peutLireCrm } from './crm-model';

type EtatPermissions = 'chargement' | 'pret' | 'echec';

export interface MembreCrm {
  userId: string;
  name: string;
}

interface AccesCrm {
  etat: EtatPermissions;
  /** Actions détenues (`null` tant qu'elles ne sont pas connues). */
  actions: OrgAction[] | null;
  /** Membres connus (nom par identifiant) ; vide si la lecture est refusée. */
  membres: MembreCrm[];
}

const Contexte = createContext<AccesCrm>({ etat: 'chargement', actions: null, membres: [] });

export function useAccesCrm(): AccesCrm {
  return useContext(Contexte);
}

export function CrmChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const { actions, chargees } = useShell();
  const [membres, setMembres] = useState<MembreCrm[]>([]);
  const lireMembres = actions !== null && actions.includes('work.read');

  useEffect(() => {
    if (!lireMembres) return;
    let annule = false;
    workApi
      .listMembers()
      .then((items: WorkMemberOption[]) => {
        if (!annule) setMembres(items.map((m) => ({ userId: m.userId, name: m.name })));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [lireMembres]);

  const etat: EtatPermissions = !chargees ? 'chargement' : actions === null ? 'echec' : 'pret';
  const valeur = useMemo<AccesCrm>(() => ({ etat, actions, membres }), [etat, actions, membres]);

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

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
