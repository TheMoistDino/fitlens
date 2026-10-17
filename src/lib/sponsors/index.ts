import type { SponsorPlugin } from './types';
import { createStepFunPlugin } from './stepfun/stepfunPlugin';
import { createFetchAiPlugin } from './fetchai/fetchaiPlugin';
import { createPhotonPlugin } from './photon/photonPlugin';
import { createGlassesPlugin } from './smart-glasses/glassesPlugin';

export { sponsorBus, registerPlugins, getPluginHealth, onPluginHealthChange } from './SponsorEventBus';
export { registerGlassesAdapter, glassesController } from './smart-glasses/glassesPlugin';

/** The default plugin set. Comment one out to drop a sponsor — nothing else needs to change. */
export function defaultPlugins(): SponsorPlugin[] {
  return [createStepFunPlugin(), createFetchAiPlugin(), createPhotonPlugin(), createGlassesPlugin()];
}
