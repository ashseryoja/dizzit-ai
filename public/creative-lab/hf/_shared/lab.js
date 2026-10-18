/* Dizzit Creative Lab — хелперы шаблонов Hyperframes.
   Все шаблоны строят один GSAP-таймлайн на паузе и регистрируют его в
   window.__timelines. Время — в секундах, монтаж — на сетке бита (B = 0.5 с).
   Детерминизм: без Date, random, RAF. Движение резкое: короткие expo.out,
   snap-масштаб на склейке, никаких фейдов между кадрами. */
(function () {
  "use strict";
  var html = document.documentElement;
  var W = Number(html.getAttribute("data-w") || 1080);
  var H = Number(html.getAttribute("data-h") || 1920);
  var B = .5;
  var E = { enter: "expo.out", hard: "power4.inOut", exit: "power3.in", camera: "none", none: "none" };

  function declared() {
    var out = {};
    try {
      var list = JSON.parse(html.getAttribute("data-composition-variables") || "[]");
      list.forEach(function (v) { if (v && v.id) out[v.id] = v.default; });
    } catch (e) { /* пустая декларация */ }
    return out;
  }
  var cache;
  function vars() {
    if (cache) return cache;
    var base = declared();
    var over = window.__hfVariables;
    if (over && typeof over === "object") Object.keys(over).forEach(function (k) { base[k] = over[k]; });
    cache = base;
    return base;
  }
  function text(id, fallback) { var v = vars()[id]; return typeof v === "string" && v.trim() ? v.trim() : (fallback || ""); }
  function photos(max) {
    var v = vars(), out = [];
    for (var i = 1; i <= max; i++) {
      var src = v["photo" + i];
      if (typeof src === "string" && src) out.push({ src: src, focus: typeof v["focus" + i] === "string" && v["focus" + i] ? v["focus" + i] : "50% 50%", caption: text("cap" + i, "") });
    }
    return out;
  }
  function el(tag, cls, parent, textContent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (textContent != null) node.textContent = textContent;
    (parent || document.getElementById("root")).appendChild(node);
    return node;
  }
  function photo(parent, p, cls) {
    var box = el("div", cls || "photo", parent);
    var img = document.createElement("img");
    img.src = p.src; img.alt = ""; img.decoding = "sync";
    img.style.setProperty("--focus", p.focus);
    box.appendChild(img);
    return box;
  }
  /* Переносит строку по словам в несколько .mask > span — для построчного появления. */
  function lines(parent, str, maxChars, cls) {
    var words = String(str).split(/\s+/).filter(Boolean), rows = [], row = "";
    words.forEach(function (w) {
      if (row && (row + " " + w).length > maxChars) { rows.push(row); row = w; } else row = row ? row + " " + w : w;
    });
    if (row) rows.push(row);
    return rows.map(function (r) { var m = el("div", "mask" + (cls ? " " + cls : ""), parent); var s = el("span", "", m, r); fit(s, m.clientWidth); return s; });
  }
  /* Ужимает кегль строки, пока она не поместится по ширине: одно длинное слово нельзя перенести.
     Шрифты уже загружены (рантайм ждёт начертания из разметки), поэтому измерение детерминировано. */
  function fit(node, width) {
    if (!width) return node;
    var size = parseFloat(getComputedStyle(node).fontSize) || 0;
    for (var i = 0; i < 40 && size > 24 && node.scrollWidth > width; i++) { size = Math.floor(size * .96); node.style.fontSize = size + "px"; }
    return node;
  }
  /* Разбивает строку на слова-спаны (для появления по словам на долях). */
  function words(parent, str, cls) {
    var box = el("div", cls || "", parent);
    return String(str).split(/\s+/).filter(Boolean).map(function (w, i) { if (i) box.appendChild(document.createTextNode(" ")); return el("span", "", box, w); });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function inset(from) {
    return { bottom: "inset(0% 0% 100% 0%)", top: "inset(100% 0% 0% 0%)", left: "inset(0% 100% 0% 0%)", right: "inset(0% 0% 0% 100%)" }[from || "bottom"];
  }
  /* Резкая склейка с snap-масштабом: кадр появляется мгновенно и садится 1.06 → 1. */
  function cut(tl, box, at, opt) {
    opt = opt || {};
    var img = box.querySelector("img");
    tl.set(box, { autoAlpha: 1 }, at);
    if (img) tl.fromTo(img, { scale: opt.scale || 1.06 }, { scale: 1, duration: opt.dur || B * .9, ease: E.enter }, at);
    return tl;
  }
  /* Жёсткая шторка: кадр въезжает за полдоли без усадки. */
  function wipe(tl, box, at, opt) {
    opt = opt || {};
    tl.set(box, { autoAlpha: 1 }, at);
    tl.fromTo(box, { clipPath: inset(opt.from), webkitClipPath: inset(opt.from) }, { clipPath: "inset(0% 0% 0% 0%)", webkitClipPath: "inset(0% 0% 0% 0%)", duration: opt.dur || B, ease: opt.ease || E.hard }, at);
    return tl;
  }
  /* Панель въезжает сдвигом (split-screen). */
  function slide(tl, node, at, opt) {
    opt = opt || {};
    tl.set(node, { autoAlpha: 1 }, at);
    tl.fromTo(node, { xPercent: opt.xPercent == null ? 100 : opt.xPercent, yPercent: opt.yPercent || 0 }, { xPercent: 0, yPercent: 0, duration: opt.dur || B, ease: opt.ease || E.hard }, at);
    return tl;
  }
  /* Медленный наезд камеры между склейками. */
  function push(tl, box, at, dur, amount) {
    var img = box.querySelector("img") || box;
    tl.fromTo(img, { scale: 1 }, { scale: 1 + (amount == null ? .006 : amount) * dur, duration: dur, ease: E.camera }, at);
    return tl;
  }
  /* Текст вылетает из-под маски за полдоли, строки — с шагом в 1/8 доли. */
  function slam(tl, spans, at, opt) {
    opt = opt || {};
    tl.fromTo(spans, { yPercent: 108 }, { yPercent: 0, duration: opt.dur || B * .9, ease: E.enter, stagger: opt.stagger == null ? B / 8 : opt.stagger }, at);
    return tl;
  }
  function slamOut(tl, spans, at, opt) {
    opt = opt || {};
    tl.to(spans, { yPercent: -108, duration: opt.dur || B * .5, ease: E.exit, stagger: opt.stagger == null ? B / 12 : opt.stagger }, at);
    return tl;
  }
  /* Слова появляются на месте по долям — без движения. */
  function type(tl, spans, at, step) {
    tl.set(spans, { autoAlpha: 0 }, 0);
    spans.forEach(function (s, i) { tl.set(s, { autoAlpha: 1 }, at + i * (step || B / 4)); });
    return tl;
  }
  function show(tl, node, at) { tl.set(node, { autoAlpha: 1 }, at); return tl; }
  function hide(tl, node, at) { tl.set(node, { autoAlpha: 0 }, at); return tl; }
  /* Полоса акцента выстреливает от начала. */
  function bar(tl, node, at, dur) { tl.fromTo(node, { scaleX: 0 }, { scaleX: 1, duration: dur || B * .7, ease: E.enter }, at); return tl; }
  /* Счётчик индекса: 01 → 02 щелчком. */
  function counter(tl, node, at, value) { tl.set(node, { textContent: value }, at); return tl; }
  /* Зерно поверх всего; тайл прыгает 12 раз в секунду. Фиксирует длительность. */
  function finish(tl, root, seconds) {
    var g = el("div", "grain", root);
    var steps = Math.max(1, Math.round(seconds * 12));
    tl.fromTo(g, { "--gx": 0, "--gy": 0 }, { "--gx": 360 * 7, "--gy": -360 * 5, duration: seconds, ease: "steps(" + steps + ")" }, 0);
    tl.set({}, {}, seconds);
  }
  function register(id, tl) { window.__timelines = window.__timelines || {}; window.__timelines[id] = tl; }
  function theme() {
    var t = text("theme", "dark");
    html.setAttribute("data-theme", t === "light" ? "light" : "dark");
    var accent = text("accent", "");
    if (/^#[0-9a-f]{6}$/i.test(accent)) html.style.setProperty("--accent", accent);
    return t === "light" ? "light" : "dark";
  }
  function safe() {
    var s = getComputedStyle(html);
    var n = function (p) { return parseFloat(s.getPropertyValue(p)) || 0; };
    return { top: n("--safe-top"), bottom: n("--safe-bottom"), left: n("--safe-left"), right: n("--safe-right"), w: W, h: H };
  }
  /* Сетка миниатюр: cols колонок в safe-зоне, aspect = h/w ячейки. Возвращает геометрию. */
  function grid(count, cols, aspect, gap, S) {
    var left = S.left, usable = W - S.left - S.right, top = S.top;
    var w = (usable - gap * (cols - 1)) / cols, h = w * aspect, rows = Math.ceil(count / cols);
    var total = rows * h + (rows - 1) * gap, maxH = H - S.bottom - S.top;
    if (total > maxH) { var k = maxH / total; w *= k; h *= k; left += (usable - (w * cols + gap * (cols - 1))) / 2; total = maxH; }
    top += (maxH - total) / 2;
    var cells = [];
    for (var i = 0; i < count; i++) cells.push({ x: left + (i % cols) * (w + gap), y: top + Math.floor(i / cols) * (h + gap), w: w, h: h });
    return cells;
  }
  window.Lab = { W: W, H: H, B: B, E: E, vars: vars, text: text, photos: photos, el: el, photo: photo, lines: lines, words: words, fit: fit, pad: pad, inset: inset, cut: cut, wipe: wipe, slide: slide, push: push, slam: slam, slamOut: slamOut, type: type, show: show, hide: hide, bar: bar, counter: counter, finish: finish, register: register, theme: theme, safe: safe, grid: grid };
})();
