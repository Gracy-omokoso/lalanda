'use client';

// Avance au personnel — fenêtres de demande et de détail (ADR-0051 § 2.2, § 3.2, § 3.3,
// § 4 ; lot H16).
//
// « Avance sur salaire » n'apparaît qu'aux ayants droit : l'API masque la nature
// (`kind: null`) et l'écran dit alors « Avance ». Le motif d'une avance sur salaire ne
// s'affiche qu'après « Afficher le motif » (lecture journalisée), dans l'état de
// l'écran seulement. Aucun plafond n'est posé par Lalanda ; le reste dû vient du moteur.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import { HR_PAYMENT_METHOD_LABELS, type AdvanceView } from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import { rh2Api } from '@/lib/api-rh-2';

import { BOUTON_PETIT, CHAMP, Champ } from '../../ventes/_components/form-ui';
import { lireMontantSaisi } from '../../ventes/_components/sales-model';

import {
  LIBELLES_ETAPE,
  LIBELLES_STATUT_AVANCE,
  gestesAvance,
  libelleNatureAvance,
  montant,
  tonStatutAvance,
  type Moi,
} from './frais-model';
import { PaiementDialogue } from './note-frais';
import { messageRh2 } from './rh2-model';
import { ErreurAction } from './rh2-ui';
import { aujourdhui, formatJour } from './rh-model';
import { DialogueDecision } from './rh-ui';

export function AvanceFormulaire({
  salaireOuvert,
  onFermer,
  onEnregistree,
}: {
  /** Avance sur salaire activée par l'organisation (éteinte par défaut). */
  salaireOuvert: boolean;
  onFermer: () => void;
  onEnregistree: (v: AdvanceView) => void;
}): React.ReactElement {
  const id = useId();
  const [nature, setNature] = useState<'expenses' | 'salary'>('expenses');
  const [somme, setSomme] = useState('');
  const [devise, setDevise] = useState<'CDF' | 'USD'>('USD');
  const [objet, setObjet] = useState('');
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function demander(): Promise<void> {
    const m = lireMontantSaisi(somme);
    if (!m.ok) {
      setErreur(m.erreur);
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      const brouillon = await rh2Api.createAdvance({
        kind: nature,
        amount: m.valeur,
        currency: devise,
        ...(motif.trim() ? { reason: motif.trim() } : {}),
        ...(nature === 'expenses' && objet.trim() ? { purpose: objet.trim() } : {}),
      });
      onEnregistree(await rh2Api.submitAdvance(brouillon.id, brouillon.revision));
    } catch (err) {
      setErreur(messageRh2(err, 'Demande impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Demander une avance"
      description="Une avance de frais se justifie ensuite par une note de frais ; le reliquat se rend en espèces. Lalanda ne fixe aucun plafond."
      size="sm"
      busy={envoi}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Retour
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'sm')}
            disabled={envoi}
            onClick={() => void demander()}
          >
            {envoi ? 'Envoi…' : 'Envoyer la demande'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {salaireOuvert ? (
          <Champ id={`${id}-nature`} label="Nature" requis>
            <select
              id={`${id}-nature`}
              className={CHAMP}
              value={nature}
              onChange={(e) => setNature(e.target.value as 'expenses' | 'salary')}
            >
              <option value="expenses">Avance de frais (mission)</option>
              <option value="salary">Avance sur salaire</option>
            </select>
          </Champ>
        ) : null}
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Champ id={`${id}-montant`} label="Montant" requis>
            <input
              id={`${id}-montant`}
              inputMode="decimal"
              className={CHAMP}
              value={somme}
              onChange={(e) => setSomme(e.target.value)}
            />
          </Champ>
          <Champ id={`${id}-devise`} label="Devise" requis>
            <select
              id={`${id}-devise`}
              className={CHAMP}
              value={devise}
              onChange={(e) => setDevise(e.target.value as 'CDF' | 'USD')}
            >
              <option value="USD">USD</option>
              <option value="CDF">CDF</option>
            </select>
          </Champ>
        </div>
        {nature === 'expenses' ? (
          <Champ id={`${id}-objet`} label="Objet de la mission (facultatif)">
            <input
              id={`${id}-objet`}
              className={CHAMP}
              value={objet}
              maxLength={200}
              onChange={(e) => setObjet(e.target.value)}
            />
          </Champ>
        ) : null}
        <Champ
          id={`${id}-motif`}
          label="Motif (facultatif)"
          aide={
            nature === 'salary'
              ? 'Confidentiel : chiffré, jamais montré à votre manager.'
              : undefined
          }
        >
          <textarea
            id={`${id}-motif`}
            rows={2}
            className={CHAMP}
            value={motif}
            maxLength={500}
            onChange={(e) => setMotif(e.target.value)}
          />
        </Champ>
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}

type Dialogue = 'valider' | 'refuser' | 'annuler' | 'verser' | 'regulariser' | null;

export function AvanceDetail({
  avance: initiale,
  moi,
  actions,
  equipe,
  onFermer,
  onChangee,
}: {
  avance: AdvanceView;
  moi: Moi;
  actions: readonly OrgAction[] | null;
  equipe: readonly string[];
  onFermer: () => void;
  onChangee: (v: AdvanceView) => void;
}): React.ReactElement {
  const [v, setV] = useState(initiale);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [motif, setMotif] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const g = gestesAvance(v, moi, actions, equipe);

  function remplacer(n: AdvanceView): void {
    setV(n);
    setDialogue(null);
    onChangee(n);
  }

  async function agir(f: () => Promise<AdvanceView>, repli: string): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      remplacer(await f());
    } catch (err) {
      setErreur(messageRh2(err, repli));
    } finally {
      setEnvoi(false);
    }
  }

  async function afficherMotif(): Promise<void> {
    setErreur(null);
    try {
      const r = await rh2Api.revealAdvanceReason(v.id);
      setMotif(r.reason ?? '(aucun motif)');
    } catch (err) {
      setErreur(messageRh2(err, 'Motif illisible.'));
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onFermer}
        title={`${v.number ?? 'Brouillon'} · ${libelleNatureAvance(v.kind)}`}
        description={`${v.employeeName} · ${v.currency}`}
        size="md"
        busy={envoi}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {g.annuler ? (
              <button
                type="button"
                className={BOUTON_PETIT}
                disabled={envoi}
                onClick={() => setDialogue('annuler')}
              >
                Annuler
              </button>
            ) : null}
            {g.regulariser ? (
              <button
                type="button"
                className={BOUTON_PETIT}
                disabled={envoi}
                onClick={() => setDialogue('regulariser')}
              >
                Enregistrer un retour en espèces
              </button>
            ) : null}
            {g.valider ? (
              <>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  disabled={envoi}
                  onClick={() => setDialogue('refuser')}
                >
                  Refuser
                </button>
                <button
                  type="button"
                  className={buttonClasses('primary', 'sm')}
                  disabled={envoi}
                  onClick={() => setDialogue('valider')}
                >
                  Valider
                </button>
              </>
            ) : null}
            {g.verser ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={envoi}
                onClick={() => setDialogue('verser')}
              >
                Verser
              </button>
            ) : null}
            {g.soumettre ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={envoi}
                onClick={() =>
                  void agir(() => rh2Api.submitAdvance(v.id, v.revision), 'Envoi impossible.')
                }
              >
                Envoyer pour validation
              </button>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={tonStatutAvance(v.status)}>{LIBELLES_STATUT_AVANCE[v.status]}</Badge>
            <span className="font-display text-lg font-bold tabular-nums">
              {montant(v.amount, v.currency)}
            </span>
          </div>
          {g.phrase ? (
            <p className="rounded-[var(--radius-md)] border border-[var(--warn)]/50 p-3">
              {g.phrase}
            </p>
          ) : null}
          {v.disbursement ? (
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-[var(--foreground-muted)]">Versé</dt>
                <dd className="tabular-nums">{montant(v.disbursed, v.currency)}</dd>
              </div>
              <div>
                <dt className="text-[var(--foreground-muted)]">Régularisé</dt>
                <dd className="tabular-nums">{montant(v.settled, v.currency)}</dd>
              </div>
              <div>
                <dt className="text-[var(--foreground-muted)]">Reste dû</dt>
                <dd className="font-semibold tabular-nums">{montant(v.outstanding, v.currency)}</dd>
              </div>
            </dl>
          ) : null}
          {v.purpose ? <p>Objet : {v.purpose}</p> : null}
          {v.reason ? <p>Motif : {v.reason}</p> : null}
          {!v.reason && v.hasReason ? (
            motif !== null ? (
              <p>Motif : {motif}</p>
            ) : (
              <button
                type="button"
                className={`${BOUTON_PETIT} self-start`}
                onClick={() => void afficherMotif()}
              >
                Afficher le motif (lecture journalisée)
              </button>
            )
          ) : null}
          {v.findings.map((f) => (
            <p
              key={f.code}
              className="rounded-[var(--radius-md)] border border-[var(--warn)]/50 p-3 text-xs"
            >
              {f.code === 'ADVANCE_OVERDUE'
                ? `Régularisation annoncée pour le ${formatJour(f.dueOn)} : l’avance n’est pas encore soldée. Simple rappel, rien n’est retenu.`
                : `Cette avance a été régularisée sur la paie de ${f.payrollMonth ?? 'un mois'}. Saisissez la dépense de salaire pour le montant net effectivement payé ; l’avance ne doit pas être saisie une seconde fois.`}
            </p>
          ))}
          {v.approvals.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs">
              {v.approvals.map((x) => (
                <li key={`${x.step}-${x.at}`}>
                  {LIBELLES_ETAPE[x.step]} : {x.decision === 'approved' ? 'validée' : 'refusée'}
                  {x.onBehalfOfManager ? ' (en suppléance du manager)' : ''}
                  {x.soleApprover ? ' — approbateur unique' : ''}
                  {x.comment ? ` — « ${x.comment} »` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {v.disbursement ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Versée le {formatJour(v.disbursement.paidOn)} ·{' '}
              {HR_PAYMENT_METHOD_LABELS[v.disbursement.method]}
            </p>
          ) : null}
          {v.settlements.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs">
              {v.settlements.map((s) => (
                <li key={s.id} className={s.cancelledAt ? 'line-through opacity-60' : ''}>
                  {formatJour(s.on)} · {montant(s.amount, v.currency)} ·{' '}
                  {s.kind === 'expense_report'
                    ? 'justifiée par une note de frais'
                    : s.kind === 'cash_return'
                      ? 'retour en espèces'
                      : s.kind === 'declared_payroll'
                        ? 'régularisée sur la paie (hors Lalanda)'
                        : s.kind === 'top_up'
                          ? 'complément remboursé'
                          : 'abandon'}
                </li>
              ))}
            </ul>
          ) : null}
          <ErreurAction erreur={erreur} />
        </div>
      </Modal>

      {dialogue === 'valider' ? (
        <DialogueDecision
          titre="Valider l’avance"
          libelle="Commentaire (facultatif)"
          bouton="Valider"
          commentaire="facultatif"
          onFermer={() => setDialogue(null)}
          onValider={async (t) =>
            remplacer(
              await rh2Api.approveAdvance(v.id, {
                expectedRevision: v.revision,
                ...(t ? { comment: t } : {}),
              }),
            )
          }
        />
      ) : null}
      {dialogue === 'refuser' ? (
        <DialogueDecision
          titre="Refuser l’avance"
          libelle="Pourquoi ?"
          bouton="Refuser"
          commentaire="obligatoire"
          onFermer={() => setDialogue(null)}
          onValider={async (t) =>
            remplacer(
              await rh2Api.rejectAdvance(v.id, { expectedRevision: v.revision, comment: t }),
            )
          }
        />
      ) : null}
      {dialogue === 'annuler' ? (
        <DialogueDecision
          titre="Annuler l’avance"
          libelle="Motif"
          bouton="Annuler l’avance"
          commentaire={v.status === 'approved' ? 'obligatoire' : 'facultatif'}
          onFermer={() => setDialogue(null)}
          onValider={async (t) =>
            remplacer(
              await rh2Api.cancelAdvance(v.id, {
                expectedRevision: v.revision,
                ...(t ? { reason: t } : {}),
              }),
            )
          }
        />
      ) : null}
      {dialogue === 'verser' ? (
        <PaiementDialogue
          titre={`Verser ${v.number ?? 'l’avance'}`}
          description="Une sortie de trésorerie « Avance au personnel » est créée, sans le nom pour une avance sur salaire. Ce n’est pas une charge : rien n’entre au réalisé."
          devise={v.currency}
          compteObligatoire
          onFermer={() => setDialogue(null)}
          onPayer={async (p) =>
            remplacer(
              await rh2Api.disburseAdvance(v.id, {
                expectedRevision: v.revision,
                ...p,
                accountId: p.accountId ?? '',
              }),
            )
          }
        />
      ) : null}
      {dialogue === 'regulariser' ? (
        <RetourEspeces avance={v} onFermer={() => setDialogue(null)} onFait={remplacer} />
      ) : null}
    </>
  );
}

function RetourEspeces({
  avance,
  onFermer,
  onFait,
}: {
  avance: AdvanceView;
  onFermer: () => void;
  onFait: (v: AdvanceView) => void;
}): React.ReactElement {
  const id = useId();
  const [somme, setSomme] = useState(avance.outstanding.replace('.', ','));
  const [jour, setJour] = useState(aujourdhui());
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer(): Promise<void> {
    const m = lireMontantSaisi(somme);
    if (!m.ok) {
      setErreur(m.erreur);
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      onFait(
        await rh2Api.settleAdvance(avance.id, {
          expectedRevision: avance.revision,
          kind: 'cash_return',
          amount: m.valeur,
          on: jour,
          accountId: avance.disbursement?.accountId ?? null,
        }),
      );
    } catch (err) {
      setErreur(messageRh2(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Retour en espèces"
      description={`Reste dû calculé par Lalanda : ${montant(avance.outstanding, avance.currency)}. Une entrée de trésorerie est créée sur le compte qui a versé l’avance.`}
      size="sm"
      busy={envoi}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Retour
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'sm')}
            disabled={envoi}
            onClick={() => void enregistrer()}
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <Champ id={`${id}-montant`} label={`Montant rendu (${avance.currency})`} requis>
          <input
            id={`${id}-montant`}
            inputMode="decimal"
            className={CHAMP}
            value={somme}
            onChange={(e) => setSomme(e.target.value)}
          />
        </Champ>
        <Champ id={`${id}-jour`} label="Date" requis>
          <input
            id={`${id}-jour`}
            type="date"
            className={CHAMP}
            value={jour}
            onChange={(e) => setJour(e.target.value)}
          />
        </Champ>
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}
