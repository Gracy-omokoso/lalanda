'use client';

// Liste du catalogue (ADR-0022 § S25c.5) : recherche, filtres par groupe, type
// et état, pagination par curseur, désactivation, réactivation, suppression.
//
// La liste des groupes de taxation est lue une fois ici et partagée avec la
// fiche : les filtres et le formulaire proposent la même liste, celle du
// serveur.
//
// Les prix sont affichés tels que l'API les sert, dans leur devise, mis en forme
// à la française (`1 234,50 CDF TTC`, `40,00 USD HT`) ; aucun n'est converti ni
// recalculé (ADR-0023 E4).

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type CatalogItemType,
  type CatalogItemView,
  type SalesStatusFilter,
  type TaxGroupLetter,
  type TaxGroupList,
} from '@/lib/api';

import { BandeauGroupes, CatalogItemForm } from './catalog-item-form';
import { Alerte, BOUTON, BOUTON_DANGER, BOUTON_PETIT, CHAMP, Pastille } from './form-ui';
import { useAccesVentes } from './sales-access';
import {
  actionsLigne,
  FICHE_NOUVELLE,
  ficheDepuisParametre,
  type FiltresArticles,
  formatDate,
  groupeDe,
  ITEM_TYPE_LABELS,
  libellePrix,
  libelleTaxeSpecifique,
  messageVentes,
  remplacerDansListe,
  requeteArticles,
  STATUS_LABELS,
} from './sales-model';
import { useSalesList } from './use-sales-list';

export function CatalogList(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { gerer } = useAccesVentes();
  const fiche = ficheDepuisParametre(params.get('fiche'));

  const [filtres, setFiltres] = useState<FiltresArticles>({
    q: '',
    taxGroup: '',
    itemType: '',
    status: 'active',
  });
  const [groupes, setGroupes] = useState<TaxGroupList | null>(null);
  const [erreurGroupes, setErreurGroupes] = useState<string | null>(null);
  const [versionGroupes, setVersionGroupes] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setErreurGroupes(null);
    api
      .getTaxGroups()
      .then((g) => {
        if (!annule) setGroupes(g);
      })
      .catch((err: unknown) => {
        if (!annule) setErreurGroupes(messageVentes(err, 'liste indisponible.'));
      });
    return () => {
      annule = true;
    };
  }, [versionGroupes]);

  const charger = useCallback(
    (cursor: string | null) => api.listCatalogItems(requeteArticles(filtres, cursor)),
    [filtres],
  );
  const liste = useSalesList<CatalogItemView>(charger, JSON.stringify(filtres));

  const ouvrir = (valeur: string): void => {
    setNotice(null);
    setErreurAction(null);
    router.push(`${pathname}?fiche=${encodeURIComponent(valeur)}`);
  };

  const fermer = (enregistre?: CatalogItemView): void => {
    router.push(pathname);
    if (enregistre) {
      setNotice(`Article « ${enregistre.name} » enregistré.`);
      liste.recharger();
    }
  };

  async function agir(
    item: CatalogItemView,
    action: 'desactiver' | 'reactiver' | 'supprimer',
  ): Promise<void> {
    setOccupe(item.id);
    setErreurAction(null);
    setNotice(null);
    try {
      if (action === 'supprimer') {
        await api.deleteCatalogItem(item.id);
        liste.setItems((items) => items.filter((i) => i.id !== item.id));
        setNotice(`Article « ${item.name} » supprimé.`);
      } else {
        const maj =
          action === 'desactiver'
            ? await api.deactivateCatalogItem(item.id)
            : await api.reactivateCatalogItem(item.id);
        liste.setItems((items) => remplacerDansListe(items, maj, filtres.status));
        setNotice(
          action === 'desactiver'
            ? `Article « ${item.name} » désactivé : il ne sera plus proposé sur une facture.`
            : `Article « ${item.name} » réactivé.`,
        );
      }
      setASupprimer(null);
    } catch (err) {
      setErreurAction(messageVentes(err, 'Action impossible.'));
      liste.recharger();
    } finally {
      setOccupe(null);
    }
  }

  if (fiche) {
    return (
      <CatalogItemForm
        key={fiche.mode === 'edition' ? fiche.id : FICHE_NOUVELLE}
        fiche={fiche}
        gerer={gerer}
        base={pathname}
        groupes={groupes}
        erreurGroupes={erreurGroupes}
        onRechargerGroupes={() => setVersionGroupes((v) => v + 1)}
        onFermer={fermer}
      />
    );
  }

  const filtre =
    filtres.q.trim() !== '' ||
    filtres.taxGroup !== '' ||
    filtres.itemType !== '' ||
    filtres.status !== 'active';

  return (
    <section aria-labelledby="catalogue-titre" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="catalogue-titre" className="font-display text-lg font-bold tracking-tight">
            Catalogue
          </h2>
          <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
            Les biens, services et taxes que vous facturez, chacun avec son groupe de taxation DGI
            et son prix TTC ou HT.
          </p>
        </div>
        {gerer ? (
          <button type="button" onClick={() => ouvrir(FICHE_NOUVELLE)} className={BOUTON}>
            Nouvel article
          </button>
        ) : null}
      </div>

      {groupes ? <BandeauGroupes liste={groupes} /> : null}

      <form
        role="search"
        aria-label="Rechercher un article"
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ar-q" className="text-sm font-medium">
            Rechercher
          </label>
          <input
            id="ar-q"
            type="search"
            value={filtres.q}
            onChange={(e) => setFiltres((f) => ({ ...f, q: e.target.value }))}
            maxLength={100}
            placeholder="Désignation ou référence"
            className={CHAMP}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ar-filtre-groupe" className="text-sm font-medium">
            Groupe
          </label>
          <select
            id="ar-filtre-groupe"
            value={filtres.taxGroup}
            onChange={(e) =>
              setFiltres((f) => ({ ...f, taxGroup: e.target.value as TaxGroupLetter | '' }))
            }
            className={CHAMP}
          >
            <option value="">Tous les groupes</option>
            {groupes?.groups.map((g) => (
              <option key={g.letter} value={g.letter}>
                {g.letter} — {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ar-filtre-type" className="text-sm font-medium">
            Type
          </label>
          <select
            id="ar-filtre-type"
            value={filtres.itemType}
            onChange={(e) =>
              setFiltres((f) => ({ ...f, itemType: e.target.value as CatalogItemType | '' }))
            }
            className={CHAMP}
          >
            <option value="">Tous les types</option>
            {(Object.keys(ITEM_TYPE_LABELS) as CatalogItemType[]).map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ar-filtre-statut" className="text-sm font-medium">
            État
          </label>
          <select
            id="ar-filtre-statut"
            value={filtres.status}
            onChange={(e) =>
              setFiltres((f) => ({ ...f, status: e.target.value as SalesStatusFilter }))
            }
            className={CHAMP}
          >
            {(Object.keys(STATUS_LABELS) as SalesStatusFilter[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </form>

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-[var(--foreground-muted)]">
        {notice ?? ''}
      </p>
      {erreurAction ? (
        <Alerte>
          <p>{erreurAction}</p>
        </Alerte>
      ) : null}

      {liste.etat === 'chargement' ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement du catalogue…
        </p>
      ) : liste.etat === 'refus' ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
          <p className="text-sm font-medium">Catalogue non accessible</p>
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">{liste.erreur}</p>
        </div>
      ) : liste.etat === 'erreur' ? (
        <Alerte
          action={
            <button
              type="button"
              onClick={liste.recharger}
              className={`${BOUTON} text-[var(--foreground)]`}
            >
              Réessayer
            </button>
          }
        >
          <p>{liste.erreur}</p>
        </Alerte>
      ) : liste.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
          {filtre ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Aucun article ne correspond à cette recherche.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">Votre catalogue est vide</p>
              <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                {gerer
                  ? 'Ajoutez vos premiers articles : ils seront proposés sur vos factures avec leur prix et leur groupe de taxation.'
                  : 'Les articles de l’organisation apparaîtront ici.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {liste.items.map((a) => {
              const actions = actionsLigne(a, gerer);
              const g = groupeDe(groupes, a.taxGroup);
              const ts = libelleTaxeSpecifique(a);
              return (
                <li key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-medium">{a.name}</span>
                      {!a.active ? (
                        <Pastille ton="attention">
                          Désactivé le {formatDate(a.deactivatedAt)}
                        </Pastille>
                      ) : null}
                      {a.invoiced ? <Pastille ton="neutre">Déjà facturé</Pastille> : null}
                      {!a.taxGroupAvailable ? (
                        <Pastille ton="attention">Groupe {a.taxGroup} plus proposé</Pastille>
                      ) : null}
                      {a.outOfScope ? <Pastille ton="neutre">Hors champ</Pastille> : null}
                    </div>
                    <p className="fig text-sm">
                      {libellePrix(a)}
                      <span className="text-[var(--foreground-muted)]"> par {a.unit}</span>
                    </p>
                    <p className="text-xs text-[var(--foreground-muted)]">
                      {ITEM_TYPE_LABELS[a.itemType]} · Groupe {a.taxGroup}
                      {g ? ` — ${g.label}` : ''}
                      {a.code ? (
                        <>
                          {' · Réf. '}
                          <span className="font-mono">{a.code}</span>
                        </>
                      ) : null}
                      {a.edefCode && a.edefCode !== a.code ? (
                        <>
                          {' · Code DGI '}
                          <span className="font-mono">{a.edefCode}</span>
                        </>
                      ) : null}
                    </p>
                    {ts ? <p className="fig text-xs text-[var(--foreground-muted)]">{ts}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {aSupprimer === a.id ? (
                      <div
                        role="group"
                        aria-label={`Confirmer la suppression de ${a.name}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="text-xs">Supprimer définitivement ?</span>
                        <button
                          type="button"
                          disabled={occupe === a.id}
                          onClick={() => void agir(a, 'supprimer')}
                          className={BOUTON_DANGER}
                        >
                          Supprimer
                        </button>
                        <button
                          type="button"
                          onClick={() => setASupprimer(null)}
                          className={BOUTON_PETIT}
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      actions.map((act) => (
                        <button
                          key={act}
                          type="button"
                          disabled={occupe === a.id}
                          onClick={() => {
                            if (act === 'consulter' || act === 'modifier') ouvrir(a.id);
                            else if (act === 'supprimer') setASupprimer(a.id);
                            else void agir(a, act);
                          }}
                          className={act === 'supprimer' ? BOUTON_DANGER : BOUTON_PETIT}
                          aria-label={`${LIBELLES_ACTIONS[act]} — ${a.name}`}
                        >
                          {LIBELLES_ACTIONS[act]}
                        </button>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {liste.erreurSuite ? (
            <Alerte>
              <p>{liste.erreurSuite}</p>
            </Alerte>
          ) : null}
          {liste.suivante ? (
            <button
              type="button"
              onClick={liste.chargerSuite}
              disabled={liste.chargementSuite}
              className={`${BOUTON} self-center`}
            >
              {liste.chargementSuite ? 'Chargement…' : 'Afficher plus d’articles'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

const LIBELLES_ACTIONS = {
  consulter: 'Consulter',
  modifier: 'Modifier',
  desactiver: 'Désactiver',
  reactiver: 'Réactiver',
  supprimer: 'Supprimer',
} as const;
