// Tests du modèle de la grille des autorisations (ADR-0041 § 7, critère 18).
//
// Le catalogue ci-dessous est une DONNÉE DE TEST qui reprend la forme de
// `GET /authz/catalog` (domaines, dépendances, paires, lignes de quelques titres).
// L'application, elle, ne lit jamais que la réponse de l'API.

import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';
import type { CatalogueAutorisations } from '@/lib/api-permissions';

import {
  avertissementChangementTitre,
  basculer,
  compteDomaine,
  construireGrille,
  ecartAEnvoyer,
  ecartAffiche,
  etatDe,
  exigences,
  ligneDuTitre,
  messageAutorisations,
  personnalisationDesactivee,
  phraseEcart,
  raisonIndisponible,
  verrouFiche,
  type ParametresGrille,
} from './permissions-model';

const DOMAINES: CatalogueAutorisations['domains'] = [
  {
    key: 'organization',
    label: 'Organisation et équipe',
    actions: ['organization.manage', 'members.invite', 'billing.manage', 'audit.read'],
  },
  {
    key: 'plan',
    label: 'Initiatives et plan financier',
    actions: [
      'project.read',
      'project.create',
      'project.update',
      'canvas.update',
      'inputs.update',
      'plan.calculate',
      'plan.approve',
    ],
  },
  {
    key: 'actuals',
    label: 'Réalisé et rapports',
    actions: ['analytics.read', 'actuals.import', 'period.close', 'report.export'],
  },
  {
    key: 'sales',
    label: 'Ventes et facturation',
    actions: [
      'sales.read',
      'sales.manage',
      'sales.quote',
      'sales.invoice',
      'sales.receipt',
      'fiscal.manage',
    ],
  },
  { key: 'treasury', label: 'Trésorerie', actions: ['treasury.read', 'treasury.manage'] },
  { key: 'crm', label: 'CRM', actions: ['crm.read', 'crm.manage'] },
  { key: 'work', label: 'Projets et tâches', actions: ['work.read', 'work.update', 'work.manage'] },
];

const TOUTES = DOMAINES.flatMap((d) => d.actions);
const LIBELLES = Object.fromEntries(TOUTES.map((a) => [a, a])) as Record<OrgAction, string>;
LIBELLES['sales.read'] = 'Consulter clients, catalogue, devis, factures et encaissements';
LIBELLES['sales.manage'] = 'Gérer les clients, le catalogue et les brouillons de facture';
LIBELLES['sales.invoice'] = 'Émettre et normaliser les factures et les avoirs';
LIBELLES['work.manage'] = 'Gérer les projets';
LIBELLES['plan.approve'] = 'Valider un plan';
LIBELLES['period.close'] = 'Clôturer une période';
LIBELLES['treasury.read'] = 'Consulter les dépenses, les comptes et la prévision de trésorerie';

const CATALOGUE: CatalogueAutorisations = {
  domains: DOMAINES,
  labels: LIBELLES,
  dependencies: {
    'project.create': ['project.read'],
    'project.update': ['project.read'],
    'canvas.update': ['project.read'],
    'inputs.update': ['project.read'],
    'plan.calculate': ['project.read'],
    'actuals.import': ['project.read'],
    'period.close': ['project.read'],
    'plan.approve': ['project.read'],
    'report.export': ['project.read', 'analytics.read'],
    'sales.manage': ['sales.read'],
    'sales.quote': ['sales.read'],
    'sales.receipt': ['sales.read'],
    'sales.invoice': ['sales.manage'],
    'treasury.manage': ['treasury.read'],
    'crm.manage': ['crm.read'],
    'work.update': ['work.read'],
    'work.manage': ['work.update'],
  },
  baseAction: 'analytics.read',
  sodPairs: [
    ['inputs.update', 'plan.approve'],
    ['period.close', 'plan.approve'],
  ],
  nonDelegable: ['billing.manage'],
  roleMatrix: [
    {
      role: 'accountant',
      label: 'Comptable',
      description: '',
      actions: [
        'project.read',
        'analytics.read',
        'actuals.import',
        'report.export',
        'sales.read',
        'sales.manage',
        'sales.invoice',
        'sales.receipt',
        'treasury.read',
        'treasury.manage',
        'work.read',
        'work.update',
      ],
      conditional: ['period.close'],
    },
    {
      role: 'analyst',
      label: 'Analyste',
      description: '',
      actions: ['project.read', 'inputs.update', 'plan.calculate', 'analytics.read'],
      conditional: [],
    },
    {
      role: 'viewer',
      label: 'Lecteur',
      description: '',
      actions: ['project.read', 'analytics.read', 'sales.read', 'crm.read', 'work.read'],
      conditional: [],
    },
    {
      role: 'sales_rep',
      label: 'Commercial',
      description: '',
      actions: ['analytics.read', 'sales.read', 'sales.quote', 'crm.read', 'crm.manage'],
      conditional: [],
    },
  ],
};

/** Le Propriétaire : tout, sauf le non délégable dans ce qu'il peut ajouter. */
const AJOUTABLES_PROPRIETAIRE = TOUTES.filter((a) => a !== 'billing.manage');

function parametres(
  role: 'accountant' | 'analyst' | 'viewer' | 'sales_rep',
  surcharge: Partial<ParametresGrille> = {},
): ParametresGrille {
  const ligne = ligneDuTitre(CATALOGUE, role);
  return {
    catalogue: CATALOGUE,
    base: ligne.base,
    conditionnelles: ligne.conditionnelles,
    selection: new Set(ligne.base),
    contexte: 'membre',
    ajoutables: AJOUTABLES_PROPRIETAIRE,
    verrou: null,
    ...surcharge,
  };
}

function erreur(detail: unknown): Error & { status: number; detail: unknown } {
  const e = new Error('x') as Error & { status: number; detail: unknown };
  e.status = 400;
  e.detail = detail;
  return e;
}

describe('les quatre états lisibles sans couleur', () => {
  const base: OrgAction[] = ['sales.read', 'sales.invoice'];
  const sel = new Set<OrgAction>(['sales.read', 'work.manage']);

  it('distingue inclus, ajouté, retiré et non inclus', () => {
    expect(etatDe(base, sel, 'sales.read')).toBe('titre');
    expect(etatDe(base, sel, 'work.manage')).toBe('ajoute');
    expect(etatDe(base, sel, 'sales.invoice')).toBe('retire');
    expect(etatDe(base, sel, 'crm.read')).toBe('non_inclus');
  });

  it('regroupe par domaine avec son compte', () => {
    const grille = construireGrille(parametres('accountant'));
    expect(grille.map((d) => d.cle)).toEqual(DOMAINES.map((d) => d.key));
    const ventes = grille.find((d) => d.cle === 'sales')!;
    expect(compteDomaine(ventes)).toBe('Ventes et facturation : 4 sur 6');
    expect(grille.flatMap((d) => d.lignes)).toHaveLength(28);
  });
});

describe('raisons d’indisponibilité', () => {
  it('G3 — le non délégable est réservé au Propriétaire', () => {
    expect(raisonIndisponible(parametres('viewer'), 'billing.manage')).toBe(
      'Réservé au Propriétaire.',
    );
  });

  it('G1 — on n’ajoute pas ce qu’on ne détient pas', () => {
    const p = parametres('viewer', { ajoutables: ['crm.read', 'crm.manage', 'analytics.read'] });
    expect(raisonIndisponible(p, 'sales.invoice')).toBe('Vous ne détenez pas cette autorisation.');
    expect(raisonIndisponible(p, 'crm.manage')).toBeNull();
  });

  it('G1 — une dépendance non détenue rend l’ajout impossible', () => {
    const p = parametres('sales_rep', {
      ajoutables: ['treasury.manage', 'analytics.read'],
    });
    expect(raisonIndisponible(p, 'treasury.manage')).toMatch(/^Exige « Consulter les dépenses/u);
  });

  it('G4 — la paire saisie + validation est refusée à l’Analyste', () => {
    expect(raisonIndisponible(parametres('analyst'), 'plan.approve')).toBe(
      'Incompatible avec « inputs.update » — séparation des tâches.',
    );
  });

  it('G4 — le Comptable, clôture potentielle comptée, ne reçoit pas la validation', () => {
    expect(raisonIndisponible(parametres('accountant'), 'plan.approve')).toBe(
      'Incompatible avec « Clôturer une période » — séparation des tâches.',
    );
  });

  it('décision n° 3 refusée — émission et fiscalité se cumulent', () => {
    expect(raisonIndisponible(parametres('accountant'), 'fiscal.manage')).toBeNull();
  });

  it('décision n° 4 — le socle ne se retire pas tant qu’autre chose est coché', () => {
    expect(raisonIndisponible(parametres('viewer'), 'analytics.read')).toMatch(/^Socle/u);
    const seul = parametres('viewer', { selection: new Set<OrgAction>(['analytics.read']) });
    expect(raisonIndisponible(seul, 'analytics.read')).toBeNull();
  });

  it('la case ⚙ ne s’accorde pas à l’invitation', () => {
    const p = parametres('accountant', { contexte: 'invitation' });
    expect(raisonIndisponible(p, 'period.close')).toMatch(/une fois l’invitation acceptée/u);
    expect(raisonIndisponible(parametres('accountant'), 'period.close')).toBeNull();
  });

  it('un verrou de fiche vaut pour toutes les cases', () => {
    const p = parametres('viewer', { verrou: 'Verrouillé.' });
    expect(
      construireGrille(p)
        .flatMap((d) => d.lignes)
        .every((l) => l.raison === 'Verrouillé.'),
    ).toBe(true);
  });
});

describe('verrou de la fiche', () => {
  const membre = { userId: 'u2', role: 'accountant' as const, manageable: true };

  it('G2, G3, G1 et interrupteur éteint', () => {
    expect(verrouFiche(membre, 'u1', false)).toBeNull();
    expect(verrouFiche(membre, 'u2', false)).toMatch(/vos propres autorisations/u);
    expect(verrouFiche({ ...membre, role: 'owner' }, 'u1', false)).toMatch(/Propriétaire/u);
    expect(verrouFiche({ ...membre, manageable: false }, 'u1', false)).toMatch(
      /que vous n’avez pas/u,
    );
    expect(verrouFiche(membre, 'u1', true)).toMatch(/bientôt disponible/u);
  });
});

describe('dépendances cochées et décochées avec message', () => {
  it('calcule les exigences transitives et le socle', () => {
    expect(exigences(CATALOGUE, 'sales.invoice')).toEqual([
      'analytics.read',
      'sales.read',
      'sales.manage',
    ]);
    expect(exigences(CATALOGUE, 'analytics.read')).toEqual([]);
  });

  it('cocher coche ce qui est exigé', () => {
    const p = parametres('sales_rep');
    const r = basculer(p, 'sales.invoice');
    expect(r.selection.has('sales.manage')).toBe(true);
    expect(r.selection.has('sales.invoice')).toBe(true);
    expect(r.message).toBe(
      '« Émettre et normaliser les factures et les avoirs » exige « Gérer les clients, le catalogue et les brouillons de facture » : cochée aussi.',
    );
  });

  it('décocher décoche ce qui en dépend', () => {
    const p = parametres('accountant');
    const r = basculer(p, 'sales.read');
    for (const a of ['sales.read', 'sales.manage', 'sales.invoice', 'sales.receipt'] as const) {
      expect(r.selection.has(a)).toBe(false);
    }
    expect(r.message).toMatch(/en dépendent et ont été décochées aussi\.$/u);
  });

  it('sans dépendance, pas de message ; une case indisponible ne bouge pas', () => {
    const p = parametres('viewer');
    expect(basculer(p, 'audit.read').message).toBeNull();
    const r = basculer(p, 'billing.manage');
    expect(r.selection.has('billing.manage')).toBe(false);
  });
});

describe('écart et phrase d’écart', () => {
  it('« Comptable, personnalisé : + …, − … »', () => {
    const p = parametres('accountant');
    let r = basculer(p, 'work.manage');
    r = basculer({ ...p, selection: r.selection }, 'sales.invoice');
    const ecart = ecartAffiche(CATALOGUE, p.base, r.selection);
    expect(ecart).toEqual({ grants: ['work.manage'], revokes: ['sales.invoice'] });
    expect(phraseEcart(CATALOGUE, 'Comptable', p.base, ecart)).toBe(
      'Comptable, personnalisé : + Gérer les projets, − Émettre et normaliser les factures et les avoirs',
    );
  });

  it('sans écart, le titre et son nombre d’autorisations', () => {
    const p = parametres('accountant');
    expect(phraseEcart(CATALOGUE, 'Comptable', p.base, { grants: [], revokes: [] })).toBe(
      'Comptable — 12 autorisations, celles du titre.',
    );
  });

  it('la case ⚙ passe par l’ajout, et par le retrait seulement si elle était accordée', () => {
    const ligne = ligneDuTitre(CATALOGUE, 'accountant');
    const avec = new Set<OrgAction>([...ligne.base, 'period.close']);
    expect(ecartAEnvoyer(CATALOGUE, ligne, avec, false).grants).toEqual(['period.close']);
    const sans = new Set<OrgAction>(ligne.base);
    expect(ecartAEnvoyer(CATALOGUE, ligne, sans, true).revokes).toEqual(['period.close']);
    expect(ecartAEnvoyer(CATALOGUE, ligne, sans, false).revokes).toEqual([]);
  });

  it('reconstitue la ligne d’un titre absent du catalogue depuis le membre', () => {
    const ligne = ligneDuTitre(CATALOGUE, 'owner', {
      effective: ['project.read', 'analytics.read'],
      grants: [],
      revokes: [],
      canClosePeriods: false,
    });
    expect(ligne.base).toEqual(['project.read', 'analytics.read']);
  });

  it('avertit avant un changement de titre qui efface l’écart (décision n° 1)', () => {
    expect(avertissementChangementTitre({ grants: [], revokes: [] })).toBeNull();
    expect(
      avertissementChangementTitre({
        grants: ['work.manage', 'crm.read'],
        revokes: ['sales.invoice'],
      }),
    ).toBe(
      'Les 2 ajouts et 1 retrait de cette personne seront effacés : elle repartira des autorisations du nouveau titre.',
    );
  });
});

describe('interrupteur et messages d’erreur', () => {
  it('détecte l’interrupteur éteint par le 409 ou par un drapeau explicite', () => {
    expect(
      personnalisationDesactivee({ erreur: erreur({ code: 'MEMBER_PERMISSIONS_DISABLED' }) }),
    ).toBe(true);
    expect(personnalisationDesactivee({ erreur: erreur({ code: 'STALE_REVISION' }) })).toBe(false);
    expect(personnalisationDesactivee({ catalogue: { memberPermissionsEnabled: false } })).toBe(
      true,
    );
    expect(personnalisationDesactivee({ catalogue: {}, moi: {} })).toBe(false);
  });

  it('donne un message clair pour chaque code', () => {
    const codes = [
      'MEMBER_PERMISSIONS_DISABLED',
      'STALE_REVISION',
      'PERMISSION_ESCALATION',
      'SELF_PERMISSIONS_FORBIDDEN',
      'PERMISSION_NOT_DELEGABLE',
      'PERMISSION_OVERRIDE_REDUNDANT',
      'PERMISSION_DEPENDENCY_MISSING',
      'SOD_CONFLICT',
      'OWNER_PERMISSIONS_FIXED',
      'MEMBER_NOT_FOUND',
      'INVITATION_INVITER_NO_LONGER_AUTHORIZED',
    ];
    for (const code of codes) {
      const m = messageAutorisations(erreur({ code, message: 'brut' }), CATALOGUE, 'repli');
      expect(m, code).not.toBe('brut');
      expect(m, code).not.toBe('repli');
    }
  });

  it('nomme les autorisations en cause', () => {
    expect(
      messageAutorisations(
        erreur({
          code: 'PERMISSION_DEPENDENCY_MISSING',
          action: 'sales.manage',
          missing: ['sales.read'],
        }),
        CATALOGUE,
        '',
      ),
    ).toBe(
      '« Gérer les clients, le catalogue et les brouillons de facture » exige « Consulter clients, catalogue, devis, factures et encaissements ».',
    );
    expect(
      messageAutorisations(
        erreur({ code: 'SOD_CONFLICT', pair: ['period.close', 'plan.approve'] }),
        CATALOGUE,
        '',
      ),
    ).toBe(
      '« Clôturer une période » et « Valider un plan » ne peuvent pas être détenues ensemble : séparation des tâches.',
    );
  });
});
