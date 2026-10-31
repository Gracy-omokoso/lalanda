'use client';

// Vue d'ensemble des stocks — ADR-0046 § 5.1. Chaque tuile lit sa propre route :
// une route pas encore livrée (404) affiche une phrase, jamais un chiffre
// inventé. Quantités et valeurs : celles de l'API (moteur).

import { Badge, buttonClasses } from '@lalanda/ui';
import { AlertTriangle, Boxes } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { stockApi, type StockLevelRowView } from '@/lib/api-stock';

import { useAccesStocks } from './stocks-access';
import {
  STOCKS_BASE,
  formatQuantite,
  lienArticle,
  lire,
  peutGererStocks,
  peutMouvementer,
  peutVoirValeurs,
  type Lecture,
} from './stocks-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection, Tuile } from './stocks-ui';
import { tuilesVue, type TuileVue } from './vue-ensemble-model';

function Contenu({ t }: { t: TuileVue }): React.ReactElement {
  const c = t.contenu;
  const valeur =
    c.etat === 'connu' ? (
      <span className="flex flex-col">
        {c.lignes.map((l) => (
          <span key={l} className="whitespace-nowrap">
            {l}
          </span>
        ))}
      </span>
    ) : (
      <span className="text-sm font-normal text-[var(--foreground-muted)]">{c.phrase}</span>
    );
  const tuile = (
    <Tuile
      libelle={t.libelle}
      valeur={valeur}
      detail={c.etat === 'connu' ? (c.detail ?? undefined) : undefined}
      attention={c.etat === 'connu' && c.attention}
    />
  );
  return t.lien ? (
    <Link
      href={t.lien}
      className="block rounded-[var(--radius-md)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]"
    >
      {tuile}
    </Link>
  ) : (
    tuile
  );
}

export function VueEnsemble(): React.ReactElement {
  const { actions, etat } = useAccesStocks();
  const valeurs = peutVoirValeurs(actions);
  const [tuiles, setTuiles] = useState<TuileVue[] | null>(null);
  const [sousSeuil, setSousSeuil] = useState<Lecture<StockLevelRowView[]> | null>(null);

  useEffect(() => {
    if (etat !== 'pret') return;
    let annule = false;
    const seuil = lire(stockApi.listLevels({ below: 'reorder', limit: 100 }));
    void Promise.all([
      lire(stockApi.listLevels({ limit: 100 })),
      seuil,
      lire(stockApi.listPending({ status: 'open', limit: 100 })),
      valeurs ? lire(stockApi.getValuation()) : Promise.resolve(null),
    ]).then(([niveaux, bas, aTraiter, valorisation]) => {
      if (annule) return;
      setTuiles(tuilesVue(actions, { niveaux, sousSeuil: bas, aTraiter, valorisation }));
      setSousSeuil(bas.ok ? { ok: true, valeur: bas.valeur.items } : bas);
    });
    return () => {
      annule = true;
    };
  }, [etat, actions, valeurs]);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Boxes}
        titre="Vue d’ensemble"
        sousTitre="Ce qui manque, ce qui passe sous le seuil et ce qui attend une décision."
        actions={
          <>
            {peutMouvementer(actions) ? (
              <Link
                href={`${STOCKS_BASE}/bons?nouveau=issue`}
                className={buttonClasses('primary', 'sm')}
              >
                Sortir du stock
              </Link>
            ) : null}
            {peutGererStocks(actions) ? (
              <Link
                href={`${STOCKS_BASE}/articles?nouveau=1`}
                className={buttonClasses('secondary', 'sm')}
              >
                Nouvel article
              </Link>
            ) : null}
          </>
        }
      >
        {tuiles === null ? (
          <Chargement />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tuiles.map((t) => (
              <Contenu key={t.id} t={t} />
            ))}
          </div>
        )}
      </Bandeau>

      <Panneau
        titre="Sous le seuil"
        icone={AlertTriangle}
        id="stocks-sous-seuil"
        action={
          <Link
            href={`${STOCKS_BASE}/reapprovisionnement`}
            className="text-sm underline underline-offset-2"
          >
            Suggestions de réapprovisionnement
          </Link>
        }
      >
        {sousSeuil === null ? (
          <Chargement />
        ) : !sousSeuil.ok ? (
          <EchecLecture erreur={sousSeuil.erreur} repli="Les seuils sont illisibles." />
        ) : sousSeuil.valeur.length === 0 ? (
          <PhraseSection>Aucun article n’est sous son seuil.</PhraseSection>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {sousSeuil.valeur.slice(0, 10).map((r) => (
              <li
                key={`${r.itemId}-${r.locationId}`}
                className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
              >
                <Link
                  href={lienArticle(r.itemId)}
                  className="min-w-0 flex-1 font-medium break-words after:absolute after:inset-0"
                >
                  {r.itemName}
                </Link>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {r.locationName ?? 'Emplacement'}
                </span>
                <span className="text-sm tabular-nums whitespace-nowrap">
                  {formatQuantite(r.quantity, r.unit)}
                </span>
                {r.minQuantity !== null ? (
                  <Badge tone="warning">seuil {formatQuantite(r.minQuantity)}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panneau>
    </section>
  );
}
