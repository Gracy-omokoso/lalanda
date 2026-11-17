'use client';

// Réglages de notification de l'ORGANISATION — ADR-0079 § 4 (`organization.manage`).
//
// Mode par défaut du chef de projet (et de l'adjoint), des autres membres et, au besoin,
// par rôle d'organisation ; notifications rendues OBLIGATOIRES (type × canal) ; plafond
// quotidien WhatsApp par personne ; journal d'envoi de l'organisation (sans contenu).

import {
  DEFAULT_MANDATORY_NOTIFICATIONS,
  NOTIFICATION_MODES,
  NOTIFICATION_MODE_LABELS,
  NOTIFICATION_SETTINGS_LIMITS,
  type MandatoryNotification,
  type NotificationChannel,
  type NotificationMode,
  type NotificationOrgSettingsView,
} from '@lalanda/shared/notifications';
import { Alert, Button, Checkbox, Field, FormGrid, Select, Skeleton, TextInput } from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import { api, type RoleOption } from '@/lib/api';
import { notificationsApi } from '@/lib/notifications-api';

import { useShell } from '../../_components/shell-context';
import { messageWork } from '../../projets/_components/projets-model';
import { CANAUX, LIBELLES_CANAUX, groupesCatalogue } from '../reglages-model';

import { CarteNotifications as Carte, JournalEnvois } from './mes-notifications';

const OPTIONS_MODES = NOTIFICATION_MODES.map((m) => ({
  value: m,
  label: NOTIFICATION_MODE_LABELS[m],
}));

function aObligation(
  liste: readonly MandatoryNotification[],
  kind: string,
  channel: NotificationChannel,
): boolean {
  return liste.some((m) => m.kind === kind && m.channel === channel);
}

export function ReglagesOrganisation(): React.ReactElement | null {
  const id = useId();
  const { organizationId } = useShell();
  const [vue, setVue] = useState<NotificationOrgSettingsView | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [plafond, setPlafond] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);

  useEffect(() => {
    notificationsApi
      .orgSettings()
      .then((v) => {
        setVue(v);
        setPlafond(String(v.whatsappDailyCap));
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Réglages illisibles.')));
  }, []);
  useEffect(() => {
    if (!organizationId) return;
    api
      .listMembers(organizationId)
      .then((r) => setRoles(r.roleOptions))
      .catch(() => setRoles([]));
  }, [organizationId]);

  async function enregistrer(next: NotificationOrgSettingsView): Promise<void> {
    setVue(next);
    setErreur(null);
    setEnregistre(false);
    try {
      const v = await notificationsApi.putOrgSettings({
        expectedRevision: next.revision,
        projectLeadMode: next.projectLeadMode,
        memberMode: next.memberMode,
        byRole: next.byRole as Record<string, NotificationMode>,
        mandatory: next.mandatory,
        whatsappDailyCap: next.whatsappDailyCap,
      });
      setVue(v);
      setPlafond(String(v.whatsappDailyCap));
      setEnregistre(true);
    } catch (err) {
      setErreur(messageWork(err, 'Réglage non enregistré.'));
    }
  }

  if (vue === null)
    return erreur ? (
      <Alert tone="danger">
        <p>{erreur}</p>
      </Alert>
    ) : (
      <Skeleton className="h-48 w-full" />
    );
  if (!vue.canManage) return null;

  const basculerObligation = (kind: MandatoryNotification['kind'], channel: NotificationChannel) =>
    void enregistrer({
      ...vue,
      mandatory: aObligation(vue.mandatory, kind, channel)
        ? vue.mandatory.filter((m) => !(m.kind === kind && m.channel === channel))
        : [...vue.mandatory, { kind, channel }],
    });

  return (
    <div className="flex flex-col gap-4">
      <Carte
        titre="Modes par défaut de l’organisation"
        description="S’appliquent à chacun tant qu’il n’a pas choisi son propre mode."
      >
        <FormGrid>
          <Field
            id={`${id}-chef`}
            label="Chef de projet et adjoint"
            hint="Pour les événements des projets qu’ils dirigent."
          >
            <Select<NotificationMode>
              value={vue.projectLeadMode}
              onChange={(m) => void enregistrer({ ...vue, projectLeadMode: m })}
              options={OPTIONS_MODES}
            />
          </Field>
          <Field id={`${id}-membre`} label="Autres membres">
            <Select<NotificationMode>
              value={vue.memberMode}
              onChange={(m) => void enregistrer({ ...vue, memberMode: m })}
              options={OPTIONS_MODES}
            />
          </Field>
        </FormGrid>
        {roles.length > 0 ? (
          <details className="rounded-[var(--radius-md)] border border-[var(--border)]">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              Par rôle d’organisation (facultatif)
            </summary>
            <FormGrid className="p-3">
              {roles.map((r) => (
                <Field key={r.value} id={`${id}-role-${r.value}`} label={r.label} size="sm">
                  <Select<string>
                    value={vue.byRole[r.value] ?? ''}
                    onChange={(m) => {
                      const byRole = { ...vue.byRole };
                      if (m === '') delete byRole[r.value];
                      else byRole[r.value] = m as NotificationMode;
                      void enregistrer({ ...vue, byRole });
                    }}
                    options={[{ value: '', label: 'Comme les autres membres' }, ...OPTIONS_MODES]}
                  />
                </Field>
              ))}
            </FormGrid>
          </details>
        ) : null}
      </Carte>

      <Carte
        titre="Notifications obligatoires"
        description="Personne ne peut les couper sur le canal coché (ex. « une validation vous attend » dans la cloche)."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() =>
              void enregistrer({
                ...vue,
                mandatory: [
                  ...vue.mandatory,
                  ...DEFAULT_MANDATORY_NOTIFICATIONS.filter(
                    (m) => !aObligation(vue.mandatory, m.kind, m.channel),
                  ),
                ],
              })
            }
          >
            Rendre les validations obligatoires dans la cloche
          </Button>
          <Button
            size="sm"
            disabled={vue.mandatory.length === 0}
            onClick={() => void enregistrer({ ...vue, mandatory: [] })}
          >
            Tout retirer
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {groupesCatalogue().map((g) => (
            <details
              key={g.module}
              className="rounded-[var(--radius-md)] border border-[var(--border)]"
            >
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                {g.label}{' '}
                <span className="text-xs font-normal text-[var(--foreground-muted)]">
                  (
                  {
                    g.familles
                      .flatMap((f) => f.specs)
                      .filter((s) => vue.mandatory.some((m) => m.kind === s.kind)).length
                  }{' '}
                  obligatoire(s))
                </span>
              </summary>
              <ul className="flex flex-col divide-y divide-[var(--border)] border-t border-[var(--border)] px-3">
                {g.familles
                  .flatMap((f) => f.specs)
                  .map((s) => (
                    <li
                      key={s.kind}
                      className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-sm">{s.label}</span>
                      <span className="flex flex-wrap gap-3">
                        {CANAUX.filter((c) => s.channels.includes(c)).map((c) => (
                          <Checkbox
                            key={c}
                            id={`${id}-${s.kind}-${c}`}
                            checked={aObligation(vue.mandatory, s.kind, c)}
                            onChange={() => basculerObligation(s.kind, c)}
                            label={LIBELLES_CANAUX[c]}
                          />
                        ))}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          ))}
        </div>
      </Carte>

      <Carte
        titre="WhatsApp"
        description="Chaque message WhatsApp est payant : un plafond par personne et par jour (heure de Kinshasa) s’ajoute au plafond mensuel de la plateforme."
      >
        <FormGrid>
          <Field
            id={`${id}-plafond`}
            label="Messages par personne et par jour"
            size="sm"
            hint={`De ${NOTIFICATION_SETTINGS_LIMITS.whatsappDailyCapMin} à ${NOTIFICATION_SETTINGS_LIMITS.whatsappDailyCapMax}.`}
          >
            <TextInput
              inputMode="numeric"
              value={plafond}
              onChange={(e) => setPlafond(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => {
                const n = Number(plafond);
                if (
                  Number.isInteger(n) &&
                  n >= NOTIFICATION_SETTINGS_LIMITS.whatsappDailyCapMin &&
                  n <= NOTIFICATION_SETTINGS_LIMITS.whatsappDailyCapMax &&
                  n !== vue.whatsappDailyCap
                ) {
                  void enregistrer({ ...vue, whatsappDailyCap: n });
                } else setPlafond(String(vue.whatsappDailyCap));
              }}
            />
          </Field>
        </FormGrid>
      </Carte>

      <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {enregistre ? 'Enregistré.' : ' '}
      </p>
      {erreur ? (
        <Alert tone="danger">
          <p>{erreur}</p>
        </Alert>
      ) : null}

      <Carte
        titre="Journal d’envoi de l’organisation"
        description="Qui a reçu quoi, sur quel canal, ou pourquoi rien n’est parti. Ni titre ni contenu."
      >
        <JournalEnvois organisation />
      </Carte>
    </div>
  );
}
