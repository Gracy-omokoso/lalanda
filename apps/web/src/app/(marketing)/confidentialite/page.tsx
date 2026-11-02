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
// qui n'existe pas est dit comme n'existant pas (paiement en ligne), ce
// qui n'est pas décidé est marqué `[À COMPLÉTER]`. Une politique de
// confidentialité qui décrit un service imaginaire est une déclaration fausse
// faite à la personne concernée — c'est le seul document du lot où la formule
// prudente et vague est plus dangereuse que le silence.
//
// Le traitement le plus sensible est la TRANSMISSION À OPENAI (module `ai/`).
// Il a sa propre section, détaillée jusqu'au contenu exact de ce qui part.
// Revue du 1er nov. 2026 : paiement manuel (`apps/api/src/payments/manual.provider.ts`),
// Lala et ElevenLabs (`apps/api/src/ai/`), brief, business plan, Idea Lab, modules
// de gestion et RH ajoutés ; « aucun paiement encaissé » retiré (faux).
// Mise à jour du 3 nov. 2026 (ADR-0054, version `2026-11-03`) : pointage (5 ans par
// défaut, purge quotidienne), évaluations, notes de frais, formulaire public de
// prospects, journal et statistiques de la plateforme, annonces ; rôle de Lalanda pour
// les données que l'organisation saisit sur des tiers (choix produit, à revoir avec le
// juriste) ; factures d'abonnement (ADR-0047) : identité de facturation de l'abonné
// transmise à l'éditeur.
// Sources : `apps/api/src/ai/ai-actions.service.ts` (buildUserPrompt),
// `apps/api/src/ai/openai-client.ts`, `apps/api/src/account/`,
// `apps/api/src/organizations/`, `docs/17-SECURITE.md`.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import Link from 'next/link';

import {
  CONTACT_LEGAL,
  PUBLISHER_GOVERNING_LAW,
  PUBLISHER_LEGAL_FORM,
  PUBLISHER_NAME,
  legalDocument,
} from '@/lib/legal';
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
          Le responsable du traitement est <strong>{PUBLISHER_NAME}</strong>, éditeur de Lalanda,{' '}
          {PUBLISHER_LEGAL_FORM} de {PUBLISHER_GOVERNING_LAW}. Ses coordonnées figurent dans les{' '}
          <Link href="/mentions-legales" className="underline underline-offset-4">
            mentions légales
          </Link>
          .
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
              'Données de gestion de l’organisation',
              'Selon les modules utilisés : clients, prospects et leurs contacts, devis et factures, fournisseurs et achats, comptes de trésorerie, stocks, équipements, projets et tâches, documents déposés. Ce sont des données d’entreprise, qui peuvent désigner des personnes (contacts, interlocuteurs).',
              'Vous et les autres membres',
            ],
            [
              'Collaborateurs (module RH)',
              'Fiches du personnel saisies par l’organisation : identité, poste, coordonnées professionnelles, absences, documents RH.',
              'Les membres habilités de l’organisation',
            ],
            [
              'Présences (pointage), si votre organisation l’active',
              'Pour chaque collaborateur : sens du pointage (arrivée ou départ), heure du serveur, origine (le collaborateur, son manager ou les RH), note de saisie, demandes de correction et leur motif. Aucune position, photo, empreinte ni identifiant d’appareil.',
              'Le collaborateur, son manager ou les RH',
            ],
            [
              'Objectifs et évaluations, si votre organisation les active',
              'Objectifs et avancement déclaré, auto-évaluation, appréciations et notes choisies par l’évaluateur, commentaire du collaborateur, note RH — chiffrés. Aucune note n’est calculée par Lalanda ni par l’IA.',
              'Le collaborateur, son évaluateur, les RH',
            ],
            [
              'Notes de frais et avances',
              'Lignes de dépense, montants, justificatifs déposés, circuit de validation, moyen de remboursement choisi (espèces, mobile money, virement) sans numéro de compte.',
              'Le collaborateur, puis les validateurs',
            ],
            [
              'Formulaire public de prospects, si votre organisation en publie un',
              'Nom, entreprise, adresse email, téléphone, message et source déclarés par le visiteur ; texte du consentement affiché et date ; empreinte salée de l’adresse IP (jamais l’adresse en clair).',
              'Le visiteur du formulaire',
            ],
            [
              'Administration de la plateforme',
              'Métadonnées des comptes et organisations consultées par les opérateurs de Lalanda (nom, adresse email, offre, état de l’abonnement, usage) ; journal de leurs gestes avec motif et note interne ; accusés de lecture des messages de service ; statistiques agrégées par organisations.',
              'Automatique et opérateurs de Lalanda',
            ],
            [
              'Paiement manuel d’un abonnement',
              'Référence de la demande, offre, période, montant, moyen choisi (mobile money ou virement) et décision de l’administrateur qui confirme ou rejette. Aucune coordonnée du payeur (numéro de téléphone, numéro de compte) n’est enregistrée.',
              'Vous, puis un administrateur de Lalanda',
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
          <strong>Données que votre organisation saisit sur d&apos;autres personnes</strong>{' '}
          (collaborateurs, clients, prospects, contacts)&nbsp;: votre organisation décide de leur
          usage et en est responsable&nbsp;; Lalanda les héberge et les traite pour son compte, sans
          les réutiliser pour lui-même. Les personnes concernées exercent leurs droits auprès de
          l&apos;organisation.
        </p>
        <p>
          Nous ne demandons aucune donnée sensible (santé, opinions, appartenance syndicale…), à une
          exception près&nbsp;: le module RH permet d&apos;enregistrer une absence de type
          «&nbsp;maladie&nbsp;», ce qui révèle une information liée à la santé d&apos;un
          collaborateur. Le service n&apos;a pas d&apos;autre champ prévu pour recevoir une donnée
          sensible.
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
            'Gérer le paiement des abonnements : paiement manuel par mobile money ou virement, confirmé par un administrateur de Lalanda après constat du dépôt.',
            'Facturer les abonnements, lorsque la facturation sera en service.',
            'Administrer la plateforme : traiter les demandes de support et de paiement, bloquer un compte ou suspendre une organisation en cas de fraude ou d’atteinte à la sécurité, avec un motif ; tenir le journal de ces gestes ; établir des statistiques agrégées (aucune case de moins de 5 organisations) ; adresser des messages de service dans l’application, jamais de prospection par email.',
            'Pour le compte de votre organisation : tenir ses dossiers RH, présences, notes de frais et évaluations, et recevoir les demandes de son formulaire public de prospects.',
            'Respecter nos obligations légales et comptables.',
          ]}
        />
        <p>
          <ToComplete>
            qualification des bases légales (exécution du contrat, intérêt légitime, obligation
            légale, consentement) au regard du régime de protection des données applicable. Ce point
            dépend du droit congolais dont relève l’éditeur et de la localisation des utilisateurs —
            il est ouvert et documenté, pas tranché
          </ToComplete>
        </p>
      </>
    ),
  },
  {
    id: 'ia-openai',
    title: 'Assistance IA : ce qui est transmis à OpenAI et à ElevenLabs',
    body: (
      <>
        <p>
          Plusieurs fonctions d&apos;assistance de Lalanda font appel à un prestataire tiers,{' '}
          <strong>OpenAI</strong>, qui traite sur son infrastructure, via son interface de
          programmation, les données que chaque fonction lui transmet. La première est la fonction
          d&apos;<strong>actions correctives</strong>&nbsp;: à partir des ratios de votre plan qui
          sortent des seuils attendus, elle suggère des pistes de correction. Les autres sont
          décrites plus bas.{' '}
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

        <p className="font-semibold">Actions correctives : ce qui est envoyé</p>
        <LegalList
          items={[
            'L’identifiant du modèle sectoriel de votre projet (par exemple « commerce de détail »).',
            'La devise d’affichage du projet.',
            'Pour chaque ratio en anomalie seulement : son identifiant, son libellé, sa valeur calculée, le seuil de référence, le sens du seuil et la gravité (orange ou rouge).',
          ]}
        />

        <p className="font-semibold">Actions correctives : ce qui n&apos;est pas envoyé</p>
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

        <p className="font-semibold">Les autres fonctions qui transmettent des données à OpenAI</p>
        <LegalList
          items={[
            'Lala, interprétation et échange sur les résultats : le modèle sectoriel, la devise, le nom de la feuille de résultats et ses lignes (libellé, valeur calculée, format, seuil éventuel), ainsi que les messages que vous écrivez à Lala. Ces lignes peuvent être des états financiers de votre plan.',
            'Explication du brief du matin : la période, les faits du brief que votre rôle peut voir (ventes, trésorerie, réalisé…), avec leurs valeurs, les alertes et les recommandations du moteur. Aucun nom d’organisation, de client ou d’utilisateur, aucun numéro de facture.',
            'Brouillon d’une section du business plan : la section et ses questions, vos réponses et le texte actuel de la section, des cartes du Canvas, des hypothèses et des résultats de synthèse du plan. Le texte que vous avez saisi part tel quel.',
            'Assistance de l’Idea Lab : les champs de la fiche d’idée que vous avez saisis, sans le nom de l’organisation ni des membres, ni les notes d’entretien.',
          ]}
        />
        <p>
          Ces fonctions transmettent donc, pour certaines, des chiffres de votre plan financier, de
          votre réalisé ou de votre trésorerie, et du texte libre saisi par vous. Écrire un nom ou
          une information personnelle dans ce texte le transmet aussi.
        </p>

        <p className="font-semibold">Appel vocal avec Lala : ElevenLabs</p>
        <p>
          Lorsque vous lancez un appel vocal avec Lala, votre navigateur ouvre une session avec un
          autre prestataire, <strong>ElevenLabs</strong>&nbsp;: votre voix et la conversation sont
          traitées par ce prestataire. Notre serveur ne lui transmet, pour ouvrir la session, ni
          votre nom, ni votre organisation, ni les données de votre projet.
        </p>

        <p className="font-semibold">Comment vous y opposer</p>
        <LegalList
          items={[
            'Ces fonctions ne s’exécutent jamais d’elles-mêmes. Aucune donnée ne part tant que vous ne déclenchez pas l’une d’elles (demander des actions correctives, une interprétation, une explication, un brouillon, lancer un appel vocal) : ne pas les utiliser suffit à ce qu’aucun transfert n’ait lieu.',
            'Refuser ces fonctions ne dégrade rien d’autre. Les calculs, les états financiers, les ratios et les exports sont produits par le moteur financier de Lalanda, sans aucune intervention d’un modèle d’IA.',
            'Si vous souhaitez que ces fonctions soient désactivées pour l’ensemble de votre organisation, écrivez-nous : nous les coupons sur demande.',
          ]}
        />
        <p>
          <ToComplete>
            réglage en libre-service, dans les paramètres de l’organisation, permettant de
            désactiver l’assistance IA sans nous écrire — non implémenté à ce jour
          </ToComplete>
        </p>

        <p className="font-semibold">Ce que devient la donnée chez les prestataires d&apos;IA</p>
        <p>
          Les suggestions renvoyées ne sont jamais reprises comme chiffres officiels&nbsp;: elles
          sont affichées comme du texte, et le moteur financier reste seul à calculer. Nous
          n&apos;utilisons pas vos données pour entraîner un modèle, et OpenAI indique ne pas
          entraîner ses modèles sur les données reçues via son interface de programmation.
        </p>
        <p>
          <ToComplete>
            accord de traitement (DPA) à conclure avec OpenAI et ElevenLabs, durée de conservation
            appliquée de leur côté, et instrument encadrant le transfert hors du pays de
            l’utilisateur — à formaliser avant mise en service commerciale
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
              'Fonctions d’assistance IA : actions correctives, Lala, explication du brief du matin, brouillons du business plan, Idea Lab (voir la section précédente).',
              'En service dès qu’une clé d’accès est configurée',
            ],
            [
              'ElevenLabs',
              'Appel vocal avec Lala : traitement de la voix et de la conversation (voir la section précédente).',
              'En service dès qu’une clé d’accès est configurée',
            ],
            [
              'DigitalOcean',
              'Hébergement des serveurs, de la base de données et du stockage des fichiers (exports et documents déposés).',
              'En service',
            ],
            [
              'Zoho ZeptoMail',
              'Envoi des e-mails du service : vérification d’adresse, réinitialisation du mot de passe, invitations, brief du matin et alertes, ainsi que les documents de vente (factures, avoirs, pro forma, devis) que vous adressez à vos clients depuis l’application.',
              'En service',
            ],
            [
              <ToComplete key="p">prestataire de paiement</ToComplete>,
              'Paiement en ligne des abonnements (carte, PayPal) et émission des factures.',
              'Non désigné dans cette politique — le paiement manuel, lui, ne passe par aucun prestataire de Lalanda',
            ],
          ]}
        />
        <p>
          Le paiement manuel d&apos;un abonnement (mobile money ou virement) n&apos;implique aucun
          prestataire de paiement côté Lalanda&nbsp;: vous effectuez le dépôt auprès de votre
          opérateur ou de votre banque, puis un administrateur de Lalanda constate la réception et
          confirme la demande.
        </p>
        <p>
          Pour établir la facture de chaque abonnement payé, la raison sociale, le NIF et
          l&apos;adresse de facturation de l&apos;organisation abonnée sont transmis à{' '}
          {PUBLISHER_NAME}, qui émet ces factures. Aucune autre donnée de l&apos;organisation ne lui
          est communiquée à cette fin.
        </p>
        <p>
          La dernière ligne décrit un rôle prévu, sans prestataire choisi. Nous la faisons figurer
          pour que cette page ne devienne pas fausse le jour où il le sera&nbsp;: sa mise en service
          donnera lieu à une mise à jour de cette politique.
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
          Certaines données quittent votre pays. C&apos;est déjà le cas pour les fonctions
          d&apos;assistance IA, traitées par OpenAI, pour l&apos;appel vocal, traité par ElevenLabs,
          et pour l&apos;hébergement, assuré par DigitalOcean.
        </p>
        <p>
          <ToComplete>
            pays d’hébergement retenu, localisation des traitements de chaque prestataire, et
            instrument juridique encadrant ces transferts (clauses contractuelles types ou
            équivalent), au regard du droit congolais dont relève l’éditeur et des règles propres
            aux utilisateurs situés dans l’Union européenne — arbitrage juridique requis
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
              'Pointages (présences)',
              '5 ans par défaut, ou la durée réglée par votre organisation ; effacés automatiquement chaque jour au-delà.',
            ],
            [
              'Évaluations, justificatifs de frais, dossiers des anciens salariés',
              'La durée réglée par votre organisation ; tant qu’aucune n’est réglée, aucun effacement automatique.',
            ],
            [
              'Demandes reçues par le formulaire de prospects et preuve du consentement',
              'Tant que l’organisation existe, sauf suppression par elle.',
            ],
            [
              'Journal de la plateforme (gestes des opérateurs, motifs, notes internes) et accusés de lecture des messages de service',
              'Sans limite de durée à ce jour (ajout seul) ; une durée sera fixée avec un juriste.',
            ],
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
            'Vous opposer à la transmission de données à OpenAI ou à ElevenLabs, en n’utilisant pas les fonctions d’assistance IA ou en nous demandant de les désactiver.',
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
            'Le paiement en service est le paiement manuel, par mobile money ou virement : l’abonnement est activé lorsqu’un administrateur de Lalanda a constaté le dépôt, et il ne se renouvelle pas automatiquement.',
            'Le paiement en ligne (carte bancaire par Stripe, PayPal) n’est ouvert que lorsqu’un prestataire est configuré et proposé à l’écran de paiement ; son ouverture donnera lieu à une mise à jour de cette politique.',
          ]}
        />
        <p>
          Ces manques seront comblés. Ils sont mentionnés ici parce qu&apos;une politique de
          confidentialité qui décrit un paiement fictif n&apos;informe personne.
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
          données à OpenAI et à ElevenLabs pour les fonctions d&apos;assistance IA, et y compris ce
          qui n&apos;existe pas encore.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
