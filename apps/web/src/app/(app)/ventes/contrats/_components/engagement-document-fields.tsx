'use client';

// Document de vente d'une commande ou d'un contrat : client (fiche), devise, mode de prix
// et lignes — les MÊMES lignes qu'un devis ou un brouillon de facture (`InvoiceLines`).
// Les montants viennent de l'API (moteur) après chaque enregistrement. ADR-0050 — V7.
//
// ADR-0074 : devise et mode de prix en segments, comme le brouillon de facture.

import { Field, FormGrid, SegmentedControl } from '@lalanda/ui';
import { useEffect, useState } from 'react';

import { api, type InvoiceView, type TaxGroupList } from '@/lib/api';

import { InvoiceLines } from '../../factures/_components/invoice-lines';
import {
  PRICE_MODE_DOC_LABELS,
  type FormulaireDocument,
} from '../../factures/_components/invoice-model';

import { ChoixClientFiche } from './engagement-ui';

export function ChampsDocument({
  prefixe,
  form,
  setForm,
  vue,
  erreurs,
  desactive,
  aJour,
  avecClient = true,
}: {
  prefixe: string;
  form: FormulaireDocument;
  setForm: React.Dispatch<React.SetStateAction<FormulaireDocument>>;
  /** Dernière vue servie (montants de ligne) ; même forme qu'un brouillon de facture. */
  vue: unknown;
  erreurs: Record<string, string>;
  desactive: boolean;
  aJour: boolean;
  avecClient?: boolean;
}): React.ReactElement {
  const [groupes, setGroupes] = useState<TaxGroupList | null>(null);

  useEffect(() => {
    api
      .getTaxGroups()
      .then(setGroupes)
      .catch(() => undefined);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <FormGrid>
        <Field
          id={`${prefixe}-devise`}
          label="Devise"
          group
          size="sm"
          hint={form.currency === 'CDF' ? 'Franc congolais (CDF).' : 'Dollar américain (USD).'}
        >
          <SegmentedControl<FormulaireDocument['currency']>
            value={form.currency}
            onChange={(c) => setForm((f) => ({ ...f, currency: c }))}
            disabled={desactive}
            options={[
              { value: 'CDF', label: 'CDF' },
              { value: 'USD', label: 'USD' },
            ]}
          />
        </Field>
        <Field
          id={`${prefixe}-mode`}
          label="Prix"
          group
          required
          size="sm"
          hint={
            form.priceMode
              ? PRICE_MODE_DOC_LABELS[form.priceMode]
              : 'TTC : prix taxes comprises ; HT : prix hors taxes.'
          }
          error={erreurs['priceMode']}
        >
          <SegmentedControl<'ht' | 'ttc'>
            value={form.priceMode}
            onChange={(m) => setForm((f) => ({ ...f, priceMode: m }))}
            disabled={desactive}
            options={[
              { value: 'ht', label: 'HT' },
              { value: 'ttc', label: 'TTC' },
            ]}
          />
        </Field>
      </FormGrid>
      {avecClient ? (
        <ChoixClientFiche
          client={form.client}
          onChange={(client) => setForm((f) => ({ ...f, client }))}
          erreur={erreurs['customer'] ?? erreurs['customer.customerId']}
          desactive={desactive}
        />
      ) : null}
      <InvoiceLines
        form={form}
        setForm={setForm}
        vue={vue as InvoiceView | null}
        origine={null}
        groupes={groupes}
        erreurs={erreurs}
        desactive={desactive}
        aJour={aJour}
      />
    </div>
  );
}
