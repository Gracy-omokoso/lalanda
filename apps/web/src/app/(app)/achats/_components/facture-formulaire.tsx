'use client';

// Saisie d'une facture fournisseur (ADR-0044 § 2.5, § 3.5), dans le `Modal` de
// `@lalanda/ui` : depuis une commande (`from-order`, lignes préremplies au reste à
// facturer), libre (sans commande, sous-total saisi) ou avoir. Elle naît
// BROUILLON : le rapprochement et la validation se font sur sa fiche.
//
// Aucun total n'est calculé ici : le total TTC est recopié tel qu'imprimé et l'API
// vérifie l'addition ; un doublon de référence est signalé avec la facture existante.
//
// ADR-0074 : fournisseur en `EntityPicker` avec création rapide, dates en
// `DatePicker` (bornées à aujourd'hui comme avant), devise en segments,
// montants en `MoneyInput` (mise en forme seulement : la valeur reste la chaîne
// décimale lue par `preparerFacture`), validation à la sortie du champ.

import {
  Button,
  DatePicker,
  ErrorSummary,
  Field,
  FormGrid,
  Modal,
  MoneyInput,
  SegmentedControl,
  Select,
  TextInput,
  estRaccourciEnregistrer,
  resumerErreurs,
  useBlurValidation,
} from '@lalanda/ui';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { purchasesPayablesApi, type SupplierInvoiceView } from '@/lib/api-purchases-payables';
import { treasuryApi, type ExpenseCategoryView } from '@/lib/treasury-api';

import { WorkProjectSelect } from '../../tresorerie/_components/work-project-select';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
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

  // Validation à la sortie du champ (ADR-0074 § 9) : les règles de l'envoi.
  const {
    errors: erreursSaisie,
    touch,
    validateAll,
    submitCount: soumissions,
  } = useBlurValidation<string>(() => {
    if (f === null) return {};
    const p = preparerFacture(f, aujourdhui);
    return p.ok ? {} : p.champs;
  });

  async function enregistrer(): Promise<void> {
    if (f === null) return;
    validateAll();
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

  // Erreurs de la saisie (sortie du champ, ou toutes après un essai), et refus
  // de la pièce jointe, vérifiée seulement à l'enregistrement.
  const affiches: Record<string, string | undefined> = {
    ...erreursSaisie,
    ...(champs['piece'] ? { piece: champs['piece'] } : {}),
  };
  const mettreTaxe = (i: number, patch: Partial<FormulaireFacture['taxes'][number]>) =>
    f ? maj({ taxes: f.taxes.map((x, j) => (j === i ? { ...x, ...patch } : x)) }) : undefined;

  return (
    <Modal
      open
      onClose={onFermer}
      title={titre}
      description={description}
      size="lg"
      busy={envoi}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button onClick={onFermer} disabled={envoi} className="max-sm:h-11">
            Retour
          </Button>
          <Button
            variant="primary"
            busy={envoi}
            disabled={f === null}
            onClick={() => void enregistrer()}
            className="max-sm:h-11"
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer le brouillon'}
          </Button>
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
        <div
          className="flex min-w-0 flex-col gap-5 text-sm"
          // Cmd/Ctrl+Entrée enregistre, comme dans les autres formulaires (ADR-0074 § 9).
          onKeyDown={(e) => {
            if (estRaccourciEnregistrer(e) && !envoi) {
              e.preventDefault();
              void enregistrer();
            }
          }}
        >
          <ErrorSummary
            errors={resumerErreurs(affiches, [
              { cle: 'supplierId', id: `${id}-fournisseur`, libelle: 'Fournisseur' },
              { cle: 'supplierReference', id: `${id}-ref`, libelle: 'N° de la facture' },
              { cle: 'invoiceDate', id: `${id}-date`, libelle: 'Date de la facture' },
              { cle: 'receivedOn', id: `${id}-recue`, libelle: 'Reçue le' },
              { cle: 'dueDate', id: `${id}-echeance`, libelle: 'Échéance' },
              { cle: 'subtotal', id: `${id}-ht`, libelle: 'Sous-total HT' },
              { cle: 'total', id: `${id}-ttc`, libelle: 'Total TTC' },
              { cle: 'deductibleVat', id: `${id}-tva`, libelle: 'TVA déductible' },
              { cle: 'piece', id: `${id}-piece`, libelle: 'Facture scannée' },
            ])}
            submitCount={soumissions}
          />
          <FormGrid>
            {source.type === 'libre' ? (
              <Field
                id={`${id}-fournisseur`}
                label="Fournisseur"
                required
                size="lg"
                hint="Tapez un nom ou un NIF. Absent : « + » le crée sans quitter la facture."
                error={affiches['supplierId']}
              >
                <ChoixFournisseur
                  id={`${id}-fournisseur`}
                  valeur={f.supplierId}
                  onChange={(s) => {
                    maj({
                      supplierId: s?.id ?? '',
                      currency: s?.defaultCurrency ?? f.currency,
                    });
                    touch('supplierId');
                  }}
                />
              </Field>
            ) : null}
            <Field
              id={`${id}-ref`}
              label={
                f.kind === 'credit_note'
                  ? 'N° de l’avoir du fournisseur'
                  : 'N° de la facture du fournisseur'
              }
              required
              size="md"
              newRow
              hint="Tel qu’imprimé : il sert à repérer une facture saisie deux fois."
              error={affiches['supplierReference']}
            >
              <TextInput
                value={f.supplierReference}
                maxLength={100}
                onChange={(e) => maj({ supplierReference: e.target.value })}
                onBlur={() => touch('supplierReference')}
                className="font-mono"
              />
            </Field>
            <Field id={`${id}-devise`} label="Devise" group size="sm">
              <SegmentedControl<'USD' | 'CDF'>
                value={f.currency}
                disabled={source.type !== 'libre'}
                onChange={(v) => maj({ currency: v })}
                options={[
                  { value: 'USD', label: 'USD' },
                  { value: 'CDF', label: 'CDF' },
                ]}
              />
            </Field>
            <Field
              id={`${id}-date`}
              label="Date de la facture"
              required
              size="sm"
              newRow
              error={affiches['invoiceDate']}
            >
              <DatePicker
                value={f.invoiceDate}
                max={aujourdhui}
                onChange={(v) => {
                  maj({ invoiceDate: v });
                  touch('invoiceDate');
                }}
                onBlur={() => touch('invoiceDate')}
                shortcuts={['today']}
              />
            </Field>
            <Field
              id={`${id}-recue`}
              label="Reçue le"
              required
              size="sm"
              error={affiches['receivedOn']}
            >
              <DatePicker
                value={f.receivedOn}
                max={aujourdhui}
                onChange={(v) => {
                  maj({ receivedOn: v });
                  touch('receivedOn');
                }}
                onBlur={() => touch('receivedOn')}
                shortcuts={['today']}
              />
            </Field>
            <Field
              id={`${id}-echeance`}
              label="Échéance"
              optional
              size="sm"
              hint="Vide : déduite des conditions de paiement du fournisseur."
              error={affiches['dueDate']}
            >
              <DatePicker
                value={f.dueDate}
                {...(f.invoiceDate ? { min: f.invoiceDate } : {})}
                onChange={(v) => {
                  maj({ dueDate: v });
                  touch('dueDate');
                }}
                onBlur={() => touch('dueDate')}
                shortcuts={['plus30', 'endOfMonth']}
              />
            </Field>
          </FormGrid>

          {f.lignes.length > 0 ? (
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Lignes facturées (HT)</legend>
              {affiches['lignes'] ? (
                <p className="text-xs font-medium text-[var(--danger)]">{affiches['lignes']}</p>
              ) : null}
              <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
                {f.lignes.map((l, i) => (
                  <li
                    key={`${l.orderLineId ?? 'libre'}-${i}`}
                    className="flex min-w-0 flex-col gap-2 p-3"
                  >
                    <span className="font-medium break-words">{l.label}</span>
                    <FormGrid>
                      <Field
                        id={`${id}-q-${i}`}
                        label="Quantité"
                        size="xs"
                        error={affiches[`ligne-${i}-quantity`]}
                      >
                        <TextInput
                          inputMode="decimal"
                          value={l.quantity}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => majLigne(i, { quantity: e.target.value })}
                          onBlur={() => touch(`ligne-${i}-quantity`)}
                          className="text-right tabular-nums"
                        />
                      </Field>
                      <Field
                        id={`${id}-p-${i}`}
                        label="Prix unitaire HT"
                        size="sm"
                        error={affiches[`ligne-${i}-unitPrice`]}
                      >
                        <MoneyInput
                          value={l.unitPrice}
                          currency={f.currency}
                          onChange={(v) => majLigne(i, { unitPrice: v })}
                          onBlur={() => touch(`ligne-${i}-unitPrice`)}
                        />
                      </Field>
                      <Field
                        id={`${id}-r-${i}`}
                        label="Remise"
                        optional
                        size="xs"
                        error={affiches[`ligne-${i}-discountPercent`]}
                      >
                        <TextInput
                          inputMode="decimal"
                          value={l.discountPercent}
                          onChange={(e) => majLigne(i, { discountPercent: e.target.value })}
                          onBlur={() => touch(`ligne-${i}-discountPercent`)}
                          trailing="%"
                          className="text-right tabular-nums"
                        />
                      </Field>
                    </FormGrid>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--foreground-muted)]">
                Le sous-total HT est calculé par Lalanda à l’enregistrement, à partir de ces lignes.
              </p>
            </fieldset>
          ) : (
            <FormGrid>
              <Field
                id={`${id}-ht`}
                label="Sous-total HT"
                required
                size="sm"
                error={affiches['subtotal']}
              >
                <MoneyInput
                  value={f.subtotal}
                  currency={f.currency}
                  placeholder="0,00"
                  onChange={(v) => maj({ subtotal: v })}
                  onBlur={() => touch('subtotal')}
                />
              </Field>
            </FormGrid>
          )}

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">Taxes</legend>
            <p className="text-xs text-[var(--foreground-muted)]">{MENTION_TAXES_FACTURE}</p>
            {f.taxes.map((t, i) => (
              <div key={i} className="flex min-w-0 items-end gap-2">
                <FormGrid className="min-w-0 flex-1">
                  <Field
                    id={`${id}-tl-${i}`}
                    label="Libellé"
                    size="md"
                    error={affiches[`taxe-${i}-label`]}
                  >
                    <TextInput
                      value={t.label}
                      maxLength={60}
                      onChange={(e) => mettreTaxe(i, { label: e.target.value })}
                      onBlur={() => touch(`taxe-${i}-label`)}
                    />
                  </Field>
                  <Field
                    id={`${id}-ta-${i}`}
                    label="Montant"
                    size="sm"
                    error={affiches[`taxe-${i}-amount`]}
                  >
                    <MoneyInput
                      value={t.amount}
                      currency={f.currency}
                      onChange={(v) => mettreTaxe(i, { amount: v })}
                      onBlur={() => touch(`taxe-${i}-amount`)}
                    />
                  </Field>
                </FormGrid>
                <button
                  type="button"
                  className={`${BOUTON_PETIT} mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center p-0 max-sm:h-11 max-sm:w-11`}
                  aria-label={`Retirer la taxe ${i + 1}`}
                  onClick={() => maj({ taxes: f.taxes.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            ))}
            {f.taxes.length < 5 ? (
              <button
                type="button"
                className={`${BOUTON_PETIT} inline-flex items-center gap-1 self-start max-sm:h-11`}
                onClick={() => maj({ taxes: [...f.taxes, { label: 'TVA', amount: '' }] })}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Ajouter une taxe
              </button>
            ) : null}
          </fieldset>

          <FormGrid>
            <Field
              id={`${id}-ttc`}
              label="Total TTC"
              required
              size="sm"
              hint="Tel qu’imprimé sur la facture."
              error={affiches['total']}
            >
              <MoneyInput
                value={f.total}
                currency={f.currency}
                placeholder="0,00"
                onChange={(v) => maj({ total: v })}
                onBlur={() => touch('total')}
              />
            </Field>
            <Field
              id={`${id}-tva`}
              label="TVA déductible"
              optional
              size="sm"
              hint={MENTION_TVA_DEDUCTIBLE}
              error={affiches['deductibleVat']}
            >
              <MoneyInput
                value={f.deductibleVat}
                currency={f.currency}
                onChange={(v) => maj({ deductibleVat: v })}
                onBlur={() => touch('deductibleVat')}
              />
            </Field>
          </FormGrid>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">
              Imputation (catégorie de dépense, projet)
            </legend>
            <p className="text-xs text-[var(--foreground-muted)]">
              Une seule ligne sans montant prend le total. Vide : la catégorie du fournisseur ou de
              la commande est reprise. Le paiement créera les dépenses selon cette répartition.
            </p>
            {affiches['imputations'] ? (
              <p className="text-xs font-medium text-[var(--danger)]">{affiches['imputations']}</p>
            ) : null}
            {f.imputations.map((x, i) => (
              <div
                key={i}
                className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
              >
                <FormGrid>
                  <Field
                    id={`${id}-ic-${i}`}
                    label="Catégorie"
                    size="md"
                    error={affiches[`imputation-${i}-category`]}
                  >
                    {categories ? (
                      <Select<string>
                        value={x.category}
                        onChange={(v) => {
                          majImputation(i, { category: v });
                          touch(`imputation-${i}-category`);
                        }}
                        options={[
                          { value: '', label: '— Reprendre celle du fournisseur —' },
                          ...categories.map((c) => ({
                            value: c.code,
                            label: c.label,
                            keywords: c.code,
                          })),
                        ]}
                      />
                    ) : (
                      <TextInput
                        value={x.category}
                        placeholder="achats"
                        onChange={(e) => majImputation(i, { category: e.target.value.trim() })}
                        onBlur={() => touch(`imputation-${i}-category`)}
                      />
                    )}
                  </Field>
                  <Field
                    id={`${id}-im-${i}`}
                    label="Montant TTC"
                    size="sm"
                    error={affiches[`imputation-${i}-amount`]}
                  >
                    <MoneyInput
                      value={x.amount}
                      currency={f.currency}
                      placeholder={f.imputations.length === 1 ? 'Le total' : '0,00'}
                      onChange={(v) => majImputation(i, { amount: v })}
                      onBlur={() => touch(`imputation-${i}-amount`)}
                    />
                  </Field>
                  <WorkProjectSelect
                    id={`${id}-ip-${i}`}
                    value={x.workProjectId}
                    onChange={(v) => majImputation(i, { workProjectId: v })}
                  />
                </FormGrid>
                {f.imputations.length > 1 ? (
                  <button
                    type="button"
                    className={`${BOUTON_PETIT} self-end max-sm:h-11`}
                    onClick={() => maj({ imputations: f.imputations.filter((_, j) => j !== i) })}
                  >
                    Retirer
                  </button>
                ) : null}
              </div>
            ))}
            {f.imputations.length < 20 ? (
              <button
                type="button"
                className={`${BOUTON_PETIT} inline-flex items-center gap-1 self-start max-sm:h-11`}
                onClick={() =>
                  maj({
                    imputations: [
                      ...f.imputations,
                      { category: '', workProjectId: '', amount: '' },
                    ],
                  })
                }
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Répartir sur une autre catégorie
              </button>
            ) : null}
          </fieldset>

          <FormGrid>
            <Field
              id={`${id}-piece`}
              label="Facture scannée"
              optional
              size="full"
              hint="PDF (10 Mio) ou photo PNG, JPEG, WebP (2 Mio). Elle peut aussi être jointe plus tard depuis la fiche."
              error={affiches['piece']}
            >
              {({ id: idPiece, describedBy, invalid }) => (
                <input
                  id={idPiece}
                  type="file"
                  accept={TYPES_PIECE}
                  className="text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-3 file:py-1.5 file:text-sm file:font-medium"
                  onChange={(e) => setPiece(e.target.files?.[0] ?? null)}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                />
              )}
            </Field>
          </FormGrid>

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
