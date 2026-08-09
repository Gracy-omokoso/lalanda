// ─────────────────────────────────────────────────────────────────────────────
// AVERTISSEMENT — PROJET DE DOCUMENT, NON VALIDÉ JURIDIQUEMENT
//
// Ce texte est un PROJET de conditions générales d'utilisation rédigé par
// l'équipe produit. Il n'a PAS été relu par un juriste, ne constitue pas un
// document contractuel opposable en l'état, et ne doit PAS être présenté comme
// conforme à un droit applicable. Une relecture juridique est un PRÉALABLE à
// toute mise en production. Voir docs/28-CONFORMITE-LEGALE.md.
//
// ÉDITEUR : Televerx LLC (`PUBLISHER_NAME`). C'est le SEUL élément
// d'identification établi. Adresse, État d'immatriculation, numéro
// d'enregistrement, représentant légal et adresse de contact restent des
// marqueurs `[À COMPLÉTER]` VISIBLES dans la page — les déduire de la forme
// « LLC » produirait un document faux publié sous le nom d'une société réelle.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import Link from 'next/link';

import { PUBLISHER_NAME, legalDocument } from '@/lib/legal';
import { LegalList, LegalPage, ToComplete, type LegalSection } from '../_components/legal-page';

const doc = legalDocument('cgu');

export const metadata: Metadata = {
  title: `${doc.title} — Lalanda`,
  description: doc.summary,
};

const SECTIONS: readonly LegalSection[] = [
  {
    id: 'objet',
    title: 'Objet et acceptation',
    body: (
      <>
        <p>
          Les présentes conditions encadrent l&apos;utilisation de Lalanda, un service en ligne de
          construction de plans financiers édité par <strong>{PUBLISHER_NAME}</strong> (ci-après
          «&nbsp;l&apos;éditeur&nbsp;», «&nbsp;nous&nbsp;»). Elles s&apos;appliquent à toute
          personne qui crée un compte ou utilise le service, à titre gratuit comme payant.
        </p>
        <p>
          Les coordonnées complètes de l&apos;éditeur figurent dans les{' '}
          <Link href="/mentions-legales" className="underline underline-offset-4">
            mentions légales
          </Link>
          .
        </p>
        <p>
          En cochant la case d&apos;acceptation lors de la création de votre compte, vous déclarez
          avoir lu ces conditions et les accepter. Si vous créez un compte pour le compte d&apos;une
          entreprise, vous déclarez avoir le pouvoir de l&apos;engager.
        </p>
        <p>
          Les conditions de vente des abonnements payants font l&apos;objet d&apos;un document
          distinct :{' '}
          <Link href="/cgv" className="underline underline-offset-4">
            conditions générales de vente
          </Link>
          . Le traitement de vos données est décrit dans la{' '}
          <Link href="/confidentialite" className="underline underline-offset-4">
            politique de confidentialité
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: 'service',
    title: 'Description du service',
    body: (
      <>
        <p>
          Lalanda aide un porteur de projet ou une entreprise à construire un plan financier
          prévisionnel et à le présenter sous une forme exploitable par une banque ou un
          investisseur. Le service propose notamment la saisie guidée d&apos;hypothèses, le calcul
          d&apos;états financiers prévisionnels, des scénarios, le suivi du réalisé et des exports.
        </p>
        <p>
          Les référentiels comptables et paramètres pays utilisés sont datés et versionnés. Ils
          reflètent l&apos;état des informations dont nous disposons à une date donnée et peuvent
          être corrigés.
        </p>
      </>
    ),
  },
  {
    id: 'compte',
    title: 'Compte, organisation et sécurité',
    body: (
      <>
        <p>
          L&apos;accès au service suppose la création d&apos;un compte personnel, rattaché à une ou
          plusieurs organisations. Les données d&apos;un projet appartiennent à l&apos;organisation
          qui l&apos;héberge, et non au compte individuel qui l&apos;a créé.
        </p>
        <LegalList
          items={[
            'Vous fournissez des informations exactes et les tenez à jour.',
            'Vous êtes responsable de la confidentialité de votre mot de passe et des actions effectuées depuis votre compte.',
            'Vous nous signalez sans délai toute utilisation non autorisée dont vous auriez connaissance.',
            'Un compte est personnel : il n’est pas partagé entre plusieurs personnes.',
            'Les membres d’une organisation reçoivent des rôles qui déterminent ce qu’ils peuvent voir et faire.',
          ]}
        />
        <p>
          Vous pouvez à tout moment consulter vos sessions actives, changer votre mot de passe ou
          supprimer votre compte depuis votre espace personnel.
        </p>
      </>
    ),
  },
  {
    id: 'usages-interdits',
    title: 'Usages interdits',
    body: (
      <>
        <p>Il est interdit d&apos;utiliser le service pour :</p>
        <LegalList
          items={[
            'produire, présenter ou transmettre sciemment des informations financières fausses, notamment en vue d’obtenir un financement;',
            'contourner les limites techniques ou commerciales du service, y compris par des comptes multiples destinés à répéter la période d’essai;',
            'accéder aux données d’une organisation à laquelle vous n’appartenez pas, ou tenter de le faire;',
            'perturber le fonctionnement du service : charge anormale, extraction massive automatisée, tentative d’intrusion, injection de contenu malveillant;',
            'revendre, louer ou mettre à disposition d’un tiers l’accès à votre compte;',
            'copier, décompiler ou reproduire les composants du service en vue de créer un produit concurrent;',
            'importer des fichiers contenant du code malveillant;',
            'exercer une activité illicite, ou une activité interdite par la réglementation qui vous est applicable.',
          ]}
        />
        <p>
          Ces interdictions valent aussi pour les fonctions d&apos;assistance automatisée : elles ne
          doivent pas être utilisées pour produire des contenus trompeurs à destination de tiers.
        </p>
      </>
    ),
  },
  {
    id: 'vos-contenus',
    title: 'Vos contenus',
    body: (
      <>
        <p>
          Vous restez propriétaire des données que vous saisissez ou importez : hypothèses,
          chiffres, documents, contenus de projet. Nous n&apos;en revendiquons aucune propriété.
        </p>
        <p>
          Vous nous accordez uniquement les droits techniques nécessaires à la fourniture du service
          — héberger, afficher, sauvegarder, calculer, exporter vos données à votre demande — pour
          la durée où vous utilisez le service.
        </p>
        <p>
          Nous n&apos;utilisons pas vos données de projet pour entraîner des modèles d&apos;IA. Les
          conditions dans lesquelles certaines données peuvent être transmises à un prestataire
          d&apos;IA, à votre initiative, sont décrites dans la{' '}
          <Link href="/confidentialite" className="underline underline-offset-4">
            politique de confidentialité
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: 'propriete-intellectuelle',
    title: 'Propriété intellectuelle de Lalanda',
    body: (
      <>
        <p>
          Le service, son interface, ses modèles sectoriels, ses moteurs de calcul, sa documentation
          et sa marque restent la propriété de {PUBLISHER_NAME} ou de ses partenaires. Votre
          abonnement vous donne un droit d&apos;usage personnel, non exclusif et non cessible,
          limité à la durée de votre accès.
        </p>
        <p>
          Les documents que vous produisez avec le service (plan financier, exports) vous
          appartiennent et peuvent être diffusés librement, y compris à un financeur.
        </p>
      </>
    ),
  },
  {
    id: 'ia',
    title: 'Fonctions d’assistance automatisée',
    body: (
      <>
        <p>
          Certaines fonctions proposent des commentaires ou des pistes d&apos;action produits par un
          modèle d&apos;intelligence artificielle. Elles servent à expliquer et à suggérer.
        </p>
        <p>
          <strong>Elles ne produisent jamais les chiffres officiels de votre plan.</strong> Les
          calculs restent effectués par le moteur financier du service, à partir de vos hypothèses.
          Une suggestion automatisée peut être inexacte ou inadaptée à votre situation : elle doit
          être relue avant d&apos;être suivie.
        </p>
        <p>
          Ces fonctions ne sont pas activées à votre insu : elles s&apos;exécutent lorsque vous les
          déclenchez.
        </p>
      </>
    ),
  },
  {
    id: 'absence-de-conseil',
    title: 'Absence de conseil professionnel',
    body: (
      <>
        <p>
          Lalanda est un outil de mise en forme et de calcul. Le service ne constitue pas un conseil
          financier, comptable, fiscal, juridique ou en investissement, et ne remplace pas
          l&apos;intervention d&apos;un professionnel qualifié.
        </p>
        <p>
          Les résultats produits dépendent entièrement des hypothèses que vous saisissez. Vous
          restez responsable de ces hypothèses, de leur vraisemblance, et de l&apos;usage que vous
          faites des documents obtenus — en particulier auprès d&apos;une banque, d&apos;un
          investisseur ou d&apos;une administration.
        </p>
        <p>
          Les paramètres fiscaux et comptables intégrés au service sont fournis à titre indicatif,
          avec leur date et leur source lorsque celle-ci est connue. Ils ne dispensent pas de
          vérifier la réglementation applicable à votre activité et à votre pays.
        </p>
      </>
    ),
  },
  {
    id: 'disponibilite',
    title: 'Disponibilité, maintenance et évolutions',
    body: (
      <>
        <p>
          Nous nous efforçons d&apos;assurer un service disponible et performant, sans garantir une
          disponibilité ininterrompue. Le service peut être suspendu pour maintenance, mise à jour
          ou incident de sécurité.
        </p>
        <p>
          Pour une interruption programmée d&apos;ampleur, nous cherchons à prévenir à
          l&apos;avance. Une interruption d&apos;urgence peut survenir sans préavis.
        </p>
        <p>
          Le service évolue : des fonctions peuvent être ajoutées, modifiées ou retirées. Le retrait
          d&apos;une fonction significative d&apos;une offre payante est annoncé aux abonnés
          concernés.
        </p>
        <p>
          Le service dépend de prestataires tiers (hébergement, paiement, envoi d&apos;emails,
          fournisseur d&apos;IA). Une défaillance de leur part peut affecter tout ou partie du
          service.
        </p>
      </>
    ),
  },
  {
    id: 'responsabilite',
    title: 'Responsabilité',
    body: (
      <>
        <p>
          Nous mettons en œuvre des moyens raisonnables pour fournir un service fiable et sécurisé.
          Notre responsabilité ne peut être engagée pour :
        </p>
        <LegalList
          items={[
            'une décision de gestion, de financement ou d’investissement prise sur la base des documents produits;',
            'le refus d’un financement, quelle qu’en soit la raison;',
            'l’inexactitude des hypothèses que vous avez saisies;',
            'une perte résultant d’un usage non conforme aux présentes conditions;',
            'l’indisponibilité imputable à un prestataire tiers ou à un cas de force majeure.',
          ]}
        />
        <p>
          <ToComplete>
            plafond de responsabilité retenu (par exemple : montant des sommes versées au cours des
            douze derniers mois) — à arbitrer avec un conseil juridique
          </ToComplete>
        </p>
        <p>
          Aucune stipulation ci-dessus ne vise à écarter une responsabilité qui ne peut pas
          l&apos;être en vertu du droit applicable.
        </p>
      </>
    ),
  },
  {
    id: 'suspension-resiliation',
    title: 'Suspension et résiliation',
    body: (
      <>
        <p>
          Vous pouvez cesser d&apos;utiliser le service à tout moment et supprimer votre compte
          depuis votre espace personnel. La suppression est définitive et entraîne celle des
          organisations dont vous êtes le seul membre.
        </p>
        <p>
          Nous pouvons suspendre ou fermer un accès en cas de manquement grave aux présentes
          conditions, notamment en cas d&apos;usage interdit, d&apos;atteinte à la sécurité du
          service ou de défaut de paiement (voir les{' '}
          <Link href="/cgv" className="underline underline-offset-4">
            CGV
          </Link>
          ).
        </p>
        <p>
          Sauf urgence de sécurité ou obligation légale, une mise en demeure préalable est adressée
          et un délai raisonnable est laissé pour régulariser et récupérer vos données.
        </p>
      </>
    ),
  },
  {
    id: 'modification',
    title: 'Modification des conditions',
    body: (
      <>
        <p>
          Ces conditions peuvent évoluer. Chaque version porte une date de mise à jour, affichée en
          tête de page, et un numéro de version du corpus légal.
        </p>
        <p>
          En cas de modification substantielle — nouvelle finalité de traitement, nouveau
          sous-traitant, changement d&apos;engagement ou de prix, extension des usages interdits —
          votre accord vous est redemandé à la prochaine connexion. Les modifications mineures
          (corrections de forme) sont publiées sans nouvelle demande.
        </p>
      </>
    ),
  },
  {
    id: 'droit-applicable',
    title: 'Droit applicable et règlement des litiges',
    body: (
      <>
        <p>
          <ToComplete>
            droit applicable au contrat. La dénomination «&nbsp;{PUBLISHER_NAME}&nbsp;» indique une
            forme de société de type américain, sans que l’État d’immatriculation soit établi à ce
            jour. Le choix du droit applicable dépend de ce point et des pays réellement servis
            (zone OHADA, Union européenne pour la diaspora) — à faire trancher par un juriste
          </ToComplete>
        </p>
        <p>
          <ToComplete>
            juridiction compétente, et le cas échéant clause de médiation préalable ou dispositif de
            médiation de la consommation applicable aux utilisateurs particuliers. Un utilisateur
            consommateur conserve, dans plusieurs droits, le bénéfice des tribunaux de son lieu de
            résidence quelle que soit la clause retenue
          </ToComplete>
        </p>
        <p>
          En cas de difficulté, nous vous invitons à nous contacter d&apos;abord :{' '}
          <ToComplete>adresse email de contact</ToComplete>. Nous cherchons une solution amiable
          avant toute procédure.
        </p>
      </>
    ),
  },
];

export default function CguPage(): React.ReactElement {
  return (
    <LegalPage
      slug="cgu"
      lead={
        <p>
          Ce document décrit ce que Lalanda vous fournit, ce que nous attendons de vous, et les
          limites de notre responsabilité. Il est écrit pour être lu par un entrepreneur, pas par un
          juriste. En cas de doute sur une clause, écrivez-nous.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
