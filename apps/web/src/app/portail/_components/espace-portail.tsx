'use client';

// Espace externe — ADR-0078 : projets, tâches visibles, commentaires partagés,
// validation des livrables (contact client), temps sur ses tâches et semaine (consultant).
// Aucun montant, aucune marge, aucun coût n'est affiché (l'API n'en rend aucun).

import type {
  PortalMeView,
  PortalProjectSummary,
  PortalProjectView,
  PortalTaskView,
  PortalTimesheetView,
} from '@lalanda/shared/work';
import {
  Alert,
  Button,
  DatePicker,
  Field,
  FormGrid,
  StatusPill,
  TextArea,
  TextInput,
} from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import { detailPortail, portalApi, sessionTerminee } from '@/lib/portal-api';

import { duree, etatValidationClient, minutesDe } from '@/lib/externes-model';

const ETAPES: Record<string, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  done: 'Terminé',
};

function jour(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Charge une ressource du portail ; 401 → retour à la connexion. */
function usePortail<T>(
  charger: () => Promise<T>,
  cle: string,
): {
  donnee: T | null;
  erreur: string | null;
  recharger: () => void;
} {
  const router = useRouter();
  const [donnee, setDonnee] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let annule = false;
    charger()
      .then((d) => {
        if (!annule) {
          setDonnee(d);
          setErreur(null);
        }
      })
      .catch((err: unknown) => {
        if (annule) return;
        if (sessionTerminee(err)) router.replace('/portail');
        else setErreur(detailPortail(err).message ?? 'Contenu indisponible.');
      });
    return () => {
      annule = true;
    };
    // `charger` change à chaque rendu : la clé décide du rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, version, router]);
  return { donnee, erreur, recharger: useCallback(() => setVersion((v) => v + 1), []) };
}

/** En-tête : qui est connecté, liens, déconnexion. */
export function EntetePortail({ me }: { me: PortalMeView | null }): React.ReactElement {
  const router = useRouter();
  async function sortir(): Promise<void> {
    try {
      await portalApi.logout();
    } finally {
      router.replace('/portail');
    }
  }
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm">
        {me ? (
          <>
            <span className="font-medium">{me.name}</span>
            <span className="text-[var(--foreground-muted)]">
              {' '}
              · {me.kind === 'client' ? 'Contact client' : 'Consultant'} · {me.organizationName}
            </span>
          </>
        ) : null}
      </div>
      <nav className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/portail/projets" className="underline-offset-2 hover:underline">
          Mes projets
        </Link>
        {me?.kind === 'consultant' ? (
          <Link href="/portail/temps" className="underline-offset-2 hover:underline">
            Ma feuille de temps
          </Link>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => void sortir()}>
          Se déconnecter
        </Button>
      </nav>
    </div>
  );
}

function useMe(): PortalMeView | null {
  return usePortail(() => portalApi.me(), 'me').donnee;
}

// ── Liste des projets ───────────────────────────────────────────────────────

export function ProjetsPortail(): React.ReactElement {
  const me = useMe();
  const { donnee, erreur } = usePortail(() => portalApi.projects(), 'projets');
  return (
    <>
      <EntetePortail me={me} />
      <h1 className="mb-4 text-xl font-semibold">Mes projets</h1>
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      {donnee && donnee.items.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucun projet ne vous est ouvert.</p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {(donnee?.items ?? []).map((p: PortalProjectSummary) => (
          <li key={p.id}>
            <Link
              href={`/portail/projets/${p.id}`}
              className="flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)]"
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-[var(--foreground-muted)]">
                Chef de projet : {p.leadName ?? '—'} · échéance {jour(p.dueDate)}
              </span>
              <span className="text-xs">
                {p.doneTaskCount}/{p.taskCount} tâche{p.taskCount > 1 ? 's' : ''} terminée
                {p.doneTaskCount > 1 ? 's' : ''}
                {p.pendingClientApprovals > 0
                  ? ` · ${p.pendingClientApprovals} livrable${p.pendingClientApprovals > 1 ? 's' : ''} à valider`
                  : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Un projet ───────────────────────────────────────────────────────────────

export function ProjetPortail({ projectId }: { projectId: string }): React.ReactElement {
  const me = useMe();
  const { donnee, erreur, recharger } = usePortail<PortalProjectView>(
    () => portalApi.project(projectId),
    `projet:${projectId}`,
  );
  const [tache, setTache] = useState<string | null>(null);
  return (
    <>
      <EntetePortail me={me} />
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      {donnee ? (
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold">{donnee.project.name}</h1>
            <p className="text-sm text-[var(--foreground-muted)]">
              Chef de projet : {donnee.project.leadName ?? '—'} · du{' '}
              {jour(donnee.project.startDate)} au {jour(donnee.project.dueDate)}
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
              {donnee.tasks.length === 0 ? (
                <li className="px-3 py-3 text-sm text-[var(--foreground-muted)]">
                  Aucune tâche ne vous est encore partagée.
                </li>
              ) : null}
              {donnee.tasks.map((t) => {
                const etat = etatValidationClient(t.clientApproval.state);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTache(t.id)}
                      aria-pressed={tache === t.id}
                      className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm ${tache === t.id ? 'bg-[var(--accent-soft)]' : ''}`}
                    >
                      <span className="font-medium">
                        {t.isMilestone ? '◆ ' : ''}
                        {t.title}
                        {t.mine ? (
                          <span className="ml-2 text-xs text-[var(--accent)]">ma tâche</span>
                        ) : null}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--foreground-muted)]">
                        {ETAPES[t.stage] ?? t.stage} · échéance {jour(t.dueDate)}
                        {t.clientApproval.required ? (
                          <StatusPill tone={etat.ton}>{etat.libelle}</StatusPill>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {tache ? (
              <TachePortail
                key={tache}
                taskId={tache}
                kind={me?.kind ?? 'client'}
                onChange={recharger}
              />
            ) : (
              <p className="text-sm text-[var(--foreground-muted)]">
                Choisissez une tâche pour voir ses échanges.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── Une tâche ───────────────────────────────────────────────────────────────

function TachePortail({
  taskId,
  kind,
  onChange,
}: {
  taskId: string;
  kind: 'client' | 'consultant';
  onChange: () => void;
}): React.ReactElement {
  const id = useId();
  const { donnee, erreur, recharger } = usePortail<PortalTaskView>(
    () => portalApi.task(taskId),
    `tache:${taskId}`,
  );
  const [texte, setTexte] = useState('');
  const [motif, setMotif] = useState('');
  const [jourTravaille, setJourTravaille] = useState('');
  const [heures, setHeures] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function geste(p: () => Promise<unknown>, ok?: string): Promise<boolean> {
    setEnvoi(true);
    setMessage(null);
    try {
      await p();
      if (ok) setMessage(ok);
      recharger();
      onChange();
      return true;
    } catch (err) {
      setMessage(detailPortail(err).message ?? 'Le geste n’a pas abouti.');
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  if (erreur) return <Alert tone="danger">{erreur}</Alert>;
  if (!donnee) return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  const t = donnee.task;
  const etat = etatValidationClient(donnee.clientApproval.state);
  const minutes = minutesDe(heures);

  return (
    <section
      aria-labelledby={`${id}-titre`}
      className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div>
        <h2 id={`${id}-titre`} className="text-base font-semibold">
          #{t.number} {t.title}
        </h2>
        <p className="text-xs text-[var(--foreground-muted)]">
          {ETAPES[t.stage] ?? t.stage} · échéance {jour(t.dueDate)}
        </p>
        {donnee.description ? (
          <p className="mt-2 whitespace-pre-wrap text-sm">{donnee.description}</p>
        ) : null}
      </div>
      {message ? <Alert tone="info">{message}</Alert> : null}

      {donnee.clientApproval.required ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Validation du livrable</span>
            <StatusPill tone={etat.ton}>{etat.libelle}</StatusPill>
          </div>
          {donnee.clientApproval.reason ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Motif : « {donnee.clientApproval.reason} »
            </p>
          ) : null}
          {donnee.canDecide ? (
            <>
              <Field
                id={`${id}-motif`}
                label="Modifications demandées"
                size="full"
                hint="Obligatoire pour demander des modifications."
              >
                <TextArea
                  rows={2}
                  maxLength={500}
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  busy={envoi}
                  onClick={() =>
                    void geste(
                      () =>
                        portalApi.decide(taskId, {
                          expectedRevision: t.revision,
                          decision: 'approve',
                        }),
                      'Livrable approuvé. Merci.',
                    )
                  }
                >
                  Approuver
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={envoi || motif.trim() === ''}
                  onClick={() =>
                    void geste(
                      () =>
                        portalApi.decide(taskId, {
                          expectedRevision: t.revision,
                          decision: 'request_changes',
                          reason: motif.trim(),
                        }),
                      'Votre demande de modifications est transmise à l’équipe.',
                    )
                  }
                >
                  Demander des modifications
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {kind === 'consultant' && donnee.canLogTime ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Mon temps sur cette tâche</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {donnee.timeEntries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span>
                  {jour(e.workedOn)} · {duree(e.minutes)}
                  {e.note ? (
                    <span className="text-[var(--foreground-muted)]"> — {e.note}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="text-xs text-[var(--danger)] underline-offset-2 hover:underline"
                  disabled={envoi}
                  onClick={() => void geste(() => portalApi.removeTime(e.id))}
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
          <form
            noValidate
            className="flex flex-col gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!jourTravaille || minutes === null) return;
              void geste(
                () =>
                  portalApi.logTime(taskId, {
                    workedOn: jourTravaille,
                    minutes,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  }),
                'Temps enregistré.',
              ).then((ok) => {
                if (ok) {
                  setHeures('');
                  setNote('');
                }
              });
            }}
          >
            <FormGrid>
              <Field id={`${id}-jour`} label="Jour" required size="sm">
                <DatePicker
                  value={jourTravaille}
                  onChange={setJourTravaille}
                  shortcuts={['today']}
                />
              </Field>
              <Field id={`${id}-heures`} label="Heures" required size="xs" hint="Ex. 1,5">
                <TextInput
                  inputMode="decimal"
                  value={heures}
                  onChange={(e) => setHeures(e.target.value)}
                />
              </Field>
              <Field id={`${id}-note`} label="Note" optional size="full">
                <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </FormGrid>
            <div>
              <Button
                type="submit"
                size="sm"
                busy={envoi}
                disabled={envoi || !jourTravaille || minutes === null}
              >
                Saisir le temps
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Échanges</h3>
        {donnee.comments.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucun échange pour l’instant.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {donnee.comments.map((c) => (
              <li key={c.id} className="text-sm">
                <p className="text-xs text-[var(--foreground-muted)]">
                  <span className="font-semibold text-[var(--foreground)]">{c.authorName}</span> ·{' '}
                  {new Date(c.createdAt).toLocaleString('fr-FR')}
                </p>
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
              </li>
            ))}
          </ol>
        )}
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (texte.trim() === '') return;
            void geste(() => portalApi.comment(taskId, texte.trim())).then((ok) => {
              if (ok) setTexte('');
            });
          }}
        >
          <Field
            id={`${id}-commentaire`}
            label="Votre message"
            size="full"
            hint="Visible de l’équipe du projet."
          >
            <TextArea
              rows={3}
              maxLength={10000}
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" size="sm" busy={envoi} disabled={envoi || texte.trim() === ''}>
              Envoyer
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

// ── Feuille de temps du consultant ──────────────────────────────────────────

function lundiDe(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const decalage = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - decalage * 86_400_000).toISOString().slice(0, 10);
}

function decaler(semaine: string, jours: number): string {
  return new Date(Date.parse(`${semaine}T00:00:00Z`) + jours * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const STATUTS: Record<string, string> = {
  open: 'En cours',
  submitted: 'Soumise',
  approved: 'Validée',
  returned: 'Renvoyée',
  reopened: 'Rouverte',
};

export function TempsPortail(): React.ReactElement {
  const me = useMe();
  const [semaine, setSemaine] = useState(() => lundiDe(new Date().toISOString().slice(0, 10)));
  const { donnee, erreur, recharger } = usePortail<PortalTimesheetView>(
    () => portalApi.timesheet(semaine),
    `temps:${semaine}`,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(): Promise<void> {
    if (!donnee) return;
    setEnvoi(true);
    setMessage(null);
    try {
      await portalApi.submitTimesheet(donnee.week, donnee.revision);
      setMessage('Semaine soumise à votre référent.');
      recharger();
    } catch (err) {
      setMessage(detailPortail(err).message ?? 'La soumission n’a pas abouti.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <EntetePortail me={me} />
      <h1 className="mb-4 text-xl font-semibold">Ma feuille de temps</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="secondary" onClick={() => setSemaine(decaler(semaine, -7))}>
          Semaine précédente
        </Button>
        <span className="font-medium">Semaine du {jour(semaine)}</span>
        <Button size="sm" variant="secondary" onClick={() => setSemaine(decaler(semaine, 7))}>
          Semaine suivante
        </Button>
      </div>
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      {message ? <Alert tone="info">{message}</Alert> : null}
      {donnee ? (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill
              tone={donnee.locked ? 'ok' : donnee.status === 'returned' ? 'late' : 'draft'}
            >
              {STATUTS[donnee.status] ?? donnee.status}
            </StatusPill>
            Total : {duree(donnee.totalMinutes)}
            {donnee.reason ? (
              <span className="text-[var(--foreground-muted)]"> — « {donnee.reason} »</span>
            ) : null}
          </p>
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-sm">
            {donnee.entries.length === 0 ? (
              <li className="px-3 py-3 text-[var(--foreground-muted)]">
                Aucune saisie cette semaine.
              </li>
            ) : null}
            {donnee.entries.map((e) => (
              <li key={e.id} className="flex justify-between gap-2 px-3 py-2">
                <span>
                  {jour(e.workedOn)} · #{e.taskNumber} {e.taskTitle}
                </span>
                <span>{duree(e.minutes)}</span>
              </li>
            ))}
          </ul>
          {donnee.canSubmit ? (
            <div>
              <Button busy={envoi} disabled={envoi} onClick={() => void soumettre()}>
                Soumettre la semaine
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
