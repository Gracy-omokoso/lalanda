// ─────────────────────────────────────────────────────────────────────────────
// PORTE MFA — la seule question que `PermissionsGuard` pose au module MFA :
// « cet utilisateur, sur CETTE session, a-t-il satisfait son second facteur ? »
//
// ── Pourquoi un service séparé de `MfaService` ────────────────────────────────
//
// Pour que le graphe de modules reste acyclique. `AuthzModule` importe
// `MfaModule` (le garde a besoin de la porte) ; si la porte vivait dans le
// service qui gère l'enrôlement, elle traînerait avec elle le trousseau de clés,
// better-auth et `AuthzService` — dont `MfaModule` a besoin, et qui vient
// d'`AuthzModule`. Le cycle se refermerait, et Nest le signalerait par une
// injection `undefined` au démarrage, c'est-à-dire de la façon la plus obscure
// possible.
//
// Ce service ne dépend donc que d'un modèle Mongoose et ne DÉCIDE rien : il
// constate. La décision — « ce rôle exige-t-il un facteur ? » — appartient à
// `permissions.ts` (ADR-0012 §8).
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { sessionFingerprint } from '../auth/session-fingerprint.js';
import { MfaCredential, type MfaCredentialDocument } from './mfa-credential.schema.js';
import { MfaVerification, type MfaVerificationDocument } from './mfa-verification.schema.js';

/**
 * État du second facteur pour une requête donnée.
 *
 * Trois valeurs et non un booléen, parce que les deux façons d'échouer appellent
 * deux réponses différentes de l'interface : « installez une application
 * d'authentification » n'est pas « saisissez votre code ». Un booléen forcerait
 * l'appelant à refaire la distinction, donc à relire la base, donc à écrire une
 * seconde fois la règle.
 */
export type MfaGateState =
  /** Facteur actif ET prouvé sur cette session. */
  | 'satisfied'
  /** Aucun facteur actif : il faut s'enrôler. */
  | 'enrollment_required'
  /** Facteur actif mais cette session ne l'a pas (encore) présenté. */
  | 'step_up_required';

@Injectable()
export class MfaGateService {
  constructor(
    @InjectModel(MfaCredential.name)
    private readonly credentials: Model<MfaCredentialDocument>,
    @InjectModel(MfaVerification.name)
    private readonly verifications: Model<MfaVerificationDocument>,
  ) {}

  /**
   * État du second facteur pour (utilisateur, session).
   *
   * ── Ordre des deux lectures ─────────────────────────────────────────────────
   *
   * Le facteur est cherché EN PREMIER. Sans cet ordre, un utilisateur ayant
   * désactivé son MFA tout en gardant une preuve de session encore valide
   * passerait la porte : la preuve survivrait au facteur qu'elle atteste. La
   * désactivation supprime les deux (voir `MfaService.disable`), mais un garde
   * qui ne tiendrait que par la propreté d'un autre code n'est pas un garde.
   *
   * ── Pourquoi `status: 'active'` et non la seule existence du document ───────
   *
   * Un enrôlement commencé puis abandonné laisse un document `pending`. Le
   * traiter comme un facteur ouvrirait la porte à quelqu'un qui n'a jamais
   * scanné le QR code — et le traiter comme une absence, ce qui est le cas ici,
   * le renvoie simplement vers l'enrôlement.
   */
  async stateOf(userId: string, cookieHeader: string | undefined): Promise<MfaGateState> {
    const credential = await this.credentials
      .findOne({ userId, status: 'active' })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (!credential) return 'enrollment_required';

    // `null` (aucun cookie de session) ne cherche RIEN et refuse : sans session
    // identifiable, aucune preuve ne peut être liée. Passer `null` au filtre
    // Mongo ferait correspondre les documents dont le champ est absent.
    const fingerprint = sessionFingerprint(cookieHeader);
    if (!fingerprint) return 'step_up_required';

    const proof = await this.verifications
      .findOne({
        userId,
        sessionFingerprint: fingerprint,
        // Le filtre sur `expiresAt` est LE contrôle. L'index TTL de la
        // collection ne balaie qu'une fois par minute au mieux : s'y fier
        // prolongerait chaque fenêtre d'un délai que personne ne maîtrise.
        expiresAt: { $gt: new Date() },
      })
      .select({ _id: 1 })
      .lean()
      .exec();

    return proof ? 'satisfied' : 'step_up_required';
  }
}
