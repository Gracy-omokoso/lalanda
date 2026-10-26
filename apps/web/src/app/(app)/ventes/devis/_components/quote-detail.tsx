'use client';

// Un devis — ADR-0035 § 1 : brouillon modifiable, ou devis envoyé à suivre
// (accepté, refusé, expiré, nouvelle version), PDF au modèle de l'organisation,
// conversion en brouillon de facture qui ouvre la facture créée.

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { crmApi, type QuoteView } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT, Pastille } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { useAccesVentes } from '../../_components/sales-access';
import { CRM_BASE } from '../../crm/_components/crm-model';
import { FACTURES_BASE } from '../../factures/_components/invoice-model';

import { QuoteEditor } from './quote-editor';
import {
  DEVIS_BASE,
  ISSUE_GAIN,
  LIBELLE_DEVIS,
  QUOTE_STATUS_LABELS,
  formatJour,
  messageDevis,
  tonDevis,
} from './quote-model';

function telecharger(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function QuoteDetail({ quoteId }: { quoteId: string }): React.ReactElement {
  const router = useRouter();
  const { gerer } = useAccesVentes();
  const [vue, setVue] = useState<QuoteView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    crmApi
      .getQuote(quoteId)
      .then((v) => {
        setVue(v);
        setErreur(null);
      })
      .catch((err) => setErreur(messageDevis(err, 'Devis illisible.')));
  }, [quoteId]);

  useEffect(() => charger(), [charger]);

  async function agir(
    f: () => Promise<QuoteView | void>,
    message: string | null = null,
  ): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    setInfo(null);
    try {
      const v = await f();
      if (v) setVue(v);
      if (message) setInfo(message);
    } catch (err) {
      setErreur(messageDevis(err, 'Action impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  if (vue === null) {
    return erreur ? (
      <Alerte>
        <p>{erreur}</p>
      </Alerte>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement du devis…
      </p>
    );
  }

  const a = vue.actions;
  const totaux = vue.documentAmounts.calculation.totals;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={DEVIS_BASE} className="text-sm underline underline-offset-2">
          ← Tous les devis
        </Link>
        <p className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
          {LIBELLE_DEVIS}
        </p>
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          <span className="font-mono">{vue.number}</span>
          <span className="text-sm text-[var(--foreground-muted)]">version {vue.version}</span>
          <Pastille ton={tonDevis(vue.status)}>{QUOTE_STATUS_LABELS[vue.status]}</Pastille>
        </h2>
        <p className="text-sm">
          {vue.customerName ?? 'Client sans fiche'} · valable jusqu’au {formatJour(vue.validUntil)}
          {vue.title ? ` · ${vue.title}` : ''}
        </p>
        {vue.opportunity ? (
          <p className="text-sm">
            Opportunité :{' '}
            <Link
              href={`${CRM_BASE}/${encodeURIComponent(vue.opportunity.id)}`}
              className="underline underline-offset-2"
            >
              {vue.opportunity.title ?? 'ouvrir'}
            </Link>
          </p>
        ) : null}
      </header>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {info ? (
        <p role="status" className="text-sm">
          {info}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BOUTON_PETIT}
          disabled={envoi}
          onClick={() =>
            void agir(async () => {
              const r = await crmApi.downloadQuotePdf(vue.id, `${vue.number}-v${vue.version}.pdf`);
              telecharger(r.blob, r.filename);
            })
          }
        >
          Télécharger le PDF
        </button>
        {gerer && a.send ? (
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={envoi || vue.blockers.length > 0}
            onClick={() =>
              void agir(
                () => crmApi.quoteAction(vue.id, 'send', vue.revision),
                'Devis marqué envoyé : remettez le PDF au client.',
              )
            }
          >
            Marquer envoyé
          </button>
        ) : null}
        {gerer && a.accept ? (
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={envoi}
            onClick={() =>
              void agir(async () => {
                const v = await crmApi.quoteAction(vue.id, 'accept', vue.revision);
                if (v.opportunityOutcome) setInfo(ISSUE_GAIN[v.opportunityOutcome]);
                return v;
              })
            }
          >
            Accepté par le client
          </button>
        ) : null}
        {gerer && a.refuse ? (
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={envoi}
            onClick={() => {
              const motif = window.prompt('Motif du refus (facultatif)') ?? null;
              void agir(() => crmApi.refuseQuote(vue.id, vue.revision, motif?.trim() || null));
            }}
          >
            Refusé
          </button>
        ) : null}
        {gerer && a.newVersion ? (
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={envoi}
            onClick={() => void agir(() => crmApi.quoteAction(vue.id, 'new-version', vue.revision))}
          >
            Nouvelle version
          </button>
        ) : null}
        {gerer && a.convert ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi}
            onClick={() =>
              void agir(async () => {
                const r = await crmApi.convertQuote(vue.id, vue.revision);
                router.push(
                  `${FACTURES_BASE}/${encodeURIComponent(r.invoiceId)}${r.amountsDiffer ? '?ecart-devis=1' : ''}`,
                );
                return r.quote;
              })
            }
          >
            Convertir en facture
          </button>
        ) : null}
        {gerer && a.delete && vue.version === 1 ? (
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={envoi}
            onClick={() =>
              void agir(async () => {
                await crmApi.deleteQuote(vue.id);
                router.push(DEVIS_BASE);
              })
            }
          >
            Supprimer le brouillon
          </button>
        ) : null}
      </div>

      {vue.blockers.length > 0 ? (
        <div className="rounded-md border border-[var(--border)] p-3 text-sm">
          <p className="font-medium">Avant de l’envoyer :</p>
          <ul className="mt-1 list-disc pl-5">
            {vue.blockers.map((b, i) => (
              <li key={`${b.code}-${i}`}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {vue.conversion ? (
        <p className="text-sm">
          {vue.conversion.alive ? (
            <>
              Converti en facture{' '}
              <Link
                href={`${FACTURES_BASE}/${encodeURIComponent(vue.conversion.invoiceId)}`}
                className="font-mono underline underline-offset-2"
              >
                {vue.conversion.reference ?? 'ouvrir'}
              </Link>
              {vue.conversion.invoiceStatus ? ` (${vue.conversion.invoiceStatus})` : ''}.
            </>
          ) : (
            'Le brouillon de facture issu de ce devis a été supprimé : vous pouvez reconvertir.'
          )}
        </p>
      ) : null}

      {a.edit ? (
        <QuoteEditor key={vue.revision} vueInitiale={vue} onEnregistre={setVue} />
      ) : (
        <div className="flex flex-col gap-3">
          <table className="w-full text-sm">
            <caption className="sr-only">Lignes du devis</caption>
            <thead>
              <tr className="text-left text-[var(--foreground-muted)]">
                <th scope="col">Désignation</th>
                <th scope="col">Groupe</th>
                <th scope="col" className="text-right">
                  Quantité
                </th>
                <th scope="col" className="text-right">
                  Prix unitaire
                </th>
                <th scope="col" className="text-right">
                  Montant
                </th>
              </tr>
            </thead>
            <tbody>
              {vue.lines.map((l) => (
                <tr key={l.index} className="border-t border-[var(--border)]">
                  <td>{l.name}</td>
                  <td>[{l.taxGroup}]</td>
                  <td className="text-right font-mono">{l.quantity}</td>
                  <td className="text-right font-mono">
                    {formatMontant(l.unitPrice, vue.currency)}
                  </td>
                  <td className="text-right font-mono">
                    {l.amount ? formatMontant(l.amount, vue.currency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totaux ? (
            <dl className="grid max-w-sm grid-cols-2 gap-1 self-end text-sm">
              <dt className="text-[var(--foreground-muted)]">Total TVA</dt>
              <dd className="text-right font-mono">
                {formatMontant(totaux.vatTotal, vue.currency)}
              </dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-mono font-semibold">
                {formatMontant(totaux.total, vue.currency)}
              </dd>
            </dl>
          ) : null}
          {vue.notes ? <p className="text-sm">{vue.notes}</p> : null}
          {vue.refusalReason ? (
            <p className="text-sm">Motif du refus : {vue.refusalReason}</p>
          ) : null}
        </div>
      )}

      {vue.previousVersions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Versions précédentes</h3>
          <ul className="text-sm">
            {vue.previousVersions.map((p) => (
              <li key={p.version}>
                Version {p.version} — {QUOTE_STATUS_LABELS[p.status]}
                {p.total ? ` — ${formatMontant(p.total, vue.currency)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
