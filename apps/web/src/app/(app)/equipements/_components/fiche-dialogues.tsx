'use client';

// Fenêtres de la fiche équipement (ADR-0046 § 3.1, § 3.2) : affectation, retour,
// cession ou mise au rebut avec confirmation, réintégration. Le refus de
// chevauchement d'une affectation est affiché en clair dans la fenêtre.
//
// ADR-0074 : grille sémantique, dates en `DatePicker`, bénéficiaire en
// `ChoixEntite` (sur `EntityPicker`, chargeurs par permission inchangés), devise
// en segments, confirmation de cession en case stylée (jamais cochée d'office).

import {
  Button,
  Checkbox,
  DatePicker,
  Field,
  FormGrid,
  Modal,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
} from '@lalanda/ui';
import { TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { ChoixEntite } from '@/components/choix-entite';
import {
  assetsApi,
  type AssetAssigneeKind,
  type AssetDetailView,
  type AssetDisposalKind,
} from '@/lib/api-assets';

import { useShell } from '../../_components/shell-context';
import { Alerte } from '../../ventes/_components/form-ui';

import {
  LIBELLES_CESSION,
  estRefusChevauchement,
  formatJour,
  jourKinshasa,
  libelleBeneficiaire,
  messageEquipements,
  valeursAffichees,
} from './equipements-model';
import { ChampNombre } from './equipements-ui';
import {
  LIBELLES_TYPE_BENEFICIAIRE,
  preparerAffectation,
  preparerCession,
  typesBeneficiaire,
  type FormulaireAffectation,
  type FormulaireCession,
} from './fiche-model';

function Pied({
  envoi,
  bouton,
  onAnnuler,
  formId,
  danger = false,
}: {
  envoi: boolean;
  bouton: string;
  onAnnuler: () => void;
  formId: string;
  danger?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <Button size="sm" onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
        Annuler
      </Button>
      <Button
        type="submit"
        form={formId}
        size="sm"
        variant={danger ? 'danger' : 'primary'}
        busy={envoi}
        className="max-sm:h-11"
      >
        {envoi ? 'Envoi…' : bouton}
      </Button>
    </div>
  );
}

// ── Affectation ─────────────────────────────────────────────────────────────

export function DialogueAffectation({
  equipement: a,
  onFermer,
  onFait,
}: {
  equipement: AssetDetailView;
  onFermer: () => void;
  onFait: (a: AssetDetailView) => void;
}): React.ReactElement {
  const id = useId();
  const { actions, organizationId } = useShell();
  const types = typesBeneficiaire(actions);
  const [f, setF] = useState<FormulaireAffectation>({
    kind: types[0] ?? 'member',
    cible: '',
    from: jourKinshasa(new Date()),
    conditionOut: '',
    note: '',
  });
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<{ texte: string; chevauchement: boolean } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerAffectation(f, a.revision);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      onFait(await assetsApi.assign(a.id, p.corps));
    } catch (err) {
      setErreur({
        texte: messageEquipements(err, 'Affectation impossible.'),
        chevauchement: estRefusChevauchement(err),
      });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title={a.currentAssignment ? 'Réaffecter l’équipement' : 'Affecter l’équipement'}
      description={
        a.currentAssignment
          ? `Actuellement chez ${libelleBeneficiaire(a.currentAssignment.assignee)} depuis le ${formatJour(a.currentAssignment.from)} : cette affectation sera close à la date de remise.`
          : 'Une seule affectation est ouverte à la fois.'
      }
      size="md"
      footer={<Pied envoi={envoi} bouton="Affecter" onAnnuler={onFermer} formId={`${id}-form`} />}
    >
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={(e) => void valider(e)}
        className="flex flex-col gap-3"
      >
        <FormGrid>
          <Field id={`${id}-type`} label="Affecter à" size="md">
            <Select<AssetAssigneeKind>
              value={f.kind}
              onChange={(v) => setF({ ...f, kind: v, cible: '' })}
              options={types.map((t) => ({ value: t, label: LIBELLES_TYPE_BENEFICIAIRE[t] }))}
            />
          </Field>
          <Field
            id={`${id}-cible`}
            label="Bénéficiaire"
            required
            size="lg"
            newRow
            error={champs['cible']}
          >
            <ChoixEntite
              key={f.kind}
              id={`${id}-cible`}
              type={f.kind === 'project' ? 'work_project' : f.kind}
              organizationId={organizationId}
              valeur={f.cible}
              onChange={(o) => setF({ ...f, cible: o?.id ?? '' })}
            />
          </Field>
          <Field id={`${id}-du`} label="Remis le" required size="sm" newRow error={champs['from']}>
            <DatePicker
              value={f.from}
              shortcuts={['today']}
              onChange={(v) => setF({ ...f, from: v })}
            />
          </Field>
          <Field id={`${id}-etat`} label="État à la remise" size="full">
            <TextInput
              value={f.conditionOut}
              maxLength={500}
              placeholder="Bon état, chargeur fourni"
              onChange={(e) => setF({ ...f, conditionOut: e.target.value })}
            />
          </Field>
          <Field id={`${id}-note`} label="Note" size="full" optional>
            <TextArea
              rows={2}
              value={f.note}
              maxLength={1000}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
        </FormGrid>
        {erreur ? (
          <Alerte>
            {erreur.chevauchement ? (
              <p className="flex items-start gap-2 font-medium">
                <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                Chevauchement refusé
              </p>
            ) : null}
            <p>{erreur.texte}</p>
          </Alerte>
        ) : null}
      </form>
    </Modal>
  );
}

// ── Retour ──────────────────────────────────────────────────────────────────

export function DialogueRetour({
  equipement: a,
  onFermer,
  onFait,
}: {
  equipement: AssetDetailView;
  onFermer: () => void;
  onFait: (a: AssetDetailView) => void;
}): React.ReactElement {
  const id = useId();
  const [on, setOn] = useState(jourKinshasa(new Date()));
  const [etat, setEtat] = useState('');
  const [note, setNote] = useState('');
  const [champDate, setChampDate] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    // Le champ date natif portait le seul contrôle : une date vide ne part pas.
    if (on === '') {
      setChampDate('La date de retour est obligatoire.');
      return;
    }
    setChampDate(undefined);
    setEnvoi(true);
    try {
      onFait(
        await assetsApi.giveBack(a.id, {
          expectedRevision: a.revision,
          on,
          conditionIn: etat.trim() || null,
          note: note.trim() || null,
        }),
      );
    } catch (err) {
      setErreur(messageEquipements(err, 'Retour impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title="Enregistrer le retour"
      description={`L’équipement revient de chez ${libelleBeneficiaire(a.currentAssignment?.assignee)}.`}
      size="sm"
      footer={
        <Pied envoi={envoi} bouton="Enregistrer" onAnnuler={onFermer} formId={`${id}-form`} />
      }
    >
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={(e) => void valider(e)}
        className="flex flex-col gap-3"
      >
        <FormGrid>
          <Field id={`${id}-le`} label="Rendu le" required size="sm" error={champDate}>
            <DatePicker value={on} shortcuts={['today']} onChange={setOn} />
          </Field>
          <Field id={`${id}-etat`} label="État au retour" size="full">
            <TextInput value={etat} maxLength={500} onChange={(e) => setEtat(e.target.value)} />
          </Field>
          <Field id={`${id}-note`} label="Note" size="full" optional>
            <TextArea
              rows={2}
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </FormGrid>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </form>
    </Modal>
  );
}

// ── Cession ─────────────────────────────────────────────────────────────────

export function DialogueCession({
  equipement: a,
  onFermer,
  onFait,
}: {
  equipement: AssetDetailView;
  onFermer: () => void;
  onFait: (a: AssetDetailView) => void;
}): React.ReactElement {
  const id = useId();
  const { actions } = useShell();
  const valeurs = valeursAffichees(actions, a.valuesHidden);
  const [f, setF] = useState<FormulaireCession>({
    kind: 'scrapped',
    on: jourKinshasa(new Date()),
    proceeds: '',
    currency: a.acquisition.currency,
    buyer: '',
    reason: '',
  });
  const [confirme, setConfirme] = useState(false);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerCession(valeurs ? f : { ...f, proceeds: '' }, a.revision);
    const c = { ...(p.ok ? {} : p.champs) };
    if (!confirme) c['confirme'] = 'Cochez la confirmation.';
    setChamps(c);
    if (!p.ok || !confirme) return;
    setEnvoi(true);
    try {
      onFait(await assetsApi.dispose(a.id, p.corps));
    } catch (err) {
      setErreur(messageEquipements(err, 'Cession impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title="Céder ou mettre au rebut"
      description="La cession est déclarée : Lalanda n’émet aucune facture et n’enregistre aucun encaissement."
      size="md"
      footer={
        <Pied
          envoi={envoi}
          bouton="Confirmer la cession"
          onAnnuler={onFermer}
          formId={`${id}-form`}
          danger
        />
      }
    >
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={(e) => void valider(e)}
        className="flex flex-col gap-3"
      >
        <FormGrid>
          <Field id={`${id}-nature`} label="Nature" size="md">
            <Select<AssetDisposalKind>
              value={f.kind}
              onChange={(v) => setF({ ...f, kind: v })}
              options={Object.entries(LIBELLES_CESSION).map(([k, l]) => ({
                value: k as AssetDisposalKind,
                label: l,
              }))}
            />
          </Field>
          <Field id={`${id}-le`} label="Date" required size="sm" error={champs['on']}>
            <DatePicker
              value={f.on}
              shortcuts={['today']}
              onChange={(v) => setF({ ...f, on: v })}
            />
          </Field>
          {f.kind === 'sold' ? (
            <>
              {valeurs ? (
                <>
                  <Field
                    id={`${id}-prix`}
                    label="Prix de cession"
                    size="sm"
                    newRow
                    error={champs['proceeds']}
                  >
                    <ChampNombre
                      value={f.proceeds}
                      onChange={(e) => setF({ ...f, proceeds: e.target.value })}
                    />
                  </Field>
                  <Field id={`${id}-devise`} label="Devise" size="sm" group>
                    <SegmentedControl<'USD' | 'CDF'>
                      value={f.currency}
                      onChange={(v) => setF({ ...f, currency: v })}
                      options={[
                        { value: 'USD', label: 'USD' },
                        { value: 'CDF', label: 'CDF' },
                      ]}
                    />
                  </Field>
                </>
              ) : null}
              <Field id={`${id}-acheteur`} label="Acheteur" size="md" newRow={!valeurs}>
                <TextInput
                  value={f.buyer}
                  maxLength={120}
                  onChange={(e) => setF({ ...f, buyer: e.target.value })}
                />
              </Field>
            </>
          ) : null}
          <Field id={`${id}-motif`} label="Motif" required size="full" error={champs['reason']}>
            <TextArea
              rows={2}
              value={f.reason}
              maxLength={500}
              onChange={(e) => setF({ ...f, reason: e.target.value })}
            />
          </Field>
        </FormGrid>
        <div className="flex flex-col gap-1">
          <Checkbox
            checked={confirme}
            onChange={setConfirme}
            aria-invalid={champs['confirme'] ? true : undefined}
            aria-describedby={champs['confirme'] ? `${id}-confirme-erreur` : undefined}
            label={`Je confirme : ${a.name} (${a.number}) sort du parc.`}
            description="Il pourra être réintégré, avec un motif, par un gestionnaire des équipements."
          />
          {champs['confirme'] ? (
            <p id={`${id}-confirme-erreur`} className="text-xs font-medium text-[var(--danger)]">
              {champs['confirme']}
            </p>
          ) : null}
        </div>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </form>
    </Modal>
  );
}

// ── Réintégration ───────────────────────────────────────────────────────────

export function DialogueReintegration({
  equipement: a,
  onFermer,
  onFait,
}: {
  equipement: AssetDetailView;
  onFermer: () => void;
  onFait: (a: AssetDetailView) => void;
}): React.ReactElement {
  const id = useId();
  const [motif, setMotif] = useState('');
  const [champ, setChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (motif.trim() === '') {
      setChamp('Le motif est obligatoire.');
      return;
    }
    setChamp(undefined);
    setErreur(null);
    setEnvoi(true);
    try {
      onFait(
        await assetsApi.reinstate(a.id, { expectedRevision: a.revision, reason: motif.trim() }),
      );
    } catch (err) {
      setErreur(messageEquipements(err, 'Réintégration impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title="Réintégrer l’équipement"
      description="L’équipement revient en réserve ; la réintégration est journalisée."
      size="sm"
      footer={<Pied envoi={envoi} bouton="Réintégrer" onAnnuler={onFermer} formId={`${id}-form`} />}
    >
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={(e) => void valider(e)}
        className="flex flex-col gap-3"
      >
        <Field id={`${id}-motif`} label="Motif" required size="full" error={champ}>
          <TextArea
            rows={3}
            value={motif}
            maxLength={500}
            autoFocus
            onChange={(e) => setMotif(e.target.value)}
          />
        </Field>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </form>
    </Modal>
  );
}
