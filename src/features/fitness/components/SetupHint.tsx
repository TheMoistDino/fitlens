import { Badge } from '@/ui/primitives';
import type { ExerciseProfile } from '../types';
import { ReferenceLoop } from './ReferenceLoop';

/** Camera placement guidance + animated reference for an exercise. */
export function SetupHint({ profile }: { profile: ExerciseProfile }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-neutral-800/60 p-3">
      <ReferenceLoop profile={profile} className="h-20 w-20 shrink-0" />
      <div className="min-w-0 text-sm">
        <Badge tone="warn">{profile.cameraView === 'side' ? '📷 Side view' : '📷 Front view'}</Badge>
        <p className="mt-1 text-neutral-200">{profile.setupHint}</p>
      </div>
    </div>
  );
}
