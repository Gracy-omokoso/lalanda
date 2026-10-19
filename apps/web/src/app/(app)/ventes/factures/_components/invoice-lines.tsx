'use client';

// Lignes d'un document (ADR-0023 § S25e.2) : depuis le catalogue, libres, ou —
// pour un avoir hors RRR — reprises de la facture d'origine (seule la quantité
// varie, au plus le restant).
//
// Aucun montant de ligne n'est calculé ici : le montant de chaque ligne vient
// de l'API après enregistrement (`lines[].amount`), mis en forme seulement.

import { useEffect, useState } from 'react';

import {
  api,
  type CatalogItemType,
  type CatalogItemView,
  type DocumentCurrency,
  type InvoiceView,
  type TaxGroupLetter,
  type TaxGroupList,
} from '@/lib/api';

import { BOUTON_DANGER, BOUTON_PETIT, CHAMP, aria } from '../../_components/form-ui';
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

function Erreur({
  id,
  texte,
}: {
  id: string;
  texte: string | undefined;
}): React.ReactElement | null {
  return texte ? (
    <p id={`${id}-erreur`} className="text-xs font-medium text-[var(--danger)]">
      {texte}
    </p>
  ) : null;
}

function AjoutArticle({
  devise,
  onAjouter,
  desactive,
}: {
  devise: DocumentCurrency;
  onAjouter: (item: CatalogItemView) => void;
  desactive: boolean;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CatalogItemView[]>([]);
  const [choix, setChoix] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    const t = setTimeout(() => {
      api
        .listCatalogItems({ status: 'active', limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => {
          if (annule) return;
          setItems(p.items);
          setErreur(null);
        })
        .catch(() => {
          if (!annule) setErreur('Impossible de charger le catalogue.');
        });
    }, 250);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-[var(--border)] p-3">
      <p className="text-sm font-medium">Ajouter un article du catalogue</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
        <label className="sr-only" htmlFor="art-q">
          Rechercher un article
        </label>
        <input
          id="art-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher…"
          className={CHAMP}
          disabled={desactive}
        />
        <label className="sr-only" htmlFor="art-choix">
          Article
        </label>
        <select
          id="art-choix"
          value={choix}
          onChange={(e) => setChoix(e.target.value)}
          className={CHAMP}
          disabled={desactive}
        >
          <option value="">Choisir un article…</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} — {libellePrix(i)}
              {i.currency !== devise ? ` (prix à saisir en ${devise})` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={BOUTON_PETIT}
          disabled={desactive || choix === ''}
          onClick={() => {
            const item = items.find((i) => i.id === choix);
            if (item) onAjouter(item);
            setChoix('');
          }}
        >
          Ajouter
        </button>
      </div>
      {erreur ? <p className="text-xs text-[var(--danger)]">{erreur}</p> : null}
    </div>
  );
}

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

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">Lignes</legend>
      {erreurs['lines'] ? <p className="text-xs text-[var(--danger)]">{erreurs['lines']}</p> : null}
      {form.lignes.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucune ligne. Une facture sans article n’est pas admise par la DGI.
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {form.lignes.map((l, i) => {
          const id = `ligne-${l.cle}`;
          const montant = aJour ? (vue?.lines[i]?.amount ?? null) : null;
          const err = (c: string): string | undefined => erreurs[`lines.${i}.${c}`] ?? undefined;
          return (
            <li
              key={l.cle}
              className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
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
                    <span className="font-mono text-sm">
                      {formatMontant(montant, form.currency)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    disabled={desactive}
                    onClick={() => retirer(i)}
                    aria-label={`Retirer la ligne ${i + 1}`}
                  >
                    Retirer
                  </button>
                </div>
              </div>
              {erreurs[`lines.${i}`] ? (
                <p className="text-xs text-[var(--danger)]">{erreurs[`lines.${i}`]}</p>
              ) : null}

              {l.source === 'free' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label htmlFor={`${id}-nom`} className="text-sm">
                      Désignation
                    </label>
                    <input
                      id={`${id}-nom`}
                      value={l.name}
                      maxLength={200}
                      onChange={(e) => majLigne(i, { name: e.target.value })}
                      className={CHAMP}
                      disabled={desactive}
                      {...aria(`${id}-nom`, err('name'))}
                    />
                    <Erreur id={`${id}-nom`} texte={err('name')} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${id}-groupe`} className="text-sm">
                      Groupe de taxation
                    </label>
                    <select
                      id={`${id}-groupe`}
                      value={l.taxGroup}
                      onChange={(e) => {
                        const g = e.target.value as TaxGroupLetter | '';
                        const types = typesAdmis(groupes, g);
                        majLigne(i, {
                          taxGroup: g,
                          itemType: types.length === 1 ? (types[0] ?? '') : '',
                          outOfScope: g === 'A' ? l.outOfScope : false,
                          taxe: taxeSpecifiqueAdmise(g) ? l.taxe : 'none',
                        });
                      }}
                      className={CHAMP}
                      disabled={desactive}
                      {...aria(`${id}-groupe`, err('taxGroup'))}
                    >
                      <option value="">Choisir…</option>
                      {groupes?.groups.map((g) => (
                        <option key={g.letter} value={g.letter}>
                          {libelleGroupe(g)}
                        </option>
                      ))}
                    </select>
                    <Erreur id={`${id}-groupe`} texte={err('taxGroup')} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${id}-type`} className="text-sm">
                      Type d’article
                    </label>
                    <select
                      id={`${id}-type`}
                      value={l.itemType}
                      onChange={(e) =>
                        majLigne(i, { itemType: e.target.value as CatalogItemType | '' })
                      }
                      className={CHAMP}
                      disabled={desactive}
                      {...aria(`${id}-type`, err('itemType'))}
                    >
                      <option value="">Choisir…</option>
                      {typesAdmis(groupes, l.taxGroup).map((t) => (
                        <option key={t} value={t}>
                          {ITEM_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <Erreur id={`${id}-type`} texte={err('itemType')} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${id}-code`} className="text-sm">
                      Code (facultatif)
                    </label>
                    <input
                      id={`${id}-code`}
                      value={l.code}
                      maxLength={50}
                      onChange={(e) => majLigne(i, { code: e.target.value })}
                      className={CHAMP}
                      disabled={desactive}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${id}-unite`} className="text-sm">
                      Unité (facultative)
                    </label>
                    <input
                      id={`${id}-unite`}
                      value={l.unit}
                      maxLength={20}
                      onChange={(e) => majLigne(i, { unit: e.target.value })}
                      className={CHAMP}
                      disabled={desactive}
                    />
                  </div>
                  {l.taxGroup === 'A' ? (
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={l.outOfScope}
                        onChange={(e) => majLigne(i, { outOfScope: e.target.checked })}
                        disabled={desactive}
                      />
                      Opération hors champ
                    </label>
                  ) : null}
                  {taxeSpecifiqueAdmise(l.taxGroup) ? (
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label htmlFor={`${id}-taxe`} className="text-sm">
                        Taxe spécifique
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <select
                          id={`${id}-taxe`}
                          value={l.taxe}
                          onChange={(e) => majLigne(i, { taxe: e.target.value as TaxeChoix })}
                          className={CHAMP}
                          disabled={desactive}
                        >
                          <option value="none">Aucune</option>
                          <option value="per_unit">Montant par unité ({form.currency})</option>
                          <option value="percent">Pourcentage</option>
                        </select>
                        {l.taxe !== 'none' ? (
                          <input
                            aria-label="Valeur de la taxe spécifique"
                            inputMode="decimal"
                            value={l.taxeValeur}
                            onChange={(e) => majLigne(i, { taxeValeur: e.target.value })}
                            className={CHAMP}
                            disabled={desactive}
                            {...aria(`${id}-taxev`, err('specificTax'))}
                          />
                        ) : null}
                      </div>
                      <Erreur id={`${id}-taxev`} texte={err('specificTax')} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-qte`} className="text-sm">
                    Quantité
                  </label>
                  <input
                    id={`${id}-qte`}
                    inputMode="decimal"
                    value={l.quantite}
                    onChange={(e) => majLigne(i, { quantite: e.target.value })}
                    className={CHAMP}
                    disabled={desactive}
                    {...aria(`${id}-qte`, err('quantity'), l.restant !== null)}
                  />
                  {l.restant !== null ? (
                    <p id={`${id}-qte-aide`} className="text-xs text-[var(--foreground-muted)]">
                      Restant à créditer : {formatQuantite(l.restant)}
                    </p>
                  ) : null}
                  <Erreur id={`${id}-qte`} texte={err('quantity')} />
                </div>
                {l.source !== 'origin' ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${id}-prix`} className="text-sm">
                        Prix unitaire ({form.currency}
                        {form.priceMode ? ` ${form.priceMode.toUpperCase()}` : ''})
                      </label>
                      <input
                        id={`${id}-prix`}
                        inputMode="decimal"
                        value={l.prix}
                        placeholder={l.source === 'catalog' ? 'Prix de l’article' : ''}
                        onChange={(e) => majLigne(i, { prix: e.target.value })}
                        className={CHAMP}
                        disabled={desactive}
                        {...aria(`${id}-prix`, err('unitPrice'))}
                      />
                      <Erreur id={`${id}-prix`} texte={err('unitPrice')} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${id}-remise`} className="text-sm">
                        Remise
                      </label>
                      <select
                        id={`${id}-remise`}
                        value={l.remise}
                        onChange={(e) => majLigne(i, { remise: e.target.value as RemiseChoix })}
                        className={CHAMP}
                        disabled={desactive}
                      >
                        <option value="none">Aucune</option>
                        <option value="percent">En pourcentage</option>
                        <option value="total_amount">Montant pour toute la quantité</option>
                      </select>
                      {l.remise !== 'none' ? (
                        <input
                          aria-label={`Valeur de la remise, ligne ${i + 1}`}
                          inputMode="decimal"
                          value={l.remiseValeur}
                          onChange={(e) => majLigne(i, { remiseValeur: e.target.value })}
                          className={CHAMP}
                          disabled={desactive}
                          {...aria(`${id}-remv`, err('discount'))}
                        />
                      ) : null}
                      <Erreur id={`${id}-remv`} texte={err('discount')} />
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {avoirOrigine ? (
        disponibles.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-[var(--border)] p-3">
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
                    className={BOUTON_PETIT}
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
            className={`${BOUTON_PETIT} self-start`}
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
