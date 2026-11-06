/**
 * dsh-swap-enter — Client half.
 *
 * Swaps the Enter / Shift+Enter behavior inside the conversation composer:
 *   - Enter        -> insert a line break (newline)
 *   - Shift+Enter  -> send the message
 *
 * The shipped composer handles Enter through two different code paths, so the
 * swap has to reproduce each one instead of merely flipping a flag:
 *
 *   1. Shift+Enter (line break) is not handled in JavaScript at all: the
 *      composer's KEY_ENTER command returns `false` for shift+Enter and the
 *      browser's own default action inserts the break. A synthetic
 *      KeyboardEvent has no default action, so the swapped path dispatches a
 *      cancellable `beforeinput` event instead — Lexical's beforeinput handler
 *      picks up `insertLineBreak`, inserts the break and cancels the event.
 *
 *   2. Plain Enter (submit) is handled in JavaScript inside the composer's
 *      KEY_ENTER command, so a synthetic `keydown` without shiftKey re-runs the
 *      real submit path (including the busy/composer submit rules).
 *
 * The listener sits on `document` in the capture phase, which runs before
 * Lexical's root-element keydown listener, so the original key never reaches
 * the composer. Synthetic keys are tagged in a WeakSet so no listener instance
 * can intercept them a second time.
 */
window.__ModuleLoader__.load({
  id: 'dsh-swap-enter',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const COMPOSER_SELECTOR = '[data-composer-input]';
    const MENU_SELECTOR = '[data-trigger-menu]';

    /**
     * Keys this plugin synthesized. Tagging the event object itself (instead of
     * a boolean flag) keeps the guard correct even if the listener is installed
     * more than once, for example across a hot reload.
     */
    const syntheticKeys = new WeakSet();

    /** True for a bare Enter (no command modifier) that is not part of an IME composition. */
    function isSwappableEnter(event) {
      if (event.key !== 'Enter') return false;
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.isComposing || event.keyCode === 229) return false;
      return true;
    }

    /**
     * Hand the message to the real submit path by re-running the plain-Enter key.
     *
     * `repeat` is forwarded on purpose: the composer ignores a repeated Enter, so
     * holding the keys down sends once instead of once per repeat tick.
     */
    function sendMessage(composer, repeat) {
      const key = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
        composed: true,
        repeat,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      });
      syntheticKeys.add(key);
      composer.dispatchEvent(key);
    }

    /** Insert a line break the way shift+Enter would, via the editor's beforeinput hook. */
    function insertLineBreak(composer) {
      const notHandled = composer.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
      if (!notHandled) return;
      // No editor hook answered (for example an editor without the Lexical
      // beforeinput bridge): fall back to the plain DOM command.
      try {
        document.execCommand('insertLineBreak');
      } catch {
        /* nothing else left to try */
      }
    }

    function installSwap(doc) {
      const onKeyDown = (event) => {
        if (syntheticKeys.has(event)) return;
        if (!isSwappableEnter(event)) return;

        const node = event.target;
        if (!node || typeof node.closest !== 'function') return;
        const composer = node.closest(COMPOSER_SELECTOR);
        if (!composer) return;
        // A read-only composer has no text to edit and no message to send;
        // leave the key alone so the host's own handling stays intact.
        if (composer.getAttribute('contenteditable') === 'false') return;

        // An open suggestion or slash-command menu owns Enter. Leaving it alone
        // keeps keyboard navigation of that menu working as shipped.
        if (doc.querySelector(MENU_SELECTOR)) return;

        const wantsSend = event.shiftKey === true;
        event.preventDefault();
        event.stopImmediatePropagation();

        if (wantsSend) sendMessage(composer, event.repeat);
        else insertLineBreak(composer);
      };

      doc.addEventListener('keydown', onKeyDown, true);
      return () => doc.removeEventListener('keydown', onKeyDown, true);
    }

    /** Invisible activation marker, so the plugin is observable in the slot tree. */
    function SwapEnterIndicator() {
      return h('span', {
        'data-dsh-swap-enter': 'active',
        'aria-hidden': true,
        style: { display: 'none' },
      });
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => installSwap(document), 'dsh-swap-enter: composer key swap');

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-swap-enter-indicator',
          order: 900,
        }, SwapEnterIndicator));
      },
    };
  },
});
