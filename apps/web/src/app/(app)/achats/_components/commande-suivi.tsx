'use client';

// Suivi d'un bon de commande (ADR-0044 § 3.2, § 3.4, § 3.5 ; lot P8) : ses
// réceptions et ses factures fournisseurs, lues dans la fiche enrichie par P4, et
// les deux gestes qui en partent — enregistrer une réception (fenêtre modale) et
// facturer la commande (`from-order`, fenêtre modale sur l'écran des factures).

import { Badge, buttonClasses } from '@lalanda/ui';
import { PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  purchasesPayablesApi,
  type PurchaseOrderDetailView,
  type PurchaseReceptionWriteResult,
} from '@/lib/api-purchases-payables';

import { Panneau, PhraseSection } from '../../crm/_components/crm-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  ACHATS_BASE,
  formatJour,
  lienFacture,
  lienReception,
  messageAchats,
  peutGererAchats,
} from './achats-model';
import { etatFacture } from './factures-model';
import { FenetreReception } from './reception-formulaire';
import { ResultatReception } from './reception-resultat';
import { LIBELLES_STATUT_RECEPTION, peutRecevoir, resumeReception } from './receptions-model';

const FACTURABLES = new Set(['approved', 'sent', 'partially_received', 'received', 'closed']);

export function CommandeSuivi({
  orderId,
  revision,
  onChange,
}: {
  orderId: string;
  /** Révision de la commande affichée : relit le suivi quand elle change. */
  revision: number;
  onChange: () => void;
}): React.ReactElement {
  const { actions } = useAccesAchats();
  const [o, setO] = useState<PurchaseOrderDetailView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fenetre, setFenetre] = useState(false);
  const [resultat, setResultat] = useState<{
    r: PurchaseReceptionWriteResult;
    avertissement: string | null;
  } | null>(null);

  const charger = useCallback(() => {
    purchasesPayablesApi
      .getOrderDetail(orderId)
      .then((v) => {
        setO(v);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageAchats(err, 'Suivi illisible.')));
  }, [orderId]);

  useEffect(() => charger(), [charger, revision]);

  const recevoir = o !== null && peutRecevoir(o, actions);
  const facturer =
    o !== null && peutGererAchats(actions) && o.phase === 'order' && FACTURABLES.has(o.status);

  return (
    <Panneau
      titre="Réceptions et factures"
      icone={PackageCheck}
      id="cmd-suivi"
      action={
        <span className="flex flex-wrap gap-2">
          {recevoir ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => setFenetre(true)}
            >
              Enregistrer une réception
            </button>
          ) : null}
          {facturer ? (
            <Link
              href={`${ACHATS_BASE}/factures?commande=${encodeURIComponent(orderId)}`}
              className={buttonClasses('secondary', 'sm')}
            >
              Saisir la facture
            </Link>
          ) : null}
        </span>
      }
    >
      {resultat && o ? (
        <ResultatReception
          resultat={resultat.r}
          commande={o}
          avertissement={resultat.avertissement}
          onFermer={() => setResultat(null)}
        />
      ) : null}
      {erreur ? (
        <PhraseSection>{erreur}</PhraseSection>
      ) : o === null ? (
        <PhraseSection>Chargement…</PhraseSection>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-[var(--foreground-muted)]">Réceptions</p>
            {o.receptions.length === 0 ? (
              <PhraseSection>Aucune livraison enregistrée.</PhraseSection>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
                {o.receptions.map((r) => (
                  <li key={r.id} className="relative flex flex-wrap items-center gap-2 py-2">
                    <Link
                      href={lienReception(r.id)}
                      className="min-w-0 flex-1 after:absolute after:inset-0"
                    >
                      {formatJour(r.receivedOn)}
                      <span className="block text-xs text-[var(--foreground-muted)]">
                        {resumeReception(r)}
                      </span>
                    </Link>
                    <Badge tone={r.status === 'cancelled' ? 'danger' : 'success'}>
                      {LIBELLES_STATUT_RECEPTION[r.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-[var(--foreground-muted)]">Factures</p>
            {o.invoices.length === 0 ? (
              <PhraseSection>Aucune facture fournisseur.</PhraseSection>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
                {o.invoices.map((f) => {
                  const e = etatFacture(f);
                  return (
                    <li key={f.id} className="relative flex flex-wrap items-center gap-2 py-2">
                      <Link
                        href={lienFacture(f.id)}
                        className="min-w-0 flex-1 after:absolute after:inset-0"
                      >
                        {f.internalNumber}
                        <span className="block text-xs text-[var(--foreground-muted)]">
                          réf. {f.supplierReference} · {formatMontant(f.total, f.currency)}
                        </span>
                      </Link>
                      <Badge tone={e.ton}>{e.libelle}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
      {fenetre && o ? (
        <FenetreReception
          commande={o}
          onFermer={() => setFenetre(false)}
          onCree={(r, avertissement) => {
            setFenetre(false);
            setResultat({ r, avertissement });
            charger();
            onChange();
          }}
        />
      ) : null}
    </Panneau>
  );
}
