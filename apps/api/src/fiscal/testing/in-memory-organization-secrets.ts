// Faux coffre d'organisation EN MÉMOIRE — ADR-0021 §12 (chantier B).
//
// Implémente `OrganizationSecretsPort` pour que le module fiscal se code et se
// teste avant la fusion du vrai coffre (chantier A, `organization-secrets.service.ts`).
// Il n'est PAS chiffré et ne survit pas à un redémarrage : il ne doit jamais
// servir en production (voir `fiscal.module.ts`, qui le remplace alors par un
// coffre « indisponible »).
//
// Fidélité au contrat, sur les points que les tests du module fiscal exercent :
//  - `describe` ne renvoie jamais la valeur, `last4` suit ADR-0013 §4 ;
//  - `resolve` rend un `Secret` dont la sérialisation donne `[redacted]` ;
//  - `session` : une écriture faite DANS une transaction n'est appliquée que si
//    la transaction est validée. Sans cela, une transaction annulée (audit en
//    panne, index unique violé) laisserait ici un jeton orphelin que le vrai
//    coffre, lui, n'aurait jamais écrit.

import type { ClientSession } from 'mongoose';

import type {
  OrganizationSecretDescription,
  OrganizationSecretKind,
  OrganizationSecretRef,
  OrganizationSecretsPort,
} from '../../integrations/organization-secrets.port.js';
import { last4Of, Secret } from '../../integrations/secret-value.js';

interface Stored {
  value: string;
  updatedAt: Date;
  updatedBy: string;
}

type Mutation = { kind: 'put'; stored: Stored } | { kind: 'destroy' };

const ABSENT: OrganizationSecretDescription = {
  configured: false,
  last4: null,
  updatedAt: null,
  updatedBy: null,
};

function keyOf(ref: OrganizationSecretRef): string {
  return `${ref.organizationId}\u0000${ref.kind}\u0000${ref.ownerId}`;
}

export class InMemoryOrganizationSecrets implements OrganizationSecretsPort {
  private readonly store = new Map<string, Stored>();
  private readonly pending = new WeakMap<ClientSession, Map<string, Mutation>>();

  async put(
    ref: OrganizationSecretRef,
    value: string,
    actorUserId: string,
    opts: { session?: ClientSession } = {},
  ): Promise<OrganizationSecretDescription> {
    const stored: Stored = { value, updatedAt: new Date(), updatedBy: actorUserId };
    this.apply(keyOf(ref), { kind: 'put', stored }, opts.session);
    return describeStored(stored);
  }

  async resolve(ref: OrganizationSecretRef): Promise<Secret | null> {
    const stored = this.store.get(keyOf(ref));
    return stored ? new Secret(stored.value) : null;
  }

  async describe(ref: OrganizationSecretRef): Promise<OrganizationSecretDescription> {
    const stored = this.store.get(keyOf(ref));
    return stored ? describeStored(stored) : ABSENT;
  }

  async describeMany(
    organizationId: string,
    kind: OrganizationSecretKind,
    ownerIds: readonly string[],
  ): Promise<Map<string, OrganizationSecretDescription>> {
    const out = new Map<string, OrganizationSecretDescription>();
    for (const ownerId of ownerIds) {
      out.set(ownerId, await this.describe({ organizationId, kind, ownerId }));
    }
    return out;
  }

  async destroy(ref: OrganizationSecretRef, opts: { session?: ClientSession } = {}): Promise<void> {
    this.apply(keyOf(ref), { kind: 'destroy' }, opts.session);
  }

  /** Nombre de secrets détenus — pour vérifier « aucune écriture » dans les tests. */
  size(): number {
    return this.store.size;
  }

  /** Toutes les valeurs — pour les tests anti-fuite uniquement. */
  values(): string[] {
    return [...this.store.values()].map((s) => s.value);
  }

  private apply(key: string, mutation: Mutation, session: ClientSession | undefined): void {
    if (!session) {
      this.commit(key, mutation);
      return;
    }
    let mutations = this.pending.get(session);
    if (!mutations) {
      mutations = new Map();
      this.pending.set(session, mutations);
      const pendingForSession = mutations;
      // `withTransaction` valide puis l'appelant ferme la session : à la fin,
      // on n'applique que ce qu'une transaction VALIDÉE a écrit.
      session.once('ended', () => {
        if (session.transaction.isCommitted) {
          for (const [k, m] of pendingForSession) this.commit(k, m);
        }
        this.pending.delete(session);
      });
    }
    mutations.set(key, mutation);
  }

  private commit(key: string, mutation: Mutation): void {
    if (mutation.kind === 'put') this.store.set(key, mutation.stored);
    else this.store.delete(key);
  }
}

function describeStored(stored: Stored): OrganizationSecretDescription {
  return {
    configured: true,
    last4: last4Of(stored.value),
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
  };
}
