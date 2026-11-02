'use client';

// Factures de l'abonnement et fiche de facturation (ADR-0047, décisions n° 6 et n° 8).
//
// L'abonné voit et télécharge SES factures (et avoirs), émises par Go freelance SARLU à
// chaque paiement confirmé. La fiche de facturation dit ce que portera la prochaine
// facture : raison sociale obligatoire, NIF et adresse facultatifs ; à défaut, la fiche
// fiscale de l'organisation. Aucun montant n'est calculé ici : tout vient de l'API.

import { useCallback, useEffect, useState } from 'react';

import { api, type SubscriptionBillingProfileView, type SubscriptionInvoiceView } from '@/lib/api';

import { estRefusAutorisation, formatCents, formatDate, messageRefus } from './subscription-model';

const CHAMP = 'rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const BOUTON =
  'inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-50';

const SOURCES: Record<SubscriptionBillingProfileView['effective']['source'], string> = {
  billing_profile: 'votre fiche de facturation',
  fiscal_profile: 'la fiche fiscale de l’organisation',
  organization: 'le nom de l’organisation',
};

export function SubscriptionInvoices(): React.ReactElement | null {
  const [factures, setFactures] = useState<SubscriptionInvoiceView[] | null>(null);
  const [fiche, setFiche] = useState<SubscriptionBillingProfileView | null>(null);
  const [refuse, setRefuse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    try {
      const [f, p] = await Promise.all([
        api.listSubscriptionInvoices(),
        api.getSubscriptionBillingProfile(),
      ]);
      setFactures(f.invoices);
      setFiche(p);
      setErreur(null);
    } catch (err) {
      if (estRefusAutorisation(err)) setRefuse(true);
      else setErreur(messageRefus(err, 'Impossible de charger vos factures.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (refuse) return null;

  async function telecharger(id: string): Promise<void> {
    try {
      const { blob, filename } = await api.downloadSubscriptionInvoice(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErreur(messageRefus(err, 'Le téléchargement a échoué.'));
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">Vos factures</h2>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Une facture est émise par Go freelance SARLU à chaque paiement confirmé, dans la devise
          payée, TVA 16 % comprise. Elle n’est pas encore normalisée DGI : la normalisation suivra
          l’homologation du logiciel.
        </p>
        {erreur ? <p className="text-sm text-[var(--danger)]">{erreur}</p> : null}
        {factures === null ? (
          <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
        ) : factures.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucune facture pour le moment.</p>
        ) : (
          <table className="w-full max-w-3xl text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-[var(--foreground-muted)] uppercase">
                <th className="py-2">Numéro</th>
                <th>Date</th>
                <th>Période</th>
                <th className="text-right">HT</th>
                <th className="text-right">TVA</th>
                <th className="text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {factures.map((f) => (
                <tr key={f.id} className="border-t border-[var(--border)]">
                  <td className="fig py-2 font-mono">
                    {f.number}
                    {f.kind === 'credit_note' ? ' (avoir)' : ''}
                  </td>
                  <td>{formatDate(f.issuedAt)}</td>
                  <td>
                    {f.periodStart && f.periodEnd
                      ? `${formatDate(f.periodStart)} – ${formatDate(f.periodEnd)}`
                      : '—'}
                  </td>
                  <td className="fig text-right">
                    {f.exclTaxCents === null ? '—' : formatCents(f.exclTaxCents, f.currency)}
                  </td>
                  <td className="fig text-right">
                    {f.taxCents === null ? '—' : formatCents(f.taxCents, f.currency)}
                  </td>
                  <td className="fig text-right">
                    {f.totalCents === null ? '—' : formatCents(f.totalCents, f.currency)}
                  </td>
                  <td className="text-right">
                    <button type="button" className={BOUTON} onClick={() => void telecharger(f.id)}>
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {fiche ? <FicheFacturation fiche={fiche} onEnregistree={setFiche} /> : null}
    </div>
  );
}

function FicheFacturation({
  fiche,
  onEnregistree,
}: {
  fiche: SubscriptionBillingProfileView;
  onEnregistree: (f: SubscriptionBillingProfileView) => void;
}): React.ReactElement {
  const depart = fiche.profile ?? fiche.effective;
  const [raison, setRaison] = useState(depart.legalName);
  const [nif, setNif] = useState(depart.nif ?? '');
  const [adresse, setAdresse] = useState(depart.address ?? '');
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setMessage(null);
    try {
      const r = await api.saveSubscriptionBillingProfile({
        legalName: raison.trim(),
        nif: nif.trim() || null,
        address: adresse.trim() || null,
      });
      onEnregistree(r);
      setMessage({
        ok: true,
        texte: 'Fiche enregistrée : elle vaut pour les prochaines factures.',
      });
    } catch (err) {
      setMessage({ ok: false, texte: messageRefus(err, 'La fiche n’a pas pu être enregistrée.') });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold tracking-tight">Informations de facturation</h2>
      <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
        La prochaine facture sera établie au nom de <strong>{fiche.effective.legalName}</strong>
        {fiche.effective.nif ? ` (NIF ${fiche.effective.nif})` : ''}, d’après{' '}
        {SOURCES[fiche.effective.source]}. Raison sociale obligatoire ; NIF et adresse facultatifs.
        Sans NIF, la facture est établie au type « personne physique » (règle DGI).
      </p>
      <form onSubmit={(e) => void enregistrer(e)} className="flex max-w-xl flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>Raison sociale</span>
          <input
            required
            maxLength={200}
            value={raison}
            onChange={(e) => setRaison(e.target.value)}
            className={CHAMP}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>NIF (facultatif)</span>
          <input
            maxLength={40}
            value={nif}
            onChange={(e) => setNif(e.target.value)}
            className={CHAMP}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Adresse (facultative)</span>
          <input
            maxLength={255}
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
            className={CHAMP}
          />
        </label>
        <div>
          <button type="submit" disabled={envoi || raison.trim() === ''} className={BOUTON}>
            {envoi ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
        {message ? (
          <p className={`text-sm ${message.ok ? '' : 'text-[var(--danger)]'}`}>{message.texte}</p>
        ) : null}
      </form>
    </section>
  );
}
