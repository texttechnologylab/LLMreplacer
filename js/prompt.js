
(function () {
  "use strict";

  const VALID_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"];
  const GIT_URL = "https://github.com/texttechnologylab/DUUIlogger";
  const UV_SOURCE_LINE = `duui-logging = { git = "${GIT_URL}" }`;
  const REQ_LINE = `duui-logging @ git+${GIT_URL}`;

  // Python conversion
  function buildSystemPrompt(opts) {
    opts = opts || {};
    const level = VALID_LEVELS.includes(opts.installLevel) ? opts.installLevel : "INFO";
    const forward = opts.forwardThirdParty !== false; // default on

    // The FastAPI connect Only add() by default; add install() when forwarding.
    const wireUp = forward
      ? `   duui_logging.add_logging(app)
   duui_logging.install(level=logging.${level})`
      : `   duui_logging.add_logging(app)`;

    const importLine = forward
      ? `import logging
import duui_logging
from duui_logging import log_info, log_warn, log_error, log_debug`
      : `import duui_logging
from duui_logging import log_info, log_warn, log_error, log_debug`;

    return `You rewrite a Python file so it logs with the duui_logging library.

Do these edits and NOTHING else:

1. Add these import lines at the top of the file (skip any that are already there):
${importLine}

2. Replace EVERY print(...) call with a logging call. You MUST change every print. Rules:
   - print is inside an "except" block  ->  log_error(...)
   - the text is a warning               ->  log_warn(...)
   - anything else                       ->  log_info(...)
   Keep the exact text inside. Examples:
     print("loaded model")            ->  log_info("loaded model")
     print(f"got {n} docs")           ->  log_info(f"got {n} docs")
     print("file missing")  (in except)  ->  log_error("file missing")

3. If the file has a line like  app = FastAPI(...)  , add these line(s) right after it:
${wireUp}
   If there is no FastAPI app, do not add these lines.

Keep every other line of the file EXACTLY as it is: all other code, all imports, all
comments, all blank lines. Do not touch existing logging.* or warnings.warn(...) calls.

Do NOT add any comments, notes, or explanations of your own to the file. Do not write
comments like "# changed to log_info". Do not use the em dash character. Only make the
edits above; the file must look like normal human-written code.

Return the complete file inside one code block and nothing else:
\`\`\`python
<the whole file here>
\`\`\``;
  }

  // pyproject.toml
  const PYPROJECT_SYSTEM_PROMPT = `You edit a pyproject.toml file to add the duui-logging dependency.

Do these two edits and NOTHING else:

1. Find the dependencies list under [project] (dependencies = [ ... ]). Add this one item to
   that list if it is not already there:
       "duui-logging",
   Keep every other dependency in the list exactly as it is. Do not remove or change any.

2. Make sure the file has this section with this exact line (add it at the end of the file if
   the [tool.uv.sources] section does not exist yet; if the section exists, add the line to it):
       [tool.uv.sources]
       ${UV_SOURCE_LINE}

Keep every other line of the file EXACTLY as it is. Do not remove or change any existing
dependency, version, section, or line.

Return the complete file inside one code block and nothing else:
\`\`\`toml
<the whole file here>
\`\`\``;

  // requirements.txt
  const REQUIREMENTS_SYSTEM_PROMPT = `You edit a requirements.txt file to add the duui-logging dependency.

Add this exact line if it is not already in the file:
    ${REQ_LINE}

Keep every existing line EXACTLY as it is - do not remove, reorder, or change any other line.
(If there is a plain "duui-logging" line without the git URL, replace just that line with the
line above.)

Return the complete file inside one code block and nothing else:
\`\`\`text
<the whole file here>
\`\`\``;

  // user messages (the file itself)
  function buildUserMessage(filename, code) {
    return `File: ${filename}\n\n\`\`\`python\n${code}\n\`\`\``;
  }
  function buildPyprojectMessage(filename, code) {
    return `File: ${filename}\n\n\`\`\`toml\n${code}\n\`\`\``;
  }
  function buildRequirementsMessage(filename, code) {
    return `File: ${filename}\n\n\`\`\`text\n${code}\n\`\`\``;
  }

  window.DUUI_PROMPT = {
    VALID_LEVELS,
    buildSystemPrompt,
    PYPROJECT_SYSTEM_PROMPT,
    REQUIREMENTS_SYSTEM_PROMPT,
    buildUserMessage,
    buildPyprojectMessage,
    buildRequirementsMessage,
  };
})();
