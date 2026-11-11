'use client';

// Lignes d'un document (ADR-0023 § S25e.2) : depuis le catalogue, libres, ou —
// pour un avoir hors RRR — reprises de la facture d'origine (seule la quantité
// varie, au plus le restant).
//
// Aucun montant de ligne n'est calculé ici : le montant de chaque ligne vient
// de l'API après enregistrement (`lines[].amount`), mis en forme seulement.
//
// ADR-0074 : l'article se TROUVE en tapant (`EntityPicker` sur le catalogue,
// même recherche qu'avant : articles actifs, 50 au plus) et s'ajoute dès qu'il
// est choisi ; absent, « + » ouvre la fiche article complète en fenêtre
// (`CatalogItemForm`, mêmes validations, sous `sales.manage`) et l'article créé
// est ajouté. Groupes, types, remise et taxe en `Select` ; prix et montants en
// `MoneyInput` (mise en forme seulement : `lireMontantSaisi` lit la valeur comme
// avant) ; une quantité garde la largeur d'une quantité. Les identifiants des
// champs viennent de `useId` et de la position de la ligne : la clé interne
// (`nouvelleCle`) diffère entre serveur et navigateur.

import {
  Checkbox,
  EntityPicker,
  Field,
  FormGrid,
  MoneyInput,
  Select,
  TextInput,
} from '@lalanda/ui';
import { Trash2 } from 'lucide-react';
import { useId } from 'react';

import {
  api,
  type CatalogItemType,
  type CatalogItemView,
  type DocumentCurrency,
  type InvoiceView,
  type TaxGroupLetter,
  type TaxGroupList,
} from '@/lib/api';

import { CatalogItemForm } from '../../_components/catalog-item-form';
import { BOUTON_DANGER, BOUTON_PETIT } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import {
  formatMontant,
  ITEM_TYPE_LABELS,
  libelleGroupe,
  libellePrix,
  taxeSpecifiqueAdmise,
  typesAdmis,
} from '../../_components/sales-model';

import {
  formatQuantite,
  ligneDepuisOrigine,
  ligneVide,
  lignesOrigineDisponibles,
  type FormulaireDocument,
  type LigneFormulaire,
  type RemiseChoix,
  type TaxeChoix,
} from './invoice-model';

/** Liste du catalogue : liens de la fiche ouverte en création rapide. */
const CATALOGUE_BASE = '/ventes/catalogue';

// Même recherche qu'avant : articles actifs, 50 au plus.
const chercherArticles = async (q: string): Promise<CatalogItemView[]> =>
  (await api.listCatalogItems({ status: 'active', limit: 50, ...(q ? { q } : {}) })).items;

function AjoutArticle({
  devise,
  onAjouter,
  desactive,
  groupes,
  creer,
}: {
  devise: DocumentCurrency;
  onAjouter: (item: CatalogItemView) => void;
  desactive: boolean;
  groupes: TaxGroupList | null;
  /** `sales.manage` : la fiche article peut être créée sans quitter le document. */
  creer: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] p-3">
      <FormGrid>
        <Field
          id="art-choix"
          label="Ajouter un article du catalogue"
          size="lg"
          disabled={desactive}
          hint={
            creer
              ? 'Tapez un nom ou un code : l’article choisi devient une ligne. Absent : « + » le crée.'
              : 'Tapez un nom ou un code : l’article choisi devient une ligne.'
          }
        >
          <EntityPicker<CatalogItemView>
            value={null}
            onChange={(item) => {
              if (item) onAjouter(item);
            }}
            search={chercherArticles}
            getKey={(i) => i.id}
            getLabel={(i) => i.name}
            getDescription={(i) =>
              [
                i.code ? `Code ${i.code}` : null,
                libellePrix(i),
                i.currency !== devise ? `prix à saisir en ${devise}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            }
            placeholder="Nom ou code de l’article"
            recentKey="ventes.articles"
            emptyText="Aucun article actif ne correspond."
            clearable={false}
            createTitle="Nouvel article"
            createButtonLabel="Créer un article"
            createSize="lg"
            {...(creer
              ? {
                  createForm: ({ initialText, onCreated, onCancel }) => (
                    <CatalogItemForm
                      fiche={{ mode: 'creation' }}
                      gerer
                      base={CATALOGUE_BASE}
                      groupes={groupes}
                      erreurGroupes={groupes === null ? 'Groupes de taxation indisponibles.' : null}
                      onRechargerGroupes={() => undefined}
                      enModal
                      nomInitial={initialText}
                      onFermer={(a) => (a ? onCreated(a) : onCancel())}
                    />
                  ),
                }
              : {})}
          />
        </Field>
      </FormGrid>
    </div>
  );
}

const OPTIONS_REMISE: { value: RemiseChoix; label: string }[] = [
  { value: 'none', label: 'Aucune' },
  { value: 'percent', label: 'En pourcentage' },
  { value: 'total_amount', label: 'Montant pour toute la quantité' },
];

export function InvoiceLines({
  form,
  setForm,
  vue,
  origine,
  groupes,
  erreurs,
  desactive,
  aJour,
}: {
  /** Le formulaire correspond-il à la dernière vue enregistrée ? Sinon, pas de montant de ligne. */
  aJour: boolean;
  form: FormulaireDocument;
  setForm: React.Dispatch<React.SetStateAction<FormulaireDocument>>;
  /** Dernière vue servie par l'API : montants de ligne. */
  vue: InvoiceView | null;
  /** Facture d'origine d'un avoir, avec les restants. */
  origine: InvoiceView | null;
  groupes: TaxGroupList | null;
  erreurs: Record<string, string>;
  desactive: boolean;
}): React.ReactElement {
  const { gerer } = useAccesVentes();
  // Stable entre le serveur et le navigateur (pas de compteur de module).
  const base = useId().replace(/:/g, '');
  const avoirOrigine = form.nature !== null && form.nature !== 'RRR';

  const majLigne = (i: number, patch: Partial<LigneFormulaire>): void =>
    setForm((f) => ({
      ...f,
      lignes: f.lignes.map((l, n) => (n === i ? { ...l, ...patch } : l)),
    }));
  const retirer = (i: number): void =>
    setForm((f) => ({ ...f, lignes: f.lignes.filter((_, n) => n !== i) }));
  const ajouter = (l: LigneFormulaire): void =>
    setForm((f) => ({ ...f, lignes: [...f.lignes, l] }));

  const disponibles = origine && avoirOrigine ? lignesOrigineDisponibles(origine, form) : [];
  const libellePrixUnitaire = `Prix unitaire${form.priceMode ? ` ${form.priceMode.toUpperCase()}` : ''}`;

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">Lignes</legend>
      {erreurs['lines'] ? (
        <p className="text-xs font-medium text-[var(--danger)]">{erreurs['lines']}</p>
      ) : null}
      {form.lignes.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucune ligne. Une facture sans article n’est pas admise par la DGI.
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {form.lignes.map((l, i) => {
          const id = `ligne-${base}-${i}`;
          const montant = aJour ? (vue?.lines[i]?.amount ?? null) : null;
          const err = (c: string): string | undefined => erreurs[`lines.${i}.${c}`] ?? undefined;
          return (
            <li
              key={l.cle}
              className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-sm font-medium break-words">
                  Ligne {i + 1} ·{' '}
                  {l.source === 'free'
                    ? 'ligne libre'
                    : l.source === 'origin'
                      ? 'reprise de la facture d’origine'
                      : 'article du catalogue'}
                  {l.apercu ? ` — ${l.apercu}` : ''}
                </p>
                <div className="flex items-center gap-3">
                  {montant !== null ? (
                    <span className="font-mono text-sm tabular-nums">
                      {formatMontant(montant, form.currency)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={`${BOUTON_DANGER} inline-flex h-8 w-8 items-center justify-center p-0 max-sm:h-10 max-sm:w-10`}
                    disabled={desactive}
                    onClick={() => retirer(i)}
                    aria-label={`Retirer la ligne ${i + 1}`}
                    title="Retirer la ligne"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {erreurs[`lines.${i}`] ? (
                <p className="text-xs font-medium text-[var(--danger)]">{erreurs[`lines.${i}`]}</p>
              ) : null}

              {l.source === 'free' ? (
                <FormGrid>
                  <Field
                    id={`${id}-nom`}
                    label="Désignation"
                    size="full"
                    disabled={desactive}
                    error={err('name')}
                  >
                    <TextInput
                      value={l.name}
                      maxLength={200}
                      onChange={(e) => majLigne(i, { name: e.target.value })}
                    />
                  </Field>
                  <Field
                    id={`${id}-groupe`}
                    label="Groupe de taxation"
                    size="lg"
                    disabled={desactive}
                    error={err('taxGroup')}
                  >
                    <Select<TaxGroupLetter | ''>
                      value={l.taxGroup}
                      placeholder="Choisir…"
                      loading={groupes === null}
                      onChange={(g) => {
                        const types = typesAdmis(groupes, g);
                        majLigne(i, {
                          taxGroup: g,
                          itemType: types.length === 1 ? (types[0] ?? '') : '',
                          outOfScope: g === 'A' ? l.outOfScope : false,
                          taxe: taxeSpecifiqueAdmise(g) ? l.taxe : 'none',
                        });
                      }}
                      options={(groupes?.groups ?? []).map((g) => ({
                        value: g.letter,
                        label: libelleGroupe(g),
                        keywords: g.letter,
                      }))}
                    />
                  </Field>
                  <Field
                    id={`${id}-type`}
                    label="Type d’article"
                    size="md"
                    disabled={desactive}
                    error={err('itemType')}
                  >
                    <Select<CatalogItemType | ''>
                      value={l.itemType}
                      placeholder={l.taxGroup === '' ? 'Choisir d’abord le groupe' : 'Choisir…'}
                      onChange={(t) => majLigne(i, { itemType: t })}
                      options={typesAdmis(groupes, l.taxGroup).map((t) => ({
                        value: t,
                        label: ITEM_TYPE_LABELS[t],
                      }))}
                    />
                  </Field>
                  <Field
                    id={`${id}-code`}
                    label="Code"
                    optional
                    size="sm"
                    newRow
                    disabled={desactive}
                  >
                    <TextInput
                      value={l.code}
                      maxLength={50}
                      onChange={(e) => majLigne(i, { code: e.target.value })}
                      className="font-mono"
                    />
                  </Field>
                  <Field id={`${id}-unite`} label="Unité" optional size="xs" disabled={desactive}>
                    <TextInput
                      value={l.unit}
                      maxLength={20}
                      onChange={(e) => majLigne(i, { unit: e.target.value })}
                    />
                  </Field>
                  {l.taxGroup === 'A' ? (
                    <Field
                      id={`${id}-hors-champ`}
                      label="Champ d’application"
                      group
                      size="full"
                      disabled={desactive}
                    >
                      <Checkbox
                        checked={l.outOfScope}
                        onChange={(v) => majLigne(i, { outOfScope: v })}
                        disabled={desactive}
                        label="Opération hors champ"
                      />
                    </Field>
                  ) : null}
                  {taxeSpecifiqueAdmise(l.taxGroup) ? (
                    <>
                      <Field
                        id={`${id}-taxe`}
                        label="Taxe spécifique"
                        size="md"
                        newRow
                        disabled={desactive}
                      >
                        <Select<TaxeChoix>
                          value={l.taxe}
                          onChange={(t) => majLigne(i, { taxe: t })}
                          options={[
                            { value: 'none', label: 'Aucune' },
                            { value: 'per_unit', label: `Montant par unité (${form.currency})` },
                            { value: 'percent', label: 'Pourcentage' },
                          ]}
                        />
                      </Field>
                      {l.taxe !== 'none' ? (
                        <Field
                          id={`${id}-taxev`}
                          label="Valeur de la taxe spécifique"
                          size="sm"
                          disabled={desactive}
                          error={err('specificTax')}
                        >
                          {l.taxe === 'per_unit' ? (
                            <MoneyInput
                              value={l.taxeValeur}
                              currency={form.currency}
                              onChange={(v) => majLigne(i, { taxeValeur: v })}
                            />
                          ) : (
                            <TextInput
                              inputMode="decimal"
                              value={l.taxeValeur}
                              onChange={(e) => majLigne(i, { taxeValeur: e.target.value })}
                              trailing="%"
                              className="text-right tabular-nums"
                            />
                          )}
                        </Field>
                      ) : null}
                    </>
                  ) : null}
                </FormGrid>
              ) : null}

              <FormGrid>
                <Field
                  id={`${id}-qte`}
                  label="Quantité"
                  size="xs"
                  disabled={desactive}
                  error={err('quantity')}
                  hint={
                    l.restant !== null
                      ? `Restant à créditer : ${formatQuantite(l.restant)}`
                      : undefined
                  }
                >
                  <TextInput
                    inputMode="decimal"
                    value={l.quantite}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => majLigne(i, { quantite: e.target.value })}
                    className="text-right tabular-nums"
                  />
                </Field>
                {l.source !== 'origin' ? (
                  <>
                    <Field
                      id={`${id}-prix`}
                      label={libellePrixUnitaire}
                      size="sm"
                      disabled={desactive}
                      error={err('unitPrice')}
                      {...(l.source === 'catalog' ? { hint: 'Vide : le prix de l’article.' } : {})}
                    >
                      <MoneyInput
                        value={l.prix}
                        currency={form.currency}
                        placeholder={l.source === 'catalog' ? 'Prix de l’article' : ''}
                        onChange={(v) => majLigne(i, { prix: v })}
                      />
                    </Field>
                    <Field id={`${id}-remise`} label="Remise" size="md" disabled={desactive}>
                      <Select<RemiseChoix>
                        value={l.remise}
                        onChange={(r) => majLigne(i, { remise: r })}
                        options={OPTIONS_REMISE}
                      />
                    </Field>
                    {l.remise !== 'none' ? (
                      <Field
                        id={`${id}-remv`}
                        label={l.remise === 'percent' ? 'Taux de remise' : 'Montant de la remise'}
                        size="sm"
                        disabled={desactive}
                        error={err('discount')}
                      >
                        {l.remise === 'percent' ? (
                          <TextInput
                            inputMode="decimal"
                            value={l.remiseValeur}
                            onChange={(e) => majLigne(i, { remiseValeur: e.target.value })}
                            trailing="%"
                            className="text-right tabular-nums"
                          />
                        ) : (
                          <MoneyInput
                            value={l.remiseValeur}
                            currency={form.currency}
                            onChange={(v) => majLigne(i, { remiseValeur: v })}
                          />
                        )}
                      </Field>
                    ) : null}
                  </>
                ) : null}
              </FormGrid>
            </li>
          );
        })}
      </ol>

      {avoirOrigine ? (
        disponibles.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] p-3">
            <p className="text-sm font-medium">Reprendre une ligne de la facture d’origine</p>
            <ul className="flex flex-col gap-2">
              {disponibles.map((o) => (
                <li
                  key={o.index}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {o.name} — restant {formatQuantite(o.remaining ?? o.quantity)}
                  </span>
                  <button
                    type="button"
                    className={`${BOUTON_PETIT} max-sm:h-11`}
                    disabled={desactive}
                    onClick={() => ajouter(ligneDepuisOrigine(o))}
                  >
                    Reprendre
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      ) : (
        <div className="flex flex-col gap-2">
          <AjoutArticle
            devise={form.currency}
            desactive={desactive}
            groupes={groupes}
            creer={gerer}
            onAjouter={(item) =>
              ajouter({
                ...ligneVide('catalog'),
                catalogItemId: item.id,
                apercu: item.name,
                deviseArticle: item.currency,
              })
            }
          />
          <button
            type="button"
            className={`${BOUTON_PETIT} self-start max-sm:h-11`}
            disabled={desactive}
            onClick={() => ajouter(ligneVide('free'))}
          >
            Ajouter une ligne libre
          </button>
        </div>
      )}
    </fieldset>
  );
}
