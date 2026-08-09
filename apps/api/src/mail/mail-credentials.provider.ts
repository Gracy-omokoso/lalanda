// D'OÙ VIENNENT LES IDENTIFIANTS SMTP (S22a).
//
// Cette classe abstraite est le SEUL point de remplacement prévu du module mail.
// Elle existe parce que `integrations/` (livré en parallèle, ADR-0013) stockera un
// jour les identifiants d'envoi en base, par organisation, chiffrés. Le jour où
// c'est vrai, il suffira de fournir une autre implémentation dans le module racine :
//
//   { provide: MailCredentialsProvider, useClass: DatabaseMailCredentialsProvider }
//
// Rien d'autre ne bouge — ni le service, ni le transport, ni les gabarits.
//
// Deux propriétés en découlent, délibérées :
//
//  1. `resolve()` est ASYNCHRONE et appelée À CHAQUE ENVOI, pas au démarrage. Des
//     identifiants lus en base peuvent changer sans redémarrage ; les figer au
//     bootstrap condamnerait le futur fournisseur à un cycle de vie qu'il n'a pas.
//     Le coût est nul avec la lecture d'environnement ci-dessous, et le transport
//     met de toute façon en cache le transporteur nodemailer (voir mail.transport.ts).
//
//  2. `resolve()` retourne `null` plutôt que de lever quand rien n'est configuré.
//     L'absence de SMTP est un état NORMAL de ce produit (docs/17 § Restant) : elle
//     déclenche le repli journal, jamais un démarrage refusé ni une requête en 500.
//
// Ce module ne dépend PAS de `integrations/` : il expose une prise, il ne va pas
// chercher la fiche.

import { Injectable } from '@nestjs/common';

import type { SmtpCredentials } from './mail.types.js';

/** Contrat de résolution des identifiants SMTP. Voir l'en-tête de fichier. */
@Injectable()
export abstract class MailCredentialsProvider {
  /** Identifiants utilisables, ou `null` si l'envoi n'est pas configuré. */
  abstract resolve(): Promise<SmtpCredentials | null>;
}

/**
 * Port par défaut quand `SMTP_PORT` est absent ou illisible.
 *
 * 587 (soumission + STARTTLS) et non 25 : le port 25 est bloqué en sortie par la
 * quasi-totalité des hébergeurs, DigitalOcean compris (ADR-0009). Un défaut à 25
 * produirait un timeout silencieux là où 587 produit une erreur d'authentification
 * lisible.
 */
export const DEFAULT_SMTP_PORT = 587;

/** Port du TLS implicite (SMTPS). Le seul pour lequel `secure` vaut true. */
const IMPLICIT_TLS_PORT = 465;

/**
 * Lecture des identifiants dans l'environnement du process.
 *
 * `SMTP_HOST` seul décide : sans hôte, il n'y a pas de serveur à joindre et tout
 * le reste est sans objet. `SMTP_USER` / `SMTP_PASSWORD` restent facultatifs — un
 * relais interne ou un MailHog de développement n'authentifie personne.
 */
@Injectable()
export class EnvMailCredentialsProvider extends MailCredentialsProvider {
  async resolve(): Promise<SmtpCredentials | null> {
    const host = process.env['SMTP_HOST']?.trim();
    if (!host) return null;

    const port = parsePort(process.env['SMTP_PORT']);
    const user = process.env['SMTP_USER']?.trim() || undefined;
    const password = process.env['SMTP_PASSWORD'] || undefined;

    return {
      host,
      port,
      secure: port === IMPLICIT_TLS_PORT,
      user,
      password,
      // Défaut lisible plutôt qu'une erreur : un opérateur qui configure l'hôte et
      // oublie l'expéditeur doit voir partir des messages, quitte à corriger
      // l'adresse ensuite. `SMTP_FROM` est documenté comme fortement recommandé.
      from: process.env['SMTP_FROM']?.trim() || `Lalanda <no-reply@${hostToDomain(host)}>`,
    };
  }
}

/** Port valide, ou défaut. Une valeur illisible ne doit pas faire tomber l'API. */
function parsePort(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return DEFAULT_SMTP_PORT;
  return n;
}

/**
 * Domaine plausible déduit de l'hôte SMTP, pour l'expéditeur de repli.
 * `smtp.gmail.com` → `gmail.com`. Sans intérêt en production (où `SMTP_FROM` est
 * renseigné), utile en développement pour produire une adresse bien formée.
 */
function hostToDomain(host: string): string {
  const parts = host.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : host;
}
