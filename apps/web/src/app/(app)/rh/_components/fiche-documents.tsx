'use client';

// Onglet « Documents » de la fiche collaborateur (ADR-0045 § 2.8, § 3.3), lot H7.
// Liste sans contenu ; une pièce sensible porte un badge et le dit en texte.
// Envoi en fenêtre modale : le fichier et ses métadonnées partent dans un
// formulaire multipart, rien dans l'URL. Téléchargement inerte (l'API sert la pièce
// en pièce jointe) ; l'expiration est rappelée, le délai restant vit dans
// « Échéances ».

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { Download, FileText, Lock, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { hrAdminApi, type HrDocumentView } from '@/lib/api-hr-admin';

import {
  Alerte,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Champ,
} from '../../ventes/_components/form-ui';

import {
  ACCEPT_DOCUMENT,
  LIBELLES_CATEGORIE,
  PHRASE_SENSIBLE,
  categoriesProposees,
  changerCategorie,
  detailDocument,
  formDocument,
  libelleExpiration,
  peutDeposer,
  peutSupprimerDocument,
  validerDocument,
  type FormDocument,
} from './documents-model';
import { useFiche } from './fiche-chrome';
import { useAccesRh } from './rh-access';
import { RH_BASE, aujourdhui, lire, messageRh, peutLireRh, type Lecture } from './rh-model';
import {
  Chargement,
  DialogueDecision,
  EchecLecture,
  Panneau,
  PhraseSection,
  enregistrerFichier,
} from './rh-ui';

export function FicheDocuments(): React.ReactElement {
  const { fiche } = useFiche();
  const { actions, moi } = useAccesRh();
  const estSoi = moi?.ok === true && moi.valeur.employee?.id === fiche.id;
  const categories = categoriesProposees(actions, estSoi);
  const deposer =
    peutDeposer(actions, estSoi) && categories.length > 0 && fiche.status !== 'anonymized';
  const [lecture, setLecture] = useState<Lecture<HrDocumentView[]> | null>(null);
  const [version, setVersion] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const [aSupprimer, setASupprimer] = useState<HrDocumentView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const jour = aujourdhui();

  useEffect(() => {
    let annule = false;
    void lire(hrAdminApi.listDocuments(fiche.id).then((p) => p.items)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [fiche.id, version]);

  async function telecharger(d: HrDocumentView): Promise<void> {
    setErreur(null);
    setOccupe(d.id);
    try {
      const f = await hrAdminApi.downloadDocument(d);
      enregistrerFichier(f.blob, f.nom);
    } catch (err) {
      setErreur(messageRh(err, 'Le document n’a pas pu être téléchargé.'));
    } finally {
      setOccupe(null);
    }
  }

  return (
    <>
      <Panneau
        titre="Documents"
        icone={FileText}
        id="rh-fiche-documents"
        action={
          deposer ? (
            <button
              type="button"
              className={buttonClasses('secondary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setEnvoi(true)}
            >
              <Upload aria-hidden="true" className="mr-1 h-4 w-4" />
              {categories.length === 1 ? 'Déposer un justificatif' : 'Déposer un document'}
            </button>
          ) : null
        }
      >
        {peutLireRh(actions) ? (
          <p className="text-xs text-[var(--foreground-muted)]">
            Les dates d’expiration alimentent les{' '}
            <Link href={`${RH_BASE}/echeances`} className="underline underline-offset-2">
              échéances
            </Link>
            .
          </p>
        ) : null}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {lecture === null ? (
          <Chargement texte="Chargement des documents…" />
        ) : !lecture.ok ? (
          <EchecLecture
            erreur={lecture.erreur}
            repli="Les documents sont illisibles."
            onReessayer={() => setVersion((v) => v + 1)}
          />
        ) : lecture.valeur.length === 0 ? (
          <PhraseSection>Aucun document visible pour vous sur cette fiche.</PhraseSection>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {lecture.valeur.map((d) => {
              const exp = libelleExpiration(d.expiresOn, jour);
              return (
                <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium break-words">{d.label}</span>
                      {d.sensitive ? (
                        <Badge tone="warning">
                          <Lock aria-hidden="true" className="mr-1 inline h-3 w-3" />
                          Sensible
                        </Badge>
                      ) : null}
                      {exp ? (
                        <Badge tone={exp.expire ? 'danger' : 'neutral'}>{exp.texte}</Badge>
                      ) : null}
                    </span>
                    <span className="text-xs break-words text-[var(--foreground-muted)]">
                      {detailDocument(d)}
                      {d.visibleToEmployee ? ' · visible du collaborateur' : ''}
                    </span>
                    {d.sensitive ? (
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {PHRASE_SENSIBLE}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      disabled={occupe === d.id}
                      onClick={() => void telecharger(d)}
                    >
                      <Download aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                      {occupe === d.id ? 'Téléchargement…' : 'Télécharger'}
                      <span className="sr-only"> {d.label}</span>
                    </button>
                    {peutSupprimerDocument(actions, d) ? (
                      <button
                        type="button"
                        className={BOUTON_DANGER}
                        aria-haspopup="dialog"
                        onClick={() => setASupprimer(d)}
                      >
                        <Trash2 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                        Supprimer<span className="sr-only"> {d.label}</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panneau>

      <Modal
        open={envoi}
        onClose={() => setEnvoi(false)}
        title={categories.length === 1 ? 'Déposer un justificatif' : 'Déposer un document'}
        description="PDF (10 Mo au plus) ou image PNG, JPEG, WebP (2 Mo au plus). Le fichier et ses informations sont envoyés ensemble, dans le corps de la requête."
        size="md"
      >
        <EnvoiDocument
          employeeId={fiche.id}
          categories={categories}
          onAnnuler={() => setEnvoi(false)}
          onEnvoye={() => {
            setEnvoi(false);
            setVersion((v) => v + 1);
          }}
        />
      </Modal>

      {aSupprimer ? (
        <DialogueDecision
          titre="Supprimer ce document ?"
          description={`${aSupprimer.label} — ${LIBELLES_CATEGORIE[aSupprimer.category]}`}
          libelle=""
          bouton="Supprimer"
          commentaire="aucun"
          onFermer={() => setASupprimer(null)}
          onValider={async () => {
            await hrAdminApi.deleteDocument(aSupprimer.id);
            setASupprimer(null);
            setVersion((v) => v + 1);
          }}
        >
          <p>Le fichier est effacé du stockage. Cette suppression est journalisée.</p>
        </DialogueDecision>
      ) : null}
    </>
  );
}

function EnvoiDocument({
  employeeId,
  categories,
  onAnnuler,
  onEnvoye,
}: {
  employeeId: string;
  categories: ReturnType<typeof categoriesProposees>;
  onAnnuler: () => void;
  onEnvoye: () => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormDocument>(() => formDocument(categories[0] ?? 'other'));
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const sensibleImpose = formDocument(f.category).sensitive;

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const r = validerDocument(f, fichier, categories);
    if (!r.ok || fichier === null) {
      setErreurs(r.ok ? ['Choisissez un fichier.'] : r.erreurs);
      return;
    }
    setErreurs([]);
    setEnvoi(true);
    try {
      await hrAdminApi.uploadDocument(employeeId, r.meta, fichier);
      onEnvoye();
    } catch (err) {
      setErreurs([messageRh(err, 'Le document n’a pas pu être envoyé.')]);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <Champ id={`${id}-fichier`} label="Fichier" requis>
        <input
          id={`${id}-fichier`}
          type="file"
          accept={ACCEPT_DOCUMENT}
          className={CHAMP}
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
        />
      </Champ>
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ id={`${id}-categorie`} label="Catégorie" requis>
          <select
            id={`${id}-categorie`}
            className={CHAMP}
            value={f.category}
            disabled={categories.length === 1}
            onChange={(e) => setF(changerCategorie(f, e.target.value as FormDocument['category']))}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {LIBELLES_CATEGORIE[c]}
              </option>
            ))}
          </select>
        </Champ>
        <Champ id={`${id}-libelle`} label="Libellé" requis>
          <input
            id={`${id}-libelle`}
            className={CHAMP}
            value={f.label}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => setF({ ...f, label: e.target.value })}
          />
        </Champ>
        <Champ id={`${id}-emis`} label="Délivré le">
          <input
            id={`${id}-emis`}
            type="date"
            className={CHAMP}
            value={f.issuedOn}
            onChange={(e) => setF({ ...f, issuedOn: e.target.value })}
          />
        </Champ>
        <Champ
          id={`${id}-expire`}
          label="Expire le"
          aide="Facultatif. Un rappel est envoyé avant l’expiration."
        >
          <input
            id={`${id}-expire`}
            type="date"
            className={CHAMP}
            value={f.expiresOn}
            onChange={(e) => setF({ ...f, expiresOn: e.target.value })}
          />
        </Champ>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={f.sensitive}
          disabled={sensibleImpose}
          onChange={(e) => setF({ ...f, sensitive: e.target.checked })}
        />
        <span>
          <span className="font-medium">Pièce sensible</span>
          <span className="block text-xs text-[var(--foreground-muted)]">
            {sensibleImpose
              ? 'Toujours sensible pour cette catégorie : la pièce est chiffrée par Lalanda.'
              : 'Chiffrée par Lalanda et réservée aux personnes habilitées.'}
          </span>
        </span>
      </label>
      {categories.length > 1 ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={f.visibleToEmployee}
            onChange={(e) => setF({ ...f, visibleToEmployee: e.target.checked })}
          />
          <span className="font-medium">Visible du collaborateur dans son espace</span>
        </label>
      ) : null}
      {erreurs.length > 0 ? (
        <Alerte>
          <ul className="list-disc pl-4">
            {erreurs.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
          {envoi ? 'Envoi…' : 'Envoyer'}
        </button>
      </div>
    </form>
  );
}
