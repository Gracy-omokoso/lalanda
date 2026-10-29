import type { WorkTaskDetail } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { oid, tache } from './fixtures.test-helpers';
import {
  activiteDeTache,
  candidatsDependance,
  decoderMentions,
  diffTache,
  encoderMentions,
  filtrerTaches,
  filtresActifs,
  filtresVides,
  formulaireTache,
  insererMention,
  libelleActivite,
  membresConnus,
  messagesAvertissements,
  requeteMention,
  segmentsCommentaire,
  suggestionsMention,
} from './taches-model';

const KEVIN = { userId: oid(101), name: 'Kevin Mbala' };
const MARIE = { userId: oid(102), name: 'Marie' };
const MARIE_CLAIRE = { userId: oid(103), name: 'Marie Claire' };

describe('filtres', () => {
  const t1 = tache({
    id: oid(1),
    title: 'Poser le carrelage',
    assignee: KEVIN,
    labelKeys: ['chantier'],
  });
  const t2 = tache({ id: oid(2), title: 'Électricité', done: true, priority: 'high', number: 42 });
  it('texte sans accents, numéro, responsable, étiquette, priorité, terminées', () => {
    expect(filtrerTaches([t1, t2], { ...filtresVides(), texte: 'electri' })).toEqual([t2]);
    expect(filtrerTaches([t1, t2], { ...filtresVides(), texte: '#42' })).toEqual([t2]);
    expect(filtrerTaches([t1, t2], { ...filtresVides(), responsable: KEVIN.userId })).toEqual([t1]);
    expect(filtrerTaches([t1, t2], { ...filtresVides(), responsable: 'aucun' })).toEqual([t2]);
    expect(filtrerTaches([t1, t2], { ...filtresVides(), etiquette: 'chantier' })).toEqual([t1]);
    expect(filtrerTaches([t1, t2], { ...filtresVides(), priorite: 'high' })).toEqual([t2]);
    expect(filtrerTaches([t1, t2], { ...filtresVides(), masquerTerminees: true })).toEqual([t1]);
    expect(filtresActifs(filtresVides())).toBe(false);
  });
});

describe('membres connus (repli)', () => {
  it('dédoublonnés, triés par nom', () => {
    const m = membresConnus({ owner: MARIE }, [
      tache({ id: oid(1), assignee: KEVIN }),
      tache({ id: oid(2), assignee: MARIE }),
    ]);
    expect(m.map((x) => x.name)).toEqual(['Kevin Mbala', 'Marie']);
  });
});

describe('mentions', () => {
  it('requête en cours de frappe', () => {
    expect(requeteMention('Bonjour @Ke', 11)).toEqual({ debut: 8, requete: 'Ke' });
    expect(requeteMention('mail@exemple', 12)).toBeNull();
    expect(requeteMention('@a\nb', 4)).toBeNull();
    expect(requeteMention('sans', 4)).toBeNull();
  });
  it('suggestions par début de mot, sans accents', () => {
    const membres = [
      { ...KEVIN, canUpdate: true },
      { ...MARIE, canUpdate: false },
    ];
    expect(suggestionsMention(membres, 'mb').map((m) => m.name)).toEqual(['Kevin Mbala']);
    expect(suggestionsMention(membres, '')).toHaveLength(2);
  });
  it('insérer remplace la requête par le nom', () => {
    const q = requeteMention('Voir @ke merci', 8)!;
    expect(insererMention('Voir @ke merci', q, { ...KEVIN, canUpdate: true })).toEqual({
      texte: 'Voir @Kevin Mbala  merci',
      curseur: 18,
    });
  });
  it('encoder : @Nom → @[id], le plus long nom d’abord, noms effacés retirés', () => {
    const r = encoderMentions('Merci @Marie Claire et @Marie !', [MARIE, MARIE_CLAIRE, KEVIN]);
    expect(r.body).toBe(`Merci @[${MARIE_CLAIRE.userId}] et @[${MARIE.userId}] !`);
    expect(r.mentionedUserIds).toEqual([MARIE_CLAIRE.userId, MARIE.userId]);
  });
  it('rendu : nom courant, membre inconnu, texte brut', () => {
    const body = `Salut @[${KEVIN.userId}], vois avec @[${oid(555)}] <b>`;
    expect(segmentsCommentaire(body, [KEVIN])).toEqual([
      { type: 'texte', texte: 'Salut ' },
      { type: 'mention', userId: KEVIN.userId, nom: 'Kevin Mbala' },
      { type: 'texte', texte: ', vois avec ' },
      { type: 'mention', userId: oid(555), nom: 'membre' },
      { type: 'texte', texte: ' <b>' },
    ]);
  });
  it('aller-retour : décoder puis encoder rend le même corps', () => {
    const body = `Ok @[${KEVIN.userId}] !`;
    const d = decoderMentions(body, [KEVIN]);
    expect(d.texte).toBe('Ok @Kevin Mbala !');
    expect(encoderMentions(d.texte, d.choisis).body).toBe(body);
  });
});

function detail(p: Partial<WorkTaskDetail> = {}): WorkTaskDetail {
  return {
    ...tache({
      id: oid(1),
      title: 'Titre',
      revision: 4,
      startDate: '2026-11-01',
      dueDate: '2026-11-05',
    }),
    description: null,
    completedBy: null,
    followers: [],
    subtasks: [],
    predecessors: [],
    successors: [],
    commentCount: 0,
    attachmentCount: 0,
    source: null,
    billing: null,
    createdBy: oid(9),
    createdAt: '2026-10-29T00:00:00.000Z',
    ...p,
  };
}

describe('diffTache', () => {
  it('rien de modifié : rien à envoyer', () => {
    const t = detail();
    expect(diffTache(t, formulaireTache(t))).toBeNull();
  });
  it('seuls les champs modifiés, avec la révision', () => {
    const t = detail();
    const f = {
      ...formulaireTache(t),
      title: ' Nouveau ',
      assigneeUserId: KEVIN.userId,
      labelKeys: ['a'],
    };
    expect(diffTache(t, f)).toEqual({
      title: 'Nouveau',
      assigneeUserId: KEVIN.userId,
      labelKeys: ['a'],
      expectedRevision: 4,
    });
  });
  it('passer en jalon retire la date de début', () => {
    const t = detail();
    expect(diffTache(t, { ...formulaireTache(t), isMilestone: true })).toEqual({
      isMilestone: true,
      startDate: null,
      expectedRevision: 4,
    });
  });
});

describe('dépendances', () => {
  it('ni elle-même, ni déjà posée, ni boucle', () => {
    const a = tache({ id: oid(1) });
    const b = tache({ id: oid(2), blockedBy: [{ taskId: oid(1), type: 'finish_to_start' }] });
    const c = tache({ id: oid(3), blockedBy: [{ taskId: oid(2), type: 'finish_to_start' }] });
    // a ne peut pas attendre c (c attend b qui attend a) ni b.
    expect(candidatsDependance([a, b, c], a).map((t) => t.id)).toEqual([]);
    expect(candidatsDependance([a, b, c], c).map((t) => t.id)).toEqual([oid(1)]);
  });
  it('avertissement de conflit : lisible, jamais de décalage', () => {
    const a = tache({ id: oid(1), number: 8, title: 'Fondations' });
    const b = tache({ id: oid(2), number: 12, title: 'Murs' });
    const [m] = messagesAvertissements(
      [{ code: 'WORK_DEPENDENCY_DATE_CONFLICT', taskId: b.id, predecessorId: a.id }],
      [a, b],
    );
    expect(m).toMatch(/#12 « Murs » commence avant la fin de #8 « Fondations »/);
    expect(m).toMatch(/Aucune date n’a été déplacée/);
  });
});

describe('historique', () => {
  it('libellés avec différentiel, colonnes nommées', () => {
    const cols = new Map([
      ['todo', 'À faire'],
      ['doing', 'En cours'],
    ]);
    expect(
      libelleActivite(
        { actor: KEVIN, kind: 'task.moved', data: { from: 'todo', to: 'doing' } },
        cols,
      ),
    ).toBe('Kevin Mbala a déplacé la tâche (À faire → En cours)');
    expect(libelleActivite({ actor: KEVIN, kind: 'comment.added', data: {} })).toBe(
      'Kevin Mbala a commenté',
    );
  });
  it('filtre par tâche', () => {
    const base = {
      id: 'x',
      projectId: 'p',
      actor: KEVIN,
      kind: 'task.created' as const,
      data: {},
      at: '',
    };
    expect(
      activiteDeTache(
        [
          { ...base, taskId: 't1' },
          { ...base, taskId: null },
        ],
        't1',
      ),
    ).toHaveLength(1);
  });
});
