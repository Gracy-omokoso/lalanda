'use client';

// Saisie d'une facture fournisseur (ADR-0044 § 2.5, § 3.5), dans le `Modal` de
// `@lalanda/ui` : depuis une commande (`from-order`, lignes préremplies au reste à
// facturer), libre (sans commande, sous-total saisi) ou avoir. Elle naît
// BROUILLON : le rapprochement et la validation se font sur sa fiche.
//
// Aucun total n'est calculé ici : le total TTC est recopié tel qu'imprimé et l'API
// vérifie l'addition ; un doublon de référence est signalé avec la facture existante.

import { Modal, buttonClasses } from '@lalanda/ui';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { purchasesPayablesApi, type SupplierInvoiceView } from '@/lib/api-purchases-payables';
import { treasuryApi, type ExpenseCategoryView } from '@/lib/treasury-api';

import { WorkProjectSelect } from '../../tresorerie/_components/work-project-select';
import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { lienFacture, messageAchats } from './achats-model';
import { ChoixFournisseur } from './commande-formulaire';
import {
  MENTION_TAXES_FACTURE,
  MENTION_TVA_DEDUCTIBLE,
  TYPES_PIECE,
  doublonDe,
  ecartTotalDuRefus,
  formulaireAvoir,
  formulaireDepuisCommande,
  formulaireFactureLibre,
  preparerFacture,
  verifierPiece,
  type FormulaireFacture,
  type ImputationSaisie,
  type LigneFactureSaisie,
} from './factures-model';
import { jourKinshasa } from './receptions-model';

export type SourceFacture =
  | { type: 'libre'; supplierId: string | null }
  | { type: 'commande'; orderId: string }
  | { type: 'avoir'; facture: SupplierInvoiceView };

const TITRES: Record<SourceFacture['type'], [string, string]> = {
  libre: [
    'Saisir une facture fournisseur',
    'Facture sans commande (eau, électricité, petit achat) : recopiez-la telle qu’imprimée.',
  ],
  commande: [
    'Facturer une commande',
    'Les lignes reprennent ce qui reste à facturer sur la commande : ajustez-les à la facture reçue.',
  ],
  avoir: [
    'Saisir un avoir fournisseur',
    'L’avoir diminue ce que vous devez sur la facture d’origine.',
  ],
};

export function FenetreFacture({
  source,
  onFermer,
  onCree,
}: {
  source: SourceFacture;
  onFermer: () => void;
  onCree: (f: SupplierInvoiceView) => void;
}): React.ReactElement {
  const id = useId();
  const aujourdhui = jourKinshasa();
  const [f, setF] = useState<FormulaireFacture | null>(() =>
    source.type === 'libre'
      ? formulaireFactureLibre(aujourdhui, 'USD', source.supplierId ?? '')
      : source.type === 'avoir'
        ? formulaireAvoir(source.facture, aujourdhui)
        : null,
  );
  const [categories, setCategories] = useState<ExpenseCategoryView[] | null>(null);
  const [piece, setPiece] = useState<File | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [doublon, setDoublon] = useState<string | null>(null);
  const [ecartTotal, setEcartTotal] = useState<ReturnType<typeof ecartTotalDuRefus>>(null);
  const [envoi, setEnvoi] = useState(false);
  const [titre, description] = TITRES[source.type];
  const orderId = source.type === 'commande' ? source.orderId : null;

  useEffect(() => {
    if (orderId === null) return;
    let annule = false;
    purchasesPayablesApi
      .prefillFromOrder(orderId)
      .then((p) => {
        if (!annule) setF(formulaireDepuisCommande(p, aujourdhui));
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageAchats(err, 'Préremplissage impossible.'));
      });
    return () => {
      annule = true;
    };
  }, [orderId, aujourdhui]);

  useEffect(() => {
    let annule = false;
    treasuryApi
      .categories()
      .then((c) => {
        if (!annule) setCategories(c);
      })
      .catch(() => {
        if (!annule) setCategories(null);
      });
    return () => {
      annule = true;
    };
  }, []);

  const maj = (patch: Partial<FormulaireFacture>) => setF((p) => (p ? { ...p, ...patch } : p));
  const majLigne = (i: number, patch: Partial<LigneFactureSaisie>) =>
    setF((p) =>
      p ? { ...p, lignes: p.lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : p,
    );
  const majImputation = (i: number, patch: Partial<ImputationSaisie>) =>
    setF((p) =>
      p
        ? { ...p, imputations: p.imputations.map((x, j) => (j === i ? { ...x, ...patch } : x)) }
        : p,
    );

  async function enregistrer(): Promise<void> {
    if (f === null) return;
    setErreur(null);
    setDoublon(null);
    setEcartTotal(null);
    const p = preparerFacture(f, aujourdhui);
    const refusPiece = piece ? verifierPiece(piece) : null;
    const tous = { ...(p.ok ? {} : p.champs), ...(refusPiece ? { piece: refusPiece } : {}) };
    setChamps(tous);
    if (!p.ok || refusPiece) return;
    setEnvoi(true);
    try {
      let cree = await purchasesPayablesApi.createInvoice(p.corps);
      if (piece) {
        try {
          cree = await purchasesPayablesApi.uploadInvoiceAttachment(cree.id, piece);
        } catch {
          /* la fiche dira « sans pièce » : on pourra la joindre de là */
        }
      }
      onCree(cree);
    } catch (err) {
      setDoublon(doublonDe(err));
      setEcartTotal(ecartTotalDuRefus(err));
      setErreur(messageAchats(err, 'Enregistrement impossible.'));
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
            disabled={envoi || f === null}
            onClick={() => void enregistrer()}
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer le brouillon'}
          </button>
        </div>
      }
    >
      {f === null ? (
        erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Lecture de la commande…
          </p>
        )
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            {source.type === 'libre' ? (
              <Champ
                id={`${id}-fournisseur`}
                label="Fournisseur"
                requis
                erreur={champs['supplierId']}
              >
                <ChoixFournisseur
                  id={`${id}-fournisseur`}
                  valeur={f.supplierId}
                  onChange={(s) =>
                    maj({
                      supplierId: s?.id ?? '',
                      currency: s?.defaultCurrency ?? f.currency,
                    })
                  }
                />
              </Champ>
            ) : null}
            <Champ
              id={`${id}-ref`}
              label={
                f.kind === 'credit_note'
                  ? 'N° de l’avoir du fournisseur'
                  : 'N° de la facture du fournisseur'
              }
              requis
              aide="Tel qu’imprimé : il sert à repérer une facture saisie deux fois."
              erreur={champs['supplierReference']}
            >
              <input
                id={`${id}-ref`}
                className={CHAMP}
                value={f.supplierReference}
                maxLength={100}
                onChange={(e) => maj({ supplierReference: e.target.value })}
                {...aria(`${id}-ref`, champs['supplierReference'], true)}
              />
            </Champ>
            <Champ id={`${id}-devise`} label="Devise">
              <select
                id={`${id}-devise`}
                className={CHAMP}
                value={f.currency}
                disabled={source.type !== 'libre'}
                onChange={(e) => maj({ currency: e.target.value as 'USD' | 'CDF' })}
              >
                <option value="USD">USD</option>
                <option value="CDF">CDF</option>
              </select>
            </Champ>
            <Champ
              id={`${id}-date`}
              label="Date de la facture"
              requis
              erreur={champs['invoiceDate']}
            >
              <input
                id={`${id}-date`}
                type="date"
                max={aujourdhui}
                className={CHAMP}
                value={f.invoiceDate}
                onChange={(e) => maj({ invoiceDate: e.target.value })}
                {...aria(`${id}-date`, champs['invoiceDate'])}
              />
            </Champ>
            <Champ id={`${id}-recue`} label="Reçue le" requis erreur={champs['receivedOn']}>
              <input
                id={`${id}-recue`}
                type="date"
                max={aujourdhui}
                className={CHAMP}
                value={f.receivedOn}
                onChange={(e) => maj({ receivedOn: e.target.value })}
                {...aria(`${id}-recue`, champs['receivedOn'])}
              />
            </Champ>
            <Champ
              id={`${id}-echeance`}
              label="Échéance"
              aide="Vide : déduite des conditions de paiement du fournisseur."
              erreur={champs['dueDate']}
            >
              <input
                id={`${id}-echeance`}
                type="date"
                className={CHAMP}
                value={f.dueDate}
                onChange={(e) => maj({ dueDate: e.target.value })}
                {...aria(`${id}-echeance`, champs['dueDate'], true)}
              />
            </Champ>
          </div>

          {f.lignes.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Lignes facturées (HT)</legend>
              {champs['lignes'] ? (
                <p className="text-xs font-medium text-[var(--danger)]">{champs['lignes']}</p>
              ) : null}
              <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
                {f.lignes.map((l, i) => (
                  <li
                    key={`${l.orderLineId ?? 'libre'}-${i}`}
                    className="grid gap-2 p-3 sm:grid-cols-[1fr_6rem_8rem_5rem]"
                  >
                    <span className="self-center font-medium break-words">{l.label}</span>
                    <Champ
                      id={`${id}-q-${i}`}
                      label="Quantité"
                      erreur={champs[`ligne-${i}-quantity`]}
                    >
                      <input
                        id={`${id}-q-${i}`}
                        inputMode="decimal"
                        className={CHAMP}
                        value={l.quantity}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => majLigne(i, { quantity: e.target.value })}
                        {...aria(`${id}-q-${i}`, champs[`ligne-${i}-quantity`])}
                      />
                    </Champ>
                    <Champ
                      id={`${id}-p-${i}`}
                      label="Prix unitaire HT"
                      erreur={champs[`ligne-${i}-unitPrice`]}
                    >
                      <input
                        id={`${id}-p-${i}`}
                        inputMode="decimal"
                        className={CHAMP}
                        value={l.unitPrice}
                        onChange={(e) => majLigne(i, { unitPrice: e.target.value })}
                        {...aria(`${id}-p-${i}`, champs[`ligne-${i}-unitPrice`])}
                      />
                    </Champ>
                    <Champ
                      id={`${id}-r-${i}`}
                      label="Remise %"
                      erreur={champs[`ligne-${i}-discountPercent`]}
                    >
                      <input
                        id={`${id}-r-${i}`}
                        inputMode="decimal"
                        className={CHAMP}
                        value={l.discountPercent}
                        onChange={(e) => majLigne(i, { discountPercent: e.target.value })}
                        {...aria(`${id}-r-${i}`, champs[`ligne-${i}-discountPercent`])}
                      />
                    </Champ>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--foreground-muted)]">
                Le sous-total HT est calculé par Lalanda à l’enregistrement, à partir de ces lignes.
              </p>
            </fieldset>
          ) : (
            <Champ id={`${id}-ht`} label="Sous-total HT" requis erreur={champs['subtotal']}>
              <input
                id={`${id}-ht`}
                inputMode="decimal"
                className={CHAMP}
                value={f.subtotal}
                placeholder="0,00"
                onChange={(e) => maj({ subtotal: e.target.value })}
                {...aria(`${id}-ht`, champs['subtotal'])}
              />
            </Champ>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
              Taxes
              {f.taxes.length < 5 ? (
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  onClick={() => maj({ taxes: [...f.taxes, { label: 'TVA', amount: '' }] })}
                >
                  <Plus aria-hidden="true" className="mr-1 inline h-3 w-3" />
                  Ajouter une taxe
                </button>
              ) : null}
            </legend>
            <p className="text-xs text-[var(--foreground-muted)]">{MENTION_TAXES_FACTURE}</p>
            {f.taxes.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                <Champ id={`${id}-tl-${i}`} label="Libellé" erreur={champs[`taxe-${i}-label`]}>
                  <input
                    id={`${id}-tl-${i}`}
                    className={CHAMP}
                    value={t.label}
                    maxLength={60}
                    onChange={(e) =>
                      maj({
                        taxes: f.taxes.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                    {...aria(`${id}-tl-${i}`, champs[`taxe-${i}-label`])}
                  />
                </Champ>
                <Champ id={`${id}-ta-${i}`} label="Montant" erreur={champs[`taxe-${i}-amount`]}>
                  <input
                    id={`${id}-ta-${i}`}
                    inputMode="decimal"
                    className={CHAMP}
                    value={t.amount}
                    onChange={(e) =>
                      maj({
                        taxes: f.taxes.map((x, j) =>
                          j === i ? { ...x, amount: e.target.value } : x,
                        ),
                      })
                    }
                    {...aria(`${id}-ta-${i}`, champs[`taxe-${i}-amount`])}
                  />
                </Champ>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  aria-label={`Retirer la taxe ${i + 1}`}
                  onClick={() => maj({ taxes: f.taxes.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Champ
              id={`${id}-ttc`}
              label="Total TTC"
              requis
              aide="Tel qu’imprimé sur la facture."
              erreur={champs['total']}
            >
              <input
                id={`${id}-ttc`}
                inputMode="decimal"
                className={CHAMP}
                value={f.total}
                placeholder="0,00"
                onChange={(e) => maj({ total: e.target.value })}
                {...aria(`${id}-ttc`, champs['total'], true)}
              />
            </Champ>
            <Champ
              id={`${id}-tva`}
              label="TVA déductible (facultatif)"
              aide={MENTION_TVA_DEDUCTIBLE}
              erreur={champs['deductibleVat']}
            >
              <input
                id={`${id}-tva`}
                inputMode="decimal"
                className={CHAMP}
                value={f.deductibleVat}
                onChange={(e) => maj({ deductibleVat: e.target.value })}
                {...aria(`${id}-tva`, champs['deductibleVat'], true)}
              />
            </Champ>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
              Imputation (catégorie de dépense, projet)
              {f.imputations.length < 20 ? (
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  onClick={() =>
                    maj({
                      imputations: [
                        ...f.imputations,
                        { category: '', workProjectId: '', amount: '' },
                      ],
                    })
                  }
                >
                  <Plus aria-hidden="true" className="mr-1 inline h-3 w-3" />
                  Répartir sur une autre catégorie
                </button>
              ) : null}
            </legend>
            <p className="text-xs text-[var(--foreground-muted)]">
              Une seule ligne sans montant prend le total. Vide : la catégorie du fournisseur ou de
              la commande est reprise. Le paiement créera les dépenses selon cette répartition.
            </p>
            {champs['imputations'] ? (
              <p className="text-xs font-medium text-[var(--danger)]">{champs['imputations']}</p>
            ) : null}
            {f.imputations.map((x, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 sm:grid-cols-2"
              >
                <Champ
                  id={`${id}-ic-${i}`}
                  label="Catégorie"
                  erreur={champs[`imputation-${i}-category`]}
                >
                  {categories ? (
                    <select
                      id={`${id}-ic-${i}`}
                      className={CHAMP}
                      value={x.category}
                      onChange={(e) => majImputation(i, { category: e.target.value })}
                      {...aria(`${id}-ic-${i}`, champs[`imputation-${i}-category`])}
                    >
                      <option value="">— Reprendre celle du fournisseur —</option>
                      {categories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`${id}-ic-${i}`}
                      className={CHAMP}
                      value={x.category}
                      placeholder="achats"
                      onChange={(e) => majImputation(i, { category: e.target.value.trim() })}
                      {...aria(`${id}-ic-${i}`, champs[`imputation-${i}-category`])}
                    />
                  )}
                </Champ>
                <Champ
                  id={`${id}-im-${i}`}
                  label="Montant TTC"
                  erreur={champs[`imputation-${i}-amount`]}
                >
                  <input
                    id={`${id}-im-${i}`}
                    inputMode="decimal"
                    className={CHAMP}
                    value={x.amount}
                    placeholder={f.imputations.length === 1 ? 'Le total' : '0,00'}
                    onChange={(e) => majImputation(i, { amount: e.target.value })}
                    {...aria(`${id}-im-${i}`, champs[`imputation-${i}-amount`])}
                  />
                </Champ>
                <div className="sm:col-span-2 flex flex-wrap items-end justify-between gap-2">
                  <WorkProjectSelect
                    value={x.workProjectId}
                    onChange={(v) => majImputation(i, { workProjectId: v })}
                    className={CHAMP}
                  />
                  {f.imputations.length > 1 ? (
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      onClick={() => maj({ imputations: f.imputations.filter((_, j) => j !== i) })}
                    >
                      Retirer
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </fieldset>

          <Champ
            id={`${id}-piece`}
            label="Facture scannée"
            aide="PDF (10 Mio) ou photo PNG, JPEG, WebP (2 Mio). Elle peut aussi être jointe plus tard depuis la fiche."
            erreur={champs['piece']}
          >
            <input
              id={`${id}-piece`}
              type="file"
              accept={TYPES_PIECE}
              className="text-sm"
              onChange={(e) => setPiece(e.target.files?.[0] ?? null)}
              {...aria(`${id}-piece`, champs['piece'], true)}
            />
          </Champ>

          {erreur ? (
            <Alerte
              action={
                doublon ? (
                  <Link href={lienFacture(doublon)} className={BOUTON_PETIT}>
                    Ouvrir la facture déjà saisie
                  </Link>
                ) : null
              }
            >
              <p>{erreur}</p>
              {ecartTotal && ecartTotal.attendu ? (
                <p>
                  Sous-total plus taxes : {formatMontant(ecartTotal.attendu, f.currency)} ; total
                  saisi : {formatMontant(ecartTotal.saisi, f.currency)} ; différence :{' '}
                  {formatMontant(ecartTotal.difference.replace(/^[-+]/, ''), f.currency)}.
                </p>
              ) : null}
            </Alerte>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
