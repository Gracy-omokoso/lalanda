'use client';

// Fenêtre de ré-authentification (S21b — ADR-0013 §5).
//
// ── Pourquoi une seconde saisie du mot de passe ──────────────────────────────
//
// Une session ouverte est un état qui dure des jours; remplacer une clé Stripe
// est un acte qui dure une seconde. Le vol de session est le scénario que cette
// fenêtre coûte cher à l'attaquant : disposer du cookie ne suffit plus, il faut
// aussi le mot de passe, et la fenêtre se referme au bout de dix minutes.
//
// ── Ce que ce composant ne fait pas ──────────────────────────────────────────
//
// Il n'ouvre aucun droit. L'API vérifie la fraîcheur de la ré-authentification à
// chaque écriture et répond `401 REAUTH_REQUIRED` sinon. Cette fenêtre existe
// pour que l'opératrice ne découvre pas l'exigence APRÈS avoir tapé une clé de
// quarante caractères — le refus arriverait au pire moment, et la valeur saisie
// serait perdue.
//
// La marge de 15 s (`reauthUtilisable`) redemande le mot de passe un peu tôt
// plutôt qu'un peu tard, pour la même raison.

import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

import { Bandeau } from './admin-chrome';
import { formaterRestant, messageErreur, reauthRestantMs, reauthUtilisable } from './admin-model';

export interface Reauth {
  /** La fenêtre est-elle ouverte et assez large pour lancer une écriture ? */
  ouverte: boolean;
  restant: string;
  /** À rappeler après un `401 REAUTH_REQUIRED` : rouvre le formulaire. */
  redemander: () => void;
  rafraichir: () => void;
}

export function useReauth(): Reauth {
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const rafraichir = useCallback((): void => {
    void api
      .getReauthStatus()
      .then((s) => setExpiresAt(s.active ? s.expiresAt : null))
      // Un échec laisse la fenêtre considérée FERMÉE. Le défaut sûr est de
      // redemander le mot de passe, jamais de supposer qu'il a été donné.
      .catch(() => setExpiresAt(null));
  }, []);

  useEffect(() => {
    rafraichir();
  }, [rafraichir]);

  // Une horloge locale suffit : le décompte est indicatif, l'autorité reste
  // l'API. Une seconde de dérive n'a aucune conséquence — la marge en absorbe
  // quinze.
  useEffect(() => {
    const timer = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return {
    ouverte: reauthUtilisable(expiresAt, maintenant),
    restant: formaterRestant(reauthRestantMs(expiresAt, maintenant)),
    redemander: () => setExpiresAt(null),
    rafraichir,
  };
}

export function ReauthGate({
  reauth,
  children,
}: {
  reauth: Reauth;
  children: React.ReactNode;
}): React.ReactElement {
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function confirmer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      await api.confirmReauth(motDePasse);
      // Vidé immédiatement : le champ ne doit pas rester rempli derrière un
      // panneau replié, ni repartir dans un rendu ultérieur.
      setMotDePasse('');
      reauth.rafraichir();
    } catch (err) {
      setErreur(messageErreur(err, 'Mot de passe refusé.'));
    } finally {
      setEnvoi(false);
    }
  }

  if (reauth.ouverte) {
    return (
      <div className="flex flex-col gap-4">
        <Bandeau ton="succes">
          Fenêtre de modification ouverte — elle se referme dans {reauth.restant}. Passé ce délai,
          votre mot de passe sera redemandé.
        </Bandeau>
        {children}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
      onSubmit={(e) => void confirmer(e)}
    >
      <h2 className="font-display text-lg font-bold tracking-tight">
        Confirmez votre mot de passe
      </h2>
      <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
        Modifier un secret d’intégration exige une ré-authentification, valable dix minutes. Une
        session volée ne suffit donc pas à remplacer une clé de paiement ou d’envoi d’e-mails. La
        consultation de l’état des intégrations, elle, reste ouverte sans cette confirmation.
      </p>
      <label className="flex max-w-sm flex-col gap-1 text-sm">
        <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
          Mot de passe
        </span>
        <input
          type="password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          autoComplete="current-password"
          className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
        />
      </label>
      <div>
        <button
          type="submit"
          disabled={envoi || motDePasse === ''}
          className="rounded-md border border-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-40"
        >
          {envoi ? 'Vérification…' : 'Ouvrir la fenêtre de dix minutes'}
        </button>
      </div>
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
    </form>
  );
}
