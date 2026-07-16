# RecruitFlow AI Demo

RecruitFlow AI 是一个面向 HR 招聘提效场景的轻量 Demo，用于演示：

- 企业微信群消息进入系统
- 规则版 AI 抽取器将自然语言转为候选人结构化数据
- 候选人数据写入普通 JSON 文件
- 招聘看板自动更新
- 腾讯文档同步接口预留
- 企业微信机器人推送接口预留
- 大模型 API 抽取接口预留
- 面试进展提醒推送到企业微信工作群

当前版本不接入大模型 API，使用 `src/ruleExtractor.js` 作为可运行的小替代，保证没有 API Key 也能完整演示。
后续接入大模型时，切换 `data/config.json` 中的 `ai.mode=llm`，并填写 endpoint、model、apiKey 即可。

## 快速开始

本项目无外部 npm 依赖，只需要 Node.js。

```bash
npm start
```

启动后访问：

```txt
http://localhost:5173
```

页面内置样例群聊消息，点击“AI 解析并入库”即可看到候选人写入 `data/candidates.json`，看板随之更新。

如果本机没有配置 npm，也可以直接运行：

```bash
node server.js
```

## 当前 Demo 数据文件

```txt
data/
  candidates.json
  messages.json
  sync_logs.json
  push_logs.json
  config.json
exports/
  candidates.csv
```

当前静态 Demo 会从这些文件的示例结构出发，并在浏览器 localStorage 中保存操作结果；点击导出时生成 CSV 文件，模拟同步腾讯文档。
启动本地服务后，操作结果会真实写入这些普通文件。点击“同步腾讯文档”会更新 `exports/candidates.csv`。

## 后续数据库改造

为降低部署和演示成本，当前 Demo 采用普通 JSON/CSV 文件作为数据载体。生产环境中可将文件存储替换为 MySQL、PostgreSQL、MongoDB 或企业已有 ATS 数据库。

建议改造方式：

1. 保留候选人、消息、同步日志、推送日志的数据结构。
2. 将文件读写层替换为数据库 Repository。
3. 企业微信与腾讯文档 Connector 不变。
4. 看板接口从数据库聚合统计数据。

## 企业微信接口预留

Demo 中提供两类企业微信能力：

- 消息入口：模拟企业微信应用回调，将群聊文本提交给系统并实时更新候选人表。
- 机器人推送：模拟企业微信群机器人 Webhook，用于发送待跟进提醒、二面进展、日报、同步结果。

真实接入时分为两条链路：

- 读群消息：使用企业微信应用回调、会话存档，或 HR 表单/转发入口，将群消息提交到系统。
- 发群提醒：使用企业微信群机器人 Webhook，向工作群推送面试进展和待办提醒。

普通群机器人 Webhook 更适合“发消息”，不适合作为“读取群聊消息”的唯一入口。

当前已提供接口：

```txt
POST /api/wecom/inbound
POST /api/integrations/wecom/inbound
POST /api/integrations/wecom/test-push
POST /api/integrations/wecom/interview-reminders
```

其中 `wecom/inbound` 用于接收企业微信群消息：

```json
{
  "token": "demo-token",
  "room": "招聘协作群",
  "sender": "HR 张同学",
  "text": "候选人: 张三，电话 1**********，岗位: Java 后端，今天一面通过，下周三约二面"
}
```

`interview-reminders` 会根据候选人的当前阶段和 `nextFollowUpAt` 生成提醒，例如“张三 / Java 后端实习生：初面通过，2026-07-22 推进二面安排”。

## 腾讯文档接口预留

Demo 中的“同步腾讯文档”会生成 CSV 文件，模拟把候选人表写入腾讯在线文档。

真实接入时可替换为腾讯文档开放平台 API：

- 将候选人字段映射为腾讯表格列。
- 新增/更新候选人时触发同步任务。
- 写入同步日志，展示成功/失败状态。

## 规则版 AI 抽取器

当前版本不用大模型，采用关键词和正则规则完成字段抽取：

- 手机号识别
- 姓名识别
- 岗位识别
- 来源识别
- 招聘阶段识别
- 面试官识别
- 跟进时间识别
- 缺失字段提示
- 置信度估算

## 大模型 API 预留

当前抽取统一入口是：

```txt
src/aiExtractor.js
```

已预留的大模型实现是：

```txt
src/llmExtractor.js
```

后续接入大模型时，不需要改看板、同步和企微提醒逻辑，只需要在集成页或 `data/config.json` 中配置：

```json
{
  "ai": {
    "mode": "llm",
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "apiKey": "YOUR_API_KEY",
    "model": "gpt-4.1-mini"
  }
}
```

如果配置了 `llm` 但没有 API Key 或请求失败，系统会自动回退到规则抽取器，保证 Demo 不会运行失败。

## 演示建议

1. 打开“消息采集”，使用内置样例或粘贴企业微信群消息。
2. 点击“模拟企微群消息推送”，模拟企业微信实时回调进入 `/api/wecom/inbound`。
3. 切到“看板”，查看漏斗、渠道分布和待跟进指标。
4. 切到“集成”，点击“手动同步”，观察 `exports/candidates.csv` 和同步日志。
5. 点击“推送面试进展提醒”，观察系统自动生成二面/跟进提醒并写入企业微信 Mock 推送日志。
