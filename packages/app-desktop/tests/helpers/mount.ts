/**
 * 壳挂载单点（#76 项 1）：手写 mount「三件套」副本（createGame + 挂载点 +
 * buildUi/bindActions/render 接线）收敛于此——接线变更只动本文件。
 *
 * 夹具差异（存档、裁包、预点页签、动作记录）留在各测试文件的薄包装里：
 * 那是被测语义的一部分，不随接线走。
 */
import type { ContentPack } from '@wendao/content';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import {
  createGame,
  ManualClock,
  type GameAction,
  type SaveData,
} from '@wendao/engine';
import { buildUi } from '../../src/ui';

export interface MountOptions {
  /** 内容包；缺省 = 修仙包（套件默认题材包）。 */
  readonly content?: ContentPack;
  /** 初始存档；缺省 = 从零开局（createGame 不收 save，种子语义不动）。 */
  readonly save?: SaveData;
  /** 时钟；缺省 = 新 ManualClock（要推时间的测试取返回值里的 clock）。 */
  readonly clock?: ManualClock;
  /** 无存档开局的 RNG 种子；缺省 = 不传（引擎缺省 1，确定性纪律）。 */
  readonly seed?: number;
  /** 注入随机源（掉落确定性夹具用）；注入后引擎不再维护种子持久化。 */
  readonly rng?: () => number;
  /** dispatch 前置钩子（动作记录类夹具用，缺省零搬运）。 */
  readonly onAction?: (action: GameAction) => void;
}

export interface Mounted {
  readonly root: HTMLElement;
  readonly ui: ReturnType<typeof buildUi>;
  readonly game: ReturnType<typeof createGame>;
  readonly clock: ManualClock;
}

/** 建游戏 + 挂 UI + 接线 + 首绘，一步到位。 */
export function mountGame(options: MountOptions = {}): Mounted {
  const clock = options.clock ?? new ManualClock();
  const content = options.content ?? loadXiuxianPack();
  const game = createGame({
    content,
    clock,
    ...(options.save ? { save: options.save } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.rng ? { rng: options.rng } : {}),
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => {
    options.onAction?.(action);
    game.dispatch(action);
  });
  ui.render();
  return { root, ui, game, clock };
}
