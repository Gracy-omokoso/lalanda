'use client';

// Bloc de validation d'une semaine de temps — ADR-0077 § 4.
//
// Pastille d'état, phrase, gestes rendus possibles par le SERVEUR (`canSubmit`,
// `canDecide`, `canReopen`) et historique. Renvoyer et rouvrir demandent un motif
// (fenêtre, kit `@lalanda/ui`). Le serveur reste juge : une erreur s'affiche telle quelle.

import type { TimesheetApprovalView } from '@lalanda/shared/work';
import {
  Alert,
  Field,
  Modal,
  StatusPill,
  SubmitButton,
  TextArea,
  buttonClasses,
} from '@lalanda/ui';
import { useState } from 'react';

import { workSyncApi } from '@/lib/work-sync-api';

import { messageWork } from './projets-model';
import { ligneHistorique, pastilleSemaine, phraseValidation } from './temps-model';

type Motif = 'return' | 'reopen';

export function ValidationSemaine({
  approval,
  userId,
  week,
  onChange,
}: {
  approval: TimesheetApprovalView;
  userId: string;
  week: string;
  onChange: (a: TimesheetApprovalView) => void;
}): React.ReactElement {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [motif, setMotif] = useState<Motif | null>(null);
  const [texte, setTexte] = useState('');
  const pastille = pastilleSemaine(approval);

  async function agir(fn: () => Promise<TimesheetApprovalView>): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      onChange(await fn());
      setMotif(null);
      setTexte('');
    } catch (err) {
      setErreur(messageWork(err, 'Le geste n’a pas abouti.'));
    } finally {
      setEnCours(false);
    }
  }

  const corps = { userId, week, expectedRevision: approval.revision };

  return (
    <section
      aria-label="Validation de la semaine"
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={pastille.ton}>{pastille.label}</StatusPill>
        <p className="min-w-0 flex-1 text-sm" aria-live="polite">
          {phraseValidation(approval)}
        </p>
        <div className="flex flex-wrap gap-2">
          {approval.canSubmit ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              disabled={enCours}
              onClick={() =>
                void agir(() =>
                  workSyncApi.submitTimesheet({ week, expectedRevision: approval.revision }),
                )
              }
            >
              Soumettre la semaine
            </button>
          ) : null}
          {approval.canDecide ? (
            <>
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={enCours}
                onClick={() => void agir(() => workSyncApi.approveTimesheet(corps))}
              >
                Approuver
              </button>
              <button
                type="button"
                className={buttonClasses('secondary', 'sm')}
                disabled={enCours}
                onClick={() => setMotif('return')}
              >
                Renvoyer
              </button>
            </>
          ) : null}
          {approval.canReopen ? (
            <button
              type="button"
              className={buttonClasses('secondary', 'sm')}
              disabled={enCours}
              onClick={() => setMotif('reopen')}
            >
              Rouvrir
            </button>
          ) : null}
        </div>
      </div>
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      {approval.history.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-[var(--foreground-muted)]">
          {approval.history.map((h, i) => (
            <li key={`${h.at}-${i}`}>{ligneHistorique(h)}</li>
          ))}
        </ul>
      ) : null}
      <Modal
        open={motif !== null}
        onClose={() => setMotif(null)}
        title={motif === 'reopen' ? 'Rouvrir la semaine' : 'Renvoyer la semaine'}
        description={
          motif === 'reopen'
            ? 'Les saisies redeviennent modifiables ; la réouverture est tracée.'
            : 'Le membre corrige sa semaine puis la soumet de nouveau.'
        }
        size="md"
        busy={enCours}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = texte.trim();
            if (reason === '') {
              setErreur('Indiquez le motif.');
              return;
            }
            void agir(() =>
              motif === 'reopen'
                ? workSyncApi.reopenTimesheet({ ...corps, reason })
                : workSyncApi.returnTimesheet({ ...corps, reason }),
            );
          }}
        >
          <Field id="ts-motif" label="Motif" required>
            <TextArea
              value={texte}
              maxLength={500}
              rows={3}
              onChange={(e) => setTexte(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton busy={enCours} busyLabel="Envoi…">
              {motif === 'reopen' ? 'Rouvrir' : 'Renvoyer'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </section>
  );
}
