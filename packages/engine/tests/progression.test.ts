import { describe, expect, it } from 'vitest';
import {
  BASE_PROGRESSION,
  expBase,
  expToNext,
  levelFromXp,
  maxHpForLevel,
} from '../src/index.js';

describe('修为曲线（issue #3）', () => {
  it('边界：25 修为进 2 层，89 修为进 3 层', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(24)).toBe(1);
    expect(levelFromXp(25)).toBe(2);
    expect(levelFromXp(88)).toBe(2);
    expect(levelFromXp(89)).toBe(3);
  });

  it('层需求与累计表一致', () => {
    expect(expToNext(1)).toBe(25);
    expect(expToNext(2)).toBe(64);
    expect(expToNext(3)).toBe(117);
    expect(expBase(2)).toBe(25);
    expect(expBase(3)).toBe(89);
  });

  it('封顶 99 层', () => {
    expect(levelFromXp(Number.MAX_SAFE_INTEGER)).toBe(BASE_PROGRESSION.maxLevel);
    expect(expToNext(BASE_PROGRESSION.maxLevel)).toBe(Number.POSITIVE_INFINITY);
  });

  it('气血上限：100 + 12×斗法层数', () => {
    expect(maxHpForLevel(0)).toBe(100);
    expect(maxHpForLevel(1)).toBe(112);
  });
});
