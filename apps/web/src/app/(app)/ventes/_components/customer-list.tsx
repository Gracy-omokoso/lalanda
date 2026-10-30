'use client';

// Liste des clients (ADR-0022 § S25c.5) : recherche, filtres, pagination par
// curseur, désactivation, réactivation, suppression.
//
// La fiche s'ouvre sur la même page (`?fiche=<id>` ou `?fiche=nouveau`) : un
// lien vers une fiche se partage, et le bouton « précédent » du navigateur
// ramène à la liste.
//
// La suppression n'est proposée que pour un client JAMAIS facturé (§ O7) ;
// sinon, seule la désactivation le retire des propositions.

import { Modal, buttonClasses } from '@lalanda/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { api, type CustomerType, type CustomerView, type SalesStatusFilter } from '@/lib/api';

import { CustomerForm } from './customer-form';
import { Alerte, BOUTON, BOUTON_DANGER, BOUTON_PETIT, CHAMP, Pastille } from './form-ui';
import { useAccesVentes } from './sales-access';
import {
  actionsLigne,
  CUSTOMER_TYPES,
  FICHE_NOUVELLE,
  ficheDepuisParametre,
  type FiltresClients,
  formatDate,
  messageVentes,
  remplacerDansListe,
  requeteClients,
  STATUS_LABELS,
} from './sales-model';
import { useSalesList } from './use-sales-list';

export function CustomerList(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { gerer } = useAccesVentes();
  const fiche = ficheDepuisParametre(params.get('fiche'));

  const [filtres, setFiltres] = useState<FiltresClients>({ q: '', type: '', status: 'active' });
  const [notice, setNotice] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);

  const charger = useCallback(
    (cursor: string | null) => api.listCustomers(requeteClients(filtres, cursor)),
    [filtres],
  );
  const liste = useSalesList<CustomerView>(charger, JSON.stringify(filtres));

  const ouvrir = (valeur: string): void => {
    setNotice(null);
    setErreurAction(null);
    router.push(`${pathname}?fiche=${encodeURIComponent(valeur)}`);
  };

  const fermer = (enregistre?: CustomerView): void => {
    router.push(pathname);
    if (enregistre) {
      setNotice(`Client « ${enregistre.name} » enregistré.`);
      liste.recharger();
    }
  };

  async function agir(
    item: CustomerView,
    action: 'desactiver' | 'reactiver' | 'supprimer',
  ): Promise<void> {
    setOccupe(item.id);
    setErreurAction(null);
    setNotice(null);
    try {
      if (action === 'supprimer') {
        await api.deleteCustomer(item.id);
        liste.setItems((items) => items.filter((i) => i.id !== item.id));
        setNotice(`Client « ${item.name} » supprimé.`);
      } else {
        const maj =
          action === 'desactiver'
            ? await api.deactivateCustomer(item.id)
            : await api.reactivateCustomer(item.id);
        liste.setItems((items) => remplacerDansListe(items, maj, filtres.status));
        setNotice(
          action === 'desactiver'
            ? `Client « ${item.name} » désactivé : il ne sera plus proposé sur une facture.`
            : `Client « ${item.name} » réactivé.`,
        );
      }
      setASupprimer(null);
    } catch (err) {
      setErreurAction(messageVentes(err, 'Action impossible.'));
      // Un client facturé entre-temps : la liste se relit pour retirer
      // « Supprimer » de sa ligne.
      liste.recharger();
    } finally {
      setOccupe(null);
    }
  }

  if (fiche?.mode === 'edition') {
    return (
      <CustomerForm
        key={fiche.mode === 'edition' ? fiche.id : FICHE_NOUVELLE}
        fiche={fiche}
        gerer={gerer}
        base={pathname}
        onFermer={fermer}
      />
    );
  }

  const filtre = filtres.q.trim() !== '' || filtres.type !== '' || filtres.status !== 'active';

  return (
    <section aria-labelledby="clients-titre" className="flex flex-col gap-4">
      <Modal
        open={fiche?.mode === 'creation'}
        onClose={() => fermer()}
        title="Nouveau client"
        size="lg"
      >
        {fiche ? (
          <CustomerForm
            key={FICHE_NOUVELLE}
            fiche={fiche}
            gerer={gerer}
            base={pathname}
            onFermer={fermer}
            enModal
          />
        ) : null}
      </Modal>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="clients-titre" className="font-display text-lg font-bold tracking-tight">
            Clients
          </h2>
          {/* ADR-0030 : sur téléphone, lue par les lecteurs d'écran mais non
              affichée — la liste se voit sans défiler. */}
          <p className="max-w-2xl text-sm text-[var(--foreground-muted)] max-sm:sr-only">
            Chaque client porte l’un des cinq types de la DGI ; la facture reprendra ses
            informations telles qu’elles sont au moment de l’émission.
          </p>
        </div>
        {gerer ? (
          <button
            type="button"
            onClick={() => ouvrir(FICHE_NOUVELLE)}
            className={buttonClasses('primary', 'md')}
          >
            Nouveau client
          </button>
        ) : null}
      </div>

      <form
        role="search"
        aria-label="Rechercher un client"
        onSubmit={(e) => e.preventDefault()}
        className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <label htmlFor="cl-q" className="text-sm font-medium">
            Rechercher
          </label>
          <input
            id="cl-q"
            type="search"
            value={filtres.q}
            onChange={(e) => setFiltres((f) => ({ ...f, q: e.target.value }))}
            maxLength={100}
            placeholder="Nom, NIF ou e-mail"
            className={CHAMP}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cl-filtre-type" className="text-sm font-medium">
            Type
          </label>
          <select
            id="cl-filtre-type"
            value={filtres.type}
            onChange={(e) =>
              setFiltres((f) => ({ ...f, type: e.target.value as CustomerType | '' }))
            }
            className={CHAMP}
          >
            <option value="">Tous les types</option>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cl-filtre-statut" className="text-sm font-medium">
            État
          </label>
          <select
            id="cl-filtre-statut"
            value={filtres.status}
            onChange={(e) =>
              setFiltres((f) => ({ ...f, status: e.target.value as SalesStatusFilter }))
            }
            className={CHAMP}
          >
            {(Object.keys(STATUS_LABELS) as SalesStatusFilter[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </form>

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-[var(--foreground-muted)]">
        {notice ?? ''}
      </p>
      {erreurAction ? (
        <Alerte>
          <p>{erreurAction}</p>
        </Alerte>
      ) : null}

      {liste.etat === 'chargement' ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement des clients…
        </p>
      ) : liste.etat === 'refus' ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
          <p className="text-sm font-medium">Fichier clients non accessible</p>
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">{liste.erreur}</p>
        </div>
      ) : liste.etat === 'erreur' ? (
        <Alerte
          action={
            <button
              type="button"
              onClick={liste.recharger}
              className={`${BOUTON} text-[var(--foreground)]`}
            >
              Réessayer
            </button>
          }
        >
          <p>{liste.erreur}</p>
        </Alerte>
      ) : liste.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
          {filtre ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Aucun client ne correspond à cette recherche.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">Aucun client pour l’instant</p>
              <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                {gerer
                  ? 'Créez votre premier client : il sera proposé sur vos factures.'
                  : 'Les clients de l’organisation apparaîtront ici.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {liste.items.map((c) => {
              const actions = actionsLigne(c, gerer);
              return (
                <li key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-medium">{c.name}</span>
                      {!c.active ? (
                        <Pastille ton="attention">
                          Désactivé le {formatDate(c.deactivatedAt)}
                        </Pastille>
                      ) : null}
                      {c.invoiced ? <Pastille ton="neutre">Déjà facturé</Pastille> : null}
                    </div>
                    <p className="text-xs text-[var(--foreground-muted)]">
                      {c.typeLabel}
                      {c.nif ? (
                        <>
                          {' · NIF '}
                          <span className="font-mono">{c.nif}</span>
                        </>
                      ) : null}
                    </p>
                    {c.email || c.phone ? (
                      <p className="break-words text-xs text-[var(--foreground-muted)]">
                        {[c.email, c.phone].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {aSupprimer === c.id ? (
                      <div
                        role="group"
                        aria-label={`Confirmer la suppression de ${c.name}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="text-xs">Supprimer définitivement ?</span>
                        <button
                          type="button"
                          disabled={occupe === c.id}
                          onClick={() => void agir(c, 'supprimer')}
                          className={BOUTON_DANGER}
                        >
                          Supprimer
                        </button>
                        <button
                          type="button"
                          onClick={() => setASupprimer(null)}
                          className={BOUTON_PETIT}
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      actions.map((a) => (
                        <button
                          key={a}
                          type="button"
                          disabled={occupe === c.id}
                          onClick={() => {
                            if (a === 'consulter' || a === 'modifier') ouvrir(c.id);
                            else if (a === 'supprimer') setASupprimer(c.id);
                            else void agir(c, a);
                          }}
                          className={a === 'supprimer' ? BOUTON_DANGER : BOUTON_PETIT}
                          aria-label={`${LIBELLES_ACTIONS[a]} — ${c.name}`}
                        >
                          {LIBELLES_ACTIONS[a]}
                        </button>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {liste.erreurSuite ? (
            <Alerte>
              <p>{liste.erreurSuite}</p>
            </Alerte>
          ) : null}
          {liste.suivante ? (
            <button
              type="button"
              onClick={liste.chargerSuite}
              disabled={liste.chargementSuite}
              className={`${BOUTON} self-center`}
            >
              {liste.chargementSuite ? 'Chargement…' : 'Afficher plus de clients'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

const LIBELLES_ACTIONS = {
  consulter: 'Consulter',
  modifier: 'Modifier',
  desactiver: 'Désactiver',
  reactiver: 'Réactiver',
  supprimer: 'Supprimer',
} as const;
