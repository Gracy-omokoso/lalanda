'use client';

// Avenants d'un contrat signé — ADR-0050 § 2.5, lot V7. Chaque avenant suit le cycle du
// contrat (préparé, soumis, approuvé, signé) ; un avenant non signé n'a aucun effet. Les
// conditions en vigueur sont calculées par le moteur (`termsAt`), jamais par l'écran.

import { Modal, buttonClasses } from '@lalanda/ui';
import { useCallback, useEffect, useId, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import {
  salesContractsApi,
  type AmendmentBody,
  type SalesContractAmendmentView,
  type SalesContractView,
} from '@/lib/api-sales-contracts';

import {
  Alerte,
  BOUTON,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Champ,
  Pastille,
  aria,
} from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { formatJour } from '../../devis/_components/quote-model';
import {
  preparerDocument,
  type FormulaireDocument,
} from '../../factures/_components/invoice-model';

import { ChampsClauses } from './clauses-fields';
import {
  aujourdhuiKinshasa,
  approbation,
  champsRefusesEngagement,
  clausesDepuisVue,
  formulaireDepuisEngagement,
  libelleDuree,
  libelleReconduction,
  messageEngagement,
  peutPreparerEngagement,
  preparerClauses,
  type FormulaireClauses,
} from './contract-model';
import { ChampsDocument } from './engagement-document-fields';
import { FenetreMotif, ListePieces } from './engagement-ui';
import { FenetreSignature } from './signature-form';

export function SectionAvenants({
  contrat,
  actions,
  moi,
  approbateurUniqueAdmis,
  onChange,
}: {
  contrat: SalesContractView;
  actions: readonly OrgAction[] | null;
  moi: string | null;
  approbateurUniqueAdmis: boolean;
  onChange: () => void;
}): React.ReactElement {
  const preparer = peutPreparerEngagement(actions);
  const [items, setItems] = useState<SalesContractAmendmentView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [saisie, setSaisie] = useState<SalesContractAmendmentView | 'nouveau' | null>(null);

  const charger = useCallback(() => {
    salesContractsApi
      .listAmendments(contrat.id)
      .then((r) => {
        setItems(r.items);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageEngagement(err, 'Avenants illisibles.')));
  }, [contrat.id]);

  useEffect(() => charger(), [charger, contrat.revision]);

  const courant = items?.find((x) => x.id === ouvert) ?? null;

  function remplacer(v: SalesContractAmendmentView): void {
    setItems((xs) => (xs ?? []).map((x) => (x.id === v.id ? v : x)));
    onChange();
  }

  return (
    <div className="flex flex-col gap-3">
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {items === null ? null : items.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucun avenant.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOuvert(x.id)}
                className="flex w-full flex-col gap-1 rounded-md border border-[var(--border)] p-3 text-left text-sm transition hover:border-[var(--accent)]"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{x.number}</span>
                  <Pastille
                    ton={x.status === 'signed' || x.status === 'cancelled' ? 'neutre' : 'attention'}
                  >
                    {x.statusLabel}
                  </Pastille>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {x.purpose === 'renewal' ? 'Renouvellement' : 'Modification'} · effet le{' '}
                  {formatJour(x.effectiveDate)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {preparer && contrat.actions.addAmendment ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-start`}
          aria-haspopup="dialog"
          onClick={() => setSaisie('nouveau')}
        >
          + Avenant
        </button>
      ) : null}
      {courant ? (
        <FenetreAvenant
          contrat={contrat}
          avenant={courant}
          actions={actions}
          moi={moi}
          approbateurUniqueAdmis={approbateurUniqueAdmis}
          onFermer={() => setOuvert(null)}
          onChange={remplacer}
          onModifier={() => {
            setOuvert(null);
            setSaisie(courant);
          }}
          onRecharger={charger}
        />
      ) : null}
      {saisie ? (
        <FenetreSaisieAvenant
          contrat={contrat}
          avenant={saisie === 'nouveau' ? null : saisie}
          onFermer={() => setSaisie(null)}
          onEnregistre={(v) => {
            setSaisie(null);
            setItems((xs) => {
              const reste = (xs ?? []).filter((x) => x.id !== v.id);
              return [...reste, v].sort((p, q) => p.index - q.index);
            });
            setOuvert(v.id);
            onChange();
          }}
        />
      ) : null}
    </div>
  );
}

type Geste = null | 'rejeter' | 'annuler' | 'signer' | 'approuver';

function FenetreAvenant({
  contrat,
  avenant: v,
  actions,
  moi,
  approbateurUniqueAdmis,
  onFermer,
  onChange,
  onModifier,
  onRecharger,
}: {
  contrat: SalesContractView;
  avenant: SalesContractAmendmentView;
  actions: readonly OrgAction[] | null;
  moi: string | null;
  approbateurUniqueAdmis: boolean;
  onFermer: () => void;
  onChange: (v: SalesContractAmendmentView) => void;
  onModifier: () => void;
  onRecharger: () => void;
}): React.ReactElement {
  const preparer = peutPreparerEngagement(actions);
  const [geste, setGeste] = useState<Geste>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const appro = approbation({
    actions,
    etatPermet: v.actions.approve,
    moi,
    soumisPar: v.submittedBy,
    creePar: v.createdBy,
    approbateurUniqueAdmis,
  });
  const c = v.changes;

  async function agir(f: () => Promise<SalesContractAmendmentView>): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      onChange(await f());
    } catch (err) {
      setErreur(messageEngagement(err, 'Action impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal open onClose={onFermer} title={`Avenant ${v.number}`} size="lg" busy={envoi}>
      <div className="flex flex-col gap-4 text-sm">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <p className="flex flex-wrap items-center gap-2">
          <Pastille ton="neutre">{v.statusLabel}</Pastille>
          {v.purpose === 'renewal' ? 'Renouvellement exprès' : 'Modification'} · effet le{' '}
          {formatJour(v.effectiveDate)}
        </p>
        <p className="text-xs text-[var(--foreground-muted)]">
          Un avenant n’a d’effet qu’une fois sa signature déclarée, à partir de sa date d’effet.
        </p>
        <dl className="grid gap-1 sm:grid-cols-[12rem_1fr]">
          {c.lines ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Lignes</dt>
              <dd>
                <ul>
                  {c.lines.map((l) => (
                    <li key={l.lineRef}>
                      {l.name} — {l.quantity} × {formatMontant(l.unitPrice, contrat.currency)}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {c.initialTermMonths !== undefined ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Durée du premier terme</dt>
              <dd>{libelleDuree(c.initialTermMonths)}</dd>
            </>
          ) : null}
          {c.renewal ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Reconduction</dt>
              <dd>{libelleReconduction(c.renewal)}</dd>
            </>
          ) : null}
          {c.noticeDays !== undefined ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Préavis</dt>
              <dd>{c.noticeDays} jours</dd>
            </>
          ) : null}
          {c.clauses !== undefined ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Clauses</dt>
              <dd className="whitespace-pre-line">{c.clauses ?? '—'}</dd>
            </>
          ) : null}
          {c.billing ? (
            <>
              <dt className="text-[var(--foreground-muted)]">Échéancier</dt>
              <dd>Modifié par l’avenant</dd>
            </>
          ) : null}
        </dl>
        {v.approvals.length > 0 ? (
          <ul className="text-xs">
            {v.approvals.map((p, i) => (
              <li key={`${p.at}-${i}`}>
                {p.decision === 'approved' ? 'Approuvé' : 'Rejeté'} le{' '}
                {formatJour(p.at.slice(0, 10))}
                {p.soleApprover ? ' (approbateur unique)' : ''}
                {p.comment ? ` — ${p.comment}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        {v.signature ? (
          <p className="text-xs">
            Signature déclarée le {formatJour(v.signature.signedOn)} par{' '}
            {v.signature.signatories.map((s) => s.name).join(', ')}.
          </p>
        ) : null}
        {appro.note ? (
          <p className="rounded-md border border-[var(--border)] p-2 text-xs">{appro.note}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {preparer && v.actions.edit ? (
            <button type="button" className={BOUTON_PETIT} onClick={onModifier}>
              Modifier
            </button>
          ) : null}
          {preparer && v.actions.submit ? (
            <button
              type="button"
              className={BOUTON_PETIT}
              disabled={envoi}
              onClick={() =>
                void agir(() => salesContractsApi.submitAmendment(contrat.id, v.id, v.revision))
              }
            >
              Soumettre à approbation
            </button>
          ) : null}
          {appro.visible ? (
            <>
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={envoi}
                onClick={() => setGeste('approuver')}
              >
                Approuver
              </button>
              <button
                type="button"
                className={BOUTON_PETIT}
                disabled={envoi}
                onClick={() => setGeste('rejeter')}
              >
                Rejeter
              </button>
            </>
          ) : null}
          {preparer && v.actions.declareSignature ? (
            <button type="button" className={BOUTON_PETIT} onClick={() => setGeste('signer')}>
              Déclarer la signature
            </button>
          ) : null}
          {preparer && v.actions.cancel ? (
            <button type="button" className={BOUTON_DANGER} onClick={() => setGeste('annuler')}>
              Annuler l’avenant
            </button>
          ) : null}
        </div>
        <ListePieces
          pieces={v.files}
          lire={(p) => () => salesContractsApi.readContractFile(contrat.id, p.id, p.fileName)}
          televerser={
            preparer && v.actions.addFile
              ? (f) => salesContractsApi.addContractFile(contrat.id, f, 'draft_copy', v.id)
              : null
          }
          libelleAjout="Copie de travail"
          onAjoutee={onRecharger}
        />
      </div>
      {geste === 'approuver' ? (
        <FenetreMotif
          titre={`Approuver l’avenant ${v.number}`}
          description="Validation interne avant la signature (ce n’est pas la signature)."
          libelle="Commentaire (facultatif)"
          bouton="Approuver"
          facultatif
          onFermer={() => setGeste(null)}
          onConfirmer={async (commentaire) => {
            onChange(
              await salesContractsApi.approveAmendment(
                contrat.id,
                v.id,
                v.revision,
                commentaire || null,
              ),
            );
            setGeste(null);
          }}
        />
      ) : null}
      {geste === 'rejeter' ? (
        <FenetreMotif
          titre={`Rejeter l’avenant ${v.number}`}
          libelle="Commentaire"
          bouton="Rejeter"
          danger
          onFermer={() => setGeste(null)}
          onConfirmer={async (commentaire) => {
            onChange(
              await salesContractsApi.rejectAmendment(contrat.id, v.id, v.revision, commentaire),
            );
            setGeste(null);
          }}
        />
      ) : null}
      {geste === 'annuler' ? (
        <FenetreMotif
          titre={`Annuler l’avenant ${v.number}`}
          bouton="Annuler l’avenant"
          danger
          onFermer={() => setGeste(null)}
          onConfirmer={async (motif) => {
            onChange(await salesContractsApi.cancelAmendment(contrat.id, v.id, v.revision, motif));
            setGeste(null);
          }}
        />
      ) : null}
      {geste === 'signer' ? (
        <FenetreSignature
          titre={`Déclarer la signature — avenant ${v.number}`}
          contractId={contrat.id}
          amendmentId={v.id}
          expectedRevision={v.revision}
          copiesExistantes={v.files.filter((f) => f.kind === 'signed_copy')}
          declarer={async (corps) => {
            onChange(await salesContractsApi.declareAmendmentSignature(contrat.id, v.id, corps));
          }}
          onFermer={() => setGeste(null)}
          onFait={() => setGeste(null)}
        />
      ) : null}
    </Modal>
  );
}

/** Saisie d'un avenant : seuls les champs cochés sont modifiés ; le reste est repris. */
function FenetreSaisieAvenant({
  contrat,
  avenant,
  onFermer,
  onEnregistre,
}: {
  contrat: SalesContractView;
  avenant: SalesContractAmendmentView | null;
  onFermer: () => void;
  onEnregistre: (v: SalesContractAmendmentView) => void;
}): React.ReactElement {
  const id = useId();
  const enVigueur = contrat.terms?.inForce;
  const c = avenant?.changes ?? {};
  const [date, setDate] = useState(avenant?.effectiveDate ?? aujourdhuiKinshasa());
  const [objet, setObjet] = useState<AmendmentBody['purpose']>(avenant?.purpose ?? 'change');
  const [avecLignes, setAvecLignes] = useState(c.lines !== undefined);
  const [avecClauses, setAvecClauses] = useState(
    c.initialTermMonths !== undefined ||
      c.renewal !== undefined ||
      c.noticeDays !== undefined ||
      c.clauses !== undefined,
  );
  const [form, setForm] = useState<FormulaireDocument>(() =>
    formulaireDepuisEngagement({
      ...contrat,
      lines: c.lines ?? enVigueur?.lines ?? contrat.lines,
    }),
  );
  const [clauses, setClauses] = useState<FormulaireClauses>(() =>
    clausesDepuisVue({
      startDate: contrat.startDate,
      initialTermMonths:
        c.initialTermMonths !== undefined
          ? c.initialTermMonths
          : (enVigueur?.initialTermMonths ?? contrat.initialTermMonths),
      renewal: c.renewal ?? enVigueur?.renewal ?? contrat.renewal,
      noticeDays: c.noticeDays ?? enVigueur?.noticeDays ?? contrat.noticeDays,
      billing: { kind: 'none' },
      clauses: c.clauses !== undefined ? c.clauses : (enVigueur?.clauses ?? contrat.clauses),
      lines: [],
    }),
  );
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer(): Promise<void> {
    const champs: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) champs['effectiveDate'] = 'Date d’effet : AAAA-MM-JJ.';
    const changes: AmendmentBody['changes'] = {};
    if (avecLignes) {
      const doc = preparerDocument({ ...form, type: 'FV', paiements: [], nature: null });
      if (!doc.ok) Object.assign(champs, doc.champs);
      else changes.lines = doc.corps.lines;
    }
    if (avecClauses) {
      const cl = preparerClauses({ ...clauses, facturation: 'none' }, []);
      if (!cl.ok) Object.assign(champs, cl.champs);
      else {
        changes.initialTermMonths = cl.corps.initialTermMonths;
        changes.renewal = cl.corps.renewal;
        changes.noticeDays = cl.corps.noticeDays;
        changes.clauses = cl.corps.clauses;
      }
    }
    if (!avecLignes && !avecClauses) champs['changes'] = 'Choisissez ce que l’avenant modifie.';
    if (Object.keys(champs).length > 0) {
      setErreurs(champs);
      return;
    }
    setErreurs({});
    setEnvoi(true);
    setErreur(null);
    try {
      const corps: AmendmentBody = { effectiveDate: date, purpose: objet, changes };
      const v = avenant
        ? await salesContractsApi.updateAmendment(contrat.id, avenant.id, {
            ...corps,
            expectedRevision: avenant.revision,
          })
        : await salesContractsApi.createAmendment(contrat.id, corps);
      onEnregistre(v);
    } catch (err) {
      setErreurs(champsRefusesEngagement(err));
      setErreur(messageEngagement(err, 'Enregistrement impossible.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={
        avenant ? `Modifier l’avenant ${avenant.number}` : `Nouvel avenant — ${contrat.number}`
      }
      description="Ce qui n’est pas modifié est repris du contrat en vigueur. L’avenant suit ensuite le même circuit que le contrat : soumission, approbation, signature."
      size="xl"
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi}
            onClick={() => void enregistrer()}
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer l’avenant'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ id={`${id}-date`} label="Date d’effet" requis erreur={erreurs['effectiveDate']}>
            <input
              id={`${id}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={CHAMP}
              {...aria(`${id}-date`, erreurs['effectiveDate'])}
            />
          </Champ>
          <Champ id={`${id}-objet`} label="Objet">
            <select
              id={`${id}-objet`}
              value={objet}
              onChange={(e) => setObjet(e.target.value as AmendmentBody['purpose'])}
              className={CHAMP}
            >
              <option value="change">Modification</option>
              <option value="renewal">Renouvellement exprès</option>
            </select>
          </Champ>
        </div>
        {erreurs['changes'] ? (
          <p className="text-xs font-medium text-[var(--danger)]">{erreurs['changes']}</p>
        ) : null}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={avecLignes}
            onChange={(e) => setAvecLignes(e.target.checked)}
          />
          Modifier les lignes (prix, quantités, articles)
        </label>
        {avecLignes ? (
          <ChampsDocument
            prefixe={`${id}-doc`}
            form={form}
            setForm={setForm}
            vue={null}
            erreurs={erreurs}
            desactive={envoi}
            aJour={false}
            avecClient={false}
          />
        ) : null}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={avecClauses}
            onChange={(e) => setAvecClauses(e.target.checked)}
          />
          Modifier la durée, la reconduction, le préavis ou les clauses
        </label>
        {avecClauses ? (
          <ChampsClauses
            prefixe={`${id}-cl`}
            f={clauses}
            setF={setClauses}
            erreurs={erreurs}
            desactive={envoi}
            lignesContrat={[]}
            avecEcheancier={false}
          />
        ) : null}
      </div>
    </Modal>
  );
}
