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

import { Field, Select, TextInput } from '@lalanda/ui';
import { Search } from 'lucide-react';
import { useCallback, useState } from 'react';

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
// ADR-0053 — P2
import { ChampsMotif } from './champs-motif';
import {
  echeanceSupportParDefaut,
  MOTIF_VIDE,
  motifComplet,
  rechercheSuffisante,
  type MotifSaisi,
} from './motif-model';
import { ReauthGate, useReauth, type Reauth } from './reauth-gate';
// ADR-0053 — P8
import { ReinitialisationDeuxFacteurs } from './reinitialisation-deux-facteurs';

const REAUTH_COMPTES =
  'Bloquer, débloquer un compte ou attribuer un rôle plateforme exige une ré-authentification, valable dix minutes. Chaque geste est motivé et inscrit au journal plateforme.';

export function UsersPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const { data: session } = useSession();
  const moiUserId = session?.user?.id ?? null;

  const [recherche, setRecherche] = useState('');
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const reauth = useReauth();

  // ADR-0053 — P2 : la recherche est OBLIGATOIRE côté serveur (`400 SEARCH_REQUIRED`) ;
  // rien n'est chargé avant trois caractères.
  const charger = useCallback(async (q: string): Promise<void> => {
    if (!rechercheSuffisante(q)) {
      setUsers(null);
      setErreur('Saisissez au moins trois caractères : la recherche est obligatoire.');
      return;
    }
    setChargement(true);
    try {
      const { users: liste } = await api.listAdminUsers(q.trim());
      setUsers(liste);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger les comptes.'));
    } finally {
      setChargement(false);
    }
  }, []);

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
        <Field label="Rechercher un compte" className="w-full max-w-xs">
          <TextInput
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Adresse e-mail ou nom"
            leading={<Search className="h-4 w-4" aria-hidden="true" />}
          />
        </Field>
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
          {users
            ? 'Aucun compte ne correspond à cette recherche.'
            : 'Cherchez un compte par son adresse ou son nom (trois caractères au moins).'}
        </Vide>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((user) => (
            <LigneCompte
              key={user.id}
              user={user}
              moiUserId={moiUserId}
              peutEcrire={acces.canManagePlatform}
              peutReinitialiser2fa={acces.actions.includes('platform.roles.manage')}
              reauth={reauth}
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
  peutReinitialiser2fa,
  reauth,
  onMaj,
}: {
  user: AdminUserSummary;
  moiUserId: string | null;
  peutEcrire: boolean;
  /** ADR-0053 — P8 : `platform.roles.manage` (super-administrateur). */
  peutReinitialiser2fa: boolean;
  reauth: Reauth;
  onMaj: (maj: AdminUserSummary) => void;
}): React.ReactElement {
  const [role, setRole] = useState<PlatformRole>('platform_support');
  const [motifRole, setMotifRole] = useState('');
  const [motif, setMotif] = useState<MotifSaisi>(MOTIF_VIDE);
  const [etat, setEtat] = useState<{ ton: 'succes' | 'echec'; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const desactive = user.disabledAt !== null;
  const blocageDesactivation = raisonNonDesactivable(user, moiUserId);

  async function executer(action: () => Promise<AdminUserSummary>, succes: string): Promise<void> {
    setEnvoi(true);
    setEtat(null);
    try {
      onMaj(await action());
      setMotif(MOTIF_VIDE);
      setMotifRole('');
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
          <Pastille ton="echec">Bloqué le {formaterDate(user.disabledAt)}</Pastille>
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
        <div className="border-t border-[var(--border)] pt-3">
          <ReauthGate reauth={reauth} description={REAUTH_COMPTES}>
            <div className="flex flex-wrap items-end gap-2">
              <Select<PlatformRole>
                value={role}
                onChange={setRole}
                aria-label={`Rôle plateforme à attribuer à ${user.email}`}
                disabled={attribuables.length === 0}
                options={attribuables.map((r) => ({ value: r, label: libelleRole(r) }))}
                className="w-56"
              />
              <TextInput
                value={motifRole}
                onChange={(e) => setMotifRole(e.target.value)}
                placeholder="Motif de l’attribution (10 caractères minimum)"
                aria-label="Motif de l’attribution"
                className="w-80 max-w-full"
              />
              <button
                type="button"
                disabled={
                  envoi ||
                  attribuables.length === 0 ||
                  !attribuables.includes(role) ||
                  motifRole.trim().length < 10
                }
                onClick={() =>
                  void executer(
                    () =>
                      api.grantPlatformRole(user.id, role, {
                        reason: motifRole.trim(),
                        // Le Support est attribué pour 90 jours au plus (ADR-0053, décision n° 18).
                        ...(role === 'platform_support'
                          ? { expiresAt: echeanceSupportParDefaut(new Date()) }
                          : {}),
                      }),
                    'Rôle attribué. L’attribution figure au journal.',
                  )
                }
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40"
              >
                Attribuer
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <ChampsMotif
                motif={motif}
                onChange={setMotif}
                avecCategorie={!desactive}
                avecMessageClient={false}
              />
              <div>
                <button
                  type="button"
                  disabled={
                    envoi ||
                    blocageDesactivation !== null ||
                    !motifComplet(motif, { avecCategorie: !desactive, avecMessageClient: false })
                  }
                  onClick={() =>
                    void executer(
                      () =>
                        desactive
                          ? api.unblockUser(user.id, { internalNote: motif.internalNote.trim() })
                          : motif.reasonCategory === ''
                            ? Promise.reject(new Error('Catégorie de motif obligatoire.'))
                            : api.blockUser(user.id, {
                                reasonCategory: motif.reasonCategory,
                                internalNote: motif.internalNote.trim(),
                              }),
                      desactive
                        ? 'Compte débloqué : il peut de nouveau se connecter.'
                        : 'Compte bloqué : sessions révoquées, connexion refusée.',
                    )
                  }
                  className="rounded-md border border-[var(--danger)]/40 px-3 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-40"
                >
                  {desactive ? 'Débloquer le compte' : 'Bloquer le compte'}
                </button>
              </div>
            </div>

            {blocageDesactivation ? (
              <p className="text-xs text-[var(--foreground-muted)]">{blocageDesactivation}</p>
            ) : desactive ? null : (
              <p className="max-w-2xl text-xs text-[var(--foreground-muted)]">
                {AVERTISSEMENT_DESACTIVATION}
              </p>
            )}
            {/* ADR-0053 — P8 : super-administrateur seul, opérateur tiers seulement. */}
            {peutReinitialiser2fa && user.platformRoles.length > 0 && user.id !== moiUserId ? (
              <ReinitialisationDeuxFacteurs userId={user.id} email={user.email} />
            ) : null}
          </ReauthGate>
        </div>
      ) : null}

      {etat ? <Bandeau ton={etat.ton}>{etat.texte}</Bandeau> : null}
    </li>
  );
}
