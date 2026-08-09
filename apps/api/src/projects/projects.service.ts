import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';

import { Project, type ProjectDocument } from './project.schema.js';

export interface CreateProjectInput {
  organizationId: string;
  createdBy: string;
  name: string;
  templateSlug: string;
  pays: string;
  parameterPackSlug: string;
  systemeComptable: string;
  deviseAffichage: string;
  driverValues?: Record<string, number>;
}

@Injectable()
export class ProjectsService {
  constructor(@InjectModel(Project.name) private readonly model: Model<ProjectDocument>) {}

  create(input: CreateProjectInput): Promise<ProjectDocument> {
    return this.model.create({
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      name: input.name,
      templateSlug: input.templateSlug,
      pays: input.pays,
      parameterPackSlug: input.parameterPackSlug,
      systemeComptable: input.systemeComptable,
      deviseAffichage: input.deviseAffichage,
      driverValues: input.driverValues ?? {},
      _schemaVersion: 2,
    });
  }

  /** Nombre total de projets d'une organisation (S16b — quota `maxProjects`). */
  countByOrg(organizationId: string): Promise<number> {
    return this.model.countDocuments({ organizationId }).exec();
  }

  /** Liste les projets d'une organisation, plus récents en premier. */
  listByOrg(organizationId: string, limit = 50): Promise<ProjectDocument[]> {
    return this.model.find({ organizationId }).sort({ updatedAt: -1 }).limit(limit).exec();
  }

  /**
   * Récupère un projet scopé par organisation. Renvoie 404 si l'id est invalide,
   * inexistant, OU si le projet appartient à une autre org.
   * On préfère 404 à 403 pour ne pas révéler l'existence de ressources cross-tenant.
   */
  async findScoped(id: string, organizationId: string): Promise<ProjectDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND' });
    }
    const project = await this.model.findOne({ _id: id, organizationId }).exec();
    if (!project) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND' });
    return project;
  }

  async updateDrivers(
    id: string,
    organizationId: string,
    driverValues: Record<string, number>,
    updatedBy?: string,
  ): Promise<ProjectDocument> {
    const project = await this.findScoped(id, organizationId);
    project.driverValues = driverValues;
    // Trace de l'auteur pour la séparation des tâches (R2). `updatedBy` est
    // optionnel pour ne pas casser les appels internes qui n'ont pas d'acteur.
    if (updatedBy !== undefined) project.driversUpdatedBy = updatedBy;
    await project.save();
    return project;
  }
}
