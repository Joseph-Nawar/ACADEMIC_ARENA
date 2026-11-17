(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const api = window.AcademicArenaDataAccess.createArenaDataAccess();
  const mode = api.mode;
  const characterIds = ["omar", "mariam", "youssef", "amara", "tariq", "habiba2", "malek", "nour2", "zein"];
  const characterLabels = ["WAVE", "BOLD", "CHILL", "SPARK", "CASUAL", "BRAVE", "SUNNY", "CREATIVE", "CALM"];
  const styles = { ink: "COMIC ORIGINAL", cartoon3d: "3D CARTOON" };
  const tones = ["mint", "coral", "gold", "paper", "blue", "lilac"];
  const badges = ["✦", "⚡", "♥", "★", ""];
  const artwork = (base, style = "ink") => `assets/characters/${base}-${style === "cartoon3d" ? "3d" : "ink"}.png`;
  const faceArtwork = (base, style = "ink") => `assets/characters/${base}-${style === "cartoon3d" ? "3d-face.jpg" : "face.png"}`;
  const templates = Object.freeze({
    top3: { title: "TOP THREE!", icon: "🏆", category: "academic", tone: "gold" },
    workshop: { title: "WORKSHOP WIN!", icon: "🎯", category: "consistency", tone: "mint" },
    project: { title: "PROJECT DONE!", icon: "🚀", category: "academic", tone: "blue" },
    helped: { title: "BETTER TOGETHER!", icon: "✦", category: "community", tone: "mint" },
  });
  const reactionTypes = ["heart", "clap", "fire"];
  const reactionIcons = ["❤️", "👏", "🔥"];
  const level = $("level-filter");
  const semester = $("semester-filter");
  const group = $("group-filter");
  const module = $("module-filter");
  const boardState = { kind: "semester", groups: [], modules: {}, selectedCategory: "all" };
  let boardSequence = 0;
  let catalogSequence = 0;
  let winsSequence = 0;
  let currentPage = "leaderboard";
  let session = { authenticated: false };
  let pendingSubmission = null;
  let previewPosts = [];
  const viewerReactions = new Map();
  let activeTotpSecret = "";
  let selectedCategory = "all";
  let choices = { base: "amara", style: "ink", tone: "mint", badge: "✦" };

  function showPage(target) {
    currentPage = target;
    document.querySelectorAll(".page").forEach((section) => {
      section.hidden = section.id !== `page-${target}`;
    });
    document.querySelectorAll(".nav-link").forEach((button) => {
      const active = button.dataset.page === target;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
    if (target === "wins") void loadWins();
  }

  function announce(id, message, state = "info") {
    const target = $(id);
    target.textContent = message;
    target.dataset.state = state;
  }

  function updateFilterButtons() {
    for (const kind of ["semester", "module"]) {
      const active = boardState.kind === kind;
      $(`tab-${kind}`).classList.toggle("active", active);
      $(`tab-${kind}`).setAttribute("aria-pressed", String(active));
    }
    $("module-wrap").hidden = boardState.kind !== "module";
  }

  function currentFilters() {
    return {
      level: level.value,
      semester: semester.value,
      group: group.value,
      kind: boardState.kind,
      module: boardState.kind === "module" ? module.value : "",
    };
  }

  function replaceOptions(select, items, previous, placeholder) {
    select.replaceChildren();
    if (!items.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = placeholder;
      select.append(option);
      select.disabled = true;
      return;
    }
    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.key;
      option.textContent = item.label;
      select.append(option);
    }
    select.disabled = false;
    select.value = items.some((item) => item.key === previous) ? previous : items[0].key;
  }

  async function loadCatalog() {
    const sequence = ++catalogSequence;
    const previousGroup = group.value;
    const previousModule = module.value;
    group.disabled = true;
    module.disabled = true;
    const result = await api.public.getCatalog({ level: level.value, semester: semester.value });
    if (sequence !== catalogSequence) return;
    if (result.state === "unavailable") {
      boardState.groups = [];
      boardState.modules = {};
      replaceOptions(group, [], "", "Cohorts unavailable");
      replaceOptions(module, [], "", "Modules unavailable");
      await loadLeaderboard();
      return;
    }
    if (result.state === "empty" || !result.groups.length) {
      boardState.groups = [];
      boardState.modules = {};
      replaceOptions(group, [], "", "No cohorts available");
      setModules(previousModule);
      boardSequence += 1;
      document.querySelector(".podium-zone").hidden = true;
      document.querySelector(".rank-sheet").hidden = true;
      $("ranking-rows").replaceChildren();
      announce("ranking-status", "No cohorts are available for this level and semester yet.", "empty");
      return;
    }
    boardState.groups = result.groups;
    boardState.modules = result.modules;
    replaceOptions(group, result.groups, previousGroup, "No cohorts available");
    setModules(previousModule);
    await loadLeaderboard();
  }

  function setModules(previous = "") {
    const available = boardState.modules[group.value] || [];
    replaceOptions(module, available, previous, "No modules available");
  }

  function renderBoard(rows) {
    const podium = document.querySelector(".podium-zone");
    const sheet = document.querySelector(".rank-sheet");
    const list = $("ranking-rows");
    list.replaceChildren();
    podium.hidden = rows.length < 3;
    sheet.hidden = rows.length < 3;
    if (rows.length < 3) return;

    const selectedModule = (boardState.modules[group.value] || []).find((item) => item.key === module.value);
    const scope = boardState.kind === "module" ? selectedModule?.label || "Module" : "TOP 3";
    $("podium-label").textContent = `LEVEL ${level.value} / SEM ${semester.value} / ${scope}`;
    $("sheet-subtitle").textContent = boardState.kind === "module"
      ? `${selectedModule?.label || "Module"} · approved top ten`
      : "Seven more names. One leaderboard.";
    for (let position = 1; position <= 3; position += 1) {
      const row = rows.find((item) => item.position === position);
      const image = $(`art-${position}`);
      const name = $(`name-${position}`);
      if (!row) {
        image.removeAttribute("src");
        image.alt = "";
        name.textContent = "—";
        continue;
      }
      image.src = artwork(row.avatar, row.style);
      image.alt = `Illustrated character for rank ${position}`;
      name.textContent = row.name;
    }
    for (const rowData of rows.filter((row) => row.position > 3).slice(0, 7)) {
      const row = document.createElement("li");
      row.className = "rank-row";
      const position = document.createElement("b");
      position.textContent = String(rowData.position).padStart(2, "0");
      const portrait = document.createElement("span");
      portrait.className = "pic";
      const image = document.createElement("img");
      image.src = faceArtwork(rowData.avatar, rowData.style);
      image.alt = "";
      portrait.append(image);
      const name = document.createElement("span");
      name.className = "person";
      name.textContent = rowData.name;
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "›";
      row.append(position, portrait, name, arrow);
      list.append(row);
    }
  }

  async function loadLeaderboard() {
    const sequence = ++boardSequence;
    const podium = document.querySelector(".podium-zone");
    podium.hidden = true;
    document.querySelector(".rank-sheet").hidden = true;
    $("ranking-rows").replaceChildren();
    announce("ranking-status", "Loading approved standings…", "loading");
    if (!group.value) {
      announce("ranking-status", "Standings are temporarily unavailable. Please try again later.", "unavailable");
      return;
    }
    if (boardState.kind === "module" && !module.value) {
      announce("ranking-status", "No modules are available for this selection.", "empty");
      return;
    }
    const result = await api.public.getLeaderboard(currentFilters());
    if (sequence !== boardSequence) return;
    if (result.state === "unavailable") {
      announce("ranking-status", "Standings are temporarily unavailable. Please try again later.", "unavailable");
      return;
    }
    if (result.state === "empty" || !result.rows.length) {
      announce("ranking-status", "No approved standings are available for this selection yet.", "empty");
      return;
    }
    if (result.rows.length < 3) {
      announce("ranking-status", "Not enough approved standings are available for a podium yet.", "empty");
      return;
    }
    renderBoard(result.rows);
    announce("ranking-status", "Showing the approved top ten standings.", "ready");
  }

  function updateCharacterControls() {
    document.querySelectorAll(".base-btn").forEach((button) => {
      const active = button.dataset.base === choices.base;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".style-option").forEach((button) => {
      const active = button.dataset.style === choices.style;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".swatch").forEach((button) => {
      const active = button.dataset.tone === choices.tone;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".badge-choice").forEach((button) => {
      const active = button.dataset.badge === choices.badge;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderStudio() {
    const stage = $("studio-stage");
    stage.dataset.style = choices.style;
    stage.dataset.tone = choices.tone;
    $("studio-art").src = artwork(choices.base, choices.style);
    $("studio-art").alt = `Illustrated character in ${styles[choices.style]} style`;
    $("studio-badge").textContent = choices.badge;
    $("nav-portrait").src = artwork(choices.base, choices.style);
    document.querySelector(".mini-photo").dataset.tone = choices.tone;
    $("base-options").querySelectorAll("img").forEach((image) => {
      image.src = artwork(image.dataset.character, choices.style);
    });
    updateCharacterControls();
  }

  function createPickerOptions() {
    const bases = $("base-options");
    for (let index = 0; index < characterIds.length; index += 1) {
      const id = characterIds[index];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "base-btn";
      button.dataset.base = id;
      const preview = document.createElement("span");
      preview.className = "base-preview";
      const image = document.createElement("img");
      image.dataset.character = id;
      image.alt = "";
      preview.append(image);
      const label = document.createElement("span");
      label.className = "base-name";
      label.textContent = characterLabels[index];
      button.append(preview, label);
      button.addEventListener("click", () => {
        choices.base = id;
        renderStudio();
      });
      bases.append(button);
    }

    const stylesContainer = $("style-options");
    for (const [key, label] of Object.entries(styles)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "style-option";
      button.dataset.style = key;
      const image = document.createElement("img");
      image.src = artwork("amara", key);
      image.alt = "";
      const name = document.createElement("span");
      name.textContent = label;
      button.append(image, name);
      button.addEventListener("click", () => {
        choices.style = key;
        renderStudio();
      });
      stylesContainer.append(button);
    }

    for (const button of document.querySelectorAll(".swatch")) {
      button.addEventListener("click", () => {
        choices.tone = button.dataset.tone;
        renderStudio();
      });
    }
    for (const button of document.querySelectorAll(".badge-choice")) {
      button.addEventListener("click", () => {
        choices.badge = button.dataset.badge;
        renderStudio();
      });
    }
  }

  async function loadSavedCharacter() {
    try {
      const saved = await api.student.getMyCharacter();
      if (saved) choices = { ...choices, ...saved };
    } catch {
      if (mode === "production") $("save-note").textContent = "Sign in with your staff-issued account to load your saved character.";
    }
    renderStudio();
  }

  function openLogin() {
    $("login-backdrop").hidden = false;
    $("login-status").textContent = "";
    renderAccountPanel();
    if (session.authenticated) $("account-status").textContent = "You are signed in to your character account.";
    else $("login-username").focus();
  }

  function clearTotpSetup() {
    activeTotpSecret = "";
    $("mfa-secret").textContent = "";
    $("mfa-secret-panel").hidden = true;
    $("mfa-code-form").reset();
  }

  function renderAccountPanel() {
    const authenticated = session.authenticated === true;
    $("login-form").hidden = authenticated;
    $("account-panel").hidden = !authenticated;
    if (!authenticated) {
      $("mfa-panel").hidden = true;
      return;
    }

    const user = session.user || {};
    const mustChangePassword = user.mustChangePassword === true;
    const needsMfa = user.mfaRequired === true;
    $("mfa-panel").hidden = !needsMfa;
    if (!needsMfa) return;
    if (mustChangePassword) {
      $("mfa-status").textContent = "Change your temporary password before setting up staff verification.";
      $("mfa-enroll-form").hidden = true;
      $("mfa-secret-panel").hidden = true;
      $("mfa-code-form").hidden = true;
    } else if (user.mfaSetupRequired === true) {
      $("mfa-status").textContent = activeTotpSecret
        ? "Add the setup key to your authenticator, then enter its current six-digit code."
        : "Staff accounts must set up an authenticator before using staff tools.";
      $("mfa-enroll-form").hidden = Boolean(activeTotpSecret);
      $("mfa-secret-panel").hidden = !activeTotpSecret;
      $("mfa-code-form").hidden = !activeTotpSecret;
    } else {
      $("mfa-status").textContent = "Enter the current six-digit code from your staff authenticator.";
      $("mfa-enroll-form").hidden = true;
      $("mfa-secret-panel").hidden = true;
      $("mfa-code-form").hidden = false;
    }
  }

  function closeLogin() {
    clearTotpSetup();
    $("login-backdrop").hidden = true;
    $("account-entry").focus();
  }

  function showLoginRequired(message) {
    $("login-status").textContent = message;
    openLogin();
    $("login-status").textContent = message;
  }

  async function renderSession() {
    try {
      session = await api.auth.getSession();
    } catch {
      session = { authenticated: false };
    }
    $("account-entry").textContent = session.authenticated ? "ACCOUNT" : "SIGN IN";
  }

  function renderWinCard(post) {
    const template = templates[post.type];
    if (!template) return null;
    const card = document.createElement("article");
    card.className = "win-post";
    const header = document.createElement("header");
    const avatar = document.createElement("span");
    avatar.className = "win-avatar";
    const image = document.createElement("img");
    image.src = faceArtwork(post.avatar, post.style);
    image.alt = "";
    avatar.append(image);
    const details = document.createElement("div");
    const author = document.createElement("p");
    author.className = "win-author";
    author.textContent = post.author;
    const subtitle = document.createElement("span");
    subtitle.className = "win-sub";
    subtitle.textContent = `${post.created} · ${post.category}`;
    details.append(author, subtitle);
    header.append(avatar, details);

    const tile = document.createElement("div");
    tile.className = "win-sticker";
    tile.dataset.theme = template.tone;
    const title = document.createElement("div");
    title.className = "sticker-text";
    title.textContent = template.title;
    const icon = document.createElement("span");
    icon.className = "sticker-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = template.icon;
    tile.append(title, icon);

    const reactions = document.createElement("div");
    reactions.className = "win-reactions";
    reactionTypes.forEach((reaction, index) => {
      const currentReaction = viewerReactions.has(post.id) ? viewerReactions.get(post.id) : post.myReaction;
      const chosen = currentReaction === reaction;
      const button = document.createElement("button");
      button.className = `react-btn${chosen ? " chosen" : ""}`;
      button.type = "button";
      button.setAttribute("aria-pressed", String(chosen));
      button.setAttribute("aria-label", `${reactionIcons[index]} reaction to an achievement`);
      button.textContent = `${reactionIcons[index]} ${post.counts[index]}`;
      button.addEventListener("click", async () => {
        if (mode === "production" && !session.authenticated) {
          showLoginRequired("Sign in with your staff-issued account to react.");
          return;
        }
        try {
          const result = await api.student.setReaction(post.id, reaction);
          if (result && Object.hasOwn(result, "activeReaction")) {
            viewerReactions.set(post.id, result.activeReaction);
            const previewPost = mode === "demo" ? previewPosts.find((item) => item.id === post.id) : null;
            if (previewPost) {
              const previousIndex = reactionTypes.indexOf(previewPost.myReaction);
              const nextIndex = reactionTypes.indexOf(result.activeReaction);
              if (previousIndex >= 0) previewPost.counts[previousIndex] = Math.max(0, previewPost.counts[previousIndex] - 1);
              if (nextIndex >= 0) previewPost.counts[nextIndex] += 1;
              previewPost.myReaction = result.activeReaction;
            }
          }
          await loadWins();
        } catch {
          announce("wins-status", "Your reaction could not be saved. Please sign in and try again.", "unavailable");
        }
      });
      reactions.append(button);
    });
    card.append(header, tile, reactions);
    return card;
  }

  async function loadWins() {
    const sequence = ++winsSequence;
    announce("wins-status", "Loading approved Campus Wins…", "loading");
    const result = await api.public.getWins(selectedCategory);
    if (sequence !== winsSequence) return;
    const feed = $("wins-feed");
    feed.replaceChildren();
    if (result.state === "unavailable") {
      announce("wins-status", "Campus Wins are temporarily unavailable. Please try again later.", "unavailable");
      return;
    }
    const posts = [...previewPosts, ...result.posts];
    for (const post of posts) {
      const card = renderWinCard(post);
      if (card) feed.append(card);
    }
    if (!posts.length) {
      announce("wins-status", "No approved wins are available in this category yet.", "empty");
      return;
    }
    announce("wins-status", "Showing approved Campus Wins.", "ready");
  }

  function setCategory(category) {
    selectedCategory = category;
    document.querySelectorAll(".wins-filter").forEach((button) => {
      const active = button.dataset.filter === category;
      button.classList.toggle("current", active);
      button.setAttribute("aria-pressed", String(active));
    });
    void loadWins();
  }

  function openComposer() {
    if (mode === "production" && !session.authenticated) {
      showLoginRequired("Sign in with your staff-issued account to submit a milestone.");
      return;
    }
    $("composer-status").textContent = "";
    $("composer-backdrop").hidden = false;
    $("achievement-type").focus();
  }

  async function submitAchievement(event) {
    event.preventDefault();
    const type = $("achievement-type").value;
    try {
      const result = await api.student.submitAchievement({ type });
      pendingSubmission = { type, id: result.id };
      $("composer-backdrop").hidden = true;
      $("pending-description").textContent = `${templates[type].title} · awaiting staff review.`;
      $("approve-demo").hidden = mode !== "demo";
      $("pending-panel").hidden = false;
      showPage("wins");
      announce("wins-status", "Your milestone was submitted for staff review.", "ready");
    } catch {
      $("composer-status").textContent = "The submission could not be saved. Please sign in and try again.";
    }
  }

  async function approveDemoSubmission() {
    if (mode !== "demo" || !pendingSubmission) return;
    const template = templates[pendingSubmission.type];
    previewPosts.unshift({
      id: pendingSubmission.id,
      author: "You (demo)",
      avatar: choices.base,
      style: choices.style,
      type: pendingSubmission.type,
      category: template.category,
      created: "just now",
      counts: [0, 0, 0],
      myReaction: null,
    });
    previewPosts = previewPosts.slice(0, 10);
    pendingSubmission = null;
    $("pending-panel").hidden = true;
    setCategory("all");
  }

  async function saveCharacter() {
    if (mode === "production" && !session.authenticated) {
      showLoginRequired("Sign in with your staff-issued account to save your character.");
      return;
    }
    try {
      await api.student.saveCharacter(choices);
      $("save-status").textContent = mode === "demo"
        ? "Fictional character saved in this browser."
        : "Character saved to your account.";
    } catch {
      $("save-status").textContent = "Your character could not be saved. Sign in and try again.";
    }
  }

  function closeComposer() {
    $("composer-backdrop").hidden = true;
    $("open-composer").focus();
  }

  function bindEvents() {
    $("tab-semester").addEventListener("click", () => {
      boardState.kind = "semester";
      updateFilterButtons();
      void loadLeaderboard();
    });
    $("tab-module").addEventListener("click", () => {
      boardState.kind = "module";
      updateFilterButtons();
      void loadLeaderboard();
    });
    level.addEventListener("change", () => void loadCatalog());
    semester.addEventListener("change", () => void loadCatalog());
    group.addEventListener("change", () => {
      setModules();
      void loadLeaderboard();
    });
    module.addEventListener("change", () => void loadLeaderboard());
    document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
    $("profile-link").addEventListener("click", () => showPage("avatar"));
    $("create-button").addEventListener("click", () => showPage("avatar"));
    $("see-wins").addEventListener("click", () => showPage("wins"));
    $("save-character").addEventListener("click", () => void saveCharacter());
    $("open-composer").addEventListener("click", openComposer);
    $("close-composer").addEventListener("click", closeComposer);
    $("composer-backdrop").addEventListener("click", (event) => {
      if (event.target === $("composer-backdrop")) closeComposer();
    });
    $("achievement-form").addEventListener("submit", (event) => void submitAchievement(event));
    $("approve-demo").addEventListener("click", () => void approveDemoSubmission());
    document.querySelectorAll(".wins-filter").forEach((button) => button.addEventListener("click", () => setCategory(button.dataset.filter)));
    $("account-entry").addEventListener("click", openLogin);
    $("close-login").addEventListener("click", closeLogin);
    $("login-backdrop").addEventListener("click", (event) => {
      if (event.target === $("login-backdrop")) closeLogin();
    });
    $("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("login-status").textContent = "Signing in…";
      try {
        session = await api.auth.signIn({
          username: $("login-username").value,
          password: $("login-password").value,
        });
        if (!session.authenticated) throw new Error("Sign-in failed");
        viewerReactions.clear();
        $("login-form").reset();
        $("account-entry").textContent = "ACCOUNT";
        renderAccountPanel();
        $("account-status").textContent = "You are signed in to your character account.";
        if (session.user.mustChangePassword) $("account-status").textContent += " Change your initial password before continuing.";
        else if (session.user.mfaRequired) $("account-status").textContent = "Complete the staff security check to continue.";
      } catch {
        $("login-status").textContent = "Could not sign you in. Check your details or try again later.";
      }
    });
    $("mfa-enroll-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("mfa-status").textContent = "Preparing your authenticator setup…";
      try {
        const enrollment = await api.auth.enrollMfa();
        activeTotpSecret = enrollment.secret;
        $("mfa-secret").textContent = enrollment.secret;
        renderAccountPanel();
        $("mfa-code").focus();
      } catch {
        $("mfa-status").textContent = "Authenticator setup could not be started. Try again later.";
      }
    });
    $("mfa-code-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("mfa-code-form").querySelector('button[type="submit"]');
      button.disabled = true;
      $("mfa-status").textContent = "Checking your authenticator…";
      try {
        session = await api.auth.verifyMfa($("mfa-code").value);
        if (!session.authenticated || session.user.mfaRequired) throw new Error("MFA verification failed");
        clearTotpSetup();
        renderAccountPanel();
        $("account-status").textContent = "Staff verification is complete.";
      } catch {
        $("mfa-code").value = "";
        $("mfa-status").textContent = "Code could not be verified. Check it and try again.";
      } finally {
        button.disabled = false;
      }
    });
    $("change-password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const oldPassword = $("old-password").value;
      const newPassword = $("new-password").value;
      try {
        await api.auth.changePassword(oldPassword, newPassword);
        $("change-password-form").reset();
        session = { authenticated: false };
        clearTotpSetup();
        $("account-entry").textContent = "SIGN IN";
        renderAccountPanel();
        $("login-status").textContent = "Password changed. Sign in again to continue.";
        $("login-form").hidden = false;
      } catch {
        $("account-status").textContent = "Password change could not be completed. Check the new password or try again later.";
      }
    });
    $("logout-btn").addEventListener("click", async () => {
      try {
        await api.auth.signOut();
        session = { authenticated: false };
        viewerReactions.clear();
        clearTotpSetup();
        $("account-entry").textContent = "SIGN IN";
        renderAccountPanel();
        $("login-status").textContent = "You are signed out.";
      } catch {
        $("account-status").textContent = "Sign-out could not be confirmed. Close this browser session and try again.";
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (!$("composer-backdrop").hidden) closeComposer();
        if (!$("login-backdrop").hidden) closeLogin();
      }
    });
  }

  async function start() {
    document.documentElement.dataset.appMode = mode;
    $("mode-stamp").hidden = mode !== "demo";
    $("approve-demo").hidden = mode !== "demo";
    if (mode === "production") $("save-note").textContent = "Your character is private to your account. Staff-issued sign-in is required to save changes.";
    createPickerOptions();
    renderStudio();
    updateFilterButtons();
    bindEvents();
    await Promise.all([loadCatalog(), loadWins(), renderSession(), loadSavedCharacter()]);
    document.documentElement.dataset.appReady = "true";
  }

  void start();
})();
