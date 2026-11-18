// ==UserScript==
// @name         ChatGPT conversation export
// @namespace    local.chatgpt.conversation-export
// @version      0.0.2
// @author       ddrewpublic
// @license      MIT
// @basedupon    https://github.com/arandomhooman/chatgpt-conversation-export
// @description  Export the full current conversation as TXT, with optional reasoning and tool activity.
// @description  Export readable JSON/TXT or a deduplicated GitHub work archive.
// @match        https://chatgpt.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// @updateURL    https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_conversation_compact_export-0.0.1.user.js
// @downloadURL  https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_conversation_compact_export-0.0.1.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.1.0';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const valueID = value => value == null || value === '' ? null : String(value);

  function unwrap(payload) {
    for (const candidate of [payload, payload?.conversation, payload?.data?.conversation, payload?.data]) {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) &&
          (candidate.mapping || Array.isArray(candidate.messages) || Array.isArray(candidate.items))) return candidate;
    }
    return payload;
  }

  function pageInfo(payload) {
    const p = payload.page_info || payload.pagination || {};
    return {
      previous: p.has_previous_page === true || payload.has_previous_page === true,
      next: p.has_next_page === true || payload.has_next_page === true || p.has_more === true || payload.has_more === true ||
        valueID(p.next_cursor ?? payload.next_cursor) !== null,
      before: p.start_cursor ?? p.previous_cursor ?? payload.previous_cursor,
      after: p.end_cursor ?? p.next_cursor ?? payload.next_cursor,
      partial: payload.partial === true || payload.is_partial === true || payload.truncated === true ||
        payload.is_truncated === true || payload.is_complete === false || payload.has_more_messages === true || p.has_more_messages === true ||
        Boolean(payload.next_page || payload.next_token || p.next_page || p.next_token)
    };
  }

  function records(payload) {
    if (payload.mapping && !Array.isArray(payload.mapping)) {
      return Object.entries(payload.mapping).map(([id, node]) => ({
        id, parent: valueID(node?.parent), linked: own(node || {}, 'parent'), message: node?.message ?? null
      }));
    }
    const list = payload.messages ?? payload.items;
    if (!Array.isArray(list)) throw new Error('ChatGPT returned an unrecognized message format. No file was exported.');
    return list.map(item => {
      const wrapped = own(item, 'message');
      const message = wrapped ? item.message : item;
      const id = valueID(item.id ?? message?.id);
      if (!id) throw new Error('A history message has no ID. No file was exported.');
      const parentKeys = ['parent', 'parent_id', 'parent_message_id'];
      const owner = parentKeys.some(k => own(item, k)) ? item : message || {};
      const key = parentKeys.find(k => own(owner, k));
      return { id, message, parent: key ? valueID(owner[key]) : null, linked: Boolean(key) };
    });
  }

  function assertID(payload, expected) {
    const returned = valueID(payload.conversation_id ?? (payload.mapping || payload.current_node ? payload.id : null));
    if (returned && returned !== expected) throw new Error('ChatGPT returned a different conversation. No file was exported.');
  }

  async function loadHistory(basePayload, expectedID, fetchPage, progress = () => {}) {
    const base = unwrap(basePayload);
    assertID(base, expectedID);
    const groups = [records(base)];
    const flags = pageInfo(base);
    let pageCount = 1;
    for (const direction of ['before', 'after']) {
      let info = flags;
      const seen = new Set();
      while (direction === 'before' ? info.previous : info.next) {
        const cursor = valueID(info[direction]);
        if (!cursor) throw new Error('ChatGPT says more history exists but supplied no cursor. No partial file was exported.');
        if (seen.has(cursor)) throw new Error('ChatGPT repeated a history cursor. No partial file was exported.');
        if (pageCount >= 2000) throw new Error('History exceeded 2,000 pages. No partial file was exported.');
        seen.add(cursor);
        progress(`Loading history, page ${pageCount + 1}…`);
        const page = unwrap(await fetchPage(direction, cursor));
        assertID(page, expectedID);
        const group = records(page);
        if (!group.length) throw new Error('An expected history page was empty. No partial file was exported.');
        if (direction === 'before') groups.unshift(group); else groups.push(group);
        pageCount++;
        info = pageInfo(page);
        if (info.partial) throw new Error('ChatGPT marked a history page as truncated. No partial file was exported.');
        const p = page.page_info || page.pagination;
        const hasEndFlag = direction === 'before'
          ? own(p || {}, 'has_previous_page') || own(page, 'has_previous_page')
          : own(p || {}, 'has_next_page') || own(p || {}, 'has_more') || own(page, 'has_next_page') || own(page, 'has_more');
        if (!hasEndFlag) throw new Error('A history page did not report whether more pages exist. No partial file was exported.');
      }
    }
    if (flags.partial) throw new Error('ChatGPT marked this conversation as truncated. No partial file was exported.');

    const byID = new Map();
    // The initial, freshest page takes precedence over overlapping older pages.
    for (const group of groups) for (const record of group) if (!byID.has(record.id)) byID.set(record.id, record);
    for (const record of records(base)) byID.set(record.id, record);
    const current = valueID(base.current_node ?? base.current_node_id);
    if (!current || !byID.has(current)) throw new Error('The active conversation endpoint is missing. Reload this chat and try again.');
    let selected;
    const warnings = [];
    if (base.mapping || [...byID.values()].some(record => record.parent !== null)) {
      selected = [];
      const seen = new Set();
      let id = current;
      while (id) {
        if (seen.has(id)) throw new Error('The conversation contains a parent cycle. No file was exported.');
        seen.add(id);
        const record = byID.get(id);
        if (!record) throw new Error('An older message is missing from the conversation tree. No partial file was exported.');
        if (!record.linked) throw new Error('A message is missing its parent link. No partial file was exported.');
        selected.push(record);
        id = record.parent;
      }
      selected.reverse();
    } else {
      const pagination = base.page_info || base.pagination || {};
      if (!own(pagination, 'has_previous_page') && !own(base, 'has_previous_page')) {
        throw new Error('ChatGPT did not report whether earlier messages exist in its flat list. No partial file was exported.');
      }
      selected = [...byID.values()];
      const end = selected.findIndex(record => record.id === current);
      selected = selected.slice(0, end + 1);
      warnings.push('ChatGPT returned a flat active-message list without parent links. Branch separation cannot be independently verified.');
    }
    const leaf = byID.get(current)?.message;
    if (leaf && ['in_progress', 'streaming', 'pending'].includes(leaf.status)) {
      throw new Error('This response is still being generated. Wait until it finishes, then export again.');
    }
    return { base, selected, pageCount, current, warnings, totalNodes: byID.size };
  }

  const activityTypes = /^(thoughts?|reasoning(?:_recap|_summary)?|analysis|tool_call|tool_result|function_call|execution_output|code)$/i;
  function activity(message) {
    const role = message.author?.role ?? message.role;
    const channel = message.channel ?? message.metadata?.channel;
    const recipient = message.recipient;
    return role === 'tool' || activityTypes.test(message.content?.content_type || '') ||
      (role === 'assistant' && (['analysis', 'commentary', 'justify', 'confidence'].includes(channel) ||
        (recipient && !['all', 'assistant', 'user'].includes(recipient))));
  }

  function cleanContent(value, includeActivity) {
    if (includeActivity || value == null || typeof value !== 'object') return value;
    if (activityTypes.test(value.content_type || value.type || '')) return undefined;
    if (Array.isArray(value)) return value.map(item => cleanContent(item, false)).filter(item => item !== undefined);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(reasoning|reasoning_recap|reasoning_summary|thoughts|analysis|tool_calls|tool_results|function_call)$/.test(key)) continue;
      const cleaned = cleanContent(item, false);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }

  function exportData(history, id, title, includeActivity, sourceURL) {
    const messages = [];
    for (const record of history.selected) {
      const message = record.message;
      if (!message) continue;
      const role = message.author?.role ?? message.role;
      if (!['user', 'assistant', 'tool'].includes(role)) continue;
      const extra = activity(message);
      if (extra && !includeActivity) continue;
      if (message.metadata?.is_visually_hidden_from_conversation && !extra) continue;
      const content = cleanContent(message.content ?? { content_type: 'text', parts: [message.text ?? ''] }, includeActivity);
      if (!content) continue;
      const output = {
        id: message.id ?? record.id, node_id: record.id, role,
        kind: extra ? (role === 'tool' || ['code', 'execution_output', 'tool_call', 'tool_result', 'function_call'].includes(message.content?.content_type) || message.recipient && message.recipient !== 'all' ? 'tool' : 'reasoning') : 'message',
        author_name: message.author?.name ?? null, recipient: message.recipient ?? null,
        channel: message.channel ?? message.metadata?.channel ?? null,
        create_time: message.create_time ?? null, update_time: message.update_time ?? null, content
      };
      if (message.metadata?.content_references) output.content_references = message.metadata.content_references;
      if (message.metadata?.citations) output.citations = message.metadata.citations;
      if (message.metadata?.attachments) output.attachments = message.metadata.attachments;
      messages.push(output);
    }
    if (!messages.length) throw new Error('No exportable messages were found in this conversation.');
    return {
      schema: 'chatgpt-conversation-export/v1', exporter_version: VERSION,
      conversation_id: id, title: history.base.title || title || 'ChatGPT conversation',
      source_url: sourceURL, exported_at: new Date().toISOString(),
      include_reasoning_and_tools: includeActivity,
      scope: 'active conversation branch', current_node: history.current,
      history: { pages_fetched: history.pageCount, active_path_nodes: history.selected.length,
        total_nodes_fetched: history.totalNodes, completeness_check: 'passed', warnings: history.warnings },
      messages
    };
  }


  // Compact work archive: preserve visible messages and distinct file versions,
  // but exclude repeated GitHub reads, previews, execution wrappers, and reasoning.
  const WORK_ACTIONS = new Set([
    'create_file', 'update_file', 'delete_file', 'create_branch',
    'create_pull_request', 'update_pull_request', 'create_tree',
    'create_commit', 'update_ref'
  ]);
  const encoder = new TextEncoder();

  async function digest(text) {
    const data = encoder.encode(text);
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function unpackToolMessage(message) {
    const c = message?.content;
    if (c?.content_type !== 'code' || typeof c.text !== 'string') return null;
    try {
      const parsed = JSON.parse(c.text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }

  function fileLocation(file) {
    // GitHub display_url is metadata, not a guarantee of a known branch/path.
    const url = file?.display_url;
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'github.com') return null;
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 5 || segments[2] !== 'blob') return null;
      // The ref may contain slashes. When the repository path is unknown,
      // retain the full suffix rather than asserting an incorrect path.
      const suffix = segments.slice(3);
      // File paths in manuscript repositories have a stable source_material root.
      // Keep it when present even if the branch name contains slashes.
      const anchor = suffix.indexOf('source_material');
      const path = anchor >= 0 ? suffix.slice(anchor).join('/') :
        ['main', 'master'].includes(suffix[0]) ? suffix.slice(1).join('/') : suffix.join('/');
      return { repo: `${segments[0]}/${segments[1]}`, source_path: path };
    } catch { return null; }
  }

  function workMessages(data) {
    // Full original content, role, order and timestamps remain unchanged.
    return data.messages.filter(m => m.kind === 'message' &&
      (m.role === 'user' || m.role === 'assistant')).map(m => {
      const copy = {};
      for (const k of ['role', 'kind', 'create_time', 'content']) {
        if (Object.prototype.hasOwnProperty.call(m, k)) copy[k] = m[k];
      }
      return copy;
    });
  }

  function compactConversation(data) {
    return {
      format: 'chatgpt-readable-conversation/v1',
      conversation_id: data.conversation_id, title: data.title,
      source_url: data.source_url, exported_at: data.exported_at,
      messages: workMessages(data)
    };
  }

  function transcript(data) {
    const lines = [data.title || 'ChatGPT conversation', '='.repeat(50), ''];
    for (const [index, message] of workMessages(data).entries()) {
      const parts = message.content?.parts || [];
      const body = parts.map(part => typeof part === 'string' ? part : JSON.stringify(part)).join('\n');
      lines.push(`[${index + 1}] ${message.role.toUpperCase()}`, body, '');
    }
    return lines.join('\n');
  }

  async function compactWorkArchive(data, progress = () => {}, signal = null) {
    const versions = new Map();
    const requests = [], results = [], prs = new Map(), patches = new Map();
    const statistics = { reads: 0, writes: 0, tool_records_skipped: 0 };
    const fileIdentity = async (repo, path, body, origin, sha = null, url = null) => {
      if (typeof body !== 'string' || typeof path !== 'string') return null;
      const hash = await digest(body);
      const key = JSON.stringify([repo || 'unknown', path, hash]);
      let version = versions.get(key);
      if (!version) {
        const pathHash = await digest(`${repo || 'unknown'}|${path}`);
        version = {
          id: `file-${hash.slice(0, 16)}-${pathHash.slice(0, 8)}`,
          repository: repo || 'unknown', path, sha256: hash,
          content: body, git_blob_sha: sha || null, source_url: url || null, origins: [origin]
        };
        versions.set(key, version);
      } else {
        if (!version.origins.includes(origin)) version.origins.push(origin);
        if (!version.git_blob_sha && sha) version.git_blob_sha = sha;
      }
      return version.id;
    };

    const addPr = pr => {
      if (!pr || typeof pr !== 'object' || pr.number == null) return;
      const summary = {};
      for (const k of ['number', 'title', 'url', 'html_url', 'state', 'merged',
                       'merge_commit_sha', 'created_at', 'updated_at', 'closed_at', 'merged_at']) {
        if (pr[k] != null && typeof pr[k] !== 'object') summary[k] = pr[k];
      }
      const previous = prs.get(String(pr.number));
      if (!previous || String(summary.updated_at || '') >= String(previous.updated_at || '')) {
        prs.set(String(pr.number), summary);
      }
    };
    const savePatch = async item => {
      if (typeof item?.patch !== 'string') return;
      const hash = await digest(item.patch);
      const id = `patch-${hash.slice(0, 20)}`;
      if (!patches.has(id)) patches.set(id, { id, filename: item.filename || null, patch: item.patch });
    };

    for (let i = 0; i < data.messages.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const message = data.messages[i];
      const parsed = unpackToolMessage(message);
      if (!parsed) {
        if (message.kind !== 'message') statistics.tool_records_skipped++;
        continue;
      }
      const time = message.create_time ?? null;
      if (message.role === 'assistant' && parsed.path?.startsWith('/GitHub/')) {
        const action = parsed.path.split('/').at(-1);
        if (!WORK_ACTIONS.has(action)) continue;
        const args = parsed.args;
        if (!args || typeof args !== 'object' || Array.isArray(args)) continue;
        const compactArgs = { ...args };
        delete compactArgs.link_id;
        const body = compactArgs.content;
        delete compactArgs.content;
        if (typeof body === 'string' && ['create_file', 'update_file'].includes(action)) {
          compactArgs.file_version_id = await fileIdentity(
            compactArgs.repository_full_name, compactArgs.path, body, 'write_request'
          );
          statistics.writes++;
        }
        // Preserve the action and concise arguments, not huge duplicated payloads.
        for (const [key, value] of Object.entries(compactArgs)) {
          const serialized = JSON.stringify(value);
          if (serialized && encoder.encode(serialized).byteLength > 4096) {
            compactArgs[key] = { sha256: await digest(serialized),
              original_utf8_bytes: encoder.encode(serialized).byteLength,
              summary: 'bulk argument omitted from compact worklog' };
          }
        }
        requests.push({ index: i, time, operation: action, args: compactArgs });
      } else if (message.role === 'tool') {
        const action = parsed.action_name;
        const response = parsed.result;
        if (action === 'fetch_file' && response && typeof response.content === 'string') {
          const location = fileLocation(response);
          // Preserve all readable file bodies, even when their path cannot be resolved.
          const repo = location?.repo || 'unknown';
          const path = location?.source_path || response.display_title || `unknown-file-${i}`;
          await fileIdentity(repo, path, response.content, 'fetch_file', response.sha, response.display_url);
          statistics.reads++;
        } else if (WORK_ACTIONS.has(action)) {
          const compactResult = {};
          if (response && typeof response === 'object') {
            for (const key of ['commit_sha', 'content_sha', 'sha', 'url', 'branch',
                               'ref', 'tree', 'merged', 'number', 'state', 'title',
                               'merge_commit_sha', 'head', 'base']) {
              if (response[key] != null && typeof response[key] !== 'object') {
                compactResult[key] = response[key];
              }
            }
            if (response.pull_request) {
              addPr(response.pull_request);
              compactResult.pull_request = Object.fromEntries(
                ['number', 'title', 'url', 'state', 'merged', 'merge_commit_sha']
                  .filter(k => response.pull_request[k] != null)
                  .map(k => [k, response.pull_request[k]])
              );
            }
          }
          results.push({ index: i, time, operation: action,
            result: compactResult, error: parsed.error || null });
        } else if (action === 'fetch_pr_patch' && Array.isArray(response?.patches)) {
          for (const patch of response.patches) await savePatch(patch);
        } else if (action === 'fetch_pr') {
          addPr(response?.pull_request);
          if (typeof parsed.diff === 'string') await savePatch({patch: parsed.diff});
        }
        // Expanded GitHub PR lists may arrive in a wrapper with title 'pulls'.
        if (parsed.title === 'pulls' && typeof parsed.content === 'string') {
          try {
            const items = JSON.parse(parsed.content);
            if (Array.isArray(items)) for (const item of items) addPr(item);
          } catch { }
        }
      }
      if (i > 0 && i % 400 === 0) {
        progress(`Compacting work archive: ${i.toLocaleString()} / ${data.messages.length.toLocaleString()} records…`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    const meta = {
      format: 'chatgpt-compact-work-archive/v1',
      conversation_id: data.conversation_id, title: data.title,
      source_url: data.source_url, exported_at: data.exported_at,
      note: 'Editorial work archive, not a lossless ChatGPT export. Read-only GitHub tool traffic, redundant previews, reasoning and internal API metadata are omitted.',
      messages: workMessages(data), file_versions: [...versions.values()],
      github_requests: requests, github_results: results,
      pull_requests: [...prs.values()].sort((a, b) => String(a.number).localeCompare(String(b.number))),
      unique_patches: [...patches.values()]
    };
    meta.compaction = { original_message_records: data.messages.length,
      retained_conversation_messages: meta.messages.length,
      unique_file_versions: versions.size,
      github_write_requests: requests.length,
      github_write_results: results.length,
      unique_patches: patches.size,
      source_file_reads: statistics.reads,
      source_write_bodies: statistics.writes };
    return meta;
  }

  function safeURL(raw) {
    try {
      const url = new URL(raw, 'https://chatgpt.com/');
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? escapeHTML(url.href) : null;
    } catch { return null; }
  }

  function inline(text, depth = 0) {
    if (depth > 6) return escapeHTML(text);
    const pattern = /(`+)([^\n]*?)\1|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+)\*|~~([^\n]+?)~~/g;
    let out = '', offset = 0, match;
    while ((match = pattern.exec(text))) {
      out += escapeHTML(text.slice(offset, match.index));
      if (match[1]) out += `<code>${escapeHTML(match[2])}</code>`;
      else if (match[3]) {
        const href = safeURL(match[4]);
        out += href ? `<a href="${href}" rel="noreferrer noopener">${inline(match[3], depth + 1)}</a>` : escapeHTML(match[0]);
      } else if (match[5] || match[6]) out += `<strong>${inline(match[5] || match[6], depth + 1)}</strong>`;
      else if (match[7]) out += `<em>${inline(match[7], depth + 1)}</em>`;
      else out += `<del>${inline(match[8], depth + 1)}</del>`;
      offset = pattern.lastIndex;
    }
    return out + escapeHTML(text.slice(offset));
  }

  function markdown(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const fence = /^\s{0,3}(`{3,}|~{3,})([^`]*)$/.exec(line);
      if (fence) {
        const code = [], closing = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
        i++;
        while (i < lines.length && !closing.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        out.push(`<div class="code-label">${escapeHTML(fence[2].trim() || 'Code')}</div><pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) { out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (i + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        const header = cells(line).map(cell => `<th>${inline(cell)}</th>`).join('');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(`<tr>${cells(lines[i++]).map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`);
        out.push(`<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*> ?/, ''));
        out.push(`<blockquote>${quote.map(part => inline(part)).join('<br>')}</blockquote>`);
        continue;
      }
      const list = /^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/.exec(line);
      if (list) {
        const ordered = /^\d/.test(list[1]), items = [];
        while (i < lines.length) {
          const item = /^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/.exec(lines[i]);
          if (!item || /^\d/.test(item[1]) !== ordered) break;
          items.push(`<li>${inline(item[2])}</li>`); i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.join('')}</${tag}>`); continue;
      }
      const paragraph = [line]; i++;
      while (i < lines.length && lines[i].trim() && !/^\s{0,3}(?:#{1,6}\s|`{3,}|~{3,}|>|[-+*]\s|\d+[.)]\s)/.test(lines[i])) {
        if (i + 1 < lines.length && lines[i].includes('|') && lines[i + 1].includes('---')) break;
        paragraph.push(lines[i++]);
      }
      out.push(`<p>${paragraph.map(part => inline(part)).join('<br>')}</p>`);
    }
    return out.join('\n');
  }

  function contentHTML(content) {
    if (typeof content === 'string') return markdown(content);
    if (!content || typeof content !== 'object') return '';
    const parts = content.parts ?? (typeof content.text === 'string' ? [content.text] : null);
    if (Array.isArray(parts)) return parts.map(part => {
      if (typeof part === 'string') return content.content_type === 'code'
        ? `<pre><code>${escapeHTML(part)}</code></pre>` : markdown(part);
      if (typeof part?.text === 'string') return markdown(part.text);
      return `<details class="asset"><summary>${escapeHTML(part?.content_type || part?.type || 'Attachment / structured content')}</summary><pre>${escapeHTML(JSON.stringify(part, null, 2))}</pre></details>`;
    }).join('\n');
    if (Array.isArray(content.thoughts)) return content.thoughts.map(thought =>
      `<section>${thought.summary ? `<h4>${escapeHTML(thought.summary)}</h4>` : ''}${markdown(thought.content ?? thought.text ?? JSON.stringify(thought))}</section>`).join('\n');
    if (typeof content.result === 'string') return `<pre>${escapeHTML(content.result)}</pre>`;
    return `<pre>${escapeHTML(JSON.stringify(content, null, 2))}</pre>`;
  }

  function htmlDocument(data) {
    const articles = data.messages.map((message, index) => {
      const label = message.role === 'user' ? 'You' : message.kind === 'tool' ? `Tool · ${message.author_name || message.recipient || 'activity'}` : message.kind === 'reasoning' ? 'Reasoning / commentary' : 'ChatGPT';
      const references = message.content_references || message.citations;
      const sources = references ? `<details class="asset"><summary>Source references</summary><pre>${escapeHTML(JSON.stringify(references, null, 2))}</pre></details>` : '';
      const attachments = message.attachments ? `<details class="asset"><summary>Attachment references</summary><pre>${escapeHTML(JSON.stringify(message.attachments, null, 2))}</pre></details>` : '';
      const body = `${contentHTML(message.content)}${sources}${attachments}`;
      return message.kind !== 'message'
        ? `<details class="message activity" id="message-${index + 1}"><summary>${escapeHTML(label)}</summary><div class="body">${body}</div></details>`
        : `<article class="message ${escapeHTML(message.role)}" id="message-${index + 1}"><div class="byline">${escapeHTML(label)}</div><div class="body">${body}</div></article>`;
    }).join('\n');
    const warnings = data.history.warnings.length ? `<p class="note">${escapeHTML(data.history.warnings.join(' '))}</p>` : '';
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>${escapeHTML(data.title)}</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#202123;--muted:#686b70;--surface:#f5f5f5;--border:#e4e4e7;--link:#176bc0}
@media(prefers-color-scheme:dark){:root{--bg:#212121;--fg:#ececec;--muted:#b4b4b4;--surface:#2f2f2f;--border:#424242;--link:#8ab4f8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:900px;padding:42px 24px 80px;margin:auto}header{margin-bottom:36px;border-bottom:1px solid var(--border);padding-bottom:24px}h1{font-size:28px;line-height:1.3;overflow-wrap:anywhere}header p,.note{font-size:13px;color:var(--muted)}a{color:var(--link);overflow-wrap:anywhere}a:hover{text-decoration:underline}
.message{margin:0 0 28px}.user{background:var(--surface);padding:20px 24px;border-radius:20px;margin-left:8%}.byline{font-weight:650;font-size:13px;color:var(--muted);margin-bottom:10px}.body{overflow-wrap:anywhere;min-width:0}.body>:first-child{margin-top:0}.body>:last-child{margin-bottom:0}
.activity{border:1px solid var(--border);border-radius:14px;padding:14px 18px}.activity>summary{cursor:pointer;font-size:14px;color:var(--muted);font-weight:600}.activity .body{padding-top:16px}.asset{margin:16px 0;font-size:13px}.asset summary{cursor:pointer;color:var(--muted)}
pre{background:var(--surface);border:1px solid var(--border);padding:16px;border-radius:10px;overflow:auto;white-space:pre;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}p code,li code,td code{background:var(--surface);padding:2px 5px;border-radius:4px}pre code{font-size:inherit}.code-label{font-size:12px;color:var(--muted);margin:20px 0 -10px 12px}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:18px 0}th,td{border:1px solid var(--border);padding:9px 12px;text-align:left}th{background:var(--surface)}blockquote{border-left:3px solid var(--border);padding-left:18px;margin-left:0;color:var(--muted)}hr{border:0;border-top:1px solid var(--border);margin:24px 0}h2,h3,h4{line-height:1.4;margin-top:24px}
@media(max-width:600px){main{padding:24px 16px 48px}.user{margin-left:0;padding:16px}h1{font-size:24px}}
@media print{body{font-size:11pt}main{max-width:none;padding:0}.message{break-inside:auto}.activity .body{display:block}.activity{break-inside:auto}pre{white-space:pre-wrap}a{color:inherit}}
</style></head><body><main><header><h1>${escapeHTML(data.title)}</h1>
<p>${data.messages.length} messages · ${data.history.pages_fetched} history pages · ${data.include_reasoning_and_tools ? 'Includes available reasoning and tool activity' : 'Conversation messages only'}</p>
<p><a href="${safeURL(data.source_url) || '#'}">Original conversation</a> · Exported ${escapeHTML(data.exported_at)}</p>${warnings}
<p>Attachments are preserved as references. Image, audio, and file binaries are not embedded. Markdown math and citation markers remain as source text.</p>
</header>${articles}</main></body></html>`;
  }

  function filename(title, id, extension) {
    let name = String(title || 'ChatGPT conversation').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 100);
    if (!name) name = 'ChatGPT conversation';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    return `${name} - ${String(id).slice(0, 8)}.${extension}`;
  }

  const core = { loadHistory, exportData, htmlDocument, filename, markdown, records, pageInfo, compactConversation, compactWorkArchive, transcript };
  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined') module.exports = core;
    return;
  }
  if (window.__localChatGPTExportVersion === VERSION) return;
  window.__localChatGPTExportInstalled = true;
  window.__localChatGPTExportVersion = VERSION;

  const originalFetch = window.fetch.bind(window);
  const contextHeaders = new Map();
  const endpointHints = new Map();
  let host, slot, root, trigger, panel, status, checkbox, cancelButton, job;
  let lastID = '', scheduled = false;
  const settingsKey = 'local-chatgpt-export-settings-v1';

  function conversationID() {
    return location.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1] || null;
  }

  function endpoint(input) {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
      const match = /^\/backend-api\/(conversations?)\/([a-zA-Z0-9_-]+)(?:\/messages)?$/.exec(url.pathname);
      return url.origin === location.origin && match ? { id: match[2], plural: match[1] } : null;
    } catch { return null; }
  }

  function rememberHeaders(id, input, init) {
    const allowed = ['authorization', 'chatgpt-account-id', 'openai-organization', 'openai-project', 'oai-device-id'];
    try {
      const requestHeaders = new Headers(input?.headers);
      if (init?.headers) new Headers(init.headers).forEach((value, name) => requestHeaders.set(name, value));
      const saved = contextHeaders.get(id) || {};
      for (const key of allowed) if (requestHeaders.has(key)) saved[key] = requestHeaders.get(key);
      contextHeaders.delete(id); contextHeaders.set(id, saved);
      while (contextHeaders.size > 4) contextHeaders.delete(contextHeaders.keys().next().value);
    } catch { /* Observing requests must never interrupt ChatGPT. */ }
  }

  // Observe only conversation request headers; preserve the original fetch result.
  window.fetch = function (input, init) {
    const info = endpoint(input);
    if (info) {
      rememberHeaders(info.id, input, init);
      endpointHints.delete(info.id); endpointHints.set(info.id, info.plural);
      while (endpointHints.size > 4) endpointHints.delete(endpointHints.keys().next().value);
    }
    return originalFetch(input, init);
  };

  if (window.XMLHttpRequest) {
    const open = XMLHttpRequest.prototype.open, setHeader = XMLHttpRequest.prototype.setRequestHeader;
    const requests = new WeakMap();
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      requests.set(this, { info: endpoint(url), headers: {} });
      return open.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      const request = requests.get(this);
      if (request?.info && ['authorization', 'chatgpt-account-id', 'openai-organization', 'openai-project', 'oai-device-id'].includes(String(name).toLowerCase())) {
        request.headers[name] = value;
        rememberHeaders(request.info.id, null, { headers: request.headers });
        endpointHints.set(request.info.id, request.info.plural);
      }
      return setHeader.call(this, name, value);
    };
  }

  async function requestJSON(path, headers, signal) {
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 45000);
    try {
      const response = await originalFetch(path, { credentials: 'include', headers, signal: timeout.signal, cache: 'no-store' });
      if (!response.ok) {
        const error = new Error(response.status === 401 ? 'Your ChatGPT session expired. Reload and sign in again.' :
          response.status === 403 ? 'ChatGPT refused the history request. Reload this chat and try again.' :
          response.status === 429 ? 'ChatGPT rate-limited history requests. Wait a little, then try again.' : `History request failed with HTTP ${response.status}.`);
        error.httpStatus = response.status; throw error;
      }
      try { return await response.json(); }
      catch { if (signal.aborted || timeout.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        throw new Error('ChatGPT returned a non-JSON history response. Reload the page and try again.'); }
    } catch (error) {
      if (timeout.signal.aborted && !signal.aborted) throw new Error('The history request timed out after 45 seconds. Try again.');
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }

  async function readConversation(id, signal) {
    const headers = { Accept: 'application/json', ...(contextHeaders.get(id) || {}) };
    let refreshed = false;
    async function refreshSession() {
      refreshed = true;
      const session = await requestJSON('/api/auth/session', { Accept: 'application/json' }, signal);
      const token = session.accessToken ?? session.access_token;
      if (typeof token === 'string' && token) headers.authorization = `Bearer ${token}`;
    }
    if (!headers.authorization) await refreshSession();
    async function get(path) {
      try { return await requestJSON(path, headers, signal); }
      catch (error) {
        if (error.httpStatus === 401 && !refreshed) { await refreshSession(); return requestJSON(path, headers, signal); }
        throw error;
      }
    }
    const preferred = endpointHints.get(id) || 'conversation';
    const paths = [preferred, preferred === 'conversation' ? 'conversations' : 'conversation'];
    let base;
    for (const kind of paths) {
      const path = `/backend-api/${kind}/${encodeURIComponent(id)}`;
      try { base = unwrap(await get(path)); break; }
      catch (error) { if (![404, 405].includes(error.httpStatus)) throw error; }
    }
    if (!base) throw new Error('ChatGPT history endpoints were not available. Its web format may have changed.');
    if (!base.mapping && !Array.isArray(base.messages) && !Array.isArray(base.items)) {
      const first = unwrap(await get(`/backend-api/conversations/${encodeURIComponent(id)}/messages?include_has_versions=true&num_turns=25`));
      base = { ...base, ...first, current_node: first.current_node ?? base.current_node ?? base.current_node_id };
    }
    return loadHistory(base, id, (direction, cursor) => get(
      `/backend-api/conversations/${encodeURIComponent(id)}/messages?${direction}=${encodeURIComponent(cursor)}&include_has_versions=true&num_turns=25`
    ), text => { status.textContent = text; });
  }

  function download(text, type, name) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function setBusy(busy) {
    root.querySelectorAll('[data-format]').forEach(button => { button.disabled = busy; });
    checkbox.disabled = busy; cancelButton.hidden = !busy;
    trigger.setAttribute('aria-busy', String(busy));
  }

  async function runExport(format) {
    if (job) return;
    const id = conversationID();
    if (!id) { status.textContent = 'Open a saved conversation first. Temporary and shared chats are not supported.'; return; }
    if (document.querySelector('[data-testid="stop-button"],button[aria-label="Stop generating"]')) {
      status.textContent = 'Wait for the current response to finish, then export.'; return;
    }
    const controller = new AbortController(); job = controller;
    setBusy(true); status.textContent = 'Loading the full conversation…';
    try {
      const history = await readConversation(id, controller.signal);
      if (controller.signal.aborted || conversationID() !== id) throw new DOMException('Aborted', 'AbortError');
      const data = exportData(history, id, document.title.replace(/\s*[-|]\s*ChatGPT$/, ''), (format === 'work' || checkbox.checked), `${location.origin}${location.pathname}`);
      status.textContent = `Preparing ${data.messages.length.toLocaleString()} messages…`;
      // Let the progress text paint before formatting a large conversation.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (controller.signal.aborted || conversationID() !== id) throw new DOMException('Aborted', 'AbortError');
      let output, mime, extension;
      if (format === 'work') {
        output = JSON.stringify(await compactWorkArchive(data, text => { status.textContent = text; }, controller.signal), null, 2);
        mime = 'application/json;charset=utf-8'; extension = 'work-archive.json';
      } else if (format === 'clean') {
        output = JSON.stringify(compactConversation(data), null, 2);
        mime = 'application/json;charset=utf-8'; extension = 'readable.json';
      } else if (format === 'txt') {
        output = transcript(data);
        mime = 'text/plain;charset=utf-8'; extension = 'readable.txt';
      } else if (format === 'json') {
        output = JSON.stringify(data, null, 2);
        mime = 'application/json;charset=utf-8'; extension = 'json';
      } else {
        output = htmlDocument(data);
        mime = 'text/html;charset=utf-8'; extension = 'html';
      }
      if (controller.signal.aborted || conversationID() !== id) throw new DOMException('Aborted', 'AbortError');
      download(output, mime, filename(data.title, id, extension));
      status.textContent = `Downloaded ${data.messages.length.toLocaleString()} messages from ${history.pageCount} history ${history.pageCount === 1 ? 'page' : 'pages'}.${history.warnings.length ? ' See the branch note in the file.' : ''}`;
    } catch (error) {
      status.textContent = error.name === 'AbortError' ? 'Export cancelled.' : error.message || 'Export failed. Reload this chat and try again.';
    } finally {
      if (job === controller) {
        job = null; setBusy(false);
        if (!panel.hidden) root.querySelector(`[data-format="${format}"]`).focus();
      }
    }
  }

  function closePanel(returnFocus = false) {
    panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  }

  function positionPanel() {
    if (!panel || panel.hidden) return;
    const rect = trigger.getBoundingClientRect();
    panel.style.width = `${Math.min(320, innerWidth - 24)}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 12))}px`;
    panel.style.top = `${Math.min(rect.bottom + 8, Math.max(12, innerHeight - panel.offsetHeight - 12))}px`;
  }

  function createUI() {
    host = document.createElement('div'); host.id = 'local-chatgpt-export';
    host.style.cssText = 'display:inline-flex;align-items:center;position:fixed;z-index:2147483000;pointer-events:auto;';
    slot = document.createElement('span'); slot.id = 'local-chatgpt-export-slot';
    slot.setAttribute('aria-hidden', 'true');
    slot.style.cssText = 'display:block;flex:0 0 auto;height:36px;pointer-events:none;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
:host{font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text-primary,#202123);color-scheme:light dark}
*{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit;cursor:pointer;color:inherit}button:disabled{opacity:.5;cursor:wait}
.trigger{display:flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid var(--border-light,rgba(127,127,127,.24));border-radius:999px;background:transparent;white-space:nowrap;height:36px}.trigger:hover{background:var(--main-surface-secondary,rgba(127,127,127,.12))}svg{width:16px;height:16px;flex:none}
.panel{position:fixed;z-index:2147483647;background:var(--main-surface-primary,#fff);border:1px solid var(--border-light,#dedede);border-radius:16px;box-shadow:0 10px 35px #0002;padding:8px;max-height:calc(100vh - 24px);overflow:auto;color:var(--text-primary,#202123)}
.title{font-size:13px;font-weight:600;padding:9px 10px 8px}.option{display:flex;align-items:center;width:100%;gap:12px;border:0;background:none;border-radius:9px;padding:11px 10px;text-align:left}.option:hover{background:var(--main-surface-secondary,#f4f4f4)}.option span{display:block}.subtitle{display:block;font-size:12px;color:var(--text-secondary,#666);margin-top:2px}.divider{height:1px;background:var(--border-light,#e7e7e7);margin:7px 4px}
.toggle{display:flex;gap:12px;align-items:center;padding:10px;cursor:pointer}.toggle input{appearance:none;width:32px;min-width:32px;height:19px;border:1px solid #a0a0a0;border-radius:20px;position:relative;margin:0;background:#909090}.toggle input:before{content:"";position:absolute;width:13px;height:13px;border-radius:50%;background:white;top:2px;left:2px;transition:transform .12s}.toggle input:checked{background:var(--text-primary,#202123);border-color:var(--text-primary,#202123)}.toggle input:checked:before{transform:translateX(13px);background:var(--main-surface-primary,#fff)}
.status{padding:9px 10px;font-size:12px;color:var(--text-secondary,#666);overflow-wrap:anywhere;min-height:36px}.cancel{border:0;background:none;color:inherit;text-decoration:underline;padding:5px 10px 10px;font-size:12px}button:focus-visible,input:focus-visible{outline:2px solid #4a90e2;outline-offset:2px}
@media(prefers-color-scheme:dark){:host{color:var(--text-primary,#ececec)}.panel{background:var(--main-surface-primary,#2f2f2f);border-color:var(--border-light,#494949);color:var(--text-primary,#ececec)}.option:hover{background:var(--main-surface-secondary,#3b3b3b)}.subtitle,.status{color:var(--text-secondary,#b4b4b4)}.divider{background:var(--border-light,#494949)}.toggle input:checked{background:var(--text-primary,#ececec);border-color:var(--text-primary,#ececec)}.toggle input:checked:before{background:var(--main-surface-primary,#333)}}
@media(max-width:520px){.trigger{padding:8px}.trigger .label{display:none}}
</style>
<button class="trigger" aria-label="Export conversation" aria-haspopup="dialog" aria-expanded="false" aria-controls="export-panel" title="Export conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M5 15v5h14v-5"/></svg><span class="label">Export</span></button>
<section class="panel" id="export-panel" role="dialog" aria-label="Export conversation" hidden>
<div class="title">Download conversation</div>
<button class="option" data-format="html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/></svg><span>HTML<span class="subtitle">Readable, self-contained page</span></span></button>
<button class="option" data-format="json"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 4H7v6l-3 2 3 2v6h2m6-16h2v6l3 2-3 2v6h-2"/></svg><span>JSON<span class="subtitle">Structured message content</span></span></button>
<button class="option" data-format="clean"><span>Readable JSON<span class="subtitle">Conversation only; no tools or reasoning</span></span></button>
<button class="option" data-format="txt"><span>Readable TXT<span class="subtitle">Numbered user/assistant transcript</span></span></button>
<button class="option" data-format="work"><span>Compact work archive<span class="subtitle">Distinct file versions and GitHub change history</span></span></button>
<div class="divider"></div>
<label class="toggle"><input type="checkbox" role="switch"><span>Include reasoning &amp; tools<span class="subtitle">Activity available in the conversation</span></span></label>
<div class="status" role="status" aria-live="polite">Downloads the full saved chat, including unloaded history.</div>
<button class="cancel" hidden>Cancel export</button>
</section>`;
    trigger = root.querySelector('.trigger'); panel = root.querySelector('.panel');
    checkbox = root.querySelector('input'); status = root.querySelector('.status'); cancelButton = root.querySelector('.cancel');
    try { checkbox.checked = JSON.parse(localStorage.getItem(settingsKey) || '{}').includeActivity === true; } catch { /* Optional preference. */ }
    checkbox.addEventListener('change', () => { try { localStorage.setItem(settingsKey, JSON.stringify({ includeActivity: checkbox.checked })); } catch { /* Storage may be unavailable. */ } });
    trigger.addEventListener('click', () => {
      if (!panel.hidden) { closePanel(); return; }
      panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); positionPanel();
      root.querySelector('[data-format]').focus();
    });
    root.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => runExport(button.dataset.format)));
    cancelButton.addEventListener('click', () => job?.abort());
    for (const type of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      root.addEventListener(type, event => event.stopPropagation());
    }
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); closePanel(true); }
      if (event.key === 'Tab' && !panel.hidden) {
        const controls = [...panel.querySelectorAll('button,input')].filter(element => !element.disabled && !element.hidden);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && root.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && root.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    document.addEventListener('pointerdown', event => { if (!event.composedPath().includes(host)) closePanel(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); closePanel(true); }
    });
    window.addEventListener('resize', positionPanel);
    document.addEventListener('scroll', scheduleMount, { capture: true, passive: true });
  }

  function mountUI() {
    if (!document.body) return;
    if (!host) createUI();
    const id = conversationID();
    if (id !== lastID) { job?.abort(); lastID = id; closePanel(); status.textContent = 'Downloads the full saved chat, including unloaded history.'; }
    host.style.display = id ? 'inline-flex' : 'none';
    // Keep both controls outside ChatGPT's clipped and auto-hiding toolbar.
    if (host.parentElement !== document.body) document.body.append(host);
    if (!id) { slot.remove(); return; }
    slot.style.width = `${trigger.offsetWidth}px`;
    const header = document.querySelector('#conversation-header,[data-testid="conversation-header"],main > header,main header');
    if (header) {
      let target = header;
      const share = header.querySelector('[data-testid="share-chat-button"],button[aria-label="Share"]');
      if (share?.parentElement && /flex/.test(getComputedStyle(share.parentElement).display)) target = share.parentElement;
      if (slot.parentElement !== target) target.insertBefore(slot, share?.parentElement === target ? share : null);
    } else slot.remove();
    const rect = slot.getBoundingClientRect();
    const visible = slot.isConnected && rect.width > 0 && rect.height > 0 &&
      rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
    host.style.left = `${visible ? rect.left : Math.max(12, innerWidth - trigger.offsetWidth - 60)}px`;
    host.style.top = `${visible ? rect.top : 8}px`;
    host.style.right = '';
    positionPanel();
  }

  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; mountUI(); }, 200);
  }
  new MutationObserver(scheduleMount).observe(document, { childList: true, subtree: true });
  setInterval(mountUI, 1000);
  scheduleMount();
})();
