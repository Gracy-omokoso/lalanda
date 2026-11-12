'use client';

// Paiements d'un document (ADR-0023 § S25e.8) : un ou plusieurs, dans la
// devise du document, parmi les sept modes e-DEF ; `CREDIT` déclare la part
// non réglée. La somme doit égaler le total : c'est le MOTEUR qui le vérifie
// (`paymentsCheck`, avertissement en brouillon, refus au gel). L'interface
// propose seulement de RECOPIER le total servi par l'API dans un paiement
// unique, à confirmer.
//
// ADR-0074 : mode en `Select`, montant en `MoneyInput` (mise en forme
// seulement ; `lireMontantSaisi` lit la valeur comme avant), largeurs d'un mode
// et d'un montant. Les identifiants des champs viennent de `useId` et de la
// position du paiement : la clé interne (`nouvelleCle`, compteur du module)
// diffère entre le rendu serveur et le navigateur et faisait échouer
// l'hydratation quand elle servait d'identifiant.

import { Field, FormGrid, MoneyInput, Select } from '@lalanda/ui';
import { Trash2 } from 'lucide-react';
import { useId } from 'react';

import type { InvoicePaymentMethod, InvoiceView } from '@/lib/api';

import { BOUTON_DANGER, BOUTON_PETIT } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';

import {
  type FormulaireDocument,
  nouvelleCle,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  paiementUnique,
} from './invoice-model';

const OPTIONS_MODES = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }));

export function PaymentsEditor({
  form,
  setForm,
  vue,
  erreurs,
  desactive,
}: {
  form: FormulaireDocument;
  setForm: React.Dispatch<React.SetStateAction<FormulaireDocument>>;
  vue: InvoiceView | null;
  erreurs: Record<string, string>;
  desactive: boolean;
}): React.ReactElement {
  // Stable entre le serveur et le navigateur (pas de compteur de module).
  const base = useId().replace(/:/g, '');
  const total = vue?.documentAmounts.calculation.totals?.total ?? null;
  const maj = (
    i: number,
    patch: Partial<{ method: InvoicePaymentMethod; montant: string }>,
  ): void =>
    setForm((f) => ({
      ...f,
      paiements: f.paiements.map((p, n) => (n === i ? { ...p, ...patch } : p)),
    }));

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">Paiements ({form.currency})</legend>
      <p className="text-xs text-[var(--foreground-muted)]">
        La somme des paiements doit égaler le total. Choisissez « Crédit » pour la part qui n’est
        pas encore réglée.
      </p>
      <ul className="flex flex-col gap-2">
        {form.paiements.map((p, i) => {
          const id = `paiement-${base}-${i}`;
          const err = erreurs[`payments.${i}.amount`] ?? erreurs[`payments.${i}`];
          return (
            <li key={p.cle} className="flex min-w-0 items-start gap-2">
              {/* Largeur bornée : la corbeille reste à côté du montant, pas au bout
                  de la ligne (ADR-0074, qualité). */}
              <FormGrid className="min-w-0 flex-1 sm:max-w-[36rem]">
                <Field id={`${id}-mode`} label="Mode" size="md" disabled={desactive}>
                  <Select<InvoicePaymentMethod>
                    value={p.method}
                    onChange={(v) => maj(i, { method: v })}
                    options={OPTIONS_MODES}
                  />
                </Field>
                <Field
                  id={`${id}-montant`}
                  label="Montant"
                  size="sm"
                  disabled={desactive}
                  error={err}
                >
                  <MoneyInput
                    value={p.montant}
                    currency={form.currency}
                    onChange={(v) => maj(i, { montant: v })}
                  />
                </Field>
              </FormGrid>
              <button
                type="button"
                className={`${BOUTON_DANGER} mt-[1.625rem] inline-flex h-9 w-9 shrink-0 items-center justify-center p-0 max-sm:h-11 max-sm:w-11`}
                disabled={desactive || form.paiements.length <= 1}
                onClick={() =>
                  setForm((f) => ({ ...f, paiements: f.paiements.filter((_, n) => n !== i) }))
                }
                aria-label={`Retirer le paiement ${i + 1}`}
                title="Retirer"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4 shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
      {erreurs['payments'] ? (
        <p className="text-xs font-medium text-[var(--danger)]">{erreurs['payments']}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${BOUTON_PETIT} max-sm:h-11`}
          disabled={desactive}
          onClick={() =>
            setForm((f) => ({
              ...f,
              paiements: [...f.paiements, { cle: nouvelleCle('p'), method: 'CREDIT', montant: '' }],
            }))
          }
        >
          Ajouter un paiement
        </button>
        {vue && total !== null ? (
          <button
            type="button"
            className={`${BOUTON_PETIT} max-sm:h-11`}
            disabled={desactive}
            onClick={() => {
              const p = paiementUnique(vue, form.paiements[0]?.method ?? 'ESPECES');
              if (p) setForm((f) => ({ ...f, paiements: p }));
            }}
          >
            Un seul paiement égal au total ({formatMontant(total, form.currency)})
          </button>
        ) : null}
      </div>
      {vue && total !== null ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Total enregistré : {formatMontant(total, form.currency)}. Après une modification des
          lignes, enregistrez pour que le serveur recalcule le total.
        </p>
      ) : null}
    </fieldset>
  );
}
