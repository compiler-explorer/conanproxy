# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Conanproxy is a Node.js (Express) proxy server that sits in front of a Conan package manager server. It serves the Compiler Explorer (godbolt.org) ecosystem by providing library binary packages, build logging, failure tracking, and a web dashboard. It proxies Conan API requests (`/v1/*`, `/v2/*`) to a local Conan server at port 9300 while adding authentication, analytics, and a web UI on port 1080.

## Commands

- **Start server**: `npm start` (runs `node index.js`)
- **Lint**: `npm run lint` (ESLint with auto-fix on `index.js`, `build-logging.js`, `build-annotations.js`, `cpp-build-results.js`, `compiler-restrictions.js`)
- **Dev test**: `npm run devtest` (starts server with test env vars `CESECRET=123456789 CEPASSWORD=1234`)
- **CI**: GitHub Actions runs `npm run lint` on Node 16.x and 22.x. There are no automated tests.

## Architecture

**Entry point**: `index.js` (~740 lines) — contains all Express routes, server initialization, and data refresh logic. On startup it:
1. Connects to SQLite database and runs migrations
2. Fetches compiler/library metadata from the Compiler Explorer API (`godbolt.org`)
3. Scans the local Conan server filesystem for available packages
4. Starts Express on port 1080

**Key modules**:
- `build-logging.js` — SQLite operations for build status tracking (failures, logs, compiler stats)
- `build-annotations.js` — Reads/writes JSON annotation files on disk for build metadata (commit hash, ABI, architecture)
- `cpp-build-results.js` — Generates HTML build result views using Pug templates; queries AWS DynamoDB for build history
- `compiler-restrictions.js` — Blocks downloads of proprietary compiler packages (Intel ICC, MSVC, QNX, EDG)

**Data sources**:
- Compiler Explorer API (`godbolt.org`) — compiler list, library metadata
- Local Conan server filesystem (`/home/ce/.conan_server/data/`) — package files and annotations
- SQLite (`buildslogs.db`) — build logs and failure records
- AWS DynamoDB (`library-build-history` table) — historical build tracking

**Authentication**: JWT-based (12-hour tokens) via `express-jwt`. Public routes serve data/pages; authenticated routes handle build status updates and annotation writes.

**Frontend**: Static HTML pages in `/html/` using Bootstrap 4.5 with dark mode support. Pug templates in `/views/` for dynamic pages like build results.

## Code Style

- Plain JavaScript (no TypeScript) — intentional choice due to tight coupling with production data
- ESLint config: 4-space indentation, 160-char line length, semicolons required, smart equality (`===`)
- Database migrations live in `/migrations/` (sequential SQL files)
