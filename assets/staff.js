/* Staff desk: ranking publication, verified rewards and Campus Wins moderation. Authorization is
   enforced by the server; this file only decides which panels to show. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const templateTitles = { top3: "Top three", workshop: "Workshop challenge", project: "Project finished", helped: "Helped classmates" };
  const stateLabels = { live: "Live", draft: "Draft", previous: "Previous", withdrawn: "Withdrawn" };
  let api = null;
  let showPage = () => {};
  let canPublish = false;
  let canModerate = false;
  let draftId = "";
  let queue = "pending";
  let bound = false;

  function status(message, state = "info") {
    $("staff-status").textContent = message;
    $("staff-status").dataset.state = state;
  }

  function button(label, onClick, solid = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = solid ? "button-solid" : "outline-btn";
    element.textContent = label;
    element.addEventListener("click", async () => {
      element.disabled = true;
      try {
        await onClick();
      } finally {
        element.disabled = false;
      }
    });
    return element;
  }

  function listItem(parts, actions = []) {
    const item = document.createElement("li");
    for (const part of parts) item.append(part);
    if (actions.length) {
      const wrap = document.createElement("span");
      wrap.className = "staff-actions";
      wrap.append(...actions);
      item.append(wrap);
    }
    return item;
  }

  function textNode(tag, value, className = "") {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  function stateTag(state, label) {
    const tag = textNode("span", label, "staff-state");
    tag.dataset.state = state;
    return tag;
  }

  function failure(error, fallback) {
    const messages = {
      unauthorized: "Your session ended. Sign in again.",
      forbidden: "Your account is not allowed to do this, or staff verification is required.",
      invalid_transition: "That change is not allowed for this item's current state.",
      not_found: "That item no longer exists.",
      invalid_upload: "The file was rejected. Fix the listed problems and upload again.",
    };
    status(messages[error?.code] || fallback, "unavailable");
  }

  async function loadHistory() {
    const list = $("publication-history");
    list.replaceChildren();
    try {
      const publications = await api.staff.publicationHistory();
      if (!publications.length) list.append(listItem([textNode("span", "No publications yet.")]));
      for (const item of publications) {
        const when = item.publishedAt ? new Date(item.publishedAt).toLocaleString("en-GB") : "not published";
        const actions = item.state === "live" || item.format !== "level_only" ? [] : [button(item.state === "draft" ? "PUBLISH" : "ROLL BACK TO THIS", async () => {
          if (!window.confirm(`Make version ${item.version} the live rankings?`)) return;
          try {
            await api.staff.publishLeaderboard(item.id);
            status(`Version ${item.version} is now live.`, "ready");
            await loadHistory();
          } catch (error) {
            failure(error, "Publishing failed. Nothing was changed.");
          }
        })];
        list.append(listItem([
          textNode("strong", `v${item.version}`),
          stateTag(item.state, stateLabels[item.state]),
          textNode("span", item.format === "level_only"
            ? `${item.releaseLabel || ""} · ${item.academicYear} · ${item.rowCount} rows · ${when}`
            : `legacy semester/module format · ${item.academicYear} · ${when}`),
        ], actions));
      }
    } catch (error) {
      failure(error, "Publication history is unavailable.");
    }
    // Keep the publication pickers in step with history (new publish, rollback).
    if (!$("staff-artwork").hidden) void loadArtworkPublications();
    if (!$("staff-links").hidden) void loadLinkPublications();
  }

  function renderDiff(result) {
    const list = $("ranking-diff");
    list.replaceChildren();
    list.append(textNode("li", `Draft v${result.draft.version} (${result.draft.releaseLabel}): ${result.draft.rowCount} rows. Live version: ${result.liveVersion ?? "none"}.`));
    const words = { added: "New", changed: "Changed", removed: "Removed" };
    for (const { level, changes } of result.diff.levels) {
      if (!changes.length) {
        list.append(textNode("li", `Level ${level}: no changes.`));
        continue;
      }
      for (const item of changes) {
        const detail = item.change === "changed" ? `${item.before} → ${item.after}` : item.after ?? item.before;
        list.append(textNode("li", `Level ${level} · rank ${item.position} · ${words[item.change]}: ${detail}`));
      }
    }
    $("ranking-preview").hidden = false;
  }

  async function uploadRankings(event) {
    event.preventDefault();
    $("ranking-errors").replaceChildren();
    $("ranking-preview").hidden = true;
    draftId = "";
    const file = $("ranking-file").files[0];
    if (!file || file.size > 16384) {
      status("Choose a CSV file of at most 16 KB.", "unavailable");
      return;
    }
    status("Validating…", "loading");
    try {
      const result = await api.staff.uploadRankings($("ranking-year").value.trim(), $("ranking-label").value.trim(), await file.text());
      draftId = result.draft.id;
      renderDiff(result);
      status("The file is valid. Review the preview, then publish.", "ready");
      await loadHistory();
    } catch (error) {
      for (const detail of error?.details || []) {
        $("ranking-errors").append(textNode("li", detail.line ? `Line ${detail.line}: ${detail.message}` : detail.message));
      }
      failure(error, "The file could not be validated.");
    }
  }

  // ---- Board characters (staff-reviewed defaults, 3D family)
  const CHARACTERS = [["omar", "Wave"], ["mariam", "Bold"], ["youssef", "Chill"], ["amara", "Spark"], ["tariq", "Casual"],
    ["habiba2", "Brave"], ["malek", "Sunny"], ["nour2", "Creative"], ["zein", "Calm"]];
  // Visible traits staff must know before choosing; the face-only preview hides them.
  const CHARACTER_NOTES = { habiba2: "headscarf", zein: "wheelchair user" };
  let artworkPublication = "";
  let artworkRows = [];

  function closeArtworkReview() {
    $("artwork-review").hidden = true;
    $("artwork-result").textContent = "";
    $("artwork-rows").replaceChildren();
    artworkRows = [];
    artworkPublication = "";
  }

  async function loadArtworkPublications() {
    const select = $("artwork-publication");
    const previous = select.value;
    select.replaceChildren();
    try {
      for (const item of (await api.staff.publicationHistory()).filter((entry) => entry.format === "level_only")) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `v${item.version} · ${item.releaseLabel || ""} · ${stateLabels[item.state]}`;
        option.dataset.version = String(item.version);
        select.append(option);
      }
      // Keep the staff member's current choice; otherwise default to the live version.
      const keep = [...select.options].find((option) => option.value === previous);
      const live = [...select.options].find((option) => option.textContent.endsWith(stateLabels.live));
      if (keep) keep.selected = true;
      else if (live) live.selected = true;
      // A review list must always belong to the publication shown in the picker.
      if (artworkPublication && select.value !== artworkPublication) closeArtworkReview();
    } catch (error) {
      failure(error, "Publications are unavailable.");
    }
  }

  // Every pre-filled or flagged row needs its own tick before anything can be approved.
  function refreshArtworkState() {
    const items = [...$("artwork-rows").querySelectorAll("li")];
    const chosen = items.filter((item) => item.querySelector("select").value).length;
    const pending = items.filter((item) => item.dataset.pending === "true").length;
    $("artwork-summary").textContent = `${chosen} of ${items.length} rows have a character` +
      (pending ? ` · ${pending} row(s) still need your check` : " · every row checked") + ".";
    $("approve-artwork").disabled = pending > 0 || items.length === 0;
  }

  function renderArtworkRows(suggestions = null) {
    const list = $("artwork-rows");
    list.replaceChildren();
    const suggested = new Map((suggestions || []).map((item) => [`${item.level}:${item.position}`, item]));
    for (const row of artworkRows) {
      const item = document.createElement("li");
      const label = textNode("span", `L${row.level} · ${String(row.position).padStart(2, "0")} · ${row.publicName}`, "artwork-name");
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Character for Level ${row.level} rank ${row.position}`);
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Neutral illustration";
      select.append(none);
      for (const [key, mood] of CHARACTERS) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = `${mood} (${key.replace(/\d+$/u, "")}${CHARACTER_NOTES[key] ? `, ${CHARACTER_NOTES[key]}` : ""})`;
        select.append(option);
      }
      // An earlier staff decision always wins over a new suggestion.
      const suggestion = row.character ? null : suggested.get(`${row.level}:${row.position}`);
      select.value = row.character || suggestion?.character || "";
      const preview = document.createElement("img");
      preview.className = "artwork-preview";
      preview.alt = "";
      const note = suggestion?.flag === "ambiguous" ? "Unisex name: decide this row yourself."
        : suggestion?.flag ? "Name not recognised: decide this row yourself."
          : suggestion?.character ? "Suggested from the first name: check it." : "";
      const check = document.createElement("label");
      check.className = "artwork-check";
      const box = document.createElement("input");
      box.type = "checkbox";
      check.append(box, document.createTextNode(" Checked"));
      const flag = textNode("span", note, "artwork-flag");
      const needsCheck = Boolean(suggestion);
      check.hidden = !needsCheck;
      flag.hidden = !note;
      if (suggestion?.flag) item.dataset.flag = suggestion.flag;
      const setPending = () => {
        item.dataset.pending = String(needsCheck && !box.checked);
        refreshArtworkState();
      };
      const update = () => {
        preview.hidden = !select.value;
        if (select.value) preview.src = `assets/characters/${select.value}-3d-face.jpg`;
      };
      select.addEventListener("change", () => {
        box.checked = true;
        update();
        setPending();
      });
      box.addEventListener("change", setPending);
      item.append(preview, label, select, check, flag);
      list.append(item);
      update();
      setPending();
    }
    refreshArtworkState();
  }

  async function loadArtwork(event) {
    event.preventDefault();
    const publicationId = $("artwork-publication").value;
    try {
      artworkRows = await api.staff.boardCharacters(publicationId);
      artworkPublication = publicationId;
      renderArtworkRows();
      $("artwork-review").hidden = false;
      status("Review each row, then approve.", "ready");
    } catch (error) {
      failure(error, "Rows could not be loaded.");
    }
  }

  function suggestArtwork() {
    // Runs only in this browser; nothing about the suggestion is sent or stored.
    const suggestions = window.AcademicArenaCharacterSuggestions.suggestCharacters(
      artworkRows.map((row) => ({ level: row.level, position: row.position, name: row.publicName })));
    renderArtworkRows(suggestions);
    status("Suggestions filled in for rows without a character. Tick each row once you have checked it.", "ready");
  }

  async function approveArtwork() {
    const select = $("artwork-publication");
    if (!artworkPublication || select.value !== artworkPublication) {
      closeArtworkReview();
      status("The publication changed. Load its rows again before approving.", "unavailable");
      return;
    }
    if ([...$("artwork-rows").querySelectorAll("li")].some((item) => item.dataset.pending === "true")) return;
    const assignments = [...$("artwork-rows").querySelectorAll("li")].map((item, index) => ({
      level: artworkRows[index].level, rank: artworkRows[index].position, character: item.querySelector("select").value,
    })).filter((item) => item.character);
    const version = select.selectedOptions[0]?.textContent || "this publication";
    if (!window.confirm(`Approve ${assignments.length} board characters for ${version}? Rows on "Neutral illustration" show a neutral figure.`)) return;
    const result = $("artwork-result");
    const button = $("approve-artwork");
    button.disabled = true;
    result.dataset.state = "pending";
    result.textContent = "Saving…";
    try {
      const saved = await api.staff.approveBoardCharacters(artworkPublication, assignments);
      // Show what is actually stored now, not what the dropdowns said.
      artworkRows = await api.staff.boardCharacters(artworkPublication);
      renderArtworkRows();
      const stored = artworkRows.filter((row) => row.character).length;
      result.dataset.state = "ready";
      result.textContent = `Saved: ${saved.approved} board character(s) for ${version}. ${stored} row(s) now have a character; the public board uses them immediately.`;
      status(`${saved.approved} board character(s) approved for ${version}.`, "ready");
    } catch (error) {
      // A failed save must never look like a success: say so next to the button
      // and put the list back to what is really stored.
      result.dataset.state = "unavailable";
      result.textContent = error?.code === "unauthorized"
        ? "Not saved: your session ended. Sign in again, then load the rows and approve again."
        : "Not saved. Nothing changed on the public board. Load the rows and try again.";
      failure(error, "Characters were not changed.");
      if (error?.code !== "unauthorized") {
        try {
          artworkRows = await api.staff.boardCharacters(artworkPublication);
          renderArtworkRows();
        } catch {
          // Keep the message; the next Load rows shows what is stored.
        }
      }
    } finally {
      refreshArtworkState();
    }
  }

  let linkCsv = "";
  let linkPublication = "";
  // Links already approved for the selected publication. Approval replaces the
  // whole set, so the preview lists any of these the uploaded file would drop.
  let currentLinks = [];
  let currentLinksFor = "";
  let linkRemovals = 0;
  const linkKey = (item) => `${item.level}:${item.position}:${item.username}`;

  async function loadCurrentLinks() {
    const publicationId = $("links-publication").value;
    currentLinks = [];
    currentLinksFor = "";
    $("links-current").hidden = true;
    $("links-preview").hidden = true;
    linkCsv = "";
    if (!publicationId) return;
    // No preview until this publication's current links are known.
    const submit = $("links-form").querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const links = await api.staff.rankingLinks(publicationId);
      if ($("links-publication").value !== publicationId) return;
      currentLinks = links;
      currentLinksFor = publicationId;
      $("links-current-heading").textContent = `CURRENTLY APPROVED (${links.length})`;
      const list = $("links-current-list");
      list.replaceChildren();
      if (!links.length) list.append(textNode("li", "No approved links yet for this publication."));
      for (const item of links) list.append(textNode("li", `Level ${item.level} · rank ${item.position} · ${item.publicName} → ${item.username}`));
      $("download-links").hidden = links.length === 0;
      $("links-current").hidden = false;
    } catch (error) {
      failure(error, "Current links are unavailable. Do not approve until they load.");
    } finally {
      if ($("links-publication").value === publicationId) submit.disabled = currentLinksFor !== publicationId;
    }
  }

  // A level,rank,username file of the current links, made in this browser
  // (nothing is sent anywhere). Keep it with the private roster, not online.
  function downloadCurrentLinks() {
    if (!currentLinks.length) return;
    const csv = ["level,rank,username", ...currentLinks.map((item) => `${item.level},${item.position},${item.username}`)].join("\n") + "\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    const option = $("links-publication").selectedOptions[0];
    const version = /^v(\d+)/u.exec(option?.textContent || "")?.[1];
    link.download = version ? `links-v${version}.csv` : "current-links.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadLinkPublications() {
    const select = $("links-publication");
    select.replaceChildren();
    try {
      const publications = (await api.staff.publicationHistory())
        .filter((item) => item.format === "level_only" && item.state !== "draft");
      for (const item of publications) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `v${item.version} · ${item.releaseLabel || ""} · ${stateLabels[item.state]}`;
        select.append(option);
      }
      await loadCurrentLinks();
    } catch (error) {
      failure(error, "Publications are unavailable.");
    }
  }

  const linkStates = { new: "new link", changed: "changed since previous version", unchanged: "same as previous version" };

  async function previewLinks(event) {
    event.preventDefault();
    $("links-errors").replaceChildren();
    $("links-preview").hidden = true;
    linkCsv = "";
    const file = $("links-file").files[0];
    if (!file || file.size > 4096) {
      status("Choose a link CSV of at most 4 KB.", "unavailable");
      return;
    }
    try {
      const csv = await file.text();
      const publicationId = $("links-publication").value;
      if (currentLinksFor !== publicationId) {
        status("The current links of this publication have not loaded. Reselect the publication and try again.", "unavailable");
        return;
      }
      const result = await api.staff.previewRankingLinks(publicationId, csv);
      const list = $("links-list");
      list.replaceChildren();
      if (!result.links.length) list.append(textNode("li", "No links: approving clears every link for this publication."));
      for (const item of result.links) {
        list.append(textNode("li", `Level ${item.level} · rank ${item.position} · ${item.publicName} → ${item.username} (${item.accountStatus}) · ${linkStates[item.previous] || item.previous}`));
      }
      const kept = new Set(result.links.map(linkKey));
      const removed = currentLinks.filter((item) => !kept.has(linkKey(item)));
      const removedList = $("links-removed");
      removedList.replaceChildren();
      for (const item of removed) removedList.append(textNode("li", `Level ${item.level} · rank ${item.position} · ${item.publicName} → ${item.username}`));
      $("links-removed-block").hidden = removed.length === 0;
      linkRemovals = removed.length;
      linkCsv = csv;
      linkPublication = publicationId;
      $("links-preview").hidden = false;
      status(removed.length
        ? `Check every identity privately. ${removed.length} current link(s) are not in this file and will be removed.`
        : "Check every identity privately, then approve.", removed.length ? "unavailable" : "ready");
    } catch (error) {
      for (const detail of error?.details || []) {
        $("links-errors").append(textNode("li", detail.line ? `Line ${detail.line}: ${detail.message}` : detail.message));
      }
      failure(error, "The link file could not be validated.");
    }
  }

  async function approveLinks() {
    const question = linkRemovals
      ? `This replaces all links of this publication and REMOVES ${linkRemovals} current link(s). Approve anyway?`
      : "Approve these private account links for this publication? This replaces its current link set.";
    if (!linkCsv || !window.confirm(question)) return;
    try {
      const result = await api.staff.approveRankingLinks(linkPublication, linkCsv);
      status(`${result.linked} account link(s) approved.`, "ready");
      $("links-preview").hidden = true;
      $("links-file").value = "";
      linkCsv = "";
      linkRemovals = 0;
      await loadCurrentLinks();
    } catch (error) {
      failure(error, "Links were not changed.");
    }
  }

  async function publishDraft() {
    if (!draftId || !window.confirm("Publish this version? It replaces the live rankings for every board.")) return;
    try {
      const result = await api.staff.publishLeaderboard(draftId);
      status(`Version ${result.version} is now live.`, "ready");
      $("ranking-preview").hidden = true;
      draftId = "";
      await loadHistory();
    } catch (error) {
      failure(error, "Publishing failed. Nothing was changed.");
    }
  }

  async function withdraw() {
    if (!window.confirm("Withdraw the live rankings? The public site will show no standings until you publish again.")) return;
    try {
      const result = await api.staff.withdrawLeaderboard();
      status(result.withdrawn ? "Live rankings withdrawn." : "Nothing was live.", "ready");
      await loadHistory();
    } catch (error) {
      failure(error, "Withdrawal failed.");
    }
  }

  const decisions = {
    pending: [["APPROVE", "approved"], ["REJECT", "rejected"]],
    approved: [["HIDE", "hidden"], ["REMOVE", "removed"]],
    hidden: [["RESTORE", "approved"], ["REMOVE", "removed"]],
    rejected: [],
    removed: [],
  };

  async function loadQueue() {
    const list = $("moderation-list");
    list.replaceChildren();
    try {
      const { posts } = queue === "pending" ? await api.staff.listPendingCampusWins() : await api.staff.listCampusWinHistory(queue);
      if (!posts.length) list.append(listItem([textNode("span", "Nothing here.")]));
      for (const post of posts) {
        const actions = decisions[queue].map(([label, decision]) => button(label, async () => {
          if (decision === "removed" && !window.confirm("Remove this post permanently from Campus Wins?")) return;
          try {
            await api.staff.moderateCampusWin(post.id, decision);
            status("Moderation saved.", "ready");
            await loadQueue();
          } catch (error) {
            failure(error, "Moderation failed.");
          }
        }, decision === "approved"));
        list.append(listItem([
          textNode("strong", post.author),
          textNode("span", templateTitles[post.type]),
          textNode("span", post.created),
        ], actions));
      }
    } catch (error) {
      failure(error, "The moderation queue is unavailable.");
    }
  }

  function setQueue(next) {
    queue = next;
    document.querySelectorAll("[data-queue]").forEach((element) => {
      const active = element.dataset.queue === next;
      element.classList.toggle("current", active);
      element.setAttribute("aria-pressed", String(active));
    });
    void loadQueue();
  }

  async function savePublicName(event) {
    event.preventDefault();
    try {
      await api.staff.setPublicName($("public-name-username").value.trim().toLowerCase(), $("public-name-value").value.trim());
      $("public-name-status").textContent = "Public name saved.";
      $("public-name-form").reset();
    } catch (error) {
      $("public-name-status").textContent = error?.code === "account_not_available"
        ? "No student account has that username."
        : "The name was not saved. Use letters, spaces, apostrophes, hyphens, or periods.";
    }
  }

  // ---------- verified rewards (AAL2 admin) ----------
  const COLLECTION_LABELS = { elite: "Elite (Top 10)", podium: "Podium (Top 3)", champion: "Champion (1st)" };
  let rewardsPreviewFor = "";
  let rewardsPreview = null;
  // Mirrors app_private.canonical_period_key (the database decides; this only pre-fills).
  const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/(^|[^0-9])0+([0-9])/gu, "$1$2").replace(/^-+|-+$/gu, "");

  async function loadRewardPublications() {
    const select = $("rewards-publication");
    select.replaceChildren();
    try {
      const publications = (await api.staff.publicationHistory()).filter((item) => item.format === "level_only" && item.state !== "draft");
      for (const item of publications) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `v${item.version} · ${item.releaseLabel || ""} · ${stateLabels[item.state]}`;
        option.dataset.period = item.releaseLabel ? `${slug(item.academicYear)}:${slug(item.releaseLabel)}`.slice(0, 64) : "";
        option.dataset.label = item.releaseLabel || `Version ${item.version}`;
        select.append(option);
      }
      suggestPeriod();
      await loadRewardPeriods();
    } catch (error) {
      failure(error, "Publications are unavailable.");
    }
  }

  // A suggestion only: staff confirm the period, which must stay the same for corrections.
  function suggestPeriod() {
    const option = $("rewards-publication").selectedOptions[0];
    if (!option) return;
    $("rewards-period").value = option.dataset.period;
    $("rewards-label").value = option.dataset.label;
    $("rewards-preview").hidden = true;
    rewardsPreviewFor = "";
  }

  async function loadRewardPeriods() {
    const list = $("rewards-periods");
    list.replaceChildren();
    try {
      const periods = await api.staff.rewardPeriods();
      if (!periods.length) list.append(listItem([textNode("span", "No rewards processed yet.")]));
      for (const period of periods) {
        const active = Object.entries(period.active || {}).map(([name, count]) => `${COLLECTION_LABELS[name] || name}: ${count}`).join(" · ") || "no active grants";
        list.append(listItem([
          textNode("strong", period.key),
          textNode("span", `${period.label} · versions ${period.versions.map((version) => "v" + version).join(", ") || "none"} · ${active} · revoked ${period.revoked}`),
        ]));
      }
    } catch (error) {
      if (error?.code !== "forbidden") failure(error, "Reward history is unavailable.");
    }
  }

  async function previewRewards(event) {
    event.preventDefault();
    $("rewards-preview").hidden = true;
    rewardsPreviewFor = "";
    const publicationId = $("rewards-publication").value;
    const periodKey = $("rewards-period").value.trim().toLowerCase();
    try {
      const preview = await api.staff.previewRewards(publicationId, periodKey);
      const summary = $("rewards-summary");
      summary.replaceChildren();
      summary.append(textNode("li", `Publication v${preview.publication.version} · ${preview.publication.label || ""}${preview.publication.current ? " (live)" : ""} → period ${periodKey}${preview.period.exists ? ` (already used by ${preview.period.versions.map((v) => "v" + v).join(", ") || "no publication"})` : " (new)"}`));
      summary.append(textNode("li", `${preview.rows} ranked rows · ${preview.linked} verified links · ${preview.eligibleStudents} eligible students`));
      for (const [name, counts] of Object.entries(preview.collections)) {
        summary.append(textNode("li", `${COLLECTION_LABELS[name] || name}: ${counts.newGrants} new · ${counts.alreadyGranted} already granted · ${counts.previouslyRevoked} previously revoked · ${counts.wouldRevoke} would be revoked by reconcile`));
      }
      summary.append(textNode("li", `Excluded: ${preview.exclusions.unlinked} rows without a verified link · ${preview.exclusions.inactiveAccounts} linked accounts not active`));
      if (preview.revocation.students) {
        summary.append(textNode("li", `Reconcile would revoke from ${preview.revocation.students} student(s); ${preview.revocation.equippedFallbacks} of them are wearing an item that would be swapped for a free one.`));
      }
      summary.append(textNode("li", `Changes to confirm: GRANT ${preview.expectedChanges.grant} · RECONCILE ${preview.expectedChanges.reconcile}`));
      const warnings = $("rewards-warnings");
      warnings.replaceChildren();
      const BLOCKERS = {
        not_live: "This is not the live publication. Only the live publication can be processed (preview of history is for reference).",
        no_release_label: "This publication has no release label, so it has no earning period.",
        bound_to_other_period: `This publication was already processed for period ${preview.conflicts.snapshotBoundToPeriod}. Use that period.`,
        new_period_key_not_canonical: `A new earning period must use this publication's key: ${preview.canonicalKey}. To correct an earlier week, choose that week's existing period.`,
        period_belongs_to_other_source: "That period belongs to another kind of reward.",
        likely_replacement: `These verified links match period ${preview.conflicts.likelyReplacementOf}. This looks like a replacement of that week: process it under ${preview.conflicts.likelyReplacementOf}.`,
        no_verified_links: "This publication has no verified account links yet. Approve its links first.",
      };
      for (const code of preview.blockers) warnings.append(textNode("li", BLOCKERS[code] || `Blocked: ${code}`));
      if (preview.conflicts.incompleteLinks) warnings.append(textNode("li", `This version has fewer verified links (${preview.linked}) than an earlier version of this period (${preview.previousLinked}). Reconcile is refused until its links are complete.`));
      if (preview.exclusions.linkedSuspended) warnings.append(textNode("li", `${preview.exclusions.linkedSuspended} linked student(s) are suspended. They still earn and keep verified rewards; suspension only hides them publicly.`));
      if (!preview.rewardsSwitchOn) warnings.append(textNode("li", "Cosmetic rewards are switched off. This preview is all that can happen until the database owner switches them on after approval."));
      const blocked = !preview.rewardsSwitchOn || preview.blockers.length > 0;
      $("rewards-grant").disabled = blocked || preview.expectedChanges.grant === 0;
      $("rewards-reconcile").disabled = blocked || preview.conflicts.incompleteLinks || preview.expectedChanges.reconcile === 0;
      rewardsPreview = preview;
      rewardsPreviewFor = `${publicationId}|${periodKey}`;
      $("rewards-preview").hidden = false;
      status("Reward preview ready. Nothing has been granted.", "ready");
    } catch (error) {
      failure(error, "The reward preview is unavailable. Check the period key (letters, digits, . _ : -).");
    }
  }

  async function processRewards(mode) {
    const publicationId = $("rewards-publication").value;
    const periodKey = $("rewards-period").value.trim().toLowerCase();
    if (rewardsPreviewFor !== `${publicationId}|${periodKey}`) {
      status("Preview this publication and period first.", "unavailable");
      return;
    }
    const expectedChanges = rewardsPreview?.expectedChanges?.[mode] ?? -1;
    const revocations = Object.values(rewardsPreview?.collections || {}).reduce((sum, item) => sum + item.wouldRevoke, 0);
    if (mode === "reconcile" && revocations > 0) {
      // Destructive: the person types the exact number of revocations.
      const typed = window.prompt(`Reconcile period ${periodKey}: revoke ${revocations} reward(s) from ${rewardsPreview.revocation.students} student(s) (reason: result corrected), ` +
        `swap ${rewardsPreview.revocation.equippedFallbacks} worn item(s) for free ones, and grant ${expectedChanges - revocations}. Type ${revocations} to confirm.`);
      if (typed === null || typed.trim() !== String(revocations)) { status("Reconcile cancelled. Nothing was changed.", "info"); return; }
    } else if (!window.confirm(`${mode === "reconcile" ? "Reconcile" : "Grant"} period ${periodKey}: ${expectedChanges} change(s), exactly as previewed. Nothing is ever granted twice.`)) return;
    try {
      const result = await api.staff.processRewards({ publicationId, periodKey, periodLabel: $("rewards-label").value.trim(), mode, expectedChanges });
      status(`Done: ${result.granted} granted, ${result.regranted} restored, ${result.revoked} revoked, ${result.equippedFallbacks} worn item(s) swapped.`, "ready");
      $("rewards-preview").hidden = true;
      rewardsPreviewFor = "";
      await loadRewardPeriods();
    } catch (error) {
      const messages = {
        rewards_not_enabled: "Cosmetic rewards are switched off. Nothing was granted.",
        period_conflict: "This publication belongs to another earning period. Nothing was granted.",
        publication_not_live: "Only the live publication can be processed. Nothing was granted.",
        links_incomplete: "This version's verified links are incomplete. Nothing was changed.",
        preview_out_of_date: "Something changed since the preview. Preview again; nothing was changed.",
        period_key_not_canonical: "A new earning period must use the publication's own key. Nothing was granted.",
      };
      if (messages[error?.code]) status(messages[error.code], "unavailable");
      else failure(error, "Processing failed. Nothing was granted.");
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    $("ranking-upload-form").addEventListener("submit", uploadRankings);
    $("publish-draft").addEventListener("click", publishDraft);
    $("withdraw-rankings").addEventListener("click", withdraw);
    $("public-name-form").addEventListener("submit", savePublicName);
    $("links-form").addEventListener("submit", previewLinks);
    $("artwork-form").addEventListener("submit", loadArtwork);
    $("artwork-publication").addEventListener("change", () => {
      if (artworkPublication && $("artwork-publication").value !== artworkPublication) closeArtworkReview();
    });
    $("suggest-artwork").addEventListener("click", suggestArtwork);
    $("approve-artwork").addEventListener("click", approveArtwork);
    $("approve-links").addEventListener("click", approveLinks);
    $("links-publication").addEventListener("change", () => void loadCurrentLinks());
    $("download-links").addEventListener("click", downloadCurrentLinks);
    $("rewards-form").addEventListener("submit", previewRewards);
    $("rewards-publication").addEventListener("change", suggestPeriod);
    $("rewards-period").addEventListener("input", () => { $("rewards-preview").hidden = true; rewardsPreviewFor = ""; });
    $("rewards-grant").addEventListener("click", () => void processRewards("grant"));
    $("rewards-reconcile").addEventListener("click", () => void processRewards("reconcile"));
    document.querySelectorAll("[data-queue]").forEach((element) => element.addEventListener("click", () => setQueue(element.dataset.queue)));
    $("staff-nav").addEventListener("click", () => {
      if (canPublish) void loadHistory();
      if (canModerate) void loadQueue();
    });
  }

  function onSession(detail) {
    api = detail.api;
    showPage = detail.showPage;
    const session = detail.session;
    const user = session.authenticated ? session.user : null;
    const verifiedStaff = Boolean(user && user.role !== "student" && !user.mfaRequired && !user.mustChangePassword && api.mode === "production");
    canPublish = verifiedStaff && ["publisher", "admin"].includes(user.role);
    canModerate = verifiedStaff && ["moderator", "admin"].includes(user.role);
    $("staff-nav").hidden = !verifiedStaff;
    $("staff-rankings").hidden = !canPublish;
    $("staff-moderation").hidden = !canModerate;
    $("staff-accounts").hidden = !(verifiedStaff && user.role === "admin");
    $("staff-links").hidden = !(verifiedStaff && user.role === "admin");
    $("staff-rewards").hidden = !(verifiedStaff && user.role === "admin");
    $("staff-artwork").hidden = !canPublish;
    if (canPublish) void loadArtworkPublications();
    if (verifiedStaff && user.role === "admin") { void loadLinkPublications(); void loadRewardPublications(); }
    if (!verifiedStaff) {
      if (!$("page-staff").hidden) showPage("leaderboard");
      return;
    }
    bind();
    status("Signed in with staff verification.", "ready");
  }
  window.addEventListener("arena:session", (event) => onSession(event.detail));
  // The first session may have been announced before this script loaded.
  const announced = window.AcademicArenaSession?.latest();
  if (announced) onSession(announced);
})();
