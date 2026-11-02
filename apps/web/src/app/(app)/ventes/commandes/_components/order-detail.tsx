'use client';

// Fiche d'une commande client — ADR-0050 § 9, lot V7 : lignes, reste à facturer (moteur),
// acomptes, factures liées, pièce du client. Préparer une facture crée un BROUILLON et
// l'ouvre : « Émettre » reste dans l'écran des factures (`sales.invoice`).

import { Modal, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import { salesContractsApi, type SalesOrderView } from '@/lib/api-sales-contracts';

import {
  Alerte,
  BOUTON,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Pastille,
} from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { useAccesVentes } from '../../_components/sales-access';
import { formatJour } from '../../devis/_components/quote-model';
import { formatQuantite } from '../../factures/_components/invoice-model';
import {
  COMMANDES_BASE,
  CONTRATS_BASE,
  lienFacture,
  messageEngagement,
  peutPreparerBrouillon,
  peutPreparerEngagement,
  phrasesAvertissements,
} from '../../contrats/_components/contract-model';
import {
  FacturesLiees,
  FenetreConfirmation,
  FenetreMotif,
  ListePieces,
  SectionAcomptes,
} from '../../contrats/_components/engagement-ui';

import { FenetreCommande } from './order-form';
import {
  FACTURATION_COMMANDE_LABELS,
  preparerFacturation,
  quantitesProposees,
  tonCommande,
} from './order-model';

type Fenetre = null | 'modifier' | 'confirmer' | 'clore' | 'annuler' | 'supprimer' | 'facturer';

function Section({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4">
      <h3 className="text-sm font-semibold">{titre}</h3>
      {children}
    </section>
  );
}

export function OrderDetail({ orderId }: { orderId: string }): React.ReactElement {
  const router = useRouter();
  const { actions } = useAccesVentes();
  const preparer = peutPreparerEngagement(actions);
  const brouillon = peutPreparerBrouillon(actions);
  const [vue, setVue] = useState<SalesOrderView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string[]>([]);
  const [fenetre, setFenetre] = useState<Fenetre>(null);
  const [cleAcomptes, setCleAcomptes] = useState(0);

  const charger = useCallback(() => {
    salesContractsApi
      .getOrder(orderId)
      .then((v) => {
        setVue(v);
        setErreur(null);
      })
      .catch((err) => setErreur(messageEngagement(err, 'Commande illisible.')));
  }, [orderId]);

  useEffect(() => charger(), [charger]);

  if (vue === null) {
    return erreur ? (
      <Alerte>
        <p>{erreur}</p>
      </Alerte>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement de la commande…
      </p>
    );
  }

  const a = vue.actions;
  const totaux = vue.documentAmounts.calculation.totals;
  const resteParLigne = new Map((vue.invoicing?.lines ?? []).map((l) => [l.lineRef, l]));

  return (
    <section className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link href={COMMANDES_BASE} className="text-sm underline underline-offset-2">
          ← Toutes les commandes
        </Link>
        <p className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
          Commande client — pièce interne, non valable comme facture
        </p>
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          <span className="font-mono">{vue.number}</span>
          <Pastille ton={tonCommande(vue.status, vue.invoicingStatus)}>{vue.statusLabel}</Pastille>
          {vue.invoicing && vue.status !== 'draft' ? (
            <Pastille ton="neutre">{FACTURATION_COMMANDE_LABELS[vue.invoicing.status]}</Pastille>
          ) : null}
        </h2>
        <p className="text-sm">
          {vue.customerName ?? 'Client'} · commandée le {formatJour(vue.orderedOn)}
          {vue.customerReference ? ` · référence du client ${vue.customerReference}` : ''}
          {vue.requestedDeliveryDate
            ? ` · livraison souhaitée le ${formatJour(vue.requestedDeliveryDate)}`
            : ''}
        </p>
        {vue.source?.kind === 'quote' ? (
          <p className="text-sm">
            Issue du{' '}
            <Link
              href={`/ventes/devis/${encodeURIComponent(vue.source.quoteId)}`}
              className="underline underline-offset-2"
            >
              devis (version {vue.source.quoteVersion})
            </Link>
          </p>
        ) : vue.source?.kind === 'contract' ? (
          <p className="text-sm">
            Issue du{' '}
            <Link
              href={`${CONTRATS_BASE}/${encodeURIComponent(vue.source.contractId)}`}
              className="underline underline-offset-2"
            >
              contrat
            </Link>
          </p>
        ) : null}
      </header>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {info.length > 0 ? (
        <ul role="status" className="list-disc pl-5 text-sm">
          {info.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {vue.warnings.length > 0 ? (
        <ul className="list-disc rounded-md border border-[var(--warn)]/50 p-3 pl-8 text-sm">
          {phrasesAvertissements(vue.warnings).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {preparer && a.edit ? (
          <button type="button" className={BOUTON_PETIT} onClick={() => setFenetre('modifier')}>
            Modifier le brouillon
          </button>
        ) : null}
        {preparer && a.confirm ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={vue.blockers.length > 0}
            onClick={() => setFenetre('confirmer')}
          >
            Confirmer la commande
          </button>
        ) : null}
        {brouillon && a.prepareInvoice ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            onClick={() => setFenetre('facturer')}
          >
            Préparer une facture
          </button>
        ) : null}
        {preparer && a.close ? (
          <button type="button" className={BOUTON_PETIT} onClick={() => setFenetre('clore')}>
            {a.closeSuggested ? 'Clore (tout est facturé)' : 'Clore'}
          </button>
        ) : null}
        {preparer && a.cancel ? (
          <button type="button" className={BOUTON_DANGER} onClick={() => setFenetre('annuler')}>
            Annuler la commande
          </button>
        ) : null}
        {preparer && a.delete ? (
          <button type="button" className={BOUTON_DANGER} onClick={() => setFenetre('supprimer')}>
            Supprimer le brouillon
          </button>
        ) : null}
      </div>

      {vue.blockers.length > 0 ? (
        <div className="rounded-md border border-[var(--border)] p-3 text-sm">
          <p className="font-medium">Avant de la confirmer :</p>
          <ul className="mt-1 list-disc pl-5">
            {vue.blockers.map((b, i) => (
              <li key={`${b.code}-${i}`}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {vue.closure ? <p className="text-sm">Close : {vue.closure.reason}</p> : null}
      {vue.cancellation ? <p className="text-sm">Annulée : {vue.cancellation.reason}</p> : null}

      <Section titre="Lignes et reste à facturer">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Lignes de la commande</caption>
            <thead>
              <tr className="text-left text-[var(--foreground-muted)]">
                <th scope="col">Désignation</th>
                <th scope="col" className="text-right">
                  Commandé
                </th>
                <th scope="col" className="text-right">
                  Prix unitaire
                </th>
                <th scope="col" className="text-right">
                  Montant
                </th>
                <th scope="col" className="text-right">
                  Facturé
                </th>
                <th scope="col" className="text-right">
                  En brouillon
                </th>
                <th scope="col" className="text-right">
                  Reste à facturer
                </th>
              </tr>
            </thead>
            <tbody>
              {vue.lines.map((l) => {
                const r = resteParLigne.get(l.lineRef);
                return (
                  <tr key={l.lineRef} className="border-t border-[var(--border)]">
                    <td>
                      <span className="font-mono text-xs text-[var(--foreground-muted)]">
                        {l.lineRef}
                      </span>{' '}
                      {l.name} [{l.taxGroup}]
                    </td>
                    <td className="text-right font-mono">{formatQuantite(l.quantity)}</td>
                    <td className="text-right font-mono">
                      {formatMontant(l.unitPrice, vue.currency)}
                    </td>
                    <td className="text-right font-mono">
                      {l.amount ? formatMontant(l.amount, vue.currency) : '—'}
                    </td>
                    <td className="text-right font-mono">
                      {r ? formatQuantite(r.invoiced) : '—'}
                      {r && r.credited && r.credited !== '0' ? (
                        <span className="block text-xs text-[var(--foreground-muted)]">
                          avoirs : −{formatQuantite(r.credited)}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right font-mono">{r ? formatQuantite(r.inDraft) : '—'}</td>
                    <td className="text-right font-mono">
                      {r ? formatQuantite(r.remainingToInvoice) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totaux ? (
          <dl className="grid max-w-sm grid-cols-2 gap-1 self-end text-sm">
            <dt className="text-[var(--foreground-muted)]">Total TVA</dt>
            <dd className="text-right font-mono">{formatMontant(totaux.vatTotal, vue.currency)}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-mono font-semibold">
              {formatMontant(totaux.total, vue.currency)}
            </dd>
          </dl>
        ) : null}
        {vue.invoicing && vue.invoicing.issues.length > 0 ? (
          <ul className="list-disc pl-5 text-sm">
            {vue.invoicing.issues.map((i, n) => (
              <li key={`${i.code}-${n}`}>
                {i.code === 'UNMATCHED_LINE'
                  ? `Une ligne de facture${i.lineRef ? ` (${i.lineRef})` : ''} ne correspond plus à la commande (article ou prix changé) : elle n’est pas comptée.`
                  : `Point signalé par le calcul : ${i.code}${i.lineRef ? ` (${i.lineRef})` : ''}.`}{' '}
                {i.invoiceId ? (
                  <Link href={lienFacture(i.invoiceId)} className="underline underline-offset-2">
                    Ouvrir la facture
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {vue.notes ? <p className="text-sm">{vue.notes}</p> : null}
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section titre="Factures liées">
          <FacturesLiees factures={vue.invoices.filter((f) => !f.kind.endsWith('deposit'))} />
        </Section>
        <Section titre="Acomptes">
          <SectionAcomptes
            key={cleAcomptes}
            proprietaire="orders"
            id={vue.id}
            peutPreparer={brouillon}
            ouvert={vue.status === 'confirmed'}
            devise={vue.currency}
            onChange={charger}
          />
        </Section>
        <Section titre="Bon de commande du client">
          <ListePieces
            pieces={vue.files}
            lire={(p) => () => salesContractsApi.readOrderFile(vue.id, p.id, p.fileName)}
            televerser={
              preparer && a.addFile ? (f) => salesContractsApi.addOrderFile(vue.id, f) : null
            }
            libelleAjout="Bon de commande du client"
            onAjoutee={charger}
          />
        </Section>
      </div>

      {fenetre === 'modifier' ? (
        <FenetreCommande
          vue={vue}
          onFermer={() => setFenetre(null)}
          onEnregistre={(v) => {
            setVue(v);
            setFenetre(null);
          }}
        />
      ) : null}
      {fenetre === 'confirmer' ? (
        <FenetreConfirmation
          titre="Confirmer la commande"
          bouton="Confirmer"
          onFermer={() => setFenetre(null)}
          onConfirmer={async () => {
            setVue(await salesContractsApi.confirmOrder(vue.id, vue.revision));
            setFenetre(null);
            setCleAcomptes((n) => n + 1);
          }}
        >
          <p>
            Les lignes et les prix seront figés. Vous pourrez ensuite préparer factures et acomptes.
          </p>
        </FenetreConfirmation>
      ) : null}
      {fenetre === 'clore' ? (
        <FenetreMotif
          titre="Clore la commande"
          description={
            a.closeSuggested
              ? 'Tout est facturé : la commande peut être close.'
              : 'Le reliquat non facturé sera abandonné. Indiquez pourquoi.'
          }
          bouton="Clore"
          onFermer={() => setFenetre(null)}
          onConfirmer={async (motif) => {
            setVue(await salesContractsApi.closeOrder(vue.id, vue.revision, motif));
            setFenetre(null);
          }}
        />
      ) : null}
      {fenetre === 'annuler' ? (
        <FenetreMotif
          titre="Annuler la commande"
          bouton="Annuler la commande"
          danger
          onFermer={() => setFenetre(null)}
          onConfirmer={async (motif) => {
            setVue(await salesContractsApi.cancelOrder(vue.id, vue.revision, motif));
            setFenetre(null);
          }}
        />
      ) : null}
      {fenetre === 'supprimer' ? (
        <FenetreConfirmation
          titre="Supprimer le brouillon de commande"
          bouton="Supprimer"
          onFermer={() => setFenetre(null)}
          onConfirmer={async () => {
            await salesContractsApi.deleteOrder(vue.id);
            router.push(COMMANDES_BASE);
          }}
        >
          <p>Le brouillon {vue.number} sera supprimé. Son numéro ne sera pas réattribué.</p>
        </FenetreConfirmation>
      ) : null}
      {fenetre === 'facturer' ? (
        <FenetreFacturer
          vue={vue}
          onFermer={() => setFenetre(null)}
          onPrepare={(r) => {
            setInfo(phrasesAvertissements(r.warnings));
            router.push(lienFacture(r.invoiceId));
          }}
        />
      ) : null}
    </section>
  );
}

function FenetreFacturer({
  vue,
  onFermer,
  onPrepare,
}: {
  vue: SalesOrderView;
  onFermer: () => void;
  onPrepare: (r: { invoiceId: string; warnings: { message: string }[] }) => void;
}): React.ReactElement {
  const id = useId();
  const [type, setType] = useState<'FV' | 'EV'>('FV');
  const [quantites, setQuantites] = useState<Record<string, string>>(() =>
    quantitesProposees(vue.invoicing),
  );
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [avert, setAvert] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function preparer(): Promise<void> {
    const prep = preparerFacturation({
      expectedRevision: vue.revision,
      type,
      quantites,
      invoicing: vue.invoicing,
    });
    if (!prep.ok) {
      setChamps(prep.champs);
      return;
    }
    setChamps({});
    setAvert(prep.avertissements);
    setEnvoi(true);
    setErreur(null);
    try {
      onPrepare(await salesContractsApi.prepareOrderInvoice(vue.id, prep.corps));
    } catch (err) {
      setErreur(messageEngagement(err, 'La facture n’a pas pu être préparée.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={`Préparer une facture — ${vue.number}`}
      description="Un brouillon de facture est créé aux prix de la commande, puis ouvert. Vous l’émettez depuis l’écran des factures."
      size="lg"
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi}
            onClick={() => void preparer()}
          >
            {envoi ? 'Préparation…' : 'Préparer le brouillon'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {champs['lines'] ? <p className="text-sm text-[var(--danger)]">{champs['lines']}</p> : null}
        {avert.length > 0 ? (
          <ul className="list-disc pl-5 text-sm">
            {avert.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${id}-type`}>
          Type de facture
          <select
            id={`${id}-type`}
            value={type}
            onChange={(e) => setType(e.target.value as 'FV' | 'EV')}
            className={CHAMP}
          >
            <option value="FV">Facture de vente (FV)</option>
            <option value="EV">Facture de vente à l’export (EV)</option>
          </select>
        </label>
        <table className="w-full text-sm">
          <caption className="sr-only">Quantités à facturer</caption>
          <thead>
            <tr className="text-left text-[var(--foreground-muted)]">
              <th scope="col">Ligne</th>
              <th scope="col" className="text-right">
                Reste à préparer
              </th>
              <th scope="col" className="text-right">
                À facturer
              </th>
            </tr>
          </thead>
          <tbody>
            {vue.lines.map((l) => {
              const reste = vue.invoicing?.lines.find((r) => r.lineRef === l.lineRef);
              return (
                <tr key={l.lineRef} className="border-t border-[var(--border)]">
                  <td>
                    {l.lineRef} — {l.name}
                  </td>
                  <td className="text-right font-mono">
                    {reste ? formatQuantite(reste.remainingToPrepare) : '—'}
                  </td>
                  <td className="text-right">
                    <input
                      aria-label={`Quantité à facturer — ${l.name}`}
                      inputMode="decimal"
                      value={quantites[l.lineRef] ?? ''}
                      onChange={(e) => setQuantites((q) => ({ ...q, [l.lineRef]: e.target.value }))}
                      className={`${CHAMP} max-w-[8rem] text-right`}
                      aria-invalid={champs[l.lineRef] ? true : undefined}
                    />
                    {champs[l.lineRef] ? (
                      <span className="block text-xs text-[var(--danger)]">
                        {champs[l.lineRef]}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
