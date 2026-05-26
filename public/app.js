const form = document.querySelector("#analysisForm");
const clearButton = document.querySelector("#clearButton");
const configStatus = document.querySelector("#configStatus");
const resultTitle = document.querySelector("#resultTitle");
const resultOutput = document.querySelector("#resultOutput");
const modelPill = document.querySelector("#modelPill");
const submitButton = form.querySelector("button[type='submit']");

loadConfig();

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
  resultOutput.textContent = "Checking signal clusters, counter-evidence, and false-positive risks...";

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
      payload.mode === "author" ? "Humanization guidance" : "Authorship assessment";
    resultOutput.textContent = data.output;
    modelPill.textContent = data.model;
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
  resultTitle.textContent = "Ready when you are";
  resultOutput.classList.remove("error");
  resultOutput.textContent =
    "Paste a sample, choose whether you want an audit or author-mode guidance, then run the analysis.";
});

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();

    modelPill.textContent = data.model || "Model pending";
    configStatus.textContent = data.configured
      ? "API key configured"
      : "Add OPENAI_API_KEY to .env";
    configStatus.classList.toggle("ready", Boolean(data.configured));
    configStatus.classList.toggle("missing", !data.configured);
  } catch {
    configStatus.textContent = "Config unavailable";
    configStatus.classList.add("missing");
  }
}
