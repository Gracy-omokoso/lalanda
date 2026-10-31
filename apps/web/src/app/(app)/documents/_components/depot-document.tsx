'use client';

// Dépôt d'un document (ADR-0046 § 4.2, § 4.3), dans le `Modal` de `@lalanda/ui`.
// Le fichier ET ses métadonnées partent ensemble en `multipart/form-data`, dans le
// corps : rien dans l'URL ni dans un en-tête. Seuls les PDF et les images sont
// acceptés ; un autre type est refusé avant l'envoi, avec un message clair.
// Réutilisé par la bibliothèque et par les panneaux « Documents » des fiches.

import { Modal, buttonClasses } from '@lalanda/ui';
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
import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

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
        <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr_auto] sm:items-end">
          <select
            aria-label="Type d’élément"
            className={CHAMP}
            value={type}
            onChange={(e) => {
              setType(e.target.value as EntiteLiable);
              setChoix(null);
            }}
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {LIBELLES_ENTITE[t]}
              </option>
            ))}
          </select>
          <ChoixEntite
            key={type}
            id={`${id}-entite`}
            type={type}
            organizationId={organizationId}
            valeur={choix?.id ?? ''}
            onChange={setChoix}
          />
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={choix === null}
            onClick={() => {
              if (choix === null) return;
              const l = { entityType: type, entityId: choix.id, label: choix.label };
              if (!liens.some((x) => cle(x) === cle(l))) onChange([...liens, l]);
              setChoix(null);
            }}
          >
            Lier
          </button>
        </div>
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
        <Champ id={`${id}-fichier`} label="Fichier" requis erreur={champs['fichier'] || undefined}>
          <input
            id={`${id}-fichier`}
            type="file"
            accept={ACCEPT_DOCUMENT}
            className={CHAMP}
            onChange={(e) => choisirFichier(e.target.files?.[0] ?? null)}
            {...aria(`${id}-fichier`, champs['fichier'] || undefined)}
          />
        </Champ>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Champ id={`${id}-titre`} label="Titre" requis erreur={champs['title']}>
              <input
                id={`${id}-titre`}
                className={CHAMP}
                value={f.title}
                maxLength={200}
                autoComplete="off"
                onChange={(e) => setF({ ...f, title: e.target.value })}
                {...aria(`${id}-titre`, champs['title'])}
              />
            </Champ>
          </div>
          <Champ id={`${id}-dossier`} label="Dossier" erreur={champs['folderId']}>
            <select
              id={`${id}-dossier`}
              className={CHAMP}
              value={f.folderId}
              onChange={(e) => setF({ ...f, folderId: e.target.value })}
              {...aria(`${id}-dossier`, champs['folderId'])}
            >
              {gerer ? (
                <option value="">Sans dossier (seulement lié)</option>
              ) : (
                <option value="">Choisir un dossier</option>
              )}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Champ>
          <Champ id={`${id}-nature`} label="Nature">
            <select
              id={`${id}-nature`}
              className={CHAMP}
              value={f.nature}
              onChange={(e) => setF({ ...f, nature: e.target.value as DocumentNature })}
            >
              {Object.entries(LIBELLES_NATURE).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
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
          <Champ id={`${id}-expire`} label="Expire le" erreur={champs['expiresOn']}>
            <input
              id={`${id}-expire`}
              type="date"
              className={CHAMP}
              value={f.expiresOn}
              onChange={(e) => setF({ ...f, expiresOn: e.target.value })}
              {...aria(`${id}-expire`, champs['expiresOn'])}
            />
          </Champ>
          {f.expiresOn ? (
            <Champ
              id={`${id}-rappel`}
              label="Rappel (jours avant l’expiration)"
              aide="Vide : 30 jours."
              erreur={champs['reminderDays']}
            >
              <ChampNombre
                id={`${id}-rappel`}
                entier
                value={f.reminderDays}
                onChange={(e) => setF({ ...f, reminderDays: e.target.value })}
                {...aria(`${id}-rappel`, champs['reminderDays'], true)}
              />
            </Champ>
          ) : null}
          <Champ
            id={`${id}-tags`}
            label="Étiquettes"
            aide="Séparées par des virgules, 10 au plus."
            erreur={champs['tags']}
          >
            <input
              id={`${id}-tags`}
              className={CHAMP}
              value={f.tags}
              autoComplete="off"
              placeholder="fiscal, 2026"
              onChange={(e) => setF({ ...f, tags: e.target.value })}
              {...aria(`${id}-tags`, champs['tags'], true)}
            />
          </Champ>
        </div>
        <EditeurLiens
          liens={f.links}
          verrouilles={verrouilles}
          onChange={(links) => setF({ ...f, links })}
        />
        {gerer ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={f.sensitive}
              onChange={(e) => setF({ ...f, sensitive: e.target.checked })}
            />
            <span>
              <span className="font-medium">Document sensible</span>
              <span className="block text-xs text-[var(--foreground-muted)]">
                Chiffré par Lalanda ; chaque téléchargement est journalisé. Ne change plus après le
                dépôt.
              </span>
            </span>
          </label>
        ) : null}
        {champs['sensitive'] ? (
          <p className="text-xs text-[var(--danger)]">{champs['sensitive']}</p>
        ) : null}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
            {envoi ? 'Envoi…' : 'Déposer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
