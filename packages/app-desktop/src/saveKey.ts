/**
 * 存档键单源（#76 项 4）：生产装配（main.ts）与测试共用一把键，不再各自
 * 硬编码字面量（platform/ui.smoke 测试此前手抄 8+ 处）。
 *
 * #24：状态键 gp/pill/fist → gold/consumable/basic 是存档形状 breaking change。
 * 旧存档不迁移（ADR-008）：旧档留在旧键下永不读，新档从新键起。
 * #61：state.talents string[] → Record<id, 层数>（叠层形态）+ SAVE_VERSION
 * 1→2，键名 bump v3→v4（键名 bump 才是版本机制，#61 票面既有裁决）。
 */
export const SAVE_KEY = 'wendao_changsheng_v4';
