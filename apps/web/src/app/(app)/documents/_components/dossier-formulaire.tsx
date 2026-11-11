'use client';

// Création ou modification d'un dossier et de ses droits (ADR-0046 § 4.1), en
// fenêtre modale (`docs.manage`). Lecture : tous, par nature (droit effectif), ou
// personnes désignées (dossier restreint, invisible des autres, nom compris).
// Écriture : gestionnaires, plus des personnes désignées. Un sous-dossier hérite
// et ne peut qu'ajouter des restrictions : l'API en juge.

import {
  Button,
  Checkbox,
  ChoiceCards,
  EntityPicker,
  Field,
  FormGrid,
  Modal,
  Select,
  SubmitButton,
  TextInput,
  correspondRecherche,
} from '@lalanda/ui';
import { useId, useState } from 'react';

import { documentsApi, type DocumentFolderView } from '@/lib/api-documents';

import { Alerte } from '../../ventes/_components/form-ui';

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
      <legend className="mb-1 text-sm font-medium">{legende}</legend>
      {membres.length === 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          La liste des membres n’est pas lisible.
        </p>
      ) : (
        <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] p-2 sm:grid-cols-2">
          {membres.map((m) => (
            <li key={m.userId}>
              <Checkbox
                checked={valeur.includes(m.userId)}
                onChange={(coche) =>
                  onChange(coche ? [...valeur, m.userId] : valeur.filter((u) => u !== m.userId))
                }
                label={<span className="break-words">{m.name}</span>}
              />
            </li>
          ))}
        </ul>
      )}
      {erreur ? (
        <p aria-live="polite" className="text-xs font-medium text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
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
  const parentChoisi = parents.find((o) => o.id === f.parentId) ?? null;

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
        <FormGrid>
          <Field id={`${id}-nom`} label="Nom" required size="lg" error={champs['name']}>
            <TextInput
              value={f.name}
              maxLength={120}
              autoFocus={dossier === null}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field
            id={`${id}-parent`}
            label="Dans"
            size="lg"
            newRow
            hint="Tapez pour chercher. Cinq niveaux au plus."
          >
            <EntityPicker<{ id: string; label: string }>
              value={parentChoisi}
              onChange={(o) => setF({ ...f, parentId: o?.id ?? '' })}
              search={async (q) => parents.filter((o) => correspondRecherche([o.label], q))}
              refreshKey={parents.length}
              getKey={(o) => o.id}
              getLabel={(o) => o.label}
              placeholder="La racine de la bibliothèque"
              debounceMs={0}
              emptyText="Aucun dossier ne correspond."
            />
          </Field>
          <Field label="Qui peut le consulter ?" size="full" group newRow>
            <ChoiceCards<TypeLecture>
              value={f.lecture}
              onChange={(lecture) => setF({ ...f, lecture })}
              columns={1}
              options={[
                { value: 'all', label: 'Tous ceux qui consultent la bibliothèque' },
                { value: 'action', label: 'Seulement ceux qui ont une autorisation' },
                {
                  value: 'users',
                  label: 'Seulement des personnes désignées (dossier restreint)',
                  description:
                    'Visible, nom compris, de ces personnes et du Propriétaire seulement — même pas des autres gestionnaires des documents.',
                },
              ]}
            />
          </Field>
          {f.lecture === 'action' ? (
            <Field label="Autorisation exigée" size="lg" newRow>
              <Select<string>
                value={f.action}
                onChange={(action) => setF({ ...f, action })}
                options={ACTIONS_DOSSIER.map((x) => ({ value: x.action, label: x.label }))}
              />
            </Field>
          ) : null}
        </FormGrid>
        {f.lecture === 'users' ? (
          <ChoixPersonnes
            legende="Personnes autorisées"
            membres={membres}
            valeur={f.lecteurs}
            onChange={(lecteurs) => setF({ ...f, lecteurs })}
            erreur={champs['lecteurs']}
          />
        ) : null}

        <ChoixPersonnes
          legende="Peuvent aussi y déposer (en plus des gestionnaires)"
          membres={membres}
          valeur={f.ecrivains}
          onChange={(ecrivains) => setF({ ...f, ecrivains })}
        />
        <Checkbox
          checked={f.inherit}
          onChange={(inherit) => setF({ ...f, inherit })}
          label="Hériter des droits du dossier parent"
          description="Un sous-dossier ne peut qu’ajouter des restrictions, jamais élargir."
        />

        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button size="sm" onClick={onFermer} disabled={envoi} className="max-sm:h-11">
            Annuler
          </Button>
          <SubmitButton size="sm" busy={envoi} busyLabel="Enregistrement…" className="max-sm:h-11">
            Enregistrer
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
