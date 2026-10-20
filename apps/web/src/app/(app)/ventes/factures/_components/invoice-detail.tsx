'use client';

// Page d'un document (ADR-0023 § S25e.1). Un brouillon s'ouvre dans l'éditeur ;
// tout autre statut est FIGÉ et se consulte seulement : facture émise ou
// normalisée (créer un avoir), pro forma en attente DGI, pro forma refusé
// (reprendre en brouillon). Aucun montant n'est recalculé : tout vient de la vue.
// En mode normalisé, l'état de la normalisation DGI (ADR-0024 § 9.3) et les
// échanges avec la DGI s'affichent sous l'en-tête.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, type InvoiceView } from '@/lib/api';

import { Alerte, BOUTON, Pastille } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import { estRefus, formatDate, formatMontant } from '../../_components/sales-model';

import { AmountsPanel } from './amounts-panel';
import { CreditNoteDialog } from './credit-note-dialog';
import { DgiExchanges } from './dgi-exchanges';
import { InvoiceEditor } from './invoice-editor';
import {
  actionsDocument,
  comparerDecimaux,
  enTestDgi,
  enteteDocument,
  FACTURES_BASE,
  formatQuantite,
  MENTION_TEST_DGI,
  messageFacture,
  NATURE_LABELS,
  STATUS_LABELS,
  tonStatut,
  TYPE_LABELS,
} from './invoice-model';
import { NormalizationStatus } from './normalization-status';

/** Bandeau « test » : impossible à manquer (demande de la décideuse). */
const BANDEAU_TEST =
  'rounded-md border-2 border-[var(--warn)] bg-[var(--warn)]/15 px-3 py-2 text-sm font-bold uppercase tracking-wide';

export function InvoiceDetail({ invoiceId }: { invoiceId: string }): React.ReactElement {
  const [vue, setVue] = useState<InvoiceView | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'refus' | 'erreur'>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback((): void => {
    setEtat('chargement');
    api
      .getInvoice(invoiceId)
      .then((v) => {
        setVue(v);
        setEtat('pret');
      })
      .catch((err: unknown) => {
        setErreur(messageFacture(err, 'Impossible de charger le document.'));
        setEtat(estRefus(err) ? 'refus' : 'erreur');
      });
  }, [invoiceId]);

  useEffect(charger, [charger]);

  if (etat === 'chargement') {
    return (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement du document…
      </p>
    );
  }
  if (etat !== 'pret' || vue === null) {
    return (
      <div className="flex flex-col gap-3">
        <Link href={FACTURES_BASE} className="text-sm text-[var(--foreground-muted)] underline">
          ← Documents de vente
        </Link>
        <Alerte
          action={
            etat === 'erreur' ? (
              <button
                type="button"
                className={`${BOUTON} text-[var(--foreground)]`}
                onClick={charger}
              >
                Réessayer
              </button>
            ) : undefined
          }
        >
          <p>{erreur}</p>
        </Alerte>
      </div>
    );
  }
  if (vue.status === 'draft') {
    return <InvoiceEditor key={vue.id} vueInitiale={vue} onChange={setVue} />;
  }
  return <DocumentFige vue={vue} onChange={setVue} />;
}

function DocumentFige({
  vue,
  onChange,
}: {
  vue: InvoiceView;
  onChange: (v: InvoiceView) => void;
}): React.ReactElement {
  const router = useRouter();
  const { gerer, facturer } = useAccesVentes();
  const [avoir, setAvoir] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const entete = enteteDocument(vue);
  const actions = actionsDocument(vue, { gerer, facturer });
  const n = vue.normalization;

  async function reprendre(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      onChange(await api.backToDraft(vue.id, vue.revision));
    } catch (err) {
      setErreur(messageFacture(err, 'Reprise impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <article aria-labelledby="doc-titre" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href={FACTURES_BASE} className="text-sm text-[var(--foreground-muted)] underline">
          ← Documents de vente
        </Link>
        {enTestDgi(vue) ? (
          <p role="note" className={`${BANDEAU_TEST} my-1`}>
            {MENTION_TEST_DGI}
          </p>
        ) : null}
        <h2 id="doc-titre" className="font-display text-lg font-bold tracking-tight">
          {entete.titre}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono">{entete.reference}</span>
          <Pastille ton={tonStatut(vue.status)}>{STATUS_LABELS[vue.status]}</Pastille>
          <span className="text-xs text-[var(--foreground-muted)]">{TYPE_LABELS[vue.type]}</span>
          {vue.environment === 'test' ? <Pastille ton="attention">Mode test</Pastille> : null}
        </p>
        {entete.mention ? (
          <p className="text-sm text-[var(--foreground-muted)]">{entete.mention}</p>
        ) : null}
        <p className="text-xs text-[var(--foreground-muted)]">
          Contenu figé{vue.issuedAt ? ` — émis le ${formatDate(vue.issuedAt)}` : ''}
          {vue.operator ? ` par ${vue.operator.name}` : ''}. Il ne se modifie plus
          {vue.documentKind === 'invoice' ? ' : une correction passe par un avoir.' : '.'}
        </p>
      </div>

      {vue.emissionMode === 'normalized' || n !== null ? (
        <NormalizationStatus vue={vue} onChange={onChange} />
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--foreground-muted)]">Client</dt>
          <dd>
            {vue.customer.name ?? 'Vente de comptoir'} — {vue.customer.typeLabel}
            {vue.customer.nif ? (
              <>
                {' · NIF '}
                <span className="font-mono">{vue.customer.nif}</span>
              </>
            ) : null}
          </dd>
        </div>
        {vue.seller ? (
          <div>
            <dt className="text-xs text-[var(--foreground-muted)]">Vendeur</dt>
            <dd>
              {vue.seller.legalName} · NIF <span className="font-mono">{vue.seller.nif}</span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-[var(--foreground-muted)]">Devise et mode de prix</dt>
          <dd>
            {vue.currency} · {vue.priceMode.toUpperCase()}
          </dd>
        </div>
        {vue.creditNote ? (
          <div>
            <dt className="text-xs text-[var(--foreground-muted)]">Avoir</dt>
            <dd>
              {NATURE_LABELS[vue.creditNote.nature].court} ({vue.creditNote.nature})
              {vue.creditNote.originInvoiceId ? (
                <>
                  {' — sur '}
                  <Link
                    className="underline"
                    href={`${FACTURES_BASE}/${encodeURIComponent(vue.creditNote.originInvoiceId)}`}
                  >
                    {vue.creditNote.originNumber
                      ? `la facture n° ${vue.creditNote.originNumber}`
                      : 'la facture d’origine'}
                  </Link>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <section aria-label="Lignes" className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">Lignes du document</caption>
          <thead className="text-xs text-[var(--foreground-muted)]">
            <tr>
              <th scope="col" className="py-1 pr-2 text-left font-medium">
                Désignation
              </th>
              <th scope="col" className="py-1 pr-2 text-left font-medium">
                Groupe
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Quantité
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Prix unitaire
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Montant
              </th>
            </tr>
          </thead>
          <tbody>
            {vue.lines.map((l) => (
              <tr key={l.index} className="border-t border-[var(--border)] align-top">
                <td className="py-1.5 pr-2">
                  {l.name}
                  {l.priceModification ? (
                    <span className="block text-xs text-[var(--foreground-muted)]">
                      {l.priceModification}
                    </span>
                  ) : null}
                  {l.remaining !== undefined &&
                  l.credited !== undefined &&
                  comparerDecimaux(l.credited, '0') === 1 ? (
                    <span className="block text-xs text-[var(--foreground-muted)]">
                      Crédité : {formatQuantite(l.credited)} · restant {formatQuantite(l.remaining)}
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-2">{l.taxGroup}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{formatQuantite(l.quantity)}</td>
                <td className="py-1.5 pr-2 text-right font-mono">
                  {formatMontant(l.unitPrice, vue.currency)}
                </td>
                <td className="py-1.5 text-right font-mono">
                  {l.amount === null ? '—' : formatMontant(l.amount, vue.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <AmountsPanel vue={vue} />

      {vue.creditNotes.length > 0 ? (
        <section aria-labelledby="avoirs-titre" className="flex flex-col gap-2">
          <h3 id="avoirs-titre" className="text-sm font-semibold">
            Avoirs sur ce document
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {vue.creditNotes.map((c) => {
              const e = enteteDocument({
                ...c,
                type: vue.type === 'EV' || vue.type === 'ET' ? 'EA' : 'FA',
                emissionMode: vue.emissionMode,
              });
              return (
                <li key={c.id}>
                  <Link className="underline" href={`${FACTURES_BASE}/${encodeURIComponent(c.id)}`}>
                    <span className="font-mono">{e.reference}</span>
                  </Link>{' '}
                  — {NATURE_LABELS[c.nature].court} · {STATUS_LABELS[c.status]}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {actions.includes('avoir') ? (
          <button type="button" className={BOUTON} onClick={() => setAvoir(true)}>
            Créer un avoir
          </button>
        ) : null}
        {actions.includes('reprendre') ? (
          <button
            type="button"
            className={BOUTON}
            disabled={envoi}
            onClick={() => void reprendre()}
          >
            {envoi ? 'Reprise…' : 'Reprendre en brouillon'}
          </button>
        ) : null}
      </div>
      {vue.status === 'normalization_failed' && actions.includes('reprendre') ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          La reprise efface la conversion en CDF et redonne un brouillon modifiable.
        </p>
      ) : null}

      {vue.emissionMode === 'normalized' || n !== null ? <DgiExchanges invoiceId={vue.id} /> : null}

      {avoir ? (
        <CreditNoteDialog
          origine={vue}
          reference={entete.reference}
          onFermer={() => setAvoir(false)}
          onCree={(v) => router.push(`${FACTURES_BASE}/${encodeURIComponent(v.id)}`)}
        />
      ) : null}
    </article>
  );
}
