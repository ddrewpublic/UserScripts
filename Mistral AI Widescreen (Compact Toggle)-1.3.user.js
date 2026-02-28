// ==UserScript==
// @name         Mistral AI Widescreen (Compact Toggle)
// @namespace    mistral-widescreen-compact
// @version      1.3
// @description  Widescreen for Mistral AI with a tiny toggle button that expands on hover
// @author       Le Chat
// @match        *://chat.mistral.ai/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // Apply widescreen styles
    GM_addStyle(`
        /* Widen the chat container (input and messages) */
        .flex.max-w-(--breakpoint-md).min-w-0.flex-1.shrink.flex-col.gap-8 {
            max-width: 90vw !important;
            margin: 0 auto !important;
        }

        /* Widen message bubbles (content only) */
        .group.message.interpolate-size-allow-keywords.flex.min-h-auto.w-full.gap-3 {
            max-width: 90vw !important;
        }

        /* Widen message text/content */
        .flex.min-w-0.flex-1.flex-col {
            max-width: calc(90vw - 60px) !important;
        }

        /* Widen markdown, code blocks, and prose */
        .markdown-container-style,
        .border-default.bg-default.relative.m-0.rounded-md.border.whitespace-break-spaces {
            max-width: calc(90vw - 60px) !important;
        }

        /* Widen the chat input area */
        .relative.start-0.end-0.bottom-0.z-30.flex.flex-col.items-center.mx-3.mb-0.w-full {
            max-width: 90vw !important;
            margin: 0 auto !important;
        }

        /* Widen the input form */
        .rounded-xl.transition-all.shadow-big.delay-150.mx-3.mb-0.w-full {
            max-width: 90vw !important;
        }

        /* Widen the ProseMirror input */
        .ProseMirror {
            min-height: 100px !important;
        }

        /* Hide the bottom disclaimer */
        .text-muted.max-w-6xl.px-2.py-3.text-center.text-xs {
            display: none !important;
        }

        /* Keep avatar column small */
        .relative.flex.flex-col.items-center.gap-4 {
            width: 40px !important;
            flex: 0 0 auto !important;
        }

        /* Compact toggle button */
        #mistralWidescreenToggle {
            position: fixed;
            bottom: 17px;
            right: 80px;
            z-index: 9999;
            padding: 4px 8px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s ease;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }

        #mistralWidescreenToggle:hover {
            width: auto;
            padding: 4px 12px;
        }
    `);

    // Add a toggle button
    const button = document.createElement('button');
    button.id = 'mistralWidescreenToggle';
    button.textContent = 'W';
    button.title = 'Toggle Widescreen';
    button.style.cssText = `
        bottom: 17px;
        right: 80px;
    `;

    // Toggle styles on/off
    button.onclick = function() {
        const style = document.querySelector('style[gm-style]');
        if (style) {
            style.remove();
            button.textContent = 'W';
            button.title = 'Enable Widescreen';
        } else {
            location.reload();
        }
    };

    document.body.appendChild(button);
})();
