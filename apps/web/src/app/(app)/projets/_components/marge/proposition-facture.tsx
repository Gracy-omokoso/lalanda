'use client';

// Proposition « Préparer la facture » d'un jalon terminé (ADR-0039 § 6.3, lot L4a).
//
// À afficher quand une écriture de tâche rend la suggestion `PREPARE_INVOICE`
// (`suggestionFacture(résultat.suggestions)`) et que l'appelant détient
// `sales.manage`. Le geste crée un BROUILLON de facture `FV` (lignes du devis à
// prix fixés, ou facture vide) : il n'est ni émis, ni normalisé, ni envoyé —
// « Émettre » reste un geste de l'utilisateur, sur la fiche de la facture.
//
// Proposer, jamais imposer : « Plus tard » ferme la proposition sans rien créer.
//
// ADR-0074 : contenu du brouillon en cartes de choix (une colonne), boutons
// `Button`. Même corps envoyé.

import type { WorkProjectView } from '@lalanda/shared/work';
import { Alert, Button, ChoiceCards, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { crmApi } from '@/lib/api-crm';
import { workBillingApi, workErrorCode, type PreparedInvoiceView } from '@/lib/work-billing-api';

import { FACTURES_BASE } from '../../../ventes/factures/_components/invoice-model';

import { messageErreur } from './marge-model';

interface Props {
  taskId: string;
  /** Projet du jalon : ses devis liés proposent leurs lignes. */
  project: Pick<WorkProjectView, 'links' | 'source'>;
  /** Appelé après la préparation (pour relire la tâche : `billing` est posé). */
  onPrepared?: (result: PreparedInvoiceView) => void;
  onClose: () => void;
}

export function PropositionFacture({
  taskId,
  project,
  onPrepared,
  onClose,
}: Props): React.ReactElement {
  // ADR-0040 — C7 : un projet issu d'une opportunité n'a pas de devis d'origine.
  const quoteId =
    (project.source?.kind === 'quote' ? project.source.quoteId : null) ??
    project.links.quotes[0]?.quoteId ??
    null;
  const quoteNumber = project.links.quotes.find((q) => q.quoteId === quoteId)?.number ?? null;
  const [lineCount, setLineCount] = useState<number | null>(null);
  const [source, setSource] = useState<'quote_lines' | 'empty'>(quoteId ? 'quote_lines' : 'empty');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [prepare, setPrepare] = useState<PreparedInvoiceView | null>(null);

  useEffect(() => {
    if (!quoteId) return;
    let actif = true;
    crmApi
      .getQuote(quoteId)
      .then((q) => {
        if (actif) setLineCount(q.status === 'accepted' ? q.lines.length : 0);
      })
      .catch(() => {
        if (actif) setLineCount(0);
      });
    return () => {
      actif = false;
    };
  }, [quoteId]);

  const lignesDisponibles = quoteId !== null && (lineCount ?? 0) > 0;

  async function preparer(): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      const r = await workBillingApi.prepareInvoice(
        taskId,
        source === 'quote_lines' && quoteId && lignesDisponibles
          ? {
              source: 'quote_lines',
              quoteId,
              lineIndexes: Array.from({ length: lineCount ?? 0 }, (_, i) => i),
            }
          : { source: 'empty' },
      );
      setPrepare(r);
      onPrepared?.(r);
    } catch (err) {
      setErreur(
        workErrorCode(err) === 'WORK_MILESTONE_ALREADY_INVOICED'
          ? 'Une facture a déjà été préparée pour ce jalon.'
          : messageErreur(err, 'La facture n’a pas pu être préparée.'),
      );
    } finally {
      setEnCours(false);
    }
  }

  if (prepare) {
    return (
      <Alert
        tone="success"
        title="Brouillon de facture préparé"
        action={
          <Link
            href={`${FACTURES_BASE}/${prepare.invoiceId}`}
            className={buttonClasses('secondary', 'sm')}
          >
            Ouvrir la facture
          </Link>
        }
      >
        Le brouillon n’est ni émis ni normalisé : vérifiez-le, puis émettez-le vous-même depuis sa
        fiche.
      </Alert>
    );
  }

  return (
    <Alert
      tone="info"
      title="Jalon terminé : préparer la facture ?"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            busy={enCours}
            disabled={quoteId !== null && lineCount === null}
            onClick={() => void preparer()}
          >
            {enCours ? 'Préparation…' : 'Préparer la facture'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Plus tard
          </Button>
        </div>
      }
    >
      <ChoiceCards<'quote_lines' | 'empty'>
        aria-label="Contenu du brouillon"
        className="mt-1"
        columns={1}
        value={lignesDisponibles ? source : 'empty'}
        onChange={setSource}
        options={[
          ...(lignesDisponibles
            ? [
                {
                  value: 'quote_lines' as const,
                  label: `Reprendre les ${lineCount} ligne(s) du devis ${quoteNumber ?? ''}`.trim(),
                  description: 'Lignes reprises à leurs prix.',
                },
              ]
            : []),
          {
            value: 'empty' as const,
            label: 'Brouillon vide',
            description: 'À compléter sur la fiche de la facture.',
          },
        ]}
      />
      {erreur ? <p className="mt-2 text-[var(--danger)]">{erreur}</p> : null}
    </Alert>
  );
}
