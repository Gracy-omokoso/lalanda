'use client';

// Frontière d'accès de l'application Achats (ADR-0044 § 8), sur le modèle du CRM.
// Sans rangée d'onglets : la colonne de gauche est la seule navigation
// (ADR-0038 § 3, révision du 29 oct. 2026).
//
// La condition d'entrée est `purchase.read`. Les droits viennent de la coquille
// (`useShell().actions`) — jamais du nom du rôle. Le contexte ajoute l'identité
// de l'utilisateur (`useProfil`, pour « vous » et la séparation des tâches
// affichée) et les membres (`GET /work/members`, lecture `work.read`) pour
// nommer un demandeur ou un approbateur ; sans cette lecture, « un membre ».

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { workApi } from '@/lib/work-api';

import { useProfil } from '../../_components/profile-context';
import { useShell } from '../../_components/shell-context';

import { peutLireAchats, type Membre } from './achats-model';

type Etat = 'chargement' | 'pret' | 'echec';

interface AccesAchats {
  etat: Etat;
  actions: OrgAction[] | null;
  membres: Membre[];
  /** Identifiant de l'utilisateur connecté, `null` tant qu'il n'est pas connu. */
  moi: string | null;
}

const Contexte = createContext<AccesAchats>({
  etat: 'chargement',
  actions: null,
  membres: [],
  moi: null,
});

export function useAccesAchats(): AccesAchats {
  return useContext(Contexte);
}

export function AchatsChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const { actions, chargees } = useShell();
  const { profil } = useProfil();
  const [membres, setMembres] = useState<Membre[]>([]);
  const lireMembres = actions !== null && actions.includes('work.read');

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

  const etat: Etat = !chargees ? 'chargement' : actions === null ? 'echec' : 'pret';
  const moi = profil?.id ?? null;
  const valeur = useMemo<AccesAchats>(
    () => ({ etat, actions, membres, moi }),
    [etat, actions, membres, moi],
  );

  if (etat === 'pret' && !peutLireAchats(actions)) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
        <p className="text-sm font-medium">Les achats ne sont pas ouverts à votre rôle</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
          Fournisseurs, prix d’achat et dettes ne sont consultables que par les rôles qui en ont
          l’usage. Si vous en avez besoin, demandez à un Propriétaire ou un Administrateur de
          l’organisation de revoir vos droits.
        </p>
      </div>
    );
  }

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
