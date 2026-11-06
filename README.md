# dsh-swap-enter

Swaps <kbd>Enter</kbd> and <kbd>Shift</kbd>+<kbd>Enter</kbd> in the DeepSeek Harness chat composer.

- **<kbd>Enter</kbd>** → inserts a newline
- **<kbd>Shift</kbd>+<kbd>Enter</kbd>** → sends the message

Some chats (Feishu, Slack, Telegram) put the line break on the bare key and the send action on the modifier. DSH ships the other way around. This plugin flips it.

English | [中文](README.zh.md)

## Install

From the plugin market (dsh-market, or any storefront built on the `awesome-dsh-plugin` index):

```sh
dsh plugin --profile <profile> add github:64511982lin-hash/dsh-swap-enter
```

Or point `plugin_manager` at a local checkout:

```
plugin_manager install_bundle { target: "<absolute path to this directory>" }
```

No build step, no runtime dependencies — the bundle is plain ES modules. The host half is a no-op; everything happens in the browser bundle.

After installing, reload the Web UI. There is nothing to configure.

## What is left alone

Swapping two keys must not break the other things <kbd>Enter</kbd> does:

| Situation | Behavior |
|---|---|
| Suggestion or slash-command menu is open | Untouched — <kbd>Enter</kbd> still picks the highlighted entry |
| IME composition in progress (Chinese, Japanese, Korean) | Untouched — the composing keystroke never reaches the plugin |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>/<kbd>Alt</kbd> + <kbd>Enter</kbd> | Untouched — the complementary shortcut keeps working |
| Composer is read-only | Untouched |
| Focus is anywhere outside the composer | Untouched |
| Plugin disposed (profile switched, HMR) | Untouched — the shipped behavior returns |

Holding <kbd>Shift</kbd>+<kbd>Enter</kbd> sends once, not once per repeat tick, because the auto-repeat flag is forwarded to the submit path.

## Why this is a plugin and not a setting

There is no keybinding option to toggle. The client `ui-conversation` plugin's config schema has exactly one field — `busyEnter` (`queue` or `steer`) — and the `fixed.send` / `fixed.newline` entries visible in the keyboard-command registry are **display records only**: they describe the bindings to the settings UI and do not route the keypress.

The real behavior lives in two different code paths in the shipped composer:

1. **<kbd>Shift</kbd>+<kbd>Enter</kbd> is not handled in JavaScript at all.** The composer's `KEY_ENTER` command returns `false` for shift+Enter and lets the *browser's default action* insert the line break.
2. **Bare <kbd>Enter</kbd> calls `handlers.submit()`** from inside that command.

So a swap has to reproduce each path rather than flip a flag, and it cannot rely on one mechanism for both.

## How it works

`client.js` installs a `keydown` listener on `document` in the **capture** phase, which runs before Lexical's listener on the editor root element. When a bare <kbd>Enter</kbd> arrives from inside `[data-composer-input]`, it cancels the original event with `preventDefault()` + `stopImmediatePropagation()` and then replays the opposite path:

- **<kbd>Shift</kbd>+<kbd>Enter</kbd> (send)** — dispatches a synthetic `keydown` with `shiftKey: false`, which re-runs the composer's own submit path, including its busy/steering rules.
- **<kbd>Enter</kbd> (newline)** — dispatches a cancellable `InputEvent('beforeinput', { inputType: 'insertLineBreak' })`. Lexical's beforeinput handler inserts the break and cancels the event. A synthetic keydown with `shiftKey: true` would *not* work here: untrusted events have no default action, so the break would never be inserted.

Keys the plugin synthesized are tagged in a `WeakSet` so no listener instance — including a second one from a hot reload — can intercept them again.

## Compatibility

- Declared for `dsh` `>=0.2.0-rc.1 <0.3.0-0`.
- Developed and verified against DSH `0.2.2-rc.1` (desktop build).
- Web UI only (`dsh.client.platform: "web"`).

The mechanism depends on the composer being a Lexical editor with the `data-composer-input` attribute and a `beforeinput` bridge — both true for the 0.2.x line. A future composer rewrite could change that.

## Tests

```sh
node test/swap-enter.test.cjs
```

Eight cases run against the **real** `client.js` in a stub DOM that reproduces both composer paths:

```
PASS  Enter -> line break
PASS  Shift+Enter -> send
PASS  Ctrl+Enter untouched
PASS  menu open -> untouched
PASS  read-only -> untouched
PASS  IME composing -> untouched
PASS  outside composer -> untouched
PASS  after dispose -> shipped behavior
```

## License

MIT
