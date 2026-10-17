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
// Cocher la case ne suffit pas : la version du corpus AFFICHÉE À CET ÉCRAN part
// avec la demande de création (`termsVersion`), et l'API l'enregistre au moment
// même où le compte naît (v0.4.3, `databaseHooks` d'auth.ts). Elle REFUSE de
// créer un compte mot de passe sans version publiée.
//
// Avant la v0.4.3, l'accord partait APRÈS l'inscription par un appel qui exige
// une session. Une fois la vérification d'adresse obligatoire, l'inscription
// n'ouvre plus de session : l'appel tombait en 401, le compte existait sans
// preuve d'accord, et l'écran « Une dernière étape » n'avait aucune issue.
//
// ── APRÈS L'INSCRIPTION ──────────────────────────────────────────────────────
// Session ouverte (vérification non exigée) → l'application. Pas de session
// (vérification exigée) → écran « confirmez votre adresse » : le lien est déjà
// parti (`sendOnSignUp`).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { signUp } from '@/lib/auth-client';
import { LEGAL_VERSION } from '@/lib/legal';

import { GoogleButton } from '../_components/google-button';

export default function RegisterPage(): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // JAMAIS `true` — voir l'en-tête de fichier.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Compte créé, adresse à confirmer : l'inscription n'a pas ouvert de session. */
  const [verificationSent, setVerificationSent] = useState(false);

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
      // `termsVersion` n'est pas dans le type du client better-auth (ce n'est pas
      // un champ du modèle user) mais il part bien dans le corps : l'API le lit
      // dans son crochet de création et refuse l'inscription sans lui.
      const signUpBody = { email, password, name, termsVersion: LEGAL_VERSION };
      const res = await signUp.email(signUpBody as Parameters<typeof signUp.email>[0]);
      if (res.error) {
        setError(res.error.message ?? 'Impossible de créer le compte');
        return;
      }
      if (!res.data?.token) {
        setVerificationSent(true);
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

  if (verificationSent) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h2 className="text-2xl font-semibold tracking-tight">Confirmez votre adresse</h2>
        <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--surface)] p-4 text-sm leading-6">
          <p>
            Votre compte est créé. Nous venons d&apos;envoyer un lien de confirmation à {email}.
          </p>
          <p className="mt-2 text-[var(--foreground-muted)]">
            Cliquez sur ce lien pour activer votre compte — il est valable 24 heures. Pensez à
            regarder dans les indésirables.
          </p>
        </div>
        <p className="text-center text-sm text-[var(--foreground-muted)]">
          Lien expiré ou perdu ? Connectez-vous : un nouveau lien vous sera envoyé.{' '}
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
