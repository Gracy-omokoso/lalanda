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

import { Checkbox, Field, Form, PasswordInput, SubmitButton, TextInput } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { signUp } from '@/lib/auth-client';
// ADR-0052 — O5 : inscription venue d'une invitation.
import { TEXTE_INSCRIPTION_INVITEE, lireJetonInvitation } from '@/lib/invitation-en-attente';
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
  /** ADR-0052 — O5 : une invitation est suivie (cookie posé par le middleware). */
  const [invitee, setInvitee] = useState(false);

  useEffect(() => {
    setInvitee(lireJetonInvitation(document.cookie) !== null);
  }, []);

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
      router.push('/accueil');
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
    // `noValidate={false}` : la validation native (nom ≥ 2, adresse, mot de passe ≥ 8,
    // case obligatoire) reste active, comme avant la migration (ADR-0074).
    <Form onSubmit={(e) => void handleSubmit(e)} noValidate={false} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Créer un compte</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          {invitee
            ? TEXTE_INSCRIPTION_INVITEE
            : 'Une organisation personnelle est créée automatiquement.'}
        </p>
      </div>

      {/* Le même bouton qu'à la connexion, et c'est voulu : côté Google, créer un
          compte et s'y connecter sont la même action. Un intitulé différent ferait
          croire à deux comptes distincts selon la porte empruntée. */}
      <GoogleButton label="Continuer avec Google" />

      <Field label="Nom" required size="full">
        <TextInput
          type="text"
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Email" required size="full">
        <TextInput
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Mot de passe" required size="full" hint="Minimum 8 caractères.">
        <PasswordInput
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {/* Case JAMAIS pré-cochée (`termsAccepted` part de `false`, voir l'en-tête) ;
          `required` natif gardé, doublé du contrôle de `handleSubmit`. */}
      <Checkbox
        required
        checked={termsAccepted}
        onChange={setTermsAccepted}
        label={
          <>
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
          </>
        }
        description={
          <>
            Version du corpus&nbsp;: {LEGAL_VERSION}. Les liens s&apos;ouvrent dans un nouvel
            onglet&nbsp;: votre saisie n&apos;est pas perdue.
          </>
        }
      />

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      <SubmitButton busy={loading} busyLabel="Création…" size="lg" className="mt-2 w-full">
        Créer mon compte
      </SubmitButton>

      <p className="text-center text-sm text-[var(--foreground-muted)]">
        Déjà un compte ?{' '}
        <Link
          href="/login"
          className="text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
        >
          Se connecter
        </Link>
      </p>
    </Form>
  );
}
