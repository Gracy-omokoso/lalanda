'use client';

// Sélecteur d'organisation : liste des orgs du user, marque l'active, permet d'en créer une nouvelle.
// L'org active est stockée dans le cookie `active_org_id`, lu par l'AuthGuard côté API.
//
// ADR-0052 — O1 : un changement d'organisation pose le cookie puis RECHARGE la page vers
// l'accueil (`basculerOrganisation`) : aucun état en mémoire de l'ancienne organisation ne
// survit. L'organisation affichée est celle que l'API sert (`activeOrganizationId`, F2) ;
// chaque ligne dit le rôle et l'avancement de la mise en route.
//
// ADR-0030 § 2 : il vit en tête de la barre latérale (panneau pétrole) et dans
// le tiroir mobile, et affiche sous le nom l'OFFRE EFFECTIVE de l'organisation
// active — lue par la coquille, jamais déduite ici. Une organisation créée ici
// ouvre directement sa mise en route.

import { Modal } from '@lalanda/ui';
import { useEffect, useRef, useState } from 'react';

import { IconeNav } from '@/components/icones-navigation';
import {
  api,
  readActiveOrgCookie,
  setActiveOrgCookie,
  type OrganizationSetupProgressView,
  type OrganizationView,
} from '@/lib/api';
import { basculerOrganisation } from '@/lib/bascule-organisation';

import { PLAN_LABELS, STATUS_LABELS } from '../souscription/_components/subscription-model';
import {
  DESTINATION_APRES_CREATION,
  FORMULAIRE_CREATION_VIDE,
  PAYS_CREATION,
  PHRASE_NOUVELLE_ORGANISATION,
  TYPES_ORGANISATION,
  avertissementPays,
  cookieARectifier,
  detailOrganisation,
  organisationAffichee,
  validerCreation,
  type FormulaireCreation,
} from './org-switcher-model';
import { useShell } from './shell-context';

export function OrgSwitcher({ replie = false }: { replie?: boolean }): React.ReactElement {
  const { subscription } = useShell();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [orgs, setOrgs] = useState<OrganizationView[] | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [avancement, setAvancement] = useState<Map<string, OrganizationSetupProgressView>>(
    () => new Map(),
  );
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refresh();
  }, []);

  // L'avancement de chaque organisation est lu à l'ouverture du menu (une lecture par
  // ouverture : il change quand on avance dans la mise en route).
  useEffect(() => {
    if (!open) return;
    let actif = true;
    api
      .listOrganizationsSetupProgress()
      .then(({ organizations }) => {
        if (actif) setAvancement(new Map(organizations.map((p) => [p.organizationId, p])));
      })
      .catch(() => {
        /* silencieux : le menu reste utilisable sans l'avancement */
      });
    return () => {
      actif = false;
    };
  }, [open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && rootRef.current?.contains(document.activeElement)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  async function refresh(): Promise<void> {
    try {
      const { organizations, activeOrganizationId } = await api.listOrganizations();
      setOrgs(organizations);
      // F2 : l'organisation affichée est celle que l'API sert. Le cookie est reposé quand il
      // manque ou en désigne une autre — ce qui le migre aussi vers le domaine partagé avec
      // l'API (`setActiveOrgCookie`) : l'étiquette et les données disent toujours la même chose.
      const servie = organisationAffichee(organizations, activeOrganizationId);
      if (servie && cookieARectifier(readActiveOrgCookie(), servie.id)) {
        setActiveOrgCookie(servie.id);
      }
      setActiveId(servie?.id);
    } catch {
      /* silencieux — l'app fonctionne quand même via la primary org côté API */
    }
  }

  function switchTo(org: OrganizationView): void {
    setOpen(false);
    if (org.id === activeId) return;
    // Cookie posé, reprises de session effacées, page RECHARGÉE sur l'accueil.
    basculerOrganisation(org, '/accueil');
  }

  const active = orgs ? organisationAffichee(orgs, activeId) : undefined;
  // Offre effective (essai, suspension compris) : c'est ce à quoi l'organisation
  // a droit aujourd'hui, pas ce qu'elle a souscrit (docs/13).
  const offre = subscription
    ? subscription.status === 'trialing'
      ? `${PLAN_LABELS[subscription.plan]} · ${STATUS_LABELS.trialing.toLowerCase()}`
      : `Offre ${PLAN_LABELS[subscription.plan]}`
    : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={replie ? (active?.name ?? 'Organisation') : undefined}
        aria-label={`Organisation active : ${active?.name ?? 'chargement'}${offre ? ` — ${offre}` : ''}. Changer d’organisation`}
        className={
          replie
            ? 'flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--nav-border)] font-display text-sm font-bold text-[var(--nav-fg)] transition hover:bg-[var(--nav-active-bg)]'
            : 'flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--nav-border)] px-3 py-2 text-left text-[var(--nav-fg)] transition hover:bg-[var(--nav-active-bg)]'
        }
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {replie ? (
          <span aria-hidden="true">{(active?.name ?? '·').slice(0, 1).toUpperCase()}</span>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">
                {active?.name ?? 'Organisation…'}
              </span>
              <span className="truncate text-xs text-[var(--nav-muted)]">{offre ?? '\u00a0'}</span>
            </span>
            <IconeNav id="selecteur" className="h-4 w-4 shrink-0 text-[var(--nav-muted)]" />
          </>
        )}
      </button>

      {open && orgs ? (
        <div
          role="menu"
          className="absolute left-0 z-40 mt-2 w-64 text-[var(--foreground)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {orgs.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => switchTo(o)}
                  className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] ${
                    o.id === (active?.id ?? '') ? 'bg-[var(--surface-muted)]' : ''
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{o.name}</span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {detailOrganisation(o, avancement.get(o.id))}
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
          onCreated={(org) => {
            // ADR-0052 § 5 : la nouvelle organisation devient active et commence par sa
            // mise en route, étape « Société » ; rechargement complet comme toute bascule.
            basculerOrganisation(org, DESTINATION_APRES_CREATION);
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
  const [form, setForm] = useState<FormulaireCreation>(FORMULAIRE_CREATION_VIDE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avertissement = avertissementPays(form.pays);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const v = validerCreation(form);
    if (!v.ok) {
      setError(v.erreur);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const org = await api.createOrganization(v.corps);
      onCreated(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer l’organisation.');
      setCreating(false);
    }
  }

  const champ =
    'rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]';

  return (
    <Modal
      open
      onClose={onClose}
      title="Nouvelle organisation"
      description={PHRASE_NOUVELLE_ORGANISATION}
      size="sm"
      busy={creating}
    >
      <form
        onSubmit={handleSubmit}
        aria-label="Nouvelle organisation"
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Nom</span>
          <input
            type="text"
            required
            maxLength={100}
            autoFocus
            placeholder="Ex : Ma PME SARL"
            value={form.nom}
            onChange={(e) => setForm({ ...form, nom: e.target.value })}
            className={champ}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Pays</span>
          <select
            value={form.pays}
            onChange={(e) => setForm({ ...form, pays: e.target.value })}
            aria-describedby={avertissement ? 'org-creation-pays-aide' : undefined}
            className={champ}
          >
            {PAYS_CREATION.map((p) => (
              <option key={p.code} value={p.code}>
                {p.libelle}
              </option>
            ))}
          </select>
          {avertissement ? (
            <span id="org-creation-pays-aide" className="text-xs text-[var(--warn)]">
              {avertissement}
            </span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Type d’organisation</span>
          <select
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as FormulaireCreation['type'] })
            }
            className={champ}
          >
            {TYPES_ORGANISATION.map((t) => (
              <option key={t.code} value={t.code}>
                {t.libelle}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[var(--foreground-muted)]">
          Vous en devenez Propriétaire. Sa mise en route vous attend ensuite ; rien n’est copié
          depuis votre organisation actuelle.
        </p>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
          >
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
            disabled={creating || !form.nom.trim()}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            {creating ? 'Création…' : 'Créer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
