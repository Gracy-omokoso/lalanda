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

import { Button, Field, FormGrid, Modal, Select, SubmitButton, TextInput } from '@lalanda/ui';
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

/**
 * `nav` : dans la barre de navigation (jetons `--nav-*`) ; `surface` : dans
 * l'en-tête clair, hors module sur grand écran (ADR-0056).
 */
export type VarianteSelecteur = 'nav' | 'surface';

const CLASSES_VARIANTE: Record<
  VarianteSelecteur,
  { bouton: string; replie: string; discret: string }
> = {
  nav: {
    bouton:
      'border-[var(--nav-border)] bg-[color-mix(in_srgb,var(--nav-fg)_6%,var(--nav-bg))] text-[var(--nav-fg)] hover:bg-[var(--nav-active-bg)]',
    replie: 'border-[var(--nav-border)] text-[var(--nav-fg)] hover:bg-[var(--nav-active-bg)]',
    discret: 'text-[var(--nav-muted)]',
  },
  surface: {
    bouton:
      'border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] hover:bg-[var(--accent-soft)]',
    replie: 'border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent-soft)]',
    discret: 'text-[var(--foreground-muted)]',
  },
};

export function OrgSwitcher({
  replie = false,
  variante = 'nav',
}: {
  replie?: boolean;
  variante?: VarianteSelecteur;
}): React.ReactElement {
  const classes = CLASSES_VARIANTE[variante];
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
            ? `flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border font-display text-sm font-bold transition-colors duration-[var(--motion-fast)] ${classes.replie}`
            : `flex w-full items-center gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 text-left transition-colors duration-[var(--motion-fast)] ${classes.bouton}`
        }
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {replie ? (
          <span aria-hidden="true">{(active?.name ?? '·').slice(0, 1).toUpperCase()}</span>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[13px] font-semibold">
                {active?.name ?? 'Organisation…'}
              </span>
              <span className={`truncate text-xs ${classes.discret}`}>{offre ?? '\u00a0'}</span>
            </span>
            <IconeNav id="selecteur" className={`h-3.5 w-3.5 shrink-0 ${classes.discret}`} />
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
        <FormGrid>
          <Field label="Nom" required size="full">
            <TextInput
              type="text"
              required
              maxLength={100}
              autoFocus
              placeholder="Ex : Ma PME SARL"
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
            />
          </Field>
          <Field
            label="Pays"
            size="full"
            hint={
              avertissement ? (
                <span className="text-[var(--warn)]">{avertissement}</span>
              ) : undefined
            }
          >
            <Select
              value={form.pays}
              onChange={(pays) => setForm({ ...form, pays })}
              options={PAYS_CREATION.map((p) => ({ value: p.code, label: p.libelle }))}
            />
          </Field>
          <Field label="Type d’organisation" size="full">
            <Select<FormulaireCreation['type']>
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              options={TYPES_ORGANISATION.map((t) => ({ value: t.code, label: t.libelle }))}
            />
          </Field>
        </FormGrid>
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
          <Button onClick={onClose} disabled={creating}>
            Annuler
          </Button>
          <SubmitButton busy={creating} busyLabel="Création…" disabled={!form.nom.trim()}>
            Créer
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
