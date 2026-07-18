// ==UserScript==
// @name         OB Pick Center
// @namespace    http://tampermonkey.net/
// @version      3.5
// @description  Pick HC tracker - editable Plan HC & Actuals, auto-read from Rodeo, snip feature, light/dark mode, expandable workforce viewer with FANS messaging + direct FANS send with auto-retry
// @author       ttuyen
// @match        https://rodeo-iad.amazon.com/*/ExSD?yAxis=PROCESS_PATH*
// @match        https://rodeo-dub.amazon.com/*/ExSD?yAxis=PROCESS_PATH*
// @match        https://rodeo-nrt.amazon.com/*/ExSD?yAxis=PROCESS_PATH*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      picking-console.na.picking.aft.a2z.com
// @connect      fans-iad.amazon.com
// @connect      localhost
// @connect      raw.githubusercontent.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @updateURL    https://raw.githubusercontent.com/ttuyen099/ob-pick-center/main/ob-pick-center.user.js
// @downloadURL  https://raw.githubusercontent.com/ttuyen099/ob-pick-center/main/ob-pick-center.user.js
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Compatibility: ensure GM_xmlHttpRequest is available
    const gmXHR = (typeof GM_xmlHttpRequest !== 'undefined') ? GM_xmlHttpRequest :
                  (typeof GM_xmlhttpRequest !== 'undefined') ? GM_xmlhttpRequest :
                  (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : null;

    // ===== CONSTANTS =====
    const STORAGE_KEY = 'pickHC_planData';
    const STORAGE_KEY_ACTUALS = 'pickHC_actualsData';
    const STORAGE_KEY_THEME = 'pickHC_theme';
    const STORAGE_KEY_SYNC = 'pickHC_syncEnabled';
    const STORAGE_KEY_FC = 'pickHC_fcCode';
    const POLL_INTERVAL_MS = 3000;
    const INITIAL_DELAY_MS = 5000;
    const WORKFORCE_REFRESH_MS = 30000;
    const FANS_API_URL = 'https://fans-iad.amazon.com/api/message/new';

    // Auto-update settings
    const SCRIPT_VERSION = '3.5';
    const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/ttuyen099/ob-pick-center/main/ob-pick-center.user.js';
    const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour
    const STORAGE_KEY_LAST_UPDATE_CHECK = 'pickHC_lastUpdateCheck';
    const STORAGE_KEY_SKIP_VERSION = 'pickHC_skipVersion';

    // Extract FC code from URL (e.g., rodeo-iad.amazon.com/HOU8/ExSD...)
    const FC_CODE = GM_getValue(STORAGE_KEY_FC, '') || (() => {
        const match = window.location.pathname.match(/^\/([A-Z]{3}\d+)\//i);
        return match ? match[1].toUpperCase() : 'HOU8';
    })();

    const WORKFORCE_API_BASE = `https://picking-console.na.picking.aft.a2z.com/api/fcs/${FC_CODE}`;

    // Theme definitions
    const THEMES = {
        dark: {
            panelBg: '#1e1e1e',
            headerBg: '#2d2d2d',
            headerColor: '#fff',
            tableBg: '#1e1e1e',
            thBg: '#2d2d2d',
            thColor: '#ccc',
            rowBorder: '#3a3a3a',
            rowHover: '#2a2a2a',
            ppColor: '#fff',
            inputBg: '#333',
            inputBorder: '#555',
            inputColor: '#fff',
            inputFocusBorder: '#888',
            inputFocusBg: '#3a3a3a',
            totalRowBg: '#2d2d2d',
            totalRowBorder: '#888',
            totalColor: '#fff',
            statusBorder: '#3a3a3a',
            statusColor: '#999',
            btnBorder: '#666',
            btnColor: '#ccc',
            btnHoverBg: '#444',
            border: '#444',
            shadow: 'rgba(0,0,0,0.5)',
            expandBg: '#252525',
            expandBorder: '#3a3a3a',
            activeDot: '#4caf50',
            inactiveDot: '#f44336',
            pickerColor: '#ddd',
            pickerHover: '#333',
            checkboxBorder: '#666',
            fansBtnBg: '#1565c0',
            fansBtnHover: '#1976d2',
            fansInputBg: '#333',
            fansInputBorder: '#555',
            fansInputColor: '#fff'
        },
        light: {
            panelBg: '#ffffff',
            headerBg: '#f5f5f5',
            headerColor: '#222',
            tableBg: '#ffffff',
            thBg: '#f0f0f0',
            thColor: '#555',
            rowBorder: '#e0e0e0',
            rowHover: '#f9f9f9',
            ppColor: '#222',
            inputBg: '#fff',
            inputBorder: '#ccc',
            inputColor: '#222',
            inputFocusBorder: '#666',
            inputFocusBg: '#f0f8ff',
            totalRowBg: '#f0f0f0',
            totalRowBorder: '#999',
            totalColor: '#222',
            statusBorder: '#e0e0e0',
            statusColor: '#888',
            btnBorder: '#bbb',
            btnColor: '#555',
            btnHoverBg: '#e8e8e8',
            border: '#ccc',
            shadow: 'rgba(0,0,0,0.15)',
            expandBg: '#f8f8f8',
            expandBorder: '#e0e0e0',
            activeDot: '#2e7d32',
            inactiveDot: '#c62828',
            pickerColor: '#333',
            pickerHover: '#eee',
            checkboxBorder: '#bbb',
            fansBtnBg: '#1976d2',
            fansBtnHover: '#1e88e5',
            fansInputBg: '#fff',
            fansInputBorder: '#ccc',
            fansInputColor: '#222'
        }
    };

    let currentTheme = GM_getValue(STORAGE_KEY_THEME, 'dark');
    let processPaths = [];
    let actuals = {};
    let isConnected = false;
    let syncEnabled = GM_getValue(STORAGE_KEY_SYNC, false);
    let workforceData = {}; // { processPath: { pickers: [{login, active}], lastUpdated } }
    let expandedPaths = {}; // tracks which paths are expanded

    function getTheme() { return THEMES[currentTheme]; }


    // ===== CSS STYLES =====
    GM_addStyle(`
        #pick-hc-panel {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 99999;
            border-radius: 6px;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            min-width: 360px;
            max-width: 500px;
            border: 1px solid;
        }
        #pick-hc-panel .panel-header {
            padding: 8px 12px;
            border-radius: 6px 6px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
        }
        #pick-hc-panel .panel-header h3 {
            margin: 0;
            font-size: 13px;
            font-weight: 600;
        }
        #pick-hc-panel .panel-header .btn-group {
            display: flex;
            gap: 6px;
        }
        #pick-hc-panel .panel-header button {
            background: none;
            cursor: pointer;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            border: 1px solid;
        }
        #pick-hc-panel .panel-body {
            padding: 0;
            max-height: 75vh;
            overflow-y: auto;
            position: relative;
        }
        #pick-hc-panel.collapsed .panel-body,
        #pick-hc-panel.collapsed .status-bar {
            display: none;
        }
        #pick-hc-table {
            width: 100%;
            border-collapse: collapse;
        }
        #pick-hc-table thead th {
            padding: 6px 8px;
            text-align: center;
            font-weight: 600;
            font-size: 11px;
            border-bottom: 2px solid;
            position: sticky;
            top: 0;
            z-index: 1;
        }
        #pick-hc-table thead th:first-child {
            text-align: left;
        }
        #pick-hc-table tbody tr {
            border-bottom: 1px solid;
        }
        #pick-hc-table tbody td {
            padding: 3px 6px;
            text-align: center;
        }
        #pick-hc-table tbody td:first-child {
            text-align: left;
            font-weight: 500;
            padding-left: 8px;
            white-space: nowrap;
        }
        #pick-hc-table tbody td input[type="number"] {
            width: 45px;
            text-align: center;
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 12px;
            border: 1px solid;
        }
        #pick-hc-table tbody td input:focus {
            outline: none;
        }
        #pick-hc-table .delta-positive {
            background: #1b5e20;
            color: #a5d6a7;
            font-weight: bold;
            border-radius: 3px;
            padding: 2px 6px;
            display: inline-block;
            min-width: 30px;
        }
        #pick-hc-table .delta-negative {
            background: #b71c1c;
            color: #ffcdd2;
            font-weight: bold;
            border-radius: 3px;
            padding: 2px 6px;
            display: inline-block;
            min-width: 30px;
        }
        #pick-hc-table .delta-zero {
            color: #888;
            display: inline-block;
            min-width: 30px;
        }
        #pick-hc-table .total-row {
            font-weight: bold;
        }
        #pick-hc-table .total-row td {
            padding: 6px 8px;
            border-top: 2px solid;
        }
        #pick-hc-panel .status-bar {
            padding: 4px 10px;
            font-size: 10px;
            border-top: 1px solid;
            display: flex;
            justify-content: space-between;
        }
        #pick-hc-panel .status-bar .status-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 4px;
            vertical-align: middle;
        }
        #pick-hc-panel .status-bar .connected { background: #4caf50; }
        #pick-hc-panel .status-bar .disconnected { background: #f44336; }
        #pick-hc-panel .snip-toast {
            position: absolute;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: #4caf50;
            color: #fff;
            padding: 6px 14px;
            border-radius: 4px;
            font-size: 11px;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
        }
        #pick-hc-panel .snip-toast.show {
            opacity: 1;
        }

        /* Workforce expand button */
        .wf-expand-btn {
            cursor: pointer;
            font-size: 10px;
            margin-left: 4px;
            padding: 1px 4px;
            border-radius: 3px;
            border: 1px solid;
            background: none;
            vertical-align: middle;
            transition: transform 0.2s;
        }
        .wf-expand-btn.expanded {
            transform: rotate(90deg);
        }

        /* Workforce detail row */
        .wf-detail-row td {
            padding: 0 !important;
        }
        .wf-detail-container {
            padding: 6px 10px;
            border-radius: 4px;
            margin: 4px 6px;
            max-height: 200px;
            overflow-y: auto;
        }
        .wf-picker-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .wf-picker-item {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .wf-picker-item:hover {
            opacity: 0.85;
        }
        .wf-picker-item input[type="checkbox"] {
            width: 12px;
            height: 12px;
            margin: 0;
            cursor: pointer;
        }
        .wf-status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            display: inline-block;
            flex-shrink: 0;
        }
        .wf-status-dot.active { background: #4caf50; }
        .wf-status-dot.inactive { background: #f44336; }
        .wf-picker-login {
            font-size: 11px;
            font-family: monospace;
        }

        /* FANS messaging */
        .wf-actions-bar {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid;
        }
        .wf-fans-input {
            flex: 1;
            padding: 3px 6px;
            border-radius: 3px;
            border: 1px solid;
            font-size: 11px;
        }
        .wf-fans-btn {
            padding: 3px 8px;
            border: none;
            border-radius: 3px;
            color: #fff;
            font-size: 11px;
            cursor: pointer;
            white-space: nowrap;
        }
        .wf-fans-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .wf-select-all-btn {
            font-size: 10px;
            padding: 2px 5px;
            border-radius: 3px;
            border: 1px solid;
            background: none;
            cursor: pointer;
        }
        .wf-header-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }
        .wf-count-label {
            font-size: 10px;
            opacity: 0.7;
        }
        .wf-loading {
            font-size: 11px;
            padding: 8px;
            text-align: center;
            opacity: 0.6;
        }
        .wf-error {
            font-size: 11px;
            padding: 8px;
            text-align: center;
            color: #f44336;
        }
        .wf-fans-toast {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 4px;
        }
        .wf-fans-toast.success { background: #1b5e20; color: #a5d6a7; }
        .wf-fans-toast.error { background: #b71c1c; color: #ffcdd2; }

        /* FC code input */
        .fc-code-input {
            width: 50px;
            text-align: center;
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            border: 1px solid;
            margin-left: 6px;
            text-transform: uppercase;
        }

        /* Direct FANS messaging section */
        .direct-fans-section {
            padding: 8px 10px;
            border-top: 2px solid;
        }
        .direct-fans-title {
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .direct-fans-row {
            display: flex;
            gap: 6px;
            margin-bottom: 4px;
            align-items: center;
        }
        .direct-fans-login-input {
            width: 90px;
            padding: 4px 6px;
            border-radius: 3px;
            border: 1px solid;
            font-size: 11px;
            font-family: monospace;
        }
        .direct-fans-msg-input {
            flex: 1;
            padding: 4px 6px;
            border-radius: 3px;
            border: 1px solid;
            font-size: 11px;
        }
        .direct-fans-send-btn {
            padding: 4px 10px;
            border: none;
            border-radius: 3px;
            color: #fff;
            font-size: 11px;
            cursor: pointer;
            white-space: nowrap;
            font-weight: 500;
        }
        .direct-fans-send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .direct-fans-status {
            font-size: 10px;
            padding: 3px 6px;
            border-radius: 3px;
            margin-top: 2px;
            display: none;
        }
        .direct-fans-status.show {
            display: block;
        }
        .direct-fans-status.success {
            background: #1b5e20;
            color: #a5d6a7;
        }
        .direct-fans-status.error {
            background: #b71c1c;
            color: #ffcdd2;
        }
        .direct-fans-status.retrying {
            background: #e65100;
            color: #ffe0b2;
        }

        /* Update notification banner */
        .hc-update-banner {
            padding: 10px 12px;
            background: #1a237e;
            border-bottom: 2px solid #3f51b5;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .hc-update-banner .update-title {
            font-size: 12px;
            font-weight: 600;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .hc-update-banner .update-msg {
            font-size: 11px;
            color: #c5cae9;
        }
        .hc-update-banner .update-actions {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .hc-update-banner .update-btn {
            padding: 4px 12px;
            border-radius: 3px;
            border: none;
            font-size: 11px;
            cursor: pointer;
            font-weight: 500;
        }
        .hc-update-banner .update-btn.primary {
            background: #4caf50;
            color: #fff;
        }
        .hc-update-banner .update-btn.primary:hover {
            background: #66bb6a;
        }
        .hc-update-banner .update-btn.secondary {
            background: none;
            border: 1px solid #7986cb;
            color: #c5cae9;
        }
        .hc-update-banner .update-btn.secondary:hover {
            background: #283593;
        }
        .hc-update-blocked-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.85);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 0 0 6px 6px;
        }
        .hc-update-blocked-msg {
            background: #1a237e;
            border: 2px solid #3f51b5;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            max-width: 300px;
        }
        .hc-update-blocked-msg h4 {
            color: #fff;
            margin: 0 0 8px 0;
            font-size: 14px;
        }
        .hc-update-blocked-msg p {
            color: #c5cae9;
            margin: 0 0 12px 0;
            font-size: 12px;
        }
        .hc-update-blocked-msg .update-btn {
            padding: 6px 16px;
            border-radius: 4px;
            border: none;
            font-size: 12px;
            cursor: pointer;
            font-weight: 600;
            background: #4caf50;
            color: #fff;
        }
        .hc-update-blocked-msg .update-btn:hover {
            background: #66bb6a;
        }
    `);


    // ===== CORE FUNCTIONS =====

    function loadPlanData() {
        try { return JSON.parse(GM_getValue(STORAGE_KEY, '{}')); } catch(e) { return {}; }
    }
    function savePlanData(data) { GM_setValue(STORAGE_KEY, JSON.stringify(data)); }
    function loadActualsData() {
        try { return JSON.parse(GM_getValue(STORAGE_KEY_ACTUALS, '{}')); } catch(e) { return {}; }
    }
    function saveActualsData(data) { GM_setValue(STORAGE_KEY_ACTUALS, JSON.stringify(data)); }

    function readPickersFromTable() {
        const table = document.getElementById('PickingNotYetPickedTable');
        if (!table) return false;

        const foundPaths = [];
        const foundActuals = {};
        let foundAny = false;

        const rows = table.querySelectorAll('tbody tr:not(.header-row)');
        rows.forEach(row => {
            const thEl = row.querySelector('th:first-child');
            if (!thEl) return;
            const ppName = thEl.textContent.trim();
            if (!ppName || ppName.toLowerCase() === 'total') return;

            const ppLower = ppName.toLowerCase();
            foundPaths.push(ppName);

            const pickerCell = row.querySelector(`td.pickers_${ppLower}`);
            if (pickerCell) {
                const val = parseInt(pickerCell.textContent.trim(), 10);
                foundActuals[ppName] = isNaN(val) ? 0 : val;
                if (!isNaN(val) && val > 0) foundAny = true;
            } else {
                foundActuals[ppName] = 0;
            }
        });

        if (foundPaths.length > 0) {
            processPaths = foundPaths;
            const manualActuals = loadActualsData();
            foundPaths.forEach(pp => {
                if (foundActuals[pp] > 0) {
                    actuals[pp] = foundActuals[pp];
                } else {
                    actuals[pp] = manualActuals[pp] || 0;
                }
            });
            isConnected = foundAny;
            return true;
        }
        return false;
    }

    function applyTheme() {
        const t = getTheme();
        const panel = document.getElementById('pick-hc-panel');
        if (!panel) return;

        panel.style.background = t.panelBg;
        panel.style.borderColor = t.border;
        panel.style.boxShadow = `0 4px 16px ${t.shadow}`;

        const header = panel.querySelector('.panel-header');
        if (header) {
            header.style.background = t.headerBg;
            header.querySelector('h3').style.color = t.headerColor;
        }

        panel.querySelectorAll('.panel-header button').forEach(btn => {
            if (!btn.id || btn.id === 'hc-collapse-btn' || btn.id === 'hc-snip-btn' || btn.id === 'hc-reset-btn' || btn.id === 'hc-theme-btn') {
                btn.style.borderColor = t.btnBorder;
                btn.style.color = t.btnColor;
            }
        });

        const thCells = panel.querySelectorAll('#pick-hc-table thead th');
        thCells.forEach(th => {
            th.style.background = t.thBg;
            th.style.color = t.thColor;
            th.style.borderBottomColor = t.border;
        });

        const rows = panel.querySelectorAll('#pick-hc-table tbody tr:not(.total-row):not(.wf-detail-row)');
        rows.forEach(row => {
            row.style.borderBottomColor = t.rowBorder;
            const ppCell = row.querySelector('td:first-child');
            if (ppCell) ppCell.style.color = t.ppColor;
        });

        panel.querySelectorAll('#pick-hc-table tbody td input[type="number"]').forEach(input => {
            input.style.background = t.inputBg;
            input.style.borderColor = t.inputBorder;
            input.style.color = t.inputColor;
        });

        const totalRow = panel.querySelector('.total-row');
        if (totalRow) {
            totalRow.style.background = t.totalRowBg;
            totalRow.style.borderTopColor = t.totalRowBorder;
            totalRow.querySelectorAll('td').forEach(td => { td.style.color = t.totalColor; });
        }

        const statusBar = panel.querySelector('.status-bar');
        if (statusBar) {
            statusBar.style.borderTopColor = t.statusBorder;
            statusBar.style.color = t.statusColor;
        }

        // Style workforce detail containers
        panel.querySelectorAll('.wf-detail-container').forEach(container => {
            container.style.background = t.expandBg;
            container.style.borderColor = t.expandBorder;
            container.style.border = `1px solid ${t.expandBorder}`;
        });
        panel.querySelectorAll('.wf-picker-login').forEach(el => {
            el.style.color = t.pickerColor;
        });
        panel.querySelectorAll('.wf-expand-btn').forEach(btn => {
            btn.style.borderColor = t.btnBorder;
            btn.style.color = t.btnColor;
        });
        panel.querySelectorAll('.wf-fans-input').forEach(input => {
            input.style.background = t.fansInputBg;
            input.style.borderColor = t.fansInputBorder;
            input.style.color = t.fansInputColor;
        });
        panel.querySelectorAll('.wf-fans-btn').forEach(btn => {
            btn.style.background = t.fansBtnBg;
        });
        panel.querySelectorAll('.wf-actions-bar').forEach(bar => {
            bar.style.borderTopColor = t.expandBorder;
        });
        panel.querySelectorAll('.wf-select-all-btn').forEach(btn => {
            btn.style.borderColor = t.btnBorder;
            btn.style.color = t.btnColor;
        });
        panel.querySelectorAll('.wf-count-label').forEach(el => {
            el.style.color = t.statusColor;
        });
        panel.querySelectorAll('.fc-code-input').forEach(input => {
            input.style.background = t.inputBg;
            input.style.borderColor = t.inputBorder;
            input.style.color = t.inputColor;
        });

        // Style direct FANS section
        const directFansSection = panel.querySelector('.direct-fans-section');
        if (directFansSection) {
            directFansSection.style.borderTopColor = t.border;
        }
        panel.querySelectorAll('.direct-fans-title').forEach(el => {
            el.style.color = t.ppColor;
        });
        panel.querySelectorAll('.direct-fans-login-input, .direct-fans-msg-input').forEach(input => {
            input.style.background = t.fansInputBg;
            input.style.borderColor = t.fansInputBorder;
            input.style.color = t.fansInputColor;
        });
        panel.querySelectorAll('.direct-fans-send-btn').forEach(btn => {
            btn.style.background = t.fansBtnBg;
        });

        const themeBtn = document.getElementById('hc-theme-btn');
        if (themeBtn) themeBtn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    }


    // ===== WORKFORCE API & FANS MESSAGING =====

    function fetchWorkforceData(processPath) {
        return new Promise((resolve, reject) => {
            const fcCode = GM_getValue(STORAGE_KEY_FC, FC_CODE);
            const apiUrl = `https://picking-console.na.picking.aft.a2z.com/api/fcs/${fcCode}/process-paths/information`;

            gmXHR({
                method: 'GET',
                url: apiUrl,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            const ppInfo = data.processPathInformationMap || data;
                            resolve(ppInfo);
                        } catch(e) {
                            reject(new Error('Failed to parse workforce response'));
                        }
                    } else {
                        reject(new Error(`API returned ${response.status}`));
                    }
                },
                onerror: function(err) {
                    reject(new Error('Network error fetching workforce data'));
                }
            });
        });
    }

    function fetchPickerDetails(processPath) {
        return new Promise((resolve, reject) => {
            const fcCode = GM_getValue(STORAGE_KEY_FC, FC_CODE);
            const apiUrl = `https://picking-console.na.picking.aft.a2z.com/api/fcs/${fcCode}/workforce`;

            gmXHR({
                method: 'GET',
                url: apiUrl,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            const pickers = data.pickerStatusList || [];

                            // Build workforce data per process path
                            const workforceMap = {};
                            pickers.forEach(picker => {
                                const pp = picker.processPath || '';
                                const login = picker.userId || '';
                                const isActive = picker.active === true;
                                const name = picker.name || '';

                                if (!pp || !login) return;

                                if (!workforceMap[pp]) {
                                    workforceMap[pp] = { pickers: [], lastUpdated: Date.now() };
                                }
                                workforceMap[pp].pickers.push({
                                    login,
                                    active: isActive,
                                    name,
                                    lastActivity: picker.lastActivityTime,
                                    location: picker.location || ''
                                });
                            });

                            workforceData = workforceMap;
                            resolve(workforceMap);
                        } catch(e) {
                            reject(new Error('Failed to parse workforce data: ' + e.message));
                        }
                    } else if (response.status === 401 || response.status === 403) {
                        reject(new Error('Auth required — log into Picking Console first'));
                    } else {
                        reject(new Error(`Workforce API returned ${response.status}`));
                    }
                },
                onerror: function(err) {
                    reject(new Error('Network error fetching workforce data'));
                }
            });
        });
    }

    function sendFANSMessage(logins, message, attempt = 1, maxRetries = 5) {
        return new Promise((resolve, reject) => {
            if (!logins || logins.length === 0 || !message.trim()) {
                reject(new Error('No recipients or message'));
                return;
            }

            // FANS API accepts one login at a time via "to" field
            // Send to each login sequentially
            let sentCount = 0;
            let lastError = null;

            async function sendToAll() {
                for (const login of logins) {
                    let success = false;
                    let attempts = 0;

                    while (!success && attempts < maxRetries) {
                        attempts++;
                        try {
                            await sendSingleFAN(login, message.trim());
                            success = true;
                            sentCount++;
                        } catch(err) {
                            lastError = err;
                            if (attempts < maxRetries) {
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    }
                }

                if (sentCount > 0) {
                    resolve({ success: true, sent: sentCount, attempts: 1 });
                } else {
                    reject(lastError || new Error('Failed to send'));
                }
            }

            sendToAll();
        });
    }

    function sendSingleFAN(login, message) {
        return new Promise((resolve, reject) => {
            gmXHR({
                method: 'POST',
                url: FANS_API_URL,
                headers: {
                    'Content-Type': 'application/json;charset=utf-8',
                    'Accept': 'application/json, text/plain, */*'
                },
                anonymous: false,
                withCredentials: true,
                data: JSON.stringify({
                    to: login,
                    directReports: '',
                    messageText: message
                }),
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        // Check for explicit failure in response body
                        if (response.responseText) {
                            try {
                                const data = JSON.parse(response.responseText);
                                if (data.success === false || data.ok === false || data.error || data.errors) {
                                    reject(new Error(data.message || data.error || 'FANS reported failure'));
                                    return;
                                }
                            } catch(e) {
                                // Non-JSON 2xx response is still success
                            }
                        }
                        resolve({ status: response.status });
                    } else {
                        reject(new Error(`FANS returned ${response.status}`));
                    }
                },
                onerror: function(err) {
                    reject(new Error('Network error sending FANS'));
                },
                ontimeout: function() {
                    reject(new Error('FANS request timed out'));
                }
            });
        });
    }

    // Version with progress callback for UI updates during retries
    function sendFANSMessageWithProgress(logins, message, onProgress) {
        const maxRetries = 5;

        async function sendAll() {
            let sentCount = 0;
            let totalAttempts = 0;

            for (const login of logins) {
                let success = false;
                let attempts = 0;

                while (!success && attempts < maxRetries) {
                    attempts++;
                    totalAttempts = attempts;
                    if (onProgress) onProgress({ status: 'trying', attempt: attempts, maxRetries });

                    try {
                        await sendSingleFAN(login, message.trim());
                        success = true;
                        sentCount++;
                    } catch(err) {
                        if (attempts < maxRetries) {
                            if (onProgress) onProgress({ status: 'retrying', attempt: attempts, maxRetries, error: err.message });
                            await new Promise(r => setTimeout(r, 2000));
                        } else {
                            if (onProgress) onProgress({ status: 'retrying', attempt: attempts, maxRetries, error: err.message });
                        }
                    }
                }
            }

            if (sentCount > 0) {
                return { success: true, sent: sentCount, attempts: totalAttempts };
            } else {
                throw new Error(`Failed after ${maxRetries} attempts`);
            }
        }

        return sendAll();
    }

    async function loadWorkforceForPath(processPath) {
        const container = document.getElementById(`wf-container-${CSS.escape(processPath)}`);
        if (!container) return;

        container.innerHTML = '<div class="wf-loading">⏳ Loading pickers...</div>';

        try {
            // If we don't have data yet or it's stale (>30s), fetch fresh
            if (!workforceData[processPath] || (Date.now() - (workforceData[processPath].lastUpdated || 0)) > WORKFORCE_REFRESH_MS) {
                await fetchPickerDetails(processPath);
            }

            const ppData = workforceData[processPath];
            if (!ppData || ppData.pickers.length === 0) {
                container.innerHTML = '<div class="wf-loading">No pickers found for this path</div>';
                return;
            }

            renderPickerList(processPath, ppData.pickers, container);
        } catch(err) {
            container.innerHTML = `<div class="wf-error">⚠️ ${err.message}</div>`;
        }
    }

    function renderPickerList(processPath, pickers, container) {
        const t = getTheme();
        const activePickers = pickers.filter(p => p.active);
        const inactivePickers = pickers.filter(p => !p.active);
        const sortedPickers = [...activePickers, ...inactivePickers];

        let html = `<div class="wf-header-bar">
            <span class="wf-count-label">👥 ${pickers.length} total | ✅ ${activePickers.length} active | ❌ ${inactivePickers.length} inactive</span>
            <button class="wf-select-all-btn" data-pp="${processPath}">Select All</button>
        </div>`;

        html += '<ul class="wf-picker-list">';
        sortedPickers.forEach(picker => {
            html += `<li class="wf-picker-item" data-login="${picker.login}" data-pp="${processPath}">
                <input type="checkbox" class="wf-picker-check" data-login="${picker.login}" data-pp="${processPath}">
                <span class="wf-status-dot ${picker.active ? 'active' : 'inactive'}"></span>
                <span class="wf-picker-login">${picker.login}</span>
            </li>`;
        });
        html += '</ul>';

        html += `<div class="wf-actions-bar">
            <input type="text" class="wf-fans-input" placeholder="Type FANS message..." data-pp="${processPath}">
            <button class="wf-fans-btn" data-pp="${processPath}">📨 Send</button>
        </div>`;

        container.innerHTML = html;

        // Attach event listeners
        container.querySelector('.wf-select-all-btn').addEventListener('click', (e) => {
            const checks = container.querySelectorAll('.wf-picker-check');
            const allChecked = Array.from(checks).every(c => c.checked);
            checks.forEach(c => c.checked = !allChecked);
            e.target.textContent = allChecked ? 'Select All' : 'Deselect All';
        });

        container.querySelector('.wf-fans-btn').addEventListener('click', async (e) => {
            const btn = e.target;
            const input = container.querySelector('.wf-fans-input');
            const message = input.value.trim();
            const checkedLogins = Array.from(container.querySelectorAll('.wf-picker-check:checked'))
                .map(c => c.dataset.login);

            if (checkedLogins.length === 0) {
                showFansToast(container, 'Select at least 1 picker', 'error');
                return;
            }
            if (!message) {
                showFansToast(container, 'Enter a message', 'error');
                return;
            }

            btn.disabled = true;
            btn.textContent = '⏳ Attempt 1...';

            try {
                const result = await sendFANSMessageWithProgress(checkedLogins, message, (progress) => {
                    if (progress.status === 'trying') {
                        btn.textContent = `⏳ Attempt ${progress.attempt}/${progress.maxRetries}...`;
                    } else if (progress.status === 'retrying') {
                        btn.textContent = `🔄 Retry ${progress.attempt}/${progress.maxRetries}...`;
                        showFansToast(container, `⚠️ Attempt ${progress.attempt} failed (${progress.error}), retrying...`, 'error');
                    }
                });
                showFansToast(container, `✅ Sent to ${result.sent} picker(s) after ${result.attempts} attempt(s)`, 'success');
                input.value = '';
                container.querySelectorAll('.wf-picker-check').forEach(c => c.checked = false);
            } catch(err) {
                showFansToast(container, `❌ ${err.message}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = '📨 Send';
            }
        });

        // Allow Enter key in input to send
        container.querySelector('.wf-fans-input').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                container.querySelector('.wf-fans-btn').click();
            }
        });

        applyTheme();
    }

    function showFansToast(container, message, type) {
        let toast = container.querySelector('.wf-fans-toast');
        if (toast) toast.remove();

        toast = document.createElement('span');
        toast.className = `wf-fans-toast ${type}`;
        toast.textContent = message;
        container.querySelector('.wf-actions-bar').appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    async function handleDirectFansSend() {
        const loginInput = document.getElementById('direct-fans-login');
        const msgInput = document.getElementById('direct-fans-msg');
        const btn = document.getElementById('direct-fans-send-btn');
        const statusEl = document.getElementById('direct-fans-status');

        const rawLogins = loginInput.value.trim();
        const message = msgInput.value.trim();

        if (!rawLogins) {
            showDirectFansStatus('Enter at least one login', 'error');
            loginInput.focus();
            return;
        }
        if (!message) {
            showDirectFansStatus('Enter a message', 'error');
            msgInput.focus();
            return;
        }

        // Parse comma/space separated logins
        const logins = rawLogins.split(/[\s,;]+/).map(l => l.trim()).filter(l => l.length > 0);
        if (logins.length === 0) {
            showDirectFansStatus('Enter at least one valid login', 'error');
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ Attempt 1...';
        showDirectFansStatus(`📨 Sending to ${logins.join(', ')}...`, 'retrying');

        try {
            const result = await sendFANSMessageWithProgress(logins, message, (progress) => {
                if (progress.status === 'trying') {
                    btn.textContent = `⏳ Attempt ${progress.attempt}/${progress.maxRetries}...`;
                    showDirectFansStatus(`📨 Attempt ${progress.attempt}/${progress.maxRetries}...`, 'retrying');
                } else if (progress.status === 'retrying') {
                    btn.textContent = `🔄 Retry ${progress.attempt}/${progress.maxRetries}...`;
                    showDirectFansStatus(`⚠️ Attempt ${progress.attempt} failed (${progress.error}), retrying...`, 'retrying');
                }
            });

            const attemptsText = result.attempts > 1 ? ` after ${result.attempts} attempt(s)` : '';
            showDirectFansStatus(`✅ Message sent to ${logins.join(', ')}${attemptsText}`, 'success');
            msgInput.value = '';
            // Keep login in case user wants to send another message to the same person
        } catch(err) {
            showDirectFansStatus(`❌ ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '📨 Send';
        }
    }

    function showDirectFansStatus(message, type) {
        const statusEl = document.getElementById('direct-fans-status');
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.className = `direct-fans-status show ${type}`;

        // Auto-hide success after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                statusEl.classList.remove('show');
            }, 5000);
        }
    }


    // ===== PANEL CREATION & TABLE RENDERING =====

    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'pick-hc-panel';

        const storedFc = GM_getValue(STORAGE_KEY_FC, FC_CODE);

        panel.innerHTML = `
            <div class="panel-header" id="hc-drag-handle">
                <h3>📋 OB Pick Center
                    <input type="text" class="fc-code-input" id="hc-fc-input" value="${storedFc}" maxlength="5" title="FC Code (e.g. HOU8)" placeholder="FC">
                </h3>
                <div class="btn-group">
                    <button id="hc-sync-btn" title="Toggle auto-sync from Rodeo">🔄</button>
                    <button id="hc-theme-btn" title="Toggle light/dark mode">☀️</button>
                    <button id="hc-snip-btn" title="Snip to clipboard">📸</button>
                    <button id="hc-reset-btn" title="Reset all values to 0">Reset</button>
                    <button id="hc-collapse-btn" title="Collapse/Expand">−</button>
                </div>
            </div>
            <div class="panel-body" id="hc-panel-body">
                <table id="pick-hc-table">
                    <thead>
                        <tr>
                            <th></th>
                            <th>Plan HC</th>
                            <th>Actuals</th>
                            <th>Δ</th>
                        </tr>
                    </thead>
                    <tbody id="hc-table-body">
                        <tr><td colspan="4" style="text-align:center; padding:12px; color:#888;">Waiting for Pickers data...</td></tr>
                    </tbody>
                </table>
                <div class="direct-fans-section" id="direct-fans-section">
                    <div class="direct-fans-title">📨 Direct FANS Message <span style="opacity:0.6; font-weight:normal;">(send to any associate)</span></div>
                    <div class="direct-fans-row">
                        <input type="text" class="direct-fans-login-input" id="direct-fans-login" placeholder="Login(s)" title="Enter login(s) separated by commas">
                        <input type="text" class="direct-fans-msg-input" id="direct-fans-msg" placeholder="Type message...">
                        <button class="direct-fans-send-btn" id="direct-fans-send-btn">📨 Send</button>
                    </div>
                    <div class="direct-fans-status" id="direct-fans-status"></div>
                </div>
            </div>
            <div class="status-bar">
                <span><span class="status-dot disconnected" id="hc-status-dot"></span><span id="hc-status-text">Waiting...</span></span>
                <span id="hc-refresh-time"></span>
                <span id="hc-version-badge" style="font-size:9px; padding:1px 5px; border-radius:3px; background:#1b5e20; color:#a5d6a7;">✅ v${SCRIPT_VERSION}</span>
                <span style="opacity:0.4; font-size:9px; font-style:italic;">created by ttuyen</span>
            </div>
            <div class="snip-toast" id="hc-snip-toast">📋 Copied to clipboard!</div>
        `;

        document.body.appendChild(panel);

        // FC Code input handler
        document.getElementById('hc-fc-input').addEventListener('change', (e) => {
            const val = e.target.value.trim().toUpperCase();
            if (val.length >= 3) {
                GM_setValue(STORAGE_KEY_FC, val);
                // Clear workforce cache when FC changes
                workforceData = {};
                expandedPaths = {};
            }
        });

        document.getElementById('hc-collapse-btn').addEventListener('click', () => {
            panel.classList.toggle('collapsed');
            document.getElementById('hc-collapse-btn').textContent =
                panel.classList.contains('collapsed') ? '+' : '−';
        });

        document.getElementById('hc-reset-btn').addEventListener('click', () => {
            if (confirm('Reset all values to 0?')) {
                savePlanData({});
                saveActualsData({});
                actuals = {};
                processPaths.forEach(pp => { actuals[pp] = 0; });
                renderTable();
            }
        });

        document.getElementById('hc-snip-btn').addEventListener('click', snipPanel);

        document.getElementById('hc-theme-btn').addEventListener('click', () => {
            currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
            GM_setValue(STORAGE_KEY_THEME, currentTheme);
            applyTheme();
        });

        document.getElementById('hc-sync-btn').addEventListener('click', () => {
            syncEnabled = !syncEnabled;
            GM_setValue(STORAGE_KEY_SYNC, syncEnabled);
            updateSyncButton();
            if (syncEnabled) {
                readPickersFromTable();
                renderTable();
            }
        });

        // Direct FANS send handler
        document.getElementById('direct-fans-send-btn').addEventListener('click', handleDirectFansSend);
        document.getElementById('direct-fans-msg').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleDirectFansSend();
        });
        document.getElementById('direct-fans-login').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') document.getElementById('direct-fans-msg').focus();
        });

        makeDraggable(panel, document.getElementById('hc-drag-handle'));
        applyTheme();
        updateSyncButton();
    }

    function updateSyncButton() {
        const btn = document.getElementById('hc-sync-btn');
        if (btn) {
            if (syncEnabled) {
                btn.style.background = '#2e7d32';
                btn.style.color = '#fff';
                btn.style.borderColor = '#4caf50';
                btn.title = 'Auto-sync ON (click to disable)';
            } else {
                btn.style.background = '#b71c1c';
                btn.style.color = '#fff';
                btn.style.borderColor = '#f44336';
                btn.title = 'Auto-sync OFF (click to enable)';
            }
        }
    }

    function renderTable() {
        const tbody = document.getElementById('hc-table-body');
        if (!tbody || processPaths.length === 0) return;

        const planData = loadPlanData();
        let totalPlan = 0, totalActuals = 0;
        let html = '';

        processPaths.forEach(pp => {
            const plan = planData[pp] || 0;
            const actual = actuals[pp] || 0;
            const delta = actual - plan;
            totalPlan += plan;
            totalActuals += actual;

            let deltaClass = 'delta-zero';
            if (delta > 0) deltaClass = 'delta-positive';
            else if (delta < 0) deltaClass = 'delta-negative';

            const isExpanded = expandedPaths[pp] || false;

            html += `<tr data-pp="${pp}">
                <td>
                    ${pp}
                    <button class="wf-expand-btn ${isExpanded ? 'expanded' : ''}" data-pp="${pp}" title="View pickers in ${pp}">▶</button>
                </td>
                <td><input type="number" class="plan-input" data-pp="${pp}" value="${plan}" min="0" step="1"></td>
                <td><input type="number" class="actuals-input" data-pp="${pp}" value="${actual}" min="0" step="1"></td>
                <td><span class="${deltaClass}">${delta.toFixed(1)}</span></td>
            </tr>`;

            // Workforce detail row (hidden unless expanded)
            html += `<tr class="wf-detail-row" id="wf-row-${CSS.escape(pp)}" style="display:${isExpanded ? 'table-row' : 'none'};">
                <td colspan="4">
                    <div class="wf-detail-container" id="wf-container-${CSS.escape(pp)}">
                        ${isExpanded ? '<div class="wf-loading">⏳ Loading...</div>' : ''}
                    </div>
                </td>
            </tr>`;
        });

        const totalDelta = totalActuals - totalPlan;
        let totalDeltaClass = 'delta-zero';
        if (totalDelta > 0) totalDeltaClass = 'delta-positive';
        else if (totalDelta < 0) totalDeltaClass = 'delta-negative';

        html += `<tr class="total-row">
            <td>Total</td>
            <td>${totalPlan}</td>
            <td>${totalActuals}</td>
            <td><span class="${totalDeltaClass}">${totalDelta.toFixed(1)}</span></td>
        </tr>`;

        tbody.innerHTML = html;

        // Attach input listeners
        tbody.querySelectorAll('.plan-input').forEach(input => {
            input.addEventListener('change', handlePlanChange);
            input.addEventListener('keyup', debounce(handlePlanChange, 300));
        });
        tbody.querySelectorAll('.actuals-input').forEach(input => {
            input.addEventListener('change', handleActualsChange);
            input.addEventListener('keyup', debounce(handleActualsChange, 300));
        });

        // Attach expand button listeners
        tbody.querySelectorAll('.wf-expand-btn').forEach(btn => {
            btn.addEventListener('click', handleExpandClick);
        });

        // Update status bar
        const dot = document.getElementById('hc-status-dot');
        const statusText = document.getElementById('hc-status-text');
        const refreshTime = document.getElementById('hc-refresh-time');
        if (dot) dot.className = 'status-dot ' + (isConnected && syncEnabled ? 'connected' : 'disconnected');
        if (statusText) statusText.textContent = syncEnabled ? (isConnected ? `Synced (${processPaths.length} paths)` : 'Waiting...') : 'Manual mode';
        if (refreshTime) refreshTime.textContent = 'Last refreshed: ' + new Date().toLocaleTimeString();

        applyTheme();

        // Re-load workforce data for any expanded paths
        Object.keys(expandedPaths).forEach(pp => {
            if (expandedPaths[pp]) {
                loadWorkforceForPath(pp);
            }
        });
    }

    function handleExpandClick(e) {
        const btn = e.target;
        const pp = btn.dataset.pp;
        const detailRow = document.getElementById(`wf-row-${CSS.escape(pp)}`);

        if (!detailRow) return;

        const isCurrentlyExpanded = expandedPaths[pp] || false;

        if (isCurrentlyExpanded) {
            // Collapse
            expandedPaths[pp] = false;
            detailRow.style.display = 'none';
            btn.classList.remove('expanded');
        } else {
            // Expand
            expandedPaths[pp] = true;
            detailRow.style.display = 'table-row';
            btn.classList.add('expanded');
            loadWorkforceForPath(pp);
        }
    }


    // ===== EVENT HANDLERS & UTILITIES =====

    function handlePlanChange(e) {
        const pp = e.target.dataset.pp;
        const val = parseInt(e.target.value, 10) || 0;
        const planData = loadPlanData();
        planData[pp] = val;
        savePlanData(planData);
        updateRowDelta(e.target.closest('tr'), pp);
        updateTotals();
    }

    function handleActualsChange(e) {
        const pp = e.target.dataset.pp;
        const val = parseInt(e.target.value, 10) || 0;
        actuals[pp] = val;
        const actualsData = loadActualsData();
        actualsData[pp] = val;
        saveActualsData(actualsData);
        updateRowDelta(e.target.closest('tr'), pp);
        updateTotals();
    }

    function updateRowDelta(row, pp) {
        const planData = loadPlanData();
        const plan = planData[pp] || 0;
        const actual = actuals[pp] || 0;
        const delta = actual - plan;
        const deltaSpan = row.querySelector('td:last-child span');
        if (deltaSpan) {
            deltaSpan.textContent = delta.toFixed(1);
            deltaSpan.className = delta > 0 ? 'delta-positive' : delta < 0 ? 'delta-negative' : 'delta-zero';
        }
    }

    function updateTotals() {
        const planData = loadPlanData();
        let totalPlan = 0, totalActuals = 0;
        processPaths.forEach(pp => {
            totalPlan += planData[pp] || 0;
            totalActuals += actuals[pp] || 0;
        });
        const totalDelta = totalActuals - totalPlan;
        const totalRow = document.querySelector('#pick-hc-table .total-row');
        if (totalRow) {
            const cells = totalRow.querySelectorAll('td');
            cells[1].textContent = totalPlan;
            cells[2].textContent = totalActuals;
            const tSpan = cells[3].querySelector('span');
            if (tSpan) {
                tSpan.textContent = totalDelta.toFixed(1);
                tSpan.className = totalDelta > 0 ? 'delta-positive' : totalDelta < 0 ? 'delta-negative' : 'delta-zero';
            }
        }
    }

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    async function snipPanel() {
        const panel = document.getElementById('pick-hc-panel');
        const table = document.getElementById('pick-hc-table');
        const toast = document.getElementById('hc-snip-toast');

        if (!table) return;

        try {
            // Hide workforce detail rows for clean capture
            const wfRows = panel.querySelectorAll('.wf-detail-row');
            const wfOrigDisplay = [];
            wfRows.forEach(row => {
                wfOrigDisplay.push(row.style.display);
                row.style.display = 'none';
            });

            // Replace all inputs with plain text spans
            const inputs = table.querySelectorAll('input[type="number"]');
            const inputData = [];
            inputs.forEach(input => {
                const span = document.createElement('span');
                span.textContent = input.value;
                span.style.display = 'inline-block';
                span.style.width = '45px';
                span.style.textAlign = 'center';
                span.style.fontSize = '12px';
                span.style.color = getTheme().inputColor;
                input.parentNode.replaceChild(span, input);
                inputData.push({ span, input, parent: span.parentNode });
            });

            // Hide expand buttons
            const expandBtns = table.querySelectorAll('.wf-expand-btn');
            expandBtns.forEach(btn => btn.style.display = 'none');

            const canvas = await html2canvas(table, {
                backgroundColor: getTheme().panelBg,
                scale: 2,
                logging: false
            });

            // Restore inputs
            inputData.forEach(({ span, input, parent }) => {
                parent.replaceChild(input, span);
            });

            // Restore expand buttons and workforce rows
            expandBtns.forEach(btn => btn.style.display = '');
            wfRows.forEach((row, i) => {
                row.style.display = wfOrigDisplay[i];
            });

            canvas.toBlob(async (blob) => {
                try {
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]);
                    toast.textContent = '📋 Copied to clipboard!';
                    toast.classList.add('show');
                    setTimeout(() => toast.classList.remove('show'), 2000);
                } catch(e) {
                    const url = canvas.toDataURL('image/png');
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `pick-hc-${new Date().toISOString().slice(0,16).replace(/:/g,'-')}.png`;
                    a.click();
                    toast.textContent = '💾 Downloaded!';
                    toast.classList.add('show');
                    setTimeout(() => {
                        toast.classList.remove('show');
                        toast.textContent = '📋 Copied to clipboard!';
                    }, 2000);
                }
            }, 'image/png');
        } catch(e) {
            console.error('[OB Pick Center] Snip error:', e);
        }
    }

    function makeDraggable(element, handle) {
        let offsetX = 0, offsetY = 0, isDragging = false;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            isDragging = true;
            const rect = element.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            element.style.left = (e.clientX - offsetX) + 'px';
            element.style.top = (e.clientY - offsetY) + 'px';
            element.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });
    }

    // ===== AUTO-UPDATE CHECK =====

    function compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        const len = Math.max(parts1.length, parts2.length);
        for (let i = 0; i < len; i++) {
            const a = parts1[i] || 0;
            const b = parts2[i] || 0;
            if (a > b) return 1;
            if (a < b) return -1;
        }
        return 0;
    }

    function checkForUpdate() {
        return new Promise((resolve, reject) => {
            if (!gmXHR) {
                reject(new Error('GM_xmlHttpRequest not available'));
                return;
            }

            gmXHR({
                method: 'GET',
                url: UPDATE_CHECK_URL + '?t=' + Date.now(), // cache bust
                headers: { 'Cache-Control': 'no-cache' },
                onload: function(response) {
                    if (response.status === 200) {
                        const text = response.responseText;
                        // Parse @version from the remote script header
                        const versionMatch = text.match(/@version\s+(\S+)/);
                        if (versionMatch) {
                            const remoteVersion = versionMatch[1];
                            resolve(remoteVersion);
                        } else {
                            reject(new Error('Could not parse remote version'));
                        }
                    } else {
                        reject(new Error(`Update check returned ${response.status}`));
                    }
                },
                onerror: function() {
                    reject(new Error('Network error checking for updates'));
                }
            });
        });
    }

    function showUpdateBanner(remoteVersion) {
        const panel = document.getElementById('pick-hc-panel');
        if (!panel) return;

        // Remove existing banner/overlay if any
        const existing = panel.querySelector('.hc-update-banner');
        if (existing) existing.remove();
        const existingOverlay = document.getElementById('hc-update-overlay');
        if (existingOverlay) existingOverlay.remove();

        const banner = document.createElement('div');
        banner.className = 'hc-update-banner';
        banner.innerHTML = `
            <div class="update-title">🔄 Update Available — v${remoteVersion}</div>
            <div class="update-msg">A new version of OB Pick Center is available. Please update to continue using the script.</div>
            <div class="update-actions">
                <button class="update-btn primary" id="hc-update-now-btn">⬆️ Update Now</button>
                <button class="update-btn secondary" id="hc-update-later-btn">Remind Later</button>
            </div>
        `;

        // Insert banner right after the header
        const header = panel.querySelector('.panel-header');
        if (header && header.nextSibling) {
            panel.insertBefore(banner, header.nextSibling);
        } else {
            panel.appendChild(banner);
        }

        // Block usage - overlay on panel body
        const panelBody = document.getElementById('hc-panel-body');
        if (panelBody) {
            const overlay = document.createElement('div');
            overlay.className = 'hc-update-blocked-overlay';
            overlay.id = 'hc-update-overlay';
            overlay.innerHTML = `
                <div class="hc-update-blocked-msg">
                    <h4>⚠️ Update Required</h4>
                    <p>Version ${remoteVersion} is available.<br>Current: v${SCRIPT_VERSION}</p>
                    <button class="update-btn" id="hc-update-overlay-btn">⬆️ Update Script</button>
                </div>
            `;
            panelBody.appendChild(overlay);

            document.getElementById('hc-update-overlay-btn').addEventListener('click', () => {
                window.open(UPDATE_CHECK_URL, '_blank');
            });
        }

        document.getElementById('hc-update-now-btn').addEventListener('click', () => {
            window.open(UPDATE_CHECK_URL, '_blank');
        });

        // Update the version badge to show outdated
        const versionBadge = document.getElementById('hc-version-badge');
        if (versionBadge) {
            versionBadge.textContent = `⚠️ v${SCRIPT_VERSION} → v${remoteVersion}`;
            versionBadge.style.background = '#b71c1c';
            versionBadge.style.color = '#ffcdd2';
        }

        document.getElementById('hc-update-later-btn').addEventListener('click', () => {
            // Remove banner and overlay
            banner.remove();
            const overlay = document.getElementById('hc-update-overlay');
            if (overlay) overlay.remove();
            // Set a short grace period (10 minutes)
            GM_setValue(STORAGE_KEY_LAST_UPDATE_CHECK, Date.now());
        });
    }

    async function performUpdateCheck() {
        try {
            const remoteVersion = await checkForUpdate();
            if (compareVersions(remoteVersion, SCRIPT_VERSION) > 0) {
                // A newer version exists
                const skippedVersion = GM_getValue(STORAGE_KEY_SKIP_VERSION, '');
                // Always show if remote is newer (mandatory update)
                showUpdateBanner(remoteVersion);
                return true; // update available
            }
            return false; // no update
        } catch(err) {
            console.log('[OB Pick Center] Update check failed:', err.message);
            return false;
        }
    }

    function scheduleUpdateChecks() {
        // Check immediately on load
        performUpdateCheck();

        // Then check periodically
        setInterval(() => {
            performUpdateCheck();
        }, UPDATE_CHECK_INTERVAL_MS);
    }


    // ===== INITIALIZATION =====

    function init() {
        createPanel();

        // Check for updates before anything else
        scheduleUpdateChecks();

        // Load manual data first
        const manualActuals = loadActualsData();
        if (Object.keys(manualActuals).length > 0) {
            processPaths = Object.keys(manualActuals).sort();
            actuals = manualActuals;
        }

        // If sync is on, read from Rodeo
        if (syncEnabled && readPickersFromTable()) {
            renderTable();
        } else if (processPaths.length > 0) {
            renderTable();
        }

        // Observer and polling only run when sync is enabled
        const table = document.getElementById('PickingNotYetPickedTable');
        if (table) {
            new MutationObserver(() => {
                if (!syncEnabled) return;
                const prev = JSON.stringify(actuals);
                readPickersFromTable();
                if (JSON.stringify(actuals) !== prev) renderTable();
            }).observe(table, { childList: true, subtree: true, characterData: true });
        }

        setInterval(() => {
            if (!syncEnabled) return;
            const prev = JSON.stringify(actuals);
            readPickersFromTable();
            if (JSON.stringify(actuals) !== prev) renderTable();
        }, POLL_INTERVAL_MS);

        setTimeout(() => {
            if (!syncEnabled) return;
            readPickersFromTable();
            renderTable();
        }, INITIAL_DELAY_MS);
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 1000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 1000));
    }

    // ============================================================
    // STAFFING DASHBOARD BRIDGE
    // Pushes active picker data to the local Staffing Dashboard
    // server every 30 seconds so it knows who's actively picking.
    // ============================================================
    const DASHBOARD_SERVER = 'http://localhost:8787';
    const DASHBOARD_PUSH_INTERVAL = 30000;

    function pushWorkforceToDashboard() {
        const fcCode = GM_getValue(STORAGE_KEY_FC, FC_CODE);
        const apiUrl = `https://picking-console.na.picking.aft.a2z.com/api/fcs/${fcCode}/workforce`;

        gmXHR({
            method: 'GET',
            url: apiUrl,
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const pickers = data.pickerStatusList || [];
                        gmXHR({
                            method: 'POST',
                            url: `${DASHBOARD_SERVER}/api/update-workforce`,
                            headers: { 'Content-Type': 'application/json' },
                            data: JSON.stringify({ pickers: pickers }),
                            onload: function(res) {
                                if (res.status === 200) console.log('[Dashboard Bridge] Pushed ' + pickers.length + ' pickers');
                            },
                            onerror: function() {}
                        });
                    } catch(e) {}
                }
            },
            onerror: function() {}
        });
    }

    setInterval(pushWorkforceToDashboard, DASHBOARD_PUSH_INTERVAL);
    setTimeout(pushWorkforceToDashboard, 5000);
    // ============================================================
})();
