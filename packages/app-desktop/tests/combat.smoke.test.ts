// @vitest-environment happy-dom
/**
 * UI 渲染烟测（issue #4 验收）：斗法页挑战敌人 → 战斗日志 → 胜利 →
 * 装备卡佩戴 → 属性面板反映。UI 只消费 events + snapshot，测的正是
 * 这条接缝（事件→战斗日志接线与生产共用 buildUi 内的同一套路径）。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameSnapshot, type SaveData } from '@wendao/engine';
import { buildUi, MAX_FLOG } from '../src/ui';
import { mountGame } from './helpers/mount';

describe('UI 烟测（issue #4 战斗切片）', () => {
  it('斗法：挑战青鬃狼 → 战斗中视图 → 挂机胜利 → 战斗日志受控', () => {
    const content = loadXiuxianPack();
    const { root, ui, game, clock } = mountGame({ content, seed: 11 });

    // 斗法 tab：敌人卡列表（含门控信息）
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    expect(root.textContent).toContain('青鬃狼');

    // 点挑战 → 进入战斗
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e1"]')!.click();
    ui.render();
    expect(root.querySelector('.enemy-card.fighting')).not.toBeNull();
    expect(root.querySelector('#flog')).not.toBeNull();
    expect(root.querySelector('[data-act="flee"]')).not.toBeNull();
    // 增益条容器常驻顶栏（无文本节点元素以存在性断言，innerText 盲区教训）
    expect(root.querySelector('#buffbar')).not.toBeNull();

    // 挂机至首场胜利（假时钟大步长；胜利即停，避免后续连场败北离场）
    let won = false;
    for (let i = 0; i < 60 && !won; i++) {
      clock.advance(5000);
      game.tick(5000);
      won = game.events.drain().some((event) => event.type === 'victory');
    }
    expect(won).toBe(true);
    ui.render();

    // 胜利叙事 + 摘要画像落日志
    expect(root.textContent).toContain('轰然倒地');
    // 胜利战利品段（#62 保真收口）：灵石数额与缴获回迁战斗日志
    expect(root.textContent).toContain('得灵石');
    // 战斗日志容量受控（回归：日志容量受控）
    const flog = root.querySelector<HTMLElement>('#flog')!;
    expect(flog.children.length).toBeGreaterThan(0);
    expect(flog.children.length).toBeLessThanOrEqual(MAX_FLOG);
    // 日志滚动跟随到底（旧版踩坑回归；happy-dom 支持 scrollTop 记账）
    expect(flog.scrollTop).toBe(flog.scrollHeight);
  });

  it('战斗日志环形上限作用于真实 DOM：超容删头、留存精确 = MAX_FLOG', () => {
    const content = loadXiuxianPack();
    const { root, ui, game } = mountGame({ content, seed: 3 });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    const flog = root.querySelector<HTMLElement>('#flog')!;
    const total = MAX_FLOG + 10;
    for (let i = 1; i <= total; i++) {
      game.events.emit({ type: 'combat-note', time: 0, data: { text: `note ${i}` } });
    }
    // 环形删头：留存精确 MAX_FLOG 条（非仅「≤」——旧断言被删头循环绑死为近空），
    // 首行 = 最旧留存（total−MAX_FLOG+1），钉「删头保尾」语义。
    expect(flog.children.length).toBe(MAX_FLOG);
    expect(flog.firstElementChild?.textContent).toBe(`note ${total - MAX_FLOG + 1}`);
    expect(flog.lastElementChild?.textContent).toBe(`note ${total}`);
  });

  it('两次 tick 间日志节点身份不变（追加式）：战斗页不因逐击重建，实况值走定点补丁', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    // 预置高位 maxHit 封顶：破纪录会经 st.stats 走签名（D3 口径的低频结构
    // 变化，接受重建），本用例钉「逐击不重建」不变量——把破纪录变量隔离掉。
    const base = createGame({ content, clock, seed: 11 }).snapshot();
    const save: GameSnapshot = {
      ...base,
      state: { ...base.state, stats: { ...base.state.stats, maxHit: 999999 } },
    };
    const { root, ui, game } = mountGame({ content, clock, save, seed: 11 });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e1"]')!.click();
    ui.render();

    // 开战 note 落战斗日志（持久体）：采样锚点。页面骨架打标记（重建判据）。
    const flog = root.querySelector<HTMLElement>('#flog')!;
    expect(flog.firstElementChild).not.toBeNull();
    const lineBefore = flog.firstElementChild!;
    root.querySelector<HTMLElement>('.enemy-card.fighting')!.dataset.mark = 'keep';
    const ehpElBefore = root.querySelector<HTMLElement>('[data-ehp-text]')!;
    const ehpTextBefore = ehpElBefore.textContent;

    // 逐步推进到下一次命中（敌血下降）：命中窗口自证，不赌步长。
    const ehpOf = (): number => game.snapshot().state.combat?.ehp ?? -1;
    const tickToHit = (): boolean => {
      let last = ehpOf();
      for (let i = 0; i < 30; i++) {
        clock.advance(1000);
        game.tick(1000);
        ui.render();
        const now = ehpOf();
        if (now >= 0 && now < last) return true;
        last = now;
      }
      return false;
    };

    const selfStatsBefore = root.querySelector('[data-self-stats]')?.textContent ?? '';
    expect(tickToHit()).toBe(true); // 命中①
    const countBefore = flog.children.length;
    expect(tickToHit()).toBe(true); // 命中②

    // 追加式钉住：旧日志节点存活为前缀（身份不变），只增不换。
    expect(flog.firstElementChild).toBe(lineBefore);
    expect(flog.children.length).toBeGreaterThanOrEqual(countBefore);
    // 战斗页不因逐击重建：骨架标记存活、敌血读数节点身份不变。
    expect(root.querySelector<HTMLElement>('.enemy-card.fighting')!.dataset.mark).toBe('keep');
    expect(root.querySelector('[data-ehp-text]')).toBe(ehpElBefore);
    // 实况值经定点补丁更新：读数变了、节点没换（旧「签名漏 st.hp」在此了结）。
    expect(ehpElBefore.textContent).not.toBe(ehpTextBefore);
    // 自血补丁反映快照现值（{hp}/{max} 槽 = floor(st.hp)），且全窗至少随受击变过一次。
    const hpNow = Math.floor(game.snapshot().state.hp);
    expect(root.querySelector('[data-self-stats]')?.textContent).toContain(`${hpNow}/`);
    expect(root.querySelector('[data-self-stats]')?.textContent).not.toBe(selfStatsBefore);
    // 窗口内无击杀：胜负级变化才允许重建。
    expect(game.snapshot().state.combat).not.toBeNull();
  });

  it('乾坤袋：装备卡佩戴/卸下 → 顶栏属性反映倍率+词条', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    // 构造带装备实例的存档（罕见青锋剑：atk round(6×1.3)=8 + 锐锋 3 → 11）
    const base = createGame({ content, clock, seed: 3 }).snapshot();
    const save = {
      ...base,
      state: {
        ...(base.state as Record<string, unknown>),
        skills: { combat: { xp: 0 } },
        gear: [
          {
            uid: 1,
            itemId: 'sword1',
            rarity: 'rare',
            affixes: [
              { name: '锐锋', stat: 'atk', val: 3 },
              { name: '通明', stat: 'crit', val: 4 },
            ],
          },
        ],
        equips: {},
      },
    } as SaveData;
    const { root, ui } = mountGame({ content, clock, save });

    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    ui.render();
    // 稀有度着色的装备卡（罕见·青锋剑）
    expect(root.querySelector('.gear-card.r-rare')).not.toBeNull();
    expect(root.textContent).toContain('罕见·青锋剑');
    // 佩戴前属性：atk 11 / def 3 / crit 5%
    expect(root.querySelector('#res-stats')!.textContent).toBe('11/3/5%');

    // 点击佩戴（真实点击路径 → dispatch → equip:wear 事件回流）
    root.querySelector<HTMLButtonElement>('[data-act="wear"][data-uid="1"]')!.click();
    ui.render();
    expect(root.querySelector('[data-act="take-off"]')).not.toBeNull();
    // 佩戴后：atk 11+11=22、crit 5+4=9（经修饰符管线聚合）
    expect(root.querySelector('#res-stats')!.textContent).toBe('22/3/9%');

    // 卸下恢复
    root.querySelector<HTMLButtonElement>('[data-act="take-off"]')!.click();
    ui.render();
    expect(root.querySelector('[data-act="wear"][data-uid="1"]')).not.toBeNull();
    expect(root.querySelector('#res-stats')!.textContent).toBe('11/3/5%');
  });

  it('战斗页丹药快捷栏：嗑丹回血', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    const base = createGame({ content, clock, seed: 3 }).snapshot();
    const save = {
      ...base,
      state: {
        ...(base.state as Record<string, unknown>),
        items: { consumable_heal: 1 },
        hp: 50,
      },
    } as SaveData;
    const { root, ui, game } = mountGame({ content, clock, save });

    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    const eatBtn = root.querySelector<HTMLButtonElement>('[data-act="eat"][data-item="consumable_heal"]');
    expect(eatBtn).not.toBeNull();
    eatBtn!.click();
    ui.render();
    // 回气丹恢复 30% 上限：50 + 34 = 84
    expect(root.querySelector('#res-hp-text')!.textContent).toContain('84/');
    // 血条 fill 元素存在性（进度条被删后 innerText 断言仍绿的历史教训）
    expect(root.querySelector('#res-hp')).not.toBeNull();
    expect(game.snapshot().state.items['consumable_heal']).toBeUndefined();
  });

  it('增益条：同数量换 buff（A 到期 + B 服下）chip 跟随换新', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    const game = createGame({ content, clock, seed: 3 });
    const base = game.snapshot();
    const save: GameSnapshot = {
      ...base,
      state: { ...base.state, buffs: { consumable_atk: 600000 } },
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => save, game.events);
    ui.render();

    // 先有 buff A
    expect(root.querySelector('.buff-chip[data-buff="consumable_atk"]')).not.toBeNull();
    // 悬停提示 = 文本协议值（#55 裁决口径：计时仅在线流逝；禁硬编码文案）
    expect(root.querySelector('.buff-chip[data-buff="consumable_atk"]')!.getAttribute('title')).toBe(
      content.texts.shell.common.buffTimerOnlineOnly,
    );
    // 同数量换 buff：A 到期 + B 服下——childElementCount 判据对此失明，chip 必须换新
    (save.state as { buffs: Record<string, number> }).buffs = { consumable_def: 600000 };
    ui.render();
    expect(root.querySelector('.buff-chip[data-buff="consumable_atk"]')).toBeNull();
    expect(root.querySelector('.buff-chip[data-buff="consumable_def"]')).not.toBeNull();
  });
});
