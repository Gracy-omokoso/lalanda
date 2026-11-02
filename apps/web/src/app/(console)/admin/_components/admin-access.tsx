'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Accès plateforme de la console (S21b ; ADR-0053 — P1)
//
// ── Ce composant ne protège rien ─────────────────────────────────────────────
//
// Il MASQUE. « Côté web, l'autorisation n'est jamais décidée par le client »
// (docs/12 § Modèle). Toute route `/admin/**` est gardée côté API, et un
// opérateur qui forcerait l'URL obtiendrait un 403 du serveur. Ce qu'on gagne ici
// est une interface honnête : un écran qui dit « votre rôle ne le permet pas »
// plutôt qu'une page qui se monte puis se couvre de bannières rouges.
//
// ── Un contexte plutôt qu'un appel par page ──────────────────────────────────
//
// `GET /me/platform-access` est appelé UNE fois, par la coquille de console, et
// partagé par toutes les pages : une réponse unique, donc une interface qui ne se
// contredit pas d'un module à l'autre si un rôle est révoqué entre-temps.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState } from 'react';

import { api, type PlatformAccessView } from '@/lib/api';

import { messageErreur } from './admin-model';

const AccesContext = createContext<PlatformAccessView | null>(null);

/**
 * Accès plateforme de l'utilisateur courant.
 *
 * Lève hors du fournisseur : un panneau qui s'afficherait sans contexte
 * déciderait à l'aveugle de ce qu'il montre, et le défaut le plus probable
 * serait de tout montrer.
 */
export function useAccesPlateforme(): PlatformAccessView {
  const acces = useContext(AccesContext);
  if (!acces) {
    throw new Error('useAccesPlateforme utilisé hors de la coquille de console.');
  }
  return acces;
}

export function AccesPlateformeProvider({
  acces,
  children,
}: {
  acces: PlatformAccessView;
  children: React.ReactNode;
}): React.ReactElement {
  return <AccesContext.Provider value={acces}>{children}</AccesContext.Provider>;
}

export type ChargementAcces =
  | { etat: 'chargement' }
  | { etat: 'erreur'; message: string }
  | { etat: 'pret'; acces: PlatformAccessView };

/** Lit `GET /me/platform-access` une fois — seul appel de la coquille avec les préférences. */
export function useChargementAcces(): ChargementAcces {
  const [etat, setEtat] = useState<ChargementAcces>({ etat: 'chargement' });

  useEffect(() => {
    let annule = false;
    api
      .getPlatformAccess()
      .then((acces) => {
        if (!annule) setEtat({ etat: 'pret', acces });
      })
      .catch((err: unknown) => {
        if (!annule) {
          setEtat({
            etat: 'erreur',
            message: messageErreur(err, 'Impossible de vérifier votre accès.'),
          });
        }
      });
    return () => {
      annule = true;
    };
  }, []);

  return etat;
}
