// Logique pure des tâches : filtres, panneau de détail, mentions, dépendances,
// historique (ADR-0039 § 2.3, § 2.4, § 2.8, § 8). Testée sans DOM.
//
// Règles tenues ici :
// - un conflit de dates entre une tâche et son prédécesseur est un
//   AVERTISSEMENT, jamais un blocage, et AUCUNE date n'est déplacée
//   automatiquement (décision ouverte n° 5) ;
// - une mention s'écrit `@[userId]` dans le texte envoyé et se REND avec le nom
//   courant du membre (§ 2.4) ; le client envoie la liste des mentionnés, le
//   serveur la vérifie.

import {
  detectCycle,
  type PatchWorkTaskBody,
  type WorkActivityKind,
  type WorkActivityView,
  type WorkMemberRef,
  type WorkPriority,
  type WorkProjectView,
  type WorkTaskDetail,
  type WorkTaskView,
  type WorkWarning,
} from '@lalanda/shared/work';

import type { WorkMemberOption } from '@/lib/work-api';

// ─── Filtres de la vue liste et du Kanban ───────────────────────────────────

export interface FiltresTaches {
  texte: string;
  /** `''` : tous ; `'aucun'` : sans responsable ; sinon un `userId`. */
  responsable: string;
  /** `''` : toutes ; sinon une clé d'étiquette. */
  etiquette: string;
  priorite: '' | WorkPriority;
  masquerTerminees: boolean;
}

export function filtresVides(): FiltresTaches {
  return { texte: '', responsable: '', etiquette: '', priorite: '', masquerTerminees: false };
}

export function filtresActifs(f: FiltresTaches): boolean {
  return (
    f.texte.trim() !== '' ||
    f.responsable !== '' ||
    f.etiquette !== '' ||
    f.priorite !== '' ||
    f.masquerTerminees
  );
}

function normaliser(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function filtrerTaches(tasks: readonly WorkTaskView[], f: FiltresTaches): WorkTaskView[] {
  const q = normaliser(f.texte.trim().replace(/^#/, ''));
  return tasks.filter((t) => {
    if (f.masquerTerminees && t.done) return false;
    if (f.responsable === 'aucun' && t.assignee !== null) return false;
    if (f.responsable !== '' && f.responsable !== 'aucun' && t.assignee?.userId !== f.responsable)
      return false;
    if (f.etiquette !== '' && !t.labelKeys.includes(f.etiquette)) return false;
    if (f.priorite !== '' && t.priority !== f.priorite) return false;
    if (q !== '' && !normaliser(t.title).includes(q) && String(t.number) !== q) return false;
    return true;
  });
}

// ─── Membres ────────────────────────────────────────────────────────────────

/**
 * Repli quand `GET /work/members` n'est pas disponible : les membres déjà cités
 * par les réponses (responsable du projet, responsables et abonnés des tâches).
 * `canUpdate` y est supposé (`canManage` non) : le serveur refusera un responsable inéligible
 * (`WORK_ASSIGNEE_NOT_ELIGIBLE`).
 */
export function membresConnus(
  project: Pick<WorkProjectView, 'owner'> | null,
  tasks: readonly Pick<WorkTaskView, 'assignee'>[],
  extra: readonly WorkMemberRef[] = [],
): WorkMemberOption[] {
  const parId = new Map<string, WorkMemberOption>();
  const ajouter = (m: WorkMemberRef | null) => {
    if (m && !parId.has(m.userId)) parId.set(m.userId, { ...m, canUpdate: true, canManage: false });
  };
  ajouter(project?.owner ?? null);
  for (const t of tasks) ajouter(t.assignee);
  for (const m of extra) ajouter(m);
  return [...parId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// ─── Mentions (§ 2.4) ───────────────────────────────────────────────────────

const MENTION = /@\[([0-9a-f]{24})\]/gi;

/**
 * Requête de mention en cours de frappe : le texte après le dernier `@` avant
 * le curseur, s'il n'est précédé que d'un espace ou du début, et ne contient
 * pas de retour à la ligne. `null` : pas de mention en cours.
 */
export function requeteMention(
  texte: string,
  curseur: number,
): { debut: number; requete: string } | null {
  const avant = texte.slice(0, curseur);
  const at = avant.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(avant[at - 1]!)) return null;
  const requete = avant.slice(at + 1);
  if (/[\n@]/.test(requete) || requete.length > 40) return null;
  return { debut: at, requete };
}

/** Membres proposés pour `requete` (préfixe d'un mot du nom, sans accents). */
export function suggestionsMention(
  membres: readonly WorkMemberOption[],
  requete: string,
  max = 6,
): WorkMemberOption[] {
  const q = normaliser(requete.trim());
  return membres
    .filter(
      (m) =>
        q === '' ||
        normaliser(m.name)
          .split(/\s+/)
          .some((mot) => mot.startsWith(q)),
    )
    .slice(0, max);
}

/** Insère `@Nom ` à la place de la requête en cours ; rend le texte et le curseur. */
export function insererMention(
  texte: string,
  mention: { debut: number; requete: string },
  membre: WorkMemberOption,
): { texte: string; curseur: number } {
  const avant = texte.slice(0, mention.debut);
  const apres = texte.slice(mention.debut + 1 + mention.requete.length);
  const insere = `@${membre.name} `;
  return { texte: avant + insere + apres, curseur: avant.length + insere.length };
}

function echapper(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Texte saisi → corps envoyé : chaque `@Nom` d'un membre CHOISI devient
 * `@[userId]`, et la liste des mentionnés est celle qui reste dans le texte
 * (un nom effacé après le choix n'est plus mentionné). Les noms les plus longs
 * d'abord, pour qu'« @Marie Claire » ne soit pas lu « @Marie ».
 */
export function encoderMentions(
  texte: string,
  choisis: readonly WorkMemberRef[],
): { body: string; mentionedUserIds: string[] } {
  let body = texte;
  const ids: string[] = [];
  const tries = [...choisis].sort((a, b) => b.name.length - a.name.length);
  for (const m of tries) {
    const re = new RegExp(`@${echapper(m.name)}(?![\\p{L}\\p{N}])`, 'gu');
    if (re.test(body)) {
      body = body.replace(re, `@[${m.userId}]`);
      if (!ids.includes(m.userId)) ids.push(m.userId);
    }
  }
  return { body, mentionedUserIds: ids };
}

export type Segment =
  { type: 'texte'; texte: string } | { type: 'mention'; nom: string; userId: string };

/**
 * Corps reçu → segments à rendre : chaque `@[userId]` prend le NOM COURANT du
 * membre (liste `mentions` du serveur) ; un membre inconnu s'affiche « @membre ».
 * Texte brut, jamais de HTML (§ 2.4).
 */
export function segmentsCommentaire(body: string, mentions: readonly WorkMemberRef[]): Segment[] {
  const noms = new Map(mentions.map((m) => [m.userId.toLowerCase(), m.name]));
  const out: Segment[] = [];
  let dernier = 0;
  for (const m of body.matchAll(MENTION)) {
    const i = m.index ?? 0;
    if (i > dernier) out.push({ type: 'texte', texte: body.slice(dernier, i) });
    const userId = m[1]!.toLowerCase();
    out.push({ type: 'mention', userId, nom: noms.get(userId) ?? 'membre' });
    dernier = i + m[0].length;
  }
  if (dernier < body.length) out.push({ type: 'texte', texte: body.slice(dernier) });
  return out;
}

/** Corps reçu → texte éditable (`@[id]` → `@Nom`) et mentions choisies, pour modifier. */
export function decoderMentions(
  body: string,
  mentions: readonly WorkMemberRef[],
): { texte: string; choisis: WorkMemberRef[] } {
  const choisis: WorkMemberRef[] = [];
  const texte = segmentsCommentaire(body, mentions)
    .map((s) => {
      if (s.type === 'texte') return s.texte;
      if (!choisis.some((c) => c.userId === s.userId)) {
        choisis.push({ userId: s.userId, name: s.nom });
      }
      return `@${s.nom}`;
    })
    .join('');
  return { texte, choisis };
}

// ─── Formulaire du panneau de tâche ─────────────────────────────────────────

export interface FormulaireTache {
  title: string;
  description: string;
  assigneeUserId: string;
  priority: WorkPriority;
  startDate: string;
  dueDate: string;
  isMilestone: boolean;
  labelKeys: string[];
  estimate: string;
}

export function formulaireTache(t: WorkTaskDetail): FormulaireTache {
  return {
    title: t.title,
    description: t.description ?? '',
    assigneeUserId: t.assignee?.userId ?? '',
    priority: t.priority,
    startDate: t.startDate ?? '',
    dueDate: t.dueDate ?? '',
    isMilestone: t.isMilestone,
    labelKeys: [...t.labelKeys],
    estimate: t.estimateMinutes === null ? '' : String(t.estimateMinutes),
  };
}

const ouNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Différence entre la tâche et le formulaire → corps de `PATCH` (champs
 * modifiés seulement, plus `expectedRevision`). `null` : rien à envoyer.
 * Passer en jalon retire la date de début (un jalon n'en a pas, § 2.3).
 */
export function diffTache(t: WorkTaskDetail, f: FormulaireTache): PatchWorkTaskBody | null {
  const corps: Record<string, unknown> = {};
  if (f.title.trim() !== t.title) corps['title'] = f.title.trim();
  if (ouNull(f.description) !== (t.description ?? null))
    corps['description'] = ouNull(f.description);
  if (ouNull(f.assigneeUserId) !== (t.assignee?.userId ?? null))
    corps['assigneeUserId'] = ouNull(f.assigneeUserId);
  if (f.priority !== t.priority) corps['priority'] = f.priority;
  if (f.isMilestone !== t.isMilestone) corps['isMilestone'] = f.isMilestone;
  const start = f.isMilestone ? null : ouNull(f.startDate);
  if (start !== (t.startDate ?? null)) corps['startDate'] = start;
  if (ouNull(f.dueDate) !== (t.dueDate ?? null)) corps['dueDate'] = ouNull(f.dueDate);
  const a = [...f.labelKeys].sort().join(',');
  const b = [...t.labelKeys].sort().join(',');
  if (a !== b) corps['labelKeys'] = f.labelKeys;
  const est = f.estimate.trim() === '' ? null : Number(f.estimate);
  if (est !== t.estimateMinutes) corps['estimateMinutes'] = est;
  if (Object.keys(corps).length === 0) return null;
  return { ...corps, expectedRevision: t.revision } as PatchWorkTaskBody;
}

// ─── Dépendances ────────────────────────────────────────────────────────────

/**
 * Prédécesseurs proposables pour `task` : même projet, de premier niveau ou
 * non, jamais elle-même, pas déjà posés, et sans fermer de boucle
 * (`detectCycle`, la fonction du serveur — le serveur revérifie).
 */
export function candidatsDependance(
  tasks: readonly WorkTaskView[],
  task: Pick<WorkTaskView, 'id' | 'blockedBy'>,
): WorkTaskView[] {
  const deja = new Set(task.blockedBy.map((d) => d.taskId));
  return tasks
    .filter((t) => t.id !== task.id && !deja.has(t.id))
    .filter((t) => detectCycle(tasks, { taskId: task.id, predecessorTaskId: t.id }) === null)
    .sort((a, b) => a.number - b.number);
}

/**
 * Avertissements lisibles. Jamais bloquants ; aucune date n'est déplacée :
 * on dit quoi regarder, l'utilisateur décide.
 */
export function messagesAvertissements(
  warnings: readonly WorkWarning[],
  tasks: readonly Pick<WorkTaskView, 'id' | 'number' | 'title'>[],
): string[] {
  const parId = new Map(tasks.map((t) => [t.id, t]));
  const nom = (id: string) => {
    const t = parId.get(id);
    return t ? `#${t.number} « ${t.title} »` : 'une tâche';
  };
  return warnings.map((w) =>
    w.code === 'WORK_DEPENDENCY_DATE_CONFLICT'
      ? `Conflit de dates : ${nom(w.taskId)} commence avant la fin de ${nom(w.predecessorId)}, dont elle dépend. Aucune date n’a été déplacée ; ajustez-les si besoin.`
      : 'Avertissement du serveur.',
  );
}

// ─── Historique (§ 2.8) ─────────────────────────────────────────────────────

const LIBELLES_ACTIVITE: Record<WorkActivityKind, string> = {
  'project.created': 'a créé le projet',
  'project.updated': 'a modifié le projet',
  'project.archived': 'a archivé le projet',
  'project.restored': 'a restauré le projet',
  'project.completed': 'a terminé le projet',
  'task.created': 'a créé la tâche',
  'task.updated': 'a modifié la tâche',
  'task.moved': 'a déplacé la tâche',
  'task.assigned': 'a assigné la tâche',
  'task.unassigned': 'a retiré le responsable',
  'task.due_changed': 'a changé l’échéance',
  'task.completed': 'a terminé la tâche',
  'task.reopened': 'a rouvert la tâche',
  'task.deleted': 'a supprimé la tâche',
  'dependency.added': 'a ajouté une dépendance',
  'dependency.removed': 'a retiré une dépendance',
  'comment.added': 'a commenté',
  'comment.edited': 'a modifié un commentaire',
  'comment.deleted': 'a supprimé un commentaire',
  'attachment.added': 'a joint un fichier',
  'attachment.removed': 'a retiré une pièce jointe',
  'time.logged': 'a saisi du temps',
  'time.updated': 'a corrigé une saisie de temps',
  'time.deleted': 'a supprimé une saisie de temps',
  'invoice.linked': 'a lié une facture',
  'invoice.unlinked': 'a délié une facture',
  'invoice.prepared': 'a préparé un brouillon de facture',
};

/** « Kevin a déplacé la tâche (À faire → En cours) ». */
export function libelleActivite(
  a: Pick<WorkActivityView, 'actor' | 'kind' | 'data'>,
  libellesColonnes: ReadonlyMap<string, string> = new Map(),
): string {
  const base = `${a.actor.name} ${LIBELLES_ACTIVITE[a.kind] ?? 'a agi'}`;
  const { from, to } = a.data as { from?: unknown; to?: unknown };
  const lire = (v: unknown): string | null => {
    if (typeof v === 'string') return libellesColonnes.get(v) ?? v;
    if (typeof v === 'number') return String(v);
    return null;
  };
  const de = lire(from);
  const vers = lire(to);
  if (de !== null && vers !== null) return `${base} (${de} → ${vers})`;
  if (vers !== null && a.kind === 'task.due_changed') return `${base} (${vers})`;
  return base;
}
