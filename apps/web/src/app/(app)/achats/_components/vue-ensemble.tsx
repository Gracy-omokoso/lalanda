'use client';

// Vue d'ensemble des achats — ADR-0044 § 8. Chaque tuile lit sa propre route :
// une route pas encore livrée (404) affiche une phrase, jamais un chiffre
// inventé. Montants et nombres : ceux de l'API (moteur).

import { Badge, buttonClasses } from '@lalanda/ui';
import { ClipboardList, ShoppingCart, Truck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { purchasesApi, type PurchaseOrderView } from '@/lib/api-purchases';

import { Alerte } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';
import { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';

import { useAccesAchats } from './achats-access';
import {
  ACHATS_BASE,
  LIBELLES_STATUT,
  formatInstantJour,
  lienCommande,
  messageAchats,
  peutApprouverAchats,
  peutDemanderAchat,
  tonStatut,
} from './achats-model';
import { numeroCommande } from './commandes-model';
import { lire, tuilesVue, type TuileVue } from './vue-ensemble-model';

function Contenu({ t }: { t: TuileVue }): React.ReactElement {
  const c = t.contenu;
  const valeur =
    c.etat === 'connu' ? (
      <span className="flex flex-col">
        {c.lignes.map((l) => (
          <span key={l} className="whitespace-nowrap">
            {l}
          </span>
        ))}
      </span>
    ) : (
      <span className="text-sm font-normal text-[var(--foreground-muted)]">{c.phrase}</span>
    );
  const tuile = (
    <Tuile
      libelle={t.libelle}
      valeur={valeur}
      detail={c.etat === 'connu' ? (c.detail ?? undefined) : undefined}
      attention={c.etat === 'connu' && c.attention}
    />
  );
  return t.lien ? (
    <Link
      href={t.lien}
      className="block rounded-[var(--radius-md)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]"
    >
      {tuile}
    </Link>
  ) : (
    tuile
  );
}

export function VueEnsemble(): React.ReactElement {
  const { actions, etat } = useAccesAchats();
  const approuver = peutApprouverAchats(actions);
  const [tuiles, setTuiles] = useState<TuileVue[] | null>(null);
  const [miennes, setMiennes] = useState<PurchaseOrderView[] | null>(null);
  const [erreurMiennes, setErreurMiennes] = useState<string | null>(null);

  useEffect(() => {
    if (etat !== 'pret') return;
    let annule = false;
    void Promise.all([
      approuver ? lire(purchasesApi.listPendingApprovals({ limit: 50 })) : Promise.resolve(null),
      lire(purchasesApi.listOrders({ status: 'sent', limit: 50 })),
      lire(purchasesApi.listInvoices({ status: 'draft', matching: 'variance', limit: 50 })),
      lire(purchasesApi.getPayables()),
    ]).then(([enAttente, aRecevoir, facturesEcart, echeancier]) => {
      if (!annule) {
        setTuiles(tuilesVue(actions, { enAttente, aRecevoir, facturesEcart, echeancier }));
      }
    });
    purchasesApi
      .listOrders({ requestedBy: 'me', limit: 5 })
      .then((p) => {
        if (!annule) setMiennes(p.items);
      })
      .catch((err: unknown) => {
        if (!annule) setErreurMiennes(messageAchats(err, 'Vos demandes sont illisibles.'));
      });
    return () => {
      annule = true;
    };
  }, [etat, actions, approuver]);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={ShoppingCart}
        titre="Vue d’ensemble"
        sousTitre="Ce qui attend une décision, une livraison ou un paiement."
        actions={
          peutDemanderAchat(actions) ? (
            <Link
              href={`${ACHATS_BASE}/commandes?nouvelle=1`}
              className={buttonClasses('primary', 'sm')}
            >
              Demander un achat
            </Link>
          ) : null
        }
      >
        {tuiles === null ? (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement…
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {tuiles.map((t) => (
              <Contenu key={t.id} t={t} />
            ))}
          </div>
        )}
      </Bandeau>

      <Panneau
        titre="Mes dernières demandes"
        icone={ClipboardList}
        id="achats-miennes"
        action={
          <Link
            href={`${ACHATS_BASE}/commandes`}
            className="text-sm underline underline-offset-2"
          >
            Toutes les demandes
          </Link>
        }
      >
        {erreurMiennes ? (
          <Alerte>
            <p>{erreurMiennes}</p>
          </Alerte>
        ) : miennes === null ? (
          <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
        ) : miennes.length === 0 ? (
          <PhraseSection>Vous n’avez encore demandé aucun achat.</PhraseSection>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {miennes.map((o) => (
              <li key={o.id} className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link
                  href={lienCommande(o.id)}
                  className="min-w-0 flex-1 font-medium break-words after:absolute after:inset-0"
                >
                  {o.title}
                </Link>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {numeroCommande(o)} · {formatInstantJour(o.updatedAt)}
                </span>
                <span className="text-sm tabular-nums whitespace-nowrap">
                  {formatMontant(o.totals.total, o.currency)}
                </span>
                <Badge tone={tonStatut(o.status)}>{LIBELLES_STATUT[o.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panneau>

      <p className="flex items-center gap-2 text-xs text-[var(--foreground-muted)]">
        <Truck aria-hidden="true" className="h-4 w-4" />
        Réceptions, factures fournisseurs et paiements arrivent avec une prochaine livraison.
      </p>
    </section>
  );
}
