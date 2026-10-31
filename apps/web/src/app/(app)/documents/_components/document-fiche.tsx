'use client';

// Fiche d'un document — ADR-0046 § 4.2, § 4.3, § 5.3 : métadonnées, badge
// « Sensible », expiration, éléments liés, versions (historique, téléchargement,
// restauration), nouvelle version en fenêtre modale (multipart), modification des
// métadonnées et des liens, mise à la corbeille et restauration. Document invisible
// ou d'une autre organisation : l'API répond 404, l'écran le dit.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import {
  ArrowLeft,
  Download,
  FileText,
  History,
  Link2,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import {
  documentsApi,
  type DocumentFolderView,
  type DocumentNature,
  type DocumentVersionView,
  type LibraryDocumentDetail,
} from '@/lib/api-documents';

import { useShell } from '../../_components/shell-context';
import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import { optionsDossiers } from './arbre-model';
import { EditeurLiens } from './depot-document';
import {
  ACCEPT_DOCUMENT,
  DOCUMENTS_BASE,
  LIBELLES_ENTITE,
  LIBELLES_NATURE,
  PHRASE_SENSIBLE,
  PHRASE_TYPES,
  badgeExpiration,
  formatInstantJour,
  formatJour,
  formatTaille,
  libelleType,
  lienEntite,
  lire,
  lireEtiquettes,
  messageDocuments,
  statutDe,
  validerFichier,
  type FormulaireDepot,
  type Lecture,
} from './documents-model';
import {
  BadgeSensible,
  Bandeau,
  ChampNombre,
  Chargement,
  EchecLecture,
  Panneau,
  PhraseSection,
  enregistrerFichier,
  nomMembre,
  useMembres,
} from './documents-ui';

type Fenetre = 'modifier' | 'version' | 'corbeille' | null;

const libelleLien = (entityId: string): string => `n° …${entityId.slice(-6)}`;

export function DocumentFiche({ documentId }: { documentId: string }): React.ReactElement {
  const { actions } = useShell();
  const membres = useMembres();
  const [lecture, setLecture] = useState<Lecture<LibraryDocumentDetail> | null>(null);
  const [dossiers, setDossiers] = useState<DocumentFolderView[]>([]);
  const [version, setVersion] = useState(0);
  const [fenetre, setFenetre] = useState<Fenetre>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(documentsApi.get(documentId)).then((l) => {
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
  }, [documentId, version]);

  const retour = (
    <Link
      href={DOCUMENTS_BASE}
      className="inline-flex items-center gap-1 self-start text-sm underline underline-offset-2"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Bibliothèque
    </Link>
  );

  if (lecture === null) return <Chargement texte="Chargement du document…" />;
  if (!lecture.ok) {
    return (
      <section className="flex flex-col gap-4">
        {retour}
        {statutDe(lecture.erreur) === 404 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center sm:p-8">
            <p className="text-sm font-medium">Document introuvable</p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
              Ce document n’existe pas, a été supprimé, ou n’est pas visible avec vos droits.
            </p>
          </div>
        ) : (
          <EchecLecture
            erreur={lecture.erreur}
            repli="Le document est illisible."
            onReessayer={() => setVersion((v) => v + 1)}
          />
        )}
      </section>
    );
  }

  const d = lecture.valeur;
  const exp = badgeExpiration(d.expiryStatus, d.expiresOn, formatJour);
  const dossier = d.folderId ? dossiers.find((f) => f.id === d.folderId) : undefined;
  const ecrire = d.canWrite;
  const archive = d.status === 'archived';
  const remplacer = (suite: LibraryDocumentDetail): void => {
    setFenetre(null);
    setLecture({ ok: true, valeur: suite });
  };

  async function telecharger(v: DocumentVersionView): Promise<void> {
    setErreur(null);
    setOccupe(v.id);
    try {
      const f = await documentsApi.download(d.id, v.id, v.fileName);
      enregistrerFichier(f.blob, f.nom);
    } catch (err) {
      setErreur(messageDocuments(err, 'Le fichier n’a pas pu être téléchargé.'));
    } finally {
      setOccupe(null);
    }
  }

  async function restaurerVersion(v: DocumentVersionView): Promise<void> {
    setErreur(null);
    setOccupe(v.id);
    try {
      remplacer(await documentsApi.restoreVersion(d.id, v.id));
    } catch (err) {
      setErreur(messageDocuments(err, 'Restauration impossible.'));
    } finally {
      setOccupe(null);
    }
  }

  async function restaurer(): Promise<void> {
    setErreur(null);
    setOccupe('document');
    try {
      remplacer(await documentsApi.restore(d.id, d.revision));
    } catch (err) {
      setErreur(messageDocuments(err, 'Restauration impossible.'));
    } finally {
      setOccupe(null);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {retour}
      <Bandeau
        icone={FileText}
        titre={d.title}
        sousTitre={[
          LIBELLES_NATURE[d.nature],
          dossier ? `dossier ${dossier.name}` : d.folderId ? null : 'sans dossier',
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {d.sensitive ? <BadgeSensible /> : null}
            {exp ? <Badge tone={exp.ton}>{exp.texte}</Badge> : null}
            {archive ? <Badge tone="neutral">À la corbeille</Badge> : null}
            {ecrire ? (
              <>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  aria-haspopup="dialog"
                  onClick={() => setFenetre('modifier')}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  aria-haspopup="dialog"
                  onClick={() => setFenetre('version')}
                >
                  <Upload aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                  Nouvelle version
                </button>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  aria-haspopup="dialog"
                  onClick={() => setFenetre('corbeille')}
                >
                  <Trash2 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                  Mettre à la corbeille
                </button>
              </>
            ) : null}
            {archive ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={occupe === 'document'}
                onClick={() => void restaurer()}
              >
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Restaurer
              </button>
            ) : null}
          </>
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--foreground-muted)]">Délivré le</dt>
            <dd>{formatJour(d.issuedOn)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--foreground-muted)]">Expire le</dt>
            <dd>
              {d.expiresOn
                ? `${formatJour(d.expiresOn)} (rappel ${d.reminderDays} j avant)`
                : 'Pas d’expiration'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--foreground-muted)]">Déposé par</dt>
            <dd>
              {nomMembre(membres, d.createdBy)} le {formatInstantJour(d.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--foreground-muted)]">Étiquettes</dt>
            <dd className="break-words">
              {d.tags.length > 0 ? d.tags.map((t) => `#${t}`).join(' ') : '—'}
            </dd>
          </div>
        </dl>
        {d.sensitive ? (
          <p className="text-xs text-[var(--foreground-muted)]">{PHRASE_SENSIBLE}</p>
        ) : null}
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panneau titre={`Versions (${d.versionCount})`} icone={History} id="doc-versions">
          <ol className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {d.versions.map((v) => {
              const courante = v.id === d.currentVersion.id;
              return (
                <li key={v.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Version {v.number}</span>
                      {courante ? <Badge tone="success">Courante</Badge> : null}
                    </span>
                    <span className="text-xs break-words text-[var(--foreground-muted)]">
                      {v.fileName} · {libelleType(v.contentType)} · {formatTaille(v.size)} ·{' '}
                      {nomMembre(membres, v.uploadedBy)} le {formatInstantJour(v.uploadedAt)}
                    </span>
                    {v.note ? <span className="text-xs break-words">{v.note}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      disabled={occupe === v.id}
                      onClick={() => void telecharger(v)}
                    >
                      <Download aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                      {occupe === v.id ? 'Téléchargement…' : 'Télécharger'}
                      <span className="sr-only"> la version {v.number}</span>
                    </button>
                    {ecrire && !courante ? (
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        disabled={occupe === v.id}
                        onClick={() => void restaurerVersion(v)}
                      >
                        <RotateCcw aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                        Restaurer<span className="sr-only"> la version {v.number}</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-[var(--foreground-muted)]">
            Restaurer une version la recopie comme nouvelle version : rien n’est effacé.
          </p>
        </Panneau>

        <Panneau titre="Éléments liés" icone={Link2} id="doc-liens">
          {d.links.length === 0 ? (
            <PhraseSection>Aucun élément lié.</PhraseSection>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {d.links.map((l) => {
                const href = lienEntite(l, actions);
                return (
                  <li key={`${l.entityType}:${l.entityId}`}>
                    {href ? (
                      <Link href={href} className="underline underline-offset-2">
                        {LIBELLES_ENTITE[l.entityType]} {libelleLien(l.entityId)}
                      </Link>
                    ) : (
                      <span>
                        {LIBELLES_ENTITE[l.entityType]} {libelleLien(l.entityId)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panneau>
      </div>

      {fenetre === 'modifier' ? (
        <DialogueMetadonnees
          document={d}
          dossiers={dossiers}
          onFermer={() => setFenetre(null)}
          onFait={remplacer}
        />
      ) : null}
      {fenetre === 'version' ? (
        <DialogueVersion document={d} onFermer={() => setFenetre(null)} onFait={remplacer} />
      ) : null}
      {fenetre === 'corbeille' ? (
        <DialogueCorbeille document={d} onFermer={() => setFenetre(null)} onFait={remplacer} />
      ) : null}
    </section>
  );
}

function DialogueVersion({
  document: d,
  onFermer,
  onFait,
}: {
  document: LibraryDocumentDetail;
  onFermer: () => void;
  onFait: (d: LibraryDocumentDetail) => void;
}): React.ReactElement {
  const id = useId();
  const [fichier, setFichier] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [champ, setChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const err = validerFichier(fichier);
    setChamp(err ?? undefined);
    if (err || fichier === null) return;
    setEnvoi(true);
    try {
      onFait(await documentsApi.addVersion(d.id, note.trim() || null, fichier));
    } catch (x) {
      setErreur(messageDocuments(x, 'La version n’a pas pu être déposée.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title="Nouvelle version"
      description={PHRASE_TYPES}
      size="md"
    >
      <form noValidate onSubmit={(e) => void envoyer(e)} className="flex flex-col gap-3">
        <Champ id={`${id}-fichier`} label="Fichier" requis erreur={champ}>
          <input
            id={`${id}-fichier`}
            type="file"
            accept={ACCEPT_DOCUMENT}
            className={CHAMP}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFichier(f);
              setChamp(f ? (validerFichier(f) ?? undefined) : undefined);
            }}
            {...aria(`${id}-fichier`, champ)}
          />
        </Champ>
        <Champ id={`${id}-note`} label="Ce qui change">
          <textarea
            id={`${id}-note`}
            rows={2}
            className={CHAMP}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </Champ>
        {d.sensitive ? (
          <p className="text-xs text-[var(--foreground-muted)]">{PHRASE_SENSIBLE}</p>
        ) : null}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <button
          type="submit"
          className={buttonClasses('primary', 'sm', 'self-start')}
          disabled={envoi}
        >
          {envoi ? 'Envoi…' : 'Déposer la version'}
        </button>
      </form>
    </Modal>
  );
}

function DialogueCorbeille({
  document: d,
  onFermer,
  onFait,
}: {
  document: LibraryDocumentDetail;
  onFermer: () => void;
  onFait: (d: LibraryDocumentDetail) => void;
}): React.ReactElement {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  async function valider(): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      onFait(await documentsApi.archive(d.id, d.revision));
    } catch (err) {
      setErreur(messageDocuments(err, 'Action impossible.'));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title="Mettre ce document à la corbeille ?"
      description={d.title}
      size="sm"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Retour
          </button>
          <button
            type="button"
            className={buttonClasses('danger', 'sm')}
            disabled={envoi}
            onClick={() => void valider()}
          >
            {envoi ? 'Envoi…' : 'Mettre à la corbeille'}
          </button>
        </div>
      }
    >
      <p className="text-sm">
        Il disparaît de la bibliothèque et de ses échéances. Vous pourrez le restaurer depuis la
        corbeille.
      </p>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </Modal>
  );
}

function DialogueMetadonnees({
  document: d,
  dossiers,
  onFermer,
  onFait,
}: {
  document: LibraryDocumentDetail;
  dossiers: readonly DocumentFolderView[];
  onFermer: () => void;
  onFait: (d: LibraryDocumentDetail) => void;
}): React.ReactElement {
  const id = useId();
  const [titre, setTitre] = useState(d.title);
  const [dossier, setDossier] = useState(d.folderId ?? '');
  const [nature, setNature] = useState<DocumentNature>(d.nature);
  const [tags, setTags] = useState(d.tags.join(', '));
  const [liens, setLiens] = useState<FormulaireDepot['links']>(
    d.links.map((l) => ({ ...l, label: libelleLien(l.entityId) })),
  );
  const [emis, setEmis] = useState(d.issuedOn ?? '');
  const [expire, setExpire] = useState(d.expiresOn ?? '');
  const [rappel, setRappel] = useState(String(d.reminderDays));
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const options = optionsDossiers(dossiers, true);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const c: Record<string, string> = {};
    if (titre.trim() === '') c['title'] = 'Le titre est obligatoire.';
    const t = lireEtiquettes(tags);
    if (!t.ok) c['tags'] = t.erreur;
    if (emis && expire && expire < emis)
      c['expiresOn'] = 'La date d’expiration précède la date de délivrance.';
    const r = /^\d{1,3}$/.test(rappel.trim()) ? Number(rappel.trim()) : NaN;
    if (Number.isNaN(r) || r > 365) c['reminderDays'] = 'Entre 0 et 365 jours.';
    if (dossier === '' && liens.length === 0)
      c['folderId'] = 'Choisissez un dossier ou gardez au moins un lien.';
    setChamps(c);
    if (Object.keys(c).length > 0 || !t.ok) return;
    setEnvoi(true);
    try {
      onFait(
        await documentsApi.update(d.id, {
          expectedRevision: d.revision,
          title: titre.trim(),
          folderId: dossier === '' ? null : dossier,
          nature,
          tags: t.valeur,
          links: liens.map(({ entityType, entityId }) => ({ entityType, entityId })),
          issuedOn: emis || null,
          expiresOn: expire || null,
          reminderDays: r,
        }),
      );
    } catch (err) {
      setErreur(messageDocuments(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal open onClose={onFermer} busy={envoi} title="Modifier le document" size="lg">
      <form noValidate onSubmit={(e) => void valider(e)} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Champ id={`${id}-titre`} label="Titre" requis erreur={champs['title']}>
              <input
                id={`${id}-titre`}
                className={CHAMP}
                value={titre}
                maxLength={200}
                onChange={(e) => setTitre(e.target.value)}
                {...aria(`${id}-titre`, champs['title'])}
              />
            </Champ>
          </div>
          <Champ id={`${id}-dossier`} label="Dossier" erreur={champs['folderId']}>
            <select
              id={`${id}-dossier`}
              className={CHAMP}
              value={dossier}
              onChange={(e) => setDossier(e.target.value)}
              {...aria(`${id}-dossier`, champs['folderId'])}
            >
              <option value="">Sans dossier (seulement lié)</option>
              {d.folderId && !options.some((o) => o.id === d.folderId) ? (
                <option value={d.folderId}>Dossier actuel</option>
              ) : null}
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
              value={nature}
              onChange={(e) => setNature(e.target.value as DocumentNature)}
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
              value={emis}
              onChange={(e) => setEmis(e.target.value)}
            />
          </Champ>
          <Champ id={`${id}-expire`} label="Expire le" erreur={champs['expiresOn']}>
            <input
              id={`${id}-expire`}
              type="date"
              className={CHAMP}
              value={expire}
              onChange={(e) => setExpire(e.target.value)}
              {...aria(`${id}-expire`, champs['expiresOn'])}
            />
          </Champ>
          <Champ id={`${id}-rappel`} label="Rappel (jours avant)" erreur={champs['reminderDays']}>
            <ChampNombre
              id={`${id}-rappel`}
              entier
              value={rappel}
              onChange={(e) => setRappel(e.target.value)}
              {...aria(`${id}-rappel`, champs['reminderDays'])}
            />
          </Champ>
          <Champ id={`${id}-tags`} label="Étiquettes" erreur={champs['tags']}>
            <input
              id={`${id}-tags`}
              className={CHAMP}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              {...aria(`${id}-tags`, champs['tags'])}
            />
          </Champ>
        </div>
        <EditeurLiens liens={liens} onChange={setLiens} />
        <p className="text-xs text-[var(--foreground-muted)]">
          La sensibilité ne change pas après le dépôt : elle décide du chiffrement de chaque
          version.
        </p>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <button
          type="submit"
          className={buttonClasses('primary', 'sm', 'self-start')}
          disabled={envoi}
        >
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </Modal>
  );
}
