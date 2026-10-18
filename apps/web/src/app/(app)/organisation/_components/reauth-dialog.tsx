'use client';

// Boîte de ré-authentification de l'onglet Fiscalité (S25b — ADR-0021 §8).
//
// Les écritures qui engagent le contribuable (jeton, désactivation, retrait d'un
// point de vente, changement d'environnement) exigent une ré-authentification
// de moins de dix minutes. L'API répond `401 REAUTH_REQUIRED` sinon : cette
// boîte demande alors le mot de passe (`POST /me/reauth`), et l'appelant REJOUE
// UNE FOIS la requête (`avecReauth`, fiscal-model.ts).
//
// Compte créé par Google, sans mot de passe : l'API répond
// `401 REAUTH_GOOGLE_REQUIRED`. La boîte propose « Se reconnecter avec Google »,
// qui quitte la page et y revient (`?reauth=google`). L'action interrompue est
// décrite dans `sessionStorage` SANS JETON (`ActionReprise`) ; le panneau la
// propose au retour. Une action qui portait un jeton n'est pas reprise : la
// personne le saisit à nouveau — un jeton ne se range jamais dans le navigateur.
//
// La boîte n'ouvre aucun droit : elle prouve seulement la présence de la
// personne. Le serveur vérifie la fenêtre à chaque écriture.

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

import { type ActionReprise, type ModeReauth, serialiserReprise } from './fiscal-model';
import { codeErreur } from './organization-model';

export const CLE_REPRISE = 'lalanda.fiscalite.reprise';
export const PARAM_RETOUR_GOOGLE = 'reauth';

interface Demande {
  mode: ModeReauth;
  reprise: ActionReprise | null;
  resoudre: (ouverte: boolean) => void;
}

export interface ReauthDialog {
  /**
   * Ouvre la boîte. Résout `true` quand la fenêtre est ouverte, `false` si la
   * personne annule. En mode Google, la page est quittée : la promesse ne se
   * résout pas, et `reprise` est conservée pour le retour.
   */
  demander: (mode: ModeReauth, reprise?: ActionReprise | null) => Promise<boolean>;
  element: React.ReactElement | null;
}

export function useReauthDialog(): ReauthDialog {
  const [demande, setDemande] = useState<Demande | null>(null);

  const demander = useCallback(
    (mode: ModeReauth, reprise: ActionReprise | null = null): Promise<boolean> =>
      new Promise<boolean>((resoudre) => setDemande({ mode, reprise, resoudre })),
    [],
  );

  const fermer = useCallback(
    (ouverte: boolean): void => {
      demande?.resoudre(ouverte);
      setDemande(null);
    },
    [demande],
  );

  return {
    demander,
    element: demande ? (
      <ReauthModal modeInitial={demande.mode} reprise={demande.reprise} onFermer={fermer} />
    ) : null,
  };
}

function ReauthModal({
  modeInitial,
  reprise,
  onFermer,
}: {
  modeInitial: ModeReauth;
  reprise: ActionReprise | null;
  onFermer: (ouverte: boolean) => void;
}): React.ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<ModeReauth>(modeInitial);
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // `showModal()` : piège du focus, touche Échap et arrière-plan inerte sont
  // fournis par le navigateur — rien à réimplémenter.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  async function confirmer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      await api.confirmMeReauth(motDePasse);
      setMotDePasse('');
      onFermer(true);
    } catch (err) {
      setMotDePasse('');
      if (codeErreur(err) === 'REAUTH_GOOGLE_REQUIRED') {
        setMode('google');
      } else if (codeErreur(err) === 'INVALID_PASSWORD') {
        setErreur('Mot de passe incorrect.');
      } else {
        setErreur(
          err instanceof Error && err.message !== '' ? err.message : 'Vérification impossible.',
        );
      }
    } finally {
      setEnvoi(false);
    }
  }

  async function google(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      if (reprise) {
        try {
          window.sessionStorage.setItem(CLE_REPRISE, serialiserReprise(reprise));
        } catch {
          // Stockage refusé (navigation privée) : la connexion reste possible,
          // seule la reprise automatique sera perdue.
        }
      }
      const retour = `${window.location.origin}${window.location.pathname}`;
      const res = await authClient.signIn.social({
        provider: 'google',
        callbackURL: `${retour}?${PARAM_RETOUR_GOOGLE}=google`,
        errorCallbackURL: `${retour}?${PARAM_RETOUR_GOOGLE}=echec`,
      });
      if (res.error) {
        setErreur(res.error.message ?? 'Connexion Google impossible.');
        setEnvoi(false);
      }
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Connexion Google impossible.');
      setEnvoi(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="reauth-titre"
      aria-describedby="reauth-texte"
      onCancel={(e) => {
        e.preventDefault();
        onFermer(false);
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--foreground)] backdrop:bg-black/50"
    >
      <h2 id="reauth-titre" className="font-display text-lg font-bold tracking-tight">
        Confirmez votre identité
      </h2>
      <p id="reauth-texte" className="mt-2 text-sm text-[var(--foreground-muted)]">
        Cette opération engage votre organisation auprès de la DGI. Par sécurité, elle exige une
        confirmation récente, valable dix minutes : une session ouverte sur un autre appareil ne
        suffit pas.
      </p>

      {mode === 'password' ? (
        <form onSubmit={(e) => void confirmer(e)} className="mt-4 flex flex-col gap-3">
          <label htmlFor="reauth-mdp" className="text-sm font-medium">
            Mot de passe
          </label>
          <input
            id="reauth-mdp"
            type="password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
          />
          {erreur ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {erreur}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onFermer(false)}
              className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={envoi || motDePasse === ''}
              className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition disabled:opacity-50"
            >
              {envoi ? 'Vérification…' : 'Confirmer et poursuivre'}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm">
            Votre compte se connecte avec Google. Reconnectez-vous : vous reviendrez sur cette page.
          </p>
          <p className="text-xs text-[var(--foreground-muted)]">
            {reprise
              ? 'L’action en cours vous sera proposée à votre retour.'
              : 'Si vous étiez en train de saisir un jeton, il faudra le saisir à nouveau : un jeton n’est jamais conservé dans le navigateur.'}
          </p>
          {erreur ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {erreur}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onFermer(false)}
              className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void google()}
              disabled={envoi}
              autoFocus
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50"
            >
              {envoi ? 'Redirection…' : 'Se reconnecter avec Google'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
