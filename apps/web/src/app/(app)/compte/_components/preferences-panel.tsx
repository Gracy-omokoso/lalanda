'use client';

// Préférences (S20b) — thème, devise d'affichage par défaut, notifications.
// ADR-0055 : le thème d'interface (Lalanda, Lagune, Ébène) s'ajoute au mode
// clair/sombre ; Ébène, toujours sombre, désactive ce dernier en disant pourquoi.
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

import { NAV_TOKENS, THEME_TOKENS, type Combinaison } from '@lalanda/ui';

import { api, type AccountPreferencesView, type NotificationPreferences } from '@/lib/api';
import {
  applyAppearance,
  applyThemePreference,
  applyUiTheme,
  isUiTheme,
  DEFAULT_UI_THEME,
  UI_THEMES,
  uiThemeForcesDark,
  type ThemePreference,
  type UiTheme,
} from '@/lib/theme';

import {
  CURRENCY_LABELS,
  NOTIFICATION_LABELS,
  THEME_DESCRIPTIONS,
  THEME_LABELS,
  UI_THEME_LABELS,
  accountErrorMessage,
  preferencesAreDirty,
} from './account-model';

interface FormState {
  theme: ThemePreference;
  uiTheme: UiTheme;
  displayCurrency: string;
  notifications: NotificationPreferences;
}

function formOf(prefs: AccountPreferencesView): FormState {
  return {
    theme: prefs.theme,
    uiTheme: isUiTheme(prefs.uiTheme) ? prefs.uiTheme : DEFAULT_UI_THEME,
    displayCurrency: prefs.displayCurrency,
    notifications: { ...prefs.notifications },
  };
}

/** Combinaison montrée en aperçu : la variante claire, sauf Ébène (toujours sombre). */
const APERCU: Record<UiTheme, Combinaison> = {
  lalanda: 'lalanda-light',
  lagune: 'lagune-light',
  ebene: 'ebene',
};

/** Pastilles d'aperçu : barre de navigation, fond, surface, accent. */
function ThemeSwatches({ uiTheme }: { uiTheme: UiTheme }): React.ReactElement {
  const c = APERCU[uiTheme];
  const couleurs = [
    NAV_TOKENS[c]['nav-bg'],
    THEME_TOKENS[c].background,
    THEME_TOKENS[c].surface,
    THEME_TOKENS[c].accent,
  ];
  return (
    <span aria-hidden="true" className="flex gap-1">
      {couleurs.map((couleur, i) => (
        <span
          key={i}
          className="h-5 w-5 rounded-full border border-[var(--border-strong)]"
          style={{ background: couleur }}
        />
      ))}
    </span>
  );
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
      applyAppearance(prefs);
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

  function chooseUiTheme(uiTheme: UiTheme): void {
    setForm((f) => (f ? { ...f, uiTheme } : f));
    applyUiTheme(uiTheme);
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
        uiTheme: form.uiTheme,
        displayCurrency: form.displayCurrency as AccountPreferencesView['displayCurrency'],
        notifications: form.notifications,
      });
      // La réponse d'écriture ne porte pas `options` : on conserve celles déjà
      // servies, sinon les menus déroulants se videraient après un enregistrement.
      const merged: AccountPreferencesView = { ...saved, ...updated };
      setSaved(merged);
      setForm(formOf(merged));
      applyAppearance(merged);
      setNotice('Préférences enregistrées.');
    } catch (err) {
      const detail = (err as { detail?: { code?: string; message?: string } }).detail;
      setError(accountErrorMessage(detail, 'Impossible d’enregistrer vos préférences'));
      // Le thème revient à la dernière valeur RÉELLEMENT enregistrée : l'écran ne
      // doit pas rester dans une apparence que le serveur ne connaît pas.
      if (saved) applyAppearance(saved);
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
  const uiThemes = (saved.options.uiThemes ?? UI_THEMES).filter(isUiTheme);
  const modeForce = uiThemeForcesDark(form.uiTheme);

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
      {/* `loadError` est repris ici : un rechargement raté APRÈS un premier
          chargement réussi laisse le formulaire à l'écran avec des valeurs
          périmées. Il faut le dire, sinon l'utilisateur enregistre par-dessus
          une lecture qu'il croit à jour. */}
      {(error ?? loadError) ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur : </strong>
          {error ?? loadError}
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

        <p id="ui-theme-label" className="text-sm font-medium">
          Thème
        </p>
        <div
          role="radiogroup"
          aria-labelledby="ui-theme-label"
          aria-describedby="theme-help"
          className="grid gap-2 sm:grid-cols-3"
        >
          {uiThemes.map((value) => {
            const checked = form.uiTheme === value;
            const meta = UI_THEME_LABELS[value];
            return (
              <label
                key={value}
                className={[
                  'flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-sm transition',
                  checked
                    ? 'border-[var(--accent)] bg-[var(--surface-muted)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-muted)]',
                ].join(' ')}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="uiTheme"
                      value={value}
                      checked={checked}
                      onChange={() => chooseUiTheme(value)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="font-medium">{meta?.label ?? value}</span>
                  </span>
                  <ThemeSwatches uiTheme={value} />
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {meta?.description ?? ''}
                </span>
              </label>
            );
          })}
        </div>

        <p id="mode-label" className="mt-2 text-sm font-medium">
          Clair ou sombre
        </p>
        {modeForce ? (
          <p id="mode-force" className="-mt-1 text-xs text-[var(--foreground-muted)]">
            Ébène est toujours sombre : ce réglage ne s’applique pas. Il est conservé et reprend
            effet si vous choisissez Lalanda ou Lagune.
          </p>
        ) : null}
        {/* Groupe de radios : le clavier y navigue avec les flèches, et le choix
            actif est porté par le libellé et l'état coché, jamais par la seule
            bordure colorée (docs/04 § Accessibilité). */}
        <div
          role="radiogroup"
          aria-labelledby="mode-label"
          aria-describedby={modeForce ? 'mode-force' : 'theme-help'}
          aria-disabled={modeForce || undefined}
          className="grid gap-2 sm:grid-cols-3"
        >
          {themes.map((value) => {
            const checked = form.theme === value;
            return (
              <label
                key={value}
                className={[
                  'flex flex-col gap-1 rounded-lg border p-3 text-sm transition',
                  modeForce ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                  checked
                    ? 'border-[var(--accent)] bg-[var(--surface-muted)]'
                    : `border-[var(--border)] ${modeForce ? '' : 'hover:bg-[var(--surface-muted)]'}`,
                ].join(' ')}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={checked}
                    disabled={modeForce}
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
          Devise proposée par défaut à la création d’une initiative. Elle ne convertit RIEN et ne
          modifie aucune initiative existante : chaque initiative garde la devise dans laquelle elle
          a été saisie.
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
