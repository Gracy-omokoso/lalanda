'use client';

// Demandes que l'appelant peut traiter (`GET /hr/leave-approvals/pending`) avec
// « Valider » et « Refuser » en fenêtre modale. La séparation des tâches est
// jugée par l'API ; un refus (soi-même, pas son étape, déjà validée) est dit en
// clair dans la fenêtre.

import { buttonClasses } from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import { hrApi, type LeaveRequestPage, type LeaveRequestView } from '@/lib/api-hr';

import { formatInstantJour } from '../../achats/_components/achats-model';
import { BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { useAccesRh } from './rh-access';
import { formatJours, libellePeriode, libelleType, lire, type Lecture } from './rh-model';
import { Chargement, DialogueDecision, EchecLecture, PhraseSection } from './rh-ui';
import { historiqueDecisions, libelleEtape, nomDemandeur } from './validations-model';

type Decision = { demande: LeaveRequestView; sens: 'valider' | 'refuser' };

export function ValidationsListe({ limite = 50 }: { limite?: number }): React.ReactElement {
  const { relireMoi } = useAccesRh();
  const [lecture, setLecture] = useState<Lecture<LeaveRequestPage> | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    void lire(hrApi.listPendingApprovals({ limit: limite })).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [limite, version]);

  const apres = useCallback(() => {
    setDecision(null);
    setVersion((v) => v + 1);
    relireMoi();
  }, [relireMoi]);

  if (lecture === null) return <Chargement />;
  if (!lecture.ok) {
    return (
      <EchecLecture
        erreur={lecture.erreur}
        repli="Les demandes à valider sont illisibles."
        onReessayer={() => setVersion((v) => v + 1)}
      />
    );
  }
  const items = lecture.valeur.items;
  if (items.length === 0)
    return <PhraseSection>Aucune demande n’attend votre décision.</PhraseSection>;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((d) => {
          const etape = libelleEtape(d);
          const historique = historiqueDecisions(d, formatInstantJour);
          return (
            <li
              key={d.id}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium break-words">
                  {nomDemandeur(d)} · {libelleType(d)}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {libellePeriode(d.start, d.end)} · {formatJours(d.days)}
                  {etape ? ` · ${etape}` : ''}
                </span>
                {d.reason ? <span className="text-xs break-words">Motif : {d.reason}</span> : null}
                {historique.map((h) => (
                  <span key={h} className="text-xs text-[var(--foreground-muted)]">
                    {h}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  aria-haspopup="dialog"
                  onClick={() => setDecision({ demande: d, sens: 'refuser' })}
                >
                  Refuser
                </button>
                <button
                  type="button"
                  className={buttonClasses('primary', 'sm')}
                  aria-haspopup="dialog"
                  onClick={() => setDecision({ demande: d, sens: 'valider' })}
                >
                  Valider
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {lecture.valeur.nextCursor ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          D’autres demandes attendent : traitez celles-ci pour voir les suivantes.
        </p>
      ) : null}
      {decision ? (
        <DialogueDecision
          titre={
            decision.sens === 'valider' ? 'Valider cette absence ?' : 'Refuser cette absence ?'
          }
          description={`${nomDemandeur(decision.demande)} · ${libelleType(decision.demande)}, ${libellePeriode(decision.demande.start, decision.demande.end)} (${formatJours(decision.demande.days)}).`}
          libelle={decision.sens === 'valider' ? 'Commentaire (facultatif)' : 'Motif du refus'}
          bouton={decision.sens === 'valider' ? 'Valider' : 'Refuser'}
          commentaire={decision.sens === 'valider' ? 'facultatif' : 'obligatoire'}
          onFermer={() => setDecision(null)}
          onValider={async (texte) => {
            const d = decision.demande;
            if (decision.sens === 'valider') {
              await hrApi.approveLeaveRequest(d.id, {
                expectedRevision: d.revision,
                ...(texte ? { comment: texte } : {}),
              });
            } else {
              await hrApi.rejectLeaveRequest(d.id, {
                comment: texte,
                expectedRevision: d.revision,
              });
            }
            apres();
          }}
        >
          {decision.sens === 'refuser' ? (
            <p>Un refus clôt la demande ; le collaborateur en est prévenu.</p>
          ) : null}
        </DialogueDecision>
      ) : null}
      <button
        type="button"
        className={`${BOUTON_PETIT} self-start`}
        onClick={() => setVersion((v) => v + 1)}
      >
        Actualiser
      </button>
    </>
  );
}
