import { describe, expect, it } from 'vitest';

import type { WorkProjectRights } from '@lalanda/shared/work';

import type { WorkMemberOption } from '@/lib/work-api';

import {
  abonnesProposes,
  ajouterElement,
  basculerElement,
  collaborateurRetirable,
  collaborateursProposes,
  deplacerElement,
  droitsTache,
  enAttenteDeValidation,
  libelleValidation,
  motifRequis,
  progressionListe,
  retirerElement,
} from './collab-model';
import { responsablesProposes } from './taches-model';

const m = (userId: string, over: Partial<WorkMemberOption> = {}): WorkMemberOption => ({
  userId,
  name: `Membre ${userId}`,
  canUpdate: true,
  canManage: false,
  seesProject: true,
  projectRole: 'member',
  ...over,
});

const membres = [
  m('a'),
  m('b'),
  m('l', { projectRole: 'viewer' }),
  m('h', { seesProject: false }),
  m('r', { canUpdate: false }),
];

describe('collaborateurs et abonnés (ADR-0076 § 2)', () => {
  it('ni Lecteur, ni hors du projet, ni le responsable, ni les collaborateurs déjà là', () => {
    const p = collaborateursProposes(
      membres,
      { assigneeUserId: 'a', collaboratorUserIds: [] },
      { moi: 'b', soiSeulement: false },
    );
    expect(p.map((o) => o.userId)).toEqual(['b']);
  });

  it('Stagiaire : soi seulement, et ne retire que soi', () => {
    const regle = { moi: 'b', soiSeulement: true };
    expect(
      collaborateursProposes(membres, { assigneeUserId: null, collaboratorUserIds: [] }, regle).map(
        (o) => o.userId,
      ),
    ).toEqual(['b']);
    expect(collaborateurRetirable('a', regle)).toBe(false);
    expect(collaborateurRetirable('b', regle)).toBe(true);
  });

  it('le Lecteur n’est pas proposé comme responsable ; il peut être abonné', () => {
    expect(
      responsablesProposes(membres, { moi: 'a', soiSeulement: false }).map((o) => o.userId),
    ).not.toContain('l');
    expect(abonnesProposes(membres, ['a']).map((o) => o.userId)).toEqual(['b', 'l', 'r']);
  });
});

describe('liste de contrôle (ADR-0076 § 4)', () => {
  it('progression « 3/5 », rien sans liste', () => {
    expect(progressionListe({ checklistDone: 3, checklistTotal: 5 })).toEqual({
      texte: '3/5',
      complet: false,
    });
    expect(progressionListe({ checklistDone: 2, checklistTotal: 2 })?.complet).toBe(true);
    expect(progressionListe({})).toBeNull();
  });

  it('ajouter (30 au plus, texte rogné), cocher, retirer, déplacer', () => {
    expect(ajouterElement([], '   ')).toBeNull();
    const un = ajouterElement([], '  Devis signé ')!;
    expect(un).toEqual([{ text: 'Devis signé', done: false }]);
    const plein = Array.from({ length: 30 }, (_, i) => ({ text: `É${i}`, done: false }));
    expect(ajouterElement(plein, 'trop')).toBeNull();
    const deux = [...un, { id: 'x', text: 'Livrer', done: false }];
    expect(basculerElement(deux, 1)[1]!.done).toBe(true);
    expect(retirerElement(deux, 0)).toEqual([{ id: 'x', text: 'Livrer', done: false }]);
    expect(deplacerElement(deux, 1, -1).map((i) => i.text)).toEqual(['Livrer', 'Devis signé']);
    expect(deplacerElement(deux, 0, -1).map((i) => i.text)).toEqual(['Devis signé', 'Livrer']);
  });
});

describe('validation (ADR-0076 § 3)', () => {
  const a = {
    required: true,
    state: 'pending' as const,
    approverUserId: null,
    pendingApproverUserId: 'b',
  };
  it('libellé, pastille « À valider », motif requis', () => {
    expect(libelleValidation(a)).toBe('En attente de validation');
    expect(libelleValidation(null)).toBeNull();
    expect(enAttenteDeValidation({ approval: a })).toBe(true);
    expect(enAttenteDeValidation({ approval: { ...a, state: 'approved' } })).toBe(false);
    expect(motifRequis('approve')).toBe(false);
    expect(motifRequis('reject')).toBe(true);
    expect(motifRequis('request_changes')).toBe(true);
  });
});

describe('droitsTache', () => {
  const projet: WorkProjectRights = {
    role: 'member',
    canManage: false,
    canCreateTasks: true,
    canComment: true,
    canLogTime: true,
    assignable: true,
    hasLead: true,
  };
  const t = { assignee: { userId: 'b', name: 'B' }, collaboratorUserIds: ['a'], createdBy: 'c' };
  it('sans droit d’organisation : rien ; droits du serveur prioritaires', () => {
    expect(droitsTache(t, { moi: 'a', travailler: false, droitsProjet: projet }).canEdit).toBe(
      false,
    );
    const serveur = {
      canEdit: false,
      canComplete: false,
      canCheck: false,
      canSubmit: false,
      canDecide: true,
      canManage: false,
    };
    expect(
      droitsTache(
        { ...t, myRights: serveur },
        { moi: 'a', travailler: true, droitsProjet: projet },
      ),
    ).toEqual(serveur);
  });
  it('repli sur la règle partagée : collaborateur modifie sans terminer', () => {
    const r = droitsTache(t, { moi: 'a', travailler: true, droitsProjet: projet });
    expect(r.canEdit).toBe(true);
    expect(r.canComplete).toBe(false);
    expect(r.canCheck).toBe(true);
  });
});
