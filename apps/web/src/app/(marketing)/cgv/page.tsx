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
// 2. L'ÉTAT RÉEL EST DIT. Il n'existe AUCUNE intégration de paiement
//    (docs/13 § « Hors périmètre S16b ») : aucun abonnement payant ne peut être
//    souscrit aujourd'hui. Publier des CGV muettes sur ce point laisserait croire
//    à un parcours d'achat qui n'existe pas.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import Link from 'next/link';

import { PUBLISHER_NAME, legalDocument } from '@/lib/legal';
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
      </>
    ),
  },
  {
    id: 'etat-du-service',
    title: 'État actuel : aucun abonnement payant n’est encore commercialisé',
    body: (
      <>
        <p>
          <strong>
            Aucun moyen de paiement n&apos;est en service à ce jour et aucune souscription payante
            ne peut être conclue.
          </strong>{' '}
          Le service est utilisable dans son offre gratuite, avec les limites annoncées sur la page
          des tarifs.
        </p>
        <p>
          Les stipulations qui suivent décrivent le cadre prévu pour les abonnements. Elles ne
          deviendront applicables qu&apos;à l&apos;ouverture effective de la commercialisation, qui
          fera l&apos;objet d&apos;une mise à jour datée de ce document. Nous les publions dès
          maintenant pour que personne ne découvre les conditions d&apos;achat au moment de payer.
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
          <ToComplete>
            devise ou devises de facturation, et règle de conversion le cas échéant — la grille
            tarifaire n’est pas arbitrée commercialement
          </ToComplete>
        </p>
        <p>
          <ToComplete>
            traitement des taxes applicables (TVA ou équivalent) : prix affichés hors taxes ou
            toutes taxes comprises, et règles selon le pays de l’acheteur — question fiscale, à
            trancher avec un conseil
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
          le pouvoir. Il couvre l&apos;ensemble des membres de cette organisation dans la limite des
          places prévues par l&apos;offre.
        </p>
        <p>
          Avant de valider, vous verrez le récapitulatif de ce que vous commandez&nbsp;: offre,
          périodicité, montant à payer et date de la première échéance. La commande n&apos;est
          conclue qu&apos;après cette validation explicite et la confirmation du paiement.
        </p>
        <p>
          <ToComplete>
            mentions obligatoires du parcours d’achat selon le droit de la consommation applicable
            (récapitulatif avant paiement, mention explicite d’une obligation de payer, confirmation
            écrite de la commande)
          </ToComplete>
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
          fonctions de l&apos;offre essayée, dans des limites d&apos;usage raisonnables.
        </p>
        <p>
          À son terme, aucune donnée n&apos;est supprimée. L&apos;accès passe en consultation
          limitée pendant une période de grâce, et vos données restent exportables.
        </p>
        <p>
          <ToComplete>
            durée de la période de grâce après l’essai, et décision commerciale sur l’exigence d’une
            carte bancaire à l’entrée en essai (docs/13-PRICING.md la laisse ouverte)
          </ToComplete>
        </p>
        <p>
          <ToComplete>
            règle exacte de bascule à la fin de l’essai : reconduction automatique en abonnement
            payant, ou arrêt sans prélèvement sauf souscription explicite. Ce choix a des
            conséquences directes en droit de la consommation
          </ToComplete>
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
          l&apos;option choisie. Il se reconduit automatiquement à chaque échéance pour une durée
          identique, tant qu&apos;il n&apos;a pas été résilié.
        </p>
        <p>
          Vous pouvez résilier à tout moment depuis votre espace. La résiliation prend effet à la
          fin de la période en cours&nbsp;: l&apos;accès est conservé jusque-là et aucun nouveau
          prélèvement n&apos;intervient ensuite.
        </p>
        <p>
          <ToComplete>
            moyens de paiement acceptés, y compris les moyens locaux (mobile money) le cas échéant,
            et prestataire de paiement retenu
          </ToComplete>
        </p>
        <p>
          <ToComplete>
            information préalable à la reconduction (délai et canal), lorsque le droit applicable
            l’impose
          </ToComplete>
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
          Une facture est émise à chaque échéance et reste consultable depuis l&apos;espace de
          l&apos;organisation. Elle reprend l&apos;offre, la période couverte, le montant et les
          taxes applicables.
        </p>
        <p>
          Les informations de facturation que vous fournissez (raison sociale, adresse, identifiant
          fiscal) doivent être exactes. Une facture émise sur des informations erronées est
          rectifiée sur demande.
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
          période déjà payée reste servie.
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
    id: 'retractation',
    title: 'Droit de rétractation',
    body: (
      <>
        <p>
          Lorsque vous souscrivez en qualité de consommateur, un droit de rétractation peut
          s&apos;appliquer à la commande d&apos;un service numérique.
        </p>
        <p>
          <ToComplete>
            existence, durée et modalités du droit de rétractation selon le droit applicable, et
            traitement du cas où l’exécution commence immédiatement à la demande de l’acheteur. La
            rédaction de cette clause dépend du droit applicable au contrat, qui n’est pas arbitré —
            voir les CGU § droit applicable
          </ToComplete>
        </p>
        <p>
          Indépendamment de tout droit de rétractation, la période d&apos;essai gratuite permet
          d&apos;évaluer le service avant tout paiement.
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
          <ToComplete>
            politique de remboursement : cas ouverts, délai de traitement et modalités. Décision
            commerciale non arbitrée — aucune règle n’est inventée ici
          </ToComplete>
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
        <p>En cas d&apos;échec de paiement à une échéance :</p>
        <LegalList
          items={[
            'nous vous en informons et une nouvelle tentative est effectuée;',
            'l’abonnement passe en état d’impayé, sans interruption immédiate de l’accès;',
            'passé un délai de régularisation, l’accès est réduit à la consultation puis suspendu;',
            'vos données ne sont pas supprimées du fait d’un impayé, et restent exportables pendant la période de conservation applicable.',
          ]}
        />
        <p>
          <ToComplete>
            délais exacts de relance, de suspension et de conservation des données après suspension,
            ainsi que d’éventuels frais de recouvrement selon le droit applicable
          </ToComplete>
        </p>
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
          payée&nbsp;: elle prend effet à l&apos;échéance suivante, après information préalable, et
          vous pouvez résilier avant qu&apos;elle ne s&apos;applique.
        </p>
        <p>
          <ToComplete>délai de préavis retenu avant application d’une hausse de prix</ToComplete>
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
          <ToComplete>adresse email de contact</ToComplete>. La plupart des désaccords commerciaux
          se règlent par un échange.
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
          souscription, essai, paiement, résiliation et remboursement. Il est publié avant
          l&apos;ouverture de la commercialisation, et le dit&nbsp;: aucun abonnement payant ne peut
          être souscrit aujourd&apos;hui.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
