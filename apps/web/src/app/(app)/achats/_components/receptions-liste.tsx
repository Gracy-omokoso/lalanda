'use client';

// Réceptions — ADR-0044 § 3.4 et § 8 : liste (filtrable par commande) et création
// depuis une commande, en fenêtre modale. Aucune quantité n'est additionnée ici.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { PackageCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { purchasesApi, type PurchaseOrderView } from '@/lib/api-purchases';
import {
  purchasesPayablesApi,
  type PurchaseOrderDetailView,
  type PurchaseReceptionView,
  type PurchaseReceptionWriteResult,
} from '@/lib/api-purchases-payables';

import { Bandeau } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  ACHATS_BASE,
  LIBELLES_STATUT,
  formatJour,
  lienReception,
  messageAchats,
  peutGererAchats,
} from './achats-model';
import { numeroCommande } from './commandes-model';
import { FenetreReception } from './reception-formulaire';
import { ResultatReception } from './reception-resultat';
import { LIBELLES_STATUT_RECEPTION, requeteReceptions, resumeReception } from './receptions-model';

/** Commandes qui attendent une livraison : envoyées, reçues en partie, approuvées. */
function ChoixCommande({
  onChoisie,
  onFermer,
}: {
  onChoisie: (o: PurchaseOrderDetailView) => void;
  onFermer: () => void;
}): React.ReactElement {
  const [items, setItems] = useState<PurchaseOrderView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    Promise.all(
      (['sent', 'partially_received', 'approved'] as const).map((status) =>
        purchasesApi.listOrders({ phase: 'order', status, limit: 50 }),
      ),
    )
      .then((pages) => {
        if (!annule) setItems(pages.flatMap((p) => p.items));
      })
      .catch((err: unknown) => {
        if (!annule) {
          setItems([]);
          setErreur(messageAchats(err, 'Commandes illisibles.'));
        }
      });
    return () => {
      annule = true;
    };
  }, []);

  async function choisir(o: PurchaseOrderView): Promise<void> {
    try {
      onChoisie(await purchasesPayablesApi.getOrderDetail(o.id));
    } catch (err) {
      setErreur(messageAchats(err, 'Commande illisible.'));
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Recevoir une commande"
      description="Choisissez la commande livrée. Seules les commandes approuvées, envoyées ou reçues en partie attendent une livraison."
      size="md"
    >
      <div className="flex flex-col gap-3 text-sm">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {items === null ? (
          <p className="text-[var(--foreground-muted)]">Chargement des commandes…</p>
        ) : items.length === 0 ? (
          <p className="text-[var(--foreground-muted)]">Aucune commande n’attend de livraison.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {items.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left hover:bg-[var(--surface-muted)]"
                  onClick={() => void choisir(o)}
                >
                  <span className="min-w-0 flex-1 font-medium break-words">{o.title}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {numeroCommande(o)} · {o.supplierName ?? 'Fournisseur'} ·{' '}
                    {LIBELLES_STATUT[o.status]}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">
                    {formatMontant(o.totals.total, o.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function ReceptionsListe(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions } = useAccesAchats();
  const gerer = peutGererAchats(actions);
  const commandeFiltre = params.get('commande');
  const choix = params.get('nouvelle') === '1';
  const [commande, setCommande] = useState<PurchaseOrderDetailView | null>(null);
  const [resultat, setResultat] = useState<{
    r: PurchaseReceptionWriteResult;
    commande: PurchaseOrderDetailView;
    avertissement: string | null;
  } | null>(null);
  const [items, setItems] = useState<PurchaseReceptionView[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback((orderId: string | null, cursor: string | null) => {
    purchasesPayablesApi
      .listReceptions(requeteReceptions(orderId, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(messageAchats(err, 'Impossible de charger les réceptions.'));
      });
  }, []);

  useEffect(() => charger(commandeFiltre, null), [commandeFiltre, charger]);

  const ouvrirChoix = (oui: boolean) => router.replace(oui ? `${pathname}?nouvelle=1` : pathname);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={PackageCheck}
        titre="Réceptions"
        sousTitre="Ce qui est arrivé, livraison par livraison : la base du rapprochement à trois voies."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => ouvrirChoix(true)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Enregistrer une réception
            </button>
          ) : null
        }
      >
        {commandeFiltre ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            Réceptions d’une seule commande.
            <Link href={`${ACHATS_BASE}/receptions`} className="underline underline-offset-2">
              Voir toutes les réceptions
            </Link>
          </p>
        ) : null}
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {resultat ? (
        <ResultatReception
          resultat={resultat.r}
          commande={resultat.commande}
          avertissement={resultat.avertissement}
          onFermer={() => setResultat(null)}
        />
      ) : null}

      {gerer && choix && commande === null ? (
        <ChoixCommande onChoisie={setCommande} onFermer={() => ouvrirChoix(false)} />
      ) : null}
      {commande ? (
        <FenetreReception
          commande={commande}
          onFermer={() => {
            setCommande(null);
            ouvrirChoix(false);
          }}
          onCree={(r, avertissement) => {
            setResultat({ r, commande, avertissement });
            setCommande(null);
            ouvrirChoix(false);
            charger(commandeFiltre, null);
          }}
        />
      ) : null}

      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des réceptions…
        </p>
      ) : items.length === 0 ? (
        erreur ? null : (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
            Aucune réception enregistrée.
          </p>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                href={lienReception(r.id)}
                className="flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold">Reçue le {formatJour(r.receivedOn)}</span>
                  <Badge tone={r.status === 'cancelled' ? 'danger' : 'success'}>
                    {LIBELLES_STATUT_RECEPTION[r.status]}
                  </Badge>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  Commande {r.orderNumber ?? 'sans numéro'}
                </span>
                <span className="text-xs">{resumeReception(r)}</span>
                {r.attachment ? (
                  <span className="text-xs text-[var(--foreground-muted)]">Pièce jointe</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(commandeFiltre, suivante)}
        >
          Afficher plus de réceptions
        </button>
      ) : null}
    </section>
  );
}
