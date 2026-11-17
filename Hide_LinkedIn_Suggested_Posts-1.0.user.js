// ==UserScript==
// @name         Hide LinkedIn Suggested Posts
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Hide LinkedIn posts marked as 'Suggested'
// @namespace    https://github.com/ddrewpublic/UserScripts
// @updateURL    https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/Hide_LinkedIn_Suggested_Posts-1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/Hide_LinkedIn_Suggested_Posts-1.0.user.js
// @author       You
// @match        https://www.linkedin.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /**
     * Utility function to check if a node contains a "Suggested" label
     * and is inside a `fie-impression-container` block.
     */
    function hideSuggestedPosts() {
        const suggestionSpans = document.querySelectorAll(
            'span.update-components-header__text-view'
        );

        suggestionSpans.forEach((span) => {
            if (span.textContent.trim() === 'Suggested') {
                let container = span.closest('.fie-impression-container');
                if (container && !container.dataset.hiddenByScript) {
                    container.style.display = 'none';
                    container.dataset.hiddenByScript = 'true'; // Avoid hiding repeatedly
                }
            }
        });
    }

    // Run initially
    hideSuggestedPosts();

    // Observe dynamic content changes (e.g. infinite scroll)
    const observer = new MutationObserver(() => {
        hideSuggestedPosts();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
