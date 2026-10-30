'use client';

// Fiche article : création, modification, consultation (ADR-0022 § S25c.3).
//
// - Le groupe de taxation se choisit dans la liste servie par l'API
//   (`GET /sales/tax-groups`), avec son libellé et, quand la DGI l'a fourni, son
//   taux. Aucun groupe ni taux n'est codé ici.
// - Le type d'article est restreint aux types admis par le groupe ; la case
//   « Opération hors champ » n'existe qu'en groupe A, avec le code transmis à la
//   DGI affiché ; la taxe spécifique disparaît en L et N.
// - Le prix est SAISI ET TRANSMIS COMME UNE CHAÎNE. Le mode TTC/HT est
//   obligatoire, sans valeur par défaut. Rien n'est calculé : la conversion d'un
//   mode à l'autre appartient au moteur, au moment de la facture.
// - La devise du prix est au choix, CDF (d'office) ou USD (ADR-0023 E4). Aucune
//   conversion ici : le passage en CDF n'a lieu qu'à la normalisation.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type CatalogItemType,
  type CatalogItemView,
  type CatalogPriceMode,
  type TaxGroupLetter,
  type TaxGroupList,
} from '@/lib/api';

import { AideEtErreur, Alerte, aria, BOUTON, Champ, CHAMP, Pastille } from './form-ui';
import {
  appliquerGroupe,
  bandeauGroupes,
  CATALOG_CURRENCIES,
  type CatalogCurrency,
  type ChampArticle,
  CHEMINS_ARTICLE,
  codeDgiApercu,
  corpsContrat,
  CURRENCY_LABELS,
  erreursFormulaire,
  estRevisionPerimee,
  type FicheOuverte,
  ficheExistante,
  formatDate,
  type FormulaireArticle,
  formulaireArticle,
  groupeDe,
  ITEM_TYPE_LABELS,
  libelleGroupe,
  messageVentes,
  OUT_OF_SCOPE_ITEM_CODE,
  preparerArticle,
  PRICE_MODE_LABELS,
  taxeSpecifiqueAdmise,
  type TaxeSpecifiqueChoix,
  typesAdmis,
} from './sales-model';

const CHAMPS: readonly ChampArticle[] = [
  'code',
  'name',
  'unit',
  'taxGroup',
  'itemType',
  'outOfScope',
  'unitPrice',
  'priceMode',
  'currency',
  'specificKind',
  'specificValue',
];

export function CatalogItemForm({
  fiche,
  gerer,
  base,
  groupes,
  erreurGroupes,
  onRechargerGroupes,
  onFermer,
  enModal = false,
}: {
  fiche: Exclude<FicheOuverte, null>;
  gerer: boolean;
  base: string;
  /** `null` tant que la liste n'est pas chargée. */
  groupes: TaxGroupList | null;
  erreurGroupes: string | null;
  onRechargerGroupes: () => void;
  onFermer: (enregistre?: CatalogItemView) => void;
  /** Création dans la fenêtre modale : son en-tête porte le titre et la fermeture. */
  enModal?: boolean;
}): React.ReactElement {
  const id = fiche.mode === 'edition' ? fiche.id : null;
  const [vue, setVue] = useState<CatalogItemView | null>(null);
  const [form, setForm] = useState<FormulaireArticle>(() => formulaireArticle(null));
  const [chargement, setChargement] = useState(id !== null);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [autres, setAutres] = useState<string[]>([]);
  const [champs, setChamps] = useState<Partial<Record<ChampArticle, string>>>({});
  const [perimee, setPerimee] = useState(false);
  const [existant, setExistant] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const lectureSeule = !gerer;

  const charger = useCallback(async (): Promise<void> => {
    if (id === null) return;
    setChargement(true);
    setErreurChargement(null);
    try {
      const v = await api.getCatalogItem(id);
      setVue(v);
      setForm(formulaireArticle(v));
      setChamps({});
      setErreur(null);
      setAutres([]);
      setPerimee(false);
    } catch (err) {
      setErreurChargement(messageVentes(err, 'Impossible de charger cet article.'));
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => {
    void charger();
  }, [charger]);

  function maj<K extends ChampArticle>(cle: K, valeur: FormulaireArticle[K]): void {
    setForm((f) => ({ ...f, [cle]: valeur }));
    setChamps((c) => (c[cle] ? { ...c, [cle]: undefined } : c));
  }

  function choisirGroupe(lettre: TaxGroupLetter | ''): void {
    setForm((f) => appliquerGroupe(f, groupes, lettre));
    setChamps((c) => ({ ...c, taxGroup: undefined, itemType: undefined, outOfScope: undefined }));
  }

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (lectureSeule) return;
    setErreur(null);
    setAutres([]);
    setPerimee(false);
    setExistant(null);
    const prep = preparerArticle(form, groupes);
    if (!prep.ok) {
      setChamps(prep.champs);
      setErreur('Certains champs sont à compléter ou à corriger.');
      return;
    }
    setChamps({});
    setOccupe(true);
    try {
      const ecrit =
        vue === null
          ? await api.createCatalogItem(corpsContrat(prep.corps))
          : await api.updateCatalogItem(vue.id, {
              ...corpsContrat(prep.corps),
              expectedRevision: vue.revision,
            });
      onFermer(ecrit);
    } catch (err) {
      const parChamp = erreursFormulaire(err, CHAMPS, CHEMINS_ARTICLE);
      setChamps(parChamp.champs);
      setAutres(parChamp.autres);
      setErreur(messageVentes(err, 'Enregistrement impossible.'));
      setPerimee(estRevisionPerimee(err));
      setExistant(ficheExistante(err));
    } finally {
      setOccupe(false);
    }
  }

  if (chargement && vue === null) {
    return (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement de l’article…
      </p>
    );
  }

  if (erreurChargement && vue === null) {
    return (
      <Alerte
        action={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void charger()} className={BOUTON}>
              Réessayer
            </button>
            <button type="button" onClick={() => onFermer()} className={BOUTON}>
              Retour au catalogue
            </button>
          </div>
        }
      >
        <p>{erreurChargement}</p>
      </Alerte>
    );
  }

  const groupe = groupeDe(groupes, form.taxGroup);
  const admis = typesAdmis(groupes, form.taxGroup);
  // Un article dont le groupe n'est plus proposé reste lisible ; la liste le
  // garde en option pour qu'il s'affiche, et le serveur refusera de
  // l'enregistrer tant qu'il n'a pas changé de groupe (§ S25c.4).
  const groupeRetire =
    form.taxGroup !== '' && groupes !== null && groupe === undefined ? form.taxGroup : null;
  const tsAdmise = taxeSpecifiqueAdmise(form.taxGroup);
  const codeDgi = codeDgiApercu(form);
  const titre = fiche.mode === 'creation' ? 'Nouvel article' : vue ? vue.name : 'Article';

  return (
    <section
      aria-labelledby={enModal ? undefined : 'fiche-article-titre'}
      aria-label={enModal ? titre : undefined}
      className="flex flex-col gap-5"
    >
      <div className={enModal ? 'flex flex-col gap-2 empty:hidden' : 'flex flex-col gap-2'}>
        {enModal ? null : (
          <>
            <button
              type="button"
              onClick={() => onFermer()}
              className="self-start text-sm text-[var(--foreground-muted)] underline-offset-4 hover:underline"
            >
              ← Retour au catalogue
            </button>
            <h2 id="fiche-article-titre" className="font-display text-lg font-bold tracking-tight">
              {titre}
            </h2>
          </>
        )}
        {vue ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {!vue.active ? (
              <Pastille ton="attention">Désactivé le {formatDate(vue.deactivatedAt)}</Pastille>
            ) : null}
            {vue.invoiced ? <Pastille ton="neutre">Déjà facturé</Pastille> : null}
          </div>
        ) : null}
        {lectureSeule ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Consultation seule : votre rôle permet de voir le catalogue, pas de le modifier.
          </p>
        ) : null}
      </div>

      {erreurGroupes ? (
        <Alerte
          action={
            <button
              type="button"
              onClick={onRechargerGroupes}
              className={`${BOUTON} text-[var(--foreground)]`}
            >
              Réessayer
            </button>
          }
        >
          <p>Les groupes de taxation n’ont pas pu être chargés : {erreurGroupes}</p>
        </Alerte>
      ) : groupes ? (
        <BandeauGroupes liste={groupes} />
      ) : null}

      {vue && !vue.taxGroupAvailable && form.taxGroup === vue.taxGroup ? (
        <div role="status" className="rounded-md border border-[var(--warn)]/50 p-3 text-sm">
          Le groupe {vue.taxGroup} n’est plus proposé par la liste en vigueur. Choisissez-en un
          autre pour enregistrer cet article ; il ne pourra pas être facturé d’ici là.
        </div>
      ) : null}

      <form
        onSubmit={(e) => void enregistrer(e)}
        noValidate
        className="flex max-w-3xl flex-col gap-5"
      >
        {erreur ? (
          <Alerte
            action={
              perimee || existant ? (
                <div className="flex flex-wrap gap-2">
                  {perimee ? (
                    <button
                      type="button"
                      onClick={() => void charger()}
                      className={`${BOUTON} text-[var(--foreground)]`}
                    >
                      Recharger l’article (vos modifications seront perdues)
                    </button>
                  ) : null}
                  {existant ? (
                    <Link
                      href={`${base}?fiche=${encodeURIComponent(existant)}`}
                      className={`${BOUTON} text-[var(--foreground)]`}
                    >
                      Ouvrir l’article existant
                    </Link>
                  ) : null}
                </div>
              ) : undefined
            }
          >
            <p>{erreur}</p>
            {autres.length > 0 ? (
              <ul className="list-disc pl-5">
                {autres.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
          </Alerte>
        ) : null}

        <fieldset disabled={lectureSeule || occupe} className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-sm font-semibold">Article</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Champ
                  id="ar-name"
                  label="Désignation"
                  requis
                  aide="Le libellé imprimé sur la facture."
                  erreur={champs.name}
                >
                  <input
                    id="ar-name"
                    value={form.name}
                    onChange={(e) => maj('name', e.target.value)}
                    maxLength={200}
                    required
                    className={CHAMP}
                    {...aria('ar-name', champs.name, true)}
                  />
                </Champ>
              </div>
              <Champ
                id="ar-code"
                label="Référence interne"
                aide="Facultative. Lettres sans accent, chiffres et . _ / - ; unique dans votre catalogue."
                erreur={champs.code}
              >
                <input
                  id="ar-code"
                  value={form.code}
                  onChange={(e) => maj('code', e.target.value)}
                  maxLength={50}
                  autoComplete="off"
                  spellCheck={false}
                  className={`${CHAMP} font-mono`}
                  {...aria('ar-code', champs.code, true)}
                />
              </Champ>
              <Champ
                id="ar-unit"
                label="Unité"
                requis
                aide="Pièce, kg, litre, heure…"
                erreur={champs.unit}
              >
                <input
                  id="ar-unit"
                  value={form.unit}
                  onChange={(e) => maj('unit', e.target.value)}
                  maxLength={20}
                  required
                  className={CHAMP}
                  {...aria('ar-unit', champs.unit, true)}
                />
              </Champ>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-sm font-semibold">Taxation</legend>
            <Champ
              id="ar-group"
              label="Groupe de taxation"
              requis
              aide={groupes === null && !erreurGroupes ? 'Chargement des groupes…' : undefined}
              erreur={champs.taxGroup}
            >
              <select
                id="ar-group"
                value={form.taxGroup}
                onChange={(e) => choisirGroupe(e.target.value as TaxGroupLetter | '')}
                disabled={groupes === null}
                required
                className={CHAMP}
                {...aria('ar-group', champs.taxGroup, groupes === null && !erreurGroupes)}
              >
                <option value="">Choisissez un groupe</option>
                {groupes?.groups.map((g) => (
                  <option key={g.letter} value={g.letter}>
                    {libelleGroupe(g)}
                  </option>
                ))}
                {groupeRetire ? (
                  <option value={groupeRetire}>{groupeRetire} — n’est plus proposé</option>
                ) : null}
              </select>
            </Champ>

            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={champs.itemType ? 'ar-type-erreur' : 'ar-type-aide'}
            >
              <legend className="text-sm font-medium">
                Type d’article
                <span className="text-[var(--foreground-muted)]" aria-hidden="true">
                  {' '}
                  *
                </span>
                <span className="sr-only"> (obligatoire)</span>
              </legend>
              {admis.length === 0 ? (
                <p id="ar-type-aide" className="text-xs text-[var(--foreground-muted)]">
                  Choisissez d’abord le groupe : il décide des types admis.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {admis.map((t) => (
                      <RadioCarte
                        key={t}
                        name="ar-type"
                        checked={form.itemType === t}
                        onChange={() => maj('itemType', t as CatalogItemType)}
                        label={ITEM_TYPE_LABELS[t]}
                      />
                    ))}
                  </div>
                  <p id="ar-type-aide" className="text-xs text-[var(--foreground-muted)]">
                    {admis.length === 1
                      ? `Seul type admis dans le groupe ${form.taxGroup}.`
                      : `Types admis dans le groupe ${form.taxGroup}.`}
                  </p>
                </>
              )}
              {champs.itemType ? (
                <p id="ar-type-erreur" className="text-xs font-medium text-[var(--danger)]">
                  {champs.itemType}
                </p>
              ) : null}
            </fieldset>

            {groupe?.outOfScopeAllowed ? (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.outOfScope}
                    onChange={(e) => maj('outOfScope', e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                    aria-describedby="ar-hc-aide"
                  />
                  <span>Opération hors champ</span>
                </label>
                <p id="ar-hc-aide" className="text-xs text-[var(--foreground-muted)]">
                  {form.outOfScope
                    ? `Code transmis à la DGI : « ${OUT_OF_SCOPE_ITEM_CODE} » (valeur imposée, orthographe à confirmer auprès de la DGI). Votre référence interne est conservée.`
                    : 'À cocher pour une opération hors du champ de la TVA : la DGI exige alors un code d’article imposé.'}
                </p>
                {champs.outOfScope ? (
                  <p className="text-xs font-medium text-[var(--danger)]">{champs.outOfScope}</p>
                ) : null}
              </div>
            ) : null}
            {codeDgi ? (
              <p className="text-xs text-[var(--foreground-muted)]">
                Code d’article envoyé à la DGI : <span className="font-mono">{codeDgi}</span>
              </p>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-sm font-semibold">Prix</legend>
            <fieldset
              className="flex flex-col gap-1.5"
              aria-describedby={champs.currency ? 'ar-devise-erreur' : 'ar-devise-aide'}
            >
              <legend className="text-sm font-medium">
                Devise
                <span className="text-[var(--foreground-muted)]" aria-hidden="true">
                  {' '}
                  *
                </span>
                <span className="sr-only"> (obligatoire)</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {CATALOG_CURRENCIES.map((d: CatalogCurrency) => (
                  <RadioCarte
                    key={d}
                    name="ar-devise"
                    checked={form.currency === d}
                    onChange={() => maj('currency', d)}
                    label={CURRENCY_LABELS[d]}
                  />
                ))}
              </div>
              <AideEtErreur
                id="ar-devise"
                aide="Le prix et la taxe spécifique par unité s’entendent dans cette devise. Lors de la normalisation d’une facture, ses montants sont convertis en CDF au taux de référence."
                erreur={champs.currency}
              />
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Champ
                id="ar-price"
                label={`Prix unitaire (${form.currency})`}
                requis
                aide="Hors taxe spécifique. Deux décimales au plus, par exemple 1 234,50."
                erreur={champs.unitPrice}
              >
                <div className="flex items-center gap-2">
                  <input
                    id="ar-price"
                    inputMode="decimal"
                    value={form.unitPrice}
                    onChange={(e) => maj('unitPrice', e.target.value)}
                    maxLength={24}
                    required
                    autoComplete="off"
                    className={`${CHAMP} fig text-right`}
                    {...aria('ar-price', champs.unitPrice, true)}
                  />
                  <span className="text-sm text-[var(--foreground-muted)]">{form.currency}</span>
                </div>
              </Champ>
              <fieldset
                className="flex flex-col gap-1.5"
                aria-describedby={champs.priceMode ? 'ar-mode-erreur' : 'ar-mode-aide'}
              >
                <legend className="text-sm font-medium">
                  Le prix est
                  <span className="text-[var(--foreground-muted)]" aria-hidden="true">
                    {' '}
                    *
                  </span>
                  <span className="sr-only"> (obligatoire)</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(['ttc', 'ht'] as CatalogPriceMode[]).map((m) => (
                    <RadioCarte
                      key={m}
                      name="ar-mode"
                      checked={form.priceMode === m}
                      onChange={() => maj('priceMode', m)}
                      label={PRICE_MODE_LABELS[m].long}
                    />
                  ))}
                </div>
                <AideEtErreur
                  id="ar-mode"
                  aide="Sur une facture dans l’autre mode, le prix sera converti par le calcul officiel et restera modifiable."
                  erreur={champs.priceMode}
                />
              </fieldset>
            </div>
          </fieldset>

          {tsAdmise ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold">Taxe spécifique</legend>
              <p className="-mt-1 text-xs text-[var(--foreground-muted)]">
                Facultative (accises, par exemple). Elle s’ajoute au prix et entre dans la base de
                la TVA.
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['none', 'Aucune'],
                    ['per_unit', 'Montant par unité'],
                    ['percent', 'Pourcentage'],
                  ] as [TaxeSpecifiqueChoix, string][]
                ).map(([k, label]) => (
                  <RadioCarte
                    key={k}
                    name="ar-ts"
                    checked={form.specificKind === k}
                    onChange={() => {
                      maj('specificKind', k);
                      if (k === 'none') maj('specificValue', '');
                    }}
                    label={label}
                  />
                ))}
              </div>
              {form.specificKind !== 'none' ? (
                <Champ
                  id="ar-ts-valeur"
                  label={
                    form.specificKind === 'per_unit'
                      ? `Montant par ${form.unit.trim() || 'unité'} (${form.currency})`
                      : 'Taux (%)'
                  }
                  requis
                  aide={
                    form.specificKind === 'per_unit'
                      ? 'Deux décimales au plus.'
                      : 'Supérieur à 0 et inférieur à 100, deux décimales au plus.'
                  }
                  erreur={champs.specificValue ?? champs.specificKind}
                >
                  <input
                    id="ar-ts-valeur"
                    inputMode="decimal"
                    value={form.specificValue}
                    onChange={(e) => maj('specificValue', e.target.value)}
                    maxLength={24}
                    required
                    autoComplete="off"
                    className={`${CHAMP} fig max-w-xs text-right`}
                    {...aria('ar-ts-valeur', champs.specificValue ?? champs.specificKind, true)}
                  />
                </Champ>
              ) : null}
            </fieldset>
          ) : form.taxGroup !== '' ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Aucune taxe spécifique dans le groupe {form.taxGroup}.
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {lectureSeule ? null : (
            <button type="submit" disabled={occupe || groupes === null} className={BOUTON}>
              {occupe
                ? 'Enregistrement…'
                : fiche.mode === 'creation'
                  ? 'Créer l’article'
                  : 'Enregistrer les modifications'}
            </button>
          )}
          <button type="button" onClick={() => onFermer()} className={BOUTON}>
            {lectureSeule ? 'Retour au catalogue' : 'Annuler'}
          </button>
        </div>
      </form>
    </section>
  );
}

export function BandeauGroupes({ liste }: { liste: TaxGroupList }): React.ReactElement {
  const b = bandeauGroupes(liste);
  return (
    <div
      role="note"
      className={
        b.ton === 'info'
          ? 'rounded-md border border-[var(--accent)]/40 p-3 text-sm'
          : 'rounded-md border border-[var(--border)] p-3 text-sm text-[var(--foreground-muted)]'
      }
    >
      <p className="font-medium text-[var(--foreground)]">{b.titre}</p>
      <p className="mt-0.5 text-xs">{b.texte}</p>
    </div>
  );
}

function RadioCarte({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}): React.ReactElement {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
        checked
          ? 'border-[var(--accent)]'
          : 'border-[var(--border)] hover:border-[var(--border-strong)]'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="h-4 w-4" />
      {label}
    </label>
  );
}
