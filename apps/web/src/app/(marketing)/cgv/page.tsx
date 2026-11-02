// ─────────────────────────────────────────────────────────────────────────────
// AVERTISSEMENT — PROJET DE DOCUMENT, NON VALIDÉ JURIDIQUEMENT
//
// Ce texte est un PROJET de conditions générales de vente rédigé par l'équipe
// produit. Il n'a PAS été relu par un juriste et ne doit PAS être présenté comme
// conforme à un droit de la consommation applicable. Une relecture juridique est
// un PRÉALABLE à toute commercialisation. Voir docs/28-CONFORMITE-LEGALE.md.
//
// DEUX RÈGLES DE RÉDACTION PROPRES À CE DOCUMENT :
//
// 1. AUCUN PRIX, AUCUNE DURÉE D'ENGAGEMENT, AUCUNE RÈGLE DE REMBOURSEMENT N'EST
//    INVENTÉE ICI. La grille tarifaire n'est pas arbitrée commercialement
//    (docs/13-PRICING.md § « Validation commerciale requise ») et la page
//    /pricing est en cours de refonte par ailleurs. Des CGV qui annonceraient un
//    prix ou un délai de remboursement décidés en écrivant la page créeraient un
//    engagement contractuel que personne n'a pris.
// 2. L'ÉTAT RÉEL EST DIT. Revue du 1er nov. 2026 : le paiement MANUEL (mobile
//    money ou virement, confirmé par un administrateur plateforme,
//    `apps/api/src/payments/manual.provider.ts`) fonctionne, sans renouvellement
//    automatique ; aucune facture d'abonnement n'est émise.
// 3. DÉCISIONS DU 3 NOV. 2026 (ADR-0054, version `2026-11-03`). La dirigeante a
//    tranché : les conditions s'appliquent dès cette version, paiement manuel
//    compris. Les choix retenus sont des CHOIX PRODUIT PRUDENTS, alignés sur ce
//    que fait le code (essai sans carte, grâce de 7 jours, aucun remboursement
//    d'une période commencée, crédit de prorata reporté), et non des règles de
//    droit congolais établies : ils sont à revoir avec le juriste. Restent
//    marqués : la fiscalité (TVA), l'émission des factures d'abonnement
//    (ADR-0047) et le droit de rétractation — ils exigent une donnée ou un avis
//    que l'équipe produit n'a pas.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACT_FACTURATION, PUBLISHER_NAME, legalDocument } from '@/lib/legal';
import { LegalList, LegalPage, ToComplete, type LegalSection } from '../_components/legal-page';

const doc = legalDocument('cgv');

export const metadata: Metadata = {
  title: `${doc.title} — Lalanda`,
  description: doc.summary,
};

const SECTIONS: readonly LegalSection[] = [
  {
    id: 'objet',
    title: 'Objet et documents applicables',
    body: (
      <>
        <p>
          Les présentes conditions régissent la vente des abonnements au service Lalanda, édité par{' '}
          <strong>{PUBLISHER_NAME}</strong>. Elles complètent les{' '}
          <Link href="/cgu" className="underline underline-offset-4">
            conditions générales d&apos;utilisation
          </Link>
          , qui restent applicables à tout usage du service, gratuit comme payant.
        </p>
        <p>
          En cas de contradiction entre les deux documents sur un point commercial — prix,
          facturation, durée, résiliation d&apos;un abonnement — les présentes conditions
          l&apos;emportent.
        </p>
        <p>
          Elles s&apos;appliquent <strong>à compter de leur version du 3 novembre 2026</strong>, à
          tout abonnement souscrit ou renouvelé, quel que soit le moyen de paiement, y compris le
          paiement manuel. Chaque utilisateur est invité à les accepter à sa prochaine connexion.
        </p>
      </>
    ),
  },
  {
    id: 'etat-du-service',
    title: 'Moyens de paiement en service',
    body: (
      <>
        <LegalList
          items={[
            <>
              <strong>Paiement manuel, par mobile money ou par virement</strong> — en service. Vous
              recevez des instructions de dépôt ; l’abonnement est activé lorsqu’un administrateur
              de Lalanda a constaté la réception du paiement. Un paiement manuel ne se renouvelle
              pas automatiquement : il est à refaire à chaque échéance. Aucune coordonnée du payeur
              (numéro de téléphone, numéro de compte) n’est enregistrée.
            </>,
            <>
              <strong>Carte bancaire (Stripe) et PayPal</strong> — proposés à l’écran de paiement
              seulement lorsque le prestataire est configuré. Tant qu’ils n’y figurent pas, ils ne
              sont pas disponibles.
            </>,
          ]}
        />
        <p>
          Le service reste utilisable dans son offre gratuite, avec les limites annoncées sur la
          page des tarifs.
        </p>
      </>
    ),
  },
  {
    id: 'offres-prix',
    title: 'Offres et prix',
    body: (
      <>
        <p>
          Les offres, leurs limites d&apos;usage et leurs prix sont présentés sur la{' '}
          <Link href="/pricing" className="underline underline-offset-4">
            page des tarifs
          </Link>
          , qui fait foi. Ils ne sont pas recopiés ici&nbsp;: deux pages annonçant des montants
          différents finiraient nécessairement par se contredire.
        </p>
        <p>
          Les prix sont exprimés en <strong>dollars américains (USD)</strong> et{' '}
          <strong>hors taxes</strong>. Le montant à payer et la devise du paiement sont ceux
          indiqués par le récapitulatif et les instructions de paiement.
        </p>
        <p>
          <ToComplete>
            traitement de la TVA : assujettissement de {PUBLISHER_NAME}, groupe de taxation et taux
            applicables aux abonnements, règle pour un acheteur établi hors de RDC — avis de
            l’expert-comptable attendu (ADR-0047)
          </ToComplete>
        </p>
      </>
    ),
  },
  {
    id: 'souscription',
    title: 'Souscription',
    body: (
      <>
        <p>
          L&apos;abonnement est souscrit au niveau d&apos;une organisation, par un membre qui en a
          le pouvoir (le Propriétaire). Il couvre l&apos;ensemble des membres de cette organisation
          dans la limite des places prévues par l&apos;offre.
        </p>
        <p>
          Avant de valider, vous voyez le récapitulatif de ce que vous commandez&nbsp;: offre,
          périodicité, montant à payer et période couverte. Valider ce récapitulatif vaut commande
          avec obligation de payer le montant affiché. La commande est conclue à la confirmation du
          paiement&nbsp;; l&apos;état de l&apos;abonnement est alors visible dans l&apos;espace de
          facturation de l&apos;organisation.
        </p>
      </>
    ),
  },
  {
    id: 'essai',
    title: 'Période d’essai',
    body: (
      <>
        <p>
          Une période d&apos;essai gratuite de <strong>14 jours</strong> est prévue au niveau de
          l&apos;organisation, à raison d&apos;une seule par organisation. Elle donne accès aux
          fonctions de l&apos;offre Pro. <strong>Aucun moyen de paiement n&apos;est demandé</strong>{' '}
          pour la commencer.
        </p>
        <p>
          À son terme, <strong>rien n&apos;est prélevé et rien n&apos;est souscrit</strong> sans
          votre décision&nbsp;: l&apos;organisation repasse à l&apos;offre gratuite. Aucune donnée
          n&apos;est supprimée&nbsp;; les limites de l&apos;offre gratuite s&apos;appliquent aux
          créations suivantes.
        </p>
      </>
    ),
  },
  {
    id: 'paiement',
    title: 'Paiement, échéances et reconduction',
    body: (
      <>
        <p>
          L&apos;abonnement est payable d&apos;avance, par période mensuelle ou annuelle selon
          l&apos;option choisie.
        </p>
        <LegalList
          items={[
            'Paiement manuel : pas de reconduction automatique. À l’échéance, un nouveau paiement est nécessaire ; à défaut, la procédure d’impayé ci-dessous s’applique.',
            'Carte bancaire ou PayPal, lorsqu’ils sont proposés : l’abonnement se reconduit à chaque échéance pour une durée identique, tant qu’il n’a pas été résilié.',
          ]}
        />
        <p>
          Vous pouvez résilier à tout moment depuis votre espace. La résiliation prend effet à la
          fin de la période en cours&nbsp;: l&apos;accès est conservé jusque-là et aucun nouveau
          prélèvement n&apos;intervient ensuite. La période couverte par chaque paiement est
          indiquée dans l&apos;espace de souscription et de facturation de l&apos;organisation.
        </p>
      </>
    ),
  },
  {
    id: 'facturation',
    title: 'Facturation',
    body: (
      <>
        <p>
          <strong>À ce jour, Lalanda n&apos;émet pas encore de facture d&apos;abonnement.</strong>{' '}
          Chaque paiement confirmé reste consultable dans l&apos;espace de l&apos;organisation.
        </p>
        <p>
          <ToComplete>
            émission des factures d’abonnement (facture normalisée DGI ou autre pièce), moment de
            leur émission et informations demandées à l’abonné — chantier en cours (ADR-0047),
            données fiscales de l’éditeur requises
          </ToComplete>
        </p>
        <p>
          Les informations de facturation que vous fournissez doivent être exactes. Pour toute
          question, écrivez à{' '}
          <a href={`mailto:${CONTACT_FACTURATION}`} className="underline underline-offset-2">
            {CONTACT_FACTURATION}
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'changement-offre',
    title: 'Changement d’offre',
    body: (
      <>
        <p>
          Une montée en gamme prend effet immédiatement, avec ajustement du montant au prorata de la
          période restante. Une baisse de gamme prend effet à l&apos;échéance suivante, afin que la
          période déjà payée reste servie. Un crédit de prorata n&apos;est pas remboursé&nbsp;: il
          est reporté sur les échéances suivantes.
        </p>
        <p>
          Si votre usage dépasse les limites de la nouvelle offre, nous vous le signalons avant
          d&apos;appliquer le changement.{' '}
          <strong>Aucun projet n&apos;est supprimé automatiquement&nbsp;;</strong> les créations
          supplémentaires sont bloquées jusqu&apos;à ce que vous soyez revenu dans les limites.
        </p>
      </>
    ),
  },
  {
    id: 'octroi',
    title: 'Offre accordée par Lalanda',
    body: (
      <>
        <p>
          {PUBLISHER_NAME} peut accorder une offre sans paiement à une organisation (partenariat,
          geste commercial, test). L&apos;octroi porte un motif et, le cas échéant, une échéance. Il
          est visible par l&apos;organisation dans son journal, sous le nom «&nbsp;Équipe
          Lalanda&nbsp;». À son échéance ou à son retrait, l&apos;organisation retrouve l&apos;offre
          qu&apos;elle paie, ou l&apos;offre gratuite.
        </p>
      </>
    ),
  },
  {
    id: 'retractation',
    title: 'Droit de rétractation',
    body: (
      <>
        <p>
          La période d&apos;essai gratuite, sans moyen de paiement, permet d&apos;évaluer le service
          avant tout paiement.
        </p>
        <p>
          <ToComplete>
            existence, durée et modalités d’un droit de rétractation pour un acheteur consommateur,
            selon le droit applicable (en RDC et, le cas échéant, dans le pays de l’acheteur) — avis
            du juriste attendu ; aucune règle n’est affirmée ici
          </ToComplete>
        </p>
      </>
    ),
  },
  {
    id: 'remboursement',
    title: 'Remboursement',
    body: (
      <>
        <p>
          Une période d&apos;abonnement commencée n&apos;est pas remboursée&nbsp;; la résiliation
          prend effet à sa fin. Un paiement reçu en double ou par erreur, ou un paiement manuel
          rejeté après réception des fonds, est remboursé sur demande à{' '}
          <a href={`mailto:${CONTACT_FACTURATION}`} className="underline underline-offset-2">
            {CONTACT_FACTURATION}
          </a>
          , par le même moyen que le paiement lorsque c&apos;est possible.
        </p>
        <p>
          En cas d&apos;indisponibilité prolongée du service qui nous est imputable,
          écrivez-nous&nbsp;: nous examinons chaque situation et proposons une compensation adaptée.
        </p>
      </>
    ),
  },
  {
    id: 'impayes',
    title: 'Impayés et suspension',
    body: (
      <>
        <p>Lorsqu&apos;une échéance n&apos;est pas payée :</p>
        <LegalList
          items={[
            'l’abonnement passe en état d’impayé, sans interruption immédiate de l’accès ; un message vous en informe dans l’application ;',
            'une période de grâce de 7 jours s’ouvre ensuite, accès toujours intact, compte à rebours affiché ;',
            'à son terme, l’accès est ramené aux limites de l’offre gratuite, jusqu’au paiement ;',
            'vos données ne sont pas supprimées du fait d’un impayé et restent exportables ;',
            'aucuns frais de recouvrement ni pénalités ne sont facturés.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'administration',
    title: 'Administration de la plateforme',
    body: (
      <>
        <p>
          Des opérateurs de {PUBLISHER_NAME} administrent la plateforme depuis une console séparée.
          Ils voient les métadonnées des comptes et des organisations (nom, adresse email, offre,
          état de l&apos;abonnement, usage), jamais le contenu de vos projets ou de vos données de
          gestion. Chacun de leurs gestes est motivé, inscrit au journal de la plateforme et, quand
          il vous concerne, visible dans le journal de votre organisation sous le nom «&nbsp;Équipe
          Lalanda&nbsp;».
        </p>
        <p>
          En cas de fraude, d&apos;atteinte à la sécurité ou de manquement grave aux CGU, un compte
          peut être bloqué ou une organisation suspendue, avec un motif. Une suspension laisse, en
          principe, vos données accessibles en lecture.
        </p>
        <p>
          Lalanda peut vous adresser des <strong>messages de service</strong> dans
          l&apos;application (bannière et cloche)&nbsp;: incident, changement des conditions,
          sécurité. Aucun email de masse ni aucune prospection ne vous est envoyé par ce moyen. Un
          message envoyé par erreur peut être retiré.
        </p>
      </>
    ),
  },
  {
    id: 'outils-gestion',
    title: 'Outils de gestion : votre responsabilité',
    body: (
      <>
        <p>
          Certains modules vous aident à gérer vos propres relations commerciales et votre
          personnel. Lalanda les fournit comme outils&nbsp;; votre organisation reste responsable de
          ses contrats, de ses documents et des données qu&apos;elle y saisit.
        </p>
        <LegalList
          items={[
            'Contrats et commandes de vos clients : Lalanda tient les métadonnées, les dates et les copies signées que vous téléversez. Il calcule les dates à partir des clauses que vous saisissez (durée, préavis, reconduction) sans juger leur validité. Une reconduction tacite n’est jamais appliquée seule : Lalanda vous alerte avant l’échéance et c’est un membre de votre organisation qui la constate.',
            'Formulaire public de prospects : si votre organisation en publie un, Lalanda l’héberge et l’exécute pour son compte. Votre organisation rédige le texte de consentement, fournit le lien vers sa propre politique de confidentialité et répond aux demandes des personnes qui s’y inscrivent.',
            'Ressources humaines (dossiers, présences, notes de frais, évaluations) : votre organisation informe son personnel et règle les durées de conservation. Le pointage, désactivé par défaut, conserve les pointages 5 ans sauf autre durée réglée par l’organisation.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'fin-abonnement',
    title: 'Fin de l’abonnement et récupération de vos données',
    body: (
      <>
        <p>
          À la fin d&apos;un abonnement, l&apos;organisation repasse à l&apos;offre gratuite et ses
          limites. Les projets existants restent accessibles en consultation dans cette limite.
        </p>
        <p>
          Vos données de projet restent exportables aux formats proposés par le service. Nous ne
          conditionnons jamais la récupération de vos propres données au paiement d&apos;une somme.
        </p>
        <p>
          La suppression définitive relève de vous&nbsp;: elle s&apos;effectue depuis votre espace,
          et les durées de conservation sont décrites dans la{' '}
          <Link href="/confidentialite" className="underline underline-offset-4">
            politique de confidentialité
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: 'evolution-prix',
    title: 'Évolution des prix et des offres',
    body: (
      <>
        <p>
          Les prix peuvent évoluer. Une hausse ne s&apos;applique jamais à une période déjà
          payée&nbsp;: elle est annoncée <strong>au moins 30 jours</strong> à l&apos;avance, prend
          effet à l&apos;échéance suivante, et vous pouvez résilier avant qu&apos;elle ne
          s&apos;applique.
        </p>
        <p>
          Le retrait d&apos;une fonction significative d&apos;une offre payante est annoncé aux
          abonnés concernés.
        </p>
      </>
    ),
  },
  {
    id: 'litiges',
    title: 'Droit applicable et litiges',
    body: (
      <>
        <p>
          Les règles de droit applicable, de juridiction compétente et de médiation sont communes
          aux CGU et aux présentes conditions&nbsp;: voir les{' '}
          <Link href="/cgu#droit-applicable" className="underline underline-offset-4">
            CGU § droit applicable
          </Link>
          . Elles restent à arbitrer.
        </p>
        <p>
          Avant toute procédure, écrivez-nous&nbsp;:{' '}
          <a href={`mailto:${CONTACT_FACTURATION}`} className="underline underline-offset-2">
            {CONTACT_FACTURATION}
          </a>
          . La plupart des désaccords commerciaux se règlent par un échange.
        </p>
      </>
    ),
  },
];

export default function CgvPage(): React.ReactElement {
  return (
    <LegalPage
      slug="cgv"
      lead={
        <p>
          Ce document décrit les conditions d&apos;achat d&apos;un abonnement Lalanda&nbsp;:
          souscription, essai, paiement, résiliation et remboursement, ainsi que ce que Lalanda fait
          en tant qu&apos;administrateur de la plateforme. Il dit l&apos;état réel du
          paiement&nbsp;: aujourd&apos;hui, le paiement manuel (mobile money ou virement) est en
          service&nbsp;; la carte et PayPal ne le sont que s&apos;ils sont proposés à l&apos;écran
          de paiement.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
