'use client';

// État de la normalisation DGI d'un document figé (S25f — ADR-0024 § 9.3).
//
// Une seule source : `presentationNormalisation` (invoice-model.ts) dit le
// titre, le ton, les consignes, l'erreur et les boutons ; ce composant les
// assemble. Trois règles :
//
// - Les boutons viennent de `normalization.actions`, calculé par l'API selon la
//   phase ET les droits de la personne. Masquer n'autorise rien : l'API refuse
//   de toute façon.
// - Les relectures (`GET`) sont bornées dans le temps (`prochaineRelecture`) ;
//   au-delà, un bouton « Actualiser ».
// - « Relancer » et « Vérifier maintenant » ne sont JAMAIS rejoués après une
//   coupure : on relit le document, comme pour « Normaliser ».

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { api, type InvoiceView } from '@/lib/api';

import { Alerte, BOUTON, Pastille } from '../../_components/form-ui';
import { formatDate } from '../../_components/sales-model';

import { DeclareNotNormalizedDialog } from './declare-not-normalized-dialog';
import {
  conduiteApresEchecNormaliser,
  type EtapeNormalisation,
  etapesNormalisation,
  formatInstant,
  LIBELLES_ETAT_ETAPE,
  messageFacture,
  phaseNormalisation,
  presentationNormalisation,
  prochaineRelecture,
  type PresentationNormalisation,
} from './invoice-model';

const SYMBOLES: Record<EtapeNormalisation['etat'], string> = {
  en_cours: '…',
  fait: '✓',
  echec: '✗',
  incertain: '?',
  non_fait: '–',
  a_venir: '·',
};

/** Les quatre étapes, avec leur état en mots (le symbole n'est qu'un renfort). */
export function Progression({ etapes }: { etapes: EtapeNormalisation[] }): React.ReactElement {
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {etapes.map((e) => (
        <li key={e.cle} className="flex items-baseline gap-2">
          <span aria-hidden="true" className="w-4 shrink-0 text-center font-mono">
            {SYMBOLES[e.etat]}
          </span>
          <span>
            {e.libelle}{' '}
            <span className="text-xs text-[var(--foreground-muted)]">
              — {LIBELLES_ETAT_ETAPE[e.etat]}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const CADRES: Record<PresentationNormalisation['ton'], string> = {
  info: 'border-[var(--border)]',
  succes: 'border-[var(--accent)]/60',
  attention: 'border-[var(--warn)]/60',
  alerte: 'border-[var(--danger)]/50 bg-[var(--danger-bg)]',
};

/**
 * Relit le document tant que `prochaineRelecture` le permet. Le compteur
 * repart quand la phase change. Un échec de lecture n'interrompt rien : la
 * lecture suivante est programmée comme prévu, dans la même borne.
 */
function useRelecture(vue: InvoiceView, onChange: (v: InvoiceView) => void): boolean {
  const phase = phaseNormalisation(vue);
  const debut = useRef<{ phase: string | null; t: number }>({ phase, t: Date.now() });
  if (debut.current.phase !== phase) debut.current = { phase, t: Date.now() };
  const [actif, setActif] = useState(false);
  // Le rappel du parent change à chaque rendu : on garde le dernier, sans
  // relancer la minuterie pour autant.
  const rappel = useRef(onChange);
  rappel.current = onChange;

  useEffect(() => {
    const delai = prochaineRelecture(vue, debut.current.t, Date.now());
    setActif(delai !== null);
    if (delai === null) return undefined;
    let annule = false;
    const minuterie = setTimeout(() => {
      api
        .getInvoice(vue.id)
        .then((v) => {
          if (!annule) rappel.current(v);
        })
        .catch(() => {
          // Lecture manquée : une copie de la vue relance l'effet, qui
          // reprogramme la lecture suivante dans la même borne de temps.
          if (!annule) rappel.current({ ...vue });
        });
    }, delai);
    return () => {
      annule = true;
      clearTimeout(minuterie);
    };
  }, [vue]);

  return actif;
}

export function NormalizationStatus({
  vue,
  onChange,
}: {
  vue: InvoiceView;
  onChange: (v: InvoiceView) => void;
}): React.ReactElement | null {
  const relecture = useRelecture(vue, onChange);
  const [occupe, setOccupe] = useState<'relancer' | 'verifier' | 'actualiser' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [declarer, setDeclarer] = useState(false);
  const p = presentationNormalisation(vue);
  if (p === null) return null;

  async function agir(
    quoi: 'relancer' | 'verifier' | 'actualiser',
    appel: () => Promise<InvoiceView>,
  ): Promise<void> {
    setOccupe(quoi);
    setErreur(null);
    try {
      onChange(await appel());
    } catch (err) {
      if (quoi !== 'actualiser' && conduiteApresEchecNormaliser(err) === 'relire') {
        // La requête a pu aboutir côté serveur : on RELIT, on ne renvoie pas.
        try {
          onChange(await api.getInvoice(vue.id));
          setErreur(
            'La réponse s’est perdue en chemin : voici l’état du document relu à l’instant.',
          );
        } catch (err2) {
          setErreur(messageFacture(err2, 'Impossible de relire le document.'));
        }
      } else {
        setErreur(messageFacture(err, 'Action impossible.'));
      }
    } finally {
      setOccupe(null);
    }
  }

  const titreId = `normalisation-${vue.id}`;
  const enCours = occupe === 'relancer' || occupe === 'verifier';

  return (
    <section
      aria-labelledby={titreId}
      className={`flex flex-col gap-3 rounded-lg border p-4 ${CADRES[p.ton]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={titreId} className="text-base font-semibold">
          {enCours ? 'Transmission à la DGI…' : p.titre}
        </h3>
        {vue.environment === 'test' ? <Pastille ton="attention">Mode test</Pastille> : null}
      </div>

      <div aria-live="polite" className="flex flex-col gap-2 text-sm">
        {enCours ? (
          <>
            <p>
              {occupe === 'relancer'
                ? 'Lalanda renvoie le contenu figé à la DGI. Ne fermez pas cette page.'
                : 'Lalanda vérifie auprès de la DGI. Ne fermez pas cette page.'}
            </p>
            <Progression etapes={etapesNormalisation(null, true)} />
          </>
        ) : (
          <p>{p.resume}</p>
        )}
      </div>

      {!enCours && p.phase !== 'done' && p.phase !== 'queued' ? (
        <Progression etapes={etapesNormalisation(vue, false)} />
      ) : null}

      {p.elements ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {p.elements.map((e) => (
            <div key={e.libelle}>
              <dt className="text-xs text-[var(--foreground-muted)]">{e.libelle}</dt>
              <dd className="break-all font-mono">{e.valeur}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {p.consignes.length > 0 && !enCours ? (
        p.phase === 'needs_review' ? (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            {p.consignes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {p.consignes.map((c) => (
              <li key={c} className={c.startsWith('Ne refaites pas') ? 'font-semibold' : ''}>
                {c}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {p.revue ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          En vérification depuis le {formatInstant(p.revue.depuis)} — {p.revue.motif}
        </p>
      ) : null}

      {p.erreur && !enCours ? (
        <div className="flex flex-col gap-1 rounded-md border border-[var(--border)] p-3 text-sm">
          <p className="font-medium">{p.erreur.message}</p>
          {p.erreur.conduite ? <p>{p.erreur.conduite}</p> : null}
          {p.erreur.dgi ? (
            <p className="text-xs">
              Réponse de la DGI : code <span className="font-mono">{p.erreur.dgi.code ?? '—'}</span>
              {p.erreur.dgi.libelle ? (
                <>
                  {' — '}
                  <span className="font-mono">{p.erreur.dgi.libelle}</span>
                </>
              ) : null}
            </p>
          ) : null}
          <p className="text-xs text-[var(--foreground-muted)]">
            Référence Lalanda : <span className="font-mono">{p.erreur.codeLalanda}</span>
          </p>
          {p.erreur.lienFiscalite ? (
            <Link href="/organisation/fiscalite" className="text-xs underline">
              Ouvrir Organisation › Fiscalité
            </Link>
          ) : null}
        </div>
      ) : null}

      {p.ecarts && !enCours ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] text-sm">
            <caption className="mb-1 text-left text-xs text-[var(--foreground-muted)]">
              Montants calculés par Lalanda et par la DGI (CDF), tels que conservés
            </caption>
            <thead className="text-xs text-[var(--foreground-muted)]">
              <tr>
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Montant
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Lalanda
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  DGI
                </th>
              </tr>
            </thead>
            <tbody>
              {p.ecarts.map((e) => (
                <tr key={e.champ} className="border-t border-[var(--border)]">
                  <th scope="row" className="py-1 pr-2 text-left font-normal">
                    {e.libelle} <span className="font-mono text-xs">({e.champ})</span>
                  </th>
                  <td className="py-1 pr-2 text-right font-mono">{e.lalanda}</td>
                  <td className="py-1 text-right font-mono">{e.dgi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {p.demandeDgi && p.phase !== 'done' ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Identifiant de la demande à la DGI :{' '}
          <span className="break-all font-mono">{p.demandeDgi}</span>
        </p>
      ) : null}
      {vue.normalization?.normalizedAt && p.phase === 'done' ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Enregistrée le {formatDate(vue.normalization.normalizedAt)}.
        </p>
      ) : null}

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {p.boutons.includes('relancer') ? (
          <button
            type="button"
            className={`${BOUTON} border-[var(--accent)] font-semibold`}
            disabled={occupe !== null}
            onClick={() => void agir('relancer', () => api.retryNormalization(vue.id))}
          >
            {occupe === 'relancer' ? 'Relance…' : 'Relancer'}
          </button>
        ) : null}
        {p.boutons.includes('verifier') ? (
          <button
            type="button"
            className={BOUTON}
            disabled={occupe !== null}
            onClick={() => void agir('verifier', () => api.checkNormalization(vue.id))}
          >
            {occupe === 'verifier' ? 'Vérification…' : 'Vérifier maintenant'}
          </button>
        ) : null}
        {p.boutons.includes('declarer') ? (
          <button
            type="button"
            className={BOUTON}
            disabled={occupe !== null}
            onClick={() => setDeclarer(true)}
          >
            Déclarer non normalisée
          </button>
        ) : null}
        {p.phase !== 'done' && p.phase !== 'failed' && !relecture ? (
          <button
            type="button"
            className={BOUTON}
            disabled={occupe !== null}
            onClick={() => void agir('actualiser', () => api.getInvoice(vue.id))}
          >
            {occupe === 'actualiser' ? 'Lecture…' : 'Actualiser'}
          </button>
        ) : null}
      </div>
      {relecture ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Cette page se met à jour toute seule pendant quelques minutes.
        </p>
      ) : null}

      {declarer ? (
        <DeclareNotNormalizedDialog
          vue={vue}
          onFermer={() => setDeclarer(false)}
          onDeclare={(v) => {
            setDeclarer(false);
            onChange(v);
          }}
        />
      ) : null}
    </section>
  );
}
