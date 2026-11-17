// Modèles WhatsApp (« templates » Meta) de Lalanda — ADR-0065 § 4. LISTE FERMÉE.
//
// Hors de la fenêtre de 24 h ouverte par un message de la personne, Meta n'accepte que
// des modèles SOUMIS et APPROUVÉS à l'avance, avec leurs variables `{{1}}`, `{{2}}`…
// Lalanda n'envoie donc que ceux déclarés ici, en français (`fr`). Le texte EXACT à
// soumettre à Meta est celui de `body` / `footer` / `button` ci-dessous ; il est
// recopié dans `docs/integrations/whatsapp.md` (le test unitaire vérifie la recopie).
//
// Règles Meta respectées : une variable n'ouvre ni ne ferme le corps ; deux variables
// ne se suivent pas ; une variable ne contient ni saut de ligne, ni tabulation, ni plus
// de quatre espaces de suite (assaini par `templateParam`). Aucune donnée financière :
// les titres viennent des notifications `work`, qui n'en portent jamais.

import type { WorkNotificationEvent } from '@lalanda/shared/work';

import type { WhatsAppTemplateComponent, WhatsAppTemplateMessage } from './whatsapp-api.js';

export const WHATSAPP_TEMPLATE_LANGUAGE = 'fr';

/** Origine web inscrite dans le bouton des modèles (fixée à la soumission chez Meta). */
export const WHATSAPP_TEMPLATE_WEB_ORIGIN = 'https://app.lalanda.co';

export interface WhatsAppTemplateSpec {
  name: string;
  /** Catégorie Meta : « Utilitaire » ou « Authentification ». */
  category: 'UTILITY' | 'AUTHENTICATION';
  /** Corps EXACT à soumettre (variables `{{n}}`). */
  body: string;
  /** Ce que porte chaque variable du corps, dans l'ordre. */
  params: readonly string[];
  /** Exemples de valeurs demandés par Meta à la soumission. */
  examples: readonly string[];
  footer: string | null;
  button:
    | { type: 'URL'; text: string; url: string; example: string }
    | { type: 'COPY_CODE'; text: string };
}

const STOP = 'Répondez STOP pour ne plus recevoir ces messages.';
const OUVRIR = {
  type: 'URL' as const,
  text: 'Ouvrir dans Lalanda',
  url: `${WHATSAPP_TEMPLATE_WEB_ORIGIN}/{{1}}`,
  example: 'projets/6650a1b2c3d4e5f601234567?tache=6650a1b2c3d4e5f601234568',
};

export const WHATSAPP_TEMPLATES = {
  lalanda_tache_assignee: {
    name: 'lalanda_tache_assignee',
    category: 'UTILITY',
    body:
      'Bonjour, une tâche vous a été assignée dans Lalanda.\n\n' +
      'Tâche : {{1}}\nProjet : {{2}}\nOrganisation : {{3}}\n\n' +
      'Ouvrez Lalanda pour la consulter.',
    params: ['titre de la tâche', 'nom du projet', 'nom de l’organisation'],
    examples: ['#12 Maquette de l’accueil — assignée par Gracy', 'Refonte du site', 'Go freelance'],
    footer: STOP,
    button: OUVRIR,
  },
  lalanda_mention: {
    name: 'lalanda_mention',
    category: 'UTILITY',
    body:
      'Bonjour, vous avez été mentionné dans Lalanda.\n\n' +
      'Sujet : {{1}}\nProjet : {{2}}\nOrganisation : {{3}}\n\n' +
      'Ouvrez Lalanda pour répondre.',
    params: ['sujet (tâche et auteur)', 'nom du projet', 'nom de l’organisation'],
    examples: ['Gracy vous a mentionné sur #12 Maquette', 'Refonte du site', 'Go freelance'],
    footer: STOP,
    button: OUVRIR,
  },
  lalanda_echeance_depassee: {
    name: 'lalanda_echeance_depassee',
    category: 'UTILITY',
    body:
      'Bonjour, l’échéance d’une de vos tâches est dépassée.\n\n' +
      'Tâche : {{1}}\nProjet : {{2}}\nOrganisation : {{3}}\n\n' +
      'Ouvrez Lalanda pour la mettre à jour.',
    params: ['titre de la tâche', 'nom du projet', 'nom de l’organisation'],
    examples: ['#12 Maquette de l’accueil', 'Refonte du site', 'Go freelance'],
    footer: STOP,
    button: OUVRIR,
  },
  lalanda_notification_projet: {
    name: 'lalanda_notification_projet',
    category: 'UTILITY',
    body:
      'Bonjour, vous avez une nouvelle notification des Projets dans Lalanda.\n\n' +
      'Événement : {{1}}\nDétail : {{2}}\nProjet : {{3}}\nOrganisation : {{4}}\n\n' +
      'Ouvrez Lalanda pour en savoir plus.',
    params: ['événement', 'détail (tâche, auteur)', 'nom du projet', 'nom de l’organisation'],
    examples: [
      'Commentaire sur une tâche que je suis',
      'Gracy a commenté #12 Maquette',
      'Refonte du site',
      'Go freelance',
    ],
    footer: STOP,
    button: OUVRIR,
  },
  lalanda_code_verification: {
    name: 'lalanda_code_verification',
    category: 'AUTHENTICATION',
    // Modèle d'authentification : Meta impose son texte (« {{1}} est votre code de
    // vérification. ») et ajoute, sur option cochée à la soumission, la recommandation
    // de sécurité et la durée de validité. Le bouton « Copier le code » est obligatoire.
    body: '*{{1}}* est votre code de vérification. Pour votre sécurité, ne communiquez pas ce code.',
    params: ['code à 6 chiffres'],
    examples: ['482913'],
    footer: 'Ce code expire dans 10 minutes.',
    button: { type: 'COPY_CODE', text: 'Copier le code' },
  },
} as const satisfies Record<string, WhatsAppTemplateSpec>;

export type WhatsAppTemplateName = keyof typeof WHATSAPP_TEMPLATES;
export const WHATSAPP_TEMPLATE_NAMES = Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateName[];

/**
 * ADR-0079 § 7 : modèles PROPOSÉS pour les notifications hors Projets, à soumettre à Meta.
 * Tant qu'un modèle n'est pas déclaré approuvé (`WHATSAPP_APPROVED_TEMPLATES`, liste
 * séparée par des virgules), le canal WhatsApp est « indisponible pour cet événement »
 * (journalisé `template_unavailable`) : rien ne part, rien ne casse. Texte EXACT recopié
 * dans `docs/integrations/whatsapp.md` (vérifié par le test unitaire).
 */
export const WHATSAPP_PENDING_TEMPLATES = {
  lalanda_notification_generale: {
    name: 'lalanda_notification_generale',
    category: 'UTILITY',
    body:
      'Bonjour, vous avez une nouvelle notification dans Lalanda.\n\n' +
      'Événement : {{1}}\nDétail : {{2}}\nOrganisation : {{3}}\n\n' +
      'Ouvrez Lalanda pour en savoir plus.',
    params: ['événement', 'détail', 'nom de l’organisation'],
    examples: [
      'Une relance m’est assignée',
      'Appeler la société Kin Services — relance assignée par Gracy',
      'Go freelance',
    ],
    footer: STOP,
    button: { ...OUVRIR, example: 'crm/agenda' },
  },
  lalanda_validation_attendue: {
    name: 'lalanda_validation_attendue',
    category: 'UTILITY',
    body:
      'Bonjour, une demande attend votre validation dans Lalanda.\n\n' +
      'Demande : {{1}}\nDétail : {{2}}\nOrganisation : {{3}}\n\n' +
      'Ouvrez Lalanda pour la traiter.',
    params: ['nature de la demande', 'détail', 'nom de l’organisation'],
    examples: [
      'Une demande d’achat attend mon approbation',
      'DA-0042 — demandée par Gracy',
      'Go freelance',
    ],
    footer: STOP,
    button: { ...OUVRIR, example: 'achats/demandes' },
  },
} as const satisfies Record<string, WhatsAppTemplateSpec>;

export type WhatsAppPendingTemplateName = keyof typeof WHATSAPP_PENDING_TEMPLATES;

/**
 * Modèle utilisable pour l'envoi ? Les modèles d'ADR-0065 le sont (déclarés à la
 * soumission, comportement inchangé) ; un modèle proposé l'est une fois inscrit dans
 * `WHATSAPP_APPROVED_TEMPLATES` après l'approbation de Meta.
 */
export function isTemplateApproved(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if ((WHATSAPP_TEMPLATE_NAMES as readonly string[]).includes(name)) return true;
  if (!(name in WHATSAPP_PENDING_TEMPLATES)) return false;
  return (env['WHATSAPP_APPROVED_TEMPLATES'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes(name);
}

/** Modèle d'un événement des Projets : trois dédiés, un générique pour les autres. */
export function templateForEvent(event: WorkNotificationEvent): WhatsAppTemplateName {
  switch (event) {
    case 'task_assigned':
      return 'lalanda_tache_assignee';
    case 'mentioned':
      return 'lalanda_mention';
    case 'task_overdue':
      return 'lalanda_echeance_depassee';
    default:
      return 'lalanda_notification_projet';
  }
}

/** Valeur d'une variable : une ligne, espaces resserrés, bornée, jamais vide. */
export function templateParam(text: string | null | undefined, max = 200): string {
  const one = (text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\{\{|\}\}/g, '')
    .trim();
  if (one === '') return '—';
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/**
 * Suffixe du bouton « Ouvrir dans Lalanda » : chemin RELATIF sans la barre initiale.
 * Une URL absolue, ou un chemin qui ne commence pas par une barre simple, n'est jamais
 * suivie : repli sur `projets` (même règle que l'e-mail et Slack).
 */
export function linkSuffix(href: string): string {
  return /^\/[^/\s]/.test(href) && !/\s/.test(href) ? href.slice(1) : 'projets';
}

function text(t: string): { type: 'text'; text: string } {
  return { type: 'text', text: t };
}

export interface WorkTemplateInput {
  to: string;
  /** Événement ADR-0061 ; absent pour un événement du catalogue ADR-0079. */
  event?: WorkNotificationEvent | undefined;
  /** ADR-0079 § 7 : modèle choisi par le catalogue ; prioritaire sur `event`. */
  template?: string | undefined;
  eventLabel: string;
  title: string;
  projectName: string | null;
  organizationName: string;
  href: string;
}

/** Message d'une notification des Projets, prêt pour `WhatsAppApi.sendTemplate`. */
export function workTemplateMessage(input: WorkTemplateInput): WhatsAppTemplateMessage {
  const name: string =
    input.template &&
    (input.template in WHATSAPP_TEMPLATES || input.template in WHATSAPP_PENDING_TEMPLATES)
      ? input.template
      : input.event
        ? templateForEvent(input.event)
        : 'lalanda_notification_projet';
  const tail = [templateParam(input.projectName, 150), templateParam(input.organizationName, 150)];
  const params =
    name === 'lalanda_notification_projet'
      ? [templateParam(input.eventLabel, 150), templateParam(input.title), ...tail]
      : name in WHATSAPP_PENDING_TEMPLATES
        ? [
            templateParam(input.eventLabel, 150),
            templateParam(input.title),
            templateParam(input.organizationName, 150),
          ]
        : [templateParam(input.title), ...tail];
  const components: WhatsAppTemplateComponent[] = [
    { type: 'body', parameters: params.map(text) },
    { type: 'button', sub_type: 'url', index: '0', parameters: [text(linkSuffix(input.href))] },
  ];
  return { to: input.to, name, language: WHATSAPP_TEMPLATE_LANGUAGE, components };
}

/** Message du code de vérification (modèle d'authentification, bouton « Copier »). */
export function codeTemplateMessage(to: string, code: string): WhatsAppTemplateMessage {
  return {
    to,
    name: 'lalanda_code_verification',
    language: WHATSAPP_TEMPLATE_LANGUAGE,
    components: [
      { type: 'body', parameters: [text(code)] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [text(code)] },
    ],
  };
}
