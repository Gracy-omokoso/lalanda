'use client';

// Faits partagés par la coquille de l'application (ADR-0030 § 2 et § 3).
//
// Lus UNE fois au montage de la coquille — qui persiste d'une page à l'autre
// dans le routeur de Next — puis partagés : la barre latérale, la barre basse,
// les onglets d'un projet (cadenas d'offre) et la mise en route en ont besoin.
// Les espaces existants gardent leurs propres lectures (`SalesChrome`,
// `OrganizationTabs`) : la refonte ne touche pas à leur logique.
//
// Rien ici n'autorise quoi que ce soit (ADR-0012 §8) : un échec de lecture
// laisse les faits à `null`, ce qui MASQUE les entrées conditionnées et ne
// VERROUILLE rien — l'API reste seule juge.

import type { ModuleId } from '@lalanda/ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, type OrgAction, type SubscriptionStateView } from '@/lib/api';

import { cleModules, ecrireModules, lireModules } from './nav-model';

export interface ShellFacts {
  /** `null` tant que `GET /me/permissions` n'a pas répondu, ou en cas d'échec. */
  actions: OrgAction[] | null;
  /** `GET /me/permissions` a-t-il répondu (succès ou échec) ? Distingue « en cours » de « rien ». */
  chargees: boolean;
  organizationId: string | null;
  /** `null` tant que l'abonnement n'est pas lu, ou s'il ne peut pas l'être. */
  subscription: SubscriptionStateView | null;
  /** Choix de la mise en route ; `null` = tous les modules. */
  modules: ModuleId[] | null;
  setModules: (modules: readonly ModuleId[]) => void;
  /** Le choix a-t-il été fait (même « tous ») ? Sert à l'étape 4 de la mise en route. */
  modulesChoisis: boolean;
  /** Relit permissions et abonnement (après une création d'organisation, par ex.). */
  rafraichir: () => void;
}

const Contexte = createContext<ShellFacts>({
  actions: null,
  chargees: false,
  organizationId: null,
  subscription: null,
  modules: null,
  setModules: () => undefined,
  modulesChoisis: false,
  rafraichir: () => undefined,
});

export function useShell(): ShellFacts {
  return useContext(Contexte);
}

/** Lecture protégée : stockage bloqué (navigation privée, aperçu) = aucun choix. */
function lireStockage(cle: string): string | null {
  try {
    return window.localStorage.getItem(cle);
  } catch {
    return null;
  }
}

function ecrireStockage(cle: string, valeur: string | null): void {
  try {
    if (valeur === null) window.localStorage.removeItem(cle);
    else window.localStorage.setItem(cle, valeur);
  } catch {
    /* confort par appareil : un échec n'empêche rien */
  }
}

/** Marqueur « choix fait, tous les modules » : distingue « pas encore choisi » de « tout ». */
const TOUS = '"*"';

export function ShellProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [actions, setActions] = useState<OrgAction[] | null>(null);
  const [chargees, setChargees] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStateView | null>(null);
  const [modules, setModulesState] = useState<ModuleId[] | null>(null);
  const [modulesChoisis, setModulesChoisis] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    void api
      .getMyPermissions()
      .then((p) => {
        if (annule) return;
        setActions(p.actions);
        setOrganizationId(p.organizationId);
        setChargees(true);
      })
      .catch(() => {
        if (annule) return;
        setActions(null);
        setChargees(true);
      });
    void api
      .getSubscription()
      .then((s) => {
        if (!annule) setSubscription(s);
      })
      .catch(() => {
        if (!annule) setSubscription(null);
      });
    return () => {
      annule = true;
    };
  }, [version]);

  useEffect(() => {
    if (organizationId === null) return;
    const brut = lireStockage(cleModules(organizationId));
    setModulesChoisis(brut !== null);
    setModulesState(brut === TOUS ? null : lireModules(brut));
  }, [organizationId]);

  const setModules = useCallback(
    (choix: readonly ModuleId[]) => {
      if (organizationId === null) return;
      const valeur = ecrireModules(choix);
      ecrireStockage(cleModules(organizationId), valeur ?? TOUS);
      setModulesState(valeur === null ? null : lireModules(valeur));
      setModulesChoisis(true);
    },
    [organizationId],
  );

  const rafraichir = useCallback(() => setVersion((v) => v + 1), []);

  const valeur = useMemo<ShellFacts>(
    () => ({
      actions,
      chargees,
      organizationId,
      subscription,
      modules,
      setModules,
      modulesChoisis,
      rafraichir,
    }),
    [
      actions,
      chargees,
      organizationId,
      subscription,
      modules,
      setModules,
      modulesChoisis,
      rafraichir,
    ],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
