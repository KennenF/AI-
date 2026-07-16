const http = require("http");
const fs = require("fs");
const path = require("path");
const { STAGES } = require("./src/ruleExtractor");
const { extractCandidates } = require("./src/aiExtractor");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const EXPORT_DIR = path.join(ROOT, "exports");

const FILES = {
  candidates: path.join(DATA_DIR, "candidates.json"),
  messages: path.join(DATA_DIR, "messages.json"),
  syncLogs: path.join(DATA_DIR, "sync_logs.json"),
  pushLogs: path.join(DATA_DIR, "push_logs.json"),
  config: path.join(DATA_DIR, "config.json")
};

const DEFAULT_CONFIG = {
  wecom: {
    mode: "mock",
    webhookUrl: "",
    inboundToken: "demo-token"
  },
  ai: {
    mode: "rule",
    endpoint: "",
    apiKey: "",
    model: "gpt-4.1-mini"
  },
  tencentDocs: {
    mode: "mock",
    appId: "",
    appSecret: "",
    documentId: "",
    sheetId: ""
  }
};

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`RecruitFlow AI Demo running at http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, storage: "json-files", extractor: "ai-adapter" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, readBootstrap());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/messages/ingest") {
    const body = await readBody(req);
    const result = await ingestMessage(body.text || "", body.channel || "manual");
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/wecom/inbound" || url.pathname === "/api/integrations/wecom/inbound")) {
    const body = await readBody(req);
    const result = await ingestWecomInbound(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/candidates/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readBody(req);
    sendJson(res, 200, updateCandidate(id, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/tencent-docs/sync") {
    sendJson(res, 200, syncTencentDocs());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/wecom/test-push") {
    const body = await readBody(req);
    sendJson(res, 200, pushWecom(body.message || "RecruitFlow AI 测试推送：接口已连通。", "test"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/wecom/interview-reminders") {
    sendJson(res, 200, pushInterviewReminders());
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/config") {
    const body = await readBody(req);
    sendJson(res, 200, updateConfig(body));
    return;
  }

  sendJson(res, 404, { error: "API not found" });
}

function readBootstrap() {
  return {
    candidates: readJson(FILES.candidates, []),
    messages: readJson(FILES.messages, []),
    syncLogs: readJson(FILES.syncLogs, []),
    pushLogs: readJson(FILES.pushLogs, []),
    config: readJson(FILES.config, DEFAULT_CONFIG),
    dashboard: buildDashboard(),
    stages: STAGES
  };
}

async function ingestMessage(text, channel) {
  if (!text.trim()) {
    return { error: "消息内容不能为空" };
  }

  const now = new Date().toISOString();
  const message = {
    id: makeId("msg"),
    channel,
    text,
    createdAt: now
  };

  const config = readJson(FILES.config, DEFAULT_CONFIG);
  const extraction = await extractCandidates(text, config);
  const extracted = extraction.candidates;
  const candidates = readJson(FILES.candidates, []);
  const upserts = extracted.map((candidate) => upsertCandidate(candidates, candidate, message.id));

  appendJson(FILES.messages, {
    ...message,
    extractedCandidateIds: upserts.map((item) => item.candidate.id),
    extractor: {
      provider: extraction.provider,
      requestedProvider: extraction.requestedProvider || extraction.provider,
      fallback: extraction.fallback,
      fallbackReason: extraction.fallbackReason || ""
    },
    extracted
  });
  writeJson(FILES.candidates, candidates);

  return {
    message,
    extractor: extraction,
    results: upserts,
    candidates,
    dashboard: buildDashboard()
  };
}

async function ingestWecomInbound(body) {
  const config = readJson(FILES.config, DEFAULT_CONFIG);
  const token = body.token || body.inboundToken || "";
  const expectedToken = config.wecom.inboundToken || DEFAULT_CONFIG.wecom.inboundToken;

  if (expectedToken && token !== expectedToken) {
    return {
      error: "企业微信消息入口 Token 校验失败",
      expected: "请在请求体中携带 data/config.json 里的 wecom.inboundToken"
    };
  }

  const text = body.text || body.content || body.message || "";
  const sender = body.sender || body.from || "企业微信群";
  const room = body.room || body.groupName || "招聘协作群";
  const result = await ingestMessage(text, "wecom-inbound");

  if (result.error) return result;

  return {
    ...result,
    inbound: {
      source: "企业微信消息入口",
      sender,
      room,
      receivedAt: new Date().toISOString()
    }
  };
}

function upsertCandidate(candidates, candidate, messageId) {
  const now = new Date().toISOString();
  const existing = findExistingCandidate(candidates, candidate);
  const historyItem = {
    at: now,
    messageId,
    stage: candidate.stage,
    status: candidate.status,
    notes: candidate.notes
  };

  if (existing) {
    Object.assign(existing, {
      name: candidate.name || existing.name,
      phone: candidate.phone || existing.phone,
      position: candidate.position || existing.position,
      source: candidate.source || existing.source,
      stage: candidate.stage || existing.stage,
      stageLabel: candidate.stageLabel || existing.stageLabel,
      status: candidate.status || existing.status,
      interviewer: candidate.interviewer || existing.interviewer,
      nextFollowUpAt: candidate.nextFollowUpAt || existing.nextFollowUpAt,
      notes: mergeNotes(existing.notes, candidate.notes),
      confidence: Math.max(existing.confidence || 0, candidate.confidence || 0),
      missingFields: candidate.missingFields,
      updatedAt: now,
      syncStatus: "pending"
    });
    existing.history = [...(existing.history || []), historyItem];
    return { action: "updated", candidate: existing };
  }

  const created = {
    ...candidate,
    id: makeId("cand"),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
    history: [historyItem]
  };
  candidates.unshift(created);
  return { action: "created", candidate: created };
}

function findExistingCandidate(candidates, candidate) {
  if (candidate.phone) {
    const byPhone = candidates.find((item) => item.phone && item.phone === candidate.phone);
    if (byPhone) return byPhone;
  }
  if (candidate.name && candidate.position) {
    return candidates.find((item) => item.name === candidate.name && item.position === candidate.position);
  }
  return null;
}

function updateCandidate(id, patch) {
  const candidates = readJson(FILES.candidates, []);
  const target = candidates.find((item) => item.id === id);
  if (!target) return { error: "候选人不存在" };

  Object.assign(target, patch, {
    updatedAt: new Date().toISOString(),
    syncStatus: "pending"
  });
  target.missingFields = ["name", "phone", "position", "stage", "nextFollowUpAt"].filter((field) => !target[field]);
  writeJson(FILES.candidates, candidates);
  return { candidate: target, dashboard: buildDashboard() };
}

function syncTencentDocs() {
  const config = readJson(FILES.config, DEFAULT_CONFIG);
  const candidates = readJson(FILES.candidates, []);
  const csvPath = path.join(EXPORT_DIR, "candidates.csv");

  candidates.forEach((candidate) => {
    candidate.syncStatus = "synced";
    candidate.syncedAt = new Date().toISOString();
  });
  writeJson(FILES.candidates, candidates);
  const csv = toCsv(candidates);
  fs.writeFileSync(csvPath, csv, "utf8");

  const log = {
    id: makeId("sync"),
    mode: config.tencentDocs.mode,
    connector: config.tencentDocs.mode === "mock" ? "MockTencentDocsConnector" : "TencentDocsConnector",
    status: "success",
    rows: candidates.length,
    target: config.tencentDocs.mode === "mock" ? "exports/candidates.csv" : config.tencentDocs.documentId,
    message: config.tencentDocs.mode === "mock"
      ? "Mock 模式：已生成 CSV，模拟同步腾讯文档。"
      : "真实模式预留：请在 Connector 中接入腾讯文档开放平台 API。",
    createdAt: new Date().toISOString()
  };
  appendJson(FILES.syncLogs, log);

  return { log, exportPath: "exports/candidates.csv", candidates, dashboard: buildDashboard() };
}

function pushInterviewReminders() {
  const candidates = readJson(FILES.candidates, []);
  const reminders = buildInterviewReminders(candidates);
  const message = reminders.length
    ? ["RecruitFlow AI 面试进展提醒", ...reminders.map((item, index) => `${index + 1}. ${item}`)].join("\n")
    : "RecruitFlow AI 面试进展提醒：当前没有需要推进的二面/跟进事项。";
  return {
    ...pushWecom(message, "interview_progress"),
    reminders
  };
}

function buildInterviewReminders(candidates) {
  const today = new Date().toISOString().slice(0, 10);
  return candidates
    .filter((candidate) => {
      if (candidate.status === "未通过" || candidate.stage === "rejected" || candidate.stage === "withdrawn") return false;
      return candidate.nextFollowUpAt || candidate.stage === "first_interview" || candidate.stage === "second_interview" || candidate.stage === "follow_up";
    })
    .sort((a, b) => String(a.nextFollowUpAt || "9999-12-31").localeCompare(String(b.nextFollowUpAt || "9999-12-31")))
    .slice(0, 8)
    .map((candidate) => {
      const date = candidate.nextFollowUpAt || "待确认时间";
      const overdue = candidate.nextFollowUpAt && candidate.nextFollowUpAt < today ? "已逾期，需优先处理" : "请按时推进";
      const nextStep = candidate.stage === "first_interview" && candidate.status === "通过"
        ? "推进二面安排"
        : candidate.stage === "second_interview"
          ? "跟进二面反馈"
          : "跟进当前招聘进展";
      return `${candidate.name || "待确认候选人"} / ${candidate.position || "待确认岗位"}：${candidate.stageLabel || "待跟进"}，${date}，${nextStep}，${overdue}。`;
    });
}

function pushWecom(message, type = "manual") {
  const config = readJson(FILES.config, DEFAULT_CONFIG);
  const log = {
    id: makeId("push"),
    type,
    mode: config.wecom.mode,
    connector: config.wecom.mode === "mock" ? "MockWeComRobot" : "WeComRobot",
    status: "success",
    target: config.wecom.mode === "mock" ? "data/push_logs.json" : config.wecom.webhookUrl,
    message,
    createdAt: new Date().toISOString()
  };

  if (config.wecom.mode === "real" && !config.wecom.webhookUrl) {
    log.status = "blocked";
    log.message = "已切换真实模式，但缺少企业微信机器人 Webhook URL。";
  }

  appendJson(FILES.pushLogs, log);
  return { log, pushLogs: readJson(FILES.pushLogs, []) };
}

function updateConfig(patch) {
  const current = readJson(FILES.config, DEFAULT_CONFIG);
  const next = {
    wecom: { ...current.wecom, ...(patch.wecom || {}) },
    ai: { ...current.ai, ...(patch.ai || {}) },
    tencentDocs: { ...current.tencentDocs, ...(patch.tencentDocs || {}) }
  };
  writeJson(FILES.config, next);
  return { config: next };
}

function buildDashboard() {
  const candidates = readJson(FILES.candidates, []);
  const today = new Date().toISOString().slice(0, 10);
  const byStage = {};
  const bySource = {};
  const byPosition = {};
  let overdue = 0;
  let pendingFollowUp = 0;

  candidates.forEach((candidate) => {
    byStage[candidate.stageLabel || candidate.stage || "未识别"] = (byStage[candidate.stageLabel || candidate.stage || "未识别"] || 0) + 1;
    bySource[candidate.source || "未知"] = (bySource[candidate.source || "未知"] || 0) + 1;
    byPosition[candidate.position || "未知"] = (byPosition[candidate.position || "未知"] || 0) + 1;
    if (candidate.nextFollowUpAt && candidate.nextFollowUpAt < today) overdue += 1;
    if (candidate.stage === "follow_up" || candidate.status === "待反馈") pendingFollowUp += 1;
  });

  return {
    total: candidates.length,
    todayNew: candidates.filter((item) => String(item.createdAt || "").slice(0, 10) === today).length,
    pendingFollowUp,
    overdue,
    byStage,
    bySource,
    byPosition
  };
}

function toCsv(candidates) {
  const headers = ["姓名", "手机号", "岗位", "来源", "阶段", "状态", "面试官", "下次跟进", "置信度", "同步状态", "备注"];
  const rows = candidates.map((item) => [
    item.name,
    item.phone,
    item.position,
    item.source,
    item.stageLabel,
    item.status,
    item.interviewer,
    item.nextFollowUpAt,
    item.confidence,
    item.syncStatus,
    item.notes
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value || "");
  return `"${text.replace(/"/g, '""')}"`;
}

function mergeNotes(existing, next) {
  if (!existing) return next || "";
  if (!next || existing.includes(next)) return existing;
  return `${next}\n${existing}`;
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? "/public/index.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolute = path.join(ROOT, filePath);

  if (!absolute.startsWith(ROOT) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  const ext = path.extname(absolute).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8"
  }[ext] || "application/octet-stream";
  sendText(res, 200, fs.readFileSync(absolute), contentType);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  sendText(res, status, JSON.stringify(payload, null, 2), "application/json; charset=utf-8");
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, payload) {
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

function appendJson(file, item) {
  const list = readJson(file, []);
  list.unshift(item);
  writeJson(file, list);
}

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  if (!fs.existsSync(FILES.candidates)) writeJson(FILES.candidates, []);
  if (!fs.existsSync(FILES.messages)) writeJson(FILES.messages, []);
  if (!fs.existsSync(FILES.syncLogs)) writeJson(FILES.syncLogs, []);
  if (!fs.existsSync(FILES.pushLogs)) writeJson(FILES.pushLogs, []);
  if (!fs.existsSync(FILES.config)) writeJson(FILES.config, DEFAULT_CONFIG);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
