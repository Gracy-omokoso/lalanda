'use client';

// Dépôt d'un document (ADR-0046 § 4.2, § 4.3), dans le `Modal` de `@lalanda/ui`.
// Le fichier ET ses métadonnées partent ensemble en `multipart/form-data`, dans le
// corps : rien dans l'URL ni dans un en-tête. Seuls les PDF et les images sont
// acceptés ; un autre type est refusé avant l'envoi, avec un message clair.
// Réutilisé par la bibliothèque et par les panneaux « Documents » des fiches.

import {
  Button,
  Checkbox,
  DatePicker,
  Field,
  FormGrid,
  Modal,
  Select,
  SubmitButton,
  TextInput,
} from '@lalanda/ui';
import { Link2, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { ChoixEntite, type OptionEntite } from '@/components/choix-entite';
import {
  documentsApi,
  type DocumentFolderView,
  type DocumentNature,
  type LibraryDocumentDetail,
} from '@/lib/api-documents';

import { useShell } from '../../_components/shell-context';
import { Alerte, CHAMP, aria } from '../../ventes/_components/form-ui';

import { optionsDossiers } from './arbre-model';
import {
  ACCEPT_DOCUMENT,
  LIBELLES_ENTITE,
  LIBELLES_NATURE,
  PHRASE_TYPES,
  entitesLiables,
  formulaireDepot,
  messageDocuments,
  peutGererDocuments,
  preparerDepot,
  titreDepuisFichier,
  validerFichier,
  type EntiteLiable,
  type FormulaireDepot,
} from './documents-model';
import { ChampNombre } from './documents-ui';

/** Liens d'un document en cours de saisie : ajout par recherche, retrait. */
export function EditeurLiens({
  liens,
  onChange,
  verrouilles = [],
}: {
  liens: FormulaireDepot['links'];
  onChange: (l: FormulaireDepot['links']) => void;
  /** Liens imposés par la fiche d'où l'on dépose (non retirables). */
  verrouilles?: readonly string[];
}): React.ReactElement {
  const id = useId();
  const { actions, organizationId } = useShell();
  const types = entitesLiables(actions);
  const [type, setType] = useState<EntiteLiable>(types[0] ?? 'supplier');
  const [choix, setChoix] = useState<OptionEntite | null>(null);
  const cle = (l: { entityType: string; entityId: string }): string =>
    `${l.entityType}:${l.entityId}`;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">Éléments liés</legend>
      {liens.length === 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">Aucun élément lié.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {liens.map((l) => (
            <li
              key={cle(l)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1 text-xs"
            >
              <Link2 aria-hidden="true" className="h-3 w-3" />
              {LIBELLES_ENTITE[l.entityType]} : {l.label}
              {verrouilles.includes(cle(l)) ? null : (
                <button
                  type="button"
                  className="ml-1 rounded-full p-0.5 hover:bg-[var(--surface-muted)]"
                  aria-label={`Retirer le lien ${l.label}`}
                  onClick={() => onChange(liens.filter((x) => cle(x) !== cle(l)))}
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {types.length > 0 && liens.length < 10 ? (
        <FormGrid>
          <Field label="Type d’élément" size="sm">
            <Select<EntiteLiable>
              value={type}
              onChange={(t) => {
                setType(t);
                setChoix(null);
              }}
              options={types.map((t) => ({ value: t, label: LIBELLES_ENTITE[t] }))}
            />
          </Field>
          <Field id={`${id}-entite`} label="Élément" size="lg">
            <ChoixEntite
              key={type}
              id={`${id}-entite`}
              type={type}
              organizationId={organizationId}
              valeur={choix?.id ?? ''}
              onChange={setChoix}
            />
          </Field>
          <div className="flex items-end @lg:col-span-12">
            <Button
              size="sm"
              disabled={choix === null}
              className="max-sm:h-11"
              onClick={() => {
                if (choix === null) return;
                const l = { entityType: type, entityId: choix.id, label: choix.label };
                if (!liens.some((x) => cle(x) === cle(l))) onChange([...liens, l]);
                setChoix(null);
              }}
            >
              Lier
            </Button>
          </div>
        </FormGrid>
      ) : null}
    </fieldset>
  );
}

export function DepotDocument({
  open,
  onFermer,
  onEnvoye,
  dossierInitial = '',
  liensInitiaux = [],
}: {
  open: boolean;
  onFermer: () => void;
  onEnvoye: (d: LibraryDocumentDetail) => void;
  dossierInitial?: string;
  liensInitiaux?: FormulaireDepot['links'];
}): React.ReactElement | null {
  if (!open) return null;
  return (
    <ModalDepot
      onFermer={onFermer}
      onEnvoye={onEnvoye}
      dossierInitial={dossierInitial}
      liensInitiaux={liensInitiaux}
    />
  );
}

function ModalDepot({
  onFermer,
  onEnvoye,
  dossierInitial,
  liensInitiaux,
}: {
  onFermer: () => void;
  onEnvoye: (d: LibraryDocumentDetail) => void;
  dossierInitial: string;
  liensInitiaux: FormulaireDepot['links'];
}): React.ReactElement {
  const id = useId();
  const { actions } = useShell();
  const gerer = peutGererDocuments(actions);
  const [dossiers, setDossiers] = useState<DocumentFolderView[]>([]);
  const [f, setF] = useState<FormulaireDepot>(() => formulaireDepot(dossierInitial, liensInitiaux));
  const [fichier, setFichier] = useState<File | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const verrouilles = liensInitiaux.map((l) => `${l.entityType}:${l.entityId}`);

  useEffect(() => {
    let annule = false;
    documentsApi
      .listFolders()
      .then((r) => {
        if (!annule) setDossiers(r.items);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  function choisirFichier(fi: File | null): void {
    setFichier(fi);
    const e = fi ? validerFichier(fi) : null;
    setChamps((c) => ({ ...c, fichier: e ?? '' }));
    if (fi && f.title.trim() === '') setF((p) => ({ ...p, title: titreDepuisFichier(fi.name) }));
  }

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setErreur(null);
    const p = preparerDepot(f, fichier, gerer);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok || fichier === null) return;
    setEnvoi(true);
    try {
      onEnvoye(await documentsApi.upload(p.meta, fichier));
    } catch (err) {
      setErreur(messageDocuments(err, 'Le document n’a pas pu être déposé.'));
    } finally {
      setEnvoi(false);
    }
  }

  const options = optionsDossiers(dossiers, true);

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title="Déposer un document"
      description={`${PHRASE_TYPES} Le fichier et ses informations partent ensemble, dans le corps de l’envoi.`}
      size="lg"
    >
      <form noValidate onSubmit={(e) => void envoyer(e)} className="flex flex-col gap-4">
        <FormGrid>
          <Field
            id={`${id}-fichier`}
            label="Fichier"
            required
            size="full"
            error={champs['fichier'] || undefined}
          >
            <input
              id={`${id}-fichier`}
              type="file"
              accept={ACCEPT_DOCUMENT}
              className={`${CHAMP} max-sm:text-base`}
              onChange={(e) => choisirFichier(e.target.files?.[0] ?? null)}
              aria-required="true"
              {...aria(`${id}-fichier`, champs['fichier'] || undefined)}
            />
          </Field>
          <Field id={`${id}-titre`} label="Titre" required size="full" error={champs['title']}>
            <TextInput
              value={f.title}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </Field>
          <Field
            id={`${id}-dossier`}
            label="Dossier"
            size="lg"
            required={!gerer}
            error={champs['folderId']}
          >
            <Select<string>
              value={f.folderId}
              onChange={(folderId) => setF({ ...f, folderId })}
              options={[
                {
                  value: '',
                  label: gerer ? 'Sans dossier (seulement lié)' : 'Choisir un dossier',
                },
                ...options.map((o) => ({ value: o.id, label: o.label })),
              ]}
            />
          </Field>
          <Field id={`${id}-nature`} label="Nature" size="md">
            <Select<DocumentNature>
              value={f.nature}
              onChange={(nature) => setF({ ...f, nature })}
              options={(Object.entries(LIBELLES_NATURE) as [DocumentNature, string][]).map(
                ([k, l]) => ({ value: k, label: l }),
              )}
            />
          </Field>
          <Field id={`${id}-emis`} label="Délivré le" size="sm" newRow>
            <DatePicker value={f.issuedOn} onChange={(issuedOn) => setF({ ...f, issuedOn })} />
          </Field>
          <Field id={`${id}-expire`} label="Expire le" size="sm" error={champs['expiresOn']}>
            <DatePicker
              value={f.expiresOn}
              shortcuts={['endOfMonth', 'plus30', 'endOfYear']}
              onChange={(expiresOn) => setF({ ...f, expiresOn })}
            />
          </Field>
          {f.expiresOn ? (
            <Field
              id={`${id}-rappel`}
              label="Rappel (jours avant l’expiration)"
              hint="Vide : 30 jours."
              size="sm"
              error={champs['reminderDays']}
            >
              <ChampNombre
                entier
                value={f.reminderDays}
                onChange={(e) => setF({ ...f, reminderDays: e.target.value })}
              />
            </Field>
          ) : null}
          <Field
            id={`${id}-tags`}
            label="Étiquettes"
            hint="Séparées par des virgules, 10 au plus."
            size="lg"
            newRow
            error={champs['tags']}
          >
            <TextInput
              value={f.tags}
              autoComplete="off"
              placeholder="fiscal, 2026"
              onChange={(e) => setF({ ...f, tags: e.target.value })}
            />
          </Field>
        </FormGrid>
        <EditeurLiens
          liens={f.links}
          verrouilles={verrouilles}
          onChange={(links) => setF({ ...f, links })}
        />
        {gerer ? (
          <Checkbox
            checked={f.sensitive}
            onChange={(sensitive) => setF({ ...f, sensitive })}
            aria-invalid={champs['sensitive'] ? true : undefined}
            label={<span className="font-medium">Document sensible</span>}
            description="Chiffré par Lalanda ; chaque téléchargement est journalisé. Ne change plus après le dépôt."
          />
        ) : null}
        {champs['sensitive'] ? (
          <p className="text-xs text-[var(--danger)]">{champs['sensitive']}</p>
        ) : null}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button size="sm" onClick={onFermer} disabled={envoi} className="max-sm:h-11">
            Annuler
          </Button>
          <SubmitButton size="sm" busy={envoi} busyLabel="Envoi…" className="max-sm:h-11">
            Déposer
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
