'use client';

// « Normaliser » (organisation en facture normalisée, ADR-0023 §§ S25e.4, 6).
//
// 1. Le taux de référence du jour (taux officiel publié par la DGI), sa date et
//    sa source, servis par `GET /sales/exchange-rate-reference`.
// 2. Par défaut, ce taux, sans saisie. Un autre taux peut être saisi : le
//    rappel ±1 % s'affiche, c'est le SERVEUR qui contrôle.
// 3. La conversion en CDF et le recalcul sont faits par le moteur, côté
//    serveur ; l'aperçu des montants CDF affiché ensuite est celui RENVOYÉ par
//    l'API. Le document reste un pro forma « normalisation en cours » jusqu'à
//    la réponse de la DGI (lot S25f).

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api, type ExchangeRateReference, type InvoiceView } from '@/lib/api';

import { Alerte, BOUTON, CHAMP, aria } from '../../_components/form-ui';
import { formatDate } from '../../_components/sales-model';

import { AmountsPanel } from './amounts-panel';
import { Dialogue } from './dialog-ui';
import {
  type ChoixTaux,
  enteteDocument,
  formatDateDgi,
  formatTauxChange,
  jourDgi,
  messageFacture,
  preparerNormalisation,
  problemesGel,
  rappelTolerance,
  STATUS_LABELS,
  tauxIndisponible,
} from './invoice-model';

export function NormalizeDialog({
  vue,
  contreValeurUsd,
  onFermer,
  onNormalise,
}: {
  vue: InvoiceView;
  /** Document en CDF dont la contre-valeur USD est demandée (`showUsdCounterValue`). */
  contreValeurUsd: boolean;
  onFermer: () => void;
  /** Appelé avec la vue renvoyée, quand la personne ferme l'aperçu. */
  onNormalise: (v: InvoiceView) => void;
}): React.ReactElement {
  const besoinTaux = vue.currency === 'USD' || contreValeurUsd;
  const [ref, setRef] = useState<ExchangeRateReference | null>(null);
  const [etatRef, setEtatRef] = useState<'chargement' | 'pret' | 'indisponible' | 'erreur'>(
    'chargement',
  );
  const [choix, setChoix] = useState<ChoixTaux>('officiel');
  const [taux, setTaux] = useState('');
  const [date, setDate] = useState('');
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<{
    message: string;
    details: string[];
    taux: boolean;
  } | null>(null);
  const [resultat, setResultat] = useState<InvoiceView | null>(null);

  useEffect(() => {
    let annule = false;
    api
      .getExchangeRateReference()
      .then((r) => {
        if (annule) return;
        setRef(r);
        setDate(jourDgi(r.date));
        setEtatRef('pret');
      })
      .catch((err: unknown) => {
        if (!annule) setEtatRef(tauxIndisponible(err) ? 'indisponible' : 'erreur');
      });
    return () => {
      annule = true;
    };
  }, []);

  const environnementTest = (ref?.environment ?? vue.environment) === 'test';

  async function normaliser(): Promise<void> {
    const prep = preparerNormalisation(vue.revision, besoinTaux ? choix : 'officiel', taux, date);
    if (!prep.ok) {
      setChamps(prep.champs);
      return;
    }
    setChamps({});
    setEnvoi(true);
    setErreur(null);
    try {
      setResultat(await api.normalizeInvoice(vue.id, prep.corps));
    } catch (err) {
      setErreur({
        message: messageFacture(err, 'Normalisation impossible.'),
        details: problemesGel(err),
        taux: tauxIndisponible(err),
      });
    } finally {
      setEnvoi(false);
    }
  }

  if (resultat) {
    const entete = enteteDocument(resultat);
    return (
      <Dialogue
        titre={
          resultat.status === 'normalized'
            ? 'Facture normalisée'
            : resultat.status === 'normalization_failed'
              ? 'Normalisation refusée'
              : 'Pro forma figé — en attente de la DGI'
        }
        onFermer={() => onNormalise(resultat)}
      >
        <p className="text-sm" aria-live="polite">
          <strong>{entete.titre}</strong> — <span className="font-mono">{entete.reference}</span>.{' '}
          {STATUS_LABELS[resultat.status]}.
        </p>
        {resultat.documentKind === 'proforma' ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Le contenu est figé et converti. Il reste un pro forma, non valable comme facture,
            jusqu’à la confirmation de la DGI : le numéro de facture ne sera attribué qu’à ce
            moment.
          </p>
        ) : null}
        <AmountsPanel vue={resultat} />
        <div className="flex justify-end">
          <button type="button" className={BOUTON} onClick={() => onNormalise(resultat)}>
            Fermer
          </button>
        </div>
      </Dialogue>
    );
  }

  return (
    <Dialogue titre="Normaliser le document" onFermer={onFermer}>
      {environnementTest ? (
        <p className="rounded-md border border-[var(--warn)]/50 px-3 py-2 text-sm font-medium">
          Mode test — environnement de test de la DGI : la facture obtenue n’aura aucune valeur
          fiscale.
        </p>
      ) : null}
      <p className="text-sm">
        Le pro forma <span className="font-mono">{vue.proformaRef}</span> sera figé et{' '}
        {vue.currency === 'USD'
          ? 'converti en francs congolais : chaque prix unitaire est converti au taux choisi, puis le document est recalculé en CDF.'
          : 'transmis en francs congolais, sans conversion.'}{' '}
        Il ne sera plus modifiable. Il deviendra une facture seulement quand la DGI l’aura confirmé.
      </p>

      {besoinTaux ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">
            Taux de change {vue.currency === 'CDF' ? '(contre-valeur en dollars)' : ''}
          </legend>
          {etatRef === 'chargement' ? (
            <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
              Lecture du taux du jour…
            </p>
          ) : etatRef === 'pret' && ref ? (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="choix-taux"
                  checked={choix === 'officiel'}
                  onChange={() => setChoix('officiel')}
                  className="mt-1"
                />
                <span>
                  Taux officiel : <strong>{formatTauxChange(ref.rate)}</strong>
                  <span className="block text-xs text-[var(--foreground-muted)]">
                    Taux du {formatDateDgi(ref.date)}, publié par la DGI (
                    {ref.environment === 'test' ? 'environnement de test' : 'production'}), relevé
                    le {formatDate(ref.fetchedAt)}.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="choix-taux"
                  checked={choix === 'autre'}
                  onChange={() => setChoix('autre')}
                  className="mt-1"
                />
                <span>Un autre taux</span>
              </label>
              {choix === 'autre' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="norm-taux" className="text-sm">
                      Taux (CDF pour 1 USD)
                    </label>
                    <input
                      id="norm-taux"
                      inputMode="decimal"
                      value={taux}
                      onChange={(e) => setTaux(e.target.value)}
                      className={CHAMP}
                      {...aria('norm-taux', champs['rate'], true)}
                    />
                    <p id="norm-taux-aide" className="text-xs text-[var(--foreground-muted)]">
                      {rappelTolerance(ref)}
                    </p>
                    {champs['rate'] ? (
                      <p id="norm-taux-erreur" className="text-xs font-medium text-[var(--danger)]">
                        {champs['rate']}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="norm-date" className="text-sm">
                      Date du taux
                    </label>
                    <input
                      id="norm-date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className={CHAMP}
                      {...aria('norm-date', champs['date'])}
                    />
                    {champs['date'] ? (
                      <p id="norm-date-erreur" className="text-xs font-medium text-[var(--danger)]">
                        {champs['date']}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <Alerte>
              <p>
                {etatRef === 'indisponible'
                  ? 'Le taux officiel du jour n’est pas disponible.'
                  : 'Impossible de lire le taux officiel du jour.'}{' '}
                Rafraîchissez les listes de référence de votre point de vente, puis rouvrez cette
                fenêtre.
              </p>
              <Link href="/organisation/fiscalite" className="underline">
                Ouvrir Organisation › Fiscalité
              </Link>
            </Alerte>
          )}
        </fieldset>
      ) : null}

      <p className="text-xs text-[var(--foreground-muted)]">
        Les montants en CDF sont calculés par le serveur au moment de la normalisation : ils
        s’afficheront ici dès sa réponse, sous « Montants normalisés (CDF) — font foi ».
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
          {erreur.taux ? (
            <Link href="/organisation/fiscalite" className="underline">
              Ouvrir Organisation › Fiscalité
            </Link>
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
          onClick={() => void normaliser()}
          disabled={envoi || (besoinTaux && etatRef !== 'pret')}
        >
          {envoi ? 'Normalisation…' : 'Normaliser'}
        </button>
      </div>
    </Dialogue>
  );
}
