'use client';

// Créer un avoir sur une facture finale (ADR-0023 § S25e.5) : la nature, puis
// un avoir total (toutes les quantités restantes) ou partiel (lignes choisies
// ensuite). L'API crée un BROUILLON d'avoir prérempli ; rien n'est émis ici.
//
// ADR-0074 : nature et étendue en cartes de choix (`ChoiceCards`) ; même appel.

import { ChoiceCards, Field, FormGrid } from '@lalanda/ui';
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
      <FormGrid>
        <Field id="avoir-nature" label="Nature de l’avoir" group required size="full">
          <ChoiceCards<CreditNoteNature>
            value={nature ?? ''}
            onChange={(n) => {
              setNature(n);
              setErreur(null);
            }}
            options={NATURES.map((n) => ({
              value: n,
              label: (
                <>
                  {NATURE_LABELS[n].court} <span className="font-mono text-xs">({n})</span>
                </>
              ),
              description: NATURE_LABELS[n].aide,
            }))}
          />
        </Field>

        {nature !== null && nature !== 'RRR' ? (
          <Field
            id="avoir-portee"
            label="Étendue"
            group
            size="full"
            hint="Les lignes reprennent la désignation et le prix unitaire de la facture d’origine ; seule la quantité varie, au plus ce qui reste à créditer."
          >
            <ChoiceCards<CreditNoteScope>
              value={portee}
              onChange={setPortee}
              options={[
                {
                  value: 'remaining',
                  label: 'Total — reprendre toutes les quantités restantes',
                  description: 'Vous pourrez encore réduire les quantités dans le brouillon.',
                },
                { value: 'empty', label: 'Partiel — choisir les lignes et les quantités' },
              ]}
            />
          </Field>
        ) : null}
      </FormGrid>

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
