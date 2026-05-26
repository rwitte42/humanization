# Humanization

A skill for evaluating whether writing reads as human-authored, AI-generated, or human–AI collaborative — and for improving AI-assisted drafts without sanding away the author’s voice.

This repository contains the **AI Authorship Analysis** skill, its supporting reference material, and a small Node web app for running the workflow locally or behind Caddy on Bag End. The skill is designed for careful editorial reasoning, not for automated accusation or score-based AI detection.

## What this skill does

The skill helps an assistant or reviewer:

- assess written content for likely human, AI-generated, or hybrid authorship signals;
- explain the evidence behind that assessment in plain language;
- identify where a piece carries human specificity, voice, and stakes;
- identify where a piece has machine residue, such as generic abstraction, mechanical structure, or over-smoothed connective tissue;
- provide practical, voice-preserving guidance for making user-owned drafts read more authentically human.

It classifies work as one of four outcomes:

- **Likely human-written**
- **Likely AI-generated**
- **Hybrid / AI-assisted**
- **Insufficient signal**

The fourth outcome matters. Short samples, heavily constrained genres, polished house styles, and non-native English writing can all look deceptively “AI-like.” The skill is built to name uncertainty rather than force a verdict.

## What this skill is not

This is **not an AI detector**.

It does not produce a probability score, a percentage, or a claim of certainty. Score-based detectors are unreliable in high-stakes authorship contexts and can create harmful false positives, especially for skilled formal writers, non-native English writers, and people writing within constrained professional genres.

Instead, this skill uses a signal-based editorial method:

1. observe concrete signals in the text;
2. quote the evidence;
3. consider innocent explanations;
4. weigh clusters of signals rather than isolated “tells”;
5. produce a calibrated assessment with caveats.

The reasoning is the product. A label without evidence is a failure mode.

## How it works

The core workflow is defined in [`SKILL.md`](SKILL.md). It has two operating modes.

### Reviewer mode

Use reviewer mode when the user wants an authorship assessment of a piece they may not own or may not have authored.

The output is neutral and forensic:

- classification;
- confidence level;
- strongest evidence, with quoted examples;
- counter-evidence and caveats;
- section-level notes if the piece appears hybrid.

Reviewer mode avoids editorializing about quality unless the user explicitly asks for that.

### Author mode

Use author mode when the user owns the draft and wants it to read as more credible, specific, and human.

Author mode includes the same authorship assessment, plus prioritized humanization guidance. The goal is not to disguise provenance or apply generic “good writing” rules. The goal is to restore what AI tends to lack and what real authors can supply:

- specificity;
- stance;
- stakes;
- lived or operational detail;
- unevenness where it carries voice;
- authorial judgment.

The skill protects passages that are already working. Humanization should remove machine residue, not overwrite the author’s fingerprints.

## Reference materials

The skill relies on two reference documents in [`references/`](references/):

- [`references/signal-taxonomy.md`](references/signal-taxonomy.md) — a catalog of linguistic, structural, narrative, and human-positive authorship signals, including reliability ratings and false-positive guards.
- [`references/humanization-playbook.md`](references/humanization-playbook.md) — a set of author-mode rewrite patterns for restoring specificity, stance, structure, rhythm, and voice.

These references are intentionally separate from the main skill file. The skill defines the operating workflow; the references provide the deeper reasoning catalog and transformation patterns.

## Design principles

### Evidence over verdict

The skill must show its work. Every meaningful assessment should point to named signals and quote the text that produced them.

### Clusters over tells

No single feature proves AI authorship. An em dash, a polished sentence, a formal tone, or a word like “delve” is not meaningful by itself. The skill looks for converging patterns across language, structure, and content.

### Calibrated humility

Some texts do not carry enough signal. Some genres require formality. Some writers naturally produce polished, structured prose. The skill is expected to say when evidence is thin or conflicting.

### False-positive resistance

The taxonomy explicitly guards against common false positives: ESL patterns, house style, genre constraints, clean editing, and over-weighting superficial punctuation or diction.

### Specificity, stance, and stakes

The humanization playbook is organized around the highest-leverage human signals. Surface edits come last. A draft with real detail and a real point of view reads more human than a perfectly polished generic draft.

### Voice preservation

The skill should not homogenize writing into a generic professional voice. It should identify and preserve the author’s strongest human signals, including useful roughness, asymmetry, and idiosyncrasy.

### Ethical authorship support

There is a difference between improving AI-assisted writing and helping someone evade a disclosure obligation. The skill supports authentic editorial improvement. It should not be used to misrepresent authorship in academic, journalistic, regulatory, contractual, or other contexts where provenance disclosure is required.

## Repository structure

```text
.
├── SKILL.md
├── ai-authorship-analysis.skill
├── README.md
├── web/
│   ├── public/
│   │   ├── app.js
│   │   ├── index.html
│   │   └── styles.css
│   ├── .env.example
│   ├── package.json
│   └── server.js
└── references/
    ├── humanization-playbook.md
    └── signal-taxonomy.md
```

## Web app

The web app lives under `web/` as a standalone dependency-free Node server. It serves the UI from `web/public/`, reads the skill/reference files from the repository root, and calls the OpenAI Responses API from the server side. Keep the API key in `web/.env`; do not put it in browser code.

1. Copy or edit the local environment file:

   ```sh
   cd web
   cp .env.example .env
   ```

1. Add your OpenAI API key:

   ```sh
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-5.1
   PORT=8787
   ```

1. Start the app:

   ```sh
   npm run dev
   ```

1. Open `http://localhost:8787`.

For Bag End via Caddy, run the Node app on its configured local port and proxy the desired route or hostname to it:

```caddyfile
humanization.localhost {
    reverse_proxy 127.0.0.1:8787
}
```

The app exposes:

- `GET /api/config` — reports whether the server sees an API key.
- `POST /api/analyze` — runs reviewer or author-mode analysis against the submitted text.

Reviewer mode returns a structured forensic memo: classification, confidence rationale, evidence cards, counter-evidence, section map, and reviewer reliance questions. Author mode uses the same signal analysis but adds coaching: what to keep, priority fixes, and before/after rewrite examples.

The app can analyze pasted text, locally imported text-like documents (`.txt`, Markdown, HTML, CSV, JSON, and RTF), or text extracted from a URL. It also includes a light/dark theme toggle and a model picker populated from the OpenAI models available to the configured API key, filtered to general text/reasoning models useful for this workflow.
