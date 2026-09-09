
(function () {
  "use strict";

  // Classify a file by name: "pyproject" | "requirements" | "python"
  function fileKind(filename) {
    const base = filename.split("/").pop() || filename;
    if (/^pyproject\.toml$/i.test(base) || /\.toml$/i.test(base)) return "pyproject";
    if (/^requirements[^/]*\.txt$/i.test(base) || /\.txt$/i.test(base)) return "requirements";
    return "python";
  }

  // Pull the first code block out of an LLM response. Returns { code, rest }
  // rest = everything outside the block (used to surface NOTES)
  function extractCodeBlock(text) {
    // Match ```lang\n ... \n``` - take the first block regardless of language tag
    const block = /```[a-zA-Z0-9_+-]*\r?\n([\s\S]*?)\r?\n```/;
    const m = text.match(block);
    if (m) {
      const code = m[1];
      const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
      return { code, rest };
    }
    // Treat the whole thing as code
    return { code: text.trim(), rest: "" };
  }

  function extractNotes(rest) {
    if (!rest) return [];
    // Everything after a "NOTES:" marker
    const m = rest.match(/(^|\n)\s*NOTES:\s*/i);
    const body = m ? rest.slice(m.index + m[0].length) : rest;
    return body
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*]\s?/, "").trim())
      .filter((l) => l.length > 0);
  }

  async function convertOne(args) {
    const { base, key, model, filename, code, signal, installLevel, forwardThirdParty, mode } = args;
    const P = window.DUUI_PROMPT;

    const kind = fileKind(filename);

    // Rule-based (offline) path: no LLM, fully deterministic.
    if (mode === "algorithm") {
      const R = window.RuleConverter;
      let r;
      if (kind === "pyproject") r = R.convertPyproject(code);
      else if (kind === "requirements") r = R.convertRequirements(code);
      else r = R.convertPython(code, { installLevel, forwardThirdParty });
      return { code: r.code, notes: r.notes, unchanged: r.unchanged, raw: r.code };
    }

    let system;
    let user;
    if (kind === "pyproject") {
      system = P.PYPROJECT_SYSTEM_PROMPT;
      user = P.buildPyprojectMessage(filename, code);
    } else if (kind === "requirements") {
      system = P.REQUIREMENTS_SYSTEM_PROMPT;
      user = P.buildRequirementsMessage(filename, code);
    } else {
      system = P.buildSystemPrompt({ installLevel, forwardThirdParty });
      user = P.buildUserMessage(filename, code);
    }

    const raw = await window.OpenWebUI.chat(
      base,
      key,
      model,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { signal, temperature: 0 }
    );

    const { code: newCode, rest } = extractCodeBlock(raw);
    const notes = extractNotes(rest);
    const unchanged = newCode.trim() === code.trim();

    return { code: newCode, notes, unchanged, raw };
  }

  window.convertOne = convertOne;
  window.fileKind = fileKind;
})();
