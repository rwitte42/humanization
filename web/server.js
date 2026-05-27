import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const publicDir = path.join(__dirname, "public");
const env = loadEnv(path.join(__dirname, ".env"));
const PORT = Number(process.env.PORT || env.PORT || 8787);
const OPENAI_MODEL = process.env.OPENAI_MODEL || env.OPENAI_MODEL || "gpt-5.1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
const MAX_URL_BYTES = 900_000;
const OPENAI_ANALYZE_TIMEOUT_MS = readPositiveNumberEnv("OPENAI_ANALYZE_TIMEOUT_MS", 90_000);
const OPENAI_ANALYZE_MAX_ATTEMPTS = Math.min(
  3,
  Math.max(1, readPositiveNumberEnv("OPENAI_ANALYZE_MAX_ATTEMPTS", 3)),
);
const MODEL_CACHE_TTL_MS = readPositiveNumberEnv("MODEL_CACHE_TTL_MS", 15 * 60_000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const skillContext = await loadSkillContext();
let modelCache = null;

function readPositiveNumberEnv(name, fallback) {
  const value = Number(process.env[name] || env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        configured: Boolean(OPENAI_API_KEY),
        model: OPENAI_MODEL,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/models") {
      return handleModels(res);
    }

    if (req.method === "POST" && url.pathname === "/api/extract-url") {
      const payload = await readJson(req);
      return handleExtractUrl(res, payload);
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const payload = await readJson(req);
      return handleAnalyze(req, res, payload);
    }

    if (req.method === "GET") {
      return serveStatic(req, res, url.pathname);
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Humanization app running at http://localhost:${PORT}`);
});

async function handleAnalyze(req, res, payload) {
  if (!OPENAI_API_KEY) {
    return sendJson(res, 503, {
      error: "Missing OPENAI_API_KEY. Add your key to .env, then restart the server.",
    });
  }

  const text = String(payload?.text || "").trim();
  const mode = payload?.mode === "author" ? "author" : "reviewer";
  const genre = String(payload?.genre || "").trim() || "Unspecified";
  const audience = String(payload?.audience || "").trim() || "Unspecified";
  const requestedModel = normalizeModelId(payload?.model) || OPENAI_MODEL;

  if (text.length < 40) {
    return sendJson(res, 400, {
      error: "Paste a longer sample so the analysis has enough signal to inspect.",
    });
  }

  const instructions = buildInstructions(mode, genre, audience);
  const clientAbort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) clientAbort.abort();
  });

  let response;
  let data;
  try {
    ({ response, data } = await fetchOpenAIAnalysis(
      {
        model: requestedModel,
        instructions,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Analyze this text:\n\n${text}`,
              },
            ],
          },
        ],
      },
      clientAbort.signal,
    ));
  } catch (error) {
    if (clientAbort.signal.aborted) return;
    const timedOut = error.name === "TimeoutError";
    return sendJson(res, timedOut ? 504 : 502, {
      error: timedOut
        ? "OpenAI analysis timed out after retrying. Try a shorter sample or a faster model."
        : "OpenAI request failed after retrying.",
    });
  }

  if (!response.ok) {
    return sendJson(res, response.status, {
      error: data?.error?.message || "OpenAI request failed.",
    });
  }

  sendJson(res, 200, {
    model: requestedModel,
    analysis: parseAnalysis(extractText(data)),
    output: extractText(data),
  });
}

async function handleModels(res) {
  if (!OPENAI_API_KEY) {
    return sendJson(res, 200, {
      configured: false,
      defaultModel: OPENAI_MODEL,
      models: [OPENAI_MODEL],
    });
  }

  if (modelCache && Date.now() - modelCache.checkedAt < MODEL_CACHE_TTL_MS) {
    return sendJson(res, 200, modelCache.payload);
  }

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return sendJson(res, response.status, {
      error: data?.error?.message || "Unable to fetch OpenAI models.",
      defaultModel: OPENAI_MODEL,
      models: [OPENAI_MODEL],
    });
  }

  const models = (data?.data || [])
    .map((model) => model?.id)
    .filter(isUsefulTextModel)
    .sort(compareModels);

  if (!models.includes(OPENAI_MODEL)) {
    models.unshift(OPENAI_MODEL);
  }

  const payload = {
    configured: true,
    defaultModel: OPENAI_MODEL,
    models,
  };
  modelCache = { checkedAt: Date.now(), payload };
  sendJson(res, 200, payload);
}

async function handleExtractUrl(res, payload) {
  const rawUrl = String(payload?.url || "").trim();
  let target;

  try {
    target = new URL(rawUrl);
  } catch {
    return sendJson(res, 400, { error: "Enter a valid URL." });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return sendJson(res, 400, { error: "URL must start with http:// or https://." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "HumanizationStudio/0.1 (+https://github.com/rwitte42/humanization)",
        Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.6",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return sendJson(res, response.status, {
        error: `URL returned HTTP ${response.status}.`,
      });
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await readResponseWithLimit(response, MAX_URL_BYTES);
    const title = extractTitle(body);
    const text = contentType.includes("html") ? htmlToText(body) : body.trim();

    if (!text || text.length < 40) {
      return sendJson(res, 422, {
        error: "Could not extract enough readable text from that URL.",
      });
    }

    sendJson(res, 200, {
      title,
      text,
      sourceUrl: target.toString(),
      contentType,
    });
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? "Timed out while fetching that URL."
        : "Could not fetch that URL.";
    sendJson(res, 502, { error: message });
  } finally {
    clearTimeout(timeout);
  }
}

function buildInstructions(mode, genre, audience) {
  const task =
    mode === "author"
      ? "Operate in author mode. Provide an explainable assessment plus prioritized, voice-preserving humanization guidance."
      : "Operate in reviewer mode. Provide a neutral, forensic authorship assessment without rewrite guidance unless needed to explain the evidence.";

  return [
    "You are using the AI Authorship Analysis skill embedded below.",
    "This is not a binary detector and must not produce a probability score or certainty claim.",
    "Quote short evidence from the submitted text, name the signal, include counter-evidence, and calibrate confidence.",
    "Use one of these classifications: Likely human-written, Likely AI-generated, Hybrid / AI-assisted, Insufficient signal.",
    `Mode: ${mode}. ${task}`,
    `Genre/context: ${genre}. Audience/context: ${audience}.`,
    "Keep the response practical, readable, and evidence-led.",
    "Return only valid JSON with this shape:",
    JSON.stringify(analysisContract(), null, 2),
    "For reviewer mode, make reviewer_notes detailed and forensic, and leave guidance arrays empty.",
    "For author mode, include guidance.keep, guidance.priorities, and guidance.rewrites. Keep reviewer_notes shorter.",
    "Skill reference:",
    skillContext,
  ].join("\n\n");
}

function analysisContract() {
  return {
    classification: "Likely human-written | Likely AI-generated | Hybrid / AI-assisted | Insufficient signal",
    confidence: "High | Moderate | Low",
    confidence_rationale: "One sentence explaining what drives confidence.",
    executive_summary: "Two to three sentences with the bottom-line read.",
    context_notes: ["Genre, sample length, false-positive, or audience caveats."],
    evidence: [
      {
        signal: "Named signal from the taxonomy",
        category: "Linguistic | Structural | Narrative/content | Human-positive",
        direction: "AI-leaning | Human-leaning | Ambiguous",
        reliability: "Strong | Moderate | Weak/noisy",
        excerpt: "Short verbatim excerpt from the submitted text",
        read: "One sentence explaining why this signal matters.",
      },
    ],
    counter_evidence: [
      {
        point: "Counter-signal or innocent explanation",
        excerpt: "Optional short excerpt",
        read: "Why this limits the assessment.",
      },
    ],
    section_map: [
      {
        section: "Opening | middle | close | named section",
        assessment: "Human-leaning | AI-leaning | Hybrid | Insufficient signal",
        notes: "What changes by section.",
      },
    ],
    reviewer_notes: {
      risk_level: "Low | Medium | High | Not applicable",
      strongest_case: "Best argument for the classification.",
      weakest_case: "Best argument against the classification.",
      what_would_change: "What evidence would change the read.",
      next_questions: ["Question a reviewer would ask before relying on this assessment."],
    },
    guidance: {
      keep: ["Human signals or voice features worth preserving."],
      priorities: [
        {
          title: "Specific improvement area",
          rationale: "Why this matters for authenticity.",
          action: "Concrete edit to make.",
        },
      ],
      rewrites: [
        {
          before: "Short original excerpt",
          after: "Voice-preserving revision",
          note: "What changed and why.",
        },
      ],
      closing_note: "Short coaching note.",
    },
  };
}

function parseAnalysis(output) {
  try {
    return JSON.parse(output);
  } catch {
    const match = output.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim() || "No text output returned.";
}

function normalizeModelId(model) {
  const value = String(model || "").trim();
  if (!value || value.length > 100) return "";
  return /^[a-zA-Z0-9._:-]+$/.test(value) ? value : "";
}

function isUsefulTextModel(modelId) {
  if (!modelId) return false;

  const id = modelId.toLowerCase();
  const excluded = [
    "audio",
    "babbage",
    "chatgpt",
    "codex",
    "dall-e",
    "davinci",
    "deep-research",
    "embedding",
    "image",
    "moderation",
    "realtime",
    "search",
    "sora",
    "tts",
    "transcribe",
    "whisper",
  ];

  if (excluded.some((part) => id.includes(part))) return false;

  return (
    id.startsWith("gpt-") ||
    id.startsWith("o1") ||
    id.startsWith("o3") ||
    id.startsWith("o4")
  );
}

function compareModels(a, b) {
  const rank = (id) => {
    const normalized = id.toLowerCase();
    if (normalized === OPENAI_MODEL.toLowerCase()) return 0;
    if (normalized.includes("mini")) return 1;
    if (normalized.startsWith("gpt-5")) return 2;
    if (normalized.startsWith("gpt-4.1")) return 3;
    if (normalized.startsWith("o")) return 4;
    return 5;
  };

  return rank(a) - rank(b) || a.localeCompare(b);
}

async function fetchOpenAIAnalysis(payload, externalSignal) {
  let lastError = null;
  let lastResponse = null;
  let lastData = null;

  for (let attempt = 1; attempt <= OPENAI_ANALYZE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify(payload),
        },
        OPENAI_ANALYZE_TIMEOUT_MS,
        externalSignal,
      );
      const data = await response.json().catch(() => ({}));

      if (response.ok || !isRetryableOpenAIStatus(response.status) || attempt === OPENAI_ANALYZE_MAX_ATTEMPTS) {
        return { response, data };
      }

      lastResponse = response;
      lastData = data;
    } catch (error) {
      lastError = error;
      if (externalSignal?.aborted || !isRetryableOpenAIError(error) || attempt === OPENAI_ANALYZE_MAX_ATTEMPTS) {
        throw error;
      }
    }

    await sleep(400 * attempt);
  }

  if (lastResponse) return { response: lastResponse, data: lastData || {} };
  throw lastError || new Error("OpenAI request failed.");
}

async function fetchWithTimeout(url, init, timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromExternalSignal = () => controller.abort();

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error("Request timed out.");
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

function isRetryableOpenAIStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableOpenAIError(error) {
  return error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponseWithLimit(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    size += value.byteLength;
    if (size > limit) {
      throw new Error("URL content is too large to import.");
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(concatUint8(chunks, size));
}

function concatUint8(chunks, size) {
  const merged = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]).trim().replace(/\s+/g, " ") : "";
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|header|footer|main|li|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === "#") {
      const numeric =
        code[1]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
    }

    return named[code.toLowerCase()] || entity;
  });
}

async function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    if (shouldServeIndexFallback(req, pathname)) {
      const fallback = await readFile(path.join(publicDir, "index.html"));
      res.writeHead(200, { "Content-Type": contentTypes[".html"] });
      return res.end(fallback);
    }
    sendJson(res, 404, { error: "Not found" });
  }
}

function shouldServeIndexFallback(req, pathname) {
  if (pathname.startsWith("/api/")) return false;
  if (path.extname(pathname)) return false;
  const accept = req.headers.accept || "";
  return accept.includes("text/html") || accept.includes("*/*");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_200_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
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

async function loadSkillContext() {
  const files = [
    "SKILL.md",
    "references/signal-taxonomy.md",
    "references/humanization-playbook.md",
  ];

  const parts = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(path.join(repoRoot, file), "utf8");
      return `--- ${file} ---\n${content}`;
    }),
  );

  return parts.join("\n\n");
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const values = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;

    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
