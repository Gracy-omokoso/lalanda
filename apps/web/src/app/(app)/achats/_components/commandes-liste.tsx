'use client';

// Demandes et commandes — ADR-0044 § 3.2 et § 8 : liste filtrable, création d'une
// demande en fenêtre modale (`purchase.request`). Montants TTC rendus par l'API.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { ClipboardList, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { purchasesApi, type PurchaseOrderView } from '@/lib/api-purchases';

import { Bandeau } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  LIBELLES_STATUT,
  formatInstantJour,
  lienCommande,
  messageAchats,
  nomPersonne,
  peutDemanderAchat,
  tonStatut,
} from './achats-model';
import { NouvelleDemande } from './commande-formulaire';
import {
  FILTRES_COMMANDES,
  natureCommande,
  numeroCommande,
  phraseApprobations,
  requeteCommandes,
  type FiltreCommandes,
} from './commandes-model';

export function CommandesListe(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions, membres, moi } = useAccesAchats();
  const demander = peutDemanderAchat(actions);
  const creation = params.get('nouvelle') === '1';
  const fournisseur = params.get('fournisseur');
  const [filtre, setFiltre] = useState<FiltreCommandes>('toutes');
  const [items, setItems] = useState<PurchaseOrderView[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback((f: FiltreCommandes, cursor: string | null) => {
    purchasesApi
      .listOrders(requeteCommandes(f, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(messageAchats(err, 'Impossible de charger les demandes.'));
      });
  }, []);

  useEffect(() => charger(filtre, null), [filtre, charger]);

  const ouvrir = (oui: boolean) => router.replace(oui ? `${pathname}?nouvelle=1` : pathname);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={ClipboardList}
        titre="Demandes et commandes"
        sousTitre="Une demande d’achat devient bon de commande une fois approuvée."
        actions={
          demander ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => ouvrir(true)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Demander un achat
            </button>
          ) : null
        }
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les demandes">
          {FILTRES_COMMANDES.map((f) => (
            <button
              key={f.valeur}
              type="button"
              className={BOUTON_PETIT}
              aria-pressed={filtre === f.valeur}
              onClick={() => setFiltre(f.valeur)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <Modal
        open={demander && creation}
        onClose={() => ouvrir(false)}
        title="Demander un achat"
        description="Décrivez le besoin et le devis du fournisseur. La demande part en approbation depuis sa fiche."
        size="lg"
      >
        <NouvelleDemande
          fournisseurInitial={fournisseur}
          onCree={(id) => router.push(lienCommande(id))}
        />
      </Modal>

      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des demandes…
        </p>
      ) : items.length === 0 ? (
        erreur ? null : (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
            Aucune demande ne correspond.
          </p>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((o) => {
            const progression = o.status === 'submitted' ? phraseApprobations(o) : null;
            return (
              <li key={o.id}>
                <Link
                  href={lienCommande(o.id)}
                  className="flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold break-words">{o.title}</span>
                    <Badge tone={tonStatut(o.status)}>{LIBELLES_STATUT[o.status]}</Badge>
                  </span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {natureCommande(o)} · {numeroCommande(o)}
                  </span>
                  <span className="text-xs break-words">
                    {o.supplierName ?? 'Fournisseur à choisir'} · demandé par{' '}
                    {nomPersonne(membres, o.requestedBy, moi)}
                  </span>
                  <span className="flex items-end justify-between gap-2">
                    <strong className="font-display text-lg tabular-nums">
                      {formatMontant(o.totals.total, o.currency)}
                    </strong>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {formatInstantJour(o.updatedAt)}
                    </span>
                  </span>
                  {progression ? (
                    <span className="text-xs text-[var(--foreground-muted)]">{progression}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(filtre, suivante)}
        >
          Afficher plus de demandes
        </button>
      ) : null}
    </section>
  );
}
