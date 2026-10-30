'use client';

// Réglages RH (ADR-0045 § 2.2, § 3.3), lot H7 : semaine de travail, année de
// congé, types de contrat, rappels, visibilités, conservation ; circuit de
// validation (droit dédié : `leave.approve` en plus de `hr.manage`) ; types
// d'absence, jours fériés et modèles de listes (`reglages-listes.tsx`). Lecture
// `hr.read` ; chaque modification s'ouvre en fenêtre modale.

import { Modal, buttonClasses } from '@lalanda/ui';
import { CalendarCog, Scale, Settings2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { HR_APPROVAL_FLOWS, HR_WEEKDAYS, type HrApprovalFlow } from '@lalanda/shared/hr';

import { hrAdminApi, type HrSettingsFull } from '@/lib/api-hr-admin';

import { Alerte, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import { FeriesReglages, ModelesReglages, TypesAbsenceReglages } from './reglages-listes';
import {
  LIBELLES_CALENDRIER_EQUIPE,
  LIBELLES_CIRCUIT,
  LIBELLES_FRACTION,
  LIBELLES_JOUR,
  LIBELLES_ORGANIGRAMME,
  MOIS,
  PHRASE_AUCUNE_REGLE,
  cleContrat,
  formReglages,
  peutModifierCircuit,
  peutModifierReglages,
  phraseDebutAnnee,
  phraseSemaine,
  validerReglages,
  type FormReglages,
} from './reglages-model';
import { useAccesRh } from './rh-access';
import { lire, messageRh, peutLireRh, type Lecture } from './rh-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection } from './rh-ui';

const LABEL = 'flex min-w-0 flex-col gap-1 text-xs font-medium';

export function ReglagesRh(): React.ReactElement {
  const { actions } = useAccesRh();
  const autorise = peutLireRh(actions);
  const modifier = peutModifierReglages(actions);
  const circuit = peutModifierCircuit(actions);
  const [lecture, setLecture] = useState<Lecture<HrSettingsFull> | null>(null);
  const [version, setVersion] = useState(0);
  const [edition, setEdition] = useState<'general' | 'circuit' | null>(null);

  useEffect(() => {
    if (!autorise) return;
    let annule = false;
    void lire(hrAdminApi.getSettings()).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [autorise, version]);

  if (!autorise) {
    return (
      <PhraseSection>
        Les réglages RH sont réservés aux personnes qui consultent les dossiers.
      </PhraseSection>
    );
  }

  const s = lecture?.ok ? lecture.valeur : null;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau icone={Settings2} titre="Réglages" sousTitre={PHRASE_AUCUNE_REGLE} />

      {lecture === null ? (
        <Chargement texte="Chargement des réglages…" />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Les réglages sont illisibles."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : s ? (
        <>
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <Panneau
              titre="Semaine, année de congé et rappels"
              icone={CalendarCog}
              id="rh-reg-general"
              action={
                modifier ? (
                  <button
                    type="button"
                    className={buttonClasses('secondary', 'sm')}
                    aria-haspopup="dialog"
                    onClick={() => setEdition('general')}
                  >
                    Modifier
                  </button>
                ) : null
              }
            >
              <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
                <dt className="text-[var(--foreground-muted)]">Jours travaillés</dt>
                <dd>{phraseSemaine(s)}</dd>
                <dt className="text-[var(--foreground-muted)]">Année de congé</dt>
                <dd>commence le {phraseDebutAnnee(s.leaveYearStart)}</dd>
                <dt className="text-[var(--foreground-muted)]">Types de contrat</dt>
                <dd>
                  {s.contractTypes
                    .filter((c) => c.active)
                    .map((c) => c.label)
                    .join(', ')}
                </dd>
                <dt className="text-[var(--foreground-muted)]">Rappels</dt>
                <dd>
                  fin d’essai {s.reminders.probationEnd} j, fin de contrat {s.reminders.contractEnd}{' '}
                  j, document {s.reminders.documentExpiry} j avant
                </dd>
                <dt className="text-[var(--foreground-muted)]">Calendrier d’équipe</dt>
                <dd>{LIBELLES_CALENDRIER_EQUIPE[s.teamCalendarVisibility]}</dd>
                <dt className="text-[var(--foreground-muted)]">Organigramme</dt>
                <dd>{LIBELLES_ORGANIGRAMME[s.orgChartVisibility]}</dd>
                <dt className="text-[var(--foreground-muted)]">Conservation</dt>
                <dd>
                  {s.retention.privateDataMonthsAfterExit === null &&
                  s.retention.anonymizeYearsAfterExit === null
                    ? 'Aucune purge automatique (anonymisation manuelle)'
                    : [
                        s.retention.privateDataMonthsAfterExit !== null
                          ? `données sensibles effacées ${s.retention.privateDataMonthsAfterExit} mois après la sortie`
                          : null,
                        s.retention.anonymizeYearsAfterExit !== null
                          ? `dossier anonymisé ${s.retention.anonymizeYearsAfterExit} ans après la sortie`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' ; ')}
                </dd>
              </dl>
              {s.isDefault ? (
                <p className="text-xs text-[var(--foreground-muted)]">
                  Valeurs proposées par défaut : rien n’a encore été enregistré.
                </p>
              ) : null}
            </Panneau>

            <Panneau
              titre="Circuit de validation des absences"
              icone={Scale}
              id="rh-reg-circuit"
              action={
                circuit ? (
                  <button
                    type="button"
                    className={buttonClasses('secondary', 'sm')}
                    aria-haspopup="dialog"
                    onClick={() => setEdition('circuit')}
                  >
                    Modifier
                  </button>
                ) : null
              }
            >
              <p className="text-sm">{LIBELLES_CIRCUIT[s.approvalFlow]}.</p>
              <p className="text-sm">
                {s.allowSoleApprover
                  ? 'Une organisation qui n’a qu’un seul validateur peut valider ses propres absences (la décision le mentionne).'
                  : 'Personne ne valide ses propres absences, même seul validateur.'}
              </p>
              <p className="text-xs text-[var(--foreground-muted)]">
                Un type d’absence confidentiel est toujours validé par les ressources humaines
                seules ; un type peut ajouter l’étape RH.
                {circuit
                  ? ''
                  : ' Changer qui valide est réservé aux personnes qui valident elles-mêmes les absences.'}
              </p>
            </Panneau>
          </div>

          <TypesAbsenceReglages modifier={modifier} />
          <FeriesReglages modifier={modifier} />
          <ModelesReglages modifier={modifier} />

          <Modal
            open={modifier && edition === 'general'}
            onClose={() => setEdition(null)}
            title="Semaine, année de congé et rappels"
            description={PHRASE_AUCUNE_REGLE}
            size="lg"
          >
            <FormulaireGeneral
              reglages={s}
              onAnnuler={() => setEdition(null)}
              onEnregistre={() => {
                setEdition(null);
                setVersion((v) => v + 1);
              }}
            />
          </Modal>
          <Modal
            open={circuit && edition === 'circuit'}
            onClose={() => setEdition(null)}
            title="Circuit de validation"
            size="md"
          >
            <FormulaireCircuit
              reglages={s}
              onAnnuler={() => setEdition(null)}
              onEnregistre={() => {
                setEdition(null);
                setVersion((v) => v + 1);
              }}
            />
          </Modal>
        </>
      ) : null}
    </section>
  );
}

function Erreurs({ erreurs }: { erreurs: string[] }): React.ReactElement | null {
  if (erreurs.length === 0) return null;
  return (
    <Alerte>
      <ul className="list-disc pl-4">
        {erreurs.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </Alerte>
  );
}

function Pied({ envoi, onAnnuler }: { envoi: boolean; onAnnuler: () => void }): React.ReactElement {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
        Annuler
      </button>
      <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
        {envoi ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </div>
  );
}

function FormulaireGeneral({
  reglages,
  onAnnuler,
  onEnregistre,
}: {
  reglages: HrSettingsFull;
  onAnnuler: () => void;
  onEnregistre: () => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormReglages>(() => formReglages(reglages));
  const [nouveau, setNouveau] = useState('');
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const maj = (p: Partial<FormReglages>): void => setF((x) => ({ ...x, ...p }));

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const r = validerReglages(f, reglages.revision);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs([]);
    setEnvoi(true);
    try {
      await hrAdminApi.updateSettings(r.corps);
      onEnregistre();
    } catch (err) {
      setErreurs([messageRh(err, 'Les réglages n’ont pas pu être enregistrés.')]);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => void envoyer(e)} noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Semaine de travail</legend>
        <p className="text-xs text-[var(--foreground-muted)]">
          Sert au seul décompte des jours d’absence et à la feuille de temps. Une fiche peut avoir
          sa propre semaine.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {HR_WEEKDAYS.map((d) => (
            <label key={d} className={LABEL}>
              {LIBELLES_JOUR[d]}
              <select
                className={CHAMP}
                value={f.semaine[d]}
                onChange={(e) =>
                  maj({ semaine: { ...f.semaine, [d]: e.target.value as '0' | '0.5' | '1' } })
                }
              >
                {(['1', '0.5', '0'] as const).map((v) => (
                  <option key={v} value={v}>
                    {LIBELLES_FRACTION[v]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Année de congé</legend>
        <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
          <label className={LABEL}>
            Jour
            <select
              className={CHAMP}
              value={f.debutJour}
              onChange={(e) => maj({ debutJour: e.target.value })}
            >
              {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((j) => (
                <option key={j} value={j}>
                  {Number(j)}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Mois
            <select
              className={CHAMP}
              value={f.debutMois}
              onChange={(e) => maj({ debutMois: e.target.value })}
            >
              {MOIS.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, '0')}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Types de contrat</legend>
        <p className="text-xs text-[var(--foreground-muted)]">
          Libellés informatifs, sans effet juridique calculé. « Date de fin » rend la fin de contrat
          obligatoire sur la fiche.
        </p>
        <ul className="flex flex-col gap-2">
          {f.contrats.map((c, i) => (
            <li
              key={c.key}
              className="grid grid-cols-1 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2 sm:grid-cols-[1fr_auto_auto]"
            >
              <input
                aria-label={`Libellé du type ${i + 1}`}
                className={CHAMP}
                value={c.label}
                onChange={(e) =>
                  maj({
                    contrats: f.contrats.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={c.hasEndDate}
                  onChange={(e) =>
                    maj({
                      contrats: f.contrats.map((x, j) =>
                        j === i ? { ...x, hasEndDate: e.target.checked } : x,
                      ),
                    })
                  }
                />
                Date de fin
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={c.active}
                  onChange={(e) =>
                    maj({
                      contrats: f.contrats.map((x, j) =>
                        j === i ? { ...x, active: e.target.checked } : x,
                      ),
                    })
                  }
                />
                Proposé
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Nouveau type de contrat"
            placeholder="Nouveau type de contrat"
            className={`${CHAMP} sm:max-w-xs`}
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
          />
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={nouveau.trim() === ''}
            onClick={() => {
              maj({
                contrats: [
                  ...f.contrats,
                  {
                    key: cleContrat(
                      nouveau,
                      f.contrats.map((c) => c.key),
                    ),
                    label: nouveau.trim(),
                    hasEndDate: false,
                    active: true,
                  },
                ],
              });
              setNouveau('');
            }}
          >
            Ajouter
          </button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Rappels (jours d’avance, 0 à 120)</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={LABEL}>
            Fin de période d’essai
            <input
              inputMode="numeric"
              className={CHAMP}
              value={f.rappelEssai}
              onChange={(e) => maj({ rappelEssai: e.target.value })}
            />
          </label>
          <label className={LABEL}>
            Fin de contrat
            <input
              inputMode="numeric"
              className={CHAMP}
              value={f.rappelContrat}
              onChange={(e) => maj({ rappelContrat: e.target.value })}
            />
          </label>
          <label className={LABEL}>
            Document qui expire
            <input
              inputMode="numeric"
              className={CHAMP}
              value={f.rappelDocument}
              onChange={(e) => maj({ rappelDocument: e.target.value })}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Visibilité</legend>
        <label className={LABEL}>
          Calendrier des absences
          <select
            className={CHAMP}
            value={f.calendrierEquipe}
            onChange={(e) =>
              maj({ calendrierEquipe: e.target.value as FormReglages['calendrierEquipe'] })
            }
          >
            {Object.entries(LIBELLES_CALENDRIER_EQUIPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Organigramme
          <select
            className={CHAMP}
            value={f.organigramme}
            onChange={(e) => maj({ organigramme: e.target.value as FormReglages['organigramme'] })}
          >
            {Object.entries(LIBELLES_ORGANIGRAMME).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Conservation après la sortie</legend>
        <p id={`${id}-conservation`} className="text-xs text-[var(--foreground-muted)]">
          Vide : aucune purge automatique. Lalanda ne fixe aucune durée : elle se décide avec votre
          conseil juridique.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={LABEL}>
            Effacer les données sensibles après (mois)
            <input
              inputMode="numeric"
              className={CHAMP}
              value={f.conservationMois}
              aria-describedby={`${id}-conservation`}
              onChange={(e) => maj({ conservationMois: e.target.value })}
            />
          </label>
          <label className={LABEL}>
            Anonymiser le dossier après (ans)
            <input
              inputMode="numeric"
              className={CHAMP}
              value={f.anonymisationAns}
              aria-describedby={`${id}-conservation`}
              onChange={(e) => maj({ anonymisationAns: e.target.value })}
            />
          </label>
        </div>
      </fieldset>

      <Erreurs erreurs={erreurs} />
      <Pied envoi={envoi} onAnnuler={onAnnuler} />
    </form>
  );
}

function FormulaireCircuit({
  reglages,
  onAnnuler,
  onEnregistre,
}: {
  reglages: HrSettingsFull;
  onAnnuler: () => void;
  onEnregistre: () => void;
}): React.ReactElement {
  const [flux, setFlux] = useState<HrApprovalFlow>(reglages.approvalFlow);
  const [seul, setSeul] = useState(reglages.allowSoleApprover);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setErreurs([]);
    setEnvoi(true);
    try {
      await hrAdminApi.updateApprovalSettings({
        expectedRevision: reglages.revision,
        approvalFlow: flux,
        allowSoleApprover: seul,
      });
      onEnregistre();
    } catch (err) {
      setErreurs([messageRh(err, 'Le circuit n’a pas pu être enregistré.')]);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)}>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Qui valide une absence ?</legend>
        {HR_APPROVAL_FLOWS.map((v) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="circuit"
              value={v}
              checked={flux === v}
              onChange={() => setFlux(v)}
            />
            {LIBELLES_CIRCUIT[v]}
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={seul}
          onChange={(e) => setSeul(e.target.checked)}
        />
        <span>
          <span className="font-medium">Validateur unique</span>
          <span className="block text-xs text-[var(--foreground-muted)]">
            Si l’organisation ne compte qu’une personne qui valide les absences, elle peut valider
            les siennes ; la décision le mentionne.
          </span>
        </span>
      </label>
      <Erreurs erreurs={erreurs} />
      <Pied envoi={envoi} onAnnuler={onAnnuler} />
    </form>
  );
}
