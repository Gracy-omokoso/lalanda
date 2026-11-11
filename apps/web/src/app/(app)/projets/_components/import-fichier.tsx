'use client';

// « Importer un fichier » (ADR-0062) : nouveau projet depuis un .xlsx/.csv, ou
// « Importer des tâches » dans un projet existant (`?projet=<id>`).
//
// Parcours : 1. modèle à télécharger ; 2. fichier choisi → APERÇU calculé par le
// serveur (lignes, erreurs ligne par ligne, compteurs), rien n'est écrit ;
// 3. « Importer » renvoie le même fichier, le serveur refait la même lecture et
// crée tout en une fois par le créateur commun. Une ligne en erreur est écartée,
// et l'import l'exige confirmé.
//
// ADR-0074 : nom, responsable (choix d'un membre en `EntityPicker`, sans
// création : un membre s'invite depuis l'organisation), nature en segments,
// dates en `DatePicker`, confirmation en case stylée. Mêmes champs envoyés.

import type {
  WorkImportIssue,
  WorkImportPreview,
  WorkImportRowView,
  WorkPlanApplyResult,
  WorkProjectView,
} from '@lalanda/shared/work';
import {
  Button,
  Checkbox,
  DatePicker,
  EmptyState,
  EntityPicker,
  Field,
  FormGrid,
  PageHeader,
  SegmentedControl,
  StatusPill,
  TextInput,
  buttonClasses,
  correspondRecherche,
} from '@lalanda/ui';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { workApi, type WorkMemberOption } from '@/lib/work-api';
import { workPlanApi } from '@/lib/work-plan-api';

import { useShell } from '../../_components/shell-context';

import { Alerte } from './elements';
import {
  FORMATS_ACCEPTES,
  boutonImport,
  compteursApercu,
  fichierRefuse,
  heures,
  messagePlan,
  phraseApercu,
  problemesParLigne,
} from './import-model';
import {
  NATURES_PROJET,
  PRIORITES,
  formatJour,
  hrefProjet,
  peutGerer,
  peutTravailler,
} from './projets-model';

const CARTE = 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]';

async function telecharger(format: 'xlsx' | 'csv'): Promise<void> {
  const blob = await workPlanApi.downloadTemplate(format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `modele-import-projet.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Etape({
  n,
  titre,
  children,
}: {
  n: number;
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className={`${CARTE} flex min-w-0 flex-col gap-3 p-4`} aria-labelledby={`etape-${n}`}>
      <h2 id={`etape-${n}`} className="flex items-center gap-2 text-sm font-semibold">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]"
        >
          {n}
        </span>
        {titre}
      </h2>
      {children}
    </section>
  );
}

function Modele(): React.ReactElement {
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = (format: 'xlsx' | 'csv') => {
    setErreur(null);
    telecharger(format).catch((err: unknown) =>
      setErreur(messagePlan(err, 'Téléchargement impossible.')),
    );
  };
  return (
    <Etape n={1} titre="Préparez le fichier avec le modèle">
      <p className="text-sm text-[var(--foreground-muted)]">
        Une ligne par tâche. Seule la colonne{' '}
        <strong className="text-[var(--foreground)]">Tâche</strong> est obligatoire ; les autres :
        Section, Description, Responsable (e-mail d’un membre), Début et Échéance (JJ/MM/AAAA),
        Priorité (Basse, Moyenne, Haute, Urgente), Jalon (Oui/Non), Dépend de et Sous-tâche de
        (numéro de ligne ou nom), Étiquettes, Estimation (heures). L’onglet « Guide » du modèle
        explique chaque colonne ; l’onglet « Tâches » donne un exemple.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => charger('xlsx')}>
          <Download aria-hidden="true" className="h-4 w-4" />
          Modèle Excel (.xlsx)
        </Button>
        <Button size="sm" onClick={() => charger('csv')}>
          <Download aria-hidden="true" className="h-4 w-4" />
          Modèle CSV
        </Button>
      </div>
      {erreur ? <p className="text-sm text-[var(--danger)]">{erreur}</p> : null}
    </Etape>
  );
}

function Problemes({ issues }: { issues: readonly WorkImportIssue[] }): React.ReactElement | null {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {issues.map((i, k) => (
        <li
          key={k}
          className={`text-xs ${i.severity === 'error' ? 'font-medium text-[var(--danger)]' : 'text-[var(--foreground)]'}`}
        >
          <span className="font-semibold">
            {i.severity === 'error' ? 'Erreur' : 'À vérifier'} ·{' '}
          </span>
          {i.column ? <span className="font-medium">{i.column} — </span> : null}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function LigneApercu({
  r,
  issues,
}: {
  r: WorkImportRowView;
  issues: readonly WorkImportIssue[];
}): React.ReactElement {
  const ton = !r.valid ? 'late' : issues.length > 0 ? 'wait' : 'ok';
  const libelle = !r.valid ? 'Écartée' : issues.length > 0 ? 'Corrigée' : 'Prête';
  return (
    <tr className={`align-top ${!r.valid ? 'bg-[var(--danger-bg)]' : ''}`}>
      <td className="px-3 py-2 text-xs tabular-nums text-[var(--foreground-muted)]">{r.row}</td>
      <td className="px-2 py-2">
        <StatusPill tone={ton}>{libelle}</StatusPill>
      </td>
      <td className="min-w-[12rem] px-2 py-2">
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {r.parentRow !== null ? (
              <span className="text-[var(--foreground-muted)]">↳ </span>
            ) : null}
            {r.title || <em className="text-[var(--foreground-muted)]">(sans nom)</em>}
            {r.isMilestone ? (
              <span className="ml-1.5 rounded-full border border-[var(--border)] px-1.5 text-[0.7rem] font-medium text-[var(--foreground-muted)]">
                Jalon
              </span>
            ) : null}
          </span>
          <Problemes issues={issues} />
        </span>
      </td>
      <td className="px-2 py-2 text-xs">{r.section ?? '—'}</td>
      <td className="px-2 py-2 text-xs">{r.assignee?.name ?? '—'}</td>
      <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums">
        {r.startDate ? formatJour(r.startDate) : '—'}
        <span aria-hidden="true"> → </span>
        <span className="sr-only"> au </span>
        {r.dueDate ? formatJour(r.dueDate) : '—'}
      </td>
      <td className="px-2 py-2 text-xs">
        {r.priority === 'none' ? '—' : PRIORITES[r.priority].label}
      </td>
      <td className="px-2 py-2 text-xs tabular-nums">
        {r.dependsOn.length ? r.dependsOn.map((d) => `L${d}`).join(', ') : '—'}
      </td>
      <td className="px-3 py-2 text-xs tabular-nums">{heures(r.estimateMinutes)}</td>
    </tr>
  );
}

function Apercu({ p }: { p: WorkImportPreview }): React.ReactElement {
  const [aVerifier, setAVerifier] = useState(p.counts.invalid + p.counts.warnings > 0);
  const parLigne = useMemo(() => problemesParLigne(p.issues), [p.issues]);
  const fichier = parLigne.get(null) ?? [];
  const lignes = aVerifier
    ? p.rows.filter((r) => !r.valid || (parLigne.get(r.row)?.length ?? 0) > 0)
    : p.rows;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Compteurs de l’aperçu">
        {compteursApercu(p).map((c) => (
          <li key={c.id} className={`${CARTE} flex flex-col gap-0.5 px-3 py-2`}>
            <span className="text-xs text-[var(--foreground-muted)]">{c.libelle}</span>
            <span
              className={`font-mono text-lg font-medium tabular-nums ${c.alerte ? 'text-[var(--danger)]' : ''}`}
            >
              {c.valeur}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <span className="font-medium">Sera créé : </span>
        {phraseApercu(p)}
      </p>
      {p.ignoredColumns.length > 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Colonnes ignorées (inconnues du modèle) : {p.ignoredColumns.join(', ')}.
        </p>
      ) : null}
      {fichier.length > 0 ? (
        <Alerte>
          {fichier.map((i, k) => (
            <p key={k}>{i.message}</p>
          ))}
        </Alerte>
      ) : null}
      {p.rows.length > 0 ? (
        <>
          <Checkbox
            checked={aVerifier}
            onChange={setAVerifier}
            label={`Seulement les lignes à vérifier (${p.counts.invalid} en erreur, ${p.counts.warnings} avertissements)`}
          />
          <div className={`${CARTE} min-w-0 overflow-x-auto`}>
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Aperçu des lignes du fichier</caption>
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left text-xs font-medium text-[var(--foreground-muted)]">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ligne
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    État
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Tâche et problèmes
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Section
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Responsable
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Dates
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Priorité
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Dépend de
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Estimation
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {lignes.map((r) => (
                  <LigneApercu key={r.row} r={r} issues={parLigne.get(r.row) ?? []} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Resultat({
  r,
  nouveau,
}: {
  r: WorkPlanApplyResult;
  nouveau: boolean;
}): React.ReactElement {
  const lignes = [
    `${r.createdTasks} tâche${r.createdTasks > 1 ? 's' : ''}${r.createdSubtasks ? ` et ${r.createdSubtasks} sous-tâche${r.createdSubtasks > 1 ? 's' : ''}` : ''}`,
    r.createdMilestones
      ? `dont ${r.createdMilestones} jalon${r.createdMilestones > 1 ? 's' : ''}`
      : null,
    r.createdDependencies
      ? `${r.createdDependencies} dépendance${r.createdDependencies > 1 ? 's' : ''}`
      : null,
    r.createdColumns.length ? `sections ajoutées : ${r.createdColumns.join(', ')}` : null,
    r.createdLabels.length ? `étiquettes créées : ${r.createdLabels.join(', ')}` : null,
  ].filter((x): x is string => x !== null);
  return (
    <section className={`${CARTE} flex flex-col gap-3 p-5`} role="status">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-[var(--ok)]" />
        {nouveau
          ? `Projet « ${r.projectName} » créé`
          : `Tâches importées dans « ${r.projectName} »`}
      </h2>
      <ul className="list-disc pl-5 text-sm">
        {lignes.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {r.warnings.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium">À vérifier :</p>
          <ul className="list-disc pl-5 text-[var(--foreground-muted)]">
            {r.warnings.slice(0, 10).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href={hrefProjet(r.projectId)} className={buttonClasses('primary', 'md')}>
          Ouvrir le projet
        </Link>
        <Link href="/projets" className={buttonClasses('secondary', 'md')}>
          Tous les projets
        </Link>
      </div>
    </section>
  );
}

interface FormProjet {
  name: string;
  kind: 'client' | 'internal';
  ownerUserId: string;
  startDate: string;
  dueDate: string;
}

export function ImportFichier(): React.ReactElement {
  const params = useSearchParams();
  const projectId = params.get('projet');
  const { actions } = useShell();
  const autorise = projectId ? peutTravailler(actions) : peutGerer(actions);
  const [projet, setProjet] = useState<WorkProjectView | null>(null);
  const [membres, setMembres] = useState<WorkMemberOption[]>([]);
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<WorkImportPreview | null>(null);
  const [lecture, setLecture] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [confirme, setConfirme] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<WorkPlanApplyResult | null>(null);
  const [f, setF] = useState<FormProjet>({
    name: '',
    kind: 'internal',
    ownerUserId: '',
    startDate: '',
    dueDate: '',
  });
  const [champs, setChamps] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectId) {
      workApi
        .getProject(projectId)
        .then(setProjet)
        .catch((err: unknown) => setErreur(messagePlan(err, 'Projet introuvable.')));
    } else {
      workApi
        .listMembers()
        .then((r) => setMembres(r.filter((m) => m.canUpdate)))
        .catch(() => setMembres([]));
    }
  }, [projectId]);

  async function choisir(file: File | null): Promise<void> {
    setErreur(null);
    setApercu(null);
    setConfirme(false);
    setFichier(file);
    if (!file) return;
    const refus = fichierRefuse(file);
    if (refus) {
      setErreur(refus);
      return;
    }
    if (!projectId && f.name.trim() === '') {
      setF((x) => ({
        ...x,
        name: file.name
          .replace(/\.(xlsx|csv)$/i, '')
          .replace(/[-_]+/g, ' ')
          .trim()
          .slice(0, 120),
      }));
    }
    setLecture(true);
    try {
      setApercu(await workPlanApi.previewImport(file, projectId ?? undefined));
    } catch (err) {
      setErreur(messagePlan(err, 'Lecture du fichier impossible.'));
    } finally {
      setLecture(false);
    }
  }

  async function importer(): Promise<void> {
    if (!fichier || !apercu) return;
    const b = boutonImport(apercu);
    if (b.confirmer && !confirme) {
      setErreur('Cochez la confirmation : les lignes en erreur seront écartées.');
      return;
    }
    if (!projectId) {
      const c: Record<string, string> = {};
      if (f.name.trim() === '') c['name'] = 'Nom du projet obligatoire.';
      if (f.startDate && f.dueDate && f.dueDate < f.startDate)
        c['dueDate'] = 'L’échéance précède le début.';
      setChamps(c);
      if (Object.keys(c).length > 0) return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const r = projectId
        ? await workPlanApi.importIntoProject(projectId, fichier, b.confirmer)
        : await workPlanApi.importNewProject(
            fichier,
            {
              name: f.name.trim(),
              kind: f.kind,
              ...(f.ownerUserId ? { ownerUserId: f.ownerUserId } : {}),
              ...(f.startDate ? { startDate: f.startDate } : {}),
              ...(f.dueDate ? { dueDate: f.dueDate } : {}),
            },
            b.confirmer,
          );
      setResultat(r);
    } catch (err) {
      setErreur(messagePlan(err, 'Import impossible : rien n’a été créé.'));
    } finally {
      setEnvoi(false);
    }
  }

  if (!autorise) {
    return (
      <EmptyState
        title="Import non ouvert à votre rôle"
        description={
          projectId
            ? 'Importer des tâches demande le droit de travailler sur les projets.'
            : 'Créer un projet depuis un fichier demande le droit de gérer les projets.'
        }
      />
    );
  }

  const titre = projectId ? 'Importer des tâches' : 'Nouveau projet depuis un fichier';
  const b = apercu ? boutonImport(apercu) : null;

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title={titre}
        description={
          projectId
            ? `Ajoutez au projet « ${projet?.name ?? '…'} » les tâches d’un fichier Excel ou CSV : aperçu d’abord, rien n’est créé sans votre accord.`
            : 'Créez un projet et toutes ses tâches depuis un fichier Excel ou CSV : aperçu d’abord, rien n’est créé sans votre accord.'
        }
        actions={
          <Link
            href={projectId ? hrefProjet(projectId) : '/projets'}
            className={buttonClasses('secondary', 'md')}
          >
            Annuler
          </Link>
        }
      />

      {resultat ? (
        <Resultat r={resultat} nouveau={!projectId} />
      ) : (
        <>
          <Modele />
          <Etape n={2} titre="Choisissez le fichier">
            <label
              htmlFor="imp-fichier"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] px-4 py-6 text-center transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]"
            >
              {fichier ? (
                <FileSpreadsheet aria-hidden="true" className="h-6 w-6 text-[var(--accent)]" />
              ) : (
                <Upload aria-hidden="true" className="h-6 w-6 text-[var(--foreground-muted)]" />
              )}
              <span className="text-sm font-medium">
                {fichier ? fichier.name : 'Cliquez pour choisir un fichier .xlsx ou .csv'}
              </span>
              <span className="text-xs text-[var(--foreground-muted)]">
                2 Mo et 2 000 lignes au plus
              </span>
            </label>
            <input
              ref={input}
              id="imp-fichier"
              type="file"
              accept={FORMATS_ACCEPTES}
              className="sr-only"
              onChange={(e) => void choisir(e.target.files?.[0] ?? null)}
            />
            {fichier && !lecture ? (
              <Button size="sm" className="self-start" onClick={() => input.current?.click()}>
                Choisir un autre fichier
              </Button>
            ) : null}
            {lecture ? (
              <p className="text-sm text-[var(--foreground-muted)]" role="status">
                Lecture du fichier…
              </p>
            ) : null}
          </Etape>

          {apercu ? (
            <Etape n={3} titre="Vérifiez l’aperçu, puis importez">
              <Apercu p={apercu} />
              {!projectId ? (
                <div className="border-t border-[var(--border)] pt-3">
                  <FormGrid>
                    <Field
                      id="imp-nom"
                      label="Nom du projet"
                      required
                      size="lg"
                      error={champs['name']}
                    >
                      <TextInput
                        value={f.name}
                        maxLength={120}
                        onChange={(e) => setF({ ...f, name: e.target.value })}
                      />
                    </Field>
                    <Field
                      id="imp-resp"
                      label="Responsable du projet"
                      optional
                      size="md"
                      newRow
                      hint="Tapez pour chercher parmi les membres qui peuvent travailler sur les projets."
                    >
                      <EntityPicker<WorkMemberOption>
                        value={membres.find((m) => m.userId === f.ownerUserId) ?? null}
                        onChange={(m) => setF({ ...f, ownerUserId: m?.userId ?? '' })}
                        search={async (q) =>
                          membres.filter((m) => correspondRecherche([m.name], q))
                        }
                        refreshKey={membres.length}
                        getKey={(m) => m.userId}
                        getLabel={(m) => m.name}
                        placeholder="Aucun pour l’instant"
                        debounceMs={0}
                        emptyText="Aucun membre ne correspond."
                      />
                    </Field>
                    <Field id="imp-nature" label="Nature" group size="md">
                      <SegmentedControl<FormProjet['kind']>
                        value={f.kind}
                        onChange={(k) => setF({ ...f, kind: k })}
                        options={(['internal', 'client'] as const).map((k) => ({
                          value: k,
                          label: NATURES_PROJET[k],
                        }))}
                      />
                    </Field>
                    <Field id="imp-debut" label="Début" optional size="sm" newRow>
                      <DatePicker
                        value={f.startDate}
                        onChange={(v) => setF({ ...f, startDate: v })}
                        shortcuts={['today']}
                      />
                    </Field>
                    <Field
                      id="imp-fin"
                      label="Échéance"
                      optional
                      size="sm"
                      error={champs['dueDate']}
                    >
                      <DatePicker
                        value={f.dueDate}
                        onChange={(v) => setF({ ...f, dueDate: v })}
                        shortcuts={['endOfMonth', 'plus30', 'endOfYear']}
                      />
                    </Field>
                  </FormGrid>
                </div>
              ) : null}
              {b?.confirmer ? (
                <Checkbox
                  checked={confirme}
                  onChange={setConfirme}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-3"
                  label={`J’importe les ${apercu.counts.valid} lignes valides et j’écarte les ${apercu.counts.invalid} lignes en erreur (ou je corrige le fichier et je le choisis de nouveau).`}
                />
              ) : null}
              {erreur ? (
                <Alerte>
                  <p>{erreur}</p>
                </Alerte>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  busy={envoi}
                  disabled={!b?.actif || (b.confirmer && !confirme)}
                  onClick={() => void importer()}
                  className="max-sm:h-11"
                >
                  {envoi ? 'Import en cours…' : (b?.libelle ?? 'Importer')}
                </Button>
              </div>
            </Etape>
          ) : erreur ? (
            <Alerte>
              <p>{erreur}</p>
            </Alerte>
          ) : null}
        </>
      )}
    </section>
  );
}
