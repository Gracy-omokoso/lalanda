'use client';

// Choix d'un nouveau mot de passe à partir du lien reçu par email (S22a).
//
//   /nouveau-mot-de-passe?token=…
//
// LE JETON N'EST PAS VÉRIFIÉ ICI, et il ne peut pas l'être : sa validité vit
// côté serveur (better-auth le consomme, à usage unique, avec expiration). La
// page l'accepte donc en l'état et laisse `resetPassword` trancher. Une
// pré-vérification par un appel dédié ajouterait un aller-retour, et surtout un
// endpoint qui répond « ce jeton existe » — soit exactement l'oracle que le flux
// s'applique à ne pas offrir.
//
// La confirmation du mot de passe est comparée AVANT l'appel réseau : une faute
// de frappe ne doit pas consommer le jeton. C'est le seul contrôle local, et il
// existe précisément parce que l'échec serait irréversible — le lien ne sert
// qu'une fois.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { authClient } from '@/lib/auth-client';

/** Aligné sur `minLength` de l'inscription et sur le minimum de better-auth. */
const MIN_PASSWORD_LENGTH = 8;

function ResetForm(): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <Invalid message="Ce lien est incomplet : le jeton de réinitialisation est absent de l’adresse." />
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (password !== confirmation) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      return;
    }

    setLoading(true);
    try {
      const res = await authClient.resetPassword({ newPassword: password, token });
      if (res.error) {
        // Message uniforme : le serveur ne distingue pas « inconnu », « expiré »
        // et « déjà utilisé », et l'interface ne doit pas inventer la nuance.
        setError(
          'Ce lien est invalide, expiré ou déjà utilisé. Demandez-en un nouveau depuis la page « Mot de passe oublié ».',
        );
        return;
      }
      setDone(true);
      // Toutes les sessions ont été révoquées côté serveur : on renvoie vers la
      // connexion plutôt que vers l'application, où l'utilisateur serait éjecté.
      setTimeout(() => router.push('/login'), 1500);
    } catch {
      setError('Nous n’avons pas pu réinitialiser votre mot de passe. Réessayez dans un instant.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Mot de passe mis à jour</h2>
          <p className="text-sm text-[var(--foreground-muted)]">
            Vos autres sessions ont été déconnectées par sécurité. Redirection vers la connexion…
          </p>
        </div>
        <p className="text-center text-sm text-[var(--foreground-muted)]">
          <Link
            href="/login"
            className="text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
          >
            Se connecter
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Nouveau mot de passe</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Choisissez un mot de passe que vous n’utilisez nulle part ailleurs.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Nouveau mot de passe</span>
        <input
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
        />
        <span className="text-xs text-[var(--foreground-muted)]">
          Minimum {MIN_PASSWORD_LENGTH} caractères.
        </span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Confirmation</span>
        <input
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
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
        {loading ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
      </button>
    </form>
  );
}

function Invalid({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Lien inutilisable</h2>
        <p className="text-sm text-[var(--foreground-muted)]">{message}</p>
      </div>
      <p className="text-center text-sm text-[var(--foreground-muted)]">
        <Link
          href="/mot-de-passe-oublie"
          className="text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
        >
          Demander un nouveau lien
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage(): React.ReactElement {
  // Next 15 : `useSearchParams()` doit vivre sous <Suspense> pour le pré-rendu.
  return (
    <Suspense fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>}>
      <ResetForm />
    </Suspense>
  );
}
