'use client';

// « Construire avec l'IA » (ADR-0063) : un formulaire, une PROPOSITION de plan
// Scrum/Agile par l'IA (jalons, sprints, tâches), un écran de RELECTURE où l'on
// corrige titres, dates et responsables, retire des tâches, régénère (compte
// dans le quota IA) — puis « Créer le projet », par le même créateur que
// l'import de fichier. Rien n'est créé sans ce dernier clic.

import type { WorkAiPlanDraft, WorkPlanTask } from '@lalanda/shared/work';
import { EmptyState, PageHeader, buttonClasses } from '@lalanda/ui';
import { Flag, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { workApi, type WorkMemberOption } from '@/lib/work-api';
import { workPlanApi } from '@/lib/work-plan-api';

import { useShell } from '../../_components/shell-context';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from './elements';
import {
  NIVEAUX_DETAIL,
  corpsCreation,
  formulaireIa,
  groupesRelecture,
  heures,
  messagePlan,
  modifierTache,
  nombreSprints,
  preparerIa,
  retirerTache,
  type FormulaireIa,
} from './import-model';
import { PRIORITES, aujourdhui, formatJour, hrefProjet, peutGerer } from './projets-model';

const CARTE = 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]';
const PETIT_CHAMP =
  'w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm outline-none focus:border-[var(--accent)]';

function Formulaire({
  f,
  setF,
  membres,
  champs,
}: {
  f: FormulaireIa;
  setF: (f: FormulaireIa) => void;
  membres: WorkMemberOption[];
  champs: Record<string, string>;
}): React.ReactElement {
  const sprints = nombreSprints(f);
  const basculer = (id: string) =>
    setF({
      ...f,
      memberUserIds: f.memberUserIds.includes(id)
        ? f.memberUserIds.filter((m) => m !== id)
        : [...f.memberUserIds, id],
    });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Champ id="ia-nom" label="Nom du projet" requis erreur={champs['name']}>
        <input
          id="ia-nom"
          value={f.name}
          maxLength={120}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          className={CHAMP}
          {...aria('ia-nom', champs['name'])}
        />
      </Champ>
      <div className="grid grid-cols-2 gap-3">
        <Champ id="ia-debut" label="Date de début" requis erreur={champs['startDate']}>
          <input
            id="ia-debut"
            type="date"
            value={f.startDate}
            onChange={(e) => setF({ ...f, startDate: e.target.value })}
            className={CHAMP}
            {...aria('ia-debut', champs['startDate'])}
          />
        </Champ>
        <Champ id="ia-fin" label="Date butoir" requis erreur={champs['dueDate']}>
          <input
            id="ia-fin"
            type="date"
            value={f.dueDate}
            onChange={(e) => setF({ ...f, dueDate: e.target.value })}
            className={CHAMP}
            {...aria('ia-fin', champs['dueDate'])}
          />
        </Champ>
      </div>
      <div className="sm:col-span-2">
        <Champ
          id="ia-obj"
          label="Objectif"
          requis
          aide="Ce que le projet doit avoir accompli à la date butoir."
          erreur={champs['objective']}
        >
          <textarea
            id="ia-obj"
            rows={2}
            maxLength={2000}
            value={f.objective}
            onChange={(e) => setF({ ...f, objective: e.target.value })}
            className={CHAMP}
            {...aria('ia-obj', champs['objective'], true)}
          />
        </Champ>
      </div>
      <Champ id="ia-ctx" label="Contexte" aide="Qui, où, pour quel client ou quel besoin.">
        <textarea
          id="ia-ctx"
          rows={3}
          maxLength={2000}
          value={f.context}
          onChange={(e) => setF({ ...f, context: e.target.value })}
          className={CHAMP}
          {...aria('ia-ctx', undefined, true)}
        />
      </Champ>
      <Champ
        id="ia-liv"
        label="Livrables attendus"
        aide="Un par ligne ou séparés par des virgules."
      >
        <textarea
          id="ia-liv"
          rows={3}
          maxLength={2000}
          value={f.deliverables}
          onChange={(e) => setF({ ...f, deliverables: e.target.value })}
          className={CHAMP}
          {...aria('ia-liv', undefined, true)}
        />
      </Champ>
      <Champ
        id="ia-risques"
        label="Contraintes et risques"
        aide="Budget serré, délestages, fournisseurs, saison des pluies…"
      >
        <textarea
          id="ia-risques"
          rows={2}
          maxLength={2000}
          value={f.constraints}
          onChange={(e) => setF({ ...f, constraints: e.target.value })}
          className={CHAMP}
          {...aria('ia-risques', undefined, true)}
        />
      </Champ>
      <div className="grid grid-cols-2 gap-3">
        <Champ id="ia-sprint" label="Durée des sprints" erreur={champs['sprintWeeks']}>
          <select
            id="ia-sprint"
            value={f.sprintWeeks}
            onChange={(e) => setF({ ...f, sprintWeeks: Number(e.target.value) as 1 | 2 | 3 })}
            className={CHAMP}
            {...aria('ia-sprint', champs['sprintWeeks'])}
          >
            <option value={1}>1 semaine</option>
            <option value={2}>2 semaines</option>
            <option value={3}>3 semaines</option>
          </select>
        </Champ>
        <Champ id="ia-detail" label="Niveau de détail">
          <select
            id="ia-detail"
            value={f.detail}
            onChange={(e) => setF({ ...f, detail: e.target.value as FormulaireIa['detail'] })}
            className={CHAMP}
          >
            {(Object.keys(NIVEAUX_DETAIL) as FormulaireIa['detail'][]).map((k) => (
              <option key={k} value={k}>
                {NIVEAUX_DETAIL[k]}
              </option>
            ))}
          </select>
        </Champ>
        <p className="col-span-2 text-xs text-[var(--foreground-muted)]" aria-live="polite">
          {sprints > 0
            ? `${sprints} sprint${sprints > 1 ? 's' : ''} sur la période.`
            : 'Choisissez les deux dates pour voir les sprints.'}
        </p>
      </div>
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="text-sm font-medium">Équipe</legend>
        <p className="text-xs text-[var(--foreground-muted)]">
          L’IA propose un responsable parmi ces membres (elle ne voit que leur prénom, jamais leur
          e-mail).
        </p>
        <div className="flex flex-wrap gap-2">
          {membres.length === 0 ? (
            <span className="text-sm text-[var(--foreground-muted)]">
              Aucun membre ne peut travailler sur les projets.
            </span>
          ) : null}
          {membres.map((m) => {
            const choisi = f.memberUserIds.includes(m.userId);
            return (
              <label
                key={m.userId}
                className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${choisi ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--border)]'}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={choisi}
                  onChange={() => basculer(m.userId)}
                />
                <span aria-hidden="true">{choisi ? '✓' : '+'}</span>
                {m.name}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function LigneTache({
  t,
  membres,
  onChange,
  onRetirer,
}: {
  t: WorkPlanTask;
  membres: WorkMemberOption[];
  onChange: (patch: Partial<Pick<WorkPlanTask, 'title' | 'dueDate' | 'assigneeUserId'>>) => void;
  onRetirer: () => void;
}): React.ReactElement {
  const metier = (t.labels ?? []).filter((l) => !/^Sprint \d+$/.test(l));
  return (
    <li className="grid grid-cols-1 items-start gap-2 border-t border-[var(--border)] px-3 py-2 first:border-t-0 md:grid-cols-[minmax(0,1fr)_10rem_9.5rem_5rem_2rem]">
      <div className="flex min-w-0 flex-col gap-1">
        <label className="sr-only" htmlFor={`t-${t.ref}`}>
          Titre de {t.ref}
        </label>
        <input
          id={`t-${t.ref}`}
          value={t.title}
          maxLength={300}
          onChange={(e) => onChange({ title: e.target.value })}
          className={`${PETIT_CHAMP} font-medium`}
        />
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--foreground-muted)]">
          {t.description ? <span className="min-w-0">{t.description}</span> : null}
          {t.priority && t.priority !== 'none' ? (
            <span>· {PRIORITES[t.priority].label}</span>
          ) : null}
          {metier.length ? <span>· {metier.join(', ')}</span> : null}
          {t.dependsOn?.length ? <span>· attend {t.dependsOn.join(', ')}</span> : null}
          <span>· {t.ref}</span>
        </span>
      </div>
      <div>
        <label className="sr-only" htmlFor={`r-${t.ref}`}>
          Responsable de {t.ref}
        </label>
        <select
          id={`r-${t.ref}`}
          value={t.assigneeUserId ?? ''}
          onChange={(e) => onChange({ assigneeUserId: e.target.value || null })}
          className={PETIT_CHAMP}
        >
          <option value="">Sans responsable</option>
          {membres.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="sr-only" htmlFor={`d-${t.ref}`}>
          Échéance de {t.ref}
        </label>
        <input
          id={`d-${t.ref}`}
          type="date"
          value={t.dueDate ?? ''}
          onChange={(e) => onChange({ dueDate: e.target.value || null })}
          className={PETIT_CHAMP}
        />
      </div>
      <span className="pt-1.5 text-xs tabular-nums text-[var(--foreground-muted)]">
        {heures(t.estimateMinutes ?? null)}
      </span>
      <button
        type="button"
        onClick={onRetirer}
        className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--foreground-muted)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
        aria-label={`Retirer « ${t.title} »`}
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </button>
    </li>
  );
}

function Relecture({
  draft,
  tasks,
  setTasks,
  description,
  setDescription,
  membres,
}: {
  draft: WorkAiPlanDraft;
  tasks: WorkPlanTask[];
  setTasks: (t: WorkPlanTask[]) => void;
  description: string;
  setDescription: (d: string) => void;
  membres: WorkMemberOption[];
}): React.ReactElement {
  const g = useMemo(() => groupesRelecture(draft, tasks), [draft, tasks]);
  const maj = (ref: string, patch: Parameters<typeof modifierTache>[2]) =>
    setTasks(modifierTache(tasks, ref, patch));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={`${CARTE} flex flex-col gap-2 p-4`}>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--accent)]" />
          {draft.mention}
        </p>
        {draft.summary ? (
          <p className="text-sm text-[var(--foreground-muted)]">{draft.summary}</p>
        ) : null}
        {draft.corrections.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              {draft.corrections.length} correction{draft.corrections.length > 1 ? 's' : ''}{' '}
              apportée{draft.corrections.length > 1 ? 's' : ''} par Lalanda à la proposition
            </summary>
            <ul className="mt-1 list-disc pl-5 text-[var(--foreground-muted)]">
              {draft.corrections.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <Champ id="ia-desc" label="Description du projet">
          <textarea
            id="ia-desc"
            rows={4}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={CHAMP}
          />
        </Champ>
      </div>

      <section className={`${CARTE} overflow-hidden`} aria-labelledby="ia-jalons">
        <h2
          id="ia-jalons"
          className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-semibold"
        >
          <Flag aria-hidden="true" className="h-4 w-4" /> Jalons ({g.jalons.length})
        </h2>
        <ul>
          {g.jalons.map((t) => (
            <LigneTache
              key={t.ref}
              t={t}
              membres={membres}
              onChange={(p) => maj(t.ref, p)}
              onRetirer={() => setTasks(retirerTache(tasks, t.ref))}
            />
          ))}
          {g.jalons.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[var(--foreground-muted)]">Aucun jalon.</li>
          ) : null}
        </ul>
      </section>

      {g.sprints.map((s) => (
        <section key={s.label} className={`${CARTE} overflow-hidden`} aria-label={s.label}>
          <h2 className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm">
            <span className="font-semibold">{s.label}</span>
            <span className="tabular-nums text-[var(--foreground-muted)]">
              {formatJour(s.periode[0], false)} – {formatJour(s.periode[1], false)}
            </span>
            {s.goal ? <span className="text-[var(--foreground-muted)]">· {s.goal}</span> : null}
            <span className="ml-auto text-xs text-[var(--foreground-muted)]">
              {s.taches.length} tâche{s.taches.length > 1 ? 's' : ''}
            </span>
          </h2>
          <ul>
            {s.taches.map((t) => (
              <LigneTache
                key={t.ref}
                t={t}
                membres={membres}
                onChange={(p) => maj(t.ref, p)}
                onRetirer={() => setTasks(retirerTache(tasks, t.ref))}
              />
            ))}
            {s.taches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-[var(--foreground-muted)]">
                Aucune tâche dans ce sprint.
              </li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function IaConstruire(): React.ReactElement {
  const router = useRouter();
  const { actions } = useShell();
  const [f, setF] = useState<FormulaireIa>(() => formulaireIa(aujourdhui()));
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [membres, setMembres] = useState<WorkMemberOption[]>([]);
  const [draft, setDraft] = useState<WorkAiPlanDraft | null>(null);
  const [tasks, setTasks] = useState<WorkPlanTask[]>([]);
  const [description, setDescription] = useState('');
  const [attente, setAttente] = useState<'proposer' | 'creer' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    workApi
      .listMembers()
      .then((r) => setMembres(r.filter((m) => m.canUpdate)))
      .catch(() => setMembres([]));
  }, []);

  if (!peutGerer(actions)) {
    return (
      <EmptyState
        title="Construction par l’IA non ouverte à votre rôle"
        description="Créer un projet demande le droit de gérer les projets."
      />
    );
  }

  async function proposer(): Promise<void> {
    const p = preparerIa(f);
    if (!p.ok) {
      setChamps(p.champs);
      return;
    }
    setChamps({});
    setErreur(null);
    setAttente('proposer');
    try {
      const d = await workPlanApi.proposeAiPlan(p.corps);
      setDraft(d);
      setTasks(d.tasks);
      setDescription(d.description);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setErreur(messagePlan(err, 'La proposition n’a pas abouti.'));
    } finally {
      setAttente(null);
    }
  }

  async function creer(): Promise<void> {
    if (!draft) return;
    setErreur(null);
    setAttente('creer');
    try {
      const r = await workPlanApi.createFromPlan(corpsCreation(draft, f, description, tasks));
      router.push(hrefProjet(r.projectId));
    } catch (err) {
      setErreur(messagePlan(err, 'Création impossible : rien n’a été créé.'));
      setAttente(null);
    }
  }

  const relecture = draft !== null;
  const equipe = membres.filter((m) => f.memberUserIds.includes(m.userId));

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title={relecture ? `Relire le plan — ${f.name}` : 'Construire avec l’IA'}
        description={
          relecture
            ? 'Corrigez les titres, les dates et les responsables, retirez ce qui ne convient pas, puis créez le projet.'
            : 'Décrivez le projet : l’IA propose jalons, sprints et tâches. Vous relisez et décidez ; rien n’est créé sans votre accord.'
        }
        actions={
          <Link href="/projets" className={buttonClasses('secondary', 'md')}>
            Annuler
          </Link>
        }
      />

      {relecture ? (
        <Relecture
          draft={draft}
          tasks={tasks}
          setTasks={setTasks}
          description={description}
          setDescription={setDescription}
          membres={equipe.length ? equipe : membres}
        />
      ) : (
        <div className={`${CARTE} p-4`}>
          <Formulaire f={f} setF={setF} membres={membres} champs={champs} />
        </div>
      )}

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {attente === 'proposer' ? (
        <p role="status" className="text-sm text-[var(--foreground-muted)]">
          L’IA prépare un plan… cela prend en général 10 à 40 secondes.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {relecture ? (
          <>
            <button
              type="button"
              disabled={attente !== null || tasks.filter((t) => !t.isMilestone).length === 0}
              className={buttonClasses('primary', 'md')}
              onClick={() => void creer()}
            >
              {attente === 'creer' ? 'Création…' : `Créer le projet (${tasks.length} éléments)`}
            </button>
            <button
              type="button"
              disabled={attente !== null}
              className={buttonClasses('secondary', 'md')}
              onClick={() => void proposer()}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Régénérer
            </button>
            <button
              type="button"
              disabled={attente !== null}
              className={BOUTON_PETIT}
              onClick={() => setDraft(null)}
            >
              Modifier le formulaire
            </button>
            <span className="text-xs text-[var(--foreground-muted)]">
              Régénérer compte un message IA dans le quota du mois.
            </span>
          </>
        ) : (
          <button
            type="button"
            disabled={attente !== null}
            className={buttonClasses('primary', 'md')}
            onClick={() => void proposer()}
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            {attente === 'proposer' ? 'Proposition en cours…' : 'Proposer un plan'}
          </button>
        )}
      </div>
    </section>
  );
}
