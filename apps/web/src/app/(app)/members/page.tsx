'use client';

// Page /members — gestion des invitations de l'organisation active (S5d).
// L'org active = celle du cookie `active_org_id`, résolue côté API par AuthGuard.
// Le formulaire de création n'est visible que si le user connecté est owner de cette org
// (détecté via /organizations qui renvoie le rôle).

import { useEffect, useState } from 'react';

import { api, readActiveOrgCookie, type InvitationView, type OrganizationView } from '@/lib/api';

export default function MembersPage(): React.ReactElement {
  const [activeOrg, setActiveOrg] = useState<OrganizationView | null>(null);
  const [invitations, setInvitations] = useState<InvitationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
    // Effet unique au montage — les recharges sont déclenchées explicitement après
    // création ou révocation. Le linter Next impose de citer la deps ; on la désactive
    // localement plutôt que capturer bootstrap avec useCallback (surcoût inutile pour un effect one-shot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap(): Promise<void> {
    try {
      const { organizations } = await api.listOrganizations();
      const activeId = readActiveOrgCookie();
      const active = organizations.find((o) => o.id === activeId) ?? organizations[0] ?? null;
      setActiveOrg(active);
      if (active) await refreshInvitations(active.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    }
  }

  async function refreshInvitations(orgId: string): Promise<void> {
    setError(null);
    try {
      const { invitations } = await api.listOrgInvitations(orgId);
      setInvitations(invitations);
    } catch (err) {
      // Un non-owner reçoit 403 → on affiche liste vide sans hurler.
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 403) {
        setInvitations([]);
      } else {
        setError(err instanceof Error ? err.message : 'Erreur de chargement');
      }
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!activeOrg || !email.trim()) return;
    setCreating(true);
    setError(null);
    setLastCreatedToken(null);
    try {
      const { token } = await api.createInvitation(activeOrg.id, { email: email.trim() });
      setLastCreatedToken(token);
      setEmail('');
      await refreshInvitations(activeOrg.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer l'invitation");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(inv: InvitationView): Promise<void> {
    if (!activeOrg) return;
    if (!confirm(`Révoquer l'invitation pour ${inv.email} ?`)) return;
    setError(null);
    try {
      await api.revokeInvitation(activeOrg.id, inv.id);
      await refreshInvitations(activeOrg.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de révoquer');
    }
  }

  const isOwner = activeOrg?.role === 'owner';
  const acceptBaseUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/invitations/accept` : '';

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Membres</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Invitations en attente pour {activeOrg?.name ?? "l'organisation active"}. Les invitations
          expirent après 7 jours.
        </p>
      </div>

      {isOwner ? (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium">Inviter un email</span>
            <input
              type="email"
              required
              placeholder="collegue@exemple.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !email.trim()}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            {creating ? 'Envoi…' : 'Inviter'}
          </button>
        </form>
      ) : activeOrg ? (
        <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--foreground-muted)]">
          Seul un owner peut inviter ou révoquer des membres.
        </p>
      ) : null}

      {lastCreatedToken ? (
        <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 text-xs">
          <p className="mb-1 font-medium">Invitation créée. Partage ce lien avec l&apos;invité :</p>
          <code className="block break-all rounded bg-[var(--surface)] p-2 font-mono text-[11px]">
            {`${acceptBaseUrl}?token=${lastCreatedToken}`}
          </code>
          <p className="mt-2 text-[var(--foreground-muted)]">
            (L&apos;envoi email automatique arrive avec S12. Pour l&apos;instant l&apos;invité peut
            aussi accepter directement depuis la bannière de son dashboard.)
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      {invitations === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : invitations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucune invitation en attente pour cette organisation.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {invitations.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{inv.email}</span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  rôle <code>{inv.role}</code> · expire le{' '}
                  {new Date(inv.expiresAt).toLocaleDateString('fr-FR')}
                </span>
              </div>
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => handleRevoke(inv)}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground-muted)] transition hover:border-[var(--danger)]/40 hover:text-[var(--danger)]"
                >
                  Révoquer
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
