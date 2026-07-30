const ENDPOINT = "https://api.deepseek.com/chat/completions";

async function postToDeepSeek(apiKey, payload, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.error?.message ? ` ${body.error.message}` : "";
      } catch {
        detail = "";
      }
      throw new Error(`DeepSeek rejected the request (${response.status}).${detail}`.trim());
    }
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("DeepSeek did not respond in time.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function validateDeepSeekKey(apiKey) {
  const key = String(apiKey ?? "").trim();
  if (!key) throw new Error("Enter a DeepSeek API key first.");
  const result = await postToDeepSeek(key, {
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "Reply with OK." }],
    thinking: { type: "disabled" },
    max_tokens: 2,
    temperature: 0,
    stream: false,
  });
  if (!result?.choices?.[0]?.message?.content) {
    throw new Error("DeepSeek accepted the key but returned an unexpected response.");
  }
  return true;
}

function normalizeReply(value, fallback) {
  const text = String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [text];
  return sentences.slice(0, 2).map((sentence) => sentence.trim()).join(" ").slice(0, 420) || fallback;
}

export async function adaptResponse({
  apiKey,
  template,
  messages,
  language = "en",
}) {
  const context = messages
    .slice(-10)
    .map((message) => `${message.author === "self" ? "Me" : "Sender"}: ${String(message.text).slice(0, 800)}`)
    .join("\n");
  const languageInstruction = language === "zh"
    ? "Write in natural workplace Chinese."
    : "Write in natural workplace English.";
  const result = await postToDeepSeek(apiKey, {
    model: "deepseek-v4-flash",
    thinking: { type: "disabled" },
    temperature: 0.45,
    max_tokens: 140,
    stream: false,
    messages: [
      {
        role: "system",
        content: [
          "Adapt the supplied acknowledgement template to the conversation.",
          "Always acknowledge and defer. Never answer the request.",
          "Do not make a deadline, promise, factual claim, approval, commitment, or recommendation.",
          "Use a casual, empathetic, workplace-appropriate corporate tone.",
          "Return plain text only, at most two sentences.",
          languageInstruction,
        ].join(" "),
      },
      {
        role: "user",
        content: `Template:\n${template}\n\nRecent conversation:\n${context}`,
      },
    ],
  });
  return normalizeReply(result?.choices?.[0]?.message?.content, template);
}
