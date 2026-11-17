(() => {
  "use strict";
  try {
    document.documentElement.setAttribute("data-geder-wa", "1");
  } catch (e) {}
  const BOT = {
    instinct: {
      markers: [ /\[title\s*=\s*["']?instinct["']?(\s+i)?\s*\]/i, /1619344009540019/ ],
      name: /^instinct$/i
    },
    tab: {
      markers: [ /\[title\s*=\s*["']?tab["']?(\s+i)?\s*\]/i, /1532261188654319/ ],
      name: /^tab$/i
    }
  };
  const BOTS = Object.keys(BOT);
  const STYLE_ID = "gf-wa-hide";
  const LOCK_ATTR = "data-gf-lock";
  const LOCK_RULE = "html[" + LOCK_ATTR + "] div#main";
  const OPEN_ATTR = "data-gf-open";
  const RUN_ATTR = "data-gf-run";
  const RUN_RULES = [ "html[" + RUN_ATTR + "] #wds-toast-container", "html[" + RUN_ATTR + '] ul[aria-live="polite"] > li[role="status"]' ];
  const HIDE = "{display:none !important}";
  const IS_CONVERSATION = /#main\b|\[\s*id\s*=\s*["']?main["']?\s*\]/i;
  const FILTER_STATUS = [ 'button[aria-label="Status"]', 'button[aria-label="Updates in Status"]', 'div[aria-label="View status"]', 'div[data-animate-status-viewer="true"]', 'button[aria-label="\u05e1\u05d8\u05d8\u05d5\u05e1"]' ];
  const FILTER_MAIN = [ 'div[class="_3OtEr rOo0o"]', 'div[class="_ajv7 _ajv5 _ajvb"]', 'div[title="Channels"]', 'div[aria-label="Channels"]', 'button[aria-label="Channels"]', 'button[aria-label="\u05e2\u05e8\u05d5\u05e6\u05d9\u05dd"]', 'button[aria-label="*;Meta AI"]', 'div[title="Meta AI"]', 'div[aria-label="Meta AI"]', 'button[aria-label="Meta AI"]', 'div[data-id*="newsletter"]', 'div[class="xktia5q x27kpxv x135pmgq x2b8uid"]', 'div[class="x1a8lsjc"]', 'div[class="x1a8lsjc velocity-animating"]', 'div[class="xcldk2z x1phvje8 xa0aww2 x1gxa6cn"]', 'div[aria-label="Type a message to Meta AI"]', 'div[id="main"]:has(span[title="with Llama 4"])', 'div[id="main"]:has(div[aria-label="Type a message to Meta AI"])', 'div[id="main"]:has(span[title="Official WhatsApp account"])', 'div[class="x10l6tqk xh8yej3 x1g42fcv"]:has(span[title="Meta AI"])', 'div[class="x10l6tqk xh8yej3 x1g42fcv"]:has(span[title="ChatGPT"])', 'button:has(img[src*="ai_assistant"])', 'p:has(span[data-app-text-template*="13135550002"]) span:not([data-app-text-template])' ];
  let unlocked = [];
  let pending = [];
  let account = "";
  let armed = false;
  let fromMain = false;
  let titles = {};
  let exempt = {};
  const scoped = s => "html:not([" + OPEN_ATTR + '="' + exempt[s] + '"]) ' + s;
  const isBotTitle = (b, title) => BOT[b].name.test(title) || (titles[b] || []).indexOf(title) >= 0;
  const clean = a => Array.isArray(a) ? a.filter((b, i) => BOT[b] && a.indexOf(b) === i) : [];
  const rowShown = b => unlocked.includes(b) || armed && pending.includes(b);
  const botOf = sel => BOTS.find(b => BOT[b].markers.some(re => re.test(sel))) || null;
  const NET = typeof NETWORK_BUILD !== "undefined" && NETWORK_BUILD === true;
  let filterList = NET ? [] : FILTER_MAIN.slice();
  let sawFilterRule = false;
  const okList = a => Array.isArray(a) && a.length > 0 && a.length <= 300 && a.every(x => typeof x === "string" && x.length > 0 && x.length < 400);
  function splitSelectors(text) {
    const out = [];
    let depth = 0, quote = "", cur = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        cur += ch;
        if (ch === "\\") cur += text[++i] || ""; else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === "(" || ch === "[") depth++; else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out.filter(Boolean);
  }
  let styleEl = null;
  let renderedKey = null, renderedSheet = null, renderedCount = 0;
  function managedSheet() {
    if (!styleEl || !styleEl.isConnected) {
      const root = document.head || document.documentElement;
      if (!root) return null;
      styleEl = document.getElementById(STYLE_ID) || document.createElement("style");
      styleEl.id = STYLE_ID;
      if (!styleEl.isConnected) root.appendChild(styleEl);
    }
    return styleEl.sheet || null;
  }
  function wanted() {
    const sels = [];
    const add = s => {
      if (sels.indexOf(s) < 0) sels.push(s);
    };
    if (filterList.some(x => botOf(x)) || pending.length) add(LOCK_RULE);
    RUN_RULES.forEach(add);
    for (const s of (NET ? [] : FILTER_MAIN).concat(filterList)) {
      const b = botOf(s);
      if (exempt[s]) continue;
      if (!b) add(s); else if (IS_CONVERSATION.test(s)) {
        if (!unlocked.includes(b)) add(s);
      } else if (!rowShown(b)) add(s);
    }
    Object.keys(exempt).forEach(s => add(scoped(s)));
    return sels;
  }
  function render() {
    const sheet = managedSheet();
    if (!sheet) return;
    const sels = wanted();
    const key = sels.join("\n");
    if (sheet === renderedSheet && key === renderedKey && sheet.cssRules.length === renderedCount) return;
    try {
      while (sheet.cssRules.length) sheet.deleteRule(0);
    } catch (e) {}
    for (const s of sels) try {
      sheet.insertRule(s + HIDE, sheet.cssRules.length);
    } catch (e) {}
    renderedSheet = sheet;
    renderedKey = key;
    renderedCount = sheet.cssRules.length;
  }
  function canMirror(sheet, sel) {
    try {
      const i = sheet.insertRule(sel + HIDE, sheet.cssRules.length);
      sheet.deleteRule(i);
      return true;
    } catch (e) {
      return false;
    }
  }
  const scanned = new WeakMap;
  function harvest() {
    const sheet = managedSheet();
    if (!sheet) return;
    const edits = [];
    for (const ss of Array.from(document.styleSheets)) {
      if (ss === sheet) continue;
      let rules;
      try {
        rules = ss.cssRules;
      } catch (e) {
        continue;
      }
      if (!rules || scanned.get(ss) === rules.length) continue;
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (rule.type !== 1 || !rule.selectorText || !rule.style) continue;
        if (rule.style.getPropertyValue("display") !== "none") continue;
        const parts = splitSelectors(rule.selectorText);
        if (!parts.some(s => botOf(s) || exempt[s])) continue;
        const keep = [], moved = [];
        for (const s of parts) if ((botOf(s) || exempt[s] && canMirror(sheet, scoped(s))) && canMirror(sheet, s)) moved.push(s); else keep.push(s);
        if (moved.length) edits.push({
          ss: ss,
          rule: rule,
          keep: keep,
          parts: parts
        });
      }
      scanned.set(ss, rules.length);
    }
    if (!edits.length) return;
    if (!sawFilterRule) {
      const found = [];
      edits.forEach(e => {
        if (e.parts.some(s => botOf(s))) e.parts.forEach(s => {
          if (found.indexOf(s) < 0) found.push(s);
        });
      });
      if (okList(found)) {
        sawFilterRule = true;
        filterList = found;
        try {
          chrome.storage.local.set({
            gfFilterSel: found
          });
        } catch (e) {}
      }
    }
    render();
    for (const e of edits) try {
      if (e.keep.length) e.rule.selectorText = e.keep.join(", "); else {
        const i = Array.prototype.indexOf.call(e.ss.cssRules, e.rule);
        if (i >= 0) e.ss.deleteRule(i);
      }
      scanned.set(e.ss, e.ss.cssRules.length);
    } catch (err) {
      scanned.delete(e.ss);
    }
  }
  function rowOf(s) {
    return s.closest('[role="row"]') || s.closest('[role="listitem"]') || s.closest('[role="gridcell"]');
  }
  function hidePreview() {
    if (!pending.length) return;
    const titleSpans = document.querySelectorAll('#pane-side span[title]');
    titleSpans.forEach(s => {
      const title = (s.title || "").trim();
      if (!pending.some(b => isBotTitle(b, title))) return;
      const row = rowOf(s);
      if (!row) return;
      row.querySelectorAll("span,div,[data-icon]").forEach(el => {
        if (el.contains(s) || s.contains(el)) return;
        const hasText = !!(el.textContent || "").trim();
        const isIcon = el.hasAttribute && el.hasAttribute("data-icon");
        if (!hasText && !isIcon) return;
        if (el.dataset && el.dataset.gfHidden) return;
        el.style.setProperty("visibility", "hidden", "important");
        if (el.dataset) el.dataset.gfHidden = "1";
      });
    });
  }
  function restorePreview() {
    document.querySelectorAll("[data-gf-hidden]").forEach(el => {
      el.style.removeProperty("visibility");
      delete el.dataset.gfHidden;
    });
  }
  function learnOpen() {
    const root = document.documentElement;
    const b = root.getAttribute(OPEN_ATTR);
    if (!b || !BOT[b] || !unlocked.includes(b)) return;
    const main = document.getElementById("main");
    if (!main) return;
    const hidden = [];
    for (let el = main; el && el !== document.body && el !== root; el = el.parentElement) try {
      if (getComputedStyle(el).display === "none") hidden.push(el);
    } catch (e) {}
    if (!hidden.length) return;
    let found = 0;
    for (const ss of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = ss.cssRules;
      } catch (e) {
        continue;
      }
      for (const rule of Array.from(rules || [])) {
        if (rule.type !== 1 || !rule.selectorText || !rule.style) continue;
        if (rule.style.getPropertyValue("display") !== "none") continue;
        for (const s of splitSelectors(rule.selectorText)) {
          if (s === LOCK_RULE || RUN_RULES.indexOf(s) >= 0 || /^\s*(html|:root)\b/i.test(s)) continue;
          if (exempt[s] || Object.keys(exempt).length >= 50) continue;
          const owner = botOf(s);
          if (owner && owner !== b) continue;
          let hit = false;
          try {
            hit = hidden.some(el => el.matches(s));
          } catch (e) {}
          if (!hit) continue;
          exempt[s] = b;
          found++;
          scanned.delete(ss);
        }
      }
    }
    if (!found) return;
    try {
      chrome.storage.local.set({
        gfExempt: exempt
      });
    } catch (e) {}
    renderedKey = null;
    harvest();
    render();
  }
  function apply() {
    harvest();
    render();
    learnOpen();
    hidePreview();
  }
  function persist() {
    try {
      chrome.storage.local.set({
        gfState: {
          account: account,
          unlocked: unlocked,
          pending: pending
        }
      });
    } catch (e) {}
  }
  const cacheReady = new Promise(resolve => {
    try {
      chrome.storage.local.get([ "gfState", "gfFilterSel", "gfExempt" ], r => {
        const ex = r && r.gfExempt;
        if (ex && typeof ex === "object") Object.keys(ex).slice(0, 50).forEach(k => {
          if (BOT[ex[k]] && typeof k === "string" && k.length < 400 && !exempt[k]) exempt[k] = ex[k];
        });
        if (!NET && !sawFilterRule && r && okList(r.gfFilterSel) && r.gfFilterSel.some(x => botOf(x))) filterList = r.gfFilterSel.slice();
        const s = r && r.gfState || {};
        if (!fromMain) {
          account = typeof s.account === "string" ? s.account : "";
          unlocked = clean(s.unlocked);
          pending = clean(s.pending).filter(b => !unlocked.includes(b));
        }
        apply();
        resolve();
      });
      chrome.storage.local.remove([ "gfReveal", "gfPending" ]);
    } catch (e) {
      resolve();
    }
  });
  let seq = 0;
  const waiting = new Map;
  function toMain(type, payload) {
    return new Promise(resolve => {
      const id = "iso" + ++seq;
      waiting.set(id, resolve);
      window.postMessage({
        source: "geder-iso-req",
        id: id,
        type: type,
        payload: payload
      }, "*");
      setTimeout(() => {
        if (waiting.delete(id)) resolve(null);
      }, 12e4);
    });
  }
  const runSetup = bot => toMain("RUN_SETUP", {
    bot: bot
  });
  window.addEventListener("message", e => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d) return;
    if (d.source === "geder-main-resp" && waiting.has(d.id)) {
      const r = waiting.get(d.id);
      waiting.delete(d.id);
      r(d.payload);
      return;
    }
    if (d.source !== "geder-main") return;
    const back = payload => window.postMessage({
      source: "geder-iso",
      id: d.id,
      payload: payload
    }, "*");
    try {
      if (d.type === "GET_CONFIG") chrome.runtime.sendMessage({
        type: "GET_WA_CONFIG",
        number: d.payload && d.payload.number,
        lid: d.payload && d.payload.lid
      }, resp => {
        void chrome.runtime.lastError;
        back(resp && resp.ok ? resp.cfg : null);
      }); else if (d.type === "REPORT_SETUP") chrome.runtime.sendMessage({
        type: "REPORT_SETUP",
        data: d.payload
      }, resp => {
        void chrome.runtime.lastError;
        back(!!(resp && resp.ok));
      }); else if (d.type === "SUPPORT_PULL" || d.type === "SUPPORT_PUSH") chrome.runtime.sendMessage({
        type: d.type,
        data: d.payload
      }, resp => {
        void chrome.runtime.lastError;
        back(resp && resp.ok ? resp.data : null);
      }); else if (d.type === "GET_CACHE") cacheReady.then(() => back({
        account: account,
        unlocked: unlocked,
        pending: pending
      })); else if (d.type === "STATE") {
        const p = d.payload || {};
        fromMain = true;
        account = typeof p.account === "string" ? p.account : "";
        unlocked = clean(p.unlocked);
        pending = clean(p.pending).filter(b => !unlocked.includes(b));
        armed = !!p.armed;
        titles = {};
        BOTS.forEach(b => {
          const t = p.titles && p.titles[b];
          titles[b] = Array.isArray(t) ? t.filter(x => typeof x === "string" && x.length < 200).slice(0, 8) : [];
        });
        persist();
        restorePreview();
        apply();
        back(true);
      }
    } catch (err) {
      back(null);
    }
  });
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "POPUP_GET_STATE") {
        sendResponse({
          reveal: unlocked.concat(pending),
          pending: pending
        });
        return false;
      }
      if (msg && msg.type === "POPUP_RUN_SETUP" && msg.bot) {
        runSetup(msg.bot).then(r => sendResponse(r || {
          ok: false
        }));
        return true;
      }
    });
  } catch (e) {}
  let sheetScheduled = false, hideScheduled = false;
  function scheduleSheet() {
    if (sheetScheduled) return;
    sheetScheduled = true;
    requestAnimationFrame(() => {
      sheetScheduled = false;
      harvest();
      render();
    });
  }
  function scheduleHide() {
    if (hideScheduled) return;
    hideScheduled = true;
    queueMicrotask(() => {
      hideScheduled = false;
      hidePreview();
    });
  }
  apply();
  new MutationObserver(() => {
    scheduleHide();
    scheduleSheet();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  new MutationObserver(() => requestAnimationFrame(learnOpen)).observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ OPEN_ATTR ]
  });
  setInterval(apply, 3e3);
})();
