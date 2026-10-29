'use client';

// Contexte d'un projet ouvert (`/projets/[id]/…`) — partagé par l'en-tête, les
// onglets (Liste, Kanban, Réglages ; Calendrier et Chronologie du lot L3b) et
// le panneau de tâche.
//
// POUR L3b : `useProjet()` fournit `project`, `tasks` (tout le projet,
// projection allégée), `settings`, `members`, `today` (jour de Kinshasa),
// `ouvrirTache(id)` (panneau `?tache=`), `appliquerEcriture(résultat)` (après un
// `PATCH` : remplace la tâche et affiche les avertissements) et `recharger()`.
// Déplacer une échéance depuis le calendrier : `workApi.patchTask(id, { dueDate,
// expectedRevision })` puis `appliquerEcriture`.
//
// Les données sont lues UNE fois au montage du layout (qui persiste d'un onglet
// à l'autre) : changer d'onglet ne relit rien.

import type {
  WorkProjectView,
  WorkSettingsView,
  WorkTaskView,
  WorkTaskWriteResult,
} from '@lalanda/shared/work';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { workApi, type WorkMemberOption } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { recalculerBlocages, remplacerTache } from './kanban-model';
import { PARAM_TACHE, aujourdhui, codeWork, messageWork } from './projets-model';
import { membresConnus, messagesAvertissements } from './taches-model';

export interface ContexteProjet {
  projectId: string;
  project: WorkProjectView | null;
  tasks: WorkTaskView[];
  settings: WorkSettingsView | null;
  members: WorkMemberOption[];
  /** Jour de Kinshasa, `AAAA-MM-JJ`. */
  today: string;
  /** `null` tant que rien n'a échoué. */
  erreur: string | null;
  chargement: boolean;
  /** Messages non bloquants (conflits de dates, suggestions) du dernier geste. */
  avertissements: string[];
  effacerAvertissements: () => void;
  effacerErreur: () => void;
  signalerErreur: (err: unknown, repli: string) => void;
  recharger: () => void;
  setProject: (p: WorkProjectView) => void;
  setSettings: (s: WorkSettingsView) => void;
  setTasks: (f: (t: WorkTaskView[]) => WorkTaskView[]) => void;
  /** Applique la réponse d'une écriture de tâche : tâche, avertissements. */
  appliquerEcriture: (r: WorkTaskWriteResult) => void;
  tacheOuverte: string | null;
  ouvrirTache: (taskId: string) => void;
  fermerTache: () => void;
  /** Droits confirmés par le serveur (confort d'affichage). */
  travailler: boolean;
  gerer: boolean;
}

const Contexte = createContext<ContexteProjet | null>(null);

export function useProjet(): ContexteProjet {
  const c = useContext(Contexte);
  if (c === null) throw new Error('useProjet() hors de <ProjetProvider>');
  return c;
}

export function ProjetProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { actions } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [project, setProject] = useState<WorkProjectView | null>(null);
  const [tasks, setTasksState] = useState<WorkTaskView[]>([]);
  const [settings, setSettings] = useState<WorkSettingsView | null>(null);
  const [membresApi, setMembresApi] = useState<WorkMemberOption[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const tasksRef = useRef<WorkTaskView[]>([]);
  tasksRef.current = tasks;

  useEffect(() => {
    let annule = false;
    setChargement(true);
    Promise.all([
      workApi.getProject(projectId),
      workApi.listProjectTasks(projectId),
      workApi.getSettings(),
    ])
      .then(([p, t, s]) => {
        if (annule) return;
        setProject(p);
        setTasksState(t);
        setSettings(s);
        setErreur(null);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageWork(err, 'Impossible de charger ce projet.'));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [projectId, version]);

  // Membres éligibles : route supposée (`work-api.ts`) ; repli silencieux.
  useEffect(() => {
    let annule = false;
    workApi
      .listMembers()
      .then((r) => {
        if (!annule) setMembresApi(r.members);
      })
      .catch(() => {
        if (!annule) setMembresApi(null);
      });
    return () => {
      annule = true;
    };
  }, []);

  const members = useMemo(
    () => membresApi ?? membresConnus(project, tasks),
    [membresApi, project, tasks],
  );

  const recharger = useCallback(() => setVersion((v) => v + 1), []);

  const setTasks = useCallback((f: (t: WorkTaskView[]) => WorkTaskView[]) => {
    setTasksState((t) => recalculerBlocages(f(t)));
  }, []);

  const appliquerEcriture = useCallback(
    (r: WorkTaskWriteResult) => {
      setTasks((t) => remplacerTache(t, r.task));
      const messages = messagesAvertissements(r.warnings, [...tasksRef.current, r.task]);
      if (r.suggestions.some((s) => s.code === 'PREPARE_INVOICE')) {
        messages.push(
          'Jalon terminé : une facture peut être préparée depuis ce jalon (Ventes, lot à venir).',
        );
      }
      setAvertissements(messages);
    },
    [setTasks],
  );

  const signalerErreur = useCallback(
    (err: unknown, repli: string) => {
      setErreur(messageWork(err, repli));
      // Révision périmée : on relit tout, l'utilisateur refait son geste.
      if (codeWork(err) === 'STALE_REVISION') recharger();
    },
    [recharger],
  );

  const tacheOuverte = searchParams.get(PARAM_TACHE);

  const ouvrirTache = useCallback(
    (taskId: string) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set(PARAM_TACHE, taskId);
      router.push(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const fermerTache = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete(PARAM_TACHE);
    const q = p.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const valeur = useMemo<ContexteProjet>(
    () => ({
      projectId,
      project,
      tasks,
      settings,
      members,
      today: aujourdhui(),
      erreur,
      chargement,
      avertissements,
      effacerAvertissements: () => setAvertissements([]),
      effacerErreur: () => setErreur(null),
      signalerErreur,
      recharger,
      setProject,
      setSettings,
      setTasks,
      appliquerEcriture,
      tacheOuverte,
      ouvrirTache,
      fermerTache,
      travailler:
        actions !== null && actions.includes('work.update') && project?.status !== 'archived',
      gerer: actions !== null && actions.includes('work.manage'),
    }),
    [
      projectId,
      project,
      tasks,
      settings,
      members,
      erreur,
      chargement,
      avertissements,
      signalerErreur,
      recharger,
      setTasks,
      appliquerEcriture,
      tacheOuverte,
      ouvrirTache,
      fermerTache,
      actions,
    ],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
