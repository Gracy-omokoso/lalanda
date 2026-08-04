'use client';

// Dropdown : liste des orgs du user, marque l'active, permet d'en créer une nouvelle.
// L'org active est stockée dans le cookie `active_org_id`, lu par l'AuthGuard côté API.
// Un switch = set cookie + router.refresh() pour recharger les données côté serveur.

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api, readActiveOrgCookie, setActiveOrgCookie, type OrganizationView } from '@/lib/api';

export function OrgSwitcher(): React.ReactElement {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrganizationView[] | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refresh();
    setActiveId(readActiveOrgCookie());
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function refresh(): Promise<void> {
    try {
      const { organizations } = await api.listOrganizations();
      setOrgs(organizations);
      // Si aucun cookie et au moins 1 org, on prend la première comme active affichée.
      if (!readActiveOrgCookie() && organizations[0]) {
        setActiveId(organizations[0].id);
      }
    } catch {
      /* silencieux — l'app fonctionne quand même via la primary org côté API */
    }
  }

  function switchTo(orgId: string): void {
    setActiveOrgCookie(orgId);
    setActiveId(orgId);
    setOpen(false);
    router.push('/projects');
    router.refresh();
  }

  const active = orgs?.find((o) => o.id === activeId) ?? orgs?.[0];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm transition hover:bg-[var(--surface-muted)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="max-w-[160px] truncate font-medium">
          {active?.name ?? 'Organisation…'}
        </span>
        <span aria-hidden className="text-xs opacity-50">
          ▾
        </span>
      </button>

      {open && orgs ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {orgs.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => switchTo(o.id)}
                  className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] ${
                    o.id === (active?.id ?? '') ? 'bg-[var(--surface-muted)]' : ''
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{o.name}</span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {o.role} · {o.type}
                    </span>
                  </div>
                  {o.id === (active?.id ?? '') ? (
                    <span aria-hidden className="text-[var(--accent)]">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-[var(--border)] p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setModalOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--accent)] transition hover:bg-[var(--surface-muted)]"
            >
              <span aria-hidden>＋</span> Nouvelle organisation
            </button>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <CreateOrgModal
          onClose={() => setModalOpen(false)}
          onCreated={async (org) => {
            setModalOpen(false);
            setActiveOrgCookie(org.id);
            await refresh();
            setActiveId(org.id);
            router.push('/projects');
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateOrgModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (org: OrganizationView) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const org = await api.createOrganization({ name: name.trim() });
      onCreated(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer');
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6"
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">Nouvelle organisation</h3>
          <p className="text-sm text-[var(--foreground-muted)]">
            Tu deviens owner. Chaque projet appartient à une organisation.
          </p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Nom</span>
          <input
            type="text"
            required
            maxLength={100}
            autoFocus
            placeholder="Ex : Ma PME SARL"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        {error ? (
          <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-[var(--surface-muted)]"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            {creating ? 'Création…' : 'Créer'}
          </button>
        </div>
      </form>
    </div>
  );
}
