'use client';

// Fiche d'une facture fournisseur — ADR-0044 § 2.5, § 3.5, § 5 et § 8 : rapprochement
// ligne à ligne (écarts bloquants ou d'information, en français clair), validation,
// forçage motivé par un approbateur, litige, avoir, pièce jointe, paiements.
//
// Les gestes viennent de `actionsFacture` (droits servis par le serveur) ; l'API
// reste juge et ses refus s'affichent. Rien n'est calculé ici.

import { Badge, buttonClasses } from '@lalanda/ui';
import { Banknote, FileText, ListOrdered, Paperclip, Scale } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import {
  purchasesPayablesApi,
  type SupplierInvoiceVarianceView,
  type SupplierInvoiceView,
  type SupplierPaymentListItem,
} from '@/lib/api-purchases-payables';

import { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  ACHATS_BASE,
  formatInstantJour,
  formatJour,
  lienCommande,
  lienFacture,
  lienFournisseur,
  messageAchats,
  nomPersonne,
  peutGererAchats,
  peutPayerFournisseurs,
  statutDe,
} from './achats-model';
import { LIBELLES_MOYEN } from './a-payer-model';
import { DialogueMotif } from './dialogue-motif';
import { FenetreFacture } from './facture-formulaire';
import {
  LIBELLES_MODE,
  LIBELLES_RAPPROCHEMENT,
  LIBELLES_REGLEMENT,
  MENTION_TAXES_FACTURE,
  MENTION_TVA_DEDUCTIBLE,
  actionsFacture,
  ecartsAffiches,
  ecartsDuRefus,
  etatFacture,
  ligneEcart,
  natureFacture,
  phraseRapprochement,
  tonRapprochement,
  type ActionFacture,
  type IdActionFacture,
} from './factures-model';
import { FenetrePaiement } from './paiement-formulaire';
import { PieceJointe } from './piece-jointe';
import { formatQuantite } from './receptions-model';

type Dialogue = 'forcer' | 'litige' | 'lever-litige' | 'annuler' | 'avoir' | 'payer' | null;

function TableauEcarts({
  variances,
  f,
}: {
  variances: readonly SupplierInvoiceVarianceView[];
  f: SupplierInvoiceView;
}): React.ReactElement {
  const lignes = ecartsAffiches(variances, f.lines, f.currency);
  return (
    <ul className="flex flex-col gap-2">
      {lignes.map((e, i) => (
        <li
          key={`${e.code}-${i}`}
          className={`flex flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-sm ${
            e.bloquant ? 'border-[var(--danger)]/40' : 'border-[var(--border)]'
          }`}
        >
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={e.bloquant ? 'danger' : 'neutral'}>
              {e.bloquant ? 'Bloquant' : 'Information'}
            </Badge>
            <span className="font-medium">{e.titre}</span>
          </span>
          <span className="text-xs text-[var(--foreground-muted)]">{e.ligne}</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
            <span>Attendu : {e.attendu}</span>
            <span>Facturé ou constaté : {e.constate}</span>
            <span className="font-medium">Écart : {e.difference}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function BoutonGeste({
  a,
  occupe,
  onClic,
}: {
  a: ActionFacture;
  occupe: boolean;
  onClic: (id: IdActionFacture) => void;
}): React.ReactElement {
  const id = useId();
  const principal = a.id === 'valider' || a.id === 'payer';
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        className={principal ? buttonClasses('primary', 'sm') : BOUTON_PETIT}
        disabled={!a.actif || occupe}
        aria-describedby={a.raison ? `${id}-raison` : undefined}
        onClick={() => onClic(a.id)}
      >
        {a.libelle}
      </button>
      {a.raison ? (
        <span id={`${id}-raison`} className="max-w-xs text-xs text-[var(--foreground-muted)]">
          {a.raison}
        </span>
      ) : null}
    </span>
  );
}

export function FactureFiche({ invoiceId }: { invoiceId: string }): React.ReactElement {
  const router = useRouter();
  const { actions, membres, moi } = useAccesAchats();
  const [f, setF] = useState<SupplierInvoiceView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurGeste, setErreurGeste] = useState<string | null>(null);
  const [refusEcarts, setRefusEcarts] = useState<SupplierInvoiceVarianceView[] | null>(null);
  const [paiements, setPaiements] = useState<SupplierPaymentListItem[] | null>(null);
  const [erreurPaiements, setErreurPaiements] = useState<string | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(() => {
    purchasesPayablesApi
      .getInvoice(invoiceId)
      .then((v) => {
        setF(v);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageAchats(err, 'Facture illisible.')));
  }, [invoiceId]);

  useEffect(() => charger(), [charger]);

  // Paiements qui imputent CETTE facture (`GET /purchases/payments?invoiceId=`, lot P5).
  // Clé de rechargement : un paiement ne change pas la révision de la facture,
  // mais il change sa date de mise à jour — sans elle, la liste restait vide
  // juste après un paiement.
  const revision = f ? `${f.revision}:${f.updatedAt}` : undefined;
  const [aAnnuler, setAAnnuler] = useState<SupplierPaymentListItem | null>(null);
  useEffect(() => {
    if (revision === undefined) return;
    let annule = false;
    purchasesPayablesApi
      .listPayments({ invoiceId, limit: 100 })
      .then((p) => {
        if (!annule) {
          setPaiements(p.items);
          setErreurPaiements(null);
        }
      })
      .catch((err: unknown) => {
        if (annule) return;
        setPaiements(null);
        setErreurPaiements(
          statutDe(err) === 403
            ? 'Les paiements se lisent avec l’accès à la trésorerie.'
            : messageAchats(err, 'Paiements illisibles.'),
        );
      });
    return () => {
      annule = true;
    };
  }, [invoiceId, revision]);

  async function geste(id: IdActionFacture): Promise<void> {
    if (f === null) return;
    setErreurGeste(null);
    setRefusEcarts(null);
    if (id !== 'valider') {
      setDialogue(id);
      return;
    }
    setOccupe(true);
    try {
      setF(await purchasesPayablesApi.validateInvoice(f.id, f.revision));
    } catch (err) {
      setRefusEcarts(ecartsDuRefus(err));
      setErreurGeste(messageAchats(err, 'Validation impossible.'));
      charger();
    } finally {
      setOccupe(false);
    }
  }

  const retour = (
    <Link href={`${ACHATS_BASE}/factures`} className="text-sm underline underline-offset-2">
      ← Factures fournisseurs
    </Link>
  );

  if (f === null) {
    return (
      <section className="flex min-w-0 flex-col gap-5">
        {retour}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement de la facture…
          </p>
        )}
      </section>
    );
  }

  const etat = etatFacture(f);
  const gestes = actionsFacture(f, actions);
  const d = f.currency;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {retour}
      <Bandeau
        icone={FileText}
        titre={`${natureFacture(f)} ${f.internalNumber}`}
        sousTitre={`Réf. du fournisseur ${f.supplierReference} · du ${formatJour(f.invoiceDate)} · reçue le ${formatJour(f.receivedOn)}`}
        actions={
          <span className="flex flex-wrap gap-2">
            <Badge tone={etat.ton}>{etat.libelle}</Badge>
            {f.status !== 'cancelled' && f.kind === 'invoice' ? (
              <Badge tone={tonRapprochement(f.matchingStatus)}>
                {LIBELLES_RAPPROCHEMENT[f.matchingStatus]}
              </Badge>
            ) : null}
          </span>
        }
      >
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tuile
            libelle="Fournisseur"
            valeur={
              <Link
                href={lienFournisseur(f.supplierId)}
                className="break-words underline-offset-2 hover:underline"
              >
                {f.supplierName ?? 'Ouvrir la fiche'}
              </Link>
            }
          />
          <Tuile libelle="Total TTC" valeur={formatMontant(f.total, d)} />
          <Tuile
            libelle="Reste à payer"
            valeur={formatMontant(f.settlement.remaining, d)}
            detail={
              f.status === 'validated'
                ? LIBELLES_REGLEMENT[f.settlement.status]
                : 'Après validation'
            }
          />
          <Tuile libelle="Échéance" valeur={formatJour(f.dueDate)} />
        </dl>
        {gestes.length > 0 ? (
          <div className="flex flex-wrap items-start gap-2">
            {gestes.map((a) => (
              <BoutonGeste key={a.id} a={a} occupe={occupe} onClic={(id) => void geste(id)} />
            ))}
          </div>
        ) : null}
        {erreurGeste ? (
          <Alerte>
            <p>{erreurGeste}</p>
            {refusEcarts && refusEcarts.length > 0 ? (
              <TableauEcarts variances={refusEcarts} f={f} />
            ) : null}
          </Alerte>
        ) : null}
      </Bandeau>

      {f.cancellation ? (
        <Alerte>
          <p>
            Annulée le {formatInstantJour(f.cancellation.at)} par{' '}
            {nomPersonne(membres, f.cancellation.by, moi)} : {f.cancellation.reason}
          </p>
        </Alerte>
      ) : null}
      {f.dispute ? (
        <Alerte>
          <p>
            En litige depuis le {formatInstantJour(f.dispute.at)} (
            {nomPersonne(membres, f.dispute.by, moi)}) : {f.dispute.reason}. Le paiement est bloqué
            tant que le litige n’est pas levé.
          </p>
        </Alerte>
      ) : null}
      {f.forcedValidation ? (
        <p className="rounded-[var(--radius-md)] border border-[var(--warn)]/50 p-3 text-sm">
          Validée malgré l’écart par {nomPersonne(membres, f.forcedValidation.by, moi)} le{' '}
          {formatInstantJour(f.forcedValidation.at)}
          {f.forcedValidation.soleApprover ? ' (approbateur unique de l’organisation)' : ''} :{' '}
          {f.forcedValidation.reason}
        </p>
      ) : null}
      {f.creditedInvoiceId ? (
        <p className="text-sm">
          Avoir sur la facture{' '}
          <Link href={lienFacture(f.creditedInvoiceId)} className="underline underline-offset-2">
            d’origine
          </Link>
          .
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panneau
          titre="Rapprochement"
          icone={Scale}
          id="ff-rapprochement"
          className="lg:col-span-2"
        >
          <p className="text-sm">{LIBELLES_MODE[f.matching.mode]}</p>
          <p className="text-sm font-medium">{phraseRapprochement(f.matching)}</p>
          {f.matching.variances.length > 0 ? (
            <TableauEcarts variances={f.matching.variances} f={f} />
          ) : null}
          {f.matching.lines.length > 0 ? (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">Quantités par ligne de commande</caption>
                <thead>
                  <tr className="text-left text-xs text-[var(--foreground-muted)]">
                    <th className="px-4 py-1 font-medium sm:px-2">Ligne</th>
                    <th className="px-2 py-1 text-right font-medium">Commandé</th>
                    <th className="px-2 py-1 text-right font-medium">Reçu</th>
                    <th className="px-2 py-1 text-right font-medium">Déjà facturé</th>
                    <th className="px-4 py-1 text-right font-medium sm:px-2">Cette facture</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {f.matching.lines.map((l) => (
                    <tr key={l.orderLineId}>
                      <td className="px-4 py-2 break-words sm:px-2">
                        {ligneEcart(
                          { invoiceLineIndex: null, orderLineId: l.orderLineId },
                          f.lines,
                        )}
                        <span className="block text-xs text-[var(--foreground-muted)]">
                          {l.mode === 'three_way' ? 'Trois voies' : 'Deux voies'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatQuantite(l.ordered)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {l.received === null ? 'Sans réception' : formatQuantite(l.received)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatQuantite(l.invoicedBefore)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums sm:px-2">
                        {formatQuantite(l.invoicedNow)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {f.orderIds.length > 0 ? (
            <p className="flex flex-wrap gap-2 text-sm">
              Commande{f.orderIds.length > 1 ? 's' : ''} :
              {f.orderIds.map((o, i) => (
                <Link key={o} href={lienCommande(o)} className="underline underline-offset-2">
                  ouvrir la commande{f.orderIds.length > 1 ? ` ${i + 1}` : ''}
                </Link>
              ))}
            </p>
          ) : null}
        </Panneau>

        <Panneau titre="Pièce jointe" icone={Paperclip} id="ff-piece">
          <PieceJointe
            piece={f.attachment}
            peutJoindre={peutGererAchats(actions) && f.status !== 'cancelled'}
            manque="Facture sans pièce : joignez le PDF ou la photo de la facture reçue."
            telecharger={() => purchasesPayablesApi.downloadInvoiceAttachment(f.id)}
            envoyer={async (file) => {
              setF(await purchasesPayablesApi.uploadInvoiceAttachment(f.id, file));
            }}
            onEnvoyee={() => undefined}
          />
        </Panneau>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panneau
          titre="Lignes et montants"
          icone={ListOrdered}
          id="ff-lignes"
          className="lg:col-span-2"
        >
          {f.lines.length > 0 ? (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--foreground-muted)]">
                    <th className="px-4 py-1 font-medium sm:px-2">Désignation</th>
                    <th className="px-2 py-1 text-right font-medium">Quantité</th>
                    <th className="px-2 py-1 text-right font-medium">Prix unitaire HT</th>
                    <th className="px-4 py-1 text-right font-medium sm:px-2">Montant HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {f.lines.map((l, i) => (
                    <tr key={`${l.orderLineId ?? 'l'}-${i}`}>
                      <td className="px-4 py-2 break-words sm:px-2">
                        {l.label}
                        {l.orderLineId === null && f.orderIds.length > 0 ? (
                          <span className="block text-xs text-[var(--danger)]">Hors commande</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatQuantite(l.quantity)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                        {formatMontant(l.unitPrice, d)}
                        {l.discountPercent ? ` (−${l.discountPercent.replace('.', ',')} %)` : ''}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap sm:px-2">
                        {formatMontant(l.amount, d)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt>Sous-total HT</dt>
            <dd className="text-right tabular-nums">{formatMontant(f.subtotal, d)}</dd>
            {f.taxes.map((t) => (
              <div key={t.label} className="contents">
                <dt>{t.label}</dt>
                <dd className="text-right tabular-nums">{formatMontant(t.amount, d)}</dd>
              </div>
            ))}
            <dt className="font-semibold">Total TTC</dt>
            <dd className="text-right font-semibold tabular-nums">{formatMontant(f.total, d)}</dd>
          </dl>
          {f.taxes.length > 0 ? (
            <p className="text-xs text-[var(--foreground-muted)]">{MENTION_TAXES_FACTURE}</p>
          ) : null}
          {f.deductibleVat ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              TVA déductible déclarée : {formatMontant(f.deductibleVat, d)}.{' '}
              {MENTION_TVA_DEDUCTIBLE}
            </p>
          ) : null}
          {f.costAllocations.length > 0 ? (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-xs text-[var(--foreground-muted)]">Imputation</p>
              {f.costAllocations.map((c, i) => (
                <p key={`${c.category}-${i}`} className="flex justify-between gap-2">
                  <span>
                    {c.category}
                    {c.workProjectId ? ' · projet' : ''}
                  </span>
                  <span className="tabular-nums">{formatMontant(c.amount, d)}</span>
                </p>
              ))}
            </div>
          ) : null}
        </Panneau>

        <Panneau titre="Paiements" icone={Banknote} id="paiements">
          {f.status === 'validated' ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              <dt>Payé</dt>
              <dd className="text-right tabular-nums">{formatMontant(f.settlement.paid, d)}</dd>
              <dt>Avoirs</dt>
              <dd className="text-right tabular-nums">{formatMontant(f.settlement.credited, d)}</dd>
              <dt className="font-semibold">Reste à payer</dt>
              <dd className="text-right font-semibold tabular-nums">
                {formatMontant(f.settlement.remaining, d)}
              </dd>
            </dl>
          ) : (
            <PhraseSection>Une facture se paie une fois validée.</PhraseSection>
          )}
          {erreurPaiements ? (
            <PhraseSection>{erreurPaiements}</PhraseSection>
          ) : paiements === null ? null : paiements.length === 0 ? (
            <PhraseSection>Aucun paiement enregistré.</PhraseSection>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {paiements.map((p) => {
                const part = p.allocations.find((a) => a.invoiceId === f.id);
                return (
                  <li key={p.id} className="flex flex-col py-2">
                    <span className="flex justify-between gap-2">
                      <span className="font-medium">{p.number}</span>
                      <span className="tabular-nums">
                        {part ? formatMontant(part.amount, d) : formatMontant(p.amount, d)}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {formatJour(p.paidOn)} · {LIBELLES_MOYEN[p.method]}
                      {p.origin === 'linked_expense' ? ' · dépense rattachée' : ''}
                      {p.status === 'cancelled' ? ' · annulé' : ''}
                    </span>
                    {p.status === 'recorded' && peutPayerFournisseurs(actions) ? (
                      <button
                        type="button"
                        className={`${BOUTON_PETIT} mt-1 w-fit`}
                        onClick={() => setAAnnuler(p)}
                      >
                        Annuler ce paiement
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panneau>
      </div>

      {aAnnuler ? (
        <DialogueMotif
          titre={`Annuler le paiement ${aAnnuler.number}`}
          description="Les dépenses qu’il a créées dans la trésorerie sont annulées avec lui ; une dépense rattachée redevient une dépense directe."
          libelle="Motif de l’annulation"
          bouton="Annuler le paiement"
          motif="obligatoire"
          onFermer={() => setAAnnuler(null)}
          onValider={async (motif) => {
            const complet = await purchasesPayablesApi.getPayment(aAnnuler.id);
            await purchasesPayablesApi.cancelPayment(aAnnuler.id, {
              reason: motif,
              expectedRevision: complet.revision,
            });
            setAAnnuler(null);
            charger();
          }}
        />
      ) : null}
      {dialogue === 'forcer' ? (
        <DialogueMotif
          titre="Forcer la validation"
          description="La facture devient payable malgré l’écart. Le motif et les écarts sont gardés au journal."
          libelle="Motif du forçage"
          bouton="Forcer la validation"
          motif="obligatoire"
          onFermer={() => setDialogue(null)}
          onValider={async (motif) => {
            setF(
              await purchasesPayablesApi.forceValidateInvoice(f.id, {
                reason: motif,
                expectedRevision: f.revision,
              }),
            );
            setDialogue(null);
          }}
        >
          <p>
            Celui qui a saisi la facture ne la force pas lui-même, sauf s’il est l’unique
            approbateur de l’organisation.
          </p>
          <TableauEcarts variances={f.matching.variances.filter((v) => v.blocking)} f={f} />
        </DialogueMotif>
      ) : null}
      {dialogue === 'litige' ? (
        <DialogueMotif
          titre="Mettre la facture en litige"
          description="Le paiement est bloqué ; la facture reste visible dans l’échéancier, à part."
          libelle="Motif du litige"
          bouton="Mettre en litige"
          motif="obligatoire"
          onFermer={() => setDialogue(null)}
          onValider={async (motif) => {
            setF(
              await purchasesPayablesApi.disputeInvoice(f.id, {
                reason: motif,
                expectedRevision: f.revision,
              }),
            );
            setDialogue(null);
          }}
        />
      ) : null}
      {dialogue === 'lever-litige' ? (
        <DialogueMotif
          titre="Lever le litige"
          description="La facture redevient validable ou payable."
          libelle=""
          bouton="Lever le litige"
          motif="aucun"
          onFermer={() => setDialogue(null)}
          onValider={async () => {
            setF(await purchasesPayablesApi.resolveInvoiceDispute(f.id, f.revision));
            setDialogue(null);
          }}
        />
      ) : null}
      {dialogue === 'annuler' ? (
        <DialogueMotif
          titre={f.kind === 'credit_note' ? 'Annuler l’avoir' : 'Annuler la facture'}
          description="Elle reste visible, marquée annulée. Refusé si un paiement l’impute."
          libelle="Motif de l’annulation"
          bouton="Annuler"
          motif="obligatoire"
          onFermer={() => setDialogue(null)}
          onValider={async (motif) => {
            setF(
              await purchasesPayablesApi.cancelInvoice(f.id, {
                reason: motif,
                expectedRevision: f.revision,
              }),
            );
            setDialogue(null);
          }}
        />
      ) : null}
      {dialogue === 'avoir' ? (
        <FenetreFacture
          source={{ type: 'avoir', facture: f }}
          onFermer={() => setDialogue(null)}
          onCree={(avoir) => router.push(lienFacture(avoir.id))}
        />
      ) : null}
      {dialogue === 'payer' ? (
        <FenetrePaiement
          supplierId={f.supplierId}
          currency={f.currency}
          preselection={[f.id]}
          onFermer={() => setDialogue(null)}
          onPaye={() => {
            setDialogue(null);
            charger();
          }}
        />
      ) : null}
    </section>
  );
}
