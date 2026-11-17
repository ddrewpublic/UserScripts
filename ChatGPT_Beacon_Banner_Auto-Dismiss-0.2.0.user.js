// ==UserScript==
// @name         ChatGPT Beacon Banner Auto-Dismiss
// @namespace    https://chatgpt.com/
// @homepageURL  https://github.com/ddrewpublic/UserScripts
// @version      0.2.0
// @description  Automatically dismiss visible ChatGPT beacon/promotional banners.
// @updateURL    https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Beacon_Banner_Auto-Dismiss-0.2.0.user.js
// @downloadURL  https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Beacon_Banner_Auto-Dismiss-0.2.0.user.js
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict'

    /**
     * Dismiss visible ChatGPT beacon/promotional banners.
     *
     * ChatGPT can keep hidden duplicate banner markup in the DOM, so using
     * querySelector() alone may hit a zero-size hidden dismiss button.
     * This filters by rendered size and only clicks visible instances.
     */
    function dismissChatGPTBeaconBanners() {
        document.querySelectorAll(
            'button[aria-label="Dismiss ChatGPT beacon banner"]'
        ).forEach(button => {
            const rect = button.getBoundingClientRect()

            if (rect.width > 0 && rect.height > 0) {
                button.click()
            }
        })
    }

    // Handle a banner already present when the userscript starts.
    dismissChatGPTBeaconBanners()

    // ChatGPT injects/re-renders UI dynamically, so watch for later banners.
    new MutationObserver(() => {
        dismissChatGPTBeaconBanners()
    }).observe(document.body, {
        childList: true,
        subtree: true
    })
})()