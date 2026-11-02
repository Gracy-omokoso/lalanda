// En-tête d'un module de la console : titre et description tirés du catalogue
// (`CONSOLE_MODULES`), pour que la navigation, les cartes et la page disent la
// même chose.

import { CONSOLE_MODULES, type ModuleConsole } from './console-model';

export function moduleConsole(moduleId: string): ModuleConsole {
  const mod = CONSOLE_MODULES.find((m) => m.id === moduleId);
  if (!mod) throw new Error(`Module de console inconnu : ${moduleId}`);
  return mod;
}

export function EnTeteModule({ moduleId }: { moduleId: string }): React.ReactElement {
  const mod = moduleConsole(moduleId);
  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-display text-2xl font-bold tracking-tight">{mod.label}</h1>
      <p className="max-w-3xl text-sm text-[var(--foreground-muted)]">{mod.description}</p>
    </header>
  );
}
