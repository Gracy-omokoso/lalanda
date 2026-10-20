'use client';

// Impression d'un document de vente (ADR-0025). Le PDF est produit par l'API
// depuis le contenu figé : le navigateur ne compose rien. « Duplicata » produit
// une copie numérotée et journalisée d'une facture finale ; l'original se
// retélécharge à l'identique autant que voulu.

import { useState } from 'react';

import { api, type InvoiceView } from '@/lib/api';

import { Alerte, BOUTON } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';

import { enteteDocument, impressionsDocument, messageFacture } from './invoice-model';

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

export function PdfActions({ vue }: { vue: InvoiceView }): React.ReactElement {
  const { gerer } = useAccesVentes();
  const [envoi, setEnvoi] = useState<'pdf' | 'duplicata' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const libelles = impressionsDocument(vue, { gerer });
  const base = (enteteDocument(vue).reference || vue.proformaRef).replace(/[^A-Za-z0-9._-]/g, '-');

  async function lancer(kind: 'pdf' | 'duplicata'): Promise<void> {
    setEnvoi(kind);
    setErreur(null);
    setInfo(null);
    try {
      const r =
        kind === 'pdf'
          ? await api.downloadInvoicePdf(vue.id, `${base}.pdf`)
          : await api.downloadInvoiceDuplicate(vue.id, `${base}-duplicata.pdf`);
      telecharger(r.blob, r.filename);
      if (kind === 'duplicata') {
        setInfo(
          r.duplicateNumber !== null
            ? `Duplicata n° ${r.duplicateNumber} enregistré au journal.`
            : 'Duplicata enregistré au journal.',
        );
      }
    } catch (err) {
      setErreur(messageFacture(err, 'Téléchargement impossible.'));
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className={BOUTON}
          disabled={envoi !== null}
          onClick={() => void lancer('pdf')}
        >
          {envoi === 'pdf' ? 'Préparation du PDF…' : libelles.pdf}
        </button>
        {libelles.duplicata ? (
          <button
            type="button"
            className={BOUTON}
            disabled={envoi !== null}
            onClick={() => void lancer('duplicata')}
          >
            {envoi === 'duplicata' ? 'Préparation du duplicata…' : libelles.duplicata}
          </button>
        ) : null}
      </div>
      {info ? (
        <p role="status" className="text-xs text-[var(--foreground-muted)]">
          {info}
        </p>
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
