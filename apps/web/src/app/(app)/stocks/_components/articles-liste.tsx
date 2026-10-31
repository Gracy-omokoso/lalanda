'use client';

// Articles stockés — ADR-0046 § 2.1 et § 5.1 : liste filtrable et recherche,
// création en fenêtre modale (`stock.manage`, `?nouveau=1`). Quantités et valeurs
// rendues par l'API ; les valeurs n'apparaissent qu'aux rôles qui les voient.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { Package, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { stockApi, type StockItemView } from '@/lib/api-stock';

import { BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import { ArticleFormulaire } from './article-formulaire';
import { FILTRES_ARTICLES, requeteArticles, type FiltreArticles } from './articles-model';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_NATURE_ARTICLE,
  estEnRupture,
  formatQuantite,
  formatValeur,
  lienArticle,
  peutGererStocks,
  valeursAffichees,
} from './stocks-model';
import { Bandeau, CARTE, CarteVide, Chargement, EchecLecture } from './stocks-ui';

export function ArticlesListe(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions } = useAccesStocks();
  const gerer = peutGererStocks(actions);
  const creation = params.get('nouveau') === '1';
  const [filtre, setFiltre] = useState<FiltreArticles>('actifs');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<StockItemView[] | null>(null);
  const [masquees, setMasquees] = useState(true);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [sale, setSale] = useState(false);

  const charger = useCallback((f: FiltreArticles, texte: string, cursor: string | null) => {
    stockApi
      .listItems(requeteArticles(f, texte, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setMasquees(p.valuesHidden === true);
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(err);
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => charger(filtre, q, null), 200);
    return () => clearTimeout(t);
  }, [filtre, q, charger]);

  const ouvrir = (oui: boolean): void => {
    setSale(false);
    router.replace(oui ? `${pathname}?nouveau=1` : pathname);
  };
  const valeurs = valeursAffichees(actions, masquees);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Package}
        titre="Articles"
        sousTitre="Ce que vous stockez : marchandises, consommables, matières et pièces."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => ouvrir(true)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouvel article
            </button>
          ) : null
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            aria-label="Rechercher un article"
            placeholder="Rechercher par nom ou code…"
            className={`${CHAMP} sm:max-w-xs`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les articles">
            {FILTRES_ARTICLES.map((f) => (
              <button
                key={f.valeur}
                type="button"
                className={BOUTON_PETIT}
                aria-pressed={filtre === f.valeur}
                onClick={() => setFiltre(f.valeur)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </Bandeau>

      <Modal
        open={gerer && creation}
        onClose={() => ouvrir(false)}
        dirty={sale}
        title="Nouvel article"
        description="Le stock initial se saisit ensuite par un premier inventaire."
        size="lg"
      >
        <ArticleFormulaire
          article={null}
          onSale={setSale}
          onEnregistre={(a) => router.push(lienArticle(a.id))}
        />
      </Modal>

      {erreur ? <EchecLecture erreur={erreur} repli="Impossible de charger les articles." /> : null}

      {items === null ? (
        <Chargement texte="Chargement des articles…" />
      ) : items.length === 0 ? (
        erreur ? null : (
          <CarteVide>Aucun article ne correspond.</CarteVide>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => (
            <li key={a.id}>
              <Link href={lienArticle(a.id)} className={CARTE}>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold break-words">{a.name}</span>
                  {!a.active ? (
                    <Badge tone="neutral">Archivé</Badge>
                  ) : a.tracked && estEnRupture(a.quantity) ? (
                    <Badge tone="danger">Rupture</Badge>
                  ) : (a.findings ?? []).some((c) => c.code === 'BELOW_REORDER') ? (
                    <Badge tone="warning">Sous le seuil</Badge>
                  ) : null}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {a.code ? `${a.code} · ` : ''}
                  {LIBELLES_NATURE_ARTICLE[a.kind]}
                  {a.tracked ? '' : ' · quantités non suivies'}
                </span>
                <span className="flex items-end justify-between gap-2">
                  <strong className="font-display text-lg tabular-nums">
                    {a.tracked ? formatQuantite(a.quantity, a.unit) : '—'}
                  </strong>
                  {valeurs && a.value !== null ? (
                    <span className="text-xs tabular-nums text-[var(--foreground-muted)]">
                      {formatValeur(a.value, a.costCurrency)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(filtre, q, suivante)}
        >
          Afficher plus d’articles
        </button>
      ) : null}
    </section>
  );
}
