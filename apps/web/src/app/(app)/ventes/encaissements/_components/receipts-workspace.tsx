'use client';

// Écran RUN › Ventes › Encaissements (ADR-0031 ; refonte ADR-0067 sur le modèle
// de l'écran Factures, ADR-0056) :
//
//   en-tête compact (titre, Nouvel encaissement)
//   cartes de chiffres et graphiques (`GET /sales/receipts/stats`)
//   factures à encaisser (échéance, « Encaisser »)
//   saisie d'un encaissement lettré sur une ou plusieurs factures
//   encaissements : onglets avec compteurs, recherche, tableau dense, annulation motivée
//   pont vers le réalisé
//
// Aucun montant n'est calculé ici : restes, statuts, totaux et chiffres viennent
// du moteur. Lecture `sales.read` ; écriture `sales.receipt` ; échéance `sales.manage`.

import {
  buttonClasses,
  DatePicker,
  Field,
  FormGrid,
  MoneyInput,
  Select,
  StatusPill,
  SubmitButton,
  TextInput,
  type StatusTone,
} from '@lalanda/ui';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api, type ReceiptStats, type ReceiptView, type SettlementView } from '@/lib/api';

import {
  BOUTON_LIGNE,
  CARTE,
  IconePlus,
  OngletsStatut,
  type EtatTableau,
} from '../../_components/dashboard-ui';
import { Alerte, BOUTON, BOUTON_DANGER, BOUTON_PETIT } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import { formatMontant, messageVentes } from '../../_components/sales-model';

import { BridgePanel } from './bridge-panel';
import { ReceiptDashboard } from './receipt-dashboard';
import {
  compteursEncaissements,
  correspond,
  FILTRES_ENCAISSEMENTS,
  statutEncaissement,
} from './receipt-dashboard-model';
import {
  ajouterFacture,
  aujourdhuiKinshasa,
  formulaireVide,
  libelleJour,
  libelleMoyen,
  messageEncaissement,
  preparerEncaissement,
  RECEIPT_METHODS,
  SETTLEMENT_LABELS,
  type ChampEncaissement,
  type FormulaireEncaissement,
} from './receipts-model';

type Etat = 'chargement' | 'pret' | 'erreur';
type FiltreRecus = 'recorded' | 'cancelled' | 'all';

const TON_REGLEMENT: Record<string, StatusTone> = {
  unpaid: 'open',
  partially_paid: 'open',
  paid: 'ok',
  overdue: 'late',
};

const ENTETE_TABLEAU =
  'border-b border-[var(--border)] bg-[var(--surface-muted)] text-left text-xs font-medium text-[var(--foreground-muted)]';
const LIGNE_TABLEAU =
  'h-[var(--row-h)] border-b border-[var(--border)] transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-[var(--surface-muted)]';

export function ReceiptsWorkspace(): React.ReactElement {
  const { encaisser, gerer } = useAccesVentes();
  const [etat, setEtat] = useState<Etat>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvertes, setOuvertes] = useState<SettlementView[]>([]);
  const [recus, setRecus] = useState<ReceiptView[]>([]);
  const [filtre, setFiltre] = useState<FiltreRecus>('recorded');
  const [recherche, setRecherche] = useState('');
  const [form, setForm] = useState<FormulaireEncaissement>(() =>
    formulaireVide(aujourdhuiKinshasa(new Date())),
  );
  const [erreursForm, setErreursForm] = useState<Partial<Record<ChampEncaissement, string>>>({});
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [annulation, setAnnulation] = useState<{ id: string; motif: string } | null>(null);

  // ADR-0067 : chiffres, graphiques et compteurs des onglets, calculés par le
  // serveur. Un échec ne bloque pas le reste de l'écran.
  const [stats, setStats] = useState<ReceiptStats | null>(null);
  const [etatStats, setEtatStats] = useState<EtatTableau>('chargement');
  const chargerStats = useCallback(async () => {
    setEtatStats((e) => (e === 'pret' ? e : 'chargement'));
    try {
      setStats(await api.getReceiptStats());
      setEtatStats('pret');
    } catch {
      setEtatStats('erreur');
    }
  }, []);

  const charger = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([
        api.getOpenSettlements(),
        api.listReceipts({ status: filtre, limit: 100 }),
      ]);
      setOuvertes(o.items);
      setRecus(r.items);
      setEtat('pret');
      setErreur(null);
    } catch (err) {
      setErreur(messageVentes(err, 'Impossible de charger les encaissements.'));
      setEtat('erreur');
    }
  }, [filtre]);

  useEffect(() => {
    void charger();
  }, [charger]);
  useEffect(() => {
    void chargerStats();
  }, [chargerStats]);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const prep = preparerEncaissement(form);
    if (!prep.ok) {
      setErreursForm(prep.erreurs);
      return;
    }
    setErreursForm({});
    setEnvoi(true);
    try {
      const r = await api.createReceipt(prep.body);
      setMessage(`Encaissement de ${formatMontant(r.amount, r.currency)} enregistré.`);
      setForm(formulaireVide(aujourdhuiKinshasa(new Date())));
      await Promise.all([charger(), chargerStats()]);
    } catch (err) {
      setMessage(messageEncaissement(err, 'Encaissement refusé.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function annuler() {
    if (!annulation) return;
    const recu = recus.find((r) => r.id === annulation.id);
    if (!recu) return;
    setEnvoi(true);
    try {
      await api.cancelReceipt(recu.id, annulation.motif.trim(), recu.revision);
      setAnnulation(null);
      await Promise.all([charger(), chargerStats()]);
    } catch (err) {
      setMessage(messageEncaissement(err, 'Annulation refusée.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function echeance(vue: SettlementView, valeur: string) {
    try {
      const maj = await api.setInvoiceDueDate(vue.invoiceId, valeur === '' ? null : valeur);
      setOuvertes((liste) => liste.map((v) => (v.invoiceId === maj.invoiceId ? maj : v)));
      void chargerStats();
    } catch (err) {
      setMessage(messageVentes(err, 'Échéance refusée.'));
    }
  }

  function encaisserFacture(v: SettlementView) {
    setForm((f) => ajouterFacture(f, v));
    document.getElementById('nouvel-encaissement')?.scrollIntoView({ block: 'start' });
  }

  const compteurs = stats ? compteursEncaissements(stats) : null;
  const affiches = recus.filter((r) => correspond(r, recherche));

  return (
    <section aria-labelledby="encaissements-titre" className="flex flex-col gap-3.5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-0.5">
          <h1
            id="encaissements-titre"
            className="font-display text-[length:var(--font-size-h1)] font-bold leading-tight tracking-[-0.2px]"
          >
            Encaissements
          </h1>
          <p className="text-[13px] text-[var(--foreground-muted)]">
            L’argent reçu sur vos factures, lettré facture par facture.
          </p>
        </div>
        {encaisser ? (
          <a
            href="#nouvel-encaissement"
            className={buttonClasses(
              'primary',
              'md',
              'gap-1.5 px-3.5 text-[13px] font-semibold max-sm:w-full',
            )}
          >
            <IconePlus />
            Nouvel encaissement
          </a>
        ) : null}
      </header>

      <ReceiptDashboard
        stats={stats}
        etat={etatStats}
        onReessayer={() => {
          setEtatStats('chargement');
          void chargerStats();
        }}
      />

      {etat === 'chargement' ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des encaissements…
        </p>
      ) : etat === 'erreur' ? (
        <Alerte
          action={
            <button type="button" onClick={() => void charger()} className={BOUTON}>
              Réessayer
            </button>
          }
        >
          <p>{erreur}</p>
        </Alerte>
      ) : (
        <>
          <section
            aria-labelledby="ouvertes-titre"
            className={`${CARTE} flex min-w-0 flex-col overflow-hidden`}
          >
            <div className="flex flex-col gap-0.5 border-b border-[var(--border)] px-4 py-3">
              <h2 id="ouvertes-titre" className="text-[13px] font-semibold">
                Factures à encaisser
                <span className="ml-1.5 font-mono text-[11px] font-normal text-[var(--foreground-muted)]">
                  {ouvertes.length.toLocaleString('fr-FR')}
                </span>
              </h2>
              <p className="text-xs text-[var(--foreground-muted)]">
                La part déclarée « à crédit » à l’émission, moins les avoirs et l’argent déjà reçu.
                Une facture n’est « en retard » que si elle a une échéance.
              </p>
            </div>
            {ouvertes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--foreground-muted)]">
                Aucune facture n’attend de règlement.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {ouvertes.map((v) => (
                  <li
                    key={v.invoiceId}
                    className="flex flex-col gap-2 px-3 py-2.5 transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)] sm:px-4 md:grid md:grid-cols-[130px_minmax(0,1fr)_160px_minmax(150px,auto)_auto] md:items-center md:gap-3"
                  >
                    <span className="flex items-center justify-between gap-2 md:contents">
                      <span className="truncate font-mono text-xs">{v.number ?? '—'}</span>
                      {v.status !== 'not_applicable' ? (
                        <StatusPill tone={TON_REGLEMENT[v.status] ?? 'open'} className="md:hidden">
                          {SETTLEMENT_LABELS[v.status]}
                        </StatusPill>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium">
                        {v.customerName ?? 'Vente de comptoir'}
                      </span>
                      <span className="text-xs text-[var(--foreground-muted)]">
                        Émise le {libelleJour(v.issuedOn)}
                      </span>
                    </span>
                    <span className="max-md:hidden">
                      {v.status !== 'not_applicable' ? (
                        <StatusPill tone={TON_REGLEMENT[v.status] ?? 'open'}>
                          {SETTLEMENT_LABELS[v.status]}
                        </StatusPill>
                      ) : null}
                    </span>
                    <span className="font-mono text-[13px] tabular-nums md:text-right">
                      Reste {formatMontant(v.settlement?.outstanding ?? '0.00', v.currency)}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 md:justify-end">
                      {gerer ? (
                        <span className="flex items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
                          Échéance
                          <DatePicker
                            aria-label={`Échéance de la facture ${v.number ?? ''}`.trim()}
                            value={v.dueDate ?? ''}
                            onChange={(iso) => void echeance(v, iso)}
                            shortcuts={['plus30', 'endOfMonth']}
                            className="w-40"
                          />
                        </span>
                      ) : v.dueDate ? (
                        <span className="text-xs text-[var(--foreground-muted)]">
                          Échéance {libelleJour(v.dueDate)}
                        </span>
                      ) : null}
                      {encaisser ? (
                        <button
                          type="button"
                          className={BOUTON_LIGNE}
                          disabled={form.lignes.length > 0 && form.currency !== v.currency}
                          onClick={() => encaisserFacture(v)}
                        >
                          Encaisser
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {encaisser ? (
            <section
              id="nouvel-encaissement"
              aria-labelledby="nouvel-titre"
              className={`${CARTE} flex scroll-mt-20 flex-col gap-3 px-4 py-3.5`}
            >
              <h2 id="nouvel-titre" className="text-[13px] font-semibold">
                Nouvel encaissement
              </h2>
              <form
                onSubmit={(e) => void enregistrer(e)}
                className="flex flex-col gap-4"
                noValidate
              >
                {form.lignes.length === 0 ? (
                  <p className="text-sm text-[var(--foreground-muted)]" id="enc-lignes-aide">
                    Choisissez une ou plusieurs factures de la même devise avec « Encaisser ».
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {form.lignes.map((l, i) => (
                      <li
                        key={l.invoiceId}
                        className="flex flex-col gap-2 sm:flex-row sm:items-end"
                      >
                        <span className="min-w-0 flex-1 text-sm break-words sm:pb-2">
                          {l.libelle}
                        </span>
                        <Field
                          id={`enc-ligne-${i}`}
                          label="Montant imputé"
                          className="sm:w-48"
                          error={erreursForm[`ligne.${i}`]}
                        >
                          <MoneyInput
                            value={l.montant}
                            currency={form.currency}
                            onChange={(v) =>
                              setForm((f) => ({
                                ...f,
                                lignes: f.lignes.map((x, j) =>
                                  j === i ? { ...x, montant: v } : x,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <button
                          type="button"
                          className={`${BOUTON_PETIT} max-sm:h-11`}
                          onClick={() =>
                            setForm((f) => ({ ...f, lignes: f.lignes.filter((_, j) => j !== i) }))
                          }
                        >
                          Retirer
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {erreursForm.lignes ? (
                  <p className="text-xs font-medium text-[var(--danger)]">{erreursForm.lignes}</p>
                ) : null}
                <FormGrid>
                  <Field
                    id="enc-date"
                    label="Date de réception"
                    required
                    size="sm"
                    error={erreursForm.receivedOn}
                  >
                    <DatePicker
                      value={form.receivedOn}
                      onChange={(iso) => setForm((f) => ({ ...f, receivedOn: iso }))}
                      shortcuts={['today']}
                    />
                  </Field>
                  <Field
                    id="enc-moyen"
                    label="Moyen de règlement"
                    required
                    size="md"
                    error={erreursForm.method}
                  >
                    <Select<FormulaireEncaissement['method']>
                      value={form.method}
                      placeholder="Choisir…"
                      onChange={(m) => setForm((f) => ({ ...f, method: m }))}
                      options={RECEIPT_METHODS.map((m) => ({ value: m.valeur, label: m.label }))}
                    />
                  </Field>
                  {form.lignes.length > 1 ? (
                    <Field
                      id="enc-total"
                      label="Montant reçu"
                      hint="Égal à la somme des montants imputés : le serveur le vérifie."
                      required
                      size="sm"
                      newRow
                      error={erreursForm.total}
                    >
                      <MoneyInput
                        value={form.total}
                        currency={form.currency}
                        onChange={(v) => setForm((f) => ({ ...f, total: v }))}
                      />
                    </Field>
                  ) : null}
                  <Field
                    id="enc-ref"
                    label="Référence"
                    optional
                    size="md"
                    hint="N° de virement, de chèque ou de transaction."
                  >
                    <TextInput
                      value={form.reference}
                      maxLength={100}
                      onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                      className="font-mono"
                    />
                  </Field>
                </FormGrid>
                {message ? (
                  <p role="status" className="text-sm">
                    {message}
                  </p>
                ) : null}
                <SubmitButton
                  busy={envoi}
                  busyLabel="Enregistrement…"
                  className="self-start max-sm:h-11 max-sm:w-full"
                >
                  Enregistrer l’encaissement
                </SubmitButton>
              </form>
            </section>
          ) : message ? (
            <p role="status" className="text-sm">
              {message}
            </p>
          ) : null}

          <section
            aria-labelledby="recus-titre"
            className={`${CARTE} flex min-w-0 flex-col overflow-hidden`}
          >
            <h2 id="recus-titre" className="sr-only">
              Encaissements enregistrés
            </h2>
            <div className="flex flex-col gap-2 border-b border-[var(--border)] p-2 sm:px-3 lg:flex-row lg:items-center lg:gap-3">
              <OngletsStatut
                options={FILTRES_ENCAISSEMENTS}
                valeur={filtre}
                compteurs={compteurs}
                onChange={setFiltre}
              />
              <form
                role="search"
                aria-label="Rechercher un encaissement"
                onSubmit={(e) => e.preventDefault()}
                className="flex min-w-0 flex-1"
              >
                <TextInput
                  id="enc-q"
                  type="search"
                  aria-label="Rechercher un encaissement"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  maxLength={100}
                  placeholder="N° de facture ou référence"
                  leading={<Search aria-hidden="true" className="h-4 w-4" />}
                  className="min-w-0 flex-1"
                />
              </form>
            </div>
            {affiches.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[var(--foreground-muted)]">
                {recherche.trim() !== '' || filtre !== 'recorded'
                  ? 'Aucun encaissement ne correspond à ces critères.'
                  : 'Aucun encaissement pour l’instant.'}
              </p>
            ) : (
              <>
                <table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
                  <caption className="sr-only">Encaissements</caption>
                  <colgroup>
                    <col className="w-[120px]" />
                    <col />
                    <col className="w-[130px]" />
                    <col className="w-[170px]" />
                    <col className="w-[130px]" />
                    <col className="w-[100px]" />
                  </colgroup>
                  <thead>
                    <tr className={ENTETE_TABLEAU}>
                      <th scope="col" className="px-4 py-[7px] font-medium">
                        Reçu le
                      </th>
                      <th scope="col" className="px-2 py-[7px] font-medium">
                        Factures et référence
                      </th>
                      <th scope="col" className="px-2 py-[7px] font-medium">
                        Moyen
                      </th>
                      <th scope="col" className="px-2 py-[7px] text-right font-medium">
                        Montant
                      </th>
                      <th scope="col" className="py-[7px] pl-4 pr-2 font-medium">
                        Statut
                      </th>
                      <th scope="col" className="px-4 py-[7px] font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {affiches.map((r) => {
                      const statut = statutEncaissement(r);
                      return (
                        <tr key={r.id} className={LIGNE_TABLEAU}>
                          <td className="px-4 text-[var(--foreground-muted)]">
                            {libelleJour(r.receivedOn)}
                          </td>
                          <td className="truncate px-2" title={detail(r)}>
                            <span className="font-mono text-xs">
                              {r.allocations.map((a) => a.invoiceNumber ?? '—').join(', ')}
                            </span>
                            {r.reference ? (
                              <span className="text-[var(--foreground-muted)]">
                                {' '}
                                · Réf. {r.reference}
                              </span>
                            ) : null}
                          </td>
                          <td className="truncate px-2">{libelleMoyen(r.method)}</td>
                          <td className="truncate px-2 text-right font-mono tabular-nums">
                            {formatMontant(r.amount, r.currency)}
                          </td>
                          <td className="py-1 pl-4 pr-2">
                            <StatusPill tone={statut.ton} title={r.cancellation?.reason}>
                              {statut.label}
                            </StatusPill>
                          </td>
                          <td className="px-4 text-right">
                            {encaisser && r.status === 'recorded' ? (
                              <button
                                type="button"
                                className={BOUTON_LIGNE}
                                onClick={() => setAnnulation({ id: r.id, motif: '' })}
                              >
                                Annuler
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <ul className="divide-y divide-[var(--border)] md:hidden">
                  {affiches.map((r) => {
                    const statut = statutEncaissement(r);
                    return (
                      <li key={r.id} className="flex flex-col gap-1 px-3 py-2.5">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[13px]">
                            {formatMontant(r.amount, r.currency)}
                          </span>
                          <StatusPill tone={statut.ton}>{statut.label}</StatusPill>
                        </span>
                        <span className="flex items-center justify-between gap-2 text-xs text-[var(--foreground-muted)]">
                          <span className="truncate">
                            {libelleMoyen(r.method)} · {libelleJour(r.receivedOn)}
                          </span>
                          {encaisser && r.status === 'recorded' ? (
                            <button
                              type="button"
                              className={BOUTON_LIGNE}
                              onClick={() => setAnnulation({ id: r.id, motif: '' })}
                            >
                              Annuler
                            </button>
                          ) : null}
                        </span>
                        <span className="break-words text-xs text-[var(--foreground-muted)]">
                          {detail(r)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {annulation ? (
              <div className="flex flex-col gap-2 border-t border-[var(--border)] p-3 sm:flex-row sm:items-end sm:px-4">
                <Field
                  id={`motif-${annulation.id}`}
                  label="Motif de l’annulation"
                  required
                  className="min-w-0 flex-1"
                  hint="Trois caractères au moins."
                >
                  <TextInput
                    value={annulation.motif}
                    maxLength={500}
                    onChange={(e) => setAnnulation({ id: annulation.id, motif: e.target.value })}
                  />
                </Field>
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  disabled={envoi || annulation.motif.trim().length < 3}
                  onClick={() => void annuler()}
                >
                  Confirmer l’annulation
                </button>
                <button type="button" className={BOUTON_PETIT} onClick={() => setAnnulation(null)}>
                  Garder
                </button>
              </div>
            ) : null}
            {recus.length >= 100 ? (
              <p className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--foreground-muted)]">
                Les 100 encaissements les plus récents sont affichés.
              </p>
            ) : null}
          </section>
        </>
      )}

      <BridgePanel />
    </section>
  );
}

/** Lettrages, référence et motif d'annulation, en une ligne lisible. */
function detail(r: ReceiptView): string {
  const lettrages = r.allocations
    .map((a) => `${a.invoiceNumber ?? '—'} : ${formatMontant(a.amount, r.currency)}`)
    .join(' · ');
  return `${lettrages}${r.reference ? ` · Réf. ${r.reference}` : ''}${
    r.cancellation ? ` · Motif d’annulation : ${r.cancellation.reason}` : ''
  }`;
}
