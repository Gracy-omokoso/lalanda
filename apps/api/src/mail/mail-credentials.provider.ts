// D'OÙ VIENNENT LES IDENTIFIANTS D'ENVOI (S22a, étendu S22m).
//
// Depuis S22m, `resolve()` ne décide plus seulement AVEC QUOI envoyer mais PAR OÙ :
// elle rend une union discriminée (`MailCredentials`), et son `kind` désigne le
// transport. Faire porter les deux décisions au même endroit est ce qui évite
// qu'elles divergent — un jeton ZeptoMail posé sans que le transport le sache
// serait un email journalisé pendant qu'/admin affiche une intégration active.
//
// ⚠️ CE FOURNISSEUR LIT L'ENVIRONNEMENT, PAS LE COFFRE (ADR-0013).
// La fiche `zeptomail` d'`/admin` sert aujourd'hui au TEST DE CONNEXION, et lui
// seul : c'est là qu'un opérateur valide un jeton avant de le poser dans
// l'environnement. Le brancher réellement, c'est écrire le
// `DatabaseMailCredentialsProvider` décrit ci-dessous — lot à part entière, car
// il fait dépendre `MailModule` (@Global, chargé avant `AuthModule`) du graphe
// d'`IntegrationsModule`. L'asymétrie est écrite dans `.env.production.example`
// et dans `providers.ts`; elle ne doit pas être découverte.
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
//     L'absence de TOUT chemin d'envoi est un état NORMAL de ce produit (docs/17
//     § Restant) : elle déclenche le repli journal, jamais un démarrage refusé ni
//     une requête en 500.
//
// Ce module ne dépend PAS de `integrations/` : il expose une prise, il ne va pas
// chercher la fiche.

import { Injectable, Logger } from '@nestjs/common';

import type { MailCredentials } from './mail.types.js';
import { ZEPTOMAIL_DEFAULT_API_URL, normaliserJeton } from './zeptomail.client.js';

/** Contrat de résolution des identifiants d'envoi. Voir l'en-tête de fichier. */
@Injectable()
export abstract class MailCredentialsProvider {
  /** Identifiants utilisables, ou `null` si aucun envoi n'est configuré. */
  abstract resolve(): Promise<MailCredentials | null>;
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
 * ── ORDRE DE PRÉCÉDENCE, et pourquoi il n'y a PAS de bascule à chaud ──────────
 *
 * 1. `ZEPTOMAIL_TOKEN` → API ZeptoMail. C'est le chemin d'envoi préféré
 *    (ADR-0014 § S22m) : une API HTTP traverse les réseaux qui bloquent la
 *    soumission SMTP, et le port 25 est de toute façon fermé en sortie chez
 *    DigitalOcean (ADR-0009).
 * 2. Sinon `SMTP_HOST` → SMTP. CONSERVÉ, ce n'est pas de l'inertie : un
 *    développeur branche MailHog sans compte Zoho ni jeton de production, et
 *    l'installation SMTP en cours d'exploitation continue de fonctionner sans
 *    changement le jour du déploiement.
 * 3. Sinon `null` → repli journal. Propriété d'origine, intacte.
 *
 * La précédence se joue une fois, à la résolution — le transport ne réessaie
 * JAMAIS l'autre chemin après un échec. Un envoi qui échoue en ayant peut-être
 * abouti (délai dépassé après acceptation par Zoho) serait alors envoyé deux
 * fois, et un utilisateur recevrait deux liens de réinitialisation dont un seul
 * marche. Un chemin, une tentative, un journal.
 *
 * `SMTP_USER` / `SMTP_PASSWORD` restent facultatifs — un relais interne ou un
 * MailHog de développement n'authentifie personne.
 */
@Injectable()
export class EnvMailCredentialsProvider extends MailCredentialsProvider {
  private readonly logger = new Logger('MailCredentials');
  /** Le chemin déjà annoncé dans les journaux. Évite une ligne par email envoyé. */
  private annonce: string | null = null;

  async resolve(): Promise<MailCredentials | null> {
    const token = normaliserJeton(process.env['ZEPTOMAIL_TOKEN'] ?? '');
    if (token) {
      const apiUrl = process.env['ZEPTOMAIL_API_URL']?.trim() || ZEPTOMAIL_DEFAULT_API_URL;
      this.annoncer(`ZeptoMail (${hostOf(apiUrl)})`);
      return { kind: 'zeptomail', token, apiUrl, from: fromAddress(null) };
    }

    const host = process.env['SMTP_HOST']?.trim();
    if (!host) {
      // Ni jeton ni hôte : état NORMAL et documenté du produit. L'annonce est
      // faite ici plutôt qu'au démarrage pour ne pas dépendre d'un ordre de
      // module, et une seule fois pour ne pas noyer les journaux.
      this.annoncer('aucun — les emails seront journalisés, pas envoyés (repli ADR-0014)');
      return null;
    }

    const port = parsePort(process.env['SMTP_PORT']);
    this.annoncer(`SMTP (${host}:${port})`);
    return {
      kind: 'smtp',
      host,
      port,
      secure: port === IMPLICIT_TLS_PORT,
      user: process.env['SMTP_USER']?.trim() || undefined,
      password: process.env['SMTP_PASSWORD'] || undefined,
      from: fromAddress(host),
    };
  }

  /**
   * Journalise le chemin d'envoi en vigueur, et le rejournalise s'il CHANGE.
   *
   * Sans cette ligne, la question « par où partent réellement les emails ? » n'a
   * pas de réponse observable : deux chemins et un repli silencieux se ressemblent
   * beaucoup vus depuis une boîte de réception vide. Ne journalise que le chemin
   * et l'hôte — jamais le jeton, jamais le mot de passe (docs/17 § Journalisation).
   */
  private annoncer(chemin: string): void {
    if (this.annonce === chemin) return;
    this.annonce = chemin;
    this.logger.log(`Chemin d'envoi des emails : ${chemin}.`);
  }
}

/**
 * Expéditeur affiché, commun aux deux chemins.
 *
 * `MAIL_FROM` est le nom canonique depuis S22m — il ne nomme plus un protocole
 * que ZeptoMail n'utilise pas. `SMTP_FROM` reste accepté et prioritaire sur le
 * défaut : il est DÉJÀ POSÉ en production, et le retirer d'un coup ferait partir
 * les premiers emails ZeptoMail depuis une adresse déduite.
 *
 * Le défaut n'est pas une erreur : un opérateur qui configure l'envoi et oublie
 * l'expéditeur doit voir partir des messages, quitte à corriger l'adresse
 * ensuite. Sans hôte SMTP d'où déduire un domaine (chemin ZeptoMail), le défaut
 * porte `lalanda.co` — que Zoho refusera si le domaine expéditeur diffère, avec
 * un message explicite. Un refus lisible vaut mieux qu'une adresse inventée.
 */
function fromAddress(smtpHost: string | null): string {
  const explicite = process.env['MAIL_FROM']?.trim() || process.env['SMTP_FROM']?.trim();
  if (explicite) return explicite;
  return `Lalanda <no-reply@${smtpHost ? hostToDomain(smtpHost) : 'lalanda.co'}>`;
}

/** Hôte d'une URL, ou l'URL brute si elle est illisible — usage journal seulement. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
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
