'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Porte d'entrée de l'espace admin plateforme (S21b — ADR-0012 §4)
//
// ── Ce composant ne protège rien ─────────────────────────────────────────────
//
// Il MASQUE. « Côté web, l'autorisation n'est jamais décidée par le client »
// (docs/12 § Modèle). Toute route `/admin/*` est gardée par `PermissionsGuard`
// côté API, et un opérateur qui forcerait l'URL obtiendrait un 403 du serveur.
// Ce qu'on gagne ici est une interface honnête : un écran qui dit « votre rôle
// ne le permet pas » plutôt qu'une page qui se monte puis se couvre de
// bannières rouges.
//
// La distinction compte pour la revue : si ce fichier disparaissait, aucune
// donnée ne fuirait. Si `PermissionsGuard` disparaissait, tout fuirait.
//
// ── Un contexte plutôt qu'un appel par page ──────────────────────────────────
//
// `GET /me/platform-access` est appelé UNE fois, dans le layout, et partagé par
// les quatre pages. Chaque page appelant la route elle-même produirait quatre
// requêtes par navigation et, surtout, quatre réponses potentiellement
// divergentes si un rôle était révoqué entre-temps — l'interface se
// contredirait d'un onglet à l'autre.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';
import { createContext, useContext, useEffect, useState } from 'react';

import { api, type PlatformAccessView } from '@/lib/api';

import { Bandeau, Vide } from './admin-chrome';
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
    throw new Error('useAccesPlateforme utilisé hors de <AdminAccessGate>.');
  }
  return acces;
}

export function AdminAccessGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const [acces, setAcces] = useState<PlatformAccessView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let annule = false;
    async function demarrer(): Promise<void> {
      try {
        const vue = await api.getPlatformAccess();
        if (!annule) setAcces(vue);
      } catch (err) {
        if (!annule) setErreur(messageErreur(err, 'Impossible de vérifier votre accès.'));
      } finally {
        if (!annule) setChargement(false);
      }
    }
    void demarrer();
    return () => {
      annule = true;
    };
  }, []);

  if (chargement) {
    return <p className="text-sm text-[var(--foreground-muted)]">Vérification de votre accès…</p>;
  }

  if (erreur) {
    return <Bandeau ton="echec">{erreur}</Bandeau>;
  }

  if (!acces?.canReadAdmin) {
    // Refus, et non panne. La page dit ce qui manque et à qui s'adresser —
    // « votre rôle ne le permet pas » est une information exploitable, « 403 »
    // ne l'est pas.
    return (
      <Vide>
        <p className="text-sm font-medium text-[var(--foreground)]">
          L’espace d’administration est réservé aux opérateurs de la plateforme
        </p>
        <p className="mx-auto mt-2 max-w-xl">
          {acces?.isPlatformOperator
            ? `Vos rôles plateforme (${acces.roles.map((r) => r.label).join(', ')}) n’ouvrent pas cet espace.`
            : 'Vous ne détenez aucun rôle plateforme. Un super-administrateur peut vous en attribuer un.'}
        </p>
        <p className="mt-4">
          <Link href="/projects" className="underline underline-offset-4 hover:no-underline">
            Retourner à mes projets
          </Link>
        </p>
      </Vide>
    );
  }

  return <AccesContext.Provider value={acces}>{children}</AccesContext.Provider>;
}
