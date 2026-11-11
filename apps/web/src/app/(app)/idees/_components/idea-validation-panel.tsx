'use client';

// Validation d'une idée (ADR-0036 § 2) : la grille versionnée, une note de 0 à 4
// AVEC une preuve par critère, le score du moteur (ou « indisponible » et ce qui
// manque), la checklist d'expériences et leurs résultats. L'écran ne calcule rien.

import {
  Button,
  Checkbox,
  DataNature,
  Field,
  FormGrid,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
} from '@lalanda/ui';
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
      <FormGrid>
        <Field label="Note" size="md" group disabled={lecture} hint="De 0 à 4.">
          <SegmentedControl<string>
            value={note}
            onChange={setNote}
            options={NOTES.map((n) => ({ value: String(n), label: String(n) }))}
          />
        </Field>
        <Field label="Preuve" size="full" disabled={lecture}>
          <TextArea
            placeholder="Votre preuve : ce que vous avez vu, entendu, mesuré."
            value={preuve}
            maxLength={1000}
            rows={2}
            onChange={(e) => setPreuve(e.target.value)}
          />
        </Field>
      </FormGrid>
      {experiences.length > 0 && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <legend className="mb-1 text-xs font-medium">Expériences citées en preuve</legend>
          {experiences.map((e) => (
            <Checkbox
              key={e.id}
              disabled={lecture}
              checked={liees.includes(e.id)}
              onChange={(coche) =>
                setLiees(coche ? [...liees, e.id].slice(0, 5) : liees.filter((x) => x !== e.id))
              }
              label={e.title}
            />
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
      <FormGrid>
        <Field label="Type" size="md">
          <Select<ExperienceForm['type']>
            value={f.type}
            onChange={(type) => setF({ ...f, type })}
            options={EXPERIMENT_TYPES.map((t) => ({ value: t, label: LIBELLES_TYPES[t] }))}
          />
        </Field>
        <Field label="Titre" size="lg">
          <TextInput
            value={f.title}
            maxLength={120}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </Field>
        <Field label="Statut" size="md">
          <Select<ExperienceForm['status']>
            value={f.status}
            onChange={(status) => setF({ ...f, status })}
            options={EXPERIMENT_STATUSES.map((st) => ({ value: st, label: LIBELLES_STATUTS[st] }))}
          />
        </Field>
        <Field label="Hypothèse testée" size="full">
          <TextInput
            value={f.hypothesis}
            maxLength={500}
            onChange={(e) => setF({ ...f, hypothesis: e.target.value })}
          />
        </Field>
        {CHAMPS_RESULTATS[f.type].map((c, i) => {
          const k = c.cle as keyof ExperienceForm['resultats'];
          return (
            <Field key={c.cle} label={c.libelle} size="sm" newRow={i === 0}>
              <TextInput
                inputMode="numeric"
                className="fig"
                value={f.resultats[k]}
                onChange={(e) => setF({ ...f, resultats: { ...f.resultats, [k]: e.target.value } })}
              />
            </Field>
          );
        })}
        {f.type !== 'autre' && (
          <Field label="Critère de réussite (%)" size="sm">
            <TextInput
              inputMode="numeric"
              className="fig"
              value={f.targetPct}
              onChange={(e) => setF({ ...f, targetPct: e.target.value })}
            />
          </Field>
        )}
        {f.type === 'pre_commande' && (
          <>
            <Field label="Montant déclaré des pré-commandes" optional size="sm" newRow>
              <TextInput
                inputMode="decimal"
                className="fig"
                value={f.montant}
                onChange={(e) => setF({ ...f, montant: e.target.value })}
              />
            </Field>
            <Field label="Devise" size="xs">
              <TextInput
                placeholder="USD, CDF…"
                maxLength={3}
                value={f.devise}
                onChange={(e) => setF({ ...f, devise: e.target.value })}
              />
            </Field>
          </>
        )}
        {f.status === 'terminee' && (
          <Field label="Conclusion" size="md" newRow>
            <Select<ExperienceForm['conclusion']>
              value={f.conclusion}
              onChange={(conclusion) => setF({ ...f, conclusion })}
              placeholder="Conclusion…"
              options={EXPERIMENT_CONCLUSIONS.map((c) => ({
                value: c,
                label: LIBELLES_CONCLUSIONS[c],
              }))}
            />
          </Field>
        )}
        <Field label="Notes" size="full" hint="Sans nom ni coordonnées de personnes.">
          <TextArea
            value={f.notes}
            maxLength={2000}
            rows={2}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </Field>
      </FormGrid>
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
