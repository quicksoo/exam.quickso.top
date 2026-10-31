import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
assert.equal(/<(?:script|img)\b[^>]*\bsrc=|<link\b(?=[^>]*\brel=["'](?:stylesheet|icon|preload|modulepreload|manifest)["'])[^>]*\bhref=/i.test(html), false, "The offline page must not depend on external assets; canonical metadata does not load a resource");
assert.equal(html.match(/<link rel="canonical" href="([^"]+)"/)[1], "https://exam.quickso.top/");
const seo = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
assert.equal(seo["@type"], "WebApplication");
assert.equal(seo.url, "https://exam.quickso.top/");

// Execute the real page script with a controlled clock and minimal DOM.
// No browser, audio device, network, or dependencies are needed.
function launch({ now, saved, embedded = null, unavailableStorage = false } = {}) {
  let currentTime = now;
  let timer;
  let exportedConfig;
  let exportedBlob;
  class Element {
    constructor() { this.textContent = ""; this.hidden = false; this.value = ""; this.checked = false; this.open = false; this.dataset = {}; this.style = {}; this.listeners = {}; this.children = []; this.attributes = {}; this.classList = { toggle() {} }; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
    remove() {}
    click() { this.listeners.click?.({ target: this }); }
    showModal() { this.open = true; this.modalCount = (this.modalCount || 0) + 1; }
    close() { this.open = false; this.listeners.close?.(); }
  }
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  nodes.get("exam-config").textContent = JSON.stringify(embedded);
  const root = new Element();
  root.cloneNode = () => ({
    dataset: {},
    querySelector(selector) {
      if (selector === "#exam-config") return { set textContent(value) { exportedConfig = value; } };
      return new Element();
    },
    querySelectorAll() { return []; },
    get outerHTML() { return `<html><script type="application/json">${exportedConfig}</script></html>`; },
  });
  const storage = new Map(saved ? [["quickso-exam-v1", JSON.stringify(saved)]] : []);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
    static now() { return currentTime; }
  }
  const context = vm.createContext({
    document: { getElementById: (id) => nodes.get(id), documentElement: root, body: new Element(), createElement: () => new Element(), addEventListener() {} },
    localStorage: {
      getItem(key) { if (unavailableStorage) throw new Error("Storage blocked"); return storage.get(key) || null; },
      setItem(key, value) { if (unavailableStorage) throw new Error("Storage blocked"); storage.set(key, value); },
    },
    window: { addEventListener() {} },
    location: { search: "", protocol: "http:" },
    Date: Clock, Intl, URLSearchParams, Blob,
    URL: { createObjectURL(blob) { exportedBlob = blob; return "blob:test"; }, revokeObjectURL() {} },
    setInterval(callback) { timer = callback; }, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(script, context);
  return {
    nodes, root, storage, context,
    advance(milliseconds) { currentTime += milliseconds; timer(); },
    save(values) {
      nodes.get("settings-button").click();
      for (const [name, value] of Object.entries(values)) {
        const field = nodes.get(`input-${name}`);
        if (typeof value === "boolean") field.checked = value;
        else field.value = value;
      }
      nodes.get("settings-form").listeners.submit({ preventDefault() {} });
    },
    export() { nodes.get("export-button").click(); return { config: exportedConfig, blob: exportedBlob }; },
  };
}

const now = new Date("2026-10-31T08:59:59").getTime();
const settings = { title: "考试测试", start: "2026-10-31T09:00:00", end: "2026-10-31T09:01:00", notices: "第一条\n\n第二条", warningMinutes: 5, theme: "light", sound: false };
for (const id of ["input-start", "input-end"]) {
  assert.match(html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0], /step="60"/);
}
assert.equal(/id="input-(?:warning|theme)"/.test(html), false, "Removed settings must not appear in the form");
const page = launch({ now, saved: settings });
assert.equal(page.context.document.body.dataset.phase, "waiting");
assert.equal(page.nodes.get("countdown").textContent, "00:00:01");
assert.equal(page.nodes.get("notice-list").children.length, 2);
page.advance(1000);
assert.equal(page.context.document.body.dataset.phase, "active");
assert.equal(page.context.document.body.dataset.warning, "true");
page.advance(59250);
assert.equal(page.nodes.get("countdown").textContent, "00:00:01", "Fractions of a second must not end the countdown early");
page.advance(750);
assert.equal(page.nodes.get("countdown").textContent, "00:00:00");
assert.equal(page.context.document.body.dataset.phase, "ended");
assert.equal(page.nodes.get("alarm-dialog").modalCount, 1);
page.nodes.get("dismiss-alarm").click();
page.advance(60000);
assert.equal(page.nodes.get("alarm-dialog").open, false);
assert.equal(page.nodes.get("alarm-dialog").modalCount, 1, "An ended exam must not repeatedly alert");
const expired = launch({ now: now + 62000, saved: settings });
assert.equal(expired.nodes.get("alarm-dialog").open, false, "Opening an already expired exam must not sound an alarm");
const sleeping = launch({ now, saved: settings });
sleeping.advance(3600000);
assert.equal(sleeping.nodes.get("alarm-dialog").open, true, "Resuming after a timer delay must still alert");

page.save({ start: "2026-10-31T10:00:00", end: "2026-10-31T09:00:00" });
assert.equal(page.nodes.get("form-error").hidden, false);
assert.equal(JSON.parse(page.storage.get("quickso-exam-v1")).start, settings.start, "Invalid settings must not overwrite the saved exam");
page.save({ title: "   ", sound: false });
assert.equal(page.nodes.get("form-error").hidden, false);
page.save({ title: "跨天考试", start: "2026-10-31T23:00", end: "2026-11-01T01:00", notices: "", sound: false });
assert.equal(page.nodes.get("exam-duration").textContent, "共 120 分钟");
assert.equal(page.nodes.get("notice-empty").hidden, false);
assert.equal(page.root.dataset.theme, "light");
assert.equal(JSON.parse(page.storage.get("quickso-exam-v1")).start, "2026-10-31T23:00:00");
assert.equal(JSON.parse(page.storage.get("quickso-exam-v1")).end, "2026-11-01T01:00:00");
assert.equal(page.context.document.body.dataset.phase, "waiting");
assert.equal(page.nodes.get("progress").attributes["aria-valuenow"], "0");

const hostileText = '</script><script>alert("example")</script> & <b>文本</b>';
const examTicks = page.nodes.get("progress-ticks").children;
assert.deepEqual(examTicks.map((tick) => tick.children[0].textContent), ["60", "30", "10"]);
assert.equal(Number.parseFloat(examTicks[1].style.top), 75, "A two-hour exam reaches 30 minutes remaining at 75% progress");
const oneHour = launch({ now, saved: { ...settings, start: "2026-10-31T09:00:00", end: "2026-10-31T10:00:00" } });
assert.deepEqual(oneHour.nodes.get("progress-ticks").children.map((tick) => tick.children[0].textContent), ["30", "10"], "Coincident half-time and 30-minute ticks must merge");
oneHour.save({ end: "2026-10-31T09:06:00", sound: false });
assert.deepEqual(oneHour.nodes.get("progress-ticks").children.map((tick) => tick.children[0].textContent), ["3"], "Changing exam duration must recalculate ticks and omit inapplicable markers");
page.save({ title: hostileText, notices: hostileText, sound: false });
assert.equal(page.nodes.get("exam-title").textContent, hostileText, "User content must be inserted as text");
const exported = page.export();
assert.equal(exported.config.includes("<"), false, "Exported JSON must not terminate its script element");
assert.equal(JSON.parse(exported.config).title, hostileText);
assert.equal(JSON.parse(exported.config).start, "2026-10-31T23:00:00");
assert.equal(JSON.parse(exported.config).end, "2026-11-01T01:00:00");
assert.equal(exported.blob.type, "text/html;charset=utf-8");
const offline = launch({ now, embedded: JSON.parse(exported.config) });
assert.equal(offline.nodes.get("exam-title").textContent, hostileText, "Exported settings must initialize an independent page");
const noStorage = launch({ now, unavailableStorage: true });
noStorage.save({ ...{ title: "离线考试", start: settings.start, end: settings.end, sound: false } });
assert.equal(noStorage.nodes.get("exam-title").textContent, "离线考试");
assert.match(noStorage.nodes.get("storage-label").textContent, /导出/);
const corrupt = launch({ now, saved: { title: "Broken" } });
assert.equal(corrupt.nodes.get("exam-title").textContent, "期中考试 · 语文");
for (const source of ["saved", "embedded"]) {
  const legacy = launch({ now, [source]: { ...settings, start: "2026-10-31T09:00:45", end: "2026-10-31T09:01:59", theme: "dark" } });
  legacy.nodes.get("settings-button").click();
  assert.equal(legacy.nodes.get("input-start").value, "2026-10-31T09:00");
  assert.equal(legacy.nodes.get("input-end").value, "2026-10-31T09:01");
  assert.equal(legacy.nodes.get("exam-duration").textContent, "共 1 分钟");
  assert.equal(legacy.root.dataset.theme, "dark", "Removing controls must not change an existing exam theme");
  assert.equal(JSON.parse(legacy.export().config).end, "2026-10-31T09:01:00");
  legacy.save({});
  assert.equal(JSON.parse(legacy.storage.get("quickso-exam-v1")).start, "2026-10-31T09:00:00");
}
page.save({ start: "2026-10-31T09:00:10", end: "2026-10-31T09:00:59" });
assert.equal(page.nodes.get("form-error").hidden, false, "Times that collapse to the same minute must be rejected");
console.log("PASS: inline script syntax, no external assets, countdown boundaries, delayed timers, one-time alarm, validation, cross-day dates, persistence fallback, text safety, export configuration, and independent initialization.");
