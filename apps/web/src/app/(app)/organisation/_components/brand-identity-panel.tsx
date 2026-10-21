'use client';

// Identité visuelle de l'organisation (ADR-0028 § 7) — `organization.manage`.
//
// Logos (principal + trois déclinaisons), couleurs et police, que les modèles
// de facture reprennent. Un logo remplacé n'est pas effacé : les factures déjà
// émises le gardent (réimpression à l'identique). Le 403 d'un rôle sans droit
// est un état expliqué, pas une panne.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type BrandView, type LogoVariant } from '@/lib/api';

import {
  LOGO_VARIANT_HINTS,
  accepte,
  couleurSaisie,
  preControleFichier,
  tailleLisible,
} from './brand-model';
import { estRefus, formatDateHeure, messageErreur } from './organization-model';

const CHAMP =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-50';
const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';

const MESSAGES_ENVOI: Record<string, string> = {
  UNSUPPORTED_IMAGE_TYPE: 'Format non accepté : PNG, JPEG ou WebP (le SVG est refusé).',
  FILE_TOO_LARGE: 'Fichier trop lourd.',
  IMAGE_DIMENSIONS_REJECTED: 'Dimensions refusées (de 32 à 4096 pixels de côté).',
  MALFORMED_IMAGE: 'Image illisible ou incomplète.',
  STORAGE_UNAVAILABLE: 'Le stockage des fichiers est indisponible : réessayez plus tard.',
};

export function BrandIdentityPanel(): React.ReactElement {
  const [vue, setVue] = useState<BrandView | null>(null);
  const [refuse, setRefuse] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  const [principale, setPrincipale] = useState('');
  const [secondaire, setSecondaire] = useState('');
  const [police, setPolice] = useState('');

  const appliquer = useCallback((b: BrandView): void => {
    setVue(b);
    setPrincipale(b.primaryColor ?? '');
    setSecondaire(b.secondaryColor ?? '');
    setPolice(b.font ?? '');
  }, []);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      appliquer(await api.getBrand());
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

  async function envoyer(variant: LogoVariant, fichier: File): Promise<void> {
    if (!vue) return;
    const pre = preControleFichier(fichier, vue.limits);
    setNotice(null);
    if (pre) {
      setErreur(pre);
      return;
    }
    setOccupe(variant);
    setErreur(null);
    try {
      appliquer(await api.uploadBrandLogo(variant, fichier));
      setNotice('Logo enregistré.');
    } catch (err) {
      const code = codeDe(err);
      setErreur((code && MESSAGES_ENVOI[code]) ?? messageErreur(err, 'Envoi impossible.'));
    } finally {
      setOccupe(null);
    }
  }

  async function retirer(variant: LogoVariant): Promise<void> {
    setOccupe(variant);
    setErreur(null);
    setNotice(null);
    try {
      appliquer(await api.removeBrandLogo(variant));
      setNotice('Logo retiré. Les factures déjà émises le conservent.');
    } catch (err) {
      setErreur(messageErreur(err, 'Retrait impossible.'));
    } finally {
      setOccupe(null);
    }
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
    setOccupe('identite');
    setErreur(null);
    setNotice(null);
    try {
      appliquer(
        await api.putBrandIdentity({
          primaryColor: p,
          secondaryColor: s,
          font: police === '' ? null : police,
          expectedRevision: vue.revision,
        }),
      );
      setNotice('Couleurs et police enregistrées.');
    } catch (err) {
      if (codeDe(err) === 'STALE_BRAND_REVISION') {
        setErreur('L’identité a été modifiée entre-temps : elle vient d’être rechargée.');
        await charger();
      } else {
        setErreur(messageErreur(err, 'Enregistrement impossible.'));
      }
    } finally {
      setOccupe(null);
    }
  }

  if (chargement) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  }
  if (refuse) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-sm font-medium">Section réservée à la gouvernance</p>
        <p className="mt-1 text-sm text-[var(--foreground-muted)]">
          L’identité visuelle (logos, couleurs, police des factures) se règle par un Propriétaire ou
          un Administrateur de l’organisation.
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

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <p className="text-sm text-[var(--foreground-muted)]">
        Vos logos, couleurs et police habillent vos factures selon le modèle choisi dans{' '}
        <Link href="/ventes/modele-facture" className="underline underline-offset-2">
          Ventes › Modèle de facture
        </Link>
        . Ils ne changent jamais le contenu fiscal d’une facture. Une facture déjà émise garde
        l’identité de son émission.
      </p>

      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {erreur}
        </div>
      ) : null}
      <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {notice ?? ''}
      </span>

      <section aria-labelledby="logos-titre" className="flex flex-col gap-3">
        <h2 id="logos-titre" className="font-display text-lg font-semibold">
          Logos
        </h2>
        {!vue.limits.storageAvailable ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Le stockage des fichiers n’est pas configuré sur ce serveur : l’envoi de logos est
            indisponible.
          </p>
        ) : null}
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
              desactive={!vue.limits.storageAvailable || occupe !== null}
              onEnvoi={(f) => void envoyer(v.id, f)}
              onRetrait={() => void retirer(v.id)}
            />
          ))}
        </div>
      </section>

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
          aide="Couleur d’accent des modèles « couleurs de la marque » (intitulé, bandeau, filets). Un texte posé dessus reste toujours lisible."
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
        <div className="flex flex-col gap-1.5">
          <label htmlFor="brand-police" className="text-sm font-medium">
            Police
          </label>
          <select
            id="brand-police"
            value={police}
            onChange={(e) => setPolice(e.target.value)}
            aria-describedby="brand-police-aide"
            className={CHAMP}
          >
            <option value="">Celle du modèle</option>
            {vue.fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <p id="brand-police-aide" className="text-xs text-[var(--foreground-muted)]">
            Polices libres (licence OFL) intégrées aux PDF : le rendu est identique partout.
          </p>
        </div>
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
    </div>
  );
}

function codeDe(err: unknown): string | null {
  const d = (err as { detail?: unknown } | null)?.detail;
  return typeof d === 'object' && d !== null && 'code' in d
    ? String((d as { code: unknown }).code)
    : null;
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
  logo: BrandView['logos'][LogoVariant];
  accept: string;
  occupe: boolean;
  desactive: boolean;
  onEnvoi: (f: File) => void;
  onRetrait: () => void;
}): React.ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const fondSombre = variant === 'light';
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4">
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
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label={`Choisir un fichier pour : ${label}`}
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
          {occupe ? 'Envoi…' : logo ? 'Remplacer' : 'Téléverser'}
        </button>
        {logo ? (
          <button type="button" className={BOUTON} disabled={desactive} onClick={onRetrait}>
            Retirer
          </button>
        ) : null}
      </div>
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
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} — nuancier`}
          value={typeof valide === 'string' ? valide : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent"
        />
        <input
          id={id}
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#0F5132"
          maxLength={7}
          aria-describedby={`${id}-aide`}
          aria-invalid={valide === undefined}
          className={`${CHAMP} max-w-[10rem] font-mono uppercase`}
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
