import { describe, expect, it } from 'vitest';
import { FitnessStore, initialFitnessContext, transition } from '../fitnessStateMachine';
import type { SetSummary } from '../types';

const summary = { id: 's1', exercise: 'lat_pulldown', reps: 10 } as SetSummary;

describe('fitness FSM', () => {
  it('walks the happy path IDLE → SCAN_MACHINE → SCAN_WEIGHT → ACTIVE_SET → SET_SUMMARY', () => {
    const s = new FitnessStore();
    expect(s.send({ type: 'START_MACHINE_SCAN' })).toBe(true);
    const epoch = s.snapshot.epoch;
    s.send({ type: 'MACHINE_DETECTED', epoch, machine: 'lat_pulldown', confidence: 0.9, box: null });
    expect(s.snapshot.machine).toBe('lat_pulldown');
    s.send({ type: 'CONFIRM_MACHINE' });
    expect(s.snapshot.mode).toBe('SCAN_WEIGHT');
    s.send({ type: 'WEIGHT_LOCKED', epoch: s.snapshot.epoch, value: 120, unit: 'lb' });
    expect(s.snapshot.load).toEqual({ value: 120, unit: 'lb', source: 'ocr' });
    s.send({ type: 'START_SET', t: 1 });
    expect(s.snapshot.mode).toBe('ACTIVE_SET');
    s.send({ type: 'END_SET', summary });
    expect(s.snapshot.mode).toBe('SET_SUMMARY');
    s.send({ type: 'NEXT_SET' });
    expect(s.snapshot).toMatchObject({ mode: 'SCAN_WEIGHT', machine: 'lat_pulldown', load: { value: 120 } });
  });

  it('rejects illegal events by returning the same object', () => {
    const ctx = initialFitnessContext;
    expect(transition(ctx, { type: 'START_SET', t: 0 })).toBe(ctx);
    expect(transition(ctx, { type: 'END_SET', summary })).toBe(ctx);
    expect(transition(ctx, { type: 'CONFIRM_MACHINE' })).toBe(ctx);
  });

  it('cannot confirm without a detected machine', () => {
    const s = new FitnessStore();
    s.send({ type: 'START_MACHINE_SCAN' });
    expect(s.send({ type: 'CONFIRM_MACHINE' })).toBe(false);
  });

  it('drops a late machine detection from a previous scan session', () => {
    const s = new FitnessStore();
    s.send({ type: 'START_MACHINE_SCAN' });
    const stale = s.snapshot.epoch;
    s.send({ type: 'RESET' });
    s.send({ type: 'START_MACHINE_SCAN' });
    expect(s.send({ type: 'MACHINE_DETECTED', epoch: stale, machine: 'chest_press', confidence: 1, box: null })).toBe(false);
    expect(s.snapshot.machine).toBeNull();
  });

  it('drops an OCR lock that started before a mode change', () => {
    const s = new FitnessStore();
    s.send({ type: 'MACHINE_SELECTED', machine: 'seated_row' });
    const readEpoch = s.snapshot.epoch;
    s.send({ type: 'CHANGE_MACHINE' });
    s.send({ type: 'MACHINE_SELECTED', machine: 'chest_press' });
    expect(s.send({ type: 'WEIGHT_LOCKED', epoch: readEpoch, value: 90, unit: 'lb' })).toBe(false);
    expect(s.snapshot.load).toBeNull();
  });

  it('keeps a manual weight over a later OCR lock until rescan', () => {
    const s = new FitnessStore();
    s.send({ type: 'MACHINE_SELECTED', machine: 'leg_extension' });
    s.send({ type: 'WEIGHT_SET_MANUAL', value: 70, unit: 'lb' });
    expect(s.send({ type: 'WEIGHT_LOCKED', epoch: s.snapshot.epoch, value: 90, unit: 'lb' })).toBe(false);
    s.send({ type: 'WEIGHT_RESCAN' });
    s.send({ type: 'WEIGHT_LOCKED', epoch: s.snapshot.epoch, value: 90, unit: 'lb' });
    expect(s.snapshot.load).toMatchObject({ value: 90, source: 'ocr' });
  });

  it('ignores weight events during an active set', () => {
    const s = new FitnessStore();
    s.send({ type: 'MACHINE_SELECTED', machine: 'leg_extension' });
    s.send({ type: 'START_SET', t: 0 });
    expect(s.send({ type: 'WEIGHT_SET_MANUAL', value: 50, unit: 'lb' })).toBe(false);
  });

  it('RESET works from any mode and keeps the last summary', () => {
    const s = new FitnessStore();
    s.send({ type: 'MACHINE_SELECTED', machine: 'leg_extension' });
    s.send({ type: 'START_SET', t: 0 });
    s.send({ type: 'END_SET', summary });
    s.send({ type: 'RESET' });
    expect(s.snapshot).toMatchObject({ mode: 'IDLE', machine: null, lastSummary: summary });
  });
});
