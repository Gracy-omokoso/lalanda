'use client';

// Organigramme — ADR-0045 § 2.3 et § 8 : arbre par services ou par ligne
// hiérarchique, rendu par l'API (moteur `orgChart`). Motif ARIA « tree » :
// focus itinérant, flèches, Début, Fin, `*` (voir `organigramme-model.ts`).
// Une personne n'est un lien que si l'appelant peut ouvrir les dossiers.

import { Building2, ChevronDown, ChevronRight, Network, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { hrApi, type HrOrgChartResponse, type HrOrgChartView } from '@/lib/api-hr';

import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  arbreOrganigramme,
  noeudsVisibles,
  ouvertsInitiaux,
  tousLesParents,
  toucheArbre,
  type NoeudArbre,
} from './organigramme-model';
import { useAccesRh } from './rh-access';
import { lienCollaborateur, lire, peutLireRh, statutDe, type Lecture } from './rh-model';
import { Bandeau, Chargement, EchecLecture, PhraseSection } from './rh-ui';

const VUES: { id: HrOrgChartView; libelle: string }[] = [
  { id: 'departments', libelle: 'Par services' },
  { id: 'reporting', libelle: 'Ligne hiérarchique' },
];

export function Organigramme(): React.ReactElement {
  const { actions } = useAccesRh();
  const [vue, setVue] = useState<HrOrgChartView>('departments');
  const [lecture, setLecture] = useState<Lecture<HrOrgChartResponse> | null>(null);
  const [version, setVersion] = useState(0);
  const lireRh = peutLireRh(actions);

  useEffect(() => {
    let annule = false;
    setLecture(null);
    void lire(hrApi.getOrgChart(vue)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [vue, version]);

  const racines = useMemo(
    () =>
      lecture?.ok
        ? arbreOrganigramme(lecture.valeur, (id) => (lireRh ? lienCollaborateur(id) : null))
        : [],
    [lecture, lireRh],
  );

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Network}
        titre="Organigramme"
        sousTitre="Qui fait quoi, dans quel service, avec quel manager : nom, poste et service, rien d’autre."
        actions={
          <div className="flex gap-1" role="group" aria-label="Vue de l’organigramme">
            {VUES.map((v) => (
              <button
                key={v.id}
                type="button"
                className={BOUTON_PETIT}
                aria-pressed={vue === v.id}
                onClick={() => setVue(v.id)}
              >
                {v.libelle}
              </button>
            ))}
          </div>
        }
      >
        {lecture?.ok ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            {lecture.valeur.headcount} collaborateur{lecture.valeur.headcount > 1 ? 's' : ''} actif
            {lecture.valeur.headcount > 1 ? 's' : ''}.
          </p>
        ) : null}
      </Bandeau>

      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        statutDe(lecture.erreur) === 403 ? (
          <PhraseSection>
            L’organigramme de votre organisation est réservé aux ressources humaines, ou votre
            compte n’est relié à aucun dossier collaborateur.
          </PhraseSection>
        ) : (
          <EchecLecture
            erreur={lecture.erreur}
            repli="L’organigramme est illisible."
            onReessayer={() => setVersion((v) => v + 1)}
          />
        )
      ) : racines.length === 0 ? (
        <PhraseSection>
          {vue === 'departments'
            ? 'Aucun service ni collaborateur actif.'
            : 'Aucun collaborateur actif.'}
        </PhraseSection>
      ) : (
        <Arbre key={vue} racines={racines} libelle={VUES.find((v) => v.id === vue)!.libelle} />
      )}
    </section>
  );
}

function Arbre({
  racines,
  libelle,
}: {
  racines: NoeudArbre[];
  libelle: string;
}): React.ReactElement {
  const router = useRouter();
  const [ouverts, setOuverts] = useState<Set<string>>(() => ouvertsInitiaux(racines));
  const [focusVoulu, setFocus] = useState<string | null>(racines[0]?.id ?? null);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const visibles = useMemo(() => noeudsVisibles(racines, ouverts), [racines, ouverts]);
  const parNiveau = useMemo(() => new Map(visibles.map((v) => [v.noeud.id, v])), [visibles]);
  // Un nœud replié sous un parent n'est plus visible : le focus itinérant
  // revient au premier nœud, pour que l'arbre reste atteignable à la tabulation.
  const focus =
    focusVoulu !== null && parNiveau.has(focusVoulu) ? focusVoulu : (visibles[0]?.noeud.id ?? null);
  const [doitFocaliser, setDoitFocaliser] = useState(false);

  useEffect(() => {
    if (doitFocaliser && focus) refs.current.get(focus)?.focus();
    setDoitFocaliser(false);
  }, [focus, doitFocaliser]);

  function basculer(id: string): void {
    setOuverts((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function clavier(e: React.KeyboardEvent): void {
    if (e.key === 'Enter' && focus) {
      const v = parNiveau.get(focus);
      if (v?.noeud.lien) {
        e.preventDefault();
        router.push(v.noeud.lien);
        return;
      }
      if (v && v.noeud.enfants.length > 0) {
        e.preventDefault();
        basculer(focus);
      }
      return;
    }
    const suite = toucheArbre(e.key, visibles, { focus, ouverts });
    if (suite === null) return;
    e.preventDefault();
    setOuverts(suite.ouverts);
    setFocus(suite.focus);
    setDoitFocaliser(true);
  }

  const rendu = (liste: NoeudArbre[]): React.ReactElement[] =>
    liste.map((n) => {
      const v = parNiveau.get(n.id);
      const aEnfants = n.enfants.length > 0;
      const ouvert = ouverts.has(n.id);
      const Icone = n.type === 'service' ? Building2 : User;
      return (
        <li
          key={n.id}
          ref={(el) => {
            if (el) refs.current.set(n.id, el);
            else refs.current.delete(n.id);
          }}
          role="treeitem"
          aria-level={v?.niveau}
          aria-setsize={v?.freres}
          aria-posinset={v?.position}
          aria-expanded={aEnfants ? ouvert : undefined}
          aria-selected={focus === n.id}
          aria-label={[n.titre, n.detail].filter(Boolean).join(', ')}
          tabIndex={focus === n.id ? 0 : -1}
          onFocus={(e) => {
            if (e.target === e.currentTarget) setFocus(n.id);
          }}
          className="outline-none [&:focus-visible>div]:ring-2 [&:focus-visible>div]:ring-[var(--accent)]"
        >
          <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 hover:bg-[var(--surface-muted)]">
            {aEnfants ? (
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-[var(--foreground-muted)]"
                onClick={() => basculer(n.id)}
              >
                {ouvert ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : (
              <span className="h-6 w-6 shrink-0" aria-hidden="true" />
            )}
            <Icone
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 ${n.type === 'service' ? 'text-[var(--module-run)]' : 'text-[var(--foreground-muted)]'}`}
            />
            <span className="flex min-w-0 flex-col">
              {n.lien ? (
                <Link
                  href={n.lien}
                  tabIndex={-1}
                  className="font-medium break-words underline-offset-2 hover:underline"
                >
                  {n.titre}
                </Link>
              ) : (
                <span
                  className={`break-words ${n.type === 'service' ? 'font-semibold' : 'font-medium'}`}
                >
                  {n.titre}
                </span>
              )}
              {n.detail ? (
                <span className="text-xs break-words text-[var(--foreground-muted)]">
                  {n.detail}
                </span>
              ) : null}
            </span>
          </div>
          {aEnfants && ouvert ? (
            <ul role="group" className="ml-3 border-l border-[var(--border)] pl-2 sm:ml-5 sm:pl-3">
              {rendu(n.enfants)}
            </ul>
          ) : null}
        </li>
      );
    });

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BOUTON_PETIT}
          onClick={() => setOuverts(tousLesParents(racines))}
        >
          Tout déplier
        </button>
        <button type="button" className={BOUTON_PETIT} onClick={() => setOuverts(new Set())}>
          Tout replier
        </button>
        <p className="text-xs text-[var(--foreground-muted)] self-center">
          Au clavier : flèches pour se déplacer, droite et gauche pour déplier et replier, Entrée
          pour ouvrir une fiche.
        </p>
      </div>
      <ul
        role="tree"
        aria-label={`Organigramme, ${libelle.toLowerCase()}`}
        onKeyDown={clavier}
        className="text-sm"
      >
        {rendu(racines)}
      </ul>
    </div>
  );
}
