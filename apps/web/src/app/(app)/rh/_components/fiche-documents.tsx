'use client';

// Onglet « Documents » de la fiche collaborateur (ADR-0045 § 2.8, § 3.3), lot H7.
// Liste sans contenu ; une pièce sensible porte un badge et le dit en texte.
// Envoi en fenêtre modale : le fichier et ses métadonnées partent dans un
// formulaire multipart, rien dans l'URL. Téléchargement inerte (l'API sert la pièce
// en pièce jointe) ; l'expiration est rappelée, le délai restant vit dans
// « Échéances ».
//
// ADR-0074 : catégorie en `Select`, dates en `DatePicker`, grille sémantique,
// options en interrupteurs. Mêmes champs envoyés, même `validerDocument`.

import {
  Badge,
  DatePicker,
  Field,
  FormGrid,
  Modal,
  Select,
  Switch,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { Download, FileText, Lock, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { hrAdminApi, type HrDocumentView } from '@/lib/api-hr-admin';

import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';

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
      <FormGrid>
        <Field id={`${id}-fichier`} label="Fichier" required size="full">
          <TextInput
            type="file"
            accept={ACCEPT_DOCUMENT}
            className="py-1.5"
            onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field
          id={`${id}-categorie`}
          label="Catégorie"
          required
          size="md"
          newRow
          disabled={categories.length === 1}
        >
          <Select<FormDocument['category']>
            value={f.category}
            onChange={(v) => setF(changerCategorie(f, v))}
            options={categories.map((c) => ({ value: c, label: LIBELLES_CATEGORIE[c] }))}
          />
        </Field>
        <Field id={`${id}-libelle`} label="Libellé" required size="md">
          <TextInput
            value={f.label}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => setF({ ...f, label: e.target.value })}
          />
        </Field>
        <Field id={`${id}-emis`} label="Délivré le" optional size="sm" newRow>
          <DatePicker
            value={f.issuedOn}
            onChange={(v) => setF({ ...f, issuedOn: v })}
            shortcuts={['today']}
          />
        </Field>
        <Field
          id={`${id}-expire`}
          label="Expire le"
          optional
          size="sm"
          hint="Un rappel est envoyé avant l’expiration."
        >
          <DatePicker
            value={f.expiresOn}
            onChange={(v) => setF({ ...f, expiresOn: v })}
            shortcuts={['endOfYear']}
          />
        </Field>
      </FormGrid>
      <Switch
        label="Pièce sensible"
        description={
          sensibleImpose
            ? 'Toujours sensible pour cette catégorie : la pièce est chiffrée par Lalanda.'
            : 'Chiffrée par Lalanda et réservée aux personnes habilitées.'
        }
        checked={f.sensitive}
        disabled={sensibleImpose}
        onChange={(v) => setF({ ...f, sensitive: v })}
      />
      {categories.length > 1 ? (
        <Switch
          label="Visible du collaborateur dans son espace"
          checked={f.visibleToEmployee}
          onChange={(v) => setF({ ...f, visibleToEmployee: v })}
        />
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
