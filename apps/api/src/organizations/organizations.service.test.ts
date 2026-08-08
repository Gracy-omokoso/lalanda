// Non-régression du choix de l'organisation primaire (ADR-0012 §7, « piège découvert »).
//
// Le bug : `findPrimaryOrgForUser` triait par `.sort({ role: -1, createdAt: 1 })`.
// Ce n'était pas un tri par PRIVILÈGE, mais l'exploitation d'un accident — sur les
// deux seules valeurs d'alors, `'owner' > 'member'` en ordre ALPHABÉTIQUE. Avec
// les huit slugs de docs/12, `'viewer' > 'project_manager' > 'owner'` : un
// utilisateur propriétaire d'une organisation et lecteur d'une autre aurait
// basculé sur la mauvaise, silencieusement, sans aucune erreur visible.
//
// Ces tests n'ont pas besoin de MongoDB : ils substituent des modèles minimaux et
// vérifient uniquement la logique de sélection.

import { describe, expect, it } from 'vitest';

import { ORG_ROLE_RANK, type OrgRole } from '../authz/permissions.js';
import { OrganizationsService } from './organizations.service.js';

interface FauxMembership {
  userId: string;
  organizationId: string;
  role: string;
  canClosePeriods?: boolean;
  createdAt: Date;
}

/**
 * Modèle Mongoose minimal : `find().sort().exec()`.
 *
 * Le `sort({ createdAt: 1 })` est réellement appliqué — c'est important, car la
 * stabilité du tri final en dépend : à rang de privilège égal, c'est la
 * membership la plus ANCIENNE qui doit gagner.
 */
function fauxMembershipModel(docs: FauxMembership[]): unknown {
  return {
    find: (filtre: { userId: string }) => ({
      sort: () => ({
        exec: async () =>
          docs
            .filter((d) => d.userId === filtre.userId)
            .slice()
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      }),
    }),
  };
}

function fauxOrgModel(orgs: Array<{ _id: string; name: string }>): unknown {
  return {
    findById: (id: string) => ({
      exec: async () => orgs.find((o) => o._id === id) ?? null,
    }),
  };
}

function service(memberships: FauxMembership[], orgs: Array<{ _id: string; name: string }>) {
  return new OrganizationsService(
    fauxOrgModel(orgs) as never,
    fauxMembershipModel(memberships) as never,
  );
}

const ORG_A = { _id: 'org-a', name: 'Organisation A' };
const ORG_B = { _id: 'org-b', name: 'Organisation B' };

function membership(
  organizationId: string,
  role: OrgRole | string,
  createdAt: Date,
): FauxMembership {
  return { userId: 'u1', organizationId, role, createdAt };
}

describe("organisation primaire — le rôle le plus privilégié l'emporte", () => {
  it('propriétaire de A, lecteur de B → atterrit sur A (cas exact du bug)', async () => {
    // `'viewer' > 'owner'` en ordre alphabétique : l'ancien tri aurait renvoyé B.
    const svc = service(
      [
        membership('org-a', 'owner', new Date('2026-01-01')),
        membership('org-b', 'viewer', new Date('2026-02-01')),
      ],
      [ORG_A, ORG_B],
    );
    const org = await svc.findPrimaryOrgForUser('u1');
    expect(org?.name).toBe('Organisation A');
  });

  it('propriétaire de A, lecteur de B — même quand B a été créée EN PREMIER', async () => {
    // Prouve que c'est bien le rang qui décide, et non l'ancienneté.
    const svc = service(
      [
        membership('org-b', 'viewer', new Date('2026-01-01')),
        membership('org-a', 'owner', new Date('2026-06-01')),
      ],
      [ORG_A, ORG_B],
    );
    const org = await svc.findPrimaryOrgForUser('u1');
    expect(org?.name).toBe('Organisation A');
  });

  it('propriétaire de A, chef de projet de B → atterrit sur A', async () => {
    // `'project_manager' > 'owner'` alphabétiquement : second cas nommé par le CTO.
    const svc = service(
      [
        membership('org-b', 'project_manager', new Date('2026-01-01')),
        membership('org-a', 'owner', new Date('2026-02-01')),
      ],
      [ORG_A, ORG_B],
    );
    expect((await svc.findPrimaryOrgForUser('u1'))?.name).toBe('Organisation A');
  });

  it("le tri alphabétique se serait bien trompé — démonstration du bug d'origine", () => {
    // Rend le bug explicite plutôt que de le décrire seulement en commentaire.
    const roles = ['owner', 'viewer', 'project_manager', 'finance_director'];
    const alphabetiqueDescendant = [...roles].sort().reverse()[0];
    expect(alphabetiqueDescendant).toBe('viewer'); // …et non `owner`.

    const parRang = [...roles].sort(
      (a, b) => ORG_ROLE_RANK[a as OrgRole] - ORG_ROLE_RANK[b as OrgRole],
    )[0];
    expect(parRang).toBe('owner');
  });

  it('teste tous les rôles subalternes face à un propriétaire', async () => {
    for (const subalterne of [
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'project_manager',
      'advisor',
      'viewer',
    ] as const) {
      const svc = service(
        [
          membership('org-b', subalterne, new Date('2026-01-01')),
          membership('org-a', 'owner', new Date('2026-02-01')),
        ],
        [ORG_A, ORG_B],
      );
      const org = await svc.findPrimaryOrgForUser('u1');
      expect(org?.name, `owner de A vs ${subalterne} de B`).toBe('Organisation A');
    }
  });

  it('à rang ÉGAL, la membership la plus ancienne gagne', async () => {
    const svc = service(
      [
        membership('org-a', 'admin', new Date('2026-01-01')),
        membership('org-b', 'admin', new Date('2026-02-01')),
      ],
      [ORG_A, ORG_B],
    );
    expect((await svc.findPrimaryOrgForUser('u1'))?.name).toBe('Organisation A');
  });

  it('un ancien rôle `member` non migré est traité comme `finance_director`', async () => {
    // Compatibilité N-1 : l'API peut tourner avant la migration.
    const svc = service(
      [
        membership('org-b', 'member', new Date('2026-01-01')),
        membership('org-a', 'owner', new Date('2026-02-01')),
      ],
      [ORG_A, ORG_B],
    );
    expect((await svc.findPrimaryOrgForUser('u1'))?.name).toBe('Organisation A');
  });

  it('un rôle INCONNU ne gagne jamais le tri', async () => {
    // Un document corrompu ou écrit par une version future ne doit pas détourner
    // l'utilisateur de son organisation principale.
    const svc = service(
      [
        membership('org-b', 'roi_du_monde', new Date('2026-01-01')),
        membership('org-a', 'viewer', new Date('2026-02-01')),
      ],
      [ORG_A, ORG_B],
    );
    expect((await svc.findPrimaryOrgForUser('u1'))?.name).toBe('Organisation A');
  });

  it('sans aucune membership, retourne null', async () => {
    const svc = service([], [ORG_A]);
    expect(await svc.findPrimaryOrgForUser('u1')).toBeNull();
  });

  it('une seule membership : elle est retenue quel que soit le rôle', async () => {
    const svc = service([membership('org-b', 'viewer', new Date('2026-01-01'))], [ORG_A, ORG_B]);
    expect((await svc.findPrimaryOrgForUser('u1'))?.name).toBe('Organisation B');
  });
});
