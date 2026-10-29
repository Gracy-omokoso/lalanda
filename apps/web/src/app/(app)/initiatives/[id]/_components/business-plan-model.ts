// Logique pure de l'écran « Business plan » (ADR-0037) — testée sans DOM.
//
// Rien ici n'autorise quoi que ce soit : le serveur refuse de toute façon
// (`PermissionsGuard`, séparation des tâches, blocages de validation). L'écran
// ne fait que dire à l'avance ce que le serveur répondra.

import type { BusinessPlanView, DraftResult, SectionView } from '@/lib/business-plan-api';

/** Étiquette d'origine d'un texte de section, jamais devinée. */
export function libelleOrigine(s: Pick<SectionView, 'origin' | 'empty'>): string | null {
  if (s.empty) return null;
  return s.origin === 'ai_accepted' ? 'Rédigé avec l’IA, accepté par vous' : 'Rédigé par vous';
}

/** Statut du document affiché en tête. */
export function statutDocument(v: Pick<BusinessPlanView, 'versions' | 'changedSinceLastVersion'>): {
  libelle: string;
  ton: 'success' | 'warning' | 'neutral';
} {
  const derniere = v.versions[0];
  if (!derniere) return { libelle: 'Brouillon — jamais validé', ton: 'neutral' };
  if (v.changedSinceLastVersion) {
    return { libelle: `Brouillon modifié depuis la version ${derniere.version}`, ton: 'warning' };
  }
  return { libelle: `Validé — version ${derniere.version}`, ton: 'success' };
}

/** Empreinte abrégée pour l'affichage ; l'empreinte complète reste dans l'infobulle et le PDF. */
export function empreinteCourte(sha: string | null): string {
  return sha ? `${sha.slice(0, 12)}…` : '—';
}

/** Message à afficher après une demande de brouillon. */
export function messageBrouillon(r: DraftResult): {
  ton: 'success' | 'warning' | 'danger';
  texte: string;
} {
  if (r.proposal) {
    return {
      ton: 'success',
      texte: 'Brouillon proposé par l’IA : relisez-le, puis acceptez-le ou écartez-le.',
    };
  }
  switch (r.reason) {
    case 'rejetee':
      return {
        ton: 'warning',
        texte:
          'La réponse de l’IA a été écartée par le contrôle de Lalanda' +
          (r.detail ? ` (${r.detail})` : '') +
          '. Rien n’a été enregistré ni décompté. Réessayez ou rédigez vous-même.',
      };
    case 'desactivee_organisation':
      return { ton: 'warning', texte: 'L’aide IA est désactivée pour votre organisation.' };
    case 'desactivee_plateforme':
      return { ton: 'warning', texte: 'L’aide IA est momentanément désactivée.' };
    default:
      return {
        ton: 'danger',
        texte:
          'L’IA est indisponible pour le moment. Rédigez la section à l’aide des questions guides.',
      };
  }
}

/** Le bouton « Valider » est-il proposé, et sinon pourquoi ? */
export function etatValidation(v: Pick<BusinessPlanView, 'permissions' | 'blockers'>): {
  possible: boolean;
  raisons: string[];
} {
  if (!v.permissions.validate) {
    return { possible: false, raisons: ['Votre rôle ne permet pas de valider ce document.'] };
  }
  return { possible: v.blockers.length === 0, raisons: v.blockers.map((b) => b.message) };
}

/** Avancement : sections renseignées sur neuf. */
export function avancement(sections: readonly Pick<SectionView, 'empty'>[]): string {
  const pleines = sections.filter((s) => !s.empty).length;
  return `${pleines} / ${sections.length} sections renseignées`;
}
