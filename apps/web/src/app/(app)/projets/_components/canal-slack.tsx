'use client';

// Canal Slack d'un projet — ADR-0064 § 3. Bloc de l'onglet « Réglages » (`work.manage`).
//
// Le canal (public) reçoit les événements du projet : assignations, déplacements de
// tâche, alerte « projet à risque ». Choisi dans la liste des canaux publics de l'espace
// Slack, ou saisi (identifiant `C…`). Un projet PRIVÉ exige une confirmation explicite :
// tout le canal verra ses événements.

import type { SlackChannelOption, WorkProjectSlackChannelView } from '@lalanda/shared/work';
import { Button, Checkbox, Field, FormGrid, Select, StatusPill, TextInput } from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { Alerte } from './elements';
import { etatCanalSlack, valeurCanalSaisi } from './canal-slack-model';
import { messageWork } from './projets-model';

export function CanalSlack({ projectId }: { projectId: string }): React.ReactElement | null {
  const id = useId();
  const [vue, setVue] = useState<WorkProjectSlackChannelView | null>(null);
  const [canaux, setCanaux] = useState<SlackChannelOption[] | null>(null);
  const [choix, setChoix] = useState('');
  const [saisie, setSaisie] = useState('');
  const [confirme, setConfirme] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    workApi
      .getProjectSlackChannel(projectId)
      .then((v) => {
        setVue(v);
        if (v.connected && v.canManage) {
          workApi
            .listSlackChannels()
            .then((r) => setCanaux(r.items))
            .catch(() => setCanaux([]));
        }
      })
      .catch(() => setVue(null));
  }, [projectId]);

  if (vue === null) return null;

  async function enregistrer(channelId: string | null, channelName?: string): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      setVue(
        await workApi.putProjectSlackChannel(projectId, {
          channelId,
          ...(channelName ? { channelName } : {}),
          ...(vue?.projectPrivate ? { confirmPrivate: confirme } : {}),
        }),
      );
      setChoix('');
      setSaisie('');
    } catch (err) {
      setErreur(messageWork(err, 'Canal non enregistré.'));
    } finally {
      setEnvoi(false);
    }
  }

  const etat = etatCanalSlack(vue);
  const choisi = canaux?.find((c) => c.id === choix) ?? null;
  const saisi = valeurCanalSaisi(saisie);
  const cible = choisi?.id ?? saisi;

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Canal Slack</h2>
        <StatusPill tone={etat.ton}>{etat.libelle}</StatusPill>
      </header>
      {!vue.connected ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          L’espace Slack de l’organisation n’est pas connecté. La direction le connecte dans Projets
          › Paramètres › Slack.
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--foreground-muted)]">
            Le canal reçoit les événements du projet : tâches assignées et déplacées, projet à
            risque. Chaque membre garde en plus ses messages privés selon ses préférences.
          </p>
          {vue.channel ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                Publie dans <strong>#{vue.channel.name ?? vue.channel.id}</strong>
              </span>
              <Button size="sm" disabled={envoi} onClick={() => void enregistrer(null)}>
                Retirer le canal
              </Button>
            </div>
          ) : null}
          {etat.avertissement ? (
            <p className="text-sm text-[var(--foreground-muted)]">{etat.avertissement}</p>
          ) : null}
          <FormGrid>
            <Field id={`${id}-liste`} label="Canal public" size="md">
              <Select<string>
                value={choix}
                loading={canaux === null}
                disabled={canaux !== null && canaux.length === 0}
                placeholder={canaux === null ? 'Chargement…' : 'Choisir un canal'}
                emptyText="Aucun canal public."
                onChange={(v) => {
                  setChoix(v);
                  setSaisie('');
                }}
                options={(canaux ?? []).map((c) => ({ value: c.id, label: `#${c.name}` }))}
              />
            </Field>
            <Field id={`${id}-saisie`} label="Ou identifiant du canal" size="sm">
              <TextInput
                placeholder="C0123456789"
                className="font-mono"
                value={saisie}
                onChange={(e) => {
                  setSaisie(e.target.value);
                  setChoix('');
                }}
              />
            </Field>
          </FormGrid>
          {vue.projectPrivate ? (
            <Checkbox
              checked={confirme}
              onChange={setConfirme}
              label={
                <span>
                  Ce projet est <strong>privé</strong>. Je confirme que{' '}
                  <strong>tout le canal</strong> verra ses événements (titres des tâches et du
                  projet), y compris des personnes qui ne sont pas membres du projet.
                </span>
              }
            />
          ) : null}
          <div>
            <Button
              variant="primary"
              size="sm"
              busy={envoi}
              disabled={!cible || (vue.projectPrivate && !confirme)}
              onClick={() => void enregistrer(cible, choisi?.name)}
              className="max-sm:h-11 max-sm:w-full"
            >
              Publier dans ce canal
            </Button>
          </div>
        </>
      )}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </section>
  );
}
