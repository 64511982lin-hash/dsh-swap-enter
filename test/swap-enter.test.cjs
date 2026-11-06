/**
 * Offline behavioral test for dsh-swap-enter/lib client.js.
 *
 * It reproduces the two shipped composer code paths that the plugin has to
 * drive (a Lexical-style root keymap listener for KEY_ENTER, and a
 * beforeinput handler for INSERT_LINE_BREAK) with a tiny fake DOM, loads the
 * real client bundle through a __ModuleLoader__ stub, and asserts the swapped
 * outcome for all four key gestures.
 */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- fake DOM --
class FakeEvent {
  constructor(type, init = {}) {
    Object.assign(this, {
      type,
      bubbles: true,
      cancelable: true,
      composed: true,
      repeat: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
      keyCode: 0,
      key: undefined,
      code: undefined,
      inputType: undefined,
      defaultPrevented: false,
    }, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
  stopImmediatePropagation() {
    this.propagationStopped = true;
    this.immediatePropagationStopped = true;
  }
  getModifierState() { return false; }
}

/** Ordered listener list per node; capture listeners run before bubble ones. */
class FakeNode {
  constructor(name) {
    this.name = name;
    this.attributes = {};
    this.listeners = [];
    this.children = [];
  }
  setAttribute(k, v) { this.attributes[k] = String(v); return this; }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener(type, fn, capture = false) {
    this.listeners.push({ type, fn, capture: capture === true });
  }
  removeEventListener(type, fn, capture = false) {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === (capture === true)));
  }
  closest(selector) {
    // Only the two selectors this plugin uses are supported.
    const matches = (node) => {
      if (selector === '[data-composer-input]') return node.composerInput === true;
      if (selector === '[data-trigger-menu]') return node.getAttribute('data-trigger-menu') !== null;
      return false;
    };
    let node = this;
    while (node) {
      if (matches(node)) return node;
      node = node.parent;
    }
    return null;
  }
  dispatchEvent(event) {
    const chain = [];
    for (let node = this; node; node = node.parent) chain.push(node);
    chain.reverse(); // outermost first
    event.target = this;

    const run = (node, capture) => {
      for (const l of node.listeners.slice()) {
        if (l.type !== event.type) continue;
        if (l.capture !== capture) continue;
        if (event.immediatePropagationStopped) return;
        l.fn(event);
      }
    };
    for (const node of chain) {
      run(node, true);
      if (event.propagationStopped) return !event.defaultPrevented;
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      run(chain[i], false);
      if (event.propagationStopped) return !event.defaultPrevented;
    }
    return !event.defaultPrevented;
  }
}

// ------------------------------------------------------------------ harness --
function buildWorld({ menuOpen = false, readOnly = false } = {}) {
  const doc = new FakeNode('document');
  const body = new FakeNode('body');
  body.parent = doc;
  doc.body = body;

  const composer = new FakeNode('composer');
  composer.parent = body;
  composer.composerInput = true;
  composer.setAttribute('contenteditable', readOnly ? 'false' : 'true');

  let menu = null;
  if (menuOpen) {
    menu = new FakeNode('menu');
    menu.parent = body;
    menu.setAttribute('data-trigger-menu', '');
  }
  doc.querySelector = (sel) => (sel === '[data-trigger-menu]' && menu ? menu : null);

  const log = { submitted: 0, accelerated: 0, lineBreaks: 0, keydownsSeen: 0 };

  // Lexical root keymap: the shipped composer's KEY_ENTER + BEFORE_INPUT paths.
  let isInsertLineBreak = false;
  composer.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    log.keydownsSeen += 1;
    if (event.key !== 'Enter') return;
    if (event.altKey || (event.ctrlKey && event.metaKey) || (event.shiftKey && (event.ctrlKey || event.metaKey))) return;
    // Composer's cn$1 handler: shift+Enter returns false → browser default did the work.
    if (event.shiftKey === true) {
      isInsertLineBreak = true;
      return;
    }
    event.preventDefault();
    if (event.repeat === true) return;
    if (event.ctrlKey === true || event.metaKey === true) log.accelerated += 1;
    else log.submitted += 1;
  });
  composer.addEventListener('beforeinput', (event) => {
    if (event.inputType === 'insertLineBreak') {
      event.preventDefault();
      log.lineBreaks += 1;
      return;
    }
    if (event.inputType === 'insertParagraph') {
      event.preventDefault();
      if (isInsertLineBreak) { isInsertLineBreak = false; log.lineBreaks += 1; }
      return;
    }
  });

  const document = doc;
  global.document = document;
  global.KeyboardEvent = FakeEvent;
  global.InputEvent = FakeEvent;
  global.window = {
    __ModuleLoader__: { load() {} },
    document,
  };
  document.execCommand = () => { log.lineBreaks += 1; return true; };

  return { doc, composer, log, menu };
}

function loadPlugin() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8');
  let registration = null;
  const window = global.window;
  window.__ModuleLoader__ = { load(def) { registration = def; } };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'KeyboardEvent', 'InputEvent', src)(window, global.document, global.KeyboardEvent, global.InputEvent);
  if (!registration) throw new Error('bundle did not register a factory');
  if (registration.id !== 'dsh-swap-enter') throw new Error(`unexpected bundle id ${registration.id}`);
  const exportsObj = registration.factory((name) => {
    if (name === 'react') {
      return { createElement: (type, props, ...kids) => ({ type, props, kids }) };
    }
    throw new Error(`unexpected require(${name})`);
  });
  if (!Array.isArray(exportsObj.inject)) throw new Error('missing inject list');
  return exportsObj;
}

function applyPlugin(exportsObj, doc) {
  const cleanups = [];
  const slots = [];
  const ctx = {
    effect(fn, label) {
      const off = fn();
      cleanups.push(off);
      return () => { off && off(); };
    },
    slots: {
      register(meta, component) {
        return { meta, component };
      },
      inject(name, register) {
        slots.push({ name, register });
      },
    },
  };
  exportsObj.apply(ctx);
  // Materialize the slot registration so the indicator component exists.
  let indicator = null;
  for (const entry of slots) {
    const factory = entry.register();
    indicator = factory;
  }
  return { cleanups, slots, indicator };
}

function press(composer, init) {
  composer.dispatchEvent(new FakeEvent('keydown', Object.assign({ key: 'Enter', code: 'Enter' }, init)));
}

// -------------------------------------------------------------------- tests --
const results = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, actual, expected });
}

// 1. Enter inserts a line break instead of sending.
{
  const world = buildWorld();
  const plugin = loadPlugin();
  const applied = applyPlugin(plugin, world.doc);
  if (!applied.indicator) throw new Error('indicator slot was not registered');
  press(world.composer, { shiftKey: false });
  check('Enter -> line break', world.log, { submitted: 0, accelerated: 0, lineBreaks: 1, keydownsSeen: 0 });
  applied.cleanups.forEach((off) => off && off());
}

// 2. Shift+Enter sends instead of inserting a line break.
{
  const world = buildWorld();
  const plugin = loadPlugin();
  const applied = applyPlugin(plugin, world.doc);
  press(world.composer, { shiftKey: true });
  check('Shift+Enter -> send', world.log, { submitted: 1, accelerated: 0, lineBreaks: 0, keydownsSeen: 1 });
  applied.cleanups.forEach((off) => off && off());
}

// 3. Ctrl+Enter keeps the shipped accelerated submit.
{
  const world = buildWorld();
  const plugin = loadPlugin();
  const applied = applyPlugin(plugin, world.doc);
  press(world.composer, { ctrlKey: true });
  check('Ctrl+Enter untouched', world.log, { submitted: 0, accelerated: 1, lineBreaks: 0, keydownsSeen: 1 });
  applied.cleanups.forEach((off) => off && off());
}

// 4. An open suggestions menu keeps Enter for itself.
{
  const world = buildWorld({ menuOpen: true });
  const plugin = loadPlugin();
  const applied = applyPlugin(plugin, world.doc);
  press(world.composer, { shiftKey: true });
  check('menu open -> untouched', world.log, { submitted: 0, accelerated: 0, lineBreaks: 0, keydownsSeen: 1 });
  applied.cleanups.forEach((off) => off && off());
}

// 5. A read-only composer is left alone.
{
  const world = buildWorld({ readOnly: true });
  const plugin = loadPlugin();
  const applied = applyPlugin(plugin, world.doc);
  press(world.composer, { shiftKey: true });
  check('read-only -> untouched', world.log, { submitted: 0, accelerated: 0, lineBreaks: 0, keydownsSeen: 1 });
  applied.cleanups.forEach((off) => off && off());
}

// 6. IME composition Enter is never swapped.
{
  const world = buildWorld();
  const plugin = loadPlugin();
  const applied = applyPlugin(plugin, world.doc);
  world.composer.dispatchEvent(new FakeEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true }));
  check('IME composing -> untouched', world.log, { submitted: 0, accelerated: 0, lineBreaks: 0, keydownsSeen: 0 });
  applied.cleanups.forEach((off) => off && off());
}

// 7. Keydown outside the composer is ignored.
{
  const world = buildWorld();
  const elsewhere = new FakeNode('button');
  elsewhere.parent = world.doc.body;
  const plugin = loadPlugin();
  const applied = applyPlugin(plugin, world.doc);
  elsewhere.dispatchEvent(new FakeEvent('keydown', { key: 'Enter', code: 'Enter' }));
  check('outside composer -> untouched', world.log, { submitted: 0, accelerated: 0, lineBreaks: 0, keydownsSeen: 0 });
  applied.cleanups.forEach((off) => off && off());
}

// 8. Disposing the effect removes the listener, so the shipped behavior returns:
// shift+Enter reaches the composer, which leaves the line break to the browser's
// own default action (not observable in a fake DOM, hence lineBreaks stays 0).
{
  const world = buildWorld();
  const plugin = loadPlugin();
  const applied = applyPlugin(plugin, world.doc);
  applied.cleanups.forEach((off) => off && off());
  press(world.composer, { shiftKey: true });
  check('after dispose -> shipped behavior', world.log, { submitted: 0, accelerated: 0, lineBreaks: 0, keydownsSeen: 1 });
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.ok) console.log(`      actual=${JSON.stringify(r.actual)} expected=${JSON.stringify(r.expected)}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
