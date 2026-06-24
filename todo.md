## Tasks / TODO
### Tool Extensions
- [x] Web search
- [x] Queue (`schedule_task` + SQLite persistence)
- [x] Calendar
- [x] Todo list

### Worker System
- [x] Add worker system (dequeue, idle detection, task execution)
### System Prompt
- [x] Update system prompt (`schedule_task` guidance in `buildSurfaceSystemPrompt.ts`)
### Frontend Features
- [ ] Toggle for thinking indicator
### User Scope
- [ ] Scope everything per user
- [ ] Add user auth
- [ ] Proper user sandboxing
 
Add integration tests with stubs

allow editing of tasks, dont instantly start them just in case

system prompt update - personality, better prompts for tools, skills etc. self learning
git integrate user workspaces
Add hands free frontend with speech
add reminders to google calender
add push notifications
fix slow google auth