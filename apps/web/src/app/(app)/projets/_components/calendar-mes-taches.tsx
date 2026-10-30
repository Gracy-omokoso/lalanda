'use client';

// `/projets/mes-taches/calendrier` — « Mes tâches » en calendrier (ADR-0039
// § 8, lot L3b) : les mêmes tâches que la liste (non terminées, assignées à
// l'appelant, tous projets non archivés), posées sur leur échéance. Ouvrir une
// tâche mène au panneau de son projet ; déplacer une échéance passe par le même
// `PATCH` que l'onglet Calendrier d'un projet.
//
// ADR-0040 — C4 § 5.2 : les relances du CRM y sont posées à leur jour
// d'échéance, avec l'étiquette « Relance » et le signe ↻ (forme et libellé, pas
// seulement une couleur). Les ouvrir mène à l'opportunité, au compte ou au
// contact ; les déplacer change `dueAt` par `PUT /crm/activities/:id`, heure de
// Kinshasa conservée.

import type { MyTaskEntry, MyTasksView, WorkMyTaskItem } from '@lalanda/shared/work';
import { PageHeader, Skeleton, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { crmAgendaApi } from '@/lib/crm-agenda-api';
import { workApi } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { appliquerCorps } from './calendar-model';
import { CalendrierTaches, type TacheCalendrierUI } from './calendar-vue';
import { Alerte, BOUTON_PETIT } from './elements';
import {
  PASTILLE_APPROBATION,
  PASTILLE_RELANCE,
  aPlat,
  appliquerRelance,
  appliquerTache,
  estApprobation,
  estElementRh,
  estRelance,
  estTache,
  instantDeplace,
  regrouper,
  pastilleElementRh,
  sousTitreApprobation,
  sousTitreElementRh,
  sousTitreRelance,
  titreElementRh,
} from './mes-taches-model';
import {
  MES_TACHES_HREF,
  aujourdhui,
  hrefTache,
  messageWork,
  peutTravailler,
} from './projets-model';
import { messagesAvertissements } from './taches-model';

/** Élément du calendrier : la forme lue par la vue, et l'élément d'origine. */
type ElementCalendrier = TacheCalendrierUI & { element: MyTaskEntry };

function versCalendrier(e: MyTaskEntry): ElementCalendrier {
  if (estTache(e)) return { ...e, element: e };
  // ADR-0045 § 6.1 : une absence à valider se lit au premier jour de l'absence, sans se déplacer.
  if (estElementRh(e)) {
    return {
      id: e.id,
      number: 0,
      title: titreElementRh(e),
      etiquette: pastilleElementRh(e),
      startDate: null,
      dueDate: e.dueDate,
      isMilestone: false,
      done: false,
      rank: e.rank,
      revision: 0,
      element: e,
    };
  }
  // ADR-0044 § 6.5 : une approbation d'achat se lit au jour de soumission, sans se déplacer.
  if (estApprobation(e)) {
    return {
      id: e.id,
      number: 0,
      title: e.title,
      etiquette: PASTILLE_APPROBATION,
      startDate: null,
      dueDate: e.dueDate,
      isMilestone: false,
      done: false,
      rank: e.rank,
      revision: 0,
      element: e,
    };
  }
  return {
    id: e.id,
    number: 0,
    title: e.subject,
    etiquette: PASTILLE_RELANCE,
    startDate: null,
    dueDate: e.dueDate,
    isMilestone: false,
    done: false,
    rank: e.rank,
    revision: e.revision,
    element: e,
  };
}

export function CalendrierMesTaches(): React.ReactElement {
  const { actions } = useShell();
  const router = useRouter();
  const travailler = peutTravailler(actions);
  // Une relance n'est assignée qu'à un détenteur de `crm.manage` (§ 5.3) : qui la
  // voit peut la déplacer ; sinon l'API répond 403 et l'erreur s'affiche.
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

  const elements = vue ? aPlat(vue).map(versCalendrier) : [];
  const taches = vue ? aPlat(vue).filter(estTache) : [];

  function deplacerRelance(id: string, jour: string): void {
    const r = vue ? aPlat(vue).find((e) => e.id === id) : undefined;
    if (!r || !estRelance(r)) return;
    const dueAt = instantDeplace(r.dueAt, jour);
    setVue((v) =>
      v ? appliquerRelance(v, r.id, { dueDate: jour, dueAt, revision: r.revision }, dueSoon) : v,
    );
    crmAgendaApi
      .moveDue(r, dueAt)
      .then((a) => {
        setVue((v) =>
          v
            ? appliquerRelance(
                v,
                r.id,
                { dueDate: a.dueDay ?? jour, dueAt: a.dueAt ?? dueAt, revision: a.revision },
                dueSoon,
              )
            : v,
        );
      })
      .catch((err: unknown) => {
        setErreur(messageWork(err, 'Impossible de déplacer la relance.'));
        charger();
      });
  }

  function deplacer(
    t: WorkMyTaskItem,
    corps: Parameters<typeof appliquerCorps>[1] & { expectedRevision: number },
  ): void {
    setVue((v) =>
      v
        ? regrouper(
            v,
            aPlat(v).map((x) => (estTache(x) && x.id === t.id ? appliquerCorps(x, corps) : x)),
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
          taches={elements}
          today={vue.asOf || aujourdhui()}
          dueSoonDays={dueSoon}
          peutDeplacer={travailler}
          idPrefixe="mes-taches-cal"
          sousTitre={(t) =>
            estElementRh(t.element)
              ? sousTitreElementRh(t.element)
              : estApprobation(t.element)
                ? sousTitreApprobation(t.element)
                : estRelance(t.element)
                  ? sousTitreRelance(t.element)
                  : t.element.projectName
          }
          onOuvrir={(t) =>
            router.push(
              estRelance(t.element) || estApprobation(t.element) || estElementRh(t.element)
                ? t.element.href
                : hrefTache(t.element.projectId, t.element.id, 'calendrier'),
            )
          }
          onDeplacer={(t, corps) => {
            if (estTache(t.element)) deplacer(t.element, corps);
            else if (estRelance(t.element) && corps.dueDate) deplacerRelance(t.id, corps.dueDate);
          }}
        />
      )}
    </section>
  );
}
