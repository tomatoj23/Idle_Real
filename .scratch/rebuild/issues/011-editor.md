# 011 · 内容编辑器（表单 + 校验 + LLM 批量生成 + 导入导出）

**Blockers**: 002
**User stories**: #16 #17 #18 #19 #20

## 范围
- `packages/editor`：独立 vite web 应用
- 表单：由 JSON Schema 自动生成各内容类型的编辑表单（增删改、拖拽排序数组项、跨引用下拉选择）
- 校验：复用 content 包的 validateContent（同一份代码），错误定位到字段
- LLM 管道：OpenAI 兼容配置（baseURL/key/模型名存本地，不上传）；按内容类型的提示词模板（战斗文案词库/怪物描述/物品文案优先）；批量生成 → 自动 schema 校验 → 人工勾选入包
- 导入/导出：content 包 JSON/zip；"一键导入游戏"= 写入游戏 content 目录（desktop 模式）或下载包

## 验收
- [ ] 表单改一个敌人血量 → 导出包 → 游戏加载生效（端到端）
- [ ] 配置假 LLM client：批量生成 10 条文案 → 全部过校验 → 入包
- [ ] 导入坏包：字段级错误可见，包不被应用
