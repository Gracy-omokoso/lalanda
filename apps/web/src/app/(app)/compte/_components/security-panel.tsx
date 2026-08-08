'use client';

// Sécurité (S20b) — mot de passe, sessions actives, suppression du compte.
//
// États couverts (docs/04 § États obligatoires) : chargement, vide (aucune autre
// session), erreur récupérable, succès.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { authClient, signOut } from '@/lib/auth-client';
import { api, type AccountSessionView, type DeletionAssessment } from '@/lib/api';

import { accountErrorMessage, formatSessionDate } from './account-model';

export function SecurityPanel(): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <PasswordSection />
      <SessionsSection />
      <DeleteAccountSection />
    </div>
  );
}

/**
 * Changement de mot de passe.
 *
 * Passe DIRECTEMENT par better-auth (`authClient.changePassword`) plutôt que par
 * un endpoint maison : better-auth vérifie l'ancien mot de passe, applique sa
 * politique de hachage et — point décisif — fait tourner le cookie de session
 * dans sa réponse. Un proxy intermédiaire devrait retransmettre ce `Set-Cookie`
 * à l'identique, et le moindre écart déconnecterait l'utilisateur au moment
 * précis où il sécurise son compte.
 */
function PasswordSection(): React.ReactElement {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: revokeOthers,
      });
      if (res.error) {
        setError(
          res.error.code === 'INVALID_PASSWORD'
            ? 'Mot de passe actuel incorrect.'
            : (res.error.message ?? 'Impossible de changer le mot de passe'),
        );
        return;
      }
      setSuccess(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de changer le mot de passe');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
        Mot de passe
      </h2>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur :</strong> {error}
        </div>
      ) : null}

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <label htmlFor="current-password" className="text-sm font-medium">
          Mot de passe actuel
        </label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="-mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
        />

        <label htmlFor="new-password" className="text-sm font-medium">
          Nouveau mot de passe
        </label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          aria-invalid={tooShort}
          aria-describedby={tooShort ? 'new-password-error' : 'new-password-help'}
          {...(tooShort ? { 'aria-errormessage': 'new-password-error' } : {})}
          className={[
            '-mt-2 rounded-md border bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition',
            tooShort
              ? 'border-[var(--danger)] bg-[var(--danger-bg)]'
              : 'border-[var(--border)] focus:border-[var(--accent)]',
          ].join(' ')}
        />
        {tooShort ? (
          <p
            id="new-password-error"
            role="alert"
            className="-mt-2 text-xs font-medium text-[var(--danger)]"
          >
            <span className="font-semibold">Erreur : </span>8 caractères minimum.
          </p>
        ) : (
          <p id="new-password-help" className="-mt-2 text-xs italic text-[var(--foreground-muted)]">
            8 caractères minimum.
          </p>
        )}

        <label htmlFor="confirm-password" className="text-sm font-medium">
          Confirmer le nouveau mot de passe
        </label>
        <input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch}
          {...(mismatch ? { 'aria-describedby': 'confirm-password-error' } : {})}
          {...(mismatch ? { 'aria-errormessage': 'confirm-password-error' } : {})}
          className={[
            '-mt-2 rounded-md border bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition',
            mismatch
              ? 'border-[var(--danger)] bg-[var(--danger-bg)]'
              : 'border-[var(--border)] focus:border-[var(--accent)]',
          ].join(' ')}
        />
        {mismatch ? (
          <p
            id="confirm-password-error"
            role="alert"
            className="-mt-2 text-xs font-medium text-[var(--danger)]"
          >
            <span className="font-semibold">Erreur : </span>
            Les deux mots de passe ne correspondent pas.
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={revokeOthers}
            onChange={(e) => setRevokeOthers(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span>Déconnecter mes autres appareils</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={
              submitting || mismatch || tooShort || current.length === 0 || next.length === 0
            }
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Modification…' : 'Changer le mot de passe'}
          </button>
          <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
            {success ? 'Mot de passe modifié.' : ''}
          </span>
        </div>
      </form>
    </section>
  );
}

/** Sessions actives, avec révocation unitaire et « toutes les autres ». */
function SessionsSection(): React.ReactElement {
  const [sessions, setSessions] = useState<AccountSessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | undefined>(undefined);

  const load = useCallback(async (): Promise<void> => {
    try {
      const { sessions } = await api.listAccountSessions();
      setSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger vos sessions');
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // Le fuseau du profil sert à AFFICHER les dates de session : une heure
      // dans un fuseau que l'utilisateur ne pratique pas ne l'aide pas à
      // reconnaître ses propres connexions.
      try {
        const prefs = await api.getAccountPreferences();
        setTimezone(prefs.timezone);
      } catch {
        /* le fuseau local du navigateur fera l'affaire */
      }
      await load();
    })();
  }, [load]);

  async function revoke(session: AccountSessionView): Promise<void> {
    if (!confirm(`Révoquer la session « ${session.device} » ?`)) return;
    setBusy(session.id);
    setError(null);
    setNotice(null);
    try {
      await api.revokeAccountSession(session.id);
      setNotice('Session révoquée.');
      await load();
    } catch (err) {
      const detail = (err as { detail?: { code?: string; message?: string } }).detail;
      setError(accountErrorMessage(detail, 'Impossible de révoquer cette session'));
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers(): Promise<void> {
    if (!confirm('Déconnecter tous vos autres appareils ?')) return;
    setBusy('others');
    setError(null);
    setNotice(null);
    try {
      const { revoked } = await api.revokeOtherAccountSessions();
      setNotice(
        revoked === 0
          ? 'Aucune autre session à révoquer.'
          : `${revoked} session${revoked > 1 ? 's' : ''} révoquée${revoked > 1 ? 's' : ''}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de révoquer les autres sessions');
    } finally {
      setBusy(null);
    }
  }

  const others = (sessions ?? []).filter((s) => !s.current);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
          Sessions actives
        </h2>
        {others.length > 0 ? (
          <button
            type="button"
            onClick={() => void revokeOthers()}
            disabled={busy !== null}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground-muted)] transition hover:border-[var(--danger)]/40 hover:text-[var(--danger)] disabled:opacity-50"
          >
            {busy === 'others' ? 'Révocation…' : 'Déconnecter les autres appareils'}
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur :</strong> {error}
        </div>
      ) : null}

      <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {notice ?? ''}
      </span>

      {sessions === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement de vos sessions…</p>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-sm text-[var(--foreground-muted)]">
            Aucune session active à afficher.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.device}</span>
                  {s.current ? (
                    // Le statut « session courante » est porté par du TEXTE, pas
                    // par une pastille colorée seule (docs/04 § Accessibilité).
                    <span className="rounded-full border border-[var(--accent)] px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.06em] text-[var(--accent)]">
                      Session actuelle
                    </span>
                  ) : null}
                </span>
                <span className="fig text-xs text-[var(--foreground-muted)]">
                  {s.ipAddress ?? '—'} · dernière activité{' '}
                  {formatSessionDate(s.lastActiveAt, timezone)}
                </span>
                <span className="fig text-xs text-[var(--foreground-muted)]">
                  Ouverte le {formatSessionDate(s.createdAt, timezone)} · expire le{' '}
                  {formatSessionDate(s.expiresAt, timezone)}
                </span>
              </div>
              {s.current ? null : (
                <button
                  type="button"
                  onClick={() => void revoke(s)}
                  disabled={busy !== null}
                  className="shrink-0 self-start rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground-muted)] transition hover:border-[var(--danger)]/40 hover:text-[var(--danger)] disabled:opacity-50 sm:self-auto"
                >
                  {busy === s.id ? 'Révocation…' : 'Révoquer'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sessions !== null && others.length === 0 && sessions.length > 0 ? (
        <p className="text-xs italic text-[var(--foreground-muted)]">
          Vous n’êtes connecté que depuis cet appareil.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Suppression du compte — action irréversible, donc confirmation forte et portée
 * annoncée (docs/04 § Conventions).
 *
 * L'éligibilité est chargée AVANT toute saisie : un dernier propriétaire
 * d'organisation doit l'apprendre en arrivant, pas après avoir tapé son adresse
 * et son mot de passe pour rien.
 */
function DeleteAccountSection(): React.ReactElement {
  const router = useRouter();
  const [assessment, setAssessment] = useState<DeletionAssessment | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.getAccountDeletion();
        if (!cancelled) setAssessment(res);
      } catch {
        // Ne bloque pas l'écran : le serveur revalide de toute façon la règle.
        if (!cancelled) setAssessment(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.deleteAccount({ confirmEmail: confirmEmail.trim(), currentPassword: password });
      await signOut();
      router.push('/login');
      router.refresh();
    } catch (err) {
      const detail = (err as { detail?: { code?: string; message?: string } }).detail;
      setError(accountErrorMessage(detail, 'Impossible de supprimer le compte'));
      setSubmitting(false);
    }
  }

  const blocked = assessment !== null && !assessment.canDelete;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--surface)] p-5">
      <h2 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--danger)]">
        Supprimer mon compte
      </h2>

      {blocked ? (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--warn)]/40 bg-[var(--surface-muted)] p-3 text-sm">
          <p>
            <span className="font-semibold">Suppression impossible pour l’instant : </span>
            vous êtes le dernier propriétaire{' '}
            {assessment!.blockingOrganizations.length > 1
              ? 'des organisations suivantes'
              : 'de l’organisation suivante'}
            , qui compte d’autres membres.
          </p>
          <ul className="flex flex-col gap-1">
            {assessment!.blockingOrganizations.map((o) => (
              <li key={o.id} className="text-sm">
                <strong>{o.name}</strong>{' '}
                <span className="text-[var(--foreground-muted)]">
                  — {o.otherMemberCount} autre{o.otherMemberCount > 1 ? 's' : ''} membre
                  {o.otherMemberCount > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--foreground-muted)]">
            Transférez la propriété à un autre membre, ou supprimez l’organisation, puis revenez
            ici. Sans cela, l’organisation resterait sans personne pour gérer ses membres et son
            abonnement.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--foreground-muted)]">
            Cette action est définitive. Votre compte, vos préférences et vos sessions sont
            supprimés.
            {assessment && assessment.organizationsDeletedWithAccount.length > 0 ? (
              <>
                {' '}
                {assessment.organizationsDeletedWithAccount.length > 1
                  ? 'Les organisations suivantes seront également supprimées, avec tous leurs projets et plans :'
                  : 'L’organisation suivante sera également supprimée, avec tous ses projets et plans :'}{' '}
                <strong className="text-[var(--foreground)]">
                  {assessment.organizationsDeletedWithAccount.map((o) => o.name).join(', ')}
                </strong>
                .
              </>
            ) : null}
          </p>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="delete-account-form"
            className="self-start rounded-md border border-[var(--danger)]/40 px-3 py-1.5 text-sm text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
          >
            {open ? 'Annuler' : 'Supprimer mon compte'}
          </button>

          {open ? (
            <form
              id="delete-account-form"
              onSubmit={(e) => void submit(e)}
              className="flex flex-col gap-3 border-t border-[var(--border)] pt-3"
            >
              {error ? (
                <div
                  role="alert"
                  className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
                >
                  <strong>Erreur :</strong> {error}
                </div>
              ) : null}

              <label htmlFor="delete-confirm-email" className="text-sm font-medium">
                Saisissez votre adresse email pour confirmer
              </label>
              <input
                id="delete-confirm-email"
                name="confirmEmail"
                type="email"
                autoComplete="off"
                required
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                aria-describedby="delete-confirm-email-help"
                className="-mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
              />
              <p
                id="delete-confirm-email-help"
                className="-mt-2 text-xs italic text-[var(--foreground-muted)]"
              >
                Exactement l’adresse de votre compte.
              </p>

              <label htmlFor="delete-password" className="text-sm font-medium">
                Mot de passe actuel
              </label>
              <input
                id="delete-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="-mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
              />

              <button
                type="submit"
                disabled={submitting || confirmEmail.length === 0 || password.length === 0}
                className="self-start rounded-md bg-[var(--danger)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Suppression…' : 'Supprimer définitivement mon compte'}
              </button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
