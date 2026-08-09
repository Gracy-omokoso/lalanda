// Endpoints d'acceptation des conditions (S22c).
//
//   POST /legal/terms/acceptance   enregistre l'accord de l'utilisateur courant
//   GET  /legal/terms/acceptance   dit où il en est
//
// ── POURQUOI CE MODULE N'UTILISE PAS `AuthGuard` ──────────────────────────────
//
// `AuthGuard` résout la session PUIS exige une organisation active, et lève
// `403 NO_ORGANIZATION` sinon. Cette règle est juste pour les routes métier, mais
// fatale ici : l'acceptation est demandée à l'INSCRIPTION, à l'instant précis où
// l'organisation personnelle vient d'être créée par un hook non transactionnel
// (`databaseHooks.user.create.after`). Un accord refusé pour cause d'organisation
// manquante serait un accord perdu, sur le seul écran où il est donné.
//
// L'acceptation est d'ailleurs un fait PERSONNEL, pas organisationnel : c'est un
// utilisateur qui accepte des conditions, et il les accepte une fois, quelles que
// soient les organisations auxquelles il appartient.
//
// `AccountAuthGuard` (module compte) fait exactement ce qu'il faut — résoudre la
// session et rien d'autre — et son commentaire d'en-tête explique pourquoi. Il est
// RÉUTILISÉ tel quel, sans modification du module compte : le déclarer dans les
// providers de `LegalModule` suffit, il n'a aucune dépendance.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AccountAuthGuard } from '../account/account-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AcceptTermsSchema, type TermsAcceptanceView } from './legal.dto.js';
import { LegalService } from './legal.service.js';

@Controller('legal/terms')
@UseGuards(AccountAuthGuard)
export class LegalController {
  // `@Inject` explicite : vitest n'émet pas `emitDecoratorMetadata`, donc Nest ne
  // peut pas déduire le type du paramètre en test. Sans lui, l'injection échoue
  // à l'exécution des suites e2e alors que le typage est correct — même raison
  // que dans `ai-actions.controller.ts`.
  constructor(@Inject(LegalService) private readonly service: LegalService) {}

  /** Où en est l'utilisateur courant vis-à-vis du corpus en vigueur ? */
  @Get('acceptance')
  async read(@CurrentUser() user: { id: string }): Promise<TermsAcceptanceView> {
    return this.service.getAcceptance(user.id);
  }

  /**
   * Enregistre l'accord.
   *
   * La version est fournie par le client PARCE QU'ELLE DOIT L'ÊTRE : elle atteste
   * du texte réellement affiché à l'utilisateur au moment où il a coché la case.
   * L'enregistrer d'office avec la version courante du serveur enregistrerait un
   * accord sur un texte que l'utilisateur n'a peut-être pas eu sous les yeux — un
   * déploiement pendant qu'il remplissait le formulaire suffit à produire l'écart.
   * Le DTO refuse en retour toute version jamais publiée.
   */
  @Post('acceptance')
  async accept(
    @CurrentUser() user: { id: string },
    @Body() body: unknown,
  ): Promise<TermsAcceptanceView> {
    const parsed = AcceptTermsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_TERMS_VERSION',
        issues: parsed.error.issues,
      });
    }
    return this.service.recordAcceptance(user.id, parsed.data.version, new Date());
  }
}
