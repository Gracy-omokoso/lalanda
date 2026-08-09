// ─────────────────────────────────────────────────────────────────────────────
// AVERTISSEMENT — PROJET DE DOCUMENT, NON VALIDÉ JURIDIQUEMENT
//
// Ce texte est un PROJET de politique de cookies rédigé par l'équipe produit. Il
// n'a PAS été relu par un juriste et ne doit PAS être présenté comme conforme à
// un droit applicable. Voir docs/28-CONFORMITE-LEGALE.md.
//
// PARTICULARITÉ DE CETTE PAGE : son contenu est VÉRIFIABLE. Le tableau ci-dessous
// décrit les traceurs réellement posés par le code de ce dépôt, pas une liste
// générique. Chaque ligne doit rester exacte — ajouter un cookie sans l'y
// inscrire rend cette page fausse, ce qui est plus grave que de ne pas l'avoir
// écrite.
//
// Sources : `lib/cookie-consent.ts` (cookie de consentement), `middleware.ts`
// (cookie de session better-auth), `auth.guard.ts` (`active_org_id`),
// `app/layout.tsx` (clé `theme` en localStorage).
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import Link from 'next/link';

import { CookieChoicePanel } from '@/components/cookie-consent';
import { CONSENT_COOKIE_NAME } from '@/lib/cookie-consent';
import { legalDocument } from '@/lib/legal';
import {
  LegalList,
  LegalPage,
  LegalTable,
  ToComplete,
  type LegalSection,
} from '../_components/legal-page';

const doc = legalDocument('cookies');

export const metadata: Metadata = {
  title: `${doc.title} — Lalanda`,
  description: doc.summary,
};

const SECTIONS: readonly LegalSection[] = [
  {
    id: 'principe',
    title: 'Le principe que nous appliquons',
    body: (
      <>
        <p>
          Un cookie est un petit fichier déposé sur votre appareil par le site que vous consultez.
          Certains sont indispensables au fonctionnement du service — sans eux, vous ne pourriez pas
          rester connecté. Les autres ne le sont pas, et nous ne les déposons pas sans votre accord.
        </p>
        <LegalList
          items={[
            'Tant que vous n’avez pas répondu, les cookies non essentiels sont refusés. L’absence de réponse n’est jamais traitée comme une acceptation.',
            'Refuser est aussi simple qu’accepter : les deux boutons sont identiques, au même endroit.',
            'Votre refus est enregistré, pour que la question ne vous soit pas reposée à chaque page.',
            'Vous pouvez revenir sur votre choix à tout moment depuis cette page.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'etat-actuel',
    title: 'Ce qui est réellement déposé aujourd’hui',
    body: (
      <>
        <p>
          <strong>
            Lalanda n&apos;utilise aujourd&apos;hui aucun cookie non essentiel&nbsp;: ni mesure
            d&apos;audience, ni publicité, ni réseau social, ni widget tiers.
          </strong>{' '}
          Les seuls cookies déposés sont ceux sans lesquels le service ne fonctionne pas.
        </p>
        <p>
          Le mécanisme de consentement existe malgré tout, et par avance&nbsp;: le jour où un outil
          de mesure sera introduit, votre choix sera déjà connu et respecté, sans qu&apos;il faille
          se rappeler d&apos;aller le demander.
        </p>
      </>
    ),
  },
  {
    id: 'liste',
    title: 'Liste des cookies',
    body: (
      <>
        <p>Cookies essentiels, déposés sans consentement car nécessaires au service :</p>
        <LegalTable
          caption="Cookies essentiels déposés par Lalanda"
          headers={['Nom', 'Rôle', 'Durée']}
          rows={[
            [
              <code key="n">better-auth.session_token</code>,
              'Maintient votre session ouverte après connexion. Sans lui, chaque page vous redemanderait vos identifiants.',
              <ToComplete key="d">
                durée exacte de session à confirmer — valeur par défaut du socle d’authentification,
                non redéfinie dans le code
              </ToComplete>,
            ],
            [
              <code key="n">active_org_id</code>,
              'Mémorise l’organisation sur laquelle vous travaillez lorsque vous appartenez à plusieurs.',
              'Durée de la session',
            ],
            [
              <code key="n">{CONSENT_COOKIE_NAME}</code>,
              'Conserve votre réponse à cette bannière — y compris un refus. C’est lui qui évite que la question revienne à chaque page.',
              'Environ 6 mois',
            ],
          ]}
        />
        <p>
          Un élément supplémentaire est stocké sur votre appareil sans être un cookie&nbsp;: la clé{' '}
          <code>theme</code> en stockage local, qui retient si vous préférez l&apos;affichage clair
          ou sombre. Elle n&apos;est jamais transmise à nos serveurs et n&apos;identifie personne.
        </p>
        <p>
          Cookies non essentiels&nbsp;: <strong>aucun à ce jour.</strong> La catégorie «&nbsp;mesure
          d&apos;audience&nbsp;» est présentée dans la bannière et ci-dessous, mais elle ne
          correspond à aucun outil installé.
        </p>
      </>
    ),
  },
  {
    id: 'votre-choix',
    title: 'Votre choix, et comment le changer',
    body: (
      <>
        <p>
          Voici l&apos;état enregistré sur cet appareil. Le modifier prend effet immédiatement et ne
          nécessite aucune confirmation.
        </p>
        <CookieChoicePanel />
        <p className="text-sm text-[var(--foreground-muted)]">
          Le choix est enregistré par appareil et par navigateur, puisqu&apos;il est conservé dans
          un cookie. Sur un autre appareil, la question vous sera posée à nouveau.
        </p>
      </>
    ),
  },
  {
    id: 'navigateur',
    title: 'Réglages de votre navigateur',
    body: (
      <>
        <p>
          Indépendamment de cette page, votre navigateur permet de bloquer ou de supprimer les
          cookies. Attention&nbsp;: bloquer les cookies essentiels rend la connexion impossible —
          vous serez déconnecté à chaque page.
        </p>
        <p>
          Supprimer les cookies efface aussi votre réponse à la bannière. Elle vous sera donc
          reposée, et les cookies non essentiels resteront refusés d&apos;ici là.
        </p>
      </>
    ),
  },
  {
    id: 'evolution',
    title: 'Évolution de cette politique',
    body: (
      <>
        <p>
          L&apos;ajout d&apos;un outil de mesure ou de tout autre traceur non essentiel entraînera
          la mise à jour de cette page et de la bannière, et votre accord vous sera redemandé — un
          consentement donné sur une liste ne vaut pas pour une liste différente.
        </p>
        <p>
          Le traitement de vos données personnelles, cookies compris, est décrit dans la{' '}
          <Link href="/confidentialite" className="underline underline-offset-4">
            politique de confidentialité
          </Link>
          .
        </p>
      </>
    ),
  },
];

export default function CookiesPage(): React.ReactElement {
  return (
    <LegalPage
      slug="cookies"
      lead={
        <p>
          Cette page dit exactement ce que Lalanda dépose sur votre appareil, pourquoi, et comment
          revenir sur votre choix. Elle décrit l&apos;état réel du service, pas une liste
          type&nbsp;: aujourd&apos;hui, seuls des cookies techniques sont utilisés.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
