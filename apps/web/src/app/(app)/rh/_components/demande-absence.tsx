'use client';

// Demande d'absence en fenêtre modale (ADR-0045 § 2.7 ; docs/04 § Fenêtres
// modales). Les types d'absence sont lus (`GET /hr/leave-types`, lecture de tout
// membre) ; le nombre de jours est calculé par l'API à l'envoi et affiché tel que
// rendu, jamais par l'écran.

import { Modal, buttonClasses } from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import { hrApi, type LeaveRequestView, type LeaveTypeView } from '@/lib/api-hr';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

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
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <Champ
        id={`${id}-type`}
        label="Type d’absence"
        requis
        erreur={erreurs.typeId}
        aide={aideType(type)}
      >
        <select
          id={`${id}-type`}
          className={CHAMP}
          value={f.typeId}
          disabled={types === null}
          onChange={(e) => maj({ typeId: e.target.value })}
          {...aria(`${id}-type`, erreurs.typeId, aideType(type) !== undefined)}
        >
          <option value="">{types === null ? 'Chargement…' : 'Choisir…'}</option>
          {(types ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Champ>

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ id={`${id}-debut`} label="Premier jour" requis erreur={erreurs.debut}>
          <input
            id={`${id}-debut`}
            type="date"
            className={CHAMP}
            value={f.debut}
            onChange={(e) => maj({ debut: e.target.value })}
            {...aria(`${id}-debut`, erreurs.debut)}
          />
        </Champ>
        <Champ
          id={`${id}-fin`}
          label="Dernier jour"
          erreur={erreurs.fin}
          aide="Laisser vide pour une seule journée."
        >
          <input
            id={`${id}-fin`}
            type="date"
            className={CHAMP}
            value={f.fin}
            min={f.debut || undefined}
            onChange={(e) => maj({ fin: e.target.value })}
            {...aria(`${id}-fin`, erreurs.fin, true)}
          />
        </Champ>
      </div>

      {demi ? (
        unJour(f) ? (
          <Champ id={`${id}-demi`} label="Durée de la journée">
            <select
              id={`${id}-demi`}
              className={CHAMP}
              value={f.demiUnique}
              onChange={(e) => maj({ demiUnique: e.target.value as FormDemande['demiUnique'] })}
            >
              <option value="full">Journée entière</option>
              <option value="am">Matin seulement</option>
              <option value="pm">Après-midi seulement</option>
            </select>
          </Champ>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ id={`${id}-demi-debut`} label="Le premier jour">
              <select
                id={`${id}-demi-debut`}
                className={CHAMP}
                value={f.demiDebut}
                onChange={(e) => maj({ demiDebut: e.target.value as FormDemande['demiDebut'] })}
              >
                <option value="full">Journée entière</option>
                <option value="pm">À partir de l’après-midi</option>
              </select>
            </Champ>
            <Champ id={`${id}-demi-fin`} label="Le dernier jour">
              <select
                id={`${id}-demi-fin`}
                className={CHAMP}
                value={f.demiFin}
                onChange={(e) => maj({ demiFin: e.target.value as FormDemande['demiFin'] })}
              >
                <option value="full">Journée entière</option>
                <option value="am">Jusqu’à midi</option>
              </select>
            </Champ>
          </div>
        )
      ) : null}

      <Champ
        id={`${id}-motif`}
        label="Motif"
        erreur={erreurs.motif}
        aide="Facultatif. Pour une absence confidentielle, seuls vous et les ressources humaines le lisent."
      >
        <textarea
          id={`${id}-motif`}
          rows={3}
          className={CHAMP}
          value={f.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          {...aria(`${id}-motif`, erreurs.motif, true)}
        />
      </Champ>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
          Annuler
        </button>
        <button
          type="submit"
          className={buttonClasses('primary', 'sm')}
          disabled={envoi || types === null}
        >
          {envoi ? 'Envoi…' : 'Envoyer la demande'}
        </button>
      </div>
    </form>
  );
}
