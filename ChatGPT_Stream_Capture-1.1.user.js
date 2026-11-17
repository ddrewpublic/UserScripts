
// ==UserScript==
// @name         ChatGPT Stream Capture
// @namespace    https://github.com/ddrewpublic/UserScripts
// @version      1.3.0
// @description  Record a ChatGPT transcript and export cleaned plain text
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(() => {
    "use strict";

    /*
     * Configuration
     *
     * These rules operate on the captured page text.
     * Adjust them if ChatGPT changes its interface.
     */
    const CONFIG = {
        filenamePrefix: "chatgpt-capture",

        // Remove this navigation text when it appears at the
        // beginning of the captured page.
        removeLeadingNavigation: true,

        navigationStart: "Skip to content",

        // The first occurrence of this label normally marks
        // the beginning of the conversation transcript.
        conversationStart: "You said:",

        // Exact text fragments to remove wherever they occur.
        removeText: [
            "ChatGPT can make mistakes. Check important info."
        ],

        // Remove timing labels while retaining "ChatGPT said:".
        removeThinkingDuration: true,

        // Avoid excessively frequent DOM reads.
        captureDebounceMs: 300,

        // Limit the amount of text held in memory.
        maxTextLength: 2000000
    };

    /*
     * Recording state
     *
     * Deliberately not persisted with GM_setValue:
     * each page load starts a new, independent session.
     */
    let recording = false;
    let startedAt = null;
    let endedAt = null;
    let conversationUrl = "";
    let transcript = "";
    let changeCount = 0;

    let observer = null;
    let captureTimer = null;
    let toggleMenuId = null;

    /**
     * Return the current time in ISO 8601 format.
     *
     * @returns {string} Timestamp.
     */
    function timestamp() {
        return new Date().toISOString();
    }

    /**
     * Normalize line endings and remove unwanted interface text.
     *
     * @param {string} input - Raw page text.
     * @returns {string} Cleaned transcript.
     */
    function cleanText(input) {
        let text = input.replace(/\r\n?/g, "\n");

        // Strip the sidebar/navigation prefix, but only when
        // the configured conversation marker is present.
        if (CONFIG.removeLeadingNavigation) {
            const navStart = text.indexOf(
                CONFIG.navigationStart
            );

            const conversationStart = text.indexOf(
                CONFIG.conversationStart
            );

            if (
                navStart !== -1 &&
                conversationStart > navStart
            ) {
                text = text.slice(conversationStart);
            }
        }

        // Remove configurable interface text.
        for (const fragment of CONFIG.removeText) {
            text = text.replaceAll(fragment, "");
        }

        if (CONFIG.removeThinkingDuration) {
            // Examples:
            // Worked for 7m 11s
            // ChatGPT said:
            //
            // Becomes:
            // ChatGPT said:
            text = text.replace(
                /^[ \t]*Worked for[ \t]+\d+(?:h[ \t]*)?(?:\d+m[ \t]*)?(?:\d+s)?[ \t]*\n(?=[ \t]*ChatGPT said:)/gim,
                ""
            );
        }

        // Remove trailing spaces without removing line breaks.
        text = text.replace(/[ \t]+$/gm, "");

        // Collapse excessive blank lines.
        text = text.replace(/\n{4,}/g, "\n\n\n");

        return text.trim();
    }

    /**
     * Read and retain the latest complete transcript.
     *
     * A recording stores only the latest text, rather than
     * appending a full-page snapshot on every DOM mutation.
     */
    function capture() {
        if (!recording || !document.body) {
            return;
        }

        try {
            const rawText = document.body.innerText;

            if (rawText.length > CONFIG.maxTextLength) {
                console.warn(
                    "[ChatGPT Capture] Page exceeds size limit."
                );
                return;
            }

            const cleaned = cleanText(rawText);

            if (!cleaned || cleaned === transcript) {
                return;
            }

            transcript = cleaned;
            changeCount += 1;
        } catch (error) {
            console.error(
                "[ChatGPT Capture] Capture failed:",
                error
            );
        }
    }

    /**
     * Schedule one capture after DOM changes settle.
     */
    function scheduleCapture() {
        if (!recording) {
            return;
        }

        clearTimeout(captureTimer);

        captureTimer = setTimeout(() => {
            captureTimer = null;
            capture();
        }, CONFIG.captureDebounceMs);
    }

    /**
     * Refresh the Tampermonkey start/stop menu.
     */
    function updateMenu() {
        if (toggleMenuId !== null) {
            GM_unregisterMenuCommand(toggleMenuId);
        }

        toggleMenuId = GM_registerMenuCommand(
            recording
                ? "Stop recording"
                : "Start new recording",
            () => {
                if (recording) {
                    stopRecording();
                } else {
                    startRecording();
                }
            }
        );
    }

    /**
     * Start a completely new recording session.
     *
     * Old transcript data and counters are discarded.
     */
    function startRecording() {
        if (recording) {
            return;
        }

        // Reset every session-specific value.
        transcript = "";
        changeCount = 0;
        startedAt = timestamp();
        endedAt = null;
        conversationUrl = location.href;

        recording = true;

        // Take an initial snapshot immediately.
        capture();

        observer = new MutationObserver(scheduleCapture);

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        updateMenu();

        console.info(
            "[ChatGPT Capture] New recording started."
        );
    }

    /**
     * Stop recording without deleting the transcript.
     */
    function stopRecording() {
        if (!recording) {
            return;
        }

        clearTimeout(captureTimer);
        captureTimer = null;

        // Capture the final page state before stopping.
        capture();

        recording = false;
        endedAt = timestamp();

        if (observer) {
            observer.disconnect();
            observer = null;
        }

        updateMenu();

        console.info(
            "[ChatGPT Capture] Recording stopped."
        );
    }

    /**
     * Discard the current transcript and reset the counter.
     */
    function discardRecording() {
        if (recording) {
            stopRecording();
        }

        transcript = "";
        changeCount = 0;
        startedAt = null;
        endedAt = null;
        conversationUrl = "";

        console.info(
            "[ChatGPT Capture] Recording discarded."
        );
    }

    /**
     * Build a plain-text file containing one transcript.
     *
     * @returns {string} Export content.
     */
    function buildExport() {
        const endTime = endedAt || timestamp();

        return [
            `Start time: ${startedAt}`,
            `End time: ${endTime}`,
            `URL: ${conversationUrl}`,
            "",
            transcript,
            ""
        ].join("\n");
    }

    /**
     * Download the current transcript as a UTF-8 text file.
     *
     * Uses a Blob URL and an explicit download attribute.
     * Prevents the synthetic click from reaching page-level
     * click interceptors.
     */
    function exportRecording() {
        if (!startedAt || !transcript) {
            alert("No transcript available to export.");
            return;
        }

        // Include the latest text if recording is still active.
        if (recording) {
            clearTimeout(captureTimer);
            captureTimer = null;
            capture();
        }

        try {
            const content = buildExport();

            const blob = new Blob(
                [content],
                {
                    type: "text/plain;charset=utf-8"
                }
            );

            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement("a");

            const datePart = startedAt
                .replace(/[:.]/g, "-");

            link.href = blobUrl;
            link.download =
                `${CONFIG.filenamePrefix}-${datePart}.txt`;

            link.style.display = "none";

            // Keep the click from bubbling to the page's
            // own click handlers.
            link.addEventListener(
                "click",
                event => event.stopImmediatePropagation(),
                true
            );

            document.body.appendChild(link);

            link.click();
            link.remove();

            // Give the browser time to begin the download.
            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
            }, 60000);

            console.info(
                "[ChatGPT Capture] Export requested."
            );
        } catch (error) {
            console.error(
                "[ChatGPT Capture] Export failed:",
                error
            );

            alert(
                "Export failed. Check the browser console."
            );
        }
    }

    /*
     * Tampermonkey menu commands
     */
    GM_registerMenuCommand(
        "Export transcript (.txt)",
        exportRecording
    );

    GM_registerMenuCommand(
        "Discard recording",
        discardRecording
    );

    GM_registerMenuCommand(
        "Recording status",
        () => {
            alert(
                [
                    `Recording: ${recording ? "Yes" : "No"}`,
                    `Text changes: ${changeCount}`,
                    `Characters: ${transcript.length}`,
                    `Started: ${startedAt || "Not started"}`
                ].join("\n")
            );
        }
    );

    /*
     * Finish recording on page exit.
     *
     * Sessions are intentionally not resumed across pages.
     */
    window.addEventListener("pagehide", () => {
        if (recording) {
            stopRecording();
        }
    });

    // Initially stopped, with no previous captures.
    updateMenu();
})();
