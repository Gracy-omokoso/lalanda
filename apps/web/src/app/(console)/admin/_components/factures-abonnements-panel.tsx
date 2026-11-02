'use client';

// Factures des abonnements Lalanda, sous Abonnements (ADR-0047, décision de la
// dirigeante du 3 nov. 2026).
//
// Trois volets : l'ORGANISATION VENDEUSE (celle de Go freelance SARLU, désignée ici,
// jamais créée), les PAIEMENTS SANS FACTURE (« émettre la facture », un par un, avec
// motif — rien n'est régularisé automatiquement), et les FACTURES ÉMISES (PDF, avoir sur
// remboursement : motif, puis approbation par une seconde personne). Les factures sont
// émises sans normalisation DGI tant que l'homologation n'est pas obtenue.

import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type AdminSubscriptionInvoiceView,
  type AdminSubscriptionSellerView,
  type AdminUninvoicedPaymentView,
} from '@/lib/api';

import { formaterMontant, messageErreurAbonnements } from './abonnements-model';
import { Bandeau, Pastille, Vide } from './admin-chrome';
import { exigeReauth, formaterDateHeure } from './admin-model';
import {
  gestesFacture,
  LIBELLES_ETAT_AVOIR,
  LIBELLES_ETAT_FACTURE,
  libelleFournisseur,
  motifValide,
} from './factures-abonnements-model';

const ETIQUETTE =
  'font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]';
const CHAMP = 'rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const BOUTON =
  'rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40';

type Retour = { ton: 'succes' | 'echec'; texte: string } | null;

function Titre({ children, aide }: { children: string; aide: string }): React.ReactElement {
  return (
    <header className="flex flex-col gap-1">
      <h2 className="font-display text-lg font-bold tracking-tight">{children}</h2>
      <p className="max-w-3xl text-sm text-[var(--foreground-muted)]">{aide}</p>
    </header>
  );
}

function montant(cents: number | null, devise: string | null): string {
  return cents === null ? '—' : formaterMontant(cents, devise ?? 'USD');
}

async function telecharger(id: string, kind: 'invoice' | 'credit_note'): Promise<void> {
  const { blob, filename } = await api.downloadAdminSubscriptionInvoice(id, kind);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FacturesAbonnements({
  peutEmettre,
  peutDesigner,
  onReauth,
}: {
  peutEmettre: boolean;
  peutDesigner: boolean;
  onReauth: () => void;
}): React.ReactElement {
  const [vendeur, setVendeur] = useState<AdminSubscriptionSellerView | null>(null);
  const [sansFacture, setSansFacture] = useState<AdminUninvoicedPaymentView[] | null>(null);
  const [factures, setFactures] = useState<AdminSubscriptionInvoiceView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    try {
      const [v, p, f] = await Promise.all([
        api.getAdminSubscriptionSeller(),
        api.listAdminUninvoicedPayments(),
        api.listAdminSubscriptionInvoices(),
      ]);
      setVendeur(v);
      setSansFacture(p.payments);
      setFactures(f.invoices);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreurAbonnements(err, 'Impossible de charger les factures d’abonnement.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="factures-abonnements">
      <Titre aide="Chaque paiement confirmé produit une facture émise par l’organisation vendeuse (Go freelance SARLU), dans la devise payée, TVA 16 % (groupe B), sans normalisation DGI tant que l’homologation n’est pas obtenue. Décision de la dirigeante du 3 nov. 2026, à revoir avec l’expert-comptable.">
        Factures des abonnements
      </Titre>
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
      {vendeur ? (
        <Vendeur
          vendeur={vendeur}
          peutDesigner={peutDesigner}
          onFait={charger}
          onReauth={onReauth}
        />
      ) : null}
      <div className="flex flex-col gap-3">
        <h3 className="font-display font-bold">Paiements sans facture</h3>
        {sansFacture === null ? null : sansFacture.length === 0 ? (
          <Vide>Tous les paiements confirmés ont leur facture.</Vide>
        ) : (
          <ul className="flex flex-col gap-3">
            {sansFacture.map((p) => (
              <PaiementSansFacture
                key={`${p.provider}:${p.eventId}`}
                paiement={p}
                peutEmettre={peutEmettre}
                onFait={charger}
                onReauth={onReauth}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="font-display font-bold">Factures émises</h3>
        {factures === null ? null : factures.filter((f) => f.status === 'issued').length === 0 ? (
          <Vide>Aucune facture d’abonnement émise.</Vide>
        ) : (
          <ul className="flex flex-col gap-3">
            {factures
              .filter((f) => f.status === 'issued')
              .map((f) => (
                <LigneFacture
                  key={f.id}
                  facture={f}
                  peutEmettre={peutEmettre}
                  onFait={charger}
                  onReauth={onReauth}
                />
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Vendeur({
  vendeur,
  peutDesigner,
  onFait,
  onReauth,
}: {
  vendeur: AdminSubscriptionSellerView;
  peutDesigner: boolean;
  onFait: () => Promise<void>;
  onReauth: () => void;
}): React.ReactElement {
  const [organisation, setOrganisation] = useState('');
  const [motif, setMotif] = useState('');
  const [retour, setRetour] = useState<Retour>(null);
  const [envoi, setEnvoi] = useState(false);

  async function designer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setRetour(null);
    try {
      await api.designateAdminSubscriptionSeller({
        organizationId: organisation.trim(),
        reason: motif.trim(),
      });
      setRetour({ ton: 'succes', texte: 'Organisation vendeuse désignée.' });
      setOrganisation('');
      setMotif('');
      await onFait();
    } catch (err) {
      setRetour({ ton: 'echec', texte: messageErreurAbonnements(err, 'La désignation a échoué.') });
      if (exigeReauth(err)) onReauth();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
      <h3 className="font-display font-bold">Organisation vendeuse</h3>
      {vendeur.sellerOrganizationId ? (
        <p className="text-sm">
          {vendeur.organizationName ?? vendeur.sellerOrganizationId}{' '}
          <span className="text-[var(--foreground-muted)]">
            — désignée le {vendeur.designatedAt ? formaterDateHeure(vendeur.designatedAt) : '—'}
          </span>
        </p>
      ) : null}
      {vendeur.readiness.ready ? (
        <Bandeau ton="succes">Prête à émettre : la facture reprend sa fiche fiscale.</Bandeau>
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-[var(--danger)]">
          {vendeur.readiness.blockers.map((b) => (
            <li key={b.code}>{b.message}</li>
          ))}
        </ul>
      )}
      {peutDesigner ? (
        <form onSubmit={(e) => void designer(e)} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className={ETIQUETTE}>Identifiant de l’organisation existante</span>
            <input
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
              className={`${CHAMP} max-w-md font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className={ETIQUETTE}>Motif (10 caractères minimum)</span>
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              maxLength={500}
              className={`${CHAMP} max-w-xl`}
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={envoi || organisation.trim() === '' || !motifValide(motif)}
              className={BOUTON}
            >
              Désigner
            </button>
          </div>
        </form>
      ) : null}
      {retour ? <Bandeau ton={retour.ton}>{retour.texte}</Bandeau> : null}
    </div>
  );
}

function PaiementSansFacture({
  paiement,
  peutEmettre,
  onFait,
  onReauth,
}: {
  paiement: AdminUninvoicedPaymentView;
  peutEmettre: boolean;
  onFait: () => Promise<void>;
  onReauth: () => void;
}): React.ReactElement {
  const [motif, setMotif] = useState('');
  const [retour, setRetour] = useState<Retour>(null);
  const [envoi, setEnvoi] = useState(false);

  async function emettre(): Promise<void> {
    setEnvoi(true);
    setRetour(null);
    try {
      const r = await api.emitAdminSubscriptionInvoice({
        provider: paiement.provider,
        eventId: paiement.eventId,
        reason: motif.trim(),
      });
      setRetour(
        r.invoice.status === 'issued'
          ? { ton: 'succes', texte: `Facture ${r.invoice.invoiceNumber ?? ''} émise.` }
          : {
              ton: 'echec',
              texte: r.invoice.lastError?.message ?? 'La facture n’a pas pu être émise.',
            },
      );
      await onFait();
    } catch (err) {
      setRetour({ ton: 'echec', texte: messageErreurAbonnements(err, 'L’émission a échoué.') });
      if (exigeReauth(err)) onReauth();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <strong>{paiement.organizationName ?? paiement.organizationId}</strong>
        <span>{libelleFournisseur(paiement.provider)}</span>
        <span className="font-mono">{paiement.reference ?? paiement.eventId}</span>
        <span className="fig">{montant(paiement.amountCents, paiement.currency)}</span>
        <span className="text-[var(--foreground-muted)]">{formaterDateHeure(paiement.paidAt)}</span>
        {paiement.attempt ? (
          <Pastille ton="attention">Tentative : {paiement.attempt.status}</Pastille>
        ) : null}
      </div>
      {paiement.attempt?.lastError ? (
        <p className="text-[var(--danger)]">{paiement.attempt.lastError.message}</p>
      ) : null}
      {peutEmettre ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={ETIQUETTE}>Motif (10 caractères minimum)</span>
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              maxLength={500}
              className={`${CHAMP} w-80`}
            />
          </label>
          <button
            type="button"
            disabled={envoi || !motifValide(motif)}
            onClick={() => void emettre()}
            className={BOUTON}
          >
            Émettre la facture
          </button>
        </div>
      ) : null}
      {retour ? <Bandeau ton={retour.ton}>{retour.texte}</Bandeau> : null}
    </li>
  );
}

function LigneFacture({
  facture,
  peutEmettre,
  onFait,
  onReauth,
}: {
  facture: AdminSubscriptionInvoiceView;
  peutEmettre: boolean;
  onFait: () => Promise<void>;
  onReauth: () => void;
}): React.ReactElement {
  const [motif, setMotif] = useState('');
  const [retour, setRetour] = useState<Retour>(null);
  const [envoi, setEnvoi] = useState(false);
  const gestes = gestesFacture(facture, null);
  const cn = facture.creditNote;

  async function agir(geste: 'demander' | 'approuver'): Promise<void> {
    setEnvoi(true);
    setRetour(null);
    try {
      const r =
        geste === 'demander'
          ? await api.requestAdminSubscriptionCreditNote(facture.id, { reason: motif.trim() })
          : await api.approveAdminSubscriptionCreditNote(facture.id);
      const etat = r.creditNote?.status;
      setRetour({
        ton: etat === 'failed' ? 'echec' : 'succes',
        texte:
          etat === 'issued'
            ? `Avoir ${r.creditNote?.number ?? ''} émis${r.creditNote?.soleApprover ? ' (seul détenteur du droit, marqué au journal)' : ''}.`
            : etat === 'requested'
              ? 'Avoir demandé : une seconde personne doit l’approuver.'
              : (r.creditNote?.lastError?.message ?? 'L’avoir n’a pas pu être émis.'),
      });
      await onFait();
    } catch (err) {
      setRetour({ ton: 'echec', texte: messageErreurAbonnements(err, 'Le geste a échoué.') });
      if (exigeReauth(err)) onReauth();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="font-mono">{facture.invoiceNumber}</strong>
        <span>{facture.organizationName ?? facture.organizationId}</span>
        <span className="fig">{montant(facture.amountCents, facture.currency)}</span>
        <span className="text-[var(--foreground-muted)]">
          {facture.issuedAt ? formaterDateHeure(facture.issuedAt) : '—'}
        </span>
        <Pastille ton="neutre">{LIBELLES_ETAT_FACTURE[facture.status]}</Pastille>
        {facture.origin === 'console' ? (
          <Pastille ton="attention">Émise depuis la console</Pastille>
        ) : null}
        {cn ? <Pastille ton="attention">{LIBELLES_ETAT_AVOIR[cn.status]}</Pastille> : null}
        <button
          type="button"
          className={BOUTON}
          onClick={() => void telecharger(facture.id, 'invoice')}
        >
          PDF
        </button>
        {cn?.status === 'issued' ? (
          <button
            type="button"
            className={BOUTON}
            onClick={() => void telecharger(facture.id, 'credit_note')}
          >
            PDF de l’avoir {cn.number}
          </button>
        ) : null}
      </div>
      {cn ? <p className="text-[var(--foreground-muted)]">Motif de l’avoir : {cn.reason}</p> : null}
      {peutEmettre && gestes.demanderAvoir ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={ETIQUETTE}>Motif du remboursement (10 caractères minimum)</span>
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              maxLength={500}
              className={`${CHAMP} w-80`}
            />
          </label>
          <button
            type="button"
            disabled={envoi || !motifValide(motif)}
            onClick={() => void agir('demander')}
            className={BOUTON}
          >
            Demander un avoir
          </button>
        </div>
      ) : null}
      {peutEmettre && gestes.approuverAvoir ? (
        <div>
          <button
            type="button"
            disabled={envoi}
            onClick={() => void agir('approuver')}
            className={BOUTON}
          >
            Approuver l’avoir (seconde personne)
          </button>
        </div>
      ) : null}
      {retour ? <Bandeau ton={retour.ton}>{retour.texte}</Bandeau> : null}
    </li>
  );
}
