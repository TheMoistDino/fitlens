import type { PluginHealth, SponsorPlugin } from '../types';
import { notifyHealthChanged } from '../SponsorEventBus';
import { PhotonClient } from './PhotonClient';

const PHONE_KEY = 'fitlens.phone';

export function getSummaryPhone(): string | null {
  try {
    return localStorage.getItem(PHONE_KEY);
  } catch {
    return null;
  }
}

export function setSummaryPhone(phone: string | null): void {
  try {
    if (phone) localStorage.setItem(PHONE_KEY, phone);
    else localStorage.removeItem(PHONE_KEY);
  } catch {
    /* storage unavailable — feature just stays off */
  }
}

/** On `workout:ended`, texts the summary to the user's opted-in number (if any). */
export function createPhotonPlugin(client = new PhotonClient()): SponsorPlugin {
  let off: (() => void) | null = null;
  return {
    id: 'photon',
    label: 'Photon SMS / Voice',
    init(bus) {
      off = bus.on(
        'workout:ended',
        async (summary) => {
          const phone = getSummaryPhone();
          if (!phone) return; // user hasn't opted in
          const r = await client.sendSummary(phone, summary);
          if (!r.ok) console.warn('[photon] summary failed', r.error);
          notifyHealthChanged();
        },
        { owner: 'photon' },
      );
    },
    dispose() {
      off?.();
    },
    health(): PluginHealth {
      if (client.lastError) return { ok: false, mode: 'mock', detail: client.lastError.message };
      if (!getSummaryPhone()) return { ok: true, mode: 'disabled', detail: 'No phone number set' };
      return { ok: true, mode: client.lastSource === 'photon' ? 'live' : 'mock' };
    },
  };
}
