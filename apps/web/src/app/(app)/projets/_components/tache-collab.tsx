'use client';

// Collaboration sur une tâche (ADR-0039 § 2.4 à § 2.8) : commentaires avec
// mentions, pièces jointes, temps passé, historique. Une section par sujet,
// chacune chargée à part : la panne de l'une n'empêche pas les autres.
//
// Mentions : on écrit « @Nom » (la liste propose les membres) ; à l'envoi, le
// texte porte `@[userId]` et la liste des mentionnés (vérifiée par le serveur).
// Rendu : le nom COURANT du membre, en texte brut, jamais de HTML.

import type {
  TimeEntryView,
  WorkActivityView,
  WorkAttachmentView,
  WorkCommentView,
  WorkMemberRef,
  WorkTaskDetail,
} from '@lalanda/shared/work';
import { useCallback, useEffect, useRef, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { useProfil } from '../../_components/profile-context';

import { BOUTON_DANGER, BOUTON_PETIT, CHAMP } from './elements';
import { useProjet } from './project-context';
import {
  aujourdhui,
  formatInstant,
  formatJour,
  formatMinutes,
  lireDuree,
  messageWork,
} from './projets-model';
import {
  activiteDeTache,
  decoderMentions,
  encoderMentions,
  insererMention,
  libelleActivite,
  requeteMention,
  segmentsCommentaire,
  suggestionsMention,
} from './taches-model';

export function Collaboration({
  detail,
  onChange,
}: {
  detail: WorkTaskDetail;
  onChange: () => void;
}): React.ReactElement {
  return (
    <>
      <Commentaires detail={detail} onChange={onChange} />
      <PiecesJointes detail={detail} onChange={onChange} />
      <Temps detail={detail} onChange={onChange} />
      <Historique taskId={detail.id} />
    </>
  );
}

function Section({
  id,
  titre,
  children,
}: {
  id: string;
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2 border-t border-[var(--border)] pt-4"
    >
      <h3 id={id} className="text-sm font-semibold">
        {titre}
      </h3>
      {children}
    </section>
  );
}

function Erreur({ message }: { message: string | null }): React.ReactElement | null {
  return message ? (
    <p role="alert" className="text-sm text-[var(--danger)]">
      {message}
    </p>
  ) : null;
}

// ─── Commentaires ───────────────────────────────────────────────────────────

/** Zone de saisie avec proposition des membres après « @ ». */
function Redaction({
  id,
  label,
  initial,
  envoi,
  libelleEnvoi,
  onEnvoyer,
  onAnnuler,
}: {
  id: string;
  label: string;
  initial: { texte: string; choisis: WorkMemberRef[] };
  envoi: boolean;
  libelleEnvoi: string;
  onEnvoyer: (corps: { body: string; mentionedUserIds: string[] }) => Promise<boolean>;
  onAnnuler?: () => void;
}): React.ReactElement {
  const { members } = useProjet();
  const [texte, setTexte] = useState(initial.texte);
  const [choisis, setChoisis] = useState<WorkMemberRef[]>(initial.choisis);
  const [curseur, setCurseur] = useState(0);
  const [actif, setActif] = useState(0);
  const zone = useRef<HTMLTextAreaElement>(null);

  const mention = requeteMention(texte, curseur);
  const suggestions = mention ? suggestionsMention(members, mention.requete) : [];
  const ouvert = suggestions.length > 0;

  function choisir(i: number): void {
    const m = suggestions[i];
    if (!m || !mention) return;
    const r = insererMention(texte, mention, m);
    setTexte(r.texte);
    setChoisis((c) => (c.some((x) => x.userId === m.userId) ? c : [...c, m]));
    setCurseur(r.curseur);
    setActif(0);
    requestAnimationFrame(() => {
      zone.current?.focus();
      zone.current?.setSelectionRange(r.curseur, r.curseur);
    });
  }

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (texte.trim() === '') return;
    if (await onEnvoyer(encoderMentions(texte, choisis))) {
      setTexte('');
      setChoisis([]);
    }
  }

  const idListe = `${id}-membres`;
  return (
    <form onSubmit={(e) => void envoyer(e)} className="relative flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={zone}
        value={texte}
        rows={3}
        maxLength={5000}
        placeholder="Écrire un commentaire… « @ » pour mentionner un membre"
        className={CHAMP}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={ouvert}
        aria-controls={idListe}
        aria-activedescendant={ouvert ? `${idListe}-${actif}` : undefined}
        onChange={(e) => {
          setTexte(e.target.value);
          setCurseur(e.target.selectionStart);
          setActif(0);
        }}
        onSelect={(e) => setCurseur(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (!ouvert) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActif((a) => (a + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActif((a) => (a - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            choisir(actif);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setCurseur(-1);
          }
        }}
      />
      {ouvert ? (
        <ul
          id={idListe}
          role="listbox"
          aria-label="Membres à mentionner"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] py-1 shadow-[var(--shadow-pop)]"
        >
          {suggestions.map((m, i) => (
            <li
              key={m.userId}
              id={`${idListe}-${i}`}
              role="option"
              aria-selected={i === actif}
              className={`cursor-pointer px-3 py-1.5 text-sm ${i === actif ? 'bg-[var(--accent-soft)]' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choisir(i);
              }}
            >
              {m.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" className={BOUTON_PETIT} disabled={envoi || texte.trim() === ''}>
          {libelleEnvoi}
        </button>
        {onAnnuler ? (
          <button type="button" className={BOUTON_PETIT} onClick={onAnnuler}>
            Annuler
          </button>
        ) : null}
      </div>
    </form>
  );
}

function Commentaires({
  detail,
  onChange,
}: {
  detail: WorkTaskDetail;
  onChange: () => void;
}): React.ReactElement {
  const { travailler, gerer } = useProjet();
  const { profil } = useProfil();
  const [items, setItems] = useState<WorkCommentView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [edition, setEdition] = useState<string | null>(null);

  const charger = useCallback(() => {
    workApi
      .listComments(detail.id)
      .then((c) => {
        setItems(c);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Commentaires indisponibles.')));
  }, [detail.id]);
  useEffect(() => charger(), [charger]);

  async function geste(f: () => Promise<unknown>, repli: string): Promise<boolean> {
    setEnvoi(true);
    setErreur(null);
    try {
      await f();
      charger();
      onChange();
      return true;
    } catch (err) {
      setErreur(messageWork(err, repli));
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Section
      id="com-titre"
      titre={`Commentaires${items ? ` (${items.filter((c) => !c.deletedAt).length})` : ''}`}
    >
      <Erreur message={erreur} />
      {items === null ? null : items.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucun commentaire.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((c) => {
            const auteur = profil !== null && c.author.userId === profil.id;
            return (
              <li
                key={c.id}
                className="flex flex-col gap-1 rounded-[var(--radius-md)] bg-[var(--surface)] p-3 text-sm"
              >
                <p className="text-xs text-[var(--foreground-muted)]">
                  <span className="font-medium text-[var(--foreground)]">{c.author.name}</span> ·{' '}
                  {formatInstant(c.createdAt)}
                  {c.editedAt && !c.deletedAt ? ' · modifié' : ''}
                </p>
                {c.deletedAt ? (
                  <p className="italic text-[var(--foreground-muted)]">Commentaire supprimé</p>
                ) : edition === c.id ? (
                  <Redaction
                    id={`com-edit-${c.id}`}
                    label="Modifier le commentaire"
                    initial={decoderMentions(c.body, c.mentions)}
                    envoi={envoi}
                    libelleEnvoi="Enregistrer"
                    onAnnuler={() => setEdition(null)}
                    onEnvoyer={async (corps) => {
                      const ok = await geste(
                        () =>
                          workApi.updateComment(c.id, { ...corps, expectedRevision: c.revision }),
                        'Modification impossible.',
                      );
                      if (ok) setEdition(null);
                      return ok;
                    }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words">
                    {segmentsCommentaire(c.body, c.mentions).map((s, i) =>
                      s.type === 'texte' ? (
                        <span key={i}>{s.texte}</span>
                      ) : (
                        <strong key={i} className="font-semibold text-[var(--accent)]">
                          @{s.nom}
                        </strong>
                      ),
                    )}
                  </p>
                )}
                {!c.deletedAt && edition !== c.id && travailler && (auteur || gerer) ? (
                  <div className="flex gap-2">
                    {auteur ? (
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        onClick={() => setEdition(c.id)}
                      >
                        Modifier
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={BOUTON_DANGER}
                      disabled={envoi}
                      onClick={() => {
                        if (window.confirm('Supprimer ce commentaire ?')) {
                          void geste(() => workApi.deleteComment(c.id), 'Suppression impossible.');
                        }
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {travailler ? (
        <Redaction
          id="com-nouveau"
          label="Nouveau commentaire"
          initial={{ texte: '', choisis: [] }}
          envoi={envoi}
          libelleEnvoi="Commenter"
          onEnvoyer={(corps) =>
            geste(() => workApi.createComment(detail.id, corps), 'Envoi du commentaire impossible.')
          }
        />
      ) : null}
    </Section>
  );
}

// ─── Pièces jointes ─────────────────────────────────────────────────────────

function taille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Kio`;
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mio`;
}

function PiecesJointes({
  detail,
  onChange,
}: {
  detail: WorkTaskDetail;
  onChange: () => void;
}): React.ReactElement {
  const { travailler, gerer } = useProjet();
  const { profil } = useProfil();
  const [items, setItems] = useState<WorkAttachmentView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const fichier = useRef<HTMLInputElement>(null);

  const charger = useCallback(() => {
    workApi
      .listAttachments(detail.id)
      .then((a) => {
        setItems(a);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Pièces jointes indisponibles.')));
  }, [detail.id]);
  useEffect(() => charger(), [charger]);

  async function envoyer(f: File): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await workApi.uploadAttachment(detail.id, f);
      charger();
      onChange();
    } catch (err) {
      setErreur(messageWork(err, 'Envoi du fichier impossible.'));
    } finally {
      setEnvoi(false);
      if (fichier.current) fichier.current.value = '';
    }
  }

  async function telecharger(a: WorkAttachmentView): Promise<void> {
    try {
      const blob = await workApi.downloadAttachment(a.id);
      const url = URL.createObjectURL(blob);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = a.fileName;
      lien.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setErreur(messageWork(err, 'Téléchargement impossible.'));
    }
  }

  return (
    <Section id="pj-titre" titre={`Pièces jointes${items ? ` (${items.length})` : ''}`}>
      <Erreur message={erreur} />
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                className="min-w-0 break-all text-left underline underline-offset-2"
                onClick={() => void telecharger(a)}
              >
                {a.fileName}
              </button>
              <span className="text-xs text-[var(--foreground-muted)]">
                {a.contentType === 'application/pdf' ? 'PDF' : 'Image'} · {taille(a.size)} ·{' '}
                {a.uploadedBy.name}
              </span>
              {travailler && (gerer || (profil !== null && a.uploadedBy.userId === profil.id)) ? (
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  disabled={envoi}
                  aria-label={`Retirer ${a.fileName}`}
                  onClick={() => {
                    if (!window.confirm(`Retirer « ${a.fileName} » ?`)) return;
                    workApi
                      .deleteAttachment(a.id)
                      .then(() => {
                        charger();
                        onChange();
                      })
                      .catch((err: unknown) => setErreur(messageWork(err, 'Retrait impossible.')));
                  }}
                >
                  Retirer
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : items ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucune pièce jointe.</p>
      ) : null}
      {travailler ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="pj-fichier" className="text-xs font-medium">
            Joindre un fichier
          </label>
          <input
            id="pj-fichier"
            ref={fichier}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            disabled={envoi}
            aria-describedby="pj-aide"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void envoyer(f);
            }}
            className="text-sm"
          />
          <p id="pj-aide" className="text-xs text-[var(--foreground-muted)]">
            Images PNG, JPEG ou WebP (2 Mio, métadonnées retirées) ; PDF (10 Mio, téléchargement
            seulement).
          </p>
        </div>
      ) : null}
    </Section>
  );
}

// ─── Temps passé ────────────────────────────────────────────────────────────

function Temps({
  detail,
  onChange,
}: {
  detail: WorkTaskDetail;
  onChange: () => void;
}): React.ReactElement {
  const { travailler, gerer } = useProjet();
  const { profil } = useProfil();
  const [items, setItems] = useState<TimeEntryView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [jour, setJour] = useState(aujourdhui());
  const [duree, setDuree] = useState('');
  const [note, setNote] = useState('');
  const [erreurDuree, setErreurDuree] = useState<string | null>(null);

  const charger = useCallback(() => {
    workApi
      .listTimeEntries({ taskId: detail.id, limit: 100 })
      .then((p) => {
        setItems(p.items);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Temps saisi indisponible.')));
  }, [detail.id]);
  useEffect(() => charger(), [charger]);

  async function saisir(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const minutes = lireDuree(duree);
    if (minutes === null) {
      setErreurDuree('Durée illisible : par exemple « 1h30 », « 45 min » ou « 90 ».');
      return;
    }
    if (jour > aujourdhui()) {
      setErreurDuree('On ne saisit pas de temps pour un jour à venir.');
      return;
    }
    setErreurDuree(null);
    setEnvoi(true);
    setErreur(null);
    try {
      await workApi.createTimeEntry(detail.id, {
        workedOn: jour,
        minutes,
        note: note.trim() === '' ? null : note.trim(),
      });
      setDuree('');
      setNote('');
      charger();
      onChange();
    } catch (err) {
      setErreur(messageWork(err, 'Saisie impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Section id="temps-titre" titre={`Temps passé (${formatMinutes(detail.loggedMinutes)})`}>
      <Erreur message={erreur} />
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{formatMinutes(t.minutes)}</span>
              <span className="text-[var(--foreground-muted)]">
                {t.user.name} · {formatJour(t.workedOn)}
              </span>
              {t.note ? <span className="break-words">— {t.note}</span> : null}
              {travailler && (gerer || (profil !== null && t.user.userId === profil.id)) ? (
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  disabled={envoi}
                  aria-label={`Supprimer la saisie de ${formatMinutes(t.minutes)} du ${formatJour(t.workedOn)}`}
                  onClick={() => {
                    if (!window.confirm('Supprimer cette saisie de temps ?')) return;
                    workApi
                      .deleteTimeEntry(t.id)
                      .then(() => {
                        charger();
                        onChange();
                      })
                      .catch((err: unknown) =>
                        setErreur(messageWork(err, 'Suppression impossible.')),
                      );
                  }}
                >
                  Supprimer
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : items ? (
        <p className="text-sm text-[var(--foreground-muted)]">Aucun temps saisi.</p>
      ) : null}
      {travailler ? (
        <form
          onSubmit={(e) => void saisir(e)}
          noValidate
          className="grid gap-2 sm:grid-cols-[8rem_7rem_1fr_auto] sm:items-end"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="temps-jour" className="text-xs font-medium">
              Jour
            </label>
            <input
              id="temps-jour"
              type="date"
              value={jour}
              max={aujourdhui()}
              onChange={(e) => setJour(e.target.value)}
              className={CHAMP}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="temps-duree" className="text-xs font-medium">
              Durée
            </label>
            <input
              id="temps-duree"
              value={duree}
              onChange={(e) => setDuree(e.target.value)}
              placeholder="1h30"
              className={CHAMP}
              aria-invalid={erreurDuree ? true : undefined}
              aria-describedby={erreurDuree ? 'temps-erreur' : undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="temps-note" className="text-xs font-medium">
              Note (facultative)
            </label>
            <input
              id="temps-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className={CHAMP}
            />
          </div>
          <button type="submit" className={BOUTON_PETIT} disabled={envoi || duree.trim() === ''}>
            Saisir
          </button>
          {erreurDuree ? (
            <p id="temps-erreur" className="text-xs font-medium text-[var(--danger)] sm:col-span-4">
              {erreurDuree}
            </p>
          ) : null}
        </form>
      ) : null}
      <p className="text-xs text-[var(--foreground-muted)]">
        Minutes seulement : aucun coût n’est affiché ici.
      </p>
    </Section>
  );
}

// ─── Historique ─────────────────────────────────────────────────────────────

function Historique({ taskId }: { taskId: string }): React.ReactElement {
  const { projectId, project } = useProjet();
  const [items, setItems] = useState<WorkActivityView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    // L'historique est servi par projet (ADR-0039 § 4) : on lit les 100
    // derniers événements et on garde ceux de la tâche. Hypothèse à confronter
    // à L1 : un filtre `taskId` côté serveur éviterait ce tri.
    workApi
      .listProjectActivity(projectId, { limit: 100 })
      .then((p) => {
        setItems(activiteDeTache(p.items, taskId));
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Historique indisponible.')));
  }, [ouvert, projectId, taskId]);

  const colonnes = new Map((project?.columns ?? []).map((c) => [c.key, c.label]));
  return (
    <Section id="hist-titre" titre="Historique">
      <button
        type="button"
        className={`${BOUTON_PETIT} self-start`}
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
      >
        {ouvert ? 'Masquer l’historique' : 'Afficher l’historique'}
      </button>
      {ouvert ? (
        <>
          <Erreur message={erreur} />
          {items === null ? null : items.length === 0 ? (
            <p className="text-sm text-[var(--foreground-muted)]">
              Aucun événement récent pour cette tâche.
            </p>
          ) : (
            <ol className="flex flex-col gap-1 text-sm">
              {items.map((a) => (
                <li key={a.id}>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {formatInstant(a.at)}
                  </span>{' '}
                  {libelleActivite(a, colonnes)}
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </Section>
  );
}
