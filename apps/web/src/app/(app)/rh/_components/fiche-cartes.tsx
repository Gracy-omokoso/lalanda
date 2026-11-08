'use client';

// Onglet « Cartes » de la fiche collaborateur — ADR-0069.
//
// Deux blocs : « Carte de service » (QR de vérification : émettre, réémettre en cas
// de perte, révoquer ; export PDF ou PNG 300 dpi) et « Carte de visite » (export).
// La photo est FACULTATIVE et n'est acceptée qu'après l'enregistrement du
// consentement du collaborateur (date et auteur conservés). Lecture `hr.read`,
// écriture `hr.manage` ; l'API refuse de toute façon.

import { Badge, buttonClasses } from '@lalanda/ui';
import { BadgeCheck, Camera, Download, IdCard, RefreshCw, ShieldOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  hrCardsApi,
  type CardKind,
  type CardProfileView,
  type CardSettingsView,
} from '@/lib/api-hr-cards';

import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import {
  LIBELLE_TYPE,
  messageExport,
  modelesDe,
  phraseConsentement,
  statutPublic,
  urlMasquee,
} from './cartes-model';
import { useFiche } from './fiche-chrome';
import { useAccesRh } from './rh-access';
import { RH_BASE, lire, messageRh, peutGererRh, type Lecture } from './rh-model';
import { Chargement, EchecLecture, enregistrerFichier } from './rh-ui';

const SECTION =
  'flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5';

export function FicheCartes(): React.ReactElement {
  const { fiche } = useFiche();
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions) && fiche.status !== 'anonymized';
  const [profil, setProfil] = useState<Lecture<CardProfileView> | null>(null);
  const [reglages, setReglages] = useState<CardSettingsView | null>(null);
  const [version, setVersion] = useState(0);
  const [alerte, setAlerte] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const fichierPhoto = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    let annule = false;
    void lire(hrCardsApi.profile(fiche.id)).then((l) => {
      if (!annule) setProfil(l);
    });
    void hrCardsApi
      .settings()
      .then((s) => {
        if (!annule) setReglages(s);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [fiche.id, version]);

  // Photo : lue avec la session, montrée par un lien local éphémère.
  const aPhoto = profil?.ok === true && profil.valeur.photo !== null;
  const rev = profil?.ok === true ? profil.valeur.revision : 0;
  useEffect(() => {
    if (!aPhoto) {
      setPhotoUrl(null);
      return;
    }
    let url: string | null = null;
    let annule = false;
    void hrCardsApi
      .photo(fiche.id)
      .then((f) => {
        if (annule) return;
        url = URL.createObjectURL(f.blob);
        setPhotoUrl(url);
      })
      .catch(() => setPhotoUrl(null));
    return () => {
      annule = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [aPhoto, fiche.id, rev]);

  const agir = useCallback(
    async (cle: string, fn: () => Promise<CardProfileView | void>, repli: string) => {
      setAlerte(null);
      setOccupe(cle);
      try {
        const r = await fn();
        if (r) setProfil({ ok: true, valeur: r });
      } catch (err) {
        setAlerte(cle.startsWith('export') ? messageExport(err) : messageRh(err, repli));
      } finally {
        setOccupe(null);
      }
    },
    [],
  );

  if (profil === null) return <Chargement texte="Chargement des cartes…" />;
  if (!profil.ok) {
    return (
      <EchecLecture
        erreur={profil.erreur}
        repli="Les cartes sont illisibles."
        onReessayer={() => setVersion((v) => v + 1)}
      />
    );
  }
  const p = profil.valeur;
  const statut = statutPublic(p);

  const exporter = (kind: CardKind, format: 'pdf' | 'png', face: 'recto' | 'verso' = 'recto') =>
    agir(
      `export-${kind}-${format}-${face}`,
      async () => {
        const f = await hrCardsApi.exportCard(fiche.id, { kind, format, face });
        enregistrerFichier(f.blob, f.nom);
      },
      'Export impossible.',
    );

  const modele = (kind: CardKind) => {
    if (!reglages) return null;
    const idModele = reglages[kind].templateId;
    return modelesDe(reglages.templates, kind).find((t) => t.id === idModele)?.name ?? null;
  };

  const boutonsExport = (kind: CardKind, disabled: boolean) => (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={buttonClasses('primary', 'sm')}
        disabled={disabled || occupe !== null}
        onClick={() => void exporter(kind, 'pdf')}
      >
        <Download aria-hidden="true" className="h-4 w-4" />
        PDF (impression)
      </button>
      <button
        type="button"
        className={BOUTON_PETIT}
        disabled={disabled || occupe !== null}
        onClick={() => void exporter(kind, 'png', 'recto')}
      >
        PNG 300 dpi — recto
      </button>
      {kind === 'business' || reglages?.badgeVerso !== false ? (
        <button
          type="button"
          className={BOUTON_PETIT}
          disabled={disabled || occupe !== null}
          onClick={() => void exporter(kind, 'png', 'verso')}
        >
          PNG 300 dpi — verso
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {alerte ? <Alerte>{alerte}</Alerte> : null}

      <section className={SECTION} aria-labelledby={`${id}-photo`}>
        <h2 id={`${id}-photo`} className="text-base font-semibold">
          Photo (facultative)
        </h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex h-28 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- lien local éphémère
              <img
                src={photoUrl}
                alt={`Photo de ${fiche.firstName} ${fiche.lastName}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <Camera aria-hidden="true" className="h-6 w-6 text-[var(--foreground-muted)]" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3 text-sm">
            <p className="text-[var(--foreground-muted)]">{phraseConsentement(p)}</p>
            {gerer ? (
              <>
                <fieldset className="flex flex-col gap-2">
                  <legend className="sr-only">Consentement du collaborateur</legend>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={p.consent.photo}
                      disabled={occupe !== null}
                      onChange={(e) =>
                        void agir(
                          'consent',
                          () =>
                            hrCardsApi.putConsent(fiche.id, {
                              expectedRevision: p.revision,
                              photo: e.target.checked,
                              photoPublic: e.target.checked ? p.consent.photoPublic : false,
                            }),
                          'Consentement non enregistré.',
                        )
                      }
                    />
                    <span>
                      Le collaborateur accepte de figurer en photo sur sa carte.{' '}
                      <span className="text-[var(--foreground-muted)]">
                        Décocher retire le consentement et efface la photo.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={p.consent.photoPublic}
                      disabled={occupe !== null || !p.consent.photo}
                      onChange={(e) =>
                        void agir(
                          'consent',
                          () =>
                            hrCardsApi.putConsent(fiche.id, {
                              expectedRevision: p.revision,
                              photo: true,
                              photoPublic: e.target.checked,
                            }),
                          'Consentement non enregistré.',
                        )
                      }
                    />
                    <span>
                      Il accepte aussi qu’elle s’affiche sur la page publique de vérification.
                    </span>
                  </label>
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fichierPhoto}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    aria-label="Choisir une photo"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f)
                        void agir(
                          'photo',
                          () => hrCardsApi.putPhoto(fiche.id, f),
                          'Photo refusée.',
                        );
                    }}
                  />
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    disabled={!p.consent.photo || occupe !== null}
                    onClick={() => fichierPhoto.current?.click()}
                  >
                    {p.photo ? 'Remplacer la photo' : 'Ajouter une photo'}
                  </button>
                  {p.photo ? (
                    <button
                      type="button"
                      className={BOUTON_DANGER}
                      disabled={occupe !== null}
                      onClick={() =>
                        void agir(
                          'photo-del',
                          () => hrCardsApi.removePhoto(fiche.id),
                          'Photo non retirée.',
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                      Retirer la photo
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-[var(--foreground-muted)]">
                  PNG, JPEG ou WebP, 2 Mio au plus. Les métadonnées (lieu, appareil) sont
                  supprimées.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className={SECTION} aria-labelledby={`${id}-badge`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-badge`} className="flex items-center gap-2 text-base font-semibold">
            <IdCard aria-hidden="true" className="h-5 w-5" />
            {LIBELLE_TYPE.badge}
          </h2>
          <Badge tone={statut.ton}>{statut.texte}</Badge>
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">
          Format bancaire (85,60 × 53,98 mm). Le QR mène à une page publique qui dit si la personne
          est toujours en fonction. Une carte réémise rend l’ancienne non valide.
          {modele('badge') ? ` Modèle : ${modele('badge')}.` : ''}
        </p>
        {p.verification.issued ? (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-[var(--foreground-muted)]">Émission</dt>
            <dd>
              n° {p.verification.serial}
              {p.verification.issuedAt
                ? ` du ${new Date(p.verification.issuedAt).toLocaleDateString('fr-FR')}`
                : ''}
            </dd>
            <dt className="text-[var(--foreground-muted)]">Lien de vérification</dt>
            <dd className="break-all font-mono text-xs">{urlMasquee(p.verification.url)}</dd>
          </dl>
        ) : null}
        {gerer ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BOUTON_PETIT}
              disabled={occupe !== null}
              onClick={() => {
                if (
                  p.verification.issued &&
                  !window.confirm(
                    'Réémettre la carte ? L’ancienne carte deviendra « non valide » dès maintenant (perte, vol, changement de poste).',
                  )
                ) {
                  return;
                }
                void agir(
                  'issue',
                  () => hrCardsApi.issue(fiche.id, p.revision),
                  'Émission impossible.',
                );
              }}
            >
              {p.verification.issued ? (
                <>
                  <RefreshCw aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                  Réémettre (perte, vol)
                </>
              ) : (
                <>
                  <BadgeCheck aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                  Émettre la carte
                </>
              )}
            </button>
            {p.verification.issued ? (
              <button
                type="button"
                className={BOUTON_DANGER}
                disabled={occupe !== null}
                onClick={() => {
                  if (
                    window.confirm(
                      'Révoquer la carte ? Sa vérification affichera « Carte non valide ».',
                    )
                  ) {
                    void agir(
                      'revoke',
                      () => hrCardsApi.revoke(fiche.id, p.revision),
                      'Révocation impossible.',
                    );
                  }
                }}
              >
                <ShieldOff aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                Révoquer
              </button>
            ) : null}
          </div>
        ) : null}
        {boutonsExport('badge', !p.verification.issued)}
        {!p.verification.issued ? (
          <p className="text-xs text-[var(--foreground-muted)]">
            Émettez la carte pour l’exporter : le QR a besoin de son lien de vérification.
          </p>
        ) : null}
      </section>

      <section className={SECTION} aria-labelledby={`${id}-visite`}>
        <h2 id={`${id}-visite`} className="text-base font-semibold">
          {LIBELLE_TYPE.business}
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          85 × 55 mm recto verso, fond perdu de 3 mm inclus pour l’imprimeur. Nom, poste,
          coordonnées professionnelles de la fiche ; logo, slogan et site de l’organisation.
          {modele('business') ? ` Modèle : ${modele('business')}.` : ''}
        </p>
        {boutonsExport('business', false)}
      </section>

      <p className="text-sm">
        <Link href={`${RH_BASE}/cartes`} className="underline underline-offset-2">
          Modèles, réglages et génération par lot
        </Link>
      </p>
    </div>
  );
}
