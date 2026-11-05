'use client';

// Paramètres de la rubrique Projets — ADR-0061 (inspiré d'Asana, monday, ClickUp).
//
// « Mes notifications » : pour chaque événement, cloche et e-mail, plus un résumé
// quotidien par e-mail. « Comportement des projets » (`work.manage`) : qui crée,
// visibilité et vue par défaut, jours ouvrés, « échéance proche », archivage
// automatique, modération des commentaires, numéros de tâche. Les colonnes de départ
// et les étiquettes restent dans « Réglages » d'un projet (même document serveur).

import {
  WORK_NOTIFICATION_EVENTS,
  WORK_NOTIFICATION_EVENT_LABELS,
  type WorkDefaultView,
  type WorkNotificationPreferencesView,
  type WorkProjectVisibility,
  type WorkSettingsView,
  type WorkWeekday,
} from '@lalanda/shared/work';
import { PageHeader, Skeleton, TabsNav, buttonClasses } from '@lalanda/ui';
import { Bell, Mail } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import { renderNextLink } from '@/components/next-link';
import { workApi } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';
import { CHAMP } from '../../ventes/_components/form-ui';

import { Alerte } from './elements';
import {
  HEURES_RESUME,
  JOURS,
  ONGLETS_PARAMETRES,
  ROLES_CREATEURS,
  basculerCanal,
  basculerJour,
  corpsComportement,
  corpsPreferences,
  createurs,
  libelleHeure,
  ongletParametres,
  toutLeCanal,
} from './parametres-model';
import { messageWork } from './projets-model';

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
    <label htmlFor={id} className="inline-flex cursor-pointer items-center">
      <input id={id} type="checkbox" className="peer sr-only" checked={coche} disabled={disabled} onChange={onChange} />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 rounded-full bg-[var(--border-strong)] transition-colors peer-checked:bg-[var(--accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-[var(--surface)] after:shadow after:transition-transform peer-checked:after:translate-x-4"
      />
      <span className="sr-only">{libelle}</span>
    </label>
  );
}

function Carte({ titre, description, children }: { titre: string; description?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <header className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold">{titre}</h3>
        {description ? <p className="text-sm text-[var(--foreground-muted)]">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

function MesNotifications(): React.ReactElement {
  const id = useId();
  const [vue, setVue] = useState<WorkNotificationPreferencesView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);

  useEffect(() => {
    workApi
      .getNotificationPreferences()
      .then(setVue)
      .catch((err: unknown) => setErreur(messageWork(err, 'Vos préférences sont illisibles.')));
  }, []);

  async function enregistrer(next: WorkNotificationPreferencesView): Promise<void> {
    setVue(next);
    setErreur(null);
    setEnregistre(false);
    try {
      setVue(await workApi.putNotificationPreferences(corpsPreferences(next, next.revision)));
      setEnregistre(true);
    } catch (err) {
      setErreur(messageWork(err, 'Préférences non enregistrées.'));
    }
  }

  if (vue === null) return erreur ? <Alerte><p>{erreur}</p></Alerte> : <Skeleton className="h-64 w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <Carte titre="Événements" description="Choisissez, pour chaque événement, la cloche de Lalanda et/ou un e-mail. Vous n’êtes jamais notifié de vos propres gestes.">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--foreground-muted)]">
              <th scope="col" className="py-2 font-medium">Événement</th>
              <th scope="col" className="w-20 py-2 text-center font-medium">
                <span className="inline-flex items-center gap-1"><Bell aria-hidden="true" className="h-3.5 w-3.5" />Cloche</span>
              </th>
              <th scope="col" className="w-20 py-2 text-center font-medium">
                <span className="inline-flex items-center gap-1"><Mail aria-hidden="true" className="h-3.5 w-3.5" />E-mail</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {WORK_NOTIFICATION_EVENTS.map((e) => (
              <tr key={e}>
                <th scope="row" className="py-2.5 pr-3 text-left font-normal">{WORK_NOTIFICATION_EVENT_LABELS[e]}</th>
                <td className="text-center">
                  <Interrupteur id={`${id}-${e}-b`} coche={vue.events[e].bell} libelle={`Cloche : ${WORK_NOTIFICATION_EVENT_LABELS[e]}`} onChange={() => void enregistrer({ ...vue, ...basculerCanal(vue, e, 'bell') })} />
                </td>
                <td className="text-center">
                  <Interrupteur id={`${id}-${e}-m`} coche={vue.events[e].email} libelle={`E-mail : ${WORK_NOTIFICATION_EVENT_LABELS[e]}`} onChange={() => void enregistrer({ ...vue, ...basculerCanal(vue, e, 'email') })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClasses('secondary', 'sm')} onClick={() => void enregistrer({ ...vue, ...toutLeCanal(vue, 'email', false) })}>
            Couper tous les e-mails
          </button>
          <button type="button" className={buttonClasses('secondary', 'sm')} onClick={() => void enregistrer({ ...vue, ...toutLeCanal(vue, 'bell', true) })}>
            Cloche partout
          </button>
        </div>
      </Carte>

      <Carte titre="Résumé quotidien par e-mail" description="Vos tâches en retard, du jour et à échéance proche, et vos notifications non lues — une fois par jour au plus.">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <span className="flex items-center gap-2">
            <Interrupteur id={`${id}-digest`} coche={vue.digest.enabled} libelle="Recevoir le résumé quotidien" onChange={() => void enregistrer({ ...vue, digest: { ...vue.digest, enabled: !vue.digest.enabled } })} />
            <span aria-hidden="true">Recevoir le résumé</span>
          </span>
          <label className="flex items-center gap-2" htmlFor={`${id}-heure`}>
            À partir de
            <select id={`${id}-heure`} className={`${CHAMP} w-auto`} value={vue.digest.hour} disabled={!vue.digest.enabled} onChange={(e) => void enregistrer({ ...vue, digest: { ...vue.digest, hour: Number(e.target.value) } })}>
              {HEURES_RESUME.map((h) => (
                <option key={h} value={h}>{libelleHeure(h)}</option>
              ))}
            </select>
            <span className="text-xs text-[var(--foreground-muted)]">(heure de Kinshasa)</span>
          </label>
          <label className="flex items-center gap-2" htmlFor={`${id}-ouvres`}>
            <input id={`${id}-ouvres`} type="checkbox" checked={vue.digest.workingDaysOnly} disabled={!vue.digest.enabled} onChange={() => void enregistrer({ ...vue, digest: { ...vue.digest, workingDaysOnly: !vue.digest.workingDaysOnly } })} />
            Jours ouvrés seulement
          </label>
        </div>
      </Carte>
      <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">{enregistre ? 'Enregistré.' : ' '}</p>
      {erreur ? <Alerte><p>{erreur}</p></Alerte> : null}
    </div>
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

  if (s === null) return erreur ? <Alerte><p>{erreur}</p></Alerte> : <Skeleton className="h-64 w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <Carte titre="Création des projets" description="Parmi les gestionnaires des projets, qui peut en créer. La direction (Propriétaire, Administrateur) le peut toujours.">
        <div className="flex flex-wrap gap-4 text-sm">
          {ROLES_CREATEURS.map((r) => (
            <label key={r.role} className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={r.direction}
                checked={r.direction || s.projectCreatorRoles === null || s.projectCreatorRoles.includes(r.role)}
                onChange={(e) => void enregistrer({ projectCreatorRoles: createurs(s.projectCreatorRoles, r.role, e.target.checked) })}
              />
              {r.label}
            </label>
          ))}
        </div>
      </Carte>

      <Carte titre="Nouveaux projets" description="Valeurs proposées à la création ; chaque projet reste modifiable ensuite.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-vis`}>
            Visibilité par défaut
            <select id={`${id}-vis`} className={CHAMP} value={s.defaultVisibility} onChange={(e) => void enregistrer({ defaultVisibility: e.target.value as WorkProjectVisibility })}>
              <option value="organization">Toute l’organisation</option>
              <option value="private">Membres seulement (privé)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-vue`}>
            Vue à l’ouverture d’un projet
            <select id={`${id}-vue`} className={CHAMP} value={s.defaultView} onChange={(e) => void enregistrer({ defaultView: e.target.value as WorkDefaultView })}>
              <option value="overview">Aperçu</option>
              <option value="list">Liste</option>
              <option value="board">Tableau</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">
          Colonnes de départ : {s.defaultColumns.map((c) => c.label).join(' → ')}. Elles se règlent dans « Réglages » d’un projet (gestionnaires).
        </p>
      </Carte>

      <Carte titre="Calendrier et échéances" description="Les jours ouvrés comptent pour « échéance proche » et pour le résumé quotidien.">
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
                onClick={() => void enregistrer({ workingDays: basculerJour(s.workingDays, j.iso) as WorkWeekday[] })}
                className={`h-9 min-w-12 rounded-[var(--radius-md)] border px-2 text-sm ${actif ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}
              >
                {j.court}
              </button>
            );
          })}
        </fieldset>
        <label className="flex flex-wrap items-center gap-2 text-sm" htmlFor={`${id}-proche`}>
          « Échéance proche » :
          <select id={`${id}-proche`} className={`${CHAMP} w-auto`} value={s.dueSoonDays} onChange={(e) => void enregistrer({ dueSoonDays: Number(e.target.value) })}>
            {Array.from({ length: 15 }, (_, n) => (
              <option key={n} value={n}>{n === 0 ? 'le jour même' : `${n} jour${n > 1 ? 's' : ''} ouvré${n > 1 ? 's' : ''} avant`}</option>
            ))}
          </select>
        </label>
      </Carte>

      <Carte titre="Archivage et travail en commun">
        <form
          className="flex flex-wrap items-end gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const n = jours.trim() === '' ? null : Number(jours);
            if (n !== null && (!Number.isInteger(n) || n < 1 || n > 365)) {
              setErreur('Archivage automatique : un nombre de jours entre 1 et 365, ou vide pour jamais.');
              return;
            }
            void enregistrer({ autoArchiveCompletedDays: n });
          }}
        >
          <label className="flex flex-col gap-1" htmlFor={`${id}-arch`}>
            Archiver automatiquement les projets terminés après (jours)
            <input id={`${id}-arch`} inputMode="numeric" className={`${CHAMP} w-40`} placeholder="Jamais" value={jours} onChange={(e) => setJours(e.target.value)} />
          </label>
          <button type="submit" className={buttonClasses('secondary', 'sm')}>Appliquer</button>
        </form>
        <label className="flex items-center gap-3 text-sm">
          <Interrupteur id={`${id}-mod`} coche={s.managersModerateComments} libelle="Les gestionnaires modifient et suppriment les commentaires des autres" onChange={() => void enregistrer({ managersModerateComments: !s.managersModerateComments })} />
          <span aria-hidden="true">Les gestionnaires peuvent modifier et supprimer les commentaires des autres</span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <Interrupteur id={`${id}-num`} coche={s.showTaskNumbers} libelle="Afficher les numéros de tâche" onChange={() => void enregistrer({ showTaskNumbers: !s.showTaskNumbers })} />
          <span aria-hidden="true">Afficher les numéros de tâche (#12)</span>
        </label>
      </Carte>
      <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">{enregistre ? 'Enregistré.' : ' '}</p>
      {erreur ? <Alerte><p>{erreur}</p></Alerte> : null}
    </div>
  );
}

export function ParametresProjets(): React.ReactElement {
  const { actions } = useShell();
  const pathname = usePathname();
  const params = useSearchParams();
  const gerer = actions !== null && actions.includes('work.manage');
  const onglet = ongletParametres(params.get('onglet'), gerer);
  const onglets = ONGLETS_PARAMETRES.filter((o) => o.id === 'notifications' || gerer);

  return (
    <section className="flex flex-col gap-5">
      <PageHeader
        module="run"
        moduleLabel="Projets"
        title="Paramètres"
        description="Vos notifications, et le comportement des projets de l’organisation."
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
      {onglet === 'comportement' ? <Comportement /> : <MesNotifications />}
    </section>
  );
}
