'use client';

// Éditeur d'un devis (brouillon) — ADR-0035 § 1 et § 5.
//
// Mêmes lignes qu'un brouillon de facture (`InvoiceLines`), même contrôle de
// forme ; les montants viennent de l'API (moteur) après chaque enregistrement.

import {
  DatePicker,
  Field,
  Form,
  FormGrid,
  SegmentedControl,
  SubmitButton,
  TextArea,
  TextInput,
} from '@lalanda/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, type InvoiceView, type TaxGroupList } from '@/lib/api';
import { crmApi, type QuoteView } from '@/lib/api-crm';

import { ChoixClientDocument } from '../../_components/client-picker';
import { Alerte } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { useAccesVentes } from '../../_components/sales-access';
import { InvoiceLines } from '../../factures/_components/invoice-lines';
import {
  PRICE_MODE_DOC_LABELS,
  type FormulaireDocument,
} from '../../factures/_components/invoice-model';

import {
  DEVIS_BASE,
  champsRefuses,
  formulaireDepuisDevis,
  formulaireDevisVide,
  messageDevis,
  metaDepuisDevis,
  preparerDevis,
  type MetaDevis,
  peutPreparerDevis,
} from './quote-model';

export function QuoteEditor({
  vueInitiale,
  opportunityId = null,
  clientInitial = null,
  onEnregistre,
}: {
  vueInitiale: QuoteView | null;
  opportunityId?: string | null;
  clientInitial?: { id: string; nom: string } | null;
  onEnregistre?: (v: QuoteView) => void;
}): React.ReactElement {
  const router = useRouter();
  // `gerer` (sales.manage) : création rapide d'un client depuis le devis.
  const { actions, gerer: gererClients } = useAccesVentes();
  const gerer = peutPreparerDevis(actions);
  const [vue, setVue] = useState<QuoteView | null>(vueInitiale);
  const [form, setForm] = useState<FormulaireDocument>(() => {
    if (vueInitiale) return formulaireDepuisDevis(vueInitiale);
    const vide = formulaireDevisVide();
    return clientInitial
      ? {
          ...vide,
          client: {
            mode: 'fiche',
            customerId: clientInitial.id,
            nom: clientInitial.nom,
            printContactDetails: false,
          },
        }
      : vide;
  });
  const [meta, setMeta] = useState<MetaDevis>(() => metaDepuisDevis(vueInitiale, opportunityId));
  const [groupes, setGroupes] = useState<TaxGroupList | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [aJour, setAJour] = useState(vueInitiale !== null);

  useEffect(() => {
    api
      .getTaxGroups()
      .then(setGroupes)
      .catch(() => undefined);
  }, []);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const prep = preparerDevis(form, meta);
    if (!prep.ok) {
      setErreurs(prep.champs);
      return;
    }
    setErreurs({});
    setEnvoi(true);
    try {
      const v = vue
        ? await crmApi.updateQuote(vue.id, { ...prep.corps, expectedRevision: vue.revision })
        : await crmApi.createQuote(prep.corps);
      setAJour(true);
      if (!vue) {
        router.push(`${DEVIS_BASE}/${encodeURIComponent(v.id)}`);
        return;
      }
      setVue(v);
      setForm(formulaireDepuisDevis(v));
      onEnregistre?.(v);
    } catch (err) {
      setErreurs(champsRefuses(err));
      setErreur(messageDevis(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  const desactive = !gerer || envoi;
  const totaux = vue?.documentAmounts.calculation.totals ?? null;

  return (
    <Form
      onSubmit={(e) => void enregistrer(e)}
      dirty={gerer && vue !== null && !aJour}
      autoFocusFirst={vue === null}
      className="flex flex-col gap-6"
    >
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <FormGrid>
        <Field id="devis-titre" label="Objet du devis" size="lg" error={erreurs['title']}>
          <TextInput
            value={meta.title}
            maxLength={200}
            onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))}
            disabled={desactive}
          />
        </Field>
        <Field
          id="devis-validite"
          label="Valable jusqu’au"
          size="sm"
          hint="Vide : 30 jours après la création."
          error={erreurs['validUntil']}
        >
          <DatePicker
            value={meta.validUntil}
            onChange={(v) => setMeta((m) => ({ ...m, validUntil: v }))}
            disabled={desactive}
            shortcuts={['plus30', 'endOfMonth']}
          />
        </Field>
        <Field
          id="devis-devise"
          label="Devise"
          group
          size="sm"
          newRow
          hint={form.currency === 'CDF' ? 'Franc congolais (CDF)' : 'Dollar américain (USD)'}
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
          id="devis-mode"
          label="Prix"
          group
          required
          size="sm"
          hint={
            form.priceMode
              ? PRICE_MODE_DOC_LABELS[form.priceMode]
              : 'HT : prix hors taxes ; TTC : prix taxes comprises.'
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

      <ChoixClientDocument
        form={form}
        setForm={setForm}
        verrouille={false}
        desactive={desactive}
        creer={gererClients}
        erreur={erreurs['customer']}
        typeClient={null}
        libelleSansFiche="Personne physique sans fiche"
      />

      <InvoiceLines
        form={form}
        setForm={(u) => {
          setAJour(false);
          setForm(u);
        }}
        vue={vue as unknown as InvoiceView | null}
        origine={null}
        groupes={groupes}
        erreurs={erreurs}
        desactive={desactive}
        aJour={aJour}
      />

      <FormGrid>
        <Field
          id="devis-notes"
          label="Conditions (imprimées sur le devis)"
          size="full"
          error={erreurs['notes']}
        >
          <TextArea
            value={meta.notes}
            maxLength={1000}
            rows={3}
            onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))}
            disabled={desactive}
          />
        </Field>
      </FormGrid>

      {totaux ? (
        <dl className="grid max-w-sm grid-cols-2 gap-1 self-end text-sm">
          <dt className="text-[var(--foreground-muted)]">Total TVA</dt>
          <dd className="text-right font-mono">{formatMontant(totaux.vatTotal, vue!.currency)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-mono font-semibold">
            {formatMontant(totaux.total, vue!.currency)}
          </dd>
        </dl>
      ) : null}

      {gerer ? (
        <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="self-start">
          {vue ? 'Enregistrer le brouillon' : 'Créer le devis'}
        </SubmitButton>
      ) : null}
    </Form>
  );
}
