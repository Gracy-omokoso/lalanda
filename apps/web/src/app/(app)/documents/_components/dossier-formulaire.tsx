'use client';

// Création ou modification d'un dossier et de ses droits (ADR-0046 § 4.1), en
// fenêtre modale (`docs.manage`). Lecture : tous, par nature (droit effectif), ou
// personnes désignées (dossier restreint, invisible des autres, nom compris).
// Écriture : gestionnaires, plus des personnes désignées. Un sous-dossier hérite
// et ne peut qu'ajouter des restrictions : l'API en juge.

import { Modal, buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import { documentsApi, type DocumentFolderView } from '@/lib/api-documents';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import {
  ACTIONS_DOSSIER,
  descendants,
  formulaireDossier,
  optionsDossiers,
  preparerDossier,
  type FormulaireDossier,
  type TypeLecture,
} from './arbre-model';
import { messageDocuments } from './documents-model';
import type { MembreOrg } from './documents-ui';

function ChoixPersonnes({
  legende,
  membres,
  valeur,
  onChange,
  erreur,
}: {
  legende: string;
  membres: readonly MembreOrg[];
  valeur: string[];
  onChange: (v: string[]) => void;
  erreur?: string;
}): React.ReactElement {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">{legende}</legend>
      {membres.length === 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          La liste des membres n’est pas lisible.
        </p>
      ) : (
        <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] p-2 sm:grid-cols-2">
          {membres.map((m) => (
            <li key={m.userId}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={valeur.includes(m.userId)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...valeur, m.userId]
                        : valeur.filter((u) => u !== m.userId),
                    )
                  }
                />
                <span className="break-words">{m.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {erreur ? <p className="text-xs text-[var(--danger)]">{erreur}</p> : null}
    </fieldset>
  );
}

export function DossierFormulaire({
  dossier,
  parentInitial,
  dossiers,
  membres,
  onFermer,
  onFait,
}: {
  dossier: DocumentFolderView | null;
  parentInitial: string;
  dossiers: readonly DocumentFolderView[];
  membres: readonly MembreOrg[];
  onFermer: () => void;
  onFait: (d: DocumentFolderView) => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormulaireDossier>(() => formulaireDossier(dossier, parentInitial));
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const exclus = dossier ? descendants(dossiers, dossier.id) : new Set<string>();
  const parents = optionsDossiers(dossiers, false).filter((o) => !exclus.has(o.id));

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerDossier(f);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      const d =
        dossier === null
          ? await documentsApi.createFolder(p.corps)
          : await documentsApi.updateFolder(dossier.id, {
              ...p.corps,
              expectedRevision: dossier.revision,
            });
      onFait(d);
    } catch (err) {
      setErreur(messageDocuments(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title={dossier ? 'Modifier le dossier' : 'Nouveau dossier'}
      description="Les droits se jugent sur les autorisations effectives de chacun, jamais sur le nom du rôle."
      size="md"
    >
      <form noValidate onSubmit={(e) => void valider(e)} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ id={`${id}-nom`} label="Nom" requis erreur={champs['name']}>
            <input
              id={`${id}-nom`}
              className={CHAMP}
              value={f.name}
              maxLength={120}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              {...aria(`${id}-nom`, champs['name'])}
            />
          </Champ>
          <Champ id={`${id}-parent`} label="Dans" aide="Cinq niveaux au plus.">
            <select
              id={`${id}-parent`}
              className={CHAMP}
              value={f.parentId}
              onChange={(e) => setF({ ...f, parentId: e.target.value })}
              aria-describedby={`${id}-parent-aide`}
            >
              <option value="">La racine de la bibliothèque</option>
              {parents.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Champ>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Qui peut le consulter ?</legend>
          {(
            [
              ['all', 'Tous ceux qui consultent la bibliothèque'],
              ['action', 'Seulement ceux qui ont une autorisation'],
              ['users', 'Seulement des personnes désignées (dossier restreint)'],
            ] as [TypeLecture, string][]
          ).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-lecture`}
                checked={f.lecture === v}
                onChange={() => setF({ ...f, lecture: v })}
              />
              {l}
            </label>
          ))}
          {f.lecture === 'action' ? (
            <select
              aria-label="Autorisation exigée"
              className={CHAMP}
              value={f.action}
              onChange={(e) => setF({ ...f, action: e.target.value })}
            >
              {ACTIONS_DOSSIER.map((x) => (
                <option key={x.action} value={x.action}>
                  {x.label}
                </option>
              ))}
            </select>
          ) : null}
          {f.lecture === 'users' ? (
            <>
              <p className="text-xs text-[var(--foreground-muted)]">
                Un dossier restreint n’est visible, nom compris, que de ces personnes et du
                Propriétaire — même pas des autres gestionnaires des documents.
              </p>
              <ChoixPersonnes
                legende="Personnes autorisées"
                membres={membres}
                valeur={f.lecteurs}
                onChange={(lecteurs) => setF({ ...f, lecteurs })}
                erreur={champs['lecteurs']}
              />
            </>
          ) : null}
        </fieldset>

        <ChoixPersonnes
          legende="Peuvent aussi y déposer (en plus des gestionnaires)"
          membres={membres}
          valeur={f.ecrivains}
          onChange={(ecrivains) => setF({ ...f, ecrivains })}
        />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={f.inherit}
            onChange={(e) => setF({ ...f, inherit: e.target.checked })}
          />
          <span>
            Hériter des droits du dossier parent
            <span className="block text-xs text-[var(--foreground-muted)]">
              Un sous-dossier ne peut qu’ajouter des restrictions, jamais élargir.
            </span>
          </span>
        </label>

        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
