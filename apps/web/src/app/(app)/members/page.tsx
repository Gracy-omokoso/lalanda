'use client';

// Page /members — gouvernance de l'organisation active (S5d, refondue en S20a).
//
// L'organisation active vient du cookie `active_org_id`, résolue côté API.
//
// Deux appels seulement, tous deux gardés par le serveur :
//   GET /organizations/:id/members     → `organization.manage` (owner, admin)
//   GET /organizations/:id/invitations → `members.invite`      (owner, admin)
//
// Un 403 sur le premier n'est PAS une erreur à afficher en rouge : c'est la
// réponse normale pour un Analyste ou un Lecteur qui arrive ici par le menu. La
// page dit alors ce que son rôle permet, au lieu de crier une panne.

import { useCallback, useEffect, useState } from 'react';

import {
  api,
  readActiveOrgCookie,
  type InvitationView,
  type MemberView,
  type OrganizationView,
  type RoleOption,
} from '@/lib/api';

import { InvitePanel } from './_components/invite-panel.js';
import { MembersPanel } from './_components/members-panel.js';
import { libelleRoleActeur, messageErreur } from './_components/members-model.js';

/** Un refus d'autorisation, à distinguer d'une panne. */
function estRefus(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    ((err as { status: number }).status === 403 || (err as { status: number }).status === 404)
  );
}

export default function MembersPage(): React.ReactElement {
  const [org, setOrg] = useState<OrganizationView | null>(null);
  const [moiUserId, setMoiUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [peutInviter, setPeutInviter] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const recharger = useCallback(async (orgId: string): Promise<void> => {
    setErreur(null);
    try {
      const { members, roleOptions } = await api.listMembers(orgId);
      setMembers(members);
      setRoleOptions(roleOptions);
      setRefuse(false);
    } catch (err) {
      if (estRefus(err)) {
        setRefuse(true);
        setMembers([]);
        return;
      }
      setErreur(messageErreur(err, 'Impossible de charger les membres.'));
      return;
    }

    // Les invitations sont secondaires : leur refus ne doit pas vider la liste
    // des membres déjà obtenue.
    //
    // C'est aussi ce qui détermine `peutInviter` : la route est gardée par
    // `members.invite`, donc sa réponse EST la réponse à « ai-je le droit
    // d'inviter ? ». Le déduire d'un `role === 'owner' || role === 'admin'`
    // recopierait la matrice dans l'interface (ADR-0012 §8) et se tromperait au
    // premier rôle qui gagne ou perd l'action.
    try {
      const { invitations } = await api.listOrgInvitations(orgId);
      setInvitations(invitations);
      setPeutInviter(true);
    } catch (err) {
      if (!estRefus(err)) {
        setErreur(messageErreur(err, 'Impossible de charger les invitations.'));
      }
      setInvitations([]);
      setPeutInviter(false);
    }
  }, []);

  useEffect(() => {
    let annule = false;
    async function demarrer(): Promise<void> {
      try {
        const [{ organizations }, profil] = await Promise.all([
          api.listOrganizations(),
          // Sert uniquement à repérer « Vous » dans la liste et à exclure
          // l'acteur des cibles de transfert.
          api.getAccountProfile().catch(() => null),
        ]);
        if (annule) return;
        const activeId = readActiveOrgCookie();
        const active = organizations.find((o) => o.id === activeId) ?? organizations[0] ?? null;
        setOrg(active);
        setMoiUserId(profil?.id ?? null);
        if (active) await recharger(active.id);
      } catch (err) {
        if (!annule) setErreur(messageErreur(err, 'Erreur de chargement.'));
      } finally {
        if (!annule) setChargement(false);
      }
    }
    void demarrer();
    return () => {
      annule = true;
    };
  }, [recharger]);

  const rafraichir = useCallback(async (): Promise<void> => {
    if (org) await recharger(org.id);
  }, [org, recharger]);

  // Le rôle affiché est celui de la liste rechargée après chaque écriture, pas
  // celui de `GET /organizations` figé au montage : un transfert de propriété
  // rétrograde l'acteur, et l'en-tête ne doit pas continuer à le sacrer
  // Propriétaire. L'instantané ne sert que de repli (cf. `libelleRoleActeur`).
  const monRoleLabel = libelleRoleActeur(members ?? [], moiUserId, org?.roleLabel ?? null);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Membres</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Rôles et accès de {org?.name ?? 'l’organisation active'}
          {monRoleLabel ? ` · votre rôle : ${monRoleLabel}` : ''}.
        </p>
      </div>

      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {erreur}
        </div>
      ) : null}

      {chargement ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : !org ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucune organisation active. Créez-en une pour inviter des membres.
          </p>
        </div>
      ) : refuse ? (
        // Le refus est une INFORMATION, pas une panne : la matrice réserve la
        // gestion des membres au Propriétaire et à l'Administrateur (docs/12).
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-sm font-medium">Cette page est réservée à la gouvernance</p>
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">
            Votre rôle ({monRoleLabel ?? org.roleLabel}) ne donne pas accès à la gestion des
            membres. Un Propriétaire ou un Administrateur de {org.name} peut vous renseigner.
          </p>
        </div>
      ) : (
        <>
          <MembersPanel
            orgId={org.id}
            members={members ?? []}
            roleOptions={roleOptions}
            moiUserId={moiUserId}
            onChanged={rafraichir}
          />
          {/* `key` sur les options : le rôle par défaut du formulaire est calculé
              à l'initialisation, il doit être recalculé si la portée de l'acteur
              change (typiquement après un transfert de propriété). */}
          <InvitePanel
            key={roleOptions.map((o) => `${o.value}:${o.grantable}`).join(',')}
            orgId={org.id}
            invitations={invitations}
            roleOptions={roleOptions}
            peutInviter={peutInviter}
            onChanged={rafraichir}
          />
        </>
      )}
    </section>
  );
}
