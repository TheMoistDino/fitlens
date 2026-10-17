import type { PluginHealth, SponsorPlugin } from '../types';
import { notifyHealthChanged } from '../SponsorEventBus';
import { AgentDiscoveryClient, type DiscoveredAgent } from './AgentDiscoveryClient';

/**
 * Background agent discovery on boot, then forwards each finished workout to the best-matching
 * agent (e.g. a nutrition planner agent) so it can respond asynchronously.
 */
export function createFetchAiPlugin(client = new AgentDiscoveryClient()): SponsorPlugin & {
  getAgents(): DiscoveredAgent[];
} {
  let agents: DiscoveredAgent[] = [];
  let off: (() => void) | null = null;

  return {
    id: 'fetchai',
    label: 'Fetch.ai / ASI:One agents',
    init(bus) {
      // Fire-and-forget: discovery must never block app boot.
      void client.discover().then((r) => {
        if (r.ok) agents = r.value;
        notifyHealthChanged();
      });

      off = bus.on(
        'workout:ended',
        async (summary) => {
          const target = agents[0];
          if (!target) return;
          const reply = await client.ask(target.address, { type: 'workout_summary', summary });
          if (reply.ok) bus.emit('coach:feedback', { text: reply.value, source: client.lastSource === 'fetchai' ? 'fetchai' : 'mock' });
        },
        { owner: 'fetchai' },
      );
    },
    dispose() {
      off?.();
    },
    health(): PluginHealth {
      if (client.lastError) return { ok: false, mode: 'mock', detail: client.lastError.message };
      if (!client.lastSource) return { ok: true, mode: 'mock', detail: 'Discovering…' };
      return { ok: true, mode: client.lastSource === 'fetchai' ? 'live' : 'mock', detail: `${agents.length} agent(s)` };
    },
    getAgents: () => agents,
  };
}
