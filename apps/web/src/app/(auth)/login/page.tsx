'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { signIn } from '@/lib/auth-client';

import { GoogleButton } from '../_components/google-button';

/**
 * Bandeaux pilotés par l'URL : `?verifie=1` après un clic sur le lien de
 * vérification d'adresse, `?erreur=google` quand la connexion Google a échoué.
 *
 * Isolé dans son propre composant sous `<Suspense>` : Next 15 refuse de
 * pré-rendre statiquement une page qui appelle `useSearchParams()` en dehors
 * d'une frontière de suspense.
 */
function UrlNotices(): React.ReactElement | null {
  const params = useSearchParams();

  if (params.get('verifie') === '1') {
    return (
      <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--surface)] p-3 text-sm">
        Votre adresse est confirmée. Connectez-vous pour continuer.
      </div>
    );
  }
  if (params.get('erreur') === 'google') {
    return (
      <div
        role="alert"
        className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
      >
        La connexion Google n’a pas abouti. Réessayez, ou connectez-vous avec votre mot de passe.
      </div>
    );
  }
  return null;
}

export default function LoginPage(): React.ReactElement {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? 'Identifiants invalides');
        return;
      }
      router.push('/projects');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Bon retour</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Connecte-toi pour retrouver tes plans financiers.
        </p>
      </div>

      <Suspense fallback={null}>
        <UrlNotices />
      </Suspense>

      <GoogleButton label="Continuer avec Google" />

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

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium">Mot de passe</span>
          <Link
            href="/mot-de-passe-oublie"
            className="text-xs text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
          >
            Mot de passe oublié ?
          </Link>
        </span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
        />
      </label>

      {error ? (
        <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? 'Connexion…' : 'Se connecter'}
      </button>

      <p className="text-center text-sm text-[var(--foreground-muted)]">
        Pas encore de compte ?{' '}
        <Link
          href="/register"
          className="text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
        >
          Créer un compte
        </Link>
      </p>
    </form>
  );
}
