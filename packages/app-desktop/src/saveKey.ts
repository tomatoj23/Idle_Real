/**
 * 存档键单源（#76 项 4）：生产装配（main.ts）与测试共用一把键，不再各自
 * 硬编码字面量（platform/ui.smoke 测试此前手抄 8+ 处）。
 *
 * #24：状态键 gp/pill/fist → gold/consumable/basic 是存档形状 breaking change。
 * 旧存档不迁移（ADR-008）：v2 档留在旧键下永不读，新档从 v3 起。
 */
export const SAVE_KEY = 'wendao_changsheng_v3';
