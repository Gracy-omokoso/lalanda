'use client';

// Paramètres de la rubrique Projets — ADR-0061 (inspiré d'Asana, monday, ClickUp).
//
// « Mes notifications » : depuis ADR-0079, l'écran UNIQUE de tout Lalanda (mode
// Perroquet / Atténué / Essentiel, canaux, tests, journal), partagé avec le compte. « Comportement des projets » (`work.manage`) : qui crée,
// visibilité et vue par défaut, jours ouvrés, « échéance proche », archivage
// automatique, modération des commentaires, numéros de tâche. Les colonnes de départ
// et les étiquettes restent dans « Réglages » d'un projet (même document serveur).
// « Slack » (`organization.manage`, ADR-0064) : connecter l'espace Slack de
// l'organisation ; la colonne Slack de « Mes notifications » n'apparaît qu'une fois
// l'organisation connectée.

import {
  WORK_NOTIFICATION_EVENTS,
  WORK_NOTIFICATION_EVENT_LABELS,
  type SlackConnectionView,
  type WhatsAppView,
  type WorkDefaultView,
  type WorkNotificationPreferencesView,
  type WorkProjectVisibility,
  type WorkSettingsView,
  type WorkWeekday,
} from '@lalanda/shared/work';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  FormGrid,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StatusPill,
  Switch,
  TabsNav,
  TextInput,
} from '@lalanda/ui';
import { Bell, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import { renderNextLink } from '@/components/next-link';
import { workApi } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { MesNotifications } from '../../notifications/_components/mes-notifications';
import {
  HEURES_RESUME,
  JOURS,
  ROLES_CREATEURS,
  basculerCanal,
  basculerJour,
  corpsComportement,
  colonneWhatsApp,
  corpsPreferences,
  createurs,
  libelleEtatSlack,
  libelleHeure,
  ongletParametres,
  ongletsVisibles,
  retourSlack,
  toutLeCanal,
} from './parametres-model';
import { messageWork } from './projets-model';

/** Interrupteur d'une cellule de tableau : libellé lu seulement (la colonne le dit). */
function Interrupteur({
  id,
  coche,
  libelle,
  disabled,
  onChange,
}: {
  id: string;
  coche: boolean;
  libelle: string;
  disabled?: boolean;
  onChange: () => void;
}): React.ReactElement {
  return (
    <Switch
      id={id}
      checked={coche}
      aria-label={libelle}
      {...(disabled === undefined ? {} : { disabled })}
      onChange={() => onChange()}
    />
  );
}

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

function Comportement(): React.ReactElement {
  const id = useId();
  const [s, setS] = useState<WorkSettingsView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);
  const [jours, setJours] = useState('');

  useEffect(() => {
    workApi
      .getSettings()
      .then((v) => {
        setS(v);
        setJours(v.autoArchiveCompletedDays === null ? '' : String(v.autoArchiveCompletedDays));
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Les réglages sont illisibles.')));
  }, []);

  async function enregistrer(patch: Parameters<typeof corpsComportement>[1]): Promise<void> {
    if (!s) return;
    setErreur(null);
    setEnregistre(false);
    try {
      setS(await workApi.putSettings(corpsComportement(s, patch)));
      setEnregistre(true);
    } catch (err) {
      setErreur(messageWork(err, 'Réglage non enregistré.'));
    }
  }

  if (s === null)
    return erreur ? (
      <Alert tone="danger">
        <p>{erreur}</p>
      </Alert>
    ) : (
      <Skeleton className="h-64 w-full" />
    );

  return (
    <div className="flex flex-col gap-4">
      <Carte
        titre="Création des projets"
        description="Parmi les gestionnaires des projets, qui peut en créer. La direction (Propriétaire, Administrateur) le peut toujours."
      >
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {ROLES_CREATEURS.map((r, i) => (
            <Checkbox
              key={r.role}
              id={`${id}-createur-${i}`}
              disabled={r.direction}
              checked={
                r.direction ||
                s.projectCreatorRoles === null ||
                s.projectCreatorRoles.includes(r.role)
              }
              onChange={(c) =>
                void enregistrer({
                  projectCreatorRoles: createurs(s.projectCreatorRoles, r.role, c),
                })
              }
              label={r.label}
            />
          ))}
        </div>
      </Carte>

      <Carte
        titre="Nouveaux projets"
        description="Valeurs proposées à la création ; chaque projet reste modifiable ensuite."
      >
        <FormGrid>
          <Field id={`${id}-vis`} label="Visibilité par défaut" group size="lg">
            <SegmentedControl<WorkProjectVisibility>
              value={s.defaultVisibility}
              onChange={(v) => void enregistrer({ defaultVisibility: v })}
              options={[
                { value: 'organization', label: 'Toute l’organisation' },
                { value: 'private', label: 'Membres seulement (privé)' },
              ]}
            />
          </Field>
          <Field id={`${id}-vue`} label="Vue à l’ouverture d’un projet" group size="md" newRow>
            <SegmentedControl<WorkDefaultView>
              value={s.defaultView}
              onChange={(v) => void enregistrer({ defaultView: v })}
              options={[
                { value: 'overview', label: 'Aperçu' },
                { value: 'list', label: 'Liste' },
                { value: 'board', label: 'Tableau' },
              ]}
            />
          </Field>
        </FormGrid>
        <p className="text-xs text-[var(--foreground-muted)]">
          Colonnes de départ : {s.defaultColumns.map((c) => c.label).join(' → ')}. Elles se règlent
          dans « Réglages » d’un projet (gestionnaires).
        </p>
      </Carte>

      <Carte
        titre="Calendrier et échéances"
        description="Les jours ouvrés comptent pour « échéance proche » et pour le résumé quotidien."
      >
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-sm">Jours ouvrés</legend>
          {JOURS.map((j) => {
            const actif = s.workingDays.includes(j.iso);
            return (
              <button
                key={j.iso}
                type="button"
                aria-pressed={actif}
                title={j.long}
                onClick={() =>
                  void enregistrer({
                    workingDays: basculerJour(s.workingDays, j.iso) as WorkWeekday[],
                  })
                }
                className={`h-9 min-w-12 rounded-[var(--radius-md)] border px-2 text-sm ${actif ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}
              >
                {j.court}
              </button>
            );
          })}
        </fieldset>
        <FormGrid>
          <Field id={`${id}-proche`} label="« Échéance proche »" size="md">
            <Select<string>
              value={String(s.dueSoonDays)}
              onChange={(v) => void enregistrer({ dueSoonDays: Number(v) })}
              options={Array.from({ length: 15 }, (_, n) => ({
                value: String(n),
                label:
                  n === 0
                    ? 'le jour même'
                    : `${n} jour${n > 1 ? 's' : ''} ouvré${n > 1 ? 's' : ''} avant`,
              }))}
            />
          </Field>
        </FormGrid>
      </Carte>

      <Carte titre="Archivage et travail en commun">
        <form
          className="flex flex-wrap items-end gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const n = jours.trim() === '' ? null : Number(jours);
            if (n !== null && (!Number.isInteger(n) || n < 1 || n > 365)) {
              setErreur(
                'Archivage automatique : un nombre de jours entre 1 et 365, ou vide pour jamais.',
              );
              return;
            }
            void enregistrer({ autoArchiveCompletedDays: n });
          }}
        >
          <Field
            id={`${id}-arch`}
            label="Archiver automatiquement les projets terminés après"
            className="w-full sm:w-auto"
            hint="Nombre de jours, de 1 à 365 ; vide : jamais."
          >
            <TextInput
              inputMode="numeric"
              className="w-40"
              placeholder="Jamais"
              value={jours}
              onChange={(e) => setJours(e.target.value)}
            />
          </Field>
          <Button type="submit" size="sm" className="max-sm:h-11">
            Appliquer
          </Button>
        </form>
        <Switch
          id={`${id}-mod`}
          checked={s.managersModerateComments}
          label="Les gestionnaires peuvent modifier et supprimer les commentaires des autres"
          onChange={() =>
            void enregistrer({ managersModerateComments: !s.managersModerateComments })
          }
        />
        <Switch
          id={`${id}-num`}
          checked={s.showTaskNumbers}
          label="Afficher les numéros de tâche (#12)"
          onChange={() => void enregistrer({ showTaskNumbers: !s.showTaskNumbers })}
        />
      </Carte>
      <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {enregistre ? 'Enregistré.' : ' '}
      </p>
      {erreur ? (
        <Alert tone="danger">
          <p>{erreur}</p>
        </Alert>
      ) : null}
    </div>
  );
}

/** ADR-0064 : connexion de l'espace Slack de l'organisation (`organization.manage`). */
function OngletSlack({ retour }: { retour: string | null }): React.ReactElement {
  const [vue, setVue] = useState<SlackConnectionView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const message = retourSlack(retour);

  useEffect(() => {
    workApi
      .getSlack()
      .then(setVue)
      .catch((err: unknown) => setErreur(messageWork(err, 'L’état de Slack est illisible.')));
  }, []);

  async function connecter(): Promise<void> {
    setErreur(null);
    setOccupe(true);
    try {
      const { authorizeUrl } = await workApi.connectSlack();
      window.location.assign(authorizeUrl);
    } catch (err) {
      setErreur(messageWork(err, 'Connexion à Slack impossible pour le moment.'));
      setOccupe(false);
    }
  }

  async function deconnecter(): Promise<void> {
    if (
      !window.confirm(
        'Déconnecter Slack ? Plus aucune notification ne partira vers Slack, et l’accès de l’application sera révoqué.',
      )
    ) {
      return;
    }
    setErreur(null);
    setOccupe(true);
    try {
      setVue(await workApi.disconnectSlack());
    } catch (err) {
      setErreur(messageWork(err, 'Déconnexion impossible.'));
    } finally {
      setOccupe(false);
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

  const aReconnecter = vue.status === 'reconnect_required' || vue.status === 'uninstalled';

  return (
    <div className="flex flex-col gap-4">
      {message ? (
        message.ton === 'erreur' ? (
          <Alert tone="danger">
            <p>{message.message}</p>
          </Alert>
        ) : (
          <p
            role="status"
            className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent-soft)] p-3 text-sm"
          >
            {message.message}
          </p>
        )
      ) : null}
      <Carte
        titre="Espace Slack de l’organisation"
        description="Chaque membre reçoit ses notifications des Projets en message privé du bot « Lalanda », selon ses préférences. Un projet peut aussi publier dans un canal. Seule votre organisation utilise cette connexion."
      >
        {!vue.connected ? (
          <div className="flex flex-col items-start gap-3 text-sm">
            <StatusPill tone="draft">Non connecté</StatusPill>
            {vue.available ? (
              <p className="text-[var(--foreground-muted)]">
                Vous serez redirigé vers Slack pour choisir l’espace et autoriser l’application
                Lalanda, puis ramené ici.
              </p>
            ) : (
              <p className="text-[var(--foreground-muted)]">
                Slack n’est pas encore disponible sur Lalanda : l’application Slack de la plateforme
                n’est pas configurée. Rien ne change pour vos notifications (cloche et e-mail).
              </p>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={!vue.available || occupe}
              onClick={() => void connecter()}
            >
              Connecter Slack
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={aReconnecter ? 'late' : 'ok'}>
                {libelleEtatSlack(vue.status)}
              </StatusPill>
              <span className="font-medium">{vue.teamName}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-[var(--foreground-muted)]">Connecté par</dt>
              <dd>{vue.connectedBy?.name ?? '—'}</dd>
              <dt className="text-[var(--foreground-muted)]">Le</dt>
              <dd>
                {vue.connectedAt
                  ? new Date(vue.connectedAt).toLocaleString('fr-FR', {
                      dateStyle: 'long',
                      timeStyle: 'short',
                    })
                  : '—'}
              </dd>
              {vue.stats ? (
                <>
                  <dt className="text-[var(--foreground-muted)]">Envois</dt>
                  <dd>
                    {vue.stats.sent} remis · {vue.stats.unmatched} introuvable
                    {vue.stats.unmatched > 1 ? 's' : ''} dans Slack · {vue.stats.failed} échec
                    {vue.stats.failed > 1 ? 's' : ''}
                  </dd>
                </>
              ) : null}
            </dl>
            {aReconnecter ? (
              <p className="text-[var(--foreground-muted)]">
                Slack a retiré l’accès de l’application : plus aucun message ne part. Reconnectez
                l’espace pour reprendre les envois.
              </p>
            ) : (
              <p className="text-xs text-[var(--foreground-muted)]">
                Un membre est retrouvé dans Slack par son adresse e-mail Lalanda ; s’il n’y figure
                pas, rien ne lui est envoyé.
              </p>
            )}
            {vue.canManage ? (
              <div className="flex flex-wrap gap-2">
                {aReconnecter ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!vue.available || occupe}
                    onClick={() => void connecter()}
                  >
                    Reconnecter Slack
                  </Button>
                ) : null}
                <Button size="sm" disabled={occupe} onClick={() => void deconnecter()}>
                  Déconnecter
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Carte>
      {erreur ? (
        <Alert tone="danger">
          <p>{erreur}</p>
        </Alert>
      ) : null}
    </div>
  );
}

export function ParametresProjets(): React.ReactElement {
  const { actions } = useShell();
  const pathname = usePathname();
  const params = useSearchParams();
  const gerer = actions !== null && actions.includes('work.manage');
  const diriger = actions !== null && actions.includes('organization.manage');
  const onglet = ongletParametres(params.get('onglet'), gerer, diriger);
  const onglets = ongletsVisibles(gerer, diriger);

  return (
    <section className="flex flex-col gap-5">
      <PageHeader
        module="run"
        moduleLabel="Projets"
        title="Paramètres"
        description="Vos notifications, le comportement des projets et la connexion Slack de l’organisation."
      />
      <TabsNav
        label="Paramètres des Projets"
        items={onglets.map((o) => ({
          label: o.label,
          href: `${pathname}?onglet=${o.id}`,
          current: o.id === onglet,
        }))}
        renderLink={renderNextLink}
      />
      {onglet === 'comportement' ? (
        <Comportement />
      ) : onglet === 'slack' ? (
        <OngletSlack retour={params.get('slack')} />
      ) : (
        <MesNotifications />
      )}
    </section>
  );
}
