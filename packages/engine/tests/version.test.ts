import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index.js';

/**
 * #12 版本策略：ENGINE_VERSION 是引擎版本的单一事实源，
 * packages/engine/package.json 的 version 必须与之一致（发版两处一起改，
 * 本测试钉住漂移）。
 */
describe('ENGINE_VERSION', () => {
  it('与 packages/engine/package.json version 一致', () => {
    const raw = readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8');
    const pkg = JSON.parse(raw) as { version: string };
    expect(ENGINE_VERSION).toBe(pkg.version);
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
