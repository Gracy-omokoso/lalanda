'use client';

// Mouvements — grand livre filtrable d'un article (ADR-0046 § 2.3, § 5.1).
// Ajout seul : une annulation apparaît comme un mouvement inverse. Coûts
// d'entrée seulement pour un rôle qui voit les valeurs.

import { Badge } from '@lalanda/ui';
import { History } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { stockApi, type StockItemView, type StockMovementView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT, CHAMP, Champ } from '../../ventes/_components/form-ui';

import {
  FILTRES_VIDES,
  OPTIONS_NATURE,
  coutAffiche,
  origineMouvement,
  requeteMouvements,
  type FiltresMouvements,
} from './mouvements-model';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_MOUVEMENT,
  estNegatif,
  formatCoutUnitaire,
  formatJour,
  formatQuantiteSignee,
  lienArticle,
  nomPersonne,
  valeursAffichees,
} from './stocks-model';
import {
  Bandeau,
  CarteVide,
  Chargement,
  ChoixArticle,
  ChoixEmplacement,
  EchecLecture,
} from './stocks-ui';

export function Mouvements(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions, emplacements, membres, moi } = useAccesStocks();
  const articleId = params.get('article') ?? '';
  const [article, setArticle] = useState<StockItemView | null>(null);
  const [filtres, setFiltres] = useState<FiltresMouvements>(FILTRES_VIDES);
  const [items, setItems] = useState<StockMovementView[] | null>(null);
  const [masquees, setMasquees] = useState(true);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [erreurFiltre, setErreurFiltre] = useState<string | null>(null);

  useEffect(() => {
    if (articleId === '') {
      setArticle(null);
      return;
    }
    let annule = false;
    stockApi
      .getItem(articleId)
      .then((a) => {
        if (!annule) setArticle(a);
      })
      .catch(() => {
        if (!annule) setArticle(null);
      });
    return () => {
      annule = true;
    };
  }, [articleId]);

  const charger = useCallback((itemId: string, f: FiltresMouvements, cursor: string | null) => {
    const r = requeteMouvements(f, cursor);
    if (!r.ok) {
      setErreurFiltre(r.erreur);
      return;
    }
    setErreurFiltre(null);
    stockApi
      .listItemMovements(itemId, r.requete)
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
    if (articleId === '') {
      setItems(null);
      return;
    }
    charger(articleId, filtres, null);
  }, [articleId, filtres, charger]);

  const valeurs = valeursAffichees(actions, masquees);
  const nomEmplacement = (id: string): string =>
    (emplacements?.ok ? emplacements.valeur.find((l) => l.id === id)?.name : null) ?? 'Emplacement';

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={History}
        titre="Mouvements"
        sousTitre="Le grand livre : chaque entrée et chaque sortie, jamais effacée."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2">
            <Champ id="mvt-article" label="Article">
              <ChoixArticle
                id="mvt-article"
                valeur={articleId}
                nomInitial={article?.name ?? null}
                onChange={(a) =>
                  router.replace(a ? `${pathname}?article=${encodeURIComponent(a.id)}` : pathname)
                }
              />
            </Champ>
          </div>
          <Champ id="mvt-emplacement" label="Emplacement">
            <ChoixEmplacement
              id="mvt-emplacement"
              valeur={filtres.locationId}
              vide="Tous"
              onChange={(v) => setFiltres((f) => ({ ...f, locationId: v }))}
            />
          </Champ>
          <Champ id="mvt-nature" label="Nature">
            <select
              id="mvt-nature"
              className={CHAMP}
              value={filtres.kind}
              onChange={(e) =>
                setFiltres((f) => ({ ...f, kind: e.target.value as FiltresMouvements['kind'] }))
              }
            >
              <option value="">Toutes</option>
              {OPTIONS_NATURE.map((o) => (
                <option key={o.valeur} value={o.valeur}>
                  {o.label}
                </option>
              ))}
            </select>
          </Champ>
          <div className="grid grid-cols-2 gap-2">
            <Champ id="mvt-du" label="Du">
              <input
                id="mvt-du"
                type="date"
                className={CHAMP}
                value={filtres.from}
                onChange={(e) => setFiltres((f) => ({ ...f, from: e.target.value }))}
              />
            </Champ>
            <Champ id="mvt-au" label="Au">
              <input
                id="mvt-au"
                type="date"
                className={CHAMP}
                value={filtres.to}
                onChange={(e) => setFiltres((f) => ({ ...f, to: e.target.value }))}
              />
            </Champ>
          </div>
        </div>
      </Bandeau>

      {erreurFiltre ? (
        <Alerte>
          <p>{erreurFiltre}</p>
        </Alerte>
      ) : null}
      {erreur ? <EchecLecture erreur={erreur} repli="Impossible de lire les mouvements." /> : null}

      {articleId === '' ? (
        <CarteVide>Choisissez un article pour lire son grand livre.</CarteVide>
      ) : items === null ? (
        <Chargement texte="Chargement des mouvements…" />
      ) : items.length === 0 ? (
        erreur ? null : (
          <CarteVide>Aucun mouvement ne correspond.</CarteVide>
        )
      ) : (
        <>
          {article ? (
            <Link
              href={lienArticle(article.id)}
              className="self-start text-sm underline underline-offset-2"
            >
              Fiche de l’article {article.name}
            </Link>
          ) : null}
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
            {items.map((m) => {
              const cout = coutAffiche(m, valeurs);
              const origine = origineMouvement(m);
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
                >
                  <span className="w-24 shrink-0 text-xs text-[var(--foreground-muted)]">
                    {formatJour(m.occurredOn)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium break-words">
                      {LIBELLES_MOUVEMENT[m.kind]}
                      {m.reversalOf ? ' (contre-passation)' : ''}
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {[
                        origine,
                        m.locationName ?? nomEmplacement(m.locationId),
                        m.reason,
                        m.createdBy ? `par ${nomPersonne(membres, m.createdBy, moi)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {cout !== null ? (
                    <span className="text-xs tabular-nums text-[var(--foreground-muted)]">
                      {cout === 'coût à saisir'
                        ? cout
                        : `à ${formatCoutUnitaire(cout, article?.costCurrency ?? '')}`}
                    </span>
                  ) : null}
                  <span
                    className={`tabular-nums whitespace-nowrap font-semibold ${estNegatif(m.quantity) ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}`}
                  >
                    {formatQuantiteSignee(m.quantity, article?.unit ?? null)}
                  </span>
                  {m.costStatus === 'pending_cost' && valeurs ? (
                    <Badge tone="warning">Sans coût</Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {suivante && articleId ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(articleId, filtres, suivante)}
        >
          Afficher plus de mouvements
        </button>
      ) : null}
    </section>
  );
}
