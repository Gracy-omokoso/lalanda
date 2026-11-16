'use client';

// Statut déclaré du projet — ADR-0076 § 5, bloc de l'Aperçu. Le chef de projet, son
// adjoint (ou un gestionnaire) publie « Dans les temps / À risque / En retard /
// Terminé », un texte et une date ; l'historique suit. Affiché à côté de la santé
// calculée, sans la remplacer. Formulaire du kit `@lalanda/ui` (ADR-0074).

import type { WorkProjectStatusValue, WorkProjectStatusView } from '@lalanda/shared/work';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Field,
  FormGrid,
  SegmentedControl,
  StatusPill,
  SubmitButton,
  TextArea,
} from '@lalanda/ui';
import { useEffect, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { useProjet } from './project-context';
import { messageWork } from './projets-model';
import { OPTIONS_STATUT, TONS_STATUT, corpsStatut, resumeStatut } from './statut-model';

export function StatutDeclare(): React.ReactElement | null {
  const { project, gererProjet, setProject, recharger } = useProjet();
  const [historique, setHistorique] = useState<WorkProjectStatusView[] | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [voirHistorique, setVoirHistorique] = useState(false);
  const [f, setF] = useState<{ status: WorkProjectStatusValue; text: string; date: string }>({
    status: 'on_track',
    text: '',
    date: '',
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurTexte, setErreurTexte] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const projectId = project?.id ?? null;

  useEffect(() => {
    if (!voirHistorique || projectId === null) return;
    let annule = false;
    workApi
      .listProjectStatusUpdates(projectId)
      .then((h) => {
        if (!annule) setHistorique(h);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageWork(err, 'Historique des statuts illisible.'));
      });
    return () => {
      annule = true;
    };
  }, [voirHistorique, projectId]);

  if (project === null) return null;
  const dernier = project.latestStatus ?? null;
  const publiable = gererProjet && project.status !== 'archived';
  if (dernier === null && !publiable) return null;

  async function publier(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const corps = corpsStatut(f);
    if (corps === null) {
      setErreurTexte('Écrivez où en est le projet.');
      return;
    }
    setErreurTexte(null);
    setErreur(null);
    setEnvoi(true);
    try {
      const s = await workApi.postProjectStatus(project!.id, corps);
      setProject({ ...project!, latestStatus: s });
      setHistorique((h) => (h ? [s, ...h] : h));
      setF({ status: f.status, text: '', date: '' });
      setOuvert(false);
      recharger();
    } catch (err) {
      setErreur(messageWork(err, 'Le statut n’a pas pu être publié.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Card as="section" className="flex min-w-0 flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Statut déclaré</h2>
      {erreur ? (
        <Alert tone="danger">
          <p>{erreur}</p>
        </Alert>
      ) : null}
      {dernier ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={TONS_STATUT[dernier.status]}>
              {OPTIONS_STATUT.find((o) => o.value === dernier.status)?.label}
            </StatusPill>
            <span className="text-xs text-[var(--foreground-muted)]">{resumeStatut(dernier)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">{dernier.text}</p>
        </div>
      ) : (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucun statut publié. Le chef de projet dit ici où en est le projet ; la santé calculée
          reste affichée à côté.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {publiable && !ouvert ? (
          <Button size="sm" variant="primary" onClick={() => setOuvert(true)}>
            Publier un statut
          </Button>
        ) : null}
        {dernier ? (
          <Button size="sm" onClick={() => setVoirHistorique((v) => !v)}>
            {voirHistorique ? 'Masquer l’historique' : 'Historique'}
          </Button>
        ) : null}
      </div>
      {ouvert ? (
        <form onSubmit={(e) => void publier(e)}>
          <fieldset disabled={envoi} className="flex min-w-0 flex-col gap-3">
            <FormGrid>
              <Field id="statut-valeur" label="Statut" group size="full">
                <SegmentedControl<WorkProjectStatusValue>
                  value={f.status}
                  onChange={(v) => setF({ ...f, status: v })}
                  options={OPTIONS_STATUT}
                />
              </Field>
              <Field
                id="statut-texte"
                label="Où en est le projet ?"
                required
                size="full"
                {...(erreurTexte ? { error: erreurTexte } : {})}
              >
                <TextArea
                  rows={3}
                  maxLength={2000}
                  value={f.text}
                  onChange={(e) => setF({ ...f, text: e.target.value })}
                />
              </Field>
              <Field id="statut-date" label="Date" optional size="sm" hint="Aujourd’hui si vide.">
                <DatePicker
                  value={f.date}
                  onChange={(v) => setF({ ...f, date: v })}
                  shortcuts={['today']}
                />
              </Field>
            </FormGrid>
            <div className="flex flex-wrap gap-2">
              <SubmitButton busy={envoi} showShortcut={false}>
                Publier
              </SubmitButton>
              <Button onClick={() => setOuvert(false)}>Annuler</Button>
            </div>
            <p className="text-xs text-[var(--foreground-muted)]">
              Les membres du projet sont prévenus selon leurs préférences de notification.
            </p>
          </fieldset>
        </form>
      ) : null}
      {voirHistorique ? (
        historique === null ? (
          <p className="text-xs text-[var(--foreground-muted)]">Chargement…</p>
        ) : (
          <ol className="flex flex-col gap-2 border-t border-[var(--border)] pt-2">
            {historique.map((s) => (
              <li key={s.id} className="flex flex-col gap-0.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={TONS_STATUT[s.status]}>
                    {OPTIONS_STATUT.find((o) => o.value === s.status)?.label}
                  </StatusPill>
                  <span className="text-xs text-[var(--foreground-muted)]">{resumeStatut(s)}</span>
                </span>
                <span className="whitespace-pre-wrap break-words">{s.text}</span>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </Card>
  );
}
