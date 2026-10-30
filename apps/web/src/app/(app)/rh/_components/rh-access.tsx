'use client';

// Frontière d'accès de l'application Ressources humaines (ADR-0045 § 8, lot H6),
// sur le modèle des Achats : pas de rangée d'onglets, la colonne de gauche est la
// seule navigation (ADR-0038 § 3).
//
// Condition d'entrée : `leave.request` OU `hr.read` (actions de la coquille,
// jamais le nom du rôle). Le contexte ajoute `GET /hr/me` (ma fiche, `isManager`,
// `canApprove`), lu une fois et relu après une demande ou une décision. Une
// route pas encore livrée (404) reste une lecture en échec : chaque écran le dit.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { hrApi, type HrMeView } from '@/lib/api-hr';

import { useShell } from '../../_components/shell-context';

import { lire, peutEntrerRh, type Lecture } from './rh-model';

type Etat = 'chargement' | 'pret' | 'echec';

interface AccesRh {
  etat: Etat;
  actions: OrgAction[] | null;
  /** `null` tant que `GET /hr/me` n'a pas répondu. */
  moi: Lecture<HrMeView> | null;
  relireMoi: () => void;
}

const Contexte = createContext<AccesRh>({
  etat: 'chargement',
  actions: null,
  moi: null,
  relireMoi: () => undefined,
});

export function useAccesRh(): AccesRh {
  return useContext(Contexte);
}

export function RhChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const { actions, chargees } = useShell();
  const etat: Etat = !chargees ? 'chargement' : actions === null ? 'echec' : 'pret';
  const entree = etat === 'pret' && peutEntrerRh(actions);
  const [moi, setMoi] = useState<Lecture<HrMeView> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!entree) return;
    let annule = false;
    void lire(hrApi.getMe()).then((l) => {
      if (!annule) setMoi(l);
    });
    return () => {
      annule = true;
    };
  }, [entree, version]);

  const relireMoi = useCallback(() => setVersion((v) => v + 1), []);
  const valeur = useMemo<AccesRh>(
    () => ({ etat, actions, moi, relireMoi }),
    [etat, actions, moi, relireMoi],
  );

  if (etat === 'pret' && !peutEntrerRh(actions)) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
        <p className="text-sm font-medium">Les ressources humaines ne sont pas ouvertes à votre rôle</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
          Demander une absence et consulter son espace sont réservés aux membres internes de
          l’organisation. Si vous en avez besoin, demandez à un Propriétaire ou un Administrateur de
          revoir vos droits.
        </p>
      </div>
    );
  }

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
