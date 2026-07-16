const STRUCTURED_EXTRACTION_SCHEMA = {
  candidates: [
    {
      name: "候选人姓名，缺失时为空字符串",
      phone: "手机号，缺失时为空字符串",
      position: "应聘岗位",
      source: "招聘来源渠道",
      stage: "招聘阶段枚举值",
      stageLabel: "招聘阶段中文名",
      status: "当前状态，例如通过、待反馈、未通过、已放弃",
      interviewer: "面试官",
      nextFollowUpAt: "YYYY-MM-DD 格式的下次跟进或面试日期",
      notes: "保留原始关键信息摘要",
      confidence: "0 到 1 的置信度",
      missingFields: "缺失字段数组"
    }
  ]
};

function buildExtractionPrompt(text) {
  return [
    "你是招聘流程数据助理，请从企业微信群聊文本中抽取候选人结构化信息。",
    "必须只输出 JSON，不要输出 Markdown。",
    "如果一段文本中有多名候选人，请输出 candidates 数组。",
    "招聘阶段 stage 只能使用：resume_screen, first_interview, second_interview, hr_interview, offer, onboard, rejected, withdrawn, follow_up。",
    "日期统一转换成 YYYY-MM-DD；无法确定则为空字符串。",
    `输出结构示例：${JSON.stringify(STRUCTURED_EXTRACTION_SCHEMA)}`,
    "原始文本：",
    text
  ].join("\n");
}

async function extractCandidatesByLlm(text, config = {}) {
  const endpoint = config.endpoint || "https://api.openai.com/v1/chat/completions";
  const apiKey = config.apiKey || "";
  const model = config.model || "gpt-4.1-mini";

  if (!apiKey) {
    throw new Error("LLM extractor is configured but apiKey is missing.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你负责把招聘群聊自然语言转成严格 JSON。"
        },
        {
          role: "user",
          content: buildExtractionPrompt(text)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return Array.isArray(parsed.candidates) ? parsed.candidates : [];
}

module.exports = {
  buildExtractionPrompt,
  extractCandidatesByLlm
};
