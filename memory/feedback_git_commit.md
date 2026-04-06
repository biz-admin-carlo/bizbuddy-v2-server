---
name: Git commit — prep message only, don't stage or commit
description: When user asks to "prep the commit message", only write the message — do not run git add or git commit
type: feedback
---

When the user says "prep the commit" or "prep the comment for this", only prepare and display the commit message text. Do NOT run `git add` or `git commit` — let the user run the commands themselves.

**Why:** User rejected a `git add` call when asked to just prep the message. They want to control when staging and committing happens.

**How to apply:** On any commit-related request, write the message out as text unless the user explicitly says "go ahead and commit" or "commit it".
