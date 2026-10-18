// Paramètre `session` du journal d'audit (ADR-0021 §9).
//
// Ce que ce test protège : l'ajout est COMPATIBLE. Sans session, l'écriture garde
// la forme `create(doc)` d'avant ; avec une session, elle prend la forme tableau
// `create([doc], { session })`, la seule que Mongoose rattache à la transaction.
// Une régression silencieuse (forme objet + options) écrirait la trace HORS de la
// transaction — exactement le défaut que le paramètre doit empêcher.

import type { ClientSession, Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import type { AuditEventDocument } from './audit-event.schema.js';
import { AuditService, type AuditRecordInput } from './audit.service.js';

const ENTREE: AuditRecordInput = {
  organizationId: 'org-1',
  actorUserId: 'user-1',
  actorRole: 'owner',
  action: 'normalized_invoicing.disabled',
  targetType: 'normalized_invoicing_settings',
  targetId: 'org-1',
  metadata: { environment: 'test' },
};

function harnais(create: (...args: unknown[]) => Promise<unknown>) {
  const spy = vi.fn(create);
  const model = { create: spy } as unknown as Model<AuditEventDocument>;
  return { service: new AuditService(model), spy };
}

describe('AuditService — option session (ADR-0021 §9)', () => {
  it('sans session : appel inchangé, un seul argument objet', async () => {
    const { service, spy } = harnais(async () => ({}));
    await service.recordStrict(ENTREE);
    await service.record(ENTREE);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const appel of spy.mock.calls) {
      expect(appel).toHaveLength(1);
      expect(appel[0]).toMatchObject({ action: ENTREE.action, _schemaVersion: 1 });
    }
  });

  it('avec session : forme tableau et session transmise, pour les deux variantes', async () => {
    const { service, spy } = harnais(async () => []);
    const session = { id: 'session-factice' } as unknown as ClientSession;
    await service.recordStrict(ENTREE, { session });
    await service.record(ENTREE, { session });
    expect(spy).toHaveBeenCalledTimes(2);
    for (const appel of spy.mock.calls) {
      expect(Array.isArray(appel[0])).toBe(true);
      expect((appel[0] as unknown[])[0]).toMatchObject({ organizationId: 'org-1' });
      expect(appel[1]).toEqual({ session });
    }
  });

  it('recordStrict propage l’échec, record l’avale — avec ou sans session', async () => {
    const { service } = harnais(async () => {
      throw new Error('écriture refusée');
    });
    const session = {} as ClientSession;
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(service.recordStrict(ENTREE, { session })).rejects.toThrow('écriture refusée');
    await expect(service.record(ENTREE, { session })).resolves.toBeUndefined();
    expect(erreurs).toHaveBeenCalledTimes(1);
    erreurs.mockRestore();
  });
});
