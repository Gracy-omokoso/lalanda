'use client';

// Composition d'un document de vente (ADR-0023 §§ S25e.2, 7, 8) : client ou
// vente de comptoir, lignes, mode TTC/HT, devise CDF ou USD, paiements,
// commentaires ; puis « Émettre » (organisation ordinaire) ou « Normaliser »
// (organisation en facture normalisée) — jamais les deux.
//
// Le brouillon s'enregistre même incomplet : l'API renvoie ses totaux (moteur)
// et ce qui empêche encore de le figer (`readiness.blockers`). L'écran AFFICHE
// ces montants ; il n'en calcule aucun.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Field,
  FormGrid,
  SegmentedControl,
  Select,
  StickyActions,
  SubmitButton,
  Switch,
  TextInput,
  estRaccourciEnregistrer,
  useUnsavedChangesGuard,
} from '@lalanda/ui';
import { useEffect, useMemo, useState } from 'react';

import {
  api,
  type CustomerType,
  type DocumentCurrency,
  type InvoiceType,
  type InvoiceView,
  type SelectablePointsOfSale,
  type TaxGroupList,
} from '@/lib/api';

import { ChoixClientDocument } from '../../_components/client-picker';
import { Alerte, BOUTON, BOUTON_DANGER, Pastille } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import {
  erreursFormulaire,
  estRevisionPerimee,
  libelleTypeClient,
} from '../../_components/sales-model';

import { AmountsPanel } from './amounts-panel';
import { InvoiceLines } from './invoice-lines';
import {
  actionsDocument,
  choixPointDeVente,
  commentaireAModifiable,
  CURRENCY_LABELS,
  enteteDocument,
  estAvoir,
  FACTURES_BASE,
  type FormulaireDocument,
  formulaireDepuisVue,
  formulaireVide,
  libelleEmpechement,
  libellePointDeVente,
  messageFacture,
  NATURE_LABELS,
  pointDeVenteParDefaut,
  preparerDocument,
  PRICE_MODE_DOC_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  TYPES_AVOIR,
  TYPES_VENTE,
} from './invoice-model';
import { IssueDialog } from './issue-dialog';
import { NormalizeDialog } from './normalize-dialog';
import { PaymentsEditor } from './payments-editor';
import { PdfActions } from './pdf-actions';

/** Chemins du serveur rapprochés des champs de l'écran. */
function champsConnus(f: FormulaireDocument): string[] {
  const base = [
    'type',
    'currency',
    'priceMode',
    'customer',
    'lines',
    'payments',
    'creditNote.nature',
    'comments.A',
    'comments.C',
    'pointOfSaleId',
  ];
  f.lignes.forEach((_, i) => {
    base.push(`lines.${i}`);
    for (const c of [
      'quantity',
      'unitPrice',
      'discount',
      'name',
      'taxGroup',
      'itemType',
      'specificTax',
      'catalogItemId',
    ]) {
      base.push(`lines.${i}.${c}`);
    }
  });
  f.paiements.forEach((_, i) => base.push(`payments.${i}.amount`, `payments.${i}`));
  return base;
}

function correspondances(f: FormulaireDocument): Record<string, string> {
  const out: Record<string, string> = {
    'customer.customerId': 'customer',
    'customer.walkIn.name': 'customer',
    creditNote: 'creditNote.nature',
  };
  f.lignes.forEach((_, i) => {
    out[`lines.${i}.discount.value`] = `lines.${i}.discount`;
    out[`lines.${i}.specificTax.amount`] = `lines.${i}.specificTax`;
    out[`lines.${i}.specificTax.rate`] = `lines.${i}.specificTax`;
    out[`lines.${i}.originLineIndex`] = `lines.${i}`;
  });
  return out;
}

/**
 * Point de vente e-MCF du document (ADR-0026, écart C6) : affiché d'office
 * quand il n'y en a qu'un actif, à CHOISIR quand il y en a plusieurs.
 */
function ChoixPointDeVenteChamp({
  form,
  setForm,
  liste,
  desactive,
  erreur,
}: {
  form: FormulaireDocument;
  setForm: React.Dispatch<React.SetStateAction<FormulaireDocument>>;
  liste: SelectablePointsOfSale | null;
  desactive: boolean;
  erreur: string | undefined;
}): React.ReactElement | null {
  const choix = choixPointDeVente(liste, form.pointOfSaleId);
  if (choix.mode === 'masque') return null;
  if (choix.mode === 'aucun') {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Point de vente e-MCF</p>
        <p className="text-sm text-[var(--danger)]">
          Aucun point de vente e-MCF n’est actif : la normalisation est impossible tant qu’un
          responsable fiscal n’en a pas configuré un (Organisation › Fiscalité).
        </p>
      </div>
    );
  }
  if (choix.mode === 'unique') {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Point de vente e-MCF</p>
        <p className="text-sm">{libellePointDeVente(choix.pointDeVente)}</p>
        <p className="text-xs text-[var(--foreground-muted)]">
          Seul point de vente actif : il normalisera ce document.
        </p>
      </div>
    );
  }
  const message =
    erreur ??
    (choix.manquant
      ? 'Plusieurs points de vente sont actifs : choisissez celui qui normalisera ce document.'
      : undefined);
  return (
    <FormGrid>
      <Field id="doc-pdv" label="Point de vente e-MCF" required size="lg" error={message}>
        <Select
          value={choix.selection}
          onChange={(v) => setForm((f) => ({ ...f, pointOfSaleId: v === '' ? null : v }))}
          disabled={desactive}
          placeholder="Choisir un point de vente…"
          options={choix.options.map((p) => ({ value: p.id, label: libellePointDeVente(p) }))}
        />
      </Field>
    </FormGrid>
  );
}

export function InvoiceEditor({
  vueInitiale,
  onChange,
}: {
  /** `null` : nouveau document. */
  vueInitiale: InvoiceView | null;
  /** La vue a changé (enregistrée, émise, normalisée). */
  onChange?: (v: InvoiceView) => void;
}): React.ReactElement {
  const router = useRouter();
  const { gerer, facturer } = useAccesVentes();
  const [vue, setVue] = useState<InvoiceView | null>(vueInitiale);
  const [origine, setOrigine] = useState<InvoiceView | null>(null);
  const [form, setForm] = useState<FormulaireDocument>(() =>
    vueInitiale ? formulaireDepuisVue(vueInitiale) : formulaireVide(),
  );
  const [reference, setReference] = useState<string>(() => JSON.stringify(form));
  const [typeClient, setTypeClient] = useState<CustomerType | null>(
    vueInitiale?.customer.type ?? null,
  );
  const [groupes, setGroupes] = useState<TaxGroupList | null>(null);
  const [pointsDeVente, setPointsDeVente] = useState<SelectablePointsOfSale | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [autres, setAutres] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [perimee, setPerimee] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [dialogue, setDialogue] = useState<'emettre' | 'normaliser' | 'supprimer' | null>(null);

  const modifie = JSON.stringify(form) !== reference;
  // ADR-0074 § 9 et décision n° 3 : avertissement avant de quitter la page avec un
  // brouillon modifié (rechargement, onglet fermé, lien interne de l'application).
  const gardeNavigation = useUnsavedChangesGuard(modifie && gerer);
  const desactive = !gerer || envoi;
  const verrouOrigine = form.originInvoiceId !== null;

  useEffect(() => {
    api
      .getTaxGroups()
      .then(setGroupes)
      .catch(() => undefined);
  }, []);

  // Points de vente proposables ; un NOUVEAU document prend le seul actif.
  useEffect(() => {
    let annule = false;
    api
      .listSelectablePointsOfSale()
      .then((l) => {
        if (annule) return;
        setPointsDeVente(l);
        if (vueInitiale === null) {
          const parDefaut = pointDeVenteParDefaut(l);
          setForm((f) => (f.pointOfSaleId === null ? { ...f, pointOfSaleId: parDefaut } : f));
          setReference((r) => {
            const f = JSON.parse(r) as FormulaireDocument;
            return JSON.stringify(
              f.pointOfSaleId === null ? { ...f, pointOfSaleId: parDefaut } : f,
            );
          });
        }
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [vueInitiale]);

  // Avoir hors RRR : la facture d'origine donne les restants par ligne.
  useEffect(() => {
    const id = vueInitiale?.creditNote?.originInvoiceId ?? null;
    if (id === null) return;
    let annule = false;
    api
      .getInvoice(id)
      .then((o) => {
        if (annule) return;
        setOrigine(o);
        // Les restants ne sont connus qu'avec l'origine : on les reporte sans
        // marquer le formulaire comme modifié.
        const f = formulaireDepuisVue(vueInitiale!, o);
        setForm(f);
        setReference(JSON.stringify(f));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [vueInitiale]);

  const recharger = (v: InvoiceView): void => {
    setVue(v);
    const f = formulaireDepuisVue(v, origine);
    setForm(f);
    setReference(JSON.stringify(f));
    onChange?.(v);
  };

  async function enregistrer(): Promise<void> {
    setNotice(null);
    setErreur(null);
    setAutres([]);
    const prep = preparerDocument(form);
    if (!prep.ok) {
      setErreurs(prep.champs);
      setErreur('Certaines valeurs sont à corriger. Elles sont signalées sous chaque champ.');
      return;
    }
    setErreurs({});
    setEnvoi(true);
    try {
      if (vue === null) {
        const cree = await api.createInvoice(prep.corps);
        router.replace(`${FACTURES_BASE}/${encodeURIComponent(cree.id)}`);
        return;
      }
      const maj = await api.updateInvoice(vue.id, {
        ...prep.corps,
        expectedRevision: vue.revision,
      });
      recharger(maj);
      setNotice(`Brouillon ${maj.proformaRef} enregistré.`);
    } catch (err) {
      if (estRevisionPerimee(err)) setPerimee(true);
      const e = erreursFormulaire(err, champsConnus(form), correspondances(form));
      setErreurs(e.champs as Record<string, string>);
      setAutres(e.autres);
      setErreur(messageFacture(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function relire(): Promise<void> {
    if (!vue) return;
    try {
      recharger(await api.getInvoice(vue.id));
      setPerimee(false);
      setErreur(null);
    } catch (err) {
      setErreur(messageFacture(err, 'Impossible de recharger le document.'));
    }
  }

  async function supprimer(): Promise<void> {
    if (!vue) return;
    setEnvoi(true);
    try {
      await api.deleteInvoice(vue.id);
      router.push(FACTURES_BASE);
    } catch (err) {
      setErreur(messageFacture(err, 'Suppression impossible.'));
      setDialogue(null);
    } finally {
      setEnvoi(false);
    }
  }

  const actions = vue ? actionsDocument(vue, { gerer, facturer }) : [];
  const entete = vue ? enteteDocument(vue) : null;
  const typesProposes: readonly InvoiceType[] = verrouOrigine
    ? [form.type]
    : [...TYPES_VENTE, ...TYPES_AVOIR];
  const avoirLibre = estAvoir(form.type) && !verrouOrigine;
  const aModifiable = commentaireAModifiable(form, typeClient);
  const modeNormalise = vue?.readiness.action === 'normalize';
  const blockers = useMemo(() => vue?.readiness.blockers ?? [], [vue]);
  const avertissements = useMemo(() => vue?.readiness.warnings ?? [], [vue]);

  return (
    <section aria-labelledby="doc-titre" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href={FACTURES_BASE} className="text-sm text-[var(--foreground-muted)] underline">
          ← Documents de vente
        </Link>
        <h2 id="doc-titre" className="font-display text-lg font-bold tracking-tight">
          {entete ? entete.titre : 'Nouveau document de vente'}
        </h2>
        {entete && vue ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono">{entete.reference}</span>
            <Pastille ton="neutre">{STATUS_LABELS[vue.status]}</Pastille>
            {vue.creditNote ? (
              <span className="text-xs text-[var(--foreground-muted)]">
                Avoir · {NATURE_LABELS[vue.creditNote.nature].court}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            Le document naît en brouillon : c’est un pro forma, non valable comme facture.
          </p>
        )}
      </div>

      {!gerer ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Consultation seule : votre rôle ne permet pas de modifier les brouillons.
        </p>
      ) : null}

      {/* Région annoncée toujours présente, mais sans place réservée quand elle
          est vide : plus de trou au-dessus du formulaire (ADR-0074, qualité). */}
      <p aria-live="polite" className="text-sm text-[var(--foreground-muted)] empty:sr-only">
        {notice ?? ''}
      </p>
      {erreur ? (
        <Alerte
          action={
            perimee ? (
              <button
                type="button"
                className={`${BOUTON} text-[var(--foreground)]`}
                onClick={() => void relire()}
              >
                Recharger le document
              </button>
            ) : undefined
          }
        >
          <p>{erreur}</p>
          {autres.length > 0 ? (
            <ul className="list-disc pl-5">
              {autres.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enregistrer();
        }}
        onKeyDown={(e) => {
          // ADR-0074 § 9 : Cmd/Ctrl+Entrée enregistre le brouillon.
          if (estRaccourciEnregistrer(e) && gerer && !envoi) {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }
        }}
        className="flex flex-col gap-6"
        noValidate
      >
        <FormGrid>
          <Field
            id="doc-type"
            label="Type de document"
            size="md"
            hint={
              avoirLibre
                ? 'Un avoir rattaché à une facture se crée depuis cette facture (« Créer un avoir ») ; ici, seulement une remise, ristourne ou rabais sans facture d’origine.'
                : undefined
            }
          >
            <Select<InvoiceType>
              value={form.type}
              onChange={(t) =>
                setForm((f) => ({ ...f, type: t, nature: estAvoir(t) ? 'RRR' : null }))
              }
              disabled={desactive || verrouOrigine || vue !== null}
              options={typesProposes.map((t) => ({
                value: t,
                label: TYPE_LABELS[t],
                description:
                  estAvoir(t) && !verrouOrigine ? 'Remise, ristourne ou rabais' : undefined,
              }))}
            />
          </Field>
          <Field
            id="doc-devise"
            label="Devise du document"
            group
            size="sm"
            hint={`${CURRENCY_LABELS[form.currency]}. Le document est composé et payé dans cette devise ; en facture normalisée, il est converti en CDF au moment de « Normaliser ».`}
          >
            <SegmentedControl<DocumentCurrency>
              value={form.currency}
              onChange={(c) => setForm((f) => ({ ...f, currency: c }))}
              disabled={desactive || verrouOrigine}
              options={(Object.keys(CURRENCY_LABELS) as DocumentCurrency[]).map((c) => ({
                value: c,
                label: c,
              }))}
            />
          </Field>
          <Field
            id="mode-prix"
            label="Mode de prix"
            group
            required
            size="sm"
            hint={
              form.priceMode
                ? PRICE_MODE_DOC_LABELS[form.priceMode]
                : 'TTC : prix taxes comprises ; HT : prix hors taxes.'
            }
            error={erreurs['priceMode']}
          >
            <SegmentedControl<'ttc' | 'ht'>
              value={form.priceMode}
              onChange={(m) => setForm((f) => ({ ...f, priceMode: m }))}
              disabled={desactive || verrouOrigine}
              options={(['ttc', 'ht'] as const).map((m) => ({
                value: m,
                label: m.toUpperCase(),
              }))}
            />
          </Field>
        </FormGrid>

        <ChoixPointDeVenteChamp
          form={form}
          setForm={setForm}
          liste={pointsDeVente}
          desactive={desactive}
          erreur={erreurs['pointOfSaleId']}
        />

        <ChoixClientDocument
          form={form}
          setForm={setForm}
          verrouille={verrouOrigine}
          desactive={desactive}
          creer={gerer}
          erreur={erreurs['customer']}
          typeClient={typeClient}
          onType={setTypeClient}
        />
        {typeClient && form.client?.mode !== 'fiche' ? (
          <p className="-mt-3 text-xs text-[var(--foreground-muted)]">
            Type DGI : {libelleTypeClient(typeClient)}
          </p>
        ) : null}

        <InvoiceLines
          form={form}
          setForm={setForm}
          vue={vue}
          origine={origine}
          groupes={groupes}
          erreurs={erreurs}
          desactive={desactive}
          aJour={!modifie}
        />

        <PaymentsEditor
          form={form}
          setForm={setForm}
          vue={modifie ? null : vue}
          erreurs={erreurs}
          desactive={desactive}
        />

        <fieldset className="flex min-w-0 flex-col gap-3" disabled={desactive}>
          <legend className="mb-1 text-sm font-semibold">Commentaires</legend>
          {typeClient === 'AO' ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Ligne A : la référence d’exonération du client (« Réf. Exo. : … ») est ajoutée
              automatiquement.
            </p>
          ) : null}
          <FormGrid>
            {typeClient !== 'AO' && aModifiable ? (
              <Field
                id="com-a"
                label="Ligne A — référence de dérogation (groupe D)"
                size="lg"
                error={erreurs['comments.A']}
              >
                <TextInput
                  value={form.commentA}
                  maxLength={255}
                  onChange={(e) => setForm((f) => ({ ...f, commentA: e.target.value }))}
                />
              </Field>
            ) : null}
            <Field
              id="com-c"
              label="Ligne C — rappel du code d’une facture d’acompte"
              optional
              size="lg"
              newRow
              error={erreurs['comments.C']}
            >
              <TextInput
                value={form.commentC}
                maxLength={255}
                onChange={(e) => setForm((f) => ({ ...f, commentC: e.target.value }))}
              />
            </Field>
          </FormGrid>
          {form.currency === 'CDF' && modeNormalise ? (
            <Switch
              checked={form.showUsdCounterValue}
              onChange={(v) => setForm((f) => ({ ...f, showUsdCounterValue: v }))}
              label="Indiquer la contre-valeur en dollars sur la facture normalisée"
            />
          ) : null}
        </fieldset>

        {gerer ? (
          <StickyActions
            status={
              modifie && vue
                ? 'Modifications non enregistrées : les totaux affichés sont ceux du dernier enregistrement.'
                : modifie
                  ? 'Brouillon pas encore créé.'
                  : null
            }
          >
            <SubmitButton busy={envoi} busyLabel="Enregistrement…">
              {vue === null ? 'Créer le brouillon' : 'Enregistrer le brouillon'}
            </SubmitButton>
          </StickyActions>
        ) : null}
      </form>

      {vue ? (
        <>
          <AmountsPanel vue={vue} />

          {/* ADR-0025 : pro forma de la dernière version ENREGISTRÉE. */}
          {!modifie && vue.documentAmounts.calculation.ok ? <PdfActions vue={vue} /> : null}

          {blockers.length > 0 ? (
            <div className="rounded-xl border border-[var(--warn)]/50 p-4 text-sm">
              <p className="font-medium">
                Avant de {vue.readiness.action === 'issue' ? 'l’émettre' : 'le normaliser'} :
              </p>
              <ul className="mt-1 list-disc pl-5">
                {blockers.map((b, i) => (
                  <li key={i}>{libelleEmpechement(b)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {avertissements.length > 0 ? (
            <div role="note" className="rounded-xl border border-[var(--border)] p-4 text-sm">
              <p className="font-medium">À vérifier (n’empêche pas d’émettre) :</p>
              <ul className="mt-1 list-disc pl-5">
                {avertissements.map((w, i) => (
                  <li key={i}>{libelleEmpechement(w)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {actions.includes('emettre') ? (
              <button
                type="button"
                className={`${BOUTON} border-[var(--accent)] font-semibold`}
                disabled={modifie || envoi || !vue.readiness.ready}
                onClick={() => setDialogue('emettre')}
              >
                Émettre
              </button>
            ) : null}
            {actions.includes('normaliser') ? (
              <button
                type="button"
                className={`${BOUTON} border-[var(--accent)] font-semibold`}
                disabled={modifie || envoi || !vue.readiness.ready}
                onClick={() => setDialogue('normaliser')}
              >
                Normaliser
              </button>
            ) : null}
            {actions.includes('supprimer') ? (
              dialogue === 'supprimer' ? (
                <div
                  role="group"
                  aria-label="Confirmer la suppression du brouillon"
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="text-sm">Supprimer ce brouillon définitivement ?</span>
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    disabled={envoi}
                    onClick={() => void supprimer()}
                  >
                    Supprimer
                  </button>
                  <button type="button" className={BOUTON} onClick={() => setDialogue(null)}>
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  disabled={envoi}
                  onClick={() => setDialogue('supprimer')}
                >
                  Supprimer le brouillon
                </button>
              )
            ) : null}
          </div>
          {(actions.includes('emettre') || actions.includes('normaliser')) && modifie ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Enregistrez d’abord vos modifications.
            </p>
          ) : null}

          {dialogue === 'emettre' ? (
            <IssueDialog
              vue={vue}
              onFermer={() => setDialogue(null)}
              onEmise={(v) => {
                setDialogue(null);
                recharger(v);
              }}
            />
          ) : null}
          {dialogue === 'normaliser' ? (
            <NormalizeDialog
              vue={vue}
              contreValeurUsd={form.currency === 'CDF' && form.showUsdCounterValue}
              onFermer={() => setDialogue(null)}
              onNormalise={(v) => {
                setDialogue(null);
                recharger(v);
              }}
            />
          ) : null}
        </>
      ) : null}
      {gardeNavigation}
    </section>
  );
}
