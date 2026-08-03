// packages/engine — squelette S0.
// Le contenu réel (compilateur DSL, graphe, moteur HyperFormula, générateur xlsx)
// arrive en S1 (moteur) et S2 (export + golden files) — voir brief §11.

export const ENGINE_VERSION = '0.1.0';

/** Placeholder — sera remplacé par le vrai compilateur DSL en S1. */
export function engineHealth(): { ok: true; version: string } {
  return { ok: true, version: ENGINE_VERSION };
}
