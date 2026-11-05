// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateContentPack, validatePackSemantics, type ContentError } from '@wendao/content';
import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import { xiuxianStore } from './helpers.js';
import type { EditorStore } from '../src/core/state.js';
import { visibleValidation } from '../src/core/validate.js';
import { createValidatePanel } from '../src/ui/panel.js';

/**
 * #100 用户可见校验面补语义面：整包校验在 schema 错误存在时提前返回、
 * 错误集只含 schema 面——存量语义错（手动改 item id 的悬空引用）在校验
 * 面板红条与导出确认计数两处不可见，直到 schema 错全部修净才集中现形；
 * 而入包门禁（#94）对同一状态能拦语义新增，三面不一致。本套件钉住：
 * - 合并入口 visibleValidation：!ok 包补跑独立语义入口、按身份去重
 *   （仅语义错包语义面已含于整包结果，二次并入即双计——729e7b6 先例）；
 * - 面板红条（单元直挂）与导出确认计数（装配级真 main.ts）两面同数；
 * - 干净包 / 仅 schema 错包行为零变化。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」；集：
 * scripts/mutation-sets/semantic-surface-100.mjs，4 条）：
 * - 01 合并入口语义半边摘除 → 带错包两处校验面缺语义错，红；
 * - 02 身份去重摘除 → 仅语义错包计数翻倍（「含语义错」注记现身），红；
 * - 03 面板接线换绿（恒 ok）→ 面板红条用例红；
 * - 04 导出确认接线换绿（恒 ok）→ 确认消息用例红。
 */

/** 带错结果取错误集（union 收窄，避免测试内 as 断言）。 */
function errorsOf(result: ReturnType<typeof validateContentPack>): readonly ContentError[] {
  if (result.ok) throw new Error('预期带错包，整包校验却通过');
  return result.errors;
}

/** 存量语义错夹具：给既有敌人补悬空 drop（与 #94 pipeline 测试同款手法）。 */
function addGhostDrop(store: EditorStore): number {
  const drops = (store.state.pack['enemies'] as { drops: { item: string; chance: number }[] }[])[0]!.drops;
  drops.push({ item: 'ghost_old', chance: 0.1 });
  return drops.length - 1;
}

/** 版本 schema 错夹具（不涉任何节，语义面守卫对全包恒可信）。 */
function breakVersion(store: EditorStore): void {
  store.update((pack) => {
    pack['version'] = 'not-semver';
  });
}

describe('#100 · visibleValidation：整包校验 + 带 schema 错包补语义面', () => {
  it('干净包：ok 短路、零错误（前提钉：语义入口对修仙包恒空集）', () => {
    const store = xiuxianStore();
    expect(validatePackSemantics(store.state.pack)).toEqual([]);
    expect(visibleValidation(store.state.pack)).toEqual({ ok: true, errors: [], extraSemantic: 0 });
  });

  it('仅语义错包（schema 净）：语义面已含于整包结果，不双计、extraSemantic 0', () => {
    const store = xiuxianStore();
    const idx = addGhostDrop(store);
    const n = errorsOf(validateContentPack(store.state.pack)).length;
    const result = visibleValidation(store.state.pack);
    expect(result.ok).toBe(false);
    // 防双计钉：合并集条数 = 整包校验错误数，语义入口再报的同一悬空按身份折叠。
    expect(result.errors.length).toBe(n);
    expect(result.extraSemantic).toBe(0);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: `/enemies/0/drops/${idx}/item`, keyword: 'xref' }),
    );
  });

  it('schema 错 + 存量语义错：两面并存合并，extraSemantic = 语义面条数（无噪音级联）', () => {
    const store = xiuxianStore();
    const idx = addGhostDrop(store);
    breakVersion(store);
    const schemaErrors = errorsOf(validateContentPack(store.state.pack));
    // 提前返回形态前提钉：整包结果只含 schema 面（悬空不在其中）。
    expect(schemaErrors.some((error) => error.path === `/enemies/0/drops/${idx}/item`)).toBe(false);
    const result = visibleValidation(store.state.pack);
    expect(result.ok).toBe(false);
    expect(result.extraSemantic).toBe(1);
    expect(result.errors.length).toBe(schemaErrors.length + 1);
    // 两面各在其位：schema 面（/version pattern）+ 语义面（悬空 xref）。
    expect(result.errors).toContainEqual(expect.objectContaining({ path: '/version', keyword: 'pattern' }));
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: `/enemies/0/drops/${idx}/item`,
        keyword: 'xref',
        message: expect.stringContaining('ghost_old'),
      }),
    );
    // 无噪音级联：语义面恰 1 条（schema 错未牵连成守卫级联）。
    expect(result.errors.filter((error) => error.keyword === 'xref')).toHaveLength(1);
  });

  it('仅 schema 错：错误集与整包校验原样同集、extraSemantic 0（行为不变）', () => {
    const store = xiuxianStore();
    breakVersion(store);
    const full = errorsOf(validateContentPack(store.state.pack));
    const result = visibleValidation(store.state.pack);
    expect(result.errors).toEqual(full);
    expect(result.extraSemantic).toBe(0);
  });
});

describe('#100 · 校验面板红条并入语义面（单元直挂）', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mountPanel(store: EditorStore): void {
    const root = document.createElement('div');
    document.body.append(root);
    createValidatePanel(root, store, { onGoto: () => {} });
  }

  it('干净包：绿条零错误（行为不变）', () => {
    mountPanel(xiuxianStore());
    expect(document.querySelector('.validate-status')!.textContent).toContain('✓ 内容包合法');
    expect(document.querySelectorAll('.validate-item')).toHaveLength(0);
  });

  it('schema 错 + 存量语义错：红条计数含语义面、列表含语义错行（path/keyword 同构）', () => {
    const store = xiuxianStore();
    const idx = addGhostDrop(store);
    breakVersion(store);
    const expected = visibleValidation(store.state.pack);
    mountPanel(store);
    expect(document.querySelector('.validate-status')!.textContent).toContain(
      `✗ ${expected.errors.length} 处校验错误`,
    );
    const items = [...document.querySelectorAll('.validate-item')].map((node) => node.textContent ?? '');
    expect(items.join('\n')).toContain(`/enemies/0/drops/${idx}/item`);
    expect(items.join('\n')).toContain('[xref]');
    // 点击定位同构：语义错行也带 path（onGoto 挂钩不另测，#11 已钉）。
  });

  it('仅语义错包：红条计数 = 整包校验错误数（不双计）', () => {
    const store = xiuxianStore();
    addGhostDrop(store);
    const n = errorsOf(validateContentPack(store.state.pack)).length;
    mountPanel(store);
    expect(document.querySelector('.validate-status')!.textContent).toContain(`✗ ${n} 处校验错误`);
  });
});

/* ==================== 装配级（main.ts 真装配） ==================== */

/**
 * 导出确认计数（confirmExportDespiteErrors）与面板红条经真装配走通。
 * confirm 走取消路径断言（垫桩 window.confirm 捕获消息并拒绝；导出放行面
 * 落真实下载文件勿实点——#56 票评坑，下载以 URL.createObjectURL 垫桩计数）。
 */

/** 预期确认消息（与 main.ts 措辞同构）：semantic > 0 才带「含语义错」注记。 */
function confirmMessageOf(total: number, semantic: number): string {
  const note = semantic > 0 ? `（含 ${semantic} 处语义错）` : '';
  return `当前包有 ${total} 处校验错误${note}，导出后可能无法通过游戏加载校验。仍要导出？`;
}

/** 独立夹具包（store 外对拍基准）：深拷示例包后施加同款编辑。 */
function fixtureWith(mutate: (pack: Record<string, unknown>) => void): Record<string, unknown> {
  const pack = structuredClone(xiuxianPackJson) as Record<string, unknown>;
  mutate(pack);
  return pack;
}

/** 与装配级表单驱动同款的 id 改名（qi1 悬空共 7 处：skills/0 活动产出、recipes/5-9 materials 键、shop/7——真机首跑实测，预期数一律取夹具现算不硬编码）。 */
function renameFirstItem(pack: Record<string, unknown>): void {
  (pack['items'] as { id: string }[])[0]!.id = 'qi1_renamed';
}

/** 版本 schema 错（同 #56 breakPack 手法，装配级走 #pack-version change 事件）。 */
function breakVersionJson(pack: Record<string, unknown>): void {
  pack['version'] = 'not-semver';
}

describe('#100 · 装配级：导出确认计数并入语义面 + 面板红条同步', () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  let downloads: number;

  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  /** 真装配起步：空 #app + confirm 捕获桩（拒绝）+ 下载计数桩 + 载示例包 + 表单改 items[0].id。 */
  async function assemblyWithRenamedItem(confirms: string[]): Promise<void> {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    downloads = 0;
    URL.createObjectURL = (() => {
      downloads += 1;
      return 'blob:mock';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    (window as unknown as { confirm?: (message: string) => boolean }).confirm = (message: string) => {
      confirms.push(message);
      return false;
    };
    await import('../src/main.js');

    (document.querySelector('#btn-sample') as HTMLButtonElement).click();
    // 切 items 节 → 展开条目 0 → 改 id（input 写值 + blur 回填）。
    [...document.querySelectorAll<HTMLButtonElement>('.nav-item')]
      .find((node) => node.textContent?.includes('物品'))!
      .click();
    [...document.querySelectorAll<HTMLButtonElement>('.entry-card button')]
      .find((button) => button.textContent === '编辑')!
      .click();
    const idInput = document.querySelector<HTMLInputElement>('[data-path="/items/0/id"] input')!;
    idInput.value = 'qi1_renamed';
    idInput.dispatchEvent(new Event('input', { bubbles: true }));
    idInput.dispatchEvent(new Event('blur'));
  }

  function versionBreakAtAssembly(): void {
    const versionInput = document.querySelector<HTMLInputElement>('#pack-version')!;
    versionInput.value = 'not-semver';
    versionInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('仅语义错包：确认计数 = 整包校验数（不双计、无注记），面板红条同数含语义行', async () => {
    const confirms: string[] = [];
    await assemblyWithRenamedItem(confirms);

    // 预期计数取自独立夹具（与表单驱动同款编辑），前提钉：schema 净时
    // 整包结果已含语义面（错误数恰 = 语义入口产出，无 schema 错混入）。
    const fixture = fixtureWith(renameFirstItem);
    const n = errorsOf(validateContentPack(fixture)).length;
    expect(validatePackSemantics(fixture).length).toBe(n);

    // 面板红条：计数 = n，列表含语义错行（去抖刷新，等它到位）。
    await vi.waitFor(
      () =>
        expect(document.querySelector('.validate-status')!.textContent).toContain(
          `✗ ${n} 处校验错误`,
        ),
      { timeout: 2000 },
    );
    const items = [...document.querySelectorAll('.validate-item')].map((node) => node.textContent ?? '');
    expect(items.join('\n')).toContain('/shop/7/item');
    expect(items.join('\n')).toContain('[xref]');

    // 导出确认（取消路径）：消息精确同构——无「含语义错」注记 = 不双计的可观察面。
    (document.querySelector('#btn-export-json') as HTMLButtonElement).click();
    expect(confirms).toEqual([confirmMessageOf(n, 0)]);
    expect(downloads).toBe(0);
    expect(document.querySelector('#toast')!.textContent).toContain('已取消导出');
  });

  it('schema 错 + 存量语义错：确认计数并入语义面并注记（含 M 处语义错）', async () => {
    const confirms: string[] = [];
    await assemblyWithRenamedItem(confirms);
    versionBreakAtAssembly();

    // 预期计数：整包校验（提前返回，只含 schema 面）+ 语义入口产出。
    const fixture = fixtureWith((pack) => {
      renameFirstItem(pack);
      breakVersionJson(pack);
    });
    const schemaCount = errorsOf(validateContentPack(fixture)).length;
    const semanticCount = validatePackSemantics(fixture).length;
    const total = schemaCount + semanticCount;

    // 面板红条同数（版本 change 走去抖，等它到位）。
    await vi.waitFor(
      () =>
        expect(document.querySelector('.validate-status')!.textContent).toContain(
          `✗ ${total} 处校验错误`,
        ),
      { timeout: 2000 },
    );
    const items = [...document.querySelectorAll('.validate-item')].map((node) => node.textContent ?? '');
    expect(items.join('\n')).toContain('/version');
    expect(items.join('\n')).toContain('/shop/7/item');

    // 导出确认（取消路径）：计数并入语义面并注记。
    (document.querySelector('#btn-export-json') as HTMLButtonElement).click();
    expect(confirms).toEqual([confirmMessageOf(total, semanticCount)]);
    expect(downloads).toBe(0);
    expect(document.querySelector('#toast')!.textContent).toContain('已取消导出');
  });
});
