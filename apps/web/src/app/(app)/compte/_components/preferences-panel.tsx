'use client';

// Préférences (S20b) — thème, devise d'affichage par défaut, notifications.
//
// États couverts (docs/04 § États obligatoires) : chargement, erreur récupérable
// (avec réessai), succès. Pas d'état vide : l'API sert toujours des valeurs, les
// défauts avant toute écriture.
//
// LE THÈME EST APPLIQUÉ IMMÉDIATEMENT, AVANT L'ALLER-RETOUR RÉSEAU.
// Un réglage d'apparence dont l'effet attend la réponse du serveur donne
// l'impression que le clic n'a pas été pris en compte. En cas d'échec de
// l'enregistrement, on remet le thème précédemment enregistré et on le dit :
// l'écran ne reste jamais dans un état que le serveur ignore.

import { useCallback, useEffect, useState } from 'react';

import { api, type AccountPreferencesView, type NotificationPreferences } from '@/lib/api';
import { applyThemePreference, type ThemePreference } from '@/lib/theme';

import {
  CURRENCY_LABELS,
  NOTIFICATION_LABELS,
  THEME_DESCRIPTIONS,
  THEME_LABELS,
  accountErrorMessage,
  preferencesAreDirty,
} from './account-model';

interface FormState {
  theme: ThemePreference;
  displayCurrency: string;
  notifications: NotificationPreferences;
}

function formOf(prefs: AccountPreferencesView): FormState {
  return {
    theme: prefs.theme,
    displayCurrency: prefs.displayCurrency,
    notifications: { ...prefs.notifications },
  };
}

export function PreferencesPanel(): React.ReactElement {
  const [saved, setSaved] = useState<AccountPreferencesView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const prefs = await api.getAccountPreferences();
      setSaved(prefs);
      setForm(formOf(prefs));
      // Le thème enregistré fait autorité au chargement de l'écran : c'est ce qui
      // rend la préférence réellement « persistée serveur » d'un appareil à l'autre.
      applyThemePreference(prefs.theme);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Impossible de charger vos préférences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function chooseTheme(theme: ThemePreference): void {
    setForm((f) => (f ? { ...f, theme } : f));
    applyThemePreference(theme);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.putAccountPreferences({
        theme: form.theme,
        displayCurrency: form.displayCurrency as AccountPreferencesView['displayCurrency'],
        notifications: form.notifications,
      });
      // La réponse d'écriture ne porte pas `options` : on conserve celles déjà
      // servies pour ne pas vider les menus déroulants après un enregistrement.
      setSaved((prev) => (prev ? { ...prev, ...updated } : prev));
      setForm(formOf({ ...(saved as AccountPreferencesView), ...updated }));
      applyThemePreference(updated.theme);
      setNotice('Préférences enregistrées.');
    } catch (err) {
      const detail = (err as { detail?: { code?: string; message?: string } }).detail;
      setError(accountErrorMessage(detail, 'Impossible d’enregistrer vos préférences'));
      // Le thème revient à la dernière valeur RÉELLEMENT enregistrée : l'écran ne
      // doit pas rester dans une apparence que le serveur ne connaît pas.
      if (saved) applyThemePreference(saved.theme);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p role="status" className="text-sm text-[var(--foreground-muted)]">
        Chargement de vos préférences…
      </p>
    );
  }

  if (!form || !saved) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-5 text-sm text-[var(--danger)]"
      >
        <p>
          <strong>Erreur : </strong>
          {loadError ?? 'Préférences indisponibles.'}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-[var(--danger)]/40 px-3 py-1.5 text-sm transition hover:bg-[var(--surface)]"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const dirty = preferencesAreDirty(form, formOf(saved));
  const themes =
    saved.options.themes.length > 0 ? saved.options.themes : ['system', 'light', 'dark'];

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur : </strong>
          {error}
        </div>
      ) : null}

      {/* ─── Thème ─────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <legend className="font-mono px-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
          Apparence
        </legend>
        <p id="theme-help" className="text-sm text-[var(--foreground-muted)]">
          Le thème est enregistré sur votre compte : vous le retrouvez sur tous vos appareils.
        </p>
        {/* Groupe de radios : le clavier y navigue avec les flèches, et le choix
            actif est porté par le libellé et l'état coché, jamais par la seule
            bordure colorée (docs/04 § Accessibilité). */}
        <div
          role="radiogroup"
          aria-label="Thème de l’interface"
          aria-describedby="theme-help"
          className="grid gap-2 sm:grid-cols-3"
        >
          {themes.map((value) => {
            const checked = form.theme === value;
            return (
              <label
                key={value}
                className={[
                  'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition',
                  checked
                    ? 'border-[var(--accent)] bg-[var(--surface-muted)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-muted)]',
                ].join(' ')}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={checked}
                    onChange={() => chooseTheme(value as ThemePreference)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="font-medium">{THEME_LABELS[value] ?? value}</span>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {THEME_DESCRIPTIONS[value] ?? ''}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ─── Devise ────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <legend className="font-mono px-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
          Devise
        </legend>

        <label htmlFor="display-currency" className="text-sm font-medium">
          Devise d’affichage par défaut
        </label>
        <select
          id="display-currency"
          name="displayCurrency"
          value={form.displayCurrency}
          onChange={(e) => setForm((f) => (f ? { ...f, displayCurrency: e.target.value } : f))}
          aria-describedby="display-currency-help"
          className="-mt-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
        >
          {saved.options.currencies.map((code) => (
            <option key={code} value={code}>
              {CURRENCY_LABELS[code] ?? code}
            </option>
          ))}
        </select>
        <p
          id="display-currency-help"
          className="-mt-1 text-xs italic text-[var(--foreground-muted)]"
        >
          Devise proposée par défaut à la création d’un projet. Elle ne convertit RIEN et ne modifie
          aucun projet existant : chaque projet garde la devise dans laquelle il a été saisi.
        </p>
      </fieldset>

      {/* ─── Notifications ─────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <legend className="font-mono px-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
          Notifications
        </legend>

        <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--foreground-muted)]">
          <span className="font-semibold">À savoir : </span>
          aucun email n’est envoyé pour l’instant — aucun service d’envoi n’est encore branché sur
          Lalanda. Ces réglages sont bien enregistrés sur votre compte et seront respectés dès la
          mise en service ; d’ici là, cocher une case ne déclenchera aucun message.
        </p>

        <ul className="flex flex-col gap-1">
          {Object.entries(form.notifications).map(([key, value]) => {
            const meta = NOTIFICATION_LABELS[key];
            const id = `notif-${key}`;
            return (
              <li key={key}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--surface-muted)]"
                >
                  <input
                    id={id}
                    type="checkbox"
                    name={key}
                    checked={value}
                    onChange={(e) =>
                      setForm((f) =>
                        f
                          ? { ...f, notifications: { ...f.notifications, [key]: e.target.checked } }
                          : f,
                      )
                    }
                    aria-describedby={`${id}-help`}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{meta?.label ?? key}</span>
                    <span id={`${id}-help`} className="text-xs text-[var(--foreground-muted)]">
                      {meta?.description ?? ''}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {/* `aria-live` : le succès est annoncé, pas seulement affiché. */}
        <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
          {notice ?? (dirty ? 'Modifications non enregistrées' : '')}
        </span>
      </div>
    </form>
  );
}
