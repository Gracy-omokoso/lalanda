// ─────────────────────────────────────────────────────────────────────────────
// AVERTISSEMENT — PROJET DE DOCUMENT, NON VALIDÉ JURIDIQUEMENT
//
// Ce texte est un PROJET de politique de confidentialité rédigé par l'équipe
// produit. Il n'a PAS été relu par un juriste, ne vaut pas qualification au titre
// d'un régime de protection des données (RGPD ou autre) et ne doit PAS être
// présenté comme conforme. Voir docs/28-CONFORMITE-LEGALE.md.
//
// RÈGLE DE RÉDACTION DE CETTE PAGE : elle décrit les traitements RÉELLEMENT
// effectués par le code de ce dépôt, à la date de sa dernière mise à jour. Ce
// qui n'existe pas est dit comme n'existant pas (envoi d'emails, paiement), ce
// qui n'est pas décidé est marqué `[À COMPLÉTER]`. Une politique de
// confidentialité qui décrit un service imaginaire est une déclaration fausse
// faite à la personne concernée — c'est le seul document du lot où la formule
// prudente et vague est plus dangereuse que le silence.
//
// Le traitement le plus sensible est la TRANSMISSION À OPENAI (module `ai/`).
// Il a sa propre section, détaillée jusqu'au contenu exact de ce qui part.
// Sources : `apps/api/src/ai/ai-actions.service.ts` (buildUserPrompt),
// `apps/api/src/ai/openai-client.ts`, `apps/api/src/account/`,
// `apps/api/src/organizations/`, `docs/17-SECURITE.md`.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACT_LEGAL, PUBLISHER_NAME, legalDocument } from '@/lib/legal';
import {
  LegalList,
  LegalPage,
  LegalTable,
  ToComplete,
  type LegalSection,
} from '../_components/legal-page';

const doc = legalDocument('confidentialite');

export const metadata: Metadata = {
  title: `${doc.title} — Lalanda`,
  description: doc.summary,
};

const SECTIONS: readonly LegalSection[] = [
  {
    id: 'responsable',
    title: 'Qui traite vos données',
    body: (
      <>
        <p>
          Le responsable du traitement est <strong>{PUBLISHER_NAME}</strong>, éditeur de Lalanda.
          Ses coordonnées complètes figurent dans les{' '}
          <Link href="/mentions-legales" className="underline underline-offset-4">
            mentions légales
          </Link>{' '}
          — plusieurs y sont encore à compléter, et nous le signalons plutôt que de les inventer.
        </p>
        <p>
          Pour toute question sur vos données ou pour exercer vos droits&nbsp;:{' '}
          <a href={`mailto:${CONTACT_LEGAL}`} className="underline underline-offset-2">
            {CONTACT_LEGAL}
          </a>
        </p>
        <p>
          <ToComplete>
            désignation éventuelle d’un délégué à la protection des données, et d’un représentant
            dans l’Union européenne si des utilisateurs y sont établis — à arbitrer avec un juriste
          </ToComplete>
        </p>
      </>
    ),
  },
  {
    id: 'donnees',
    title: 'Quelles données nous traitons',
    body: (
      <>
        <p>
          Nous ne collectons que ce que le service utilise. Il n&apos;y a ni collecte publicitaire,
          ni profilage, ni achat de données auprès de tiers.
        </p>
        <LegalTable
          caption="Catégories de données traitées par Lalanda"
          headers={['Catégorie', 'Contenu', 'Origine']}
          rows={[
            [
              'Compte',
              'Nom, adresse email, mot de passe (conservé sous forme chiffrée non réversible), statut de vérification de l’adresse.',
              'Vous, à l’inscription',
            ],
            [
              'Connexions et sessions',
              'Adresse IP, description de l’appareil déduite du navigateur, dates de connexion et d’activité. Elles alimentent l’écran « sessions actives » qui vous permet de repérer et de révoquer un accès.',
              'Automatique, à chaque connexion',
            ],
            [
              'Organisation et rôles',
              'Nom de l’organisation, membres, rôles, invitations envoyées (adresse email de la personne invitée).',
              'Vous et les autres membres',
            ],
            [
              'Projets et plans financiers',
              'Nom du projet, pays, référentiel comptable, hypothèses chiffrées, scénarios, réalisé saisi, objectifs, contenus du canvas. Ce sont des données d’entreprise, susceptibles d’être confidentielles.',
              'Vous',
            ],
            [
              'Acceptation des conditions',
              'Date et version du corpus contractuel accepté. Sert à prouver le consentement et à savoir quand le redemander.',
              'Vous, à l’inscription',
            ],
            [
              'Préférences',
              'Langue, fuseau horaire, thème d’affichage, devise proposée par défaut, préférences de notification.',
              'Vous',
            ],
            [
              'Journaux techniques',
              'Traces d’erreurs et d’accès du serveur. Les en-têtes d’autorisation et les cookies en sont retirés avant écriture.',
              'Automatique',
            ],
          ]}
        />
        <p>
          Nous ne demandons aucune donnée sensible (santé, opinions, appartenance syndicale…) et le
          service n&apos;a pas de champ prévu pour en recevoir.
        </p>
      </>
    ),
  },
  {
    id: 'finalites',
    title: 'Pourquoi nous les traitons',
    body: (
      <>
        <LegalList
          items={[
            'Fournir le service : compte, organisations, projets, calculs, exports.',
            'Sécuriser les accès : authentification, détection d’un accès anormal, limitation du nombre de requêtes.',
            'Répondre à vos demandes de support.',
            'Prouver l’acceptation des conditions et savoir quand la redemander.',
            'Facturer les abonnements, lorsque la facturation sera en service.',
            'Respecter nos obligations légales et comptables.',
          ]}
        />
        <p>
          <ToComplete>
            qualification des bases légales (exécution du contrat, intérêt légitime, obligation
            légale, consentement) au regard du régime de protection des données applicable. Ce point
            dépend du pays d’immatriculation de l’éditeur et de la localisation des utilisateurs —
            il est ouvert et documenté, pas tranché
          </ToComplete>
        </p>
      </>
    ),
  },
  {
    id: 'ia-openai',
    title: 'Assistance IA : ce qui est transmis à OpenAI',
    body: (
      <>
        <p>
          Lalanda propose une fonction d&apos;<strong>actions correctives</strong>&nbsp;: à partir
          des ratios de votre plan qui sortent des seuils attendus, elle suggère des pistes de
          correction. Pour produire ces suggestions,{' '}
          <strong>
            des données de votre projet sont transmises à un prestataire tiers, OpenAI
          </strong>
          , qui les traite sur son infrastructure via son interface de programmation.{' '}
          <ToComplete>
            entité juridique contractante d’OpenAI et adresse de son établissement — à relever dans
            le contrat au moment de le conclure, pas à déduire
          </ToComplete>
        </p>
        <p>
          Ce n&apos;est pas une éventualité théorique&nbsp;: c&apos;est ce que fait le service
          lorsque vous déclenchez cette fonction et qu&apos;une clé d&apos;accès OpenAI est
          configurée. Nous le disons donc précisément.
        </p>

        <p className="font-semibold">Ce qui est envoyé</p>
        <LegalList
          items={[
            'L’identifiant du modèle sectoriel de votre projet (par exemple « commerce de détail »).',
            'La devise d’affichage du projet.',
            'Pour chaque ratio en anomalie seulement : son identifiant, son libellé, sa valeur calculée, le seuil de référence, le sens du seuil et la gravité (orange ou rouge).',
          ]}
        />

        <p className="font-semibold">Ce qui n&apos;est pas envoyé</p>
        <LegalList
          items={[
            'Ni votre nom, ni votre adresse email, ni aucun identifiant de compte.',
            'Ni le nom de votre projet, ni celui de votre organisation.',
            'Ni le plan financier complet : ni les états financiers, ni le détail de vos hypothèses, ni vos données de réalisé, ni vos documents.',
          ]}
        />
        <p>
          Les valeurs transmises restent néanmoins des données financières de votre entreprise. Une
          marge, un délai de récupération ou une couverture de dette disent quelque chose de votre
          activité, même sans votre nom&nbsp;: nous ne les présentons pas comme anonymes.
        </p>

        <p className="font-semibold">Comment vous y opposer</p>
        <LegalList
          items={[
            'La fonction ne s’exécute jamais d’elle-même. Aucune donnée ne part tant que vous ne demandez pas explicitement des actions correctives : ne pas utiliser cette fonction suffit à ce qu’aucun transfert n’ait lieu.',
            'Refuser cette fonction ne dégrade rien d’autre. Les calculs, les états financiers, les ratios et les exports sont produits par le moteur financier de Lalanda, sans aucune intervention d’un modèle d’IA.',
            'Si vous souhaitez que la fonction soit désactivée pour l’ensemble de votre organisation, écrivez-nous : nous la coupons sur demande.',
          ]}
        />
        <p>
          <ToComplete>
            réglage en libre-service, dans les paramètres de l’organisation, permettant de
            désactiver l’assistance IA sans nous écrire — non implémenté à ce jour
          </ToComplete>
        </p>

        <p className="font-semibold">Ce que devient la donnée chez OpenAI</p>
        <p>
          Les suggestions renvoyées ne sont jamais reprises comme chiffres officiels&nbsp;: elles
          sont affichées comme du texte, et le moteur financier reste seul à calculer. Nous
          n&apos;utilisons pas vos données pour entraîner un modèle, et OpenAI indique ne pas
          entraîner ses modèles sur les données reçues via son interface de programmation.
        </p>
        <p>
          <ToComplete>
            accord de traitement (DPA) à conclure avec OpenAI, durée de conservation appliquée de
            leur côté, et instrument encadrant le transfert hors du pays de l’utilisateur — à
            formaliser avant mise en service commerciale
          </ToComplete>
        </p>
      </>
    ),
  },
  {
    id: 'destinataires',
    title: 'À qui vos données sont transmises',
    body: (
      <>
        <p>
          Nous ne vendons pas vos données et ne les cédons à personne à des fins publicitaires ou
          commerciales. Les seuls tiers qui y accèdent sont des prestataires techniques, pour ce
          qu&apos;ils nous fournissent.
        </p>
        <LegalTable
          caption="Prestataires ayant accès aux données"
          headers={['Prestataire', 'Rôle', 'État']}
          rows={[
            [
              'OpenAI',
              'Génération des suggestions d’actions correctives, à partir des ratios en anomalie (voir la section précédente).',
              'En service dès qu’une clé d’accès est configurée',
            ],
            [
              <ToComplete key="h">hébergeur — cible ADR-0009 : DigitalOcean</ToComplete>,
              'Hébergement des serveurs, de la base de données et du stockage des fichiers exportés.',
              'Non provisionné à ce jour',
            ],
            [
              <ToComplete key="m">fournisseur d’envoi d’emails</ToComplete>,
              'Envoi des emails du service : vérification d’adresse, invitations, notifications.',
              'Aucun fournisseur configuré — aucun email n’est envoyé à ce jour',
            ],
            [
              <ToComplete key="p">prestataire de paiement</ToComplete>,
              'Encaissement des abonnements et émission des factures.',
              'Aucune intégration de paiement — voir les CGV',
            ],
          ]}
        />
        <p>
          Les deux dernières lignes décrivent des rôles prévus, sans prestataire choisi. Nous les
          faisons figurer pour que cette page ne devienne pas fausse le jour où ils le seront&nbsp;:
          leur mise en service donnera lieu à une mise à jour de cette politique.
        </p>
        <p>
          Vos données peuvent par ailleurs être communiquées à une autorité si la loi nous y oblige.
          Nous ne le faisons que sur demande régulière et, sauf interdiction, nous vous en
          informons.
        </p>
      </>
    ),
  },
  {
    id: 'transferts',
    title: 'Transferts hors de votre pays',
    body: (
      <>
        <p>
          Certaines données quittent votre pays. C&apos;est déjà le cas pour la fonction
          d&apos;actions correctives, traitée par OpenAI, et ce le sera pour l&apos;hébergement.
        </p>
        <p>
          <ToComplete>
            pays d’hébergement retenu, localisation des traitements de chaque prestataire, et
            instrument juridique encadrant ces transferts (clauses contractuelles types ou
            équivalent). Ce point est lié à la question ouverte du droit applicable : la forme « LLC
            » de l’éditeur suggère une immatriculation aux États-Unis, ce qui a des conséquences
            directes sur le régime applicable aux utilisateurs situés dans l’Union européenne —
            arbitrage juridique requis
          </ToComplete>
        </p>
      </>
    ),
  },
  {
    id: 'conservation',
    title: 'Combien de temps nous les gardons',
    body: (
      <>
        <LegalTable
          caption="Durées de conservation"
          headers={['Donnée', 'Durée']}
          rows={[
            ['Compte, organisations, projets et plans', 'Tant que votre compte existe'],
            [
              'Après suppression du compte',
              'Suppression des données du compte, des organisations dont vous étiez le seul membre, des appartenances et des sessions. La suppression est définitive et immédiate.',
            ],
            ['Sessions', 'Jusqu’à expiration ou révocation par vous'],
            ['Jeton de changement d’adresse email', '24 heures'],
            ['Choix en matière de cookies', 'Environ 6 mois'],
            [
              'Preuve d’acceptation des conditions',
              <ToComplete key="p">
                durée de conservation de la preuve d’acceptation après suppression du compte — à
                arbitrer : la conserver sert la preuve, l’effacer sert le droit à l’effacement
              </ToComplete>,
            ],
            [
              'Journaux techniques',
              <ToComplete key="j">durée de rétention des journaux serveur</ToComplete>,
            ],
            [
              'Factures et pièces comptables',
              <ToComplete key="f">
                durée légale de conservation, selon le droit applicable à l’éditeur
              </ToComplete>,
            ],
          ]}
        />
      </>
    ),
  },
  {
    id: 'securite',
    title: 'Comment nous les protégeons',
    body: (
      <>
        <LegalList
          items={[
            'Cloisonnement par organisation et par projet : les routes de l’API n’acceptent aucun identifiant d’utilisateur ou d’organisation qui permettrait de désigner autrui.',
            'Rôles et permissions vérifiés côté serveur, pas seulement masqués dans l’interface.',
            'Mots de passe conservés sous forme chiffrée non réversible ; ils ne sont jamais lisibles, y compris par nous.',
            'Sessions consultables et révocables une par une depuis votre espace compte.',
            'Limitation du nombre de requêtes et en-têtes de sécurité sur le web comme sur l’API.',
            'Journaux expurgés des cookies et des en-têtes d’autorisation avant écriture.',
          ]}
        />
        <p>
          Aucune mesure ne rend un service invulnérable. Si un incident affectant vos données
          survenait, nous vous en informerions ainsi que les autorités compétentes lorsque cela est
          requis.
        </p>
        <p>
          <ToComplete>
            procédure de notification d’incident (délai, canal, autorité destinataire) à formaliser
            avec un juriste, en fonction du régime applicable
          </ToComplete>
        </p>
      </>
    ),
  },
  {
    id: 'droits',
    title: 'Vos droits',
    body: (
      <>
        <p>
          Selon le droit qui vous est applicable, vous disposez de droits sur vos données. Nous
          appliquons les suivants sans discuter du régime dont ils relèvent&nbsp;:
        </p>
        <LegalList
          items={[
            'Accéder aux données que nous détenons sur vous.',
            'Les corriger si elles sont inexactes — la plupart sont modifiables directement dans votre espace compte.',
            'Les supprimer : la suppression du compte est disponible en libre-service et prend effet immédiatement.',
            'Vous opposer à la transmission de données de projet à OpenAI, en n’utilisant pas la fonction d’actions correctives ou en nous demandant de la désactiver.',
            'Récupérer vos données de projet, que les exports du service produisent au format PDF et Excel.',
            'Retirer votre consentement aux cookies non essentiels, à tout moment, depuis la politique de cookies.',
            'Introduire une réclamation auprès d’une autorité de protection des données.',
          ]}
        />
        <p>
          Pour exercer un droit qui ne dispose pas d&apos;un bouton dans l&apos;interface, écrivez à{' '}
          <a href={`mailto:${CONTACT_LEGAL}`} className="underline underline-offset-2">
            {CONTACT_LEGAL}
          </a>
          . Nous répondons dans un délai raisonnable et pouvons vous demander de confirmer votre
          identité, afin qu&apos;une demande ne serve pas à obtenir les données de quelqu&apos;un
          d&apos;autre.
        </p>
      </>
    ),
  },
  {
    id: 'limites-actuelles',
    title: 'Limites actuelles, dites franchement',
    body: (
      <>
        <p>
          Certaines fonctions décrites ailleurs comme « prévues » ne sont pas en service, et cela a
          des conséquences visibles pour vous&nbsp;:
        </p>
        <LegalList
          items={[
            'Aucun email n’est envoyé, faute de fournisseur configuré. La vérification d’adresse et le changement d’adresse email ne peuvent donc pas aboutir aujourd’hui, et aucune notification ne vous parvient — même si vous en avez activé.',
            'Aucun paiement n’est encaissé : il n’existe pas d’intégration de paiement.',
            'L’infrastructure d’hébergement de production n’est pas provisionnée, ce qui explique que l’hébergeur ne soit pas encore nommé.',
          ]}
        />
        <p>
          Ces manques seront comblés. Ils sont mentionnés ici parce qu&apos;une politique de
          confidentialité qui décrit des envois d&apos;emails inexistants ou un paiement fictif
          n&apos;informe personne.
        </p>
      </>
    ),
  },
  {
    id: 'modification',
    title: 'Modification de cette politique',
    body: (
      <>
        <p>
          Cette page porte une date de mise à jour et un numéro de version du corpus légal. Toute
          modification substantielle — nouvelle finalité, nouveau prestataire ayant accès aux
          données, nouveau transfert — entraîne une mise à jour de la version et une nouvelle
          demande d&apos;accord à votre prochaine connexion.
        </p>
        <p>
          Les documents liés&nbsp;:{' '}
          <Link href="/cgu" className="underline underline-offset-4">
            conditions d&apos;utilisation
          </Link>
          ,{' '}
          <Link href="/cookies" className="underline underline-offset-4">
            politique de cookies
          </Link>
          .
        </p>
      </>
    ),
  },
];

export default function ConfidentialitePage(): React.ReactElement {
  return (
    <LegalPage
      slug="confidentialite"
      lead={
        <p>
          Cette page décrit ce que Lalanda fait de vos données&nbsp;: ce que nous collectons, à quoi
          cela sert, qui y accède et ce que vous pouvez exiger. Elle décrit le service tel
          qu&apos;il fonctionne réellement aujourd&apos;hui — y compris la transmission de certaines
          données de projet à OpenAI pour la fonction d&apos;actions correctives, et y compris ce
          qui n&apos;existe pas encore.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
