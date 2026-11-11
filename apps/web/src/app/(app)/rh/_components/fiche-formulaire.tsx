'use client';

// Création et modification d'une fiche collaborateur (ADR-0045 § 2.1), dans le
// `Modal` de `@lalanda/ui` (docs/04 § Fenêtres modales). Dossier NON sensible :
// le salaire, les coordonnées bancaires, l'identité et les coordonnées
// personnelles se saisissent dans l'onglet des données sensibles (lot H7).

import {
  Button,
  DatePicker,
  EntityPicker,
  ErrorSummary,
  Field,
  Form,
  FormGrid,
  FormSection,
  PhoneInput,
  Select,
  StickyActions,
  SubmitButton,
  Switch,
  TextArea,
  TextInput,
  correspondRecherche,
  resumerErreurs,
  useBlurValidation,
  type FieldSize,
} from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import { hrApi, type HrDepartmentView, type HrEmployeeView } from '@/lib/api-hr';
// ADR-0068 : matricule automatique, poste du référentiel, « Inviter sur Lalanda ».
import { hrLot1Api, type PositionView } from '@/lib/api-hr-lot1';

import { Alerte } from '../../ventes/_components/form-ui';

import {
  formCollaborateur,
  managersProposes,
  validerCollaborateur,
  type ChampCollaborateur,
  type ErreursCollaborateur,
  type FormCollaborateur,
} from './collaborateurs-model';
import {
  caseInvitation,
  corpsPoste,
  optionPoste,
  peutInviterSurLalanda,
  type ChoixPoste,
} from './lot1-model';
import { useReferentielsRh } from './referentiels';
import { useAccesRh } from './rh-access';
import { aujourdhui, messageRh, peutGererRh } from './rh-model';
import { FormulaireService } from './services';

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
  // ADR-0068 § 1 : case cochée par défaut dès qu'un e-mail est saisi (`null` : non touchée).
  const { actions } = useAccesRh();
  const [choixInvitation, setChoixInvitation] = useState<boolean | null>(null);
  const sansCompte = !fiche?.userId;
  const invitation = caseInvitation(f.workEmail, choixInvitation);
  const peutInviter = peutInviterSurLalanda(actions);
  // ADR-0074 § 4 : un service absent se crée depuis la fiche (`hr.manage`, l'API juge).
  const gererServices = peutGererRh(actions);
  const [servicesAjoutes, setServicesAjoutes] = useState<HrDepartmentView[]>([]);
  // ADR-0068 § 2 : matricule posé = non modifiable ici ; sinon attribué si laissé vide.
  const matriculeFige = fiche !== null && fiche.employeeNumber !== null;
  const [prochain, setProchain] = useState<string | null>(null);
  // ADR-0068 § 3 : poste (création, ou fiche qui n'en a pas encore).
  const choixPossible = !fiche?.positionId;
  const [choixPoste, setChoixPoste] = useState<ChoixPoste>('');
  const [vacants, setVacants] = useState<PositionView[]>([]);
  useEffect(() => {
    let annule = false;
    if (!matriculeFige) {
      hrLot1Api
        .getNumbering()
        .then((n) => !annule && setProchain(n.nextNumber))
        .catch(() => undefined);
    }
    if (choixPossible) {
      hrLot1Api
        .listPositions('open')
        .then((r) => !annule && setVacants(r.items))
        .catch(() => undefined);
    }
    return () => {
      annule = true;
    };
  }, [matriculeFige, choixPossible]);

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    validateAll();
    const r = validerCollaborateur(f, contrats, fiche?.id ?? null);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs({});
    setErreur(null);
    setEnvoi(true);
    try {
      const position = choixPossible ? corpsPoste(choixPoste) : undefined;
      const corps = {
        ...r.corps,
        ...(sansCompte && invitation.cochee ? { invite: true } : {}),
        ...(position ? { position } : {}),
      };
      // Un matricule posé ne se renvoie pas : la correction a sa propre fenêtre.
      if (matriculeFige) delete corps.employeeNumber;
      const e = fiche
        ? await hrApi.updateEmployee(fiche.id, { ...corps, expectedRevision: fiche.revision })
        : await hrApi.createEmployee(corps);
      onEnregistre(e);
    } catch (err) {
      setErreur(messageRh(err, 'La fiche n’a pas pu être enregistrée.'));
    } finally {
      setEnvoi(false);
    }
  }

  // ADR-0074 § 9 : une erreur apparaît à la sortie du champ, avec les MÊMES règles qu'à l'envoi.
  const {
    errors: erreursSaisie,
    touch,
    validateAll,
    submitCount,
  } = useBlurValidation<ChampCollaborateur>(() => {
    const r = validerCollaborateur(f, contrats, fiche?.id ?? null);
    return r.ok ? {} : r.erreurs;
  });
  const erreursVues: ErreursCollaborateur = { ...erreursSaisie, ...erreurs };
  const idDe = (champ: ChampCollaborateur): string => `${id}-${champ}`;

  // Services : la liste du référentiel, plus ceux créés depuis cette fenêtre.
  const tousServices = [
    ...services,
    ...servicesAjoutes.filter((a) => !services.some((s) => s.id === a.id)),
  ];
  const serviceChoisi = tousServices.find((s) => s.id === f.departmentId) ?? null;
  const managers = managersProposes(employes, fiche?.id ?? null);
  const managerChoisi = managers.find((m) => m.id === f.managerEmployeeId) ?? null;

  const texte = (
    champ: ChampCollaborateur,
    label: string,
    opts: {
      requis?: boolean;
      type?: string;
      aide?: string;
      autoComplete?: string;
      taille?: FieldSize;
      nouvelleLigne?: boolean;
    } = {},
  ): React.ReactElement => (
    <Field
      id={idDe(champ)}
      label={label}
      required={opts.requis}
      error={erreursVues[champ]}
      hint={opts.aide}
      size={opts.taille ?? 'md'}
      newRow={opts.nouvelleLigne}
    >
      <TextInput
        type={opts.type ?? 'text'}
        value={f[champ]}
        autoComplete={opts.autoComplete ?? 'off'}
        onChange={(e) => maj({ [champ]: e.target.value } as Partial<FormCollaborateur>)}
        onBlur={() => touch(champ)}
      />
    </Field>
  );

  const date = (
    champ: 'startDate' | 'probationEndDate' | 'contractEndDate',
    label: string,
    opts: { requis?: boolean; aide?: string; min?: string } = {},
  ): React.ReactElement => (
    <Field
      id={idDe(champ)}
      label={label}
      required={opts.requis}
      error={erreursVues[champ]}
      hint={opts.aide}
      size="sm"
    >
      <DatePicker
        value={f[champ]}
        onChange={(v) => {
          maj({ [champ]: v } as Partial<FormCollaborateur>);
          touch(champ);
        }}
        onBlur={() => touch(champ)}
        required={opts.requis}
        {...(opts.min ? { min: opts.min } : {})}
        shortcuts={champ === 'startDate' ? ['today'] : ['today', 'endOfMonth', 'plus30']}
      />
    </Field>
  );

  const resume = resumerErreurs(
    erreursVues,
    (
      [
        ['firstName', 'Prénom'],
        ['lastName', 'Nom'],
        ['preferredName', 'Nom d’usage'],
        ['employeeNumber', 'Matricule'],
        ['jobTitle', 'Intitulé du poste'],
        ['departmentId', 'Service'],
        ['managerEmployeeId', 'Manager'],
        ['contractType', 'Type de contrat'],
        ['startDate', 'Date d’entrée'],
        ['probationEndDate', 'Fin de période d’essai'],
        ['contractEndDate', 'Fin de contrat'],
        ['workLocation', 'Lieu de travail'],
        ['workEmail', 'E-mail professionnel'],
        ['workPhone', 'Téléphone professionnel'],
        ['notes', 'Notes'],
      ] as const
    ).map(([cle, libelle]) => ({ cle, id: idDe(cle), libelle })),
  );

  return (
    <Form className="flex flex-col gap-5" onSubmit={(e) => void envoyer(e)}>
      <ErrorSummary errors={submitCount > 0 ? resume : []} submitCount={submitCount} />

      <FormSection title="Identité">
        {texte('firstName', 'Prénom', { requis: true, autoComplete: 'given-name' })}
        {texte('lastName', 'Nom', { requis: true, autoComplete: 'family-name' })}
        {texte('preferredName', 'Nom d’usage', { aide: 'Facultatif : le nom affiché partout.' })}
        {matriculeFige ? (
          <Field
            id={idDe('employeeNumber')}
            label="Matricule"
            size="sm"
            newRow
            hint="Attribué à la création ; un responsable RH peut le corriger depuis le dossier, avec un motif."
          >
            <TextInput value={fiche?.employeeNumber ?? ''} readOnly aria-readonly="true" />
          </Field>
        ) : (
          <Field
            id={idDe('employeeNumber')}
            label="Matricule"
            size="sm"
            newRow
            optional
            error={erreursVues.employeeNumber}
            hint={`Vide : attribué automatiquement${prochain ? ` (prochain : ${prochain})` : ''}. Saisissez-le pour reprendre un matricule existant.`}
          >
            <TextInput
              value={f.employeeNumber}
              autoComplete="off"
              className="font-mono"
              onChange={(e) => maj({ employeeNumber: e.target.value })}
              onBlur={() => touch('employeeNumber')}
            />
          </Field>
        )}
      </FormSection>

      <FormSection title="Poste">
        {texte('jobTitle', 'Intitulé du poste', { requis: true, taille: 'lg' })}
        {choixPossible ? (
          <Field
            id={`${id}-position`}
            label="Poste du référentiel"
            size="lg"
            hint="Remplacement poste pour poste : même numéro de poste, nouveau matricule pour la personne."
          >
            <Select<ChoixPoste>
              value={choixPoste}
              onChange={(v) => {
                setChoixPoste(v);
                const p = vacants.find((x) => `pos:${x.id}` === v);
                if (p && f.jobTitle.trim() === '') maj({ jobTitle: p.title });
                if (p?.departmentId && f.departmentId === '') maj({ departmentId: p.departmentId });
              }}
              options={[
                { value: '', label: 'Sans poste numéroté' },
                {
                  value: 'new',
                  label: 'Nouveau poste (numéro attribué)',
                  description: 'Un numéro de poste est créé pour cette personne.',
                },
                ...vacants.map((p) => ({
                  value: `pos:${p.id}` as ChoixPoste,
                  label: optionPoste(p),
                  group: 'Remplacement poste pour poste (postes vacants)',
                })),
              ]}
            />
          </Field>
        ) : null}
        <Field
          id={idDe('departmentId')}
          label="Service"
          size="md"
          newRow
          error={erreursVues.departmentId}
          hint={
            gererServices
              ? 'Tapez pour chercher. Service absent : « + » le crée sans quitter la fiche.'
              : 'Tapez pour chercher. Vide : aucun service.'
          }
        >
          <EntityPicker<HrDepartmentView>
            value={serviceChoisi}
            onChange={(s) => maj({ departmentId: s?.id ?? '' })}
            search={async (q) =>
              tousServices
                .filter((s) => correspondRecherche([s.name], q))
                .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
            }
            refreshKey={tousServices.length}
            getKey={(s) => s.id}
            getLabel={(s) => s.name}
            getDescription={(s) => tousServices.find((p) => p.id === s.parentId)?.name ?? null}
            placeholder="Aucun service"
            debounceMs={0}
            emptyText="Aucun service ne correspond."
            createTitle="Nouveau service"
            createButtonLabel="Créer un service"
            {...(gererServices
              ? {
                  createForm: ({ initialText, onCreated, onCancel }) => (
                    <FormulaireService
                      service={null}
                      services={tousServices}
                      employes={employes}
                      nomInitial={initialText}
                      onEnregistre={(cree) => {
                        setServicesAjoutes((l) => [...l, cree]);
                        onCreated(cree);
                      }}
                      onAnnuler={onCancel}
                    />
                  ),
                }
              : {})}
          />
        </Field>
        <Field
          id={idDe('managerEmployeeId')}
          label="Manager"
          size="md"
          error={erreursVues.managerEmployeeId}
          hint="Il valide les absences de ce collaborateur."
        >
          <EntityPicker<{ id: string; nom: string }>
            value={managerChoisi}
            onChange={(m) => maj({ managerEmployeeId: m?.id ?? '' })}
            search={async (q) => managers.filter((m) => correspondRecherche([m.nom], q))}
            refreshKey={managers.length}
            getKey={(m) => m.id}
            getLabel={(m) => m.nom}
            placeholder="Aucun manager"
            debounceMs={0}
            emptyText="Aucun collaborateur actif ne correspond."
          />
        </Field>
      </FormSection>

      <FormSection title="Contrat">
        <Field
          id={idDe('contractType')}
          label="Type de contrat"
          required
          size="md"
          error={erreursVues.contractType}
        >
          <Select
            value={f.contractType}
            onChange={(v) => {
              maj({ contractType: v });
              touch('contractType');
            }}
            onBlur={() => touch('contractType')}
            placeholder="Choisir…"
            options={contrats
              .filter((c) => c.active || c.key === f.contractType)
              .map((c) => ({
                value: c.key,
                label: c.label,
                description: c.hasEndDate ? 'Avec date de fin' : undefined,
              }))}
          />
        </Field>
        {date('startDate', 'Date d’entrée', { requis: true })}
        {date('probationEndDate', 'Fin de période d’essai', {
          aide: 'Saisie, jamais calculée : Lalanda ne fixe aucune durée d’essai.',
          ...(f.startDate ? { min: f.startDate } : {}),
        })}
        {date('contractEndDate', 'Fin de contrat', f.startDate ? { min: f.startDate } : {})}
      </FormSection>

      <FormSection title="Coordonnées professionnelles">
        {texte('workLocation', 'Lieu de travail')}
        {texte('workEmail', 'E-mail professionnel', { type: 'email', autoComplete: 'off' })}
        <Field
          id={idDe('workPhone')}
          label="Téléphone professionnel"
          size="md"
          error={erreursVues.workPhone}
        >
          <PhoneInput
            value={f.workPhone}
            onChange={(v) => maj({ workPhone: v })}
            onBlur={() => touch('workPhone')}
          />
        </Field>
      </FormSection>

      {sansCompte && invitation.visible ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <Switch
            checked={invitation.cochee}
            onChange={setChoixInvitation}
            label="Inviter sur Lalanda"
            description={
              peutInviter
                ? 'Un membre de l’organisation qui a cette adresse est relié tout de suite ; sinon une invitation part à cette adresse (rôle Salarié) et la fiche est reliée quand la personne l’accepte.'
                : 'Vous n’avez pas le droit d’inviter : la fiche sera enregistrée sans rien envoyer, et un administrateur pourra l’inviter depuis la fiche.'
            }
          />
        </div>
      ) : null}

      <FormGrid>
        <Field
          id={idDe('notes')}
          label="Notes"
          size="full"
          error={erreursVues.notes}
          hint="Ne rien noter ici de médical, de disciplinaire ou de financier : ces notes ne sont pas protégées comme des données sensibles."
        >
          <TextArea
            rows={3}
            value={f.notes}
            onChange={(e) => maj({ notes: e.target.value })}
            onBlur={() => touch('notes')}
          />
        </Field>
      </FormGrid>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <StickyActions>
        <Button size="sm" onClick={onAnnuler} disabled={envoi}>
          Annuler
        </Button>
        <SubmitButton size="sm" busy={envoi} busyLabel="Enregistrement…">
          {fiche ? 'Enregistrer' : 'Créer la fiche'}
        </SubmitButton>
      </StickyActions>
    </Form>
  );
}
