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

import {
  Checkbox,
  ChoiceCards,
  Field,
  FormGrid,
  NAV_TOKENS,
  Select,
  SubmitButton,
  THEME_TOKENS,
  type Combinaison,
} from '@lalanda/ui';

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

        {/* Cartes de choix (`radiogroup`) : un seul arrêt de tabulation, les flèches
            déplacent et choisissent ; le choix actif est porté par l'état coché et
            le libellé, jamais par la seule bordure colorée (docs/04 § Accessibilité). */}
        <FormGrid>
          <Field label="Thème" group size="full">
            <ChoiceCards<UiTheme>
              value={form.uiTheme}
              onChange={chooseUiTheme}
              aria-describedby="theme-help"
              columns={3}
              options={uiThemes.map((value) => ({
                value,
                label: (
                  <span className="flex items-center justify-between gap-2">
                    <span>{UI_THEME_LABELS[value]?.label ?? value}</span>
                    <ThemeSwatches uiTheme={value} />
                  </span>
                ),
                description: UI_THEME_LABELS[value]?.description ?? '',
              }))}
            />
          </Field>
          <Field
            label="Clair ou sombre"
            group
            size="full"
            disabled={modeForce}
            hint={
              modeForce
                ? 'Ébène est toujours sombre : ce réglage ne s’applique pas. Il est conservé et reprend effet si vous choisissez Lalanda ou Lagune.'
                : undefined
            }
          >
            <ChoiceCards<ThemePreference>
              value={form.theme}
              onChange={chooseTheme}
              aria-describedby={modeForce ? undefined : 'theme-help'}
              columns={3}
              options={themes.map((value) => ({
                value: value as ThemePreference,
                label: THEME_LABELS[value] ?? value,
                description: THEME_DESCRIPTIONS[value] ?? '',
              }))}
            />
          </Field>
        </FormGrid>
      </fieldset>

      {/* ─── Devise ────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <legend className="font-mono px-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
          Devise
        </legend>

        <FormGrid>
          <Field
            id="display-currency"
            label="Devise d’affichage par défaut"
            size="md"
            hint="Devise proposée par défaut à la création d’une initiative. Elle ne convertit RIEN et ne modifie aucune initiative existante : chaque initiative garde la devise dans laquelle elle a été saisie."
          >
            <Select
              name="displayCurrency"
              value={form.displayCurrency}
              onChange={(displayCurrency) => setForm((f) => (f ? { ...f, displayCurrency } : f))}
              options={saved.options.currencies.map((code) => ({
                value: code,
                label: CURRENCY_LABELS[code] ?? code,
                keywords: code,
              }))}
            />
          </Field>
        </FormGrid>
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
            return (
              <li
                key={key}
                className="rounded-lg px-2 py-2 transition hover:bg-[var(--surface-muted)]"
              >
                <Checkbox
                  id={`notif-${key}`}
                  name={key}
                  checked={value}
                  onChange={(coche) =>
                    setForm((f) =>
                      f ? { ...f, notifications: { ...f.notifications, [key]: coche } } : f,
                    )
                  }
                  label={<span className="font-medium">{meta?.label ?? key}</span>}
                  description={meta?.description || undefined}
                />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={saving} busyLabel="Enregistrement…" disabled={!dirty}>
          Enregistrer
        </SubmitButton>
        {/* `aria-live` : le succès est annoncé, pas seulement affiché. */}
        <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
          {notice ?? (dirty ? 'Modifications non enregistrées' : '')}
        </span>
      </div>
    </form>
  );
}
