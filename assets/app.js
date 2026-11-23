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
  // Board artwork: a linked, opted-in student's own character in the style,
  // backdrop and sticker they saved; otherwise the 3D character staff approved
  // for that publication row; with neither, a neutral illustration (never a
  // guess from a name, rank, or record).
  const boardStyle = (row) => (row.personalized ? row.style : "cartoon3d");
  const boardArtwork = (row) => (row.avatar ? artwork(row.avatar, boardStyle(row)) : `assets/competitors/podium-${row.position}.svg`);
  const boardThumbnail = (row) => (row.avatar ? faceArtwork(row.avatar, boardStyle(row)) : `assets/competitors/thumb-${"abc"[(row.position - 4) % 3]}.svg`);
  const artKind = (row) => (row.personalized ? "personal" : row.avatar ? "default" : "neutral");
  const templates = Object.freeze({
    top3: { title: "TOP THREE!", icon: "🏆", category: "academic", tone: "gold" },
    workshop: { title: "WORKSHOP WIN!", icon: "🎯", category: "consistency", tone: "mint" },
    project: { title: "PROJECT DONE!", icon: "🚀", category: "academic", tone: "blue" },
    helped: { title: "BETTER TOGETHER!", icon: "✦", category: "community", tone: "mint" },
  });
  const reactionTypes = ["heart", "clap", "fire"];
  const reactionIcons = ["❤️", "👏", "🔥"];
  // V1: one public board per level (4, 5, 6). Semester/module boards are a later version.
  const boardState = { level: "4" };
  let boardSequence = 0;
  let lastBoardLoad = 0;
  let winsSequence = 0;
  let currentPage = "leaderboard";
  let session = { authenticated: false };
  let pendingSubmission = null;
  let previewPosts = [];
  const viewerReactions = new Map();
  let activeTotpSecret = "";
  let selectedCategory = "all";
  const DEFAULT_CHOICES = Object.freeze({ base: "amara", style: "ink", tone: "mint", badge: "✦" });
  let choices = { ...DEFAULT_CHOICES };
  // What the server last confirmed for the signed-in student: the saved look,
  // their public-display choice, and whether the public board shows it.
  let savedLook = null;
  let publicationState = null;
  // Every session change goes through applySession(); the epoch lets a slow
  // background session check be discarded if a sign-in, sign-out or password
  // change happened while it was in flight.
  let sessionEpoch = 0;
  let lastSessionCheck = 0;
  let sessionResolved = false;
  let passwordFormOpen = false;
  let lastUsername = "";
  let features = { studentSignIn: false, avatarPersonalization: false, welcomeDialog: false };
  const WELCOME_KEY = "arena-welcome-dismissed";
  const WELCOME_VERSION = "v1";
  let welcomeReturnFocus = null;

  // My Character and other student-only controls need a server-verified student
  // session with a completed password (the fictional demo has no accounts).
  function characterAccess() {
    if (mode === "demo") return true;
    const user = session.user || {};
    return session.authenticated === true && features.studentSignIn === true &&
      user.role === "student" && user.mustChangePassword !== true;
  }

  function showPage(target) {
    if (target === "avatar" && !characterAccess()) {
      // A temporary password must be replaced first; anyone else goes to a public page.
      if (session.authenticated && session.user?.mustChangePassword) openLogin();
      target = "leaderboard";
    }
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
    // Refetch on every visit so an open tab never keeps showing withdrawn or replaced standings.
    if (target === "leaderboard") void loadLeaderboard();
  }

  function announce(id, message, state = "info") {
    const target = $(id);
    target.textContent = message;
    target.dataset.state = state;
  }

  function updateLevelButtons() {
    document.querySelectorAll(".level-tabs [data-level]").forEach((button) => {
      const active = button.dataset.level === boardState.level;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  // Visible short label; the complete approved name stays available as a tooltip
  // and as the accessible name.
  function setPublicName(element, shortName, fullName) {
    element.replaceChildren();
    if (shortName === fullName) {
      element.textContent = fullName;
      element.removeAttribute("title");
      return;
    }
    const visible = document.createElement("span");
    visible.setAttribute("aria-hidden", "true");
    visible.textContent = shortName;
    const full = document.createElement("span");
    full.className = "sr-only";
    full.textContent = fullName;
    element.append(visible, full);
    element.title = fullName;
  }

  function renderBoard(rows) {
    const podium = document.querySelector(".podium-zone");
    const sheet = document.querySelector(".rank-sheet");
    const list = $("ranking-rows");
    list.replaceChildren();
    podium.hidden = rows.length < 3;
    sheet.hidden = rows.length < 3;
    if (rows.length < 3) return;

    $("podium-label").textContent = `LEVEL ${boardState.level} / TOP 3`;
    const shortNames = window.AcademicArenaDisplayNames.shortDisplayNames(rows.map((row) => row.name));
    const visibleName = (rowData) => shortNames[rows.indexOf(rowData)];
    $("sheet-subtitle").textContent = "Ranks 4 to 10";
    for (let position = 1; position <= 3; position += 1) {
      const row = rows.find((item) => item.position === position);
      const image = $(`art-${position}`);
      const name = $(`name-${position}`);
      if (!row) {
        image.removeAttribute("src");
        image.alt = "";
        name.replaceChildren("—");
        name.removeAttribute("title");
        setPersonalTouches(image.closest(".competitor"), {});
        continue;
      }
      image.src = boardArtwork(row);
      image.alt = row.personalized ? `Character chosen by the rank ${position} student`
        : row.avatar ? `Illustrated character for rank ${position}` : `Neutral illustration for rank ${position}`;
      const competitor = image.closest(".competitor");
      competitor.dataset.art = artKind(row);
      competitor.dataset.style = boardStyle(row);
      setPersonalTouches(competitor, row);
      setPublicName(name, visibleName(row), row.name);
    }
    for (const rowData of rows.filter((row) => row.position > 3).slice(0, 7)) {
      const row = document.createElement("li");
      row.className = "rank-row";
      const position = document.createElement("b");
      position.textContent = String(rowData.position).padStart(2, "0");
      const portrait = document.createElement("span");
      portrait.className = "pic";
      const image = document.createElement("img");
      image.src = boardThumbnail(rowData);
      image.alt = "";
      portrait.dataset.art = artKind(rowData) === "neutral" ? "anonymous" : artKind(rowData);
      portrait.append(image);
      setPersonalTouches(portrait, rowData);
      const name = document.createElement("span");
      name.className = "person";
      setPublicName(name, visibleName(rowData), rowData.name);
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "›";
      row.append(position, portrait, name, arrow);
      list.append(row);
    }
  }

  // The student's saved backdrop and sticker, only on their own opted-in row.
  // The sticker is decorative (the image's alt text already names the row).
  function setPersonalTouches(container, row) {
    container.querySelector(":scope > .board-sticker")?.remove();
    if (!row.personalized) {
      delete container.dataset.tone;
      return;
    }
    container.dataset.tone = row.tone;
    if (row.badge) {
      const sticker = document.createElement("span");
      sticker.className = "board-sticker";
      sticker.setAttribute("aria-hidden", "true");
      sticker.textContent = row.badge;
      container.append(sticker);
    }
  }

  async function loadLeaderboard() {
    lastBoardLoad = Date.now();
    const sequence = ++boardSequence;
    const podium = document.querySelector(".podium-zone");
    podium.hidden = true;
    document.querySelector(".rank-sheet").hidden = true;
    $("ranking-rows").replaceChildren();
    announce("ranking-status", "Loading approved standings…", "loading");
    const result = await api.public.getLeaderboard({ level: boardState.level });
    if (sequence !== boardSequence) return;
    // Only name a release (e.g. "Week 5") when a publication actually carries that label.
    $("leaderboard-subtitle").textContent = result.releaseLabel ? `${result.releaseLabel} · Quiz Leaderboard` : "Quiz Leaderboard";
    if (result.state === "unavailable") {
      announce("ranking-status", "Standings are temporarily unavailable. Please try again later.", "unavailable");
      return;
    }
    if (result.state === "empty" || !result.rows.length) {
      announce("ranking-status", `No approved standings are published for Level ${boardState.level} yet.`, "empty");
      return;
    }
    if (result.rows.length < 3) {
      announce("ranking-status", "Not enough approved standings are available for a podium yet.", "empty");
      return;
    }
    renderBoard(result.rows);
    announce("ranking-status", `Showing the approved Level ${boardState.level} top ten.`, "ready");
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
    $("base-options").querySelectorAll("img").forEach((image) => {
      image.src = artwork(image.dataset.character, choices.style);
    });
    updateCharacterControls();
    renderPublicationState();
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

  // The header portrait shows the signed-in student's saved character, else the anonymous one.
  function showSavedPortrait() {
    $("nav-portrait").src = artwork(choices.base, choices.style);
    document.querySelector(".mini-photo").dataset.tone = choices.tone;
    document.querySelector(".mini-photo").dataset.art = "personal";
  }

  async function loadSavedCharacter() {
    const epoch = sessionEpoch;
    try {
      const saved = await api.student.getMyCharacter();
      if (epoch !== sessionEpoch) return;
      if (saved) {
        const { showOnLeaderboard, publication, ...look } = saved;
        choices = { ...choices, ...look };
        $("show-on-leaderboard").checked = showOnLeaderboard === true;
        savedLook = { ...look, showOnLeaderboard: showOnLeaderboard === true };
        publicationState = publication;
        showSavedPortrait();
      } else {
        savedLook = null;
        publicationState = "not_saved";
      }
    } catch (error) {
      if (epoch !== sessionEpoch) return;
      if (error?.code === "unauthorized") return void sessionEnded();
      savedLook = null;
      publicationState = "unknown";
      if (mode === "production") $("save-note").textContent = "Your saved character could not be loaded. Try again later.";
    }
    renderStudio();
  }

  // One truthful line about where the saved character is visible. The state
  // comes from the server (see my_character_publication_state); the browser
  // never upgrades it, and unsaved edits are called out as not public.
  const PUBLICATION_COPY = Object.freeze({
    not_saved: ["NOT SAVED YET", "Nothing is saved or public yet. Save to keep this character on your account."],
    saved_private: ["SAVED PRIVATELY", "Only you can see it. Showing characters on public leaderboards isn’t switched on yet, so leaderboards show the default character."],
    display_off: ["PUBLIC DISPLAY OFF", "Saved to your account. Leaderboards show the default character for your rank. To change that, tick “Show my character on public leaderboards” and save."],
    awaiting_link: ["AWAITING STAFF VERIFICATION", "Public display is on, but your character is not on a leaderboard yet. It appears only if you are in a published top 10 and staff have verified which ranking is yours. You don’t need to do anything else."],
    public: ["PUBLIC NOW", "Your character is on the current leaderboard. Changes you save appear there the next time anyone loads it."],
    unknown: ["STATUS UNAVAILABLE", "We couldn’t check whether your character is public. Try again later."],
  });

  function hasUnsavedChanges() {
    if (!savedLook) return true;
    return ["base", "style", "tone", "badge"].some((key) => savedLook[key] !== choices[key]) ||
      (features.avatarPersonalization && savedLook.showOnLeaderboard !== $("show-on-leaderboard").checked);
  }

  function renderPublicationState() {
    const panel = $("publication-state");
    const visible = mode === "production" && characterAccess() && publicationState !== null;
    panel.hidden = !visible;
    if (!visible) return;
    const state = Object.hasOwn(PUBLICATION_COPY, publicationState) ? publicationState : "unknown";
    const [label, text] = PUBLICATION_COPY[state];
    panel.dataset.state = state;
    $("publication-state-label").textContent = label;
    $("publication-state-text").textContent = text;
    const unsaved = state !== "not_saved" && state !== "unknown" && hasUnsavedChanges();
    $("publication-state-unsaved").hidden = !unsaved;
  }

  // Back to the default studio look (sign-out on a shared device leaves nothing behind).
  function resetCharacter() {
    choices = { ...DEFAULT_CHOICES };
    savedLook = null;
    publicationState = null;
    $("show-on-leaderboard").checked = false;
    $("save-status").textContent = "";
    resetPortrait();
    renderStudio();
  }

  // The studio's note always matches who is signed in.
  function renderSaveNote() {
    if (mode !== "production") return;
    const user = session.user || {};
    let note = "Sign in with your Arena account to save.";
    if (session.authenticated && user.role !== "student") note = "Saving a character is for student accounts.";
    else if (session.authenticated && user.mustChangePassword) note = "Set your own password first (ACCOUNT, top right), then save your character.";
    else if (session.authenticated) {
      note = features.avatarPersonalization
        ? "Saved to your Arena account."
        : "Saved to your Arena account. Showing characters on public leaderboards isn’t switched on yet.";
    }
    $("save-note").textContent = note;
  }

  function welcomeDismissed() {
    try {
      return window.localStorage.getItem(WELCOME_KEY) === WELCOME_VERSION;
    } catch {
      return false;
    }
  }

  // Shown once per browser (per onboarding version), only when the database
  // owner has enabled student accounts and the welcome switch, and never to a
  // signed-in visitor. Dismissal stores only a version marker.
  function maybeShowWelcome() {
    if (!features.welcomeDialog || !features.studentSignIn || session.authenticated || welcomeDismissed()) return;
    welcomeReturnFocus = document.activeElement;
    $("welcome-backdrop").hidden = false;
    $("welcome-signin").focus();
  }

  function closeWelcome(remember = true) {
    if ($("welcome-backdrop").hidden) return;
    $("welcome-backdrop").hidden = true;
    if (remember) {
      try {
        window.localStorage.setItem(WELCOME_KEY, WELCOME_VERSION);
      } catch {
        // Storage unavailable: the dialog may appear again on a later visit.
      }
    }
    if (welcomeReturnFocus && typeof welcomeReturnFocus.focus === "function") welcomeReturnFocus.focus();
  }

  function trapWelcomeFocus(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWelcome();
      return;
    }
    trapTab(event, $("welcome-backdrop"));
  }

  // Keeps Tab inside an open modal dialog (only visible, enabled controls count).
  function trapTab(event, container) {
    if (event.key !== "Tab") return;
    const focusable = [...container.querySelectorAll("button, input, select, a[href]")]
      .filter((element) => !element.disabled && element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openLogin() {
    $("login-backdrop").hidden = false;
    $("login-status").textContent = "";
    renderAccountForms();
    focusAccountAction();
  }

  // Puts focus on the one thing the visitor should do next.
  function focusAccountAction() {
    if ($("login-backdrop").hidden) return;
    const user = session.user || {};
    if (!session.authenticated) {
      if (lastUsername && !$("login-username").value) $("login-username").value = lastUsername;
      ($("login-username").value ? $("login-password") : $("login-username")).focus();
    } else if (!$("password-section").hidden) $("old-password").focus();
    else if (user.mfaRequired) $("mfa-panel").querySelector("form:not([hidden]) button, form:not([hidden]) input")?.focus();
    else if (!$("student-next").hidden) $("open-studio").focus();
    else if (!$("staff-next").hidden) $("open-staff-desk").focus();
    else $("close-account").focus();
  }

  function clearTotpSetup() {
    activeTotpSecret = "";
    $("mfa-secret").textContent = "";
    $("mfa-secret-panel").hidden = true;
    $("mfa-code-form").reset();
  }

  function applySession(next) {
    sessionEpoch += 1;
    sessionResolved = true;
    lastSessionCheck = Date.now();
    const wasAuthenticated = session.authenticated === true;
    session = next && next.authenticated === true ? next : { authenticated: false };
    if (!session.authenticated) {
      passwordFormOpen = false;
      clearTotpSetup();
      $("change-password-form").reset();
      $("password-status").textContent = "";
      if (wasAuthenticated) resetCharacter();
    }
    renderAccountForms();
    void onSessionChanged();
  }

  // The server ended the session (expiry, revocation): show it honestly.
  function sessionEnded(message = "Your session has ended. Sign in again to continue.") {
    applySession({ authenticated: false });
    showLoginRequired(message);
  }

  const submissionLabels = Object.freeze({
    pending: "awaiting staff review",
    approved: "published",
    rejected: "not approved",
    not_shown: "no longer shown",
  });

  function renderSubmissions(submissions) {
    const list = $("my-submissions");
    list.replaceChildren();
    for (const item of submissions.slice(0, 5)) {
      const entry = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = templates[item.type].title;
      const state = document.createElement("span");
      state.className = "staff-state";
      state.dataset.state = item.status;
      state.textContent = submissionLabels[item.status];
      const date = document.createElement("span");
      date.textContent = item.created;
      entry.append(title, state, date);
      list.append(entry);
    }
    $("pending-description").textContent = submissions.length
      ? "Your recent milestones and their review status."
      : "";
    $("pending-panel").hidden = submissions.length === 0;
  }

  // Back to the anonymous header portrait (e.g. after sign-out on a shared device).
  function resetPortrait() {
    $("nav-portrait").src = "assets/competitors/thumb-a.svg";
    const frame = document.querySelector(".mini-photo");
    frame.dataset.art = "anonymous";
    delete frame.dataset.tone;
  }

  // Runs after every session change: account button, student-private data, staff desk.
  function renderHeader() {
    const user = session.user || {};
    const entry = $("account-entry");
    entry.textContent = session.authenticated ? "ACCOUNT" : "SIGN IN";
    entry.title = session.authenticated ? "Your Arena account" : "Sign in";
    entry.dataset.state = !session.authenticated ? "signed-out"
      : user.mustChangePassword || user.mfaRequired ? "action-needed" : "signed-in";
    document.documentElement.dataset.session = !session.authenticated ? "none"
      : user.role !== "student" ? "staff" : user.mustChangePassword ? "student-setup" : "student";
    const access = characterAccess();
    document.documentElement.dataset.characterAccess = access ? "on" : "off";
    if (!access) {
      // Leave a protected page and close student-only dialogs the moment access ends.
      if (currentPage === "avatar") showPage("leaderboard");
      if (!$("composer-backdrop").hidden) $("composer-backdrop").hidden = true;
    }
  }

  async function onSessionChanged() {
    const epoch = sessionEpoch;
    if (!session.authenticated) resetPortrait();
    renderHeader();
    renderSaveNote();
    window.dispatchEvent(new CustomEvent("arena:session", { detail: { session, api, showPage } }));
    if (mode !== "production") return;
    const user = session.user || {};
    const student = session.authenticated && user.role === "student" && !user.mustChangePassword;
    if (session.authenticated) closeWelcome(false);
    viewerReactions.clear();
    if (student) void loadSavedCharacter();
    if (!student) {
      renderSubmissions([]);
      if (currentPage === "wins") void loadWins();
      return;
    }
    try {
      const [reactions, submissions] = await Promise.all([api.student.getMyReactions(), api.student.getMySubmissions()]);
      if (epoch !== sessionEpoch) return;
      for (const [id, reaction] of Object.entries(reactions)) viewerReactions.set(id, reaction);
      renderSubmissions(submissions);
    } catch {
      renderSubmissions([]);
    }
    if (currentPage === "wins") void loadWins();
  }

  function accountStatusText() {
    const user = session.user || {};
    if (user.mustChangePassword) return "You’re signed in with a temporary password. Set your own password to continue.";
    if (user.mfaRequired) return "Complete the staff security check to continue.";
    if (user.role !== "student") return "Signed in to your staff account. Staff verification is complete.";
    return "You’re signed in.";
  }

  function renderAccountForms() {
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
    const ready = !mustChangePassword && !needsMfa;
    $("account-status").textContent = accountStatusText();
    $("student-next").hidden = !(ready && user.role === "student");
    $("staff-next").hidden = !(ready && user.role !== "student");
    // The password form appears only when it is required (temporary password)
    // or when the person chose CHANGE PASSWORD; otherwise it stays tucked away.
    const showPassword = mustChangePassword || passwordFormOpen;
    $("password-section").hidden = !showPassword;
    $("password-title").textContent = mustChangePassword ? "SET YOUR OWN PASSWORD" : "CHANGE PASSWORD";
    const afterChange = user.role === "student"
      ? "You’ll stay signed in; use it next time you sign in."
      : "You’ll then sign in again with it.";
    $("password-help").textContent = mustChangePassword
      ? `You signed in with a temporary password from university staff. Choose your own (15–128 characters). ${afterChange}`
      : `Choose a new password of 15–128 characters. ${afterChange}`;
    // Lets password managers save the new password for the right account.
    $("password-username").value = lastUsername;
    $("cancel-password-change").hidden = mustChangePassword;
    $("show-password-change").hidden = showPassword;
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

  // Asks the server who is signed in. A result is dropped if the session
  // changed meanwhile; a failed check is retried once rather than shown as
  // signed out.
  async function renderSession() {
    const epoch = sessionEpoch;
    let next = await api.auth.getSession();
    if (next.unavailable && epoch === sessionEpoch) {
      await new Promise((resolve) => { setTimeout(resolve, 1200); });
      next = await api.auth.getSession();
    }
    if (epoch !== sessionEpoch) return;
    lastSessionCheck = Date.now();
    if (next.unavailable) {
      // Keep a known signed-in state; never show a failed check as "signed out" silently.
      if (!session.authenticated) $("account-entry").title = "Couldn’t check your sign-in. Try again shortly.";
      return;
    }
    // Same person, same state: nothing to re-render (keeps unsaved studio edits and staff messages).
    if (sameSessionState(session, next)) return;
    applySession(next);
  }

  function sameSessionState(current, next) {
    if (!sessionResolved || current.authenticated !== next.authenticated) return false;
    if (!next.authenticated) return true;
    const a = current.user || {};
    const b = next.user || {};
    return ["role", "mustChangePassword", "mfaRequired", "mfaSetupRequired"].every((key) => a[key] === b[key]);
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
      // Until student sign-in is enabled, counts are read-only (no dead-end sign-in prompt).
      if (!features.studentSignIn) {
        button.disabled = true;
        button.title = "Reactions open when student accounts launch.";
      }
      button.addEventListener("click", async () => {
        if (mode === "production" && !session.authenticated) {
          showLoginRequired("Sign in with your Arena account to react.");
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
      showLoginRequired("Sign in with your Arena account to share a milestone.");
      return;
    }
    if (!characterAccess()) return;
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
      if (mode === "demo") {
        $("pending-description").textContent = `${templates[type].title} · awaiting staff review.`;
        $("pending-panel").hidden = false;
      } else {
        renderSubmissions(await api.student.getMySubmissions().catch(() => []));
      }
      $("approve-demo").hidden = mode !== "demo";
      showPage("wins");
      announce("wins-status", "Your milestone was submitted for staff review.", "ready");
    } catch (error) {
      const messages = {
        submission_pending: "You already have a milestone waiting for staff review.",
        weekly_limit: "You can share one milestone every seven days. Please try again later.",
        public_name_required: "Staff need to approve your public name before you can share a milestone.",
        password_change_required: "Change your temporary password before sharing a milestone.",
        forbidden: "Only student accounts can share milestones.",
      };
      $("composer-status").textContent = messages[error?.code] || "The submission could not be saved. Please sign in and try again.";
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
      showLoginRequired("Sign in with your Arena account to save your character.");
      return;
    }
    if (mode === "production" && session.user?.mustChangePassword) {
      openLogin();
      return;
    }
    if (mode === "production" && session.user?.role !== "student") {
      $("save-status").textContent = "Saving a character is for student accounts.";
      return;
    }
    try {
      const publicChoice = features.avatarPersonalization ? $("show-on-leaderboard").checked : undefined;
      const result = await api.student.saveCharacter(choices, publicChoice);
      showSavedPortrait();
      if (mode === "demo") {
        $("save-status").textContent = "Fictional character saved in this browser. The fictional preview never publishes it.";
      } else {
        // The server's answer after the save is the only source for the state line.
        savedLook = result.avatar ? { ...result.avatar, showOnLeaderboard: result.showOnLeaderboard } : null;
        publicationState = result.publication;
        $("save-status").textContent = "Character saved to your account.";
        renderPublicationState();
      }
      if (currentPage === "leaderboard" || publicChoice !== undefined) void loadLeaderboard();
    } catch (error) {
      if (error?.code === "unauthorized") return void sessionEnded("Your session has ended. Sign in again to save your character.");
      $("save-status").textContent = "Your character could not be saved. Try again later.";
    }
  }

  function closeComposer() {
    $("composer-backdrop").hidden = true;
    $("open-composer").focus();
  }

  function bindEvents() {
    document.querySelectorAll(".level-tabs [data-level]").forEach((button) => button.addEventListener("click", () => {
      boardState.level = button.dataset.level;
      updateLevelButtons();
      void loadLeaderboard();
    }));
    document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
    $("profile-link").addEventListener("click", () => showPage("avatar"));
    $("create-button").addEventListener("click", () => showPage("avatar"));
    $("see-wins").addEventListener("click", () => showPage("wins"));
    $("save-character").addEventListener("click", () => void saveCharacter());
    $("show-on-leaderboard").addEventListener("change", renderPublicationState);
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
      const button = $("login-form").querySelector('button[type="submit"]');
      button.disabled = true;
      $("login-status").textContent = "Signing in…";
      const username = $("login-username").value;
      try {
        const next = await api.auth.signIn({ username, password: $("login-password").value });
        if (!next.authenticated) throw new Error("Sign-in failed");
        lastUsername = username.trim();
        viewerReactions.clear();
        $("login-form").reset();
        $("login-status").textContent = "";
        applySession(next);
        // A student with their own password is done: close the dialog so the
        // board and My Character are right there. Temporary passwords and
        // staff security checks keep the dialog open for the required step.
        if (next.user.role === "student" && !next.user.mustChangePassword) closeLogin();
        else focusAccountAction();
      } catch (error) {
        $("login-password").value = "";
        $("login-status").textContent = error?.code === "rate_limited"
          ? "Too many attempts. Wait a few minutes, then try again."
          : error?.code === "invalid_credentials"
            ? "Could not sign you in. Check your username and password."
            : "Sign-in is temporarily unavailable. Try again later.";
      } finally {
        button.disabled = false;
      }
    });
    $("mfa-enroll-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("mfa-status").textContent = "Preparing your authenticator setup…";
      try {
        const enrollment = await api.auth.enrollMfa();
        activeTotpSecret = enrollment.secret;
        $("mfa-secret").textContent = enrollment.secret;
        renderAccountForms();
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
        const next = await api.auth.verifyMfa($("mfa-code").value);
        if (!next.authenticated || next.user.mfaRequired) throw new Error("MFA verification failed");
        clearTotpSetup();
        applySession(next);
        focusAccountAction();
      } catch {
        $("mfa-code").value = "";
        $("mfa-status").textContent = "Code could not be verified. Check it and try again.";
      } finally {
        button.disabled = false;
      }
    });
    $("show-password-change").addEventListener("click", () => {
      passwordFormOpen = true;
      renderAccountForms();
      $("old-password").focus();
    });
    $("cancel-password-change").addEventListener("click", () => {
      passwordFormOpen = false;
      $("change-password-form").reset();
      $("password-status").textContent = "";
      renderAccountForms();
      $("show-password-change").focus();
    });
    $("change-password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const oldPassword = $("old-password").value;
      const newPassword = $("new-password").value;
      const problem = newPassword.length < 15 || newPassword.length > 128 ? "Choose a new password of 15–128 characters."
        : newPassword !== $("confirm-password").value ? "The two new passwords don’t match."
          : newPassword === oldPassword ? "Choose a new password that differs from the current one." : "";
      if (problem) {
        $("password-status").textContent = problem;
        return;
      }
      const button = $("change-password-form").querySelector('button[type="submit"]');
      button.disabled = true;
      $("password-status").textContent = "Saving your new password…";
      try {
        const result = await api.auth.changePassword(oldPassword, newPassword);
        if (result?.authenticated === true) {
          // Students stay signed in: no need to retype the new password now.
          passwordFormOpen = false;
          $("change-password-form").reset();
          applySession(result);
          $("account-status").textContent = "Password changed. You’re signed in — use your new password next time.";
          focusAccountAction();
          return;
        }
        // Otherwise the server ended this session: sign in again.
        applySession({ authenticated: false });
        $("login-status").textContent = "Password changed. Sign in with your new password.";
        focusAccountAction();
      } catch (error) {
        if (error?.code === "unauthorized") return void sessionEnded();
        $("old-password").value = "";
        $("password-status").textContent = error?.code === "password_change_unavailable"
          ? "A password reset is in progress for this account. Contact the Arena staff team."
          : error?.code === "password_change_failed"
            ? "Password not changed. Check your current password and try a different new one."
            : error?.code === "password_change_uncertain"
              ? "We couldn’t confirm the change. Sign out, then try your new password; if it doesn’t work, use your current one."
              : "Password change is temporarily unavailable. Try again later.";
      } finally {
        button.disabled = false;
      }
    });
    $("open-staff-desk").addEventListener("click", () => {
      closeLogin();
      showPage("staff");
    });
    $("close-account").addEventListener("click", closeLogin);
    $("open-studio").addEventListener("click", () => {
      closeLogin();
      showPage("avatar");
    });
    $("welcome-close").addEventListener("click", () => closeWelcome());
    $("welcome-explore").addEventListener("click", () => closeWelcome());
    $("welcome-signin").addEventListener("click", () => {
      closeWelcome();
      openLogin();
    });
    $("welcome-backdrop").addEventListener("keydown", trapWelcomeFocus);
    $("login-backdrop").addEventListener("keydown", (event) => trapTab(event, $("login-backdrop")));
    $("welcome-backdrop").addEventListener("click", (event) => {
      if (event.target === $("welcome-backdrop")) closeWelcome();
    });
    $("logout-btn").addEventListener("click", async () => {
      try {
        await api.auth.signOut();
        viewerReactions.clear();
        applySession({ authenticated: false });
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
    if (mode === "demo") {
      $("mode-stamp").textContent = "FICTIONAL DEMO";
      $("pending-demo-note").textContent = "This preview control is local to fictional demo data. Real moderation is staff-only.";
    }
    // The hosted staging site only ever holds fictional test data; say so on every page.
    if (/(^|\.)academic-arena-staging\.pages\.dev$/.test(location.hostname)) {
      $("mode-stamp").textContent = "STAGING · FICTIONAL TEST DATA";
      $("mode-stamp").hidden = false;
    }
    $("approve-demo").hidden = mode !== "demo";
    if (mode === "production") $("save-note").textContent = "Sign in with your Arena account to save.";
    createPickerOptions();
    renderStudio();
    updateLevelButtons();
    bindEvents();
    features = await api.public.getFeatures();
    // Student-only navigation and promotions appear only once the owner enables student sign-in.
    document.documentElement.dataset.students = features.studentSignIn ? "on" : "off";
    $("public-avatar-group").hidden = !features.avatarPersonalization;
    await Promise.all([loadLeaderboard(), loadWins(), renderSession(), mode === "demo" ? loadSavedCharacter() : null]);
    document.documentElement.dataset.appReady = "true";
    // A temporary password or a pending staff check must be dealt with first.
    if (session.authenticated && (session.user.mustChangePassword || session.user.mfaRequired)) openLogin();
    else maybeShowWelcome();
    // Re-check after back/forward cache restores or a long time in the background,
    // so the header never keeps showing a stale signed-in or signed-out state.
    window.addEventListener("pageshow", (event) => { if (event.persisted) void renderSession(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && mode === "production" && Date.now() - lastSessionCheck > 60_000) void renderSession();
      // An open board tab refetches when it is shown again after a minute away,
      // so changed or withdrawn characters and standings do not linger.
      if (document.visibilityState === "visible" && currentPage === "leaderboard" && Date.now() - lastBoardLoad > 60_000) void loadLeaderboard();
    });
  }

  void start();
})();
