'use client';

// Comptes de la plateforme (S21b) — recherche, rôles plateforme, désactivation.
//
// ── La recherche est obligatoire, et c'est le point ──────────────────────────
//
// L'API sert une liste bornée; l'interface ne propose pas de « tout parcourir ».
// Un annuaire de toutes les adresses de tous les clients, feuilletable, est une
// base de données personnelles offerte à quiconque obtient un rôle support. On
// cherche quelqu'un qu'on a une raison de chercher.
//
// ── Deux garde-fous que le serveur applique aussi ────────────────────────────
//
// Se retirer son propre `platform_super_admin` et se désactiver soi-même sont
// refusés par l'API (`SELF_DEMOTION_FORBIDDEN`, `SELF_DISABLE_FORBIDDEN`). Ici
// on désactive le contrôle ET on affiche la raison à côté : un bouton grisé sans
// explication se lit comme un bug.

import { useCallback, useEffect, useState } from 'react';

import { api, PLATFORM_ROLES, type AdminUserSummary, type PlatformRole } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

import { useAccesPlateforme } from './admin-access';
import { Bandeau, Pastille, Vide } from './admin-chrome';
import {
  AVERTISSEMENT_DESACTIVATION,
  formaterDate,
  libelleRole,
  messageErreur,
  raisonNonDesactivable,
  raisonNonRevocable,
} from './admin-model';

export function UsersPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const { data: session } = useSession();
  const moiUserId = session?.user?.id ?? null;

  const [recherche, setRecherche] = useState('');
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (q: string): Promise<void> => {
    setChargement(true);
    try {
      const { users: liste } = await api.listAdminUsers(q.trim() || undefined);
      setUsers(liste);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger les comptes.'));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger('');
  }, [charger]);

  const remplacer = useCallback((maj: AdminUserSummary): void => {
    setUsers((liste) => (liste ? liste.map((u) => (u.id === maj.id ? maj : u)) : liste));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void charger(recherche);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
            Rechercher un compte
          </span>
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Adresse e-mail ou nom"
            className="w-72 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)]"
        >
          Chercher
        </button>
      </form>

      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}

      {chargement ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : !users || users.length === 0 ? (
        <Vide>
          {recherche.trim()
            ? 'Aucun compte ne correspond à cette recherche.'
            : 'Aucun compte à afficher.'}
        </Vide>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((user) => (
            <LigneCompte
              key={user.id}
              user={user}
              moiUserId={moiUserId}
              peutEcrire={acces.canManagePlatform}
              onMaj={remplacer}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LigneCompte({
  user,
  moiUserId,
  peutEcrire,
  onMaj,
}: {
  user: AdminUserSummary;
  moiUserId: string | null;
  peutEcrire: boolean;
  onMaj: (maj: AdminUserSummary) => void;
}): React.ReactElement {
  const [role, setRole] = useState<PlatformRole>('platform_support');
  const [etat, setEtat] = useState<{ ton: 'succes' | 'echec'; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const desactive = user.disabledAt !== null;
  const blocageDesactivation = raisonNonDesactivable(user, moiUserId);

  async function executer(action: () => Promise<AdminUserSummary>, succes: string): Promise<void> {
    setEnvoi(true);
    setEtat(null);
    try {
      onMaj(await action());
      setEtat({ ton: 'succes', texte: succes });
    } catch (err) {
      setEtat({ ton: 'echec', texte: messageErreur(err, 'L’action a échoué.') });
    } finally {
      setEnvoi(false);
    }
  }

  const dejaDetenus = new Set(user.platformRoles.map((r) => r.role));
  const attribuables = PLATFORM_ROLES.filter((r) => !dejaDetenus.has(r));

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-medium">{user.name || user.email}</span>
          <span className="font-mono text-xs text-[var(--foreground-muted)]">
            {user.email} · {user.organizationCount} organisation
            {user.organizationCount > 1 ? 's' : ''} · inscrit le {formaterDate(user.createdAt)}
          </span>
        </div>
        {desactive ? (
          <Pastille ton="echec">Désactivé le {formaterDate(user.disabledAt)}</Pastille>
        ) : (
          <Pastille ton="succes">Actif</Pastille>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
          Rôles plateforme
        </span>
        {user.platformRoles.length === 0 ? (
          <span className="text-sm text-[var(--foreground-muted)]">aucun</span>
        ) : (
          user.platformRoles.map((r) => {
            const blocage = raisonNonRevocable(user, r.role, moiUserId);
            return (
              <span key={r.role} className="flex items-center gap-1">
                <Pastille ton="neutre">
                  {r.label || libelleRole(r.role)}
                  {r.expiresAt ? ` · jusqu’au ${formaterDate(r.expiresAt)}` : ''}
                </Pastille>
                {peutEcrire ? (
                  <button
                    type="button"
                    disabled={envoi || blocage !== null}
                    title={blocage ?? undefined}
                    onClick={() =>
                      void executer(
                        () => api.revokePlatformRole(user.id, r.role),
                        'Rôle retiré. Le retrait figure au journal.',
                      )
                    }
                    className="text-xs text-[var(--danger)] underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
                  >
                    retirer
                  </button>
                ) : null}
              </span>
            );
          })
        )}
      </div>

      {/* La raison d'un contrôle bloqué est écrite, pas seulement suggérée par
          un `title` qu'un lecteur d'écran mobile n'annoncera jamais. */}
      {peutEcrire
        ? user.platformRoles
            .map((r) => raisonNonRevocable(user, r.role, moiUserId))
            .filter((x): x is string => x !== null)
            .map((raison) => (
              <p key={raison} className="text-xs text-[var(--foreground-muted)]">
                {raison}
              </p>
            ))
        : null}

      {peutEcrire ? (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as PlatformRole)}
              aria-label={`Rôle plateforme à attribuer à ${user.email}`}
              disabled={attribuables.length === 0}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              {attribuables.map((r) => (
                <option key={r} value={r}>
                  {libelleRole(r)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={envoi || attribuables.length === 0 || !attribuables.includes(role)}
              onClick={() =>
                void executer(
                  () => api.grantPlatformRole(user.id, role),
                  'Rôle attribué. L’attribution figure au journal.',
                )
              }
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40"
            >
              Attribuer
            </button>

            <button
              type="button"
              disabled={envoi || blocageDesactivation !== null}
              onClick={() =>
                void executer(
                  () => api.setUserDisabled(user.id, !desactive),
                  desactive ? 'Compte réactivé.' : 'Compte désactivé et sessions révoquées.',
                )
              }
              className="rounded-md border border-[var(--danger)]/40 px-3 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-40"
            >
              {desactive ? 'Réactiver le compte' : 'Désactiver le compte'}
            </button>
          </div>

          {blocageDesactivation ? (
            <p className="text-xs text-[var(--foreground-muted)]">{blocageDesactivation}</p>
          ) : desactive ? null : (
            <p className="max-w-2xl text-xs text-[var(--foreground-muted)]">
              {AVERTISSEMENT_DESACTIVATION}
            </p>
          )}
        </div>
      ) : null}

      {etat ? <Bandeau ton={etat.ton}>{etat.texte}</Bandeau> : null}
    </li>
  );
}
