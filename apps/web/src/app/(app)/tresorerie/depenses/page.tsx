'use client';

// Onglet « Dépenses » (ADR-0034 § 2 et § 3) : saisie, liste, pièce justificative,
// totaux du mois par catégorie (moteur), dépenses récurrentes et échéances à
// confirmer. Fonctionne SANS projet ni plan : RUN est utilisable seul.

import { Modal, buttonClasses } from '@lalanda/ui';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  codeOf,
  messageOf,
  treasuryApi,
  type DueOccurrence,
  type ExpenseCategoryView,
  type ExpenseSummary,
  type ExpenseView,
  type RecurrenceFrequency,
  type RecurringExpenseView,
  type TreasuryAccountView,
  type TreasuryCurrency,
} from '@/lib/treasury-api';

import { lireMontantSaisi } from '../../ventes/_components/sales-model';
import { Bandeau, Section, useAccesTresorerie } from '../_components/treasury-access';
import { WorkProjectSelect } from '../_components/work-project-select';

import {
  MENTION_POSSEDEE,
  gestesTresorerie,
  lienPaiement,
  messageDepensePossedee,
} from './_components/depense-possedee';
import {
  FREQUENCY_LABELS,
  formatMontantSigne,
  libelleDate,
  libelleMois,
} from '../_components/treasury-model';

const CHAMP =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-60';
const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';
const PETIT =
  'rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition hover:border-[var(--accent)] disabled:opacity-50';

function moisCourant(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 7);
}
function aujourdhui(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}
function finDeMois(mois: string): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

interface Formulaire {
  spentOn: string;
  amount: string;
  currency: TreasuryCurrency;
  category: string;
  label: string;
  supplierName: string;
  accountId: string;
  deductibleVat: string;
  reference: string;
  /** Projet du RUN rattaché (ADR-0039 § 6.4), `''` : aucun. */
  workProjectId: string;
}

const VIDE: Formulaire = {
  spentOn: aujourdhui(),
  amount: '',
  currency: 'USD',
  category: 'charges_diverses',
  label: '',
  supplierName: '',
  accountId: '',
  deductibleVat: '',
  reference: '',
  workProjectId: '',
};

export default function DepensesPage(): React.ReactElement {
  const { gerer } = useAccesTresorerie();
  const [categories, setCategories] = useState<ExpenseCategoryView[]>([]);
  const [comptes, setComptes] = useState<TreasuryAccountView[]>([]);
  const [mois, setMois] = useState(moisCourant());
  const [filtreCategorie, setFiltreCategorie] = useState('');
  const [depenses, setDepenses] = useState<ExpenseView[]>([]);
  const [synthese, setSynthese] = useState<ExpenseSummary | null>(null);
  const [regles, setRegles] = useState<RecurringExpenseView[]>([]);
  const [echeances, setEcheances] = useState<DueOccurrence[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [form, setForm] = useState<Formulaire>(VIDE);
  const [enCours, setEnCours] = useState(false);
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);
  const [fournisseurs, setFournisseurs] = useState<string[]>([]);
  const [apercu, setApercu] = useState<{ id: string; url: string } | null>(null);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const from = `${mois}-01`;
      const to = finDeMois(mois);
      const [liste, somme, r, e] = await Promise.all([
        treasuryApi.listExpenses({
          from,
          to,
          category: filtreCategorie || undefined,
          status: 'all',
          limit: 200,
        }),
        treasuryApi.expenseSummary({ from, to }),
        treasuryApi.listRecurring(),
        treasuryApi.dueOccurrences(),
      ]);
      setDepenses(liste.items);
      setSynthese(somme);
      setRegles(r.items);
      setEcheances(e.items);
    } catch (err) {
      setErreur(messageOf(err));
    }
  }, [mois, filtreCategorie]);

  useEffect(() => {
    void treasuryApi
      .categories()
      .then(setCategories)
      .catch(() => undefined);
    void treasuryApi
      .listAccounts()
      .then((p) => setComptes(p.items.filter((a) => a.active)))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);
  useEffect(() => {
    if (form.supplierName.trim().length < 2) return;
    const t = setTimeout(() => {
      void treasuryApi
        .suppliers(form.supplierName)
        .then((r) => setFournisseurs(r.items))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [form.supplierName]);
  useEffect(() => () => (apercu ? URL.revokeObjectURL(apercu.url) : undefined), [apercu]);

  const libelleCategorie = useMemo(
    () => new Map(categories.map((c) => [c.code, c.label])),
    [categories],
  );
  const comptesDevise = comptes.filter((c) => c.currency === form.currency);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreurCreation(null);
    setInfo(null);
    const montant = lireMontantSaisi(form.amount);
    if (!montant.ok) {
      setErreurCreation(montant.erreur);
      return;
    }
    let tva: string | null = null;
    if (form.deductibleVat.trim() !== '') {
      const lu = lireMontantSaisi(form.deductibleVat);
      if (!lu.ok) {
        setErreurCreation(`TVA déductible : ${lu.erreur}`);
        return;
      }
      tva = lu.valeur;
    }
    setEnCours(true);
    try {
      await treasuryApi.createExpense({
        spentOn: form.spentOn,
        amount: montant.valeur,
        currency: form.currency,
        category: form.category,
        label: form.label,
        supplierName: form.supplierName || null,
        accountId: form.accountId || null,
        deductibleVat: tva,
        reference: form.reference || null,
        workProjectId: form.workProjectId || null,
      });
      setForm({
        ...VIDE,
        currency: form.currency,
        accountId: form.accountId,
        spentOn: form.spentOn,
      });
      setCreation(false);
      setInfo('Dépense enregistrée.');
      await charger();
    } catch (err) {
      setErreurCreation(messageOf(err));
    } finally {
      setEnCours(false);
    }
  }

  async function annuler(d: ExpenseView): Promise<void> {
    const motif = window.prompt(`Motif de l’annulation de « ${d.label} » ?`);
    if (!motif || motif.trim() === '') return;
    try {
      await treasuryApi.cancelExpense(d.id, motif);
      await charger();
    } catch (err) {
      setErreur(messageDepensePossedee(codeOf(err)) ?? messageOf(err));
    }
  }

  async function joindre(d: ExpenseView, fichier: File | undefined): Promise<void> {
    if (!fichier) return;
    try {
      await treasuryApi.uploadAttachment(d.id, fichier);
      setInfo('Pièce justificative enregistrée (métadonnées retirées).');
      await charger();
    } catch (err) {
      setErreur(
        messageDepensePossedee(codeOf(err)) ??
          (codeOf(err) === 'UNSUPPORTED_IMAGE_TYPE'
            ? 'Seules les photos PNG, JPEG ou WebP sont acceptées (le PDF n’est pas encore accepté).'
            : messageOf(err)),
      );
    }
  }

  async function voir(d: ExpenseView): Promise<void> {
    try {
      const blob = await treasuryApi.attachmentBlob(d.id);
      if (apercu) URL.revokeObjectURL(apercu.url);
      setApercu({ id: d.id, url: URL.createObjectURL(blob) });
    } catch (err) {
      setErreur(messageOf(err));
    }
  }

  async function confirmer(o: DueOccurrence): Promise<void> {
    try {
      const r = await treasuryApi.confirmOccurrence(o.recurringExpenseId, o.occurrenceDate);
      setInfo(
        r.alreadyConfirmed
          ? 'Cette échéance était déjà confirmée.'
          : `Échéance du ${libelleDate(o.occurrenceDate)} enregistrée comme dépense.`,
      );
      await charger();
    } catch (err) {
      setErreur(messageOf(err));
    }
  }

  const totauxParCategorie = (synthese?.byMonth ?? []).filter((r) => r.month === mois);

  return (
    <div className="flex flex-col gap-6">
      {gerer ? (
        <div className="flex justify-end">
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            onClick={() => {
              setErreurCreation(null);
              setCreation(true);
            }}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Nouvelle dépense
          </button>
        </div>
      ) : null}
      {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}
      {info ? <Bandeau>{info}</Bandeau> : null}

      {echeances.length > 0 ? (
        <Section
          titre="Échéances à confirmer"
          description="Dépenses récurrentes passées, pas encore enregistrées. Une échéance n’est une dépense que lorsque vous confirmez l’avoir payée."
        >
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {echeances.map((o) => (
              <li
                key={`${o.recurringExpenseId}-${o.occurrenceDate}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  {libelleDate(o.occurrenceDate)} — {o.label}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMontantSigne(o.amount, o.currency)}</span>
                  {gerer ? (
                    <button type="button" className={PETIT} onClick={() => void confirmer(o)}>
                      Confirmer le paiement
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Modal
        open={gerer && creation}
        onClose={() => setCreation(false)}
        title="Nouvelle dépense"
        description="Montant réellement payé. Le compte est facultatif, mais sans lui la dépense n’entre pas dans les soldes."
        size="lg"
        busy={enCours}
      >
        <div className="flex flex-col gap-3">
          {erreurCreation ? <Bandeau ton="erreur">{erreurCreation}</Bandeau> : null}
          <form
            aria-label="Nouvelle dépense"
            onSubmit={(e) => void enregistrer(e)}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <label className="flex flex-col gap-1 text-sm">
              Date
              <input
                type="date"
                className={CHAMP}
                value={form.spentOn}
                max={aujourdhui()}
                required
                onChange={(e) => setForm({ ...form, spentOn: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Montant payé
              <span className="flex gap-2">
                <input
                  className={CHAMP}
                  inputMode="decimal"
                  value={form.amount}
                  required
                  placeholder="0,00"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
                <select
                  className={CHAMP + ' w-24'}
                  value={form.currency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      currency: e.target.value as TreasuryCurrency,
                      accountId: '',
                    })
                  }
                >
                  <option value="USD">USD</option>
                  <option value="CDF">CDF</option>
                </select>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Catégorie
              <select
                className={CHAMP}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Libellé
              <input
                className={CHAMP}
                value={form.label}
                required
                maxLength={200}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Fournisseur (facultatif)
              <input
                className={CHAMP}
                list="fournisseurs-connus"
                value={form.supplierName}
                maxLength={120}
                onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
              />
              <datalist id="fournisseurs-connus">
                {fournisseurs.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Payé depuis
              <select
                className={CHAMP}
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              >
                <option value="">— Aucun compte —</option>
                {comptesDevise.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <WorkProjectSelect
              className={CHAMP}
              value={form.workProjectId}
              onChange={(workProjectId) => setForm({ ...form, workProjectId })}
            />
            <label className="flex flex-col gap-1 text-sm">
              TVA déductible (facultatif)
              <input
                className={CHAMP}
                inputMode="decimal"
                value={form.deductibleVat}
                onChange={(e) => setForm({ ...form, deductibleVat: e.target.value })}
              />
              <span className="text-xs text-[var(--foreground-muted)]">
                Conservée pour votre comptable ; le réalisé reçoit le montant payé (décision
                ouverte).
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Référence (reçu, transaction)
              <input
                className={CHAMP}
                value={form.reference}
                maxLength={100}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </label>
            <div className="flex items-end">
              <button type="submit" className={BOUTON} disabled={enCours}>
                Enregistrer la dépense
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Section
        titre={`Dépenses de ${libelleMois(mois)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              type="month"
              aria-label="Mois"
              className={CHAMP + ' w-40'}
              value={mois}
              onChange={(e) => setMois(e.target.value || moisCourant())}
            />
            <select
              aria-label="Catégorie"
              className={CHAMP + ' w-56'}
              value={filtreCategorie}
              onChange={(e) => setFiltreCategorie(e.target.value)}
            >
              <option value="">Toutes les catégories</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {totauxParCategorie.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {totauxParCategorie.map((t) => (
              <span
                key={`${t.currency}-${t.category}`}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs"
              >
                {libelleCategorie.get(t.category) ?? t.category} :{' '}
                <span className="tabular-nums font-medium">
                  {formatMontantSigne(t.total, t.currency)}
                </span>
              </span>
            ))}
          </div>
        ) : null}
        {depenses.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucune dépense ce mois-ci.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-[var(--foreground-muted)]">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Libellé</th>
                  <th className="py-2 pr-3">Catégorie</th>
                  <th className="py-2 pr-3 text-right">Montant</th>
                  <th className="py-2 pr-3">Pièce</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {depenses.map((d) => {
                  const gestes = gestesTresorerie(d, gerer);
                  const paiement = lienPaiement(d);
                  return (
                    <tr
                      key={d.id}
                      className={d.status === 'cancelled' ? 'opacity-50 line-through' : ''}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">{libelleDate(d.spentOn)}</td>
                      <td className="py-2 pr-3">
                        {d.label}
                        {d.supplierName ? (
                          <span className="block text-xs text-[var(--foreground-muted)]">
                            {d.supplierName}
                          </span>
                        ) : null}
                        {d.recurringExpenseId ? (
                          <span className="block text-xs text-[var(--foreground-muted)]">
                            Échéance récurrente
                          </span>
                        ) : null}
                        {paiement ? (
                          <span className="block text-xs text-[var(--foreground-muted)]">
                            {MENTION_POSSEDEE}{' '}
                            <Link href={paiement.href} className="underline underline-offset-2">
                              {paiement.libelle}
                            </Link>
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{d.categoryLabel}</td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                        {formatMontantSigne(d.amount, d.currency)}
                      </td>
                      <td className="py-2 pr-3">
                        {d.attachment ? (
                          <button type="button" className={PETIT} onClick={() => void voir(d)}>
                            Voir
                          </button>
                        ) : gestes.joindre ? (
                          <label className={PETIT + ' cursor-pointer'}>
                            Joindre
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="sr-only"
                              onChange={(e) => void joindre(d, e.target.files?.[0])}
                            />
                          </label>
                        ) : (
                          <span className="text-xs text-[var(--foreground-muted)]">—</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {gestes.annuler ? (
                          <button type="button" className={PETIT} onClick={() => void annuler(d)}>
                            Annuler
                          </button>
                        ) : d.status === 'cancelled' ? (
                          <span className="text-xs">Annulée</span>
                        ) : paiement ? (
                          <span className="text-xs text-[var(--foreground-muted)]">
                            Lecture seule
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {apercu ? (
          <figure className="flex flex-col items-start gap-2">
            {/* Octets assainis par l'API, servis en URL d'objet locale. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={apercu.url}
              alt="Pièce justificative"
              className="max-h-80 rounded-md border border-[var(--border)]"
            />
            <button type="button" className={PETIT} onClick={() => setApercu(null)}>
              Fermer l’aperçu
            </button>
          </figure>
        ) : null}
      </Section>

      <RecurringSection
        regles={regles}
        categories={categories}
        comptes={comptes}
        gerer={gerer}
        onChange={() => void charger()}
        onError={setErreur}
      />
    </div>
  );
}

function RecurringSection({
  regles,
  categories,
  comptes,
  gerer,
  onChange,
  onError,
}: {
  regles: RecurringExpenseView[];
  categories: ExpenseCategoryView[];
  comptes: TreasuryAccountView[];
  gerer: boolean;
  onChange: () => void;
  onError: (m: string) => void;
}): React.ReactElement {
  const [f, setF] = useState({
    label: '',
    amount: '',
    currency: 'USD' as TreasuryCurrency,
    category: 'loyer',
    accountId: '',
    frequency: 'monthly' as RecurrenceFrequency,
    startDate: aujourdhui(),
    endDate: '',
  });
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const montant = lireMontantSaisi(f.amount);
    if (!montant.ok) {
      setErreurCreation(montant.erreur);
      return;
    }
    try {
      await treasuryApi.createRecurring({
        label: f.label,
        amount: montant.valeur,
        currency: f.currency,
        category: f.category,
        accountId: f.accountId || null,
        frequency: f.frequency,
        startDate: f.startDate,
        endDate: f.endDate || null,
      });
      setF({ ...f, label: '', amount: '' });
      setCreation(false);
      onChange();
    } catch (err) {
      setErreurCreation(messageOf(err));
    }
  }

  async function basculer(r: RecurringExpenseView): Promise<void> {
    try {
      await treasuryApi.updateRecurring(r.id, r.revision, {
        label: r.label,
        amount: r.amount,
        currency: r.currency,
        category: r.category,
        supplierName: r.supplierName,
        accountId: r.accountId,
        frequency: r.frequency,
        startDate: r.startDate,
        endDate: r.endDate,
        active: !r.active,
      });
      onChange();
    } catch (err) {
      onError(messageOf(err));
    }
  }

  return (
    <Section
      titre="Dépenses récurrentes"
      description="Loyer, salaires, abonnements : une règle prévoit, elle ne paie rien. Ses échéances alimentent la prévision de trésorerie ; vous confirmez chacune une fois payée."
      actions={
        gerer ? (
          <button
            type="button"
            className={buttonClasses('primary', 'sm')}
            onClick={() => {
              setErreurCreation(null);
              setCreation(true);
            }}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Nouvelle règle
          </button>
        ) : undefined
      }
    >
      {regles.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucune dépense récurrente.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {regles.map((r) => (
            <li
              key={r.id}
              className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${r.active ? '' : 'opacity-60'}`}
            >
              <span>
                <span className="font-medium">{r.label}</span> —{' '}
                {FREQUENCY_LABELS[r.frequency].toLowerCase()} · {r.categoryLabel}
                {r.nextOccurrence ? (
                  <span className="block text-xs text-[var(--foreground-muted)]">
                    Prochaine échéance : {libelleDate(r.nextOccurrence)}
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{formatMontantSigne(r.amount, r.currency)}</span>
                {gerer ? (
                  <button type="button" className={PETIT} onClick={() => void basculer(r)}>
                    {r.active ? 'Suspendre' : 'Réactiver'}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={gerer && creation}
        onClose={() => setCreation(false)}
        title="Nouvelle dépense récurrente"
        description="Une règle prévoit, elle ne paie rien : chaque échéance sera à confirmer une fois payée."
        size="md"
      >
        {erreurCreation ? <Bandeau ton="erreur">{erreurCreation}</Bandeau> : null}
        <form
          onSubmit={(e) => void creer(e)}
          aria-label="Nouvelle dépense récurrente"
          className="mt-3 grid gap-3 sm:grid-cols-2"
        >
          <input
            aria-label="Libellé"
            placeholder="Libellé (ex. Loyer du local)"
            className={CHAMP}
            value={f.label}
            required
            onChange={(e) => setF({ ...f, label: e.target.value })}
          />
          <span className="flex gap-2">
            <input
              aria-label="Montant"
              placeholder="Montant"
              inputMode="decimal"
              className={CHAMP}
              value={f.amount}
              required
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
            <select
              aria-label="Devise"
              className={CHAMP + ' w-24'}
              value={f.currency}
              onChange={(e) =>
                setF({ ...f, currency: e.target.value as TreasuryCurrency, accountId: '' })
              }
            >
              <option value="USD">USD</option>
              <option value="CDF">CDF</option>
            </select>
          </span>
          <select
            aria-label="Catégorie"
            className={CHAMP}
            value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Fréquence"
            className={CHAMP}
            value={f.frequency}
            onChange={(e) => setF({ ...f, frequency: e.target.value as RecurrenceFrequency })}
          >
            {(Object.keys(FREQUENCY_LABELS) as RecurrenceFrequency[]).map((k) => (
              <option key={k} value={k}>
                {FREQUENCY_LABELS[k]}
              </option>
            ))}
          </select>
          <label className="flex flex-col gap-1 text-xs">
            Première échéance
            <input
              type="date"
              className={CHAMP}
              value={f.startDate}
              required
              onChange={(e) => setF({ ...f, startDate: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Dernière échéance (facultatif)
            <input
              type="date"
              className={CHAMP}
              value={f.endDate}
              onChange={(e) => setF({ ...f, endDate: e.target.value })}
            />
          </label>
          <select
            aria-label="Compte"
            className={CHAMP}
            value={f.accountId}
            onChange={(e) => setF({ ...f, accountId: e.target.value })}
          >
            <option value="">— Aucun compte —</option>
            {comptes
              .filter((c) => c.currency === f.currency)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <div className="flex items-end">
            <button type="submit" className={BOUTON}>
              Ajouter la règle
            </button>
          </div>
        </form>
      </Modal>
    </Section>
  );
}
