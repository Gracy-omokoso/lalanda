'use client';

// Bannière affichée sur toutes les pages (app) quand le user connecté a des invitations
// pending destinées à son email.
//
// ADR-0052 — O5 :
// - chaque invitation dit QUI invite ; « Rejoindre » accepte puis BASCULE vers
//   l'organisation invitante (cookie, reprises effacées, rechargement complet) ;
// - après une bascule (sélecteur, création, invitation), le message d'une ligne
//   « Vous êtes maintenant dans l'espace de X » s'affiche ici, une seule fois ;
// - une invitation suivie à travers la connexion ou l'inscription (cookie posé par le
//   middleware) renvoie vers la page d'acceptation : on arrive dans l'organisation
//   invitante, pas dans l'organisation personnelle vide (décision ouverte n° 5, défaut).

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, type InvitationView } from '@/lib/api';
import { basculerOrganisation, prendreMessageBascule } from '@/lib/bascule-organisation';
import {
  cheminAcceptation,
  effacementCookieInvitation,
  lireJetonInvitation,
  messageRefusInvitation,
} from '@/lib/invitation-en-attente';

type PendingInvitation = InvitationView & { token: string; organizationName: string };

function sessionNavigateur(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function PendingInvitationsBanner(): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bascule, setBascule] = useState<string | null>(null);

  useEffect(() => {
    setBascule(prendreMessageBascule(sessionNavigateur()));
    // Invitation suivie depuis le lien du courriel : elle passe avant tout le reste.
    const jeton = lireJetonInvitation(document.cookie);
    if (jeton) {
      document.cookie = effacementCookieInvitation();
      if (pathname !== '/invitations/accept') {
        router.replace(cheminAcceptation(jeton));
        return;
      }
    }
    void refresh();
    // Lecture unique au montage : la bascule recharge la page entière.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(): Promise<void> {
    try {
      const { invitations } = await api.listMyPendingInvitations();
      setInvitations(invitations);
    } catch {
      // Silencieux : bannière disparaît, le user continue à naviguer.
    }
  }

  async function accept(inv: PendingInvitation): Promise<void> {
    setBusyId(inv.id);
    setError(null);
    try {
      const { organizationId, organizationName } = await api.acceptInvitation(inv.token);
      // Rechargement complet vers l'accueil de l'organisation invitante ; le message
      // « Vous êtes maintenant dans l'espace de X » s'affiche à l'arrivée.
      basculerOrganisation(
        { id: organizationId, name: organizationName || inv.organizationName },
        '/accueil',
      );
    } catch (err) {
      setError(messageRefusInvitation(err));
      setBusyId(null);
    }
  }

  if (invitations.length === 0 && !bascule) return null;

  return (
    <div className="flex flex-col gap-3">
      {bascule ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-4 py-3 text-sm"
        >
          <span className="font-medium">{bascule}</span>
          <button
            type="button"
            onClick={() => setBascule(null)}
            aria-label="Fermer le message"
            className="rounded-md px-2 py-1 text-xs text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)]"
          >
            Fermer
          </button>
        </div>
      ) : null}
      {invitations.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4 text-sm">
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">
              Vous avez {invitations.length} invitation{invitations.length > 1 ? 's' : ''} en
              attente
            </p>
            <p className="text-xs text-[var(--foreground-muted)]">
              Rejoindre vous fait passer dans l’espace de cette organisation. Vos autres
              organisations ne changent pas et restent dans le sélecteur.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    {inv.organizationName || 'Une organisation'}
                  </span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    Rôle : {inv.roleLabel} · expire le{' '}
                    {new Date(inv.expiresAt).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => accept(inv)}
                  className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
                >
                  {busyId === inv.id
                    ? 'Bascule…'
                    : `Rejoindre ${inv.organizationName || 'l’organisation'}`}
                </button>
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
