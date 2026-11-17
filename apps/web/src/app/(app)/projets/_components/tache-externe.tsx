'use client';

// Réglages externes d'une tâche — ADR-0078 § 1.3, § 1.5 et § 2.
//
// « Visible par le client », « Validation client requise » (motif du client affiché,
// remise en attente) et consultants de la tâche (responsable et collaborateurs, parmi
// les consultants du projet). Réglables par la gestion du projet ; lus par les autres.

import type { WorkTaskDetail, WorkTaskExternalView } from '@lalanda/shared/work';
import { Button, Field, Select, StatusPill, Switch, TextArea } from '@lalanda/ui';
import { useCallback, useEffect, useId, useState } from 'react';

import { workExternalApi } from '@/lib/work-external-api';

import { etatValidationClient, messageExterne } from '@/lib/externes-model';
import { useProjet } from './project-context';
import { codeWork, messageWork } from './projets-model';

const AUCUN = '';

export function TacheExterne({
  detail,
  onChange,
}: {
  detail: WorkTaskDetail;
  onChange: () => void;
}): React.ReactElement | null {
  const id = useId();
  const { project } = useProjet();
  const [vue, setVue] = useState<WorkTaskExternalView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Revue B4 : retirer une validation client en cours sur un jalon exige un motif.
  const [retrait, setRetrait] = useState<{ masquer: boolean } | null>(null);
  const [motif, setMotif] = useState('');

  const charger = useCallback(() => {
    workExternalApi
      .taskExternal(detail.id)
      .then(setVue)
      .catch(() => setVue(null));
  }, [detail.id]);
  useEffect(() => charger(), [charger, detail.revision]);

  if (!vue) return null;
  const client = project?.kind === 'client';
  if (!vue.canManage && !vue.clientVisible && !vue.consultantAssignee && !client) return null;

  async function regler(
    body: Parameters<typeof workExternalApi.putTaskExternal>[1] | 'reset',
  ): Promise<void> {
    if (!vue) return;
    setEnvoi(true);
    setErreur(null);
    try {
      setVue(
        body === 'reset'
          ? await workExternalApi.resetClientApproval(detail.id, vue.revision)
          : await workExternalApi.putTaskExternal(detail.id, body),
      );
      onChange();
    } catch (err) {
      setErreur(messageExterne(codeWork(err)) ?? messageWork(err, 'Réglage impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  const etat = etatValidationClient(vue.clientApproval.state);
  const motifRequis =
    detail.isMilestone &&
    vue.clientApproval.required &&
    (vue.clientApproval.state === 'pending' || vue.clientApproval.state === 'changes_requested');
  const options = [
    { value: AUCUN, label: 'Aucun consultant' },
    ...vue.consultants.map((c) => ({ value: c.userId, label: c.name })),
  ];

  return (
    <section
      aria-labelledby={`${id}-titre`}
      className="flex flex-col gap-3 border-t border-[var(--border)] pt-4"
    >
      <h3 id={`${id}-titre`} className="text-sm font-semibold">
        Espace externe
      </h3>
      {erreur ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
      {client ? (
        <div className="flex flex-col gap-3">
          <Switch
            checked={vue.clientVisible}
            disabled={!vue.canManage || envoi}
            onChange={(v) => {
              if (!v && motifRequis) {
                setRetrait({ masquer: true });
                return;
              }
              void regler({
                expectedRevision: vue.revision,
                clientVisible: v,
                ...(v ? {} : { clientApprovalRequired: false }),
              });
            }}
            label="Visible par le client"
            description="Le contact client voit le titre, l’échéance, l’état et les commentaires partagés — jamais de montant ni de temps."
          />
          <Switch
            checked={vue.clientApproval.required}
            disabled={!vue.canManage || envoi || !vue.clientVisible}
            onChange={(v) => {
              if (!v && motifRequis) {
                setRetrait({ masquer: false });
                return;
              }
              void regler({ expectedRevision: vue.revision, clientApprovalRequired: v });
            }}
            label="Validation client requise"
            description="Le client approuve ou demande des modifications. Pour un jalon facturable, le brouillon de facture attend son approbation."
          />
          {retrait ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <Field
                id={`${id}-motif`}
                label="Motif du retrait de la validation client"
                required
                size="full"
                hint="Ce jalon attend la validation du client : le motif est tracé."
              >
                <TextArea
                  rows={2}
                  maxLength={500}
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={envoi || motif.trim() === ''}
                  onClick={() => {
                    void regler({
                      expectedRevision: vue.revision,
                      clientApprovalRequired: false,
                      ...(retrait.masquer ? { clientVisible: false } : {}),
                      reason: motif.trim(),
                    }).then(() => {
                      setRetrait(null);
                      setMotif('');
                    });
                  }}
                >
                  Retirer la validation
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setRetrait(null)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : null}
          {vue.clientApproval.required ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill tone={etat.ton}>{etat.libelle}</StatusPill>
              {vue.clientApproval.reason ? (
                <span className="text-[var(--foreground-muted)]">
                  « {vue.clientApproval.reason} »
                </span>
              ) : null}
              {vue.canManage && vue.clientApproval.state !== 'pending' ? (
                <Button size="sm" disabled={envoi} onClick={() => void regler('reset')}>
                  Soumettre de nouveau au client
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {vue.consultants.length > 0 || vue.consultantAssignee ? (
        <Field
          id={`${id}-consultant`}
          label="Consultant responsable"
          size="md"
          hint="Il voit la tâche dans son espace et y saisit son temps."
        >
          <Select<string>
            value={vue.consultantAssignee?.userId ?? AUCUN}
            disabled={!vue.canManage || envoi}
            onChange={(v) =>
              void regler({
                expectedRevision: vue.revision,
                consultantAssigneeId: v === AUCUN ? null : v,
              })
            }
            options={options}
          />
        </Field>
      ) : null}
      {vue.consultantCollaborators.length > 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Consultants collaborateurs : {vue.consultantCollaborators.map((c) => c.name).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
