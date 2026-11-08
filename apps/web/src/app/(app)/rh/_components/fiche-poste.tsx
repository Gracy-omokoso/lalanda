'use client';

// « Changer de poste » sur la fiche (ADR-0068, amendement du 8 nov. 2026) : mutation
// vers un poste vacant du référentiel ou un nouveau poste numéroté. L'ancien poste
// redevient vacant, l'historique des titulaires des deux postes est tenu à jour, le
// matricule ne change jamais. L'API reste juge (poste vacant, dates, droits).

import { buttonClasses } from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import { hrLot1Api, type PositionView } from '@/lib/api-hr-lot1';

import { Alerte, BOUTON_PETIT, CHAMP, Champ } from '../../ventes/_components/form-ui';

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
      <Champ
        id={`${id}-poste`}
        label="Nouveau poste"
        requis
        aide="Poste vacant : même numéro de poste, la personne en devient titulaire. Nouveau poste : un numéro est attribué."
      >
        <select
          id={`${id}-poste`}
          className={CHAMP}
          value={choix}
          onChange={(e) => setChoix(e.target.value as ChoixPoste)}
        >
          <option value="">Choisir…</option>
          <option value="new">Nouveau poste (numéro attribué)</option>
          {vacants && vacants.length > 0 ? (
            <optgroup label="Postes vacants">
              {vacants.map((p) => (
                <option key={p.id} value={`pos:${p.id}`}>
                  {optionPoste(p)}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </Champ>
      <Champ
        id={`${id}-date`}
        label="Date d’effet"
        requis
        aide="Fin d’occupation de l’ancien poste et début du nouveau."
      >
        <input
          id={`${id}-date`}
          type="date"
          className={CHAMP}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Champ>
      <Champ
        id={`${id}-intitule`}
        label="Intitulé affiché sur la fiche"
        aide="Laissez vide : intitulé du poste vacant choisi, ou intitulé actuel pour un nouveau poste."
      >
        <input
          id={`${id}-intitule`}
          className={CHAMP}
          value={intitule}
          maxLength={120}
          onChange={(e) => setIntitule(e.target.value)}
        />
      </Champ>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
          {envoi ? 'Changement…' : 'Changer de poste'}
        </button>
      </div>
    </form>
  );
}
