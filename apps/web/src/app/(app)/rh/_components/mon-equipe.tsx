'use client';

// Mon équipe — ADR-0045 § 8 (lot H6), pour les managers : membres directs et
// indirects (portée calculée par l'API), présence du jour, soldes (moteur),
// demandes à valider et calendrier de l'équipe. Un membre qui n'encadre personne
// l'apprend en une phrase.

import { CalendarDays, ClipboardCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { hrApi, type HrTeamView } from '@/lib/api-hr';

import { CalendrierAbsences } from './calendrier-absences';
import { porteesProposees } from './calendrier-model';
import { membresEquipe, type MembreEquipe } from './equipe-model';
import { useAccesRh } from './rh-access';
import { aujourdhui, initiales, lienCollaborateur, lire, peutLireRh, type Lecture } from './rh-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection } from './rh-ui';
import { ValidationsListe } from './validations-liste';

function Carte({ m, lien }: { m: MembreEquipe; lien: string | null }): React.ReactElement {
  const contenu = (
    <>
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-xs font-semibold"
        >
          {initiales(m.nom)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold break-words">{m.nom}</span>
          <span className="text-xs text-[var(--foreground-muted)] break-words">{m.poste}</span>
        </span>
      </span>
      {m.presence ? (
        <span
          className={`text-xs ${m.presence.absent ? 'font-medium' : 'text-[var(--foreground-muted)]'}`}
        >
          {m.presence.texte}
        </span>
      ) : (
        <span className="text-xs text-[var(--foreground-muted)]">Aucune absence prévue</span>
      )}
      {m.soldes.map((s) => (
        <span key={s} className="text-xs text-[var(--foreground-muted)]">
          {s}
        </span>
      ))}
    </>
  );
  const classe =
    'flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm';
  return lien ? (
    <Link
      href={lien}
      className={`${classe} transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]`}
    >
      {contenu}
    </Link>
  ) : (
    <div className={classe}>{contenu}</div>
  );
}

export function MonEquipe(): React.ReactElement {
  const { actions, moi } = useAccesRh();
  const [lecture, setLecture] = useState<Lecture<HrTeamView> | null>(null);
  const [version, setVersion] = useState(0);
  const lireRh = peutLireRh(actions);
  const pasManager = moi?.ok === true && !moi.valeur.isManager;

  useEffect(() => {
    if (pasManager) return;
    let annule = false;
    void lire(hrApi.getTeam()).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [pasManager, version]);

  const jour = aujourdhui();
  // La fiche d'un membre de l'équipe est lisible par son manager (§ 3.1).
  const lien = (id: string): string => lienCollaborateur(id);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Users}
        titre="Mon équipe"
        sousTitre="Les personnes dont vous êtes le manager, directement ou par un manager intermédiaire."
      />

      {moi === null ? <Chargement /> : null}
      {pasManager ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucun collaborateur n’a votre fiche pour manager : vous n’encadrez personne pour le
          moment.
          {moi?.ok && moi.valeur.canApprove ? ' Les absences à valider restent dans « À valider ».' : ''}
        </p>
      ) : null}

      {!pasManager && moi !== null ? (
        <>
          <Panneau titre="Membres" icone={Users} id="rh-equipe-membres">
            {lecture === null ? (
              <Chargement />
            ) : !lecture.ok ? (
              <EchecLecture
                erreur={lecture.erreur}
                repli="Votre équipe est illisible."
                onReessayer={() => setVersion((v) => v + 1)}
              />
            ) : (
              (() => {
                const { directs, indirects } = membresEquipe(lecture.valeur, jour);
                if (directs.length + indirects.length === 0) {
                  return <PhraseSection>Votre équipe est vide.</PhraseSection>;
                }
                return (
                  <div className="flex flex-col gap-4">
                    {[
                      { titre: 'Directement rattachés', liste: directs },
                      { titre: 'Par un manager intermédiaire', liste: indirects },
                    ]
                      .filter((g) => g.liste.length > 0)
                      .map((g) => (
                        <div key={g.titre} className="flex flex-col gap-2">
                          <h4 className="text-xs font-semibold text-[var(--foreground-muted)]">{g.titre}</h4>
                          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {g.liste.map((m) => (
                              <li key={m.id}>
                                <Carte m={m} lien={lien(m.id)} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                );
              })()
            )}
          </Panneau>

          <Panneau titre="À valider" icone={ClipboardCheck} id="rh-equipe-validations">
            <ValidationsListe limite={20} />
          </Panneau>

          <Panneau titre="Calendrier de l’équipe" icone={CalendarDays} id="rh-equipe-calendrier">
            <CalendrierAbsences
              portees={porteesProposees({ isManager: true, lireRh })}
              porteeInitiale="team"
            />
          </Panneau>
        </>
      ) : null}
    </section>
  );
}
