'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { signUp } from '@/lib/auth-client';

import { GoogleButton } from '../_components/google-button';

export default function RegisterPage(): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await signUp.email({ email, password, name });
      if (res.error) {
        setError(res.error.message ?? 'Impossible de créer le compte');
        return;
      }
      router.push('/projects');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'inscription");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Créer un compte</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Une organisation personnelle est créée automatiquement.
        </p>
      </div>

      {/* Le même bouton qu'à la connexion, et c'est voulu : côté Google, créer un
          compte et s'y connecter sont la même action. Un intitulé différent ferait
          croire à deux comptes distincts selon la porte empruntée. */}
      <GoogleButton label="Continuer avec Google" />

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Nom</span>
        <input
          type="text"
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
        />
      </label>

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
        <span className="font-medium">Mot de passe</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
        />
        <span className="text-xs text-[var(--foreground-muted)]">Minimum 8 caractères.</span>
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
        {loading ? 'Création…' : 'Créer mon compte'}
      </button>

      <p className="text-center text-sm text-[var(--foreground-muted)]">
        Déjà un compte ?{' '}
        <Link
          href="/login"
          className="text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
        >
          Se connecter
        </Link>
      </p>
    </form>
  );
}
