'use client';

// Fenêtres de la fiche équipement (ADR-0046 § 3.1, § 3.2) : affectation, retour,
// cession ou mise au rebut avec confirmation, réintégration. Le refus de
// chevauchement d'une affectation est affiché en clair dans la fenêtre.

import { Modal, buttonClasses } from '@lalanda/ui';
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
import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

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
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
        Annuler
      </button>
      <button
        type="submit"
        form={formId}
        className={buttonClasses(danger ? 'danger' : 'primary', 'sm')}
        disabled={envoi}
      >
        {envoi ? 'Envoi…' : bouton}
      </button>
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
        <Champ id={`${id}-type`} label="Affecter à">
          <select
            id={`${id}-type`}
            className={CHAMP}
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value as AssetAssigneeKind, cible: '' })}
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {LIBELLES_TYPE_BENEFICIAIRE[t]}
              </option>
            ))}
          </select>
        </Champ>
        <Champ id={`${id}-cible`} label="Bénéficiaire" requis erreur={champs['cible']}>
          <ChoixEntite
            key={f.kind}
            id={`${id}-cible`}
            type={f.kind === 'project' ? 'work_project' : f.kind}
            organizationId={organizationId}
            valeur={f.cible}
            onChange={(o) => setF({ ...f, cible: o?.id ?? '' })}
            aria={aria(`${id}-cible`, champs['cible'])}
          />
        </Champ>
        <Champ id={`${id}-du`} label="Remis le" requis erreur={champs['from']}>
          <input
            id={`${id}-du`}
            type="date"
            className={CHAMP}
            value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })}
            {...aria(`${id}-du`, champs['from'])}
          />
        </Champ>
        <Champ id={`${id}-etat`} label="État à la remise">
          <input
            id={`${id}-etat`}
            className={CHAMP}
            value={f.conditionOut}
            maxLength={500}
            placeholder="Bon état, chargeur fourni"
            onChange={(e) => setF({ ...f, conditionOut: e.target.value })}
          />
        </Champ>
        <Champ id={`${id}-note`} label="Note">
          <textarea
            id={`${id}-note`}
            rows={2}
            className={CHAMP}
            value={f.note}
            maxLength={1000}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </Champ>
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
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
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
        <Champ id={`${id}-le`} label="Rendu le" requis>
          <input
            id={`${id}-le`}
            type="date"
            className={CHAMP}
            value={on}
            onChange={(e) => setOn(e.target.value)}
          />
        </Champ>
        <Champ id={`${id}-etat`} label="État au retour">
          <input
            id={`${id}-etat`}
            className={CHAMP}
            value={etat}
            maxLength={500}
            onChange={(e) => setEtat(e.target.value)}
          />
        </Champ>
        <Champ id={`${id}-note`} label="Note">
          <textarea
            id={`${id}-note`}
            rows={2}
            className={CHAMP}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </Champ>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ id={`${id}-nature`} label="Nature">
            <select
              id={`${id}-nature`}
              className={CHAMP}
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as AssetDisposalKind })}
            >
              {Object.entries(LIBELLES_CESSION).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Champ>
          <Champ id={`${id}-le`} label="Date" requis erreur={champs['on']}>
            <input
              id={`${id}-le`}
              type="date"
              className={CHAMP}
              value={f.on}
              onChange={(e) => setF({ ...f, on: e.target.value })}
              {...aria(`${id}-le`, champs['on'])}
            />
          </Champ>
          {f.kind === 'sold' ? (
            <>
              {valeurs ? (
                <Champ id={`${id}-prix`} label="Prix de cession" erreur={champs['proceeds']}>
                  <div className="flex gap-2">
                    <ChampNombre
                      id={`${id}-prix`}
                      value={f.proceeds}
                      onChange={(e) => setF({ ...f, proceeds: e.target.value })}
                      {...aria(`${id}-prix`, champs['proceeds'])}
                    />
                    <select
                      aria-label="Devise"
                      className={`${CHAMP} w-24`}
                      value={f.currency}
                      onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'CDF' })}
                    >
                      <option value="USD">USD</option>
                      <option value="CDF">CDF</option>
                    </select>
                  </div>
                </Champ>
              ) : null}
              <Champ id={`${id}-acheteur`} label="Acheteur">
                <input
                  id={`${id}-acheteur`}
                  className={CHAMP}
                  value={f.buyer}
                  maxLength={120}
                  onChange={(e) => setF({ ...f, buyer: e.target.value })}
                />
              </Champ>
            </>
          ) : null}
        </div>
        <Champ id={`${id}-motif`} label="Motif" requis erreur={champs['reason']}>
          <textarea
            id={`${id}-motif`}
            rows={2}
            className={CHAMP}
            value={f.reason}
            maxLength={500}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            {...aria(`${id}-motif`, champs['reason'])}
          />
        </Champ>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirme}
            onChange={(e) => setConfirme(e.target.checked)}
          />
          <span>
            Je confirme : {a.name} ({a.number}) sort du parc. Il pourra être réintégré, avec un
            motif, par un gestionnaire des équipements.
            {champs['confirme'] ? (
              <span className="block text-xs text-[var(--danger)]">{champs['confirme']}</span>
            ) : null}
          </span>
        </label>
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
        <Champ id={`${id}-motif`} label="Motif" requis erreur={champ}>
          <textarea
            id={`${id}-motif`}
            rows={3}
            className={CHAMP}
            value={motif}
            maxLength={500}
            onChange={(e) => setMotif(e.target.value)}
            {...aria(`${id}-motif`, champ)}
          />
        </Champ>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </form>
    </Modal>
  );
}
