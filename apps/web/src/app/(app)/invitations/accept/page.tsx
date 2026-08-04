'use client';

// Page d'acceptation d'invitation par URL — /invitations/accept?token=xxx
// Le user connecté (middleware Next.js impose l'auth pour tout /(app)/*) tape sur
// POST /invitations/accept ; le service vérifie que son email match l'invitation.
// Next 15 : useSearchParams() doit vivre sous <Suspense> pour le pré-rendu statique.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { api, setActiveOrgCookie } from '@/lib/api';

type Status = 'pending' | 'ok' | 'error';

function AcceptFlow(): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string>('Acceptation en cours…');
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (!token) {
      setStatus('error');
      setMessage("Token manquant dans l'URL.");
      return;
    }
    void (async () => {
      try {
        const { organizationId } = await api.acceptInvitation(token);
        setActiveOrgCookie(organizationId);
        setStatus('ok');
        setMessage("Invitation acceptée. Redirection vers l'organisation…");
        setTimeout(() => {
          router.push('/projects');
          router.refresh();
        }, 800);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : "Impossible d'accepter l'invitation.");
      }
    })();
  }, [token, router]);

  return (
    <>
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
      {status === 'error' ? (
        <Link
          href="/projects"
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm transition hover:bg-[var(--surface-muted)]"
        >
          Retour au dashboard
        </Link>
      ) : null}
    </>
  );
}

export default function AcceptInvitationPage(): React.ReactElement {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">Invitation</h2>
      <Suspense fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>}>
        <AcceptFlow />
      </Suspense>
    </section>
  );
}
