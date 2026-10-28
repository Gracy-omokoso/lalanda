// Accueil du nouvel utilisateur (S22d) — affiché à la place de la liste de
// projets tant qu'il n'y en a aucun.
//
// Parti pris : pas de visite guidée, pas de fenêtre modale, pas de surlignage
// d'éléments. Un utilisateur qui découvre l'outil veut savoir dans quel ordre
// procéder, pas être promené. Le bloc disparaît définitivement dès le premier
// projet créé — il n'a donc pas besoin d'être masquable.
//
// Le formulaire de création est juste au-dessus dans la page : l'étape 1 y
// renvoie plutôt que de la dupliquer.

import Link from 'next/link';

const ETAPES: { titre: string; texte: string; lien?: { href: string; libelle: string } }[] = [
  {
    titre: 'Décrivez votre activité',
    texte:
      'Choisissez votre pays, puis le modèle le plus proche de votre métier — restaurant, négoce, prestation de services, e-commerce. Le modèle décide des questions qu’on vous posera. Il n’est plus modifiable ensuite.',
    lien: { href: '/aide/demarrer#choisir-un-modele', libelle: 'Comment choisir' },
  },
  {
    titre: 'Remplacez les valeurs suggérées par les vôtres',
    texte:
      'Le projet arrive pré-rempli avec des ordres de grandeur du secteur. Ce ne sont pas vos chiffres. Reprenez surtout l’investissement, l’apport et le crédit : ce sont eux que la banque regarde en premier. Vos saisies sont enregistrées automatiquement.',
    lien: { href: '/aide/demarrer#hypotheses-pre-remplies', libelle: 'Les valeurs suggérées' },
  },
  {
    titre: 'Lisez vos ratios, corrigez, exportez',
    texte:
      'Le moteur produit le compte d’exploitation, la trésorerie, le plan de financement, le bilan et les ratios bancaires. Vous ajustez tant que les voyants ne sont pas au vert, puis vous figez le plan et sortez le PDF et l’Excel à déposer.',
    lien: { href: '/aide/ratios-bancaires', libelle: 'Les ratios que la banque regarde' },
  },
];

export function PremiersPas(): React.ReactElement {
  return (
    <section
      aria-labelledby="premiers-pas-titre"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8"
    >
      <p className="font-mono text-[0.62rem] font-semibold tracking-[0.14em] text-[var(--foreground-muted)]">
        PREMIER PROJET
      </p>
      <h2
        id="premiers-pas-titre"
        className="font-display mt-2 text-[1.5rem] font-black leading-tight tracking-tight text-[var(--foreground)]"
      >
        Trois étapes pour un dossier présentable en banque.
      </h2>
      <p className="mt-2.5 max-w-[46rem] text-[0.95rem] leading-relaxed text-[var(--foreground-muted)]">
        Vous n’avez aucun calcul à faire et vous n’avez pas besoin d’être comptable. Vous décrivez
        votre activité en langage courant ; Lalanda produit les états financiers et les ratios que
        votre banque attend. Comptez une à deux heures pour un premier dossier sérieux — l’essentiel
        du temps sert à réunir vos vrais chiffres.
      </p>

      <ol className="mt-7 grid gap-6 sm:grid-cols-3">
        {ETAPES.map((etape, i) => (
          <li key={etape.titre} className="flex flex-col gap-2">
            <span
              aria-hidden="true"
              className="font-mono inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-strong)] text-[0.72rem] font-semibold text-[var(--foreground-muted)]"
            >
              {i + 1}
            </span>
            <p className="font-display text-[0.98rem] font-bold leading-snug text-[var(--foreground)]">
              {etape.titre}
            </p>
            <p className="text-[0.88rem] leading-relaxed text-[var(--foreground-muted)]">
              {etape.texte}
            </p>
            {etape.lien ? (
              <Link
                href={etape.lien.href}
                className="mt-auto pt-1 text-[0.85rem] font-medium text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2 transition hover:decoration-[var(--accent)]"
              >
                {etape.lien.libelle} →
              </Link>
            ) : null}
          </li>
        ))}
      </ol>

      <p className="mt-7 border-t border-[var(--border)] pt-5 text-[0.88rem] leading-relaxed text-[var(--foreground-muted)]">
        Créez votre projet avec le formulaire ci-dessus. Si un mot vous arrête — BFR, DSCR, apport,
        point mort — le{' '}
        <Link
          href="/aide/glossaire"
          className="font-medium text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2"
        >
          glossaire
        </Link>{' '}
        les explique en français courant, et le{' '}
        <Link
          href="/aide"
          className="font-medium text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2"
        >
          centre d’aide
        </Link>{' '}
        détaille chaque étape.
      </p>
    </section>
  );
}
