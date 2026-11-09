# MOJI · 部署指南

一个本地优先 + 云同步的个人记账 PWA。数据存在你设备本地(秒开、离线可用),同时自动同步到你自己的 Cloudflare D1 云数据库,实现多设备共享。内置密码门(输一次本设备记住),只有你能访问。

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | 整个 app(前端 + 本地存储 + 同步逻辑) |
| `sw.js` | Service Worker,负责离线缓存(让 app 能装成主屏 App) |
| `manifest.webmanifest` | PWA 安装信息与启动参数 |
| `apple-touch-icon.png` | iPhone/iPad 主屏幕图标(180x180) |
| `icon-192.png` / `icon-512.png` | PWA 标准图标 |
| `functions/api/sync.js` | 后端同步接口(Cloudflare Pages Function) |
| `schema.sql` | D1 数据库建表语句 |
| `wrangler.toml` | Cloudflare 配置(D1 绑定) |

---

## 部署步骤(约 15 分钟,全程网页操作)

### 第 1 步:代码推到 GitHub

1. 注册/登录 [github.com](https://github.com)
2. 右上角 **+ → New repository**,名字填 `moji-journal`,选 **Private(私有)**,点 Create
3. 在本机终端(就在本文件夹)执行(把 `你的用户名` 换成你的 GitHub 用户名):
   ```bash
   cd /Users/bytedance/Downloads/moji-deploy
   git remote add origin https://github.com/你的用户名/moji-journal.git
   git branch -M main
   git push -u origin main
   ```
   > 首次 push 会让你登录 GitHub(浏览器授权或输入 token)。

### 第 2 步:创建 D1 数据库

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com)
2. 左侧 **Storage & Databases → D1 SQL Database → Create**
3. 数据库名填 `moji-db`,点 Create
4. 进入该数据库 → **Console** 标签,把 `schema.sql` 的全部内容粘进去,点 **Execute**(建表)
5. 回到数据库概览页,复制 **Database ID**(一串 uuid),下一步要用

### 第 3 步:创建 Pages 项目并连 GitHub

1. 左侧 **Compute (Workers) → Pages → Create → Connect to Git**
2. 授权并选中刚才的 `moji-journal` 仓库
3. 构建设置**全部留空**(这是纯静态 + Functions,无需构建):
   - Build command: 空
   - Build output directory: `/`(或留默认)
4. 点 **Save and Deploy**,等它第一次部署完成

### 第 4 步:把 D1 绑定到 Pages

1. 进入你的 Pages 项目 → **Settings → Functions → D1 database bindings**
2. 点 **Add binding**:
   - Variable name 填 **`DB`**(必须大写,和代码一致)
   - D1 database 选 `moji-db`
3. 保存后,到 **Deployments** 页点 **Retry deployment**(让绑定生效)

> `wrangler.toml` 里的 `database_id` 占位符在走 Pages 控制台绑定时可忽略;若你改用命令行 wrangler 部署,则需把它替换成第 2 步复制的真实 ID。

### 第 5 步:设置密码环境变量(保护后端接口)

app 已内置密码门:打开要输密码 `7564`,输一次本设备记住、以后免输。这一步是让**后端同步接口**也认这个密码,防止别人调你的接口、蹭你的数据和 AI Key。

1. 进入你的 Pages 项目 → **Settings → Environment variables**
2. 点 **Add variable**(Production 环境):
   - Variable name 填 **`APP_PASS`**
   - Value 填 **`7564`**(和前端密码一致)
   - 建议点 **Encrypt** 加密保存
3. 保存后到 **Deployments** 页 **Retry deployment** 让变量生效

> 密码怎么工作:前端源码里只存密码的哈希(看不到 `7564` 明文);每次同步请求会带上密码,后端比对 `APP_PASS` 一致才放行。别人没密码,既进不了 app,也调不动接口。

**想改密码?** 改两个地方要一致:① 前端 `index.html` 里的 `PASS_HASH`(用新密码的 SHA-256),② 这里的 `APP_PASS`。需要时我帮你算哈希。

---

## 完成后

- 手机/电脑浏览器打开 `https://moji-journal.pages.dev`,输密码 `7564`(一次,以后免输)
- iOS Safari:分享 → **添加到主屏幕**;Android Chrome:菜单 → **安装应用**
- 现在电脑记的账,手机打开会自动同步过来(左下角同步图标:绿色=已同步,转圈=同步中,灰=离线,红=失败)

## 以后改代码怎么更新

改完 `index.html` 后:
```bash
git add -A && git commit -m "更新" && git push
```
Cloudflare 会自动重新部署,几十秒后生效。

## 同步 Downloads 独立副本

独立 HTML 依赖同目录图标和 manifest，使用脚本统一导出，避免只复制 HTML 造成坏图:
```bash
./scripts/export-standalone.sh
```

## 关于 AI Key 安全

API Key 存在你浏览器本地(设置页填),不进代码仓库。配合密码(前端门 + 后端 APP_PASS),别人打不开 app、调不了接口,也就用不了你的 Key。✅

## 数据备份

虽然有云同步,重要数据建议定期 **设置 → 导出 JSON 备份** 存一份,以防万一。

## AI 记账错误诊断

记账、文本拆账或截图识别失败时，页面显示中文原因，并提供“查看诊断详情”。
复制其中的错误码、请求编号、时间、版本、失败阶段、耗时、HTTP 状态和模型信息，即可区分请求连接问题和模型返回问题。
详情和应用日志不包含账单原文、模型正文、音频、主密码或 API Key。

| 错误码 | 含义 |
|---|---|
| `AI_OFFLINE` | 浏览器报告设备离线 |
| `AI_NETWORK` | 浏览器请求或响应正文读取失败；不能仅凭此判断 Wi-Fi、DNS、TLS 或中间链路 |
| `AI_TIMEOUT` | 客户端等待超过 60 秒 |
| `AI_UPSTREAM_NETWORK` / `AI_UPSTREAM_TIMEOUT` | Pages 连接模型服务失败或超过 45 秒 |
| `AI_BALANCE` / `AI_RATE_LIMIT` | 模型服务余额不足或限流 |
| `AI_ACCESS_DENIED` / `AI_UPSTREAM_AUTH` | 应用门禁验证失败或服务器模型密钥失效 |
| `AI_RESPONSE_INVALID` / `AI_UPSTREAM_RESPONSE_INVALID` | 应用接口或模型服务响应格式异常 |
| `AI_OUTPUT_TRUNCATED` / `AI_EMPTY_OUTPUT` | 模型输出被截断或未返回答案 |
| `AI_ACCOUNT_JSON_INVALID` / `AI_PARSE_FAILED` | 模型账目不是有效 JSON，或账目解析发生异常 |

`client_request`、`response_body` 是浏览器阶段；`upstream_request`、`upstream_body`、
`upstream_response` 是服务器调用模型的阶段；`model_output`、`account_parse` 是输出验证和账目解析阶段。
`online: true` 只说明设备有网络连接，不保证记账接口可达。

服务端每个请求输出一条 `event: "moji.ai"` 的元数据日志，用同一 `requestId` 关联前后端。
复现时可查看当前生产部署的实时日志：

```bash
npx wrangler pages deployment tail --project-name moji --environment production --format json
```

实时日志并不自动成为永久历史记录。若需要跨天检索，应在 Cloudflare 配置日志持久化；
没有查到日志，不能据此证明请求未到达服务器。此改动不自动重试模型请求或重复入账。

验证：

```bash
node tests/ai-diagnostics.test.mjs
node tests/ai-parse.test.mjs
```
