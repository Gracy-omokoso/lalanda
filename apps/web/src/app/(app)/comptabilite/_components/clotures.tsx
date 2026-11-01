'use client';

// Clôtures (ADR-0049 § 4, § 13) : mois et exercices, conditions manquantes listées,
// réouverture par le Propriétaire seul, motif obligatoire.

import { Badge, Button, Modal } from '@lalanda/ui';
import { Lock } from 'lucide-react';
import { useState } from 'react';

import { accountingApi } from '@/lib/api-accounting';

import { CHAMP } from '../../ventes/_components/form-ui';

import { actionsPeriode, raisonsDuRefus } from './clotures-model';
import { useAccesCompta } from './comptabilite-access';
import { formatInstantJour, libelleMois, messageCompta } from './comptabilite-model';
import { Bandeau, CarteVide, Chargement, EchecLecture, Panneau } from './comptabilite-ui';
import { LIBELLES_EXERCICE, LIBELLES_PERIODE } from './libelles';
import { useLecture } from './use-lecture';

export function Clotures(): React.ReactElement {
  const { actions, role, mode } = useAccesCompta();
  const [version, setVersion] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<{ message: string; raisons: string[] } | null>(null);
  /** `mois: null` : réouverture de l'exercice entier. */
  const [reouverture, setReouverture] = useState<{ annee: number; mois: number | null } | null>(
    null,
  );
  const [clotureExercice, setClotureExercice] = useState<number | null>(null);
  const [motifAttente, setMotifAttente] = useState('');
  const [motif, setMotif] = useState('');
  const l = useLecture(
    () => accountingApi.listFiscalYears().then((r) => r.items),
    `${version}-${String(mode)}`,
  );

  async function agir(fn: () => Promise<unknown>, repli: string): Promise<boolean> {
    setEnvoi(true);
    setErreur(null);
    try {
      await fn();
      setVersion((v) => v + 1);
      return true;
    } catch (err) {
      setErreur({ message: messageCompta(err, repli), raisons: raisonsDuRefus(err) });
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Lock}
        titre="Clôtures"
        sousTitre="Un mois clos ne reçoit plus d’écriture. Seul le Propriétaire peut rouvrir, avec un motif."
      />
      {mode === 'simulation' ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          En simulation, rien n’est enregistré : il n’y a rien à clôturer.
        </p>
      ) : null}
      {erreur ? (
        <div role="alert" className="text-sm text-[var(--danger)]">
          <p className="font-medium">{erreur.message}</p>
          {erreur.raisons.length > 0 ? (
            <ul className="ml-5 list-disc">
              {erreur.raisons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {l === null ? (
        <Chargement />
      ) : !l.ok ? (
        <EchecLecture erreur={l.erreur} repli="Les exercices sont illisibles." />
      ) : l.valeur.length === 0 ? (
        <CarteVide>Aucun exercice ouvert pour le moment.</CarteVide>
      ) : (
        l.valeur.map((ex) => (
          <Panneau
            key={ex.year}
            titre={
              <>
                Exercice {ex.year}{' '}
                <Badge tone={ex.status === 'closed' ? 'neutral' : 'info'}>
                  {LIBELLES_EXERCICE[ex.status]}
                </Badge>
              </>
            }
            icone={Lock}
            id={`compta-exercice-${ex.year}`}
          >
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ex.periods.map((p) => {
                const a = actionsPeriode(p.status, actions, role);
                return (
                  <li
                    key={p.month}
                    className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm"
                  >
                    <span className="flex items-center justify-between gap-2 font-medium">
                      {libelleMois(ex.year, p.month)}
                      <Badge tone={p.status === 'closed' ? 'neutral' : 'success'}>
                        {LIBELLES_PERIODE[p.status]}
                      </Badge>
                    </span>
                    {p.closedAt ? (
                      <span className="text-[var(--foreground-muted)]">
                        Clos le {formatInstantJour(p.closedAt)}
                      </span>
                    ) : null}
                    {a.cloturer ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={envoi}
                        onClick={() =>
                          void agir(
                            () => accountingApi.closePeriod(ex.year, p.month),
                            'La clôture a échoué.',
                          )
                        }
                      >
                        Clôturer le mois
                      </Button>
                    ) : null}
                    {a.rouvrir ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={envoi}
                        onClick={() => {
                          setMotif('');
                          setReouverture({ annee: ex.year, mois: p.month });
                        }}
                      >
                        Rouvrir
                      </Button>
                    ) : a.raisonRouvrir ? (
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {a.raisonRouvrir}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {ex.status === 'open' && actionsPeriode('open', actions, role).cloturer ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={envoi}
                  onClick={() => {
                    setMotifAttente('');
                    setClotureExercice(ex.year);
                  }}
                >
                  Clôturer l’exercice et préparer les à-nouveaux
                </Button>
              ) : null}
              {ex.status === 'closed' && actionsPeriode('closed', actions, role).rouvrir ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={envoi}
                  onClick={() => {
                    setMotif('');
                    setReouverture({ annee: ex.year, mois: null });
                  }}
                >
                  Rouvrir l’exercice
                </Button>
              ) : null}
              <span className="text-[var(--foreground-muted)]">
                Les à-nouveaux sont calculés par Lalanda comme projet, à valider par votre
                expert-comptable.
              </span>
            </div>
          </Panneau>
        ))
      )}
      {reouverture ? (
        <Modal
          open
          onClose={() => setReouverture(null)}
          title={
            reouverture.mois === null
              ? `Rouvrir l’exercice ${reouverture.annee}`
              : `Rouvrir ${libelleMois(reouverture.annee, reouverture.mois)}`
          }
          description="La réouverture est inscrite au journal, avec votre motif. Elle ne s’efface pas."
          busy={envoi}
          dirty={motif.trim() !== ''}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReouverture(null)} disabled={envoi}>
                Annuler
              </Button>
              <Button
                variant="primary"
                disabled={envoi || motif.trim() === ''}
                onClick={() =>
                  void agir(
                    () =>
                      reouverture.mois === null
                        ? accountingApi.reopenFiscalYear(reouverture.annee, motif.trim())
                        : accountingApi.reopenPeriod(
                            reouverture.annee,
                            reouverture.mois,
                            motif.trim(),
                          ),
                    'La réouverture a échoué.',
                  ).then((ok) => {
                    if (ok) setReouverture(null);
                  })
                }
              >
                Rouvrir
              </Button>
            </>
          }
        >
          <label htmlFor="compta-motif" className="flex flex-col gap-1 text-sm font-medium">
            Motif (obligatoire)
            <textarea
              id="compta-motif"
              className={CHAMP}
              rows={3}
              maxLength={500}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            />
          </label>
        </Modal>
      ) : null}
      {clotureExercice !== null ? (
        <Modal
          open
          onClose={() => setClotureExercice(null)}
          title={`Clôturer l’exercice ${clotureExercice}`}
          description="Tous les mois doivent être clos. Lalanda prépare les à-nouveaux de l’exercice suivant ; ils restent un projet à valider par votre expert-comptable."
          busy={envoi}
          dirty={motifAttente.trim() !== ''}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClotureExercice(null)} disabled={envoi}>
                Annuler
              </Button>
              <Button
                variant="primary"
                disabled={envoi}
                onClick={() =>
                  void agir(
                    () =>
                      accountingApi.closeFiscalYear(
                        clotureExercice,
                        motifAttente.trim() === '' ? undefined : motifAttente.trim(),
                      ),
                    'La clôture de l’exercice a échoué.',
                  ).then((ok) => {
                    if (ok) setClotureExercice(null);
                  })
                }
              >
                Clôturer l’exercice
              </Button>
            </>
          }
        >
          <label htmlFor="compta-motif-attente" className="flex flex-col gap-1 text-sm font-medium">
            Si le compte d’attente n’est pas soldé : motif pour accepter son solde (facultatif)
            <textarea
              id="compta-motif-attente"
              className={CHAMP}
              rows={3}
              maxLength={500}
              value={motifAttente}
              onChange={(e) => setMotifAttente(e.target.value)}
            />
          </label>
        </Modal>
      ) : null}
    </section>
  );
}
