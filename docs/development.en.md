# GptWorkBot development and operations

[简体中文](development.md) · **English**

A Chrome Manifest V3 extension for individual developers. Coordinate independent Work conversations within one existing ChatGPT project: a supervisor assigns tasks, members report results, and the supervisor accepts deliverables. No API key or separate paid coordination backend is required. Your account still needs access to the project, Work features, and usage capacity involved.

<img src="evidence/gptworkbot-dependencies-en-400.png" alt="GptWorkBot demo sidebar with organization chart and collaboration tasks" width="400" />

*Local 0.2.0 dependency demonstration with sample data. Names and task content keep their original language.*

## Documentation

- [Product introduction](product-introduction.en.md): features, scenarios, screenshots, and workflow.
- [Extension requirements](requirements.en.md): requirement IDs, exception handling, and acceptance criteria.
- [Documentation and archives](README.en.md): technical records and fixed bilingual snapshots.

## Installation

1. Open `chrome://extensions` in Chrome and enable Developer mode.
2. Click “Load unpacked” and select this project’s **`dist` directory**. Alternatively, extract `release/gptworkbot-1.0.0.zip` and select the folder containing `manifest.json`.
3. Refresh open ChatGPT pages and click the GptWorkBot icon to open the sidebar.
4. Open your existing project or one of its Work conversations. Use “Bind conversations” → “Read current project” to show the batch role list immediately, or enter the project home URL manually.
5. Select conversations, designate one supervisor, and confirm Work mode. Click “Connect project”; the panel stays open and keeps your choices. Then import the team. Individual binding is also available.
6. Click “Connect collaboration · sync routes.” The extension adds routing conventions and keeps existing project responsibilities.
7. Give the supervisor a goal in its native ChatGPT conversation, then review and approve the proposed tasks in the sidebar.

Chrome 120 or later is required. Other browsers are not currently adapted, and the extension is not published in the Chrome Web Store.

### Update from 0.2.0 to 0.2.1

Fixes malformed JSON caused by unescaped native file-reference quotes in member results. The v2 team and task queue are retained. Reload the extension, refresh the affected ChatGPT conversation, reopen the sidebar, and use “Recheck conversations.” The existing delivered result can recover without re-running the business task. Downstream work still waits for delivery and acceptance.

### Upgrade to 0.2.0

This release uses protocol v2 and `gptworkbot-state-v2`. Old storage is retained without migration or dispatch. Reload the extension, refresh ChatGPT, reopen the sidebar, rebind the team, and connect collaboration to send the new protocol. Existing native conversations can be reused.

For ZIP installations, update files in the same extension directory before reloading. Save user drafts before refreshing. The 15-second windows still apply to page/control preparation, not Work execution.

### Interface languages

Choose 中文 or English in the sidebar header or role form. The first selection follows your browser language; later visits retain your preference. Labels, statuses, system messages, and activity use the selected language. Names, responsibilities, task instructions, results, and native page messages retain their original text. Language preferences are stored separately from the team and queue.

## Upgrade to 1.0.0

This publication uses protocol v2 and the existing gptworkbot-state-v2 storage. Updating an existing 0.2.x installation in the same extension directory retains the team and tasks. Reload the extension, refresh ChatGPT and recheck conversations. From a v1 installation, rebind and connect the team. See the verification record for automated and real-session coverage.

## Usage

Competitive analysis → full result delivered to supervisor → acceptance of current attempt → marketing receives the report → promotion strategy → supervisor review and summary. See [protocol v2](architecture.en.md).

- **Organization chart:** supervisor above members. Green means idle, red running, yellow needs input, and gray unknown or disconnected. Status text accompanies every dot.
- **Review each round:** default mode. Inspect, edit, approve, or cancel proposed tasks before dispatch.
- **Automatic collaboration:** new valid supervisor tasks dispatch automatically, with a default limit of 5 rounds. Existing drafts still need approval. Member concurrency defaults to 2 and supports 1–4.
- **Dependencies:** the supervisor plans the entire chain and you approve one round. Downstream tasks start only after current prerequisite results, report delivery, and acceptance; full result snapshots are included. Independent tasks can run in parallel. Edit prerequisites in drafts; approved relationships are fixed.
- **Revisions:** guide submitted or waiting tasks using the original ID and incremented attempts. History is preserved; stale results or acceptance cannot release downstream tasks. Ordinary waiting is green, failures or missing inputs yellow.
- **Results:** member completion means awaiting acceptance of the current attempt. Early user acceptance still waits for report delivery before releasing downstream work.
- **Drafts and receipts:** preserve user input. Clearly unsent matching extension drafts can resume with “Retry send.” Uncertain sends are checked against receipts without automatic replay.
- **Pause, stop, unbind:** pause stops future extension messages. “Request stop” uses the target’s native stop control. Unbinding removes local tracking and future messages while preserving conversations and historical results. Check already-started native tasks in ChatGPT.

### Create a Work role

1. Connect a project, then click “Add role” under “Team structure.”
2. Enter a role name and full responsibilities. The form shows the current project, which the new role will join.
3. With no supervisor, create the first supervisor. Otherwise add a member with an optional first task and acceptance criteria. Leave the first task empty to initialize only.
4. Submit directly to the approved queue. While paused, creation stays queued until resume. Repeated submission does not create duplicate conversations.
5. Wait for the permanent Work URL and original message receipt. The role joins the chart and its native title is synchronized to its role name.

If native Work selection needs manual handling, open the new conversation, select Work, then click “Retry send.” You can also create a Work conversation manually in ChatGPT and bind it in the sidebar. Supervisor-proposed `create` operations remain supported.

### Connection and recovery

Prepare pages before sending. Healthy initialization turns are confirmed one at a time, starting with the supervisor. Business tasks use the configured member concurrency.

Page-readiness and send-control checking windows each last at most 15 seconds. This is not a Work execution timeout. After delivery, wait for the matching final reply. Native connection-interruption prompts produce yellow status and remain tied to the original message, without resending it.

Use “Recheck conversations” to inspect receipts and replies. Resolve native login, quota, permission, or interruption prompts in ChatGPT. Delays alone do not establish throttling or a blocked account.

## Local data

Team bindings, responsibilities, dependencies, tasks, result history, frozen inputs, receipts, observations, and activity are stored in `chrome.storage.local` under `gptworkbot-state-v2`. No cookies, passwords, or API keys are read, and there is no separate third-party upload service. Coordination messages become part of the bound ChatGPT conversations’ history.

Closing the browser stops extension scheduling. Uninstalling or clearing extension storage removes local records. Reloading from the same directory preserves the extension ID; moving it may change the ID. One project team is configured at a time; outstanding tasks block project switching.

## Development

Use Node.js 20.13 or later; Node.js 22 or 24 is recommended.

```sh
npm ci
npm run dev -- --port 5174
npm test
npm run package
npm run verify-package
```

Preview: `http://127.0.0.1:5174/sidepanel.html`. Regular web previews use sample data and show a demo banner. Only the installed extension connects to ChatGPT.

```text
src/core/       Protocol validation, states, tasks, and receipts
src/extension/  Background scheduler, page observations, Work DOM adapter
src/panel/      Organization chart, interface languages, sidebar interactions
tests/          Protocol, DOM, language preferences, simulated scheduler tests
dist/           Loadable extension
release/        Distribution ZIPs
docs/           Product, requirements, architecture, verification, archives
```

## Validation and boundaries

For 0.2.0, all 245 tests across 13 files pass; type checking, building, and installation ZIP integrity checks pass. Local preview checks cover Chinese/English switching, preference restoration, role-form content preservation, and 400px layout.

Some real Work controls and native operations have been checked. The full installed-extension flow—supervisor → two members → reports → acceptance—still needs real acceptance testing. See the [requirements checklist](requirements.en.md) and [verification record in Chinese](verification.md).

GptWorkBot is independent of OpenAI. The ChatGPT DOM is not a stable integration interface: updates, background sleeping, interrupted streams, and virtualized messages may require manual checks. Primary Chinese and English native controls are adapted; unknown pages or languages show input-needed or unknown status. Account capabilities, limits, model output, and native permissions still govern execution.
