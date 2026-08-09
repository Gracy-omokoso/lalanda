'use client';

// Demande de réinitialisation de mot de passe (S22a).
//
// ── LA RÉPONSE EST TOUJOURS LA MÊME ──────────────────────────────────────────
// Adresse connue ou inconnue, cette page affiche EXACTEMENT le même message de
// confirmation. C'est la règle de non-énumération : un formulaire qui répond
// « adresse inconnue » se transforme en oracle permettant de savoir qui possède
// un compte, information qui alimente ensuite hameçonnage ciblé et bourrage
// d'identifiants (docs/17 § Menaces prioritaires).
//
// L'API tient déjà cette règle côté serveur (better-auth répond `{status: true}`
// dans les deux cas, en simulant même la génération d'un jeton pour ne pas se
// trahir par son temps de réponse). Cette page ne doit donc surtout pas
// « améliorer » l'expérience en distinguant les cas : on passe à l'écran de
// confirmation dès que la requête aboutit, sans regarder plus loin.
//
// Une erreur RÉSEAU, elle, est signalée — « nous n'avons pas pu traiter votre
// demande » ne dit rien sur l'existence du compte, et taire une panne laisserait
// quelqu'un attendre indéfiniment un email qui n'a jamais été demandé.

import Link from 'next/link';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

export default function ForgotPasswordPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await authClient.requestPasswordReset({ email });
      if (res.error) {
        // Un échec ici est une panne (API injoignable, limite de débit atteinte),
        // jamais « cette adresse n'existe pas » : le serveur ne le dit pas.
        setError('Nous n’avons pas pu traiter votre demande. Réessayez dans un instant.');
        return;
      }
      setSent(true);
    } catch {
      setError('Nous n’avons pas pu traiter votre demande. Réessayez dans un instant.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Vérifiez votre boîte email</h2>
          <p className="text-sm text-[var(--foreground-muted)]">
            Si un compte existe pour <span className="font-medium">{email}</span>, un lien de
            réinitialisation vient d’y être envoyé.
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--foreground-muted)]">
          Le lien est valable 30 minutes et ne peut servir qu’une seule fois. Pensez à regarder dans
          les indésirables.
        </div>

        <p className="text-center text-sm text-[var(--foreground-muted)]">
          <Link
            href="/login"
            className="text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
          >
            Retour à la connexion
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Mot de passe oublié</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Indiquez l’adresse de votre compte : nous vous enverrons un lien pour choisir un nouveau
          mot de passe.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
        />
      </label>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? 'Envoi…' : 'Envoyer le lien'}
      </button>

      <p className="text-center text-sm text-[var(--foreground-muted)]">
        <Link
          href="/login"
          className="text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
        >
          Retour à la connexion
        </Link>
      </p>
    </form>
  );
}
