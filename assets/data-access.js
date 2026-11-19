/* Browser data boundary. Production requests go only to same-origin BFF routes. */
(function attachDataAccess(root, factory) {
  const api = factory(root);
  root.AcademicArenaDataAccess = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis, function createModule(root) {
  "use strict";

  const CHARACTER_IDS = new Set(["omar", "mariam", "youssef", "amara", "tariq", "habiba2", "malek", "nour2", "zein"]);
  const AVATAR_STYLES = new Set(["ink", "cartoon3d"]);
  const TONES = new Set(["mint", "coral", "gold", "paper", "blue", "lilac"]);
  const BADGES = new Set(["✦", "⚡", "♥", "★", ""]);
  const ROLES = new Set(["student", "moderator", "staff", "publisher", "admin"]);
  const REACTIONS = new Set(["heart", "clap", "fire"]);
  const CATEGORIES = new Set(["all", "academic", "consistency", "community"]);
  const TEMPLATES = Object.freeze({
    top3: { category: "academic" },
    workshop: { category: "consistency" },
    project: { category: "academic" },
    helped: { category: "community" },
  });
  const FIXTURE_PATH = "/fixtures/demo/academic-arena.json";
  const DEFAULT_API_BASE = "/api";

  class ArenaDataError extends Error {
    constructor(message, code = "request_failed", details = []) {
      super(message);
      this.name = "ArenaDataError";
      this.code = code;
      this.details = details;
    }
  }

  const SERVER_ERROR_CODE = /^[a-z_]{2,40}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const SUBMISSION_STATES = new Set(["pending", "approved", "rejected", "not_shown"]);
  const PUBLICATION_STATES = new Set(["live", "draft", "previous", "withdrawn"]);

  function text(value, fallback = "") {
    return typeof value === "string" ? value.trim().slice(0, 120) : fallback;
  }

  function safeApiBase(value) {
    if (typeof value !== "string" || !/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(value)) return DEFAULT_API_BASE;
    return value.replace(/\/+$/, "") || DEFAULT_API_BASE;
  }

  function sanitizeAvatar(value) {
    if (!value || typeof value !== "object") return null;
    const base = CHARACTER_IDS.has(value.base) ? value.base : null;
    const style = AVATAR_STYLES.has(value.style) ? value.style : null;
    if (!base || !style) return null;
    return {
      base,
      style,
      tone: TONES.has(value.tone) ? value.tone : "mint",
      badge: BADGES.has(value.badge) ? value.badge : "✦",
    };
  }

  function sanitizeBoardRow(value) {
    if (!value || typeof value !== "object") return null;
    const position = Number(value.position);
    const name = text(value.name);
    if (!Number.isInteger(position) || position < 1 || position > 10 || !name) return null;
    // A student's own opted-in character, only when every artwork field is allowlisted.
    if (value.personalized === true && CHARACTER_IDS.has(value.avatar) && AVATAR_STYLES.has(value.style) &&
        TONES.has(value.tone) && BADGES.has(value.badge)) {
      return { position, name, avatar: value.avatar, style: value.style, tone: value.tone, badge: value.badge, personalized: true };
    }
    // Otherwise the staff-approved character for this publication row, if any;
    // with none, the page shows a neutral illustration.
    if (value.personalized !== true && CHARACTER_IDS.has(value.avatar)) return { position, name, avatar: value.avatar, personalized: false };
    return { position, name, personalized: false };
  }

  function sanitizeWin(value, includeViewerReaction = false) {
    if (!value || typeof value !== "object") return null;
    const id = text(value.id);
    const author = text(value.author);
    const avatar = CHARACTER_IDS.has(value.avatar) ? value.avatar : null;
    const style = AVATAR_STYLES.has(value.style) ? value.style : null;
    const type = Object.hasOwn(TEMPLATES, value.type) ? value.type : null;
    const created = text(value.created);
    const counts = Array.isArray(value.counts) && value.counts.length === 3
      ? value.counts.map((count) => Number.isSafeInteger(count) && count >= 0 ? count : 0)
      : [0, 0, 0];
    if (!id || !author || !avatar || !style || !type || !created) return null;
    const win = { id, author, avatar, style, type, category: TEMPLATES[type].category, created, counts };
    if (includeViewerReaction) win.myReaction = REACTIONS.has(value.myReaction) ? value.myReaction : null;
    return win;
  }

  function sanitizeSession(value) {
    if (!value || value.authenticated !== true || !value.user || typeof value.user !== "object") {
      return { authenticated: false };
    }
    const role = ROLES.has(value.user.role) ? value.user.role : "student";
    const user = {
      role,
      mustChangePassword: value.user.mustChangePassword === true,
    };
    if (role !== "student") {
      user.mfaRequired = value.user.mfaRequired === true;
      user.mfaSetupRequired = value.user.mfaSetupRequired === true;
    }
    const avatar = sanitizeAvatar(value.user.avatar);
    if (avatar) user.avatar = avatar;
    return { authenticated: true, user };
  }

  // V1 public boards are level-only: Level 4, 5, or 6.
  function validFilters(filters = {}) {
    const level = String(filters.level || "");
    if (!["4", "5", "6"].includes(level)) {
      throw new ArenaDataError("Choose a valid level.", "invalid_filters");
    }
    return { level };
  }

  function copyCounts(counts) {
    return Array.isArray(counts) && counts.length === 3
      ? counts.map((count) => Number.isSafeInteger(count) && count >= 0 ? count : 0)
      : [0, 0, 0];
  }

  function createArenaDataAccess(options = {}) {
    const runtime = root.ARENA_CONFIG || {};
    const requestedMode = options.mode === "demo"
      ? "demo"
      : options.mode === "production"
        ? "production"
        : runtime.mode === "demo" ? "demo" : "production";
    const hostname = String(options.hostname ?? root.location?.hostname ?? "").toLowerCase();
    const isLoopbackHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
    const mode = requestedMode === "demo" && isLoopbackHost ? "demo" : "production";
    const apiBase = safeApiBase(options.apiBase || runtime.apiBase);
    const fetchImpl = options.fetchImpl || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
    const storage = options.storage || (() => {
      try { return root.localStorage; } catch { return null; }
    })();
    let csrfToken = "";
    let fixturePromise;

    async function request(method, route, body, csrf = true) {
      if (!fetchImpl) throw new ArenaDataError("Service unavailable.", "unavailable");
      const headers = { Accept: "application/json" };
      const options = { method, mode: "same-origin", redirect: "error", credentials: "same-origin", headers, cache: "no-store" };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      if (csrf && csrfToken && !["GET", "HEAD"].includes(method)) headers["X-CSRF-Token"] = csrfToken;
      let response;
      try {
        response = await fetchImpl(apiBase + route, options);
      } catch {
        throw new ArenaDataError("Service unavailable.", "unavailable");
      }
      let payload = {};
      try { payload = await response.json(); } catch {}
      if (!response.ok) {
        if (route === "/auth/login" && [401, 429].includes(response.status)) {
          throw new ArenaDataError("Could not sign you in. Check your details or try again later.",
            response.status === 429 ? "rate_limited" : "invalid_credentials");
        }
        const serverCode = typeof payload?.error === "string" && SERVER_ERROR_CODE.test(payload.error) ? payload.error : "";
        const details = Array.isArray(payload?.errors)
          ? payload.errors.slice(0, 25).map((item) => ({
              line: Number.isSafeInteger(item?.line) ? item.line : 0,
              message: text(item?.message, "Invalid value."),
            }))
          : [];
        throw new ArenaDataError("Request could not be completed.",
          response.status === 401 ? "unauthorized" : serverCode || "request_failed", details);
      }
      return payload;
    }

    async function loadFixture() {
      if (mode !== "demo") throw new ArenaDataError("Fictional fixtures are disabled.", "fixture_disabled");
      if (!fixturePromise) {
        fixturePromise = requestFixture();
      }
      return fixturePromise;
    }

    async function requestFixture() {
      if (!fetchImpl) throw new ArenaDataError("Demo fixture unavailable.", "unavailable");
      let response;
      try {
        response = await fetchImpl(FIXTURE_PATH, {
          method: "GET",
          mode: "same-origin",
          redirect: "error",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
      } catch {
        throw new ArenaDataError("Demo fixture unavailable.", "unavailable");
      }
      if (!response.ok) throw new ArenaDataError("Demo fixture unavailable.", "unavailable");
      try {
        const fixture = await response.json();
        if (fixture?.mode !== "fictional-demo" || !Array.isArray(fixture.students) || !Array.isArray(fixture.wins)) {
          throw new Error("invalid fixture");
        }
        return fixture;
      } catch {
        throw new ArenaDataError("Demo fixture unavailable.", "unavailable");
      }
    }

    function storageRead(key, fallback) {
      try {
        const raw = storage?.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    }

    function storageWrite(key, value) {
      try {
        storage?.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    }

    function demoRows(students, filters) {
      if (filters.level === "4") {
        return students.slice(0, 10).map((student, index) => sanitizeBoardRow({
          position: index + 1,
          name: student.name,
          avatar: student.avatar,
          style: student.style,
        })).filter(Boolean);
      }
      const scope = "level|" + filters.level;
      function score(student) {
        let value = 2166136261;
        for (const character of scope + "|" + student.avatar) {
          value ^= character.charCodeAt(0);
          value = Math.imul(value, 16777619) >>> 0;
        }
        return value;
      }
      return [...students]
        .sort((first, second) => score(first) - score(second))
        .slice(0, 10)
        .map((student, index) => sanitizeBoardRow({
          position: index + 1,
          name: student.name,
          avatar: student.avatar,
          style: student.style,
        }))
        .filter(Boolean);
    }

    const publicApi = {
      async getCatalog(filters) {
        const level = String(filters?.level || "");
        const semester = String(filters?.semester || "");
        if (!["4", "5", "6"].includes(level) || !["1", "2"].includes(semester)) {
          throw new ArenaDataError("Choose a valid level and semester.", "invalid_filters");
        }
        if (mode === "demo") {
          try {
            const fixture = await loadFixture();
            return { state: "ok", groups: fixture.catalog.groups, modules: fixture.catalog.modules };
          } catch {
            return { state: "unavailable", groups: [], modules: {} };
          }
        }
        try {
          const query = new URLSearchParams({ level, semester });
          const payload = await request("GET", "/public/catalog?" + query.toString());
          if (!payload || typeof payload !== "object" || !Array.isArray(payload.groups) ||
              !payload.modules || typeof payload.modules !== "object" || Array.isArray(payload.modules)) {
            return { state: "unavailable", groups: [], modules: {} };
          }
          const groups = Array.isArray(payload.groups)
            ? payload.groups.filter((group) => group && typeof group.key === "string" && typeof group.label === "string")
                .map((group) => ({ key: group.key.slice(0, 60), label: group.label.slice(0, 80) }))
            : [];
          if (payload.groups.length > 0 && groups.length === 0) {
            return { state: "unavailable", groups: [], modules: {} };
          }
          const modules = {};
          if (payload.modules && typeof payload.modules === "object" && !Array.isArray(payload.modules)) {
            for (const [group, items] of Object.entries(payload.modules)) {
              if (Array.isArray(items)) {
                modules[group.slice(0, 60)] = items
                  .filter((item) => item && typeof item.key === "string" && typeof item.label === "string")
                  .map((item) => ({ key: item.key.slice(0, 60), label: item.label.slice(0, 80) }));
              }
            }
          }
          return { state: groups.length ? "ok" : "empty", groups, modules };
        } catch {
          return { state: "unavailable", groups: [], modules: {} };
        }
      },

      // Rollout switches decided by the database owner; anything unexpected means off.
      async getFeatures() {
        const off = { studentSignIn: false, avatarPersonalization: false, welcomeDialog: false };
        if (mode === "demo") return { studentSignIn: true, avatarPersonalization: true, welcomeDialog: false };
        try {
          const payload = await request("GET", "/public/features");
          return {
            studentSignIn: payload?.studentSignIn === true,
            avatarPersonalization: payload?.avatarPersonalization === true,
            welcomeDialog: payload?.welcomeDialog === true,
          };
        } catch {
          return off;
        }
      },

      async getLeaderboard(input) {
        const filters = validFilters(input);
        if (mode === "demo") {
          try {
            const fixture = await loadFixture();
            const rows = demoRows(fixture.students, filters);
            return rows.length
              ? { state: "ok", publishedAt: fixture.publishedAt || null, releaseLabel: "Fictional demo", rows }
              : { state: "empty", publishedAt: null, releaseLabel: null, rows: [] };
          } catch {
            return { state: "unavailable", publishedAt: null, releaseLabel: null, rows: [] };
          }
        }
        const unavailable = { state: "unavailable", publishedAt: null, releaseLabel: null, rows: [] };
        const query = new URLSearchParams(filters);
        try {
          const payload = await request("GET", "/public/leaderboards?" + query.toString());
          if (!payload || typeof payload !== "object" || !Array.isArray(payload.rows) || payload.rows.length > 10) {
            return unavailable;
          }
          const rows = payload.rows.map(sanitizeBoardRow).filter(Boolean);
          if (rows.length !== payload.rows.length) return unavailable;
          const label = text(payload.releaseLabel);
          return {
            state: rows.length ? "ok" : "empty",
            publishedAt: text(payload.publishedAt) || null,
            releaseLabel: /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(label) ? label : null,
            rows,
          };
        } catch {
          return unavailable;
        }
      },

      async getWins(category = "all") {
        if (!CATEGORIES.has(category)) throw new ArenaDataError("Choose an approved category.", "invalid_filter");
        if (mode === "demo") {
          try {
            const fixture = await loadFixture();
            const own = storageRead("arena-v1-demo-reactions", {});
            const posts = fixture.wins
              .filter((post) => category === "all" || TEMPLATES[post.type]?.category === category)
              .map((post) => {
                const myReaction = REACTIONS.has(own[post.id]) ? own[post.id] : null;
                const counts = copyCounts(post.counts);
                if (myReaction) counts[["heart", "clap", "fire"].indexOf(myReaction)] += 1;
                return sanitizeWin({ ...post, counts, myReaction }, true);
              })
              .filter(Boolean);
            return { state: posts.length ? "ok" : "empty", posts };
          } catch {
            return { state: "unavailable", posts: [] };
          }
        }
        try {
          const query = new URLSearchParams({ category });
          const payload = await request("GET", "/public/campus-wins?" + query.toString());
          if (!payload || typeof payload !== "object" || !Array.isArray(payload.posts)) {
            return { state: "unavailable", posts: [] };
          }
          const posts = payload.posts.map(sanitizeWin).filter(Boolean);
          if (posts.length !== payload.posts.length) return { state: "unavailable", posts: [] };
          return { state: posts.length ? "ok" : "empty", posts };
        } catch {
          return { state: "unavailable", posts: [] };
        }
      },
    };

    const auth = {
      async getSession() {
        if (mode === "demo") return { authenticated: false };
        try {
          const payload = await request("GET", "/auth/session", undefined, false);
          csrfToken = text(payload.csrfToken);
          return sanitizeSession(payload);
        } catch (error) {
          csrfToken = "";
          // A network or server failure is "couldn't check", not "signed out":
          // the caller may retry instead of showing a false SIGN IN state.
          return error?.code === "unauthorized" ? { authenticated: false } : { authenticated: false, unavailable: true };
        }
      },
      async signIn(credentials) {
        if (mode === "demo") throw new ArenaDataError("Sign-in is not connected in the fictional preview.", "unavailable");
        if (!credentials || typeof credentials.username !== "string" || typeof credentials.password !== "string" ||
            credentials.username.length < 2 || credentials.username.length > 80 ||
            credentials.password.length < 1 || credentials.password.length > 256) {
          throw new ArenaDataError("Invalid username or password.", "invalid_credentials");
        }
        try {
          const payload = await request("POST", "/auth/login", {
            username: credentials.username,
            password: credentials.password,
          }, false);
          csrfToken = text(payload.csrfToken);
          return sanitizeSession(payload);
        } catch (error) {
          if (error.code === "invalid_credentials" || error.code === "rate_limited") throw error;
          throw new ArenaDataError("Sign-in is temporarily unavailable.", "unavailable");
        }
      },
      async signOut() {
        if (mode === "demo") return { authenticated: false };
        await request("POST", "/auth/logout", {});
        csrfToken = "";
        return { authenticated: false };
      },
      async changePassword(oldPassword, newPassword) {
        if (mode === "demo") throw new ArenaDataError("Password changes are not connected in the fictional preview.", "unavailable");
        if (typeof oldPassword !== "string" || typeof newPassword !== "string" ||
            newPassword.length < 15 || newPassword.length > 128) {
          throw new ArenaDataError("Choose a new password with at least 15 characters.", "invalid_password");
        }
        const payload = await request("POST", "/auth/change-password", { oldPassword, newPassword });
        if (payload?.changed === true && payload?.authenticated === false) csrfToken = "";
        return payload;
      },
      async enrollMfa() {
        if (mode === "demo") throw new ArenaDataError("Staff MFA is unavailable in the fictional preview.", "unavailable");
        const payload = await request("POST", "/auth/mfa/enroll", {});
        if (typeof payload?.secret !== "string" || payload.secret.length < 16) {
          throw new ArenaDataError("Staff security setup is temporarily unavailable.", "unavailable");
        }
        return { secret: payload.secret };
      },
      async verifyMfa(code) {
        if (mode === "demo") throw new ArenaDataError("Staff MFA is unavailable in the fictional preview.", "unavailable");
        if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
          throw new ArenaDataError("Enter the six-digit authenticator code.", "invalid_code");
        }
        const payload = await request("POST", "/auth/mfa/verify", { code });
        const nextSession = sanitizeSession(payload);
        if (!nextSession.authenticated || nextSession.user.mfaRequired) {
          throw new ArenaDataError("Staff verification could not be completed.", "verification_failed");
        }
        return nextSession;
      },
    };

    const student = {
      async getMyCharacter() {
        if (mode === "demo") {
          const saved = sanitizeAvatar(storageRead("arena-v1-demo-avatar", null));
          return saved ? { ...saved, showOnLeaderboard: storageRead("arena-v1-demo-show", false) === true } : null;
        }
        try {
          const payload = await request("GET", "/me/avatar");
          const saved = sanitizeAvatar(payload.avatar);
          return saved ? { ...saved, showOnLeaderboard: payload.showOnLeaderboard === true } : null;
        } catch (error) {
          if (error.code === "unauthorized") return null;
          throw error;
        }
      },
      async saveCharacter(input, showOnLeaderboard) {
        const avatar = sanitizeAvatar(input);
        if (!avatar) throw new ArenaDataError("Choose a valid character.", "invalid_avatar");
        const withChoice = typeof showOnLeaderboard === "boolean";
        if (mode === "demo") {
          if (!storageWrite("arena-v1-demo-avatar", avatar) || (withChoice && !storageWrite("arena-v1-demo-show", showOnLeaderboard))) {
            throw new ArenaDataError("Browser storage is unavailable. Your preview change was not saved.", "storage_unavailable");
          }
          return { saved: true, avatar, showOnLeaderboard: withChoice ? showOnLeaderboard : storageRead("arena-v1-demo-show", false) === true };
        }
        const payload = await request("PUT", "/me/avatar", withChoice ? { avatar, showOnLeaderboard } : { avatar });
        return { saved: payload?.saved === true, avatar: sanitizeAvatar(payload?.avatar), showOnLeaderboard: payload?.showOnLeaderboard === true };
      },
      async submitAchievement(input) {
        const type = input && input.type;
        if (!Object.hasOwn(TEMPLATES, type)) throw new ArenaDataError("Choose an approved achievement.", "invalid_achievement");
        if (mode === "demo") {
          const pending = storageRead("arena-v1-demo-pending", []);
          const item = { id: "local-demo-" + Date.now(), type, status: "pending" };
          const next = [item, ...pending].slice(0, 10);
          if (!storageWrite("arena-v1-demo-pending", next)) {
            throw new ArenaDataError("Browser storage is unavailable. Your preview submission was not saved.", "storage_unavailable");
          }
          return { state: "pending", id: item.id };
        }
        return request("POST", "/me/achievements", { type });
      },
      async getMySubmissions() {
        if (mode === "demo") return [];
        const payload = await request("GET", "/me/achievements");
        return Array.isArray(payload?.submissions)
          ? payload.submissions
              .filter((item) => item && UUID.test(item.id) && Object.hasOwn(TEMPLATES, item.type) && SUBMISSION_STATES.has(item.status))
              .map((item) => ({ id: item.id, type: item.type, status: item.status, created: text(item.created) }))
          : [];
      },
      async getMyReactions() {
        if (mode === "demo") return {};
        const payload = await request("GET", "/me/campus-win-reactions");
        const result = {};
        if (payload?.reactions && typeof payload.reactions === "object") {
          for (const [id, reaction] of Object.entries(payload.reactions)) {
            if (UUID.test(id) && REACTIONS.has(reaction)) result[id] = reaction;
          }
        }
        return result;
      },
      async setReaction(postId, reaction) {
        const id = text(postId);
        if (!id || !REACTIONS.has(reaction)) throw new ArenaDataError("Choose a valid reaction.", "invalid_reaction");
        if (mode === "demo") {
          const reactions = storageRead("arena-v1-demo-reactions", {});
          const selected = reactions[id];
          if (selected === reaction) delete reactions[id];
          else reactions[id] = reaction;
          if (!storageWrite("arena-v1-demo-reactions", reactions)) {
            throw new ArenaDataError("Browser storage is unavailable. Your preview reaction was not saved.", "storage_unavailable");
          }
          return { activeReaction: reactions[id] || null };
        }
        const payload = await request("PUT", "/public/campus-wins/" + encodeURIComponent(id) + "/reaction", { reaction });
        return { activeReaction: REACTIONS.has(payload.activeReaction) ? payload.activeReaction : null };
      },
    };

    const staff = {
      async uploadRankings(academicYear, releaseLabel, csv) {
        if (mode === "demo") throw new ArenaDataError("Staff publishing is unavailable in the fictional preview.", "unauthorized");
        if (typeof academicYear !== "string" || typeof releaseLabel !== "string" || typeof csv !== "string" || csv.length > 16384) {
          throw new ArenaDataError("Choose a CSV file of at most 16 KB.", "invalid_upload");
        }
        return request("POST", "/staff/leaderboards/drafts", { academicYear, releaseLabel, csv });
      },
      // Staff-reviewed default board characters for one publication.
      async boardCharacters(publicationId) {
        if (mode === "demo") throw new ArenaDataError("Board characters are unavailable in the fictional preview.", "unauthorized");
        if (!UUID.test(String(publicationId))) throw new ArenaDataError("Choose a publication.", "invalid_publication");
        const payload = await request("GET", "/staff/leaderboards/artwork?" + new URLSearchParams({ publicationId }).toString());
        return Array.isArray(payload?.rows) ? payload.rows.filter((row) => row && [4, 5, 6].includes(row.level) &&
          Number.isInteger(row.position) && typeof row.publicName === "string")
          .map((row) => ({ level: row.level, position: row.position, publicName: row.publicName,
            character: CHARACTER_IDS.has(row.character) ? row.character : null })) : [];
      },
      async approveBoardCharacters(publicationId, assignments) {
        if (mode === "demo") throw new ArenaDataError("Board characters are unavailable in the fictional preview.", "unauthorized");
        const clean = (Array.isArray(assignments) ? assignments : []).filter((item) => CHARACTER_IDS.has(item.character))
          .map((item) => ({ level: item.level, rank: item.rank, character: item.character }));
        return request("POST", "/staff/leaderboards/artwork", { publicationId, assignments: clean });
      },
      // Admin-only private ranking links (level,rank,username).
      async previewRankingLinks(publicationId, csv) {
        if (mode === "demo") throw new ArenaDataError("Account links are unavailable in the fictional preview.", "unauthorized");
        if (!UUID.test(String(publicationId)) || typeof csv !== "string" || csv.length > 4096) {
          throw new ArenaDataError("Choose a publication and a link file of at most 4 KB.", "invalid_upload");
        }
        return request("POST", "/staff/leaderboards/links/preview", { publicationId, csv });
      },
      async approveRankingLinks(publicationId, csv) {
        if (mode === "demo") throw new ArenaDataError("Account links are unavailable in the fictional preview.", "unauthorized");
        if (!UUID.test(String(publicationId)) || typeof csv !== "string" || csv.length > 4096) {
          throw new ArenaDataError("Choose a publication and a link file of at most 4 KB.", "invalid_upload");
        }
        return request("POST", "/staff/leaderboards/links/approve", { publicationId, csv });
      },
      async publicationHistory() {
        if (mode === "demo") return [];
        const payload = await request("GET", "/staff/leaderboards/history");
        return Array.isArray(payload?.publications)
          ? payload.publications.filter((item) => item && UUID.test(item.id) && PUBLICATION_STATES.has(item.state))
          : [];
      },
      async withdrawLeaderboard() {
        if (mode === "demo") throw new ArenaDataError("Staff publishing is unavailable in the fictional preview.", "unauthorized");
        return request("POST", "/staff/leaderboards/withdraw", {});
      },
      async listCampusWinHistory(status) {
        if (mode === "demo" || !["approved", "hidden", "rejected", "removed"].includes(status)) return { posts: [] };
        const payload = await request("GET", "/staff/campus-wins/history?" + new URLSearchParams({ status }).toString());
        return { posts: Array.isArray(payload.posts) ? payload.posts.map(sanitizeWin).filter(Boolean) : [] };
      },
      async setPublicName(username, publicName) {
        if (mode === "demo") throw new ArenaDataError("Account management is unavailable in the fictional preview.", "unauthorized");
        return request("POST", "/staff/accounts/public-name", { username, publicName });
      },
      async publishLeaderboard(publicationId) {
        const id = text(publicationId);
        if (!id) throw new ArenaDataError("Choose a validated publication.", "invalid_publication");
        if (mode === "demo") throw new ArenaDataError("Staff publishing is unavailable in the fictional preview.", "unauthorized");
        return request("POST", "/staff/leaderboards/publish", { publicationId: id });
      },
      async listPendingCampusWins() {
        if (mode === "demo") return { posts: [] };
        const payload = await request("GET", "/staff/campus-wins/pending");
        return { posts: Array.isArray(payload.posts) ? payload.posts.map(sanitizeWin).filter(Boolean) : [] };
      },
      async moderateCampusWin(postId, decision) {
        const id = text(postId);
        if (!id || !["approved", "rejected", "hidden", "removed"].includes(decision)) {
          throw new ArenaDataError("Choose a valid moderation decision.", "invalid_moderation");
        }
        if (mode === "demo") throw new ArenaDataError("Staff moderation is unavailable in the fictional preview.", "unauthorized");
        return request("POST", "/staff/campus-wins/" + encodeURIComponent(id) + "/moderation", { decision });
      },
      async provisionStudent(input) {
        if (!input || typeof input.username !== "string" || typeof input.temporaryPassword !== "string" ||
            input.username.length < 2 || input.username.length > 80 ||
            input.temporaryPassword.length < 15 || input.temporaryPassword.length > 256) {
          throw new ArenaDataError("Provide a valid staff-issued username and initial password.", "invalid_account");
        }
        if (mode === "demo") throw new ArenaDataError("Account provisioning is unavailable in the fictional preview.", "unauthorized");
        return request("POST", "/staff/accounts", {
          username: input.username,
          temporaryPassword: input.temporaryPassword,
        });
      },
    };

    return Object.freeze({ mode, public: Object.freeze(publicApi), auth: Object.freeze(auth), student: Object.freeze(student), staff: Object.freeze(staff) });
  }

  return { createArenaDataAccess, ArenaDataError };
});
