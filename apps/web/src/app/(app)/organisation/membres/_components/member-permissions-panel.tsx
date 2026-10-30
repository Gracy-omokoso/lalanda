'use client';

// Fiche des autorisations d'un membre — ADR-0041 § 7, lot A5.
//
// Deux composants :
//  - `GrilleAutorisations` : la grille par domaine, partagée par la fiche, la
//    personnalisation à l'invitation et « Mes autorisations » (/compte) ;
//  - `MemberPermissionsPanel` : la fiche elle-même — phrase d'écart, grille,
//    motif facultatif, enregistrement avec la révision.
//
// Accessibilité (docs/04) : chaque état est dit en TEXTE (« Inclus dans le
// titre », « Ajout », « Retrait », « Non inclus ») ; la couleur et le barré ne
// font que le renforcer. Chaque domaine est un `fieldset` avec son compte ;
// chaque case désactivée est liée à sa raison par `aria-describedby`. Les
// dépendances cochées avec une case sont annoncées dans une région `aria-live`.
// Tout se joue au clavier (cases natives, boutons natifs) et sur une colonne
// sur téléphone.

import { useEffect, useMemo, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import {
  apiAutorisations,
  type CatalogueAutorisations,
  type MembreAutorisations,
  type MesPermissions,
} from '@/lib/api-permissions';

import {
  LIBELLE_ETAT,
  basculer,
  compteDomaine,
  construireGrille,
  ecartAEnvoyer,
  ecartAffiche,
  ligneDuTitre,
  memeEcart,
  messageAutorisations,
  personnalisationDesactivee,
  phraseEcart,
  verrouFiche,
  type DomaineGrille,
  type EtatAutorisation,
} from './permissions-model';

const STYLE_ETAT: Readonly<Record<EtatAutorisation, string>> = {
  titre: 'border-[var(--border-strong)] text-[var(--foreground-muted)]',
  ajoute: 'border-[var(--accent)] text-[var(--accent)]',
  retire: 'border-[var(--danger)] text-[var(--danger)]',
  non_inclus: 'border-transparent text-[var(--foreground-muted)]',
};

interface GrilleProps {
  idPrefixe: string;
  grille: readonly DomaineGrille[];
  /** Lecture seule : aucune case, seulement les états en texte. */
  lectureSeule?: boolean;
  onBasculer?: (action: OrgAction) => void;
}

export function GrilleAutorisations({
  idPrefixe,
  grille,
  lectureSeule = false,
  onBasculer,
}: GrilleProps): React.ReactElement {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {grille.map((domaine) => (
        <fieldset
          key={domaine.cle}
          className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 pb-3 pt-1"
        >
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
            {compteDomaine(domaine)}
          </legend>
          <ul className="flex flex-col gap-1.5">
            {domaine.lignes.map((ligne) => {
              const id = `${idPrefixe}-${ligne.action.replace('.', '-')}`;
              const etat = (
                <span
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.04em] ${STYLE_ETAT[ligne.etat]}`}
                >
                  {LIBELLE_ETAT[ligne.etat]}
                </span>
              );
              const libelle = (
                <span className={ligne.etat === 'retire' ? 'line-through' : undefined}>
                  {ligne.libelle}
                </span>
              );

              if (lectureSeule) {
                return (
                  <li key={ligne.action} className="flex items-start justify-between gap-2 text-sm">
                    <span className="flex items-start gap-2">
                      <span aria-hidden="true" className="w-4 shrink-0 text-center">
                        {ligne.coche ? '✓' : '–'}
                      </span>
                      <span>
                        <span className="sr-only">
                          {ligne.coche ? 'Détenue : ' : 'Non détenue : '}
                        </span>
                        {libelle}
                      </span>
                    </span>
                    {etat}
                  </li>
                );
              }

              const indisponible = ligne.raison !== null;
              return (
                <li key={ligne.action} className="flex flex-col gap-0.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <label htmlFor={id} className="flex min-w-0 items-start gap-2">
                      <input
                        id={id}
                        type="checkbox"
                        checked={ligne.coche}
                        disabled={indisponible}
                        aria-describedby={indisponible ? `${id}-raison` : undefined}
                        onChange={() => onBasculer?.(ligne.action)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <span className={indisponible ? 'text-[var(--foreground-muted)]' : undefined}>
                        {libelle}
                      </span>
                    </label>
                    {etat}
                  </div>
                  {indisponible ? (
                    <span
                      id={`${id}-raison`}
                      className="pl-6 text-xs text-[var(--foreground-muted)]"
                    >
                      {ligne.raison}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

interface MemberPermissionsPanelProps {
  orgId: string;
  membre: MembreAutorisations;
  catalogue: CatalogueAutorisations;
  /** `GET /me/permissions` de l'acteur ; `null` = rien d'ajoutable. */
  moi: MesPermissions | null;
  moiUserId: string | null;
  /** Interrupteur éteint (connu de la page) : la grille passe en lecture seule. */
  desactivee: boolean;
  onDesactivee: () => void;
  /** Recharge la liste (et les permissions de la coquille) après une écriture. */
  onEcrit: () => Promise<void>;
  nom: string;
}

export function MemberPermissionsPanel({
  orgId,
  membre,
  catalogue,
  moi,
  moiUserId,
  desactivee,
  onDesactivee,
  onEcrit,
  nom,
}: MemberPermissionsPanelProps): React.ReactElement {
  const ligne = useMemo(() => ligneDuTitre(catalogue, membre.role, membre), [catalogue, membre]);
  // Clé textuelle : un rechargement de la liste rend un NOUVEAU tableau à
  // contenu égal, qui ne doit pas effacer une saisie en cours.
  const cleEffective = membre.effective.join(',');
  const initiale = useMemo(
    () => new Set<OrgAction>(cleEffective.split(',').filter(Boolean) as OrgAction[]),
    [cleEffective],
  );
  const [selection, setSelection] = useState<Set<OrgAction>>(initiale);
  const [motif, setMotif] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  // Une nouvelle révision (écriture d'ici ou d'ailleurs) repart de l'état servi.
  useEffect(() => {
    setSelection(new Set(initiale));
  }, [initiale, membre.permissionsRevision]);

  const verrou = verrouFiche(membre, moiUserId, desactivee);
  const params = {
    catalogue,
    base: ligne.base,
    conditionnelles: ligne.conditionnelles,
    selection,
    contexte: 'membre' as const,
    ajoutables: moi?.grantableActions ?? [],
    verrou,
  };
  const grille = construireGrille(params);
  const ecartVu = ecartAffiche(catalogue, ligne.base, selection);
  const aEnvoyer = ecartAEnvoyer(catalogue, ligne, selection, membre.canClosePeriods);
  const actuel = ecartAEnvoyer(catalogue, ligne, initiale, membre.canClosePeriods);
  const modifie = !memeEcart(aEnvoyer, actuel);
  const surTitre = ecartVu.grants.length === 0 && ecartVu.revokes.length === 0;
  const idPrefixe = `autorisations-${membre.userId}`;

  async function enregistrer(): Promise<void> {
    setOccupe(true);
    setErreur(null);
    setMessage(null);
    try {
      await apiAutorisations.setPermissionsMembre(orgId, membre.userId, {
        ...aEnvoyer,
        expectedRevision: membre.permissionsRevision,
        ...(motif.trim() !== '' ? { reason: motif.trim() } : {}),
      });
      setMotif('');
      await onEcrit();
      setMessage(`Autorisations de ${nom} enregistrées.`);
    } catch (err) {
      if (personnalisationDesactivee({ erreur: err })) onDesactivee();
      setErreur(messageAutorisations(err, catalogue, 'L’enregistrement a échoué.'));
      // 409 STALE_REVISION : la fiche est rechargée, et le message le dit.
      if ((err as { detail?: { code?: unknown } }).detail?.code === 'STALE_REVISION') {
        await onEcrit();
      }
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section
      aria-label={`Autorisations de ${nom}`}
      className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"
    >
      <p className="text-sm font-medium">
        {phraseEcart(catalogue, membre.roleLabel, ligne.base, ecartVu)}
      </p>

      {verrou ? (
        <p className="rounded-md border border-dashed border-[var(--border)] p-2 text-xs text-[var(--foreground-muted)]">
          {verrou}
        </p>
      ) : null}

      <GrilleAutorisations
        idPrefixe={idPrefixe}
        grille={grille}
        lectureSeule={verrou !== null}
        onBasculer={(action) => {
          const r = basculer({ ...params, selection }, action);
          setSelection(r.selection);
          setMessage(r.message);
          setErreur(null);
        }}
      />

      <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {message ?? ''}
      </p>

      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-2 text-sm text-[var(--danger)]"
        >
          {erreur}
        </div>
      ) : null}

      {verrou === null ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${idPrefixe}-motif`} className="text-xs font-medium">
            Motif (facultatif, visible dans le journal d’audit)
          </label>
          <input
            id={`${idPrefixe}-motif`}
            type="text"
            maxLength={280}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={!modifie || occupe}
              onClick={() => void enregistrer()}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
            >
              {occupe ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              disabled={!modifie || occupe}
              onClick={() => {
                setSelection(new Set(initiale));
                setMessage('Modifications annulées.');
              }}
              className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm transition hover:border-[var(--accent)] disabled:opacity-50"
            >
              Annuler les modifications
            </button>
            <button
              type="button"
              disabled={surTitre || occupe}
              onClick={() => {
                setSelection(new Set(ligne.base));
                setMessage('Autorisations du titre rétablies. Enregistrez pour confirmer.');
              }}
              className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm transition hover:border-[var(--accent)] disabled:opacity-50"
            >
              Revenir aux autorisations du titre
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
