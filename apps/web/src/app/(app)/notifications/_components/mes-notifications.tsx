'use client';

// « Mes notifications » — écran UNIQUE de tout Lalanda (ADR-0079 § 8), servi depuis le
// compte (`/compte/notifications`) et depuis les Projets (Paramètres › Mes notifications).
//
// 1. Mode : cartes Perroquet / Atténué / Essentiel (explication courte), « (personnalisé) »,
//    « Revenir au mode d'origine », « Suivre le défaut de l'organisation ».
// 2. État des canaux (cloche, e-mail, Slack, WhatsApp) et « M'envoyer un test ».
// 3. Options : « Me notifier aussi de mes propres actions », heures calmes (Kinshasa).
// 4. Tableau événement × canal groupé par module et famille ; verrou des obligations ;
//    « — » quand un canal n'est pas permis ; WhatsApp « modèle en attente ».
// 5. Résumé quotidien des Projets (si la personne y a accès) et numéro WhatsApp.
// 6. Journal d'envoi.
//
// Chaque geste enregistre aussitôt (révision attendue) ; l'aperçu utilise la même règle
// que le serveur (`effectiveChannels`). Kit de formulaires ADR-0074.

import {
  NOTIFICATION_MODES,
  NOTIFICATION_MODE_DESCRIPTIONS,
  NOTIFICATION_MODE_LABELS,
  modeDisplayLabel,
  type NotificationChannel,
  type NotificationChannelsView,
  type NotificationDeliveryView,
  type NotificationMode,
  type NotificationSettingsView,
} from '@lalanda/shared/notifications';
import type { WhatsAppView, WorkNotificationPreferencesView } from '@lalanda/shared/work';
import {
  Alert,
  Button,
  ChoiceCards,
  Field,
  FormGrid,
  Select,
  Skeleton,
  StatusPill,
  Switch,
} from '@lalanda/ui';
import { Bell, Lock, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { notificationsApi } from '@/lib/notifications-api';
import { workApi } from '@/lib/work-api';

import { BlocWhatsApp } from '../../projets/_components/bloc-whatsapp';
import { messageWork } from '../../projets/_components/projets-model';
import { HEURES_RESUME, libelleHeure } from '../../projets/_components/parametres-model';
import {
  CANAUX,
  HEURES,
  LIBELLES_CANAUX,
  basculer,
  choisirMode,
  corpsReglages,
  etatCellule,
  groupesCatalogue,
  libelleEtatCanal,
  libelleHeureCalme,
  libelleSort,
  libelleType,
  modeAffiche,
  resumeModule,
  revenirOrigine,
} from '../reglages-model';

const ICONES: Record<NotificationChannel, React.ReactElement> = {
  bell: <Bell aria-hidden="true" className="h-3.5 w-3.5" />,
  email: <Mail aria-hidden="true" className="h-3.5 w-3.5" />,
  slack: <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />,
  whatsapp: <Smartphone aria-hidden="true" className="h-3.5 w-3.5" />,
};

function Carte({
  titre,
  description,
  children,
}: {
  titre: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <header className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold">{titre}</h3>
        {description ? (
          <p className="text-sm text-[var(--foreground-muted)]">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function EtatDesCanaux({
  canaux,
}: {
  canaux: NotificationChannelsView | null;
}): React.ReactElement {
  const [resultats, setResultats] = useState<Partial<Record<NotificationChannel, string>>>({});
  const [occupe, setOccupe] = useState<NotificationChannel | null>(null);

  async function tester(c: NotificationChannel): Promise<void> {
    setOccupe(c);
    try {
      const r = await notificationsApi.test(c);
      setResultats((x) => ({ ...x, [c]: libelleSort(r.outcome.status, r.outcome.reason) }));
      if (c === 'bell') window.dispatchEvent(new CustomEvent('lalanda:notifications-changees'));
    } catch (err) {
      setResultats((x) => ({ ...x, [c]: messageWork(err, 'Test impossible pour le moment.') }));
    } finally {
      setOccupe(null);
    }
  }

  if (!canaux) return <Skeleton className="h-24 w-full" />;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {canaux.channels.map((c) => (
        <li
          key={c.channel}
          className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
              {ICONES[c.channel]}
              {LIBELLES_CANAUX[c.channel]}
            </span>
            <StatusPill tone={c.ready ? 'ok' : 'draft'}>
              {c.ready ? 'Prêt' : 'Indisponible'}
            </StatusPill>
          </div>
          <p className="text-xs text-[var(--foreground-muted)]">{libelleEtatCanal(c)}</p>
          {c.channel === 'whatsapp' ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Aujourd’hui : {canaux.whatsappSentToday} message
              {canaux.whatsappSentToday > 1 ? 's' : ''} sur {canaux.whatsappDailyCap} au plus.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={occupe !== null}
              onClick={() => void tester(c.channel)}
              aria-busy={occupe === c.channel}
            >
              {occupe === c.channel ? 'Envoi…' : 'M’envoyer un test'}
            </Button>
            <span role="status" className="text-xs text-[var(--foreground-muted)]">
              {resultats[c.channel] ?? ''}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Journal({ organisation = false }: { organisation?: boolean }): React.ReactElement {
  const [items, setItems] = useState<NotificationDeliveryView[] | null>(null);
  const [suite, setSuite] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(
    async (cursor: string | null) => {
      try {
        const page = await notificationsApi.deliveries({ cursor, organization: organisation });
        setItems((x) => (cursor && x ? [...x, ...page.items] : page.items));
        setSuite(page.nextCursor);
      } catch (err) {
        setErreur(messageWork(err, 'Journal illisible pour le moment.'));
      }
    },
    [organisation],
  );
  useEffect(() => {
    void charger(null);
  }, [charger]);

  if (erreur)
    return (
      <Alert tone="danger">
        <p>{erreur}</p>
      </Alert>
    );
  if (!items) return <Skeleton className="h-32 w-full" />;
  if (items.length === 0)
    return <p className="text-sm text-[var(--foreground-muted)]">Aucun envoi pour l’instant.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
        {items.map((d) => (
          <li key={d.id} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {libelleType(d.kind)}
                {d.userName ? (
                  <span className="font-normal text-[var(--foreground-muted)]">
                    {' '}
                    — {d.userName}
                  </span>
                ) : null}
              </span>
              <time className="text-xs text-[var(--foreground-muted)]" dateTime={d.createdAt}>
                {new Date(d.createdAt).toLocaleString('fr-FR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'Africa/Kinshasa',
                })}
              </time>
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--foreground-muted)]">
              {CANAUX.filter((c) => d.channels[c]).map((c) => (
                <li key={c} className="inline-flex items-center gap-1">
                  {ICONES[c]}
                  <span>
                    {LIBELLES_CANAUX[c]} :{' '}
                    {libelleSort(d.channels[c]!.status, d.channels[c]!.reason)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {suite ? (
        <Button size="sm" onClick={() => void charger(suite)}>
          Voir les envois précédents
        </Button>
      ) : null}
    </div>
  );
}

function ResumeQuotidien(): React.ReactElement | null {
  const id = useId();
  const [vue, setVue] = useState<WorkNotificationPreferencesView | null>(null);
  const [absent, setAbsent] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    workApi
      .getNotificationPreferences()
      .then(setVue)
      .catch(() => setAbsent(true));
  }, []);

  async function enregistrer(digest: WorkNotificationPreferencesView['digest']): Promise<void> {
    if (!vue) return;
    setErreur(null);
    setVue({ ...vue, digest });
    try {
      setVue(await workApi.putDigest({ expectedRevision: vue.revision, digest }));
    } catch (err) {
      setErreur(messageWork(err, 'Résumé non enregistré.'));
    }
  }

  if (absent) return null;
  if (!vue) return <Skeleton className="h-24 w-full" />;
  return (
    <Carte
      titre="Résumé quotidien des Projets par e-mail"
      description="Vos tâches en retard, du jour et à échéance proche, et vos notifications non lues — une fois par jour au plus."
    >
      <div className="flex flex-col gap-4 text-sm">
        <Switch
          id={`${id}-digest`}
          checked={vue.digest.enabled}
          label="Recevoir le résumé quotidien"
          onChange={() => void enregistrer({ ...vue.digest, enabled: !vue.digest.enabled })}
        />
        <FormGrid>
          <Field
            id={`${id}-heure`}
            label="À partir de"
            size="sm"
            hint="Heure de Kinshasa."
            disabled={!vue.digest.enabled}
          >
            <Select<string>
              value={String(vue.digest.hour)}
              onChange={(v) => void enregistrer({ ...vue.digest, hour: Number(v) })}
              options={HEURES_RESUME.map((h) => ({ value: String(h), label: libelleHeure(h) }))}
            />
          </Field>
        </FormGrid>
        <Switch
          id={`${id}-ouvres`}
          checked={vue.digest.workingDaysOnly}
          disabled={!vue.digest.enabled}
          label="Jours ouvrés seulement"
          onChange={() =>
            void enregistrer({ ...vue.digest, workingDaysOnly: !vue.digest.workingDaysOnly })
          }
        />
        {erreur ? (
          <Alert tone="danger">
            <p>{erreur}</p>
          </Alert>
        ) : null}
      </div>
    </Carte>
  );
}

/** Écran « Mes notifications » (compte et Projets). */
export function MesNotifications(): React.ReactElement {
  const id = useId();
  const [vue, setVue] = useState<NotificationSettingsView | null>(null);
  const [canaux, setCanaux] = useState<NotificationChannelsView | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);

  useEffect(() => {
    notificationsApi
      .settings()
      .then(setVue)
      .catch((err: unknown) => setErreur(messageWork(err, 'Vos réglages sont illisibles.')));
    notificationsApi
      .channels()
      .then(setCanaux)
      .catch(() => setCanaux(null));
    workApi
      .getWhatsApp()
      .then(setWhatsapp)
      .catch(() => setWhatsapp(null));
  }, []);

  async function enregistrer(next: NotificationSettingsView): Promise<void> {
    setVue(next);
    setErreur(null);
    setEnregistre(false);
    try {
      setVue(await notificationsApi.putSettings(corpsReglages(next)));
      setEnregistre(true);
    } catch (err) {
      setErreur(messageWork(err, 'Réglage non enregistré.'));
      notificationsApi
        .settings()
        .then(setVue)
        .catch(() => undefined);
    }
  }

  /** Un type coupé depuis l'ancienne page : rallumer la cloche le décoche aussi là-bas. */
  async function rallumerTypeCoupe(kind: string): Promise<void> {
    if (!vue) return;
    const reste = vue.mutedKinds.filter((k) => k !== kind);
    try {
      await notificationsApi.setPreferences(reste);
      setVue({ ...vue, mutedKinds: reste });
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
      <Skeleton className="h-64 w-full" />
    );

  const mode = modeAffiche(vue);
  const groupes = groupesCatalogue();

  return (
    <div className="flex flex-col gap-4">
      <Carte
        titre="Mode"
        description="Choisissez un mode, puis personnalisez-le si besoin : vos réglages sont gardés pour chaque mode, passer de l’un à l’autre ne perd rien."
      >
        <Field id={`${id}-mode`} label="Mode de notification" group>
          <ChoiceCards<NotificationMode>
            columns={3}
            value={mode}
            onChange={(m) => void enregistrer(choisirMode(vue, m))}
            options={NOTIFICATION_MODES.map((m) => ({
              value: m,
              label: modeDisplayLabel(m, vue.customized[m]),
              description: NOTIFICATION_MODE_DESCRIPTIONS[m],
            }))}
          />
        </Field>
        <p className="text-sm">
          Mode appliqué : <strong>{modeDisplayLabel(mode, vue.customized[mode])}</strong>
          {vue.mode === null ? (
            <span className="text-[var(--foreground-muted)]">
              {' '}
              — défaut de l’organisation pour votre rôle ; pour les projets que vous dirigez (chef
              ou adjoint) : {NOTIFICATION_MODE_LABELS[vue.projectLeadMode]}.
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!vue.customized[mode]}
            onClick={() => void enregistrer(revenirOrigine(vue))}
          >
            Revenir au mode d’origine
          </Button>
          {vue.mode !== null ? (
            <Button size="sm" onClick={() => void enregistrer(choisirMode(vue, null))}>
              Suivre le défaut de l’organisation
            </Button>
          ) : null}
        </div>
        {vue.migratedFrom === 'adr-0061' ? (
          <p className="text-xs text-[var(--foreground-muted)]">
            Vos anciens réglages des Projets ont été repris tels quels (mode personnalisé).
          </p>
        ) : null}
      </Carte>

      <Carte
        titre="Vos canaux"
        description="Où vos notifications peuvent partir. Un test envoie un vrai message sur le canal choisi (cinq par heure au plus)."
      >
        <EtatDesCanaux canaux={canaux} />
        {whatsapp ? <BlocWhatsApp vue={whatsapp} onChange={setWhatsapp} /> : null}
      </Carte>

      <Carte titre="Options">
        <div className="flex flex-col gap-4 text-sm">
          <Switch
            id={`${id}-moi`}
            checked={vue.notifyOwnActions}
            label="Me notifier aussi de mes propres actions"
            description="Utile pour vérifier vos notifications quand vous travaillez seul. Désactivé par défaut."
            onChange={() => void enregistrer({ ...vue, notifyOwnActions: !vue.notifyOwnActions })}
          />
          <Switch
            id={`${id}-calme`}
            checked={vue.quietHours.enabled}
            label="Heures calmes pour WhatsApp et Slack"
            description="Rien ne part sur WhatsApp ni Slack pendant ces heures (heure de Kinshasa) ; la cloche et l’e-mail continuent."
            onChange={() =>
              void enregistrer({
                ...vue,
                quietHours: { ...vue.quietHours, enabled: !vue.quietHours.enabled },
              })
            }
          />
          <FormGrid>
            <Field id={`${id}-debut`} label="De" size="sm" disabled={!vue.quietHours.enabled}>
              <Select<string>
                value={String(vue.quietHours.start)}
                onChange={(v) =>
                  void enregistrer({ ...vue, quietHours: { ...vue.quietHours, start: Number(v) } })
                }
                options={HEURES.map((h) => ({ value: String(h), label: libelleHeureCalme(h) }))}
              />
            </Field>
            <Field id={`${id}-fin`} label="À" size="sm" disabled={!vue.quietHours.enabled}>
              <Select<string>
                value={String(vue.quietHours.end)}
                onChange={(v) =>
                  void enregistrer({ ...vue, quietHours: { ...vue.quietHours, end: Number(v) } })
                }
                options={HEURES.map((h) => ({ value: String(h), label: libelleHeureCalme(h) }))}
              />
            </Field>
          </FormGrid>
        </div>
      </Carte>

      <Carte
        titre={`Événements — ${modeDisplayLabel(mode, vue.customized[mode])}`}
        description="Activez ou coupez chaque notification sur chaque canal du mode affiché. « — » : canal non prévu pour cet événement ; cadenas : rendu obligatoire par votre organisation."
      >
        <div className="flex flex-col gap-2">
          {groupes.map((g, i) => (
            <details
              key={g.module}
              open={i === 0}
              className="rounded-[var(--radius-md)] border border-[var(--border)]"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium">
                <span>{g.label}</span>
                <span className="text-xs font-normal text-[var(--foreground-muted)]">
                  {resumeModule(vue, g)}
                </span>
              </summary>
              <div className="flex flex-col gap-3 border-t border-[var(--border)] px-3 py-3">
                {g.familles.map((f) => (
                  <div key={f.famille} className="flex flex-col gap-1">
                    <h4 className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
                      {f.label}
                    </h4>
                    <ul className="flex flex-col divide-y divide-[var(--border)]">
                      {f.specs.map((s) => (
                        <li
                          key={s.kind}
                          className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="text-sm">{s.label}</span>
                            <span className="text-xs text-[var(--foreground-muted)]">
                              {s.recipients}
                            </span>
                          </div>
                          <div className="grid shrink-0 grid-cols-4 gap-2">
                            {CANAUX.map((c) => {
                              const e = etatCellule(vue, s, c, canaux);
                              const libelle = `${LIBELLES_CANAUX[c]} : ${s.label}`;
                              return (
                                <div
                                  key={c}
                                  className="flex min-w-[3.5rem] flex-col items-center gap-0.5"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="inline-flex items-center gap-0.5 text-[0.65rem] text-[var(--foreground-muted)]"
                                  >
                                    {ICONES[c]}
                                    {LIBELLES_CANAUX[c]}
                                  </span>
                                  {e.etat === 'non_permis' ? (
                                    <span
                                      className="text-sm text-[var(--foreground-muted)]"
                                      aria-label={`${libelle} — non prévu`}
                                    >
                                      —
                                    </span>
                                  ) : e.etat === 'obligatoire' ? (
                                    <span
                                      className="inline-flex items-center gap-1 text-xs"
                                      title="Rendu obligatoire par votre organisation"
                                    >
                                      <Lock aria-hidden="true" className="h-3.5 w-3.5" />
                                      <span className="sr-only">{libelle} — obligatoire</span>
                                    </span>
                                  ) : e.etat === 'indisponible' ? (
                                    <span
                                      className="text-[0.65rem] text-[var(--foreground-muted)]"
                                      title={e.raison}
                                    >
                                      En attente
                                      <span className="sr-only"> — {e.raison}</span>
                                    </span>
                                  ) : (
                                    <Switch
                                      id={`${id}-${s.kind}-${c}`}
                                      checked={e.coche}
                                      aria-label={libelle}
                                      onChange={() =>
                                        void (c === 'bell' &&
                                        !e.coche &&
                                        vue.mutedKinds.includes(s.kind)
                                          ? rallumerTypeCoupe(s.kind)
                                          : enregistrer(basculer(vue, s, c)))
                                      }
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
        <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
          {enregistre ? 'Enregistré.' : ' '}
        </p>
        {erreur ? (
          <Alert tone="danger">
            <p>{erreur}</p>
          </Alert>
        ) : null}
      </Carte>

      <ResumeQuotidien />

      <Carte
        titre="Journal d’envoi"
        description="Vos dernières notifications, canal par canal : envoyée, ou ignorée et pourquoi. Conservé 90 jours."
      >
        <Journal />
      </Carte>
    </div>
  );
}

export { Journal as JournalEnvois, Carte as CarteNotifications };
