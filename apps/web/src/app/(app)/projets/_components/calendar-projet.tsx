'use client';

// Onglet « Calendrier » d'un projet (ADR-0039 § 8, lot L3b) : branche le
// calendrier réutilisable sur le contexte du projet. Déplacer une échéance :
// affichage optimiste, `PATCH /work/tasks/:id` avec la révision lue, puis la
// réponse du serveur fait foi (avertissements de conflit compris). En cas
// d'échec, on relit le projet.

import { Skeleton } from '@lalanda/ui';

import { workApi } from '@/lib/work-api';

import { appliquerCorps } from './calendar-model';
import { CalendrierTaches } from './calendar-vue';
import { useProjet } from './project-context';

export function CalendrierProjet(): React.ReactElement {
  const {
    project,
    tasks,
    settings,
    today,
    chargement,
    travailler,
    ouvrirTache,
    setTasks,
    appliquerEcriture,
    signalerErreur,
    recharger,
  } = useProjet();

  if (project === null) {
    return chargement ? <Skeleton className="h-96 w-full" /> : <></>;
  }

  return (
    <CalendrierTaches
      taches={tasks}
      today={today}
      dueSoonDays={settings?.dueSoonDays ?? 1}
      peutDeplacer={travailler}
      idPrefixe="calendrier"
      onOuvrir={(t) => ouvrirTache(t.id)}
      onDeplacer={(t, corps) => {
        setTasks((liste) => liste.map((x) => (x.id === t.id ? appliquerCorps(x, corps) : x)));
        workApi
          .patchTask(t.id, corps)
          .then(appliquerEcriture)
          .catch((err: unknown) => {
            signalerErreur(err, 'Impossible de déplacer l’échéance.');
            recharger();
          });
      }}
    />
  );
}
