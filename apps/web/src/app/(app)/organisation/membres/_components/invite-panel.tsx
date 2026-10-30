'use client';

// Invitations en attente (S5d, choix du rôle S20a).
//
// Le rôle est choisi À L'INVITATION, pas après l'acceptation : sans ce choix,
// tout invité entrerait avec le rôle par défaut du serveur et il faudrait
// penser à le corriger ensuite — ce que personne ne fait.
//
// ADR-0040 — C0 : le Commercial (`sales_rep`) est proposé dès que le serveur le
// dit attribuable (`roleOptions`, R7 : Propriétaire et Administrateur). Le rôle
// par défaut reste le moins puissant, choisi par rang (`roleParDefaut`) : le
// Commercial est le dernier de la liste sans être le moindre privilège.
//
// ADR-0041 — A5 : après le titre, « Personnaliser les autorisations » ouvre la
// même grille que la fiche du membre, préremplie par la ligne du titre. Fermée,
// elle dit en une phrase ce que le titre donne. L'invitation porte l'écart ;
// interrupteur éteint, la grille est en lecture seule et l'invitation part avec
// le titre seul.

import { useState } from 'react';

import { api, type InvitationView, type OrgAction, type OrgRole, type RoleOption } from '@/lib/api';
import {
  apiAutorisations,
  type CatalogueAutorisations,
  type InvitationAutorisations,
  type MesPermissions,
} from '@/lib/api-permissions';

import { GrilleAutorisations } from './member-permissions-panel';
import { badgePersonnalise, roleParDefaut, rolesProposables } from './members-model';
import {
  MESSAGE_PERSONNALISATION_A_VENIR,
  basculer,
  construireGrille,
  ecartAffiche,
  ligneDuTitre,
  messageAutorisations,
  personnalisationDesactivee as estDesactivee,
  phraseEcart,
  type ParametresGrille,
} from './permissions-model';
import { RoleSelect } from './role-select';

interface InvitePanelProps {
  orgId: string;
  invitations: readonly (InvitationView | InvitationAutorisations)[];
  roleOptions: readonly RoleOption[];
  /** L'acteur détient-il `members.invite` ? Le serveur reste seul juge. */
  peutInviter: boolean;
  onChanged: () => Promise<void>;
  /** ADR-0041 — `null` si le catalogue n'a pas pu être lu : pas de personnalisation. */
  catalogue: CatalogueAutorisations | null;
  moi: MesPermissions | null;
  personnalisationDesactivee: boolean;
  onDesactivee: () => void;
}

export function InvitePanel({
  orgId,
  invitations,
  roleOptions,
  peutInviter,
  onChanged,
  catalogue,
  moi,
  personnalisationDesactivee,
  onDesactivee,
}: InvitePanelProps): React.ReactElement {
  const defaut = roleParDefaut(roleOptions);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>(defaut ?? 'viewer');
  const [personnaliser, setPersonnaliser] = useState(false);
  const [selection, setSelection] = useState<Set<OrgAction> | null>(null);
  const [messageGrille, setMessageGrille] = useState<string | null>(null);

  const ligne = catalogue ? ligneDuTitre(catalogue, role) : null;
  const choisie = selection ?? new Set<OrgAction>(ligne?.base ?? []);
  const params: ParametresGrille | null =
    catalogue && ligne
      ? {
          catalogue,
          base: ligne.base,
          conditionnelles: ligne.conditionnelles,
          selection: choisie,
          contexte: 'invitation',
          ajoutables: moi?.grantableActions ?? [],
          verrou: personnalisationDesactivee ? MESSAGE_PERSONNALISATION_A_VENIR : null,
        }
      : null;
  const ecart =
    catalogue && ligne && !personnalisationDesactivee
      ? ecartAffiche(catalogue, ligne.base, choisie)
      : { grants: [], revokes: [] };
  const libelleTitre = roleOptions.find((o) => o.value === role)?.label ?? role;

  function changerTitre(nouveau: OrgRole): void {
    setRole(nouveau);
    // La grille repart de la ligne du NOUVEAU titre : un écart choisi sur un
    // autre titre n'a plus de sens (même règle que la fiche, décision n° 1).
    if (selection !== null) {
      setMessageGrille('Titre changé : la grille repart des autorisations du nouveau titre.');
    }
    setSelection(null);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lienCree, setLienCree] = useState<string | null>(null);

  const proposables = rolesProposables(roleOptions);
  const lienBase =
    typeof window !== 'undefined' ? `${window.location.origin}/invitations/accept` : '';

  async function inviter(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const adresse = email.trim();
    if (adresse === '') return;
    setBusy('creation');
    setErreur(null);
    setLienCree(null);
    try {
      const { token } = await apiAutorisations.inviter(orgId, { email: adresse, role, ...ecart });
      setLienCree(`${lienBase}?token=${token}`);
      setEmail('');
      // Le rôle N'EST PAS réinitialisé : inviter une équipe se fait en rafale,
      // et repartir de `viewer` à chaque envoi ferait rater le rôle voulu une
      // fois sur deux. L'adresse, elle, doit changer à chaque fois.
      await onChanged();
    } catch (err) {
      if (estDesactivee({ erreur: err })) onDesactivee();
      setErreur(messageAutorisations(err, catalogue, 'Impossible de créer l’invitation.'));
    } finally {
      setBusy(null);
    }
  }

  async function revoquer(inv: InvitationView): Promise<void> {
    if (!confirm(`Révoquer l’invitation de ${inv.email} ?`)) return;
    setBusy(inv.id);
    setErreur(null);
    try {
      await api.revokeInvitation(orgId, inv.id);
      await onChanged();
    } catch (err) {
      setErreur(messageAutorisations(err, catalogue, 'Impossible de révoquer l’invitation.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="invitations-titre">
      <div className="flex flex-col gap-1">
        <h3 id="invitations-titre" className="font-display text-lg font-semibold tracking-tight">
          Invitations en attente
        </h3>
        <p className="text-sm text-[var(--foreground-muted)]">
          Le rôle est fixé dès l’invitation et s’applique à l’acceptation. Les invitations expirent
          après 7 jours.
        </p>
      </div>

      {peutInviter ? (
        proposables.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--foreground-muted)]">
            Aucun rôle n’est à votre portée : vous ne pouvez attribuer que des rôles dont vous
            détenez déjà tous les droits.
          </p>
        ) : (
          <form
            onSubmit={(e) => void inviter(e)}
            className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="invite-email" className="text-sm font-medium">
                  Inviter une adresse email
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="collegue@exemple.cd"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
                />
              </div>
              <div className="sm:w-64">
                <RoleSelect
                  id="invite-role"
                  label="Rôle"
                  options={roleOptions}
                  value={role}
                  onChange={changerTitre}
                  disabled={busy !== null}
                />
              </div>
              <button
                type="submit"
                disabled={busy !== null || email.trim() === ''}
                className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50 sm:mt-[1.65rem]"
              >
                {busy === 'creation' ? 'Envoi…' : 'Inviter'}
              </button>
            </div>

            {catalogue && ligne && params ? (
              <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
                <p className="text-sm">{phraseEcart(catalogue, libelleTitre, ligne.base, ecart)}</p>
                <button
                  type="button"
                  aria-expanded={personnaliser}
                  aria-controls="invite-autorisations"
                  onClick={() => setPersonnaliser((v) => !v)}
                  className="self-start rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium transition hover:border-[var(--accent)]"
                >
                  {personnaliser ? 'Masquer les autorisations' : 'Personnaliser les autorisations'}
                </button>
                {personnaliser ? (
                  <div id="invite-autorisations" className="flex flex-col gap-2">
                    {personnalisationDesactivee ? (
                      <p className="rounded-md border border-dashed border-[var(--border)] p-2 text-xs text-[var(--foreground-muted)]">
                        {MESSAGE_PERSONNALISATION_A_VENIR}
                      </p>
                    ) : null}
                    <GrilleAutorisations
                      idPrefixe="invite-autorisations"
                      grille={construireGrille(params)}
                      lectureSeule={personnalisationDesactivee}
                      onBasculer={(action) => {
                        const r = basculer(params, action);
                        setSelection(r.selection);
                        setMessageGrille(r.message);
                      }}
                    />
                    {selection !== null && !personnalisationDesactivee ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelection(null);
                          setMessageGrille('Autorisations du titre rétablies.');
                        }}
                        className="self-start rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-xs transition hover:border-[var(--accent)]"
                      >
                        Revenir aux autorisations du titre
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
                  {messageGrille ?? ''}
                </p>
              </div>
            ) : null}
          </form>
        )
      ) : (
        <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--foreground-muted)]">
          Votre rôle ne permet pas d’inviter de nouveaux membres.
        </p>
      )}

      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Refusé :</strong> {erreur}
        </div>
      ) : null}

      {lienCree ? (
        <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 text-xs">
          <p className="mb-1 font-medium">Invitation créée. Partagez ce lien avec l’invité :</p>
          <code className="block break-all rounded bg-[var(--surface)] p-2 font-mono text-[11px]">
            {lienCree}
          </code>
          <p className="mt-2 text-[var(--foreground-muted)]">
            L’envoi automatique par email arrive avec S12. L’invité peut aussi accepter depuis la
            bannière de son tableau de bord.
          </p>
        </div>
      ) : null}

      {invitations.length === 0 ? (
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
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{inv.email}</span>
                  {/* Le rôle est un LIBELLÉ, jamais un slug : `finance_director`
                      ne veut rien dire pour la personne qui invite. */}
                  <span className="rounded-full border border-[var(--border-strong)] px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                    {inv.roleLabel}
                  </span>
                  {'grants' in inv && badgePersonnalise(inv) ? (
                    <span className="rounded-full border border-[var(--accent)] px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.06em] text-[var(--accent)]">
                      {badgePersonnalise(inv)}
                    </span>
                  ) : null}
                </span>
                <span className="fig text-xs text-[var(--foreground-muted)]">
                  Expire le {new Date(inv.expiresAt).toLocaleDateString('fr-FR')}
                </span>
              </div>
              {peutInviter ? (
                <button
                  type="button"
                  onClick={() => void revoquer(inv)}
                  disabled={busy !== null}
                  className="shrink-0 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground-muted)] transition hover:border-[var(--danger)]/40 hover:text-[var(--danger)] disabled:opacity-50"
                >
                  {busy === inv.id ? 'Révocation…' : 'Révoquer'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
