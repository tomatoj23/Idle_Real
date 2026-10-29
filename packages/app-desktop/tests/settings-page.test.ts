// @vitest-environment happy-dom
/**
 * 设置页（#62 P1-1 存档管理页回迁）：卡片渲染/手动保存/散功重修两段式/
 * 携档云游（导出密文/导入门禁/内联报错）/服务缺省降级。
 * 存档字节面全在注入的 ShellSaveService 夹具——本套件钉页面行为与转发面，
 * 编解码与受控重载的装配语义归 main 装配侧（main-entry）。
 */
import { describe, expect, it } from 'vitest';
import { mountGame } from './helpers/mount';
import type { ShellSaveService } from '../src/pages/types';

/** 服务夹具：可观察调用 + 可脚本化的导入判定。 */
function makeService(importOk = true): ShellSaveService & {
  saved: number;
  imported: string[];
  exported: number;
} {
  return {
    saved: 0,
    imported: [],
    exported: 0,
    saveNow() {
      this.saved += 1;
    },
    exportText() {
      this.exported += 1;
      return 'RVhQT1JU';
    },
    importText(raw: string) {
      this.imported.push(raw);
      return importOk;
    },
  };
}

const goSettings = (root: HTMLElement): void => {
  root.querySelector<HTMLButtonElement>('.tab[data-tab="settings"]')!.click();
};

describe('#62 · 设置页', () => {
  it('三卡齐备：存档（承诺文案）/携档云游（导出只读框）/玩法说明，密文来自服务', () => {
    const service = makeService();
    const { root } = mountGame({ saveService: service });
    goSettings(root);
    expect(root.querySelector('.settings-card .group-title')?.textContent).toBe('存档');
    expect(root.querySelector('#page-root')!.textContent).toContain('上限 24 小时');
    const expBox = root.querySelector<HTMLTextAreaElement>('#exp-box')!;
    expect(expBox.readOnly).toBe(true);
    expect(expBox.value).toBe('RVhQT1JU');
    expect(root.querySelector('#imp-box')).not.toBeNull();
    expect(root.querySelector('#page-root')!.textContent).toContain('玩法说明');
  });

  it('立即保存：转发服务 saveNow + toast 已保存', () => {
    const service = makeService();
    const { root } = mountGame({ saveService: service });
    goSettings(root);
    root.querySelector<HTMLButtonElement>('[data-act="save-now"]')!.click();
    expect(service.saved).toBe(1);
    expect(root.querySelector('#toasts')?.textContent).toContain('已保存');
  });

  it('散功重修两段式：先 arm 出确认提示，确认派发 game:reset；取消回退', () => {
    const { root, game } = mountGame({ saveService: makeService() });
    goSettings(root);
    const actions: string[] = [];
    // 动作记录经引擎事件面观察（game-reset 事件）
    game.events.subscribe((event) => {
      if (event.type === 'game-reset') actions.push(event.type);
    });
    expect(root.querySelector('[data-act="reset-confirm"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-act="reset-go"]')!.click();
    expect(root.querySelector('[data-act="reset-confirm"]')).not.toBeNull();
    expect(root.querySelector('#page-root')?.textContent).toContain('斩断前尘');
    root.querySelector<HTMLButtonElement>('[data-act="reset-cancel"]')!.click();
    expect(root.querySelector('[data-act="reset-confirm"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-act="reset-go"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="reset-confirm"]')!.click();
    expect(actions).toEqual(['game-reset']);
  });

  it('换页即撤防：arm 后切走再切回，确认态不复存', () => {
    const { root } = mountGame({ saveService: makeService() });
    goSettings(root);
    root.querySelector<HTMLButtonElement>('[data-act="reset-go"]')!.click();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    goSettings(root);
    expect(root.querySelector('[data-act="reset-confirm"]')).toBeNull();
  });

  it('导入：门禁拒绝 → 内联报错且草稿保留；通过 → 转发服务（随后受控重载）', () => {
    const bad = makeService(false);
    const { root } = mountGame({ saveService: bad });
    goSettings(root);
    const box = root.querySelector<HTMLTextAreaElement>('#imp-box')!;
    box.value = 'S0VZ';
    root.querySelector<HTMLButtonElement>('[data-act="import-save"]')!.click();
    expect(bad.imported).toEqual(['S0VZ']);
    expect(root.querySelector('#page-root')?.textContent).toContain('密文无效');
    // 重绘后草稿不丢（textarea 回填）
    expect(root.querySelector<HTMLTextAreaElement>('#imp-box')!.value).toBe('S0VZ');

    const good = makeService(true);
    const second = mountGame({ saveService: good });
    goSettings(second.root);
    second.root.querySelector<HTMLButtonElement>('[data-act="import-save"]')!.click();
    expect(good.imported).toHaveLength(1);
  });

  it('导入草稿跨整页重绘保留（活动心跳换血不吞打字中的密文）', () => {
    const service = makeService();
    const { root, ui } = mountGame({ saveService: service });
    goSettings(root);
    const box = root.querySelector<HTMLTextAreaElement>('#imp-box')!;
    box.value = 'DRAFT';
    // 强制整页重建（等价签名变化的换血路径）
    ui.render();
    expect(root.querySelector<HTMLTextAreaElement>('#imp-box')!.value).toBe('DRAFT');
  });

  it('服务未装配：只渲染玩法说明，保存/携档卡收起', () => {
    const { root } = mountGame();
    goSettings(root);
    expect(root.querySelector('[data-act="save-now"]')).toBeNull();
    expect(root.querySelector('#exp-box')).toBeNull();
    expect(root.querySelector('#page-root')?.textContent).toContain('玩法说明');
  });
});
