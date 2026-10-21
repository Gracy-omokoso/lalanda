'use client';

// Éditeur d'un devis (brouillon) — ADR-0035 § 1 et § 5.
//
// Mêmes lignes qu'un brouillon de facture (`InvoiceLines`), même contrôle de
// forme ; les montants viennent de l'API (moteur) après chaque enregistrement.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, type CustomerView, type InvoiceView, type TaxGroupList } from '@/lib/api';
import { crmApi, type QuoteView } from '@/lib/api-crm';

import { Alerte, BOUTON, CHAMP, Champ, aria } from '../../_components/form-ui';
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
} from './quote-model';

function ChoixClient({
  form,
  setForm,
  erreur,
  desactive,
}: {
  form: FormulaireDocument;
  setForm: React.Dispatch<React.SetStateAction<FormulaireDocument>>;
  erreur: string | undefined;
  desactive: boolean;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [clients, setClients] = useState<CustomerView[]>([]);
  const mode = form.client?.mode ?? 'fiche';

  useEffect(() => {
    if (mode !== 'fiche') return;
    let annule = false;
    const t = setTimeout(() => {
      api
        .listCustomers({ status: 'active', limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => {
          if (!annule) setClients(p.items);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [q, mode]);

  return (
    <fieldset className="flex flex-col gap-3" disabled={desactive}>
      <legend className="mb-1 text-sm font-semibold">Client</legend>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="devis-mode-client"
            checked={mode === 'fiche'}
            onChange={() => setForm((f) => ({ ...f, client: null }))}
          />
          Client enregistré
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="devis-mode-client"
            checked={mode === 'comptoir'}
            onChange={() => setForm((f) => ({ ...f, client: { mode: 'comptoir', nom: '' } }))}
          />
          Personne physique sans fiche
        </label>
      </div>
      {mode === 'fiche' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            aria-label="Rechercher un client"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom, NIF ou e-mail"
            className={CHAMP}
          />
          <select
            aria-label="Client"
            value={form.client?.mode === 'fiche' ? form.client.customerId : ''}
            onChange={(e) => {
              const c = clients.find((x) => x.id === e.target.value);
              setForm((f) => ({
                ...f,
                client: c
                  ? { mode: 'fiche', customerId: c.id, nom: c.name, printContactDetails: false }
                  : null,
              }));
            }}
            className={CHAMP}
            {...aria('client', erreur)}
          >
            <option value="">
              {form.client?.mode === 'fiche' ? form.client.nom : 'Choisir un client…'}
            </option>
            {clients
              .filter((c) => form.client?.mode !== 'fiche' || c.id !== form.client.customerId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.typeLabel}
                </option>
              ))}
            {form.client?.mode === 'fiche' ? (
              <option value={form.client.customerId}>{form.client.nom}</option>
            ) : null}
          </select>
        </div>
      ) : (
        <input
          aria-label="Nom de la personne"
          value={form.client?.mode === 'comptoir' ? form.client.nom : ''}
          onChange={(e) =>
            setForm((f) => ({ ...f, client: { mode: 'comptoir', nom: e.target.value } }))
          }
          placeholder="Nom (facultatif)"
          maxLength={200}
          className={CHAMP}
        />
      )}
      {erreur ? (
        <p id="client-erreur" className="text-xs font-medium text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </fieldset>
  );
}

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
  const { gerer } = useAccesVentes();
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
    <form onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-6" noValidate>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ id="devis-titre" label="Objet du devis" erreur={erreurs['title']}>
          <input
            id="devis-titre"
            value={meta.title}
            maxLength={200}
            onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))}
            className={CHAMP}
            disabled={desactive}
            {...aria('devis-titre', erreurs['title'])}
          />
        </Champ>
        <Champ
          id="devis-validite"
          label="Valable jusqu’au"
          aide="Vide : 30 jours après la création."
          erreur={erreurs['validUntil']}
        >
          <input
            id="devis-validite"
            type="date"
            value={meta.validUntil}
            onChange={(e) => setMeta((m) => ({ ...m, validUntil: e.target.value }))}
            className={CHAMP}
            disabled={desactive}
            {...aria('devis-validite', erreurs['validUntil'], true)}
          />
        </Champ>
        <Champ id="devis-devise" label="Devise">
          <select
            id="devis-devise"
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
        <Champ id="devis-mode" label="Prix" requis erreur={erreurs['priceMode']}>
          <select
            id="devis-mode"
            value={form.priceMode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                priceMode: e.target.value as FormulaireDocument['priceMode'],
              }))
            }
            className={CHAMP}
            disabled={desactive}
            {...aria('devis-mode', erreurs['priceMode'])}
          >
            <option value="">Choisir…</option>
            <option value="ht">{PRICE_MODE_DOC_LABELS.ht}</option>
            <option value="ttc">{PRICE_MODE_DOC_LABELS.ttc}</option>
          </select>
        </Champ>
      </div>

      <ChoixClient
        form={form}
        setForm={setForm}
        erreur={erreurs['customer']}
        desactive={desactive}
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

      <Champ id="devis-notes" label="Conditions (imprimées sur le devis)" erreur={erreurs['notes']}>
        <textarea
          id="devis-notes"
          value={meta.notes}
          maxLength={1000}
          rows={3}
          onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))}
          className={CHAMP}
          disabled={desactive}
        />
      </Champ>

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
        <button type="submit" disabled={envoi} className={`${BOUTON} self-start`}>
          {envoi ? 'Enregistrement…' : vue ? 'Enregistrer le brouillon' : 'Créer le devis'}
        </button>
      ) : null}
    </form>
  );
}
