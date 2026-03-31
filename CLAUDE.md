# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

智心树洞 (SecretBox) is a WeChat Mini Program for psychological counseling and student-teacher interaction. It consists of:
- **Frontend**: WeChat Mini Program (WXML, WXSS, JS, JSON)
- **Backend**: Python Flask + MySQL + Redis + Celery

## Development Commands

### Backend (Docker)

```bash
cd server/

# Copy and configure environment
cp config.env.template config.env
# Edit config.env with your settings (WX_APP_ID, WX_APP_SECRET, etc.)

# Start all services
docker-compose up -d --build

# View logs
docker-compose logs -f web
docker-compose logs -f worker

# Stop services
docker-compose down
```

### Frontend

The Mini Program must be run using **WeChat Developer Tools**:
1. Open WeChat Developer Tools
2. Import project directory `SecretBox`
3. Update `appid` in `project.config.json` if needed
4. Compile and preview

**Note**: Backend API calls require either:
- Real device with WeChat app
- Developer Tools with "Do not verify domain, TLS version, and HTTPS certificate" enabled in settings

## Architecture Highlights

### Authentication Flow
- Users login via WeChat `wx.login()` to get `code`
- Frontend sends `code` to `/api/login`
- Backend exchanges `code` for `openid` via WeChat API
- Backend returns `openid` as `token` (stored in storage)
- Subsequent requests include token in `Authorization` header

### Database Schema
Key tables defined in `server/app.py`:
- `User`: openid, nickname, avatar_url, role (student/teacher)
- `Question`: content, user_id, counselor_id, is_public, review_status, audit_status
- `Reply`: question_id, user_id, content
- `Star`: user-question favorites
- `TeacherProfile`: display_name, description, is_active
- `TeacherInvite`: invite_code-based teacher onboarding

### Review/Moderation System
- Public questions require manual review: `review_status` = pending/approved/rejected
- WeChat content security check runs async via Celery: `audit_status` = pending/passed/rejected
- `Question` has dual status fields: `review_status` (manual) and `audit_status` (auto)
- Teachers review via `/api/teacher/questions?reviewStatus=pending`

### API Response Patterns
- Success: JSON object or array
- Error: `{ "error": "message" }` with appropriate HTTP status
- Auth required: 401 status

### Key API Endpoints
- `/api/login` - WeChat code exchange
- `/api/questions` - List (public) / Create
- `/api/questions/<id>/replies` - Reply to question
- `/api/teacher/questions` - Teacher view (filtered by scope/reviewStatus)
- `/api/teacher/questions/<id>/review` - Approve/reject pending content

### Role System
- `TEACHER_OPENIDS`: Comma-separated openids with automatic teacher role
- `TEACHER_INVITE_CODE`: Code users can enter to become teachers
- `TeacherInvite`: Pre-created teacher slots with invite codes

### Frontend Patterns
- Global state in `app.js`: `baseUrl`, `userInfo`, `isLoggedIn`
- Token-based auth: `wx.getStorageSync('token')` passed in `Authorization` header
- Page navigation: TabBar pages use `wx.switchTab`, others use `wx.navigateTo`
- Custom request wrapper pattern seen in teacher pages

### Environment Configuration
Critical env vars in `server/config.env`:
- `WX_APP_ID` / `WX_APP_SECRET`: Required for login and content security check
- `TEACHER_OPENIDS`: Pre-configured teacher openids
- `TEACHER_INVITE_CODE`: Teacher upgrade code

### Content Security
- Async WeChat `msg_sec_check` via Celery task `audit_public_question`
- Falls back to "pass" if WeChat not configured or check fails
- Review queue at: 广场管理 -> 待审核
