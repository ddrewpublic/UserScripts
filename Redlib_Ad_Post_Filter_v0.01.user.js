// ==UserScript==
// @name         Redlib - Advertising Post Filter
// @namespace    https://github.com/ddrewprivate/UserScripts
// @version      0.03
// @description  Filter suspected advertising posts via the Tampermonkey menu.
// @match        https://redlib.catsarch.com/r/all*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    // Restrict execution to r/all and its sorting variants.
    if (!/^\/r\/all(?:\/|$)/.test(window.location.pathname)) {
        return;
    }

    // Persistent filtering preference.
    const STORAGE_KEY = 'redlib-ad-filter-mode';

    // Available modes, presented in the Tampermonkey extension menu.
    const MODES = {
        hide: 'Hide adverts',
        only: 'Show only adverts',
        all: 'Show all posts',
    };

    // Restore the saved preference; hide adverts by default.
    let currentMode = GM_getValue(STORAGE_KEY, 'hide');

    if (!Object.hasOwn(MODES, currentMode)) {
        currentMode = 'hide';
    }

    // Track registered commands so their labels can be refreshed.
    let menuCommandIds = [];

    /**
     * Extract the post score without the nested "Upvotes" label.
     *
     * @param {Element|null} element - Post score element.
     * @returns {string} Displayed score or placeholder.
     */
    function getScoreText(element) {
        if (!element) {
            return '';
        }

        return Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join('')
            .trim();
    }

    /**
     * Identify suspected adverts using three conditions:
     *
     * 1. Subreddit is exactly "r/".
     * 2. Comment count is zero.
     * 3. Score is missing, zero, or a placeholder.
     *
     * @param {Element} post - Redlib post element.
     * @returns {boolean} Whether all conditions match.
     */
    function isSuspectedAd(post) {
        const subreddit = post.querySelector(
            '.post_header .post_subreddit'
        );

        const comments = post.querySelector(
            '.post_footer .post_comments'
        );

        const scoreElement = post.querySelector('.post_score');

        // Missing essential metadata is not enough to classify an advert.
        if (!subreddit || !comments) {
            return false;
        }

        const blankSubreddit = subreddit.textContent.trim() === 'r/';

        const zeroComments = /^0\s+comments?$/i.test(
            comments.textContent.trim()
        );

        const score = getScoreText(scoreElement);
        const noScore = /^(?:0|[•—–-]|n\/a)?$/i.test(score);

        return blankSubreddit && zeroComments && noScore;
    }

    /**
     * Filter posts according to the currently selected mode.
     *
     * Posts are hidden rather than deleted so changing modes
     * can restore them without reloading the page.
     */
    function filterPosts() {
        for (const post of document.querySelectorAll('#posts > .post')) {
            try {
                const suspectedAd = isSuspectedAd(post);

                // Decide which posts should be hidden.
                const shouldHide =
                    (currentMode === 'hide' && suspectedAd) ||
                    (currentMode === 'only' && !suspectedAd);

                // Apply or remove the filtering class.
                post.classList.toggle(
                    'redlib-ad-filter-hidden',
                    shouldHide
                );

                // Each post has a preceding horizontal separator.
                const separator = post.previousElementSibling;

                if (separator?.matches('hr.sep')) {
                    separator.classList.toggle(
                        'redlib-ad-filter-hidden',
                        shouldHide
                    );
                }

            } catch (error) {
                console.error(
                    '[Redlib Ad Filter] Error processing post:',
                    error
                );
            }
        }
    }

    /**
     * Change the filtering mode, persist it and update the page.
     *
     * @param {string} mode - One of: hide, only, all.
     */
    function setMode(mode) {
        if (!Object.hasOwn(MODES, mode)) {
            console.error('[Redlib Ad Filter] Invalid mode:', mode);
            return;
        }

        currentMode = mode;

        // Store the preference in Tampermonkey's own storage.
        GM_setValue(STORAGE_KEY, currentMode);

        // Apply the new mode immediately.
        filterPosts();

        // Update the checkmark in the Tampermonkey menu.
        registerMenuCommands();
    }

    /**
     * Register the three filtering commands in Tampermonkey.
     *
     * The active command receives a checkmark.
     * Existing commands are unregistered before refreshing.
     */
    function registerMenuCommands() {
        // Remove previous commands to avoid duplicates.
        for (const commandId of menuCommandIds) {
            GM_unregisterMenuCommand(commandId);
        }

        menuCommandIds = [];

        // Register one menu command per filtering mode.
        for (const [mode, label] of Object.entries(MODES)) {
            const selected = mode === currentMode;
            const menuLabel = `${selected ? '✓ ' : '    '}${label}`;

            const commandId = GM_registerMenuCommand(
                menuLabel,
                () => setMode(mode),
                { autoClose: true }
            );

            menuCommandIds.push(commandId);
        }
    }

    /**
     * Install CSS used to hide filtered posts and their separators.
     */
    function installStyles() {
        const style = document.createElement('style');

        style.textContent = `
            .redlib-ad-filter-hidden {
                display: none !important;
            }
        `;

        document.head.appendChild(style);
    }

    // Initialise the filtering system.
    installStyles();
    registerMenuCommands();
    filterPosts();

    // Process additional posts if the feed is updated dynamically.
    const postsContainer = document.querySelector('#posts');

    if (postsContainer) {
        const observer = new MutationObserver(() => {
            filterPosts();
        });

        observer.observe(postsContainer, {
            childList: true,
        });
    }
})();