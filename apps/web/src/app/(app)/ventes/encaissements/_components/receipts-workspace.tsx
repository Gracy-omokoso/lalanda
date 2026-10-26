'use client';

// Onglet Encaissements (ADR-0031) : factures à encaisser, saisie d'un
// encaissement lettré sur une ou plusieurs factures, encaissements enregistrés
// (annulation motivée), totaux mensuels par devise, et pont vers le réalisé.
// Aucun montant n'est calculé ici : restes, statuts et totaux viennent du moteur.

import { useCallback, useEffect, useState } from 'react';

import { api, type ReceiptView, type ReceiptsSummary, type SettlementView } from '@/lib/api';

import {
  Alerte,
  BOUTON,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Champ,
  Pastille,
  aria,
} from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import { formatMontant, messageVentes } from '../../_components/sales-model';

import { BridgePanel } from './bridge-panel';
import {
  ajouterFacture,
  aujourdhuiKinshasa,
  formulaireVide,
  libelleJour,
  libelleMois,
  libelleMoyen,
  messageEncaissement,
  pastilleReglement,
  preparerEncaissement,
  RECEIPT_METHODS,
  type ChampEncaissement,
  type FormulaireEncaissement,
} from './receipts-model';

type Etat = 'chargement' | 'pret' | 'erreur';

export function ReceiptsWorkspace(): React.ReactElement {
  const { encaisser, gerer } = useAccesVentes();
  const [etat, setEtat] = useState<Etat>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvertes, setOuvertes] = useState<SettlementView[]>([]);
  const [recus, setRecus] = useState<ReceiptView[]>([]);
  const [totaux, setTotaux] = useState<ReceiptsSummary | null>(null);
  const [form, setForm] = useState<FormulaireEncaissement>(() =>
    formulaireVide(aujourdhuiKinshasa(new Date())),
  );
  const [erreursForm, setErreursForm] = useState<Partial<Record<ChampEncaissement, string>>>({});
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [annulation, setAnnulation] = useState<{ id: string; motif: string } | null>(null);

  const charger = useCallback(async () => {
    try {
      const [o, r, t] = await Promise.all([
        api.getOpenSettlements(),
        api.listReceipts({ status: 'all', limit: 100 }),
        api.getReceiptsSummary(),
      ]);
      setOuvertes(o.items);
      setRecus(r.items);
      setTotaux(t);
      setEtat('pret');
      setErreur(null);
    } catch (err) {
      setErreur(messageVentes(err, 'Impossible de charger les encaissements.'));
      setEtat('erreur');
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

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
      await charger();
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
      await charger();
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
    } catch (err) {
      setMessage(messageVentes(err, 'Échéance refusée.'));
    }
  }

  if (etat === 'chargement') {
    return (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement des encaissements…
      </p>
    );
  }
  if (etat === 'erreur') {
    return (
      <Alerte
        action={
          <button type="button" onClick={() => void charger()} className={BOUTON}>
            Réessayer
          </button>
        }
      >
        <p>{erreur}</p>
      </Alerte>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="ouvertes-titre" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="ouvertes-titre" className="font-display text-lg font-bold tracking-tight">
            Factures à encaisser
          </h2>
          <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
            La part déclarée « à crédit » à l’émission, moins les avoirs à crédit et l’argent déjà
            reçu. Une facture n’est « en retard » que si vous lui avez donné une échéance.
          </p>
        </div>
        {ouvertes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-muted)]">
            Aucune facture n’attend de règlement.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {ouvertes.map((v) => {
              const pastille = pastilleReglement(v);
              return (
                <li
                  key={v.invoiceId}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{v.number ?? '—'}</span>
                      {pastille ? <Pastille ton={pastille.ton}>{pastille.label}</Pastille> : null}
                    </span>
                    <span className="break-words text-sm">
                      {v.customerName ?? 'Vente de comptoir'}
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      Émise le {libelleJour(v.issuedOn)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end">
                    <span className="font-mono text-sm">
                      Reste {formatMontant(v.settlement?.outstanding ?? '0.00', v.currency)}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {gerer ? (
                        <label className="flex items-center gap-1 text-xs text-[var(--foreground-muted)]">
                          Échéance
                          <input
                            type="date"
                            value={v.dueDate ?? ''}
                            onChange={(e) => void echeance(v, e.target.value)}
                            className={`${CHAMP} w-auto py-1 text-xs`}
                          />
                        </label>
                      ) : v.dueDate ? (
                        <span className="text-xs text-[var(--foreground-muted)]">
                          Échéance {libelleJour(v.dueDate)}
                        </span>
                      ) : null}
                      {encaisser ? (
                        <button
                          type="button"
                          className={BOUTON_PETIT}
                          disabled={form.lignes.length > 0 && form.currency !== v.currency}
                          onClick={() => setForm((f) => ajouterFacture(f, v))}
                        >
                          Encaisser
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {encaisser ? (
        <section aria-labelledby="nouvel-titre" className="flex flex-col gap-3">
          <h2 id="nouvel-titre" className="font-display text-lg font-bold tracking-tight">
            Nouvel encaissement
          </h2>
          <form onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-4" noValidate>
            {form.lignes.length === 0 ? (
              <p className="text-sm text-[var(--foreground-muted)]" id="enc-lignes-aide">
                Choisissez une ou plusieurs factures de la même devise avec « Encaisser ».
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {form.lignes.map((l, i) => (
                  <li
                    key={l.invoiceId}
                    className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"
                  >
                    <span className="text-sm">{l.libelle}</span>
                    <Champ
                      id={`enc-ligne-${i}`}
                      label={`Montant imputé (${form.currency})`}
                      erreur={erreursForm[`ligne.${i}`]}
                    >
                      <input
                        id={`enc-ligne-${i}`}
                        inputMode="decimal"
                        value={l.montant}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            lignes: f.lignes.map((x, j) =>
                              j === i ? { ...x, montant: e.target.value } : x,
                            ),
                          }))
                        }
                        className={CHAMP}
                        {...aria(`enc-ligne-${i}`, erreursForm[`ligne.${i}`])}
                      />
                    </Champ>
                    <button
                      type="button"
                      className={BOUTON_PETIT}
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ id="enc-date" label="Date de réception" requis erreur={erreursForm.receivedOn}>
                <input
                  id="enc-date"
                  type="date"
                  value={form.receivedOn}
                  onChange={(e) => setForm((f) => ({ ...f, receivedOn: e.target.value }))}
                  className={CHAMP}
                  {...aria('enc-date', erreursForm.receivedOn)}
                />
              </Champ>
              <Champ id="enc-moyen" label="Moyen de règlement" requis erreur={erreursForm.method}>
                <select
                  id="enc-moyen"
                  value={form.method}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      method: e.target.value as FormulaireEncaissement['method'],
                    }))
                  }
                  className={CHAMP}
                  {...aria('enc-moyen', erreursForm.method)}
                >
                  <option value="">Choisir…</option>
                  {RECEIPT_METHODS.map((m) => (
                    <option key={m.valeur} value={m.valeur}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Champ>
              {form.lignes.length > 1 ? (
                <Champ
                  id="enc-total"
                  label={`Montant reçu (${form.currency})`}
                  aide="Égal à la somme des montants imputés : le serveur le vérifie."
                  requis
                  erreur={erreursForm.total}
                >
                  <input
                    id="enc-total"
                    inputMode="decimal"
                    value={form.total}
                    onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
                    className={CHAMP}
                    {...aria('enc-total', erreursForm.total, true)}
                  />
                </Champ>
              ) : null}
              <Champ
                id="enc-ref"
                label="Référence"
                aide="N° de virement, de chèque ou de transaction."
              >
                <input
                  id="enc-ref"
                  value={form.reference}
                  maxLength={100}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  className={CHAMP}
                  {...aria('enc-ref', undefined, true)}
                />
              </Champ>
            </div>
            {message ? (
              <p role="status" className="text-sm">
                {message}
              </p>
            ) : null}
            <button type="submit" className={`${BOUTON} self-start`} disabled={envoi}>
              {envoi ? 'Enregistrement…' : 'Enregistrer l’encaissement'}
            </button>
          </form>
        </section>
      ) : message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}

      <section aria-labelledby="recus-titre" className="flex flex-col gap-3">
        <h2 id="recus-titre" className="font-display text-lg font-bold tracking-tight">
          Encaissements enregistrés
        </h2>
        {recus.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucun encaissement pour l’instant.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {recus.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono font-semibold">
                      {formatMontant(r.amount, r.currency)}
                    </span>
                    <span>{libelleMoyen(r.method)}</span>
                    <span className="text-[var(--foreground-muted)]">
                      {libelleJour(r.receivedOn)}
                    </span>
                    {r.status === 'cancelled' ? <Pastille ton="attention">Annulé</Pastille> : null}
                  </span>
                  {encaisser && r.status === 'recorded' ? (
                    <button
                      type="button"
                      className={BOUTON_DANGER}
                      onClick={() => setAnnulation({ id: r.id, motif: '' })}
                    >
                      Annuler
                    </button>
                  ) : null}
                </div>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {r.allocations
                    .map(
                      (a) => `${a.invoiceNumber ?? '—'} : ${formatMontant(a.amount, r.currency)}`,
                    )
                    .join(' · ')}
                  {r.reference ? ` · Réf. ${r.reference}` : ''}
                  {r.cancellation ? ` · Motif d’annulation : ${r.cancellation.reason}` : ''}
                </span>
                {annulation?.id === r.id ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Champ id={`motif-${r.id}`} label="Motif de l’annulation" requis>
                      <input
                        id={`motif-${r.id}`}
                        value={annulation.motif}
                        maxLength={500}
                        onChange={(e) => setAnnulation({ id: r.id, motif: e.target.value })}
                        className={CHAMP}
                      />
                    </Champ>
                    <button
                      type="button"
                      className={BOUTON_DANGER}
                      disabled={envoi || annulation.motif.trim().length < 3}
                      onClick={() => void annuler()}
                    >
                      Confirmer l’annulation
                    </button>
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      onClick={() => setAnnulation(null)}
                    >
                      Garder
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="totaux-titre" className="flex flex-col gap-3">
        <h2 id="totaux-titre" className="font-display text-lg font-bold tracking-tight">
          Encaissé par mois
        </h2>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Par mois de réception et par devise, sans conversion. Ces montants n’alimentent pas encore
          la trésorerie du plan (décision en attente).
        </p>
        {totaux && totaux.months.length > 0 ? (
          <table className="w-full max-w-xl text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--foreground-muted)]">
                <th className="py-1 font-medium">Mois</th>
                <th className="py-1 font-medium">Devise</th>
                <th className="py-1 text-right font-medium">Encaissé</th>
                <th className="py-1 text-right font-medium">Nombre</th>
              </tr>
            </thead>
            <tbody>
              {totaux.months.map((m) => (
                <tr key={`${m.month}-${m.currency}`} className="border-t border-[var(--border)]">
                  <td className="py-1">{libelleMois(m.month)}</td>
                  <td className="py-1">{m.currency}</td>
                  <td className="py-1 text-right font-mono">
                    {formatMontant(m.total, m.currency)}
                  </td>
                  <td className="py-1 text-right">{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">Rien d’encaissé pour l’instant.</p>
        )}
      </section>

      <BridgePanel />
    </div>
  );
}
