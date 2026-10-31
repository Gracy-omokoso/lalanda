'use client';

// Réapprovisionnement — ADR-0046 § 5.1, § 6.1 : suggestions du moteur (disponible,
// seuil, déjà commandé, quantité suggérée), regroupées par fournisseur habituel.
// « Préparer une demande d'achat » ouvre le formulaire EXISTANT des achats,
// prérempli ; rien n'est créé ni envoyé tant que l'utilisateur n'enregistre pas.

import { buttonClasses } from '@lalanda/ui';
import { ShoppingCart, Truck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { stockApi, type StockReplenishmentSuggestionView } from '@/lib/api-stock';

import {
  boutonDemande,
  groupesParFournisseur,
  lienDemandeAchat,
} from './reapprovisionnement-model';
import { useAccesStocks } from './stocks-access';
import { estNul, formatQuantite, lienArticle, lire, type Lecture } from './stocks-model';
import { Bandeau, CarteVide, Chargement, EchecLecture, Panneau } from './stocks-ui';

export function Reapprovisionnement(): React.ReactElement {
  const { actions, etat } = useAccesStocks();
  const [lecture, setLecture] = useState<Lecture<StockReplenishmentSuggestionView[]> | null>(null);
  const [version, setVersion] = useState(0);
  const bouton = boutonDemande(actions);

  useEffect(() => {
    if (etat !== 'pret') return;
    let annule = false;
    void lire(stockApi.getReplenishment().then((r) => r.suggestions)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [etat, version]);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={ShoppingCart}
        titre="Réapprovisionnement"
        sousTitre="Ce qui passe sous le seuil et la quantité à racheter, une fois déduit ce qui est déjà commandé."
      >
        {!bouton.actif ? (
          <p className="text-xs text-[var(--foreground-muted)]">{bouton.raison}</p>
        ) : (
          <p className="text-xs text-[var(--foreground-muted)]">
            Une suggestion n’est jamais une commande : la demande d’achat s’ouvre préremplie, vous
            la complétez avec le prix du devis et l’enregistrez vous-même.
          </p>
        )}
      </Bandeau>

      {lecture === null ? (
        <Chargement texte="Calcul des suggestions…" />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Les suggestions sont illisibles."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : lecture.valeur.length === 0 ? (
        <CarteVide>Aucun article sous son seuil : rien à racheter pour le moment.</CarteVide>
      ) : (
        groupesParFournisseur(lecture.valeur).map((g) => {
          const lien = lienDemandeAchat(g.supplierId, g.suggestions);
          return (
            <Panneau
              key={g.supplierId ?? 'aucun'}
              titre={
                g.supplierName ??
                (g.supplierId ? 'Fournisseur habituel' : 'Sans fournisseur habituel')
              }
              icone={Truck}
              id={`reappro-${g.supplierId ?? 'aucun'}`}
              action={
                lien && bouton.actif ? (
                  <Link href={lien} className={buttonClasses('primary', 'sm')}>
                    Préparer une demande d’achat
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    title={bouton.raison ?? 'Aucune quantité à commander.'}
                    className={buttonClasses('primary', 'sm')}
                  >
                    Préparer une demande d’achat
                  </button>
                )
              }
            >
              <ul className="flex flex-col divide-y divide-[var(--border)]">
                {g.suggestions.map((s) => (
                  <li
                    key={`${s.itemId}-${s.locationId ?? 'tous'}`}
                    className="relative grid gap-1 py-3 sm:grid-cols-[2fr_repeat(4,1fr)] sm:items-center"
                  >
                    <Link
                      href={lienArticle(s.itemId)}
                      className="min-w-0 font-medium break-words after:absolute after:inset-0"
                    >
                      {s.itemCode ? `${s.itemCode} — ` : ''}
                      {s.itemName}
                      <span className="block text-xs font-normal text-[var(--foreground-muted)]">
                        {s.locationName ?? 'Tous les emplacements'}
                      </span>
                    </Link>
                    <span className="text-sm tabular-nums">
                      <span className="text-xs text-[var(--foreground-muted)] sm:hidden">
                        Disponible :{' '}
                      </span>
                      {formatQuantite(s.available, s.unit)}
                    </span>
                    <span className="text-sm tabular-nums">
                      <span className="text-xs text-[var(--foreground-muted)]">seuil </span>
                      {formatQuantite(s.minQuantity)}
                      {s.targetQuantity !== null
                        ? ` · cible ${formatQuantite(s.targetQuantity)}`
                        : ''}
                    </span>
                    <span className="text-sm tabular-nums">
                      <span className="text-xs text-[var(--foreground-muted)]">commandé </span>
                      {formatQuantite(s.onOrder)}
                    </span>
                    <span
                      className={`font-semibold tabular-nums ${estNul(s.suggestedQuantity) ? 'text-[var(--foreground-muted)]' : ''}`}
                    >
                      <span className="text-xs font-normal text-[var(--foreground-muted)]">
                        à racheter{' '}
                      </span>
                      {formatQuantite(s.suggestedQuantity, s.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panneau>
          );
        })
      )}
    </section>
  );
}
