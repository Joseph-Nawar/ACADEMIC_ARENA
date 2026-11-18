// Short public display names for the leaderboard: first + final name component.
// The complete approved name stays in the data and is exposed as a tooltip and
// accessible label; only the visible text is shortened. Shortening is per level,
// and any names that would collide are expanded with middle components (in
// order) until unique, so two different students never share a visible label.
(function attachDisplayNames(root) {
  "use strict";

  function components(name) {
    return String(name ?? "").normalize("NFC").trim().split(/\s+/u).filter(Boolean);
  }

  function labelFor(parts, middleCount) {
    if (parts.length <= 2 || middleCount >= parts.length - 2) return parts.join(" ");
    return [parts[0], ...parts.slice(1, 1 + middleCount), parts[parts.length - 1]].join(" ");
  }

  const key = (label) => label.normalize("NFKC").toLocaleLowerCase("und");

  // names: full public names of one board. Returns visible labels in the same order.
  function shortDisplayNames(names) {
    const parts = names.map(components);
    const depth = parts.map(() => 0);
    const labels = () => parts.map((item, index) => labelFor(item, depth[index]));
    for (let round = 0; round < 80; round += 1) {
      const current = labels();
      const groups = new Map();
      current.forEach((label, index) => {
        const group = groups.get(key(label)) || [];
        group.push(index);
        groups.set(key(label), group);
      });
      let changed = false;
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        for (const index of group) {
          if (depth[index] < parts[index].length - 2) {
            depth[index] += 1;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    // Anything still ambiguous (e.g. names differing only in spacing) shows in full.
    const final = labels();
    const counts = new Map();
    for (const label of final) counts.set(key(label), (counts.get(key(label)) || 0) + 1);
    return final.map((label, index) => (counts.get(key(label)) > 1 ? String(names[index] ?? "") : label));
  }

  const api = Object.freeze({ shortDisplayNames });
  root.AcademicArenaDisplayNames = api;
})(globalThis);
