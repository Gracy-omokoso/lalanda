'use client';

// Collaborateurs — ADR-0045 § 3.1 et § 8 : liste triée par nom (API), recherche,
// statut, service ; cartes entièrement cliquables ; création en fenêtre modale
// (`hr.manage`). Aucune donnée sensible n'est lue ni affichée.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { hrApi, type HrEmployeeListItem } from '@/lib/api-hr';

import { BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import {
  FILTRES_COLLABORATEURS_INITIAUX,
  libelleContrat,
  requeteCollaborateurs,
  sousTitreCarte,
  type FiltresCollaborateurs,
} from './collaborateurs-model';
import { FicheFormulaire } from './fiche-formulaire';
import { useReferentielsRh } from './referentiels';
import { useAccesRh } from './rh-access';
import {
  initiales,
  libelleStatutCollaborateur,
  lienCollaborateur,
  nomAffiche,
  peutGererRh,
  peutLireRh,
} from './rh-model';
import { Bandeau, Chargement, EchecLecture } from './rh-ui';

export function CollaborateursListe(): React.ReactElement {
  const router = useRouter();
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions);
  const { contrats, services } = useReferentielsRh(false);
  const [filtres, setFiltres] = useState<FiltresCollaborateurs>(FILTRES_COLLABORATEURS_INITIAUX);
  const [items, setItems] = useState<HrEmployeeListItem[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [creation, setCreation] = useState(false);

  const charger = useCallback((f: FiltresCollaborateurs, cursor: string | null) => {
    hrApi
      .listEmployees(requeteCollaborateurs(f, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setSuivante(null);
        setErreur(err);
      });
  }, []);

  useEffect(() => {
    if (!peutLireRh(actions)) return;
    const t = setTimeout(() => charger(filtres, null), 200);
    return () => clearTimeout(t);
  }, [filtres, charger, actions]);

  if (!peutLireRh(actions)) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
        La liste du personnel est réservée aux rôles qui tiennent les dossiers. Votre espace et
        l’organigramme restent ouverts.
      </p>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Users}
        titre="Collaborateurs"
        sousTitre="Le registre du personnel : poste, service, manager, dates. Les données sensibles n’apparaissent jamais dans une liste."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setCreation(true)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouveau collaborateur
            </button>
          ) : null
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <input
            type="search"
            aria-label="Rechercher un collaborateur"
            placeholder="Rechercher par nom, poste ou matricule…"
            className={`${CHAMP} sm:max-w-sm`}
            value={filtres.q}
            onChange={(e) => setFiltres({ ...filtres, q: e.target.value })}
          />
          <select
            aria-label="Service"
            className={`${CHAMP} sm:w-auto`}
            value={filtres.departmentId}
            onChange={(e) => setFiltres({ ...filtres, departmentId: e.target.value })}
          >
            <option value="">Tous les services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1" role="group" aria-label="Statut">
            {(
              [
                ['active', 'Actifs'],
                ['exited', 'Sortis'],
                ['', 'Tous'],
              ] as const
            ).map(([v, l]) => (
              <button
                key={l}
                type="button"
                className={BOUTON_PETIT}
                aria-pressed={filtres.statut === v}
                onClick={() => setFiltres({ ...filtres, statut: v })}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </Bandeau>

      <Modal
        open={gerer && creation}
        onClose={() => setCreation(false)}
        title="Nouveau collaborateur"
        description="Le nom, le poste et la date d’entrée suffisent. Les données sensibles s’ajoutent ensuite depuis la fiche."
        size="lg"
      >
        <FicheFormulaire
          fiche={null}
          onAnnuler={() => setCreation(false)}
          onEnregistre={(e) => router.push(lienCollaborateur(e.id))}
        />
      </Modal>

      {erreur !== null ? (
        <EchecLecture
          erreur={erreur}
          repli="Impossible de charger les collaborateurs."
          onReessayer={() => charger(filtres, null)}
        />
      ) : null}

      {items === null ? (
        <Chargement texte="Chargement des collaborateurs…" />
      ) : items.length === 0 ? (
        erreur !== null ? null : (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
            Aucun collaborateur ne correspond.
            {gerer ? ' Créez une fiche avec « Nouveau collaborateur ».' : ''}
          </p>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((e) => {
            const nom = nomAffiche(e);
            const statut = libelleStatutCollaborateur(e);
            return (
              <li key={e.id}>
                <Link
                  href={lienCollaborateur(e.id)}
                  className="group flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-xs font-semibold"
                      >
                        {initiales(nom)}
                      </span>
                      <span className="font-semibold break-words">{nom}</span>
                    </span>
                    <Badge tone={statut.ton}>{statut.texte}</Badge>
                  </span>
                  <span className="text-xs text-[var(--foreground-muted)]">{sousTitreCarte(e)}</span>
                  <span className="text-xs">
                    {libelleContrat(e, contrats)}
                    {e.managerName ? ` · Manager : ${e.managerName}` : ''}
                    {e.userId ? '' : ' · Sans compte Lalanda'}
                  </span>
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
          Afficher plus de collaborateurs
        </button>
      ) : null}
    </section>
  );
}
