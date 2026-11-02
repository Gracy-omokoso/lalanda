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
//
// ADR-0041 G8 : les permissions sont RELUES au retour de focus de l'onglet et
// après tout `403 FORBIDDEN` du guard — une autorisation ajoutée ou retirée par
// un administrateur apparaît sans reconnexion. La page des membres les relit
// aussi après chacune de ses écritures (`relirePermissions`).

import type { ModuleId } from '@lalanda/ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, type OrgAction, type SubscriptionStateView } from '@/lib/api';
import {
  EVENEMENT_REFUS_API,
  apiAutorisations,
  creerLimiteurRelecture,
  estRefusDePermission,
  type MesPermissions,
} from '@/lib/api-permissions';

// ADR-0052 — O3 : le choix des modules vient du serveur (`organization_setup`).
import { organizationSetupApi } from '@/lib/api-organization-setup';

import { planModules } from './modules-organisation-model';
import { MODULE_IDS, cleModules } from './nav-model';

export interface ShellFacts {
  /** `null` tant que `GET /me/permissions` n'a pas répondu, ou en cas d'échec. */
  actions: OrgAction[] | null;
  /** `GET /me/permissions` a-t-il répondu (succès ou échec) ? Distingue « en cours » de « rien ». */
  chargees: boolean;
  organizationId: string | null;
  /** `null` tant que l'abonnement n'est pas lu, ou s'il ne peut pas l'être. */
  subscription: SubscriptionStateView | null;
  /** Choix de l'organisation (ADR-0052 — O3) ; `null` = tous les modules. */
  modules: ModuleId[] | null;
  /** Enregistre le choix pour l'organisation (`organization.manage`) ; rejette en cas d'échec. */
  setModules: (modules: readonly ModuleId[]) => Promise<void>;
  /** Le choix de l'organisation a-t-il été fait (même « tous ») ? */
  modulesChoisis: boolean;
  /** L'appelant peut-il enregistrer le choix de l'organisation ? (`canAct` de l'étape). */
  peutChoisirModules: boolean;
  /** Relit permissions et abonnement (après une création d'organisation, par ex.). */
  rafraichir: () => void;
  /** ADR-0041 — réponse complète de `GET /me/permissions` (titre, écart, ajoutables). */
  permissions: MesPermissions | null;
  /** ADR-0041 G8 — relit `GET /me/permissions` seul. */
  relirePermissions: () => void;
}

const Contexte = createContext<ShellFacts>({
  actions: null,
  chargees: false,
  organizationId: null,
  subscription: null,
  modules: null,
  setModules: () => Promise.resolve(),
  modulesChoisis: false,
  peutChoisirModules: false,
  rafraichir: () => undefined,
  permissions: null,
  relirePermissions: () => undefined,
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

/** ADR-0052 — O3 : l'ancienne valeur locale n'est plus jamais écrite, seulement effacée. */
function effacerStockage(cle: string): void {
  try {
    window.localStorage.removeItem(cle);
  } catch {
    /* stockage bloqué : rien à effacer */
  }
}

export function ShellProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [actions, setActions] = useState<OrgAction[] | null>(null);
  const [chargees, setChargees] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStateView | null>(null);
  const [modules, setModulesState] = useState<ModuleId[] | null>(null);
  const [modulesChoisis, setModulesChoisis] = useState(false);
  const [peutChoisirModules, setPeutChoisirModules] = useState(false);
  const [version, setVersion] = useState(0);
  const [versionPermissions, setVersionPermissions] = useState(0);
  const [permissions, setPermissions] = useState<MesPermissions | null>(null);

  useEffect(() => {
    let annule = false;
    void apiAutorisations
      .getMesPermissions()
      .then((p) => {
        if (annule) return;
        setPermissions(p);
        setActions(p.actions);
        setOrganizationId(p.organizationId);
        setChargees(true);
      })
      .catch(() => {
        if (annule) return;
        // Une RELECTURE en échec (réseau coupé au retour de focus) garde les faits
        // déjà lus : masquer toute la navigation pour un hoquet n'aiderait personne.
        if (versionPermissions > 0) return;
        setPermissions(null);
        setActions(null);
        setChargees(true);
      });
    return () => {
      annule = true;
    };
  }, [version, versionPermissions]);

  useEffect(() => {
    let annule = false;
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

  // ADR-0052 — O3 : choix des modules de l'organisation, lu sur le serveur ; l'ancienne
  // valeur du navigateur est reprise une fois (par un gérant) puis effacée (critère 11).
  useEffect(() => {
    if (organizationId === null) return;
    let annule = false;
    const cle = cleModules(organizationId);
    const appliquer = (m: ModuleId[] | null, choisi: boolean): void => {
      if (annule) return;
      setModulesState(m);
      setModulesChoisis(choisi);
    };
    void api
      .getOrganizationSetup()
      .then(async (vue) => {
        const etape = vue.steps.find((s) => s.id === 'modules');
        const choisiServeur = etape?.state === 'done';
        if (!annule) setPeutChoisirModules(etape?.canAct ?? false);
        const plan = planModules({
          choisiServeur,
          brutLocal: lireStockage(cle),
          peutEnregistrer: etape?.canAct ?? false,
        });
        if (plan.type === 'serveur') {
          if (plan.effacerLocal) effacerStockage(cle);
          appliquer(vue.modules, true);
        } else if (plan.type === 'migrer') {
          try {
            const relue = await organizationSetupApi.putModules(plan.modules);
            effacerStockage(cle);
            appliquer(relue.modules, true);
          } catch {
            // Reprise refusée ou réseau coupé : la valeur locale reste, rien n'est perdu.
            appliquer(plan.modules, false);
          }
        } else if (plan.type === 'local') {
          appliquer(plan.modules, false);
        } else {
          appliquer(null, false);
        }
      })
      .catch(() => {
        // Statut illisible : aucun module mis en avant, rien n'est verrouillé.
        appliquer(null, false);
      });
    return () => {
      annule = true;
    };
  }, [organizationId, version]);

  const setModules = useCallback(async (choix: readonly ModuleId[]): Promise<void> => {
    const tous = MODULE_IDS.every((m) => choix.includes(m));
    const relue = await organizationSetupApi.putModules(tous ? null : [...choix]);
    setModulesState(relue.modules);
    setModulesChoisis(true);
  }, []);

  const rafraichir = useCallback(() => setVersion((v) => v + 1), []);
  const relirePermissions = useCallback(() => setVersionPermissions((v) => v + 1), []);

  // ADR-0041 G8 — relecture au retour sur l'onglet et après un refus du guard.
  // Le limiteur évite qu'une rafale de `403` ou un focus suivi d'un
  // `visibilitychange` ne déclenche plusieurs lectures.
  useEffect(() => {
    const peutRelire = creerLimiteurRelecture();
    const relire = (): void => {
      if (peutRelire(Date.now())) relirePermissions();
    };
    const auFocus = (): void => relire();
    const auRetour = (): void => {
      if (document.visibilityState === 'visible') relire();
    };
    const auRefus = (e: Event): void => {
      if (estRefusDePermission((e as CustomEvent<unknown>).detail)) relire();
    };
    window.addEventListener('focus', auFocus);
    document.addEventListener('visibilitychange', auRetour);
    window.addEventListener(EVENEMENT_REFUS_API, auRefus);
    return () => {
      window.removeEventListener('focus', auFocus);
      document.removeEventListener('visibilitychange', auRetour);
      window.removeEventListener(EVENEMENT_REFUS_API, auRefus);
    };
  }, [relirePermissions]);

  const valeur = useMemo<ShellFacts>(
    () => ({
      actions,
      chargees,
      organizationId,
      subscription,
      modules,
      setModules,
      modulesChoisis,
      peutChoisirModules,
      rafraichir,
      permissions,
      relirePermissions,
    }),
    [
      actions,
      chargees,
      organizationId,
      subscription,
      modules,
      setModules,
      modulesChoisis,
      peutChoisirModules,
      rafraichir,
      permissions,
      relirePermissions,
    ],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
