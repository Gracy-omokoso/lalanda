'use client';

// Paiements d'un document (ADR-0023 § S25e.8) : un ou plusieurs, dans la
// devise du document, parmi les sept modes e-DEF ; `CREDIT` déclare la part
// non réglée. La somme doit égaler le total : c'est le MOTEUR qui le vérifie
// (`paymentsCheck`, avertissement en brouillon, refus au gel). L'interface
// propose seulement de RECOPIER le total servi par l'API dans un paiement
// unique, à confirmer.

import type { InvoicePaymentMethod, InvoiceView } from '@/lib/api';

import { BOUTON_DANGER, BOUTON_PETIT, CHAMP, aria } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';

import {
  type FormulaireDocument,
  nouvelleCle,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  paiementUnique,
} from './invoice-model';

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
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">Paiements ({form.currency})</legend>
      <p className="text-xs text-[var(--foreground-muted)]">
        La somme des paiements doit égaler le total. Choisissez « Crédit » pour la part qui n’est
        pas encore réglée.
      </p>
      <ul className="flex flex-col gap-2">
        {form.paiements.map((p, i) => {
          const id = `paiement-${p.cle}`;
          const err = erreurs[`payments.${i}.amount`] ?? erreurs[`payments.${i}`];
          return (
            <li key={p.cle} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-mode`} className="text-xs">
                  Mode
                </label>
                <select
                  id={`${id}-mode`}
                  value={p.method}
                  onChange={(e) => maj(i, { method: e.target.value as InvoicePaymentMethod })}
                  className={CHAMP}
                  disabled={desactive}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-montant`} className="text-xs">
                  Montant ({form.currency})
                </label>
                <input
                  id={`${id}-montant`}
                  inputMode="decimal"
                  value={p.montant}
                  onChange={(e) => maj(i, { montant: e.target.value })}
                  className={CHAMP}
                  disabled={desactive}
                  {...aria(`${id}-montant`, err)}
                />
                {err ? (
                  <p
                    id={`${id}-montant-erreur`}
                    className="text-xs font-medium text-[var(--danger)]"
                  >
                    {err}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className={`${BOUTON_DANGER} self-end`}
                disabled={desactive || form.paiements.length <= 1}
                onClick={() =>
                  setForm((f) => ({ ...f, paiements: f.paiements.filter((_, n) => n !== i) }))
                }
                aria-label={`Retirer le paiement ${i + 1}`}
              >
                Retirer
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
          className={BOUTON_PETIT}
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
            className={BOUTON_PETIT}
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
