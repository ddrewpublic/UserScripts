// ==UserScript==
// @name         ChatGPT Stream Capture
// @namespace    https://github.com/ddrewpublic/UserScripts
// @version      1.5.1
// @description  Record timestamped full stream snapshots and export cleaned plain text
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

  /**
   * Build a readable log from the ORIGINAL full-page snapshots.
   *
   * Do not compute deltas. An assistant message at each timestamp contains
   * everything visible in that message at that moment, including the text
   * that appeared in earlier beats. This intentionally produces a large log.
   *
   * User prompts appear only once per conversation turn. Navigation and
   * interface text are removed by cleanText() / splitTurns() at export time.
   */
  function buildEvents() {
    const events = [];
    const previousTurnText = new Map();
    const promptsSeen = new Set();

    // Decide fallback mode using the entire history, not the first snapshot.
    const hasRoleMarkers = snapshots.some(snapshot =>
      splitTurns(snapshot.text).length > 0
    );
    let previousPageText = '';

    for (const snapshot of snapshots) {
      if (!hasRoleMarkers) {
        // If ChatGPT changes role labels, keep a full page-text snapshot
        // rather than silently dropping the stream or exporting just deltas.
        let text = cleanText(snapshot.text);
        if (text.startsWith(CONFIG.fallbackNavigationPrefix)) {
          text = text.slice(CONFIG.fallbackNavigationPrefix.length).trimStart();
        }
        if (text && text !== previousPageText) {
          events.push({ time: snapshot.time, role: 'page', text });
        }
        previousPageText = text;
        continue;
      }

      const turns = splitTurns(snapshot.text);
      for (let index = 0; index < turns.length; index += 1) {
        const turn = turns[index];
        if (!turn.text.trim()) continue;

        // Keep independent histories for each conversation turn.
        const key = `${index}:${turn.role}`;
        const previousText = previousTurnText.get(key);

        if (turn.role === 'user') {
          // Prompts do not need to be repeated with each assistant beat.
          if (!promptsSeen.has(key)) {
            events.push({ time: snapshot.time, role: 'user', text: turn.text });
            promptsSeen.add(key);
          }
        } else if (turn.text !== previousText) {
          // IMPORTANT: save the complete assistant text, NOT an added suffix.
          // A shrink/re-render is also recorded, just like the original
          // full-page snapshots, instead of trying to reconstruct the stream.
          events.push({ time: snapshot.time, role: 'assistant', text: turn.text });
        }

        previousTurnText.set(key, turn.text);
      }
    }

    return events;
  }

  /** Export complete assistant content at each timestamp, not fragments. */
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
      // Explicit separator makes full, repeated snapshots easier to scan.
      lines.push(`--- ${event.time} ---`, event.text, '');
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
