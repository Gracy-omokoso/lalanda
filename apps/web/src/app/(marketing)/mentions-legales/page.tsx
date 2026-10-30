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
// ÉDITEUR : Go freelance SARLU, SARLU de droit congolais (RDC) — ADR-0043.
// Seul ce qui est établi est affiché. Les mentions que la dirigeante a choisi de
// ne pas publier (RCCM, Id. Nat., NIF, siège, capital, gérant, téléphone) ne
// figurent PAS sur cette page, ni sous forme de marqueur : ce choix est consigné
// dans docs/28-CONFORMITE-LEGALE.md, pas sur le site.
// Televerx LLC n'apparaît QUE sur cette page, comme partenaire de développement
// et d'intégration — jamais comme éditeur.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import Link from 'next/link';

import {
  CONTACT_CLIENT,
  CONTACT_FACTURATION,
  CONTACT_LEGAL,
  CONTACT_TECHNIQUE,
  DEVELOPMENT_PARTNER_NAME,
  DEVELOPMENT_PARTNER_ROLE,
  PUBLISHER_GOVERNING_LAW,
  PUBLISHER_LEGAL_FORM,
  PUBLISHER_NAME,
  legalDocument,
} from '@/lib/legal';
import { LegalPage, type LegalSection } from '../_components/legal-page';

const doc = legalDocument('mentions-legales');

export const metadata: Metadata = {
  title: `${doc.title} — Lalanda`,
  description: doc.summary,
};

function Mail({ address }: { address: string }): React.ReactElement {
  return (
    <a href={`mailto:${address}`} className="underline underline-offset-2">
      {address}
    </a>
  );
}

const SECTIONS: readonly LegalSection[] = [
  {
    id: 'editeur',
    title: 'Éditeur du service',
    body: (
      <>
        <p>
          Le service Lalanda, accessible en ligne, est édité par <strong>{PUBLISHER_NAME}</strong>,{' '}
          {PUBLISHER_LEGAL_FORM} de {PUBLISHER_GOVERNING_LAW}.
        </p>
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="font-semibold">Dénomination</dt>
            <dd>{PUBLISHER_NAME}</dd>
          </div>
          <div>
            <dt className="font-semibold">Forme juridique</dt>
            <dd>
              {PUBLISHER_LEGAL_FORM}, {PUBLISHER_GOVERNING_LAW}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Contact</dt>
            <dd className="flex flex-col gap-1">
              <span>
                Questions générales : <Mail address={CONTACT_CLIENT} />
              </span>
              <span>
                Assistance technique : <Mail address={CONTACT_TECHNIQUE} />
              </span>
              <span>
                Facturation : <Mail address={CONTACT_FACTURATION} />
              </span>
            </dd>
          </div>
        </dl>
      </>
    ),
  },
  {
    id: 'directeur-publication',
    title: 'Directeur de la publication',
    body: <p>Le directeur de la publication est le représentant légal de {PUBLISHER_NAME}.</p>,
  },
  {
    id: 'partenaire',
    title: 'Développement et intégration',
    body: (
      <p>
        Le service est développé et intégré avec <strong>{DEVELOPMENT_PARTNER_NAME}</strong>,{' '}
        {DEVELOPMENT_PARTNER_ROLE}. {PUBLISHER_NAME} reste l&apos;éditeur du service et votre seul
        cocontractant.
      </p>
    ),
  },
  {
    id: 'hebergement',
    title: 'Hébergement',
    body: (
      <>
        <p>
          Le service est hébergé par <strong>DigitalOcean</strong>, sur des serveurs virtuels
          (Droplets).
        </p>
        <p>
          Les prestataires ayant accès aux données, et les transferts qui en découlent, sont décrits
          dans la{' '}
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
          écrivez à{' '}
          <a href={`mailto:${CONTACT_LEGAL}`} className="underline underline-offset-2">
            {CONTACT_LEGAL}
          </a>{' '}
          en décrivant précisément les faits et les éléments permettant de les localiser.
        </p>
        <p>
          Une faille de sécurité signalée de bonne foi ne fera l&apos;objet d&apos;aucune poursuite
          de notre part dès lors qu&apos;elle n&apos;a pas été exploitée au-delà de ce qui était
          nécessaire pour la démontrer.
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
        <p>Cette page identifie qui édite Lalanda, qui l&apos;héberge et comment nous joindre.</p>
      }
      sections={SECTIONS}
    />
  );
}
