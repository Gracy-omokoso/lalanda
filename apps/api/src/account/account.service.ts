import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { isOwnerRole } from '../authz/permissions.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { Organization, type OrganizationDocument } from '../organizations/organization.schema.js';
import type { PutPreferencesInput, PutProfileInput } from './account.dto.js';
import { EmailChangeRequest, type EmailChangeRequestDocument } from './email-change.schema.js';
import {
  UserPreferences,
  type NotificationPreferences,
  type UserPreferencesDocument,
} from './user-preferences.schema.js';

/**
 * Valeurs servies à un utilisateur qui n'a jamais rien réglé.
 *
 * Elles doivent rester identiques aux `default` du schéma Mongoose : la lecture
 * d'un compte neuf (aucun document) et celle d'un compte fraîchement créé (document
 * aux défauts) doivent produire exactement la même réponse, sinon l'interface
 * changerait d'état au premier enregistrement sans que l'utilisateur ait rien touché.
 */
export const DEFAULT_PREFERENCES: PreferencesView = {
  locale: 'fr',
  timezone: 'Africa/Kinshasa',
  theme: 'system',
  displayCurrency: 'USD',
  notifications: {
    securite: true,
    produit: true,
    projet: true,
    resumeHebdomadaire: false,
  },
  updatedAt: null,
};

export interface PreferencesView {
  locale: 'fr';
  timezone: string;
  theme: 'light' | 'dark' | 'system';
  displayCurrency: 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR';
  notifications: NotificationPreferences;
  /** `null` tant qu'aucune préférence n'a été enregistrée. */
  updatedAt: string | null;
}

/** Organisation empêchant la suppression du compte, avec de quoi agir. */
export interface BlockingOrganization {
  id: string;
  name: string;
  /** Nombre de membres AUTRES que l'utilisateur qui souhaite partir. */
  otherMemberCount: number;
}

export interface DeletionAssessment {
  canDelete: boolean;
  /** Organisations dont l'utilisateur est le DERNIER propriétaire et qui ont d'autres membres. */
  blockingOrganizations: BlockingOrganization[];
  /** Organisations dont il est le seul membre — supprimées avec le compte. */
  organizationsDeletedWithAccount: Array<{ id: string; name: string }>;
}

/**
 * Collections applicatives portant un `organizationId`.
 *
 * Même liste que `src/__tests__/e2e-utils.ts` — les deux décrivent le même fait :
 * « tout ce qui meurt avec une organisation ». Ajouter une collection scopée par
 * organisation sans l'ajouter ici laisserait des documents orphelins après la
 * suppression d'un compte solo, invisibles et impossibles à réclamer.
 */
const ORG_SCOPED_COLLECTIONS = [
  'projects',
  'financial_plans',
  'financial_objectives',
  'actual_periods',
  'canvases',
  'canvas_revisions',
  'subscriptions',
  'invitations',
] as const;

@Injectable()
export class AccountService {
  constructor(
    @InjectModel(UserPreferences.name)
    private readonly prefsModel: Model<UserPreferencesDocument>,
    @InjectModel(EmailChangeRequest.name)
    private readonly emailChangeModel: Model<EmailChangeRequestDocument>,
    @InjectModel(Membership.name)
    private readonly membershipModel: Model<MembershipDocument>,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Préférences de l'utilisateur, défauts compris.
   * Ne lève jamais : un compte sans document n'est pas une erreur (cf. DEFAULT_PREFERENCES).
   */
  async getPreferences(userId: string): Promise<PreferencesView> {
    const doc = await this.prefsModel.findOne({ userId }).exec();
    return toPreferencesView(doc);
  }

  /**
   * Écrit le volet « profil » des préférences (langue, fuseau).
   * Le nom affiché n'est PAS ici : il appartient à la collection `user` de
   * better-auth et transite par `auth.api.updateUser` (voir le contrôleur).
   */
  async saveProfilePreferences(
    userId: string,
    input: Pick<PutProfileInput, 'locale' | 'timezone'>,
  ): Promise<PreferencesView> {
    return this.upsert(userId, { locale: input.locale, timezone: input.timezone });
  }

  /** Écrit le volet « préférences » (thème, devise par défaut, notifications). */
  async savePreferences(userId: string, input: PutPreferencesInput): Promise<PreferencesView> {
    return this.upsert(userId, {
      theme: input.theme,
      displayCurrency: input.displayCurrency,
      notifications: input.notifications,
    });
  }

  /**
   * Écriture scopée. `userId` vient de la session et sert de FILTRE, jamais de
   * valeur modifiable : il n'est posé qu'au `$setOnInsert`, si bien qu'aucune
   * requête ne peut réaffecter un document de préférences à un autre compte.
   */
  private async upsert(
    userId: string,
    patch: Partial<Omit<PreferencesView, 'updatedAt'>>,
  ): Promise<PreferencesView> {
    const doc = await this.prefsModel
      .findOneAndUpdate(
        { userId },
        { $set: patch, $setOnInsert: { userId, _schemaVersion: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return toPreferencesView(doc);
  }

  /**
   * État de vérification de l'adresse email, lu dans la collection `user` de
   * better-auth (`AuthGuard` ne le propage pas dans `req.user`).
   *
   * Il est LU et non supposé : tant qu'aucun SMTP n'existe, ce drapeau vaut
   * `false` pour tout le monde, et l'interface doit pouvoir le dire honnêtement
   * plutôt que d'afficher un compte « vérifié » qui ne l'est pas.
   */
  async readEmailVerified(userId: string): Promise<boolean> {
    const db = this.connection.db;
    if (!db) return false;
    const { ObjectId } = await import('mongodb');
    if (!ObjectId.isValid(userId)) return false;
    const doc = await db
      .collection('user')
      .findOne({ _id: new ObjectId(userId) }, { projection: { emailVerified: 1 } });
    return doc?.['emailVerified'] === true;
  }

  /**
   * Peut-on supprimer ce compte ? (docs/12 § Règles critiques : « un propriétaire
   * ne peut pas retirer le dernier propriétaire sans transfert ».)
   *
   * La règle appliquée telle quelle bloquerait TOUTE suppression : chaque
   * utilisateur est l'unique propriétaire de l'organisation personnelle créée à son
   * inscription (S4a). Le critère retenu est donc la présence d'AUTRES MEMBRES :
   *
   * - d'autres membres et aucun autre propriétaire → REFUS. Partir laisserait une
   *   organisation vivante, avec des données et des utilisateurs, sans personne
   *   pour gérer abonnement, membres ou suppression. C'est l'organisation orpheline
   *   que la règle interdit.
   * - d'autres membres et un autre propriétaire → autorisé : la gouvernance survit.
   * - aucun autre membre → autorisé, l'organisation est supprimée avec le compte.
   *   Rien n'est orphelin puisque plus personne n'y a accès.
   *
   * Le rôle propriétaire est résolu par `isOwnerRole` et non comparé en dur ici.
   * Cette fonction vient de `authz/permissions.ts`, source de vérité unique des
   * rôles (ADR-0012 §8) : elle tolère la casse et les espaces, parce que la valeur
   * comparée sort d'un document Mongo et non d'un type TypeScript.
   */
  async assessDeletion(userId: string): Promise<DeletionAssessment> {
    const memberships = await this.membershipModel.find({ userId }).exec();
    const ownedOrgIds = memberships.filter((m) => isOwnerRole(m.role)).map((m) => m.organizationId);

    const blockingOrganizations: BlockingOrganization[] = [];
    const organizationsDeletedWithAccount: Array<{ id: string; name: string }> = [];

    for (const organizationId of ownedOrgIds) {
      // Une seule lecture des appartenances, puis comptage EN MÉMOIRE : un
      // `countDocuments({ role: 'owner' })` ferait une comparaison exacte côté
      // Mongo, là où `isOwnerRole` tolère casse et espaces. Deux règles
      // différentes pour la même question finiraient par diverger.
      const others = await this.membershipModel
        .find({ organizationId, userId: { $ne: userId } })
        .exec();
      const otherMemberCount = others.length;
      const otherOwnerCount = others.filter((m) => isOwnerRole(m.role)).length;

      const org = await this.orgModel.findById(organizationId).exec();
      const name = org?.name ?? 'Organisation';

      if (otherMemberCount === 0) {
        organizationsDeletedWithAccount.push({ id: organizationId, name });
      } else if (otherOwnerCount === 0) {
        blockingOrganizations.push({ id: organizationId, name, otherMemberCount });
      }
    }

    return {
      canDelete: blockingOrganizations.length === 0,
      blockingOrganizations,
      organizationsDeletedWithAccount,
    };
  }

  /**
   * Supprime définitivement le compte et tout ce qui ne survit pas sans lui.
   *
   * ORDRE DÉLIBÉRÉ — données, puis organisations, puis accès, puis identité.
   * Chaque étape laisse un état reprenable si la suivante échoue : tant que le
   * document `user` existe, l'utilisateur peut relancer l'opération. L'ordre
   * inverse (identité d'abord) transformerait la moindre panne en données
   * orphelines que plus aucune session ne peut réclamer.
   *
   * L'appelant DOIT avoir vérifié `assessDeletion` — c'est refait ici pour que la
   * règle du dernier propriétaire ne dépende pas de la discipline du contrôleur.
   */
  async deleteAccount(userId: string): Promise<{ deletedOrganizations: number }> {
    const assessment = await this.assessDeletion(userId);
    if (!assessment.canDelete) {
      throw new ConflictException({
        code: 'LAST_OWNER',
        message:
          'Vous êtes le dernier propriétaire d’une organisation qui compte d’autres membres. ' +
          'Transférez la propriété à un autre membre, ou supprimez l’organisation, avant de supprimer votre compte.',
        organizations: assessment.blockingOrganizations,
      });
    }

    const orgIds = assessment.organizationsDeletedWithAccount.map((o) => o.id);
    const db = this.connection.db;
    if (!db) {
      throw new Error('Connexion Mongo indisponible — suppression de compte interrompue.');
    }

    // 1. Données applicatives des organisations qui disparaissent avec le compte.
    if (orgIds.length > 0) {
      for (const name of ORG_SCOPED_COLLECTIONS) {
        await db.collection(name).deleteMany({ organizationId: { $in: orgIds } });
      }
      await this.orgModel.deleteMany({ _id: { $in: orgIds } }).exec();
    }

    // 2. Appartenances — y compris aux organisations qui, elles, survivent.
    await this.membershipModel.deleteMany({ userId }).exec();

    // 3. Données de compte propres à ce module.
    await Promise.all([
      this.prefsModel.deleteMany({ userId }).exec(),
      this.emailChangeModel.deleteMany({ userId }).exec(),
    ]);

    // 4. Accès puis identité. `session` et `account` sont gérées par better-auth et
    //    indexent l'utilisateur en ObjectId, là où les collections applicatives le
    //    stockent en chaîne (constat vérifié en base, cf. `e2e-utils.ts`).
    const { ObjectId } = await import('mongodb');
    const objectId = ObjectId.isValid(userId) ? new ObjectId(userId) : null;
    if (objectId) {
      await db.collection('session').deleteMany({ userId: objectId });
      await db.collection('account').deleteMany({ userId: objectId });
      await db.collection('user').deleteOne({ _id: objectId });
    }

    return { deletedOrganizations: orgIds.length };
  }
}

function toPreferencesView(doc: UserPreferencesDocument | null): PreferencesView {
  if (!doc)
    return { ...DEFAULT_PREFERENCES, notifications: { ...DEFAULT_PREFERENCES.notifications } };
  return {
    locale: doc.locale,
    timezone: doc.timezone,
    theme: doc.theme,
    displayCurrency: doc.displayCurrency,
    notifications: {
      securite: doc.notifications.securite,
      produit: doc.notifications.produit,
      projet: doc.notifications.projet,
      resumeHebdomadaire: doc.notifications.resumeHebdomadaire,
    },
    updatedAt: doc.updatedAt.toISOString(),
  };
}
