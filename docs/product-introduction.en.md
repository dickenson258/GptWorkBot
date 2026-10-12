# GptWorkBot · Coordinate your ChatGPT project

[简体中文](product-introduction.md) · **English**

**Give one supervisor a goal. Let multiple Work roles in the same project collaborate on it.**

GptWorkBot is a Chrome extension for individual developers. It organizes independent Work conversations in an existing ChatGPT project into a visible team: the supervisor breaks down work, members execute their assignments, the extension routes messages and results, and the supervisor reviews the deliverables.

| Item | Current status |
| --- | --- |
| Product version | `1.2.0` · testing phase |
| Runtime | Chrome Manifest V3 extension with a native side panel |
| Supported conversations | Independent Work conversations within one ChatGPT project |
| Connection | Uses your existing signed-in session; no API key needed |
| Languages | Simplified Chinese / English interface; bilingual product and requirements documents |
| Storage | Browser extension local storage; no separate backend |
| Documentation baseline | October 12, 2026 · document version `2.3` |

## Why GptWorkBot

Building a product alone often means working on requirements, implementation, testing, and promotion at the same time. Separate ChatGPT conversations can help with each area, but coordinating them still requires copying assignments, switching pages, collecting results, and asking for updates.

GptWorkBot puts those steps in one sidebar. Continue expressing goals in the supervisor conversation while watching each role’s status, reviewing pending assignments, and following team activity. Existing project context, responsibilities, constraints, and materials stay in use; the extension adds message routing and task management.

The extension does not require a separate team workspace or paid coordination backend. Your existing account must still have access to the ChatGPT project and Work features you use. Collaboration uses that account’s capabilities and usage limits.

## See the whole team

<img src="evidence/gptworkbot-dependencies-en-400.png" alt="GptWorkBot English sidebar showing the organization chart, member status, tasks and activity" width="400" />

*This sidebar screenshot shows the local dependency demonstration preview of 0.2.0. They contain sample data, not real user conversations. Role names and task content remain in their original language when the interface language changes.*

| Status dot beside a name | Meaning | What you can do |
| --- | --- | --- |
| 🟢 Green · Idle | Idle or normally waiting for prerequisites | Let the supervisor assign work |
| 🔴 Red · Running | Sending, executing, or waiting for the current reply | Check the task and native conversation |
| 🟡 Yellow · Needs input | Approval, a draft, a native permission prompt, an interrupted reply, or another condition needs attention | Open details or handle it in the conversation |
| ⚪ Gray · Unknown | Disconnected, stale observation, or unavailable composer | Recheck the conversation |

Roles also show a task or connection stage, such as waiting for page readiness, delivered and waiting for a readiness reply, or waiting for the previous role to confirm readiness. A disconnected page is never presented as idle.

## Plan a chain with one goal

> Analyze our product’s competitiveness and competitors, then ask marketing to create a promotion strategy from the accepted analysis. Plan the dependencies upfront.

Competitive analysis → full result delivered to supervisor → acceptance of current attempt → marketing receives the report → promotion strategy → supervisor review and summary.

Approve the entire plan once. Independent work can run in parallel. Dependent work stays idle until every prerequisite’s current complete result is delivered to the supervisor and accepted. The first downstream message includes the full report, source conversation and attempt.

If the result is rejected, the supervisor guides the original task for a new attempt. Downstream work keeps waiting; old results and delayed acceptance cannot release it. Retry preserves frozen inputs and the delivery token. Draft dependencies are editable and validated before approval.

## Main features

| Feature | Experience |
| --- | --- |
| Chinese and English interface | Switch language in the sidebar or role form; remember your preference and preserve user content |
| Organization chart | Supervisor above members, with a status dot beside every name |
| Bind existing conversations | Read the owning project from Work, add roles individually or in a batch, and merge duplicate addresses with conversation names preferred |
| Create roles in the sidebar | Enter a name, responsibilities, and an optional first task; join the current project |
| Sync names and responsibilities | Send full responsibilities in the first message and match the native Work title to the role name |
| Review and dispatch tasks | Approve rounds, edit drafts, and cancel tasks that have not started |
| Dependencies and result transfer | Approve a whole chain, gate on delivery/acceptance, pass full results, and preserve revision history |
| Collect and accept results | Forward member results for supervisor acceptance, with manual user acceptance available |
| Automatic collaboration | Default limit: 5 consecutive rounds; member concurrency defaults to 2 and supports 1–4 |
| Connection and recovery | Prepare pages before sending, confirm initialization one role at a time, and identify interruptions or uncertain delivery |
| Missed-plan diagnosis | Show why a plan was not registered and reread the current supervisor plan as unapproved drafts without duplicate dispatch |
| Draft protection | Preserve user drafts; resume a matching, fully unsent extension draft after an explicit retry |
| Pause, stop, and unbind | Pause future messages, check native execution, and remove local role bindings |

### New roles join the current project

<img src="evidence/gptworkbot-create-role-en-400.png" alt="Add Work role form showing the current project, name, responsibilities, first task and acceptance criteria" width="400" />

*The role-form screenshot is retained from the 0.1.8 sample preview; creation controls are unchanged in 0.2.0.*

Click “Add role” and enter a name and responsibilities. The form shows the project the role will join. Leave the first task empty if the role should only confirm readiness and wait for assignments.

Create the first supervisor when the project has none, then add members. The first message includes the role name and full responsibilities, and the native title is synchronized to the role name. If creation is interrupted, the extension checks the original page and receipt to avoid creating another conversation.

### Page preparation and execution are separate stages

When connecting collaboration, GptWorkBot reuses existing pages and waits for loading and composer readiness. The supervisor connects first; healthy initialization turns are confirmed one at a time to reduce startup request peaks. Business tasks still follow the configured member concurrency.

Page readiness and send-control readiness each have a maximum 15-second checking window. This does not limit Work task execution: after delivery, the extension still waits for the native final reply. Uncertain sends are checked against receipts first. A visible “connection interrupted, waiting for the complete response” state produces a yellow prompt without automatically repeating a delivered message.

## Useful scenarios

| Scenario | Example roles | Collaboration |
| --- | --- | --- |
| Individual software development | Project manager, developer, quality reviewer | Break down requirements, implement, check results, and accept deliverables |
| Product launch preparation | Project manager, content editor, marketer | Prepare product materials and promotion separately, then review together |
| Proposal review | Supervisor, designer, reviewer | Analyze independently, collect questions, and let the supervisor decide what comes next |

You define role names and responsibilities. The extension coordinates conversations; each native Work conversation’s context, tools, and permissions determine what it can actually execute.

## Get started

0.2.1 fixes member JSON results containing unescaped native file references. It retains the existing v2 team and queue; reload and recheck the affected conversation to recover the delivered result once, without re-running the business task.

0.2.0 uses protocol v2 and new storage without migrating old tasks. After upgrading, rebind the team and connect collaboration. Old storage remains inactive. This first release excludes arbitrary conditions, structured artifact extraction, and external file transfer.

1. Use the project’s `dist` build or extract `release/gptworkbot-1.2.0.zip`.
2. Enable Developer mode at `chrome://extensions` and load the folder containing `manifest.json`. The minimum supported browser version is Chrome 120.
3. Refresh your open ChatGPT pages and click the GptWorkBot icon to open the sidebar.
4. Connect your project and bind existing roles, or use “Add role” to create a team. Confirm the participating conversations use Work mode.
5. Click “Connect collaboration.” After readiness is confirmed, give the supervisor a goal in its native conversation and review tasks and results in the sidebar.

Build from source:

```sh
npm ci
npm run package
```

Choose 中文 or English in the sidebar header or role form. The initial selection follows your browser language; later visits retain your choice. Role names, responsibilities, tasks, results, and native page messages remain in their original language.

Connection guidance, initialization, task structure, prerequisite labels, reports and revision prompts sent to roles also follow the interface language. Persist the complete message and language before sending; retries reuse its content and delivery identifier. Switching language affects new, unprepared messages.

The build requires Node.js 20.13 or later. Distribution currently uses local loading; the extension is not published in the Chrome Web Store.

## Data and operating boundaries

Team records, responsibilities, tasks, results, deduplication receipts, and necessary page observations are stored in `chrome.storage.local`. There is no separate backend. The extension does not read cookies, passwords, or API keys. Tasks and reports are sent as ordinary messages to bound ChatGPT conversations and become part of their native history.

Closing the browser stops extension scheduling. Pausing or unbinding controls future extension messages; check any already-started native tasks in ChatGPT. The current version manages one project team at a time. Other browsers, simultaneous multi-project scheduling, and direct member-to-member dispatch are not provided.

GptWorkBot is an independent project, not an official OpenAI extension. ChatGPT’s web interface can change, background pages can sleep, and reply connections can be interrupted. The sidebar provides status and manual handling options. Account limits, model response formats, and native permissions still affect execution.

## Validation status

For `1.2.0`, all 334 automated tests across 18 files pass, together with type checking, building, and installation ZIP integrity checks. Coverage includes dependency chains, revision attempts, frozen inputs, the protocol, queues, states, draft protection, receipt recovery, role creation, naming, initialization scheduling, language preferences, owning-project discovery, and conversation address deduplication.

Real Work controls and some native operations have been checked. The complete installed-extension flow—supervisor, multiple members, result forwarding, and acceptance—still requires manual acceptance testing. The current version is intended for version testing, with production stability still to be assessed.

Read more: [Extension requirements](requirements.en.md) · [Documentation index](README.en.md).
