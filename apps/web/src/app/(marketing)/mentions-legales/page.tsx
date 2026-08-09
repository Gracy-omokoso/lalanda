// ─────────────────────────────────────────────────────────────────────────────
// AVERTISSEMENT — PROJET DE DOCUMENT, NON VALIDÉ JURIDIQUEMENT
//
// Ce texte est un PROJET de mentions légales rédigé par l'équipe produit. Il n'a
// PAS été relu par un juriste et ne doit PAS être présenté comme conforme à un
// droit applicable. Une relecture juridique est un PRÉALABLE à toute mise en
// production. Voir docs/28-CONFORMITE-LEGALE.md.
//
// PAGE LA PLUS EXPOSÉE DU LOT. Des mentions légales n'ont qu'une fonction :
// permettre d'identifier et de joindre l'éditeur d'un service en ligne. Une
// information inventée y est donc pire qu'une information absente — une adresse
// fausse ou un numéro d'immatriculation deviné ne se distingue pas d'une
// information vraie et personne ne pense à la vérifier.
//
// ÉTABLI : le nom de l'éditeur, Televerx LLC. RIEN D'AUTRE. Tout le reste est
// rendu en marqueurs `[À COMPLÉTER]` VISIBLES par le lecteur.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import Link from 'next/link';

import { PUBLISHER_NAME, PUBLISHER_UNKNOWNS, legalDocument } from '@/lib/legal';
import { LegalList, LegalPage, ToComplete, type LegalSection } from '../_components/legal-page';

const doc = legalDocument('mentions-legales');

export const metadata: Metadata = {
  title: `${doc.title} — Lalanda`,
  description: doc.summary,
};

const SECTIONS: readonly LegalSection[] = [
  {
    id: 'editeur',
    title: 'Éditeur du service',
    body: (
      <>
        <p>
          Le service Lalanda, accessible en ligne, est édité par <strong>{PUBLISHER_NAME}</strong>.
        </p>
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="font-semibold">Dénomination</dt>
            <dd>{PUBLISHER_NAME}</dd>
          </div>
          <div>
            <dt className="font-semibold">Forme juridique et immatriculation</dt>
            <dd>
              <ToComplete>
                forme juridique exacte, État ou pays d’immatriculation et numéro d’enregistrement
              </ToComplete>
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Siège social</dt>
            <dd>
              <ToComplete>adresse complète du siège social</ToComplete>
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Capital</dt>
            <dd>
              <ToComplete>capital social, si la forme juridique en fait état</ToComplete>
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Représentant légal</dt>
            <dd>
              <ToComplete>nom et qualité du représentant légal</ToComplete>
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Contact</dt>
            <dd>
              <ToComplete>adresse email de contact</ToComplete>
            </dd>
          </div>
        </dl>
        <p className="text-sm text-[var(--foreground-muted)]">
          La dénomination de l&apos;éditeur est établie. Les autres informations ci-dessus ne le
          sont pas encore et sont affichées comme telles : nous préférons une page visiblement
          incomplète à une page qui aurait l&apos;air complète en donnant une adresse ou un numéro
          que personne n&apos;a vérifié.
        </p>
      </>
    ),
  },
  {
    id: 'directeur-publication',
    title: 'Directeur de la publication',
    body: (
      <p>
        <ToComplete>
          nom du directeur de la publication (à défaut, le représentant légal de {PUBLISHER_NAME})
        </ToComplete>
      </p>
    ),
  },
  {
    id: 'hebergement',
    title: 'Hébergement',
    body: (
      <>
        <p>
          <ToComplete>
            dénomination, adresse et contact de l’hébergeur. La cible technique retenue est
            DigitalOcean (ADR-0009), mais l’infrastructure de production n’est pas encore
            provisionnée : tant qu’elle ne l’est pas, nommer un hébergeur reviendrait à annoncer un
            fait qui n’existe pas
          </ToComplete>
        </p>
        <p>
          Les composants d&apos;hébergement effectivement utilisés, et les pays où les données sont
          stockées, sont décrits dans la{' '}
          <Link href="/confidentialite" className="underline underline-offset-4">
            politique de confidentialité
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: 'propriete',
    title: 'Propriété intellectuelle',
    body: (
      <>
        <p>
          L&apos;ensemble des éléments du service — interface, textes, identité visuelle, modèles
          sectoriels, moteurs de calcul, documentation — est protégé et reste la propriété de{' '}
          {PUBLISHER_NAME} ou de ses partenaires. Toute reproduction sans autorisation est
          interdite.
        </p>
        <p>
          Les documents que vous produisez avec le service (plans financiers, exports) vous
          appartiennent : voir les{' '}
          <Link href="/cgu" className="underline underline-offset-4">
            conditions générales d&apos;utilisation
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: 'donnees',
    title: 'Données personnelles et cookies',
    body: (
      <p>
        Le traitement des données personnelles est décrit dans la{' '}
        <Link href="/confidentialite" className="underline underline-offset-4">
          politique de confidentialité
        </Link>
        , et l&apos;usage des cookies dans la{' '}
        <Link href="/cookies" className="underline underline-offset-4">
          politique de cookies
        </Link>
        . Vous pouvez y exercer vos droits et revenir sur votre choix en matière de cookies à tout
        moment.
      </p>
    ),
  },
  {
    id: 'signalement',
    title: 'Signaler un contenu ou un problème',
    body: (
      <>
        <p>
          Pour signaler un contenu illicite, une atteinte à vos droits ou un problème de sécurité,
          écrivez à <ToComplete>adresse email de contact</ToComplete> en décrivant précisément les
          faits et les éléments permettant de les localiser.
        </p>
        <p>
          Une faille de sécurité signalée de bonne foi ne fera l&apos;objet d&apos;aucune poursuite
          de notre part dès lors qu&apos;elle n&apos;a pas été exploitée au-delà de ce qui était
          nécessaire pour la démontrer.
        </p>
      </>
    ),
  },
  {
    id: 'a-completer',
    title: 'Ce qui reste à établir',
    body: (
      <>
        <p>
          Cette page est publiée incomplète et le dit. Les informations suivantes doivent être
          fournies par l&apos;éditeur avant toute mise en service commerciale :
        </p>
        <LegalList items={PUBLISHER_UNKNOWNS} />
        <p>
          La forme «&nbsp;LLC&nbsp;» suggère une immatriculation aux États-Unis. Cette indication
          n&apos;est pas une conclusion : elle appelle un arbitrage juridique sur le droit
          applicable, la juridiction compétente et le régime de transfert des données pour les
          utilisateurs situés dans l&apos;Union européenne. Ces questions sont recensées dans le
          document de conformité interne et ne sont tranchées nulle part dans ces pages.
        </p>
      </>
    ),
  },
];

export default function MentionsLegalesPage(): React.ReactElement {
  return (
    <LegalPage
      slug="mentions-legales"
      lead={
        <p>
          Cette page identifie qui édite Lalanda et comment nous joindre. Elle est publiée dans un
          état volontairement incomplet : seule la dénomination de l&apos;éditeur est établie à ce
          jour, et les informations manquantes sont signalées comme telles plutôt que comblées par
          des valeurs plausibles.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
