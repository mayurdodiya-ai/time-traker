# Prompt for Claude in Chrome — full QA of Chronos (copy everything below the line)

---

You are a meticulous QA engineer. Test the web app **Chronos — Tasks & Time** end to end in this browser, as the **admin (owner)** and as **team members**, and report every defect you find. **Do not change any code. Only test and report.**

## 1. What the app is
Internal task and time-tracking app that mirrors a Trello board.
- **Board = Project. Trello list = column. Trello card = Task. Checklist item = Subtask.**
- A **parent task** can be assigned to **one or more people** (first = main assignee).
- A **subtask has exactly one assignee**.
- **Timers and manual time exist ONLY on subtasks.** A parent task has no timer; its total = the sum of its subtasks.
- Only a subtask's own assignee can track time on it. One running timer per person; starting another auto-pauses the first.
- Roles: **owner** (admin), **manager**, **employee**, **viewer**. Admin-only features: People, Audit, Approvals, Excel **Import**, **Add list**.
- **Lists** can be *Chronos + Trello* (also created in Trello) or *Chronos only* (tag "Chronos only"; tasks parked there keep their Trello card in its current Trello list; a task created there has no Trello card until it is moved into a Trello list).
- Manual time entry is **turned off**: time is recorded by the timer only.
- Time entries: draft → submitted → approved / rejected. Approved entries are locked (only owner can correct with a reason).

## 2. Setup
- URL: **http://localhost:8000**
- Admin: `axitvadi.work@gmail.com` / `<ADMIN_PASSWORD>`
- Team members (password `<TEAM_PASSWORD>`): `rusha.smixit@gmail.com` (employee), `backend.node1@gmail.com` (employee), `princybhingradiya9912@gmail.com` (manager)
- Use two browser profiles/incognito windows so admin and a team member are signed in at the same time (needed for the multi-user tests).
- The app is connected to a **real Trello board**. **Prefix everything you create with `QA-`** (tasks, lists, users). Only delete things you created. Never delete or edit existing real tasks, lists or users. Prefer testing on a throwaway project/board if one exists.

## 3. How to test
- Work section by section, in order. For each case: do the steps, compare with Expected, mark **PASS / FAIL / BLOCKED** (BLOCKED = cannot be tested, say why, e.g. file upload not possible in the browser).
- On every page also watch: browser console errors, failed network calls (4xx/5xx), broken layout, wrong numbers, stale data after actions (does it update without reloading?), and generic "Something went wrong" messages.
- Take a screenshot for every FAIL.
- If a step fails, note it and continue with the next case — do not stop.
- Where a case says "verify in Trello", open the Trello board in a new tab and check.

## 4. Test cases (ID · Role · Steps → Expected)

### A. Sign-in and session (14)
- A01 · Anyone · Open /projects while signed out → redirected to the sign-in page.
- A02 · Admin · Sign in with valid email/password → lands on the dashboard, name and "Owner" shown bottom-left.
- A03 · Anyone · Wrong password → clear error, not signed in.
- A04 · Anyone · Unknown email → same generic error (does not reveal whether the email exists).
- A05 · Anyone · Empty email/password → validation message, no crash.
- A06 · Anyone · Email in UPPERCASE / with spaces → still signs in.
- A07 · Admin · Refresh the page after sign-in → stays signed in.
- A08 · Admin · Sign out → returns to sign-in; Back button does not show private data.
- A09 · Team member · Sign in → lands on dashboard with *their own* work only.
- A10 · Team member · Open /people and /audit by URL → redirected away (no data shown).
- A11 · Team member · Open /approvals by URL → redirected away.
- A12 · Anyone · Sign-up form (if shown): new request → "waiting for approval", cannot sign in yet.
- A13 · Admin · Settings → change password with wrong current password → error; with correct → success, can sign in with the new one (then change it back).
- A14 · Anyone · Short new password (<8) → rejected.

### B. People management (admin) (10)
- B01 · Admin · People page lists all users with roles and status.
- B02 · Admin · Create user `QA-Test` (employee) with valid data → appears in list, can sign in.
- B03 · Admin · Create user with duplicate email → error.
- B04 · Admin · Create user with password <8 chars → error.
- B05 · Admin · Change a user's role employee ↔ manager → saved; their menu/permissions change after they re-login.
- B06 · Admin · Deactivate `QA-Test` → cannot sign in; history kept. Reactivate → can sign in.
- B07 · Admin · Try to deactivate or demote yourself → blocked with message.
- B08 · Admin · Pending access requests: approve one (assign role) → user becomes active; reject another → removed.
- B09 · Admin · Reset a user's password → they can sign in with the new one.
- B10 · Admin · Notification bell shows a new access request when someone signs up.

### C. Projects (12)
- C01 · Admin · Projects page lists projects; search by name filters the list.
- C02 · Admin · Create project `QA-Project` (not Trello-linked) with manager + members → appears.
- C03 · Admin · Edit name/description/dates/colour → saved.
- C04 · Admin · Change status Planning → Active → On hold → Completed → Archived; each saves and the badge updates.
- C05 · Admin · Archived/completed project: Import, Add list and New task are hidden or blocked.
- C06 · Admin · Team tab: add and remove a member; removed member's old tasks/time remain.
- C07 · Admin · Reassign project manager → saved; audit log shows it.
- C08 · Team member · Sees only projects they belong to.
- C09 · Team member · Opens a project they are not in via URL → "not found", no data.
- C10 · Manager · Can edit only projects they manage; cannot change the manager.
- C11 · Admin · Insights tab shows charts; numbers match the tasks/time.
- C12 · Admin · Project with no tasks shows a friendly empty state.

### D. Trello link and sync (12)
- D01 · Admin · "Import from Trello" lists boards; importing creates a project with lists, cards, subtasks.
- D02 · Admin · Importing an already imported board → clear error.
- D03 · Admin · "Sync now" → success message; no duplicates created on repeat syncs.
- D04 · Admin · Create a card in Trello, wait ≤1 min / Sync now → appears in the right Chronos list.
- D05 · Admin · Edit a card title/description/due date in Trello → updates in Chronos after sync.
- D06 · Admin · Archive a card in Trello → task becomes cancelled in Chronos.
- D07 · Admin · Move a card between lists in Trello → moves in Chronos after sync.
- D08 · Admin · Add a checklist item in Trello → new subtask in Chronos.
- D09 · Admin · Comment in Trello → appears in the Chronos Comments tab.
- D10 · Admin · Create a task in Chronos → a card appears in the right Trello list (verify in Trello).
- D11 · Admin · Change a task's title/deadline/priority in Chronos → card updates in Trello (title, due).
- D12 · Admin · Delete a Chronos task → card is archived (not deleted) in Trello.

### E. Board lists (admin) (16)
- E01 · Admin · Toolbar and board end show **+ Add list**; team member does not see it.
- E02 · Admin · Add list `QA-Both` as "Chronos + Trello" → appears as a column AND as a list in Trello.
- E03 · Admin · Add list `QA-Local` as "Chronos only" → column with a "Chronos only" tag; NOT in Trello.
- E04 · Admin · Empty name → rejected. Name >40 chars → rejected.
- E05 · Admin · Duplicate name (any case) of an existing list → rejected with message.
- E06 · Admin · Rename `QA-Local` → name changes on the column and on tasks inside it.
- E07 · Admin · Delete a Chronos-only list that has tasks → blocked with a clear message.
- E08 · Admin · Delete an empty Chronos-only list → removed.
- E09 · Admin · Drag a task from a Trello list into `QA-Local` → stays in Chronos; **verify in Trello: the card did NOT move**.
- E10 · Admin · Drag that task from `QA-Local` into another Trello list → card moves to that list in Trello.
- E11 · Admin · Create a task directly inside `QA-Local` (list picker shows "Chronos only") → **no Trello card created**.
- E12 · Admin · Drag that new task into a Trello list → a Trello card is created there, with its subtasks as a checklist.
- E13 · Admin · Sync now while a task is parked in `QA-Local` → it stays in `QA-Local`.
- E14 · Admin · Task drawer's list dropdown / drag-drop between two Trello lists → card moves in Trello.
- E15 · Admin · Column counts update after every move without reloading.
- E16 · Team member · Can drag their own task between lists, but cannot add/rename/delete lists.

### F. Tasks and subtasks (20)
- F01 · Admin · New task with only a title → created in the chosen list with **no** subtask (nothing is added automatically). Its drawer says there are no subtasks and offers "Add subtask".
- F02 · Admin · New task assigned to 2–3 people ("+ Add another") → all avatars show on the card; first marked "main".
- F03 · Admin · Remove the main assignee from the picker → next person becomes main.
- F04 · Admin · Only project team members appear in assignee pickers (no viewers, no inactive users).
- F05 · Admin · Add a subtask → it has a **single** assignee dropdown (no multi-select).
- F06 · Admin · Try to give a subtask two people (via UI) → not possible.
- F07 · Admin · Set priority, deadline, estimate on a task; values show on the card and drawer.
- F08 · Admin · Estimate "none" vs "0 h" are shown differently.
- F09 · Admin · Parent estimate = sum of subtask estimates (updates when a subtask estimate changes).
- F10 · Admin · Mark a task "Completed" while required subtasks are open → warning; override needs a reason.
- F11 · Admin · Complete all subtasks → parent auto-completes; reopen one → parent reopens.
- F12 · Admin · Cancel / reopen a subtask → progress and estimate totals update.
- F13 · Admin · Edit title/description/criteria in the drawer, press Save → persisted; Cancel/discard works; closing with unsaved edits asks to discard.
- F14 · Admin · Delete a task with no time → removed (card archived in Trello). Delete one with tracked time → blocked ("cancel it instead").
- F15 · Admin · Task drawer deep link `?task=<id>` opens the drawer; Esc closes it.
- F16 · Admin · Board filters: search, "Everyone" (assignee), "Any priority", "Only mine", status "Active" — each filters correctly and combine.
- F17 · Admin · List view shows the same tasks; row expand shows subtasks.
- F18 · Admin · Comments: add a comment; it appears with author and time.
- F19 · Admin · Task with very long title and special characters (`<b>x</b>`, quotes, emoji) → displays as plain text, layout intact, no script runs.
- F20 · Team member · Create "my own" task ("Add my task") → assigned to themselves automatically.

### G. Timers (subtasks only) (18)
- G01 · Team member · Parent task card/drawer shows **no** Start button; drawer says "Time is tracked on subtasks".
- G02 · Team member · Start timer on **their own subtask** → running indicator, clock ticks.
- G03 · Team member · Subtask assigned to someone else → button is locked ("Only X can track time").
- G04 · Team member · Pause, then resume → no time lost; elapsed continues from where it stopped.
- G05 · Team member · Start a timer on subtask B while A is running → A is auto-paused and a message says so.
- G06 · Team member · Stop timer → a time entry is created (correct duration, date, "timer" source) and the timer disappears.
- G07 · Team member · Double-click Start quickly → only one timer, no error.
- G08 · Team member · Double-click Stop → only one entry created.
- G09 · Team member · Refresh the page while running → timer still running with correct elapsed time.
- G10 · Team member · Start in window 1; open the app in window 2 (same user) → shows the same running timer; starting another in window 2 pauses the first (no two running timers).
- G11 · Admin · Admin is not the subtask's assignee → cannot start its timer.
- G12 · Admin (other window) · Sees "X is tracking" on the subtask live.
- G13 · Team member · Subtask whose estimate is fully used → timer locked with an explanation.
- G14 · Admin · Raise that estimate → timer can start again.
- G15 · Team member · Completed/cancelled subtask → timer locked; reopen → allowed.
- G16 · Team member · Parent task totals (Direct = 0, Subtasks = sum, Total) increase live while a subtask timer runs.
- G17 · Team member · Dashboard shows the running timer; its link opens the right subtask.
- G18 · Viewer (if one exists) · Cannot start any timer.

### H. Time entries and approvals (16)
- H01 · Team member · My Time page: today/week totals match the entries listed.
- H02 · Team member · My Time and the task drawer have **no** "Log time" button. Time can only come from the timer.
- H03 · Team member · Run a timer for a minute and stop it → exactly one entry appears, source "timer".
- H04 · Team member · Call the API by hand (POST /api/time-entries with a valid token) → refused with "Manual time entries are turned off".
- H05 · Team member · Existing older "manual" entries (if any) still show with a "manual" chip and still count in totals.
- H08 · Team member · Edit a draft entry (duration, description, date) → saved; history shows the change.
- H09 · Team member · Delete a draft entry → removed; totals update.
- H10 · Team member · Submit entries for review → status "submitted"; cannot edit or delete them.
- H11 · Admin · Approvals queue shows the submitted entries; own entries are not listed for self-approval.
- H12 · Admin · Reject without a note → blocked; reject with a note → employee sees note + notification; entry editable again.
- H13 · Admin · Approve entries → status "approved"; employee notified.
- H14 · Team member · Edit/delete an approved entry → blocked ("locked").
- H15 · Admin · Correct an approved entry **with a reason** → allowed, shown as CORRECTION in history; without a reason → blocked.
- H16 · Manager · Cannot access the approvals page (admin only).

### I. Excel import (admin) (16)
- I01 · Admin · **Import** button visible on the board toolbar and each list header icon; team member sees none.
- I02 · Admin · Dialog explains: download the example file first, fill one row per task, List column decides the list, one file can have many lists.
- I03 · Admin · "Download example file" → .xlsx opens; sheets Tasks + Guide; Guide has **no** "Team members" row and no "Up to 200 tasks" line; dropdowns for List/Priority/Assignee/Status work.
- I04 · Admin · Upload a valid file (≥6 rows across several lists) → preview shows each row's list, priority, assignee, deadline, estimate, subtask count; "N ready".
- I05 · Admin · Click Import → progress shows; "Import finished" shows count, per-list tags, table of created tasks.
- I06 · Admin · Verify: tasks landed in the right lists, with the right assignee/priority/deadline/estimate/labels, subtasks created (only the ones in the sheet), cards exist in Trello.
- I07 · Admin · Row with an unknown list name → red error naming valid lists; other rows still import.
- I08 · Admin · Row with an assignee who is not on the team → error; row skipped.
- I09 · Admin · Bad priority / bad status / bad date / bad estimate (e.g. "abc") → each gives a clear error.
- I10 · Admin · Missing title → "Title is required".
- I11 · Admin · Re-upload the same file → rows flagged "already exists" and skipped (checkbox on); with the checkbox off they import again.
- I12 · Admin · Empty "List" cell → goes into the "If a row has no List" default list.
- I13 · Admin · Several people in Assignee (comma separated) → first is main, others added; subtasks from the sheet go to the first person.
- I14 · Admin · A Chronos-only list name in the List column → accepted; those tasks have no Trello card.
- I15 · Admin · Upload a .csv / .png / empty file → friendly error, no crash. >200 rows → clear error.
- I16 · Admin · "Import another file" resets the dialog; Done closes it and the board refreshes without reloading.

### J. Dashboard, reports, notifications, audit (12)
- J01 · Team member · Dashboard: "Tracked today / This week / Open items / Overdue" match My Time and the board.
- J02 · Team member · Overdue and upcoming lists show only their own work.
- J03 · Admin · Dashboard shows company-wide totals; hours by project/employee add up to the entries.
- J04 · Admin · Reports: change date range / project / employee filters → numbers and charts update; empty range shows an empty state.
- J05 · Admin · Report export (CSV/Excel if present) downloads and its totals equal the on-screen totals.
- J06 · Team member · Reports show only what they are allowed to see.
- J07 · Both · Notification bell: new assignment, "added you to", approval decisions each create a notification with the correct link; mark as read works; count updates.
- J08 · Admin · Assigning a task to a team member notifies them; assigning to yourself does not.
- J09 · Admin · Audit page lists actions (task create, list add, import, time approve, user changes) with actor and time; filters work.
- J10 · Team member · Audit is not accessible.
- J11 · Admin · Bulk import creates ONE summary audit entry and ONE notification per person (not one per task).
- J12 · Both · Global search "Search tasks and subtasks…" finds tasks by title; clicking a result opens it.

### K. Permissions and security (10)
- K01 · Team member · Open another person's task by URL (`?task=<id>`) → not found / no data.
- K02 · Team member · Cannot edit a task they are not assigned to (title/priority/assignee fields locked) but can change status of their own.
- K03 · Team member · Cannot reassign work or see "Add list" / "Import" / People.
- K04 · Team member · Cannot see other people's hours or workload on the Team tab.
- K05 · Manager · Can create tasks and assign others in projects they manage; not in others.
- K06 · Anyone · Sign out in one window → the other window's next action redirects to sign-in.
- K07 · Anyone · Tamper with the URL id (`/projects/zzz`) → clean "not found", no crash.
- K08 · Anyone · Paste `<img src=x onerror=alert(1)>` as task title, comment and list name → shown as text, no popup.
- K09 · Deactivated user · Existing session stops working on the next request.
- K10 · Anyone · Direct API access without sign-in (open `/api/tasks` in the address bar) → 401, no data.

### L. UI, responsiveness, resilience (10)
- L01 · Both · Light/dark toggle works and persists after refresh; text is readable in both.
- L02 · Both · Resize to tablet/phone widths → sidebar collapses via the menu button; board scrolls horizontally; dialogs fit the screen.
- L03 · Both · Every dialog closes with Esc and the X; clicking the backdrop closes non-destructive dialogs; Enter submits simple forms.
- L04 · Both · Every list/table has an empty state; every error shows a human-readable message (never a raw stack trace).
- L05 · Both · Toasts appear and disappear; no overlapping/blocked buttons.
- L06 · Both · Browser Back/Forward navigates correctly between pages and the task drawer.
- L07 · Both · Slow network (throttle to "Slow 3G") → loading skeletons, no duplicate submissions when clicking twice.
- L08 · Both · Offline then online → clear error while offline; works again after reconnecting.
- L09 · Both · Console is free of errors/warnings during all of the above (list any).
- L10 · Both · Keyboard-only: Tab order is sensible, focus is visible, dialogs trap focus.

## 5. What to report back
Produce one report:
1. **Summary table**: section · total · PASS · FAIL · BLOCKED.
2. **Failures** (most severe first). For each: Case ID · Role · Severity (Blocker / High / Medium / Low) · exact steps · **Expected** vs **Actual** · page URL · console/network error text · screenshot.
3. **Console / network errors** seen anywhere (even where the case passed).
4. **Blocked cases** with the reason.
5. **Extra bugs or UX problems** you noticed that are not in the list.
6. **Cleanup list**: every `QA-` item you left behind (tasks, lists, users, Trello cards) so I can remove them.

Start with Section A now. After each section, post a one-line progress update, then continue.
