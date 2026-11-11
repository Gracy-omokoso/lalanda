'use client';

// Paiement fournisseur (ADR-0044 § 2.6, § 6.2), dans le `Modal` de `@lalanda/ui` :
// un montant payé, réparti sur une ou plusieurs factures validées du même
// fournisseur et de la même devise. Le paiement CRÉE les dépenses de la trésorerie
// (côté API). Second mode : rattacher une dépense déjà saisie (`from-expense`),
// pour ne pas compter deux fois la même sortie d'argent (O3).
//
// Aucun montant n'est calculé ici : le reste de chaque facture est recopié de
// l'API, le montant payé est saisi, l'API vérifie l'égalité.
//
// ADR-0074 : date en `DatePicker`, montants en `MoneyInput` (mise en forme
// seulement), compte et moyen en `Select`, mode en segments, factures en cases
// stylées, dépense à rattacher en cartes de choix. Mêmes champs envoyés.

import {
  Button,
  Checkbox,
  ChoiceCards,
  DatePicker,
  Field,
  FormGrid,
  Modal,
  MoneyInput,
  SegmentedControl,
  Select,
  TextInput,
} from '@lalanda/ui';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import type { PurchaseCurrency, SupplierPaymentChannel } from '@lalanda/shared/purchases';

import {
  purchasesPayablesApi,
  type PossibleDuplicateView,
  type SupplierPaymentView,
} from '@/lib/api-purchases-payables';
import { treasuryApi, type TreasuryAccountView } from '@/lib/treasury-api';

import { Alerte } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import { formatJour, messageAchats } from './achats-model';
import {
  ALERTE_DOUBLE_COMPTE,
  LIBELLES_MOYEN,
  basculerImputation,
  depensesRattachables,
  facturesPayables,
  formulairePaiement,
  phraseDoublon,
  preparerPaiement,
  preparerRattachement,
  type DepenseCandidate,
  type FormulairePaiement,
  type ImputationPaiement,
} from './a-payer-model';
import { jourKinshasa } from './receptions-model';

function ListeImputations({
  idBase,
  imputations,
  devise,
  champs,
  onBasculer,
  onMontant,
}: {
  idBase: string;
  imputations: ImputationPaiement[];
  devise: PurchaseCurrency;
  champs: Record<string, string>;
  onBasculer: (invoiceId: string) => void;
  onMontant: (invoiceId: string, montant: string) => void;
}): React.ReactElement {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">Factures réglées par ce paiement</legend>
      {champs['imputations'] ? (
        <p className="text-xs font-medium text-[var(--danger)]">{champs['imputations']}</p>
      ) : null}
      {imputations.length === 0 ? (
        <p className="text-[var(--foreground-muted)]">
          Aucune facture validée à payer chez ce fournisseur dans cette devise.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
          {imputations.map((x) => (
            <li
              key={x.invoiceId}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <Checkbox
                checked={x.choisie}
                onChange={() => onBasculer(x.invoiceId)}
                label={<span className="font-medium break-words">{x.libelle}</span>}
                description={`Reste à payer ${formatMontant(x.reste, devise)} · échéance ${formatJour(x.echeance)}`}
                className="min-w-0 flex-1"
              />
              {x.choisie ? (
                <Field
                  id={`${idBase}-${x.invoiceId}`}
                  label="Montant réglé"
                  className="sm:w-44"
                  error={champs[`imputation-${x.invoiceId}`]}
                >
                  <MoneyInput
                    value={x.montant}
                    currency={devise}
                    onChange={(v) => onMontant(x.invoiceId, v)}
                  />
                </Field>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export function FenetrePaiement({
  supplierId,
  currency,
  preselection,
  onFermer,
  onPaye,
}: {
  supplierId: string;
  currency: PurchaseCurrency;
  preselection: readonly string[];
  onFermer: () => void;
  onPaye: (p: SupplierPaymentView, mode: 'paiement' | 'rattachement') => void;
}): React.ReactElement {
  const id = useId();
  const aujourdhui = jourKinshasa();
  const { actions } = useAccesAchats();
  const peutRattacher = actions !== null && actions.includes('treasury.manage');
  const [mode, setMode] = useState<'paiement' | 'rattachement'>('paiement');
  const [f, setF] = useState<FormulairePaiement | null>(null);
  const [comptes, setComptes] = useState<TreasuryAccountView[]>([]);
  const [doublons, setDoublons] = useState<PossibleDuplicateView[]>([]);
  const [depenses, setDepenses] = useState<DepenseCandidate[] | null>(null);
  const [depenseId, setDepenseId] = useState('');
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const cle = preselection.join(',');

  useEffect(() => {
    let annule = false;
    purchasesPayablesApi
      .listInvoices({ supplierId, status: 'validated', limit: 100 })
      .then((p) => {
        if (annule) return;
        const payables = facturesPayables(p.items, supplierId, currency);
        setF(formulairePaiement(payables, new Set(cle.split(',')), aujourdhui));
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageAchats(err, 'Factures illisibles.'));
      });
    treasuryApi
      .listAccounts()
      .then((p) => {
        if (!annule) setComptes(p.items.filter((c) => c.active && c.currency === currency));
      })
      .catch(() => undefined);
    purchasesPayablesApi
      .listDuplicates({ supplierId })
      .then((p) => {
        if (!annule) setDoublons(p.duplicates.filter((d) => d.supplierId === supplierId));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [supplierId, currency, cle, aujourdhui]);

  // Dépenses directes déjà saisies chez ce fournisseur, dans la devise.
  const nom = f?.supplierName ?? '';
  useEffect(() => {
    if (mode !== 'rattachement' || nom === '') return;
    let annule = false;
    treasuryApi
      .listExpenses({ q: nom.slice(0, 100), currency, status: 'recorded', limit: 50 })
      .then((p) => {
        if (!annule) setDepenses(depensesRattachables(p.items, currency));
      })
      .catch((err: unknown) => {
        if (!annule) {
          setDepenses([]);
          setErreur(messageAchats(err, 'Dépenses illisibles.'));
        }
      });
    return () => {
      annule = true;
    };
  }, [mode, nom, currency]);

  const majMontant = (invoiceId: string, montant: string) =>
    setF((p) =>
      p
        ? {
            ...p,
            imputations: p.imputations.map((x) =>
              x.invoiceId === invoiceId ? { ...x, montant } : x,
            ),
          }
        : p,
    );

  async function enregistrer(): Promise<void> {
    if (f === null) return;
    setErreur(null);
    if (mode === 'paiement') {
      const p = preparerPaiement(f, aujourdhui);
      setChamps(p.ok ? {} : p.champs);
      if (!p.ok) return;
      setEnvoi(true);
      try {
        onPaye(await purchasesPayablesApi.createPayment(p.corps), 'paiement');
      } catch (err) {
        setErreur(messageAchats(err, 'Paiement impossible.'));
      } finally {
        setEnvoi(false);
      }
      return;
    }
    const depense = depenses?.find((d) => d.id === depenseId) ?? null;
    const p = preparerRattachement(depense, f.imputations);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      onPaye(await purchasesPayablesApi.paymentFromExpense(p.corps), 'rattachement');
    } catch (err) {
      setErreur(messageAchats(err, 'Rattachement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={mode === 'paiement' ? 'Enregistrer un paiement' : 'Rattacher une dépense déjà saisie'}
      description={
        f
          ? `${f.supplierName} · ${currency}. Lalanda enregistre un paiement fait ailleurs ; il n’émet aucun virement.`
          : undefined
      }
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
            {envoi
              ? 'Enregistrement…'
              : mode === 'paiement'
                ? 'Enregistrer le paiement'
                : 'Rattacher la dépense'}
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
            Lecture des factures à payer…
          </p>
        )
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div
            role="note"
            className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--warn)]/50 p-3"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{ALERTE_DOUBLE_COMPTE}</span>
            </p>
            {doublons.map((d) => (
              <p key={`${d.paymentId}-${d.expenseId}`} className="text-xs">
                Doublon possible : {phraseDoublon(d)}
              </p>
            ))}
            {peutRattacher ? (
              <SegmentedControl<'paiement' | 'rattachement'>
                aria-label="Mode de saisie"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'paiement', label: 'Nouveau paiement' },
                  { value: 'rattachement', label: 'Rattacher une dépense déjà saisie' },
                ]}
              />
            ) : (
              <p className="text-xs text-[var(--foreground-muted)]">
                Rattacher une dépense existante est réservé aux rôles qui gèrent la trésorerie.
              </p>
            )}
          </div>

          {mode === 'paiement' ? (
            <FormGrid>
              <Field id={`${id}-date`} label="Payé le" required size="sm" error={champs['paidOn']}>
                <DatePicker
                  value={f.paidOn}
                  max={aujourdhui}
                  onChange={(v) => setF({ ...f, paidOn: v })}
                  shortcuts={['today']}
                />
              </Field>
              <Field
                id={`${id}-montant`}
                label="Montant payé"
                required
                size="sm"
                hint="Ce qui est sorti du compte ; il doit égaler la somme répartie sur les factures."
                error={champs['amount']}
              >
                <MoneyInput
                  value={f.amount}
                  currency={currency}
                  onChange={(v) => setF({ ...f, amount: v })}
                />
              </Field>
              <Field id={`${id}-compte`} label="Compte qui a payé" optional size="md" newRow>
                <Select<string>
                  value={f.accountId}
                  onChange={(v) => setF({ ...f, accountId: v })}
                  options={[
                    { value: '', label: '— Non précisé —' },
                    ...comptes.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </Field>
              <Field id={`${id}-moyen`} label="Moyen" size="md">
                <Select<SupplierPaymentChannel>
                  value={f.method}
                  onChange={(v) => setF({ ...f, method: v })}
                  options={(
                    Object.entries(LIBELLES_MOYEN) as [SupplierPaymentChannel, string][]
                  ).map(([v, l]) => ({ value: v, label: l }))}
                />
              </Field>
              <Field
                id={`${id}-ref`}
                label="N° de transaction ou de chèque"
                optional
                size="md"
                newRow
                error={champs['reference']}
              >
                <TextInput
                  value={f.reference}
                  maxLength={100}
                  onChange={(e) => setF({ ...f, reference: e.target.value })}
                  className="font-mono"
                />
              </Field>
            </FormGrid>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">
                Dépense déjà saisie dans la trésorerie
              </legend>
              {champs['expenseId'] ? (
                <p className="text-xs font-medium text-[var(--danger)]">{champs['expenseId']}</p>
              ) : null}
              {depenses === null ? (
                <p className="text-[var(--foreground-muted)]">Recherche des dépenses…</p>
              ) : depenses.length === 0 ? (
                <p className="text-[var(--foreground-muted)]">
                  Aucune dépense directe à ce nom dans cette devise.
                </p>
              ) : (
                <Field id={`${id}-depense`} label="Dépense" group size="full">
                  <ChoiceCards<string>
                    value={depenseId}
                    onChange={setDepenseId}
                    options={depenses.map((d) => ({
                      value: d.id,
                      label: (
                        <span className="flex min-w-0 items-baseline justify-between gap-3">
                          <span className="min-w-0 break-words">{d.label}</span>
                          <span className="tabular-nums whitespace-nowrap">
                            {formatMontant(d.amount, d.currency)}
                          </span>
                        </span>
                      ),
                      description: `${formatJour(d.spentOn)}${d.supplierName ? ` · ${d.supplierName}` : ''}`,
                    }))}
                  />
                </Field>
              )}
              <p className="text-xs text-[var(--foreground-muted)]">
                La dépense devient le paiement : aucune dépense nouvelle n’est créée.
              </p>
            </fieldset>
          )}

          <ListeImputations
            idBase={`${id}-imp`}
            imputations={f.imputations}
            devise={currency}
            champs={champs}
            onBasculer={(invoiceId) => setF(basculerImputation(f, invoiceId))}
            onMontant={majMontant}
          />

          {erreur ? (
            <Alerte>
              <p>{erreur}</p>
            </Alerte>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
