'use client';

// Page d'acceptation d'invitation par URL — /invitations/accept?token=xxx
// Le user connecté (middleware Next.js impose l'auth pour tout /(app)/*) tape sur
// POST /invitations/accept ; le service vérifie que son email match l'invitation.
// Next 15 : useSearchParams() doit vivre sous <Suspense> pour le pré-rendu statique.
//
// ADR-0052 — O5 : l'acceptation BASCULE vers l'organisation invitante (cookie, reprises
// effacées, rechargement complet vers l'accueil) et le dit : « Vous êtes maintenant dans
// l'espace de X ». L'autre organisation de la personne reste intacte, dans le sélecteur.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { basculerOrganisation, messageBascule } from '@/lib/bascule-organisation';
import { messageRefusInvitation } from '@/lib/invitation-en-attente';

type Status = 'pending' | 'ok' | 'error';

function AcceptFlow(): React.ReactElement {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string>('Acceptation de l’invitation…');
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (!token) {
      setStatus('error');
      setMessage('Ce lien d’invitation est incomplet. Ouvrez-le à nouveau depuis le courriel.');
      return;
    }
    void (async () => {
      try {
        const { organizationId, organizationName } = await api.acceptInvitation(token);
        setStatus('ok');
        setMessage(messageBascule(organizationName));
        // Le temps de lire le message, puis la bascule recharge toute l'application.
        setTimeout(() => {
          basculerOrganisation({ id: organizationId, name: organizationName }, '/accueil');
        }, 1200);
      } catch (err) {
        setStatus('error');
        setMessage(messageRefusInvitation(err));
      }
    })();
  }, [token]);

  return (
    <>
      <p
        role={status === 'error' ? 'alert' : 'status'}
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
      {status === 'ok' ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Vos autres organisations restent disponibles dans le sélecteur.
        </p>
      ) : null}
      {status === 'error' ? (
        <Link
          href="/accueil"
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm transition hover:bg-[var(--surface-muted)]"
        >
          Retour à l’accueil
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
