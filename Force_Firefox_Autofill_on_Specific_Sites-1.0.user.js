// ==UserScript==
// @name         Force Firefox Autofill on Specific Sites
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adjust email fields to improve Firefox autofill, only on selected sites
// @namespace    https://github.com/ddrewpublic/UserScripts
// @updateURL    https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/Force_Firefox_Autofill_on_Specific_Sites-1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/Force_Firefox_Autofill_on_Specific_Sites-1.0.user.js
// @author       Daniel Drew
// @match        https://auth.service.com/*
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://openai.com/*
// @match        https://*.openai.com/*
// @match        https://oaistatic.com/*
// @match        https://*.oaistatic.com/*
// @match        https://redditstatic.com/*
// @match        https://*.redditstatic.com/*
// @match        https://reddit.com/*
// @match        https://*.reddit.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Wait until the entire page has loaded
    window.addEventListener('load', () => {

        // Select all input elements that are either:
        //  - of type="email"
        //  - or whose name attribute contains the substring "email" (case-insensitive)
        const inputs = document.querySelectorAll(
            'input[type="email"],input[name*="email" i],input[type="username"],input[type="user[mail]"]'
        );

        // Loop over each matched input element
        inputs.forEach(input => {
            // Log to the console for debugging/verification
            console.log('[Autofill Fix] Adjusting:', input);

            // Set the autocomplete attribute to "username"
            // This helps Firefox recognize the field as a username/email for autofill
            input.setAttribute('autocomplete', 'username');
        });
    });
})();