'use client';

// Confirmation d'un changement d'adresse email (S20b, rendue utilisable en S22a).
//
//   /verification-email?token=…
//
// PAGE VOLONTAIREMENT PUBLIQUE. Le lien arrive dans la NOUVELLE boîte, souvent
// ouverte sur un autre appareil ou un autre navigateur que celui où la demande a
// été faite. Exiger une session reviendrait à exiger que la personne soit déjà
// connectée au bon endroit — précisément ce qu'on ne peut pas supposer. C'est le
// jeton qui porte la preuve (64 caractères hexadécimaux, usage unique, 24 h,
// lié à un seul utilisateur), et l'API `POST /account-email/verify` l'applique.
//
// Elle vit sous `(auth)` pour hériter de la mise en page sans en-tête
// applicatif, et n'est listée ni dans `PROTECTED_PREFIXES` ni dans `isAuthPath`
// (`lib/routes.ts`) : le middleware la laisse donc passer dans les deux sens —
// un visiteur anonyme y accède, et quelqu'un de déjà connecté n'en est pas
// éjecté vers `/projects` avant d'avoir confirmé.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

type Status = 'pending' | 'ok' | 'error';

function VerifyFlow(): React.ReactElement {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState('Confirmation en cours…');
  const attempted = useRef(false);

  useEffect(() => {
    // Le jeton est à usage unique : le double appel du mode strict de React en
    // développement consommerait le premier et ferait échouer le second, donnant
    // une page d'erreur sur une opération pourtant réussie.
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setStatus('error');
      setMessage('Ce lien est incomplet : le jeton de confirmation est absent de l’adresse.');
      return;
    }

    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/account-email/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json().catch(() => null)) as { email?: string } | null;
        if (!res.ok) {
          setStatus('error');
          setMessage('Ce lien de vérification est invalide, expiré ou déjà utilisé.');
          return;
        }
        setStatus('ok');
        setMessage(
          body?.email
            ? `Votre adresse est maintenant ${body.email}. Utilisez-la pour vos prochaines connexions.`
            : 'Votre nouvelle adresse est confirmée.',
        );
      } catch {
        setStatus('error');
        setMessage('Nous n’avons pas pu joindre le serveur. Réessayez dans un instant.');
      }
    })();
  }, [token]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Changement d’adresse email</h2>
        <p
          className={
            status === 'error'
              ? 'text-sm text-[var(--danger)]'
              : status === 'ok'
                ? 'text-sm text-[var(--accent)]'
                : 'text-sm text-[var(--foreground-muted)]'
          }
        >
          {message}
        </p>
      </div>

      {status !== 'pending' ? (
        <p className="text-center text-sm text-[var(--foreground-muted)]">
          <Link
            href={status === 'ok' ? '/login' : '/compte'}
            className="text-[var(--accent)] underline underline-offset-4 hover:opacity-80"
          >
            {status === 'ok' ? 'Aller à la connexion' : 'Retour à mon compte'}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export default function VerifyEmailChangePage(): React.ReactElement {
  // Next 15 : `useSearchParams()` doit vivre sous <Suspense> pour le pré-rendu.
  return (
    <Suspense fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>}>
      <VerifyFlow />
    </Suspense>
  );
}
