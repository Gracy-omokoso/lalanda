'use client';

// Réglages RH (ADR-0045 § 2.2, § 3.3), lot H7 : semaine de travail, année de
// congé, types de contrat, rappels, visibilités, conservation ; circuit de
// validation (droit dédié : `leave.approve` en plus de `hr.manage`) ; types
// d'absence, jours fériés et modèles de listes (`reglages-listes.tsx`). Lecture
// `hr.read` ; chaque modification s'ouvre en fenêtre modale.
//
// ADR-0074 : listes en `Select`, visibilités et circuit en cartes de choix,
// validateur unique en interrupteur, grille sémantique. Mêmes champs envoyés.

import {
  Button,
  Checkbox,
  ChoiceCards,
  Field,
  FormSection,
  Modal,
  Select,
  SubmitButton,
  Switch,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { CalendarCog, Scale, Settings2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { HR_APPROVAL_FLOWS, HR_WEEKDAYS, type HrApprovalFlow } from '@lalanda/shared/hr';

import { hrAdminApi, type HrSettingsFull } from '@/lib/api-hr-admin';

import { Alerte } from '../../ventes/_components/form-ui';

import { FeriesReglages, ModelesReglages, TypesAbsenceReglages } from './reglages-listes';
// ADR-0068 § 2 : matricules.
import { MatriculesReglages } from './lot1-reglages';
// ADR-0072 : attestations et certificats de travail.
import { DocumentsGeneresReglages } from './documents-generes-reglages';
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
          <MatriculesReglages modifier={modifier} />
          <DocumentsGeneresReglages modifier={modifier} />

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
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <Button onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
        Annuler
      </Button>
      <SubmitButton
        busy={envoi}
        busyLabel="Enregistrement…"
        showShortcut={false}
        className="max-sm:h-11"
      >
        Enregistrer
      </SubmitButton>
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
      <FormSection
        title="Semaine de travail"
        description="Sert au seul décompte des jours d’absence et à la feuille de temps. Une fiche peut avoir sa propre semaine."
      >
        {HR_WEEKDAYS.map((d) => (
          <Field key={d} id={`${id}-jour-${d}`} label={LIBELLES_JOUR[d]} size="sm">
            <Select<'0' | '0.5' | '1'>
              value={f.semaine[d]}
              onChange={(v) => maj({ semaine: { ...f.semaine, [d]: v } })}
              options={(['1', '0.5', '0'] as const).map((v) => ({
                value: v,
                label: LIBELLES_FRACTION[v] ?? v,
              }))}
            />
          </Field>
        ))}
      </FormSection>

      <FormSection title="Année de congé">
        <Field id={`${id}-debut-jour`} label="Jour" size="xs">
          <Select<string>
            value={f.debutJour}
            onChange={(v) => maj({ debutJour: v })}
            searchable={false}
            options={Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(
              (j) => ({ value: j, label: String(Number(j)) }),
            )}
          />
        </Field>
        <Field id={`${id}-debut-mois`} label="Mois" size="sm">
          <Select<string>
            value={f.debutMois}
            onChange={(v) => maj({ debutMois: v })}
            searchable={false}
            options={MOIS.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))}
          />
        </Field>
      </FormSection>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Types de contrat</legend>
        <p className="text-xs text-[var(--foreground-muted)]">
          Libellés informatifs, sans effet juridique calculé. « Date de fin » rend la fin de contrat
          obligatoire sur la fiche.
        </p>
        <ul className="flex flex-col gap-2">
          {f.contrats.map((c, i) => (
            <li
              key={c.key}
              className="grid grid-cols-1 items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2 sm:grid-cols-[1fr_auto_auto]"
            >
              <TextInput
                aria-label={`Libellé du type ${i + 1}`}
                value={c.label}
                onChange={(e) =>
                  maj({
                    contrats: f.contrats.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <Checkbox
                checked={c.hasEndDate}
                label="Date de fin"
                onChange={(oui) =>
                  maj({
                    contrats: f.contrats.map((x, j) => (j === i ? { ...x, hasEndDate: oui } : x)),
                  })
                }
              />
              <Checkbox
                checked={c.active}
                label="Proposé"
                onChange={(oui) =>
                  maj({
                    contrats: f.contrats.map((x, j) => (j === i ? { ...x, active: oui } : x)),
                  })
                }
              />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <TextInput
            aria-label="Nouveau type de contrat"
            placeholder="Nouveau type de contrat"
            className="sm:max-w-xs"
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
          />
          <Button
            disabled={nouveau.trim() === ''}
            className="max-sm:h-11"
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
          </Button>
        </div>
      </fieldset>

      <FormSection title="Rappels" description="Jours d’avance, de 0 à 120.">
        <Field id={`${id}-rappel-essai`} label="Fin de période d’essai" size="sm">
          <TextInput
            inputMode="numeric"
            value={f.rappelEssai}
            trailing="jours"
            onChange={(e) => maj({ rappelEssai: e.target.value })}
          />
        </Field>
        <Field id={`${id}-rappel-contrat`} label="Fin de contrat" size="sm">
          <TextInput
            inputMode="numeric"
            value={f.rappelContrat}
            trailing="jours"
            onChange={(e) => maj({ rappelContrat: e.target.value })}
          />
        </Field>
        <Field id={`${id}-rappel-document`} label="Document qui expire" size="sm">
          <TextInput
            inputMode="numeric"
            value={f.rappelDocument}
            trailing="jours"
            onChange={(e) => maj({ rappelDocument: e.target.value })}
          />
        </Field>
      </FormSection>

      <FormSection title="Visibilité">
        <Field id={`${id}-calendrier`} label="Calendrier des absences" group size="full">
          <ChoiceCards<FormReglages['calendrierEquipe']>
            value={f.calendrierEquipe}
            onChange={(v) => maj({ calendrierEquipe: v })}
            columns={1}
            options={(
              Object.entries(LIBELLES_CALENDRIER_EQUIPE) as [
                FormReglages['calendrierEquipe'],
                string,
              ][]
            ).map(([k, v]) => ({ value: k, label: v }))}
          />
        </Field>
        <Field id={`${id}-organigramme`} label="Organigramme" group size="full">
          <ChoiceCards<FormReglages['organigramme']>
            value={f.organigramme}
            onChange={(v) => maj({ organigramme: v })}
            columns={1}
            options={(
              Object.entries(LIBELLES_ORGANIGRAMME) as [FormReglages['organigramme'], string][]
            ).map(([k, v]) => ({ value: k, label: v }))}
          />
        </Field>
      </FormSection>

      <FormSection
        title="Conservation après la sortie"
        description="Vide : aucune purge automatique. Lalanda ne fixe aucune durée : elle se décide avec votre conseil juridique."
      >
        <Field
          id={`${id}-conservation-mois`}
          label="Effacer les données sensibles après"
          optional
          size="md"
        >
          <TextInput
            inputMode="numeric"
            value={f.conservationMois}
            trailing="mois"
            onChange={(e) => maj({ conservationMois: e.target.value })}
          />
        </Field>
        <Field id={`${id}-anonymisation`} label="Anonymiser le dossier après" optional size="md">
          <TextInput
            inputMode="numeric"
            value={f.anonymisationAns}
            trailing="ans"
            onChange={(e) => maj({ anonymisationAns: e.target.value })}
          />
        </Field>
      </FormSection>

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
  const id = useId();
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
      <Field id={`${id}-circuit`} label="Qui valide une absence ?" group size="full">
        <ChoiceCards<HrApprovalFlow>
          value={flux}
          onChange={setFlux}
          columns={1}
          options={HR_APPROVAL_FLOWS.map((v) => ({ value: v, label: LIBELLES_CIRCUIT[v] }))}
        />
      </Field>
      <Switch
        checked={seul}
        onChange={setSeul}
        label="Validateur unique"
        description="Si l’organisation ne compte qu’une personne qui valide les absences, elle peut valider les siennes ; la décision le mentionne."
      />
      <Erreurs erreurs={erreurs} />
      <Pied envoi={envoi} onAnnuler={onAnnuler} />
    </form>
  );
}
