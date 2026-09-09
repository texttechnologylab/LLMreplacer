
(function () {
  "use strict";

  const LS = {
    base: "duui-lc.base",
    key: "duui-lc.key",
    model: "duui-lc.model",
    level: "duui-lc.level",
    forward: "duui-lc.forward",
    method: "duui-lc.method",
  };
  let mode = "llm"; // "llm" | "algorithm"
  const DEFAULT_BASE = "https://llm.texttechnologylab.org/";

  const $ = (sel) => document.querySelector(sel);
  const el = {
    baseUrl: $("#baseUrl"),
    apiKey: $("#apiKey"),
    toggleKey: $("#toggleKey"),
    model: $("#model"),
    loadModels: $("#loadModels"),
    methodAlgo: $("#methodAlgo"),
    methodLLM: $("#methodLLM"),
    methodHint: $("#methodHint"),
    connFields: $("#connFields"),
    forwardThirdParty: $("#forwardThirdParty"),
    installLevel: $("#installLevel"),
    levelField: $("#levelField"),
    connStatus: $("#connStatus"),
    dropzone: $("#dropzone"),
    fileInput: $("#fileInput"),
    dirInput: $("#dirInput"),
    browseBtn: $("#browseBtn"),
    browseDir: $("#browseDir"),
    filesCard: $("#filesCard"),
    fileList: $("#fileList"),
    convertAll: $("#convertAll"),
    downloadZip: $("#downloadZip"),
    clearAll: $("#clearAll"),
    progress: $("#progress"),
    progressBar: $("#progressBar"),
    progressText: $("#progressText"),
  };

  // id -> { id, name, path, origCode, newCode, status, notes, error, open }
  const files = new Map();
  let seq = 0;
  const CONCURRENCY = 2;

  // localStorage prefs
  function loadPrefs() {
    el.baseUrl.value = localStorage.getItem(LS.base) || DEFAULT_BASE;
    el.apiKey.value = localStorage.getItem(LS.key) || "";
    el.installLevel.value = localStorage.getItem(LS.level) || "INFO";
    el.forwardThirdParty.checked = localStorage.getItem(LS.forward) !== "0"; // default on
    mode = localStorage.getItem(LS.method) === "algorithm" ? "algorithm" : "llm";
    syncLevelField();
    syncMethod();
  }
  function savePrefs() {
    localStorage.setItem(LS.base, el.baseUrl.value);
    localStorage.setItem(LS.key, el.apiKey.value);
    localStorage.setItem(LS.level, el.installLevel.value);
    localStorage.setItem(LS.forward, el.forwardThirdParty.checked ? "1" : "0");
    localStorage.setItem(LS.method, mode);
    if (el.model.value) localStorage.setItem(LS.model, el.model.value);
  }

  // The install(level=...) control only matters when third-party forwarding is on.
  function syncLevelField() {
    const on = el.forwardThirdParty.checked;
    el.installLevel.disabled = !on;
    el.levelField.classList.toggle("disabled", !on);
  }

  // Reflect the chosen conversion method: hide the OpenWebUI fields in Algorithm mode.
  function syncMethod() {
    const algo = mode === "algorithm";
    el.methodAlgo.setAttribute("aria-pressed", algo ? "true" : "false");
    el.methodLLM.setAttribute("aria-pressed", algo ? "false" : "true");
    el.connFields.classList.toggle("hidden", algo);
    el.methodHint.textContent = algo
      ? "Rule-based conversion runs fully offline in your browser. No API key or model needed."
      : "Sends each file to the OpenWebUI model you pick below. Recommended: gpt-oss:20b or a similar capable model; small models (e.g. llama3.2) are less reliable.";
  }

  function setConn(msg, cls) {
    el.connStatus.textContent = msg || "";
    el.connStatus.className = "status" + (cls ? " " + cls : "");
  }

  // model loading
  async function loadModels() {
    savePrefs();
    if (!el.baseUrl.value.trim()) return setConn("Enter a base URL first.", "err");
    if (!el.apiKey.value.trim()) return setConn("Enter your API key first.", "err");
    el.loadModels.disabled = true;
    setConn("Loading models...", "busy");
    try {
      const ids = await window.OpenWebUI.listModels(el.baseUrl.value, el.apiKey.value);
      const prev = localStorage.getItem(LS.model);
      el.model.innerHTML = "";
      for (const id of ids) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        el.model.appendChild(opt);
      }
      if (prev && ids.includes(prev)) el.model.value = prev;
      setConn("Loaded " + ids.length + " model" + (ids.length === 1 ? "" : "s") + ".", "ok");
    } catch (e) {
      setConn("Could not load models: " + e.message, "err");
    } finally {
      el.loadModels.disabled = false;
    }
  }

  // file input
  function accept(name) {
    const base = (name.split("/").pop() || name);
    return /\.py$/i.test(base) || /\.toml$/i.test(base) || /\.txt$/i.test(base);
  }

  function addFile(name, path, code) {
    // De-dupe by path.
    for (const f of files.values()) {
      if (f.path === path) return;
    }
    const id = "f" + ++seq;
    files.set(id, {
      id, name, path, origCode: code, newCode: null,
      status: "queued", notes: [], error: null, open: false,
    });
  }

  async function readEntries(fileList) {
    let added = 0;
    for (const file of fileList) {
      const path = file.webkitRelativePath || file.name;
      if (!accept(path)) continue;
      const code = await file.text();
      addFile(file.name, path, code);
      added++;
    }
    if (added > 0) {
      el.filesCard.hidden = false;
      render();
    } else {
      setConn("No .py, pyproject.toml or requirements.txt files found in the drop.", "err");
    }
  }

  // Drag & drop, folder slect
  function walkEntry(entry, out, prefix) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file) => {
          const path = (prefix ? prefix + "/" : "") + file.name;
          if (accept(path)) out.push({ file, path });
          resolve();
        }, () => resolve());
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const readBatch = () => {
          reader.readEntries(async (batch) => {
            if (!batch.length) {
              await Promise.all(all.map((e) => walkEntry(e, out, (prefix ? prefix + "/" : "") + entry.name)));
              resolve();
            } else {
              all.push(...batch);
              readBatch();
            }
          }, () => resolve());
        };
        readBatch();
      } else {
        resolve();
      }
    });
  }

  async function handleDrop(dt) {
    const items = dt.items;
    const collected = [];
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = [];
      for (const it of items) {
        const e = it.webkitGetAsEntry && it.webkitGetAsEntry();
        if (e) entries.push(e);
      }
      await Promise.all(entries.map((e) => walkEntry(e, collected, "")));
    }
    if (collected.length) {
      let added = 0;
      for (const { file, path } of collected) {
        const code = await file.text();
        addFile(file.name, path, code);
        added++;
      }
      if (added) { el.filesCard.hidden = false; render(); }
      else setConn("No .py, pyproject.toml or requirements.txt files in the drop.", "err");
    } else if (dt.files && dt.files.length) {
      await readEntries(dt.files);
    }
  }

  // Conversion
  function connReady() {
    if (mode === "algorithm") return true; // no LLM needed
    if (!el.baseUrl.value.trim() || !el.apiKey.value.trim()) {
      setConn("Set base URL and API key first.", "err");
      return false;
    }
    if (!el.model.value) {
      setConn("Load and pick a model first.", "err");
      return false;
    }
    return true;
  }

  async function convertFile(f) {
    f.status = "busy";
    f.error = null;
    renderItem(f);
    try {
      const res = await window.convertOne({
        base: el.baseUrl.value,
        key: el.apiKey.value,
        model: el.model.value,
        filename: f.path,
        code: f.origCode,
        installLevel: el.installLevel.value,
        forwardThirdParty: el.forwardThirdParty.checked,
        mode: mode,
      });
      f.newCode = res.code;
      f.notes = res.notes || [];
      f.status = res.unchanged ? "unchanged" : "done";
    } catch (e) {
      f.status = "error";
      f.error = e.message || String(e);
    }
    renderItem(f);
    updateToolbar();
  }

  async function convertAll() {
    if (!connReady()) return;
    savePrefs();
    const todo = [...files.values()].filter((f) => f.status === "queued" || f.status === "error");
    if (!todo.length) return;

    el.convertAll.disabled = true;
    el.progress.hidden = false;
    let done = 0;
    const total = todo.length;
    const tick = () => {
      done++;
      el.progressBar.style.width = Math.round((done / total) * 100) + "%";
      el.progressText.textContent = done + " / " + total;
    };
    el.progressBar.style.width = "0%";
    el.progressText.textContent = "0 / " + total;

    // simple concurrency pool
    let idx = 0;
    async function worker() {
      while (idx < todo.length) {
        const f = todo[idx++];
        await convertFile(f);
        tick();
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

    el.convertAll.disabled = false;
    updateToolbar();
  }

  // Downloads
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadFile(f) {
    const text = f.newCode != null ? f.newCode : f.origCode;
    download(new Blob([text], { type: "text/plain" }), f.name);
  }

  function downloadZip() {
    const entries = [];
    for (const f of files.values()) {
      if (f.newCode != null && (f.status === "done" || f.status === "unchanged")) {
        entries.push({ name: f.path, text: f.newCode });
      }
    }
    if (!entries.length) return;
    download(window.makeZip(entries), "duui-converted.zip");
  }

  function updateToolbar() {
    const anyConverted = [...files.values()].some(
      (f) => f.newCode != null && (f.status === "done" || f.status === "unchanged")
    );
    el.downloadZip.disabled = !anyConverted;
    const anyQueued = [...files.values()].some((f) => f.status === "queued" || f.status === "error");
    el.convertAll.disabled = !anyQueued;
  }

  // render
  const BADGE = {
    queued: "Queued", busy: "Converting...", done: "Converted",
    unchanged: "No change", error: "Error",
  };

  function render() {
    el.fileList.innerHTML = "";
    for (const f of files.values()) {
      el.fileList.appendChild(buildItem(f));
    }
    updateToolbar();
  }

  function buildItem(f) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.id = "item-" + f.id;
    li.appendChild(buildRow(f));
    const detail = document.createElement("div");
    detail.className = "file-detail" + (f.open ? " open" : "");
    detail.id = "detail-" + f.id;
    fillDetail(detail, f);
    li.appendChild(detail);
    return li;
  }

  function buildRow(f) {
    const row = document.createElement("div");
    row.className = "file-row";

    const badge = document.createElement("span");
    badge.className = "badge " + f.status;
    badge.textContent = BADGE[f.status] || f.status;

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = f.path;

    const changes = document.createElement("span");
    changes.className = "changes";
    if (f.newCode != null && f.status === "done") {
      const c = window.countChanges(window.lineDiff(f.origCode, f.newCode));
      changes.innerHTML = '<span class="plus">+' + c.added + '</span> <span class="minus">−' + c.removed + "</span>";
    }

    const actions = document.createElement("div");
    actions.className = "file-actions";

    const viewBtn = document.createElement("button");
    viewBtn.className = "ghost";
    viewBtn.textContent = f.open ? "Hide diff" : "View diff";
    viewBtn.disabled = f.newCode == null;
    viewBtn.onclick = () => toggleDetail(f);

    const convBtn = document.createElement("button");
    convBtn.className = "secondary";
    convBtn.textContent = f.status === "error" ? "Retry" : "Convert";
    convBtn.disabled = f.status === "busy";
    convBtn.onclick = async () => { if (connReady()) { savePrefs(); await convertFile(f); } };

    const dlBtn = document.createElement("button");
    dlBtn.className = "ghost";
    dlBtn.textContent = "Download";
    dlBtn.disabled = f.newCode == null;
    dlBtn.onclick = () => downloadFile(f);

    const rmBtn = document.createElement("button");
    rmBtn.className = "ghost";
    rmBtn.textContent = "✕";
    rmBtn.title = "Remove";
    rmBtn.onclick = () => { files.delete(f.id); render(); if (!files.size) el.filesCard.hidden = true; };

    actions.append(viewBtn, convBtn, dlBtn, rmBtn);
    row.append(badge, name, changes, actions);
    return row;
  }

  function fillDetail(detail, f) {
    detail.innerHTML = "";
    if (f.error) {
      const e = document.createElement("div");
      e.className = "err-msg";
      e.textContent = f.error;
      detail.appendChild(e);
    }
    if (f.notes && f.notes.length) {
      const ul = document.createElement("ul");
      ul.className = "notes";
      for (const n of f.notes) {
        const li = document.createElement("li");
        li.textContent = n;
        ul.appendChild(li);
      }
      detail.appendChild(ul);
    }
    if (f.newCode != null) {
      const head = document.createElement("div");
      head.className = "diff-head";

      const title = document.createElement("span");
      title.className = "diff-title";
      title.textContent = f.editing ? "Editing converted file" : "Converted file";
      if (f.edited) title.textContent += " (edited)";

      const actions = document.createElement("div");
      actions.className = "diff-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "copy-btn";
      editBtn.title = f.editing ? "Back to the diff view" : "Edit the converted file before copying/downloading";
      editBtn.innerHTML = f.editing
        ? '<span class="copy-label">View diff</span>'
        : EDIT_ICON + '<span class="copy-label">Edit</span>';
      editBtn.onclick = () => { f.editing = !f.editing; renderItem(f); };

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "copy-btn";
      copyBtn.title = "Copy the whole converted file";
      copyBtn.innerHTML = COPY_ICON + '<span class="copy-label">Copy</span>';
      copyBtn.onclick = () => copyWholeFile(copyBtn, f.newCode);

      actions.append(editBtn, copyBtn);
      head.append(title, actions);
      detail.appendChild(head);

      if (f.editing) {
        detail.appendChild(buildEditor(f));
      } else {
        detail.appendChild(buildDiff(f.origCode, f.newCode));
      }
    }
  }

  // Editable view of the converted file. Writes straight to f.newCode so Copy / Download /
  // ZIP all use the edited text.
  function buildEditor(f) {
    const ta = document.createElement("textarea");
    ta.className = "code-editor";
    ta.value = f.newCode;
    ta.spellcheck = false;
    ta.wrap = "off";
    ta.oninput = () => {
      f.newCode = ta.value;
      f.edited = f.newCode !== f.origCode;
      f.status = f.newCode.trim() === f.origCode.trim() ? "unchanged" : "done";
    };
    // Tab inserts 4 spaces instead of moving focus out of the editor.
    ta.onkeydown = (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = s + 4;
        ta.oninput();
      }
    };
    // Focus when opening the editor.
    setTimeout(() => { ta.focus(); }, 0);
    return ta;
  }

  // Pencil icon (inline SVG).
  const EDIT_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20h9"></path>' +
    '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';

  // Clipboard icon (inline SVG, no dependencies).
  const COPY_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  async function copyWholeFile(btn, text) {
    const label = btn.querySelector(".copy-label");
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      // Fallback for file:// / older browsers where the async clipboard API is blocked.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch (e2) {
        ok = false;
      }
    }
    if (label) label.textContent = ok ? "Copied" : "Copy failed";
    btn.classList.toggle("copied", ok);
    setTimeout(() => {
      if (label) label.textContent = "Copy";
      btn.classList.remove("copied");
    }, 1500);
  }

  function buildDiff(oldText, newText) {
    const wrap = document.createElement("div");
    wrap.className = "diff";
    const diff = window.lineDiff(oldText, newText);
    for (const d of diff) {
      const line = document.createElement("div");
      line.className = "diff-line " + d.type;
      const gutter = document.createElement("span");
      gutter.className = "gutter";
      gutter.textContent = (d.oldNo || "").toString().padStart(4, " ") + " " + (d.newNo || "").toString().padStart(4, " ");
      const txt = document.createElement("span");
      txt.className = "txt";

      txt.textContent = d.text;
      line.append(gutter, txt);
      wrap.appendChild(line);
    }
    return wrap;
  }

  function toggleDetail(f) {
    f.open = !f.open;
    renderItem(f);
  }

  // Re-render a single item
  function renderItem(f) {
    const old = document.getElementById("item-" + f.id);
    if (old) old.replaceWith(buildItem(f));
  }

  // Events
  function wire() {
    el.toggleKey.onclick = () => {
      el.apiKey.type = el.apiKey.type === "password" ? "text" : "password";
    };
    el.loadModels.onclick = loadModels;
    [el.baseUrl, el.apiKey, el.installLevel].forEach((i) => (i.onchange = savePrefs));
    el.model.onchange = savePrefs;
    el.forwardThirdParty.onchange = () => { syncLevelField(); savePrefs(); };
    el.methodAlgo.onclick = () => { mode = "algorithm"; syncMethod(); savePrefs(); setConn(""); };
    el.methodLLM.onclick = () => { mode = "llm"; syncMethod(); savePrefs(); setConn(""); };

    el.browseBtn.onclick = () => el.fileInput.click();
    el.browseDir.onclick = () => el.dirInput.click();
    el.fileInput.onchange = () => { readEntries(el.fileInput.files); el.fileInput.value = ""; };
    el.dirInput.onchange = () => { readEntries(el.dirInput.files); el.dirInput.value = ""; };

    const dz = el.dropzone;
    ["dragenter", "dragover"].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); })
    );
    ["dragleave", "drop"].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "dragleave" && dz.contains(e.relatedTarget)) return; dz.classList.remove("drag"); })
    );
    dz.addEventListener("drop", (e) => handleDrop(e.dataTransfer));
    dz.addEventListener("click", (e) => { if (e.target === dz || e.target.closest(".dz-big")) el.fileInput.click(); });
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.fileInput.click(); } });

    el.convertAll.onclick = convertAll;
    el.downloadZip.onclick = downloadZip;
    el.clearAll.onclick = () => { files.clear(); render(); el.filesCard.hidden = true; };
  }

  loadPrefs();
  wire();
})();
