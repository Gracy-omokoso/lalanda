// Modèle pur de la grille des autorisations — ADR-0041 § 7, lot A5.
//
// Calcule ce que l'écran AFFICHE : l'état de chaque autorisation par rapport au
// titre (inclus, ajouté, retiré, non inclus), les raisons d'indisponibilité, les
// dépendances cochées ou décochées avec elles, la phrase d'écart et l'écart à
// envoyer. Tout le vocabulaire vient de `GET /authz/catalog` ; aucune table de la
// matrice n'est recopiée ici.
//
// Rien de ce fichier n'AUTORISE : le serveur (`validateOverrides`) reste seul
// juge. Une divergence produit au pire un refus explicite, jamais un droit.

import type { OrgAction, OrgRole } from '@/lib/api';
import {
  CODE_PERSONNALISATION_DESACTIVEE,
  type CatalogueAutorisations,
  type Ecart,
  type MembreAutorisations,
} from '@/lib/api-permissions';

import { codeErreur, messageErreur } from './members-model';

/** Les quatre états lisibles sans couleur (ADR-0041 § 7). */
export type EtatAutorisation = 'titre' | 'ajoute' | 'retire' | 'non_inclus';

export const LIBELLE_ETAT: Readonly<Record<EtatAutorisation, string>> = {
  titre: 'Inclus dans le titre',
  ajoute: 'Ajout',
  retire: 'Retrait',
  non_inclus: 'Non inclus',
};

export interface LigneAutorisation {
  action: OrgAction;
  libelle: string;
  coche: boolean;
  etat: EtatAutorisation;
  /** Raison pour laquelle la case ne peut pas être changée ; `null` si elle peut l'être. */
  raison: string | null;
}

export interface DomaineGrille {
  cle: string;
  libelle: string;
  lignes: LigneAutorisation[];
  detenues: number;
  total: number;
}

/** Où la grille est ouverte : la case ⚙ ne s'accorde qu'après l'acceptation. */
export type ContexteGrille = 'membre' | 'invitation';

export interface ParametresGrille {
  catalogue: CatalogueAutorisations;
  /** Ligne du titre (cases accordées), sans la case ⚙. */
  base: readonly OrgAction[];
  /** Case(s) ⚙ du titre — comptée(s) comme détenue(s) pour la séparation des tâches. */
  conditionnelles: readonly OrgAction[];
  /** Autorisations actuellement cochées. */
  selection: ReadonlySet<OrgAction>;
  contexte: ContexteGrille;
  /** Ce que l'acteur peut ajouter à autrui (`grantableActions` de `GET /me/permissions`). */
  ajoutables: readonly OrgAction[];
  /** Verrou de toute la fiche (interrupteur, soi-même, Propriétaire…) ; `null` sinon. */
  verrou: string | null;
}

// ─── Titres ─────────────────────────────────────────────────────────────────

export interface LigneTitre {
  base: OrgAction[];
  conditionnelles: OrgAction[];
}

/**
 * Ligne d'un titre selon le catalogue. Pour un titre absent du catalogue (non
 * attribuable), on la reconstitue depuis le membre : effectif − ajouts + retraits.
 */
export function ligneDuTitre(
  catalogue: CatalogueAutorisations,
  role: OrgRole,
  membre?: Pick<MembreAutorisations, 'effective' | 'grants' | 'revokes' | 'canClosePeriods'>,
): LigneTitre {
  const ligne = catalogue.roleMatrix.find((r) => r.role === role);
  if (ligne) return { base: [...ligne.actions], conditionnelles: [...ligne.conditional] };
  if (!membre) return { base: [], conditionnelles: [] };
  const ajouts = new Set(membre.grants);
  const base = new Set(membre.effective.filter((a) => !ajouts.has(a)));
  for (const a of membre.revokes) base.add(a);
  return { base: ordonner(catalogue, base), conditionnelles: [] };
}

/** Toutes les actions du catalogue, dans l'ordre d'affichage des domaines. */
export function actionsDuCatalogue(catalogue: CatalogueAutorisations): OrgAction[] {
  return catalogue.domains.flatMap((d) => d.actions);
}

export function ordonner(
  catalogue: CatalogueAutorisations,
  actions: Iterable<OrgAction>,
): OrgAction[] {
  const set = new Set(actions);
  return actionsDuCatalogue(catalogue).filter((a) => set.has(a));
}

export function libelle(catalogue: CatalogueAutorisations, action: OrgAction): string {
  return catalogue.labels[action] ?? action;
}

const guillemets = (s: string): string => `« ${s} »`;

function listeLibelles(catalogue: CatalogueAutorisations, actions: readonly OrgAction[]): string {
  return actions.map((a) => guillemets(libelle(catalogue, a))).join(', ');
}

// ─── Dépendances ────────────────────────────────────────────────────────────

/** Tout ce qu'exige `action` : dépendances transitives et socle (ADR-0041 § 4). */
export function exigences(catalogue: CatalogueAutorisations, action: OrgAction): OrgAction[] {
  const requises = new Set<OrgAction>();
  const aTraiter: OrgAction[] = [...(catalogue.dependencies[action] ?? [])];
  if (action !== catalogue.baseAction) aTraiter.push(catalogue.baseAction);
  while (aTraiter.length > 0) {
    const suivante = aTraiter.pop() as OrgAction;
    if (requises.has(suivante) || suivante === action) continue;
    requises.add(suivante);
    aTraiter.push(...(catalogue.dependencies[suivante] ?? []));
  }
  return ordonner(catalogue, requises);
}

/** Actions de `selection` qui exigent `action` (directement ou non). */
export function dependantes(
  catalogue: CatalogueAutorisations,
  action: OrgAction,
  selection: ReadonlySet<OrgAction>,
): OrgAction[] {
  return ordonner(
    catalogue,
    [...selection].filter((a) => a !== action && exigences(catalogue, a).includes(action)),
  );
}

// ─── Raisons d'indisponibilité ──────────────────────────────────────────────

function pairesEnConflit(
  p: ParametresGrille,
  candidate: ReadonlySet<OrgAction>,
): [OrgAction, OrgAction] | null {
  const natif = new Set([...p.base, ...p.conditionnelles]);
  // Ensemble POTENTIEL (G4) : la case ⚙ est comptée comme détenue.
  const potentiel = new Set([...candidate, ...p.conditionnelles]);
  for (const [a, b] of p.catalogue.sodPairs) {
    if (natif.has(a) && natif.has(b)) continue;
    if (potentiel.has(a) && potentiel.has(b)) return [a, b];
  }
  return null;
}

/**
 * Pourquoi cette case ne peut-elle pas changer d'état ? `null` si elle le peut.
 * Ordre : verrou de fiche, case ⚙ à l'invitation, socle, puis — pour cocher —
 * non délégable (G3), non détenu (G1), séparation des tâches (G4).
 */
export function raisonIndisponible(p: ParametresGrille, action: OrgAction): string | null {
  if (p.verrou) return p.verrou;
  const coche = p.selection.has(action);
  const { catalogue } = p;

  if (p.contexte === 'invitation' && p.conditionnelles.includes(action)) {
    return 'S’accorde au cas par cas, une fois l’invitation acceptée.';
  }

  if (coche) {
    if (action === catalogue.baseAction && [...p.selection].some((a) => a !== action)) {
      return 'Socle : reste accordé tant qu’une autre autorisation l’est.';
    }
    return null;
  }

  // Cocher : l'action et tout ce qu'elle exige.
  const ajoutees = [action, ...exigences(catalogue, action)].filter(
    (a) => !p.selection.has(a) && !p.base.includes(a),
  );
  if (catalogue.nonDelegable.includes(action) && !p.base.includes(action)) {
    return 'Réservé au Propriétaire.';
  }
  const ajoutables = new Set(p.ajoutables);
  if (ajoutees.includes(action) && !ajoutables.has(action)) {
    return 'Vous ne détenez pas cette autorisation.';
  }
  const manquantes = ajoutees.filter((a) => a !== action && !ajoutables.has(a));
  if (manquantes.length > 0) {
    return `Exige ${listeLibelles(catalogue, manquantes)}, que vous ne détenez pas.`;
  }
  const candidate = new Set([...p.selection, action, ...exigences(catalogue, action)]);
  const conflit = pairesEnConflit(p, candidate);
  if (conflit) {
    const autre = conflit[0] === action ? conflit[1] : conflit[0];
    return `Incompatible avec ${guillemets(libelle(catalogue, autre))} — séparation des tâches.`;
  }
  return null;
}

// ─── Grille ─────────────────────────────────────────────────────────────────

export function etatDe(
  base: readonly OrgAction[],
  selection: ReadonlySet<OrgAction>,
  action: OrgAction,
): EtatAutorisation {
  const dansTitre = base.includes(action);
  const coche = selection.has(action);
  if (dansTitre) return coche ? 'titre' : 'retire';
  return coche ? 'ajoute' : 'non_inclus';
}

export function construireGrille(p: ParametresGrille): DomaineGrille[] {
  return p.catalogue.domains.map((d) => {
    const lignes = d.actions.map<LigneAutorisation>((action) => ({
      action,
      libelle: libelle(p.catalogue, action),
      coche: p.selection.has(action),
      etat: etatDe(p.base, p.selection, action),
      raison: raisonIndisponible(p, action),
    }));
    return {
      cle: d.key,
      libelle: d.label,
      lignes,
      detenues: lignes.filter((l) => l.coche).length,
      total: lignes.length,
    };
  });
}

/** « Ventes et facturation : 4 sur 6 ». */
export function compteDomaine(d: Pick<DomaineGrille, 'libelle' | 'detenues' | 'total'>): string {
  return `${d.libelle} : ${d.detenues} sur ${d.total}`;
}

// ─── Bascule d'une case, avec dépendances ───────────────────────────────────

export interface Bascule {
  selection: Set<OrgAction>;
  /** Ce qui a été coché ou décoché avec la case, dit en clair ; `null` sinon. */
  message: string | null;
}

/**
 * Coche ou décoche une case. Cocher coche ce qu'elle exige ; décocher décoche ce
 * qui en dépend (ADR-0041 § 4, décision n° 2). Une case indisponible ne bouge pas.
 */
export function basculer(p: ParametresGrille, action: OrgAction): Bascule {
  const selection = new Set(p.selection);
  if (raisonIndisponible(p, action) !== null) return { selection, message: null };
  const { catalogue } = p;
  const nom = guillemets(libelle(catalogue, action));

  if (selection.has(action)) {
    const entrainees = dependantes(catalogue, action, selection);
    selection.delete(action);
    for (const a of entrainees) selection.delete(a);
    return {
      selection,
      message:
        entrainees.length > 0
          ? `${nom} décochée : ${listeLibelles(catalogue, entrainees)} ${
              entrainees.length > 1
                ? 'en dépendent et ont été décochées'
                : 'en dépend et a été décochée'
            } aussi.`
          : null,
    };
  }

  const entrainees = exigences(catalogue, action).filter((a) => !selection.has(a));
  selection.add(action);
  for (const a of entrainees) selection.add(a);
  return {
    selection,
    message:
      entrainees.length > 0
        ? `${nom} exige ${listeLibelles(catalogue, entrainees)} : ${
            entrainees.length > 1 ? 'cochées' : 'cochée'
          } aussi.`
        : null,
  };
}

// ─── Écart ──────────────────────────────────────────────────────────────────

/** Écart affiché : ce qui est coché hors titre, ce qui est décoché dans le titre. */
export function ecartAffiche(
  catalogue: CatalogueAutorisations,
  base: readonly OrgAction[],
  selection: ReadonlySet<OrgAction>,
): Ecart {
  const dansTitre = new Set(base);
  return {
    grants: ordonner(
      catalogue,
      [...selection].filter((a) => !dansTitre.has(a)),
    ),
    revokes: ordonner(
      catalogue,
      base.filter((a) => !selection.has(a)),
    ),
  };
}

/**
 * Écart à envoyer à l'API. La case ⚙ du Comptable passe par les mêmes listes
 * (ADR-0041 § 1 : `period.close` en ajout l'accorde, en retrait la retire) ; on ne
 * l'envoie en retrait que si elle était accordée, pour ne rien écrire d'inutile.
 */
export function ecartAEnvoyer(
  catalogue: CatalogueAutorisations,
  ligne: LigneTitre,
  selection: ReadonlySet<OrgAction>,
  conditionnellesAccordees: boolean,
): Ecart {
  const { grants, revokes } = ecartAffiche(catalogue, ligne.base, selection);
  const retraitsConditionnels = conditionnellesAccordees
    ? ligne.conditionnelles.filter((a) => !selection.has(a))
    : [];
  return { grants, revokes: ordonner(catalogue, [...revokes, ...retraitsConditionnels]) };
}

export function memeEcart(a: Ecart, b: Ecart): boolean {
  return a.grants.join(',') === b.grants.join(',') && a.revokes.join(',') === b.revokes.join(',');
}

const pluriel = (n: number, un: string, plusieurs: string): string =>
  `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Phrase d'écart (ADR-0041 § 7) :
 * « Comptable, personnalisé : + Gérer les projets, − Émettre et normaliser… »
 * ou, sans écart, « Comptable — 14 autorisations, celles du titre. »
 */
export function phraseEcart(
  catalogue: CatalogueAutorisations,
  titre: string,
  base: readonly OrgAction[],
  ecart: Ecart,
): string {
  if (ecart.grants.length === 0 && ecart.revokes.length === 0) {
    return `${titre} — ${pluriel(base.length, 'autorisation', 'autorisations')}, celles du titre.`;
  }
  const morceaux = [
    ...ecart.grants.map((a) => `+ ${libelle(catalogue, a)}`),
    ...ecart.revokes.map((a) => `− ${libelle(catalogue, a)}`),
  ];
  return `${titre}, personnalisé : ${morceaux.join(', ')}`;
}

/** Avertissement avant un changement de titre qui efface l'écart (décision n° 1). */
export function avertissementChangementTitre(
  membre: Pick<MembreAutorisations, 'grants' | 'revokes'>,
): string | null {
  const a = membre.grants.length;
  const r = membre.revokes.length;
  if (a === 0 && r === 0) return null;
  const parts = [
    a > 0 ? pluriel(a, 'ajout', 'ajouts') : null,
    r > 0 ? pluriel(r, 'retrait', 'retraits') : null,
  ].filter((x): x is string => x !== null);
  return `Les ${parts.join(' et ')} de cette personne seront effacés : elle repartira des autorisations du nouveau titre.`;
}

// ─── Verrou de la fiche ─────────────────────────────────────────────────────

export const MESSAGE_PERSONNALISATION_A_VENIR =
  'La personnalisation des autorisations sera bientôt disponible. Pour l’instant, seul le titre s’attribue.';

/** Verrou global d'une fiche de membre (G2, G3, G1), ou `null`. */
export function verrouFiche(
  membre: Pick<MembreAutorisations, 'userId' | 'role' | 'manageable'>,
  moiUserId: string | null,
  personnalisationDesactivee: boolean,
): string | null {
  if (personnalisationDesactivee) return MESSAGE_PERSONNALISATION_A_VENIR;
  if (moiUserId !== null && membre.userId === moiUserId) {
    return 'Vous ne pouvez pas modifier vos propres autorisations.';
  }
  if (membre.role === 'owner') {
    return 'Les autorisations d’un Propriétaire ne se personnalisent pas : elles sont celles du titre.';
  }
  if (!membre.manageable) return 'Ce membre détient des autorisations que vous n’avez pas.';
  return null;
}

/**
 * L'interrupteur `MEMBER_PERMISSIONS_ENABLED` est-il éteint, d'après ce que
 * l'API a dit ? Un `409 MEMBER_PERMISSIONS_DISABLED`, ou un `false` explicite
 * dans le catalogue ou `/me/permissions` s'ils le publient un jour.
 */
export function personnalisationDesactivee(sources: {
  erreur?: unknown;
  catalogue?: Pick<CatalogueAutorisations, 'memberPermissionsEnabled'> | null;
  moi?: { memberPermissionsEnabled?: boolean } | null;
}): boolean {
  if (
    sources.erreur !== undefined &&
    codeErreur(sources.erreur) === CODE_PERSONNALISATION_DESACTIVEE
  ) {
    return true;
  }
  return (
    sources.catalogue?.memberPermissionsEnabled === false ||
    sources.moi?.memberPermissionsEnabled === false
  );
}

// ─── Messages d'erreur ──────────────────────────────────────────────────────

function detailDe(err: unknown): Record<string, unknown> {
  if (typeof err !== 'object' || err === null || !('detail' in err)) return {};
  const d = (err as { detail: unknown }).detail;
  return typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : {};
}

function actionsDe(valeur: unknown): OrgAction[] {
  return Array.isArray(valeur) ? valeur.filter((v): v is OrgAction => typeof v === 'string') : [];
}

/** Un message clair pour chaque code d'erreur des autorisations (ADR-0041 § 6). */
export function messageAutorisations(
  err: unknown,
  catalogue: CatalogueAutorisations | null,
  repli: string,
): string {
  const code = codeErreur(err);
  const d = detailDe(err);
  const noms = (actions: OrgAction[]): string =>
    catalogue && actions.length > 0 ? ` : ${listeLibelles(catalogue, actions)}` : '';

  switch (code) {
    case 'MEMBER_PERMISSIONS_DISABLED':
      return MESSAGE_PERSONNALISATION_A_VENIR;
    case 'STALE_REVISION':
      return 'Quelqu’un a modifié ces autorisations entre-temps. La fiche a été rechargée : vérifiez puis recommencez.';
    case 'PERMISSION_ESCALATION':
      return `Vous ne pouvez accorder, ni modifier chez autrui, que des autorisations que vous détenez${noms(actionsDe(d['actions']))}.`;
    case 'SELF_PERMISSIONS_FORBIDDEN':
      return 'Vous ne pouvez pas modifier vos propres autorisations : une autre personne habilitée doit le faire.';
    case 'PERMISSION_NOT_DELEGABLE':
      return `Autorisation réservée au Propriétaire, qui ne peut pas être accordée${noms(actionsDe(d['actions']))}.`;
    case 'PERMISSION_OVERRIDE_REDUNDANT':
      return `Ajout ou retrait sans objet par rapport au titre${noms(actionsDe(d['actions']))}. Rechargez la fiche et recommencez.`;
    case 'PERMISSION_DEPENDENCY_MISSING': {
      const action = typeof d['action'] === 'string' ? (d['action'] as OrgAction) : null;
      const manquantes = actionsDe(d['missing']);
      if (catalogue && action && manquantes.length > 0) {
        return `${guillemets(libelle(catalogue, action))} exige ${listeLibelles(catalogue, manquantes)}.`;
      }
      return 'Une autorisation en exige une autre qui n’est pas cochée.';
    }
    case 'SOD_CONFLICT': {
      const paire = actionsDe(d['pair']);
      if (catalogue && paire.length === 2) {
        return `${listeLibelles(catalogue, paire).replace(', ', ' et ')} ne peuvent pas être détenues ensemble : séparation des tâches.`;
      }
      return 'Ces deux autorisations ne peuvent pas être détenues ensemble : séparation des tâches.';
    }
    case 'OWNER_PERMISSIONS_FIXED':
      return 'Les autorisations d’un Propriétaire ne se personnalisent pas.';
    case 'INVITATION_INVITER_NO_LONGER_AUTHORIZED':
      return 'La personne qui a invité ne détient plus les autorisations accordées par l’invitation. Demandez-lui d’en créer une nouvelle.';
    case 'INVALID_REQUEST':
      return 'La demande n’a pas pu être lue. Rechargez la page et recommencez.';
    default:
      return messageErreur(err, repli);
  }
}
