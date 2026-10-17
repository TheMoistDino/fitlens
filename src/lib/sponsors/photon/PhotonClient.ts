import { z } from 'zod';
import { fetchWithTimeout } from '@/core/scheduling/throttle';
import { Err, Ok, toError, type Result } from '@/core/result';
import type { WorkoutSummary } from '@/core/events/events';

const SendResponseSchema = z.object({ source: z.enum(['photon', 'mock']), id: z.string() });

/** Posts a post-workout summary to the proxy, which delivers it via Photon (SMS or voice). */
export class PhotonClient {
  lastSource: 'photon' | 'mock' | null = null;
  lastError: Error | null = null;

  async sendSummary(to: string, summary: WorkoutSummary, channel: 'sms' | 'voice' = 'sms'): Promise<Result<string>> {
    try {
      const res = await fetchWithTimeout(
        '/api/photon/summary',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, channel, summary }) },
        15_000,
      );
      if (!res.ok) throw new Error(`Photon proxy ${res.status}`);
      const data = SendResponseSchema.parse(await res.json());
      this.lastSource = data.source;
      this.lastError = null;
      return Ok(data.id);
    } catch (e) {
      this.lastError = toError(e);
      return Err(this.lastError);
    }
  }
}
