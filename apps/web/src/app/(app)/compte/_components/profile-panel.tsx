'use client';

// Profil (S20b) — identité, langue, fuseau, changement d'adresse email.
//
// États couverts (docs/04 § États obligatoires) : chargement, erreur
// récupérable, succès. Il n'y a pas d'état « vide » ici : un compte connecté a
// toujours un profil, et l'absence de préférences enregistrées se traduit par
// des valeurs par défaut servies par l'API, pas par un écran vide.

import { useEffect, useRef, useState } from 'react';

import { api, type AccountProfileView, type AvatarLimitsView } from '@/lib/api';

import { publierProfil, useProfil } from '../../_components/profile-context';

import {
  CURRENCY_LABELS,
  LOCALE_LABELS,
  accountErrorMessage,
  detectTimezone,
  profileIsDirty,
  timezoneOffsetLabel,
  timezoneOptions,
  validateEmail,
  validateName,
} from './account-model';

interface FormState {
  name: string;
  locale: string;
  timezone: string;
}

export function ProfilePanel(): React.ReactElement {
  // Le profil vient du store PARTAGÉ avec le header (ADR-0016 §7), et non plus
  // d'un `api.getAccountProfile()` propre à ce panneau : les initiales n'ont
  // qu'une autorité, celle du serveur, et une seule lecture les alimente aux
  // deux endroits qui les affichent.
  const { profil, erreur: erreurProfil } = useProfil();
  const [form, setForm] = useState<FormState | null>(null);
  const [locales, setLocales] = useState<string[]>(['fr']);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // Amorce du formulaire à l'arrivée du profil. La garde `form === null` fait
  // que la saisie en cours n'est JAMAIS écrasée par une republication du store
  // — après enregistrement, c'est `handleSubmit` qui repose les valeurs.
  useEffect(() => {
    if (profil !== null && form === null) {
      setForm({ name: profil.name, locale: profil.locale, timezone: profil.timezone });
    }
  }, [profil, form]);

  // Les langues proposées sont un réglage secondaire : leur échec ne doit pas
  // vider la page, il se signale dans le bandeau et laisse le repli « fr ».
  useEffect(() => {
    let cancelled = false;
    void api
      .getAccountPreferences()
      .then((prefs) => {
        if (!cancelled) setLocales(prefs.options.locales);
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger la liste des langues.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (form === null) return;
    const invalid = validateName(form.name);
    setNameError(invalid);
    if (invalid) return;

    setSaving(true);
    setError(null);
    try {
      const updated = await api.putAccountProfile({
        name: form.name.trim(),
        locale: form.locale,
        timezone: form.timezone,
      });
      // Republié dans le store partagé : les initiales de la barre suivent le
      // changement de nom immédiatement, sans second appel ni rechargement.
      // C'est la contrepartie utile de l'autorité unique du serveur.
      publierProfil(updated);
      setForm({ name: updated.name, locale: updated.locale, timezone: updated.timezone });
      setSavedAt(new Date().toISOString());
    } catch (err) {
      const detail = (err as { detail?: { code?: string; message?: string } }).detail;
      setError(accountErrorMessage(detail, 'Impossible d’enregistrer votre profil'));
    } finally {
      setSaving(false);
    }
  }

  const profile = profil;

  if (profile === null || form === null) {
    // Un échec de lecture n'est pas une attente : on ne laisse pas tourner un
    // « Chargement… » sur une requête qui a déjà répondu non.
    return erreurProfil !== null ? (
      <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
        <strong>Erreur :</strong> {erreurProfil}
      </div>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]">Chargement de votre profil…</p>
    );
  }

  const dirty = profileIsDirty(form, {
    name: profile.name,
    locale: profile.locale,
    timezone: profile.timezone,
  });
  const timezones = timezoneOptions(form.timezone, detectTimezone());

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur :</strong> {error}
        </div>
      ) : null}

      {/* Identité — photo ou initiales, nom, adresse. */}
      <section className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-4">
          <AvatarGrandFormat profile={profile} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{profile.name || '—'}</span>
            <span className="truncate text-sm text-[var(--foreground-muted)]">{profile.email}</span>
            {/* L'état de vérification n'est pas porté par la seule couleur. */}
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
              {profile.emailVerified ? 'Adresse vérifiée' : 'Adresse non vérifiée'}
            </span>
          </div>
        </div>
        <AvatarControls profile={profile} />
      </section>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <legend className="font-mono px-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
            Informations
          </legend>

          <label htmlFor="account-name" className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Nom affiché</span>
          </label>
          <input
            id="account-name"
            name="name"
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={(e) => {
              setForm((f) => (f === null ? f : { ...f, name: e.target.value }));
              if (nameError) setNameError(validateName(e.target.value));
            }}
            aria-invalid={nameError !== null}
            {...(nameError ? { 'aria-describedby': 'account-name-error' } : {})}
            {...(nameError ? { 'aria-errormessage': 'account-name-error' } : {})}
            className={[
              '-mt-2 rounded-md border bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition',
              nameError
                ? 'border-[var(--danger)] bg-[var(--danger-bg)]'
                : 'border-[var(--border)] focus:border-[var(--accent)]',
            ].join(' ')}
          />
          {nameError ? (
            <p
              id="account-name-error"
              role="alert"
              className="-mt-2 text-xs font-medium text-[var(--danger)]"
            >
              <span className="font-semibold">Erreur : </span>
              {nameError}
            </p>
          ) : null}

          <label htmlFor="account-locale" className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Langue</span>
          </label>
          <select
            id="account-locale"
            name="locale"
            value={form.locale}
            onChange={(e) => setForm((f) => (f === null ? f : { ...f, locale: e.target.value }))}
            aria-describedby="account-locale-help"
            className="-mt-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
          >
            {locales.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code] ?? code}
              </option>
            ))}
          </select>
          <p
            id="account-locale-help"
            className="-mt-2 text-xs italic text-[var(--foreground-muted)]"
          >
            Le français est pour l’instant la seule langue traduite. D’autres langues seront
            proposées ici dès que les libellés le seront aussi.
          </p>

          <label htmlFor="account-timezone" className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Fuseau horaire</span>
          </label>
          <select
            id="account-timezone"
            name="timezone"
            value={form.timezone}
            onChange={(e) => setForm((f) => (f === null ? f : { ...f, timezone: e.target.value }))}
            aria-describedby="account-timezone-help"
            className="-mt-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
          >
            {timezones.map((tz) => {
              const offset = timezoneOffsetLabel(tz);
              return (
                <option key={tz} value={tz}>
                  {offset ? `${tz} (${offset})` : tz}
                </option>
              );
            })}
          </select>
          <p
            id="account-timezone-help"
            className="-mt-2 text-xs italic text-[var(--foreground-muted)]"
          >
            Utilisé pour afficher les dates et heures, notamment vos sessions actives.
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
            {savedAt
              ? `Enregistré à ${new Date(savedAt).toLocaleTimeString('fr-FR')}`
              : dirty
                ? 'Modifications non enregistrées'
                : ''}
          </span>
        </div>
      </form>

      <EmailChangeSection profile={profile} onChanged={publierProfil} />

      <p className="text-xs text-[var(--foreground-muted)]">
        Devise d’affichage par défaut ({CURRENCY_LABELS['USD']?.split(' —')[0] ?? 'USD'} et autres),
        thème et notifications se règlent dans l’onglet Préférences.
      </p>
    </div>
  );
}

/**
 * Changement d'adresse email.
 *
 * L'écran dit la vérité sur une limite d'infrastructure : tant qu'aucun
 * fournisseur SMTP n'est configuré, le lien de vérification n'est envoyé nulle
 * part et le changement ne peut pas aboutir. On préfère un avertissement
 * explicite à un formulaire qui semble marcher et ne fait rien.
 */
function EmailChangeSection({
  profile,
  onChanged,
}: {
  profile: AccountProfileView;
  onChanged: (next: AccountProfileView) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = profile.pendingEmailChange;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const invalid = validateEmail(newEmail);
    setEmailError(invalid);
    if (invalid) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.requestEmailChange({ newEmail: newEmail.trim(), currentPassword: password });
      onChanged(await api.getAccountProfile());
      setNewEmail('');
      setPassword('');
      setOpen(false);
    } catch (err) {
      const detail = (err as { detail?: { code?: string; message?: string } }).detail;
      setError(accountErrorMessage(detail, 'Impossible de demander le changement d’adresse'));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(): Promise<void> {
    setError(null);
    try {
      await api.cancelEmailChange();
      onChanged(await api.getAccountProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’annuler la demande');
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
        Adresse email
      </h2>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur :</strong> {error}
        </div>
      ) : null}

      {pending ? (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--warn)]/40 bg-[var(--surface-muted)] p-3 text-sm">
          <p>
            Changement en attente vers <strong>{pending.newEmail}</strong>. Votre adresse actuelle
            reste <strong>{profile.email}</strong> tant que la nouvelle n’est pas vérifiée.
          </p>
          {!pending.verificationDelivered ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              <span className="font-semibold">À savoir : </span>
              l’email de vérification n’a pas pu être envoyé — aucun service d’envoi d’emails n’est
              encore branché sur Lalanda. Le changement ne pourra donc pas aboutir avant cette mise
              en service. Rien n’a été modifié sur votre compte.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void cancel()}
            className="self-start rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm transition hover:bg-[var(--surface-muted)]"
          >
            Annuler la demande
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--foreground-muted)]">
            Adresse actuelle : <strong className="text-[var(--foreground)]">{profile.email}</strong>
          </p>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="email-change-form"
            className="self-start rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm transition hover:bg-[var(--surface-muted)]"
          >
            {open ? 'Annuler' : 'Changer d’adresse'}
          </button>

          {open ? (
            <form
              id="email-change-form"
              onSubmit={(e) => void submit(e)}
              className="flex flex-col gap-3 border-t border-[var(--border)] pt-3"
            >
              <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--foreground-muted)]">
                Un lien de vérification sera envoyé à la nouvelle adresse et votre compte ne
                changera qu’après confirmation.{' '}
                <span className="font-semibold">
                  Aucun service d’envoi d’emails n’étant encore branché, ce lien ne partira pas : le
                  changement restera en attente.
                </span>
              </p>

              <label htmlFor="new-email" className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Nouvelle adresse email</span>
              </label>
              <input
                id="new-email"
                name="newEmail"
                type="email"
                autoComplete="email"
                required
                value={newEmail}
                onChange={(e) => {
                  setNewEmail(e.target.value);
                  if (emailError) setEmailError(validateEmail(e.target.value));
                }}
                aria-invalid={emailError !== null}
                {...(emailError ? { 'aria-describedby': 'new-email-error' } : {})}
                {...(emailError ? { 'aria-errormessage': 'new-email-error' } : {})}
                className={[
                  '-mt-2 rounded-md border bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition',
                  emailError
                    ? 'border-[var(--danger)] bg-[var(--danger-bg)]'
                    : 'border-[var(--border)] focus:border-[var(--accent)]',
                ].join(' ')}
              />
              {emailError ? (
                <p
                  id="new-email-error"
                  role="alert"
                  className="-mt-2 text-xs font-medium text-[var(--danger)]"
                >
                  <span className="font-semibold">Erreur : </span>
                  {emailError}
                </p>
              ) : null}

              <label htmlFor="email-change-password" className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Mot de passe actuel</span>
              </label>
              <input
                id="email-change-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="email-change-password-help"
                className="-mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
              />
              <p
                id="email-change-password-help"
                className="-mt-2 text-xs italic text-[var(--foreground-muted)]"
              >
                Exigé pour qu’une session laissée ouverte ne suffise pas à déplacer votre compte.
              </p>

              <button
                type="submit"
                disabled={submitting || newEmail.trim().length === 0 || password.length === 0}
                className="self-start rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Envoi…' : 'Demander le changement'}
              </button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo de profil (ADR-0016 E4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grand format de l'avatar — le seul des trois emplacements qui vive hors du
 * header (ADR-0016 §7).
 *
 * Les initiales sont rendues DESSOUS, toujours. L'image se pose par-dessus et
 * s'efface d'elle-même sur `onError` : l'URL porte un jeton à durée limitée et
 * peut expirer pendant que la page est ouverte. Sans ce repli, on afficherait
 * une case brisée à quelqu'un qui n'a rien fait.
 *
 * Dimensions fixes : la mise en page ne doit pas sauter entre les initiales et
 * l'arrivée de l'image.
 */
function AvatarGrandFormat({ profile }: { profile: AccountProfileView }): React.ReactElement {
  const [cassee, setCassee] = useState(false);
  useEffect(() => {
    setCassee(false);
  }, [profile.avatarUrl]);

  return (
    <span
      aria-hidden="true"
      className="font-display relative inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] text-lg font-black text-[var(--accent)]"
    >
      {profile.initials}
      {profile.avatarUrl !== null && !cassee ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.avatarUrl}
          alt=""
          onError={() => setCassee(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

/** Octets en unité lisible — pour dire une limite, pas pour compter juste. */
function formatOctets(octets: number): string {
  const mio = octets / (1024 * 1024);
  return mio >= 1
    ? `${mio.toFixed(mio < 10 ? 1 : 0).replace('.', ',')} Mio`
    : `${Math.round(octets / 1024)} Kio`;
}

/**
 * Refus de l'API traduits en phrases qui disent QUOI FAIRE.
 *
 * Les codes viennent du contrat d'envoi. Un code inconnu retombe sur le message
 * du serveur plutôt que sur une phrase inventée qui masquerait la vraie cause.
 */
const REFUS_AVATAR: Record<string, string> = {
  FILE_TOO_LARGE: 'Cette image est trop lourde. Choisissez un fichier plus léger.',
  UNSUPPORTED_IMAGE_TYPE: 'Ce format n’est pas accepté. Utilisez un PNG, un JPEG ou un WebP.',
  IMAGE_DIMENSIONS_REJECTED: 'Les dimensions de cette image sont hors des bornes acceptées.',
  EMPTY_FILE: 'Le fichier est vide.',
  MALFORMED_IMAGE: 'Ce fichier n’est pas une image lisible.',
  STORAGE_UNAVAILABLE:
    'Le stockage des images ne répond pas pour l’instant. Réessayez dans un moment.',
};

function messageAvatar(err: unknown, repli: string): string {
  const detail = (err as { detail?: { code?: string; message?: string } }).detail;
  const code = detail?.code;
  if (code && REFUS_AVATAR[code]) return REFUS_AVATAR[code];
  if ((err as { status?: number }).status === 429) {
    return 'Trop d’envois en peu de temps. Réessayez dans un moment.';
  }
  return detail?.message ?? (err instanceof Error && err.message !== '' ? err.message : repli);
}

/**
 * Choix, envoi et retrait de la photo.
 *
 * LE RETRAIT EXISTE, et ce n'est pas un détail : une photo qu'on ne peut pas
 * enlever est un piège. L'endpoint est idempotent — un double clic ne produit
 * ni 404 ni erreur.
 *
 * Quand `storageAvailable` est faux, le bouton est DÉSACTIVÉ et la raison est
 * écrite. Laisser choisir un fichier pour répondre 503 ensuite ferait perdre du
 * temps et donnerait l'impression d'un bug côté utilisateur.
 */
function AvatarControls({ profile }: { profile: AccountProfileView }): React.ReactElement {
  const [limites, setLimites] = useState<AvatarLimitsView | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const champRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let annule = false;
    void api
      .getAvatarLimits()
      .then((l) => {
        if (!annule) setLimites(l);
      })
      // Les bornes inconnues ne bloquent pas l'envoi : l'API reste l'autorité et
      // refusera elle-même. On perd le confort, pas la fonction.
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  async function envoyer(file: File): Promise<void> {
    setErreur(null);

    // Validation côté client — un CONFORT, qui évite d'envoyer des octets pour
    // rien. L'API tranche de toute façon, et sur le contenu réel du fichier.
    if (limites) {
      if (file.size > limites.maxBytes) {
        setErreur(`Cette image dépasse ${formatOctets(limites.maxBytes)}.`);
        return;
      }
      if (file.type !== '' && !limites.acceptedTypes.includes(file.type)) {
        setErreur(REFUS_AVATAR['UNSUPPORTED_IMAGE_TYPE']!);
        return;
      }
    }

    setOccupe(true);
    try {
      const res = await api.postAccountAvatar(file);
      // Le profil partagé est mis à jour sur place : la pastille du header suit
      // immédiatement, sans relire le profil.
      publierProfil({
        ...profile,
        avatar: res.avatar,
        avatarUrl: res.avatarUrl,
        initials: res.initials,
      });
    } catch (err) {
      setErreur(messageAvatar(err, 'Impossible d’envoyer cette image.'));
    } finally {
      setOccupe(false);
      // Le champ est vidé pour que re-choisir LE MÊME fichier redéclenche bien
      // un `change` après un échec.
      if (champRef.current) champRef.current.value = '';
    }
  }

  async function retirer(): Promise<void> {
    setErreur(null);
    setOccupe(true);
    try {
      const res = await api.deleteAccountAvatar();
      publierProfil({ ...profile, avatar: null, avatarUrl: null, initials: res.initials });
    } catch (err) {
      setErreur(messageAvatar(err, 'Impossible de retirer cette image.'));
    } finally {
      setOccupe(false);
    }
  }

  const stockageHs = limites !== null && !limites.storageAvailable;
  const accept = limites?.acceptedTypes.join(',') ?? 'image/png,image/jpeg,image/webp';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={[
            'rounded-md border border-[var(--border)] px-3 py-2 text-sm transition',
            stockageHs || occupe
              ? 'cursor-not-allowed opacity-50'
              : 'cursor-pointer hover:bg-[var(--surface-muted)]',
          ].join(' ')}
        >
          {occupe ? 'Envoi…' : profile.avatar ? 'Changer la photo' : 'Ajouter une photo'}
          <input
            ref={champRef}
            type="file"
            accept={accept}
            disabled={stockageHs || occupe}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void envoyer(file);
            }}
            className="sr-only"
          />
        </label>

        {profile.avatar ? (
          <button
            type="button"
            onClick={() => void retirer()}
            disabled={stockageHs || occupe}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
          >
            Retirer la photo
          </button>
        ) : null}
      </div>

      {erreur ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}

      <p className="text-xs text-[var(--foreground-muted)]">
        {stockageHs
          ? 'L’envoi de photo est indisponible : le stockage des images ne répond pas. Vos initiales tiennent lieu de photo.'
          : profile.avatar
            ? 'Sans photo, vos initiales sont affichées.'
            : `Vos initiales sont affichées tant qu’aucune photo n’est posée.${
                limites ? ` PNG, JPEG ou WebP, ${formatOctets(limites.maxBytes)} au plus.` : ''
              }`}
      </p>
    </div>
  );
}
