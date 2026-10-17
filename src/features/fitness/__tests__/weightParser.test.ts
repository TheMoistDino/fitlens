import { describe, expect, it } from 'vitest';
import { WeightLockSmoother, isPlausibleLoad, parseWeightText } from '../ocr/weightParser';

describe('parseWeightText', () => {
  it('reads plain numbers and units', () => {
    expect(parseWeightText('150 LBS', 90)).toEqual({ value: 150, unit: 'lb', confidence: 90 });
    expect(parseWeightText('45kg', 80)).toMatchObject({ value: 45, unit: 'kg' });
    expect(parseWeightText('#120', 80)).toMatchObject({ value: 120, unit: 'lb' });
  });

  it('repairs common OCR confusions without eating unit letters', () => {
    expect(parseWeightText('I5O lbs', 85)).toMatchObject({ value: 150, unit: 'lb' });
    expect(parseWeightText('2O KG', 85)).toMatchObject({ value: 20, unit: 'kg' });
    expect(parseWeightText('B5', 85)).toMatchObject({ value: 85 });
  });

  it('prefers the longest plausible number', () => {
    expect(parseWeightText('1 160 2', 80)).toMatchObject({ value: 160 });
  });

  it('uses the default unit when none is printed', () => {
    expect(parseWeightText('100', 80, 'kg')).toMatchObject({ value: 100, unit: 'kg' });
  });

  it('rejects implausible or low-confidence reads', () => {
    expect(parseWeightText('7', 90)).toBeNull(); // not a 2.5 increment
    expect(parseWeightText('9999', 90)).toBeNull();
    expect(parseWeightText('150', 20)).toBeNull();
    expect(parseWeightText('   ', 90)).toBeNull();
  });

  it('accepts 2.5 increments only', () => {
    expect(isPlausibleLoad(2.5, 'kg')).toBe(true);
    expect(isPlausibleLoad(12.5, 'lb')).toBe(true);
    expect(isPlausibleLoad(13, 'lb')).toBe(false);
  });
});

describe('WeightLockSmoother', () => {
  const r = (value: number) => ({ value, unit: 'lb' as const, confidence: 90 });

  it('locks after 3 identical consecutive readings', () => {
    const s = new WeightLockSmoother();
    expect(s.push(r(150)).locked).toBeNull();
    expect(s.push(r(150)).locked).toBeNull();
    expect(s.push(r(150)).locked).toEqual(r(150));
  });

  it('restarts the streak when the value changes', () => {
    const s = new WeightLockSmoother();
    s.push(r(150));
    s.push(r(150));
    expect(s.push(r(160)).streak).toBe(1);
    s.push(r(160));
    expect(s.push(r(160)).locked?.value).toBe(160);
  });

  it('breaks the streak on an unreadable frame (glare)', () => {
    const s = new WeightLockSmoother();
    s.push(r(150));
    s.push(r(150));
    s.push(null);
    expect(s.push(r(150)).locked).toBeNull();
  });

  it('stays locked until reset', () => {
    const s = new WeightLockSmoother();
    [150, 150, 150].forEach((v) => s.push(r(v)));
    expect(s.push(r(200)).locked?.value).toBe(150);
    s.reset();
    expect(s.current.locked).toBeNull();
  });
});
