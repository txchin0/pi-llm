import { join } from 'node:path';

import {
  DefaultResourceLoader,
  type ExtensionFactory,
  type ResourceLoader,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent';

export type CreateSurfaceResourceLoaderOptions = {
  cwd: string;
  dataRoot: string;
  systemPrompt: string;
  settingsManager: SettingsManager;
  extensionFactories: ExtensionFactory[];
};

/** Builds an isolated resource loader with the surface extension factory. */
export async function createSurfaceResourceLoader(
  options: CreateSurfaceResourceLoaderOptions,
): Promise<ResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: join(options.dataRoot, '.pi-agent'),
    settingsManager: options.settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: options.systemPrompt,
    extensionFactories: options.extensionFactories,
  });

  await loader.reload();
  return loader;
}
