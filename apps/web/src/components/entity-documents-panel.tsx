'use client';

// Panneau « Documents » d'une fiche (ADR-0046 § 6.8, présentation O5 ; lot S9) :
// documents de la bibliothèque liés à l'entité ET pièces des modules propriétaires
// (factures et réceptions d'achats, pièces de projets), chacune filtrée par sa
// propre permission côté API ; jamais une pièce RH. Dépôt d'un document lié en
// fenêtre modale (multipart). La requête ne porte que le type et l'identifiant.
// Réutilisable : une insertion d'une ligne par fiche.

import { buttonClasses } from '@lalanda/ui';
import { Download, Paperclip, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  documentsApi,
  type DocumentFolderView,
  type DocumentLinkEntityType,
  type EntityPieceView,
  type EntityPiecesView,
} from '@/lib/api-documents';

import { useShell } from '../app/(app)/_components/shell-context';
import { DepotDocument } from '../app/(app)/documents/_components/depot-document';
import {
  formatInstantJour,
  formatTaille,
  lire,
  messageDocuments,
  peutDeposer,
  peutLireDocuments,
  type Lecture,
} from '../app/(app)/documents/_components/documents-model';
import {
  CarteDocument,
  Chargement,
  EchecLecture,
  Panneau,
  PhraseSection,
  enregistrerFichier,
} from '../app/(app)/documents/_components/documents-ui';
import { Alerte, BOUTON_PETIT } from '../app/(app)/ventes/_components/form-ui';

const ORIGINE: Record<EntityPieceView['ownerType'], string> = {
  supplier_invoice: 'Facture fournisseur',
  purchase_reception: 'Réception',
  work_task: 'Tâche de projet',
};

export function EntityDocumentsPanel({
  entityType,
  entityId,
  libelle = 'cette fiche',
  className,
}: {
  entityType: DocumentLinkEntityType;
  entityId: string;
  /** Nom de l'élément, pour le lien prérempli du dépôt. */
  libelle?: string;
  className?: string;
}): React.ReactElement | null {
  const { actions } = useShell();
  const lireDocs = peutLireDocuments(actions);
  const [lecture, setLecture] = useState<Lecture<EntityPiecesView> | null>(null);
  const [dossiers, setDossiers] = useState<DocumentFolderView[]>([]);
  const [version, setVersion] = useState(0);
  const [depot, setDepot] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  useEffect(() => {
    if (!lireDocs) return;
    let annule = false;
    void lire(documentsApi.entityPieces(entityType, entityId)).then((l) => {
      if (!annule) setLecture(l);
    });
    documentsApi
      .listFolders()
      .then((r) => {
        if (!annule) setDossiers(r.items);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [lireDocs, entityType, entityId, version]);

  if (!lireDocs) return null;

  async function telechargerPiece(p: EntityPieceView): Promise<void> {
    setErreur(null);
    setOccupe(p.href);
    try {
      const f = await documentsApi.downloadPiece(p.href, p.fileName);
      enregistrerFichier(f.blob, f.nom);
    } catch (err) {
      setErreur(messageDocuments(err, 'La pièce n’a pas pu être téléchargée.'));
    } finally {
      setOccupe(null);
    }
  }

  const vide =
    lecture?.ok === true &&
    lecture.valeur.library.length === 0 &&
    lecture.valeur.pieces.length === 0;

  return (
    <Panneau
      titre="Documents"
      icone={Paperclip}
      id={`documents-${entityType}`}
      className={className ?? ''}
      action={
        peutDeposer(actions, dossiers) ? (
          <button
            type="button"
            className={buttonClasses('secondary', 'sm')}
            aria-haspopup="dialog"
            onClick={() => setDepot(true)}
          >
            <Upload aria-hidden="true" className="h-4 w-4" />
            Déposer
          </button>
        ) : null
      }
    >
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="Les documents sont illisibles." />
      ) : vide ? (
        <PhraseSection>Aucun document lié.</PhraseSection>
      ) : (
        <>
          {lecture.valeur.library.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {lecture.valeur.library.map((d) => (
                <li key={d.id}>
                  <CarteDocument d={d} />
                </li>
              ))}
            </ul>
          ) : null}
          {lecture.valeur.pieces.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-[var(--foreground-muted)]">
                Pièces jointes des autres modules
              </p>
              <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
                {lecture.valeur.pieces.map((p) => (
                  <li key={p.href} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="break-words">{p.fileName}</span>
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {ORIGINE[p.ownerType]}
                        {p.ownerReference ? ` ${p.ownerReference}` : ''} · {formatTaille(p.size)} ·{' '}
                        {formatInstantJour(p.uploadedAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      disabled={occupe === p.href}
                      onClick={() => void telechargerPiece(p)}
                    >
                      <Download aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                      Télécharger<span className="sr-only"> {p.fileName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      <DepotDocument
        open={depot}
        onFermer={() => setDepot(false)}
        liensInitiaux={[{ entityType, entityId, label: libelle }]}
        onEnvoye={() => {
          setDepot(false);
          setVersion((v) => v + 1);
        }}
      />
    </Panneau>
  );
}
