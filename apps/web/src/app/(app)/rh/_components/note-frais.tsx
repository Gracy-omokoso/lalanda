'use client';

// Note de frais — fenêtres de saisie et de détail (ADR-0051 § 2.1, § 3.1, § 10 ; lot H16).
//
// Chaque « + » ouvre une fenêtre modale. Le total, la part couverte par une avance et
// le reste à rembourser sont ceux du moteur, par l'API ; l'écran ne fait aucune somme.
// Le justificatif se dépose ligne par ligne (photo du ticket depuis le téléphone) et
// se relit avec la session, jamais par une adresse publique.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import {
  HR_PAYMENT_METHODS,
  HR_PAYMENT_METHOD_LABELS,
  type ExpenseReportView,
  type HrPaymentMethod,
} from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import { rh2Api } from '@/lib/api-rh-2';
import { treasuryApi, type TreasuryAccountView } from '@/lib/treasury-api';

import { WorkProjectSelect } from '../../tresorerie/_components/work-project-select';
import { BOUTON_PETIT, BOUTON_DANGER, CHAMP, Champ } from '../../ventes/_components/form-ui';

import {
  ACCEPT_JUSTIFICATIF,
  CATEGORIES_LIGNE,
  LIBELLES_CATEGORIE,
  LIBELLES_ETAPE,
  LIBELLES_STATUT_NOTE,
  controleJustificatif,
  gestesNote,
  ligneVide,
  lireLigne,
  montant,
  saisieDepuis,
  taille,
  tonStatutNote,
  type LigneLue,
  type Moi,
  type SaisieLigne,
} from './frais-model';
import { messageRh2 } from './rh2-model';
import { ErreurAction, VoirJustificatif } from './rh2-ui';
import { aujourdhui, formatJour } from './rh-model';
import { DialogueDecision } from './rh-ui';

// ── Saisie (création et brouillon) ──────────────────────────────────────────

export function NoteFormulaire({
  note,
  onFermer,
  onEnregistree,
}: {
  /** Brouillon à modifier ; absent : nouvelle note. */
  note?: ExpenseReportView;
  onFermer: () => void;
  onEnregistree: (n: ExpenseReportView) => void;
}): React.ReactElement {
  const id = useId();
  const jour = aujourdhui();
  const [titre, setTitre] = useState(note?.title ?? '');
  const [devise, setDevise] = useState<'CDF' | 'USD'>(note?.currency ?? 'USD');
  const [lignes, setLignes] = useState<SaisieLigne[]>(
    note ? note.lines.map(saisieDepuis) : [ligneVide(jour)],
  );
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const changer = (i: number, p: Partial<SaisieLigne>): void =>
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  async function enregistrer(): Promise<void> {
    const errs: string[] = [];
    if (titre.trim() === '')
      errs.push('Donnez un titre à la note (par exemple « Mission Matadi »).');
    const lues: LigneLue[] = [];
    lignes.forEach((l, i) => {
      const r = lireLigne(l, jour);
      if (r.ok) lues.push(r.ligne);
      else errs.push(...r.erreurs.map((e) => `Ligne ${i + 1} : ${e}`));
    });
    setErreurs(errs);
    if (errs.length > 0) return;
    setErreur(null);
    setEnvoi(true);
    try {
      const n = note
        ? await rh2Api.updateExpenseReport(note.id, {
            expectedRevision: note.revision,
            title: titre.trim(),
            currency: devise,
            lines: lues,
          })
        : await rh2Api.createExpenseReport({ title: titre.trim(), currency: devise, lines: lues });
      onEnregistree(n);
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
      title={note ? 'Modifier le brouillon' : 'Nouvelle note de frais'}
      description="Une note, une devise. Chaque ligne est un montant réellement payé : aucun forfait, aucun barème. Vous joindrez la photo des tickets à l’étape suivante."
      size="lg"
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
            {envoi ? 'Enregistrement…' : 'Enregistrer le brouillon'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Champ id={`${id}-titre`} label="Titre" requis>
            <input
              id={`${id}-titre`}
              className={CHAMP}
              value={titre}
              maxLength={120}
              onChange={(e) => setTitre(e.target.value)}
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
        <ol className="flex flex-col gap-3">
          {lignes.map((l, i) => (
            <li
              key={l.id ?? `n${i}`}
              className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase text-[var(--foreground-muted)]">
                  Ligne {i + 1}
                </span>
                {lignes.length > 1 ? (
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))}
                  >
                    Retirer
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Champ id={`${id}-${i}-date`} label="Date" requis>
                  <input
                    id={`${id}-${i}-date`}
                    type="date"
                    max={jour}
                    className={CHAMP}
                    value={l.spentOn}
                    onChange={(e) => changer(i, { spentOn: e.target.value })}
                  />
                </Champ>
                <Champ id={`${id}-${i}-cat`} label="Catégorie" requis>
                  <select
                    id={`${id}-${i}-cat`}
                    className={CHAMP}
                    value={l.category}
                    onChange={(e) =>
                      changer(i, { category: e.target.value as SaisieLigne['category'] })
                    }
                  >
                    <option value="">— Choisir —</option>
                    {CATEGORIES_LIGNE.map((c) => (
                      <option key={c} value={c}>
                        {LIBELLES_CATEGORIE[c]}
                      </option>
                    ))}
                  </select>
                </Champ>
                <Champ id={`${id}-${i}-montant`} label={`Montant (${devise})`} requis>
                  <input
                    id={`${id}-${i}-montant`}
                    inputMode="decimal"
                    className={CHAMP}
                    value={l.amount}
                    placeholder="15,00"
                    onChange={(e) => changer(i, { amount: e.target.value })}
                  />
                </Champ>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Champ id={`${id}-${i}-lib`} label="Ce qui a été payé" requis>
                  <input
                    id={`${id}-${i}-lib`}
                    className={CHAMP}
                    value={l.label}
                    maxLength={200}
                    placeholder="Taxi aéroport – bureau"
                    onChange={(e) => changer(i, { label: e.target.value })}
                  />
                </Champ>
                <Champ id={`${id}-${i}-march`} label="Commerçant (facultatif)">
                  <input
                    id={`${id}-${i}-march`}
                    className={CHAMP}
                    value={l.merchant}
                    maxLength={120}
                    onChange={(e) => changer(i, { merchant: e.target.value })}
                  />
                </Champ>
              </div>
              <WorkProjectSelect
                value={l.workProjectId}
                className={CHAMP}
                onChange={(p) =>
                  changer(i, { workProjectId: p, rebillable: p ? l.rebillable : false })
                }
              />
              {l.workProjectId ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={l.rebillable}
                    onChange={(e) => changer(i, { rebillable: e.target.checked })}
                  />
                  À refacturer au client (simple marque : aucune facture n’est créée)
                </label>
              ) : null}
              <Champ
                id={`${id}-${i}-motif`}
                label="Pas de ticket ? Dites pourquoi"
                aide="Exigé si la ligne n’a pas de justificatif quand votre organisation le demande."
              >
                <input
                  id={`${id}-${i}-motif`}
                  className={CHAMP}
                  value={l.missingReceiptReason}
                  maxLength={300}
                  onChange={(e) => changer(i, { missingReceiptReason: e.target.value })}
                />
              </Champ>
            </li>
          ))}
        </ol>
        {lignes.length < 50 ? (
          <button
            type="button"
            className={`${BOUTON_PETIT} self-start`}
            onClick={() => setLignes((ls) => [...ls, ligneVide(jour)])}
          >
            + Ajouter une ligne
          </button>
        ) : null}
        {erreurs.length > 0 ? (
          <ul role="alert" className="list-disc pl-5 text-xs font-medium text-[var(--danger)]">
            {erreurs.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}

// ── Paiement (remboursement d'une note, versement d'une avance) ─────────────

export function PaiementDialogue({
  titre,
  description,
  devise,
  compteObligatoire,
  onFermer,
  onPayer,
}: {
  titre: string;
  description: string;
  devise: 'CDF' | 'USD';
  compteObligatoire: boolean;
  onFermer: () => void;
  onPayer: (p: {
    paidOn: string;
    accountId: string | null;
    method: HrPaymentMethod;
    reference?: string;
  }) => Promise<void>;
}): React.ReactElement {
  const id = useId();
  const [comptes, setComptes] = useState<TreasuryAccountView[] | null>(null);
  const [jour, setJour] = useState(aujourdhui());
  const [compte, setCompte] = useState('');
  const [moyen, setMoyen] = useState<HrPaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    treasuryApi
      .listAccounts()
      .then((p) => {
        if (!annule) setComptes(p.items.filter((c) => c.active && c.currency === devise));
      })
      .catch(() => {
        if (!annule) setComptes([]);
      });
    return () => {
      annule = true;
    };
  }, [devise]);

  async function payer(): Promise<void> {
    if (compteObligatoire && compte === '') {
      setErreur('Choisissez le compte qui paie.');
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      await onPayer({
        paidOn: jour,
        accountId: compte || null,
        method: moyen,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
    } catch (err) {
      setErreur(messageRh2(err, 'Paiement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={titre}
      description={description}
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
            onClick={() => void payer()}
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer le paiement'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <Champ id={`${id}-jour`} label="Date du paiement" requis>
          <input
            id={`${id}-jour`}
            type="date"
            className={CHAMP}
            value={jour}
            onChange={(e) => setJour(e.target.value)}
          />
        </Champ>
        <Champ
          id={`${id}-compte`}
          label="Compte qui paie"
          requis={compteObligatoire}
          aide={`Comptes actifs en ${devise}. Les coordonnées bancaires du collaborateur ne sont jamais affichées ici.`}
        >
          <select
            id={`${id}-compte`}
            className={CHAMP}
            value={compte}
            onChange={(e) => setCompte(e.target.value)}
          >
            <option value="">{compteObligatoire ? '— Choisir —' : '— Sans compte —'}</option>
            {(comptes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Champ>
        <Champ id={`${id}-moyen`} label="Moyen" requis>
          <select
            id={`${id}-moyen`}
            className={CHAMP}
            value={moyen}
            onChange={(e) => setMoyen(e.target.value as HrPaymentMethod)}
          >
            {HR_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {HR_PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Champ>
        <Champ id={`${id}-ref`} label="Référence (facultatif)">
          <input
            id={`${id}-ref`}
            className={CHAMP}
            value={reference}
            maxLength={120}
            onChange={(e) => setReference(e.target.value)}
          />
        </Champ>
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}

// ── Détail ──────────────────────────────────────────────────────────────────

type Dialogue =
  'modifier' | 'valider' | 'refuser' | 'annuler' | 'rembourser' | 'annuler-remboursement' | null;

export function NoteDetail({
  note: initiale,
  moi,
  actions,
  dansAValider,
  onFermer,
  onChangee,
}: {
  note: ExpenseReportView;
  moi: Moi;
  actions: readonly OrgAction[] | null;
  dansAValider: boolean;
  onFermer: () => void;
  onChangee: (n: ExpenseReportView | null) => void;
}): React.ReactElement {
  const [note, setNote] = useState(initiale);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const g = gestesNote(note, moi, actions, dansAValider);

  function remplacer(n: ExpenseReportView): void {
    setNote(n);
    setDialogue(null);
    onChangee(n);
  }

  async function agir(f: () => Promise<ExpenseReportView>, repli: string): Promise<void> {
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

  async function joindre(lineId: string, fichier: File | undefined): Promise<void> {
    if (!fichier) return;
    const refus = controleJustificatif(fichier);
    if (refus) {
      setErreur(refus);
      return;
    }
    await agir(
      () => rh2Api.uploadReceipt(note.id, lineId, fichier),
      'Envoi du justificatif impossible.',
    );
  }

  async function supprimer(): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      await rh2Api.deleteExpenseReport(note.id);
      onChangee(null);
      onFermer();
    } catch (err) {
      setErreur(messageRh2(err, 'Suppression impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  const brouillon = note.status === 'draft' && g.modifier;

  return (
    <>
      <Modal
        open={dialogue !== 'modifier'}
        onClose={onFermer}
        title={`${note.number ?? 'Brouillon'} · ${note.title}`}
        description={`${note.employeeName} · ${note.currency}`}
        size="lg"
        busy={envoi}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {brouillon ? (
              <>
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  disabled={envoi}
                  onClick={() => void supprimer()}
                >
                  Supprimer le brouillon
                </button>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  disabled={envoi}
                  onClick={() => setDialogue('modifier')}
                >
                  Modifier
                </button>
              </>
            ) : null}
            {g.annuler ? (
              <button
                type="button"
                className={BOUTON_PETIT}
                disabled={envoi}
                onClick={() => setDialogue('annuler')}
              >
                Annuler la note
              </button>
            ) : null}
            {g.dupliquer ? (
              <button
                type="button"
                className={BOUTON_PETIT}
                disabled={envoi}
                onClick={() =>
                  void agir(() => rh2Api.duplicateExpenseReport(note.id), 'Copie impossible.')
                }
              >
                Copier en brouillon
              </button>
            ) : null}
            {g.annulerRemboursement ? (
              <button
                type="button"
                className={BOUTON_PETIT}
                disabled={envoi}
                onClick={() => setDialogue('annuler-remboursement')}
              >
                Annuler le remboursement
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
            {g.rembourser ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={envoi}
                onClick={() => setDialogue('rembourser')}
              >
                Rembourser
              </button>
            ) : null}
            {g.soumettre ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={envoi}
                onClick={() =>
                  void agir(
                    () => rh2Api.submitExpenseReport(note.id, note.revision),
                    'Envoi impossible.',
                  )
                }
              >
                Envoyer pour validation
              </button>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={tonStatutNote(note.status)}>{LIBELLES_STATUT_NOTE[note.status]}</Badge>
            <span className="font-display text-lg font-bold tabular-nums">
              {montant(note.total, note.currency)}
            </span>
            {note.toReimburse ? (
              <span className="text-[var(--foreground-muted)]">
                À rembourser : {montant(note.toReimburse, note.currency)}
              </span>
            ) : null}
            {note.advanceNumber ? (
              <span className="text-[var(--foreground-muted)]">
                Justifie l’avance {note.advanceNumber}
              </span>
            ) : null}
          </div>
          {g.phrase ? (
            <p className="rounded-[var(--radius-md)] border border-[var(--warn)]/50 p-3">
              {g.phrase}
            </p>
          ) : null}
          {note.settlement ? (
            <p className="text-[var(--foreground-muted)]">
              Couvert par l’avance : {montant(note.settlement.fromAdvance, note.currency)} ·
              complément dû : {montant(note.settlement.topUp, note.currency)}
            </p>
          ) : null}
          <ol className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
            {note.lines.map((l) => (
              <li key={l.id} className="flex flex-col gap-1.5 p-3">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium break-words">{l.label}</span>
                  <span className="tabular-nums">{montant(l.amount, note.currency)}</span>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {formatJour(l.spentOn)} · {LIBELLES_CATEGORIE[l.category]}
                  {l.merchant ? ` · ${l.merchant}` : ''}
                  {l.workProjectId ? ' · imputée à un projet' : ''}
                  {l.rebillable ? ' · à refacturer' : ''}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  {l.receipt ? (
                    <>
                      <span className="text-[var(--foreground-muted)]">
                        Justificatif joint ({taille(l.receipt.size)})
                      </span>
                      <VoirJustificatif reportId={note.id} lineId={l.id} libelle={l.label} />
                    </>
                  ) : l.hasReceipt ? (
                    <span className="text-[var(--foreground-muted)]">
                      Justificatif joint (non visible avec vos droits)
                    </span>
                  ) : l.missingReceiptReason ? (
                    <span className="text-[var(--foreground-muted)]">
                      Sans justificatif : {l.missingReceiptReason}
                    </span>
                  ) : (
                    <span className="text-[var(--foreground-muted)]">Aucun justificatif</span>
                  )}
                  {brouillon ? (
                    <label className={`${BOUTON_PETIT} cursor-pointer`}>
                      {l.hasReceipt ? 'Remplacer le ticket' : 'Ajouter la photo du ticket'}
                      <input
                        type="file"
                        accept={ACCEPT_JUSTIFICATIF}
                        capture="environment"
                        className="sr-only"
                        disabled={envoi}
                        onChange={(e) => void joindre(l.id, e.target.files?.[0])}
                      />
                    </label>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          {note.byCategory.length > 1 ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Par catégorie :{' '}
              {note.byCategory
                .map((c) => `${LIBELLES_CATEGORIE[c.category]} ${montant(c.total, note.currency)}`)
                .join(' · ')}
            </p>
          ) : null}
          {note.approvals.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase text-[var(--foreground-muted)]">
                Décisions
              </p>
              <ul className="flex flex-col gap-1 text-xs">
                {note.approvals.map((x) => (
                  <li key={`${x.step}-${x.at}`}>
                    {LIBELLES_ETAPE[x.step]} : {x.decision === 'approved' ? 'validée' : 'refusée'}{' '}
                    par {x.userName ?? 'une personne habilitée'}
                    {x.onBehalfOfManager ? ' (en suppléance du manager)' : ''}
                    {x.soleApprover ? ' — approbateur unique' : ''}
                    {x.comment ? ` — « ${x.comment} »` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {note.currentStep ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Étape en cours : {LIBELLES_ETAPE[note.currentStep]}.
            </p>
          ) : null}
          {note.reimbursement ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Remboursée le {formatJour(note.reimbursement.paidOn)} ·{' '}
              {HR_PAYMENT_METHOD_LABELS[note.reimbursement.method]}
              {note.reimbursement.reference ? ` · ${note.reimbursement.reference}` : ''}
              {note.reimbursement.soleApprover ? ' · payeur unique' : ''}
            </p>
          ) : null}
          {note.cancelReason ? (
            <p className="text-xs text-[var(--foreground-muted)]">Motif : {note.cancelReason}</p>
          ) : null}
          <ErreurAction erreur={erreur} />
        </div>
      </Modal>

      {dialogue === 'modifier' ? (
        <NoteFormulaire note={note} onFermer={() => setDialogue(null)} onEnregistree={remplacer} />
      ) : null}
      {dialogue === 'valider' ? (
        <DialogueDecision
          titre="Valider la note"
          libelle="Commentaire (facultatif)"
          bouton="Valider"
          commentaire="facultatif"
          onFermer={() => setDialogue(null)}
          onValider={async (t) =>
            remplacer(
              await rh2Api.approveExpenseReport(note.id, {
                expectedRevision: note.revision,
                ...(t ? { comment: t } : {}),
              }),
            )
          }
        />
      ) : null}
      {dialogue === 'refuser' ? (
        <DialogueDecision
          titre="Refuser la note"
          description="Le refus clôt la note. Le collaborateur pourra la copier en brouillon pour la corriger."
          libelle="Pourquoi ?"
          bouton="Refuser"
          commentaire="obligatoire"
          onFermer={() => setDialogue(null)}
          onValider={async (t) =>
            remplacer(
              await rh2Api.rejectExpenseReport(note.id, {
                expectedRevision: note.revision,
                comment: t,
              }),
            )
          }
        />
      ) : null}
      {dialogue === 'annuler' ? (
        <DialogueDecision
          titre="Annuler la note"
          libelle="Motif"
          bouton="Annuler la note"
          commentaire={note.status === 'approved' ? 'obligatoire' : 'facultatif'}
          onFermer={() => setDialogue(null)}
          onValider={async (t) =>
            remplacer(
              await rh2Api.cancelExpenseReport(note.id, {
                expectedRevision: note.revision,
                ...(t ? { reason: t } : {}),
              }),
            )
          }
        />
      ) : null}
      {dialogue === 'annuler-remboursement' ? (
        <DialogueDecision
          titre="Annuler le remboursement"
          description="Les dépenses créées en trésorerie sont annulées ; la note revient à « approuvée »."
          libelle="Motif"
          bouton="Annuler le remboursement"
          commentaire="obligatoire"
          onFermer={() => setDialogue(null)}
          onValider={async (t) =>
            remplacer(
              await rh2Api.cancelReimbursement(note.id, {
                expectedRevision: note.revision,
                reason: t,
              }),
            )
          }
        />
      ) : null}
      {dialogue === 'rembourser' ? (
        <PaiementDialogue
          titre={`Rembourser ${note.number ?? 'la note'}`}
          description={`Montant à rembourser : ${montant(note.toReimburse ?? note.total, note.currency)} (calculé par Lalanda). Une dépense par ligne est créée en trésorerie, libellée sans le nom du collaborateur.`}
          devise={note.currency}
          compteObligatoire={false}
          onFermer={() => setDialogue(null)}
          onPayer={async (p) =>
            remplacer(
              await rh2Api.reimburseExpenseReport(note.id, {
                expectedRevision: note.revision,
                ...p,
              }),
            )
          }
        />
      ) : null}
    </>
  );
}
