// ==UserScript==
// @name         ChatGPT Stream Capture
// @namespace    https://github.com/ddrewpublic/UserScripts
// @version      1.4.0
// @description  Record streaming changes and export a cleaned plain-text transcript
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Stream_Capture-1.1.user.js
// @downloadURL  https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Stream_Capture-1.1.user.js
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(() => {
    "use strict";

    const CONFIG = {
        filenamePrefix: "chatgpt-stream-capture",
        maxTranscriptChars: 2_000_000,

        // Start with only new text from this recording. Previously visible
        // conversation messages are used as a baseline, not exported.
        includeExistingMessagesOnStart: false,

        // These strings are removed from captured message text.
        removeText: [
            "ChatGPT can make mistakes. Check important info."
        ],

        // Match transient timing labels, e.g. "Worked for 7m 11s".
        removeThinkingDuration: true,

        // Used only when ChatGPT does not expose message-role DOM attributes.
        // Everything before the first conversation label is discarded, which
        // excludes sidebar text such as "Skip to content / New chat / Search".
        fallbackRoleLabels: {
            user: "You said:",
            assistant: "ChatGPT said:"
        }
    };

    // All recording state is page-local. Refreshing the page does not load
    // previous captures, so a new recording cannot inherit an old counter.
    let recording = false;
    let startedAt = null;
    let stoppedAt = null;
    let conversationUrl = "";
    let updateCount = 0;
    let characterCount = 0;
    let truncated = false;

    const turns = [];
    const turnsByKey = new Map();
    let observer = null;
    let toggleMenuId = null;
    let warnedAboutSelectors = false;
    let captureMode = null;

    /** Normalize whitespace without discarding streamed newlines. */
    function cleanMessage(text, role) {
        let cleaned = String(text).replace(/\r\n?/g, "\n");

        for (const fragment of CONFIG.removeText) {
            cleaned = cleaned.replaceAll(fragment, "");
        }

        if (CONFIG.removeThinkingDuration) {
            cleaned = cleaned.replace(
                /^[ \t]*Worked for[ \t]+(?:\d+[hms][ \t]*)+(?:\n|$)/gim,
                ""
            );
        }

        // Heading labels come from the export formatter. Remove them from
        // captured content even when preceded by transient thinking text.
        if (role === "assistant") {
            cleaned = cleaned.replace(/^ChatGPT said:[ \t]*\n?/gm, "");
        } else if (role === "user") {
            cleaned = cleaned.replace(/^You said:[ \t]*\n?/gm, "");
        }

        // Remove trailing horizontal spaces, not trailing line breaks.
        return cleaned.replace(/[ \t]+$/gm, "");
    }

    /**
     * Find ChatGPT's message elements, independent of the sidebar.
     * Some ChatGPT layouts omit these attributes, so a text fallback follows.
     */
    function readTurnsFromDom() {
        let elements = Array.from(document.querySelectorAll(
            '[data-message-author-role="user"], ' +
            '[data-message-author-role="assistant"]'
        ));
        let getRole = node => node.getAttribute("data-message-author-role");

        if (!elements.length) {
            elements = Array.from(document.querySelectorAll(
                '[data-turn="user"], [data-turn="assistant"]'
            ));
            getRole = node => node.getAttribute("data-turn");
        }

        return elements.map((node, index) => {
            const role = getRole(node);
            const wrapper = node.closest('[data-testid^="conversation-turn-"]');

            // Stable identifiers avoid duplicating an already-seen message
            // when ChatGPT replaces or temporarily unmounts its DOM node.
            const id = node.getAttribute("data-message-id") ||
                wrapper?.getAttribute("data-testid") ||
                node.getAttribute("data-turn-id") ||
                `${role}-${index}`;

            return {
                key: `dom:${id}`,
                role,
                text: cleanMessage(node.innerText || "", role)
            };
        });
    }

    /**
     * Fallback for layouts whose DOM does not mark user/assistant turns.
     * Parse the visible "You said:" / "ChatGPT said:" labels instead.
     */
    function readTurnsFromPageText() {
        if (!document.body) return [];

        // Remove changing timing labels before splitting into turns.
        let bodyText = document.body.innerText.replace(/\r\n?/g, "\n");
        if (CONFIG.removeThinkingDuration) {
            bodyText = bodyText.replace(
                /^[ \t]*Worked for[ \t]+(?:\d+[hms][ \t]*)+(?:\n|$)/gim,
                ""
            );
        }

        const labels = CONFIG.fallbackRoleLabels;
        const matches = Array.from(bodyText.matchAll(
            /^(You said:|ChatGPT said:)[ \t]*$/gm
        ));

        // Don't export the sidebar if no conversation has been detected.
        if (!matches.length) return [];

        return matches.map((match, index) => {
            const role = match[1] === labels.user ? "user" : "assistant";
            const beginning = match.index + match[0].length;
            const ending = index + 1 < matches.length
                ? matches[index + 1].index
                : bodyText.length;

            return {
                key: `fallback:${index}:${role}`,
                role,
                text: cleanMessage(bodyText.slice(beginning, ending).replace(/^\n/, ""), role)
            };
        });
    }

    /** Find the length of the common prefix of two strings. */
    function commonPrefixLength(left, right) {
        const limit = Math.min(left.length, right.length);
        let index = 0;
        while (index < limit && left[index] === right[index]) index += 1;
        return index;
    }

    /**
     * Keep only new streamed text from each assistant message.
     *
     * Normal generation appends to the existing DOM text. If an earlier
     * passage is hidden or removed, the previously recorded text is retained.
     * A mid-text rewrite is recorded as a separate fragment rather than
     * overwriting the already captured stream.
     */
    function recordTurn(item) {
        if (!item.text) return;

        let entry = turnsByKey.get(item.key);
        if (!entry) {
            entry = {
                role: item.role,
                lastVisible: "",
                highWater: "",
                text: "",
                listed: false
            };
            turnsByKey.set(item.key, entry);
        }

        const current = item.text;
        if (current === entry.lastVisible) return;

        // A user's prompt is one message, never an accumulating stream.
        // Replacing its text avoids repeating it after a DOM rerender.
        if (entry.role === "user") {
            const difference = current.length - entry.text.length;
            if (difference > 0 &&
                characterCount + difference > CONFIG.maxTranscriptChars) {
                truncated = true;
                return;
            }
            characterCount += difference;
            entry.text = current;
            entry.lastVisible = current;
            entry.highWater = current;
            if (!entry.listed) {
                turns.push(entry);
                entry.listed = true;
            }
            updateCount += 1;
            return;
        }

        let addition = "";
        if (!entry.highWater) {
            addition = current;
            entry.highWater = current;
        } else if (current.startsWith(entry.highWater)) {
            // Ordinary streaming: append only bytes not previously seen.
            addition = current.slice(entry.highWater.length);
            entry.highWater = current;
        } else if (entry.highWater.startsWith(current)) {
            // DOM temporarily collapsed; do not erase or duplicate text.
        } else if (entry.role === "assistant") {
            // ChatGPT may replace a thinking block with the answer, or edit
            // already-rendered Markdown. Keep only the inserted/replaced part.
            const prefix = commonPrefixLength(entry.lastVisible, current);
            // Do not strip a matching suffix: unrelated text can end with
            // the same letter, accidentally truncating the new output.
            addition = current.slice(prefix);

            if (addition && entry.text && !entry.text.endsWith("\n") &&
                !addition.startsWith("\n")) {
                addition = "\n" + addition;
            }
            entry.highWater = current;
        }

        entry.lastVisible = current;
        if (!addition) return;

        if (characterCount + addition.length > CONFIG.maxTranscriptChars) {
            if (!truncated) {
                console.warn("[ChatGPT Capture] Transcript limit reached.");
                truncated = true;
            }
            return;
        }

        entry.text += addition;
        if (!entry.listed) {
            turns.push(entry);
            entry.listed = true;
        }
        characterCount += addition.length;
        updateCount += 1;
    }

    /**
     * Choose one message extraction method for the whole recording.
     * Switching strategies mid-session could duplicate messages.
     */
    function readCurrentTurns() {
        let items = [];
        if (captureMode !== "fallback") {
            items = readTurnsFromDom();
            if (items.length) captureMode = "dom";
        }
        if (!items.length && captureMode !== "dom") {
            items = readTurnsFromPageText();
            if (items.length) captureMode = "fallback";
        }
        return items;
    }

    /** Collect each DOM change immediately, before transient text vanishes. */
    function capture() {
        if (!recording) return;

        try {
            const items = readCurrentTurns();

            if (!items.length && !warnedAboutSelectors) {
                console.warn("[ChatGPT Capture] No conversation markers found yet.");
                warnedAboutSelectors = true;
            }

            for (const item of items) recordTurn(item);

            // New chats sometimes obtain their permanent URL after Start.
            if (location.pathname !== "/") conversationUrl = location.href;
        } catch (error) {
            console.error("[ChatGPT Capture] Capture failed:", error);
        }
    }

    /** Register one toggle menu command, reflecting the current state. */
    function updateMenu() {
        if (toggleMenuId !== null) GM_unregisterMenuCommand(toggleMenuId);
        toggleMenuId = GM_registerMenuCommand(
            recording ? "Stop recording" : "Start new recording",
            recording ? stopRecording : startRecording
        );
    }

    /** Start a new recording; old turns and counters never carry across. */
    function startRecording() {
        if (recording || !document.body) return;

        turns.length = 0;
        turnsByKey.clear();
        updateCount = 0;
        characterCount = 0;
        truncated = false;
        warnedAboutSelectors = false;
        captureMode = null;
        startedAt = new Date().toISOString();
        stoppedAt = null;
        conversationUrl = location.href;
        recording = true;

        if (CONFIG.includeExistingMessagesOnStart) {
            capture();
        } else {
            // Do not mistake previously displayed messages for newly
            // streamed content after Stop -> Start on the same page.
            for (const item of readCurrentTurns()) {
                turnsByKey.set(item.key, {
                    role: item.role,
                    lastVisible: item.text,
                    highWater: item.text,
                    text: "",
                    listed: false
                });
            }
        }

        observer = new MutationObserver(capture);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
        updateMenu();
        console.info("[ChatGPT Capture] Recording started.");
    }

    /** Stop collecting but retain the stream for exporting. */
    function stopRecording() {
        if (!recording) return;

        capture();
        recording = false;
        stoppedAt = new Date().toISOString();
        observer?.disconnect();
        observer = null;
        updateMenu();
        console.info("[ChatGPT Capture] Recording stopped.");
    }

    /** Remove captured text without starting another recording. */
    function discardRecording() {
        if (recording) stopRecording();
        turns.length = 0;
        turnsByKey.clear();
        updateCount = 0;
        characterCount = 0;
        truncated = false;
        startedAt = null;
        stoppedAt = null;
        conversationUrl = "";
        console.info("[ChatGPT Capture] Recording discarded.");
    }

    /** Compose the one-time header and ordered, de-duplicated stream. */
    function buildExport() {
        const lines = [
            `Start time: ${startedAt}`,
            `End time: ${stoppedAt || new Date().toISOString()}`,
            `URL: ${conversationUrl}`,
            ""
        ];

        for (const entry of turns) {
            const text = entry.text.trim();
            if (!text) continue;
            lines.push(entry.role === "user" ? "You said:" : "ChatGPT said:");
            lines.push(text, "");
        }

        if (truncated) lines.push("[Transcript truncated at configured size limit]", "");
        return lines.join("\n");
    }

    /** Export a .txt file, using a detached anchor to bypass page click handlers. */
    function exportRecording() {
        if (recording) capture();
        if (!startedAt || !turns.some(entry => entry.text.trim())) {
            alert("Nothing recorded yet.");
            return;
        }

        try {
            const blob = new Blob([buildExport()], {
                type: "text/plain;charset=utf-8"
            });
            const blobUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = blobUrl;
            anchor.download = `${CONFIG.filenamePrefix}-${startedAt.replace(/[:.]/g, "-")}.txt`;

            // Attaching the anchor ensures Firefox and Chromium both handle
            // the Blob URL as a download. The Link Rewriter is disabled.
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
            console.info("[ChatGPT Capture] Export requested.");
        } catch (error) {
            console.error("[ChatGPT Capture] Export failed:", error);
            alert("Export failed; see browser console.");
        }
    }

    GM_registerMenuCommand("Export stream (.txt)", exportRecording);
    GM_registerMenuCommand("Discard recording", discardRecording);
    GM_registerMenuCommand("Recording status", () => {
        alert([
            `Recording: ${recording ? "Yes" : "No"}`,
            `Stream updates: ${updateCount}`,
            `Characters retained: ${characterCount}`,
            `Messages: ${turns.length}`
        ].join("\n"));
    });

    window.addEventListener("pagehide", () => {
        if (recording) stopRecording();
    });
    updateMenu();
})();
