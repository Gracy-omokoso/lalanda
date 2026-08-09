'use client';

// Création de compte, avec acceptation explicite des conditions (S22c).
//
// ── LA CASE N'EST PAS PRÉ-COCHÉE, ET NE DOIT JAMAIS L'ÊTRE ────────────────────
//
// `useState(false)` est ici une règle, pas une valeur initiale de commodité. Une
// case pré-cochée transforme l'acceptation en défaut qu'on subit : l'utilisateur
// n'a alors rien accepté, il a omis de refuser. C'est la modification d'une
// seule ligne qui vide de sa substance tout le dispositif de preuve construit
// derrière (`terms_acceptances` côté API) — la preuve resterait techniquement
// correcte tout en attestant d'un accord que personne n'a donné.
//
// ── L'ACCEPTATION EST ENREGISTRÉE, PAS SEULEMENT VÉRIFIÉE ─────────────────────
//
// Cocher la case ne suffit pas : l'accord est envoyé à l'API avec la version du
// corpus AFFICHÉE À CET ÉCRAN. Si cet enregistrement échoue, on ne navigue PAS
// en silence — le compte existe déjà, mais l'accord n'est pas prouvé, et
// l'utilisateur se voit proposer de réessayer. Avaler l'échec produirait
// exactement la situation qu'on cherche à éviter : un compte actif dont on ne
// peut pas montrer qu'il a accepté quoi que ce soit.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api';
import { signUp } from '@/lib/auth-client';
import { LEGAL_VERSION } from '@/lib/legal';

export default function RegisterPage(): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // JAMAIS `true` — voir l'en-tête de fichier.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Le compte existe, mais l'acceptation n'a pas pu être enregistrée. */
  const [acceptancePending, setAcceptancePending] = useState(false);

  /** Enregistre l'accord et navigue. Réutilisé par le bouton « Réessayer ». */
  async function recordAcceptanceAndContinue(): Promise<void> {
    await api.acceptTerms(LEGAL_VERSION);
    setAcceptancePending(false);
    router.push('/projects');
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!termsAccepted) {
      // Double sécurité avec l'attribut `required` : un `required` retiré par
      // l'inspecteur ne doit pas suffire à créer un compte sans accord.
      setError('Vous devez accepter les conditions pour créer un compte.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await signUp.email({ email, password, name });
      if (res.error) {
        setError(res.error.message ?? 'Impossible de créer le compte');
        return;
      }
      try {
        await recordAcceptanceAndContinue();
      } catch {
        setAcceptancePending(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'inscription");
    } finally {
      setLoading(false);
    }
  }

  async function handleRetryAcceptance(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await recordAcceptanceAndContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'enregistrer votre acceptation.");
    } finally {
      setLoading(false);
    }
  }

  if (acceptancePending) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Une dernière étape</h2>
        <div className="rounded-md border border-[var(--warn)] bg-[var(--surface-muted)] p-4 text-sm leading-6">
          <p>
            Votre compte a bien été créé, mais nous n&apos;avons pas pu enregistrer votre
            acceptation des conditions. Nous préférons vous le dire plutôt que de considérer que
            c&apos;est fait.
          </p>
        </div>
        {error ? (
          <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        ) : null}
        <button
          type="button"
          onClick={handleRetryAcceptance}
          disabled={loading}
          className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Enregistrement…' : 'Réessayer'}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Créer un compte</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Une organisation personnelle est créée automatiquement.
        </p>
      </div>

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

      <label className="flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          required
          checked={termsAccepted}
          onChange={(e) => setTermsAccepted(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
        />
        <span>
          J&apos;ai lu et j&apos;accepte les{' '}
          <Link href="/cgu" target="_blank" className="underline underline-offset-4">
            conditions générales d&apos;utilisation
          </Link>
          , les{' '}
          <Link href="/cgv" target="_blank" className="underline underline-offset-4">
            conditions générales de vente
          </Link>{' '}
          et la{' '}
          <Link href="/confidentialite" target="_blank" className="underline underline-offset-4">
            politique de confidentialité
          </Link>
          .
          <span className="mt-1 block text-xs text-[var(--foreground-muted)]">
            Version du corpus&nbsp;: {LEGAL_VERSION}. Les liens s&apos;ouvrent dans un nouvel
            onglet&nbsp;: votre saisie n&apos;est pas perdue.
          </span>
        </span>
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
