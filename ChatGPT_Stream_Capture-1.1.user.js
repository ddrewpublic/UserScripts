// ==UserScript==
// @name         ChatGPT Stream Capture
// @namespace    https://github.com/ddrewpublic/UserScripts
// @version      1.2.2
// @description  Capture visible ChatGPT streaming responses
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Stream_Capture-1.1.user.js
// @downloadURL  https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Stream_Capture-1.1.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(() => {
  "use strict";

  const DATA_KEY = "chatgpt-captures-v1";
  const STATE_KEY = "chatgpt-recording-v1";
  // Keep a bounded number of snapshots to limit Tampermonkey storage growth.
  const MAX_SNAPSHOTS = 500;
  const MAX_TEXT_LENGTH = 500000;

  let recording = GM_getValue(STATE_KEY, false);
  let captures = GM_getValue(DATA_KEY, []);
  if (!Array.isArray(captures)) captures = [];
  captures = captures.slice(-MAX_SNAPSHOTS);
  let previous = "";
  let observer = null;
  let toggleMenuId = null;

  function save() {
    GM_setValue(DATA_KEY, captures);
  }

  function capture() {
    if (!recording) return;

    const text = document.body.innerText.trim();
    // Avoid persisting extremely large full-page snapshots.
    if (text.length > MAX_TEXT_LENGTH) {
      console.warn("[ChatGPT Capture] Snapshot exceeds size limit; skipped.");
      return;
    }

    if (!text || text === previous) return;

    previous = text;

    captures.push({
      time: new Date().toISOString(),
      url: location.href,
      text
    });

    // Bound history and persist each snapshot promptly. A debounce can lose
    // the latest snapshots if the page is closed before its timer fires.
    if (captures.length > MAX_SNAPSHOTS) captures.shift();
    save();
  }

  function updateMenu() {
    if (toggleMenuId !== null) {
      GM_unregisterMenuCommand(toggleMenuId);
    }

    toggleMenuId = GM_registerMenuCommand(
      recording
        ? "● Stop recording (active)"
        : "○ Start recording (stopped)",
      toggle
    );
  }

  function start(freshSession = false) {
    if (observer) return;

    // Explicit starts discard old captures. Automatic restart after a page
    // reload preserves the active recording session.
    if (freshSession) {
      captures = [];
      previous = "";
      save();
    }

    recording = true;
    GM_setValue(STATE_KEY, true);

    previous = "";

    observer = new MutationObserver(capture);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    capture();
    updateMenu();
  }

  function stop() {
    recording = false;
    GM_setValue(STATE_KEY, false);

    observer?.disconnect();
    observer = null;

    save();
    updateMenu();
  }

  function toggle() {
    recording ? stop() : start(true);
  }

  function discardCaptures() {
    // Stop first to prevent an observer callback repopulating the cleared data.
    if (recording) stop();
    captures = [];
    previous = "";
    save();
  }

  function exportCaptures() {
    // Flush pending snapshots before exporting.
    save();

    const blob = new Blob(
      [JSON.stringify(captures, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "chatgpt-stream-capture.json";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  GM_registerMenuCommand("Export captures", exportCaptures);
  GM_registerMenuCommand("Discard captures", discardCaptures);

  GM_registerMenuCommand(
    "Snapshot count",
    () => alert(`${captures.length} snapshots captured`)
  );

  window.addEventListener("pagehide", save);

  if (recording) {
    start(false);
  } else {
    updateMenu();
  }
})();