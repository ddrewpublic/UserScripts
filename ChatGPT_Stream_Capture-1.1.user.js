// ==UserScript==
// @name         ChatGPT Stream Capture
// @namespace    https://github.com/ddrewpublic/UserScripts
// @version      1.2.0
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

  let recording = GM_getValue(STATE_KEY, false);
  let captures = GM_getValue(DATA_KEY, []);
  let previous = "";
  let observer = null;
  let saveTimer = null;
  let toggleMenuId = null;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    GM_setValue(DATA_KEY, captures);
  }

  function capture() {
    if (!recording) return;

    const text = document.body.innerText.trim();

    if (!text || text === previous) return;

    previous = text;

    captures.push({
      time: new Date().toISOString(),
      url: location.href,
      text
    });

    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
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

  function start() {
    if (observer) return;

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
    recording ? stop() : start();
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

  GM_registerMenuCommand(
    "Snapshot count",
    () => alert(`${captures.length} snapshots captured`)
  );

  window.addEventListener("pagehide", save);

  if (recording) {
    start();
  } else {
    updateMenu();
  }
})();