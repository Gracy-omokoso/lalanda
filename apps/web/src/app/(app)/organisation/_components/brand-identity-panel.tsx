'use client';

// Identité visuelle de l'organisation (ADR-0028 § 7, ADR-0073) — `organization.manage`.
//
// Un seul choix de logo pour tous les documents (carré ou horizontal), les
// fichiers de logo, le favicon des onglets, le motif de fond, les couleurs et la
// police, puis l'aperçu d'un document réel rendu par l'API. Un logo ou un motif
// remplacé n'est pas effacé : les documents déjà émis le gardent (réimpression à
// l'identique). Le 403 d'un rôle sans droit est un état expliqué, pas une panne.

import { Field, Select, TextInput } from '@lalanda/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type InvoiceTemplateId, type LogoVariant } from '@/lib/api';
import { brandApi, type BrandViewV2, type LogoChoice, type PatternSource } from '@/lib/api-brand';

import {
  LOGO_VARIANT_HINTS,
  accepte,
  couleurSaisie,
  preControleFichier,
  preControlePng,
  tailleLisible,
  varianteImprimee,
  vignetteMotif,
} from './brand-model';
import { estRefus, formatDateHeure, messageErreur } from './organization-model';

const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';
const CARTE = 'flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4';
const CHOIX_ACTIF = 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30';

const MESSAGES_ENVOI: Record<string, string> = {
  UNSUPPORTED_IMAGE_TYPE: 'Format non accepté (le SVG est refusé).',
  FILE_TOO_LARGE: 'Fichier trop lourd.',
  IMAGE_DIMENSIONS_REJECTED: 'Dimensions refusées.',
  MALFORMED_IMAGE: 'Image illisible ou incomplète.',
  PATTERN_NOT_TRANSPARENT: 'Le motif doit avoir un fond transparent (PNG avec canal alpha).',
  PATTERN_NOT_PNG: 'Le motif doit être un PNG transparent, non entrelacé.',
  STORAGE_UNAVAILABLE: 'Le stockage des fichiers est indisponible : réessayez plus tard.',
};

export function BrandIdentityPanel(): React.ReactElement {
  const [vue, setVue] = useState<BrandViewV2 | null>(null);
  const [refuse, setRefuse] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  const [principale, setPrincipale] = useState('');
  const [secondaire, setSecondaire] = useState('');
  const [police, setPolice] = useState('');
  const [intensite, setIntensite] = useState(8);

  const appliquer = useCallback((b: BrandViewV2): void => {
    setVue(b);
    setPrincipale(b.primaryColor ?? '');
    setSecondaire(b.secondaryColor ?? '');
    setPolice(b.font ?? '');
    setIntensite(b.pattern.intensity);
  }, []);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      appliquer(await brandApi.get());
      setRefuse(false);
    } catch (err) {
      if (estRefus(err)) setRefuse(true);
      else setErreur(messageErreur(err, 'Impossible de charger l’identité visuelle.'));
    } finally {
      setChargement(false);
    }
  }, [appliquer]);

  useEffect(() => {
    void charger();
  }, [charger]);

  /** Une écriture : occupation, erreurs, conflit de révision, message. */
  async function ecrire(
    cle: string,
    action: () => Promise<BrandViewV2>,
    succes: string,
  ): Promise<void> {
    setOccupe(cle);
    setErreur(null);
    setNotice(null);
    try {
      appliquer(await action());
      setNotice(succes);
    } catch (err) {
      const code = codeDe(err);
      if (code === 'STALE_BRAND_REVISION') {
        setErreur('L’identité a été modifiée entre-temps : elle vient d’être rechargée.');
        await charger();
      } else {
        setErreur((code && MESSAGES_ENVOI[code]) ?? messageErreur(err, 'Opération impossible.'));
      }
    } finally {
      setOccupe(null);
    }
  }

  function envoyerLogo(variant: LogoVariant, fichier: File): void {
    if (!vue) return;
    const pre = preControleFichier(fichier, vue.limits);
    if (pre) {
      setErreur(pre);
      return;
    }
    void ecrire(
      variant,
      async () => {
        await api.uploadBrandLogo(variant, fichier);
        return brandApi.get();
      },
      'Logo enregistré.',
    );
  }

  function retirerLogo(variant: LogoVariant): void {
    void ecrire(
      variant,
      async () => {
        await api.removeBrandLogo(variant);
        return brandApi.get();
      },
      'Logo retiré. Les documents déjà émis le conservent.',
    );
  }

  function choisirLogo(choix: LogoChoice): void {
    if (!vue || vue.logoChoice === choix) return;
    void ecrire(
      'choix',
      () => brandApi.putLogoChoice(choix, vue.revision),
      'Choix du logo enregistré.',
    );
  }

  function envoyerPng(type: 'favicon' | 'motif', fichier: File): void {
    if (!vue) return;
    const max =
      type === 'favicon' ? vue.imageLimits.favicon.maxBytes : vue.imageLimits.pattern.maxBytes;
    const pre = preControlePng(fichier, max);
    if (pre) {
      setErreur(pre);
      return;
    }
    void ecrire(
      type,
      type === 'favicon'
        ? () => brandApi.uploadFavicon(fichier)
        : async () => {
            const v = await brandApi.uploadPatternImage(fichier);
            // Un motif téléversé devient le motif choisi.
            return brandApi.putPattern(
              { source: 'upload', libraryId: null, intensity: v.pattern.intensity },
              v.revision,
            );
          },
      type === 'favicon' ? 'Favicon enregistré.' : 'Motif enregistré et appliqué.',
    );
  }

  function choisirMotif(source: PatternSource, libraryId: string | null): void {
    if (!vue) return;
    void ecrire(
      'motif',
      () => brandApi.putPattern({ source, libraryId, intensity: intensite }, vue.revision),
      source === 'none' ? 'Aucun motif : les documents restent sur fond blanc.' : 'Motif appliqué.',
    );
  }

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!vue) return;
    const p = couleurSaisie(principale);
    const s = couleurSaisie(secondaire);
    if (p === undefined || s === undefined) {
      setErreur('Couleur attendue au format #RRGGBB (par exemple #0F5132).');
      return;
    }
    await ecrire(
      'identite',
      async () => {
        await api.putBrandIdentity({
          primaryColor: p,
          secondaryColor: s,
          font: police === '' ? null : police,
          expectedRevision: vue.revision,
        });
        return brandApi.get();
      },
      'Couleurs et police enregistrées.',
    );
  }

  if (chargement) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  }
  if (refuse) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-sm font-medium">Section réservée à la gouvernance</p>
        <p className="mt-1 text-sm text-[var(--foreground-muted)]">
          L’identité visuelle (logos, favicon, motifs, couleurs et police des documents) se règle
          par un Propriétaire ou un Administrateur de l’organisation.
        </p>
      </div>
    );
  }
  if (!vue) {
    return (
      <p role="alert" className="text-sm text-[var(--danger)]">
        {erreur ?? 'Identité visuelle indisponible.'}
      </p>
    );
  }

  const stockage = vue.limits.storageAvailable;
  const unLogo = Boolean(vue.logos.primary || vue.logos.horizontal || vue.logos.symbol);
  const lim = vue.imageLimits;

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <p className="text-sm text-[var(--foreground-muted)]">
        Votre identité habille tous vos documents : factures, devis et avoirs (modèle choisi dans{' '}
        <Link href="/ventes/modele-facture" className="underline underline-offset-2">
          Ventes › Modèle de facture
        </Link>
        ), cartes de service et de visite, attestations et certificats, formulaires publics. Elle ne
        change jamais le contenu fiscal d’une facture. Un document déjà émis garde l’identité de son
        émission.
      </p>

      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {erreur}
        </div>
      ) : null}
      <span aria-live="polite" className="-mt-8 text-xs text-[var(--foreground-muted)]">
        {notice ?? ''}
      </span>

      {!stockage ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Le stockage des fichiers n’est pas configuré sur ce serveur : l’envoi de logos, de favicon
          et de motifs est indisponible.
        </p>
      ) : null}

      {/* ── 1. Le logo de vos documents ─────────────────────────────── */}
      <section aria-labelledby="choix-titre" className="flex flex-col gap-3">
        <h2 id="choix-titre" className="font-display text-lg font-semibold">
          Le logo de vos documents
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Un seul choix pour toute l’organisation. Dès qu’un logo est téléversé, le nom de votre
          marque n’est plus écrit à côté (votre logo le porte déjà) ; sur les factures, la raison
          sociale reste imprimée dans le bloc des mentions légales.
        </p>
        <div role="radiogroup" aria-labelledby="choix-titre" className="grid gap-4 sm:grid-cols-2">
          {vue.logoChoices.map((c) => {
            const variante = varianteImprimee(c.id, vue.logos);
            const logo = variante ? vue.logos[variante] : null;
            const actif = vue.effectiveLogoChoice === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={actif}
                disabled={occupe !== null}
                onClick={() => choisirLogo(c.id)}
                className={`${CARTE} text-left transition hover:border-[var(--accent)] disabled:opacity-60 ${actif ? CHOIX_ACTIF : ''}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  {actif ? (
                    <span className="text-xs text-[var(--accent)]">
                      {vue.logoChoice ? 'Choisi' : 'Choisi par défaut'}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`flex h-20 items-center justify-center rounded-md border border-[var(--border)] bg-white ${c.id === 'square' ? '' : 'px-4'}`}
                >
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logo.url}
                      alt={`Aperçu : ${c.label}`}
                      className={
                        c.id === 'square'
                          ? 'max-h-16 max-w-16 object-contain'
                          : 'max-h-12 max-w-[85%] object-contain'
                      }
                    />
                  ) : (
                    <span className="text-xs text-gray-500">Aucun logo : initiales et nom</span>
                  )}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {c.id === 'square'
                    ? 'Logo principal, sinon symbole. À défaut, le logo horizontal.'
                    : 'Logo horizontal. À défaut, le logo carré.'}
                  {logo && variante && variante !== (c.id === 'square' ? 'primary' : 'horizontal')
                    ? ' (repli en cours)'
                    : ''}
                </span>
              </button>
            );
          })}
        </div>
        {!unLogo ? (
          <p className="text-xs text-[var(--foreground-muted)]">
            Tant qu’aucun logo n’est téléversé, les documents gardent leurs initiales et votre nom.
          </p>
        ) : null}
      </section>

      {/* ── 2. Fichiers de logo ─────────────────────────────────────── */}
      <section aria-labelledby="logos-titre" className="flex flex-col gap-3">
        <h2 id="logos-titre" className="font-display text-lg font-semibold">
          Fichiers de logo
        </h2>
        <p className="text-xs text-[var(--foreground-muted)]">
          PNG, JPEG ou WebP, {tailleLisible(vue.limits.maxBytes)} au plus, de{' '}
          {vue.limits.minDimension} à {vue.limits.maxDimension} pixels de côté. Le SVG n’est pas
          accepté. Les métadonnées (EXIF, position GPS) sont retirées à l’envoi.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {vue.variants.map((v) => (
            <CarteLogo
              key={v.id}
              variant={v.id}
              label={v.label}
              logo={vue.logos[v.id]}
              accept={accepte(vue.limits.acceptedTypes)}
              occupe={occupe === v.id}
              desactive={!stockage || occupe !== null}
              onEnvoi={(f) => envoyerLogo(v.id, f)}
              onRetrait={() => retirerLogo(v.id)}
            />
          ))}
        </div>
      </section>

      {/* ── 3. Favicon ──────────────────────────────────────────────── */}
      <section aria-labelledby="favicon-titre" className="flex flex-col gap-3">
        <h2 id="favicon-titre" className="font-display text-lg font-semibold">
          Favicon
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          L’icône des onglets du navigateur dans votre espace Lalanda et sur vos pages publiques
          (vérification des cartes, formulaires). Sans favicon, celui de Lalanda s’affiche.
        </p>
        <div className={`${CARTE} sm:flex-row sm:items-center`}>
          <div className="flex items-end gap-3">
            {[16, 32, 64].map((px) => (
              <div key={px} className="flex flex-col items-center gap-1">
                <span
                  className="flex items-center justify-center rounded border border-[var(--border)] bg-white"
                  style={{ width: px + 8, height: px + 8 }}
                >
                  {vue.favicon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={vue.favicon.url} alt="" width={px} height={px} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/icon.png" alt="" width={px} height={px} />
                  )}
                </span>
                <span className="fig text-[10px] text-[var(--foreground-muted)]">{px} px</span>
              </div>
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <p className="text-xs text-[var(--foreground-muted)]">
              PNG carré, {lim.favicon.recommended} × {lim.favicon.recommended} pixels conseillés (de{' '}
              {lim.favicon.minDimension} à {lim.favicon.maxDimension}),{' '}
              {tailleLisible(lim.favicon.maxBytes)} au plus. Un dessin simple et contrasté reste
              lisible à 16 pixels.
              {vue.favicon
                ? ` Actuel : ${vue.favicon.width} × ${vue.favicon.height} px · ${tailleLisible(vue.favicon.byteSize)}.`
                : ''}
            </p>
            <BoutonsFichier
              label="favicon"
              accept="image/png"
              present={vue.favicon !== null}
              occupe={occupe === 'favicon'}
              desactive={!stockage || occupe !== null}
              onEnvoi={(f) => envoyerPng('favicon', f)}
              onRetrait={() =>
                void ecrire('favicon', () => brandApi.removeFavicon(), 'Favicon retiré.')
              }
            />
          </div>
        </div>
      </section>

      {/* ── 4. Motif de fond ────────────────────────────────────────── */}
      <section aria-labelledby="motif-titre" className="flex flex-col gap-3">
        <h2 id="motif-titre" className="font-display text-lg font-semibold">
          Motif de fond
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Un motif discret derrière vos factures, devis, avoirs, cartes, attestations et
          certificats. Le cadre DGI et le QR code restent sur fond blanc ; l’intensité est bornée
          pour que le texte reste lisible.
        </p>
        <div
          role="radiogroup"
          aria-labelledby="motif-titre"
          className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6"
        >
          <VignetteMotif
            label="Aucun motif"
            actif={vue.pattern.source === 'none'}
            desactive={occupe !== null}
            onChoix={() => choisirMotif('none', null)}
          />
          {vue.patterns.map((p) => (
            <VignetteMotif
              key={p.id}
              label={p.label}
              image={vignetteMotif(p.id, vue.primaryColor)}
              taille="auto"
              actif={vue.pattern.source === 'library' && vue.pattern.libraryId === p.id}
              desactive={occupe !== null}
              onChoix={() => choisirMotif('library', p.id)}
            />
          ))}
          {vue.patternImage ? (
            <VignetteMotif
              label="Votre motif"
              image={vue.patternImage.url}
              taille="64px auto"
              actif={vue.pattern.source === 'upload'}
              desactive={occupe !== null}
              onChoix={() => choisirMotif('upload', null)}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="motif-intensite" className="text-sm font-medium">
            Intensité : <span className="fig">{intensite} %</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="motif-intensite"
              type="range"
              min={lim.intensity.min}
              max={lim.intensity.max}
              step={1}
              value={intensite}
              onChange={(e) => setIntensite(Number(e.target.value))}
              aria-describedby="motif-intensite-aide"
              className="w-full max-w-xs accent-[var(--accent)]"
            />
            {intensite !== vue.pattern.intensity && vue.pattern.source !== 'none' ? (
              <button
                type="button"
                className={BOUTON}
                disabled={occupe !== null}
                onClick={() => choisirMotif(vue.pattern.source, vue.pattern.libraryId)}
              >
                Appliquer
              </button>
            ) : null}
          </div>
          <p id="motif-intensite-aide" className="text-xs text-[var(--foreground-muted)]">
            De {lim.intensity.min} à {lim.intensity.max} % ; {lim.intensity.default} % conseillé.
          </p>
        </div>

        <div className={CARTE}>
          <p className="text-sm font-medium">Téléverser votre motif</p>
          <ul className="list-disc pl-5 text-xs text-[var(--foreground-muted)]">
            <li>
              PNG <strong>transparent obligatoire</strong> (canal alpha), vérifié à l’envoi : un
              fond plein est refusé.
            </li>
            <li>
              Tuile répétée : {lim.pattern.recommended} × {lim.pattern.recommended} pixels
              conseillés (de {lim.pattern.minDimension} à {lim.pattern.maxDimension}),{' '}
              {tailleLisible(lim.pattern.maxBytes)} au plus.
            </li>
            <li>
              Dessin sombre et fin sur fond transparent ; l’opacité est réglée par l’intensité
              ci-dessus (8 % conseillé).
            </li>
          </ul>
          <BoutonsFichier
            label="motif"
            accept="image/png"
            present={vue.patternImage !== null}
            occupe={occupe === 'motif'}
            desactive={!stockage || occupe !== null}
            onEnvoi={(f) => envoyerPng('motif', f)}
            onRetrait={() =>
              void ecrire(
                'motif',
                () => brandApi.removePatternImage(),
                'Motif retiré. Les documents déjà émis le conservent.',
              )
            }
          />
        </div>
      </section>

      {/* ── 5. Couleurs et police ───────────────────────────────────── */}
      <form
        onSubmit={(e) => void enregistrer(e)}
        aria-labelledby="couleurs-titre"
        className="flex max-w-2xl flex-col gap-4"
      >
        <h2 id="couleurs-titre" className="font-display text-lg font-semibold">
          Couleurs et police
        </h2>
        <ChampCouleur
          id="brand-principale"
          label="Couleur principale"
          aide="Couleur d’accent des documents (intitulé, bandeau, filets, motifs). Un texte posé dessus reste toujours lisible."
          valeur={principale}
          onChange={setPrincipale}
        />
        <ChampCouleur
          id="brand-secondaire"
          label="Couleur secondaire"
          aide="Teinte douce des fonds de tableau. Laissez vide pour la dériver de la couleur principale."
          valeur={secondaire}
          onChange={setSecondaire}
        />
        <Field
          id="brand-police"
          label="Police"
          size="md"
          className="max-w-sm"
          hint="Polices libres (licence OFL) intégrées aux PDF : le rendu est identique partout."
        >
          <Select
            value={police}
            onChange={setPolice}
            options={[
              { value: '', label: 'Celle du modèle' },
              ...vue.fonts.map((f) => ({ value: f.id, label: f.label })),
            ]}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={occupe !== null} className={BOUTON}>
            {occupe === 'identite' ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <span className="fig text-xs text-[var(--foreground-muted)]">
            {vue.updatedAt
              ? `Dernière modification : ${formatDateHeure(vue.updatedAt)}`
              : 'Jamais modifiée'}
          </span>
        </div>
      </form>

      {/* ── 6. Aperçu ───────────────────────────────────────────────── */}
      <ApercuDocument revision={vue.revision} />
    </div>
  );
}

function codeDe(err: unknown): string | null {
  const d = (err as { detail?: unknown } | null)?.detail;
  return typeof d === 'object' && d !== null && 'code' in d
    ? String((d as { code: unknown }).code)
    : null;
}

/** Aperçu RÉEL (PNG rendu par l'API) d'une facture fictive marquée EXEMPLE. */
function ApercuDocument({ revision }: { revision: number }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [modele, setModele] = useState<string | null>(null);
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'indisponible'>('chargement');

  useEffect(() => {
    let annule = false;
    let objet: string | null = null;
    setEtat('chargement');
    void (async () => {
      try {
        const modeles = await api.getInvoiceTemplates();
        const courant = modeles.current?.templateId;
        const id: InvoiceTemplateId = courant && courant !== 'sur-mesure' ? courant : 'classique';
        const blob = await api.getInvoiceTemplatePreview(id, {}, 'png');
        if (annule) return;
        objet = URL.createObjectURL(blob);
        setUrl(objet);
        setModele(modeles.templates.find((t) => t.id === id)?.label ?? id);
        setEtat('pret');
      } catch {
        if (!annule) setEtat('indisponible');
      }
    })();
    return () => {
      annule = true;
      if (objet) URL.revokeObjectURL(objet);
    };
  }, [revision]);

  return (
    <section aria-labelledby="apercu-titre" className="flex flex-col gap-3">
      <h2 id="apercu-titre" className="font-display text-lg font-semibold">
        Aperçu d’un document
      </h2>
      <p className="text-sm text-[var(--foreground-muted)]">
        Facture fictive marquée EXEMPLE, rendue par le vrai moteur
        {modele ? ` avec le modèle ${modele}` : ''} et votre identité enregistrée. Elle se met à
        jour à chaque changement.
      </p>
      <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-muted,var(--surface))] p-3">
        {etat === 'pret' && url ? (
          // Image produite localement (objet `blob:`) ; `next/image` n'apporte rien.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Aperçu de la première page d’une facture fictive"
            className="w-full max-w-xl rounded border border-[var(--border)] bg-white shadow-sm"
          />
        ) : etat === 'chargement' ? (
          <span className="text-sm text-[var(--foreground-muted)]">Rendu de l’aperçu…</span>
        ) : (
          <span className="text-sm text-[var(--foreground-muted)]">
            Aperçu indisponible (rendu PDF non configuré sur ce serveur, ou module Ventes
            inaccessible).
          </span>
        )}
      </div>
    </section>
  );
}

function VignetteMotif({
  label,
  image,
  taille,
  actif,
  desactive,
  onChoix,
}: {
  label: string;
  image?: string;
  taille?: string;
  actif: boolean;
  desactive: boolean;
  onChoix: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={actif}
      aria-label={label}
      disabled={desactive}
      onClick={onChoix}
      className={`flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-1.5 text-left transition hover:border-[var(--accent)] disabled:opacity-60 ${actif ? CHOIX_ACTIF : ''}`}
    >
      <span
        aria-hidden="true"
        className="block h-16 w-full rounded bg-white"
        style={
          image
            ? {
                backgroundImage: `url("${image}")`,
                backgroundRepeat: 'repeat',
                backgroundSize: taille ?? 'auto',
              }
            : undefined
        }
      >
        {!image ? (
          <span className="flex h-full items-center justify-center text-[10px] text-gray-500">
            Fond blanc
          </span>
        ) : null}
      </span>
      <span className="truncate text-xs">{label}</span>
    </button>
  );
}

function BoutonsFichier({
  label,
  accept,
  present,
  occupe,
  desactive,
  onEnvoi,
  onRetrait,
}: {
  label: string;
  accept: string;
  present: boolean;
  occupe: boolean;
  desactive: boolean;
  onEnvoi: (f: File) => void;
  onRetrait: () => void;
}): React.ReactElement {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={`Choisir un fichier : ${label}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onEnvoi(f);
        }}
      />
      <button
        type="button"
        className={BOUTON}
        disabled={desactive}
        onClick={() => input.current?.click()}
      >
        {occupe ? 'Envoi…' : present ? 'Remplacer' : 'Téléverser'}
      </button>
      {present ? (
        <button type="button" className={BOUTON} disabled={desactive} onClick={onRetrait}>
          Retirer
        </button>
      ) : null}
    </div>
  );
}

function CarteLogo({
  variant,
  label,
  logo,
  accept,
  occupe,
  desactive,
  onEnvoi,
  onRetrait,
}: {
  variant: LogoVariant;
  label: string;
  logo: BrandViewV2['logos'][LogoVariant];
  accept: string;
  occupe: boolean;
  desactive: boolean;
  onEnvoi: (f: File) => void;
  onRetrait: () => void;
}): React.ReactElement {
  const fondSombre = variant === 'light';
  return (
    <div className={CARTE}>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[var(--foreground-muted)]">{LOGO_VARIANT_HINTS[variant]}</p>
      </div>
      <div
        className={`flex h-24 items-center justify-center rounded-md border border-[var(--border)] ${
          fondSombre ? 'bg-[#1f2937]' : 'bg-white'
        }`}
      >
        {logo ? (
          // URL signée servie par l'API (img-src autorise son origine) ; `next/image`
          // n'apporterait rien à une vignette déjà bornée côté serveur.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo.url} alt={label} className="max-h-20 max-w-[80%] object-contain" />
        ) : (
          <span className={`text-xs ${fondSombre ? 'text-gray-300' : 'text-gray-500'}`}>
            Aucun logo
          </span>
        )}
      </div>
      {logo ? (
        <p className="fig text-xs text-[var(--foreground-muted)]">
          {logo.width} × {logo.height} px · {tailleLisible(logo.byteSize)}
        </p>
      ) : null}
      <BoutonsFichier
        label={label}
        accept={accept}
        present={logo !== null}
        occupe={occupe}
        desactive={desactive}
        onEnvoi={onEnvoi}
        onRetrait={onRetrait}
      />
    </div>
  );
}

function ChampCouleur({
  id,
  label,
  aide,
  valeur,
  onChange,
}: {
  id: string;
  label: string;
  aide: string;
  valeur: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  const valide = couleurSaisie(valeur);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={`${label} — nuancier`}
          value={typeof valide === 'string' ? valide : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent"
        />
        <TextInput
          id={id}
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#0F5132"
          maxLength={7}
          aria-describedby={`${id}-aide`}
          aria-invalid={valide === undefined}
          className="max-w-[10rem] font-mono uppercase"
        />
        {valeur !== '' ? (
          <button type="button" className={BOUTON} onClick={() => onChange('')}>
            Effacer
          </button>
        ) : null}
      </div>
      <p id={`${id}-aide`} className="text-xs text-[var(--foreground-muted)]">
        {aide}
      </p>
    </div>
  );
}
