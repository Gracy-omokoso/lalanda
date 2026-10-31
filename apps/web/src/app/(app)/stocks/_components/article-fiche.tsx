'use client';

// Fiche d'un article stocké — ADR-0046 § 2.1, § 5.1 : quantités par emplacement,
// coût moyen et valeur (seulement si les valeurs sont visibles), seuil, constats
// du moteur, derniers mouvements. Modification en fenêtre modale (`stock.manage`).
// Article introuvable ou d'une autre organisation : l'API répond 404, l'écran le dit.

import { Badge, Modal } from '@lalanda/ui';
import { ArrowLeft, History, MapPin, Package, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { stockApi, type StockItemView, type StockMovementView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { ArticleFormulaire } from './article-formulaire';
import { gestesArticle, phraseSeuil } from './articles-model';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_MOUVEMENT,
  LIBELLES_NATURE_ARTICLE,
  STOCKS_BASE,
  constatsVisibles,
  estEnRupture,
  formatCoutUnitaire,
  formatJour,
  formatQuantite,
  formatQuantiteSignee,
  formatValeur,
  libelleConstat,
  lienMouvementsArticle,
  lire,
  messageStocks,
  statutDe,
  valeursAffichees,
  type Lecture,
} from './stocks-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection, Tuile } from './stocks-ui';

export function ArticleFiche({ itemId }: { itemId: string }): React.ReactElement {
  const { actions, emplacements } = useAccesStocks();
  const [lecture, setLecture] = useState<Lecture<StockItemView> | null>(null);
  const [mouvements, setMouvements] = useState<Lecture<StockMovementView[]> | null>(null);
  const [version, setVersion] = useState(0);
  const [edition, setEdition] = useState(false);
  const [sale, setSale] = useState(false);
  const [erreurGeste, setErreurGeste] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let annule = false;
    void lire(stockApi.getItem(itemId)).then((l) => {
      if (!annule) setLecture(l);
    });
    void lire(stockApi.listItemMovements(itemId, { limit: 10 }).then((p) => p.items)).then((l) => {
      if (!annule) setMouvements(l);
    });
    return () => {
      annule = true;
    };
  }, [itemId, version]);

  const nomEmplacement = useCallback(
    (id: string): string | null =>
      emplacements?.ok ? (emplacements.valeur.find((l) => l.id === id)?.name ?? null) : null,
    [emplacements],
  );

  const retour = (
    <Link
      href={`${STOCKS_BASE}/articles`}
      className="inline-flex items-center gap-1 self-start text-sm underline underline-offset-2"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Tous les articles
    </Link>
  );

  if (lecture === null) return <Chargement texte="Chargement de l’article…" />;
  if (!lecture.ok) {
    return (
      <section className="flex flex-col gap-4">
        {retour}
        {statutDe(lecture.erreur) === 404 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center sm:p-8">
            <p className="text-sm font-medium">Article introuvable</p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
              Cet article n’existe pas, appartient à une autre organisation, ou les stocks ne sont
              pas encore disponibles sur ce serveur.
            </p>
          </div>
        ) : (
          <EchecLecture
            erreur={lecture.erreur}
            repli="L’article est illisible."
            onReessayer={() => setVersion((v) => v + 1)}
          />
        )}
      </section>
    );
  }

  const a = lecture.valeur;
  const valeurs = valeursAffichees(actions, a.valuesHidden);
  const constats = constatsVisibles(a.findings, valeurs);
  const gestes = gestesArticle(a, actions);

  async function geste(id: 'archiver' | 'restaurer'): Promise<void> {
    setErreurGeste(null);
    setOccupe(true);
    try {
      const suite =
        id === 'archiver'
          ? await stockApi.archiveItem(a.id, a.revision)
          : await stockApi.restoreItem(a.id, a.revision);
      setLecture({ ok: true, valeur: suite });
    } catch (err) {
      setErreurGeste(messageStocks(err, 'Action impossible.'));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {retour}
      <Bandeau
        icone={Package}
        titre={a.name}
        sousTitre={[a.code, LIBELLES_NATURE_ARTICLE[a.kind], `unité : ${a.unit}`]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {!a.active ? <Badge tone="neutral">Archivé</Badge> : null}
            {gestes.map((g) => (
              <button
                key={g.id}
                type="button"
                className={BOUTON_PETIT}
                disabled={!g.actif || occupe}
                title={g.raison ?? undefined}
                aria-describedby={g.raison ? `geste-${g.id}-raison` : undefined}
                onClick={() => {
                  if (g.id === 'modifier') {
                    setSale(false);
                    setEdition(true);
                  } else void geste(g.id);
                }}
              >
                {g.libelle}
              </button>
            ))}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tuile
            libelle="Quantité en stock"
            valeur={a.tracked ? formatQuantite(a.quantity, a.unit) : 'Non suivie'}
            attention={a.tracked && estEnRupture(a.quantity)}
          />
          <Tuile
            libelle="Seuil"
            valeur={
              <span className="text-sm">{phraseSeuil(a, nomEmplacement, formatQuantite)}</span>
            }
          />
          {valeurs ? (
            <>
              <Tuile
                libelle="Coût moyen pondéré"
                valeur={formatCoutUnitaire(a.averageUnitCost, a.costCurrency)}
                detail="Mesure de gestion"
              />
              <Tuile
                libelle="Valeur du stock"
                valeur={formatValeur(a.value, a.costCurrency)}
                detail={
                  a.valuationComplete === false ? 'Incomplète : entrées sans coût' : undefined
                }
              />
            </>
          ) : null}
        </div>
        {gestes
          .filter((g) => g.raison)
          .map((g) => (
            <p
              key={g.id}
              id={`geste-${g.id}-raison`}
              className="text-xs text-[var(--foreground-muted)]"
            >
              {g.libelle} : {g.raison}
            </p>
          ))}
      </Bandeau>

      {erreurGeste ? (
        <Alerte>
          <p>{erreurGeste}</p>
        </Alerte>
      ) : null}

      <Modal
        open={edition}
        onClose={() => setEdition(false)}
        dirty={sale}
        title="Modifier l’article"
        size="lg"
      >
        <ArticleFormulaire
          article={a}
          onSale={setSale}
          onEnregistre={(suite) => {
            setEdition(false);
            setLecture({ ok: true, valeur: suite });
          }}
        />
      </Modal>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panneau titre="Par emplacement" icone={MapPin} id="article-emplacements">
          {(a.levels ?? []).length === 0 ? (
            <PhraseSection>Aucune quantité enregistrée à un emplacement.</PhraseSection>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {(a.levels ?? []).map((l) => (
                <li key={l.locationId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 break-words">
                    {l.locationName ?? nomEmplacement(l.locationId) ?? 'Emplacement'}
                  </span>
                  <span
                    className={`tabular-nums whitespace-nowrap ${estEnRupture(l.quantity) ? 'text-[var(--danger)]' : ''}`}
                  >
                    {formatQuantite(l.quantity, a.unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panneau>

        <Panneau titre="Constats" icone={TriangleAlert} id="article-constats">
          {constats.length === 0 ? (
            <PhraseSection>Rien à signaler sur cet article.</PhraseSection>
          ) : (
            <ul className="flex flex-col gap-2">
              {constats.map((c, i) => (
                <li key={`${c.code}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={c.code === 'NEGATIVE_STOCK' ? 'danger' : 'warning'}>
                    {libelleConstat(c.code)}
                  </Badge>
                  {c.locationId ? (
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {nomEmplacement(c.locationId) ?? ''}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panneau>
      </div>

      <Panneau
        titre="Derniers mouvements"
        icone={History}
        id="article-mouvements"
        action={
          <Link href={lienMouvementsArticle(a.id)} className="text-sm underline underline-offset-2">
            Grand livre de l’article
          </Link>
        }
      >
        {mouvements === null ? (
          <Chargement />
        ) : !mouvements.ok ? (
          <EchecLecture erreur={mouvements.erreur} repli="Les mouvements sont illisibles." />
        ) : mouvements.valeur.length === 0 ? (
          <PhraseSection>Aucun mouvement pour cet article.</PhraseSection>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {mouvements.valeur.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-24 shrink-0 text-xs text-[var(--foreground-muted)]">
                  {formatJour(m.occurredOn)}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  {LIBELLES_MOUVEMENT[m.kind]}
                  {m.sourceLabel ? ` · ${m.sourceLabel}` : ''}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {m.locationName ?? nomEmplacement(m.locationId) ?? ''}
                </span>
                <span className="tabular-nums whitespace-nowrap font-medium">
                  {formatQuantiteSignee(m.quantity, a.unit)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panneau>
    </section>
  );
}
