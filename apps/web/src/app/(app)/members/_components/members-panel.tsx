'use client';

// Liste des membres et gouvernance de l'organisation (S20a — ADR-0012 §6).
//
// Trois écritures : changement de rôle, droit conditionnel de clôture (case ⚙),
// révocation. Plus le transfert de propriété, qui est la seule sortie pour un
// propriétaire unique (R1).
//
// Accessibilité (docs/04) : rôle et statut sont TOUJOURS portés par du texte. Les
// pastilles ne sont qu'un renfort visuel — un daltonien lit « Dernier
// propriétaire », pas une nuance d'ambre.

import { useState } from 'react';

import { api, type MemberView, type RoleOption } from '@/lib/api';

import {
  acteurEstProprietaire,
  afficheDroitCloture,
  ciblesDeTransfert,
  messageErreur,
  nomAffiche,
  raisonNonModifiable,
  raisonNonRevocable,
  sousTitre,
} from './members-model.js';
import { RoleSelect } from './role-select.js';

interface MembersPanelProps {
  orgId: string;
  members: readonly MemberView[];
  roleOptions: readonly RoleOption[];
  moiUserId: string | null;
  onChanged: () => Promise<void>;
}

export function MembersPanel({
  orgId,
  members,
  roleOptions,
  moiUserId,
  onChanged,
}: MembersPanelProps): React.ReactElement {
  const [busy, setBusy] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Toute écriture passe par ici : une seule ligne occupée à la fois, un seul
   * endroit qui traduit les refus, et un rechargement systématique après succès.
   * `isLastOwner` et `manageable` de TOUTES les lignes peuvent changer à chaque
   * écriture — rafraîchir la seule ligne touchée laisserait la liste mentir.
   */
  async function ecrire(
    cle: string,
    succes: string,
    action: () => Promise<unknown>,
  ): Promise<void> {
    setBusy(cle);
    setErreur(null);
    setNotice(null);
    try {
      await action();
      await onChanged();
      setNotice(succes);
    } catch (err) {
      setErreur(messageErreur(err, 'L’opération a échoué.'));
    } finally {
      setBusy(null);
    }
  }

  const cibles = moiUserId ? ciblesDeTransfert(members, moiUserId) : [];
  // Le rôle de l'acteur est lu dans la LISTE, jamais dans l'organisation chargée
  // au montage : un transfert de propriété le fait passer de Propriétaire à
  // Administrateur, et le bloc de transfert doit disparaître dans la foulée.
  const jeSuisProprietaire = acteurEstProprietaire(members, moiUserId);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="membres-titre">
      <div className="flex flex-col gap-1">
        <h3 id="membres-titre" className="font-display text-lg font-semibold tracking-tight">
          Membres de l’organisation
        </h3>
        <p className="text-sm text-[var(--foreground-muted)]">
          Le rôle détermine ce que chacun peut faire. Une organisation garde toujours au moins un
          propriétaire.
        </p>
      </div>

      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Refusé :</strong> {erreur}
        </div>
      ) : null}

      <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {notice ?? ''}
      </span>

      <ul className="flex flex-col gap-2">
        {members.map((m) => {
          const motifRole = raisonNonModifiable(m);
          const motifRevoc = raisonNonRevocable(m);
          const cestMoi = m.userId === moiUserId;
          const occupe = busy === m.userId;

          return (
            <li
              key={m.userId}
              className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{nomAffiche(m)}</span>
                    {cestMoi ? <Pastille ton="accent">Vous</Pastille> : null}
                    {m.isLastOwner ? (
                      <Pastille ton="alerte">Dernier propriétaire</Pastille>
                    ) : (
                      <Pastille ton="neutre">{m.roleLabel}</Pastille>
                    )}
                  </span>
                  {sousTitre(m) ? (
                    <span className="fig text-xs text-[var(--foreground-muted)]">
                      {sousTitre(m)}
                    </span>
                  ) : null}
                  <span className="fig text-xs text-[var(--foreground-muted)]">
                    {m.acceptedAt
                      ? `Membre depuis le ${new Date(m.acceptedAt).toLocaleDateString('fr-FR')}`
                      : 'Invitation pas encore acceptée'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    // La confirmation précède l'écriture : un abandon ne doit pas
                    // ressortir en « Refusé », qui ferait croire à un blocage.
                    if (!confirm(`Retirer ${nomAffiche(m)} de l’organisation ?`)) return;
                    void ecrire(m.userId, `${nomAffiche(m)} a été retiré de l’organisation.`, () =>
                      api.revokeMember(orgId, m.userId),
                    );
                  }}
                  disabled={motifRevoc !== null || occupe}
                  title={motifRevoc ?? undefined}
                  className="shrink-0 self-start rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground-muted)] transition hover:border-[var(--danger)]/40 hover:text-[var(--danger)] disabled:opacity-50 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--foreground-muted)]"
                >
                  {occupe ? 'En cours…' : 'Retirer'}
                </button>
              </div>

              <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-start sm:gap-6">
                <div className="sm:max-w-xs sm:flex-1">
                  <RoleSelect
                    id={`role-${m.userId}`}
                    options={roleOptions}
                    value={m.role}
                    label={null}
                    ariaLabel={`Rôle de ${nomAffiche(m)}`}
                    disabled={motifRole !== null || occupe}
                    onChange={(role) =>
                      void ecrire(m.userId, `Rôle mis à jour pour ${nomAffiche(m)}.`, () =>
                        api.changeMemberRole(orgId, m.userId, role),
                      )
                    }
                  />
                  {/* Le motif du refus est affiché À CÔTÉ du contrôle désactivé,
                      jamais à sa place : une commande absente n'explique rien. */}
                  {motifRole ? (
                    <p className="mt-1 text-xs text-[var(--foreground-muted)]">{motifRole}</p>
                  ) : null}
                </div>

                {afficheDroitCloture(m) ? (
                  <label className="flex items-start gap-2 text-xs sm:max-w-xs">
                    <input
                      type="checkbox"
                      checked={m.canClosePeriods}
                      disabled={motifRole !== null || occupe}
                      onChange={(e) =>
                        void ecrire(
                          m.userId,
                          e.target.checked
                            ? 'Droit de clôture accordé.'
                            : 'Droit de clôture retiré.',
                          () => api.setMemberCloseRight(orgId, m.userId, e.target.checked),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Autoriser la clôture des périodes</span>
                      <span className="block text-[var(--foreground-muted)]">
                        Droit accordé au cas par cas, refusé par défaut. Seul le Comptable peut le
                        recevoir.
                      </span>
                    </span>
                  </label>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {jeSuisProprietaire ? (
        <TransferBlock
          cibles={cibles}
          occupe={busy === 'transfert'}
          onTransfer={(userId) => {
            const cible = cibles.find((c) => c.userId === userId);
            if (!cible) return;
            if (
              !confirm(
                `Transférer la propriété à ${nomAffiche(cible)} ?\n\n` +
                  'Vous deviendrez Administrateur : vous perdrez l’abonnement et la validation des plans.',
              )
            ) {
              return;
            }
            void ecrire(
              'transfert',
              `${nomAffiche(cible)} est désormais propriétaire. Vous êtes Administrateur.`,
              () => api.transferOwnership(orgId, userId),
            );
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Transfert de propriété — replié dans son propre bloc parce que c'est
 * l'opération la moins réversible de la page, et la seule qui rétrograde
 * l'acteur lui-même.
 */
function TransferBlock({
  cibles,
  occupe,
  onTransfer,
}: {
  cibles: readonly MemberView[];
  occupe: boolean;
  onTransfer: (userId: string) => void;
}): React.ReactElement {
  const [choix, setChoix] = useState('');

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-[var(--border)] p-4">
      <h4 className="text-sm font-medium">Transférer la propriété</h4>
      <p className="text-xs text-[var(--foreground-muted)]">
        Le nouveau propriétaire reçoit l’abonnement, la gestion des membres et la validation des
        plans. Vous devenez Administrateur. C’est la seule manière de quitter le rôle de
        propriétaire quand vous êtes le dernier.
      </p>
      {cibles.length === 0 ? (
        <p className="text-xs italic text-[var(--foreground-muted)]">
          Aucun autre membre ne peut recevoir la propriété pour l’instant.
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="transfert-cible" className="sr-only">
            Nouveau propriétaire
          </label>
          <select
            id="transfert-cible"
            value={choix}
            disabled={occupe}
            onChange={(e) => setChoix(e.target.value)}
            className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-50"
          >
            <option value="">Choisir un membre…</option>
            {cibles.map((c) => (
              <option key={c.userId} value={c.userId}>
                {nomAffiche(c)} — {c.roleLabel}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={choix === '' || occupe}
            onClick={() => onTransfer(choix)}
            className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50"
          >
            {occupe ? 'Transfert…' : 'Transférer'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Pastille de statut. Le TEXTE porte l'information; la couleur ne fait que la
 * renforcer (docs/04 § Accessibilité — jamais de statut par la couleur seule).
 */
function Pastille({
  ton,
  children,
}: {
  ton: 'neutre' | 'accent' | 'alerte';
  children: React.ReactNode;
}): React.ReactElement {
  const styles = {
    neutre: 'border-[var(--border-strong)] text-[var(--foreground-muted)]',
    accent: 'border-[var(--accent)] text-[var(--accent)]',
    alerte: 'border-[var(--danger)] text-[var(--danger)]',
  }[ton];

  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.06em] ${styles}`}
    >
      {children}
    </span>
  );
}
