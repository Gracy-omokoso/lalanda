'use client';

// Module « Annonces » de la console (ADR-0053 § 6.6 — lot P6).
//
// Circuit : brouillon → aperçu (texte rendu + NOMBRE de destinataires, jamais la liste) →
// soumission → approbation par une AUTRE personne → envoi, qui fait RETAPER le nombre
// approuvé. Canal unique : l'application (bannière et cloche). Aucun e-mail.
// Chaque écriture passe par la fenêtre de ré-authentification ; l'API juge de tout.

import {
  Checkbox,
  DatePicker,
  Field,
  FormGrid,
  SubmitButton,
  TextArea,
  TextInput,
} from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import { announcementsApi, type AdminAnnouncementView } from '@/lib/announcements-api';

import { useAccesPlateforme } from './admin-access';
import { Bandeau, Pastille, Vide } from './admin-chrome';
import { exigeReauth, formaterDate, formaterDateHeure, LIBELLES_PLAN } from './admin-model';
import {
  audienceDepuisSaisie,
  erreursBrouillon,
  ETATS_ABONNEMENT,
  finDepuisSaisie,
  finParDefaut,
  gesteDeFin,
  LIBELLES_ETATS_ABONNEMENT,
  LIBELLES_ROLES_ORG,
  messageErreurAnnonces,
  nombreRetapeValide,
  OFFRES,
  resumeAudience,
  ROLES_ORG,
  SAISIE_AUDIENCE_VIDE,
  statutAnnonce,
  type SaisieAudience,
} from './annonces-model';
import { ReauthGate, useReauth } from './reauth-gate';

const REAUTH_ANNONCES =
  'Préparer, soumettre, approuver, envoyer, annuler ou retirer une annonce exige une ré-authentification, valable dix minutes. Une annonce est approuvée par une autre personne que son auteur, et chaque étape est inscrite au journal plateforme.';

const ETIQUETTE =
  'font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]';
const BOUTON =
  'rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40';

type Retour = { ton: 'succes' | 'echec'; texte: string } | null;

export function AnnoncesPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const peutApprouver = acces.actions.includes('platform.announcements.approve');
  const reauth = useReauth();
  const [liste, setListe] = useState<AdminAnnouncementView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    try {
      const { announcements } = await announcementsApi.list();
      setListe(announcements);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreurAnnonces(err, 'Impossible de charger les annonces.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  return (
    <div className="flex flex-col gap-8">
      <ReauthGate reauth={reauth} description={REAUTH_ANNONCES}>
        {null}
      </ReauthGate>

      <Bandeau ton="neutre">
        Canal unique : l’application (bannière et cloche des destinataires). Aucun e-mail, aucun
        SMS. Le destinataire ne voit ni la catégorie, ni le nombre de destinataires, ni l’auteur.
      </Bandeau>

      <Redaction
        fenetreOuverte={reauth.ouverte}
        onReauth={reauth.redemander}
        onCree={(id) => {
          setOuverte(id);
          void charger();
        }}
      />

      <section className="flex flex-col gap-4" aria-labelledby="liste-annonces">
        <h2 id="liste-annonces" className="font-display text-lg font-bold tracking-tight">
          Annonces
        </h2>
        {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
        {liste === null ? (
          <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
        ) : liste.length === 0 ? (
          <Vide>Aucune annonce pour le moment.</Vide>
        ) : (
          <ul className="flex flex-col gap-2">
            {liste.map((a) => {
              const statut = statutAnnonce(a.status);
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)]"
                >
                  <button
                    type="button"
                    onClick={() => setOuverte((o) => (o === a.id ? null : a.id))}
                    aria-expanded={ouverte === a.id}
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{a.title}</span>
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {resumeAudience(a.audience)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {a.soleApprover ? (
                        <Pastille ton="attention">Approbateur unique</Pastille>
                      ) : null}
                      <Pastille ton={statut.ton}>{statut.libelle}</Pastille>
                      <span className="font-mono text-xs text-[var(--foreground-muted)]">
                        {formaterDate(a.createdAt)}
                      </span>
                    </span>
                  </button>
                  {ouverte === a.id ? (
                    <Detail
                      annonce={a}
                      peutApprouver={peutApprouver}
                      fenetreOuverte={reauth.ouverte}
                      onReauth={reauth.redemander}
                      onChange={() => void charger()}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Rédaction d'un brouillon ─────────────────────────────────────────────────

function Redaction({
  fenetreOuverte,
  onReauth,
  onCree,
}: {
  fenetreOuverte: boolean;
  onReauth: () => void;
  onCree: (id: string) => void;
}): React.ReactElement {
  const [titre, setTitre] = useState('');
  const [texte, setTexte] = useState('');
  const [fin, setFin] = useState('');
  const [saisie, setSaisie] = useState<SaisieAudience>(SAISIE_AUDIENCE_VIDE);
  const [retour, setRetour] = useState<Retour>(null);
  const [envoi, setEnvoi] = useState(false);
  const erreurs = erreursBrouillon({ titre, texte, saisie, fin });

  function basculer<T extends string>(liste: T[], valeur: T): T[] {
    return liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur];
  }

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setRetour(null);
    try {
      const cree = await announcementsApi.create({
        title: titre.trim(),
        body: texte.trim(),
        audience: audienceDepuisSaisie(saisie),
        expiresAt: finDepuisSaisie(fin),
      });
      setTitre('');
      setTexte('');
      setFin('');
      setSaisie(SAISIE_AUDIENCE_VIDE);
      setRetour({
        ton: 'succes',
        texte: 'Brouillon enregistré : affichez l’aperçu, puis soumettez.',
      });
      onCree(cree.id);
    } catch (err) {
      setRetour({ ton: 'echec', texte: messageErreurAnnonces(err, 'Le brouillon a échoué.') });
      if (exigeReauth(err)) onReauth();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void creer(e)}
      className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
      aria-labelledby="rediger-annonce"
    >
      <h2 id="rediger-annonce" className="font-display text-lg font-bold tracking-tight">
        Préparer une annonce
      </h2>
      <FormGrid>
        <Field label="Titre" required size="lg">
          <TextInput value={titre} onChange={(e) => setTitre(e.target.value)} />
        </Field>
        <Field label="Texte" required size="full" newRow hint="Texte brut, sans mise en forme.">
          <TextArea value={texte} onChange={(e) => setTexte(e.target.value)} rows={5} />
        </Field>
      </FormGrid>

      <fieldset className="flex flex-col gap-3">
        <legend className={ETIQUETTE}>Catégorie de destinataires (critères combinés)</legend>
        <Checkbox
          checked={saisie.proprietairesSeulement}
          onChange={(v) => setSaisie({ ...saisie, proprietairesSeulement: v })}
          label="Propriétaires seulement"
        />
        <GroupeCases titre="Offre">
          {OFFRES.map((o) => (
            <Checkbox
              key={o}
              checked={saisie.offres.includes(o)}
              onChange={() => setSaisie({ ...saisie, offres: basculer(saisie.offres, o) })}
              label={LIBELLES_PLAN[o]}
            />
          ))}
        </GroupeCases>
        <GroupeCases titre="Abonnement">
          {ETATS_ABONNEMENT.map((st) => (
            <Checkbox
              key={st}
              checked={saisie.etats.includes(st)}
              onChange={() => setSaisie({ ...saisie, etats: basculer(saisie.etats, st) })}
              label={LIBELLES_ETATS_ABONNEMENT[st]}
            />
          ))}
        </GroupeCases>
        <GroupeCases titre="Rôle">
          {ROLES_ORG.map((r) => (
            <Checkbox
              key={r}
              checked={saisie.roles.includes(r)}
              onChange={() => setSaisie({ ...saisie, roles: basculer(saisie.roles, r) })}
              label={LIBELLES_ROLES_ORG[r]}
            />
          ))}
        </GroupeCases>
        <FormGrid>
          <Field label="Pays (codes ISO)" size="sm" hint="Séparés par une virgule.">
            <TextInput
              value={saisie.pays}
              onChange={(e) => setSaisie({ ...saisie, pays: e.target.value })}
              placeholder="CD, CG"
            />
          </Field>
          <Field label="Inscrits depuis" optional size="sm">
            <DatePicker
              value={saisie.inscritsApres}
              onChange={(v) => setSaisie({ ...saisie, inscritsApres: v })}
            />
          </Field>
          <Field label="Inscrits avant" optional size="sm">
            <DatePicker
              value={saisie.inscritsAvant}
              onChange={(v) => setSaisie({ ...saisie, inscritsAvant: v })}
            />
          </Field>
          <Field label="Fin de diffusion" optional size="sm">
            <DatePicker
              value={fin}
              onChange={setFin}
              shortcuts={['plus7', 'plus30', 'endOfMonth']}
            />
          </Field>
        </FormGrid>
        <p className="text-xs text-[var(--foreground-muted)]">
          {resumeAudience(audienceDepuisSaisie(saisie))}. Sans date de fin : 30 jours après l’envoi
          (soit le {formaterDate(finParDefaut().toISOString())} pour un envoi aujourd’hui).
        </p>
      </fieldset>

      {erreurs.length > 0 && (titre !== '' || texte !== '') ? (
        <Bandeau ton="neutre">{erreurs.join(' ')}</Bandeau>
      ) : null}
      {!fenetreOuverte ? (
        <Bandeau ton="neutre">
          Confirmez votre mot de passe en haut de page pour enregistrer.
        </Bandeau>
      ) : null}
      <div>
        <SubmitButton
          size="sm"
          busy={envoi}
          busyLabel="Enregistrement…"
          disabled={!fenetreOuverte || erreurs.length > 0}
        >
          Enregistrer le brouillon
        </SubmitButton>
      </div>
      {retour ? <Bandeau ton={retour.ton}>{retour.texte}</Bandeau> : null}
    </form>
  );
}

/** Groupe de cases à cocher titré (offre, état d'abonnement, rôle). */
function GroupeCases({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <legend className="float-left mr-1 text-[var(--foreground-muted)]">{titre} :</legend>
      {children}
    </fieldset>
  );
}

// ── Détail et circuit ────────────────────────────────────────────────────────

function Detail({
  annonce: a,
  peutApprouver,
  fenetreOuverte,
  onReauth,
  onChange,
}: {
  annonce: AdminAnnouncementView;
  peutApprouver: boolean;
  fenetreOuverte: boolean;
  onReauth: () => void;
  onChange: () => void;
}): React.ReactElement {
  const [retour, setRetour] = useState<Retour>(null);
  const [envoi, setEnvoi] = useState(false);
  const [nombre, setNombre] = useState('');
  const [motif, setMotif] = useState('');

  async function agir(geste: () => Promise<unknown>, succes: string): Promise<void> {
    setEnvoi(true);
    setRetour(null);
    try {
      await geste();
      setRetour({ ton: 'succes', texte: succes });
      onChange();
    } catch (err) {
      setRetour({ ton: 'echec', texte: messageErreurAnnonces(err, 'Le geste a échoué.') });
      if (exigeReauth(err)) onReauth();
      onChange();
    } finally {
      setEnvoi(false);
    }
  }

  const fin = gesteDeFin(a.status);
  const enCours = fin === 'annuler';

  return (
    <div className="flex flex-col gap-4 border-t border-[var(--border)] px-4 py-4 text-sm">
      <div className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <span className={ETIQUETTE}>Aperçu tel que le destinataire le lira</span>
        <p className="font-semibold">{a.title}</p>
        <p className="whitespace-pre-line break-words">{a.body}</p>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <dt className={ETIQUETTE}>Catégorie</dt>
        <dd>{resumeAudience(a.audience)}</dd>
        <dt className={ETIQUETTE}>Destinataires (aperçu)</dt>
        <dd>{a.previewCount ?? '—'}</dd>
        <dt className={ETIQUETTE}>Destinataires approuvés</dt>
        <dd>{a.audienceCountAtApproval ?? '—'}</dd>
        <dt className={ETIQUETTE}>Envoyée</dt>
        <dd>
          {a.sentAt
            ? `${formaterDateHeure(a.sentAt)} — ${a.recipientCount ?? 0} destinataire(s)`
            : '—'}
        </dd>
        {a.withdrawnAt ? (
          <>
            <dt className={ETIQUETTE}>Retirée</dt>
            <dd>{formaterDateHeure(a.withdrawnAt)}</dd>
          </>
        ) : null}
        <dt className={ETIQUETTE}>Fin de diffusion</dt>
        <dd>{a.expiresAt ? formaterDate(a.expiresAt) : '30 jours après l’envoi'}</dd>
      </dl>

      {!fenetreOuverte && fin !== null ? (
        <Bandeau ton="neutre">
          Confirmez votre mot de passe en haut de page pour faire avancer cette annonce.
        </Bandeau>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {enCours ? (
          <button
            type="button"
            disabled={envoi}
            className={BOUTON}
            onClick={() => void agir(() => announcementsApi.preview(a.id), 'Aperçu mis à jour.')}
          >
            Afficher l’aperçu (nombre de destinataires)
          </button>
        ) : null}
        {a.status === 'draft' ? (
          <button
            type="button"
            disabled={envoi || !fenetreOuverte || a.previewCount === null}
            className={BOUTON}
            onClick={() =>
              void agir(
                () => announcementsApi.submit(a.id),
                'Soumise : une autre personne doit l’approuver.',
              )
            }
          >
            Soumettre à l’approbation
          </button>
        ) : null}
        {a.status === 'pending_approval' && peutApprouver ? (
          <button
            type="button"
            disabled={envoi || !fenetreOuverte}
            className={BOUTON}
            onClick={() =>
              void agir(() => announcementsApi.approve(a.id), 'Approuvée : elle peut être envoyée.')
            }
          >
            Approuver (seconde personne)
          </button>
        ) : null}
      </div>

      {a.status === 'approved' && peutApprouver ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={`Retapez le nombre de destinataires approuvé (${a.audienceCountAtApproval})`}
            className="w-full max-w-xs"
          >
            <TextInput
              inputMode="numeric"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <button
            type="button"
            disabled={
              envoi || !fenetreOuverte || !nombreRetapeValide(nombre, a.audienceCountAtApproval)
            }
            className={BOUTON}
            onClick={() =>
              void agir(
                () => announcementsApi.send(a.id, Number.parseInt(nombre.trim(), 10)),
                'Envoyée dans l’application.',
              )
            }
          >
            Envoyer dans l’application
          </button>
        </div>
      ) : null}

      {fin !== null ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={fin === 'retirer' ? 'Motif du retrait' : 'Motif d’annulation'}
            required
            hint={
              fin === 'retirer' ? 'Dix caractères au moins, interne.' : 'Dix caractères au moins.'
            }
            className="w-full max-w-md"
          >
            <TextInput value={motif} onChange={(e) => setMotif(e.target.value)} />
          </Field>
          <button
            type="button"
            disabled={envoi || !fenetreOuverte || motif.trim().length < 10}
            className={BOUTON}
            onClick={() =>
              void agir(
                () =>
                  fin === 'retirer'
                    ? announcementsApi.withdraw(a.id, motif.trim())
                    : announcementsApi.cancel(a.id, motif.trim()),
                fin === 'retirer'
                  ? 'Annonce retirée : elle n’apparaît plus chez les destinataires.'
                  : 'Annonce annulée.',
              )
            }
          >
            {fin === 'retirer' ? 'Retirer l’annonce envoyée' : 'Annuler l’annonce'}
          </button>
        </div>
      ) : null}

      {a.soleApprover ? (
        <Bandeau ton="neutre">
          Approuvée par le seul détenteur du droit d’approbation : geste marqué au journal.
        </Bandeau>
      ) : null}
      {retour ? <Bandeau ton={retour.ton}>{retour.texte}</Bandeau> : null}
    </div>
  );
}
