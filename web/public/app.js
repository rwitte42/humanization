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

loadConfig();
updateModeChrome();
updateSampleStats();

form.addEventListener("input", (event) => {
  if (event.target.name === "text") updateSampleStats();
  if (event.target.name === "mode") updateModeChrome();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    mode: formData.get("mode"),
    genre: formData.get("genre"),
    audience: formData.get("audience"),
    text: formData.get("text"),
  };

  submitButton.disabled = true;
  resultTitle.textContent = "Reading the evidence";
  resultOutput.classList.remove("error");
  renderLoading(payload.mode);

  try {
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
  updateModeChrome();
  updateSampleStats();
  resultTitle.textContent = "Ready when you are";
  resultOutput.classList.remove("error");
  resultOutput.innerHTML = "";
  resultOutput.append(
    el("div", { className: "empty-state" }, [
      el("span", { className: "empty-mark", text: "H" }),
      el("p", { text: "Paste a sample, choose a lens, then run the analysis." }),
    ]),
  );
});

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
