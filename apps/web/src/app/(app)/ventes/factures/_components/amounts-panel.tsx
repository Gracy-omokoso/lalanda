// Panneau des montants (ADR-0023 § S25e.4) : deux jeux, deux libellés fixes.
//
// « Montants du document (USD) » : la devise choisie par l'utilisateur.
// « Montants normalisés (CDF) — font foi » : les seuls qui ont valeur fiscale.
//
// Tout ce qui s'affiche ici est RENVOYÉ par l'API (moteur `invoice-totals`) et
// seulement mis en forme. Aucun total n'est calculé dans le navigateur.

import type { InvoiceGroupTotals, InvoiceTotals, InvoiceView } from '@/lib/api';

import { formatMontant, formatTaux } from '../../_components/sales-model';

import {
  formatDateDgi,
  formatTauxChange,
  PAYMENT_LABELS,
  RATE_SOURCE_LABELS,
} from './invoice-model';

function Groupes({
  groupes,
  devise,
}: {
  groupes: readonly InvoiceGroupTotals[];
  devise: string;
}): React.ReactElement | null {
  if (groupes.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[18rem] text-xs">
        <caption className="sr-only">Totaux par groupe de taxation</caption>
        <thead className="text-[var(--foreground-muted)]">
          <tr>
            <th scope="col" className="py-1 pr-2 text-left font-medium">
              Groupe
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              HT
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              TVA
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              TTC
            </th>
          </tr>
        </thead>
        <tbody>
          {groupes.map((g) => (
            <tr key={g.group} className="border-t border-[var(--border)]">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {g.group} · {formatTaux(g.ratePercent)}
              </th>
              <td className="py-1 pr-2 text-right font-mono">{formatMontant(g.ht, devise)}</td>
              <td className="py-1 pr-2 text-right font-mono">{formatMontant(g.vat, devise)}</td>
              <td className="py-1 text-right font-mono">{formatMontant(g.total, devise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totaux({ totaux, devise }: { totaux: InvoiceTotals; devise: string }): React.ReactElement {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
      <dt className="text-[var(--foreground-muted)]">TVA</dt>
      <dd className="text-right font-mono">{formatMontant(totaux.vatTotal, devise)}</dd>
      {totaux.specificTax !== '0.00' ? (
        <>
          <dt className="text-[var(--foreground-muted)]">Taxe spécifique</dt>
          <dd className="text-right font-mono">{formatMontant(totaux.specificTax, devise)}</dd>
        </>
      ) : null}
      <dt className="font-semibold">Total</dt>
      <dd className="text-right font-mono font-semibold">{formatMontant(totaux.total, devise)}</dd>
    </dl>
  );
}

export function AmountsPanel({
  vue,
}: {
  vue: Pick<
    InvoiceView,
    | 'documentAmounts'
    | 'normalizedAmounts'
    | 'conversion'
    | 'currency'
    | 'emissionMode'
    | 'readiness'
  >;
}): React.ReactElement {
  // Organisation ordinaire : document émis tel quel, sans montants normalisés.
  const ordinaire =
    vue.emissionMode === 'standard' ||
    (vue.emissionMode === null && vue.readiness.action === 'issue');
  const doc = vue.documentAmounts;
  const norm = vue.normalizedAmounts;
  const devise = doc.currency;
  const calcul = doc.calculation;
  return (
    <section aria-label="Montants" className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold">Montants du document ({devise})</h3>
        {calcul.totals ? (
          <>
            <Groupes groupes={calcul.totals.groups} devise={devise} />
            <Totaux totaux={calcul.totals} devise={devise} />
          </>
        ) : (
          <div className="text-sm text-[var(--foreground-muted)]">
            <p>Le total s’affichera dès que le document sera complet.</p>
            {calcul.issues.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {calcul.issues.map((i, n) => (
                  <li key={n}>
                    {typeof i.lineIndex === 'number' ? `Ligne ${String(i.lineIndex + 1)} : ` : ''}
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        {doc.payments.length > 0 ? (
          <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-2 text-sm">
            <p className="text-xs font-medium text-[var(--foreground-muted)]">Paiements</p>
            <ul className="flex flex-col gap-0.5">
              {doc.payments.map((p, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{p.methodLabel || PAYMENT_LABELS[p.method]}</span>
                  <span className="font-mono">{formatMontant(p.amount, devise)}</span>
                </li>
              ))}
            </ul>
            {doc.paymentsCheck && doc.paymentsCheck.amountOnCredit !== '0.00' ? (
              <p className="text-xs text-[var(--foreground-muted)]">
                Dont à crédit (non réglé) :{' '}
                {formatMontant(doc.paymentsCheck.amountOnCredit, devise)}
              </p>
            ) : null}
            {doc.paymentsCheck && !doc.paymentsCheck.ok ? (
              <ul className="text-xs font-medium text-[var(--warn)]">
                {doc.paymentsCheck.issues.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold">Montants normalisés (CDF) — font foi</h3>
        {norm ? (
          <>
            <Groupes groupes={norm.calculation.groups} devise="CDF" />
            <Totaux totaux={norm.calculation} devise="CDF" />
            {vue.conversion ? (
              <p className="text-xs text-[var(--foreground-muted)]">
                {vue.conversion.from === 'CDF'
                  ? RATE_SOURCE_LABELS.identity
                  : `${formatTauxChange(vue.conversion.rate)} du ${formatDateDgi(vue.conversion.rateDate)} — ${RATE_SOURCE_LABELS[vue.conversion.rateSource]}.`}{' '}
                Chaque prix unitaire est converti puis le document recalculé en CDF : le total peut
                différer de quelques centimes du total en dollars multiplié par le taux.
              </p>
            ) : null}
            {norm.counterValueUsd ? (
              <p className="text-xs text-[var(--foreground-muted)]">
                Contre-valeur : {formatMontant(norm.counterValueUsd.amount, 'USD')} au taux de{' '}
                {formatTauxChange(norm.counterValueUsd.rate)}.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            {ordinaire
              ? 'Sans objet : votre organisation n’est pas en facture normalisée ; le document vaut dans sa devise.'
              : devise === 'CDF'
                ? 'Calculés à la normalisation, dans les organisations en facture normalisée.'
                : 'Calculés par le serveur au moment de « Normaliser », au taux officiel du jour, dans les organisations en facture normalisée.'}
          </p>
        )}
      </div>
    </section>
  );
}
