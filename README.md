## Userscripts for Tampermonkey

Small browser enhancements and quality-of-life improvements. Install [Tampermonkey](https://www.tampermonkey.net/) first.

| Script | Description | Install |
| --- | --- | --- |
| [ChatGPT Beacon Banner Auto-Dismiss](ChatGPT_Beacon_Banner_Auto-Dismiss-0.2.0.user.js) | Dismisses ChatGPT beacon banners. | [Install](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Beacon_Banner_Auto-Dismiss-0.2.0.user.js) |
| [ChatGPT Bottom Area Resizer](ChatGPT_Bottom_Area_Resizer_v0.06.js) | Adds a draggable handle to resize the ChatGPT input area. | [Install](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Bottom_Area_Resizer_v0.06.js) |
| [ChatGPT Conversation Compact Export](ChatGPT_conversation_compact_export-0.0.1.user.js) | Export complete saved conversations as HTML, JSON, readable JSON/TXT, or deduplicated work archives. | [Install](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_conversation_compact_export-0.0.1.user.js) |
| [ChatGPT Stream Capture](ChatGPT_Stream_Capture-1.1.user.js) | Captures visible ChatGPT text snapshots and exports JSON. | [Install](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_Stream_Capture-1.1.user.js) |
| [Hide LinkedIn Suggested Posts](Hide_LinkedIn_Suggested_Posts-1.0.user.js) | Hides LinkedIn posts labelled Suggested. | [Install](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/Hide_LinkedIn_Suggested_Posts-1.0.user.js) |
| [Link Rewriter](Link_Rewriter_v0.02.js) | Applies configurable URL rewriting rules. | [Install](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/Link_Rewriter_v0.02.js) |
| [Mistral AI Widescreen](Mistral_AI_Widescreen_(Compact_Toggle)-1.3.user.js) | Expands the Mistral chat interface with a toggle. | [Install](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/Mistral_AI_Widescreen_(Compact_Toggle)-1.3.user.js) |
| [Redlib Ad Post Filter](Redlib_Ad_Post_Filter_v0.01.user.js) | Filters suspected advertising posts on Redlib. | [Install](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/Redlib_Ad_Post_Filter_v0.01.user.js) |

Install links use the public distribution repository, `ddrewpublic/UserScripts`.

## ChatGPT Conversation Compact Export

[Source](ChatGPT_conversation_compact_export-0.0.1.user.js) · [Public install link](https://raw.githubusercontent.com/ddrewpublic/UserScripts/main/ChatGPT_conversation_compact_export-0.0.1.user.js)

Exports the complete **active branch** of a saved ChatGPT conversation, including unloaded history pages. It validates history pagination and does not silently export partial history. Alternative conversation branches, temporary chats, shared chats and binary attachments are not exported.

### Output formats

| Format | Extension | Contents |
| --- | --- | --- |
| HTML | `.html` | Self-contained readable page, optionally with available reasoning/tool activity |
| JSON | `.json` | Original structured export, optionally with available reasoning/tool activity |
| Readable JSON | `.readable.json` | User/assistant messages only, with original message content and timestamps |
| Readable TXT | `.readable.txt` | Numbered plain-text user/assistant transcript |
| Compact work archive | `.work-archive.json` | Conversation plus distinct GitHub file versions, write operations/results, PR summaries and unique patches |

The **Include reasoning & tools** switch affects raw HTML/JSON. Readable exports always omit activity; work-archive mode collects available activity and compacts it regardless of that switch.

### Usage

1. Install the userscript in Tampermonkey and open a saved chat at `chatgpt.com`.
2. Click **Export** beside the conversation header and choose an output format.
3. For an audit trail, export raw JSON with **Include reasoning & tools** enabled and retain that file separately.

The compact work archive deduplicates repeated GitHub file reads across matching repository/path/content versions, retains distinct read and write bodies, summarizes supported GitHub write/branch/commit/PR events, and drops repeated previews, empty execution wrappers, large listings and reasoning records. Tool output formats can change, and unrecognized operations may not be retained.

**Lossy format:** A work archive cannot reconstruct every original API response or tool event. It is not a GitHub repository backup, complete audit trail or reversible export. The amount saved depends on conversation content. Attachment references may be present, but file/image/audio binaries are not embedded.

### Development and release

The updated userscript has version `0.0.2` inside the existing `ChatGPT_conversation_compact_export-0.0.1.user.js` filename to retain current links. Its existing `@updateURL` and `@downloadURL` point to the **public distribution repository**. Merge and publish to `ddrewpublic/UserScripts` before expecting those links to deliver the new version; a private-repository PR alone does not update public installations.

The compaction functions were regression-tested against a 3,232-record archive: all 154 conversation messages preserved, 244 distinct file versions captured and all generated file-write references resolved. A **Firefox/Tampermonkey smoke test is still required** before release.
