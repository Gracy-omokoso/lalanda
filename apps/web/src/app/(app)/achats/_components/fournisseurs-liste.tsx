'use client';

// Fournisseurs — ADR-0044 § 3.1 et § 8 : liste triée par nom, recherche,
// archivés ; création en fenêtre modale (`purchase.manage`). Le reste dû par
// devise n'apparaît que si l'API le sert (droit `treasury.read` en plus).

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { Plus, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { purchasesApi, type SupplierListItem } from '@/lib/api-purchases';

import { Bandeau, MontantsLignes } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import { useAccesAchats } from './achats-access';
import { lienFournisseur, messageAchats, peutGererAchats } from './achats-model';
import { NouveauFournisseur } from './fournisseur-formulaire';
import {
  FILTRES_FOURNISSEURS_INITIAUX,
  contactPrincipal,
  libelleConditions,
  libelleNature,
  requeteFournisseurs,
  resteDuLignes,
  retenirFournisseurs,
  type FiltresFournisseurs,
} from './fournisseurs-model';

export function FournisseursListe(): React.ReactElement {
  const router = useRouter();
  const { actions } = useAccesAchats();
  const gerer = peutGererAchats(actions);
  const [filtres, setFiltres] = useState<FiltresFournisseurs>(FILTRES_FOURNISSEURS_INITIAUX);
  const [items, setItems] = useState<SupplierListItem[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);

  const charger = useCallback((f: FiltresFournisseurs, cursor: string | null) => {
    purchasesApi
      .listSuppliers(requeteFournisseurs(f, cursor))
      .then((p) => {
        retenirFournisseurs(p.items);
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(messageAchats(err, 'Impossible de charger les fournisseurs.'));
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => charger(filtres, null), 200);
    return () => clearTimeout(t);
  }, [filtres, charger]);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Truck}
        titre="Fournisseurs"
        sousTitre="Les fiches de vos fournisseurs : identité, contacts, conditions de paiement."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => setCreation(true)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouveau fournisseur
            </button>
          ) : null
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="search"
            aria-label="Rechercher un fournisseur"
            placeholder="Rechercher par nom ou NIF…"
            className={`${CHAMP} sm:max-w-sm`}
            value={filtres.q}
            onChange={(e) => setFiltres({ ...filtres, q: e.target.value })}
          />
          <button
            type="button"
            className={`${BOUTON_PETIT} self-start sm:self-auto`}
            aria-pressed={filtres.archives}
            onClick={() => setFiltres({ ...filtres, archives: !filtres.archives })}
          >
            Archivés
          </button>
        </div>
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <Modal
        open={gerer && creation}
        onClose={() => setCreation(false)}
        title="Nouveau fournisseur"
        description="Les coordonnées de paiement s’ajoutent ensuite, depuis la fiche."
        size="lg"
      >
        <NouveauFournisseur onCree={(id) => router.push(lienFournisseur(id))} />
      </Modal>

      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des fournisseurs…
        </p>
      ) : items.length === 0 ? (
        erreur ? null : (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
            Aucun fournisseur ne correspond.
          </p>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => {
            const reste = resteDuLignes(s);
            const contact = contactPrincipal(s);
            return (
              <li key={s.id}>
                <Link
                  href={lienFournisseur(s.id)}
                  className="group flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold break-words">{s.name}</span>
                    <Badge tone={s.active ? 'info' : 'neutral'}>
                      {s.active ? libelleNature(s.kind) : 'Archivé'}
                    </Badge>
                  </span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {[s.nif ? `NIF ${s.nif}` : 'Sans NIF', libelleConditions(s.paymentTerms)].join(
                      ' · ',
                    )}
                  </span>
                  {contact ? (
                    <span className="text-xs break-words">Contact : {contact.name}</span>
                  ) : null}
                  {reste !== null ? (
                    <span className="rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-2 py-1.5 text-xs">
                      <span className="block text-[var(--foreground-muted)]">Reste à payer</span>
                      <strong className="font-display text-base tabular-nums">
                        <MontantsLignes montants={reste} vide="Rien à payer" />
                      </strong>
                    </span>
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
          onClick={() => charger(filtres, suivante)}
        >
          Afficher plus de fournisseurs
        </button>
      ) : null}
    </section>
  );
}
