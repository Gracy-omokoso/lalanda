// Vérification d'un changement d'adresse email (S20b).
//
//   POST /account-email/verify  → applique le changement à partir du token
//
// POURQUOI CETTE ROUTE N'EST PAS AUTHENTIFIÉE :
// le lien de vérification est reçu dans la NOUVELLE boîte, souvent ouverte sur un
// autre appareil ou un autre navigateur que celui où la demande a été faite.
// Exiger une session revient à exiger que l'utilisateur soit déjà connecté au bon
// endroit — exactement ce qu'on ne peut pas supposer. C'est le token qui porte la
// preuve : 64 caractères hexadécimaux tirés de `randomBytes(32)`, à usage unique,
// valable 24 h, et lié à un seul utilisateur. La possession du token EST
// l'authentification de cette opération.
//
// Surface d'attaque : la route est couverte par le rate limiting global (100
// req/min/IP, S16a) et ne renvoie qu'un message uniforme — elle ne permet donc ni
// d'énumérer les tokens ni de distinguer « inconnu » de « expiré » ou « déjà
// utilisé ».
//
// Contrôleur séparé de `AccountController` parce que ce dernier est entièrement
// gardé par `AccountAuthGuard` : monter une exception à l'intérieur d'un
// contrôleur gardé demanderait un mécanisme de contournement du guard, c'est-à-dire
// précisément le genre de dérogation qui finit par s'appliquer à une route qu'on
// ne voulait pas ouvrir. Un contrôleur sans guard est explicite et se relit d'un
// coup d'œil.

import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';

import { VerifyEmailChangeSchema } from './account.dto.js';
import { EmailChangeService } from './email-change.service.js';

@Controller('account-email')
export class EmailVerificationController {
  constructor(@Inject(EmailChangeService) private readonly emailChange: EmailChangeService) {}

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown): Promise<{ verified: true; email: string }> {
    const parsed = VerifyEmailChangeSchema.safeParse(body);
    if (!parsed.success) {
      // Message aligné sur celui d'un token inconnu : un corps malformé ne doit
      // pas se distinguer d'un token invalide.
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'Ce lien de vérification est invalide, expiré ou déjà utilisé.',
      });
    }
    const { newEmail } = await this.emailChange.verify(parsed.data.token);
    return { verified: true, email: newEmail };
  }
}
