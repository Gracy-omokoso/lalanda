'use client';

// Validation d'une idée (ADR-0036 § 2) : la grille versionnée, une note de 0 à 4
// AVEC une preuve par critère, le score du moteur (ou « indisponible » et ce qui
// manque), la checklist d'expériences et leurs résultats. L'écran ne calcule rien.

import { Button, DataNature } from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import {
  EXPERIMENT_CONCLUSIONS,
  EXPERIMENT_STATUSES,
  EXPERIMENT_TYPES,
  ideaLabApi,
  type CriterionResult,
  type ExperimentView,
  type IdeaView,
} from '@/lib/idea-lab-api';

import { Bloc, Chargement, Erreur, Pastille } from '../../croissance/_components/grow-ui';
import { useAccesIdees } from './idees-chrome';
import { IdeaHeader } from './idea-header';
import {
  CHAMPS_RESULTATS,
  corpsExperience,
  experienceDepuis,
  experienceVide,
  formatPct,
  LIBELLES_CONCLUSIONS,
  LIBELLES_ETATS_CRITERE,
  LIBELLES_STATUTS,
  LIBELLES_TYPES,
  messageErreur,
  tonNiveau,
  type ExperienceForm,
} from './idea-model';

const CHAMP =
  'rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm disabled:opacity-70';

const NOTES = [0, 1, 2, 3, 4] as const;

function CritereLigne({
  critere,
  experiences,
  lecture,
  onSave,
  onClear,
}: {
  critere: CriterionResult;
  experiences: ExperimentView[];
  lecture: boolean;
  onSave: (note: number, proof: string, experimentIds: string[]) => Promise<void>;
  onClear: () => Promise<void>;
}): React.ReactElement {
  const [note, setNote] = useState<string>(critere.note === null ? '' : String(critere.note));
  const [preuve, setPreuve] = useState(critere.preuve ?? '');
  const [liees, setLiees] = useState<string[]>(critere.experiences);
  const id = `critere-${critere.id}`;
  return (
    <li className="doc-card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={id} className="font-medium">
          {critere.libelle}{' '}
          <span className="text-xs text-[var(--foreground-muted)]">· poids {critere.poids}</span>
        </h3>
        <Pastille
          ton={
            critere.etat === 'renseigne'
              ? 'ok'
              : critere.etat === 'non_renseigne'
                ? 'neutre'
                : 'warn'
          }
        >
          {LIBELLES_ETATS_CRITERE[critere.etat]}
        </Pastille>
      </div>
      <p className="text-xs text-[var(--foreground-muted)]">
        Preuve attendue : {critere.preuveAttendue}
      </p>
      {critere.etat === 'source_manquante' && (
        <p className="text-xs text-[var(--warn)]">
          Ce critère ne compte que si la fiche porte une taille de marché avec sa source.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <select
          aria-labelledby={id}
          aria-label="Note"
          value={note}
          disabled={lecture}
          onChange={(e) => setNote(e.target.value)}
          className={CHAMP}
        >
          <option value="">Note…</option>
          {NOTES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <textarea
          aria-label={`Preuve — ${critere.libelle}`}
          placeholder="Votre preuve : ce que vous avez vu, entendu, mesuré."
          value={preuve}
          maxLength={1000}
          rows={2}
          disabled={lecture}
          onChange={(e) => setPreuve(e.target.value)}
          className={CHAMP}
        />
      </div>
      {experiences.length > 0 && (
        <fieldset className="flex flex-wrap gap-3 text-xs">
          <legend className="sr-only">Expériences citées en preuve</legend>
          {experiences.map((e) => (
            <label key={e.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                disabled={lecture}
                checked={liees.includes(e.id)}
                onChange={(ev) =>
                  setLiees(
                    ev.target.checked
                      ? [...liees, e.id].slice(0, 5)
                      : liees.filter((x) => x !== e.id),
                  )
                }
              />
              {e.title}
            </label>
          ))}
        </fieldset>
      )}
      {!lecture && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={note === ''}
            onClick={() => void onSave(Number(note), preuve, liees)}
          >
            Enregistrer la note
          </Button>
          {critere.etat !== 'non_renseigne' && (
            <Button size="sm" variant="ghost" onClick={() => void onClear()}>
              Retirer
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function ExperienceEditeur({
  initial,
  onSave,
  onCancel,
}: {
  initial: ExperienceForm;
  onSave: (f: ExperienceForm) => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [f, setF] = useState<ExperienceForm>(initial);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          aria-label="Type"
          value={f.type}
          onChange={(e) => setF({ ...f, type: e.target.value as ExperienceForm['type'] })}
          className={CHAMP}
        >
          {EXPERIMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {LIBELLES_TYPES[t]}
            </option>
          ))}
        </select>
        <input
          aria-label="Titre"
          value={f.title}
          maxLength={120}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          className={CHAMP}
        />
        <select
          aria-label="Statut"
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value as ExperienceForm['status'] })}
          className={CHAMP}
        >
          {EXPERIMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LIBELLES_STATUTS[s]}
            </option>
          ))}
        </select>
      </div>
      <input
        aria-label="Hypothèse testée"
        placeholder="Hypothèse testée"
        value={f.hypothesis}
        maxLength={500}
        onChange={(e) => setF({ ...f, hypothesis: e.target.value })}
        className={CHAMP}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {CHAMPS_RESULTATS[f.type].map((c) => {
          const k = c.cle as keyof ExperienceForm['resultats'];
          return (
            <input
              key={c.cle}
              aria-label={c.libelle}
              placeholder={c.libelle}
              inputMode="numeric"
              value={f.resultats[k]}
              onChange={(e) => setF({ ...f, resultats: { ...f.resultats, [k]: e.target.value } })}
              className={CHAMP}
            />
          );
        })}
        {f.type !== 'autre' && (
          <input
            aria-label="Critère de réussite (%)"
            placeholder="Critère de réussite (%)"
            inputMode="numeric"
            value={f.targetPct}
            onChange={(e) => setF({ ...f, targetPct: e.target.value })}
            className={CHAMP}
          />
        )}
      </div>
      {f.type === 'pre_commande' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            aria-label="Montant déclaré des pré-commandes"
            placeholder="Montant déclaré (facultatif)"
            inputMode="decimal"
            value={f.montant}
            onChange={(e) => setF({ ...f, montant: e.target.value })}
            className={CHAMP}
          />
          <input
            aria-label="Devise"
            placeholder="Devise (USD, CDF…)"
            maxLength={3}
            value={f.devise}
            onChange={(e) => setF({ ...f, devise: e.target.value })}
            className={CHAMP}
          />
        </div>
      )}
      {f.status === 'terminee' && (
        <select
          aria-label="Conclusion"
          value={f.conclusion}
          onChange={(e) =>
            setF({ ...f, conclusion: e.target.value as ExperienceForm['conclusion'] })
          }
          className={CHAMP}
        >
          <option value="">Conclusion…</option>
          {EXPERIMENT_CONCLUSIONS.map((c) => (
            <option key={c} value={c}>
              {LIBELLES_CONCLUSIONS[c]}
            </option>
          ))}
        </select>
      )}
      <textarea
        aria-label="Notes"
        placeholder="Notes (sans nom ni coordonnées de personnes)"
        value={f.notes}
        maxLength={2000}
        rows={2}
        onChange={(e) => setF({ ...f, notes: e.target.value })}
        className={CHAMP}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => void onSave(f)}>
          Enregistrer l’expérience
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

export function IdeaValidationPanel({ id }: { id: string }): React.ReactElement {
  const acces = useAccesIdees();
  const [idea, setIdea] = useState<IdeaView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [edition, setEdition] = useState<{ id: string | null; form: ExperienceForm } | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    setErreur(null);
    try {
      setIdea(await ideaLabApi.get(id));
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger cette idée.'));
    }
  }, [id]);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (erreur) return <Erreur message={erreur} onRetry={() => void charger()} />;
  if (!idea) return <Chargement />;

  const lecture = !acces.modifier;
  const v = idea.validation;

  async function action(f: () => Promise<IdeaView>, defaut: string): Promise<void> {
    setMessage(null);
    try {
      setIdea(await f());
    } catch (err) {
      setMessage(messageErreur(err, defaut));
    }
  }

  async function enregistrerExperience(form: ExperienceForm): Promise<void> {
    const r = corpsExperience(form);
    if (!r.ok) {
      setMessage(r.erreur);
      return;
    }
    const cible = edition?.id ?? null;
    await action(
      () =>
        cible === null
          ? ideaLabApi.addExperiment(id, r.body)
          : ideaLabApi.updateExperiment(id, cible, r.body),
      'Enregistrement impossible.',
    );
    setEdition(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <IdeaHeader idea={idea} courant="validation" />

      <Bloc titre="Score de validation" aside={<DataNature nature="prevision" />}>
        <div className="doc-card flex flex-col gap-2 p-4 text-sm">
          {v.score.disponible ? (
            <p className="flex flex-wrap items-center gap-3">
              <span className="fig font-display text-3xl font-semibold">{v.score.valeur}</span>
              <span className="text-[var(--foreground-muted)]">/ 100</span>
              <Pastille ton={tonNiveau(v.score.niveau)}>{v.score.libelleNiveau}</Pastille>
            </p>
          ) : (
            <>
              <p className="font-medium">Score indisponible</p>
              <p className="text-[var(--foreground-muted)]">{v.score.message}</p>
              <p className="text-xs text-[var(--foreground-muted)]">
                À noter en priorité :{' '}
                {v.score.manquants
                  .map((c) => v.criteres.find((x) => x.id === c)?.libelle ?? c)
                  .join(' ; ')}
                .
              </p>
            </>
          )}
          <p className="text-xs text-[var(--foreground-muted)]">
            {v.couverture.criteresRenseignes} critère(s) sur {v.couverture.criteresTotal} notés avec
            une preuve, {v.couverture.poidsRenseigne} % du poids. {v.methode} Le niveau qualifie vos
            preuves, pas la valeur de l’idée.
          </p>
          {v.signaux.map((s) => (
            <p key={s.critere} role="note" className="text-sm text-[var(--ko)]">
              {s.message}
            </p>
          ))}
        </div>
      </Bloc>

      {message && (
        <p role="status" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      )}

      <Bloc titre="La grille" aside={<DataNature nature="hypothese" />}>
        <ul className="flex flex-col gap-3">
          {v.criteres.map((c) => (
            <CritereLigne
              key={`${c.id}-${idea.version}`}
              critere={c}
              experiences={idea.experiments}
              lecture={lecture}
              onSave={(note, proof, experimentIds) =>
                action(
                  () => ideaLabApi.rate(id, c.id, { note, proof, experimentIds }),
                  'Note refusée.',
                )
              }
              onClear={() => action(() => ideaLabApi.clearRating(id, c.id), 'Action impossible.')}
            />
          ))}
        </ul>
      </Bloc>

      <Bloc titre="Expériences de validation">
        <div className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-2 text-xs">
            {idea.experimentChecklist.points.map((p) => (
              <li key={p.type}>
                <Pastille
                  ton={p.etat === 'terminee' ? 'ok' : p.etat === 'prevue' ? 'warn' : 'neutre'}
                >
                  {p.libelle} —{' '}
                  {p.etat === 'terminee'
                    ? 'terminée'
                    : p.etat === 'prevue'
                      ? 'prévue'
                      : 'à prévoir'}
                </Pastille>
              </li>
            ))}
          </ul>

          {idea.experiments.length === 0 && (
            <p className="text-sm text-[var(--foreground-muted)]">
              Aucune expérience. Commencez par une dizaine d’entretiens avec des clients potentiels.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {idea.experiments.map((e) => (
              <li key={e.id} className="doc-card flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {e.title}{' '}
                    <span className="text-xs text-[var(--foreground-muted)]">
                      · {LIBELLES_TYPES[e.type]} · {LIBELLES_STATUTS[e.status]}
                    </span>
                  </span>
                  {e.conclusion && (
                    <Pastille ton="accent">{LIBELLES_CONCLUSIONS[e.conclusion]}</Pastille>
                  )}
                </div>
                {e.hypothesis && <p className="text-[var(--foreground-muted)]">{e.hypothesis}</p>}
                {e.summary.taux ? (
                  <p>
                    {e.summary.taux.libelle} :{' '}
                    <span className="fig font-medium">
                      {e.summary.taux.numerateur} / {e.summary.taux.denominateur} (
                      {formatPct(e.summary.taux.valeur)})
                    </span>
                    {e.summary.seuilPct !== null && (
                      <>
                        {' '}
                        — critère de réussite {e.summary.seuilPct} % :{' '}
                        {e.summary.atteint ? 'atteint' : 'non atteint'}
                      </>
                    )}
                  </p>
                ) : (
                  e.summary.tauxIndisponible && (
                    <p className="text-xs text-[var(--foreground-muted)]">
                      {e.summary.tauxIndisponible.message}
                    </p>
                  )
                )}
                {e.results.montant && (
                  <p className="text-xs">
                    Montant déclaré des pré-commandes : {e.results.montant} {e.results.devise}{' '}
                    <DataNature nature="hypothese" compact />
                  </p>
                )}
                {e.summary.ecartConclusion && (
                  <p role="note" className="text-xs text-[var(--warn)]">
                    Votre conclusion ne correspond pas au critère de réussite que vous aviez fixé :
                    à vérifier.
                  </p>
                )}
                {!lecture && edition?.id !== e.id && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setEdition({ id: e.id, form: experienceDepuis(e) })}
                    >
                      Modifier
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void action(
                          () => ideaLabApi.deleteExperiment(id, e.id),
                          'Suppression impossible.',
                        )
                      }
                    >
                      Supprimer
                    </Button>
                  </div>
                )}
                {edition?.id === e.id && (
                  <ExperienceEditeur
                    initial={edition.form}
                    onSave={enregistrerExperience}
                    onCancel={() => setEdition(null)}
                  />
                )}
              </li>
            ))}
          </ul>
          {!lecture && edition?.id === null && (
            <ExperienceEditeur
              initial={edition.form}
              onSave={enregistrerExperience}
              onCancel={() => setEdition(null)}
            />
          )}
          {!lecture && edition === null && (
            <div>
              <Button onClick={() => setEdition({ id: null, form: experienceVide() })}>
                Ajouter une expérience
              </Button>
            </div>
          )}
        </div>
      </Bloc>
    </div>
  );
}
