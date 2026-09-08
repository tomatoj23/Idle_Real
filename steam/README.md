# steam/ — Steam 上架预备（#12）

本目录存放 Steamworks SteamPipe 上传所需的**构建脚本模板**与人工步骤指引。
AppID / DepotID 在 Steamworks 侧办理产生（人工步骤），办理前模板不动、办理后由
`steam/wizard-steamworks-setup.sh`（交互向导）生成正式构建脚本。

## 目录结构

| 文件 | 作用 |
|---|---|
| `app_build_TEMPLATE.vdf` | 应用构建脚本模板：AppID、contentroot、depot 清单。填好后改名 `app_build_<AppID>.vdf` |
| `depot_build_TEMPLATE.vdf` | depot 构建脚本模板：DepotID 与文件映射。填好后改名 `depot_build_<DepotID>.vdf` |
| `wizard-steamworks-setup.sh` | 交互向导：账号办理 → 建 AppID → 成就配置 → 首次上传，逐步引导（Git Bash 运行） |
| `steamworks.local.env`（向导生成，已 gitignore） | 本机留存 AppID/DepotID/构建器账号，向导重跑幂等 |
| `steamworks_build_output/`（steamcmd 生成，已 gitignore） | steamcmd 构建日志与分段缓存产物 |

## 一次上架的完整链路

1. **本地构建**：仓库根 `npm run dist` —— 四包构建 + electron-builder 打包，
   产物在 `packages/app-desktop/release/`：NSIS 安装包、portable 单文件、
   `win-unpacked/`（= Steam depot 的内容根）。
2. **Steamworks 办理**（人工）：跑向导 `bash steam/wizard-steamworks-setup.sh`，
   按提示办理合作伙伴账号、支付应用费、创建 AppID、配置成就、生成构建脚本。
3. **首次上传**（人工/向导收尾）：steamcmd `+login <构建器账号> +run_app_build
   <app_build_<AppID>.vdf 绝对路径> +quit`，上传后到 partner 站把构建 set live。

## 配置位对照（代码侧 vs Steamworks 侧）

| 配置 | 代码侧落点 | Steamworks 侧 |
|---|---|---|
| AppID | 运行期由 Steam 客户端注入（发行版无需配置）；开发期 `STEAM_APPID` 环境变量（`electron/platform.ts` appIdFromEnv）或 exe 旁 `steam_appid.txt`（仅限本机调试，**depot 排除，禁止随包发布**） | 应用管理页 → AppID |
| 成就 | content 包 achievements 节的 `id` **即** Steam 成就 API 名（#10 约定，零映射） | 应用管理页 → Technical Tools → Achievements，逐条建同名成就 |
| 云存档 | `steamworks.js` cloud 读写（`platform.ts` createSteamPlatform），槽位键 = 存档 key | 应用管理页 → Cloud：开启并配置 autocloud/同步（配额默认即可） |
| depot 内容 | `release/win-unpacked/`（electron-builder 产物整体） | 应用管理页 → depots（建应用后自动生成主 depot） |

## 版本策略（#12）

- 游戏内页脚版本行 = `content 包 version + 引擎 ENGINE_VERSION`（`packages/engine/src/version.ts`），
  文案模板在题材包 `texts.shell.footer.versionLine`——发版改包 version 即玩家可见。
- 存档自带引擎格式版本字段 `SaveData.version`；存档槽位键带 schema 代际
  （`wendao_changsheng_v3`，不兼容历史直接换键，旧档不迁移，ADR-008）。
- Steam 侧发版：改版本 → `npm run dist` → steamcmd 重传 → set live；构建描述
  （app_build vdf 的 `desc`）写游戏内版本号，便于 partner 站对账。
