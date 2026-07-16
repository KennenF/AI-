const STAGES = [
  { value: "resume_screen", label: "简历筛选", keywords: ["简历", "筛选", "初筛"] },
  { value: "first_interview", label: "初面", keywords: ["初面", "一面", "1面", "第一轮"] },
  { value: "second_interview", label: "复面", keywords: ["复面", "二面", "2面", "第二轮"] },
  { value: "hr_interview", label: "HR面", keywords: ["hr面", "hr 面", "HR 面"] },
  { value: "offer", label: "Offer", keywords: ["offer", "录用", "发 offer", "已发"] },
  { value: "onboard", label: "已入职", keywords: ["入职", "到岗"] },
  { value: "rejected", label: "已淘汰", keywords: ["淘汰", "不通过", "挂了", "拒绝"] },
  { value: "withdrawn", label: "已放弃", keywords: ["放弃", "不考虑", "拒 offer"] },
  { value: "follow_up", label: "待跟进", keywords: ["跟进", "待约", "待确认", "再沟通"] }
];

const STATUS_KEYWORDS = [
  { value: "通过", keywords: ["通过", "pass", "可推进", "进入下一轮"] },
  { value: "待反馈", keywords: ["待反馈", "等反馈", "待确认", "待约", "跟进"] },
  { value: "未通过", keywords: ["不通过", "淘汰", "挂了", "不合适"] },
  { value: "已放弃", keywords: ["放弃", "不考虑", "拒 offer"] },
  { value: "已发Offer", keywords: ["发 offer", "已发 offer", "offer 已发", "录用"] }
];

const SOURCES = ["Boss", "BOSS直聘", "拉勾", "猎聘", "内推", "校园招聘", "牛客", "官网", "脉脉", "LinkedIn"];
const POSITIONS = ["后端", "前端", "算法", "大模型", "LLM", "NLP", "推荐", "搜索", "数据分析", "测试", "产品", "运营", "Java", "Python", "Go", "全栈"];
const REQUIRED_FIELDS = ["name", "phone", "position", "stage", "nextFollowUpAt"];

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[：]/g, ":")
    .replace(/[，]/g, ",")
    .replace(/[。]/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function findPhone(text) {
  const match = text.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/);
  if (match) return match[1];
  const masked = text.match(/(?:\+?86[-\s]?)?(1[*xX]{10})/);
  return masked ? masked[1] : "";
}

function findName(text) {
  const explicit = text.match(/(?:候选人|姓名|同学|学生|候选者)[:\s]*([\u4e00-\u9fa5]{2,4})/);
  if (explicit) return explicit[1];

  const compact = text.match(/^([\u4e00-\u9fa5]{2,4})[,，\s]/);
  if (compact) return compact[1];

  const beforePhone = text.match(/([\u4e00-\u9fa5]{2,4})[^0-9]{0,12}(?:\+?86[-\s]?)?1[3-9]\d{9}/);
  return beforePhone ? beforePhone[1] : "";
}

function findPosition(text) {
  const explicit = text.match(/(?:岗位|职位|投递|应聘)[:\s]*([\u4e00-\u9fa5A-Za-z0-9+\-/ ]{2,24})/);
  if (explicit) return cleanupValue(explicit[1]);

  const hit = POSITIONS.find((item) => text.toLowerCase().includes(item.toLowerCase()));
  if (!hit) return "";
  if (["Java", "Python", "Go"].includes(hit)) return `${hit} 后端`;
  if (hit === "LLM") return "大模型算法";
  return hit;
}

function findSource(text) {
  const explicit = text.match(/(?:来源|渠道)[:\s]*([\u4e00-\u9fa5A-Za-z0-9]+) ?/);
  if (explicit) return cleanupValue(explicit[1]);
  return SOURCES.find((source) => text.toLowerCase().includes(source.toLowerCase())) || "";
}

function findStage(text) {
  const lower = text.toLowerCase();
  const rejected = STAGES.find((stage) => stage.value === "rejected");
  if (rejected.keywords.some((kw) => lower.includes(kw.toLowerCase()))) return rejected;
  return STAGES.find((stage) => stage.keywords.some((kw) => lower.includes(kw.toLowerCase()))) || STAGES[8];
}

function findStatus(text) {
  const lower = text.toLowerCase();
  const hit = STATUS_KEYWORDS.find((item) => item.keywords.some((kw) => lower.includes(kw.toLowerCase())));
  return hit ? hit.value : "待反馈";
}

function findInterviewer(text) {
  const match = text.match(/(?:面试官|面试人|面试老师)[:\s]*([\u4e00-\u9fa5A-Za-z]{1,12})/);
  if (match) return cleanupValue(match[1]);

  const teacher = text.match(/([\u4e00-\u9fa5]{1,4}(?:老师|同学|总|经理))/);
  return teacher ? teacher[1] : "";
}

function findDate(text) {
  const now = new Date();
  const monthDay = text.match(/(\d{1,2})[\/月.-](\d{1,2})(?:日|号)?/);
  if (monthDay) {
    const year = now.getFullYear();
    return `${year}-${pad(monthDay[1])}-${pad(monthDay[2])}`;
  }

  const iso = text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

  if (/下周一/.test(text)) return nextWeekday(now, 1);
  if (/下周二/.test(text)) return nextWeekday(now, 2);
  if (/下周三/.test(text)) return nextWeekday(now, 3);
  if (/下周四/.test(text)) return nextWeekday(now, 4);
  if (/下周五/.test(text)) return nextWeekday(now, 5);
  if (/明天/.test(text)) return formatDate(addDays(now, 1));
  if (/后天/.test(text)) return formatDate(addDays(now, 2));
  if (/今天/.test(text)) return formatDate(now);
  return "";
}

function cleanupValue(value) {
  return String(value || "")
    .split(/[,，.。；;]/)[0]
    .replace(/(候选人|电话|手机|来源|渠道|阶段|状态)$/g, "")
    .trim();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextWeekday(date, weekday) {
  const current = date.getDay() || 7;
  const diff = 7 - current + weekday;
  return formatDate(addDays(date, diff));
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function scoreCandidate(candidate) {
  const filled = REQUIRED_FIELDS.filter((field) => candidate[field]);
  const base = 0.3 + filled.length * 0.12;
  const bonus = candidate.source ? 0.06 : 0;
  return Math.min(0.92, Number((base + bonus).toFixed(2)));
}

function splitMessages(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [normalized];

  const chunks = [];
  let current = [];
  for (const line of lines) {
    const startsNew = /(?:候选人|姓名|同学|学生)[:\s]*[\u4e00-\u9fa5]{2,4}/.test(line) || /^[-*]\s*[\u4e00-\u9fa5]{2,4}/.test(line);
    if (startsNew && current.length) {
      chunks.push(current.join(" "));
      current = [];
    }
    current.push(line.replace(/^[-*]\s*/, ""));
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

function extractOne(rawText) {
  const text = normalizeText(rawText);
  const stage = findStage(text);
  const candidate = {
    id: "",
    name: findName(text),
    phone: findPhone(text),
    position: findPosition(text),
    source: findSource(text),
    stage: stage.value,
    stageLabel: stage.label,
    status: findStatus(text),
    interviewer: findInterviewer(text),
    nextFollowUpAt: findDate(text),
    notes: text,
    confidence: 0,
    missingFields: [],
    updatedAt: new Date().toISOString()
  };

  candidate.missingFields = REQUIRED_FIELDS.filter((field) => !candidate[field]);
  candidate.confidence = scoreCandidate(candidate);
  return candidate;
}

function extractCandidatesByRules(text) {
  return splitMessages(text).map(extractOne);
}

if (typeof module !== "undefined") {
  module.exports = {
    STAGES,
    extractCandidatesByRules
  };
}

if (typeof window !== "undefined") {
  window.RecruitRuleExtractor = {
    STAGES,
    extractCandidatesByRules
  };
}
