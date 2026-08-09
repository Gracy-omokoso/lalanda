// Enregistrement et lecture de l'acceptation des conditions (S22c).
//
// Le module ne sert pas les TEXTES : ceux-ci sont des pages Next.js statiques,
// versionnées dans le dépôt. Il ne sert que la PREUVE d'acceptation, qui est la
// seule chose qu'une page statique ne peut pas porter.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LEGAL_VERSION, isTermsAcceptanceCurrent } from '@lalanda/shared/legal';
import type { Model } from 'mongoose';

import type { TermsAcceptanceView } from './legal.dto.js';
import { TermsAcceptance, type TermsAcceptanceDocument } from './terms-acceptance.schema.js';

@Injectable()
export class LegalService {
  constructor(
    @InjectModel(TermsAcceptance.name)
    private readonly acceptances: Model<TermsAcceptanceDocument>,
  ) {}

  /**
   * Enregistre l'acceptation d'une version par un utilisateur.
   *
   * IDEMPOTENT PAR CONSTRUCTION. `$setOnInsert` sur un upsert indexé unique :
   * réémettre la même acceptation ne déplace pas `acceptedAt`. C'est délibéré —
   * un double clic sur « Créer mon compte », un rejeu réseau ou un retour arrière
   * du navigateur ne doivent pas réécrire la date qui fait la preuve. La date
   * enregistrée reste celle du PREMIER accord.
   *
   * La version a déjà été vérifiée comme réellement publiée par le DTO. Le
   * propriétaire vient de la session, jamais de la requête.
   */
  async recordAcceptance(userId: string, version: string, now: Date): Promise<TermsAcceptanceView> {
    await this.acceptances.updateOne(
      { userId, termsVersion: version },
      { $setOnInsert: { userId, termsVersion: version, acceptedAt: now, _schemaVersion: 1 } },
      { upsert: true },
    );
    return this.getAcceptance(userId);
  }

  /**
   * État de l'accord d'un utilisateur.
   *
   * On retient la PLUS RÉCENTE acceptation par date, et non « celle qui porte la
   * version courante » : la question posée par l'appelant est « où en est cet
   * utilisateur ? », pas « a-t-il accepté cette version précise ? ». La réponse
   * distingue ensuite les deux via `isCurrent`.
   */
  async getAcceptance(userId: string): Promise<TermsAcceptanceView> {
    const latest = await this.acceptances
      .findOne({ userId })
      .sort({ acceptedAt: -1 })
      .lean()
      .exec();

    const acceptedVersion = latest?.termsVersion ?? null;

    return {
      currentVersion: LEGAL_VERSION,
      acceptedVersion,
      acceptedAt: latest?.acceptedAt ? new Date(latest.acceptedAt).toISOString() : null,
      isCurrent: isTermsAcceptanceCurrent(acceptedVersion),
    };
  }
}
