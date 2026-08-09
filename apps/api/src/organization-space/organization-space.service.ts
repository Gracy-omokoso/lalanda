// Espace organisation (S21a) — agrégation, jamais calcul.
//
// Ce service charge des documents déjà écrits par d'autres modules (`projects`,
// `plans` S16c, `actuals` S18b, `billing` S16b) et les assemble en UNE réponse
// dont le contenu dépend du rôle de l'appelant. Il ne recalcule aucun chiffre
// financier : les feux tricolores viennent des snapshots de plans validés, les
// écarts de `computeVariances`, les limites du catalogue d'entitlements.
//
// Il ne DÉCIDE pas non plus des autorisations : il appelle `can()` (ADR-0012 §8)
// et n'écrit aucun `if (role === …)`.

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ActualPeriod, type ActualPeriodDocument } from '../actuals/actual-period.schema.js';
import { computeVariances } from '../actuals/variance.js';
import type { Action, OrgPermissionContext, OrgRole } from '../authz/permissions.js';
import { actionsOf } from '../authz/permissions.js';
import { PLAN_ENTITLEMENTS, type Plan } from '../billing/entitlements.js';
import { Subscription, type SubscriptionDocument } from '../billing/subscription.schema.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { Organization, type OrganizationDocument } from '../organizations/organization.schema.js';
import { FinancialPlan, type FinancialPlanDocument } from '../plans/plan.schema.js';
import { Project, type ProjectDocument } from '../projects/project.schema.js';
import {
  anomaliesDesEcarts,
  blocVisible,
  blocsMasques,
  consommation,
  depassements,
  estLectureSeule,
  libelleRole,
  moisACloturer,
  planEnAttente,
  prochainMoisASaisir,
  ratiosRougesDuPlan,
  resumeEcarts,
  type PlanSnapshotInput,
} from './dashboard.js';
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  DISPLAY_CURRENCIES,
  type ComptabiliteSection,
  type DisplayCurrency,
  type GouvernanceSection,
  type HistoriqueAbonnementView,
  type OrganizationBillingView,
  type OrganizationDashboardView,
  type OrganizationSettingsView,
  type ProjetsSection,
  type UpdateOrganizationSettingsInput,
  type ValidationSection,
} from './organization-space.dto.js';
import {
  OrganizationSettings,
  type OrganizationSettingsDocument,
} from './organization-settings.schema.js';

/**
 * Nombre maximal de projets balayés par les agrégations COÛTEUSES (ratios,
 * écarts, périodes) — celles qui chargent un snapshot de plan complet par projet.
 *
 * Un tableau de bord n'est pas un export : il doit répondre vite et donner
 * l'essentiel. Les projets sont pris du plus récemment modifié au plus ancien, et
 * la réponse ne prétend nulle part à l'exhaustivité — le détail complet vit sur
 * la page de chaque projet.
 */
const PROJETS_ANALYSES_MAX = 20;

/** Exercice suivi par défaut. Le réalisé est indexé par ANNÉE D'EXERCICE (1..5). */
const EXERCICE_SUIVI = 1;

/** Nombre de validations récentes remontées dans le bloc « Projets ». */
const VALIDATIONS_RECENTES_MAX = 5;

@Injectable()
export class OrganizationSpaceService {
  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(OrganizationSettings.name)
    private readonly settings: Model<OrganizationSettingsDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Project.name) private readonly projects: Model<ProjectDocument>,
    @InjectModel(FinancialPlan.name) private readonly plans: Model<FinancialPlanDocument>,
    @InjectModel(ActualPeriod.name) private readonly periods: Model<ActualPeriodDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Paramètres
  // ───────────────────────────────────────────────────────────────────────────

  async readSettings(organizationId: string): Promise<OrganizationSettingsView> {
    const [org, reglages] = await Promise.all([
      this.requireOrg(organizationId),
      this.settings.findOne({ organizationId }).lean().exec(),
    ]);
    return {
      id: String(org._id),
      name: org.name,
      slug: org.slug,
      type: org.type,
      pays: org.pays,
      deviseAffichage: reglages?.deviseAffichage ?? DEFAULT_ORGANIZATION_SETTINGS.deviseAffichage,
      logoUrl: reglages?.logoUrl ?? DEFAULT_ORGANIZATION_SETTINGS.logoUrl,
      updatedAt: reglages?.updatedAt ? new Date(reglages.updatedAt).toISOString() : null,
      options: { currencies: DISPLAY_CURRENCIES },
    };
  }

  /**
   * Écrit les paramètres. Deux collections, deux responsabilités :
   * `organizations` porte l'identité (nom, pays), `organization_settings` la
   * présentation (devise d'affichage, logo) — voir l'en-tête du schéma.
   *
   * Le `slug` n'est PAS régénéré au renommage : il est unique, indexé, et sert
   * d'identifiant stable. Le renommer casserait tout lien déjà partagé.
   */
  async writeSettings(
    organizationId: string,
    input: UpdateOrganizationSettingsInput,
    actorUserId: string,
  ): Promise<OrganizationSettingsView> {
    await this.requireOrg(organizationId);

    await this.orgs
      .updateOne(
        { _id: organizationId },
        { $set: { name: input.name, pays: input.pays.toUpperCase() } },
      )
      .exec();

    await this.settings
      .updateOne(
        { organizationId },
        {
          $set: {
            deviseAffichage: input.deviseAffichage,
            logoUrl: input.logoUrl,
            updatedBy: actorUserId,
          },
          $setOnInsert: { organizationId, _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec();

    return this.readSettings(organizationId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Facturation
  // ───────────────────────────────────────────────────────────────────────────

  async readBilling(organizationId: string): Promise<OrganizationBillingView> {
    const [abonnement, projets, membres] = await Promise.all([
      this.subscriptions.findOne({ organizationId }).lean().exec(),
      this.projects.countDocuments({ organizationId }).exec(),
      this.memberships.countDocuments({ organizationId }).exec(),
    ]);

    // Absence de document = plan `free` (S16b) : on ne crée pas d'abonnement à
    // l'inscription, seulement lors d'un changement de plan.
    const plan: Plan = abonnement?.plan ?? 'free';
    const entitlements = PLAN_ENTITLEMENTS[plan];
    const c = consommation(plan, entitlements, { projets, membres });

    return {
      plan,
      entitlements,
      consommation: c,
      depassements: depassements(c),
      historique: this.historiqueAbonnement(plan, abonnement),
      paiement: {
        integre: false,
        message:
          'Aucun moyen de paiement n’est branché : les changements de plan passent par ' +
          'l’équipe Lalanda. Facturation, prélèvement et historique de paiement arriveront ' +
          'avec le fournisseur de paiement (docs/13).',
      },
    };
  }

  /**
   * Historique de l'abonnement, reconstitué depuis le SEUL document existant.
   *
   * Il n'y a pas d'événements de paiement à afficher — aucun fournisseur n'est
   * branché (docs/13 § Hors périmètre S16b). Fabriquer un faux échéancier serait
   * pire que l'absence : on remonte donc les deux seules dates réelles, l'ouverture
   * et la dernière modification, et l'interface annonce clairement la limite.
   */
  private historiqueAbonnement(
    plan: Plan,
    abonnement: { plan: Plan; status: string; createdAt?: Date; updatedAt?: Date } | null,
  ): HistoriqueAbonnementView[] {
    if (!abonnement?.createdAt) {
      return [
        {
          plan,
          status: 'active',
          depuis: '',
          evenement: 'Offre gratuite par défaut — aucun abonnement souscrit.',
        },
      ];
    }
    const lignes: HistoriqueAbonnementView[] = [
      {
        plan: abonnement.plan,
        status: abonnement.status,
        depuis: new Date(abonnement.createdAt).toISOString(),
        evenement: 'Ouverture de l’abonnement.',
      },
    ];
    if (
      abonnement.updatedAt &&
      new Date(abonnement.updatedAt).getTime() !== new Date(abonnement.createdAt).getTime()
    ) {
      lignes.unshift({
        plan: abonnement.plan,
        status: abonnement.status,
        depuis: new Date(abonnement.updatedAt).toISOString(),
        evenement: 'Dernière modification de l’abonnement.',
      });
    }
    return lignes;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tableau de bord
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * UNE réponse, quatre blocs, chacun conditionné par une action de la matrice.
   *
   * Un bloc refusé vaut `null` et sa raison part dans `masque` : le serveur ne
   * charge alors RIEN pour ce bloc — pas de compteur, pas de nom de projet. C'est
   * ce qui fait qu'un `viewer` ne peut rien apprendre de cette réponse qu'il ne
   * puisse déjà voir ailleurs.
   */
  async readDashboard(
    organizationId: string,
    role: OrgRole,
    ctx: OrgPermissionContext,
  ): Promise<OrganizationDashboardView> {
    const [org, reglages] = await Promise.all([
      this.requireOrg(organizationId),
      this.settings.findOne({ organizationId }).lean().exec(),
    ]);

    const voitGouvernance = blocVisible('gouvernance', role, ctx);
    const voitValidation = blocVisible('validation', role, ctx);
    const voitComptabilite = blocVisible('comptabilite', role, ctx);
    const voitProjets = blocVisible('projets', role, ctx);

    const [gouvernance, validation, comptabilite, projets] = await Promise.all([
      voitGouvernance ? this.sectionGouvernance(organizationId) : Promise.resolve(null),
      voitValidation ? this.sectionValidation(organizationId) : Promise.resolve(null),
      voitComptabilite
        ? this.sectionComptabilite(organizationId, role, ctx)
        : Promise.resolve(null),
      voitProjets ? this.sectionProjets(organizationId) : Promise.resolve(null),
    ]);

    const actions: Action[] = actionsOf(role, ctx);

    return {
      organization: {
        id: String(org._id),
        name: org.name,
        slug: org.slug,
        type: org.type,
        pays: org.pays,
        deviseAffichage: (reglages?.deviseAffichage ??
          DEFAULT_ORGANIZATION_SETTINGS.deviseAffichage) as DisplayCurrency,
        logoUrl: reglages?.logoUrl ?? DEFAULT_ORGANIZATION_SETTINGS.logoUrl,
      },
      role,
      roleLabel: libelleRole(role),
      actions,
      lectureSeule: estLectureSeule(role, ctx),
      sections: { gouvernance, validation, comptabilite, projets },
      masque: blocsMasques(role, ctx),
    };
  }

  /** `organization.manage` — Propriétaire, Administrateur. */
  private async sectionGouvernance(organizationId: string): Promise<GouvernanceSection> {
    const debutDuMois = new Date();
    debutDuMois.setUTCDate(1);
    debutDuMois.setUTCHours(0, 0, 0, 0);

    const [projets, plansValidesCeMois, membresActifs, abonnement] = await Promise.all([
      this.projects.countDocuments({ organizationId }).exec(),
      this.plans.countDocuments({ organizationId, approvedAt: { $gte: debutDuMois } }).exec(),
      this.memberships.countDocuments({ organizationId }).exec(),
      this.subscriptions.findOne({ organizationId }).lean().exec(),
    ]);

    const plan: Plan = abonnement?.plan ?? 'free';
    return {
      projets,
      // Compte les plans APPROUVÉS ce mois, `superseded` compris : une version
      // remplacée depuis a bien été validée ce mois-là. Filtrer sur le statut
      // courant ferait disparaître le travail du mois au premier remplacement.
      plansValidesCeMois,
      membresActifs,
      consommation: consommation(plan, PLAN_ENTITLEMENTS[plan], {
        projets,
        membres: membresActifs,
      }),
    };
  }

  /** `plan.approve` — Propriétaire, Directeur financier. */
  private async sectionValidation(organizationId: string): Promise<ValidationSection> {
    const projets = await this.projetsRecents(organizationId);
    const derniers = await this.derniersPlansParProjet(
      organizationId,
      projets.map((p) => String(p._id)),
    );

    const ratiosRouges = projets.flatMap((p) => {
      const plan = derniers.get(String(p._id));
      return plan ? ratiosRougesDuPlan(plan, p.name) : [];
    });

    const plansEnAttente = projets.flatMap((p) => {
      const attente = planEnAttente(
        {
          id: String(p._id),
          name: p.name,
          driverValues: p.driverValues ?? {},
          updatedAt: p.updatedAt,
        },
        derniers.get(String(p._id)),
      );
      return attente ? [attente] : [];
    });

    const ecarts = await this.ecartsParProjet(organizationId, projets, derniers);

    return {
      ratiosRouges,
      plansEnAttente,
      ecartsDefavorables: ecarts.flatMap((e) => (e.resume === null ? [] : [e.resume])),
    };
  }

  /** `actuals.import` — Comptable, Directeur financier, Administrateur, Propriétaire. */
  private async sectionComptabilite(
    organizationId: string,
    role: OrgRole,
    ctx: OrgPermissionContext,
  ): Promise<ComptabiliteSection> {
    const projets = await this.projetsRecents(organizationId);
    const derniers = await this.derniersPlansParProjet(
      organizationId,
      projets.map((p) => String(p._id)),
    );

    const periodesASaisir: ComptabiliteSection['periodesASaisir'] = [];
    const periodesACloturer: ComptabiliteSection['periodesACloturer'] = [];

    const periodesParProjet = await this.periodesParProjet(
      organizationId,
      projets.map((p) => String(p._id)),
    );

    for (const p of projets) {
      const projectId = String(p._id);
      // Sans plan validé, la saisie du réalisé est refusée en amont
      // (409 NO_APPROVED_PLAN, docs/08) : proposer de saisir serait mentir.
      if (!derniers.has(projectId)) continue;
      const periodes = periodesParProjet.get(projectId) ?? [];

      const prochain = prochainMoisASaisir(periodes);
      if (prochain !== null) {
        periodesASaisir.push({
          projectId,
          projectName: p.name,
          year: EXERCICE_SUIVI,
          month: prochain,
        });
      }
      for (const mois of moisACloturer(periodes)) {
        periodesACloturer.push({
          projectId,
          projectName: p.name,
          year: EXERCICE_SUIVI,
          month: mois,
        });
      }
    }

    const ecarts = await this.ecartsParProjet(organizationId, projets, derniers);

    return {
      // Case ⚙ de la matrice : un Comptable ne clôture que si `canClosePeriods`
      // lui a été accordé. La question est posée à la matrice, jamais au rôle.
      peutCloturer: this.peutCloturer(role, ctx),
      periodesASaisir,
      periodesACloturer,
      anomalies: ecarts.flatMap((e) => e.anomalies),
    };
  }

  private peutCloturer(role: OrgRole, ctx: OrgPermissionContext): boolean {
    return actionsOf(role, ctx).includes('period.close');
  }

  /** `project.read` — tous les rôles, Conseiller et Lecteur compris. */
  private async sectionProjets(organizationId: string): Promise<ProjetsSection> {
    const projets = await this.projetsRecents(organizationId);
    const ids = projets.map((p) => String(p._id));
    const derniers = await this.derniersPlansParProjet(organizationId, ids);
    const noms = new Map(projets.map((p) => [String(p._id), p.name]));

    const dernieresValidations = [...derniers.values()]
      .sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime())
      .slice(0, VALIDATIONS_RECENTES_MAX)
      .map((plan) => ({
        projectId: plan.projectId,
        projectName: noms.get(plan.projectId) ?? '',
        version: plan.version,
        approvedAt: plan.approvedAt.toISOString(),
        soleApprover: plan.soleApprover,
      }));

    return {
      projets: projets.map((p) => {
        const plan = derniers.get(String(p._id));
        return {
          id: String(p._id),
          name: p.name,
          deviseAffichage: p.deviseAffichage,
          updatedAt: p.updatedAt.toISOString(),
          dernierPlan: plan
            ? {
                version: plan.version,
                approvedAt: plan.approvedAt.toISOString(),
                soleApprover: plan.soleApprover,
              }
            : null,
        };
      }),
      dernieresValidations,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Chargements partagés
  // ───────────────────────────────────────────────────────────────────────────

  private async requireOrg(organizationId: string): Promise<OrganizationDocument> {
    const org = await this.orgs.findById(organizationId).exec();
    // Ne devrait pas arriver : `AuthGuard` n'a posé cette organisation qu'après
    // avoir vérifié l'appartenance. Se produit si l'organisation est supprimée
    // entre-temps — c'est un 404, jamais un 500.
    if (!org) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    return org;
  }

  private async projetsRecents(organizationId: string): Promise<ProjectDocument[]> {
    return this.projects
      .find({ organizationId })
      .sort({ updatedAt: -1 })
      .limit(PROJETS_ANALYSES_MAX)
      .exec();
  }

  /**
   * Dernier plan validé de chaque projet, réduit à ce dont les agrégations ont
   * besoin.
   *
   * `result` est volumineux (le résultat moteur complet). On projette donc
   * `result.lines` seulement, et on ne garde de chaque ligne que l'identité et le
   * feu tricolore — inutile de traverser le réseau avec les amortissements et les
   * états financiers pour compter des ratios rouges.
   */
  private async derniersPlansParProjet(
    organizationId: string,
    projectIds: string[],
  ): Promise<Map<string, PlanSnapshotInput>> {
    if (projectIds.length === 0) return new Map();
    const docs = await this.plans
      .find({ organizationId, projectId: { $in: projectIds }, status: 'approved' })
      .select({
        projectId: 1,
        version: 1,
        approvedAt: 1,
        driverValues: 1,
        approval: 1,
        'result.lines': 1,
      })
      .sort({ version: -1 })
      .lean()
      .exec();

    const out = new Map<string, PlanSnapshotInput>();
    for (const d of docs) {
      // Trié par version décroissante : le premier vu pour un projet est le bon.
      if (out.has(d.projectId)) continue;
      out.set(d.projectId, {
        projectId: d.projectId,
        version: d.version,
        approvedAt: d.approvedAt,
        driverValues: d.driverValues ?? {},
        soleApprover: d.approval?.soleApprover === true,
        lines: (d.result?.lines ?? []) as PlanSnapshotInput['lines'],
      });
    }
    return out;
  }

  private async periodesParProjet(
    organizationId: string,
    projectIds: string[],
  ): Promise<
    Map<string, Array<{ month: number; status: 'open' | 'closed'; values: Record<string, number> }>>
  > {
    const out = new Map<
      string,
      Array<{ month: number; status: 'open' | 'closed'; values: Record<string, number> }>
    >();
    if (projectIds.length === 0) return out;

    const docs = await this.periods
      .find({ organizationId, projectId: { $in: projectIds }, year: EXERCICE_SUIVI })
      .select({ projectId: 1, month: 1, status: 1, values: 1 })
      .lean()
      .exec();

    for (const d of docs) {
      const liste = out.get(d.projectId) ?? [];
      liste.push({ month: d.month, status: d.status, values: d.values ?? {} });
      out.set(d.projectId, liste);
    }
    return out;
  }

  /**
   * Écarts et anomalies par projet, à partir du plan validé et du réalisé saisi.
   *
   * `computeVariances` est la fonction de S18b, testée et déjà servie par
   * `GET /projects/:id/variances`. On la réutilise telle quelle : dupliquer sa
   * logique dans un tableau de bord serait exactement le genre de deuxième source
   * de vérité que CLAUDE.md interdit.
   */
  private async ecartsParProjet(
    organizationId: string,
    projets: ProjectDocument[],
    derniers: Map<string, PlanSnapshotInput>,
  ): Promise<
    Array<{
      resume: ReturnType<typeof resumeEcarts>;
      anomalies: ReturnType<typeof anomaliesDesEcarts>;
    }>
  > {
    const avecPlan = projets.filter((p) => derniers.has(String(p._id)));
    if (avecPlan.length === 0) return [];

    const periodesParProjet = await this.periodesParProjet(
      organizationId,
      avecPlan.map((p) => String(p._id)),
    );

    // Les lignes complètes du plan sont nécessaires ici (formules de solde,
    // feuilles `activite`/`projection`) : `derniersPlansParProjet` n'en projette
    // qu'une partie. Une seconde lecture ciblée est plus honnête qu'un snapshot
    // tronqué passé à un calcul qui attend le résultat entier.
    const complets = await this.plans
      .find({
        organizationId,
        projectId: { $in: avecPlan.map((p) => String(p._id)) },
        status: 'approved',
      })
      .select({ projectId: 1, version: 1, 'result.lines': 1 })
      .sort({ version: -1 })
      .lean()
      .exec();

    const parProjet = new Map<string, { version: number; lines: unknown[] }>();
    for (const d of complets) {
      if (parProjet.has(d.projectId)) continue;
      parProjet.set(d.projectId, { version: d.version, lines: d.result?.lines ?? [] });
    }

    return avecPlan.flatMap((p) => {
      const projectId = String(p._id);
      const plan = parProjet.get(projectId);
      const periodes = periodesParProjet.get(projectId) ?? [];
      if (!plan || periodes.length === 0) return [];

      const lignes = computeVariances(
        plan.lines as Parameters<typeof computeVariances>[0],
        periodes,
        EXERCICE_SUIVI,
      );
      const projet = { id: projectId, name: p.name };
      return [
        {
          resume: resumeEcarts(projet, EXERCICE_SUIVI, plan.version, lignes),
          anomalies: anomaliesDesEcarts(projet, EXERCICE_SUIVI, lignes),
        },
      ];
    });
  }
}
