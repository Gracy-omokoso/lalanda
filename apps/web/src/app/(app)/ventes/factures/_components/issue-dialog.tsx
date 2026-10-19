'use client';

// « Émettre » (organisation ordinaire, ADR-0023 § S25e.6) : numéro définitif de
// la série, contenu figé. Action irréversible : la boîte dit sa portée avant
// de l'exécuter (docs/04, conventions). `sales.invoice` seulement.

import { useState } from 'react';

import { api, type InvoiceView } from '@/lib/api';

import { Alerte, BOUTON } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';

import { Dialogue } from './dialog-ui';
import { messageFacture, problemesGel } from './invoice-model';

export function IssueDialog({
  vue,
  onFermer,
  onEmise,
}: {
  vue: InvoiceView;
  onFermer: () => void;
  onEmise: (v: InvoiceView) => void;
}): React.ReactElement {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<{ message: string; details: string[] } | null>(null);
  const total = vue.documentAmounts.calculation.totals?.total ?? null;

  async function emettre(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      onEmise(await api.issueInvoice(vue.id, vue.revision));
    } catch (err) {
      setErreur({
        message: messageFacture(err, 'Émission impossible.'),
        details: problemesGel(err),
      });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Dialogue titre="Émettre la facture" onFermer={onFermer}>
      <p className="text-sm">
        Le document <span className="font-mono">{vue.proformaRef}</span>
        {total !== null ? (
          <>
            {' '}
            d’un total de <strong>{formatMontant(total, vue.currency)}</strong>
          </>
        ) : null}{' '}
        devient une facture : il reçoit le prochain numéro de votre série et ne pourra plus être
        modifié ni supprimé. Une erreur se corrigera par un avoir.
      </p>
      {erreur ? (
        <Alerte>
          <p>{erreur.message}</p>
          {erreur.details.length > 0 ? (
            <ul className="list-disc pl-5">
              {erreur.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
          Annuler
        </button>
        <button
          type="button"
          className={`${BOUTON} border-[var(--accent)] font-semibold`}
          onClick={() => void emettre()}
          disabled={envoi}
        >
          {envoi ? 'Émission…' : 'Émettre'}
        </button>
      </div>
    </Dialogue>
  );
}
