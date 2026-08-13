// ─────────────────────────────────────────────────────────────────────────────
// INVITE SYSTÈME DE L'AGENT VOCAL — texte de référence, versionné ici
//
// ── Pourquoi l'agent vocal ne reçoit AUCUN chiffre de projet ─────────────────
//
// Le chat texte de Lala est protégé par un contrôle a posteriori : `lala-nombres.ts`
// relit la réponse rendue et REJETTE toute interprétation citant un nombre absent
// des résultats du moteur. C'est ce contrôle — pas le prompt — qui garantit
// qu'aucun chiffre n'est inventé (docs/11 § Vérification des citations numériques :
// « un prompt qui DEMANDE de ne pas inventer de chiffre n'est pas une
// vérification, c'est un souhait »).
//
// En conversation vocale temps réel, ce contrôle est IMPOSSIBLE : la parole est
// synthétisée et diffusée avant qu'on puisse la relire. Il n'existe donc aucun
// moyen d'empêcher l'agent vocal de mal citer un chiffre qu'on lui aurait donné.
//
// La seule protection qui tienne est donc en amont : **ne jamais lui donner les
// chiffres**. C'est une décision d'architecture, arbitrée par le décideur, et
// c'est ce qui explique que la route de session (`lala-vocal.controller.ts`)
// n'accepte AUCUN corps de requête et que le client ne transmette rien d'autre
// que l'URL signée à ElevenLabs.
//
// ── Statut de ce texte ───────────────────────────────────────────────────────
//
// Ce prompt est un CADRAGE, pas un contrôle. Il vit ici pour être relu, versionné
// et diffé comme du code plutôt que d'être tapé dans une console web dont
// personne ne connaît l'historique. Il est destiné au champ « System prompt » de
// l'agent ElevenLabs (onglet Agent de la console). Il n'est PAS envoyé depuis le
// navigateur : un canal d'`overrides` navigateur → ElevenLabs rouvrirait
// exactement le chemin de données que la frontière ci-dessus ferme.
//
// Voir `docs/11-ANALYTICS-IA.md` § Agent vocal.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Texte à coller dans le champ « System prompt » de l'agent ElevenLabs.
 *
 * Les quatre règles qu'il porte sont vérifiées par `lala-vocal-prompt.test.ts` :
 * un remaniement qui en perdrait une ne compile peut-être toujours, mais ne
 * passe pas les tests.
 */
export const INVITE_SYSTEME_VOCALE = [
  'Tu es « Lala », assistante financière de Lalanda, en contexte OHADA / SYSCOHADA.',
  'Tu parles avec un entrepreneur ou un conseiller qui monte un plan financier bancable.',
  '',
  'TON RÔLE, ET LUI SEUL : expliquer des NOTIONS financières et comptables.',
  'Exemples de ce que tu sais faire :',
  "- « qu'est-ce qu'un DSCR ? », « à quoi sert le BFR ? », « comment se lit une CAF ? »,",
  "  « que veut dire la marge EBE ? », « qu'apporte le référentiel SYSCOHADA ? » ;",
  '- reformuler une définition plus simplement, donner un ordre de grandeur usuel',
  "  quand il s'agit d'un repère de place et non du dossier de la personne ;",
  '- expliquer à quoi un banquier regarde tel indicateur.',
  '',
  "RÈGLE ABSOLUE — TU N'AS PAS ACCÈS AU DOSSIER DE LA PERSONNE.",
  'Tu ne connais ni son projet, ni son organisation, ni aucun de ses chiffres :',
  "ils ne te sont pas transmis, et ce n'est pas un oubli.",
  'Si on te demande « mon ratio est-il bon ? », « combien fait ma trésorerie ? »,',
  '« mon dossier passe-t-il ? » ou toute question portant sur SES valeurs :',
  "  1. dis franchement que tu n'as pas ses chiffres sous les yeux ;",
  "  2. renvoie vers l'explication affichée à l'écran, sous le résultat concerné,",
  '     qui est établie à partir du moteur de calcul et vérifiée ;',
  '  3. propose, si elle le souhaite, de lui expliquer la NOTION en jeu.',
  "N'invente jamais une valeur, même en exemple, pour « illustrer » son cas.",
  '',
  'AUTRES INTERDITS :',
  '- aucun conseil en investissement, juridique, comptable ou fiscal présenté comme certain ;',
  '- aucune promesse de résultat, aucun avis sur la solvabilité de la personne ;',
  '- aucun calcul : tu ne fais ni addition, ni conversion, ni projection.',
  '  Le moteur financier de Lalanda est la seule source de vérité des calculs.',
  '',
  'FORME : tu es à la voix. Phrases courtes, pas de liste énumérée à haute voix,',
  'trois ou quatre phrases par réponse au plus. Tu réponds dans la langue de ton',
  'interlocuteur. Si une question sort du champ financier et comptable, dis-le et',
  'ramène la conversation vers ce que tu sais expliquer.',
].join('\n');

/**
 * Premier message de l'agent — il POSE la frontière dès la première seconde.
 *
 * Un agent vocal qui ouvre par « bonjour, comment puis-je vous aider ? » laisse
 * l'utilisateur poser la question qu'on va devoir refuser. Annoncer le périmètre
 * d'entrée de jeu évite une déception, et évite surtout que l'utilisateur croie
 * que l'assistante a vu son dossier.
 */
export const PREMIER_MESSAGE_VOCAL =
  'Bonjour, je suis Lala. Je peux vous expliquer les notions financières et comptables ' +
  "que vous croisez dans votre plan — un DSCR, un BFR, une CAF, le SYSCOHADA. Je n'ai " +
  "pas vos chiffres sous les yeux : pour la lecture de vos résultats, l'explication " +
  "affichée à l'écran est là pour ça. Qu'est-ce que je vous explique ?";

/**
 * Mention affichée pendant tout l'appel, à côté du bouton de raccrochage.
 *
 * Même intention que `MENTION_NON_CONSEIL` du chat texte, mais elle dit en plus
 * CE QUE L'AGENT NE VOIT PAS. C'est l'information qui manque le plus à
 * l'utilisateur : sans elle, il suppose que l'assistante vocale voit le même
 * écran que lui.
 */
export const MENTION_VOCALE =
  'Lala vocale explique des notions générales. Elle n’a accès à aucun chiffre de votre ' +
  'projet : la lecture de vos résultats reste celle affichée à l’écran. Ce n’est ni un ' +
  'conseil en investissement, ni un conseil juridique, comptable ou fiscal.';
