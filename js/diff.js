/*
 * diff.js - minimal line-based diff (LCS) for the before/after review.
 *
 * window.lineDiff(oldText, newText) -> [{ type: "same"|"add"|"del", text, oldNo, newNo }]
 */
(function () {
  "use strict";

  function lineDiff(oldText, newText) {
    const a = oldText.split("\n");
    const b = newText.split("\n");
    const n = a.length;
    const m = b.length;

    // LCS length table.
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const out = [];
    let i = 0;
    let j = 0;
    let oldNo = 1;
    let newNo = 1;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        out.push({ type: "same", text: a[i], oldNo: oldNo++, newNo: newNo++ });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ type: "del", text: a[i], oldNo: oldNo++, newNo: null });
        i++;
      } else {
        out.push({ type: "add", text: b[j], oldNo: null, newNo: newNo++ });
        j++;
      }
    }
    while (i < n) out.push({ type: "del", text: a[i++], oldNo: oldNo++, newNo: null });
    while (j < m) out.push({ type: "add", text: b[j++], oldNo: null, newNo: newNo++ });
    return out;
  }

  function countChanges(diff) {
    let added = 0;
    let removed = 0;
    for (const d of diff) {
      if (d.type === "add") added++;
      else if (d.type === "del") removed++;
    }
    return { added, removed };
  }

  window.lineDiff = lineDiff;
  window.countChanges = countChanges;
})();
