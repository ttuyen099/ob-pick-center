# OB Pick Center v3.7

A Tampermonkey overlay for Rodeo that gives you real-time visibility into OB Pick headcount — all in one draggable panel.

---

## What It Does

Tracks **Plan HC vs. Actuals** for every process path, shows the delta at a glance, and gives you tools to communicate with pickers — without leaving Rodeo.

---

## Features

**📊 HC Tracking**
- Editable Plan HC and Actuals columns per process path
- Auto-calculates delta (Actuals − Plan) with color-coded indicators
- Running totals at the bottom

**🔄 Auto-Sync from Rodeo**
- Pulls live picker counts directly from the Rodeo page
- Toggle sync on/off with one click
- Polls every 3 seconds for real-time updates

**👥 Workforce Viewer**
- Expand any process path to see who's picking
- Shows active/inactive status per associate
- Select individual pickers or bulk-select all

**🔗 PickMatrix HC Sync**
- Pushes the full workforce roster (every picker + active/inactive status) to the local PickMatrix dashboard every 30 seconds
- Makes Picking Console the single source of truth for Total / Active / Inactive HC in PickMatrix
- Reads directly from the Picking Console workforce API, so it runs even when Rodeo auto-sync is off
- Best-effort: if PickMatrix (Start Dashboard.bat) isn't running, the push is silently skipped
- Configurable target: use the Tampermonkey menu command **"Set PickMatrix URL…"** to point at a non-default host/port (default `http://localhost:8787`). Non-localhost hosts also need a matching `@connect` grant.

**📨 FANS Messaging**
- Send FANS messages to selected pickers within a process path
- Direct FANS send to any login (comma-separated for multiple)
- Auto-retry up to 5 attempts if a send fails

**📸 Snip to Clipboard**
- One-click screenshot of the panel
- Copies directly to clipboard as an image
- Clean capture (hides expand buttons and detail rows)

**🎨 Light/Dark Mode**
- Toggle between themes with one click
- Preference is saved between sessions

**🏢 Multi-FC Support**
- Change FC code on the fly from the panel header
- Works across all Rodeo regions (IAD, DUB, NRT)

**⬆️ Auto-Update**
- Checks for new versions automatically
- Shows a banner + version badge when an update is available
- One-click update — no manual file swapping

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Click the link below:

   **https://raw.githubusercontent.com/ttuyen099/ob-pick-center/main/ob-pick-center.user.js**

3. Click **Install** on the Tampermonkey prompt
4. Open Rodeo → the panel appears in the top-right corner

---

## Status Bar

| Indicator | Meaning |
|-----------|---------|
| 🟢 Synced (13 paths) | Auto-sync is on and reading from Rodeo |
| 🔴 Manual mode | Auto-sync is off, edit values manually |
| ✅ v3.7 | You're on the latest version |
| ⚠️ v3.7 → v3.8 | Update available |
| Last refreshed: 3:35 AM | When data was last pulled |

---

*Created by ttuyen*
