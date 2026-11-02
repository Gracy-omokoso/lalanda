'use client';

// Échéancier d'un contrat — ADR-0050 § 2.4, § 5.3, lot V7 : échéances préparées, à
// préparer, à venir, bloquées (motif affiché), calculées par le moteur. « Préparer
// maintenant » crée un BROUILLON et l'ouvre ; rien n'est émis ici.

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { salesContractsApi, type SalesContractScheduleView } from '@/lib/api-sales-contracts';

import { Alerte, Pastille } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { formatJour } from '../../devis/_components/quote-model';

import {
  ECHEANCE_LABELS,
  lienFacture,
  messageEngagement,
  phrasesAvertissements,
  tonEcheance,
} from './contract-model';

export function SectionEcheancier({
  contractId,
  peutPreparer,
}: {
  contractId: string;
  /** `sales.read` + `sales.manage`. */
  peutPreparer: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [vue, setVue] = useState<SalesContractScheduleView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    salesContractsApi
      .getSchedule(contractId)
      .then((v) => {
        if (!annule) setVue(v);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageEngagement(err, 'Échéancier illisible.'));
      });
    return () => {
      annule = true;
    };
  }, [contractId]);

  async function preparer(key: string): Promise<void> {
    setEnvoi(key);
    setErreur(null);
    try {
      const r = await salesContractsApi.prepareOccurrence(contractId, key);
      router.push(lienFacture(r.invoiceId));
    } catch (err) {
      setErreur(messageEngagement(err, 'Le brouillon n’a pas pu être préparé.'));
      setEnvoi(null);
    }
  }

  if (vue === null) {
    return erreur ? (
      <Alerte>
        <p>{erreur}</p>
      </Alerte>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Calcul de l’échéancier…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <p className="text-xs text-[var(--foreground-muted)]">
        Du {formatJour(vue.window.from)} au {formatJour(vue.window.to)}
        {vue.billableUntil ? ` · rien n’est préparé après le ${formatJour(vue.billableUntil)}` : ''}
        {vue.autoPrepareEnabled
          ? vue.leadDays > 0
            ? ` · brouillons préparés ${vue.leadDays} jour(s) avant l’échéance`
            : ' · brouillons préparés le jour de l’échéance'
          : ' · préparation automatique désactivée'}
        . Les échéances à venir n’entrent pas dans la prévision de trésorerie.
      </p>
      {phrasesAvertissements(vue.warnings).map((m) => (
        <p key={m} className="text-sm">
          {m}
        </p>
      ))}
      {vue.entries.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucune échéance sur cette période.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {vue.entries.map((e) => (
            <li
              key={e.key}
              className="flex flex-col gap-1.5 rounded-md border border-[var(--border)] p-3 text-sm"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{formatJour(e.date)}</span>
                <Pastille ton={tonEcheance(e.state)}>
                  {e.stateLabel || ECHEANCE_LABELS[e.state]}
                </Pastille>
              </span>
              {e.label ? <span>{e.label}</span> : null}
              {e.periodStart && e.periodEnd ? (
                <span className="text-xs text-[var(--foreground-muted)]">
                  Période du {formatJour(e.periodStart)} au {formatJour(e.periodEnd)}
                  {e.periodExceedsBounds
                    ? ' (déborde du terme : aucun prorata, à ajuster à la main)'
                    : ''}
                </span>
              ) : null}
              {e.reasons.length > 0 ? (
                <ul className="list-disc pl-5 text-xs">
                  {e.reasons.map((r) => (
                    <li key={r.code}>{r.message}</li>
                  ))}
                </ul>
              ) : null}
              {e.invoice ? (
                <Link
                  href={lienFacture(e.invoice.invoiceId)}
                  className="text-xs underline underline-offset-2"
                >
                  {e.invoice.reference ?? 'Brouillon'}
                  {e.invoice.total
                    ? ` — ${formatMontant(e.invoice.total, e.invoice.currency)}`
                    : ''}{' '}
                  (ouvrir pour émettre)
                </Link>
              ) : null}
              {peutPreparer &&
              !e.invoice &&
              (e.state === 'to_prepare' || e.state === 'upcoming') ? (
                <button
                  type="button"
                  className={buttonClasses('secondary', 'sm', 'self-start')}
                  disabled={envoi !== null}
                  onClick={() => void preparer(e.key)}
                >
                  {envoi === e.key ? 'Préparation…' : 'Préparer maintenant'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
