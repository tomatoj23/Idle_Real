# 016 · content 预留字段（调研合入）：器胚×铭纹 schema + 槽位 config 节

**Blocks**: 013
**来源**: docs/research/rebuild-research.md §1.2/§1.4/§3.6；ADR-015
**背景**: 调研合入（2026-09-02）时票 #2 已完成关闭（6f34697+e52d4a5），预留字段未落地代码，故单开此票承接。

## 范围
- `items` 增器胚形态：slot / floorRange / tierRange / preferredTags / inherentModifiers（胚纹）；铭纹形态：tiers 三阶表 / feature / tags——schema oneOf 分流两类条目
- `config` 节：槽位数据化（法器/护体/灵饰起步，为法宝/外袍留门）
- `enemies` 可选字段：element? / affinities?（只给 Boss 配，不填=无系别，零破坏）
- 全条目预留 prototypeKey / prototypeParent（字段先行，加载期展平继承留待后续票）
- 校验器认识新形态；**默认包暂不放器胚/铭纹内容**（无机制消费方，避免污染数值快照）

## 验收
- [ ] 器胚×铭纹 schema 定形：缺 slot 的器胚 / 缺 tiers 的铭纹被 schema 拒绝；空集合合法
- [ ] enemies 带 element/affinities 的样例条目过校验（可选字段零破坏）
- [ ] config 槽位节通过校验；沿用"未显式写入字段不落盘"约定（ADR-013）
