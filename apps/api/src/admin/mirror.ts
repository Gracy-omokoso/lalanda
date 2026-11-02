// ─────────────────────────────────────────────────────────────────────────────
// MIROIR PSEUDONYME D'UN GESTE PLATEFORME (ADR-0053 § 2.5, O3-c — lot P2)
//
// Un geste d'opérateur qui touche une organisation (suspension, rétablissement,
// changement d'offre, blocage d'un de ses membres) s'écrit DEUX fois :
//
//   1. dans le journal PLATEFORME (`PlatformAuditService`, portée `platform`), avec
//      l'acteur réel, ses rôles réellement détenus et la note interne ;
//   2. dans le journal de l'ORGANISATION touchée, ici, avec l'acteur pseudonyme
//      `platform:lalanda` (« Équipe Lalanda »), le seul message destiné au client et
//      la référence de l'événement plateforme.
//
// Ce que le miroir ne porte JAMAIS : l'identifiant de l'opérateur (ni un suffixe), son
// rôle plateforme, la note interne (fuite F3). Le type `PlatformMirrorInput` ne laisse
// aucune place pour eux : il n'y a pas de champ où les glisser par mégarde.
// ─────────────────────────────────────────────────────────────────────────────

import { Inject, Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';

import { PLATFORM_MIRROR_ACTOR_ID, PLATFORM_MIRROR_ACTOR_ROLE } from '@lalanda/shared/platform';

import { AuditService } from '../authz/audit.service.js';

/** Référence commune à l'événement plateforme et à son miroir (24 hexadécimaux). */
export function newPlatformEventRef(): string {
  return new ObjectId().toHexString();
}

export interface PlatformMirrorInput {
  /** Organisation dont le journal reçoit le miroir. */
  readonly organizationId: string;
  /** Action côté client, préfixée `platform.` (ex. `platform.organization.suspended`). */
  readonly action: string;
  readonly targetType: 'organization' | 'user';
  readonly targetId: string;
  /** Référence de l'événement plateforme correspondant. */
  readonly platformEventRef: string;
  /** Message destiné au client, s'il y en a un. Jamais la note interne. */
  readonly clientMessage?: string | null;
  /** Geste accompli par le seul détenteur de l'action, marqué (§ 2.6). */
  readonly soleOperator?: boolean;
  /** Faits non nominatifs supplémentaires (offre avant et après, mode de suspension). */
  readonly facts?: Readonly<Record<string, string | null>>;
}

@Injectable()
export class PlatformMirrorService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Écriture STRICTE : un miroir perdu est un geste invisible pour le client. */
  async mirror(input: PlatformMirrorInput): Promise<void> {
    await this.audit.recordStrict({
      organizationId: input.organizationId,
      actorUserId: PLATFORM_MIRROR_ACTOR_ID,
      actorRole: PLATFORM_MIRROR_ACTOR_ROLE,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: {
        ...(input.facts ?? {}),
        clientMessage: input.clientMessage ?? null,
        platformEventRef: input.platformEventRef,
        soleOperator: input.soleOperator === true,
      },
    });
  }
}
