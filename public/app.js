const state = {
  page: "dashboard",
  candidates: [],
  messages: [],
  syncLogs: [],
  pushLogs: [],
  config: null,
  dashboard: null,
  stages: []
};

const titles = {
  dashboard: ["招聘看板", "企业微信群消息自动结构化，候选人数据实时归档。"],
  ingest: ["消息采集", "模拟企业微信消息入口，使用规则抽取器完成结构化解析。"],
  candidates: ["候选人管理", "候选人数据保存在普通 JSON 文件中，可人工修正。"],
  integrations: ["集成配置", "企业微信机器人与腾讯文档接口在 Demo 中以 Mock 方式体现。"],
  logs: ["运行日志", "查看消息解析、腾讯文档同步、企业微信推送记录。"]
};

const sampleMessage = `候选人: 张三，电话 1**********，岗位: Java 后端实习生，来源: Boss，今天一面通过，面试官李老师，下周三约二面，备注: 项目匹配度高，算法基础一般。
候选人: 李娜，电话 1**********，岗位: 大模型算法实习生，来源: 内推，简历筛选通过，明天跟进，面试官王老师。
王磊 1********** 前端实习生 来自牛客，二面不通过，组件化经验不足。`;

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  document.getElementById("messageInput").value = sampleMessage;
  bootstrap();
  window.setInterval(() => bootstrap({ silent: true }), 5000);
});

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  });

  document.getElementById("refreshBtn").addEventListener("click", bootstrap);
  document.getElementById("syncTopBtn").addEventListener("click", syncDocs);
  document.getElementById("syncBtn").addEventListener("click", syncDocs);
  document.getElementById("sampleBtn").addEventListener("click", () => {
    document.getElementById("messageInput").value = sampleMessage;
  });
  document.getElementById("ingestBtn").addEventListener("click", ingestMessage);
  document.getElementById("inboundMockBtn").addEventListener("click", simulateWecomInbound);
  document.getElementById("pushBtn").addEventListener("click", pushWecom);
  document.getElementById("reminderBtn").addEventListener("click", pushInterviewReminders);
  document.getElementById("saveConfigBtn").addEventListener("click", saveConfig);
  document.getElementById("saveConfigBtn2").addEventListener("click", saveConfig);
  document.getElementById("saveConfigBtn3").addEventListener("click", saveConfig);
  document.getElementById("candidateSearch").addEventListener("input", renderCandidates);
  document.getElementById("stageFilter").addEventListener("change", renderCandidates);
}

async function bootstrap(options = {}) {
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  hydrateConfig();
  hydrateInboundInfo();
  renderAll();
  if (!options.silent) toast("数据已刷新");
}

function switchPage(page) {
  state.page = page;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  document.querySelectorAll(".page").forEach((item) => item.classList.remove("active"));
  document.getElementById(`${page}Page`).classList.add("active");
  document.getElementById("pageTitle").textContent = titles[page][0];
  document.getElementById("pageSubtitle").textContent = titles[page][1];
}

async function ingestMessage() {
  const text = document.getElementById("messageInput").value;
  const result = await api("/api/messages/ingest", {
    method: "POST",
    body: { text, channel: "wecom-mock" }
  });

  if (result.error) {
    toast(result.error);
    return;
  }

  state.candidates = result.candidates;
  state.dashboard = result.dashboard;
  await bootstrap();
  renderExtractPreview(result.results || []);
  toast(`已解析 ${result.results.length} 条候选人记录`);
}

async function simulateWecomInbound() {
  const text = document.getElementById("messageInput").value;
  const result = await api("/api/wecom/inbound", {
    method: "POST",
    body: {
      token: state.config?.wecom?.inboundToken || "demo-token",
      room: "招聘协作群",
      sender: "企业微信群成员",
      text
    }
  });

  if (result.error) {
    toast(result.error);
    return;
  }

  state.candidates = result.candidates;
  state.dashboard = result.dashboard;
  await bootstrap({ silent: true });
  renderExtractPreview(result.results || []);
  toast(`企微入口收到消息，已更新 ${result.results.length} 条候选人记录`);
}

async function syncDocs() {
  const result = await api("/api/integrations/tencent-docs/sync", { method: "POST", body: {} });
  state.syncLogs = [result.log, ...state.syncLogs];
  state.candidates = result.candidates;
  state.dashboard = result.dashboard;
  renderAll();
  toast("已生成 exports/candidates.csv，模拟腾讯文档同步");
}

async function pushWecom() {
  await saveConfig(false);
  const message = document.getElementById("pushMessage").value;
  const result = await api("/api/integrations/wecom/test-push", {
    method: "POST",
    body: { message }
  });
  state.pushLogs = result.pushLogs;
  renderLogs();
  toast(result.log.status === "success" ? "企业微信 Mock 推送已记录" : result.log.message);
}

async function pushInterviewReminders() {
  await saveConfig(false);
  const result = await api("/api/integrations/wecom/interview-reminders", {
    method: "POST",
    body: {}
  });
  state.pushLogs = result.pushLogs;
  renderLogs();
  toast(result.reminders.length ? `已生成 ${result.reminders.length} 条面试进展提醒` : "当前没有待提醒事项");
}

async function saveConfig(showToast = true) {
  const patch = collectConfig();
  const result = await api("/api/config", {
    method: "PATCH",
    body: patch
  });
  state.config = result.config;
  if (showToast) toast("集成配置已保存");
}

async function updateCandidate(id, patch) {
  const result = await api(`/api/candidates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch
  });
  if (result.error) {
    toast(result.error);
    return;
  }
  const index = state.candidates.findIndex((item) => item.id === id);
  if (index >= 0) state.candidates[index] = result.candidate;
  state.dashboard = result.dashboard;
  renderAll();
  toast("候选人已更新");
}

function renderAll() {
  renderDashboard();
  renderStageOptions();
  renderCandidates();
  renderLogs();
}

function renderDashboard() {
  const dashboard = state.dashboard || {};
  setText("metricTotal", dashboard.total || 0);
  setText("metricToday", dashboard.todayNew || 0);
  setText("metricPending", dashboard.pendingFollowUp || 0);
  setText("metricOverdue", dashboard.overdue || 0);
  renderBars("stageBars", dashboard.byStage || {});
  renderBars("sourceBars", dashboard.bySource || {});
  renderRecentCandidates();
}

function renderBars(containerId, data) {
  const container = document.getElementById(containerId);
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  if (!entries.length) {
    container.innerHTML = empty("暂无数据");
    return;
  }
  container.innerHTML = entries.map(([label, value]) => `
    <div class="bar-row">
      <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, (value / max) * 100)}%"></div></div>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderRecentCandidates() {
  const rows = state.candidates.slice(0, 6).map((item) => `
    <tr>
      <td>${escapeHtml(item.name || "待确认")}</td>
      <td>${escapeHtml(item.position || "待确认")}</td>
      <td>${tag(item.stageLabel || item.stage || "待跟进")}</td>
      <td>${escapeHtml(item.status || "待反馈")}</td>
      <td>${escapeHtml(item.source || "未知")}</td>
      <td>${dateTag(item.nextFollowUpAt)}</td>
      <td>${confidenceTag(item)}</td>
    </tr>
  `).join("");
  document.getElementById("recentCandidates").innerHTML = rows || tableEmpty(7, "暂无候选人");
}

function renderExtractPreview(results) {
  const container = document.getElementById("extractPreview");
  if (!results.length) {
    container.innerHTML = empty("等待解析结果");
    return;
  }
  container.innerHTML = results.map(({ action, candidate }) => `
    <article class="candidate-preview">
      <header>
        <strong>${escapeHtml(candidate.name || "待确认姓名")}</strong>
        ${tag(action === "created" ? "新增" : "更新", action === "created" ? "" : "warn")}
      </header>
      <div class="preview-grid">
        <span>电话 <strong>${escapeHtml(candidate.phone || "缺失")}</strong></span>
        <span>岗位 <strong>${escapeHtml(candidate.position || "缺失")}</strong></span>
        <span>阶段 <strong>${escapeHtml(candidate.stageLabel || "待跟进")}</strong></span>
        <span>来源 <strong>${escapeHtml(candidate.source || "未知")}</strong></span>
        <span>跟进 <strong>${escapeHtml(candidate.nextFollowUpAt || "缺失")}</strong></span>
        <span>置信度 <strong>${Math.round((candidate.confidence || 0) * 100)}%</strong></span>
      </div>
    </article>
  `).join("");
}

function renderStageOptions() {
  const select = document.getElementById("stageFilter");
  const current = select.value;
  select.innerHTML = `<option value="">全部阶段</option>${state.stages.map((stage) => `<option value="${stage.value}">${stage.label}</option>`).join("")}`;
  select.value = current;
}

function renderCandidates() {
  const keyword = document.getElementById("candidateSearch").value.trim().toLowerCase();
  const stage = document.getElementById("stageFilter").value;
  const filtered = state.candidates.filter((item) => {
    const haystack = [item.name, item.position, item.source, item.phone, item.status].join(" ").toLowerCase();
    return (!keyword || haystack.includes(keyword)) && (!stage || item.stage === stage);
  });

  document.getElementById("candidateRows").innerHTML = filtered.map((item) => `
    <tr>
      <td><input value="${attr(item.name)}" data-field="name" data-id="${item.id}" /></td>
      <td><input value="${attr(item.phone)}" data-field="phone" data-id="${item.id}" /></td>
      <td><input value="${attr(item.position)}" data-field="position" data-id="${item.id}" /></td>
      <td>${stageSelect(item)}</td>
      <td><input value="${attr(item.status)}" data-field="status" data-id="${item.id}" /></td>
      <td><input value="${attr(item.source)}" data-field="source" data-id="${item.id}" /></td>
      <td><input value="${attr(item.interviewer)}" data-field="interviewer" data-id="${item.id}" /></td>
      <td><input type="date" value="${attr(item.nextFollowUpAt)}" data-field="nextFollowUpAt" data-id="${item.id}" /></td>
      <td>${syncTag(item.syncStatus)}</td>
      <td><button class="small-action" data-save="${item.id}">保存</button></td>
    </tr>
  `).join("") || tableEmpty(10, "暂无候选人");

  document.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.save;
      const fields = document.querySelectorAll(`[data-id="${id}"]`);
      const patch = {};
      fields.forEach((field) => {
        patch[field.dataset.field] = field.value;
      });
      const stageDef = state.stages.find((item) => item.value === patch.stage);
      patch.stageLabel = stageDef ? stageDef.label : patch.stage;
      updateCandidate(id, patch);
    });
  });
}

function stageSelect(item) {
  return `<select data-field="stage" data-id="${item.id}">
    ${state.stages.map((stage) => `<option value="${stage.value}" ${stage.value === item.stage ? "selected" : ""}>${stage.label}</option>`).join("")}
  </select>`;
}

function renderLogs() {
  renderLogList("syncLogs", state.syncLogs, (log) => `
    <strong>${escapeHtml(log.connector || "TencentDocsConnector")} · ${escapeHtml(log.status)}</strong>
    <p>${escapeHtml(log.message || "")}</p>
    <p>目标：${escapeHtml(log.target || "-")} · 行数：${log.rows || 0} · ${formatTime(log.createdAt)}</p>
  `);
  renderLogList("pushLogs", state.pushLogs, (log) => `
    <strong>${escapeHtml(log.connector || "WeComRobot")} · ${escapeHtml(log.type || "manual")} · ${escapeHtml(log.status)}</strong>
    <p>${escapeHtml(log.message || "")}</p>
    <p>目标：${escapeHtml(log.target || "-")} · ${formatTime(log.createdAt)}</p>
  `);
  renderLogList("messageLogs", state.messages, (log) => `
    <strong>${escapeHtml(log.channel || "manual")} · ${formatTime(log.createdAt)}</strong>
    <p>${escapeHtml(log.text || "")}</p>
    <p>候选人 ID：${escapeHtml((log.extractedCandidateIds || []).join(", ") || "-")}</p>
  `);
}

function renderLogList(containerId, items, template) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.length ? items.map((item) => `<article class="log-item">${template(item)}</article>`).join("") : empty("暂无日志");
}

function hydrateConfig() {
  const config = state.config || { wecom: {}, tencentDocs: {} };
  document.getElementById("wecomMode").value = config.wecom.mode || "mock";
  document.getElementById("wecomWebhook").value = config.wecom.webhookUrl || "";
  document.getElementById("aiMode").value = config.ai?.mode || "rule";
  document.getElementById("aiEndpoint").value = config.ai?.endpoint || "";
  document.getElementById("aiModel").value = config.ai?.model || "gpt-4.1-mini";
  document.getElementById("aiApiKey").value = config.ai?.apiKey || "";
  document.getElementById("docsMode").value = config.tencentDocs.mode || "mock";
  document.getElementById("docsAppId").value = config.tencentDocs.appId || "";
  document.getElementById("docsDocumentId").value = config.tencentDocs.documentId || "";
  document.getElementById("docsSheetId").value = config.tencentDocs.sheetId || "";
}

function hydrateInboundInfo() {
  const origin = window.location.origin;
  const token = state.config?.wecom?.inboundToken || "demo-token";
  document.getElementById("wecomInboundUrl").textContent = `POST ${origin}/api/wecom/inbound`;
  document.getElementById("wecomInboundToken").textContent = token;
  document.getElementById("inboundStatus").textContent = `自动刷新中，上次同步 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
}

function collectConfig() {
  return {
    wecom: {
      mode: document.getElementById("wecomMode").value,
      webhookUrl: document.getElementById("wecomWebhook").value.trim()
    },
    ai: {
      mode: document.getElementById("aiMode").value,
      endpoint: document.getElementById("aiEndpoint").value.trim(),
      model: document.getElementById("aiModel").value.trim() || "gpt-4.1-mini",
      apiKey: document.getElementById("aiApiKey").value.trim()
    },
    tencentDocs: {
      mode: document.getElementById("docsMode").value,
      appId: document.getElementById("docsAppId").value.trim(),
      documentId: document.getElementById("docsDocumentId").value.trim(),
      sheetId: document.getElementById("docsSheetId").value.trim()
    }
  };
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`API failed: ${response.status}`);
  return response.json();
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function tag(text, tone = "") {
  return `<span class="tag ${tone}">${escapeHtml(text)}</span>`;
}

function confidenceTag(item) {
  const confidence = item.confidence || 0;
  const tone = confidence < 0.65 || (item.missingFields || []).length ? "warn" : "";
  const title = (item.missingFields || []).length ? `缺失：${item.missingFields.join(", ")}` : "字段完整";
  return `<span class="tag ${tone}" title="${escapeHtml(title)}">${Math.round(confidence * 100)}%</span>`;
}

function dateTag(value) {
  if (!value) return tag("待确认", "warn");
  const today = new Date().toISOString().slice(0, 10);
  return tag(value, value < today ? "danger" : "");
}

function syncTag(value) {
  if (value === "synced") return tag("已同步");
  return tag("待同步", "warn");
}

function tableEmpty(colspan, message) {
  return `<tr><td colspan="${colspan}" class="muted">${message}</td></tr>`;
}

function empty(message) {
  return `<p class="muted">${message}</p>`;
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 2200);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function attr(value) {
  return escapeHtml(value);
}
