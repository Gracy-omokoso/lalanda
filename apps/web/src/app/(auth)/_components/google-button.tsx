'use client';

// Bouton « Continuer avec Google » (S22a).
//
// IL NE S'AFFICHE QUE SI L'API SAIT LE TRAITER. La disponibilité est demandée à
// `GET /auth-providers`, qui la dérive de la configuration réellement chargée par
// better-auth. Une variable `NEXT_PUBLIC_GOOGLE_ENABLED` aurait été une seconde
// source de vérité, et la panne qui en découle est toujours la même : un bouton
// visible qui mène à une page d'erreur parce qu'on a renseigné le front sans
// configurer le back.
//
// Tant que la réponse n'est pas arrivée, le composant ne rend RIEN — ni bouton,
// ni squelette. Afficher un bouton grisé puis le faire disparaître donnerait
// l'impression d'une fonctionnalité retirée ; l'absence pure est plus honnête et
// ne déplace pas le formulaire sous le curseur de quelqu'un qui a déjà commencé
// à saisir son mot de passe.

import { useEffect, useState } from 'react';

import { authClient } from '@/lib/auth-client';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

type Availability = 'unknown' | 'available' | 'unavailable';

export function GoogleButton({ label }: { label: string }): React.ReactElement | null {
  const [availability, setAvailability] = useState<Availability>('unknown');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/auth-providers`, { credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { google?: boolean };
        if (!canceled) setAvailability(data.google === true ? 'available' : 'unavailable');
      } catch {
        // API injoignable : on masque le bouton plutôt que d'offrir un chemin qui
        // échouera. Le formulaire mot de passe, lui, affichera une vraie erreur.
        if (!canceled) setAvailability('unavailable');
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  if (availability !== 'available') return null;

  async function handleClick(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      // `signIn.social` répond une URL de redirection vers Google ; le client
      // better-auth suit la redirection lui-même. `callbackURL` doit être une
      // origine de confiance côté API (`trustedOrigins` = WEB_URL).
      const res = await authClient.signIn.social({
        provider: 'google',
        callbackURL: `${window.location.origin}/projects`,
        errorCallbackURL: `${window.location.origin}/login?erreur=google`,
      });
      if (res.error) {
        setError(res.error.message ?? 'Connexion Google impossible.');
        setPending(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion Google impossible.');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
      >
        <GoogleMark />
        {pending ? 'Redirection…' : label}
      </button>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-xs text-[var(--foreground-muted)]">ou</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
    </div>
  );
}

/**
 * Logo Google en SVG INLINE.
 *
 * Inline et non `<img src="https://…">` : une image distante ferait dépendre le
 * rendu de la page de connexion d'un serveur tiers, et signalerait chaque
 * affichage du formulaire à Google avant même que l'utilisateur ait choisi de
 * s'y connecter.
 */
function GoogleMark(): React.ReactElement {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
