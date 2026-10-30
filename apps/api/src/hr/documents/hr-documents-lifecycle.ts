// Fournisseur réel du point d'extension `HR_DOCUMENTS_LIFECYCLE` (posé par H3 dans
// `lifecycle/hr-lifecycle.ts`) — ADR-0045 § 2.8, § 3.1. ADR-0045 — H4.
//
// Anonymisation : les documents SENSIBLES du collaborateur sont effacés dans la
// transaction de l'anonymisation (suppression logique et clé enveloppée effacée :
// l'objet chiffré devient illisible à jamais), puis leurs objets sont effacés du
// stockage au mieux. Les documents non sensibles (contrat, diplôme) restent, rattachés
// à la fiche anonymisée.
//
// Sortie : rien n'est effacé ni créé seul. La liste de départ est PROPOSÉE (la sortie
// rend `offboardingSuggested`) ; l'accès à Lalanda n'est pas retiré (décision ouverte
// n° 13). Aucune durée de conservation n'est appliquée ici (`hr.retention`, éteinte).

import { Inject, Injectable } from '@nestjs/common';

import type { HrEmployeeLifecycleEvent } from '../employees/hr-employee-lifecycle.port.js';
import type { HrDocumentsLifecycle } from '../lifecycle/hr-lifecycle.js';
import { HrDocumentsService } from './hr-documents.service.js';

@Injectable()
export class HrDocumentsLifecycleService implements HrDocumentsLifecycle {
  constructor(@Inject(HrDocumentsService) private readonly documents: HrDocumentsService) {}

  async onAnonymize(event: HrEmployeeLifecycleEvent): Promise<void> {
    const objectIds = await this.documents.eraseSensitive(
      event.organizationId,
      event.employeeId,
      event.actorUserId,
      event.session,
    );
    if (objectIds.length === 0) return;
    // Après la validation de la transaction : un abandon laisse les objets intacts
    // (et leurs clés), une validation les efface. La clé étant effacée en base,
    // un objet resté au stockage par panne est déjà illisible.
    const session = event.session as unknown as {
      transaction?: { isCommitted?: boolean };
      once?: (e: string, cb: () => void) => void;
    };
    if (typeof session.once === 'function') {
      session.once('ended', () => {
        if (session.transaction?.isCommitted === true) void this.documents.drop(objectIds);
      });
    } else {
      await this.documents.drop(objectIds);
    }
  }
}
