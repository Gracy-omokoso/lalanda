'use client';

// Créer un avoir sur une facture finale (ADR-0023 § S25e.5) : la nature, puis
// un avoir total (toutes les quantités restantes) ou partiel (lignes choisies
// ensuite). L'API crée un BROUILLON d'avoir prérempli ; rien n'est émis ici.

import { useState } from 'react';

import { api, type CreditNoteNature, type CreditNoteScope, type InvoiceView } from '@/lib/api';

import { Alerte, BOUTON } from '../../_components/form-ui';

import { Dialogue } from './dialog-ui';
import { messageFacture, NATURE_LABELS, NATURES } from './invoice-model';

export function CreditNoteDialog({
  origine,
  reference,
  onFermer,
  onCree,
}: {
  origine: InvoiceView;
  /** Numéro de la facture d'origine, tel qu'affiché. */
  reference: string;
  onFermer: () => void;
  onCree: (v: InvoiceView) => void;
}): React.ReactElement {
  const [nature, setNature] = useState<CreditNoteNature | null>(null);
  const [portee, setPortee] = useState<CreditNoteScope>('remaining');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function creer(): Promise<void> {
    if (nature === null) {
      setErreur('Choisissez la nature de l’avoir.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      onCree(
        await api.createCreditNote(origine.id, {
          nature,
          scope: nature === 'RRR' ? 'empty' : portee,
        }),
      );
    } catch (err) {
      setErreur(messageFacture(err, 'Création de l’avoir impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Dialogue titre={`Créer un avoir — facture n° ${reference}`} onFermer={onFermer}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Nature de l’avoir</legend>
        {NATURES.map((n) => (
          <label key={n} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="nature-avoir"
              checked={nature === n}
              onChange={() => setNature(n)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{NATURE_LABELS[n].court}</span>{' '}
              <span className="font-mono text-xs">({n})</span>
              <span className="block text-xs text-[var(--foreground-muted)]">
                {NATURE_LABELS[n].aide}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {nature !== null && nature !== 'RRR' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Étendue</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="portee-avoir"
              checked={portee === 'remaining'}
              onChange={() => setPortee('remaining')}
              className="mt-1"
            />
            <span>
              Total — reprendre toutes les quantités restantes
              <span className="block text-xs text-[var(--foreground-muted)]">
                Vous pourrez encore réduire les quantités dans le brouillon.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="portee-avoir"
              checked={portee === 'empty'}
              onChange={() => setPortee('empty')}
              className="mt-1"
            />
            <span>Partiel — choisir les lignes et les quantités</span>
          </label>
          <p className="text-xs text-[var(--foreground-muted)]">
            Les lignes reprennent la désignation et le prix unitaire de la facture d’origine ; seule
            la quantité varie, au plus ce qui reste à créditer.
          </p>
        </fieldset>
      ) : null}

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
          Annuler
        </button>
        <button
          type="button"
          className={`${BOUTON} border-[var(--accent)] font-semibold`}
          onClick={() => void creer()}
          disabled={envoi}
        >
          {envoi ? 'Création…' : 'Créer le brouillon d’avoir'}
        </button>
      </div>
    </Dialogue>
  );
}
