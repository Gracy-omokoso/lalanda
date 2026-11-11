'use client';

// `/projets/mes-taches` — « Mes tâches » transverse (ADR-0039 § 4 et § 8) :
// tâches non terminées assignées à l'appelant, tous projets non archivés,
// groupées au jour de Kinshasa (en retard · aujourd'hui · 7 jours · plus tard ·
// sans date). La bascule vers un calendrier est le lot L3b
// (`mes-taches/calendrier`) : elle n'est pas affichée tant qu'il n'existe pas.
//
// ADR-0040 — C4 § 5 : les relances du CRM assignées à l'appelant figurent dans
// la même liste (pastille « Relance », compte ou opportunité) ; leur case se
// coche par la route du CRM ; un clic ouvre l'opportunité, le compte ou le contact.

import type { AssetsMyTaskItem } from '@lalanda/shared/assets';
import type { CrmMyTaskItem } from '@lalanda/shared/crm';
import type { HrMyTaskItem } from '@lalanda/shared/hr';
import type { PurchasesMyTaskItem } from '@lalanda/shared/purchases';
import type { SalesContractMyTaskItem } from '@lalanda/shared/sales-contracts';
import type { StockMyTaskItem } from '@lalanda/shared/stock';
import {
  projectColor,
  type MyTasksView,
  type WorkMyTaskItem,
  type WorkProjectSummary,
} from '@lalanda/shared/work';
import {
  Checkbox,
  DatePicker,
  EmptyState,
  PageHeader,
  Select,
  Skeleton,
  SubmitButton,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { ClipboardCheck, FileSignature, Scale } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useSession } from '@/lib/auth-client';
import { crmAgendaApi } from '@/lib/crm-agenda-api';
import { workApi } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { constatAbsentEcheance } from './absences-model';
import {
  AbsenceBadges,
  Alerte,
  BOUTON_PETIT,
  BloqueeBadge,
  Echeance,
  PrioriteBadge,
} from './elements';
import { CercleCocher, OngletsMesTaches, PastilleProjet } from './equipe-elements';
import {
  SECTIONS_MES_TACHES,
  sectionsMesTaches,
  PASTILLE_RELANCE,
  PASTILLE_APPROBATION,
  appliquerTache,
  estApprobation,
  estElementContrat,
  estElementMagasin,
  estElementRh,
  sousTitreElementContrat,
  sousTitreElementMagasin,
  estRelance,
  peutCocherRelance,
  retirerElement,
  pastilleElementRh,
  sousTitreApprobation,
  sousTitreElementRh,
  sousTitreRelance,
  titreElementRh,
  totalMesTaches,
} from './mes-taches-model';
import { PROJETS_BASE, hrefTache, messageWork, peutTravailler } from './projets-model';

export function MesTaches(): React.ReactElement {
  const { actions } = useShell();
  const { data: session } = useSession();
  const moi = session?.user?.id ?? null;
  const travailler = peutTravailler(actions);
  const cocherRelances = peutCocherRelance(actions);
  const [vue, setVue] = useState<MyTasksView | null>(null);
  const [dueSoon, setDueSoon] = useState(1);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState('');

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

  async function cocherRelance(r: CrmMyTaskItem): Promise<void> {
    try {
      await crmAgendaApi.complete(r.activityId, r.revision);
      setVue((v) => (v ? retirerElement(v, r.id, dueSoon) : v));
      setAnnonce(`${r.kindLabel} « ${r.subject} » faite.`);
    } catch (err) {
      setErreur(messageWork(err, 'Impossible de cocher la relance.'));
      charger();
    }
  }

  async function terminer(t: WorkMyTaskItem): Promise<void> {
    try {
      const r = await workApi.completeTask(t.id, t.revision);
      // Laisse la coche se tracer (180 ms) avant de retirer la ligne.
      await new Promise((ok) => setTimeout(ok, 180));
      setVue((v) => (v ? appliquerTache(v, r.task, dueSoon) : v));
      setAnnonce(`#${t.number} « ${t.title} » terminée.`);
    } catch (err) {
      setErreur(messageWork(err, 'Impossible de terminer la tâche.'));
      charger();
      throw err;
    }
  }

  const sections = vue ? sectionsMesTaches(vue) : null;

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        module="run"
        moduleLabel="Exploiter · Projets"
        title="Mes tâches"
        description="Les tâches qui vous sont assignées, tous projets confondus, de la plus urgente à la plus lointaine."
        actions={
          <Link href={PROJETS_BASE} className={buttonClasses('secondary', 'md')}>
            Tous les projets
          </Link>
        }
      />
      <OngletsMesTaches actif="liste" />
      <p className="sr-only" aria-live="polite">
        {annonce}
      </p>
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
      {travailler && moi ? <AjoutRapide moi={moi} onAjoute={charger} /> : null}
      {/* ADR-0045 — H5 (§ 6.2) : tâches que j'ai créées dont l'assigné sera absent à l'échéance. */}
      {vue && (vue.absenceFindings?.length ?? 0) > 0 ? (
        <section
          aria-labelledby="mt-absences"
          className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-3"
        >
          <h2 id="mt-absences" className="text-sm font-semibold">
            <span aria-hidden="true">⚠</span> Responsable absent à l’échéance (
            {vue.absenceFindings!.length})
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {vue.absenceFindings!.map((f) => (
              <li key={f.taskId}>
                <Link
                  href={hrefTache(f.projectId, f.taskId)}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  #{f.number} {f.title}
                </Link>{' '}
                <span className="text-[var(--foreground-muted)]">
                  ({f.projectName}) — {constatAbsentEcheance(f.absence, f.assignee.name)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {vue === null || sections === null ? (
        erreur ? null : (
          <div aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )
      ) : totalMesTaches(vue) === 0 ? (
        <EmptyState
          title="Aucune tâche ouverte pour vous"
          description={
            travailler
              ? 'Ajoutez une tâche ci-dessus, ou attendez qu’on vous en assigne une dans un projet : elle apparaîtra ici, rangée par échéance.'
              : 'Quand une tâche vous sera assignée dans un projet, elle apparaîtra ici.'
          }
          action={
            <Link href={PROJETS_BASE} className={buttonClasses('secondary', 'md')}>
              Voir les projets
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {SECTIONS_MES_TACHES.map((g) => {
            const liste = sections[g.cle];
            return (
              <section
                key={g.cle}
                aria-labelledby={`mt-${g.cle}`}
                className="flex flex-col gap-1.5"
              >
                <h2
                  id={`mt-${g.cle}`}
                  className={`flex items-baseline gap-2 text-[13px] font-semibold ${g.cle === 'overdue' && liste.length > 0 ? 'text-[var(--danger)]' : ''}`}
                >
                  {g.titre}
                  <span className="text-xs font-normal text-[var(--foreground-muted)] tabular-nums">
                    {liste.length}
                  </span>
                </h2>
                {liste.length === 0 ? (
                  <p className="px-1 text-xs text-[var(--foreground-muted)]">{g.vide}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
                    {liste.map((t) =>
                      estElementContrat(t) ? (
                        <LigneContrat key={t.id} e={t} today={vue.asOf} dueSoonDays={dueSoon} />
                      ) : estElementMagasin(t) ? (
                        <LigneMagasin key={t.id} e={t} today={vue.asOf} dueSoonDays={dueSoon} />
                      ) : estElementRh(t) ? (
                        <LigneElementRh key={t.id} e={t} today={vue.asOf} dueSoonDays={dueSoon} />
                      ) : estApprobation(t) ? (
                        <LigneApprobation key={t.id} a={t} today={vue.asOf} dueSoonDays={dueSoon} />
                      ) : estRelance(t) ? (
                        <LigneRelance
                          key={t.id}
                          r={t}
                          today={vue.asOf}
                          dueSoonDays={dueSoon}
                          peutCocher={cocherRelances}
                          onCocher={() => void cocherRelance(t)}
                        />
                      ) : (
                        <LigneTache
                          key={t.id}
                          t={t}
                          today={vue.asOf}
                          dueSoonDays={dueSoon}
                          peutCocher={travailler}
                          onTerminer={() => terminer(t)}
                        />
                      ),
                    )}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Ligne dense d'une tâche (ADR-0058 § 3) : cercle à cocher, titre, projet avec sa
 * pastille, échéance colorée et écrite. Toute la ligne ouvre la tâche ; le cercle
 * reste cliquable au-dessus du lien étiré.
 */
function LigneTache({
  t,
  today,
  dueSoonDays,
  peutCocher,
  onTerminer,
}: {
  t: WorkMyTaskItem;
  today: string;
  dueSoonDays: number;
  peutCocher: boolean;
  onTerminer: () => Promise<void>;
}): React.ReactElement {
  return (
    <li className="relative flex min-h-[var(--row-h)] min-w-0 flex-col gap-1 px-3 py-1.5 transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)] motion-reduce:transition-none sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="relative z-10 flex">
          <CercleCocher
            libelle={`Terminer #${t.number} ${t.title}`}
            desactive={!peutCocher}
            onCocher={onTerminer}
          />
        </span>
        <Link
          href={hrefTache(t.projectId, t.id)}
          className="min-w-0 truncate text-sm font-medium underline-offset-2 after:absolute after:inset-0 hover:underline"
        >
          {t.title}
        </Link>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 pl-9 sm:flex-nowrap sm:pl-0">
        <span className="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
          <PastilleProjet couleur={projectColor(t.projectId)} taille="sm" />
          <span className="truncate">{t.projectName}</span>
        </span>
        {t.blocked ? <BloqueeBadge /> : null}
        <AbsenceBadges t={t} />
        <PrioriteBadge priority={t.priority} />
        <Echeance task={t} today={today} dueSoonDays={dueSoonDays} />
      </div>
    </li>
  );
}

/**
 * Ajout rapide (ADR-0058 § 3) : titre, projet, échéance facultative ; la tâche
 * est assignée à l'appelant et rejoint sa section. Projets actifs seulement.
 */
function AjoutRapide({ moi, onAjoute }: { moi: string; onAjoute: () => void }): React.ReactElement {
  const [projets, setProjets] = useState<WorkProjectSummary[] | null>(null);
  const [titre, setTitre] = useState('');
  const [projet, setProjet] = useState('');
  const [echeance, setEcheance] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    workApi
      .listProjects({ status: 'active', limit: 100 })
      .then((p) => {
        setProjets(p.items);
        setProjet((avant) => avant || (p.items[0]?.id ?? ''));
      })
      .catch(() => setProjets([]));
  }, []);

  if (projets !== null && projets.length === 0) return <></>;

  async function ajouter(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const t = titre.trim();
    if (t === '' || projet === '') {
      setErreur(t === '' ? 'Donnez un titre à la tâche.' : 'Choisissez un projet.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await workApi.createTask(projet, {
        title: t,
        assigneeUserId: moi,
        ...(echeance ? { dueDate: echeance } : {}),
      });
      setTitre('');
      setEcheance('');
      onAjoute();
    } catch (err) {
      setErreur(messageWork(err, 'Impossible d’ajouter la tâche.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void ajouter(e)}
      aria-label="Ajouter une tâche pour moi"
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_10.5rem_auto] sm:items-center"
    >
      <TextInput
        id="mt-ajout"
        aria-label="Nouvelle tâche"
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
        placeholder="＋ Ajouter une tâche…"
        maxLength={300}
        className="col-span-2 border-transparent bg-transparent sm:col-span-1"
        aria-invalid={erreur !== null && titre.trim() === '' ? true : undefined}
      />
      <Select<string>
        id="mt-ajout-projet"
        aria-label="Projet"
        value={projet}
        onChange={setProjet}
        disabled={projets === null}
        loading={projets === null}
        aria-invalid={erreur !== null && projet === '' ? true : undefined}
        options={(projets ?? []).map((p) => ({ value: p.id, label: p.name }))}
        className="col-span-2 sm:col-span-1"
      />
      <DatePicker
        id="mt-ajout-echeance"
        aria-label="Échéance"
        value={echeance}
        onChange={setEcheance}
        shortcuts={['today', 'plus7', 'endOfMonth']}
      />
      <SubmitButton
        busy={envoi}
        busyLabel="Ajout…"
        disabled={projets === null}
        showShortcut={false}
      >
        Ajouter
      </SubmitButton>
      {erreur ? (
        <p role="alert" className="col-span-full text-xs text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Approbation d'achat (ADR-0044 § 6.5, § 8) : pastille « Approbation », pas de case à
 * cocher — approuver exige une décision, le lien ouvre la demande.
 */
/** ADR-0046 § 6.7 : inventaire, « À traiter » ou maintenance — un lien et sa pastille. */
function LigneMagasin({
  e,
  today,
  dueSoonDays,
}: {
  e: StockMyTaskItem | AssetsMyTaskItem;
  today: string;
  dueSoonDays: number;
}): React.ReactElement {
  return (
    <li className="relative flex min-w-0 flex-col gap-1.5 px-3 py-2.5 hover:bg-[var(--surface-muted)] sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <ClipboardCheck
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--module-run)]"
        />
        <span className="flex min-w-0 flex-col">
          <Link
            href={e.href}
            className="break-words text-sm font-medium underline-offset-2 after:absolute after:inset-0 hover:underline"
          >
            {e.title}
          </Link>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {sousTitreElementMagasin(e)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.7rem] font-medium">
          {e.kindLabel}
        </span>
        <Echeance
          task={{ dueDate: e.dueDate, done: false, isMilestone: false }}
          today={today}
          dueSoonDays={dueSoonDays}
        />
      </div>
    </li>
  );
}

/**
 * ADR-0050 § 6 : contrat, avenant, échéance ou acompte — un lien et sa pastille, sans case
 * à cocher (« cocher » renvoie à l'écran propriétaire).
 */
function LigneContrat({
  e,
  today,
  dueSoonDays,
}: {
  e: SalesContractMyTaskItem;
  today: string;
  dueSoonDays: number;
}): React.ReactElement {
  return (
    <li className="relative flex min-w-0 flex-col gap-1.5 px-3 py-2.5 hover:bg-[var(--surface-muted)] sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <FileSignature
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--module-run)]"
        />
        <span className="flex min-w-0 flex-col">
          <Link
            href={e.href}
            className="break-words text-sm font-medium underline-offset-2 after:absolute after:inset-0 hover:underline"
          >
            {e.title}
          </Link>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {sousTitreElementContrat(e)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.7rem] font-medium">
          {e.kindLabel}
        </span>
        <Echeance
          task={{ dueDate: e.dueDate, done: false, isMilestone: false }}
          today={today}
          dueSoonDays={dueSoonDays}
        />
      </div>
    </li>
  );
}

function LigneApprobation({
  a,
  today,
  dueSoonDays,
}: {
  a: PurchasesMyTaskItem;
  today: string;
  dueSoonDays: number;
}): React.ReactElement {
  return (
    <li className="relative flex min-w-0 flex-col gap-1.5 px-3 py-2.5 hover:bg-[var(--surface-muted)] sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <ClipboardCheck
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--module-run)]"
        />
        <span className="flex min-w-0 flex-col">
          <Link
            href={a.href}
            className="break-words text-sm font-medium underline-offset-2 after:absolute after:inset-0 hover:underline"
          >
            {a.title}
          </Link>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {sousTitreApprobation(a)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.7rem] font-medium">
          <Scale aria-hidden="true" className="h-3 w-3" />
          {PASTILLE_APPROBATION}
        </span>
        <Echeance
          task={{ dueDate: a.dueDate, done: false, isMilestone: false }}
          today={today}
          dueSoonDays={dueSoonDays}
        />
      </div>
    </li>
  );
}

/**
 * Élément RH (ADR-0045 § 6.1, § 8) : absence à valider — pastille « Validation
 * d'absence », pas de case à cocher (valider est une décision), le lien ouvre la liste
 * « À valider » ; ou élément de liste d'entrée ou de sortie (lot H4), même forme.
 */
function LigneElementRh({
  e,
  today,
  dueSoonDays,
}: {
  e: HrMyTaskItem;
  today: string;
  dueSoonDays: number;
}): React.ReactElement {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-center text-xs">
          ✓
        </span>
        <span className="flex min-w-0 flex-col">
          <Link
            href={e.href}
            className="break-words text-sm font-medium underline-offset-2 hover:underline"
          >
            {titreElementRh(e)}
          </Link>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {sousTitreElementRh(e)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.7rem] font-medium">
          <span aria-hidden="true">⏸</span>
          {pastilleElementRh(e)}
        </span>
        <Echeance
          task={{ dueDate: e.dueDate, done: false, isMilestone: false }}
          today={today}
          dueSoonDays={dueSoonDays}
        />
      </div>
    </li>
  );
}

/** Relance du CRM dans la liste (ADR-0040 — C4 § 8.2) : pastille, compte, case du CRM. */
function LigneRelance({
  r,
  today,
  dueSoonDays,
  peutCocher,
  onCocher,
}: {
  r: CrmMyTaskItem;
  today: string;
  dueSoonDays: number;
  peutCocher: boolean;
  onCocher: () => void;
}): React.ReactElement {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={false}
          disabled={!peutCocher}
          aria-label={`Marquer faite : ${r.kindLabel.toLowerCase()} « ${r.subject} »`}
          onChange={onCocher}
        />
        <span className="flex min-w-0 flex-col">
          <Link
            href={r.href}
            className="break-words text-sm font-medium underline-offset-2 hover:underline"
          >
            {r.subject}
          </Link>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {r.kindLabel} · {sousTitreRelance(r)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.7rem] font-medium">
          <span aria-hidden="true">↻</span>
          {PASTILLE_RELANCE}
        </span>
        <Echeance
          task={{ dueDate: r.dueDate, done: false, isMilestone: false }}
          today={today}
          dueSoonDays={dueSoonDays}
        />
      </div>
    </li>
  );
}
