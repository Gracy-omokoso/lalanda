'use client';

// Document de vente d'une commande ou d'un contrat : client (fiche), devise, mode de prix
// et lignes — les MÊMES lignes qu'un devis ou un brouillon de facture (`InvoiceLines`).
// Les montants viennent de l'API (moteur) après chaque enregistrement. ADR-0050 — V7.

import { useEffect, useState } from 'react';

import { api, type InvoiceView, type TaxGroupList } from '@/lib/api';

import { CHAMP, Champ, aria } from '../../_components/form-ui';
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ id={`${prefixe}-devise`} label="Devise">
          <select
            id={`${prefixe}-devise`}
            value={form.currency}
            onChange={(e) =>
              setForm((f) => ({ ...f, currency: e.target.value as FormulaireDocument['currency'] }))
            }
            className={CHAMP}
            disabled={desactive}
          >
            <option value="CDF">Franc congolais (CDF)</option>
            <option value="USD">Dollar américain (USD)</option>
          </select>
        </Champ>
        <Champ id={`${prefixe}-mode`} label="Prix" requis erreur={erreurs['priceMode']}>
          <select
            id={`${prefixe}-mode`}
            value={form.priceMode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                priceMode: e.target.value as FormulaireDocument['priceMode'],
              }))
            }
            className={CHAMP}
            disabled={desactive}
            {...aria(`${prefixe}-mode`, erreurs['priceMode'])}
          >
            <option value="">Choisir…</option>
            <option value="ht">{PRICE_MODE_DOC_LABELS.ht}</option>
            <option value="ttc">{PRICE_MODE_DOC_LABELS.ttc}</option>
          </select>
        </Champ>
      </div>
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
