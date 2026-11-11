'use client';

// « Changer de poste » sur la fiche (ADR-0068, amendement du 8 nov. 2026) : mutation
// vers un poste vacant du référentiel ou un nouveau poste numéroté. L'ancien poste
// redevient vacant, l'historique des titulaires des deux postes est tenu à jour, le
// matricule ne change jamais. L'API reste juge (poste vacant, dates, droits).
//
// ADR-0074 : poste en `Select` (groupe des vacants), date d'effet en `DatePicker`.

import { Button, DatePicker, Field, FormGrid, Select, SubmitButton, TextInput } from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import { hrLot1Api, type PositionView } from '@/lib/api-hr-lot1';

import { Alerte } from '../../ventes/_components/form-ui';

import { useFiche } from './fiche-chrome';
import { corpsChangementPoste, optionPoste, type ChoixPoste } from './lot1-model';
import { aujourdhui, messageRh } from './rh-model';

export function ChangementPoste({
  onAnnuler,
  onFait,
}: {
  onAnnuler: () => void;
  onFait: (message: string) => void;
}): React.ReactElement {
  const id = useId();
  const { fiche, remplacer } = useFiche();
  const [vacants, setVacants] = useState<PositionView[] | null>(null);
  const [choix, setChoix] = useState<ChoixPoste>('');
  const [date, setDate] = useState(aujourdhui());
  const [intitule, setIntitule] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    hrLot1Api
      .listPositions('open')
      .then((r) => !annule && setVacants(r.items))
      .catch(() => !annule && setVacants([]));
    return () => {
      annule = true;
    };
  }, []);

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const corps = corpsChangementPoste({
      expectedRevision: fiche.revision,
      choix,
      effectiveDate: date,
      jobTitle: intitule,
    });
    if (!corps) {
      setErreur('Choisissez un poste vacant ou « Nouveau poste ».');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      remplacer(await hrLot1Api.changePosition(fiche.id, corps));
      onFait('Poste changé ; l’ancien poste est vacant. Le matricule est inchangé.');
    } catch (err) {
      setErreur(messageRh(err, 'Le poste n’a pas pu être changé.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <p className="text-sm">
        Poste actuel : <strong>{fiche.positionNumber ?? '—'}</strong> · {fiche.jobTitle}. Matricule{' '}
        <strong>{fiche.employeeNumber ?? '—'}</strong> (inchangé).
      </p>
      <FormGrid>
        <Field
          id={`${id}-poste`}
          label="Nouveau poste"
          required
          size="lg"
          hint="Poste vacant : même numéro de poste, la personne en devient titulaire. Nouveau poste : un numéro est attribué."
        >
          <Select<ChoixPoste>
            value={choix}
            onChange={setChoix}
            placeholder="Choisir…"
            loading={vacants === null}
            options={[
              { value: 'new', label: 'Nouveau poste (numéro attribué)' },
              ...(vacants ?? []).map((p) => ({
                value: `pos:${p.id}` as ChoixPoste,
                label: optionPoste(p),
                group: 'Postes vacants',
              })),
            ]}
          />
        </Field>
        <Field
          id={`${id}-date`}
          label="Date d’effet"
          required
          size="sm"
          newRow
          hint="Fin d’occupation de l’ancien poste et début du nouveau."
        >
          <DatePicker
            value={date}
            onChange={setDate}
            shortcuts={['today', 'endOfMonth', 'plus30']}
          />
        </Field>
        <Field
          id={`${id}-intitule`}
          label="Intitulé affiché sur la fiche"
          optional
          size="lg"
          newRow
          hint="Laissez vide : intitulé du poste vacant choisi, ou intitulé actuel pour un nouveau poste."
        >
          <TextInput
            value={intitule}
            maxLength={120}
            onChange={(e) => setIntitule(e.target.value)}
          />
        </Field>
      </FormGrid>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button size="sm" onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton
          busy={envoi}
          busyLabel="Changement…"
          showShortcut={false}
          size="sm"
          className="max-sm:h-11"
        >
          Changer de poste
        </SubmitButton>
      </div>
    </form>
  );
}
