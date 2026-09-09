/*
 * rules.js - deterministic, offline converter (the "Algorithm" method).
 *
 * No LLM. Same job as the prompts, done with a small string scanner:
 *   - convertPython(code, {forwardThirdParty, installLevel}) -> { code, notes, unchanged }
 *   - convertPyproject(code)                                 -> { code, notes, unchanged }
 *   - convertRequirements(code)                              -> { code, notes, unchanged }
 *
 * The Python pass:
 *   - finds every builtin print(...) call (string/comment aware, balanced parens),
 *   - picks a helper by context: inside an except block -> log_error; warn/error wording or
 *     file=stderr -> log_warn/log_error; debug wording -> log_debug; otherwise log_info,
 *   - joins multi-argument prints into one message,
 *   - finds the FastAPI app variable ("app = FastAPI(...)") and adds add_logging()/install(),
 *   - adds only the imports that the resulting code actually uses.
 *
 * It is intentionally conservative: it never removes code and, when a print spans multiple
 * arguments, it uses a str()-join that is always valid Python (and flags it in the notes).
 */
(function () {
  "use strict";

  const VALID = ["DEBUG", "INFO", "WARNING", "ERROR"];
  const GIT_URL = "https://github.com/texttechnologylab/DUUIlogger";
  const UV_SOURCE_LINE = `duui-logging = { git = "${GIT_URL}" }`;
  const REQ_LINE = `duui-logging @ git+${GIT_URL}`;

  // ---- low level scanning helpers -----------------------------------------

  // src[i] is a quote. Return the index just past the end of the string literal.
  function skipString(src, i) {
    const q = src[i];
    if (src[i + 1] === q && src[i + 2] === q) {
      let j = i + 3;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === q && src[j + 1] === q && src[j + 2] === q) return j + 3;
        j++;
      }
      return src.length;
    }
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === "\\") { j += 2; continue; }
      if (src[j] === q) return j + 1;
      if (src[j] === "\n") return j; // unterminated single-line string; bail
      j++;
    }
    return src.length;
  }

  // src[openIdx] is one of ( [ { . Return the index of the matching close, or -1.
  function matchDelim(src, openIdx) {
    const open = src[openIdx];
    const close = open === "(" ? ")" : open === "[" ? "]" : "}";
    let depth = 0;
    let i = openIdx;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === "#") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === '"' || c === "'") { i = skipString(src, i); continue; }
      if (c === open) { depth++; i++; continue; }
      if (c === close) { depth--; if (depth === 0) return i; i++; continue; }
      i++;
    }
    return -1;
  }

  // Split a call's argument text on top-level commas (string/nesting aware).
  function splitArgs(s) {
    if (s.trim() === "") return [];
    const parts = [];
    let depth = 0;
    let i = 0;
    let last = 0;
    const n = s.length;
    while (i < n) {
      const c = s[i];
      if (c === "#") { while (i < n && s[i] !== "\n") i++; continue; }
      if (c === '"' || c === "'") { i = skipString(s, i); continue; }
      if (c === "(" || c === "[" || c === "{") { depth++; i++; continue; }
      if (c === ")" || c === "]" || c === "}") { depth--; i++; continue; }
      if (c === "," && depth === 0) { parts.push(s.slice(last, i)); last = i + 1; i++; continue; }
      i++;
    }
    parts.push(s.slice(last));
    return parts.map((p) => p.trim()).filter((p) => p !== "");
  }

  function classify(parts) {
    const positional = [];
    const kwargs = {};
    for (const p of parts) {
      const m = p.match(/^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/);
      if (m) kwargs[m[1]] = m[2].trim();
      else positional.push(p);
    }
    return { positional, kwargs };
  }

  function isStringLiteral(s) {
    return /^[rRbBuUfF]*['"]/.test(s.trim());
  }

  function buildLineStarts(code) {
    const arr = [0];
    for (let i = 0; i < code.length; i++) if (code[i] === "\n") arr.push(i + 1);
    return arr;
  }

  function lineIndexOf(starts, pos) {
    let lo = 0;
    let hi = starts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function posToLine(code, idx) {
    let c = 0;
    for (let i = 0; i < idx && i < code.length; i++) if (code[i] === "\n") c++;
    return c;
  }

  function stripComment(line) {
    let i = 0;
    const n = line.length;
    while (i < n) {
      const c = line[i];
      if (c === "#") return line.slice(0, i);
      if (c === '"' || c === "'") { i = skipString(line, i); continue; }
      i++;
    }
    return line;
  }

  // For every line, is it inside an except-block suite (stopping at def/class scopes)?
  function computeExceptLines(code) {
    const lines = code.split("\n");
    const res = new Array(lines.length).fill(false);
    const stack = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const indent = line.length - line.trimStart().length;
      while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
      let ie = false;
      for (let s = stack.length - 1; s >= 0; s--) {
        const kw = stack[s].kw;
        if (kw === "def" || kw === "class") { ie = false; break; }
        if (kw === "except") { ie = true; break; }
      }
      res[idx] = ie;
      const hm = line.match(/^\s*(async\s+def|def|class|if|elif|else|for|while|try|except|finally|with|match|case)\b/);
      if (hm) {
        const codePart = stripComment(line).trimEnd();
        if (codePart.endsWith(":")) {
          let kw = hm[1];
          if (/^async\s+def/.test(kw)) kw = "def";
          stack.push({ indent, kw });
        }
      }
    }
    return res;
  }

  // Find builtin print(...) calls. Skips strings/comments, attribute calls (x.print) and
  // "def print"/"class print". Returns [{ start, argStart, argEnd, end }] ascending.
  function findPrintCalls(src) {
    const calls = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === "#") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === '"' || c === "'") { i = skipString(src, i); continue; }
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j);
        if (word === "print") {
          let p = i - 1;
          while (p >= 0 && (src[p] === " " || src[p] === "\t")) p--;
          const prev = p >= 0 ? src[p] : "";
          let prevWord = "";
          if (prev && /[A-Za-z0-9_]/.test(prev)) {
            let ps = p;
            while (ps >= 0 && /[A-Za-z0-9_]/.test(src[ps])) ps--;
            prevWord = src.slice(ps + 1, p + 1);
          }
          if (prev !== "." && prevWord !== "def" && prevWord !== "class") {
            let k = j;
            while (k < n && (src[k] === " " || src[k] === "\t")) k++;
            if (src[k] === "(") {
              const close = matchDelim(src, k);
              if (close >= 0) {
                calls.push({ start: i, argStart: k + 1, argEnd: close, end: close + 1 });
                i = close + 1;
                continue;
              }
            }
          }
        }
        i = j;
        continue;
      }
      i++;
    }
    return calls;
  }

  function levelFor(inExcept, argsText, hasStderr) {
    const t = argsText.toLowerCase();
    if (inExcept) return "error";
    if (/\b(warn|warning|deprecat|careful|skipping|skip|fallback|fall back)\b/.test(t)) return "warn";
    if (hasStderr || /\b(error|fail|failed|failure|exception|traceback|crash|fatal)\b/.test(t)) return "error";
    if (/\b(debug|verbose)\b/.test(t)) return "debug";
    return "info";
  }

  // ---- python conversion --------------------------------------------------

  function replacePrints(code, forward, notes) {
    const inExcept = computeExceptLines(code);
    const starts = buildLineStarts(code);
    const calls = findPrintCalls(code);
    let converted = 0;
    let multi = 0;
    for (let ci = calls.length - 1; ci >= 0; ci--) {
      const call = calls[ci];
      const argsText = code.slice(call.argStart, call.argEnd);
      const { positional, kwargs } = classify(splitArgs(argsText));
      const hasStderr = kwargs.file && /stderr/.test(kwargs.file);
      const ie = inExcept[lineIndexOf(starts, call.start)] || false;
      const helper = "log_" + levelFor(ie, argsText, hasStderr);

      let msg;
      if (positional.length === 0) {
        msg = '""';
      } else if (positional.length === 1) {
        msg = positional[0];
      } else {
        const sep = kwargs.sep && isStringLiteral(kwargs.sep) ? kwargs.sep : '" "';
        msg = sep + ".join(str(_v) for _v in [" + positional.join(", ") + "])";
        multi++;
      }
      code = code.slice(0, call.start) + helper + "(" + msg + ")" + code.slice(call.end);
      converted++;
    }
    if (converted) notes.push("Converted " + converted + " print() call" + (converted === 1 ? "" : "s") + ".");
    else notes.push("No print() calls found to convert.");
    if (multi) notes.push(multi + " print() call" + (multi === 1 ? "" : "s") + " had multiple arguments; joined with str() - review the wording.");
    return code;
  }

  function wireUp(code, forward, level, notes) {
    const m = /^([ \t]*)([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/m.exec(code);
    if (!m) {
      if (!forward) return code;
      notes.push("No 'app = FastAPI(...)' found; skipped add_logging()/install() wiring.");
      return code;
    }
    const appName = m[2];
    const openIdx = m.index + m[0].length - 1; // the '(' after FastAPI
    const closeIdx = matchDelim(code, openIdx);
    if (closeIdx < 0) return code;
    const indent = m[1] || "";
    const hasAdd = /\bduui_logging\.add_logging\s*\(/.test(code);
    const hasInstall = /\bduui_logging\.install\s*\(/.test(code);

    const insertLines = [];
    if (!hasAdd) { insertLines.push(indent + "duui_logging.add_logging(" + appName + ")"); notes.push("Added duui_logging.add_logging(" + appName + ")."); }
    if (forward && !hasInstall) { insertLines.push(indent + "duui_logging.install(level=logging." + level + ")"); notes.push("Added duui_logging.install(level=logging." + level + ")."); }

    if (insertLines.length) {
      const lineIdx = posToLine(code, closeIdx);
      const lines = code.split("\n");
      lines.splice(lineIdx + 1, 0, ...insertLines);
      code = lines.join("\n");
    }
    if (forward && hasInstall) {
      const updated = code.replace(/(\bduui_logging\.install\s*\(\s*level\s*=\s*logging\.)\w+(\s*\))/, "$1" + level + "$2");
      if (updated !== code) { code = updated; notes.push("Set install(level=...) to logging." + level + "."); }
    }
    if (!forward && hasInstall) {
      const removed = code.replace(/^[ \t]*duui_logging\.install\s*\([^\n]*\)[ \t]*\n?/m, "");
      if (removed !== code) { code = removed; notes.push("Removed duui_logging.install(...) (forwarding off)."); }
    }
    return code;
  }

  function docstringEnd(lines) {
    let i = 0;
    if (lines[0] && lines[0].startsWith("#!")) i = 1;
    while (i < lines.length && (lines[i].trim() === "" || lines[i].trim().startsWith("#"))) i++;
    const t = lines[i] ? lines[i].trimStart() : "";
    const dm = t.match(/^[rRbBuUfF]*("""|''')/);
    if (dm) {
      const q = dm[1];
      if (t.slice(dm[0].length).includes(q)) return i + 1; // single-line docstring
      for (let j = i + 1; j < lines.length; j++) if (lines[j].includes(q)) return j + 1;
      return lines.length;
    }
    return i;
  }

  function ensureImports(code) {
    const helpers = new Set();
    const re = /\blog_(trace|debug|info|warn|warning|error|critical)\s*\(/g;
    let mm;
    while ((mm = re.exec(code))) helpers.add("log_" + mm[1]);
    const needDuui = /\bduui_logging\s*\./.test(code);
    const needLogging = /(^|[^.\w])logging\s*\./.test(code);

    const lines = code.split("\n");
    let fromIdx = -1;
    let existingNames = [];
    let hasDuui = false;
    let hasLogging = false;
    let firstImport = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      if (firstImport < 0 && /^\s*(import|from)\s/.test(t)) firstImport = i;
      const fm = t.match(/^\s*from\s+duui_logging\s+import\s+(.+?)\s*$/);
      if (fm) { fromIdx = i; existingNames = fm[1].split(",").map((s) => s.trim()).filter(Boolean); }
      if (/^\s*import\s+duui_logging\b/.test(t)) hasDuui = true;
      if (/^\s*import\s+logging\b/.test(t)) hasLogging = true;
    }

    const newLines = [];
    if (needLogging && !hasLogging) newLines.push("import logging");
    if (needDuui && !hasDuui) newLines.push("import duui_logging");
    if (helpers.size) {
      const order = ["log_trace", "log_debug", "log_info", "log_warn", "log_warning", "log_error", "log_critical"];
      const union = Array.from(new Set([...existingNames, ...helpers]));
      union.sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      const fromLine = "from duui_logging import " + union.join(", ");
      if (fromIdx >= 0) { lines[fromIdx] = fromLine; }
      else newLines.push(fromLine);
    }
    if (newLines.length === 0) return lines.join("\n");
    const insertAt = firstImport >= 0 ? firstImport : docstringEnd(lines);
    lines.splice(insertAt, 0, ...newLines);
    return lines.join("\n");
  }

  function convertPython(code, opts) {
    opts = opts || {};
    const level = VALID.includes(opts.installLevel) ? opts.installLevel : "INFO";
    const forward = opts.forwardThirdParty !== false;
    const notes = [];
    const original = code;

    code = replacePrints(code, forward, notes);
    code = wireUp(code, forward, level, notes);
    code = ensureImports(code);

    const unchanged = code === original;
    return { code, notes, unchanged };
  }

  // ---- pyproject.toml -----------------------------------------------------

  function addDependency(code, notes) {
    const m = /dependencies\s*=\s*\[/.exec(code);
    if (!m) { notes.push("No 'dependencies = [ ... ]' array found; did not add the dependency."); return code; }
    const openIdx = code.indexOf("[", m.index);
    const closeIdx = matchDelim(code, openIdx);
    if (closeIdx < 0) { notes.push("Could not parse the dependencies array."); return code; }
    const inner = code.slice(openIdx + 1, closeIdx);
    if (/["']duui[-_]logging/i.test(inner)) return code; // already there

    if (inner.includes("\n")) {
      // Insert as the FIRST item (avoids the "previous item needs a trailing comma" problem).
      const im = inner.match(/\n([ \t]+)\S/);
      const ind = im ? im[1] : "    ";
      const nl = code.indexOf("\n", openIdx);
      code = code.slice(0, nl + 1) + ind + '"duui-logging",\n' + code.slice(nl + 1);
    } else {
      const add = inner.trim() === "" ? '"duui-logging"' : ', "duui-logging"';
      code = code.slice(0, closeIdx) + add + code.slice(closeIdx);
    }
    notes.push('Added "duui-logging" to [project] dependencies.');
    return code;
  }

  function addUvSource(code, notes) {
    const hm = /^\[tool\.uv\.sources\][ \t]*$/m.exec(code);
    if (hm) {
      const secStart = hm.index + hm[0].length;
      const rest = code.slice(secStart);
      const nh = rest.search(/\n\[/);
      const secEnd = nh < 0 ? code.length : secStart + nh + 1;
      const section = code.slice(secStart, secEnd);
      if (/duui[-_]logging\s*=/.test(section)) return code; // already there
      code = code.slice(0, secStart) + "\n" + UV_SOURCE_LINE + code.slice(secStart);
      notes.push("Added duui-logging to [tool.uv.sources].");
      return code;
    }
    code = code.replace(/\s*$/, "") + "\n\n[tool.uv.sources]\n" + UV_SOURCE_LINE + "\n";
    notes.push("Added [tool.uv.sources] with duui-logging.");
    return code;
  }

  function convertPyproject(code) {
    const notes = [];
    const original = code;
    code = addDependency(code, notes);
    code = addUvSource(code, notes);
    const unchanged = code === original;
    if (unchanged) notes.unshift("Already wired up; no changes needed.");
    return { code, notes, unchanged };
  }

  // ---- requirements.txt ---------------------------------------------------

  function convertRequirements(code) {
    const notes = [];
    if (/duui[-_]logging/i.test(code) && /git\+/.test(code)) {
      return { code, notes: ["Already has the duui-logging git dependency."], unchanged: true };
    }
    const eol = code.includes("\r\n") ? "\r\n" : "\n";
    const lines = code.split(/\r?\n/);
    let trailingEmpty = false;
    if (lines.length && lines[lines.length - 1] === "") { lines.pop(); trailingEmpty = true; }

    const plainIdx = lines.findIndex((l) => /^\s*duui[-_]logging\s*($|[=<>!~; @])/i.test(l) && !/git\+/.test(l));
    if (plainIdx >= 0) { lines[plainIdx] = REQ_LINE; notes.push("Replaced the plain duui-logging line with the git dependency."); }
    else { lines.push(REQ_LINE); notes.push("Added the duui-logging git dependency line."); }

    let out = lines.join(eol);
    if (trailingEmpty) out += eol;
    return { code: out, notes, unchanged: out === code };
  }

  window.RuleConverter = { convertPython, convertPyproject, convertRequirements };
})();
