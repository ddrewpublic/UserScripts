// ==UserScript==
// @name         ChatGPT Bottom Area Resizer (unified target, persistent)
// @namespace    cgpt-tools
// @version      0.8
// @description  Drag up = increase. Resizes #thread-bottom (normal) or #thread-bottom-container (project). Grip stays next to the input.
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  const DEFAULT_PX = 420;
  const MIN_PX = 120;
  const MAX_VH = 80;
  const HANDLE_SIZE = 16;
  const STORE_KEY = 'cgpt_bottom_height_px';
  const GRIP_ID = 'cgpt-bottom-grip';
  const READOUT_ID = 'cgpt-bottom-readout';
  const SELECTOR_COMPOSER = 'form[data-type="unified-composer"]';

  let isDragging = false;

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const getStored = (k, d) => { try { return hasGM ? GM_getValue(k, d) : JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const setStored = (k, v) => { try { hasGM ? GM_setValue(k, v) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const clamp = (px) => Math.max(MIN_PX, Math.min(Math.round(window.innerHeight * (MAX_VH/100)), px));

  function pickResizeTarget() {
    // Normal chats have #thread-bottom; project chats don’t.
    return document.getElementById('thread-bottom') ||
           document.getElementById('thread-bottom-container');
  }

  function applyHeight(px) {
    const tgt = pickResizeTarget();
    if (!tgt) return false;
    // Don’t change display/flex/grid: only force height so flex can’t collapse it.
    tgt.style.boxSizing = 'border-box';
    tgt.style.flex = '0 0 auto';
    tgt.style.height = `${px}px`;
    return true;
  }

  function attachGripOnce() {
    const composer = document.querySelector(SELECTOR_COMPOSER);
    if (!composer) return false;
    if (composer.querySelector('#' + GRIP_ID)) return true;

    // Keep the grip aligned with the input row
    const cs = getComputedStyle(composer);
    if (cs.position === 'static') composer.style.position = 'relative';

    // Styles (tiny, self-contained)
    const style = document.createElement('style');
    style.textContent = `
      #${GRIP_ID}{
        position:absolute;right:6px;bottom:6px;width:${HANDLE_SIZE}px;height:${HANDLE_SIZE}px;
        cursor:nwse-resize;opacity:.65;z-index:10
      }
      #${GRIP_ID}::before,#${GRIP_ID}::after{
        content:"";position:absolute;right:2px;bottom:2px;width:${Math.floor(HANDLE_SIZE*0.9)}px;height:${Math.floor(HANDLE_SIZE*0.9)}px;
        border-bottom:2px solid currentColor;border-right:2px solid currentColor;opacity:.55
      }
      #${GRIP_ID}::after{right:6px;bottom:6px;opacity:.35}
      #${READOUT_ID}{
        position:absolute;right:${HANDLE_SIZE+10}px;bottom:8px;font:11px/1.2 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        color:currentColor;opacity:.55;user-select:none;pointer-events:none;display:none
      }
      #${GRIP_ID}.dragging + #${READOUT_ID}{display:block}
    `;
    document.documentElement.appendChild(style);

    const grip = document.createElement('div');
    grip.id = GRIP_ID;
    const readout = document.createElement('div');
    readout.id = READOUT_ID;

    composer.appendChild(grip);
    composer.appendChild(readout);

    // Initial apply from storage (or default)
    const saved = parseInt(getStored(STORE_KEY, DEFAULT_PX), 10);
    const initial = Number.isFinite(saved) ? saved : DEFAULT_PX;
    applyHeight(initial);
    readout.textContent = `${initial}px`;

    // Drag logic (drag up = increase)
    let startY = 0, startH = initial, raf = 0, pending = null, lastSave = 0;

    const saveThrottled = (px) => {
      const now = performance.now();
      if (now - lastSave > 150) { setStored(STORE_KEY, px); lastSave = now; }
    };
    const flush = () => {
      if (pending == null) return;
      applyHeight(pending);
      readout.textContent = `${pending}px`;
      pending = null; raf = 0;
    };

    function onDown(e) {
      const tgt = pickResizeTarget();
      if (!tgt) return;
      isDragging = true;
      grip.classList.add('dragging');
      startY = e.clientY;
      startH = parseInt(getComputedStyle(tgt).height, 10) || initial;
      e.preventDefault();
    }
    function onMove(e) {
      if (!isDragging) return;
      const dy = startY - e.clientY; // up = increase
      const next = clamp(startH + dy);
      pending = next; saveThrottled(next);
      if (!raf) raf = requestAnimationFrame(flush);
    }
    function onUp() {
      if (!isDragging) return;
      isDragging = false;
      grip.classList.remove('dragging');
      if (raf) { cancelAnimationFrame(raf); flush(); }
      const tgt = pickResizeTarget();
      const h = tgt ? parseInt(getComputedStyle(tgt).height, 10) : initial;
      setStored(STORE_KEY, h);
    }
    function onDbl() {
      isDragging = false;
      applyHeight(DEFAULT_PX);
      readout.textContent = `${DEFAULT_PX}px`;
      setStored(STORE_KEY, DEFAULT_PX);
    }

    grip.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    grip.addEventListener('dblclick', onDbl);

    return true;
  }

  // Reapply on SPA remounts — but don’t fight during drag
  function startObserver() {
    let deb = 0;
    const obs = new MutationObserver(() => {
      if (isDragging) return;
      clearTimeout(deb);
      deb = setTimeout(() => {
        const ok = attachGripOnce();
        const saved = parseInt(getStored(STORE_KEY, DEFAULT_PX), 10);
        if (ok) applyHeight(Number.isFinite(saved) ? saved : DEFAULT_PX);
      }, 120);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // Manual: Alt+R to force reapply
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === 'r') {
        const saved = parseInt(getStored(STORE_KEY, DEFAULT_PX), 10);
        attachGripOnce();
        applyHeight(Number.isFinite(saved) ? saved : DEFAULT_PX);
      }
    });
  }

  // Init (bounded retries for SPA timing), then observer
  (function init() {
    let tries = 0, maxTries = 20;
    const tick = () => {
      tries++;
      const ok = attachGripOnce();
      const saved = parseInt(getStored(STORE_KEY, DEFAULT_PX), 10);
      if (ok) applyHeight(Number.isFinite(saved) ? saved : DEFAULT_PX);
      if (ok || tries >= maxTries) startObserver();
      else setTimeout(tick, 150);
    };
    tick();
  })();
})();
