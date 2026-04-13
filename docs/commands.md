# Commands

## Design Principles

`Cyberboss` does not hard-code one shared string format across terminal commands, WeChat commands, and different agent runtimes.

It defines stable internal actions first, then lets each channel expose its own entrypoints:

- core action: stable internal meaning
- terminal command: terminal entrypoint
- weixin command: WeChat entrypoint

This keeps the core naming stable when new runtimes or channels are added later.

## Current Action Groups

### Lifecycle & Diagnostics

- `app.login`
- `app.accounts`
- `app.start`
- `app.doctor`

### Workspace & Thread

- `workspace.bind`
- `workspace.status`
- `thread.new`
- `thread.switch`
- `thread.stop`

### Approvals & Control

- `approval.accept_once`
- `approval.accept_workspace`
- `approval.reject_once`

### Capabilities

- `model.inspect`
- `model.select`
- `channel.send_file`
- `timeline.write`
- `reminder.create`
- `diary.append`
- `app.help`

## Current Terminal Commands

The intentionally small public set is:

- `npm run login`
- `npm run accounts`
- `npm run shared:start`
- `npm run shared:open`
- `npm run shared:status`
- `npm run doctor`
- `npm run help`

## Capability Commands

### channel

- `npm run channel:send-file -- --path /absolute/path`

Notes:
- Sends an existing local file back to the current WeChat chat
- `--user <wechatUserId>` can override the default receiver

### reminder

- `npm run reminder:write -- --delay 30m --text "Reminder text"`
- `npm run reminder:write -- --delay 1h30m --text "Reminder text"`
- `printf '%s\n' 'Reminder text with quotes or longer context' | npm run reminder:write -- --delay 20m --stdin`
- `npm run reminder:write -- --at "2026-04-07 21:30" --text "Reminder text"`

### diary

- `npm run diary:write -- --text "Content"`
- `npm run diary:write -- --title "Title" --text "Content"`
- `npm run diary:write -- --date 2026-04-06 --text "Content"`

Notes:
- `--title` only affects the entry title
- `--date` decides which diary file to write into
- `--time` is optional and overrides the entry time

### system

- `npm run system:send -- --text "System message"`
- `npm run system:checkin`

Notes:
- `checkin` is usually better started through shared mode: `npm run shared:start`
- `system:checkin` remains available as the low-level polling entrypoint

### timeline

- `npm run timeline:write -- --date YYYY-MM-DD --stdin`
- `npm run timeline:build`
- `npm run timeline:serve`
- `npm run timeline:dev`
- `npm run timeline:screenshot -- --send`
- `TIMELINE_FOR_AGENT_LOCALE=zh-CN npm run timeline:serve`
- `TIMELINE_FOR_AGENT_LOCALE=en npm run timeline:screenshot -- --send`

Notes:
- `timeline:screenshot -- --send` queues the screenshot for the current WeChat bridge and automatically sends the result back to the current WeChat user.
- `TIMELINE_FOR_AGENT_LOCALE` supports `en` and `zh-CN` and controls the language of the timeline UI and screenshots.

All `reminder / diary / system / timeline` commands listed here are already usable.

## Current WeChat Commands

- `/bind`
- `/status`
- `/new`
- `/reread`
- `/stop`
- `/switch <threadId>`
- `/yes`
- `/always`
- `/no`
- `/model`
- `/model <id>`
- `/help`

Notes:

- `/status` now covers what used to be split between `where` and `usage`
- file sending is still available, but no longer exposed as a WeChat command
