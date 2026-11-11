'use client';

// Demande d'absence en fenêtre modale (ADR-0045 § 2.7 ; docs/04 § Fenêtres
// modales). Les types d'absence sont lus (`GET /hr/leave-types`, lecture de tout
// membre) ; le nombre de jours est calculé par l'API à l'envoi et affiché tel que
// rendu, jamais par l'écran.
//
// ADR-0074 : type en `Select`, jours en `DatePicker`, demi-journées en
// segments. Mêmes champs envoyés, même validation (`validerDemande`).

import {
  Button,
  DatePicker,
  Field,
  Form,
  FormGrid,
  Modal,
  SegmentedControl,
  Select,
  SubmitButton,
  TextArea,
  buttonClasses,
} from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import { hrApi, type LeaveRequestView, type LeaveTypeView } from '@/lib/api-hr';

import { Alerte } from '../../ventes/_components/form-ui';

import {
  aideType,
  demiJourneesPermises,
  formDemandeInitial,
  typesProposes,
  unJour,
  validerDemande,
  type ErreursDemande,
  type FormDemande,
} from './demande-model';
import { EchecLecture } from './rh-ui';
import { aujourdhui, formatJours, libellePeriode, messageRh } from './rh-model';

export function DemandeAbsence({
  open,
  onFermer,
  onCreee,
  gererRh = false,
  employeeId,
  pourQui,
}: {
  open: boolean;
  onFermer: () => void;
  onCreee: (d: LeaveRequestView) => void;
  /** `hr.manage` : types réservés aux RH proposés. */
  gererRh?: boolean;
  /** Saisie pour autrui (`hr.manage`) ; absent : pour soi. */
  employeeId?: string;
  /** Nom de la personne, quand la saisie est pour autrui. */
  pourQui?: string;
}): React.ReactElement {
  return (
    <Modal
      open={open}
      onClose={onFermer}
      title={pourQui ? `Absence de ${pourQui}` : 'Demander une absence'}
      description="Le nombre de jours est calculé par Lalanda à l’envoi : jours travaillés, jours fériés et demi-journées."
      size="md"
    >
      <Formulaire gererRh={gererRh} employeeId={employeeId} onCreee={onCreee} onFermer={onFermer} />
    </Modal>
  );
}

function Formulaire({
  gererRh,
  employeeId,
  onCreee,
  onFermer,
}: {
  gererRh: boolean;
  employeeId?: string;
  onCreee: (d: LeaveRequestView) => void;
  onFermer: () => void;
}): React.ReactElement {
  const id = useId();
  const [types, setTypes] = useState<LeaveTypeView[] | null>(null);
  const [erreurTypes, setErreurTypes] = useState<unknown>(null);
  const [f, setF] = useState<FormDemande>(() => formDemandeInitial(aujourdhui()));
  const [erreurs, setErreurs] = useState<ErreursDemande>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [creee, setCreee] = useState<LeaveRequestView | null>(null);

  useEffect(() => {
    let annule = false;
    hrApi
      .listLeaveTypes()
      .then((r) => {
        if (!annule) setTypes(typesProposes(r.items, gererRh));
      })
      .catch((err: unknown) => {
        if (!annule) setErreurTypes(err);
      });
    return () => {
      annule = true;
    };
  }, [gererRh]);

  const type = types?.find((t) => t.id === f.typeId);
  const demi = demiJourneesPermises(type);
  const maj = (p: Partial<FormDemande>): void => setF((avant) => ({ ...avant, ...p }));

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (types === null) return;
    const r = validerDemande(f, types, employeeId);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs({});
    setErreur(null);
    setEnvoi(true);
    try {
      const d = await hrApi.createLeaveRequest(r.corps);
      setCreee(d);
      onCreee(d);
    } catch (err) {
      setErreur(messageRh(err, 'La demande n’a pas pu être envoyée.'));
    } finally {
      setEnvoi(false);
    }
  }

  if (creee) {
    return (
      <div className="flex flex-col gap-4 text-sm" role="status">
        <p>
          Demande envoyée : {creee.typeLabel}, {libellePeriode(creee.start, creee.end)}, soit{' '}
          <strong>{formatJours(creee.days)}</strong> décomptés par Lalanda.
        </p>
        <p className="text-[var(--foreground-muted)]">
          Vous serez prévenu de la décision dans la cloche des notifications.
        </p>
        <div className="flex justify-end">
          <button type="button" className={buttonClasses('primary', 'sm')} onClick={onFermer}>
            Fermer
          </button>
        </div>
      </div>
    );
  }

  if (erreurTypes !== null) {
    return <EchecLecture erreur={erreurTypes} repli="Les types d’absence sont illisibles." />;
  }

  return (
    <Form onSubmit={(e) => void envoyer(e)} className="flex flex-col gap-4">
      <FormGrid>
        <Field
          id={`${id}-type`}
          label="Type d’absence"
          required
          size="lg"
          error={erreurs.typeId}
          hint={aideType(type)}
        >
          <Select<string>
            value={f.typeId}
            disabled={types === null}
            loading={types === null}
            onChange={(v) => maj({ typeId: v })}
            placeholder={types === null ? 'Chargement…' : 'Choisir…'}
            options={(types ?? []).map((t) => ({ value: t.id, label: t.label }))}
          />
        </Field>
        <Field
          id={`${id}-debut`}
          label="Premier jour"
          required
          size="sm"
          newRow
          error={erreurs.debut}
        >
          <DatePicker
            value={f.debut}
            onChange={(v) => maj({ debut: v })}
            shortcuts={['today', 'plus7']}
          />
        </Field>
        <Field
          id={`${id}-fin`}
          label="Dernier jour"
          optional
          size="sm"
          error={erreurs.fin}
          hint="Laisser vide pour une seule journée."
        >
          <DatePicker
            value={f.fin}
            {...(f.debut ? { min: f.debut } : {})}
            onChange={(v) => maj({ fin: v })}
            shortcuts={['plus7', 'endOfMonth']}
          />
        </Field>

        {demi ? (
          unJour(f) ? (
            <Field id={`${id}-demi`} label="Durée de la journée" group size="full" newRow>
              <SegmentedControl<FormDemande['demiUnique']>
                value={f.demiUnique}
                onChange={(v) => maj({ demiUnique: v })}
                options={[
                  { value: 'full', label: 'Journée entière' },
                  { value: 'am', label: 'Matin' },
                  { value: 'pm', label: 'Après-midi' },
                ]}
              />
            </Field>
          ) : (
            <>
              <Field id={`${id}-demi-debut`} label="Le premier jour" group size="md" newRow>
                <SegmentedControl<FormDemande['demiDebut']>
                  value={f.demiDebut}
                  onChange={(v) => maj({ demiDebut: v })}
                  options={[
                    { value: 'full', label: 'Journée entière' },
                    { value: 'pm', label: 'Dès l’après-midi' },
                  ]}
                />
              </Field>
              <Field id={`${id}-demi-fin`} label="Le dernier jour" group size="md">
                <SegmentedControl<FormDemande['demiFin']>
                  value={f.demiFin}
                  onChange={(v) => maj({ demiFin: v })}
                  options={[
                    { value: 'full', label: 'Journée entière' },
                    { value: 'am', label: 'Jusqu’à midi' },
                  ]}
                />
              </Field>
            </>
          )
        ) : null}

        <Field
          id={`${id}-motif`}
          label="Motif"
          optional
          size="full"
          newRow
          error={erreurs.motif}
          hint="Pour une absence confidentielle, seuls vous et les ressources humaines le lisent."
        >
          <TextArea value={f.motif} onChange={(e) => maj({ motif: e.target.value })} />
        </Field>
      </FormGrid>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button onClick={onFermer} disabled={envoi} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton
          busy={envoi}
          busyLabel="Envoi…"
          disabled={types === null}
          className="max-sm:h-11"
        >
          Envoyer la demande
        </SubmitButton>
      </div>
    </Form>
  );
}
