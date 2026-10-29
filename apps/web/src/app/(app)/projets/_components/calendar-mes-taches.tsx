'use client';

// `/projets/mes-taches/calendrier` — « Mes tâches » en calendrier (ADR-0039
// § 8, lot L3b) : les mêmes tâches que la liste (non terminées, assignées à
// l'appelant, tous projets non archivés), posées sur leur échéance. Ouvrir une
// tâche mène au panneau de son projet ; déplacer une échéance passe par le même
// `PATCH` que l'onglet Calendrier d'un projet.

import type { MyTaskItem, MyTasksView } from '@lalanda/shared/work';
import { PageHeader, Skeleton, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { appliquerCorps } from './calendar-model';
import { CalendrierTaches } from './calendar-vue';
import { Alerte, BOUTON_PETIT } from './elements';
import { aPlat, appliquerTache, regrouper } from './mes-taches-model';
import {
  MES_TACHES_HREF,
  aujourdhui,
  hrefTache,
  messageWork,
  peutTravailler,
} from './projets-model';
import { messagesAvertissements } from './taches-model';

export function CalendrierMesTaches(): React.ReactElement {
  const { actions } = useShell();
  const router = useRouter();
  const travailler = peutTravailler(actions);
  const [vue, setVue] = useState<MyTasksView | null>(null);
  const [dueSoon, setDueSoon] = useState(1);
  const [erreur, setErreur] = useState<string | null>(null);
  const [avertissements, setAvertissements] = useState<string[]>([]);

  const charger = useCallback(() => {
    workApi
      .myTasks()
      .then((v) => {
        setVue(v);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Impossible de charger vos tâches.')));
    workApi
      .getSettings()
      .then((s) => setDueSoon(s.dueSoonDays))
      .catch(() => undefined);
  }, []);
  useEffect(() => charger(), [charger]);

  const taches = vue ? aPlat(vue) : [];

  function deplacer(
    t: MyTaskItem,
    corps: Parameters<typeof appliquerCorps>[1] & { expectedRevision: number },
  ): void {
    setVue((v) =>
      v
        ? regrouper(
            v,
            aPlat(v).map((x) => (x.id === t.id ? appliquerCorps(x, corps) : x)),
            dueSoon,
          )
        : v,
    );
    workApi
      .patchTask(t.id, corps)
      .then((r) => {
        setVue((v) => (v ? appliquerTache(v, r.task, dueSoon) : v));
        setAvertissements(messagesAvertissements(r.warnings, [...taches, r.task]));
      })
      .catch((err: unknown) => {
        setErreur(messageWork(err, 'Impossible de déplacer l’échéance.'));
        charger();
      });
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <PageHeader
        module="run"
        moduleLabel="Exploiter · Projets"
        title="Mes tâches — calendrier"
        description="Vos tâches non terminées, tous projets confondus, posées sur leur échéance."
        actions={
          <Link href={MES_TACHES_HREF} className={buttonClasses('secondary', 'md')}>
            Vue liste
          </Link>
        }
      />
      {erreur ? (
        <Alerte
          action={
            <button type="button" className={BOUTON_PETIT} onClick={charger}>
              Réessayer
            </button>
          }
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {avertissements.length > 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm"
        >
          <ul className="list-disc pl-5">
            {avertissements.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {vue === null ? (
        erreur ? null : (
          <Skeleton className="h-96 w-full" />
        )
      ) : (
        <CalendrierTaches
          taches={taches}
          today={vue.asOf || aujourdhui()}
          dueSoonDays={dueSoon}
          peutDeplacer={travailler}
          idPrefixe="mes-taches-cal"
          sousTitre={(t) => t.projectName}
          onOuvrir={(t) => router.push(hrefTache(t.projectId, t.id, 'calendrier'))}
          onDeplacer={deplacer}
        />
      )}
    </section>
  );
}
