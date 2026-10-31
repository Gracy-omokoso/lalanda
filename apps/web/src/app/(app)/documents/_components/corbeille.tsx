'use client';

// Corbeille — ADR-0046 § 4.2 : documents archivés, restauration, suppression
// définitive avec confirmation (les fichiers sont effacés du stockage 30 jours plus
// tard par `documents.purge`). Seul un rôle qui peut écrire le document agit.

import { Modal, buttonClasses } from '@lalanda/ui';
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { documentsApi, type LibraryDocumentView } from '@/lib/api-documents';

import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  CORPS_CORBEILLE,
  DOCUMENTS_BASE,
  LIBELLES_NATURE,
  formatInstantJour,
  lire,
  messageDocuments,
  type Lecture,
} from './documents-model';
import { Bandeau, BadgeSensible, CarteVide, Chargement, EchecLecture } from './documents-ui';

export function Corbeille(): React.ReactElement {
  const [lecture, setLecture] = useState<Lecture<LibraryDocumentView[]> | null>(null);
  const [version, setVersion] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [aSupprimer, setASupprimer] = useState<LibraryDocumentView | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(
      documentsApi
        .search(CORPS_CORBEILLE)
        .then((p) => p.items.filter((d) => d.status === 'archived')),
    ).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [version]);

  async function restaurer(d: LibraryDocumentView): Promise<void> {
    setErreur(null);
    setOccupe(d.id);
    try {
      await documentsApi.restore(d.id, d.revision);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreur(messageDocuments(err, 'Restauration impossible.'));
    } finally {
      setOccupe(null);
    }
  }

  async function supprimer(d: LibraryDocumentView): Promise<void> {
    setErreur(null);
    setOccupe(d.id);
    try {
      await documentsApi.remove(d.id);
      setASupprimer(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreur(messageDocuments(err, 'Suppression impossible.'));
    } finally {
      setOccupe(null);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Link
        href={DOCUMENTS_BASE}
        className="inline-flex items-center gap-1 self-start text-sm underline underline-offset-2"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Bibliothèque
      </Link>
      <Bandeau
        icone={Trash2}
        titre="Corbeille"
        sousTitre="Documents retirés de la bibliothèque : restaurez-les, ou supprimez-les pour de bon."
      />
      {erreur && aSupprimer === null ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="La corbeille est illisible." />
      ) : lecture.valeur.length === 0 ? (
        <CarteVide>La corbeille est vide.</CarteVide>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm">
          {lecture.valeur.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{d.title}</span>
                  {d.sensitive ? <BadgeSensible /> : null}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {LIBELLES_NATURE[d.nature]} · modifié le {formatInstantJour(d.updatedAt)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  disabled={occupe === d.id}
                  onClick={() => void restaurer(d)}
                >
                  <RotateCcw aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                  Restaurer<span className="sr-only"> {d.title}</span>
                </button>
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setErreur(null);
                    setASupprimer(d);
                  }}
                >
                  Supprimer<span className="sr-only"> {d.title}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {aSupprimer ? (
        <Modal
          open
          onClose={() => setASupprimer(null)}
          busy={occupe === aSupprimer.id}
          title="Supprimer définitivement ?"
          description={aSupprimer.title}
          size="sm"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={BOUTON_PETIT} onClick={() => setASupprimer(null)}>
                Retour
              </button>
              <button
                type="button"
                className={buttonClasses('danger', 'sm')}
                disabled={occupe === aSupprimer.id}
                onClick={() => void supprimer(aSupprimer)}
              >
                Supprimer
              </button>
            </div>
          }
        >
          <p className="text-sm">
            Le document et toutes ses versions disparaissent ; les fichiers sont effacés du stockage
            30 jours plus tard. La suppression est journalisée.
          </p>
          {erreur ? (
            <Alerte>
              <p>{erreur}</p>
            </Alerte>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}
