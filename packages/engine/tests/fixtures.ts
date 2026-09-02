import type { GameContent } from '../src/index.js';

/**
 * 形状合规的最小内容包：引擎零内容感知，测试自备形状。
 * 采青灵草 interval=3000 → 假时钟 60 游戏秒恰好 20 轮。
 */
export function makePack(): GameContent {
  return {
    skills: [
      {
        id: 'herb',
        name: '采药',
        icon: '药',
        kind: 'gather',
        activities: [
          {
            name: '采青灵草',
            unlockLevel: 1,
            interval: 3000,
            exp: 6,
            output: { item: 'herb1', count: 1 },
            byproduct: { item: 'silk', chance: 0.5 },
          },
          {
            name: '采紫云花',
            unlockLevel: 15,
            interval: 4000,
            exp: 15,
            output: { item: 'herb2', count: 1 },
          },
        ],
      },
      { id: 'combat', name: '斗法', icon: '斗', kind: 'combat' },
    ],
    items: [
      { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
      { id: 'silk', name: '灵蚕丝', icon: '蚕', type: 'mat', sell: 6 },
      { id: 'pill_heal', name: '回气丹', icon: '回', type: 'pill', sell: 18 },
    ],
    shop: [{ item: 'pill_heal', price: 45 }],
  };
}

/** 60 游戏秒 / 3000ms 间隔。 */
export const CYCLES_60S = 20;
