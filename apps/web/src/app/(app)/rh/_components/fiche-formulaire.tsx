'use client';

// Création et modification d'une fiche collaborateur (ADR-0045 § 2.1), dans le
// `Modal` de `@lalanda/ui` (docs/04 § Fenêtres modales). Dossier NON sensible :
// le salaire, les coordonnées bancaires, l'identité et les coordonnées
// personnelles se saisissent dans l'onglet des données sensibles (lot H7).

import { buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import { hrApi, type HrEmployeeView } from '@/lib/api-hr';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import {
  formCollaborateur,
  managersProposes,
  validerCollaborateur,
  type ChampCollaborateur,
  type ErreursCollaborateur,
  type FormCollaborateur,
} from './collaborateurs-model';
import { useReferentielsRh } from './referentiels';
import { aujourdhui, messageRh } from './rh-model';

export function FicheFormulaire({
  fiche,
  onEnregistre,
  onAnnuler,
}: {
  /** `null` : création. */
  fiche: HrEmployeeView | null;
  onEnregistre: (e: HrEmployeeView) => void;
  onAnnuler: () => void;
}): React.ReactElement {
  const id = useId();
  const { contrats, services, employes } = useReferentielsRh();
  const [f, setF] = useState<FormCollaborateur>(() =>
    formCollaborateur(fiche, contrats.find((c) => c.active)?.key ?? '', aujourdhui()),
  );
  const [erreurs, setErreurs] = useState<ErreursCollaborateur>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const maj = (p: Partial<FormCollaborateur>): void => setF((a) => ({ ...a, ...p }));

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const r = validerCollaborateur(f, contrats, fiche?.id ?? null);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs({});
    setErreur(null);
    setEnvoi(true);
    try {
      const e = fiche
        ? await hrApi.updateEmployee(fiche.id, { ...r.corps, expectedRevision: fiche.revision })
        : await hrApi.createEmployee(r.corps);
      onEnregistre(e);
    } catch (err) {
      setErreur(messageRh(err, 'La fiche n’a pas pu être enregistrée.'));
    } finally {
      setEnvoi(false);
    }
  }

  const texte = (
    champ: ChampCollaborateur,
    label: string,
    opts: { requis?: boolean; type?: string; aide?: string; autoComplete?: string } = {},
  ): React.ReactElement => (
    <Champ
      id={`${id}-${champ}`}
      label={label}
      requis={opts.requis}
      erreur={erreurs[champ]}
      aide={opts.aide}
    >
      <input
        id={`${id}-${champ}`}
        type={opts.type ?? 'text'}
        className={CHAMP}
        value={f[champ]}
        autoComplete={opts.autoComplete ?? 'off'}
        onChange={(e) => maj({ [champ]: e.target.value } as Partial<FormCollaborateur>)}
        {...aria(`${id}-${champ}`, erreurs[champ], opts.aide !== undefined)}
      />
    </Champ>
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {texte('firstName', 'Prénom', { requis: true })}
        {texte('lastName', 'Nom', { requis: true })}
        {texte('preferredName', 'Nom d’usage', { aide: 'Facultatif : le nom affiché partout.' })}
        {texte('employeeNumber', 'Matricule')}
        {texte('jobTitle', 'Poste', { requis: true })}
        <Champ id={`${id}-departmentId`} label="Service" erreur={erreurs.departmentId}>
          <select
            id={`${id}-departmentId`}
            className={CHAMP}
            value={f.departmentId}
            onChange={(e) => maj({ departmentId: e.target.value })}
          >
            <option value="">Aucun service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Champ>
        <Champ
          id={`${id}-managerEmployeeId`}
          label="Manager"
          erreur={erreurs.managerEmployeeId}
          aide="Il valide les absences de ce collaborateur."
        >
          <select
            id={`${id}-managerEmployeeId`}
            className={CHAMP}
            value={f.managerEmployeeId}
            onChange={(e) => maj({ managerEmployeeId: e.target.value })}
            {...aria(`${id}-managerEmployeeId`, erreurs.managerEmployeeId, true)}
          >
            <option value="">Aucun manager</option>
            {managersProposes(employes, fiche?.id ?? null).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nom}
              </option>
            ))}
          </select>
        </Champ>
        <Champ
          id={`${id}-contractType`}
          label="Type de contrat"
          requis
          erreur={erreurs.contractType}
        >
          <select
            id={`${id}-contractType`}
            className={CHAMP}
            value={f.contractType}
            onChange={(e) => maj({ contractType: e.target.value })}
            {...aria(`${id}-contractType`, erreurs.contractType)}
          >
            <option value="">Choisir…</option>
            {contrats
              .filter((c) => c.active || c.key === f.contractType)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
          </select>
        </Champ>
        {texte('startDate', 'Date d’entrée', { requis: true, type: 'date' })}
        {texte('probationEndDate', 'Fin de période d’essai', {
          type: 'date',
          aide: 'Saisie, jamais calculée : Lalanda ne fixe aucune durée d’essai.',
        })}
        {texte('contractEndDate', 'Fin de contrat', { type: 'date' })}
        {texte('workLocation', 'Lieu de travail')}
        {texte('workEmail', 'E-mail professionnel', { type: 'email' })}
        {texte('workPhone', 'Téléphone professionnel', { type: 'tel' })}
      </div>
      <Champ
        id={`${id}-notes`}
        label="Notes"
        erreur={erreurs.notes}
        aide="Ne rien noter ici de médical, de disciplinaire ou de financier : ces notes ne sont pas protégées comme des données sensibles."
      >
        <textarea
          id={`${id}-notes`}
          rows={3}
          className={CHAMP}
          value={f.notes}
          onChange={(e) => maj({ notes: e.target.value })}
          {...aria(`${id}-notes`, erreurs.notes, true)}
        />
      </Champ>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
          {envoi ? 'Enregistrement…' : fiche ? 'Enregistrer' : 'Créer la fiche'}
        </button>
      </div>
    </form>
  );
}
