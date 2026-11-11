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
//
// ADR-0074 : composants de `@lalanda/ui` (groupe et type en `Select`, devise et
// mode TTC/HT en segments — le mode reste sans valeur par défaut —, prix en
// `MoneyInput` qui ne fait que mettre en forme), validation à la sortie du champ
// avec les règles de l'envoi (`preparerArticle`), résumé d'erreurs. Sert aussi
// de fenêtre de création rapide depuis une ligne de facture (`nomInitial`).

import {
  Button,
  Checkbox,
  ErrorSummary,
  Field,
  Form,
  FormSection,
  MoneyInput,
  SegmentedControl,
  Select,
  SubmitButton,
  TextInput,
  resumerErreurs,
  useBlurValidation,
} from '@lalanda/ui';
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

import { Alerte, BOUTON, Pastille } from './form-ui';
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

/** Ordre, contrôle et libellé de chaque champ dans le résumé d'erreurs. */
const RESUME: { cle: ChampArticle; id: string; libelle: string }[] = [
  { cle: 'name', id: 'ar-name', libelle: 'Désignation' },
  { cle: 'code', id: 'ar-code', libelle: 'Référence interne' },
  { cle: 'unit', id: 'ar-unit', libelle: 'Unité' },
  { cle: 'taxGroup', id: 'ar-group', libelle: 'Groupe de taxation' },
  { cle: 'itemType', id: 'ar-type', libelle: 'Type d’article' },
  { cle: 'outOfScope', id: 'ar-hc', libelle: 'Opération hors champ' },
  { cle: 'currency', id: 'ar-devise', libelle: 'Devise' },
  { cle: 'unitPrice', id: 'ar-price', libelle: 'Prix unitaire' },
  { cle: 'priceMode', id: 'ar-mode', libelle: 'Le prix est' },
  { cle: 'specificKind', id: 'ar-ts', libelle: 'Taxe spécifique' },
  { cle: 'specificValue', id: 'ar-ts-valeur', libelle: 'Valeur de la taxe spécifique' },
];

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
  nomInitial = '',
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
  /** Création rapide depuis une ligne de document : désignation tapée dans le sélecteur. */
  nomInitial?: string;
}): React.ReactElement {
  const id = fiche.mode === 'edition' ? fiche.id : null;
  const [vue, setVue] = useState<CatalogItemView | null>(null);
  const [form, setForm] = useState<FormulaireArticle>(() => ({
    ...formulaireArticle(null),
    name: nomInitial,
  }));
  const [chargement, setChargement] = useState(id !== null);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [autres, setAutres] = useState<string[]>([]);
  const [champs, setChamps] = useState<Partial<Record<ChampArticle, string>>>({});
  const [perimee, setPerimee] = useState(false);
  const [existant, setExistant] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const lectureSeule = !gerer;
  // Validation à la sortie du champ (ADR-0074 § 9) : les règles de l'envoi.
  const {
    errors: erreursSaisie,
    touch,
    validateAll,
    submitCount: soumissions,
  } = useBlurValidation<ChampArticle>(() => {
    const p = preparerArticle(form, groupes);
    return p.ok ? {} : p.champs;
  });

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
    validateAll();
    const prep = preparerArticle(form, groupes);
    if (!prep.ok) {
      // Le résumé cliquable (ErrorSummary) liste les champs à compléter.
      setChamps(prep.champs);
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
  // Erreur du serveur (ou de l'envoi) d'abord, sinon celle de la saisie ; une
  // erreur effacée par une correction ne masque pas celle de la sortie du champ.
  const affiches: Partial<Record<ChampArticle, string>> = { ...erreursSaisie };
  for (const [k, m] of Object.entries(champs) as [ChampArticle, string | undefined][]) {
    if (m) affiches[k] = m;
  }

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

      <Form
        onSubmit={(e) => void enregistrer(e)}
        autoFocusFirst={vue === null}
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

        <ErrorSummary errors={resumerErreurs(affiches, RESUME)} submitCount={soumissions} />

        <fieldset disabled={lectureSeule || occupe} className="flex min-w-0 flex-col gap-6">
          <FormSection title="Article">
            <Field
              id="ar-name"
              label="Désignation"
              required
              size="lg"
              hint="Le libellé imprimé sur la facture."
              error={affiches.name}
            >
              <TextInput
                value={form.name}
                onChange={(e) => maj('name', e.target.value)}
                onBlur={() => touch('name')}
                maxLength={200}
              />
            </Field>
            <Field
              id="ar-code"
              label="Référence interne"
              optional
              size="sm"
              newRow
              hint="Lettres sans accent, chiffres et . _ / - ; unique dans votre catalogue."
              error={affiches.code}
            >
              <TextInput
                value={form.code}
                onChange={(e) => maj('code', e.target.value)}
                onBlur={() => touch('code')}
                maxLength={50}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <Field
              id="ar-unit"
              label="Unité"
              required
              size="xs"
              hint="Pièce, kg, litre, heure…"
              error={affiches.unit}
            >
              <TextInput
                value={form.unit}
                onChange={(e) => maj('unit', e.target.value)}
                onBlur={() => touch('unit')}
                maxLength={20}
              />
            </Field>
          </FormSection>

          <FormSection title="Taxation">
            <Field
              id="ar-group"
              label="Groupe de taxation"
              required
              size="lg"
              hint={groupes === null && !erreurGroupes ? 'Chargement des groupes…' : undefined}
              error={affiches.taxGroup}
            >
              <Select<TaxGroupLetter | ''>
                value={form.taxGroup}
                placeholder="Choisissez un groupe"
                loading={groupes === null && !erreurGroupes}
                disabled={groupes === null}
                onChange={(g) => {
                  choisirGroupe(g);
                  touch('taxGroup');
                }}
                onBlur={() => touch('taxGroup')}
                options={[
                  ...(groupes?.groups ?? []).map((g) => ({
                    value: g.letter,
                    label: libelleGroupe(g),
                    keywords: g.letter,
                  })),
                  ...(groupeRetire
                    ? [
                        {
                          value: groupeRetire,
                          label: `${groupeRetire} — n’est plus proposé`,
                          disabled: true,
                        },
                      ]
                    : []),
                ]}
              />
            </Field>
            <Field
              id="ar-type"
              label="Type d’article"
              required
              size="md"
              hint={
                admis.length === 0
                  ? 'Choisissez d’abord le groupe : il décide des types admis.'
                  : admis.length === 1
                    ? `Seul type admis dans le groupe ${form.taxGroup}.`
                    : `Types admis dans le groupe ${form.taxGroup}.`
              }
              error={affiches.itemType}
            >
              <Select<CatalogItemType | ''>
                value={form.itemType}
                placeholder={admis.length === 0 ? 'Groupe à choisir d’abord' : 'Choisissez un type'}
                disabled={admis.length === 0}
                onChange={(t) => {
                  maj('itemType', t);
                  touch('itemType');
                }}
                onBlur={() => touch('itemType')}
                options={admis.map((t) => ({ value: t, label: ITEM_TYPE_LABELS[t] }))}
              />
            </Field>
            {groupe?.outOfScopeAllowed ? (
              <Field
                id="ar-hc"
                label="Champ de la TVA"
                group
                size="full"
                error={affiches.outOfScope}
              >
                <Checkbox
                  checked={form.outOfScope}
                  onChange={(v) => {
                    maj('outOfScope', v);
                    touch('outOfScope');
                  }}
                  label="Opération hors champ"
                  description={
                    form.outOfScope
                      ? `Code transmis à la DGI : « ${OUT_OF_SCOPE_ITEM_CODE} » (valeur imposée, orthographe à confirmer auprès de la DGI). Votre référence interne est conservée.`
                      : 'À cocher pour une opération hors du champ de la TVA : la DGI exige alors un code d’article imposé.'
                  }
                />
              </Field>
            ) : null}
            {codeDgi ? (
              <p className="col-span-full text-xs text-[var(--foreground-muted)]">
                Code d’article envoyé à la DGI : <span className="font-mono">{codeDgi}</span>
              </p>
            ) : null}
          </FormSection>

          <FormSection title="Prix">
            <Field
              id="ar-devise"
              label="Devise"
              group
              required
              size="md"
              hint="Le prix et la taxe spécifique par unité s’entendent dans cette devise. Lors de la normalisation d’une facture, ses montants sont convertis en CDF au taux de référence."
              error={affiches.currency}
            >
              <SegmentedControl<CatalogCurrency>
                value={form.currency}
                onChange={(d) => {
                  maj('currency', d);
                  touch('currency');
                }}
                options={CATALOG_CURRENCIES.map((d) => ({ value: d, label: CURRENCY_LABELS[d] }))}
              />
            </Field>
            <Field
              id="ar-price"
              label="Prix unitaire"
              required
              size="sm"
              newRow
              hint="Hors taxe spécifique. Deux décimales au plus, par exemple 1 234,50."
              error={affiches.unitPrice}
            >
              <MoneyInput
                value={form.unitPrice}
                currency={form.currency}
                onChange={(v) => maj('unitPrice', v)}
                onBlur={() => touch('unitPrice')}
                maxLength={24}
                autoComplete="off"
              />
            </Field>
            <Field
              id="ar-mode"
              label="Le prix est"
              group
              required
              size="md"
              hint="Sur une facture dans l’autre mode, le prix sera converti par le calcul officiel et restera modifiable."
              error={affiches.priceMode}
            >
              <SegmentedControl<CatalogPriceMode>
                value={form.priceMode}
                onChange={(m) => {
                  maj('priceMode', m);
                  touch('priceMode');
                }}
                options={(['ttc', 'ht'] as CatalogPriceMode[]).map((m) => ({
                  value: m,
                  label: PRICE_MODE_LABELS[m].long,
                }))}
              />
            </Field>
          </FormSection>

          {tsAdmise ? (
            <FormSection
              title="Taxe spécifique"
              description="Facultative (accises, par exemple). Elle s’ajoute au prix et entre dans la base de la TVA."
            >
              <Field id="ar-ts" label="Nature" size="md" error={affiches.specificKind}>
                <Select<TaxeSpecifiqueChoix>
                  value={form.specificKind}
                  onChange={(k) => {
                    maj('specificKind', k);
                    if (k === 'none') maj('specificValue', '');
                  }}
                  options={[
                    { value: 'none', label: 'Aucune' },
                    { value: 'per_unit', label: 'Montant par unité' },
                    { value: 'percent', label: 'Pourcentage' },
                  ]}
                />
              </Field>
              {form.specificKind !== 'none' ? (
                <Field
                  id="ar-ts-valeur"
                  label={
                    form.specificKind === 'per_unit'
                      ? `Montant par ${form.unit.trim() || 'unité'}`
                      : 'Taux'
                  }
                  required
                  size="sm"
                  hint={
                    form.specificKind === 'per_unit'
                      ? 'Deux décimales au plus.'
                      : 'Supérieur à 0 et inférieur à 100, deux décimales au plus.'
                  }
                  error={affiches.specificValue}
                >
                  {form.specificKind === 'per_unit' ? (
                    <MoneyInput
                      value={form.specificValue}
                      currency={form.currency}
                      onChange={(v) => maj('specificValue', v)}
                      onBlur={() => touch('specificValue')}
                      maxLength={24}
                      autoComplete="off"
                    />
                  ) : (
                    <TextInput
                      inputMode="decimal"
                      value={form.specificValue}
                      onChange={(e) => maj('specificValue', e.target.value)}
                      onBlur={() => touch('specificValue')}
                      maxLength={24}
                      autoComplete="off"
                      trailing="%"
                      className="text-right tabular-nums"
                    />
                  )}
                </Field>
              ) : null}
            </FormSection>
          ) : form.taxGroup !== '' ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Aucune taxe spécifique dans le groupe {form.taxGroup}.
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button onClick={() => onFermer()} className="max-sm:h-11">
            {lectureSeule ? 'Retour au catalogue' : 'Annuler'}
          </Button>
          {lectureSeule ? null : (
            <SubmitButton
              busy={occupe}
              busyLabel="Enregistrement…"
              disabled={groupes === null}
              className="max-sm:h-11"
            >
              {fiche.mode === 'creation' ? 'Créer l’article' : 'Enregistrer les modifications'}
            </SubmitButton>
          )}
        </div>
      </Form>
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
