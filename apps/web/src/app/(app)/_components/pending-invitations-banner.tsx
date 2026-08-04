'use client';

// Bannière affichée sur toutes les pages (app) quand le user connecté a des invitations
// pending destinées à son email. Cliquer Accepter crée la membership + bascule sur l'org
// acceptée, puis refresh (les data-fetching serveur repartent avec le nouveau cookie).

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, setActiveOrgCookie, type InvitationView } from '@/lib/api';

type PendingInvitation = InvitationView & { token: string };

export function PendingInvitationsBanner(): React.ReactElement | null {
  const router = useRouter();
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
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
      const { organizationId } = await api.acceptInvitation(inv.token);
      setActiveOrgCookie(organizationId);
      // Force le re-fetch côté serveur + refresh de OrgSwitcher (qui lit /organizations).
      router.refresh();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'accepter l'invitation");
    } finally {
      setBusyId(null);
    }
  }

  if (invitations.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4 text-sm">
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">
          Tu as {invitations.length} invitation{invitations.length > 1 ? 's' : ''} en attente
        </p>
        <p className="text-xs text-[var(--foreground-muted)]">
          Accepter t&apos;ajoute à l&apos;organisation et bascule ton contexte actif dessus.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {invitations.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Organisation invitée</span>
              <span className="text-xs text-[var(--foreground-muted)]">
                rôle <code>{inv.role}</code> · expire le{' '}
                {new Date(inv.expiresAt).toLocaleDateString('fr-FR')}
              </span>
            </div>
            <button
              type="button"
              disabled={busyId === inv.id}
              onClick={() => accept(inv)}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
            >
              {busyId === inv.id ? 'Acceptation…' : 'Accepter'}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
