// ==UserScript==
// @name         Redlib - Hide Suspected Advertising Posts
// @namespace    https://github.com/ddrewprivate/UserScripts
// @version      0.01
// @description  Hide r/all posts with no subreddit, zero comments and no meaningful score.
// @match        https://redlib.catsarch.com/r/all*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---------- CONFIG: EDIT THIS ----------
    const CONFIG = {
        debug: false, // Log hidden posts and any processing errors to the console.
    };
    // -------- END CONFIG: EDIT ABOVE --------

    // Keep the userscript confined to r/all, including sort and query variants.
    if (!/^\/r\/all(?:\/|$)/.test(window.location.pathname)) {
        return;
    }

    /**
     * Return the score text without the nested "Upvotes" label.
     * Redlib renders the score itself as a direct text node.
     *
     * @param {Element|null} scoreElement - The post's score element.
     * @returns {string} Displayed numeric score or placeholder.
     */
    function getScoreText(scoreElement) {
        if (!scoreElement) {
            return '';
        }

        return Array.from(scoreElement.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join('')
            .trim();
    }

    /**
     * Identify posts matching all three suspected-ad characteristics.
     * Missing subreddit or comment elements are not treated as matches.
     *
     * @param {Element} post - A Redlib feed post element.
     * @returns {boolean} Whether the post should be hidden.
     */
    function isSuspectedAd(post) {
        const subredditElement = post.querySelector('.post_header .post_subreddit');
        const commentsElement = post.querySelector('.post_footer .post_comments');
        const scoreElement = post.querySelector('.post_score');

        if (!subredditElement || !commentsElement) {
            return false;
        }

        // Condition 1: No subreddit name (exactly "r/").
        const blankSubreddit = subredditElement.textContent.trim() === 'r/';

        // Condition 2: Exactly zero comments.
        const zeroComments = /^0\s+comments?$/i.test(commentsElement.textContent.trim());

        // Condition 3: No displayed score, zero, or Redlib's hidden-score bullet.
        const score = getScoreText(scoreElement);
        const noScore = /^(?:0|[•—–-]|n\/a)?$/i.test(score);

        return blankSubreddit && zeroComments && noScore;
    }

    /**
     * Remove suspected advertising posts and their preceding separators.
     *
     * @returns {number} Number of posts removed by this pass.
     */
    function filterPosts() {
        let removed = 0;

        for (const post of document.querySelectorAll('#posts > .post')) {
            try {
                if (!isSuspectedAd(post)) {
                    continue;
                }

                if (CONFIG.debug) {
                    console.info('[Redlib Ad Filter] Hiding post:', post.id, post);
                }

                // Each Redlib feed post is preceded by its own <hr class="sep">.
                const separator = post.previousElementSibling;
                if (separator?.matches('hr.sep')) {
                    separator.remove();
                }

                post.remove();
                removed += 1;
            } catch (error) {
                // One malformed post must not prevent processing the rest.
                console.error('[Redlib Ad Filter] Could not process post:', error);
            }
        }

        if (CONFIG.debug && removed > 0) {
            console.info(`[Redlib Ad Filter] Removed ${removed} suspected ad(s).`);
        }

        return removed;
    }

    // Filter the initial feed and any posts subsequently inserted into it.
    filterPosts();

    const postsContainer = document.querySelector('#posts');
    if (postsContainer) {
        const observer = new MutationObserver(() => filterPosts());
        observer.observe(postsContainer, { childList: true });
    }
})();