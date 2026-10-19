'use client';

// Composition d'un document de vente (ADR-0023 §§ S25e.2, 7, 8) : client ou
// vente de comptoir, lignes, mode TTC/HT, devise CDF ou USD, paiements,
// commentaires ; puis « Émettre » (organisation ordinaire) ou « Normaliser »
// (organisation en facture normalisée) — jamais les deux.
//
// Le brouillon s'enregistre même incomplet : l'API renvoie ses totaux (moteur)
// et ce qui empêche encore de le figer (`readiness.blockers`). L'écran AFFICHE
// ces montants ; il n'en calcule aucun.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  api,
  type CustomerType,
  type CustomerView,
  type DocumentCurrency,
  type InvoiceType,
  type InvoiceView,
  type TaxGroupList,
} from '@/lib/api';

import { Alerte, BOUTON, BOUTON_DANGER, CHAMP, Pastille, aria } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import {
  erreursFormulaire,
  estRevisionPerimee,
  libelleTypeClient,
} from '../../_components/sales-model';

import { AmountsPanel } from './amounts-panel';
import { InvoiceLines } from './invoice-lines';
import {
  actionsDocument,
  commentaireAModifiable,
  CURRENCY_LABELS,
  enteteDocument,
  estAvoir,
  FACTURES_BASE,
  type FormulaireDocument,
  formulaireDepuisVue,
  formulaireVide,
  libelleEmpechement,
  messageFacture,
  NATURE_LABELS,
  preparerDocument,
  PRICE_MODE_DOC_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  TYPES_AVOIR,
  TYPES_VENTE,
} from './invoice-model';
import { IssueDialog } from './issue-dialog';
import { NormalizeDialog } from './normalize-dialog';
import { PaymentsEditor } from './payments-editor';

/** Chemins du serveur rapprochés des champs de l'écran. */
function champsConnus(f: FormulaireDocument): string[] {
  const base = [
    'type',
    'currency',
    'priceMode',
    'customer',
    'lines',
    'payments',
    'creditNote.nature',
    'comments.A',
    'comments.C',
  ];
  f.lignes.forEach((_, i) => {
    base.push(`lines.${i}`);
    for (const c of [
      'quantity',
      'unitPrice',
      'discount',
      'name',
      'taxGroup',
      'itemType',
      'specificTax',
      'catalogItemId',
    ]) {
      base.push(`lines.${i}.${c}`);
    }
  });
  f.paiements.forEach((_, i) => base.push(`payments.${i}.amount`, `payments.${i}`));
  return base;
}

function correspondances(f: FormulaireDocument): Record<string, string> {
  const out: Record<string, string> = {
    'customer.customerId': 'customer',
    'customer.walkIn.name': 'customer',
    creditNote: 'creditNote.nature',
  };
  f.lignes.forEach((_, i) => {
    out[`lines.${i}.discount.value`] = `lines.${i}.discount`;
    out[`lines.${i}.specificTax.amount`] = `lines.${i}.specificTax`;
    out[`lines.${i}.specificTax.rate`] = `lines.${i}.specificTax`;
    out[`lines.${i}.originLineIndex`] = `lines.${i}`;
  });
  return out;
}

function ChoixClient({
  form,
  setForm,
  verrouille,
  desactive,
  erreur,
  onType,
}: {
  form: FormulaireDocument;
  setForm: React.Dispatch<React.SetStateAction<FormulaireDocument>>;
  /** Avoir : client repris de la facture d'origine. */
  verrouille: boolean;
  /** Lecture seule (rôle, envoi en cours) : champs visibles mais inactifs. */
  desactive: boolean;
  erreur: string | undefined;
  onType: (t: CustomerType | null) => void;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [clients, setClients] = useState<CustomerView[]>([]);
  const mode = form.client?.mode ?? 'fiche';

  useEffect(() => {
    if (verrouille || mode !== 'fiche') return;
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
  }, [q, mode, verrouille]);

  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-describedby={erreur ? 'client-erreur' : undefined}
    >
      <legend className="mb-1 text-sm font-semibold">Client</legend>
      {verrouille ? (
        <p className="text-sm">
          {form.client?.nom || 'Vente de comptoir'}{' '}
          <span className="text-xs text-[var(--foreground-muted)]">
            (repris de la facture d’origine)
          </span>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode-client"
                checked={mode === 'fiche'}
                onChange={() => {
                  setForm((f) => ({ ...f, client: null }));
                  onType(null);
                }}
              />
              Client enregistré
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode-client"
                checked={mode === 'comptoir'}
                onChange={() => {
                  setForm((f) => ({ ...f, client: { mode: 'comptoir', nom: '' } }));
                  onType('PP');
                }}
              />
              Vente de comptoir (personne physique)
            </label>
          </div>
          {mode === 'fiche' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="client-q" className="text-sm">
                  Rechercher
                </label>
                <input
                  id="client-q"
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Nom, NIF ou e-mail"
                  className={CHAMP}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="client-choix" className="text-sm">
                  Client
                </label>
                <select
                  id="client-choix"
                  value={form.client?.mode === 'fiche' ? form.client.customerId : ''}
                  onChange={(e) => {
                    const c = clients.find((x) => x.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      client: c
                        ? {
                            mode: 'fiche',
                            customerId: c.id,
                            nom: c.name,
                            printContactDetails: false,
                          }
                        : null,
                    }));
                    onType(c?.type ?? null);
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
              {form.client?.mode === 'fiche' ? (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.client.printContactDetails}
                    onChange={(e) =>
                      setForm((f) =>
                        f.client?.mode === 'fiche'
                          ? { ...f, client: { ...f.client, printContactDetails: e.target.checked } }
                          : f,
                      )
                    }
                  />
                  Le client demande que ses coordonnées figurent sur le document
                </label>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="client-comptoir" className="text-sm">
                Nom du client (facultatif)
              </label>
              <input
                id="client-comptoir"
                value={form.client?.mode === 'comptoir' ? form.client.nom : ''}
                maxLength={200}
                onChange={(e) =>
                  setForm((f) => ({ ...f, client: { mode: 'comptoir', nom: e.target.value } }))
                }
                className={CHAMP}
              />
            </div>
          )}
        </>
      )}
      {erreur ? (
        <p id="client-erreur" className="text-xs font-medium text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </fieldset>
  );
}

export function InvoiceEditor({
  vueInitiale,
  onChange,
}: {
  /** `null` : nouveau document. */
  vueInitiale: InvoiceView | null;
  /** La vue a changé (enregistrée, émise, normalisée). */
  onChange?: (v: InvoiceView) => void;
}): React.ReactElement {
  const router = useRouter();
  const { gerer, facturer } = useAccesVentes();
  const [vue, setVue] = useState<InvoiceView | null>(vueInitiale);
  const [origine, setOrigine] = useState<InvoiceView | null>(null);
  const [form, setForm] = useState<FormulaireDocument>(() =>
    vueInitiale ? formulaireDepuisVue(vueInitiale) : formulaireVide(),
  );
  const [reference, setReference] = useState<string>(() => JSON.stringify(form));
  const [typeClient, setTypeClient] = useState<CustomerType | null>(
    vueInitiale?.customer.type ?? null,
  );
  const [groupes, setGroupes] = useState<TaxGroupList | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [autres, setAutres] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [perimee, setPerimee] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [dialogue, setDialogue] = useState<'emettre' | 'normaliser' | 'supprimer' | null>(null);

  const modifie = JSON.stringify(form) !== reference;
  const desactive = !gerer || envoi;
  const verrouOrigine = form.originInvoiceId !== null;

  useEffect(() => {
    api
      .getTaxGroups()
      .then(setGroupes)
      .catch(() => undefined);
  }, []);

  // Avoir hors RRR : la facture d'origine donne les restants par ligne.
  useEffect(() => {
    const id = vueInitiale?.creditNote?.originInvoiceId ?? null;
    if (id === null) return;
    let annule = false;
    api
      .getInvoice(id)
      .then((o) => {
        if (annule) return;
        setOrigine(o);
        // Les restants ne sont connus qu'avec l'origine : on les reporte sans
        // marquer le formulaire comme modifié.
        const f = formulaireDepuisVue(vueInitiale!, o);
        setForm(f);
        setReference(JSON.stringify(f));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [vueInitiale]);

  const recharger = (v: InvoiceView): void => {
    setVue(v);
    const f = formulaireDepuisVue(v, origine);
    setForm(f);
    setReference(JSON.stringify(f));
    onChange?.(v);
  };

  async function enregistrer(): Promise<void> {
    setNotice(null);
    setErreur(null);
    setAutres([]);
    const prep = preparerDocument(form);
    if (!prep.ok) {
      setErreurs(prep.champs);
      setErreur('Certaines valeurs sont à corriger. Elles sont signalées sous chaque champ.');
      return;
    }
    setErreurs({});
    setEnvoi(true);
    try {
      if (vue === null) {
        const cree = await api.createInvoice(prep.corps);
        router.replace(`${FACTURES_BASE}/${encodeURIComponent(cree.id)}`);
        return;
      }
      const maj = await api.updateInvoice(vue.id, {
        ...prep.corps,
        expectedRevision: vue.revision,
      });
      recharger(maj);
      setNotice(`Brouillon ${maj.proformaRef} enregistré.`);
    } catch (err) {
      if (estRevisionPerimee(err)) setPerimee(true);
      const e = erreursFormulaire(err, champsConnus(form), correspondances(form));
      setErreurs(e.champs as Record<string, string>);
      setAutres(e.autres);
      setErreur(messageFacture(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function relire(): Promise<void> {
    if (!vue) return;
    try {
      recharger(await api.getInvoice(vue.id));
      setPerimee(false);
      setErreur(null);
    } catch (err) {
      setErreur(messageFacture(err, 'Impossible de recharger le document.'));
    }
  }

  async function supprimer(): Promise<void> {
    if (!vue) return;
    setEnvoi(true);
    try {
      await api.deleteInvoice(vue.id);
      router.push(FACTURES_BASE);
    } catch (err) {
      setErreur(messageFacture(err, 'Suppression impossible.'));
      setDialogue(null);
    } finally {
      setEnvoi(false);
    }
  }

  const actions = vue ? actionsDocument(vue, { gerer, facturer }) : [];
  const entete = vue ? enteteDocument(vue) : null;
  const typesProposes: readonly InvoiceType[] = verrouOrigine
    ? [form.type]
    : [...TYPES_VENTE, ...TYPES_AVOIR];
  const avoirLibre = estAvoir(form.type) && !verrouOrigine;
  const aModifiable = commentaireAModifiable(form, typeClient);
  const modeNormalise = vue?.readiness.action === 'normalize';
  const blockers = useMemo(() => vue?.readiness.blockers ?? [], [vue]);

  return (
    <section aria-labelledby="doc-titre" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href={FACTURES_BASE} className="text-sm text-[var(--foreground-muted)] underline">
          ← Documents de vente
        </Link>
        <h2 id="doc-titre" className="font-display text-lg font-bold tracking-tight">
          {entete ? entete.titre : 'Nouveau document de vente'}
        </h2>
        {entete && vue ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono">{entete.reference}</span>
            <Pastille ton="neutre">{STATUS_LABELS[vue.status]}</Pastille>
            {vue.creditNote ? (
              <span className="text-xs text-[var(--foreground-muted)]">
                Avoir · {NATURE_LABELS[vue.creditNote.nature].court}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            Le document naît en brouillon : c’est un pro forma, non valable comme facture.
          </p>
        )}
      </div>

      {!gerer ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Consultation seule : votre rôle ne permet pas de modifier les brouillons.
        </p>
      ) : null}

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-[var(--foreground-muted)]">
        {notice ?? ''}
      </p>
      {erreur ? (
        <Alerte
          action={
            perimee ? (
              <button
                type="button"
                className={`${BOUTON} text-[var(--foreground)]`}
                onClick={() => void relire()}
              >
                Recharger le document
              </button>
            ) : undefined
          }
        >
          <p>{erreur}</p>
          {autres.length > 0 ? (
            <ul className="list-disc pl-5">
              {autres.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enregistrer();
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="doc-type" className="text-sm font-medium">
              Type de document
            </label>
            <select
              id="doc-type"
              value={form.type}
              onChange={(e) => {
                const t = e.target.value as InvoiceType;
                setForm((f) => ({ ...f, type: t, nature: estAvoir(t) ? 'RRR' : null }));
              }}
              className={CHAMP}
              disabled={desactive || verrouOrigine || vue !== null}
            >
              {typesProposes.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                  {estAvoir(t) && !verrouOrigine ? ' — remise, ristourne ou rabais' : ''}
                </option>
              ))}
            </select>
            {avoirLibre ? (
              <p className="text-xs text-[var(--foreground-muted)]">
                Un avoir rattaché à une facture se crée depuis cette facture (« Créer un avoir ») ;
                ici, seulement une remise, ristourne ou rabais sans facture d’origine.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="doc-devise" className="text-sm font-medium">
              Devise du document
            </label>
            <select
              id="doc-devise"
              value={form.currency}
              onChange={(e) =>
                setForm((f) => ({ ...f, currency: e.target.value as DocumentCurrency }))
              }
              className={CHAMP}
              disabled={desactive || verrouOrigine}
              aria-describedby="doc-devise-aide"
            >
              {(Object.keys(CURRENCY_LABELS) as DocumentCurrency[]).map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_LABELS[c]}
                </option>
              ))}
            </select>
            <p id="doc-devise-aide" className="text-xs text-[var(--foreground-muted)]">
              Le document est composé et payé dans cette devise. En facture normalisée, il est
              converti en CDF au moment de « Normaliser ».
            </p>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2" disabled={desactive || verrouOrigine}>
          <legend className="mb-1 text-sm font-semibold">
            Mode de prix
            <span className="sr-only"> (obligatoire)</span>
          </legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            {(['ttc', 'ht'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mode-prix"
                  checked={form.priceMode === m}
                  onChange={() => setForm((f) => ({ ...f, priceMode: m }))}
                />
                {PRICE_MODE_DOC_LABELS[m]}
              </label>
            ))}
          </div>
          {erreurs['priceMode'] ? (
            <p className="text-xs font-medium text-[var(--danger)]">{erreurs['priceMode']}</p>
          ) : null}
        </fieldset>

        <ChoixClient
          form={form}
          setForm={setForm}
          verrouille={verrouOrigine}
          desactive={desactive}
          erreur={erreurs['customer']}
          onType={setTypeClient}
        />
        {typeClient ? (
          <p className="-mt-3 text-xs text-[var(--foreground-muted)]">
            Type DGI : {libelleTypeClient(typeClient)}
          </p>
        ) : null}

        <InvoiceLines
          form={form}
          setForm={setForm}
          vue={vue}
          origine={origine}
          groupes={groupes}
          erreurs={erreurs}
          desactive={desactive}
          aJour={!modifie}
        />

        <PaymentsEditor
          form={form}
          setForm={setForm}
          vue={modifie ? null : vue}
          erreurs={erreurs}
          desactive={desactive}
        />

        <fieldset className="flex flex-col gap-3" disabled={desactive}>
          <legend className="mb-1 text-sm font-semibold">Commentaires</legend>
          {typeClient === 'AO' ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Ligne A : la référence d’exonération du client (« Réf. Exo. : … ») est ajoutée
              automatiquement.
            </p>
          ) : aModifiable ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="com-a" className="text-sm">
                Ligne A — référence de dérogation (groupe D)
              </label>
              <input
                id="com-a"
                value={form.commentA}
                maxLength={255}
                onChange={(e) => setForm((f) => ({ ...f, commentA: e.target.value }))}
                className={CHAMP}
                {...aria('com-a', erreurs['comments.A'])}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="com-c" className="text-sm">
              Ligne C — rappel du code d’une facture d’acompte (facultatif)
            </label>
            <input
              id="com-c"
              value={form.commentC}
              maxLength={255}
              onChange={(e) => setForm((f) => ({ ...f, commentC: e.target.value }))}
              className={CHAMP}
              {...aria('com-c', erreurs['comments.C'])}
            />
          </div>
          {form.currency === 'CDF' && modeNormalise ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.showUsdCounterValue}
                onChange={(e) => setForm((f) => ({ ...f, showUsdCounterValue: e.target.checked }))}
              />
              Indiquer la contre-valeur en dollars sur la facture normalisée
            </label>
          ) : null}
        </fieldset>

        {gerer ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" className={`${BOUTON} font-semibold`} disabled={envoi}>
              {envoi
                ? 'Enregistrement…'
                : vue === null
                  ? 'Créer le brouillon'
                  : 'Enregistrer le brouillon'}
            </button>
            {modifie && vue ? (
              <p className="self-center text-xs text-[var(--foreground-muted)]">
                Modifications non enregistrées : les totaux affichés sont ceux du dernier
                enregistrement.
              </p>
            ) : null}
          </div>
        ) : null}
      </form>

      {vue ? (
        <>
          <AmountsPanel vue={vue} />

          {blockers.length > 0 ? (
            <div className="rounded-xl border border-[var(--warn)]/50 p-4 text-sm">
              <p className="font-medium">
                Avant de {vue.readiness.action === 'issue' ? 'l’émettre' : 'le normaliser'} :
              </p>
              <ul className="mt-1 list-disc pl-5">
                {blockers.map((b, i) => (
                  <li key={i}>{libelleEmpechement(b)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {actions.includes('emettre') ? (
              <button
                type="button"
                className={`${BOUTON} border-[var(--accent)] font-semibold`}
                disabled={modifie || envoi || !vue.readiness.ready}
                onClick={() => setDialogue('emettre')}
              >
                Émettre
              </button>
            ) : null}
            {actions.includes('normaliser') ? (
              <button
                type="button"
                className={`${BOUTON} border-[var(--accent)] font-semibold`}
                disabled={modifie || envoi || !vue.readiness.ready}
                onClick={() => setDialogue('normaliser')}
              >
                Normaliser
              </button>
            ) : null}
            {actions.includes('supprimer') ? (
              dialogue === 'supprimer' ? (
                <div
                  role="group"
                  aria-label="Confirmer la suppression du brouillon"
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="text-sm">Supprimer ce brouillon définitivement ?</span>
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    disabled={envoi}
                    onClick={() => void supprimer()}
                  >
                    Supprimer
                  </button>
                  <button type="button" className={BOUTON} onClick={() => setDialogue(null)}>
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  disabled={envoi}
                  onClick={() => setDialogue('supprimer')}
                >
                  Supprimer le brouillon
                </button>
              )
            ) : null}
          </div>
          {(actions.includes('emettre') || actions.includes('normaliser')) && modifie ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Enregistrez d’abord vos modifications.
            </p>
          ) : null}

          {dialogue === 'emettre' ? (
            <IssueDialog
              vue={vue}
              onFermer={() => setDialogue(null)}
              onEmise={(v) => {
                setDialogue(null);
                recharger(v);
              }}
            />
          ) : null}
          {dialogue === 'normaliser' ? (
            <NormalizeDialog
              vue={vue}
              contreValeurUsd={form.currency === 'CDF' && form.showUsdCounterValue}
              onFermer={() => setDialogue(null)}
              onNormalise={(v) => {
                setDialogue(null);
                recharger(v);
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
