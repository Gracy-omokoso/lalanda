'use client';

// Profil du compte, lu UNE FOIS et partagé (ADR-0016 §7, étape E3).
//
// ── Pourquoi ce module existe ────────────────────────────────────────────────
// Les initiales font autorité côté serveur : `initialsOf(name, email)` les
// calcule à partir du NOM AFFICHÉ (`apps/api/src/account/account.controller.ts`)
// et les sert dans `AccountProfileView.initials`. Le header en avait un second
// calcul, fondé sur l'adresse seule : « Marie-Claire Nsimba » <mcn@…> portait
// `MN` sur /compte et `MC` dans la barre. Une seule autorité, celle du serveur —
// c'est sur /compte que la personne saisit son nom et voit le résultat.
//
// Le header a donc besoin du profil. Le lire dans chaque composant qui l'affiche
// produirait deux appels par page (barre + panneau /compte). Ce module le lit
// une fois et le partage.
//
// ── Pourquoi un store de module et non un React context ──────────────────────
// Un `createContext` exigerait un Provider enveloppant à la fois le header et
// les pages, donc une modification de `(app)/layout.tsx`. Un store de module
// atteint le même résultat sans toucher au layout, et rend le partage
// indépendant de la position dans l'arbre. Le coût — un état hors React — est
// contenu par `useSyncExternalStore`, qui est fait pour ça.
//
// ── Ce que ce module ne fait PAS ─────────────────────────────────────────────
// Il ne connaît AUCUN champ de photo. Le contrat d'API de l'envoi de photo est
// en cours de construction et n'est pas figé (ADR-0016 §7, étape E4) : rien ici
// ne présume du nom du champ ni de la forme de l'URL. Le jour où le contrat
// existera, `AccountProfileView` gagnera un champ et c'est le seul endroit qui
// devra le savoir.

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { api, type AccountProfileView } from '@/lib/api';

export interface EtatProfil {
  /** `null` tant que la réponse n'est pas arrivée, ou après un échec. */
  profil: AccountProfileView | null;
  /** Message prêt à afficher, ou `null`. Le header l'ignore, /compte l'affiche. */
  erreur: string | null;
  /** Un appel est en vol. Distinct de « profil absent » : un échec n'est pas une attente. */
  chargement: boolean;
}

const VIDE: EtatProfil = { profil: null, erreur: null, chargement: false };

/**
 * Instantané rendu côté serveur.
 *
 * Constante dédiée, jamais l'état vivant du module : sur le serveur, un état de
 * module est partagé entre les requêtes, et y exposer le profil d'un utilisateur
 * le ferait fuir vers la requête suivante. Rien n'écrit ici pendant le rendu
 * serveur — `charger()` ne part que d'un effet — mais la garantie doit tenir
 * même si quelqu'un l'oublie plus tard.
 */
const ETAT_SERVEUR: EtatProfil = { profil: null, erreur: null, chargement: true };

let etat: EtatProfil = VIDE;
let enVol: Promise<void> | null = null;
const abonnes = new Set<() => void>();

function poser(suivant: EtatProfil): void {
  etat = suivant;
  for (const notifier of abonnes) notifier();
}

function sabonner(notifier: () => void): () => void {
  abonnes.add(notifier);
  return () => {
    abonnes.delete(notifier);
  };
}

function lire(): EtatProfil {
  return etat;
}

function lireServeur(): EtatProfil {
  return ETAT_SERVEUR;
}

/**
 * Déclenche la lecture si elle n'a pas déjà eu lieu.
 *
 * `enVol` déduplique : deux composants montés dans le même rendu produisent un
 * seul appel réseau. Un échec relâche le verrou, pour qu'un remontage puisse
 * réessayer plutôt que de rester bloqué sur une erreur transitoire.
 */
function charger(): void {
  if (enVol !== null || etat.profil !== null) return;
  poser({ ...etat, erreur: null, chargement: true });
  enVol = api
    .getAccountProfile()
    .then((profil) => {
      poser({ profil, erreur: null, chargement: false });
    })
    .catch((err: unknown) => {
      poser({
        profil: null,
        erreur: err instanceof Error ? err.message : 'Impossible de charger votre profil',
        chargement: false,
      });
    })
    .finally(() => {
      enVol = null;
    });
}

/**
 * Remplace le profil partagé après une écriture réussie.
 *
 * Appelé par `/compte` quand la personne enregistre son nom : les initiales de
 * la barre suivent immédiatement, sans second appel et sans rechargement de
 * page. C'est la contrepartie utile de l'autorité unique.
 */
export function publierProfil(profil: AccountProfileView): void {
  poser({ profil, erreur: null, chargement: false });
}

/**
 * Vide le cache. À appeler à la DÉCONNEXION : le profil de la personne qui part
 * ne doit pas rester affiché pour celle qui se connecte ensuite.
 */
export function oublierProfil(): void {
  enVol = null;
  poser(VIDE);
}

/**
 * Profil partagé.
 *
 * `charge: false` (défaut `true`) pour lire l'état sans provoquer d'appel —
 * inutile ici pour l'instant, mais c'est ce qui distingue « je consomme » de
 * « je réclame ».
 */
export function useProfil(options?: { charge?: boolean }): EtatProfil & {
  rafraichir: () => void;
} {
  const doitCharger = options?.charge ?? true;
  const instantane = useSyncExternalStore(sabonner, lire, lireServeur);

  useEffect(() => {
    if (doitCharger) charger();
  }, [doitCharger]);

  const rafraichir = useCallback(() => {
    oublierProfil();
    charger();
  }, []);

  return { ...instantane, rafraichir };
}

/**
 * Réinitialisation du store entre deux tests. Sans export dédié, un test qui
 * remplit le cache contaminerait le suivant.
 */
export function __resetProfilPourTests(): void {
  oublierProfil();
}
