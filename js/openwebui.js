
(function () {
  "use strict";

  function normalizeBase(base) {
    return (base || "").trim().replace(/\/+$/, "");
  }

  function authHeaders(key) {
    return {
      Authorization: "Bearer " + (key || "").trim(),
      "Content-Type": "application/json",
    };
  }

  async function tryJson(url, opts) {
    const res = await fetch(url, opts);
    const bodyText = await res.text();
    let body = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch (e) {
      body = null;
    }
    return { res, body, bodyText };
  }

  async function listModels(base, key) {
    const b = normalizeBase(base);
    const headers = authHeaders(key);
    const endpoints = [b + "/api/models", b + "/v1/models"];
    let lastErr = null;

    for (const url of endpoints) {
      try {
        const { res, body, bodyText } = await tryJson(url, { headers });
        if (!res.ok) {
          lastErr = new Error("HTTP " + res.status + " from " + url + (bodyText ? " - " + bodyText.slice(0, 200) : ""));
          continue;
        }
        // OpenWebUI: { data: [{ id, name? }, ...] }; be liberal about shape.
        const list = (body && (body.data || body.models || body)) || [];
        const ids = [];
        for (const m of list) {
          if (typeof m === "string") ids.push(m);
          else if (m && (m.id || m.name)) ids.push(m.id || m.name);
        }
        if (ids.length) return Array.from(new Set(ids)).sort();
        lastErr = new Error("No models found in response from " + url);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Could not list models");
  }

  async function chat(base, key, model, messages, opts) {
    opts = opts || {};
    const b = normalizeBase(base);
    const headers = authHeaders(key);
    const payload = JSON.stringify({
      model: model,
      messages: messages,
      stream: false,
      temperature: opts.temperature != null ? opts.temperature : 0,
    });
    const endpoints = [b + "/api/chat/completions", b + "/v1/chat/completions"];
    let lastErr = null;

    for (const url of endpoints) {
      try {
        const { res, body, bodyText } = await tryJson(url, {
          method: "POST",
          headers,
          body: payload,
          signal: opts.signal,
        });
        if (!res.ok) {
          lastErr = new Error("HTTP " + res.status + " from " + url + (bodyText ? " - " + bodyText.slice(0, 300) : ""));
          continue;
        }
        const content =
          body &&
          body.choices &&
          body.choices[0] &&
          body.choices[0].message &&
          body.choices[0].message.content;
        if (typeof content === "string") return content;
        lastErr = new Error("Unexpected response shape from " + url + ": " + (bodyText || "").slice(0, 200));
      } catch (e) {
        if (e && e.name === "AbortError") throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error("Chat request failed");
  }

  window.OpenWebUI = { normalizeBase, listModels, chat };
})();
