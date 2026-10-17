import { z } from 'zod';
import { fetchWithTimeout } from '@/core/scheduling/throttle';
import { Err, Ok, toError, type Result } from '@/core/result';

/**
 * Talks to Fetch.ai uAgents / ASI:One via our proxy. The Python agents run separately
 * (Agentverse or a local uAgent); the proxy forwards to FETCH_AGENT_URL or returns mock data.
 */
const AgentSchema = z.object({
  address: z.string(),
  name: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()).default([]),
});
export type DiscoveredAgent = z.infer<typeof AgentSchema>;

const DiscoverResponseSchema = z.object({
  source: z.enum(['fetchai', 'mock']),
  agents: z.array(AgentSchema),
});

const AskResponseSchema = z.object({ source: z.enum(['fetchai', 'mock']), reply: z.string() });

export class AgentDiscoveryClient {
  lastSource: 'fetchai' | 'mock' | null = null;
  lastError: Error | null = null;

  async discover(query = 'fitness nutrition coach'): Promise<Result<DiscoveredAgent[]>> {
    try {
      const res = await fetchWithTimeout(`/api/agents/discover?q=${encodeURIComponent(query)}`, {}, 10_000);
      if (!res.ok) throw new Error(`Agent discovery ${res.status}`);
      const data = DiscoverResponseSchema.parse(await res.json());
      this.lastSource = data.source;
      this.lastError = null;
      return Ok(data.agents);
    } catch (e) {
      this.lastError = toError(e);
      return Err(this.lastError);
    }
  }

  /** Send a structured message (e.g. a workout summary) to a discovered agent. */
  async ask(agentAddress: string, message: unknown): Promise<Result<string>> {
    try {
      const res = await fetchWithTimeout(
        '/api/agents/ask',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentAddress, message }) },
        20_000,
      );
      if (!res.ok) throw new Error(`Agent ask ${res.status}`);
      return Ok(AskResponseSchema.parse(await res.json()).reply);
    } catch (e) {
      return Err(toError(e));
    }
  }
}
