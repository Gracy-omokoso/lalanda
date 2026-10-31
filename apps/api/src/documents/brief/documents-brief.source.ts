// Fournisseur réel du port `DOCUMENTS_SOURCE` du brief du matin — ADR-0046 § 6.6.
// ADR-0046 — S7.
//
// LECTURE SEULE, organisation de la session. Compte les documents actifs que le MEMBRE
// PEUT LIRE (droits des dossiers jugés sur ses droits EFFECTIFS et sur sa personne,
// règle de `LibraryDocumentsService.deadlines`, la même que l'écran « Échéances ») et
// qui ont expiré ou expirent sous leur délai de rappel. Rend UN NOMBRE : ni titre, ni
// nature, ni dossier ne sortent d'ici (l'IA du brief n'en reçoit jamais).

import type { BriefDocumentsInput } from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';

import type { Action, OrgRole } from '../../authz/permissions.js';
import type { DocumentsSource } from '../../morning-brief/morning-brief.ports.js';
import { documentsActorFrom } from '../document-access.js';
import { LibraryDocumentsService } from '../library-documents.service.js';

@Injectable()
export class DocumentsBriefSource implements DocumentsSource {
  constructor(@Inject(LibraryDocumentsService) private readonly library: LibraryDocumentsService) {}

  async documentsOf(
    organizationId: string,
    userId: string,
    role: OrgRole,
    actions: readonly string[],
    now: Date,
  ): Promise<BriefDocumentsInput> {
    const actor = documentsActorFrom(userId, role, actions as readonly Action[]);
    const list = await this.library.deadlines(organizationId, actor, {}, now);
    return { status: 'known', expiringCount: list.items.length };
  }
}
