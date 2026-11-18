/* Staff desk: ranking publication and Campus Wins moderation. Authorization is
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

  let linkCsv = "";
  let linkPublication = "";

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
      const result = await api.staff.previewRankingLinks(publicationId, csv);
      const list = $("links-list");
      list.replaceChildren();
      if (!result.links.length) list.append(textNode("li", "No links: approving clears every link for this publication."));
      for (const item of result.links) {
        list.append(textNode("li", `Level ${item.level} · rank ${item.position} · ${item.publicName} → ${item.username} (${item.accountStatus}) · ${linkStates[item.previous] || item.previous}`));
      }
      linkCsv = csv;
      linkPublication = publicationId;
      $("links-preview").hidden = false;
      status("Check every identity privately, then approve.", "ready");
    } catch (error) {
      for (const detail of error?.details || []) {
        $("links-errors").append(textNode("li", detail.line ? `Line ${detail.line}: ${detail.message}` : detail.message));
      }
      failure(error, "The link file could not be validated.");
    }
  }

  async function approveLinks() {
    if (!linkCsv || !window.confirm("Approve these private account links for this publication?")) return;
    try {
      const result = await api.staff.approveRankingLinks(linkPublication, linkCsv);
      status(`${result.linked} account link(s) approved.`, "ready");
      $("links-preview").hidden = true;
      $("links-form").reset();
      linkCsv = "";
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

  function bind() {
    if (bound) return;
    bound = true;
    $("ranking-upload-form").addEventListener("submit", uploadRankings);
    $("publish-draft").addEventListener("click", publishDraft);
    $("withdraw-rankings").addEventListener("click", withdraw);
    $("public-name-form").addEventListener("submit", savePublicName);
    $("links-form").addEventListener("submit", previewLinks);
    $("approve-links").addEventListener("click", approveLinks);
    document.querySelectorAll("[data-queue]").forEach((element) => element.addEventListener("click", () => setQueue(element.dataset.queue)));
    $("staff-nav").addEventListener("click", () => {
      if (canPublish) void loadHistory();
      if (canModerate) void loadQueue();
    });
  }

  window.addEventListener("arena:session", (event) => {
    api = event.detail.api;
    showPage = event.detail.showPage;
    const session = event.detail.session;
    const user = session.authenticated ? session.user : null;
    const verifiedStaff = Boolean(user && user.role !== "student" && !user.mfaRequired && !user.mustChangePassword && api.mode === "production");
    canPublish = verifiedStaff && ["publisher", "admin"].includes(user.role);
    canModerate = verifiedStaff && ["moderator", "admin"].includes(user.role);
    $("staff-nav").hidden = !verifiedStaff;
    $("staff-rankings").hidden = !canPublish;
    $("staff-moderation").hidden = !canModerate;
    $("staff-accounts").hidden = !(verifiedStaff && user.role === "admin");
    $("staff-links").hidden = !(verifiedStaff && user.role === "admin");
    if (verifiedStaff && user.role === "admin") void loadLinkPublications();
    if (!verifiedStaff) {
      if (!$("page-staff").hidden) showPage("leaderboard");
      return;
    }
    bind();
    status("Signed in with staff verification.", "ready");
  });
})();
