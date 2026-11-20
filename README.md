# 知间 · 读书笔记

微信读书负责阅读，ChatGPT / Claude 负责讨论，**知间**负责整理、回顾和将笔记保存到 GitHub。

## 已实现

- 响应式书架：手动添加书名、作者、分类、封面（图片在上传前压缩）
- 每本书独立目录；每张笔记独立 JSON 文件
- 费曼复述：一句话概括、自己的理解、例子、疑问；不强制章节目录
- 复制费曼纠错提示词到外部 AI
- 复制知识卡整理提示词，接收并解析 JSON，允许修改字段
- 两阶段保存：初次复述（待讨论） / 知识卡（已整理）
- 全部知识卡、主动回忆翻卡、按书管理、编辑和删除
- GitHub 云端写入确认、版本冲突保护、失败保留当前编辑内容
- 不使用 localStorage / IndexedDB 保存笔记或写入口令；可选择在 localStorage 保存 30 天有效的签名登录凭证
- PWA manifest 和移动端响应式样式

**注意：不提供内置 AI、自动从微信读书抓取内容、离线写入或账号系统。**

## 部署流程

### 1. 部署 Cloudflare Worker

可用 Cloudflare Dashboard 创建一个 Worker，把 `worker/src/index.js` 的代码复制进去部署；或在 `worker/` 目录使用 Wrangler 部署。

Worker 需要以下配置：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `GITHUB_TOKEN` | GitHub Fine-grained personal access token |
| Secret | `WRITE_PASSWORD` | 你自己设置的高强度写入口令 |
| Variable | `REPO` | `wongtszshan/reading-notes` |
| Variable | `BRANCH` | `main` |
| Variable | `APP_ORIGIN` | `https://wongtszshan.github.io` |

创建 GitHub Fine-grained Token 时只授予 `wongtszshan/reading-notes` 一个仓库的 **Contents: Read and write** 权限。不要把 Token 写入前端、仓库、提交日志或 Worker 公开变量。Worker 的两项 Secret 应在 Cloudflare Secrets 中配置，而不是 `wrangler.toml`。

`APP_ORIGIN` 是 **origin** 而不是完整的 Pages 路径，即不包含 `/reading-notes/`。

使用 Wrangler 时：

```sh
cd worker
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WRITE_PASSWORD
npx wrangler deploy
```

### 2. 连接网页

在根目录的 `config.js` 填上你刚部署的 Worker 地址：

```js
window.READING_NOTES_CONFIG = {
  workerUrl: "https://reading-notes-api.YOUR-SUBDOMAIN.workers.dev",
  githubOwner: "wongtszshan",
  githubRepo: "reading-notes",
  githubBranch: "main"
};
```

注意：Worker URL 可以公开，**WRITE_PASSWORD 不能放到 config.js**。在网页右上角“设置”中输入一次口令并验证。选中“记住此设备 30 天”后浏览器只保存签名登录凭证（不是原始口令）；到期或退出后重新验证。不勾选时刷新网页需要重新登录。

### 3. 发布 GitHub Pages

仓库 Settings → Pages → Build and deployment → Deploy from a branch → `main` → `/(root)` → Save。

预期网页 URL：

https://wongtszshan.github.io/reading-notes/

此 URL 仅为预期地址，**并不表示 Pages 已启用或部署成功**。

## 云端数据布局

```text
index.html
config.js
assets/
  app.js
  style.css
  icon.svg
data/
  books.json
  books/
    <book-id>/
      book.json
      cover.jpg
      notes/
        <note-id>.json
worker/
  src/index.js
  wrangler.toml
```

### 写入和失败处理

网页在用户点击保存后，先通过 Worker 读取目标文件的 SHA，再调用 Worker 写入。Worker **再次核对当前云端 SHA**，不一致时返回 409；GitHub 成功返回提交信息后前端显示成功。

新建笔记涉及两个文件：`notes/<note-id>.json` 和 `book.json`。如果中途网络断开，可能出现部分文件已上传的情况；此时应重新打开书籍或检查仓库文件再重试。书架索引 `books.json` 的笔记数量是便捷字段，不是笔记真实内容源。

网页不对笔记内容做持久化的本地自动保存；未点击保存的草稿在刷新 / 关闭时会丢失。选择“记住此设备”仅会保存登录凭证，已签发的凭证在到期前有效；本地退出无法撤销已复制的凭证，若需立即让全部设备失效，轮换 Cloudflare 的 WRITE_PASSWORD。公开仓库的内容（包括笔记、例子、Git 历史）人人可见；书籍正文及大量受版权保护摘录不建议上传。

## AI 整理 JSON 格式

请让外部 AI 返回以下字段（均为字符串），然后粘贴到“AI 整理结果”并点击“解析结果”：

```json
{
  "summary": "一句话总结",
  "concepts": "关键概念与条件",
  "example": "我的例子",
  "misconceptions": "曾经理解错误的地方与修正",
  "extensions": "补充与延伸",
  "question": "可用于主动回忆的问题"
}
```

## 安全说明

Worker 限制了允许写入的文件路径和浏览器请求源，并验证写入口令。这个轻量版本并未实现独立账号登录、服务端审计或严格的速率限制。请使用高强度口令，不要泄露。GitHub 公库不是私人笔记空间。

## 官方文档

- GitHub Pages: https://docs.github.com/en/pages
- GitHub Contents API: https://docs.github.com/en/rest/repos/contents
- Cloudflare Workers Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
