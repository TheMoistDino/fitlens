import * as Sentry from '@sentry/react';
import { LatestOnlyQueue } from '@/core/scheduling/throttle';
import type { SponsorEventMap } from '@/core/events/events';
import type { SponsorBus, SponsorPlugin, PluginHealth } from '../types';
import { notifyHealthChanged } from '../SponsorEventBus';
import { StepFunClient, toMacroSummary } from './StepFunClient';

type Keyframe = SponsorEventMap['keyframe:captured'];

/**
 * Cold-path consumer: listens for `keyframe:captured`, analyses at most one frame at a time
 * (latest-only — stale frames are dropped), and publishes `macro:result` / `coach:feedback`.
 */
export function createStepFunPlugin(client = new StepFunClient()): SponsorPlugin {
  let off: (() => void) | null = null;
  let bus: SponsorBus | null = null;

  const queue = new LatestOnlyQueue<Keyframe>(async ({ image, mode, context }) => {
    await Sentry.startSpan({ name: `stepfun.analyze.${mode}`, op: 'ai.inference' }, async () => {
      const result = await client.analyzeKeyframe(image, mode, context);
      notifyHealthChanged();
      if (!result.ok) {
        console.warn('[stepfun] analysis failed', result.error);
        Sentry.captureException(result.error, { tags: { plugin: 'stepfun' } });
        return;
      }
      const data = result.value;
      if (data.mode === 'food') bus?.emit('macro:result', toMacroSummary(data));
      else bus?.emit('coach:feedback', { text: data.formNotes, source: data.source });
    });
  });

  return {
    id: 'stepfun',
    label: 'StepFun step-5-preview',
    init(b) {
      bus = b;
      off = b.on('keyframe:captured', (kf) => queue.push(kf), { owner: 'stepfun' });
    },
    dispose() {
      off?.();
      bus = null;
    },
    health(): PluginHealth {
      if (client.lastError) return { ok: false, mode: 'mock', detail: client.lastError.message };
      if (client.lastSource === 'mock') return { ok: true, mode: 'mock', detail: 'No STEPFUN_API_KEY on proxy' };
      return { ok: true, mode: client.lastSource ? 'live' : 'mock', detail: client.lastSource ? undefined : 'Idle' };
    },
  };
}
