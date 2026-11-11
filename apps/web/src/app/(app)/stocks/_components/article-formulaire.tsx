'use client';

// Création ou modification d'un article stocké (ADR-0046 § 2.1), dans le `Modal`
// de `@lalanda/ui` (`stock.manage`). Aucune quantité ni valeur n'est saisie ici :
// le stock initial passe par un premier inventaire (§ 2.7).
//
// ADR-0074 : grille sémantique, nature et devise en segments, article du
// catalogue en `Select` (même lecture), suivi en interrupteur. Sert aussi de
// création rapide depuis le choix d'un article (`nomInitial`).

import {
  Button,
  Field,
  FormGrid,
  FormSection,
  SegmentedControl,
  Select,
  SubmitButton,
  Switch,
  TextArea,
  TextInput,
  type SelectOption,
} from '@lalanda/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { api, type CatalogItemView } from '@/lib/api';
import { stockApi, type StockItemView } from '@/lib/api-stock';

import { ChoixFournisseur } from '../../achats/_components/commande-formulaire';
import { Alerte } from '../../ventes/_components/form-ui';

import { formulaireArticle, preparerArticle, type FormulaireArticle } from './articles-model';
import { useAccesStocks } from './stocks-access';
import { LIBELLES_NATURE_ARTICLE, messageStocks } from './stocks-model';
import { ChampNombre, ChoixEmplacement } from './stocks-ui';

/** Article du catalogue de vente (biens), même lecture qu'avant (100 au plus). */
function ChoixCatalogue({
  valeur,
  onChange,
}: {
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
  const items = liste ?? [];
  const options: SelectOption[] = [
    { value: '', label: 'Aucun lien (article non vendu)' },
    ...(valeur !== '' && !items.some((c) => c.id === valeur)
      ? [{ value: valeur, label: 'Article du catalogue lié' }]
      : []),
    ...items.map((c) => ({
      value: c.id,
      label: c.name,
      ...(c.code ? { description: c.code, keywords: c.code } : {}),
    })),
  ];
  return (
    <Select
      value={valeur}
      onChange={onChange}
      options={options}
      loading={liste === null}
      emptyText="Aucun bien au catalogue."
    />
  );
}

export function ArticleFormulaire({
  article,
  nomInitial,
  onEnregistre,
  onSale,
}: {
  /** `null` : création. */
  article: StockItemView | null;
  /** Nom pré-rempli d'une création rapide (texte tapé dans le choix d'article). */
  nomInitial?: string;
  onEnregistre: (a: StockItemView) => void;
  onSale?: (sale: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const { actions } = useAccesStocks();
  const lireVentes = actions?.includes('sales.read') ?? false;
  const lireAchats = actions?.includes('purchase.read') ?? false;
  const [f, setF] = useState<FormulaireArticle>(() => {
    const base = formulaireArticle(article);
    return article === null && nomInitial ? { ...base, name: nomInitial } : base;
  });
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
    <form noValidate onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-5">
      <FormGrid>
        <Field id={`${id}-nom`} label="Nom de l’article" required size="lg" error={champs['name']}>
          <TextInput
            value={f.name}
            maxLength={200}
            placeholder="Ciment gris 50 kg"
            autoFocus={article === null}
            onChange={(e) => maj({ name: e.target.value })}
          />
        </Field>
        <Field
          id={`${id}-code`}
          label="Code"
          size="sm"
          hint="Facultatif, unique."
          error={champs['code']}
        >
          <TextInput
            value={f.code}
            maxLength={40}
            onChange={(e) => maj({ code: e.target.value })}
          />
        </Field>
        <Field id={`${id}-nature`} label="Nature" size="lg" newRow group>
          <SegmentedControl<FormulaireArticle['kind']>
            value={f.kind}
            onChange={(v) => maj({ kind: v })}
            options={Object.entries(LIBELLES_NATURE_ARTICLE).map(([k, l]) => ({
              value: k as FormulaireArticle['kind'],
              label: l,
            }))}
          />
        </Field>
        <Field
          id={`${id}-unite`}
          label="Unité de stock"
          required
          size="sm"
          hint="Ne change plus après le premier mouvement."
          error={champs['unit']}
        >
          <TextInput
            value={f.unit}
            maxLength={20}
            onChange={(e) => maj({ unit: e.target.value })}
          />
        </Field>
        <Field
          id={`${id}-devise`}
          label="Devise de coût"
          size="sm"
          group
          newRow
          hint="Devise de valorisation ; aucun taux n’est jamais appliqué."
        >
          <SegmentedControl<'USD' | 'CDF'>
            value={f.costCurrency}
            onChange={(v) => maj({ costCurrency: v })}
            options={[
              { value: 'USD', label: 'USD' },
              { value: 'CDF', label: 'CDF' },
            ]}
          />
        </Field>
        <Field id={`${id}-emplacement`} label="Emplacement par défaut" size="md">
          <ChoixEmplacement
            valeur={f.defaultLocationId}
            onChange={(v) => maj({ defaultLocationId: v })}
            vide="Celui de l’organisation"
          />
        </Field>
        <div className="@lg:col-span-12">
          <Switch
            checked={f.tracked}
            onChange={(v) => maj({ tracked: v })}
            label="Suivre les quantités de cet article"
          />
        </div>
        {lireVentes ? (
          <Field
            id={`${id}-catalogue`}
            label="Article du catalogue de vente"
            size="lg"
            newRow
            hint="Ses ventes sortiront de ce stock. Seuls les biens peuvent être liés."
          >
            <ChoixCatalogue valeur={f.catalogItemId} onChange={(v) => maj({ catalogItemId: v })} />
          </Field>
        ) : null}
        {lireAchats ? (
          <Field id={`${id}-fournisseur`} label="Fournisseur habituel" size="lg" newRow>
            <ChoixFournisseur
              id={`${id}-fournisseur`}
              valeur={f.preferredSupplierId}
              onChange={(s) => maj({ preferredSupplierId: s?.id ?? '' })}
            />
          </Field>
        ) : null}
        <Field
          id={`${id}-desc`}
          label="Description"
          size="full"
          optional
          error={champs['description']}
        >
          <TextArea
            rows={2}
            value={f.description}
            maxLength={2000}
            onChange={(e) => maj({ description: e.target.value })}
          />
        </Field>
      </FormGrid>

      <FormSection title="Seuil de réapprovisionnement">
        <Field
          id={`${id}-min`}
          label="Seuil d’alerte"
          size="sm"
          hint="Vide : aucun seuil."
          error={champs['minQuantity']}
        >
          <ChampNombre
            value={f.minQuantity}
            onChange={(e) => maj({ minQuantity: e.target.value })}
          />
        </Field>
        <Field id={`${id}-cible`} label="Quantité visée" size="sm" error={champs['targetQuantity']}>
          <ChampNombre
            value={f.targetQuantity}
            onChange={(e) => maj({ targetQuantity: e.target.value })}
          />
        </Field>
        <Field id={`${id}-seuil-emplacement`} label="Pour" size="md">
          <ChoixEmplacement
            valeur={f.reorderLocationId}
            onChange={(v) => maj({ reorderLocationId: v })}
            vide="Tous les emplacements"
          />
        </Field>
      </FormSection>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Autres unités</legend>
        <p className="text-xs text-[var(--foreground-muted)]">
          Pour lire une commande ou une vente exprimée dans une autre unité : 1 carton = 12 pièces.
        </p>
        {champs['conversions'] ? (
          <p className="text-xs text-[var(--danger)]">{champs['conversions']}</p>
        ) : null}
        {f.conversions.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
            <Field
              id={`${id}-conv-${i}-u`}
              label="1 unité de"
              size="full"
              error={champs[`conversion-${i}-unit`]}
            >
              <TextInput
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
            </Field>
            <Field
              id={`${id}-conv-${i}-f`}
              label={`= combien de ${f.unit || 'unités'}`}
              size="full"
              error={champs[`conversion-${i}-factor`]}
            >
              <ChampNombre
                value={c.factor}
                onChange={(e) =>
                  maj({
                    conversions: f.conversions.map((x, j) =>
                      j === i ? { ...x, factor: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <Button
              size="sm"
              className="mt-6 max-sm:h-11"
              aria-label={`Retirer la conversion ${i + 1}`}
              onClick={() => maj({ conversions: f.conversions.filter((_, j) => j !== i) })}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          className="self-start max-sm:h-11"
          disabled={f.conversions.length >= 5}
          onClick={() => maj({ conversions: [...f.conversions, { unit: '', factor: '' }] })}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Ajouter une unité
        </Button>
      </fieldset>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="self-start max-sm:w-full">
        {article === null ? 'Créer l’article' : 'Enregistrer'}
      </SubmitButton>
    </form>
  );
}
