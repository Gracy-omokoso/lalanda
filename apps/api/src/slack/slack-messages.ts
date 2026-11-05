// Messages Slack (Block Kit) des Projets — ADR-0064 § 5. Fonctions pures, testées.
//
// Courts et en français : QUOI (l'événement), le PROJET, la TÂCHE (titre déjà formé par
// le module `work`), un bouton vers Lalanda. Jamais de donnée financière : le module
// `work` n'en met dans aucun titre de notification, et ce fichier n'en ajoute aucune.
//
// Le lien est construit ICI à partir d'un chemin RELATIF et de `WEB_URL` (même règle
// que l'e-mail, `MailService.sendWorkNotification`) : une URL absolue reçue n'est
// jamais suivie.

/** Échappe le texte pour le mrkdwn de Slack (`&`, `<`, `>`). */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Coupe un texte trop long (Slack limite une section à 3 000 caractères). */
function bound(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Lien absolu vers l'application, à partir d'un chemin relatif contrôlé. */
export function lalandaLink(webUrl: string, href: string): string {
  const path = /^\/[^/]/.test(href) ? href : '/projets';
  return `${webUrl.replace(/\/+$/, '')}${path}`;
}

export interface SlackWorkMessageInput {
  /** Libellé de l'événement (« Une tâche m’est assignée », « Tâche déplacée »…). */
  eventLabel: string;
  /** Titre de la notification (tâche, auteur du geste). */
  title: string;
  projectName: string | null;
  organizationName: string;
  url: string;
}

export interface SlackMessage {
  text: string;
  blocks: unknown[];
}

export function slackWorkMessage(input: SlackWorkMessageInput): SlackMessage {
  const label = bound(input.eventLabel, 150);
  const title = bound(input.title, 500);
  const project = input.projectName ? bound(input.projectName, 150) : null;
  const where = project
    ? `Projet : ${slackEscape(project)} · ${slackEscape(input.organizationName)}`
    : slackEscape(input.organizationName);
  return {
    // Texte de repli : notification mobile et lecteurs d'écran.
    text: bound(`${label} — ${title}${project ? ` (${project})` : ''}`, 1000),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${slackEscape(label)}*\n${slackEscape(title)}` },
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: where }] },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Ouvrir dans Lalanda', emoji: false },
            url: input.url,
          },
        ],
      },
    ],
  };
}
