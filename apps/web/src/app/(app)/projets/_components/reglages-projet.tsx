'use client';

// Onglet « Réglages » d'un projet (`work.manage`, ADR-0039 § 4 et § 8) :
// informations du projet, colonnes du Kanban PROPRES AU PROJET, archivage et
// suppression ; puis les étiquettes de l'organisation (`PUT /work/settings`),
// palette fermée du design system.

import {
  WORK_COLUMN_CATEGORIES,
  WORK_LABEL_COLORS,
  WORK_LIMITS,
  WORK_PROJECT_EDITABLE_STATUSES,
  WorkColumnsSchema,
  type WorkColumn,
  type WorkLabel,
  type WorkLabelColor,
  type WorkProjectEditableStatus,
  type WorkProjectKind,
} from '@lalanda/shared/work';
import {
  Button,
  DatePicker,
  EntityPicker,
  Field,
  FormGrid,
  SegmentedControl,
  Select,
  SubmitButton,
  Tag,
  TextArea,
  TextInput,
  correspondRecherche,
} from '@lalanda/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { workApi, type WorkMemberOption } from '@/lib/work-api';

import { CanalSlack } from './canal-slack';
import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from './elements';
import { useProjet } from './project-context';
import {
  CATEGORIES_COLONNE,
  NATURES_PROJET,
  PROJETS_BASE,
  STATUTS_PROJET,
  cleDepuisLibelle,
  messageWork,
} from './projets-model';

const COULEURS: Record<WorkLabelColor, string> = {
  gray: 'Gris',
  red: 'Rouge',
  orange: 'Orange',
  yellow: 'Jaune',
  green: 'Vert',
  teal: 'Sarcelle',
  blue: 'Bleu',
  purple: 'Violet',
  pink: 'Rose',
};

const OPTIONS_COULEUR = WORK_LABEL_COLORS.map((c) => ({ value: c, label: COULEURS[c] }));

export function ReglagesProjet(): React.ReactElement {
  const { project, gerer } = useProjet();
  if (project === null) return <></>;
  if (!gerer) {
    return (
      <p className="text-sm text-[var(--foreground-muted)]">
        Les réglages du projet sont réservés aux gestionnaires de projets.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <InfosProjet />
      {/* ADR-0064 : canal Slack du projet. */}
      <CanalSlack projectId={project.id} />
      <Colonnes />
      <Etiquettes />
      <CycleDeVie />
    </div>
  );
}

function Bloc({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="text-base font-semibold">{titre}</h2>
      {children}
    </section>
  );
}

function InfosProjet(): React.ReactElement {
  const { project, members, setProject, signalerErreur } = useProjet();
  const p = project!;
  const [f, setF] = useState({
    name: p.name,
    description: p.description ?? '',
    kind: p.kind,
    status: (p.status === 'archived' ? 'active' : p.status) as WorkProjectEditableStatus,
    ownerUserId: p.owner?.userId ?? '',
    startDate: p.startDate ?? '',
    dueDate: p.dueDate ?? '',
  });
  const [envoi, setEnvoi] = useState(false);
  const [ok, setOk] = useState(false);
  const archive = p.status === 'archived';
  const bloque = archive || envoi;
  const responsables = members.filter((m) => m.canUpdate);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setOk(false);
    try {
      setProject(
        await workApi.updateProject(p.id, {
          expectedRevision: p.revision,
          name: f.name.trim(),
          description: f.description.trim() === '' ? null : f.description.trim(),
          kind: f.kind,
          status: f.status,
          ownerUserId: f.ownerUserId || null,
          startDate: f.startDate || null,
          dueDate: f.dueDate || null,
        }),
      );
      setOk(true);
    } catch (err) {
      signalerErreur(err, 'Enregistrement du projet impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Bloc titre="Projet">
      <form onSubmit={(e) => void enregistrer(e)}>
        <fieldset disabled={bloque} className="flex min-w-0 flex-col gap-4">
          <FormGrid>
            <Field id="rg-nom" label="Nom" required size="lg">
              <TextInput
                value={f.name}
                maxLength={120}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            <Field id="rg-statut" label="Statut" group size="full" newRow>
              <SegmentedControl<WorkProjectEditableStatus>
                value={f.status}
                disabled={bloque}
                onChange={(v) => setF({ ...f, status: v })}
                options={WORK_PROJECT_EDITABLE_STATUSES.map((s) => ({
                  value: s,
                  label: STATUTS_PROJET[s],
                }))}
              />
            </Field>
            <Field id="rg-nature" label="Nature" group size="md" newRow>
              <SegmentedControl<WorkProjectKind>
                value={f.kind}
                disabled={bloque}
                onChange={(v) => setF({ ...f, kind: v })}
                options={[
                  { value: 'client', label: NATURES_PROJET.client },
                  { value: 'internal', label: NATURES_PROJET.internal },
                ]}
              />
            </Field>
            <Field
              id="rg-resp"
              label="Responsable du projet"
              size="md"
              hint="Tapez pour chercher parmi les membres qui peuvent modifier le projet."
            >
              <EntityPicker<WorkMemberOption>
                value={responsables.find((m) => m.userId === f.ownerUserId) ?? null}
                onChange={(m) => setF({ ...f, ownerUserId: m?.userId ?? '' })}
                search={async (q) => responsables.filter((m) => correspondRecherche([m.name], q))}
                refreshKey={responsables.length}
                getKey={(m) => m.userId}
                getLabel={(m) => m.name}
                placeholder="Aucun"
                disabled={bloque}
                debounceMs={0}
                emptyText="Aucun membre ne correspond."
              />
            </Field>
            <Field id="rg-debut" label="Début" size="sm" newRow>
              <DatePicker
                value={f.startDate}
                disabled={bloque}
                onChange={(v) => setF({ ...f, startDate: v })}
                shortcuts={['today']}
              />
            </Field>
            <Field id="rg-fin" label="Échéance" size="sm">
              <DatePicker
                value={f.dueDate}
                disabled={bloque}
                onChange={(v) => setF({ ...f, dueDate: v })}
                shortcuts={['endOfMonth', 'plus30', 'endOfYear']}
              />
            </Field>
            <Field id="rg-desc" label="Description" optional size="full">
              <TextArea
                rows={3}
                maxLength={5000}
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
              />
            </Field>
          </FormGrid>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton busy={envoi} showShortcut={false} className="max-sm:h-11 max-sm:w-full">
              Enregistrer
            </SubmitButton>
            {ok ? (
              <span role="status" className="text-sm text-[var(--ok)]">
                ✓ Enregistré
              </span>
            ) : null}
          </div>
        </fieldset>
      </form>
    </Bloc>
  );
}

function Colonnes(): React.ReactElement {
  const { project, tasks, setProject, signalerErreur } = useProjet();
  const p = project!;
  const [cols, setCols] = useState<WorkColumn[]>(p.columns);
  const [nouvelle, setNouvelle] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const occupees = new Set(tasks.map((t) => t.columnKey));
  const modifie = JSON.stringify(cols) !== JSON.stringify(p.columns);

  function deplacer(i: number, delta: number): void {
    const j = i + delta;
    if (j < 0 || j >= cols.length) return;
    const c = [...cols];
    [c[i], c[j]] = [c[j]!, c[i]!];
    setCols(c);
  }

  async function enregistrer(): Promise<void> {
    const r = WorkColumnsSchema.safeParse(cols);
    if (!r.success) {
      setErreur(r.error.issues[0]?.message ?? 'Colonnes invalides.');
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      setProject(
        await workApi.updateProject(p.id, { expectedRevision: p.revision, columns: r.data }),
      );
    } catch (err) {
      setErreur(messageWork(err, 'Enregistrement des colonnes impossible.'));
      signalerErreur(err, 'Enregistrement des colonnes impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Bloc titre="Colonnes du Kanban">
      <p className="text-sm text-[var(--foreground-muted)]">
        Propres à ce projet : 2 à 12 colonnes, au moins une « à faire » et une seule « terminé ».
        Une colonne qui porte des tâches ne peut ni être retirée ni changer de catégorie.
      </p>
      <ol className="flex flex-col gap-2">
        {cols.map((c, i) => {
          const occupee = occupees.has(c.key);
          return (
            <li key={c.key} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-right text-xs text-[var(--foreground-muted)]">
                {i + 1}.
              </span>
              <TextInput
                id={`col-${c.key}`}
                aria-label={`Libellé de la colonne ${i + 1}`}
                value={c.label}
                maxLength={WORK_LIMITS.columnLabelMax}
                onChange={(e) =>
                  setCols(cols.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)))
                }
                className="min-w-0 flex-1 basis-32"
              />
              <Select<WorkColumn['category']>
                id={`cat-${c.key}`}
                aria-label={`Catégorie de la colonne ${c.label}`}
                value={c.category}
                disabled={occupee && p.columns.some((x) => x.key === c.key)}
                onChange={(v) =>
                  setCols(cols.map((x) => (x.key === c.key ? { ...x, category: v } : x)))
                }
                options={WORK_COLUMN_CATEGORIES.map((k) => ({
                  value: k,
                  label: CATEGORIES_COLONNE[k],
                }))}
                className="w-40"
              />
              <button
                type="button"
                className={BOUTON_PETIT}
                disabled={i === 0}
                aria-label={`Monter la colonne ${c.label}`}
                onClick={() => deplacer(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={BOUTON_PETIT}
                disabled={i === cols.length - 1}
                aria-label={`Descendre la colonne ${c.label}`}
                onClick={() => deplacer(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className={BOUTON_DANGER}
                disabled={occupee}
                title={occupee ? 'Cette colonne porte des tâches' : undefined}
                aria-label={`Retirer la colonne ${c.label}`}
                onClick={() => setCols(cols.filter((x) => x.key !== c.key))}
              >
                Retirer
              </button>
            </li>
          );
        })}
      </ol>
      {cols.length < WORK_LIMITS.columnsMax ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const label = nouvelle.trim();
            if (!label) return;
            const key = cleDepuisLibelle(
              label,
              cols.map((c) => c.key),
            );
            // Nouvelle colonne « en cours », placée avant la colonne « terminé ».
            const iDone = cols.findIndex((c) => c.category === 'done');
            const c = [...cols];
            c.splice(iDone === -1 ? c.length : iDone, 0, { key, label, category: 'in_progress' });
            setCols(c);
            setNouvelle('');
          }}
        >
          <TextInput
            id="col-nouvelle"
            aria-label="Nouvelle colonne"
            value={nouvelle}
            maxLength={WORK_LIMITS.columnLabelMax}
            onChange={(e) => setNouvelle(e.target.value)}
            placeholder="Nouvelle colonne"
            className="max-w-xs"
          />
          <button type="submit" className={BOUTON_PETIT} disabled={!nouvelle.trim()}>
            Ajouter
          </button>
        </form>
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="primary"
          busy={envoi}
          disabled={!modifie || p.status === 'archived'}
          onClick={() => void enregistrer()}
        >
          Enregistrer les colonnes
        </Button>
        {modifie ? (
          <Button variant="ghost" onClick={() => setCols(p.columns)}>
            Annuler
          </Button>
        ) : null}
      </div>
    </Bloc>
  );
}

function Etiquettes(): React.ReactElement {
  const { settings, setSettings } = useProjet();
  const [labels, setLabels] = useState<WorkLabel[]>(settings?.labels ?? []);
  const [nom, setNom] = useState('');
  const [couleur, setCouleur] = useState<WorkLabelColor>('blue');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  if (settings === null) return <></>;
  const modifie = JSON.stringify(labels) !== JSON.stringify(settings.labels);

  async function enregistrer(): Promise<void> {
    if (settings === null) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const s = await workApi.putSettings({
        expectedRevision: settings.revision,
        labels,
        defaultColumns: settings.defaultColumns,
        dueSoonDays: settings.dueSoonDays,
      });
      setSettings(s);
      setLabels(s.labels);
    } catch (err) {
      setErreur(messageWork(err, 'Enregistrement des étiquettes impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Bloc titre="Étiquettes de l’organisation">
      <p className="text-sm text-[var(--foreground-muted)]">
        Communes à tous les projets. Couleurs prises dans une palette fermée, chacune avec sa forme
        de repère : le libellé reste toujours écrit.
      </p>
      {labels.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucune étiquette.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {labels.map((l) => (
            <li key={l.key} className="flex flex-wrap items-center gap-2">
              <Tag color={l.color}>{l.label}</Tag>
              <Select<WorkLabelColor>
                id={`etq-c-${l.key}`}
                aria-label={`Couleur de ${l.label}`}
                value={l.color}
                onChange={(v) =>
                  setLabels(labels.map((x) => (x.key === l.key ? { ...x, color: v } : x)))
                }
                options={OPTIONS_COULEUR}
                searchable={false}
                className="w-36"
              />
              <button
                type="button"
                className={BOUTON_DANGER}
                aria-label={`Retirer l’étiquette ${l.label}`}
                onClick={() => setLabels(labels.filter((x) => x.key !== l.key))}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
      {labels.length < WORK_LIMITS.labelsMax ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const label = nom.trim();
            if (!label) return;
            setLabels([
              ...labels,
              {
                key: cleDepuisLibelle(
                  label,
                  labels.map((x) => x.key),
                ),
                label,
                color: couleur,
              },
            ]);
            setNom('');
          }}
        >
          <TextInput
            id="etq-nom"
            aria-label="Nouvelle étiquette"
            value={nom}
            maxLength={WORK_LIMITS.labelLabelMax}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nouvelle étiquette"
            className="min-w-0 flex-1 basis-40"
          />
          <Select<WorkLabelColor>
            id="etq-couleur"
            aria-label="Couleur"
            value={couleur}
            onChange={setCouleur}
            options={OPTIONS_COULEUR}
            searchable={false}
            className="w-36"
          />
          <button type="submit" className={BOUTON_PETIT} disabled={!nom.trim()}>
            Ajouter
          </button>
        </form>
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div>
        <Button
          variant="primary"
          busy={envoi}
          disabled={!modifie}
          onClick={() => void enregistrer()}
        >
          Enregistrer les étiquettes
        </Button>
      </div>
    </Bloc>
  );
}

function CycleDeVie(): React.ReactElement {
  const router = useRouter();
  const { project, setProject, signalerErreur } = useProjet();
  const p = project!;
  const [envoi, setEnvoi] = useState(false);
  const archive = p.status === 'archived';

  async function geste(f: () => Promise<void>, repli: string): Promise<void> {
    setEnvoi(true);
    try {
      await f();
    } catch (err) {
      signalerErreur(err, repli);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Bloc titre="Archivage et suppression">
      <p className="text-sm text-[var(--foreground-muted)]">
        Archiver masque le projet des listes et de « Mes tâches » et le passe en lecture seule ;
        rien n’est perdu. Supprimer n’est possible que pour un projet sans temps saisi, sans facture
        ni dépense rattachée.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={envoi}
          onClick={() =>
            void geste(
              async () =>
                setProject(
                  archive
                    ? await workApi.restoreProject(p.id, p.revision)
                    : await workApi.archiveProject(p.id, p.revision),
                ),
              archive ? 'Restauration impossible.' : 'Archivage impossible.',
            )
          }
        >
          {archive ? 'Restaurer le projet' : 'Archiver le projet'}
        </Button>
        <Button
          variant="danger"
          disabled={envoi}
          onClick={() => {
            if (!window.confirm(`Supprimer définitivement le projet « ${p.name} » et ses tâches ?`))
              return;
            void geste(async () => {
              await workApi.deleteProject(p.id);
              router.push(PROJETS_BASE);
            }, 'Suppression impossible.');
          }}
        >
          Supprimer le projet
        </Button>
      </div>
    </Bloc>
  );
}
