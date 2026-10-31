'use client';

// Création ou modification d'un article stocké (ADR-0046 § 2.1), dans le `Modal`
// de `@lalanda/ui` (`stock.manage`). Aucune quantité ni valeur n'est saisie ici :
// le stock initial passe par un premier inventaire (§ 2.7).

import { buttonClasses } from '@lalanda/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { api, type CatalogItemView } from '@/lib/api';
import { stockApi, type StockItemView } from '@/lib/api-stock';

import { ChoixFournisseur } from '../../achats/_components/commande-formulaire';
import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import { formulaireArticle, preparerArticle, type FormulaireArticle } from './articles-model';
import { useAccesStocks } from './stocks-access';
import { LIBELLES_NATURE_ARTICLE, messageStocks } from './stocks-model';
import { ChampNombre, ChoixEmplacement } from './stocks-ui';

function ChoixCatalogue({
  id,
  valeur,
  onChange,
}: {
  id: string;
  valeur: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  const [liste, setListe] = useState<CatalogItemView[] | null>(null);
  useEffect(() => {
    let annule = false;
    api
      .listCatalogItems({ itemType: 'BIE', limit: 100 })
      .then((p) => {
        if (!annule) setListe(p.items);
      })
      .catch(() => {
        if (!annule) setListe([]);
      });
    return () => {
      annule = true;
    };
  }, []);
  return (
    <select id={id} className={CHAMP} value={valeur} onChange={(e) => onChange(e.target.value)}>
      <option value="">Aucun lien (article non vendu)</option>
      {valeur !== '' && !(liste ?? []).some((c) => c.id === valeur) ? (
        <option value={valeur}>Article du catalogue lié</option>
      ) : null}
      {(liste ?? []).map((c) => (
        <option key={c.id} value={c.id}>
          {c.code ? `${c.code} — ` : ''}
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function ArticleFormulaire({
  article,
  onEnregistre,
  onSale,
}: {
  /** `null` : création. */
  article: StockItemView | null;
  onEnregistre: (a: StockItemView) => void;
  onSale?: (sale: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const { actions } = useAccesStocks();
  const lireVentes = actions?.includes('sales.read') ?? false;
  const lireAchats = actions?.includes('purchase.read') ?? false;
  const [f, setF] = useState<FormulaireArticle>(() => formulaireArticle(article));
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const maj = (patch: Partial<FormulaireArticle>): void => {
    setF((p) => ({ ...p, ...patch }));
    onSale?.(true);
  };

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerArticle(f);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      const a =
        article === null
          ? await stockApi.createItem(p.corps)
          : await stockApi.updateItem(article.id, {
              ...p.corps,
              expectedRevision: article.revision,
            });
      onEnregistre(a);
    } catch (err) {
      setErreur(messageStocks(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Champ id={`${id}-nom`} label="Nom de l’article" requis erreur={champs['name']}>
            <input
              id={`${id}-nom`}
              className={CHAMP}
              value={f.name}
              maxLength={200}
              placeholder="Ciment gris 50 kg"
              onChange={(e) => maj({ name: e.target.value })}
              {...aria(`${id}-nom`, champs['name'])}
            />
          </Champ>
        </div>
        <Champ id={`${id}-code`} label="Code" aide="Facultatif, unique." erreur={champs['code']}>
          <input
            id={`${id}-code`}
            className={CHAMP}
            value={f.code}
            maxLength={40}
            onChange={(e) => maj({ code: e.target.value })}
            {...aria(`${id}-code`, champs['code'], true)}
          />
        </Champ>
        <Champ id={`${id}-nature`} label="Nature">
          <select
            id={`${id}-nature`}
            className={CHAMP}
            value={f.kind}
            onChange={(e) => maj({ kind: e.target.value as FormulaireArticle['kind'] })}
          >
            {Object.entries(LIBELLES_NATURE_ARTICLE).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Champ>
        <Champ
          id={`${id}-unite`}
          label="Unité de stock"
          requis
          aide="Ne change plus après le premier mouvement."
          erreur={champs['unit']}
        >
          <input
            id={`${id}-unite`}
            className={CHAMP}
            value={f.unit}
            maxLength={20}
            onChange={(e) => maj({ unit: e.target.value })}
            {...aria(`${id}-unite`, champs['unit'], true)}
          />
        </Champ>
        <Champ
          id={`${id}-devise`}
          label="Devise de coût"
          aide="Devise de valorisation ; aucun taux n’est jamais appliqué."
        >
          <select
            id={`${id}-devise`}
            className={CHAMP}
            value={f.costCurrency}
            onChange={(e) => maj({ costCurrency: e.target.value as 'USD' | 'CDF' })}
            aria-describedby={`${id}-devise-aide`}
          >
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
          </select>
        </Champ>
        <Champ id={`${id}-emplacement`} label="Emplacement par défaut">
          <ChoixEmplacement
            id={`${id}-emplacement`}
            valeur={f.defaultLocationId}
            onChange={(v) => maj({ defaultLocationId: v })}
            vide="Celui de l’organisation"
          />
        </Champ>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={f.tracked}
            onChange={(e) => maj({ tracked: e.target.checked })}
          />
          Suivre les quantités de cet article
        </label>
        {lireVentes ? (
          <Champ
            id={`${id}-catalogue`}
            label="Article du catalogue de vente"
            aide="Ses ventes sortiront de ce stock. Seuls les biens peuvent être liés."
          >
            <ChoixCatalogue
              id={`${id}-catalogue`}
              valeur={f.catalogItemId}
              onChange={(v) => maj({ catalogItemId: v })}
            />
          </Champ>
        ) : null}
        {lireAchats ? (
          <Champ id={`${id}-fournisseur`} label="Fournisseur habituel">
            <ChoixFournisseur
              id={`${id}-fournisseur`}
              valeur={f.preferredSupplierId}
              onChange={(s) => maj({ preferredSupplierId: s?.id ?? '' })}
            />
          </Champ>
        ) : null}
        <div className="sm:col-span-2">
          <Champ id={`${id}-desc`} label="Description" erreur={champs['description']}>
            <textarea
              id={`${id}-desc`}
              rows={2}
              className={CHAMP}
              value={f.description}
              maxLength={2000}
              onChange={(e) => maj({ description: e.target.value })}
            />
          </Champ>
        </div>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Seuil de réapprovisionnement</legend>
        <Champ
          id={`${id}-min`}
          label="Seuil d’alerte"
          aide="Vide : aucun seuil."
          erreur={champs['minQuantity']}
        >
          <ChampNombre
            id={`${id}-min`}
            value={f.minQuantity}
            onChange={(e) => maj({ minQuantity: e.target.value })}
            {...aria(`${id}-min`, champs['minQuantity'], true)}
          />
        </Champ>
        <Champ id={`${id}-cible`} label="Quantité visée" erreur={champs['targetQuantity']}>
          <ChampNombre
            id={`${id}-cible`}
            value={f.targetQuantity}
            onChange={(e) => maj({ targetQuantity: e.target.value })}
            {...aria(`${id}-cible`, champs['targetQuantity'])}
          />
        </Champ>
        <Champ id={`${id}-seuil-emplacement`} label="Pour">
          <ChoixEmplacement
            id={`${id}-seuil-emplacement`}
            valeur={f.reorderLocationId}
            onChange={(v) => maj({ reorderLocationId: v })}
            vide="Tous les emplacements"
          />
        </Champ>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Autres unités</legend>
        <p className="text-xs text-[var(--foreground-muted)]">
          Pour lire une commande ou une vente exprimée dans une autre unité : 1 carton = 12 pièces.
        </p>
        {champs['conversions'] ? (
          <p className="text-xs text-[var(--danger)]">{champs['conversions']}</p>
        ) : null}
        {f.conversions.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Champ
              id={`${id}-conv-${i}-u`}
              label="1 unité de"
              erreur={champs[`conversion-${i}-unit`]}
            >
              <input
                id={`${id}-conv-${i}-u`}
                className={CHAMP}
                value={c.unit}
                maxLength={20}
                placeholder="carton"
                onChange={(e) =>
                  maj({
                    conversions: f.conversions.map((x, j) =>
                      j === i ? { ...x, unit: e.target.value } : x,
                    ),
                  })
                }
              />
            </Champ>
            <Champ
              id={`${id}-conv-${i}-f`}
              label={`= combien de ${f.unit || 'unités'}`}
              erreur={champs[`conversion-${i}-factor`]}
            >
              <ChampNombre
                id={`${id}-conv-${i}-f`}
                value={c.factor}
                onChange={(e) =>
                  maj({
                    conversions: f.conversions.map((x, j) =>
                      j === i ? { ...x, factor: e.target.value } : x,
                    ),
                  })
                }
              />
            </Champ>
            <button
              type="button"
              className={`${BOUTON_PETIT} self-end`}
              aria-label={`Retirer la conversion ${i + 1}`}
              onClick={() => maj({ conversions: f.conversions.filter((_, j) => j !== i) })}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${BOUTON_PETIT} inline-flex items-center gap-1 self-start`}
          disabled={f.conversions.length >= 5}
          onClick={() => maj({ conversions: [...f.conversions, { unit: '', factor: '' }] })}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Ajouter une unité
        </button>
      </fieldset>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <button
        type="submit"
        disabled={envoi}
        className={buttonClasses('primary', 'md', 'self-start')}
      >
        {envoi ? 'Enregistrement…' : article === null ? 'Créer l’article' : 'Enregistrer'}
      </button>
    </form>
  );
}
