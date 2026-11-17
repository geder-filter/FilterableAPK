(() => {
  "use strict";
  const BOT_NAME = {
    instinct: /^instinct$/i,
    tab: /^tab$/i
  };
  const BOT_IDS = {
    instinct: [ "23949492670633@lid", "16508702892@c.us" ],
    tab: [ "70713146904747@lid", "12512765320@c.us" ]
  };
  const BOT_SITE = {
    instinct: /(^|\.)instinct\.co$/i,
    tab: /(^|\.)tab\.bot$/i
  };
  const BOTS = Object.keys(BOT_NAME);
  const cap = b => b.charAt(0).toUpperCase() + b.slice(1);
  const REPLY_TIMEOUT_MS = 18e4;
  const PROBE_MESSAGE = "Hi";
  const PROBE_TIMEOUT_MS = 6e4;
  const NOT_LIVE = /wait\s?list|isn['\u2019]?t connected|not connected|moment i['\u2019]?m live/i;
  const GREET_QUIET_MS = 8e3, GREET_MAX_MS = 4e4;
  const GRACE_MS = 6e4;
  const LATE_MS = 3e5;
  const full = body => /got it/i.test(body || "") && /my email is[:\s]*[^\s]+@[^\s@]+\.[^\s@]+/i.test(body || "");
  const LEFT_MAX_AGE_S = 7 * 24 * 3600, LEFT_ANSWER_S = 600;
  const LOCK_ATTR = "data-gf-lock";
  const RUN_ATTR = "data-gf-run";
  const OPEN_ATTR = "data-gf-open";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let seq = 0;
  const waiting = new Map;
  function ask(type, payload, timeoutMs) {
    return new Promise(resolve => {
      const id = "main" + ++seq;
      waiting.set(id, resolve);
      window.postMessage({
        source: "geder-main",
        id: id,
        type: type,
        payload: payload
      }, "*");
      setTimeout(() => {
        if (waiting.delete(id)) resolve(null);
      }, timeoutMs || 2e4);
    });
  }
  const SUPPORT = window.__gederSupport === 1;
  const getConfig = (number, lid) => ask("GET_CONFIG", {
    number: number,
    lid: lid
  });
  const report = data => ask("REPORT_SETUP", SUPPORT ? Object.assign({
    support: true
  }, data) : data);
  let myNumber = null, myLid = null;
  let account = "";
  let unlocked = [];
  let pending = [];
  let setupMsgs = {};
  let armed = false;
  let haveServer = false;
  const inflight = new Set;
  const late = {};
  const setupDoneAt = {};
  const clean = a => Array.isArray(a) ? a.filter((b, i) => BOT_NAME[b] && a.indexOf(b) === i) : [];
  const pushState = () => {
    titles = botTitles();
    return ask("STATE", {
      account: account,
      unlocked: unlocked,
      pending: pending,
      armed: armed,
      titles: titles
    }, 5e3);
  };
  function wppReady(maxMs) {
    return new Promise(resolve => {
      const ok = () => !!(window.WPP && window.WPP.isReady);
      if (ok()) return resolve(true);
      const t0 = Date.now();
      const t = setInterval(() => {
        if (ok()) {
          clearInterval(t);
          resolve(true);
        } else if (maxMs && Date.now() - t0 > maxMs) {
          clearInterval(t);
          resolve(false);
        }
      }, 200);
    });
  }
  const wppUp = () => !!(window.WPP && window.WPP.isReady);
  function native(name) {
    if (!wppUp()) return null;
    try {
      return window.require(name) || null;
    } catch (e) {
      return null;
    }
  }
  function meWids() {
    const m = native("WAWebApiContact");
    try {
      return m.getMeUserWids().map(w => typeof w === "string" ? w : w && w._serialized || "");
    } catch (e) {
      return [];
    }
  }
  function meUser(fn) {
    const m = native("WAWebUserPrefsMeUser");
    try {
      if (m && typeof m[fn] === "function") {
        const u = m[fn]();
        if (u && u._serialized) return u._serialized;
      }
    } catch (e) {}
    if (wppUp()) try {
      const u = window.WPP.whatsapp.UserPrefs[fn]();
      if (u && u._serialized) return u._serialized;
    } catch (e) {}
    return "";
  }
  function deviceNumber() {
    for (const s of meWids()) {
      const m = s.match(/^(\d+)@c\.us$/);
      if (m) return m[1];
    }
    const m = meUser("getMaybeMePnUser").match(/(\d+)@c\.us/);
    return m ? m[1] : null;
  }
  function deviceLid() {
    const m = meUser("getMaybeMeLidUser").match(/(\d+)@lid/);
    if (m) return m[1];
    for (const s of meWids()) {
      const k = s.match(/^(\d+)@lid$/);
      if (k) return k[1];
    }
    return null;
  }
  function readIdentity() {
    const n = deviceNumber(), l = deviceLid();
    if (!n && !l) return "";
    myNumber = n;
    myLid = l;
    return l ? "lid:" + l : "n:" + n;
  }
  function chatStore() {
    const m = native("WAWebChatCollection");
    let s = m && m.ChatCollection;
    if (!s && wppUp()) try {
      s = window.WPP.whatsapp.ChatStore;
    } catch (e) {}
    return s && typeof s.on === "function" && typeof s.getModelsArray === "function" ? s : null;
  }
  function botOfChat(c) {
    try {
      const ct = c && c.contact || {};
      const id = c && c.id && c.id._serialized || "";
      const phone = ct.phoneNumber && ct.phoneNumber._serialized || "";
      const vn = (ct.verifiedName || "").trim();
      for (const b of BOTS) if (BOT_IDS[b].indexOf(id) >= 0 || phone && BOT_IDS[b].indexOf(phone) >= 0 || BOT_NAME[b].test(vn)) return b;
      const sites = ct.businessProfile && ct.businessProfile.website || [];
      for (const w of sites) {
        let host = "";
        try {
          host = new URL(typeof w === "string" ? w : w.url).hostname;
        } catch (e) {}
        for (const b of BOTS) if (host && BOT_SITE[b].test(host)) return b;
      }
    } catch (e) {}
    return null;
  }
  function botTitles() {
    const out = {};
    for (const b of BOTS) {
      const c = botChat(b), ct = c && c.contact || {}, names = [];
      [ c && c.formattedTitle, c && c.name, ct.name, ct.formattedName, ct.verifiedName, ct.pushname ].forEach(n => {
        n = (typeof n === "string" ? n : "").trim();
        if (n && names.indexOf(n) < 0) names.push(n);
      });
      out[b] = names;
    }
    return out;
  }
  let titles = {};
  const isBotTitle = (b, title) => BOT_NAME[b].test(title) || (titles[b] || []).indexOf(title) >= 0;
  function activeChat() {
    const s = chatStore();
    if (!s) return null;
    try {
      if (typeof s.getActive === "function") {
        const a = s.getActive();
        if (a) return a;
      }
    } catch (e) {}
    try {
      return s.getModelsArray().find(c => c.active) || null;
    } catch (e) {
      return null;
    }
  }
  const chatCache = {};
  function botChat(botKey) {
    if (chatCache[botKey]) return chatCache[botKey];
    const s = chatStore();
    if (!s) return null;
    try {
      const c = s.getModelsArray().find(x => botOfChat(x) === botKey) || null;
      if (c) chatCache[botKey] = c;
      return c;
    } catch (e) {
      return null;
    }
  }
  function lockCheck() {
    const c = activeChat();
    const bot = c ? botOfChat(c) : null;
    const lock = !!bot && !unlocked.includes(bot);
    const root = document.documentElement;
    if (lock) {
      if (!root.hasAttribute(LOCK_ATTR)) root.setAttribute(LOCK_ATTR, "1");
    } else if (root.hasAttribute(LOCK_ATTR)) root.removeAttribute(LOCK_ATTR);
    const open = !!bot && !lock;
    if (open) {
      if (root.getAttribute(OPEN_ATTR) !== bot) root.setAttribute(OPEN_ATTR, bot);
    } else if (root.hasAttribute(OPEN_ATTR)) root.removeAttribute(OPEN_ATTR);
    return lock ? bot : null;
  }
  let gateBot = null, gateOrigin = null, gateEl = null, gateStatus = null, gateBtn = null, gateMode = null;
  function rightPane() {
    const ps = document.querySelector("#pane-side");
    if (ps) {
      const r = ps.getBoundingClientRect();
      return {
        left: Math.round(r.right),
        width: Math.max(0, window.innerWidth - Math.round(r.right))
      };
    }
    return {
      left: Math.min(408, Math.round(window.innerWidth * .3)),
      width: window.innerWidth
    };
  }
  function positionGate() {
    if (!gateEl) return;
    const r = rightPane();
    gateEl.style.left = r.left + "px";
    gateEl.style.width = r.width + "px";
  }
  function hideGate() {
    gateBot = null;
    gateOrigin = null;
    gateMode = null;
    gateStatus = null;
    gateBtn = null;
    if (gateEl) {
      gateEl.remove();
      gateEl = null;
    }
  }
  function showGate(botKey, origin) {
    const mode = pending.includes(botKey) ? "setup" : haveServer ? "locked" : "checking";
    if (gateBot === botKey && gateMode === mode && gateEl && gateEl.isConnected) {
      if (origin === "chat") gateOrigin = "chat";
      positionGate();
      return;
    }
    hideGate();
    if (!document.body) return;
    gateBot = botKey;
    gateOrigin = origin;
    gateMode = mode;
    const r = rightPane();
    const wrap = document.createElement("div");
    wrap.className = "gf-gate";
    Object.assign(wrap.style, {
      position: "fixed",
      top: "0",
      height: "100%",
      left: r.left + "px",
      width: r.width + "px",
      zIndex: 2147483646,
      background: "#0b141a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px"
    });
    const card = document.createElement("div");
    Object.assign(card.style, {
      maxWidth: "400px",
      textAlign: "center",
      color: "#e9edef",
      font: "400 15px system-ui,-apple-system,sans-serif"
    });
    const h = document.createElement("div");
    h.textContent = "Set up filtering for " + botKey.charAt(0).toUpperCase() + botKey.slice(1);
    Object.assign(h.style, {
      fontSize: "19px",
      fontWeight: "600",
      marginBottom: "10px"
    });
    const p = document.createElement("div");
    p.textContent = "This assistant stays locked until its topic filter is in place. Set it up now to start using it.";
    Object.assign(p.style, {
      color: "#8696a0",
      lineHeight: "1.5",
      marginBottom: "22px"
    });
    const btn = document.createElement("button");
    btn.textContent = "Set up filtering";
    Object.assign(btn.style, {
      padding: "11px 20px",
      background: "#00a884",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      font: "600 15px system-ui,sans-serif",
      cursor: "pointer"
    });
    const status = document.createElement("div");
    Object.assign(status.style, {
      marginTop: "14px",
      color: "#8696a0",
      minHeight: "18px",
      fontSize: "13px"
    });
    btn.addEventListener("click", () => {
      btn.disabled = true;
      status.textContent = "Setting up\u2026";
      runSetup(botKey).then(res => {
        if (!res || !res.ok) {
          btn.disabled = false;
          status.textContent = res && res.message || "Setup didn't complete. Try again.";
        }
      });
    });
    if (mode !== "setup") {
      h.textContent = cap(botKey) + " is locked on this account";
      p.textContent = mode === "locked" ? "Filtering for this assistant isn't available on this account right now. If you just set it up, reload WhatsApp Web. If it stays locked, contact Geder support." : "Checking this assistant's filter\u2026 If this stays, reload WhatsApp Web.";
      card.appendChild(h);
      card.appendChild(p);
    } else if (SUPPORT) {
      p.textContent = "Geder support is helping you set up filtering for this assistant. When they're ready, a notice will ask you to start it.";
      card.appendChild(h);
      card.appendChild(p);
    } else {
      card.appendChild(h);
      card.appendChild(p);
      card.appendChild(btn);
      card.appendChild(status);
    }
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    gateEl = wrap;
    gateStatus = status;
    gateBtn = btn;
  }
  function sync() {
    const bot = lockCheck();
    if (bot) {
      showGate(bot, "chat");
      return;
    }
    if (gateBot && (gateOrigin === "chat" || !pending.includes(gateBot))) hideGate(); else if (gateBot && gateEl && !gateEl.isConnected) showGate(gateBot, gateOrigin); else positionGate();
  }
  function onActive(chat, isActive) {
    try {
      if (isActive && gateBot && gateOrigin === "click" && botOfChat(chat) !== gateBot) hideGate();
    } catch (e) {}
    sync();
  }
  function onPanePointer(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (gateEl && gateEl.contains(t)) return;
    const row = t.closest('#pane-side [role="row"]') || t.closest('#pane-side [role="listitem"]') || t.closest('#pane-side [role="gridcell"]');
    if (!row) return;
    const s = row.querySelector && (row.querySelector('[data-testid="cell-frame-title"] span[title]') || row.querySelector("span[title]"));
    const title = s && (s.title || "").trim();
    const bot = title ? pending.find(b => isBotTitle(b, title)) : null;
    if (bot) {
      e.stopImmediatePropagation();
      e.preventDefault();
      showGate(bot, "click");
      return;
    }
    if (gateBot && gateOrigin === "click") hideGate();
  }
  function isMuted(chat) {
    try {
      const e = chat && chat.mute && chat.mute.expiration;
      return !!e && (e < 0 || e > Math.floor(Date.now() / 1e3));
    } catch (e) {
      return false;
    }
  }
  function ourMute(chat) {
    try {
      const left = chat.mute.expiration - Math.floor(Date.now() / 1e3);
      return left > 0 && left <= 3600;
    } catch (e) {
      return false;
    }
  }
  async function mute(chatId) {
    try {
      await window.WPP.chat.mute(chatId, {
        expiration: Math.floor(Date.now() / 1e3) + 3600
      });
    } catch (e) {}
  }
  async function unmute(chatId) {
    try {
      await window.WPP.chat.unmute(chatId);
    } catch (e) {}
  }
  const QUIET_MIN_MS = 6e3, QUIET_MAX_MS = 45e3;
  let quietTimer = null;
  function popupsShowing() {
    const c = document.getElementById("wds-toast-container");
    return !!(c && c.children.length);
  }
  function quiet(on) {
    if (quietTimer) {
      clearInterval(quietTimer);
      quietTimer = null;
    }
    if (on) {
      document.documentElement.setAttribute(RUN_ATTR, "1");
      return;
    }
    const t0 = Date.now();
    let emptyTicks = 0;
    quietTimer = setInterval(() => {
      if (inflight.size) return;
      const age = Date.now() - t0;
      emptyTicks = popupsShowing() ? 0 : emptyTicks + 1;
      if (age >= QUIET_MIN_MS && emptyTicks >= 4 || age >= QUIET_MAX_MS) {
        clearInterval(quietTimer);
        quietTimer = null;
        document.documentElement.removeAttribute(RUN_ATTR);
      }
    }, 300);
  }
  let busyBot = null, busyEl = null, busyParts = null, busyDone = false;
  function hideBusy() {
    busyBot = null;
    busyParts = null;
    busyDone = false;
    if (busyEl) {
      busyEl.remove();
      busyEl = null;
    }
  }
  function showBusy(botKey) {
    hideBusy();
    if (!document.body) return;
    busyBot = botKey;
    const name = cap(botKey);
    const wrap = document.createElement("div");
    wrap.className = "gf-busy";
    Object.assign(wrap.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      zIndex: 2147483647,
      background: "rgba(11,20,26,0.95)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      cursor: "progress"
    });
    const card = document.createElement("div");
    Object.assign(card.style, {
      maxWidth: "440px",
      textAlign: "center",
      color: "#e9edef",
      font: "400 15px system-ui,-apple-system,sans-serif"
    });
    const h = document.createElement("div");
    h.textContent = "Setting up filtering for " + name;
    Object.assign(h.style, {
      fontSize: "20px",
      fontWeight: "600",
      marginBottom: "12px"
    });
    const p = document.createElement("div");
    p.textContent = "Please keep this page open and don't refresh it. This can take a minute or two.";
    Object.assign(p.style, {
      color: "#8696a0",
      lineHeight: "1.5",
      marginBottom: "18px"
    });
    const status = document.createElement("div");
    status.textContent = "Setting up\u2026";
    Object.assign(status.style, {
      color: "#8696a0",
      minHeight: "18px",
      fontSize: "14px"
    });
    const ok = document.createElement("button");
    ok.textContent = "OK";
    Object.assign(ok.style, {
      display: "none",
      marginTop: "6px",
      padding: "10px 28px",
      background: "#00a884",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      font: "600 15px system-ui,sans-serif",
      cursor: "pointer"
    });
    ok.addEventListener("click", () => {
      if (busyBot === botKey) hideBusy();
    });
    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(status);
    card.appendChild(ok);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    busyEl = wrap;
    busyParts = {
      h: h,
      p: p,
      status: status,
      ok: ok,
      name: name
    };
  }
  function finishBusy(botKey, res) {
    if (busyBot !== botKey || !busyParts) return;
    const {h: h, p: p, status: status, ok: ok, name: name} = busyParts;
    busyDone = true;
    if (busyEl) busyEl.style.cursor = "default";
    status.textContent = "";
    status.style.minHeight = "0";
    if (res && res.ok) {
      h.textContent = "\u2713 Filtering is on for " + name;
      h.style.color = "#6ee7bf";
      p.textContent = "";
      ok.style.display = "none";
      setTimeout(() => {
        if (busyBot === botKey) hideBusy();
      }, 2e3);
      return;
    }
    h.textContent = "Filtering wasn't set up for " + name;
    h.style.color = "#f3a3a3";
    p.textContent = res && res.message || "Setup didn't complete. Try again.";
    p.style.color = "#e9edef";
    ok.style.display = "inline-block";
    try {
      ok.focus();
    } catch (e) {}
  }
  function onUnload(e) {
    if (inflight.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
  function running(botKey, on) {
    if (on) {
      inflight.add(botKey);
      window.addEventListener("beforeunload", onUnload);
    } else {
      inflight.delete(botKey);
      if (!inflight.size) window.removeEventListener("beforeunload", onUnload);
    }
  }
  const said = heard => heard.map(m => (m.body || "").slice(0, 600)).filter(Boolean).slice(0, 8);
  async function reportOk(data) {
    for (let i = 0; i < 3; i++) {
      if (await report(data)) return true;
      await sleep(2e3);
    }
    return false;
  }
  async function runSetup(botKey) {
    if (!BOT_NAME[botKey]) return {
      ok: false,
      message: "Assistant chat not found."
    };
    if (unlocked.includes(botKey)) return {
      ok: true
    };
    if (inflight.has(botKey)) return {
      ok: false,
      message: "Already setting up\u2026"
    };
    running(botKey, true);
    showBusy(botKey);
    quiet(true);
    let res = null;
    try {
      res = await prepareAndSend(botKey);
    } catch (e) {
      res = {
        ok: false,
        message: "Something went wrong during setup. Try again."
      };
    } finally {
      running(botKey, false);
      quiet(false);
      finishBusy(botKey, res);
      sweepSoon(botKey);
    }
    return res;
  }
  async function prepareAndSend(botKey) {
    if (!await wppReady(3e4)) return {
      ok: false,
      message: "WhatsApp is still loading. Try again in a moment."
    };
    if (!setupMsgs[botKey]) await refresh();
    if (unlocked.includes(botKey)) return {
      ok: true
    };
    const setupMessage = setupMsgs[botKey];
    if (!setupMessage) return {
      ok: false,
      message: "Couldn't reach the filter service. Check the internet connection and try again."
    };
    const chat = botChat(botKey);
    const name = cap(botKey);
    if (!chat) return {
      ok: false,
      message: name + "'s chat wasn't found in this WhatsApp account."
    };
    const chatId = chat.id._serialized;
    const held = (late[botKey] ? late[botKey].cancel() : false) || ourMute(chat);
    const old = await strays(chatId);
    if (old && old.ids.length) {
      await wipe(chatId, old.ids, [], null);
      if (old.confirm) {
        if (held) await unmute(chatId);
        await confirmed(botKey, classify(old.confirm.body).email, "found in chat");
        return {
          ok: true
        };
      }
    }
    const wasMuted = isMuted(chat) && !held;
    const ear = listen(chatId);
    const sent = [];
    const send = async text => {
      const r = await window.WPP.chat.sendTextMessage(chatId, text, {
        createChat: true
      });
      sent.push(r && (r.id || r.ack && r.ack.id) || null);
    };
    try {
      if (!wasMuted) await mute(chatId);
      await send(PROBE_MESSAGE);
      const hello = await ear.next(0, PROBE_TIMEOUT_MS);
      if (hello && !NOT_LIVE.test(hello.body)) {
        const g0 = Date.now();
        let n = ear.got.length;
        while (Date.now() - g0 < GREET_MAX_MS && await ear.next(n, GREET_QUIET_MS)) n = ear.got.length;
      }
      if (!hello || ear.got.some(m => NOT_LIVE.test(m.body))) {
        await wipe(chatId, sent, ear.got, null);
        if (!wasMuted) await unmute(chatId);
        await report({
          bot: botKey,
          status: hello ? "inactive" : "offline",
          stage: "hi",
          replies: said(ear.got),
          number: myNumber,
          lid: myLid
        });
        return {
          ok: false,
          message: hello ? "This number isn't active on " + name + " yet. Activate it with " + name + " first, then set up filtering." : name + " didn't answer. It may be offline. Try again in a little while."
        };
      }
      const early = ear.got.find(m => full(m.body));
      if (early) return await settle(botKey, chat, sent, early, ear.got, !wasMuted, "confirmed an earlier run");
      let n = ear.got.length;
      await send(setupMessage);
      const end = Date.now() + REPLY_TIMEOUT_MS;
      let answer = null, until = end;
      for (;;) {
        const m = await ear.next(n, Math.max(0, until - Date.now()));
        if (!m) break;
        answer = m;
        if (classify(m.body).ok) break;
        n = ear.got.indexOf(m) + 1;
        until = Math.min(end, Date.now() + GRACE_MS);
      }
      return await settle(botKey, chat, sent, answer, ear.got, !wasMuted, null);
    } catch (e) {
      await wipe(chatId, sent, ear.got, null);
      if (!wasMuted) await unmute(chatId);
      await report({
        bot: botKey,
        status: "error",
        error: String(e && e.message || e),
        replies: said(ear.got),
        number: myNumber,
        lid: myLid
      });
      return {
        ok: false,
        message: "Something went wrong during setup. Try again."
      };
    } finally {
      ear.stop();
    }
  }
  function listen(chatId) {
    const got = [], waiters = [];
    const handler = msg => {
      try {
        const mChat = msg && (msg.chatId ? msg.chatId._serialized : msg.id && msg.id.remote && msg.id.remote._serialized);
        if (msg && msg.id && !msg.id.fromMe && msg.type === "chat" && mChat === chatId) {
          got.push({
            id: msg.id._serialized,
            body: msg.body || ""
          });
          waiters.slice().forEach(w => w());
        }
      } catch (e) {}
    };
    let on = false;
    try {
      window.WPP.on("chat.new_message", handler);
      on = true;
    } catch (e) {}
    return {
      got: got,
      next(from, ms, test) {
        return new Promise(resolve => {
          let done = false, timer = null;
          const finish = v => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            const k = waiters.indexOf(check);
            if (k >= 0) waiters.splice(k, 1);
            resolve(v);
          };
          const check = () => {
            for (let i = from; i < got.length; i++) if (!test || test(got[i])) {
              finish(got[i]);
              return;
            }
          };
          waiters.push(check);
          timer = setTimeout(() => finish(null), ms);
          check();
        });
      },
      stop() {
        if (on) {
          try {
            window.WPP.off("chat.new_message", handler);
          } catch (e) {}
          on = false;
        }
      }
    };
  }
  function botChatById(chatId) {
    const s = chatStore();
    try {
      const c = s && s.getModelsArray().find(x => x.id && x.id._serialized === chatId);
      return c && botOfChat(c) ? c : null;
    } catch (e) {
      return null;
    }
  }
  async function wipe(chatId, sentIds, heard, reply) {
    if (!chatId || !botChatById(chatId)) return;
    const key = x => typeof x === "string" ? x : x && x._serialized || "";
    const ids = sentIds.concat(heard.map(m => m.id)).concat(reply ? [ reply.id ] : []).map(key).filter((x, i, a) => x && a.indexOf(x) === i && x.split("_")[1] === chatId).filter(x => !SUPPORT || x.indexOf("true_") === 0);
    if (ids.length) try {
      await window.WPP.chat.deleteMessage(chatId, ids, true, false);
    } catch (e) {}
  }
  async function confirmed(botKey, email, note) {
    setupDoneAt[botKey] = Date.now();
    if (!unlocked.includes(botKey)) unlocked.push(botKey);
    pending = pending.filter(b => b !== botKey);
    delete setupMsgs[botKey];
    await pushState();
    sync();
    const data = {
      bot: botKey,
      status: "ok",
      email: email || null,
      number: myNumber,
      lid: myLid
    };
    if (note) data.note = note;
    reportOk(data);
    sweepSoon(botKey);
  }
  async function settle(botKey, chat, sentIds, reply, heard, unmuteAfter, note) {
    const chatId = chat.id._serialized;
    const verdict = reply ? classify(reply.body) : {
      ok: false
    };
    const lateEar = verdict.ok ? null : listen(chatId);
    await wipe(chatId, sentIds, heard, reply);
    if (verdict.ok) {
      if (unmuteAfter) await unmute(chatId);
      await confirmed(botKey, verdict.email, note);
      return {
        ok: true
      };
    }
    const all = heard.length ? heard : reply ? [ reply ] : [];
    await report({
      bot: botKey,
      status: "failed",
      stage: "setup",
      replies: said(all),
      note: note,
      number: myNumber,
      lid: myLid
    });
    watchLate(botKey, chatId, lateEar, unmuteAfter);
    return {
      ok: false,
      message: cap(botKey) + " didn't confirm the filter. Try again."
    };
  }
  function watchLate(botKey, chatId, ear, ourMute) {
    if (late[botKey] && late[botKey].cancel()) ourMute = true;
    const acct = account;
    let over = false;
    const h = {
      cancel() {
        if (over) return false;
        over = true;
        ear.stop();
        if (late[botKey] === h) delete late[botKey];
        return !!ourMute;
      }
    };
    late[botKey] = h;
    ear.next(0, LATE_MS, m => full(m.body)).then(async m => {
      if (over) return;
      h.cancel();
      quiet(true);
      try {
        if (m) await wipe(chatId, [], [ m ], null);
        if (ourMute) await unmute(chatId);
      } catch (e) {} finally {
        quiet(false);
      }
      if (!m || account !== acct || unlocked.includes(botKey)) return;
      await confirmed(botKey, classify(m.body).email, "late");
      if (!busyBot) showBusy(botKey);
      finishBusy(botKey, {
        ok: true
      });
    });
  }
  const SWEEP_COUNT = 60;
  const PROMPT = /Fixed link:\s*https?:\/\/\S+\/fp\/\S+/i;
  async function strays(chatId) {
    let msgs;
    try {
      msgs = (await window.WPP.chat.getMessages(chatId, {
        count: SWEEP_COUNT
      })).filter(m => m && m.id);
    } catch (e) {
      return null;
    }
    const mine = m => !!m.id.fromMe;
    const fromBot = m => !mine(m) && m.type === "chat";
    const ids = [];
    let confirm = null;
    const add = m => {
      const id = m.id._serialized;
      if (ids.indexOf(id) < 0) ids.push(id);
    };
    const took = m => {
      if (!confirm && full(m.body)) confirm = {
        id: m.id._serialized,
        body: m.body || ""
      };
    };
    msgs.forEach((m, at) => {
      if (!mine(m) || !PROMPT.test(m.body || "")) return;
      add(m);
      for (let i = at - 1; i >= 0 && i >= at - 6; i--) {
        if (!mine(msgs[i])) continue;
        if (msgs[i].body === PROBE_MESSAGE && m.t - msgs[i].t < 180) {
          add(msgs[i]);
          msgs.slice(i + 1, at).filter(fromBot).forEach(add);
        }
        break;
      }
      const after = [];
      for (let i = at + 1; i < msgs.length && !mine(msgs[i]); i++) if (fromBot(msgs[i])) after.push(msgs[i]);
      const k = after.findIndex(x => classify(x.body).ok);
      (k >= 0 ? after.slice(0, k + 1) : after.filter(x => x.t - m.t < 150)).forEach(add);
      if (k >= 0) took(after[k]);
    });
    const oldest = Date.now() / 1e3 - LEFT_MAX_AGE_S;
    msgs.forEach((m, i) => {
      if (!fromBot(m) || !full(m.body) || !(m.t >= oldest) || ids.indexOf(m.id._serialized) >= 0) return;
      const before = msgs[i - 1];
      if (before ? mine(before) && m.t - before.t < LEFT_ANSWER_S : msgs.length >= SWEEP_COUNT) return;
      add(m);
      took(m);
    });
    return {
      ids: ids,
      confirm: confirm
    };
  }
  const sweeping = new Set;
  const swept = new Set;
  async function sweep(botKey) {
    const idle = () => !inflight.has(botKey) && !late[botKey] && (pending.includes(botKey) || unlocked.includes(botKey));
    if (sweeping.has(botKey) || !idle() || !wppUp()) return;
    const chat = botChat(botKey);
    if (!chat) return;
    sweeping.add(botKey);
    try {
      const chatId = chat.id._serialized;
      const old = await strays(chatId);
      if (!old || !idle()) return;
      if (unlocked.includes(botKey)) swept.add(botKey);
      if (!old.ids.length) return;
      const unlock = !!old.confirm && pending.includes(botKey);
      quiet(true);
      try {
        await wipe(chatId, old.ids, [], null);
        if (ourMute(chat)) await unmute(chatId);
      } finally {
        quiet(false);
      }
      if (!unlock) return;
      await confirmed(botKey, classify(old.confirm.body).email, "found in chat");
      if (!busyBot) showBusy(botKey);
      finishBusy(botKey, {
        ok: true
      });
    } catch (e) {} finally {
      sweeping.delete(botKey);
    }
  }
  function sweepSoon(botKey) {
    setTimeout(() => {
      swept.delete(botKey);
      sweep(botKey);
    }, 8e3);
  }
  const recovered = new Set;
  async function recover(botKey) {
    if (recovered.has(botKey) || inflight.has(botKey) || late[botKey] || !pending.includes(botKey) || !setupMsgs[botKey]) return;
    const whole = setupMsgs[botKey];
    const lm = whole.match(/Fixed link:\s*(\S+)/i);
    const link = lm ? lm[1] : null;
    const chat = botChat(botKey);
    if (!chat) return;
    recovered.add(botKey);
    running(botKey, true);
    let res = null, froze = false, found = false;
    try {
      const chatId = chat.id._serialized;
      const msgs = (await window.WPP.chat.getMessages(chatId, {
        count: 30
      })).filter(m => m && m.id);
      const mine = m => !!m.id.fromMe;
      const fromBot = m => !mine(m) && m.type === "chat";
      const isSetup = m => {
        const b = m.body || "";
        return mine(m) && (b === whole || !!link && b.indexOf(link) >= 0);
      };
      const muteEnds = isMuted(chat) ? chat.mute.expiration : 0;
      const ourMuteFrom = t => !!muteEnds && Math.abs(muteEnds - (t + 3600)) < 600;
      let s = -1, p = -1;
      for (let i = msgs.length - 1; i >= 0; i--) if (isSetup(msgs[i])) {
        s = i;
        break;
      }
      if (s >= 0) {
        for (let i = s - 1; i >= 0 && i >= s - 6; i--) if (mine(msgs[i]) && msgs[i].body === PROBE_MESSAGE && msgs[s].t - msgs[i].t < 180) {
          p = i;
          break;
        }
      } else for (let i = msgs.length - 1; i >= 0; i--) if (mine(msgs[i]) && msgs[i].body === PROBE_MESSAGE) {
        if (ourMuteFrom(msgs[i].t)) p = i;
        break;
      }
      if (s < 0 && p < 0) return;
      found = true;
      quiet(true);
      const del = [];
      msgs.forEach(m => {
        if (isSetup(m)) del.push(m.id._serialized);
      });
      if (p >= 0) {
        del.push(msgs[p].id._serialized);
        const greet = msgs.slice(p + 1, s >= 0 ? s : msgs.length).filter(fromBot);
        (s >= 0 ? greet : greet.slice(0, 1)).forEach(g => del.push(g.id._serialized));
      }
      let reply = null;
      if (s >= 0) {
        const after = msgs.slice(s + 1).filter(fromBot);
        const r = after.find(m => classify(m.body).ok) || after[0] || null;
        reply = r ? {
          id: r.id._serialized,
          body: r.body || ""
        } : null;
        const leftMs = REPLY_TIMEOUT_MS - (Date.now() - msgs[s].t * 1e3);
        if (!reply && leftMs > 1e3) {
          froze = true;
          showBusy(botKey);
          const ear = listen(chatId);
          reply = await ear.next(0, leftMs);
          ear.stop();
        }
      }
      const ourMute = s >= 0 && ourMuteFrom(msgs[s].t) || p >= 0 && ourMuteFrom(msgs[p].t);
      res = await settle(botKey, chat, del, reply, [], ourMute, "interrupted");
    } catch (e) {} finally {
      running(botKey, false);
      if (found) quiet(false);
      if (froze) finishBusy(botKey, res);
    }
  }
  function classify(body) {
    const t = (body || "").trim();
    if (!/got it/i.test(t)) return {
      ok: false
    };
    const m = t.match(/my email is[:\s]*([^\s]+@[^\s@]+\.[^\s@]+)/i);
    return {
      ok: true,
      email: m ? m[1].replace(/[.,;]+$/, "") : null
    };
  }
  window.addEventListener("message", e => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d) return;
    if (d.source === "geder-iso" && waiting.has(d.id)) {
      const r = waiting.get(d.id);
      waiting.delete(d.id);
      r(d.payload);
      return;
    }
    if (d.source === "geder-iso-req" && d.type === "RUN_SETUP") {
      const back = payload => window.postMessage({
        source: "geder-main-resp",
        id: d.id,
        payload: payload
      }, "*");
      if (SUPPORT) {
        back({
          ok: false,
          message: "Geder support will ask you to start setup when they're ready."
        });
        return;
      }
      runSetup(d.payload && d.payload.bot).then(back).catch(err => back({
        ok: false,
        message: String(err && err.message || err)
      }));
    }
  });
  const NOTE_KEY = "BO26bmBKSW36G2qslNMkyX5OdUdlknNT3xG3wOA-PjPlaFOlGSTmaSLc23xvaqPfDPPnd2RX2nkwQwhm_b5JG2A";
  const NOTE_RE = /GEDER1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  const NOTE_STORE = "geder-wa:note";
  const NOTE_LABEL = "Geder filter key. Please keep this message.\n";
  const b64d = x => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((x.length + 3) % 4)), c => c.charCodeAt(0));
  let noteKey = null, noteChain = Promise.resolve(true), notePosted = "";
  function noteBody(raw) {
    try {
      const b = JSON.parse((new TextDecoder).decode(b64d(raw.split(".")[1])));
      return b && typeof b.t === "number" && Array.isArray(b.u) ? b : null;
    } catch (e) {
      return null;
    }
  }
  const noteForMe = b => b.l && myLid ? b.l === myLid : !!b.n && b.n === myNumber;
  async function noteValid(raw) {
    const b = noteBody(raw);
    if (!b || !noteForMe(b) || !NOTE_KEY || !(window.crypto && crypto.subtle)) return null;
    try {
      if (!noteKey) noteKey = await crypto.subtle.importKey("raw", b64d(NOTE_KEY), {
        name: "ECDSA",
        namedCurve: "P-256"
      }, false, [ "verify" ]);
      const p = raw.split(".");
      return await crypto.subtle.verify({
        name: "ECDSA",
        hash: "SHA-256"
      }, noteKey, b64d(p[2]), (new TextEncoder).encode(p[1])) ? b : null;
    } catch (e) {
      return null;
    }
  }
  const selfChats = () => [ myLid && myLid + "@lid", myNumber && myNumber + "@c.us" ].filter(Boolean);
  async function chatNotes() {
    const out = [];
    const take = msgs => {
      for (const m of msgs || []) {
        const hit = m && m.id && m.id.fromMe && typeof m.body === "string" && m.body.match(NOTE_RE);
        if (hit) out.push(hit[0]);
      }
    };
    for (const id of selfChats()) try {
      take(await window.WPP.chat.getMessages(id, {
        count: 50
      }));
    } catch (e) {}
    if (!out.length) try {
      const CC = window.require("WAWebChatCollection").ChatCollection;
      const D = window.require("WAWebDBMessageFindLocal");
      for (const id of selfChats()) {
        const chat = CC.get(id);
        if (!chat) continue;
        const r = await D.msgFindSearch({
          searchTerm: "GEDER1",
          remote: chat.id,
          page: 1,
          count: 20
        });
        take(Array.isArray(r) ? r : r && r.messages || []);
      }
    } catch (e) {}
    return out;
  }
  const storedNote = () => {
    try {
      return localStorage.getItem(NOTE_STORE) || "";
    } catch (e) {
      return "";
    }
  };
  async function newestNote(raws) {
    let best = null;
    for (const raw of [ storedNote() ].concat(raws || [])) {
      if (!raw) continue;
      const b = await noteValid(raw);
      if (b && (!best || b.t > best.b.t)) best = {
        raw: raw,
        b: b
      };
    }
    if (best && best.raw !== storedNote()) try {
      localStorage.setItem(NOTE_STORE, best.raw);
    } catch (e) {}
    return best;
  }
  async function fromNote(acct) {
    if (!NOTE_KEY || !await wppReady(1)) return false;
    const n = await newestNote(await chatNotes());
    if (!n || readIdentity() !== acct) return false;
    unlocked = clean(n.b.u);
    pending = [];
    setupMsgs = {};
    await pushState();
    sync();
    return false;
  }
  function postNote(raw, acct) {
    noteChain = noteChain.then(() => postNoteNow(raw, acct), () => postNoteNow(raw, acct));
    return noteChain;
  }
  async function postNoteNow(raw, acct) {
    try {
      const fresh = noteBody(raw);
      if (!fresh || !await wppReady(12e4) || readIdentity() !== acct) return false;
      let last = null;
      for (const r of await chatNotes()) {
        const b = NOTE_KEY ? await noteValid(r) : noteBody(r);
        if (b && noteForMe(b) && (!last || b.t > last.t)) last = b;
      }
      const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
      const sig = acct + "|" + clean(fresh.u).sort().join(",");
      if (notePosted === sig) return true;
      if (last && same(clean(last.u), clean(fresh.u))) return true;
      if (!last && !clean(fresh.u).length) return true;
      const to = selfChats()[0];
      if (!to) return false;
      await window.WPP.chat.sendTextMessage(to, NOTE_LABEL + raw, {
        createChat: true
      });
      notePosted = sig;
      return true;
    } catch (e) {
      return false;
    }
  }
  const removing = new Set;
  async function runRemoval(botKey, text, raw, acct) {
    if (!BOT_NAME[botKey] || typeof text !== "string" || !text || removing.has(botKey) || inflight.has(botKey)) return;
    removing.add(botKey);
    let ear = null;
    const sent = [];
    const fail = data => report(Object.assign({
      bot: botKey,
      status: "remove_failed",
      number: myNumber,
      lid: myLid
    }, data));
    try {
      if (!await wppReady(12e4) || readIdentity() !== acct) return;
      if (!raw || !await postNote(raw, acct)) {
        await fail({
          note: "hide note not posted"
        });
        return;
      }
      const chat = botChat(botKey);
      if (!chat) {
        await fail({
          note: "chat not found"
        });
        return;
      }
      const chatId = chat.id._serialized;
      const wasMuted = isMuted(chat);
      if (!wasMuted) await mute(chatId);
      ear = listen(chatId);
      quiet(true);
      try {
        const r = await window.WPP.chat.sendTextMessage(chatId, text, {
          createChat: true
        });
        sent.push(r && (r.id || r.ack && r.ack.id) || null);
        const reply = await ear.next(0, REPLY_TIMEOUT_MS, m => /filter updated/i.test(m.body || ""));
        await wipe(chatId, sent, ear.got, reply);
        if (!wasMuted) await unmute(chatId);
        if (reply) await report({
          bot: botKey,
          status: "removed",
          replies: said(ear.got),
          number: myNumber,
          lid: myLid
        }); else await fail({
          replies: said(ear.got)
        });
      } finally {
        quiet(false);
      }
    } catch (e) {
      try {
        await fail({
          error: String(e && e.message || e)
        });
      } catch (x) {}
    } finally {
      if (ear) ear.stop();
      removing.delete(botKey);
    }
  }
  function hideNotes() {
    document.querySelectorAll('#main [role="row"]').forEach(r => {
      const hit = (r.textContent || "").indexOf("GEDER1.") >= 0;
      if (hit) r.style.setProperty("display", "none", "important"); else if (r.style.display === "none") r.style.removeProperty("display");
    });
    document.querySelectorAll("#pane-side span").forEach(sp => {
      if (!sp.children.length && (sp.textContent || "").indexOf("GEDER1.") >= 0) sp.style.setProperty("visibility", "hidden", "important");
    });
  }
  let refreshing = null, lastRefresh = 0;
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const now = readIdentity();
      if (!now) return false;
      if (now !== account) {
        account = now;
        unlocked = [];
        pending = [];
        setupMsgs = {};
        hideGate();
        await pushState();
        sync();
      }
      lastRefresh = Date.now();
      const cfg = await getConfig(myNumber, myLid);
      if (!cfg || !Array.isArray(cfg.unlockedBots)) return await fromNote(now);
      if (readIdentity() !== now) return false;
      const msgs = cfg.setup && typeof cfg.setup === "object" ? cfg.setup : {};
      let un = clean(cfg.unlockedBots);
      for (const b of BOTS) if (!un.includes(b) && setupDoneAt[b] && Date.now() - setupDoneAt[b] < 6e4) un.push(b);
      unlocked = un;
      pending = clean(Object.keys(msgs)).filter(b => !unlocked.includes(b));
      setupMsgs = {};
      pending.forEach(b => {
        if (typeof msgs[b] === "string") setupMsgs[b] = msgs[b];
      });
      haveServer = true;
      await pushState();
      sync();
      const noteRaw = typeof cfg.note === "string" && NOTE_RE.test(cfg.note) ? cfg.note.match(NOTE_RE)[0] : "";
      if (noteRaw) postNote(noteRaw, now);
      if (SUPPORT) supportBots = clean(cfg.support);
      const rm = cfg.remove && typeof cfg.remove === "object" ? cfg.remove : {};
      clean(Object.keys(rm)).forEach(b => runRemoval(b, rm[b], noteRaw, now));
      BOTS.forEach(b => {
        const locked = pending.includes(b) && !!setupMsgs[b];
        if (!locked && !(unlocked.includes(b) && !swept.has(b))) return;
        wppReady(12e4).then(async ok => {
          if (!ok) return;
          if (locked) try {
            await recover(b);
          } catch (e) {}
          await sweep(b);
        });
      });
      return true;
    })().catch(() => false).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  async function refreshLoop() {
    let delay = 1e3;
    for (;;) {
      delay = await refresh() ? 5 * 60 * 1e3 : Math.min(delay * 2, 6e4);
      await sleep(delay);
    }
  }
  async function waitFor(fn, everyMs) {
    for (;;) {
      let v = null;
      try {
        v = fn();
      } catch (e) {}
      if (v) return v;
      await sleep(everyMs);
    }
  }
  async function getCache() {
    for (let i = 0; i < 40; i++) {
      const c = await ask("GET_CACHE", null, 400);
      if (c) return c;
    }
    return null;
  }
  let supportBots = [];
  const supEars = {};
  const pull = (number, lid) => ask("SUPPORT_PULL", {
    number: number,
    lid: lid,
    open: true
  });
  const push = data => ask("SUPPORT_PUSH", data);
  function supEar(b) {
    if (supEars[b]) return;
    const chat = botChat(b);
    if (!chat) return;
    const chatId = chat.id._serialized;
    const handler = msg => {
      try {
        const mChat = msg && (msg.chatId ? msg.chatId._serialized : msg.id && msg.id.remote && msg.id.remote._serialized);
        if (!msg || !msg.id || msg.id.fromMe || mChat !== chatId || typeof msg.body !== "string" || !msg.body) return;
        if (inflight.has(b)) return;
        push({
          bot: b,
          body: msg.body.slice(0, 4e3),
          number: myNumber,
          lid: myLid
        });
      } catch (e) {}
    };
    try {
      window.WPP.on("chat.new_message", handler);
      supEars[b] = {
        chatId: chatId,
        stop() {
          try {
            window.WPP.off("chat.new_message", handler);
          } catch (e) {}
        }
      };
    } catch (e) {}
  }
  let notice = null;
  function retryNotice(b) {
    if (notice) notice.remove();
    const n = document.createElement("div");
    Object.assign(n.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: 2147483647,
      background: "#1f2c34",
      color: "#e9edef",
      padding: "14px 16px",
      borderRadius: "10px",
      maxWidth: "320px",
      font: "400 14px system-ui,sans-serif",
      boxShadow: "0 4px 16px rgba(0,0,0,.4)"
    });
    const t = document.createElement("div");
    t.textContent = "Geder support has asked you to try setting up filtering for " + cap(b) + " again.";
    t.style.marginBottom = "10px";
    const go = document.createElement("button");
    go.textContent = "Set up filtering";
    Object.assign(go.style, {
      padding: "8px 14px",
      background: "#00a884",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      marginRight: "8px"
    });
    const no = document.createElement("button");
    no.textContent = "Not now";
    Object.assign(no.style, {
      padding: "8px 14px",
      background: "transparent",
      color: "#8696a0",
      border: "1px solid #2a3942",
      borderRadius: "8px",
      cursor: "pointer"
    });
    go.onclick = () => {
      n.remove();
      notice = null;
      runSetup(b);
    };
    no.onclick = () => {
      n.remove();
      notice = null;
    };
    n.appendChild(t);
    n.appendChild(go);
    n.appendChild(no);
    document.body.appendChild(n);
    notice = n;
  }
  async function supportTick() {
    for (const b of Object.keys(supEars)) if (!supportBots.includes(b)) {
      supEars[b].stop();
      delete supEars[b];
    }
    if (!(myNumber || myLid) || !await wppReady(1)) return;
    const r = await pull(myNumber, myLid);
    if (r && Array.isArray(r.open)) supportBots = clean(r.open);
    supportBots.forEach(supEar);
    for (const it of r && Array.isArray(r.items) ? r.items : []) {
      if (!BOT_NAME[it.bot] || !supportBots.includes(it.bot)) continue;
      if (it.kind === "retry") {
        retryNotice(it.bot);
        continue;
      }
      const body = String(it.body || "");
      if (!body) continue;
      const chat = botChat(it.bot);
      if (!chat) continue;
      const text = /^Geder support:/.test(body) ? body : "Geder support: " + body;
      try {
        await window.WPP.chat.sendTextMessage(chat.id._serialized, text, {
          createChat: true
        });
      } catch (e) {}
    }
  }
  if (SUPPORT) setInterval(() => {
    supportTick().catch(() => {});
  }, 1e4);
  const LINK_FLAG = [ "_gx", "1" ];
  const LINK_HOSTS = {
    instinct: /(^|\.)instinct\.com$/i,
    tab: /(^|\.)tab\.bot$/i
  };
  function flagged(href) {
    let u;
    try {
      u = new URL(String(href), location.href);
    } catch (e) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    const b = BOTS.find(k => LINK_HOSTS[k] && LINK_HOSTS[k].test(u.hostname));
    if (!b || !unlocked.includes(b)) return null;
    if (u.searchParams.get(LINK_FLAG[0]) === LINK_FLAG[1]) return null;
    u.searchParams.set(LINK_FLAG[0], LINK_FLAG[1]);
    return u.href;
  }
  function flagAnchor(e) {
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    const f = flagged(a.getAttribute("href"));
    if (f) a.setAttribute("href", f);
  }
  for (const ev of [ "pointerdown", "mousedown", "auxclick", "click", "keydown" ]) document.addEventListener(ev, flagAnchor, true);
  try {
    const open0 = window.open;
    window.open = function(url) {
      const f = url != null ? flagged(url) : null;
      const args = Array.prototype.slice.call(arguments);
      if (f) args[0] = f;
      return open0.apply(this, args);
    };
  } catch (e) {}
  for (const ev of [ "pointerdown", "mousedown", "click" ]) document.addEventListener(ev, onPanePointer, true);
  document.addEventListener("keydown", e => {
    if (busyBot) {
      const close = busyDone && busyParts && busyParts.ok.style.display !== "none" && (e.key === "Enter" || e.key === "Escape");
      e.stopImmediatePropagation();
      e.preventDefault();
      if (close) hideBusy();
      return;
    }
    if (e.key === "Escape" && gateBot && gateOrigin === "click") hideGate();
  }, true);
  window.addEventListener("resize", positionGate);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && armed && Date.now() - lastRefresh > 3e4) refresh();
  });
  window.addEventListener("message", e => {
    if (e.source === window && e.data && e.data.source === "geder-net" && e.data.type === "CONFIG_CHANGED" && armed) refresh();
  });
  (async () => {
    const store = await waitFor(chatStore, 50);
    store.on("change:active", onActive);
    armed = true;
    sync();
    setInterval(sync, 500);
    setInterval(hideNotes, 1e3);
    let numberSince = 0;
    const id = await waitFor(() => {
      const a = readIdentity();
      if (!a || a.indexOf("lid:") === 0) return a;
      if (!numberSince) numberSince = Date.now();
      return Date.now() - numberSince > 3e3 ? a : "";
    }, 250);
    if (!account) account = id;
    const cache = await getCache();
    if (!haveServer && cache && cache.account === account) {
      unlocked = clean(cache.unlocked);
      pending = clean(cache.pending).filter(b => !unlocked.includes(b));
    }
    await pushState();
    sync();
    refreshLoop();
  })();
})();
