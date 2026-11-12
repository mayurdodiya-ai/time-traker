# Product Requirements Document (PRD)
## Internal Company Task & Time Tracking Application

**Document status:** Initial product specification  
**Product type:** Private, internal company application  
**Platforms:** Web, Android, iOS  
**Initial team size:** 21–100 users  
**Primary objective:** Manage company projects, tasks, and subtasks while accurately tracking time spent on work.

---

# 1. Product Overview

## 1.1 Product Vision

Build a centralized application that enables the company owner and project managers to organize projects, assign work to employees, track time at task and subtask level, and understand how working hours are distributed across projects.

The application will be inspired by the useful task-management concepts of Trello, but it will not attempt to replicate every Trello feature.

**The core differentiator is reliable task and subtask time tracking.**

## 1.2 Business Objectives

The application must help the company:

1. Organize all company projects in one place.
2. Assign responsibilities clearly.
3. Track actual time spent on each task and subtask.
4. Compare estimated effort against actual effort.
5. Identify delayed tasks and projects.
6. Understand time distribution across employees and projects.
7. Give the owner and project managers clear visibility into work progress.
8. Maintain reliable records of tracked time, manual changes, and approvals.
9. Reduce dependence on spreadsheets and disconnected tracking tools.

## 1.3 Product Principles

- Simple and easy for employees to use daily.
- Time tracking is a first-class feature, not an optional add-on.
- Every task has clear ownership.
- Employees can only access authorized company information.
- Time records must remain accurate when apps close or internet connectivity changes.
- Reports must be transparent and auditable.
- Features should be added according to actual company needs, not to imitate every competing product.

---

# 2. Scope

## 2.1 In Scope

The application will include:

- Employee authentication and account management.
- Role-based access control.
- Project creation and management.
- Project-specific teams.
- Task and subtask creation, assignment, and status management.
- Task and subtask timers.
- Manual time entry and time history.
- Estimated-versus-actual time tracking.
- Personal and management dashboards.
- Time reports by employee, project, task, and date.
- Notifications and reminders.
- Timesheet review and approval.
- Calendar and recurring tasks.
- Audit history.
- Web, Android, and iOS applications.
- Secure hosting, backups, and monitoring.

## 2.2 Out of Scope for the Initial Release

The initial version will not include:

- Public user registration or external customer accounts.
- SaaS subscriptions or billing.
- A marketplace for other companies.
- Payroll processing.
- Employee surveillance, screenshots, or keystroke monitoring.
- Full accounting or invoicing.
- Complex resource-planning systems.
- Advanced AI automation.
- Unlimited Trello-style customization.
- Extensive third-party integrations unless required by the company.

These features can be considered separately if a genuine business need emerges.

## 2.3 Platform Scope

| Platform | Primary use |
|---|---|
| Web dashboard | Project management, team administration, reports, approvals, and configuration |
| Android app | Employee task execution, timers, time entries, and notifications |
| iOS app | Employee task execution, timers, time entries, and notifications |
| Shared backend | Authentication, permissions, time calculations, data storage, and business rules |

All platforms must use the same backend and consistent business rules.

---

# 3. Organizational Hierarchy

The official hierarchy will be:

**Company Owner → Project Manager → Project → Project Team → Task → Subtask**

The project team is a membership group belonging to a project. It defines which employees can be assigned work within that project.

## 3.1 Company Owner

The owner has overall control of the internal application.

Responsibilities:

- Manage employee accounts and roles.
- Create, edit, archive, or close projects.
- Assign project managers.
- View all company projects and time reports.
- Configure company-wide settings.
- Review or override records when authorized.
- View audit history.
- Manage application access.

## 3.2 Project Manager

The project manager is responsible for assigned projects.

Responsibilities:

- Create and manage assigned projects.
- Add and remove project team members.
- Create tasks and subtasks.
- Assign work to eligible team members.
- Define estimates, deadlines, priorities, and statuses.
- Monitor project progress.
- Review time reports and overdue work.
- Review timesheets if granted approval permission.

Project managers must not automatically receive unrestricted administrative access to unrelated company settings.

## 3.3 Project

A project represents a defined body of work with a clear objective.

Each project should have:

- Project name and description.
- Project manager.
- Start date and target completion date, when applicable.
- Status.
- Project team.
- Tasks and subtasks.
- Estimated effort.
- Actual tracked effort.
- Progress summary.
- Project-specific reports.

Project statuses may include Planning, Active, On Hold, Completed, and Archived.

## 3.4 Project Team

Each project has an assigned team of eligible employees.

Project team functionality must allow:

- Adding and removing members.
- Assigning work only to eligible members.
- Defining a project lead, when required.
- Viewing team workload and assigned work.
- Preserving historical time records if a member leaves the project.

Removing a team member must not delete their previous tasks, time entries, comments, or audit history.

---

# 4. Standard Definitions: Task and Subtask

## 4.1 Task Definition

A **task** is a meaningful, independently manageable unit of work that contributes to a project's objective.

A task must describe a clear outcome that can be assigned, estimated, tracked, and marked complete.

Example:

**Task: Develop the employee login module**

The task may have its own:

- Title and description.
- Accountable assignee.
- Optional collaborators.
- Status and priority.
- Deadline.
- Estimated duration.
- Timer and time entries.
- Comments and attachments.
- Subtasks.
- Completion criteria.

A task may be tracked directly or broken down into subtasks.

## 4.2 Subtask Definition

A **subtask** is a smaller, independently manageable part of a parent task.

Example subtasks for “Develop the employee login module”:

1. Design the login screen.
2. Integrate the authentication API.
3. Implement input validation.
4. Test the login flow.

A subtask must:

- Belong to exactly one parent task.
- Belong to the same project as its parent.
- Be assignable to an eligible project team member.
- Have its own status and optional deadline.
- Support its own estimate and timer.
- Maintain its own time-entry history.
- Contribute to parent-task progress and time totals.

## 4.3 Task vs. Subtask

| Attribute | Task | Subtask |
|---|---|---|
| Purpose | Deliver a meaningful unit of project work | Complete part of a parent task |
| Project association | Required | Inherited from parent |
| Assignee | Required for active work | Required for active work |
| Status | Yes | Yes |
| Priority | Yes | Yes |
| Deadline | Optional | Optional |
| Estimate | Optional | Optional |
| Timer | Yes | Yes |
| Manual time entries | Yes | Yes |
| Comments and attachments | Yes | Yes |
| Time reporting | Yes | Yes |
| Parent relationship | None for a top-level task | Required |

## 4.4 Task Assignment Rules

1. The project manager creates the project team.
2. Tasks can be assigned to members of that project's team.
3. Subtasks can be assigned to any eligible member of the same project team.
4. A subtask does not have to be assigned to the same person as its parent.
5. Every task and subtask has one primary accountable assignee by default.
6. Optional collaborators can participate without replacing the accountable assignee.
7. Only authorized users can override project-team assignment restrictions.
8. Historical assignments and time records must remain available for reporting.

## 4.5 Completion Rules

- Completing a subtask updates parent-task progress.
- The parent task should not automatically become complete merely because a timer stops.
- A parent task cannot normally be completed while required subtasks remain incomplete.
- An authorized manager may override this restriction with a recorded reason.
- Completing a task does not erase its timer history.
- Reopening a completed task must preserve historical records.

## 4.6 Nesting Decision

For the initial release, the user interface will support:

**Project → Task → Subtask**

The data model may support deeper nesting in the future, but unlimited nested subtasks will not be exposed in the first version. This keeps task management, progress calculations, and reporting simple.

---

# 5. Roles and Permissions

The application will use role-based access control.

## 5.1 Company Owner

**Access level: Full company administration**

Permissions:

- Manage all users and roles.
- View and manage all projects.
- View all tasks and subtasks.
- View company-wide time reports.
- Review time entries and approvals.
- Manage settings.
- View audit history.
- Perform authorized overrides.

## 5.2 Project Manager

**Access level: Assigned projects**

Permissions:

- Manage assigned projects.
- Manage project teams.
- Create, edit, assign, and prioritize tasks.
- Create and assign subtasks.
- Set deadlines and estimates.
- View project and team reports.
- Review time entries within authorized projects.
- Approve timesheets only if separately granted that permission.

## 5.3 Team Lead

**Access level: Designated projects or teams**

Permissions:

- Monitor assigned team work.
- Coordinate task assignments if permitted.
- Update project task statuses.
- View authorized team time summaries.
- Identify overdue tasks.
- Assist with task completion and reviews.

This role is optional and may be combined with Project Manager for a smaller team.

## 5.4 Employee

**Access level: Assigned or otherwise authorized work**

Permissions:

- View permitted projects and tasks.
- Update assigned task and subtask statuses.
- Start, pause, resume, and stop timers.
- Add manual time entries.
- View personal time history.
- Add comments and attachments where permitted.
- Submit time entries for approval.
- Edit unapproved entries according to policy.

Employees cannot change approved time records without an authorized correction workflow.

## 5.5 Approver

**Access level: Authorized review workflow**

Permissions:

- View submitted time entries assigned for review.
- Approve or reject entries.
- Request corrections.
- Add review comments.
- View the history of approval decisions.

Approval permission may be granted to the Owner, Project Manager, or another designated employee. It does not automatically grant full administrative access.

## 5.6 Viewer

**Access level: Read-only**

Permissions:

- View authorized projects, tasks, and reports.
- Cannot change task data, assignments, timers, or time entries.

This role is optional for the first release.

## 5.7 Permission Enforcement

- The backend must validate every protected action.
- Unauthorized users must not access data by changing URLs or API requests.
- Users must only see projects and reports permitted by their role and project membership.
- Sensitive administrative actions must be recorded in the audit log.

---

# 6. Feature Requirements

## 6.1 Authentication and User Management

The system must support:

- Secure sign-in and sign-out.
- Invitation-based employee onboarding.
- Password reset or supported identity-provider recovery.
- User activation and deactivation.
- Role assignment.
- Profile details.
- Session and access security.
- Account deactivation without deleting historical work records.

Public registration is not required.

## 6.2 Project Management

The system must support:

- Creating, editing, and archiving projects.
- Assigning a project manager.
- Setting project dates and status.
- Managing the project team.
- Viewing task counts and completion progress.
- Viewing total estimated and actual project time.
- Filtering projects by manager, status, and date.

Archived projects must retain their history and reports.

## 6.3 Task Management

The system must support:

- Creating, editing, and duplicating tasks.
- Assigning an accountable employee.
- Setting priority and status.
- Setting optional deadlines and estimates.
- Adding descriptions and completion criteria.
- Creating subtasks.
- Adding comments and attachments.
- Filtering and searching tasks.
- Displaying task time totals.
- Displaying overdue and completed work.
- Viewing task activity history.

Recommended statuses:

- To Do
- In Progress
- Blocked
- In Review
- Completed
- Cancelled

Statuses may be simplified for the first release, but their meanings must be consistent across web and mobile.

## 6.4 Subtask Management

The system must support:

- Creating and editing subtasks.
- Assigning subtasks to project team members.
- Setting separate estimates and deadlines.
- Updating subtask status.
- Tracking time independently.
- Displaying progress within the parent task.
- Viewing the subtask's time history.
- Preserving the parent relationship when tasks are edited.

## 6.5 Core Timer Functionality

This is the highest-priority module.

Employees must be able to:

- Start a timer on a task.
- Start a timer on a subtask.
- Pause and resume a timer.
- Stop a timer.
- View the current active timer.
- View elapsed time.
- Add a description to a time entry.
- View previous time entries.
- Enter time manually where permitted.

### Timer Rules

1. Each employee may have only one active timer at a time across the application.
2. Starting a new timer automatically pauses the employee's previous timer.
3. The application must communicate that the previous timer was paused.
4. The timer must use server-recorded timestamps as the source of truth.
5. The timer must remain accurate when the app is closed or the device restarts.
6. Repeated start or stop requests must not create duplicate time entries.
7. Simultaneous requests from multiple devices must not produce overlapping active timers.
8. Paused and stopped timers must retain their recorded duration.
9. The employee must be able to see the task associated with the active timer.
10. Timer corrections must be subject to permissions and audit history.

### Parent Task and Subtask Time Calculation

Both a parent task and a subtask may have direct time entries, but one employee cannot run overlapping timers.

The parent task's total time is calculated as:

**Parent task total = direct time recorded on the parent + time recorded on its subtasks.**

Example:

- Direct parent-task time: 1.5 hours
- Subtask A: 2 hours
- Subtask B: 3 hours

Total parent-task effort = 6.5 hours.

The application must not add the subtask hours a second time when showing project or company totals.

Time totals must distinguish:

- Direct time on a task.
- Time on subtasks.
- Combined task effort.
- Actual time recorded against the employee.
- Total effort recorded against the project.

## 6.6 Manual Time Entries

Employees may need to record work that was not tracked live.

Each manual time entry must contain:

- Employee.
- Project.
- Task or subtask.
- Work date.
- Duration.
- Description, where required by company policy.
- Creation timestamp.
- Entry source: timer or manual.
- Approval status.
- Modification history.

The system must validate the duration and permissions before saving an entry.

Overlapping manual entries should be detected and flagged according to company policy. They must not silently distort time totals.

## 6.7 Time Estimates and Actuals

Tasks and subtasks may have estimated durations.

The application must calculate:

- Estimated time.
- Actual recorded time.
- Difference between estimate and actual.
- Estimate consumption.
- Remaining estimate, where useful.

Example:

Estimated duration: 8 hours  
Actual tracked duration: 10 hours  
Variance: 2 hours over estimate

The interface must distinguish a missing estimate from a zero-hour estimate.

## 6.8 Timesheets and Approvals

The system must support a configurable time-review process.

Workflow:

1. Employee records time.
2. Employee submits eligible entries for review.
3. Approver reviews the submitted entries.
4. Approver approves, rejects, or requests corrections.
5. The employee receives the decision.
6. The system records the decision and any subsequent changes.

Approved entries must not be silently overwritten. Corrections must create an audit record and follow the configured permission rules.

## 6.9 Dashboards

### Employee Dashboard

Display:

- My assigned tasks.
- My subtasks.
- My active timer.
- Time tracked today and this week.
- Recently tracked work.
- Upcoming deadlines.
- Overdue tasks.
- Timesheet submission status.

### Project Manager Dashboard

Display:

- Assigned projects.
- Project progress.
- Tasks by status.
- Overdue tasks.
- Team task assignments.
- Estimated vs. actual time.
- Team time summaries.
- Pending time approvals, where authorized.

### Owner Dashboard

Display:

- Overall company project summary.
- Active, completed, and delayed projects.
- Total tracked hours.
- Time by project and employee.
- Estimate-versus-actual summaries.
- Pending approvals.
- Workload and overdue task summaries.

Reports must be based on recorded data and must not present tracked time as a perfect measurement of productivity.

## 6.10 Reports and Exports

The application must support the following reports:

**Employee reports**
- Daily, weekly, and monthly hours.
- Time by project.
- Time by task and subtask.
- Manual vs. timer-recorded time.
- Estimated vs. actual effort for assigned work.

**Project reports**
- Total project hours.
- Time by task and subtask.
- Time by employee.
- Completed and pending tasks.
- Overdue tasks.
- Estimated vs. actual project effort.

**Company reports**
- Time by project and employee.
- Work completed over a selected period.
- Task completion trends.
- Time-entry approval status.
- Total recorded effort.

Users must only see reports permitted by their role.

CSV or Excel export should be included in the planned reporting phase.

## 6.11 Notifications

The system should provide in-app notifications and mobile push notifications for:

- New task assignments.
- Task reassignment.
- Mentions and relevant comments.
- Upcoming deadlines.
- Overdue tasks.
- Approval requests.
- Approval, rejection, or correction requests.
- Changes to important project information.

Users should be able to configure nonessential notifications. Notification delivery failures must not affect timer accuracy or data integrity.

## 6.12 Calendar and Recurring Tasks

Calendar and recurring-task functionality is planned after the core timer workflow.

The calendar may display:

- Task deadlines.
- Project milestones.
- Upcoming assigned work.
- Overdue tasks.

Recurring tasks should support a defined schedule and clear rules for generating each occurrence. Editing one occurrence must not unintentionally modify the entire recurring series.

## 6.13 Search and Filters

The application should support searching and filtering by:

- Project.
- Task or subtask name.
- Assignee.
- Status.
- Priority.
- Due date.
- Time-entry date.
- Approval status.

Saved views may be introduced later if they provide meaningful value to employees and managers.

## 6.14 Comments, Attachments, and Activity

Tasks and subtasks may contain comments and relevant files.

The application should record important events, including:

- Creation and completion.
- Assignment changes.
- Status changes.
- Deadline and estimate changes.
- Timer and time-entry changes.
- Approval decisions.

File access must follow the same authorization rules as the associated task.

---

# 7. Time-Tracking Data Rules

Accurate reporting depends on consistent calculations.

## 7.1 Time Storage

- Store authoritative timestamps in UTC.
- Display dates and times using the configured company or user timezone.
- Store duration using a precise, consistent unit, such as integer seconds.
- Preserve the work date needed for timesheet reporting.
- Maintain the source and audit history of each entry.

## 7.2 Timer Persistence

The application must not rely only on a continuously running frontend counter.

The server must store timer start, pause, resume, and stop events or equivalent authoritative records. The displayed elapsed time can be calculated from those records.

Mobile and web interfaces should synchronize with the server when connectivity is available.

Offline actions may be queued locally, but reconciliation must prevent duplicate entries and conflicting timer sessions. The interface must clearly indicate unsynchronized actions.

## 7.3 Time Calculation Rules

- Paused time is excluded.
- Stopped sessions are no longer active.
- A task total includes its direct time and its subtask time.
- Project and company totals must not double-count parent summaries.
- Employee time reports must use actual time entries, not sums of duplicated task summaries.
- Midnight-crossing sessions must be reported against the appropriate dates according to the configured timezone and reporting policy.
- Rounding rules must be documented and consistent.

---

# 8. Application Screens

## 8.1 Web Application

1. Sign In
2. Employee Dashboard
3. Owner Dashboard
4. Project List
5. Project Details
6. Project Team Management
7. Task Board
8. Task and Subtask Details
9. Timer and Time History
10. My Timesheet
11. Approval Queue
12. Calendar
13. Reports and Exports
14. Employee Management
15. Roles and Permissions
16. Audit History
17. Application Settings

## 8.2 Mobile Application

1. Sign In
2. My Dashboard
3. My Tasks
4. Project List
5. Task Details
6. Subtask List
7. Active Timer
8. Time Entry History
9. Manual Time Entry
10. Notifications
11. Timesheet Submission
12. Profile and Settings

The mobile application should prioritize fast task access and reliable timer controls. Administrative and complex reporting functions may be optimized for the web dashboard.

---

# 9. Technical Architecture

## 9.1 Recommended Stack

| Layer | Technology |
|---|---|
| Web | Next.js + TypeScript |
| Mobile | Flutter |
| Backend API | Node.js + NestJS |
| Database | PostgreSQL |
| Authentication | Secure authentication provider or OIDC-compatible service |
| Real-time updates | WebSockets or server-sent events where needed |
| Background jobs | Redis + BullMQ where needed |
| File storage | Private S3-compatible object storage |
| Push notifications | Firebase Cloud Messaging and Apple Push Notification service |
| Hosting | Managed cloud infrastructure |
| Monitoring | Application error tracking, logs, uptime monitoring, and database alerts |

A modular backend is recommended so authentication, project management, time tracking, reporting, and notifications can evolve independently without introducing unnecessary microservice complexity.

## 9.2 Core Database Entities

The initial data model should include:

- `users`
- `roles`
- `permissions`
- `user_roles`
- `projects`
- `project_members`
- `tasks`
- `task_assignees`
- `time_entries`
- `timer_sessions` or equivalent timer state records
- `comments`
- `attachments`
- `notifications`
- `approval_requests`
- `approval_decisions`
- `audit_events`

Supporting entities may include task labels, checklists, recurring-task rules, saved filters, and application settings.

### Important relationships

- One project has one or more authorized team members.
- One project contains many top-level tasks.
- A task belongs to one project.
- A subtask belongs to one parent task and the same project.
- A task or subtask can have multiple time entries.
- A user may have many historical time entries but only one active timer.
- Approval records reference the time entries being reviewed.
- Audit events reference the actor and affected record.

Database constraints and transactions should enforce important integrity rules.

---

# 10. Security and Reliability

The application must provide:

- Encrypted connections.
- Secure password or identity-provider handling.
- Role-based authorization.
- Server-side validation of all protected actions.
- Restricted file access.
- Secure session handling.
- Protection against unauthorized data access.
- Audit history for sensitive changes.
- Automated backups and a tested restoration process.
- Monitoring for backend errors and timer failures.
- A documented retention and deletion policy.
- Appropriate protection of employee and company information.

The company should define who may edit, export, or delete time records and how long those records should be retained.

---

# 11. Non-Functional Requirements

## Performance

- Common screens should load quickly under normal company usage.
- Timer controls should respond promptly.
- Reports should support the expected initial user count without requiring complex infrastructure.
- Long-running report calculations should not block normal task operations.

## Reliability

- App restarts must not erase recorded time.
- Duplicate network requests must not create duplicate time entries.
- Concurrent timer-start requests must be handled safely.
- Database failures must not silently corrupt timer history.
- Backups must be restorable.

## Usability

- Starting or stopping a timer should require minimal interaction.
- Active timer status must be visible.
- Tasks and subtasks must be easy to distinguish.
- Time totals should be understandable and auditable.
- Mobile and web interfaces must use consistent statuses and calculations.

## Maintainability

- Use modular application architecture.
- Maintain automated tests for timer calculations and permissions.
- Version and review database migrations.
- Document APIs and core business rules.
- Use separate development, staging, and production environments.

---

# 12. Development Roadmap

## Phase 1 — Core MVP

Build the essential daily workflow:

- Authentication and user management.
- Roles and permissions.
- Project creation and project teams.
- Task and subtask management.
- Assignment and status management.
- Start, pause, resume, and stop timers.
- One active timer per employee.
- Manual time entries.
- Time-entry history.
- Task and subtask time totals.
- Estimated vs. actual effort.
- Employee and manager dashboards.
- Basic reports.
- Web application and mobile applications.
- Security, monitoring, backups, and core tests.

**Release objective:** Employees can perform their daily work and reliably record time; managers can understand project effort.

## Phase 2 — Team Workflow

Add:

- Timesheet submission.
- Approval and correction workflows.
- Audit history improvements.
- Notifications and reminders.
- Advanced task filters.
- CSV/Excel exports.
- Calendar and recurring tasks.

## Phase 3 — Advanced Management

Add features according to real usage:

- Workload summaries.
- Task dependencies.
- Custom fields.
- Project templates.
- Configurable workflows.
- Advanced reporting.
- Additional integrations.
- Optional AI-assisted summaries or planning.

These are not prerequisites for the first release.

---

# 13. Testing and Acceptance Criteria

The first production release must pass the following tests.

## Access and Permissions

- Employees cannot access unauthorized projects.
- Project managers can manage only the projects permitted by their role.
- Only authorized users can modify company settings.
- Deactivated employees cannot initiate new work sessions.
- Historical records remain accessible to authorized administrators.

## Task Management

- Tasks can be created and assigned to project team members.
- Subtasks belong to their correct parent task and project.
- Subtasks can have different assignees from their parent.
- Required incomplete subtasks prevent normal parent-task completion.
- Task history remains available after completion or archival.

## Time Tracking

- Starting a new timer pauses the previous active timer.
- Concurrent requests cannot create multiple active timers for the same employee.
- Timers remain accurate after app closure and restart.
- Network retries do not duplicate time entries.
- Manual entries are validated and auditable.
- Parent totals include subtask time without double-counting.
- Time reports reconcile with the underlying time entries.
- Approved records cannot be silently modified.
- Date and timezone reporting is consistent.

## Reporting and Platforms

- Employee reports show only authorized information.
- Managers can report on permitted projects and team members.
- Web, Android, and iOS follow the same timer rules.
- Notifications do not alter time records.
- Backup restoration is tested before production launch.

---

# 14. Success Metrics

The company should evaluate the system using measurable operational indicators.

- Percentage of active employees using the system.
- Percentage of work items with an accountable assignee.
- Percentage of eligible work hours captured through time entries.
- Number of duplicate or overlapping timer incidents.
- Percentage of time entries requiring correction.
- Difference between estimated and actual effort.
- Number of overdue tasks.
- Average time required to approve timesheets.
- Reliability of timer records across web and mobile.
- Employee feedback on ease of use.

Tracked hours should be interpreted in context. They should not be treated as a standalone measure of employee quality or productivity.

---

# 15. Final Product Decisions

The following decisions define the baseline for implementation:

1. The product is a **private application for the company's internal use**, not a public SaaS platform.
2. The initial target is 21–100 users.
3. The supported platforms are web, Android, and iOS.
4. The hierarchy is Company Owner → Project Manager → Project → Project Team → Task → Subtask.
5. Project team membership determines who is eligible for task assignment.
6. Each task or subtask has one accountable assignee by default, with optional collaborators.
7. Both tasks and subtasks can have independent timers.
8. Only one timer can be active per employee at a time.
9. Starting a new timer automatically pauses the previous timer.
10. Parent-task totals include direct work and subtask work without double-counting.
11. Server-recorded timestamps are authoritative.
12. Manual entries and corrections follow permission and audit rules.
13. Timesheet approvals, notifications, calendar, and recurring tasks follow the core MVP.
14. Advanced automation and AI features are deferred until the core system is reliable.

## Final Definition of Success

The application is successful when every employee can clearly see what work they are responsible for, track the time spent on each task or subtask, and record their work reliably—while the project manager and company owner can use the resulting data to understand progress, effort, delays, and planning accuracy.

**Implementation priority: Build a dependable task and time-tracking engine first. Add additional project-management features only when they support the company's actual workflow.**