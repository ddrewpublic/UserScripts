// ==UserScript==
// @name         Link Rewriter (configurable add/remove)
// @namespace    https://example.com/
// @version      0.02
// @description  Generic link rewriting on specific sites with configurable add/remove rules.
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- CONFIG: EDIT THIS ---------- */
  const CONFIG = {
    // Where should this script run? (Any of: string, RegExp). All must match current URL.
    baseMatch: [
      /^https:\/\/chatgpt\.com\//,               // example: only on chatgpt.com
      // 'https://example.com/app'               // string match (includes)
    ],

    // Which anchors to process?
    outgoingFilter: {
      onlyExternal: true,                        // true = only links whose host differs from current host
      hrefIncludesAny: [
        // 'outgoing?',                          // optional: only links containing any of these substrings
      ],
      hrefExcludesAny: [
        // 'logout',                             // optional: skip links containing any of these substrings
      ]
    },

    // What to do with matched links? Actions run in order.
    actions: [
      // Remove a specific query param (optionally only when value matches)
      { type: 'removeQueryParam', key: 'utm_source', ifValueIs: 'chatgpt.com' },

      // Example: add a query param if missing (or overwrite if overwrite=true)
      // { type: 'addQueryParam', key: 'ref', value: 'mytag', overwrite: false },

      // Remove raw substring anywhere in the URL
      // { type: 'removeSubstring', value: '/?utm_source=chatgpt.com' },

      // Add raw prefix/suffix (use with care; handles ?/& joining when suffix looks like query)
      // { type: 'addSuffix', value: 'ref=mytag' }, // if suffix contains '=', it will be appended as query
      // { type: 'addPrefix', value: 'https://redirect.example.com/?url=' },
    ]
  };
  /* -------- END CONFIG: EDIT ABOVE -------- */

  // --- helpers ---
  function pageMatches() {
    return CONFIG.baseMatch.every(rule =>
      rule instanceof RegExp ? rule.test(location.href) : String(location.href).includes(String(rule))
    );
  }

  function isExternal(u) {
    try { return new URL(u, location.href).host !== location.host; } catch { return false; }
  }

  function includesAny(href, arr) {
    return Array.isArray(arr) && arr.length ? arr.some(s => href.includes(s)) : true;
  }
  function excludesAny(href, arr) {
    return Array.isArray(arr) && arr.length ? !arr.some(s => href.includes(s)) : true;
  }

  // Build a cleaned URL string based on CONFIG.actions
  function transformUrlString(href) {
    let u;
    try { u = new URL(href, location.href); }
    catch { return href; } // leave malformed/relative strings alone

    for (const action of CONFIG.actions) {
      switch (action.type) {
        case 'removeQueryParam': {
          if (!action.key) break;
          if (action.ifValueIs == null || u.searchParams.get(action.key) === String(action.ifValueIs)) {
            u.searchParams.delete(action.key);
          }
          break;
        }
        case 'addQueryParam': {
          if (!action.key) break;
          const has = u.searchParams.has(action.key);
          if (!has || action.overwrite) {
            u.searchParams.set(action.key, action.value ?? '');
          }
          break;
        }
        case 'removeSubstring': {
          if (!action.value) break;
          // operate on full href string representation
          const asString = u.toString().replace(action.value, '');
          try { u = new URL(asString); } catch { /* ignore */ }
          break;
        }
        case 'addSuffix': {
          if (!action.value) break;
          // If suffix looks like "k=v" or starts with "&" or "?", treat it as query join
          const v = String(action.value);
          if (v.startsWith('?') || v.startsWith('&') || v.includes('=')) {
            // append as query, handling separators
            const hasQuery = u.search.length > 0;
            const sep = hasQuery ? (v.startsWith('&') ? '' : '&') : (v.startsWith('?') ? '' : '?');
            const newHref = u.origin + u.pathname + u.search + sep + v.replace(/^[?&]/, '') + u.hash;
            try { u = new URL(newHref); } catch { /* ignore */ }
          } else {
            // treat as literal suffix to path
            const newHref = u.origin + u.pathname + v + u.search + u.hash;
            try { u = new URL(newHref); } catch { /* ignore */ }
          }
          break;
        }
        case 'addPrefix': {
          if (!action.value) break;
          // naive: just prepend; consumer can encode if needed
          const newHref = String(action.value) + encodeURIComponent(u.toString());
          try { u = new URL(newHref); } catch { /* ignore */ }
          break;
        }
        default:
          // no-op for unknown types
          break;
      }
    }

    // Recompose without adding trailing "?" if empty
    return u.origin + u.pathname + (u.search || '') + (u.hash || '');
  }

  function shouldProcessHref(href) {
    if (!href) return false;
    const isExtOk = CONFIG.outgoingFilter.onlyExternal ? isExternal(href) : true;
    const incOk = includesAny(href, CONFIG.outgoingFilter.hrefIncludesAny);
    const excOk = excludesAny(href, CONFIG.outgoingFilter.hrefExcludesAny);
    return isExtOk && incOk && excOk;
  }

  function sanitizeAnchor(a) {
    const original = a.getAttribute('href');
    if (!shouldProcessHref(original)) return;
    const cleaned = transformUrlString(original);
    if (cleaned !== original) a.setAttribute('href', cleaned);
  }

  function sanitizeAnchors(root = document) {
    const list = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    list.forEach(sanitizeAnchor);
  }

  function clickInterceptor(e) {
    const a = e.composedPath().find(n => n && n.tagName === 'A' && n.href);
    if (!a) return;
    const original = a.getAttribute('href');
    if (!shouldProcessHref(original)) return;

    const cleaned = transformUrlString(original);
    if (cleaned !== original) {
      a.setAttribute('href', cleaned);
      // Direct navigation for plain left-click (no modifiers)
      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const target = a.getAttribute('target');
        if (target === '_blank') {
          window.open(cleaned, '_blank');
        } else {
          location.href = cleaned;
        }
      }
    }
  }

  // Patch window.open as well (in case site code opens links programmatically)
  const origOpen = window.open;
  window.open = function (url, target, features) {
    try {
      if (shouldProcessHref(url)) url = transformUrlString(url);
    } catch { /* ignore */ }
    return origOpen.call(window, url, target, features);
  };

  // Mutation observer to catch dynamic content
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.attributeName === 'href' && m.target?.tagName === 'A') {
        sanitizeAnchor(m.target);
      } else if (m.addedNodes?.length) {
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'A' && n.hasAttribute('href')) sanitizeAnchor(n);
          sanitizeAnchors(n);
        });
      }
    }
  });

  // Boot
  if (!pageMatches()) return;
  sanitizeAnchors(document);
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  document.addEventListener('click', clickInterceptor, true);
})();
