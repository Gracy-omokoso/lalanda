'use client';

// Bibliothèque — ADR-0046 § 4, § 5.3 : arbre des dossiers (déjà filtré par les droits),
// droits du dossier ouvert, liste, recherche par titre, étiquette et nature (critères
// dans le CORPS de `POST /documents/search`, jamais dans l'URL), dépôt en fenêtre
// modale (multipart). Seul l'identifiant du dossier ouvert figure dans l'adresse.

import { Select, TextInput, buttonClasses } from '@lalanda/ui';
import { Folder, FolderOpen, FolderPlus, Library, Lock, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  documentsApi,
  type DocumentFolderView,
  type DocumentNature,
  type LibraryDocumentView,
} from '@/lib/api-documents';

import { useShell } from '../../_components/shell-context';
import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { arbreDossiers, cheminDossier, resumeAcces, type NoeudDossier } from './arbre-model';
import { DepotDocument } from './depot-document';
import {
  DOCUMENTS_BASE,
  FILTRES_VIDES,
  LIBELLES_NATURE,
  corpsRecherche,
  lienDocument,
  messageDocuments,
  peutDeposer,
  peutGererDocuments,
  type FiltresBibliotheque,
} from './documents-model';
import {
  Bandeau,
  CarteDocument,
  CarteVide,
  Chargement,
  EchecLecture,
  Panneau,
  nomMembre,
  useMembres,
} from './documents-ui';
import { DossierFormulaire } from './dossier-formulaire';

function Arbre({
  noeuds,
  courant,
  onChoisir,
}: {
  noeuds: NoeudDossier[];
  courant: string | null;
  onChoisir: (id: string) => void;
}): React.ReactElement {
  return (
    <ul className="flex flex-col gap-0.5">
      {noeuds.map((n) => {
        const actif = n.dossier.id === courant;
        const restreint = n.dossier.access.read !== 'all';
        return (
          <li key={n.dossier.id}>
            <button
              type="button"
              aria-current={actif ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition hover:bg-[var(--surface-muted)] ${actif ? 'bg-[var(--surface-muted)] font-semibold' : ''}`}
              onClick={() => onChoisir(n.dossier.id)}
            >
              {actif ? (
                <FolderOpen
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--module-run)]"
                />
              ) : (
                <Folder aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--module-run)]" />
              )}
              <span className="min-w-0 flex-1 break-words">{n.dossier.name}</span>
              {restreint ? (
                <Lock
                  aria-label="Accès réservé"
                  className="h-3 w-3 shrink-0 text-[var(--foreground-muted)]"
                />
              ) : null}
            </button>
            {n.enfants.length > 0 ? (
              <div className="ml-4 border-l border-[var(--border)] pl-1">
                <Arbre noeuds={n.enfants} courant={courant} onChoisir={onChoisir} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function Bibliotheque(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions } = useShell();
  const gerer = peutGererDocuments(actions);
  const membres = useMembres();
  const courant = params.get('dossier');
  const [dossiers, setDossiers] = useState<DocumentFolderView[] | null>(null);
  const [erreurDossiers, setErreurDossiers] = useState<unknown>(null);
  const [versionDossiers, setVersionDossiers] = useState(0);
  const [filtres, setFiltres] = useState<FiltresBibliotheque>(FILTRES_VIDES);
  const [items, setItems] = useState<LibraryDocumentView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [depot, setDepot] = useState(false);
  const [editionDossier, setEditionDossier] = useState<DocumentFolderView | 'nouveau' | null>(null);
  const [initialisation, setInitialisation] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    documentsApi
      .listFolders()
      .then((r) => {
        if (annule) return;
        setDossiers(r.items);
        setErreurDossiers(null);
      })
      .catch((err: unknown) => {
        if (annule) return;
        setDossiers([]);
        setErreurDossiers(err);
      });
    return () => {
      annule = true;
    };
  }, [versionDossiers]);

  const charger = useCallback(
    (f: FiltresBibliotheque, dossier: string | null, cursor: string | null) => {
      const corps = corpsRecherche(f, dossier);
      const p = corps
        ? documentsApi.search({ ...corps, ...(cursor ? { cursor } : {}) })
        : documentsApi.list({
            ...(dossier ? { folderId: dossier } : {}),
            ...(cursor ? { cursor } : {}),
            limit: 50,
          });
      p.then((page) => {
        setItems((avant) => (cursor && avant ? [...avant, ...page.items] : page.items));
        setTotal(page.total);
        setSuivante(page.nextCursor);
        setErreur(null);
      }).catch((err: unknown) => {
        setItems([]);
        setErreur(err);
      });
    },
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => charger(filtres, courant, null), 250);
    return () => clearTimeout(t);
  }, [filtres, courant, charger]);

  const choisir = (id: string | null): void => {
    router.replace(id ? `${pathname}?dossier=${encodeURIComponent(id)}` : pathname);
  };

  async function creerProposes(): Promise<void> {
    setInitialisation(null);
    try {
      await documentsApi.createDefaultFolders();
      setVersionDossiers((v) => v + 1);
    } catch (err) {
      setInitialisation(messageDocuments(err, 'Création impossible.'));
    }
  }

  const liste = dossiers ?? [];
  const dossier = courant ? (liste.find((d) => d.id === courant) ?? null) : null;
  const chemin = cheminDossier(liste, courant);
  const nomDossier = (id: string | null): string | null =>
    id ? (liste.find((d) => d.id === id)?.name ?? null) : null;
  const acces = dossier ? resumeAcces(dossier.access, (u) => nomMembre(membres, u)) : null;
  const deposer = peutDeposer(actions, liste);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Library}
        titre="Bibliothèque"
        sousTitre="Statuts, attestations, contrats, polices d’assurance : rangés, datés, retrouvés."
        actions={
          <>
            <Link href={`${DOCUMENTS_BASE}/corbeille`} className={buttonClasses('ghost', 'sm')}>
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Corbeille
            </Link>
            {deposer ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                aria-haspopup="dialog"
                onClick={() => setDepot(true)}
              >
                <Upload aria-hidden="true" className="h-4 w-4" />
                Déposer un document
              </button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <TextInput
            type="search"
            aria-label="Rechercher par titre"
            placeholder="Rechercher par titre…"
            className="lg:max-w-xs"
            value={filtres.texte}
            onChange={(e) => setFiltres({ ...filtres, texte: e.target.value })}
          />
          <TextInput
            type="search"
            aria-label="Étiquette"
            placeholder="Étiquette"
            className="lg:max-w-[10rem]"
            value={filtres.etiquette}
            onChange={(e) => setFiltres({ ...filtres, etiquette: e.target.value })}
          />
          <Select<DocumentNature | ''>
            aria-label="Nature"
            className="w-full lg:max-w-[14rem]"
            value={filtres.nature}
            onChange={(nature) => setFiltres({ ...filtres, nature })}
            options={[
              { value: '', label: 'Toutes les natures' },
              ...(Object.entries(LIBELLES_NATURE) as [DocumentNature, string][]).map(([k, l]) => ({
                value: k,
                label: l,
              })),
            ]}
          />
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">
          La recherche porte sur les titres, étiquettes et natures, jamais sur le contenu des
          fichiers.
        </p>
      </Bandeau>

      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Panneau
          titre="Dossiers"
          icone={Folder}
          id="doc-dossiers"
          action={
            gerer ? (
              <button
                type="button"
                className={BOUTON_PETIT}
                aria-haspopup="dialog"
                aria-label="Nouveau dossier"
                onClick={() => setEditionDossier('nouveau')}
              >
                <FolderPlus aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null
          }
        >
          <button
            type="button"
            aria-current={courant === null ? 'true' : undefined}
            className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-muted)] ${courant === null ? 'bg-[var(--surface-muted)] font-semibold' : ''}`}
            onClick={() => choisir(null)}
          >
            <Library aria-hidden="true" className="h-4 w-4 text-[var(--module-run)]" />
            Tous les documents
          </button>
          {dossiers === null ? (
            <Chargement />
          ) : erreurDossiers ? (
            <EchecLecture erreur={erreurDossiers} repli="Les dossiers sont illisibles." />
          ) : liste.length === 0 ? (
            <div className="flex flex-col gap-2 text-sm text-[var(--foreground-muted)]">
              <p>Aucun dossier.</p>
              {gerer ? (
                <button type="button" className={BOUTON_PETIT} onClick={() => void creerProposes()}>
                  Créer les dossiers proposés
                </button>
              ) : null}
              {initialisation ? (
                <p className="text-xs text-[var(--danger)]">{initialisation}</p>
              ) : null}
            </div>
          ) : (
            <Arbre noeuds={arbreDossiers(liste)} courant={courant} onChoisir={choisir} />
          )}
        </Panneau>

        <div className="flex min-w-0 flex-col gap-4">
          {dossier && acces ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <nav aria-label="Chemin du dossier" className="flex flex-wrap items-center gap-1">
                  {chemin.map((c, i) => (
                    <span key={c.id} className="flex items-center gap-1">
                      {i > 0 ? <span aria-hidden="true">›</span> : null}
                      <button
                        type="button"
                        className="underline-offset-2 hover:underline"
                        onClick={() => choisir(c.id)}
                      >
                        {c.name}
                      </button>
                    </span>
                  ))}
                </nav>
                {gerer ? (
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    aria-haspopup="dialog"
                    onClick={() => setEditionDossier(dossier)}
                  >
                    Modifier le dossier et ses droits
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-[var(--foreground-muted)]">
                Consultation : {acces.lecture}. Dépôt : {acces.ecriture}.
                {dossier.canWrite ? ' Vous pouvez y déposer.' : ''}
              </p>
            </div>
          ) : null}

          {erreur ? (
            <EchecLecture erreur={erreur} repli="Impossible de charger les documents." />
          ) : null}
          {items === null ? (
            <Chargement texte="Chargement des documents…" />
          ) : items.length === 0 ? (
            erreur ? null : (
              <CarteVide>Aucun document ne correspond.</CarteVide>
            )
          ) : (
            <>
              <p className="text-xs text-[var(--foreground-muted)]" aria-live="polite">
                {total} document{total > 1 ? 's' : ''} visible{total > 1 ? 's' : ''}
              </p>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((d) => (
                  <li key={d.id}>
                    <CarteDocument d={d} dossier={courant ? null : nomDossier(d.folderId)} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {suivante ? (
            <button
              type="button"
              className={`${BOUTON_PETIT} self-center`}
              onClick={() => charger(filtres, courant, suivante)}
            >
              Afficher plus de documents
            </button>
          ) : null}
        </div>
      </div>

      <DepotDocument
        open={depot}
        onFermer={() => setDepot(false)}
        dossierInitial={dossier?.canWrite ? dossier.id : ''}
        onEnvoye={(d) => {
          setDepot(false);
          router.push(lienDocument(d.id));
        }}
      />
      {editionDossier !== null ? (
        <DossierFormulaire
          dossier={editionDossier === 'nouveau' ? null : editionDossier}
          parentInitial={courant ?? ''}
          dossiers={liste}
          membres={membres}
          onFermer={() => setEditionDossier(null)}
          onFait={(d) => {
            setEditionDossier(null);
            setVersionDossiers((v) => v + 1);
            choisir(d.id);
          }}
        />
      ) : null}
    </section>
  );
}
