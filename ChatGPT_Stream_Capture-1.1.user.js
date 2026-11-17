// ==UserScript==
// @name         ChatGPT Stream Capture
// @namespace    https://github.com/ddrewpublic/UserScripts
// @version      1.5.0
// @description  Capture every visible stream change and export timestamped plain text
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    filenamePrefix: 'chatgpt-stream-capture',

    // The navigation is discarded by starting at the first role label.
    roleLabels: { user: 'You said:', assistant: 'ChatGPT said:' },

    // Optional exact strings to remove from the exported text.
    removeText: [
      'ChatGPT can make mistakes. Check important info.'
    ],

    // Used only when ChatGPT's role labels cannot be found at all.
    fallbackNavigationPrefix:
      'Skip to content\nNew chat\nSearch\nPinned\nRecents\nLibrary\nScript',

    removeThinkingDuration: true,

    // Optional safeguard. When reached, stop rather than silently discard data.
    maxSnapshots: 30000
  };

  // Restore the original script's recording model: one timestamped snapshot
  // per change to document.body.innerText. No DOM-role selectors or debounce.
  // State deliberately belongs to this page only; a new page starts empty.
  let recording = false;
  let snapshots = [];
  let previous = '';
  let startedAt = null;
  let endedAt = null;
  let conversationUrl = '';
  let observer = null;
  let toggleMenuId = null;

  /** Save every distinct visible page state while recording. */
  function capture() {
    if (!recording || !document.body) return;

    try {
      const text = document.body.innerText.replace(/\r\n?/g, '\n');
      if (!text.trim() || text === previous) return;

      previous = text;
      // New chats may acquire their permanent URL after recording begins.
      if (location.pathname !== '/') conversationUrl = location.href;
      snapshots.push({ time: new Date().toISOString(), text });

      // Stop explicitly on reaching the limit so a partial export is visible.
      if (snapshots.length >= CONFIG.maxSnapshots) {
        console.warn('[ChatGPT Capture] Snapshot limit reached; recording stopped.');
        stopRecording();
      }
    } catch (error) {
      console.error('[ChatGPT Capture] Capture failed:', error);
    }
  }

  /** Start a new session, without inherited snapshots or counts. */
  function startRecording() {
    if (recording || !document.body) return;

    snapshots = [];
    previous = '';
    startedAt = new Date().toISOString();
    endedAt = null;
    conversationUrl = location.href;
    recording = true;

    // Capture the first state, then capture every subsequent change.
    observer = new MutationObserver(capture);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    capture();
    updateMenu();
  }

  /** Stop without discarding anything, including the final page state. */
  function stopRecording() {
    if (!recording) return;

    // Disconnect before the final capture to avoid reentrant callbacks.
    observer?.disconnect();
    observer = null;
    if (snapshots.length < CONFIG.maxSnapshots) capture();

    recording = false;
    endedAt = new Date().toISOString();
    updateMenu();
  }

  /** Explicitly discard the previous output. */
  function discardRecording() {
    if (recording) stopRecording();
    snapshots = [];
    previous = '';
    startedAt = null;
    endedAt = null;
    conversationUrl = '';
  }

  /** Normalize and clean only the exported text, never stored snapshots. */
  function cleanText(text) {
    let result = text.replace(/\r\n?/g, '\n');

    for (const fragment of CONFIG.removeText) {
      result = result.replaceAll(fragment, '');
    }

    if (CONFIG.removeThinkingDuration) {
      // Handles "Worked for 7m 11s", "Worked for 28s", etc.
      result = result.replace(
        /^[ \t]*Worked for[ \t]+(?:\d+[hms][ \t]*)+(?=\n|$)/gim,
        ''
      );
    }

    return result.replace(/[ \t]+$/gm, '');
  }

  /**
   * Split a full-page snapshot into numbered conversation turns.
   * Using visible text preserves the original script's reliable capture path.
   */
  function splitTurns(rawText) {
    const text = cleanText(rawText);
    const markers = [...text.matchAll(
      /(?:^|\n)[ \t]*(You said:|ChatGPT said:)[ \t]*(?:\n|$)/g
    )];

    return markers.map((marker, index) => {
      const next = markers[index + 1];
      const start = marker.index + marker[0].length;
      const end = next ? next.index : text.length;
      return {
        role: marker[1] === CONFIG.roleLabels.user ? 'user' : 'assistant',
        text: text.slice(start, end).replace(/\n+$/, '')
      };
    });
  }

  /** Find the shared prefix, even when streamed content is rewritten. */
  function commonPrefixLength(a, b) {
    let i = 0;
    const length = Math.min(a.length, b.length);
    while (i < length && a[i] === b[i]) i += 1;
    return i;
  }

  /**
   * Convert the full snapshot history to a timestamped change log.
   * Prompts appear once; assistant entries contain only newly observed text.
   * The original full snapshots remain intact for reliable collection.
   */
  function buildEvents() {
    const events = [];
    const lastTurnText = new Map();
    const promptsSeen = new Set();

    // Decide the mode across ALL snapshots, not from a single early state.
    const hasRoleMarkers = snapshots.some(s => splitTurns(s.text).length > 0);
    let previousFallback = '';

    for (const snapshot of snapshots) {
      if (!hasRoleMarkers) {
        // Preserve evidence of streaming even if ChatGPT changes its labels.
        let text = cleanText(snapshot.text);
        if (text.startsWith(CONFIG.fallbackNavigationPrefix)) {
          text = text.slice(CONFIG.fallbackNavigationPrefix.length).trimStart();
        }
        if (text === previousFallback) continue;
        const prefix = commonPrefixLength(previousFallback, text);
        const addition = text.slice(prefix);
        if (addition) events.push({ time: snapshot.time, role: 'page', text: addition });
        previousFallback = text;
        continue;
      }

      const turns = splitTurns(snapshot.text);
      for (let i = 0; i < turns.length; i += 1) {
        const turn = turns[i];
        if (!turn.text.trim()) continue;

        // Turn order is stable across successive full-page snapshots.
        const key = `${i}:${turn.role}`;
        const prior = lastTurnText.get(key) || '';

        if (turn.role === 'user') {
          // Only one record for each prompt, regardless of future snapshots.
          if (!promptsSeen.has(key)) {
            events.push({ time: snapshot.time, role: 'user', text: turn.text });
            promptsSeen.add(key);
          }
          lastTurnText.set(key, turn.text);
          continue;
        }

        if (turn.text === prior) continue;

        // A temporary shrink (e.g. a hidden streaming node) is not new text.
        if (prior.startsWith(turn.text)) continue;

        const prefix = commonPrefixLength(prior, turn.text);
        const addition = turn.text.slice(prefix);
        if (addition) {
          events.push({ time: snapshot.time, role: 'assistant', text: addition });
        }
        lastTurnText.set(key, turn.text);
      }
    }

    return events;
  }

  /** Produce flat text with one timestamp for every retained change. */
  function buildExport() {
    const lines = [
      `Start time: ${startedAt}`,
      `End time: ${endedAt || new Date().toISOString()}`,
      `URL: ${conversationUrl}`,
      ''
    ];

    let previousRole = null;
    for (const event of buildEvents()) {
      // Print the role heading only once per contiguous message stream.
      if (event.role !== previousRole) {
        lines.push(event.role === 'user' ? 'You said:' :
          event.role === 'assistant' ? 'ChatGPT said:' : 'Page text:');
      }
      lines.push(`[${event.time}]`, event.text, '');
      previousRole = event.role;
    }

    return lines.join('\n');
  }

  /** Save the collected stream as a normal text download. */
  function exportRecording() {
    if (recording) capture();
    if (!snapshots.length) {
      alert('No snapshots recorded.');
      return;
    }

    try {
      const blob = new Blob([buildExport()], {
        type: 'text/plain;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${CONFIG.filenamePrefix}-${startedAt.replace(/[:.]/g, '-')}.txt`;
      link.addEventListener('click', event => event.stopPropagation());
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('[ChatGPT Capture] Export failed:', error);
      alert('Export failed; check the browser console.');
    }
  }

  /** Keep the start/stop Tampermonkey command in sync with the session. */
  function updateMenu() {
    if (toggleMenuId !== null) GM_unregisterMenuCommand(toggleMenuId);
    toggleMenuId = GM_registerMenuCommand(
      recording ? 'Stop recording' : 'Start new recording',
      recording ? stopRecording : startRecording
    );
  }

  GM_registerMenuCommand('Export stream (.txt)', exportRecording);
  GM_registerMenuCommand('Discard recording', discardRecording);
  GM_registerMenuCommand('Snapshot count', () => {
    alert(`${snapshots.length} snapshots in this recording`);
  });

  // On full navigation, the session ends; no previous count is persisted.
  window.addEventListener('pagehide', () => {
    if (recording) stopRecording();
  });
  updateMenu();
})();
