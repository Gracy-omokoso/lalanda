'use client';

// Nouvelle demande d'achat (ADR-0044 § 2.3), dans le `Modal` de `@lalanda/ui`.
// Elle naît BROUILLON ; on la soumet depuis sa fiche. Aucun total n'est affiché
// ici : le moteur les calcule à l'enregistrement et la fiche les montre.
//
// ADR-0074 : fournisseur en `EntityPicker` (tape pour chercher, « + » pour le
// créer sans quitter la demande), date en `DatePicker`, montants en
// `MoneyInput` (mise en forme seulement : la valeur reste la chaîne décimale
// lue par `preparerCommande`), largeurs sémantiques. Mêmes champs envoyés.

import {
  DatePicker,
  EntityPicker,
  ErrorSummary,
  Field,
  Form,
  FormGrid,
  FormSection,
  MoneyInput,
  SegmentedControl,
  SubmitButton,
  TextArea,
  TextInput,
  resumerErreurs,
  useBlurValidation,
} from '@lalanda/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { purchasesApi, type SupplierView } from '@/lib/api-purchases';
import { stockApi } from '@/lib/api-stock';

import { useShell } from '../../_components/shell-context';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { messageAchats, peutGererAchats } from './achats-model';
import { lignesPreremplies, type ArticlePrerempli } from './commande-prefill-model';
import {
  MENTION_TAXES,
  formulaireCommande,
  ligneVide,
  preparerCommande,
  type FormulaireCommande,
  type LigneSaisie,
} from './commandes-model';
import { NouveauFournisseur } from './fournisseur-formulaire';

/** Fournisseur tel que le sélecteur le connaît : la fiche lue, ou son seul identifiant. */
type FournisseurChoisi = Pick<SupplierView, 'id' | 'name'> &
  Partial<Pick<SupplierView, 'nif' | 'defaultCurrency'>>;

/**
 * Choix d'un fournisseur actif (ADR-0074 § 4) : on tape un nom ou un NIF (même
 * recherche qu'avant, `GET /purchases/suppliers?active=true&limit=50&q=…`) ;
 * absent, « + » ouvre la fiche fournisseur en fenêtre, pré-remplie avec le
 * texte tapé, et la fiche créée est choisie d'office. Le « + » n'existe qu'avec
 * `purchase.manage` (le droit de la route de création ; l'API reste juge).
 */
export function ChoixFournisseur({
  id,
  valeur,
  onChange,
  creer,
  placeholder = 'Nom ou NIF du fournisseur',
}: {
  id: string;
  valeur: string;
  onChange: (s: SupplierView | null) => void;
  /** Force (ou retire) la création rapide ; défaut : selon `purchase.manage`. */
  creer?: boolean;
  placeholder?: string;
}): React.ReactElement {
  const { actions } = useShell();
  const peutCreer = creer ?? (actions !== null && peutGererAchats(actions));
  const [choisi, setChoisi] = useState<FournisseurChoisi | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Un identifiant reçu sans fiche (préremplissage) reste « Fournisseur choisi ».
  const affiche: FournisseurChoisi | null =
    valeur === ''
      ? null
      : choisi?.id === valeur
        ? choisi
        : { id: valeur, name: 'Fournisseur choisi' };

  const chercher = useCallback(async (q: string): Promise<SupplierView[]> => {
    try {
      const p = await purchasesApi.listSuppliers({
        active: 'true',
        limit: 50,
        ...(q ? { q } : {}),
      });
      setErreur(null);
      return p.items;
    } catch (err) {
      setErreur(messageAchats(err, 'Fournisseurs illisibles.'));
      throw err;
    }
  }, []);

  function choisir(s: FournisseurChoisi | null): void {
    setChoisi(s);
    // La liste et la création rendent des fiches complètes.
    onChange(s as SupplierView | null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <EntityPicker<FournisseurChoisi>
        id={id}
        value={affiche}
        onChange={choisir}
        search={chercher}
        getKey={(s) => s.id}
        getLabel={(s) => s.name}
        getDescription={(s) => (s.nif ? `NIF ${s.nif}` : null)}
        placeholder={placeholder}
        recentKey="achats.fournisseurs"
        emptyText="Aucun fournisseur actif ne correspond."
        debounceMs={200}
        createTitle="Nouveau fournisseur"
        createButtonLabel="Créer un fournisseur"
        createSize="lg"
        {...(peutCreer
          ? {
              createForm: ({ initialText, onCreated, onCancel }) => (
                <NouveauFournisseur
                  enModal
                  nomInitial={initialText}
                  onCree={(_, fiche) => onCreated(fiche)}
                  onAnnuler={onCancel}
                />
              ),
            }
          : {})}
      />
      {erreur ? <p className="text-xs text-[var(--danger)]">{erreur}</p> : null}
    </div>
  );
}

export function NouvelleDemande({
  fournisseurInitial,
  articlesInitiaux = [],
  onCree,
}: {
  fournisseurInitial: string | null;
  /**
   * ADR-0046 — S8 : lignes préremplies depuis les suggestions de
   * réapprovisionnement (identifiants et quantités seulement) ; désignation et
   * unité relues sur l'API des stocks, prix à saisir d'après le devis.
   */
  articlesInitiaux?: readonly ArticlePrerempli[];
  onCree: (id: string) => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormulaireCommande>(() => {
    const base = formulaireCommande('USD', fournisseurInitial ?? '');
    return articlesInitiaux.length > 0
      ? { ...base, lignes: lignesPreremplies(articlesInitiaux, new Map()) }
      : base;
  });
  const cleArticles = articlesInitiaux.map((a) => a.itemId).join(',');

  useEffect(() => {
    if (cleArticles === '') return;
    let annule = false;
    const ids = cleArticles.split(',');
    void Promise.allSettled(ids.map((i) => stockApi.getItem(i))).then((res) => {
      if (annule) return;
      const details = new Map<string, { name: string; unit: string }>();
      res.forEach((r, i) => {
        if (r.status === 'fulfilled')
          details.set(ids[i]!, { name: r.value.name, unit: r.value.unit });
      });
      // Seules les lignes encore vides reçoivent leur désignation et leur unité.
      setF((p) => ({
        ...p,
        lignes: p.lignes.map((l) => {
          const itemId = l.itemRef?.startsWith('stk:') ? l.itemRef.slice(4) : null;
          const d = itemId ? details.get(itemId) : undefined;
          return d ? { ...l, label: l.label || d.name, unit: l.unit || d.unit } : l;
        }),
      }));
    });
    return () => {
      annule = true;
    };
  }, [cleArticles]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Validation à la sortie du champ (ADR-0074 § 9) : les règles de l'envoi.
  const { errors, touch, validateAll, submitCount } = useBlurValidation<string>(() => {
    const p = preparerCommande(f);
    return p.ok ? {} : p.champs;
  });
  // Erreurs de `preparerCommande` : à la sortie du champ, ou toutes après un essai.
  const affiches: Record<string, string | undefined> = errors;
  const idc = (cle: string): string => `${id}-${cle}`;

  const majLigne = (i: number, patch: Partial<LigneSaisie>) =>
    setF((p) => ({ ...p, lignes: p.lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const majTaxe = (i: number, patch: Partial<FormulaireCommande['taxes'][number]>) =>
    setF((p) => ({ ...p, taxes: p.taxes.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    validateAll();
    const p = preparerCommande(f);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      const o = await purchasesApi.createOrder(p.corps);
      onCree(o.id);
    } catch (err) {
      setErreur(messageAchats(err, 'Création impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  const resume = resumerErreurs(affiches, [
    { cle: 'title', id: idc('titre'), libelle: 'Objet de la demande' },
    { cle: 'expectedOn', id: idc('date'), libelle: 'Livraison souhaitée' },
    { cle: 'deliveryAddress', id: idc('adresse'), libelle: 'Adresse de livraison' },
    { cle: 'justification', id: idc('justif'), libelle: 'Justification' },
    { cle: 'lignes', id: '', libelle: 'Lignes' },
    ...f.lignes.flatMap((_, i) => [
      {
        cle: `ligne-${i}-label`,
        id: idc(`ligne-${i}-label`),
        libelle: `Ligne ${i + 1}, désignation`,
      },
      {
        cle: `ligne-${i}-quantity`,
        id: idc(`ligne-${i}-quantity`),
        libelle: `Ligne ${i + 1}, quantité`,
      },
      {
        cle: `ligne-${i}-unitPrice`,
        id: idc(`ligne-${i}-unitPrice`),
        libelle: `Ligne ${i + 1}, prix unitaire`,
      },
    ]),
    ...f.taxes.flatMap((_, i) => [
      { cle: `taxe-${i}-label`, id: idc(`taxe-${i}-label`), libelle: `Taxe ${i + 1}, libellé` },
      { cle: `taxe-${i}-amount`, id: idc(`taxe-${i}-montant`), libelle: `Taxe ${i + 1}, montant` },
    ]),
  ]);

  return (
    <Form onSubmit={(e) => void creer(e)} className="flex min-w-0 flex-col gap-5">
      <ErrorSummary errors={resume} submitCount={submitCount} />
      <fieldset disabled={envoi} className="flex min-w-0 flex-col gap-6">
        <FormGrid>
          <Field
            id={idc('titre')}
            label="Objet de la demande"
            required
            size="full"
            error={affiches['title']}
          >
            <TextInput
              value={f.title}
              maxLength={200}
              placeholder="Fournitures de bureau du trimestre"
              onChange={(e) => setF({ ...f, title: e.target.value })}
              onBlur={() => touch('title')}
            />
          </Field>
          <Field
            id={idc('fournisseur')}
            label="Fournisseur"
            optional
            size="lg"
            newRow
            hint="Tapez un nom ou un NIF. Absent : « + » le crée sans quitter la demande. À choisir avant la soumission."
          >
            <ChoixFournisseur
              id={idc('fournisseur')}
              valeur={f.supplierId}
              onChange={(s) =>
                setF((p) => ({
                  ...p,
                  supplierId: s?.id ?? '',
                  currency: s?.defaultCurrency ?? p.currency,
                }))
              }
            />
          </Field>
          <Field
            id={idc('devise')}
            label="Devise"
            group
            size="sm"
            hint="Ne change plus après la soumission."
          >
            <SegmentedControl<'USD' | 'CDF'>
              value={f.currency}
              onChange={(v) => setF((p) => ({ ...p, currency: v }))}
              options={[
                { value: 'USD', label: 'USD' },
                { value: 'CDF', label: 'CDF' },
              ]}
            />
          </Field>
          <Field
            id={idc('date')}
            label="Livraison souhaitée"
            optional
            size="sm"
            newRow
            error={affiches['expectedOn']}
          >
            <DatePicker
              value={f.expectedOn}
              onChange={(v) => {
                setF((p) => ({ ...p, expectedOn: v }));
                touch('expectedOn');
              }}
              onBlur={() => touch('expectedOn')}
              shortcuts={['plus7', 'plus30', 'endOfMonth']}
            />
          </Field>
          <Field
            id={idc('adresse')}
            label="Adresse de livraison"
            optional
            size="lg"
            hint="Vide : le siège de l’organisation."
            error={affiches['deliveryAddress']}
          >
            <TextInput
              value={f.deliveryAddress}
              maxLength={500}
              onChange={(e) => setF({ ...f, deliveryAddress: e.target.value })}
              onBlur={() => touch('deliveryAddress')}
            />
          </Field>
          <Field
            id={idc('justif')}
            label="Justification"
            optional
            size="full"
            error={affiches['justification']}
          >
            <TextArea
              rows={2}
              value={f.justification}
              maxLength={2000}
              onChange={(e) => setF({ ...f, justification: e.target.value })}
              onBlur={() => touch('justification')}
            />
          </Field>
        </FormGrid>

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">Lignes</legend>
          {affiches['lignes'] ? (
            <p className="text-xs font-medium text-[var(--danger)]">{affiches['lignes']}</p>
          ) : null}
          {f.lignes.map((l, i) => {
            const k = (c: string) => idc(`ligne-${i}-${c}`);
            const err = (c: string) => affiches[`ligne-${i}-${c}`];
            return (
              <div
                key={i}
                className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
                    Ligne {i + 1}
                  </span>
                  <button
                    type="button"
                    className={`${BOUTON_PETIT} inline-flex h-8 w-8 items-center justify-center p-0 max-sm:h-10 max-sm:w-10`}
                    disabled={f.lignes.length === 1}
                    aria-label={`Retirer la ligne ${i + 1}`}
                    onClick={() =>
                      setF((p) => ({ ...p, lignes: p.lignes.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
                <FormGrid>
                  <Field id={k('label')} label="Désignation" size="lg" error={err('label')}>
                    <TextInput
                      value={l.label}
                      maxLength={200}
                      onChange={(e) => majLigne(i, { label: e.target.value })}
                      onBlur={() => touch(`ligne-${i}-label`)}
                    />
                  </Field>
                  <Field id={k('kind')} label="Nature" group size="sm">
                    <SegmentedControl<LigneSaisie['kind']>
                      value={l.kind}
                      onChange={(v) => majLigne(i, { kind: v })}
                      options={[
                        { value: 'goods', label: 'Bien' },
                        { value: 'service', label: 'Service' },
                      ]}
                    />
                  </Field>
                  <Field
                    id={k('quantity')}
                    label="Quantité"
                    size="xs"
                    newRow
                    error={err('quantity')}
                  >
                    <TextInput
                      inputMode="decimal"
                      value={l.quantity}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => majLigne(i, { quantity: e.target.value })}
                      onBlur={() => touch(`ligne-${i}-quantity`)}
                      className="text-right tabular-nums"
                    />
                  </Field>
                  <Field id={k('unit')} label="Unité" optional size="xs">
                    <TextInput
                      value={l.unit}
                      maxLength={20}
                      placeholder="pièce, h…"
                      onChange={(e) => majLigne(i, { unit: e.target.value })}
                    />
                  </Field>
                  <Field
                    id={k('unitPrice')}
                    label="Prix unitaire HT"
                    size="sm"
                    error={err('unitPrice')}
                  >
                    <MoneyInput
                      value={l.unitPrice}
                      currency={f.currency}
                      onChange={(v) => majLigne(i, { unitPrice: v })}
                      onBlur={() => touch(`ligne-${i}-unitPrice`)}
                    />
                  </Field>
                </FormGrid>
              </div>
            );
          })}
          <button
            type="button"
            className={`${BOUTON_PETIT} inline-flex items-center gap-1 self-start max-sm:h-11`}
            disabled={f.lignes.length >= 100}
            onClick={() => setF((p) => ({ ...p, lignes: [...p.lignes, ligneVide()] }))}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Ajouter une ligne
          </button>
        </fieldset>

        <FormSection title="Taxes du devis fournisseur" description={MENTION_TAXES}>
          {f.taxes.map((t, i) => (
            <div key={i} className="col-span-full flex min-w-0 items-end gap-2">
              <FormGrid className="min-w-0 flex-1">
                <Field
                  id={idc(`taxe-${i}-label`)}
                  label="Libellé"
                  size="md"
                  error={affiches[`taxe-${i}-label`]}
                >
                  <TextInput
                    value={t.label}
                    maxLength={60}
                    onChange={(e) => majTaxe(i, { label: e.target.value })}
                    onBlur={() => touch(`taxe-${i}-label`)}
                  />
                </Field>
                <Field
                  id={idc(`taxe-${i}-montant`)}
                  label="Montant"
                  size="sm"
                  error={affiches[`taxe-${i}-amount`]}
                >
                  <MoneyInput
                    value={t.amount}
                    currency={f.currency}
                    onChange={(v) => majTaxe(i, { amount: v })}
                    onBlur={() => touch(`taxe-${i}-amount`)}
                  />
                </Field>
              </FormGrid>
              <button
                type="button"
                className={`${BOUTON_PETIT} mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center p-0 max-sm:h-11 max-sm:w-11`}
                aria-label={`Retirer la taxe ${i + 1}`}
                onClick={() => setF((p) => ({ ...p, taxes: p.taxes.filter((_, j) => j !== i) }))}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="col-span-full">
            <button
              type="button"
              className={`${BOUTON_PETIT} inline-flex items-center gap-1 max-sm:h-11`}
              disabled={f.taxes.length >= 5}
              onClick={() =>
                setF((p) => ({ ...p, taxes: [...p.taxes, { label: 'TVA', amount: '' }] }))
              }
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Ajouter une taxe
            </button>
          </div>
        </FormSection>
      </fieldset>

      <p className="text-xs text-[var(--foreground-muted)]">
        La demande est enregistrée en brouillon : les totaux sont calculés par Lalanda, puis vous la
        soumettez pour approbation depuis sa fiche.
      </p>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="max-sm:h-11">
          Enregistrer le brouillon
        </SubmitButton>
      </div>
    </Form>
  );
}
