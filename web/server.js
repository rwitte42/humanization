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

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const skillContext = await loadSkillContext();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        configured: Boolean(OPENAI_API_KEY),
        model: OPENAI_MODEL,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const payload = await readJson(req);
      return handleAnalyze(res, payload);
    }

    if (req.method === "GET") {
      return serveStatic(res, url.pathname);
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

async function handleAnalyze(res, payload) {
  if (!OPENAI_API_KEY) {
    return sendJson(res, 503, {
      error: "Missing OPENAI_API_KEY. Add your key to .env, then restart the server.",
    });
  }

  const text = String(payload?.text || "").trim();
  const mode = payload?.mode === "author" ? "author" : "reviewer";
  const genre = String(payload?.genre || "").trim() || "Unspecified";
  const audience = String(payload?.audience || "").trim() || "Unspecified";

  if (text.length < 40) {
    return sendJson(res, 400, {
      error: "Paste a longer sample so the analysis has enough signal to inspect.",
    });
  }

  const instructions = buildInstructions(mode, genre, audience);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return sendJson(res, response.status, {
      error: data?.error?.message || "OpenAI request failed.",
    });
  }

  sendJson(res, 200, {
    model: OPENAI_MODEL,
    output: extractText(data),
  });
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
    "Skill reference:",
    skillContext,
  ].join("\n\n");
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

async function serveStatic(res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, cleanPath));

  if (!filePath.startsWith(publicDir)) {
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
    const fallback = await readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": contentTypes[".html"] });
    res.end(fallback);
  }
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
