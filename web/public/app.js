const form = document.querySelector("#analysisForm");
const clearButton = document.querySelector("#clearButton");
const configStatus = document.querySelector("#configStatus");
const resultTitle = document.querySelector("#resultTitle");
const resultOutput = document.querySelector("#resultOutput");
const modelPill = document.querySelector("#modelPill");
const submitButton = document.querySelector("#submitButton");
const submitLabel = document.querySelector("#submitLabel");
const textSample = document.querySelector("#textSample");
const wordCount = document.querySelector("#wordCount");
const charCount = document.querySelector("#charCount");
const signalDepth = document.querySelector("#signalDepth");
const modelSelect = document.querySelector("#modelSelect");
const themeToggle = document.querySelector("#themeToggle");
const themeIcon = document.querySelector("#themeIcon");
const sourceMeta = document.querySelector("#sourceMeta");
const fileInput = document.querySelector("#fileInput");
const urlInput = document.querySelector("#urlInput");
const fetchUrlButton = document.querySelector("#fetchUrlButton");
const sourcePanels = [...document.querySelectorAll("[data-source-panel]")];
const copyResultButton = document.querySelector("#copyResultButton");
let lastReportText = "";

loadConfig();
loadModels();
loadTheme();
updateModeChrome();
updateSourcePanel();
updateSampleStats();

form.addEventListener("input", (event) => {
  if (event.target.name === "text") updateSampleStats();
  if (event.target.name === "mode") updateModeChrome();
  if (event.target.name === "source") updateSourcePanel();
});

themeToggle.addEventListener("click", () => {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
  localStorage.setItem("humanization-theme", nextTheme);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const text = await readFileAsText(file);
    textSample.value = cleanImportedText(text, file.name);
    sourceMeta.textContent = `Imported ${file.name}`;
    updateSampleStats();
  } catch (error) {
    sourceMeta.textContent = error.message;
  }
});

fetchUrlButton.addEventListener("click", importUrl);
copyResultButton.addEventListener("click", copyReport);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    mode: formData.get("mode"),
    genre: formData.get("genre"),
    audience: formData.get("audience"),
    text: formData.get("text"),
    model: modelSelect.value,
  };

  submitButton.disabled = true;
  resultTitle.textContent = "Reading the evidence";
  resultOutput.classList.remove("error");
  renderLoading(payload.mode);

  try {
    if (!payload.text || payload.text.trim().length < 40) {
      throw new Error("Add a longer sample before running the analysis.");
    }

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Analysis failed.");
    }

    resultTitle.textContent =
      payload.mode === "author" ? "Author coaching" : "Reviewer memo";
    modelPill.textContent = data.model;
    renderAnalysis(data.analysis, data.output, payload.mode);
    lastReportText = buildReportText(data.analysis, data.output, payload.mode);
    copyResultButton.hidden = false;
  } catch (error) {
    resultTitle.textContent = "Needs attention";
    resultOutput.classList.add("error");
    resultOutput.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

clearButton.addEventListener("click", () => {
  form.reset();
  fileInput.value = "";
  urlInput.value = "";
  sourceMeta.textContent = "Manual paste";
  updateModeChrome();
  updateSourcePanel();
  updateSampleStats();
  resultTitle.textContent = "Ready when you are";
  lastReportText = "";
  copyResultButton.hidden = true;
  resultOutput.classList.remove("error");
  resultOutput.innerHTML = "";
  resultOutput.append(
    el("div", { className: "empty-state" }, [
      el("span", { className: "empty-mark", text: "H" }),
      el("p", { text: "Paste a sample, choose a lens, then run the analysis." }),
    ]),
  );
});

function updateSourcePanel() {
  const source = new FormData(form).get("source") || "paste";
  sourcePanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.sourcePanel === source);
  });

  if (source === "paste") sourceMeta.textContent = "Manual paste";
}

async function copyReport() {
  if (!lastReportText) return;

  await navigator.clipboard.writeText(lastReportText);
  const previous = copyResultButton.textContent;
  copyResultButton.textContent = "Copied";
  setTimeout(() => {
    copyResultButton.textContent = previous;
  }, 1400);
}

function buildReportText(analysis, rawOutput, mode) {
  if (!analysis) return rawOutput || "";

  const lines = [
    `${mode === "author" ? "Author Coaching" : "Reviewer Memo"}`,
    `Classification: ${analysis.classification || "Unclassified"}`,
    `Confidence: ${analysis.confidence || "Unclear"}`,
    "",
    analysis.executive_summary || "",
    analysis.confidence_rationale || "",
  ].filter((line) => line !== undefined);

  if (analysis.evidence?.length) {
    lines.push("", "Evidence");
    for (const item of analysis.evidence) {
      lines.push(`- ${item.signal}: ${item.read}`);
      if (item.excerpt) lines.push(`  Excerpt: ${item.excerpt}`);
    }
  }

  if (mode === "author" && analysis.guidance?.priorities?.length) {
    lines.push("", "Priorities");
    for (const item of analysis.guidance.priorities) {
      lines.push(`- ${item.title}: ${item.action}`);
    }
  }

  if (mode === "reviewer" && analysis.reviewer_notes) {
    lines.push("", "Reviewer Notes");
    lines.push(`Strongest case: ${analysis.reviewer_notes.strongest_case || ""}`);
    lines.push(`Weakest case: ${analysis.reviewer_notes.weakest_case || ""}`);
    lines.push(`Would change with: ${analysis.reviewer_notes.what_would_change || ""}`);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function updateModeChrome() {
  const mode = new FormData(form).get("mode");
  submitLabel.textContent =
    mode === "author" ? "Build author coaching" : "Build reviewer memo";
}

function updateSampleStats() {
  const text = textSample.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = text.length;

  wordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  charCount.textContent = `${chars} ${chars === 1 ? "character" : "characters"}`;

  if (chars < 40) {
    signalDepth.textContent = "Needs more signal";
    signalDepth.dataset.depth = "low";
  } else if (words < 150) {
    signalDepth.textContent = "Short sample";
    signalDepth.dataset.depth = "medium";
  } else {
    signalDepth.textContent = "Richer sample";
    signalDepth.dataset.depth = "high";
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();

    modelPill.textContent = data.model || "Model pending";
    configStatus.textContent = data.configured
      ? "API key configured"
      : "Add OPENAI_API_KEY to web/.env";
    configStatus.classList.toggle("ready", Boolean(data.configured));
    configStatus.classList.toggle("missing", !data.configured);
  } catch {
    configStatus.textContent = "Config unavailable";
    configStatus.classList.add("missing");
  }
}

async function loadModels() {
  try {
    const response = await fetch("/api/models");
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Model list unavailable.");

    modelSelect.innerHTML = "";
    for (const model of data.models || []) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      option.selected = model === data.defaultModel;
      modelSelect.append(option);
    }

    if (!modelSelect.options.length) {
      const option = document.createElement("option");
      option.value = data.defaultModel || "";
      option.textContent = data.defaultModel || "No models found";
      modelSelect.append(option);
    }
  } catch (error) {
    modelSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Using .env model";
    modelSelect.append(option);
    sourceMeta.textContent = error.message;
  }
}

function loadTheme() {
  const savedTheme = localStorage.getItem("humanization-theme");
  const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  setTheme(savedTheme || preferredTheme);
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  themeIcon.textContent = theme === "dark" ? "☾" : "◐";
}

async function importUrl() {
  const url = urlInput.value.trim();
  if (!url) {
    sourceMeta.textContent = "Enter a URL to import.";
    return;
  }

  fetchUrlButton.disabled = true;
  sourceMeta.textContent = "Fetching URL...";

  try {
    const response = await fetch("/api/extract-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Unable to import URL.");

    textSample.value = data.text;
    sourceMeta.textContent = data.title
      ? `Imported ${data.title}`
      : `Imported ${data.sourceUrl}`;
    updateSampleStats();
  } catch (error) {
    sourceMeta.textContent = error.message;
  } finally {
    fetchUrlButton.disabled = false;
  }
}

function readFileAsText(file) {
  const supported =
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|html|htm|csv|json|rtf)$/i.test(file.name);

  if (!supported) {
    return Promise.reject(
      new Error("Use a readable text-like file: TXT, Markdown, HTML, CSV, JSON, or RTF."),
    );
  }

  if (file.size > 900_000) {
    return Promise.reject(new Error("File is too large for this first-pass importer."));
  }

  return file.text();
}

function cleanImportedText(text, filename) {
  if (/\.(html|htm)$/i.test(filename)) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    return doc.body.textContent.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  if (/\.rtf$/i.test(filename)) {
    return text
      .replace(/\\'[0-9a-f]{2}/gi, " ")
      .replace(/[{}]/g, " ")
      .replace(/\\[a-z]+\d*\s?/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return text.trim();
}

function renderLoading(mode) {
  resultOutput.innerHTML = "";
  resultOutput.append(
    el("div", { className: "loading-card" }, [
      el("span", { className: "loader" }),
      el("div", {}, [
        el("strong", {
          text: mode === "author" ? "Building coaching notes" : "Building reviewer brief",
        }),
        el("p", {
          text:
            mode === "author"
              ? "Separating what to keep from what needs more specificity, stance, and stakes."
              : "Checking signal clusters, counter-evidence, and false-positive risks.",
        }),
      ]),
    ]),
  );
}

function renderAnalysis(analysis, rawOutput, mode) {
  resultOutput.innerHTML = "";
  resultOutput.classList.remove("error");

  if (!analysis) {
    resultOutput.append(el("pre", { className: "raw-output", text: rawOutput }));
    return;
  }

  const overview = el("section", { className: "assessment-card overview-card" }, [
    el("div", { className: "verdict-row" }, [
      el("span", {
        className: `verdict-chip ${classificationClass(analysis.classification)}`,
        text: analysis.classification || "Unclassified",
      }),
      el("span", {
        className: `confidence-chip ${confidenceClass(analysis.confidence)}`,
        text: `${analysis.confidence || "Unclear"} confidence`,
      }),
    ]),
    el("p", { className: "summary", text: analysis.executive_summary || rawOutput }),
    analysis.confidence_rationale
      ? el("p", { className: "rationale", text: analysis.confidence_rationale })
      : null,
  ]);

  resultOutput.append(overview);
  appendContextNotes(analysis.context_notes);
  appendEvidence(analysis.evidence);

  if (mode === "reviewer") {
    appendReviewerNotes(analysis.reviewer_notes);
    appendCounterEvidence(analysis.counter_evidence);
    appendSectionMap(analysis.section_map);
  } else {
    appendGuidance(analysis.guidance);
    appendCounterEvidence(analysis.counter_evidence);
    appendSectionMap(analysis.section_map);
  }
}

function appendContextNotes(notes = []) {
  const clean = notes.filter(Boolean);
  if (!clean.length) return;

  resultOutput.append(
    el("section", { className: "assessment-card note-strip" }, [
      ...clean.map((note) => el("span", { text: note })),
    ]),
  );
}

function appendEvidence(evidence = []) {
  const clean = evidence.filter(Boolean);
  if (!clean.length) return;

  resultOutput.append(
    el("section", { className: "assessment-card" }, [
      sectionHeading("Evidence"),
      el(
        "div",
        { className: "evidence-grid" },
        clean.map((item) =>
          el("article", { className: "signal-card" }, [
            el("div", { className: "signal-meta" }, [
              el("span", { text: item.category || "Signal" }),
              el("span", { text: item.reliability || "Unrated" }),
            ]),
            el("h3", { text: item.signal || "Observed signal" }),
            item.excerpt ? el("blockquote", { text: item.excerpt }) : null,
            el("p", { text: item.read || "" }),
            el("span", {
              className: `direction ${directionClass(item.direction)}`,
              text: item.direction || "Ambiguous",
            }),
          ]),
        ),
      ),
    ]),
  );
}

function appendReviewerNotes(notes = {}) {
  if (!notes || !Object.keys(notes).length) return;

  const rows = [
    ["Risk level", notes.risk_level],
    ["Strongest case", notes.strongest_case],
    ["Weakest case", notes.weakest_case],
    ["Would change with", notes.what_would_change],
  ].filter(([, value]) => value);

  resultOutput.append(
    el("section", { className: "assessment-card reviewer-card" }, [
      sectionHeading("Reviewer Brief"),
      el(
        "div",
        { className: "reviewer-grid" },
        rows.map(([label, value]) =>
          el("div", { className: "reviewer-item" }, [
            el("span", { text: label }),
            el("p", { text: value }),
          ]),
        ),
      ),
      notes.next_questions?.length
        ? el("div", { className: "question-list" }, [
            el("h3", { text: "Questions before relying on it" }),
            el(
              "ul",
              {},
              notes.next_questions.map((question) => el("li", { text: question })),
            ),
          ])
        : null,
    ]),
  );
}

function appendGuidance(guidance = {}) {
  if (!guidance || !Object.keys(guidance).length) return;

  const hasGuidance =
    guidance.keep?.length || guidance.priorities?.length || guidance.rewrites?.length;
  if (!hasGuidance) return;

  resultOutput.append(
    el("section", { className: "assessment-card guidance-card" }, [
      sectionHeading("Author Coaching"),
      guidance.keep?.length
        ? el("div", { className: "keep-list" }, [
            el("h3", { text: "Keep" }),
            el(
              "ul",
              {},
              guidance.keep.map((item) => el("li", { text: item })),
            ),
          ])
        : null,
      guidance.priorities?.length
        ? el(
            "div",
            { className: "priority-stack" },
            guidance.priorities.map((priority, index) =>
              el("article", { className: "priority-card" }, [
                el("span", { text: `Priority ${index + 1}` }),
                el("h3", { text: priority.title || "Revision priority" }),
                el("p", { text: priority.rationale || "" }),
                el("strong", { text: priority.action || "" }),
              ]),
            ),
          )
        : null,
      guidance.rewrites?.length
        ? el(
            "div",
            { className: "rewrite-stack" },
            guidance.rewrites.map((rewrite) =>
              el("article", { className: "rewrite-card" }, [
                el("div", {}, [
                  el("span", { text: "Before" }),
                  el("p", { text: rewrite.before || "" }),
                ]),
                el("div", {}, [
                  el("span", { text: "After" }),
                  el("p", { text: rewrite.after || "" }),
                ]),
                rewrite.note ? el("em", { text: rewrite.note }) : null,
              ]),
            ),
          )
        : null,
      guidance.closing_note
        ? el("p", { className: "closing-note", text: guidance.closing_note })
        : null,
    ]),
  );
}

function appendCounterEvidence(counterEvidence = []) {
  const clean = counterEvidence.filter(Boolean);
  if (!clean.length) return;

  resultOutput.append(
    el("section", { className: "assessment-card" }, [
      sectionHeading("Counter-Evidence"),
      el(
        "div",
        { className: "counter-stack" },
        clean.map((item) =>
          el("article", { className: "counter-card" }, [
            el("h3", { text: item.point || "Caveat" }),
            item.excerpt ? el("blockquote", { text: item.excerpt }) : null,
            el("p", { text: item.read || "" }),
          ]),
        ),
      ),
    ]),
  );
}

function appendSectionMap(sectionMap = []) {
  const clean = sectionMap.filter(Boolean);
  if (!clean.length) return;

  resultOutput.append(
    el("section", { className: "assessment-card" }, [
      sectionHeading("Section Map"),
      el(
        "div",
        { className: "section-map" },
        clean.map((item) =>
          el("article", {}, [
            el("span", { text: item.section || "Section" }),
            el("strong", { text: item.assessment || "Unclear" }),
            el("p", { text: item.notes || "" }),
          ]),
        ),
      ),
    ]),
  );
}

function sectionHeading(text) {
  return el("div", { className: "section-heading" }, [
    el("h2", { text }),
  ]);
}

function classificationClass(classification = "") {
  const normalized = classification.toLowerCase();
  if (normalized.includes("ai-generated")) return "ai";
  if (normalized.includes("hybrid")) return "hybrid";
  if (normalized.includes("human")) return "human";
  return "unknown";
}

function confidenceClass(confidence = "") {
  const normalized = confidence.toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("moderate")) return "moderate";
  return "low";
}

function directionClass(direction = "") {
  const normalized = direction.toLowerCase();
  if (normalized.includes("ai")) return "ai";
  if (normalized.includes("human")) return "human";
  return "ambiguous";
}

function el(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);

  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;

  for (const child of children) {
    if (child) node.append(child);
  }

  return node;
}
