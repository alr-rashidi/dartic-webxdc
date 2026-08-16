import { translations } from './i18n.js';

let myAddr = (window.webxdc && window.webxdc.selfAddr) ? window.webxdc.selfAddr : '';
if (!myAddr) {
    myAddr = localStorage.getItem('webxdc_fallback_addr');
    if (!myAddr) {
        myAddr = 'user-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('webxdc_fallback_addr', myAddr);
    }
}
const defaultName = (window.webxdc && window.webxdc.selfName) ? window.webxdc.selfName : '';

// DOM Elements
const screens = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    playing: document.getElementById('screen-game'),
    results: document.getElementById('screen-results')
};

// Login
const nicknameInput = document.getElementById('nickname-input');
const btnJoin = document.getElementById('btn-join');

// Lobby
const hostControls = document.getElementById('host-controls');
const playerControls = document.getElementById('player-controls');
const playerList = document.getElementById('player-list');

const btnReady = document.getElementById('btn-ready');
const btnLeave = document.getElementById('btn-leave');
const btnStartGame = document.getElementById('btn-start-game');
const settingMode = document.getElementById('setting-mode');
const settingRounds = document.getElementById('setting-rounds');
const settingTime = document.getElementById('setting-time');

// Game
const phasePrompt = document.getElementById('phase-prompt');
const phaseDraw = document.getElementById('phase-draw');
const phaseWait = document.getElementById('phase-wait');
const gameTimer = document.getElementById('game-timer');
const gameRoundInfo = document.getElementById('game-round-info');
const waitPlayerStatus = document.getElementById('wait-player-status');

// Prompt Phase
const promptTitle = document.getElementById('prompt-title');
const promptContext = document.getElementById('prompt-context');
const promptPrevDrawing = document.getElementById('prompt-prev-drawing');
const promptInput = document.getElementById('prompt-input');
const promptTextarea = document.getElementById('prompt-textarea');
const btnSubmitPrompt = document.getElementById('btn-submit-prompt');

// Draw Phase
const drawInstruction = document.getElementById('draw-instruction');
const drawSubject = document.getElementById('draw-subject');
const drawPrevCanvas = document.getElementById('draw-prev-canvas');
const drawingSvg = document.getElementById('drawing-svg');
const canvasLockOverlay = document.getElementById('canvas-lock-overlay');
const btnSubmitDraw = document.getElementById('btn-submit-draw');
const paintControlsContainer = document.getElementById('paint-controls-container');
const btnUndo = document.getElementById('btn-undo');
const btnToolBackground = document.getElementById('btn-tool-background');
const toolSize = document.getElementById('tool-size');

// Results
const resultsScrollArea = document.getElementById('results-scroll-area');
const resultAlbumTitle = document.getElementById('result-album-title');
const btnNextResult = document.getElementById('btn-next-result');
const btnBackLobby = document.getElementById('btn-back-lobby');
const btnDownloadResults = document.getElementById('btn-download-results');
const btnCopyResults = document.getElementById('btn-copy-results');

// Hourglass Status Elements
const btnStatusHourglass = document.getElementById('btn-status-hourglass');
const statusDropdown = document.getElementById('status-dropdown');
const statusPlayerList = document.getElementById('status-player-list');

// --- Global State ---
let state = {
    screen: 'login', // lobby, playing, results
    hostAddr: null,
    settings: {
        mode: 'write_draw',
        rounds: 0,
        time: 60
    },
    players: [], // { addr, name, ready }
    blacklist: [],
    
    // Game
    playingAddrs: [],
    currentRound: 0,
    totalRounds: 0,
    roundStartTime: 0,
    submissions: {}, // round -> addr -> data (string for prompt, array of strings for svg elements)
    
    // Results
    resultsRevealed: false
};

// Local variables
let isHost = false;
let myPlayer = null;
let timerInterval = null;
let isSubmitted = false;
let isTempSpectator = false;
let autoSubmitted = false;

// True during the short window after the app loads while past updates are
// being replayed (e.g. a player reopening the app).
let isRestoring = true;
let adminReturnHandled = false;

// Drawing state
let isDrawing = false;
let currentPath = null;
let currentColor = '#000000';
let currentStrokeWidth = 5;
let svgHistory = []; // array of DOM elements appended to SVG
let bgRect = null; // <rect> painting the canvas background, if any

// --- Language and Translations ---
let currentLang = 'en'; // default to English
try {
    const deviceLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (deviceLang.startsWith('fa')) {
        currentLang = 'fa';
    }
} catch (e) {
    currentLang = 'en';
}

function getTranslation(key) {
    return translations[currentLang][key] || translations['fa'][key] || '';
}

function applyLanguage() {
    // Set text direction
    document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
    document.body.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
    
    // Translate every element marked with data-i18n attributes
    document.querySelectorAll('[data-i18n]').forEach(el => {
        // The players heading and the round info are rebuilt with dynamic
        // values (live player count / formatted round number).
        if (el.id === 'lobby-players-title' || el.id === 'game-round-info') return;
        const text = getTranslation(el.dataset.i18n);
        if (text) el.innerText = text;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const text = getTranslation(el.dataset.i18nPlaceholder);
        if (text) el.placeholder = text;
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const text = getTranslation(el.dataset.i18nTitle);
        if (text) el.title = text;
    });
    
    // Page title
    document.title = getTranslation('title') + ' WebXDC';
    
    // Update ready button
    const me = state.players.find(p => p.addr === myAddr);
    if (btnReady && me) {
        btnReady.innerText = me.ready ? getTranslation('not_ready_btn') : getTranslation('ready_btn');
    }
    
    // Update submit buttons if not submitted
    if (!isSubmitted) {
        if (btnSubmitPrompt) btnSubmitPrompt.innerText = getTranslation('submit_prompt');
        if (btnSubmitDraw) btnSubmitDraw.innerText = getTranslation('submit_draw');
    } else {
        if (btnSubmitPrompt) btnSubmitPrompt.innerText = getTranslation('waiting_others');
        if (btnSubmitDraw) btnSubmitDraw.innerText = getTranslation('retract_draw');
    }
    
    // Keep the language dropdown in sync with the active language
    const langSelect = document.getElementById('select-lang');
    if (langSelect) langSelect.value = currentLang;

    // Redraw wait player lists and hourglass list
    updateGameUI();
    updateLobbyUI();
}

// --- Helpers ---

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeSettings(s) {
    const validModes = ['write_draw', 'draw_write', 'only_draw', 'only_write', 'write_start_end', 'write_start', 'write_end'];
    const mode = (s && s.mode && validModes.includes(s.mode)) ? s.mode : 'write_draw';
    return {
        mode,
        rounds: Math.max(0, Math.min(20, parseInt(s && s.rounds) || 0)),
        time: Math.max(5, Math.min(600, parseInt(s && s.time) || 60))
    };
}

// When the host goes inactive (or their device is gone), the first still-active
// player acts as host so the game can keep advancing.
function getActingHostAddr() {
    const hostInactive = state.inactiveAddrs && state.inactiveAddrs.includes(state.hostAddr);
    if (!hostInactive) return state.hostAddr;
    const active = (state.playingAddrs || []).filter(a => !state.inactiveAddrs.includes(a));
    return active[0] || state.hostAddr;
}

function isConsecutivePromptRound(round) {
    if (!round || round <= 0) return false;
    if (getTaskTypeForRound(round, state.settings.mode, state.totalRounds) !== 'prompt') return false;
    const prev = round > 1 && getTaskTypeForRound(round - 1, state.settings.mode, state.totalRounds) === 'prompt';
    const next = round < state.totalRounds && getTaskTypeForRound(round + 1, state.settings.mode, state.totalRounds) === 'prompt';
    return prev || next;
}

function init() {
    // Theme initialization
    const themeIcon = document.getElementById('theme-icon');
    const savedTheme = localStorage.getItem('user-theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
        document.body.classList.add('dark');
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        if (themeIcon) themeIcon.innerText = '☀️';
    } else {
        document.body.classList.remove('dark');
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
        if (themeIcon) themeIcon.innerText = '🌙';
    }

    if (defaultName && defaultName !== 'WebXDC') {
        nicknameInput.value = defaultName;
    }
    
    btnJoin.addEventListener('click', handleJoin);
    btnReady.addEventListener('click', handleReady);
    btnLeave.addEventListener('click', handleLeave);
    
    // Settings changes (only host)
    settingMode.addEventListener('change', sendSettings);
    settingRounds.addEventListener('change', sendSettings);
    settingTime.addEventListener('change', sendSettings);
    btnStartGame.addEventListener('click', handleStartGame);
    
    btnSubmitPrompt.addEventListener('click', submitPrompt);
    btnSubmitDraw.addEventListener('click', submitDraw);
    
    btnNextResult.addEventListener('click', () => {
        showNextResult();
    });
    if (btnDownloadResults) {
        btnDownloadResults.addEventListener('click', () => {
            const chain = resultChains[currentChainIdx];
            if (chain) {
                generateWebMVideo(chain);
            }
        });
    }
    if (btnCopyResults) {
        btnCopyResults.addEventListener('click', () => {
            const chain = resultChains[currentChainIdx];
            if (chain) {
                copyChainTranscript(chain);
            }
        });
    }
    btnBackLobby.addEventListener('click', () => {
        sendAction('BACK_LOBBY');
    });
    
    // Hourglass status modal togglers
    const btnCloseStatusModal = document.getElementById('btn-close-status-modal');
    const btnCloseStatusModalX = document.getElementById('btn-close-status-modal-x');

    if (btnStatusHourglass) {
        btnStatusHourglass.addEventListener('click', (e) => {
            e.stopPropagation();
            if (statusDropdown) {
                statusDropdown.classList.remove('hidden');
                updateHourglassDropdown();
            }
        });
    }

    if (btnCloseStatusModal) {
        btnCloseStatusModal.addEventListener('click', (e) => {
            e.stopPropagation();
            if (statusDropdown) statusDropdown.classList.add('hidden');
        });
    }

    if (btnCloseStatusModalX) {
        btnCloseStatusModalX.addEventListener('click', (e) => {
            e.stopPropagation();
            if (statusDropdown) statusDropdown.classList.add('hidden');
        });
    }
    
    if (statusDropdown) {
        statusDropdown.addEventListener('click', (e) => {
            if (e.target === statusDropdown) {
                statusDropdown.classList.add('hidden');
            }
        });
    }
    
    // Reset mock data helper (useful for local multi-tab testing)
    const btnResetMock = document.getElementById('btn-reset-mock');
    if (btnResetMock) {
        if (window.webxdc && window.webxdc.isMock) {
            btnResetMock.classList.remove('hidden');
            btnResetMock.addEventListener('click', () => {
                // Signal to other tabs to reload as well
                if (window.webxdc && window.webxdc.sendUpdate) {
                    window.webxdc.sendUpdate({
                        payload: { type: 'CLEAR_HISTORY' },
                        info: 'اتاق بازی ریستارت شد'
                    });
                }
                localStorage.removeItem('webxdc_updates');
                location.reload();
            });
        } else {
            btnResetMock.classList.add('hidden');
        }
    }
    
    // Delegate player kick events to avoid inline onclick ReferenceErrors
    playerList.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-kick');
        if (btn) {
            const targetAddr = btn.dataset.addr;
            if (targetAddr) {
                sendAction('KICK', { targetAddr });
            }
        }
    });
    
    // Theme toggle
    const btnToggleTheme = document.getElementById('btn-toggle-theme');
    if (btnToggleTheme) {
        btnToggleTheme.addEventListener('click', () => {
            document.body.classList.toggle('dark');
            const isDark = document.body.classList.contains('dark');
            if (isDark) {
                document.documentElement.classList.add('dark');
                document.documentElement.classList.remove('light');
                localStorage.setItem('user-theme', 'dark');
                if (themeIcon) themeIcon.innerText = '☀️';
            } else {
                document.documentElement.classList.add('light');
                document.documentElement.classList.remove('dark');
                localStorage.setItem('user-theme', 'light');
                if (themeIcon) themeIcon.innerText = '🌙';
            }
        });
    }
    
    // Language switch
    const selectLang = document.getElementById('select-lang');
    if (selectLang) {
        selectLang.addEventListener('change', (e) => {
            currentLang = e.target.value;
            applyLanguage();
        });
    }

    // Prompt input dynamic validation
    if (promptInput) {
        promptInput.addEventListener('input', () => {
            if (!isSubmitted) {
                btnSubmitPrompt.disabled = !promptInput.value.trim();
            }
        });
    }
    if (promptTextarea) {
        promptTextarea.addEventListener('input', () => {
            if (!isSubmitted) {
                btnSubmitPrompt.disabled = !promptTextarea.value.trim();
            }
        });
    }
    
    setupDrawingTools();
    
    // Apply default translation on load
    applyLanguage();
    
    // Initial UI update based on local state (which is empty)
    updateUI();
    
    // Set listener for WebXDC
    window.webxdc.setUpdateListener(function (update) {
        if (update.payload && update.payload.type === 'CLEAR_HISTORY') {
            localStorage.removeItem('webxdc_updates');
            location.reload();
            return;
        }
        processAction(update.payload);
    });
    
    // In the browser mock the whole update history is replayed synchronously
    // above, so the state is complete already; in Delta Chat the updates arrive
    // right after. Handle both: check immediately, and again once the replay
    // window closes.
    checkReturningAdmin();
    setTimeout(() => {
        checkReturningAdmin();
        isRestoring = false;
    }, 2000);
}

function sendAction(type, payload = {}) {
    const action = { type, addr: myAddr, sentAt: Date.now(), ...payload };
    
    // Only send the info field for JOIN, START, and SHOW_RESULTS to prevent filling Delta Chat with empty/unnecessary system updates
    let info = undefined;
    if (type === 'JOIN') {
        info = currentLang === 'fa' ? `${payload.name} به بازی پیوست` : `${payload.name} joined the game`;
    } else if (type === 'START') {
        info = currentLang === 'fa' ? `بازی شروع شد!` : `Game started!`;
    } else if (type === 'SHOW_RESULTS') {
        info = currentLang === 'fa' ? `نتایج آماده است!` : `Results are ready!`;
    }
    
    const updateObj = { payload: action };
    if (info !== undefined) {
        updateObj.info = info;
    }
    
    window.webxdc.sendUpdate(updateObj);
}

function recalculateHost() {
    if (state.players.length > 0) {
        state.players.sort((a, b) => {
            const timeA = a.sentAt || 0;
            const timeB = b.sentAt || 0;
            if (timeA !== timeB) return timeA - timeB;

            return a.addr.localeCompare(b.addr);
        });
        state.hostAddr = state.players[0].addr;
    } else {
        state.hostAddr = null;
    }
}

function processAction(action) {
    switch (action.type) {
        case 'JOIN':
            let pJoin = state.players.find(p => p.addr === action.addr);
            const sentAt = action.sentAt || Date.now();
            if (!pJoin) {
                pJoin = { addr: action.addr, name: action.name, ready: false, sentAt: sentAt };
                state.players.push(pJoin);
            } else {
                pJoin.name = action.name;
                if (action.sentAt && (!pJoin.sentAt || action.sentAt < pJoin.sentAt)) {
                    pJoin.sentAt = action.sentAt;
                }
            }
            recalculateHost();
            if (action.addr === myAddr && state.screen === 'login') {
                state.screen = 'lobby';
            }
            break;
            
        case 'READY':
            const pReady = state.players.find(p => p.addr === action.addr);
            if (pReady) pReady.ready = action.ready;
            break;
            
        case 'LEAVE':
            state.players = state.players.filter(p => p.addr !== action.addr);
            // If they were part of the game and game is actively in progress:
            if (state.screen === 'playing' && state.playingAddrs && state.playingAddrs.includes(action.addr)) {
                if (!state.inactiveAddrs) state.inactiveAddrs = [];
                if (!state.inactiveAddrs.includes(action.addr)) {
                    state.inactiveAddrs.push(action.addr);
                }
                const activePlayers = state.playingAddrs.filter(addr => !state.inactiveAddrs.includes(addr) && state.players.some(p => p.addr === addr));
                if (activePlayers.length < 2) {
                    if (state.currentRound <= 1) {
                        alert(getTranslation('alert_too_few_active'));
                        if (myAddr === getActingHostAddr()) {
                            sendAction('BACK_LOBBY');
                        }
                    } else {
                        if (myAddr === getActingHostAddr()) {
                            sendAction('SHOW_RESULTS', { endedInactive: true });
                        }
                    }
                }
            }
            recalculateHost();
            break;
            
        case 'KICK':
            if (action.addr === state.hostAddr) {
                state.players = state.players.filter(p => p.addr !== action.targetAddr);
                if (action.targetAddr === myAddr) {
                    state.screen = 'login';
                }
                if (state.screen === 'playing' && state.playingAddrs && state.playingAddrs.includes(action.targetAddr)) {
                    if (!state.inactiveAddrs) state.inactiveAddrs = [];
                    if (!state.inactiveAddrs.includes(action.targetAddr)) {
                        state.inactiveAddrs.push(action.targetAddr);
                    }
                    const activePlayers = state.playingAddrs.filter(addr => !state.inactiveAddrs.includes(addr) && state.players.some(p => p.addr === addr));
                    if (activePlayers.length < 2) {
                        if (state.currentRound <= 1) {
                            alert(getTranslation('alert_too_few_active'));
                            if (myAddr === getActingHostAddr()) {
                                sendAction('BACK_LOBBY');
                            }
                        } else {
                            if (myAddr === getActingHostAddr()) {
                                sendAction('SHOW_RESULTS', { endedInactive: true });
                            }
                        }
                    }
                }
                recalculateHost();
            }
            break;
            
        case 'SETTINGS':
            if (action.addr === state.hostAddr) {
                state.settings = sanitizeSettings(action.settings);
            }
            break;
            
        case 'START':
            if (action.addr === state.hostAddr) {
                // A new game starts fresh albums, forget the previously saved one
                // (but keep it while replaying the current game's own updates).
                if (!isRestoring) saveLastChainIdx(-1);
                state.screen = 'playing';
                state.playingAddrs = state.players.map(p => p.addr);
                state.totalRounds = state.settings.rounds > 0 ? state.settings.rounds : state.playingAddrs.length;
                state.currentRound = 1;
                state.roundStartTime = action.startTime || Date.now();
                state.submissions = {};
                state.inactiveAddrs = [];
                state.resultsRevealed = false;
                isTempSpectator = false;
                isSubmitted = false;
                startRoundUI();
            }
            break;
            
        case 'SUBMIT':
            if (!state.submissions[action.round]) state.submissions[action.round] = {};
            state.submissions[action.round][action.addr] = action.data;
            if (state.screen === 'playing' && myAddr === getActingHostAddr()) {
                checkAndAdvanceRoundHost();
            }
            break;
            
        case 'CANCEL_SUBMIT':
            if (state.submissions[action.round]) {
                delete state.submissions[action.round][action.addr];
            }
            break;
            
        case 'NEXT_ROUND':
            if (action.addr === state.hostAddr || action.addr === getActingHostAddr()) {
                state.currentRound = action.round;
                state.roundStartTime = action.startTime || Date.now();
                isSubmitted = false;
                autoSubmitted = false;
                startRoundUI();
            }
            break;
            
        case 'SHOW_RESULTS':
            if (action.addr === state.hostAddr || action.addr === getActingHostAddr()) {
                if (action.endedInactive) {
                    alert(getTranslation('game_ended_inactive'));
                }
                // The game is over: nobody stays "ready" for a new one, so the
                // host cannot start again until everyone readies up.
                state.players.forEach(p => p.ready = false);
                if (state.inactiveAddrs && state.inactiveAddrs.includes(myAddr)) {
                    state.screen = 'lobby';
                } else {
                    state.screen = 'results';
                }
                state.resultsRevealed = true;
                prepareResults();
            }
            break;
            
        case 'BACK_LOBBY': {
            const fromHost = action.addr === state.hostAddr || action.addr === getActingHostAddr();
            // A host returning from a live game takes everyone back to the lobby;
            // on the results screen every player returns on their own.
            if (action.addr === myAddr || (fromHost && state.screen === 'playing')) {
                state.screen = 'lobby';
                state.currentRound = 0;
                state.submissions = {};
                state.resultsRevealed = false;
                state.inactiveAddrs = [];
                isTempSpectator = false;
                // Returning to the lobby from a game: everyone must ready up again.
                state.players.forEach(p => p.ready = false);
            }
            const pBack = state.players.find(p => p.addr === action.addr);
            if (pBack) pBack.ready = false;
            break;
        }

        case 'PLAYER_INACTIVE':
            if (!state.inactiveAddrs) state.inactiveAddrs = [];
            const targetAddr = action.targetAddr || action.addr;
            if (!state.inactiveAddrs.includes(targetAddr)) {
                state.inactiveAddrs.push(targetAddr);
            }
            if (targetAddr === myAddr) {
                // Stay on the game screen as a spectator instead of dropping to the
                // lobby — this keeps the round advancing even when the host is idle.
                isTempSpectator = true;
            }
            if (state.screen === 'playing') {
                if (myAddr === getActingHostAddr()) {
                    checkAndAdvanceRoundHost();
                }
            }
            break;
    }
    
    updateUI();
}

function handleJoin() {
    const name = nicknameInput.value.trim() || getTranslation('badge_waiting');
    sendAction('JOIN', { name });
    state.screen = 'lobby'; // optimistically change to lobby to avoid double clicks
    updateUI();
}

function handleReady() {
    const me = state.players.find(p => p.addr === myAddr);
    if (me) {
        sendAction('READY', { ready: !me.ready });
    }
}

function handleLeave() {
    sendAction('LEAVE');
    state.screen = 'login';
    state.hostAddr = null; // will be reassigned locally if needed, but better let processAction handle
    updateUI();
}

function sendSettings() {
    if (!isHost) return;
    const settings = sanitizeSettings({
        mode: settingMode.value,
        rounds: settingRounds.value,
        time: settingTime.value
    });
    sendAction('SETTINGS', { settings });
}

function handleStartGame() {
    if (!isHost) return;
    if (state.players.length < 2) {
        alert(getTranslation('alert_min_players'));
        return;
    }
    const allReady = state.players.filter(p => p.addr !== myAddr).every(p => p.ready);
    if (!allReady) {
        alert(getTranslation('alert_not_ready'));
        return;
    }
    sendAction('START', { startTime: Date.now() });
}

// ---- UI Updates ----

function updateUI() {
    checkPlayerSessionStatus();
    
    recalculateHost();
    myPlayer = state.players.find(p => p.addr === myAddr);
    isHost = state.hostAddr === myAddr;
    
    // Switch screens
    Object.keys(screens).forEach(key => {
        screens[key].classList.toggle('hidden', state.screen !== key);
    });
    
    if (state.screen === 'lobby') {
        updateLobbyUI();
    } else if (state.screen === 'playing') {
        updateGameUI();
    } else if (state.screen === 'results') {
        // results handled in its own flow
    }
}

// If the host reopens the app while a game is still running and they are no
// longer an active player, the game is considered over: broadcast it so every
// player returns to the lobby instead of staying stuck on the "Waiting for
// other players" screen.
function checkReturningAdmin() {
    if (!isRestoring || adminReturnHandled) return;
    if (isHost && state.screen === 'playing' && state.currentRound > 0 && !determineTaskForRound(myAddr, state.currentRound)) {
        adminReturnHandled = true;
        alert(getTranslation('prev_finished'));
        sendAction('BACK_LOBBY');
    }
}

function updatePlayersHeading() {
    const heading = document.getElementById('lobby-players-title');
    if (!heading) return;
    heading.innerHTML = `${getTranslation('players')} (<span id="player-count">${state.players.length}</span>)`;
}

function updateLobbyUI() {
    updatePlayersHeading();
    playerList.innerHTML = '';
    
    state.players.forEach(p => {
        const li = document.createElement('li');
        
        let status = p.addr === state.hostAddr ? `<span class="badge badge-purple">${getTranslation('badge_host')}</span>` 
                   : (p.ready ? `<span class="badge badge-green">${getTranslation('badge_ready')}</span>` 
                               : `<span class="badge badge-gray">${getTranslation('badge_waiting')}</span>`);
                               
        let kickBtn = (isHost && p.addr !== myAddr) ? `<button class="btn-kick" data-addr="${p.addr}" title="${escapeHtml(getTranslation('kick'))}">✖</button>` : '';
        
        li.innerHTML = `<div class="flex-row items-center gap-2"><span class="font-bold player-name">${escapeHtml(p.name)}</span> ${kickBtn}</div> <div>${status}</div>`;
        playerList.appendChild(li);
    });
    
    // Always show the settings block
    hostControls.classList.remove('hidden');
    
    // Update setting values
    settingMode.value = state.settings.mode;
    settingRounds.value = state.settings.rounds;
    settingTime.value = state.settings.time;
    
    const settingsTitle = document.getElementById('host-settings-title');
    
    if (isHost) {
        // Enable inputs for host
        settingMode.disabled = false;
        settingRounds.disabled = false;
        settingTime.disabled = false;
        
        // Show start game button
        btnStartGame.classList.remove('hidden');
        playerControls.classList.add('hidden');
        
        if (settingsTitle) {
            settingsTitle.innerText = getTranslation('host_settings');
        }
        
        const allReady = state.players.filter(p => p.addr !== myAddr).every(p => p.ready);
        btnStartGame.disabled = state.players.length < 2 || !allReady;
    } else {
        // Disable inputs for guests
        settingMode.disabled = true;
        settingRounds.disabled = true;
        settingTime.disabled = true;
        
        // Hide start game button, show player controls (Ready / Cancel Ready)
        btnStartGame.classList.add('hidden');
        playerControls.classList.remove('hidden');
        
        if (settingsTitle) {
            settingsTitle.innerText = getTranslation('settings_guest_title');
        }
        
        btnReady.innerText = myPlayer && myPlayer.ready ? getTranslation('not_ready_btn') : getTranslation('ready_btn');
        if (myPlayer && myPlayer.ready) {
            btnReady.className = 'btn btn-yellow flex-1';
        } else {
            btnReady.className = 'btn btn-blue flex-1';
        }
    }
}

// ---- Game Logic ----

function startRoundUI() {
    if (statusDropdown) statusDropdown.classList.add('hidden');
    gameRoundInfo.innerText = getTranslation('round_info')
        .replace('{cur}', state.currentRound)
        .replace('{total}', state.totalRounds);
    promptInput.value = '';
    if (promptTextarea) promptTextarea.value = '';
    clearCanvas();
    autoSubmitted = false;
    
    // Safety check if we already submitted this round
    if (state.submissions[state.currentRound] && state.submissions[state.currentRound][myAddr]) {
        isSubmitted = true;
    }
    
    // Determine what I should do this round
    const task = determineTaskForRound(myAddr, state.currentRound);
    
    phasePrompt.classList.add('hidden');
    phaseDraw.classList.add('hidden');
    phaseWait.classList.add('hidden');
    
    if (!task) {
        // Spectator or joined late
        phaseWait.classList.remove('hidden');
    } else {
        if (task.type === 'prompt') {
            phasePrompt.classList.remove('hidden');
            if (task.contextData) {
                promptContext.classList.remove('hidden');
                
                const isConsecutivePrompt = isConsecutivePromptRound(state.currentRound);
                
                if (isConsecutivePrompt) {
                    document.getElementById('prompt-context-text').innerText = getTranslation('prompt_continue');
                    promptPrevDrawing.classList.add('text-only-context');
                    promptPrevDrawing.innerHTML = `<div class="consecutive-prompt-card">${escapeHtml(task.contextData)}</div>`;
                } else {
                    document.getElementById('prompt-context-text').innerText = getTranslation('prompt_context');
                    promptPrevDrawing.classList.remove('text-only-context');
                    const innerSVG = Array.isArray(task.contextData) ? task.contextData.join('') : (typeof task.contextData === 'string' ? escapeHtml(task.contextData) : '');
                    promptPrevDrawing.innerHTML = `<svg viewBox="0 0 400 400" class="w-full h-full">${innerSVG}</svg>`;
                }
            } else {
                promptContext.classList.add('hidden');
                promptPrevDrawing.classList.remove('text-only-context');
            }
        } else if (task.type === 'draw') {
            phaseDraw.classList.remove('hidden');
            if (!task.contextData && state.currentRound === 1) {
                drawSubject.innerText = currentLang === 'fa' ? 'نقاشی آزاد (هر چه دوست داری بکش)' : 'Free Drawing (Draw whatever you like)';
            } else {
                drawSubject.innerText = task.contextData || '';
            }
            if (task.prevDrawing) {
                 drawPrevCanvas.classList.remove('hidden');
                 drawPrevCanvas.style.opacity = '0.3';
                 const innerSVG = Array.isArray(task.prevDrawing) ? task.prevDrawing.join('') : (typeof task.prevDrawing === 'string' ? task.prevDrawing : '');
                 drawPrevCanvas.innerHTML = `<svg viewBox="0 0 400 400" class="w-full h-full">${innerSVG}</svg>`;
            } else {
                 drawPrevCanvas.classList.add('hidden');
                 drawPrevCanvas.style.opacity = '';
                 drawPrevCanvas.innerHTML = '';
             }
        }
    }
    
    manageTimer();
}

function updateGameUI() {
    if (!state.roundStartTime) return;
    
    updateHourglassButton();
    updateHourglassDropdown();
    
    const task = determineTaskForRound(myAddr, state.currentRound);
    
    if (!task || isTempSpectator) {
        // Spectator or joined late
        phasePrompt.classList.add('hidden');
        phaseDraw.classList.add('hidden');
        phaseWait.classList.remove('hidden');
        
        // Show who we are waiting for
        waitPlayerStatus.innerHTML = '';
        state.playingAddrs.forEach(addr => {
            const p = state.players.find(x => x.addr === addr) || { name: 'Unknown' };
            const hasSub = state.submissions[state.currentRound] && state.submissions[state.currentRound][addr] !== undefined;
            const doneText = getTranslation('done_status');
            const waitText = getTranslation('waiting_status');
            waitPlayerStatus.innerHTML += `<li>${escapeHtml(p.name)}: ${hasSub ? '✅ ' + doneText : '⏳ ' + waitText}</li>`;
        });
    } else {
        // We are an active player
        phaseWait.classList.add('hidden');
        
        if (task.type === 'prompt') {
            phasePrompt.classList.remove('hidden');
            phaseDraw.classList.add('hidden');
            
            const isConsecutivePrompt = isConsecutivePromptRound(state.currentRound);
            
            if (isConsecutivePrompt) {
                promptInput.classList.add('hidden');
                promptTextarea.classList.remove('hidden');
                
                if (isSubmitted) {
                    promptTextarea.disabled = true;
                    btnSubmitPrompt.disabled = false;
                    btnSubmitPrompt.innerText = getTranslation('retract_prompt');
                    btnSubmitPrompt.className = 'btn btn-yellow w-full';
                } else {
                    promptTextarea.disabled = false;
                    btnSubmitPrompt.disabled = !promptTextarea.value.trim();
                    btnSubmitPrompt.innerText = getTranslation('submit_prompt');
                    btnSubmitPrompt.className = 'btn btn-success w-full';
                }
            } else {
                promptInput.classList.remove('hidden');
                promptTextarea.classList.add('hidden');
                
                if (isSubmitted) {
                    promptInput.disabled = true;
                    btnSubmitPrompt.disabled = false;
                    btnSubmitPrompt.innerText = getTranslation('retract_prompt');
                    btnSubmitPrompt.className = 'btn btn-yellow w-full';
                } else {
                    promptInput.disabled = false;
                    btnSubmitPrompt.disabled = !promptInput.value.trim();
                    btnSubmitPrompt.innerText = getTranslation('submit_prompt');
                    btnSubmitPrompt.className = 'btn btn-success w-full';
                }
            }
        } else if (task.type === 'draw') {
            phasePrompt.classList.add('hidden');
            phaseDraw.classList.remove('hidden');
            
            if (isSubmitted) {
                drawingSvg.style.pointerEvents = 'none';
                if (canvasLockOverlay) {
                    canvasLockOverlay.classList.add('hidden');
                }
                
                btnSubmitDraw.innerText = getTranslation('retract_draw');
                btnSubmitDraw.className = 'btn btn-yellow w-full';
                btnSubmitDraw.disabled = false;
                btnUndo.disabled = true;
                if (btnToolBackground) btnToolBackground.disabled = true;
                
                if (paintControlsContainer) {
                    paintControlsContainer.classList.add('opacity-50', 'pointer-events-none');
                }
            } else {
                drawingSvg.style.pointerEvents = 'auto';
                if (canvasLockOverlay) {
                    canvasLockOverlay.classList.add('hidden');
                }
                
                btnSubmitDraw.innerText = getTranslation('submit_draw');
                btnSubmitDraw.className = 'btn btn-success w-full';
                const hasDrawing = drawingSvg && drawingSvg.children.length > 0;
                btnSubmitDraw.disabled = !hasDrawing;
                btnUndo.disabled = false;
                if (btnToolBackground) btnToolBackground.disabled = false;
                
                if (paintControlsContainer) {
                    paintControlsContainer.classList.remove('opacity-50', 'pointer-events-none');
                }
            }
        }
    }
    
    // Round-end / stuck-round handling runs on every client so the game recovers
    // even if the host goes inactive or closes the app; only the acting host advances.
    if (state.screen === 'playing' && state.currentRound > 0 && !state.resultsRevealed) {
        const subs = state.submissions[state.currentRound] || {};
        const activePlayingAddrs = state.playingAddrs.filter(addr => !state.inactiveAddrs || !state.inactiveAddrs.includes(addr));
        const elapsed = (Date.now() - state.roundStartTime) / 1000;
        const timeOut = elapsed >= state.settings.time + 5; // 5s grace period
        
        if (timeOut) {
            activePlayingAddrs.forEach(addr => {
                const subData = subs[addr];
                const isEmpty = subData === undefined || subData === null || subData === '' || (Array.isArray(subData) && subData.length === 0);
                if (isEmpty) {
                    sendAction('PLAYER_INACTIVE', { targetAddr: addr });
                }
            });
        }
        if (myAddr === getActingHostAddr()) {
            checkAndAdvanceRoundHost();
        }
    }
}

function manageTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        if (state.screen !== 'playing') {
            clearInterval(timerInterval);
            return;
        }
        
        const elapsed = Math.floor((Date.now() - state.roundStartTime) / 1000);
        let remaining = state.settings.time - elapsed;
        if (remaining < 0) remaining = 0;
        
        gameTimer.innerText = remaining;
        
        if (remaining <= 10) {
            gameTimer.classList.add('text-danger', 'timer-pulse');
        } else {
            gameTimer.classList.remove('text-danger', 'timer-pulse');
            gameTimer.classList.add('text-primary');
        }
        
        if (remaining <= 0 && !isSubmitted && !autoSubmitted) {
            autoSubmitted = true;
            const task = determineTaskForRound(myAddr, state.currentRound);
            if (task) {
                let hasContent = false;
                let submitData = null;
                if (task.type === 'prompt') {
                    const isConsecutivePrompt = isConsecutivePromptRound(state.currentRound);
                    const text = isConsecutivePrompt ? promptTextarea.value.trim() : promptInput.value.trim();
                    if (text) {
                        hasContent = true;
                        submitData = text;
                    }
                } else if (task.type === 'draw') {
                    const elements = getDrawingElements();
                    if (elements.length > 0) {
                        hasContent = true;
                        submitData = elements;
                    }
                }
                
                if (hasContent) {
                    sendAction('SUBMIT', { round: state.currentRound, data: submitData });
                    isSubmitted = true;
                } else {
                    sendAction('PLAYER_INACTIVE', { targetAddr: myAddr });
                }
            }
        }
        
        updateGameUI();
    }, 1000);
}

function getTaskTypeForRound(round, mode, totalRounds) {
    if (mode === 'write_draw') {
        return round % 2 !== 0 ? 'prompt' : 'draw';
    } else if (mode === 'draw_write') {
        return round % 2 !== 0 ? 'draw' : 'prompt';
    } else if (mode === 'only_draw') {
        return 'draw';
    } else if (mode === 'only_write') {
        return 'prompt';
    } else if (mode === 'write_start_end') {
        if (round === 1 || round === totalRounds) return 'prompt';
        return 'draw';
    } else if (mode === 'write_start') {
        if (round === 1) return 'prompt';
        return 'draw';
    } else if (mode === 'write_end') {
        if (round === totalRounds) return 'prompt';
        return 'draw';
    }
    return round % 2 !== 0 ? 'prompt' : 'draw';
}

function checkAndAdvanceRoundHost() {
    if (myAddr !== getActingHostAddr() || state.screen !== 'playing' || !state.currentRound || state.resultsRevealed) return;
    
    const activePlayingAddrs = state.playingAddrs ? state.playingAddrs.filter(addr => !state.inactiveAddrs || !state.inactiveAddrs.includes(addr)) : [];
    if (activePlayingAddrs.length < 2) {
        if (state.currentRound <= 1) {
            alert(getTranslation('alert_too_few_active'));
            sendAction('BACK_LOBBY');
        } else {
            sendAction('SHOW_RESULTS', { endedInactive: true });
        }
        return;
    }
    
    const subs = state.submissions[state.currentRound] || {};
    const allSubmitted = activePlayingAddrs.every(addr => subs[addr] !== undefined);
    
    if (allSubmitted) {
        if (state.currentRound < state.totalRounds) {
            sendAction('NEXT_ROUND', { round: state.currentRound + 1, startTime: Date.now() });
        } else {
            sendAction('SHOW_RESULTS');
        }
    }
}

// Target assignment logic
function determineTaskForRound(addr, round) {
    if (!state.playingAddrs) return null;
    // Inactive players never get a task, but the chain rotation always uses the
    // full list of players who started the game, so every album keeps its own
    // prompt -> drawing chain even when someone stops playing.
    if (state.inactiveAddrs && state.inactiveAddrs.includes(addr)) return null;
    const chainAddrs = state.playingAddrs;
    const idx = chainAddrs.indexOf(addr);
    if (idx === -1) return null;
    
    const n = chainAddrs.length;
    if (n === 0) return null;
    
    let chainIdx = (idx - (round - 1)) % n;
    if (chainIdx < 0) chainIdx += n;
    const chainOwner = chainAddrs[chainIdx];
    
    let type = getTaskTypeForRound(round, state.settings.mode, state.totalRounds);
    let contextData = null;
    let prevDrawing = null;
    
    if (round > 1) {
        const prevRound = round - 1;
        let prevAssigneeIdx = (chainIdx + (prevRound - 1)) % n;
        const prevAssignee = chainAddrs[prevAssigneeIdx];
        
        const prevRoundType = getTaskTypeForRound(prevRound, state.settings.mode, state.totalRounds);
        
        if (type === 'prompt') {
            if (prevRoundType === 'draw') {
                if (state.submissions[prevRound] && state.submissions[prevRound][prevAssignee] !== undefined) {
                    contextData = state.submissions[prevRound][prevAssignee];
                }
            } else {
                if (state.submissions[prevRound] && state.submissions[prevRound][prevAssignee] !== undefined) {
                    contextData = state.submissions[prevRound][prevAssignee];
                } else {
                    contextData = null;
                }
            }
        } else if (type === 'draw') {
            if (prevRoundType === 'prompt') {
                if (state.submissions[prevRound] && state.submissions[prevRound][prevAssignee] !== undefined) {
                    contextData = state.submissions[prevRound][prevAssignee];
                }
            } else {
                // Consecutive draw -> onion skin and find prompt context
                let promptFound = '';
                for (let r = prevRound; r >= 1; r--) {
                    if (getTaskTypeForRound(r, state.settings.mode, state.totalRounds) === 'prompt') {
                        let assigneeIdx = (chainIdx + (r - 1)) % n;
                        const assignee = chainAddrs[assigneeIdx];
                        if (state.submissions[r] && state.submissions[r][assignee] !== undefined) {
                            promptFound = state.submissions[r][assignee];
                            break;
                        }
                    }
                }
                contextData = promptFound;
                
                if (state.submissions[prevRound] && state.submissions[prevRound][prevAssignee] !== undefined) {
                    prevDrawing = state.submissions[prevRound][prevAssignee];
                }
            }
        }
    }
    
    return { type, contextData, prevDrawing, chainOwner };
}

function submitPrompt() {
    if (isSubmitted) {
        sendAction('CANCEL_SUBMIT', { round: state.currentRound });
        isSubmitted = false;
    } else {
        const isConsecutivePrompt = isConsecutivePromptRound(state.currentRound);
        const text = isConsecutivePrompt ? promptTextarea.value.trim() : promptInput.value.trim();
        if (!text) {
            alert(getTranslation('alert_no_prompt'));
            return;
        }
        sendAction('SUBMIT', { round: state.currentRound, data: text });
        isSubmitted = true;
    }
    updateGameUI();
}

function submitDraw() {
    if (isSubmitted) {
        sendAction('CANCEL_SUBMIT', { round: state.currentRound });
        isSubmitted = false;
    } else {
        const hasDrawing = drawingSvg && drawingSvg.children.length > 0;
        if (!hasDrawing) {
            return;
        }
        const elements = getDrawingElements();
        sendAction('SUBMIT', { round: state.currentRound, data: elements });
        isSubmitted = true;
    }
    updateGameUI();
}

// ---- Drawing Logic ----
function setupDrawingTools() {
    const allColorBtns = document.querySelectorAll('.color-btn');
    allColorBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Avoid unselecting when clicking input directly
            if (e.target.tagName === 'INPUT') return;
            allColorBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            currentColor = btn.dataset.color || '#000000';
        });
    });

    const inputCustomColor = document.getElementById('input-custom-color');
    const btnCustomColor = document.getElementById('btn-custom-color');
    
    // Set first black color as active initially
    const blackBtn = document.querySelector('.color-btn[data-color="#000000"]');
    if (blackBtn) blackBtn.classList.add('selected');

    if (inputCustomColor && btnCustomColor) {
        const handleCustomColorInput = (e) => {
            const selectedColor = e.target.value;
            btnCustomColor.style.background = selectedColor;
            btnCustomColor.dataset.color = selectedColor;
            currentColor = selectedColor;
            
            allColorBtns.forEach(b => b.classList.remove('selected'));
            btnCustomColor.classList.add('selected');
        };
        inputCustomColor.addEventListener('input', handleCustomColorInput);
        inputCustomColor.addEventListener('change', handleCustomColorInput);
    }
    
    toolSize.addEventListener('input', (e) => {
        currentStrokeWidth = e.target.value;
    });
    
    btnUndo.addEventListener('click', () => {
        if (svgHistory.length > 0) {
            const last = svgHistory.pop();
            if (last instanceof SVGElement) {
                if (drawingSvg.contains(last)) {
                    drawingSvg.removeChild(last);
                }
            } else if (last && last.type === 'background') {
                if (last.prevColor) {
                    bgRect.setAttribute('fill', last.prevColor);
                } else {
                    if (bgRect && drawingSvg.contains(bgRect)) {
                        drawingSvg.removeChild(bgRect);
                    }
                    bgRect = null;
                }
            }
        }
        updateGameUI();
    });
    
    if (btnToolBackground) {
        btnToolBackground.addEventListener('click', () => {
            setCanvasBackground(currentColor);
            updateGameUI();
        });
    }
    
    // SVG coordinates
    const getCoords = (e) => {
        const pt = drawingSvg.createSVGPoint();
        if (e.touches && e.touches.length > 0) {
            pt.x = e.touches[0].clientX;
            pt.y = e.touches[0].clientY;
        } else {
            pt.x = e.clientX;
            pt.y = e.clientY;
        }
        const ctm = drawingSvg.getScreenCTM();
        if(!ctm) return {x: 0, y: 0};
        return pt.matrixTransform(ctm.inverse());
    };
    
    const startDraw = (e) => {
        e.preventDefault();
        isDrawing = true;
        const coords = getCoords(e);
        
        currentPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        currentPath.setAttribute('fill', 'transparent');
        currentPath.setAttribute('stroke', currentColor);
        currentPath.setAttribute('stroke-width', currentStrokeWidth);
        currentPath.setAttribute('stroke-linecap', 'round');
        currentPath.setAttribute('stroke-linejoin', 'round');
        currentPath.setAttribute('d', `M ${coords.x} ${coords.y}`);
        
        drawingSvg.appendChild(currentPath);
    };
    
    const draw = (e) => {
        if (!isDrawing || !currentPath) return;
        e.preventDefault();
        const coords = getCoords(e);
        const d = currentPath.getAttribute('d');
        currentPath.setAttribute('d', `${d} L ${coords.x} ${coords.y}`);
    };
    
    const stopDraw = () => {
        if (isDrawing && currentPath) {
            svgHistory.push(currentPath);
        }
        isDrawing = false;
        currentPath = null;
        updateGameUI();
    };
    
    drawingSvg.addEventListener('mousedown', startDraw);
    drawingSvg.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDraw);
    
    drawingSvg.addEventListener('touchstart', startDraw, {passive: false});
    drawingSvg.addEventListener('touchmove', draw, {passive: false});
    window.addEventListener('touchend', stopDraw);
}

function clearCanvas() {
    drawingSvg.innerHTML = '';
    svgHistory = [];
    bgRect = null;
    updateGameUI();
}

// Paint the canvas background with the currently selected color. The color is
// stored as a <rect> inside the SVG so it becomes part of the shared drawing.
function setCanvasBackground(color) {
    const prevColor = bgRect ? bgRect.getAttribute('fill') : null;
    if (!bgRect) {
        bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', 0);
        bgRect.setAttribute('y', 0);
        bgRect.setAttribute('width', 400);
        bgRect.setAttribute('height', 400);
        drawingSvg.insertBefore(bgRect, drawingSvg.firstChild);
    }
    bgRect.setAttribute('fill', color);
    svgHistory.push({ type: 'background', prevColor });
}

// Serialize the current drawing (background rect first, then strokes) for
// sharing through webxdc updates.
function getDrawingElements() {
    return Array.from(drawingSvg.children).map(el => el.outerHTML);
}

// ---- Results Logic ----
let resultChains = [];
let currentChainIdx = 0;
let currentStepIdx = 0;
let autoAdvanceTimer = null;

// Remember which album the player was last viewing (or saving), so a player
// who reopens the app lands back on that timeline.
function saveLastChainIdx(idx) {
    try { localStorage.setItem('dartic_last_chain_idx', String(idx)); } catch (e) {}
}
function getSavedChainIdx() {
    try {
        const v = parseInt(localStorage.getItem('dartic_last_chain_idx'), 10);
        return isNaN(v) ? -1 : v;
    } catch (e) { return -1; }
}

function prepareResults() {
    // Reconstruct the chains
    resultChains = [];
    if (!state.playingAddrs) return;
    
    // Build chains from everyone who started the game so each album keeps its
    // own prompt -> drawing chain; players who never finished simply leave a
    // missing step in their album.
    const chainAddrs = state.playingAddrs;
    const n = chainAddrs.length;
    if (n === 0) return;
    
    chainAddrs.forEach((ownerAddr, chainIdx) => {
        const chain = {
            owner: state.players.find(p => p.addr === ownerAddr)?.name || 'Unknown',
            steps: []
        };
        
        for (let r = 1; r <= state.totalRounds; r++) {
            let assigneeIdx = (chainIdx + (r - 1)) % n;
            const assigneeAddr = chainAddrs[assigneeIdx];
            const data = state.submissions[r] && state.submissions[r][assigneeAddr];
            const hasData = data !== undefined && data !== null && data !== '' && (!Array.isArray(data) || data.length > 0);
            const author = state.players.find(p => p.addr === assigneeAddr)?.name || getTranslation('unknown');
            const type = getTaskTypeForRound(r, state.settings.mode, state.totalRounds);
            
            chain.steps.push({
                round: r,
                author,
                type,
                data: hasData ? data : undefined
            });
        }
        if (chain.steps.length > 0) {
            resultChains.push(chain);
        }
    });
    
    if (isRestoring) {
        // Returning to an already-finished game: show the full timeline of the
        // album the player was last viewing, without the step-by-step animation.
        if (resultChains.length === 0) return;
        const savedIdx = getSavedChainIdx();
        currentChainIdx = (savedIdx >= 0 && savedIdx < resultChains.length) ? savedIdx : 0;
        showFullTimelineInstant(currentChainIdx);
        if (resultAlbumTitle) {
            resultAlbumTitle.innerText = getTranslation('album_of').replace('{name}', resultChains[currentChainIdx].owner);
            resultAlbumTitle.classList.remove('hidden');
        }
        renderTimelineTabs();
        if (btnBackLobby) btnBackLobby.classList.remove('hidden');
        if (btnDownloadResults) btnDownloadResults.classList.remove('hidden');
        if (btnNextResult) btnNextResult.classList.add('hidden');
        return;
    }
    
    currentChainIdx = 0;
    startChainReveal();
}

function startChainReveal() {
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }
    
    // Hide tabs wrapper when presenting sequentially
    const tabsWrapper = document.getElementById('results-tabs-wrapper');
    if (tabsWrapper) tabsWrapper.classList.add('hidden');
    
    resultsScrollArea.innerHTML = '';
    currentStepIdx = 0;
    
    // Hide footer action buttons during automatic sequential reveal
    btnNextResult.classList.add('hidden');
    btnBackLobby.classList.add('hidden');
    if (btnDownloadResults) btnDownloadResults.classList.add('hidden');
    
    if (currentChainIdx >= resultChains.length) {
        return;
    }
    
    const chain = resultChains[currentChainIdx];
    if (resultAlbumTitle) {
        resultAlbumTitle.innerText = getTranslation('album_of').replace('{name}', chain.owner);
        resultAlbumTitle.classList.remove('hidden');
    }
    
    // Start revealing items one by one
    revealNextStep();
}

function revealNextStep() {
    const chain = resultChains[currentChainIdx];
    if (!chain) return;
    
    if (currentStepIdx < chain.steps.length) {
        const step = chain.steps[currentStepIdx];
        const el = document.createElement('div');
        el.className = 'result-card fade-in';
        
        const authorP = document.createElement('p');
        authorP.className = 'result-author';
        const actionText = step.type === 'prompt' ? getTranslation('wrote') : getTranslation('drew');
        authorP.innerText = `${step.author} ${actionText}`;
        el.appendChild(authorP);
        
        if (step.type === 'prompt') {
            const content = document.createElement('h3');
            content.className = 'result-text';
            content.innerText = step.data || getTranslation('no_answer');
            el.appendChild(content);
        } else {
            const svgContainer = document.createElement('div');
            svgContainer.className = 'result-svg-container';
            if (step.data && Array.isArray(step.data)) {
                svgContainer.innerHTML = `<svg viewBox="0 0 400 400" class="w-full h-full">${step.data.join('')}</svg>`;
            } else {
                 svgContainer.innerHTML = `<div class="flex-center h-full text-secondary">${getTranslation('no_drawing')}</div>`;
            }
            el.appendChild(svgContainer);
        }
        
        resultsScrollArea.appendChild(el);
        
        // Smooth scroll to bottom
        setTimeout(() => {
            resultsScrollArea.scrollTo({
                top: resultsScrollArea.scrollHeight,
                behavior: 'smooth'
            });
        }, 100);
        
        currentStepIdx++;
        
        // Auto-advance to the next item every 3 seconds
        autoAdvanceTimer = setTimeout(revealNextStep, 3000);
    } else {
        // Finished revealing this chain! Show appropriate actions at the bottom
        if (btnDownloadResults) btnDownloadResults.classList.remove('hidden');
        if (currentChainIdx < resultChains.length - 1) {
            // Not the last chain: show the "Next" (بعدی) button to ALL players
            btnNextResult.classList.remove('hidden');
            btnBackLobby.classList.add('hidden');
        } else {
            // Last chain: show "Back to Lobby" (بازگشت به لابی) button to everyone
            btnBackLobby.classList.remove('hidden');
            btnNextResult.classList.add('hidden');
            
            // Render all timeline tabs!
            renderTimelineTabs();
        }
    }
}

function renderTimelineTabs() {
    const tabsWrapper = document.getElementById('results-tabs-wrapper');
    const tabsContainer = document.getElementById('results-tabs-container');
    if (!tabsWrapper || !tabsContainer) return;

    tabsWrapper.classList.remove('hidden');
    tabsContainer.innerHTML = '';

    resultChains.forEach((chain, idx) => {
        const tabBtn = document.createElement('button');
        tabBtn.className = idx === currentChainIdx ? 'btn btn-yellow px-4 py-2 text-sm mx-1 my-1' : 'btn btn-light px-4 py-2 text-sm mx-1 my-1';
        tabBtn.style.whiteSpace = 'nowrap';
        tabBtn.innerText = chain.owner;
        
        tabBtn.addEventListener('click', () => {
            // Update active tab styles
            const allTabs = tabsContainer.querySelectorAll('button');
            allTabs.forEach((btn, tIdx) => {
                if (tIdx === idx) {
                    btn.className = 'btn btn-yellow px-4 py-2 text-sm mx-1 my-1';
                } else {
                    btn.className = 'btn btn-light px-4 py-2 text-sm mx-1 my-1';
                }
            });
            
            // Render the full timeline of this tab WITHOUT ANIMATION
            showFullTimelineInstant(idx);
        });
        tabsContainer.appendChild(tabBtn);
    });
}

function showFullTimelineInstant(chainIdx) {
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }
    
    if (btnDownloadResults) btnDownloadResults.classList.remove('hidden');
    currentChainIdx = chainIdx;
    saveLastChainIdx(chainIdx);
    resultsScrollArea.innerHTML = '';
    
    const chain = resultChains[chainIdx];
    if (!chain) return;
    
    chain.steps.forEach(step => {
        const el = document.createElement('div');
        el.className = 'result-card'; // No 'fade-in' class to prevent animations!
        
        const authorP = document.createElement('p');
        authorP.className = 'result-author';
        const actionText = step.type === 'prompt' ? getTranslation('wrote') : getTranslation('drew');
        authorP.innerText = `${step.author} ${actionText}`;
        el.appendChild(authorP);
        
        if (step.type === 'prompt') {
            const content = document.createElement('h3');
            content.className = 'result-text';
            content.innerText = step.data || getTranslation('no_answer');
            el.appendChild(content);
        } else {
            const svgContainer = document.createElement('div');
            svgContainer.className = 'result-svg-container';
            if (step.data && Array.isArray(step.data)) {
                svgContainer.innerHTML = `<svg viewBox="0 0 400 400" class="w-full h-full">${step.data.join('')}</svg>`;
            } else {
                 svgContainer.innerHTML = `<div class="flex-center h-full text-secondary">${getTranslation('no_drawing')}</div>`;
            }
            el.appendChild(svgContainer);
        }
        
        resultsScrollArea.appendChild(el);
    });
    
    // Auto scroll to top
    resultsScrollArea.scrollTop = 0;
}

function showNextResult() {
    // Each player advances through the timelines on their own device
    currentChainIdx++;
    startChainReveal();
}

function copyChainTranscript(chain) {
    saveLastChainIdx(currentChainIdx);
    const lines = [];
    lines.push(getTranslation('album_of').replace('{name}', chain.owner));
    chain.steps.forEach((step, i) => {
        const actionText = step.type === 'prompt' ? getTranslation('wrote') : getTranslation('drew');
        if (step.type === 'prompt') {
            lines.push(`${i + 1}. ${step.author} ${actionText} ${step.data || getTranslation('no_answer')}`);
        } else {
            lines.push(`${i + 1}. ${step.author} ${actionText} 🎨`);
        }
    });
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
    } else {
        fallbackCopyText(text);
    }
}

function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
}

function updateHourglassButton() {
    if (!state.currentRound || !state.playingAddrs) return;
    const subs = state.submissions[state.currentRound] || {};
    const activeAddrs = state.playingAddrs.filter(addr => !state.inactiveAddrs || !state.inactiveAddrs.includes(addr));
    let completedCount = 0;
    activeAddrs.forEach(addr => {
        if (subs[addr] !== undefined) completedCount++;
    });
    const totalCount = activeAddrs.length;
    const countEl = document.getElementById('status-completed-count');
    if (countEl) {
        countEl.innerText = `${completedCount}/${totalCount}`;
    }
}

function updateHourglassDropdown() {
    if (!state.currentRound || !state.playingAddrs || !statusPlayerList) return;
    const subs = state.submissions[state.currentRound] || {};
    statusPlayerList.innerHTML = '';
    
    // Active players in current game
    const activeAddrs = state.playingAddrs.filter(addr => !state.inactiveAddrs || !state.inactiveAddrs.includes(addr));
    
    activeAddrs.forEach(addr => {
        const p = state.players.find(x => x.addr === addr) || { name: getTranslation('unknown') };
        const hasSubmitted = subs[addr] !== undefined;
        const statusIcon = hasSubmitted ? '✅' : '⏳';
        const statusText = hasSubmitted ? getTranslation('done_status') : getTranslation('waiting_status');
        const colorClass = hasSubmitted ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400';
        
        statusPlayerList.innerHTML += `<li class="flex justify-between items-center w-full py-1">
            <span class="font-bold text-gray-800 dark:text-gray-100">${escapeHtml(p.name)}</span>
            <span class="flex items-center gap-1.5 text-xs font-bold ${colorClass}">
                <span>${statusText}</span>
                <span class="text-base">${statusIcon}</span>
            </span>
        </li>`;
    });
}

function checkPlayerSessionStatus() {
    if (state.screen === 'playing') {
        // If we are not in playingAddrs, we are a spectator
        if (state.playingAddrs && !state.playingAddrs.includes(myAddr)) {
            isTempSpectator = true;
        } else if (state.playingAddrs) {
            // Check if we missed any previous rounds of the current game
            let missedRound = false;
            for (let r = 1; r < state.currentRound; r++) {
                if (state.submissions[r] && state.submissions[r][myAddr] === undefined) {
                    missedRound = true;
                    break;
                }
            }
            if (missedRound) {
                isTempSpectator = true;
            }
        }
    } else if (state.screen === 'results') {
        // Players who took part in the game can come back and review the
        // results (e.g. after saving a timeline notebook); only players who
        // were never part of the game are sent to the lobby.
        const wasInGame = state.playingAddrs && state.playingAddrs.includes(myAddr);
        if (!wasInGame) {
            alert(getTranslation('prev_finished'));
            isTempSpectator = false;
            // Go to lobby
            state.screen = 'lobby';
            state.currentRound = 0;
            state.submissions = {};
            state.resultsRevealed = false;
            state.players.forEach(p => p.ready = false);
            updateUI();
        }
    }
}

async function generateWebMVideo(chain) {
    if (!btnDownloadResults) return;
    saveLastChainIdx(currentChainIdx);
    const originalText = btnDownloadResults.innerHTML;
    btnDownloadResults.disabled = true;
    btnDownloadResults.innerHTML = currentLang === 'fa' ? '⏳ در حال آماده‌سازی...' : '⏳ Preparing...';

    try {
        // 1. Pre-load all drawings as Images
        const loadImgPromises = chain.steps.map((step) => {
            if (step.type === 'draw' && step.data && Array.isArray(step.data)) {
                return new Promise((resolve) => {
                    const img = new Image();
                    const svgContent = step.data.join('');
                    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" style="background: white;">${svgContent}</svg>`;
                    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    img.onload = () => {
                        URL.revokeObjectURL(url);
                        resolve(img);
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        resolve(null);
                    };
                    img.src = url;
                });
            }
            return Promise.resolve(null);
        });
        const loadedImages = await Promise.all(loadImgPromises);

        // 2. Setup canvas 512x512
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // 3. Setup MediaRecorder
        const stream = canvas.captureStream(30); // 30 fps
        let recorder;
        const mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
        for (const mime of mimes) {
            if (MediaRecorder.isTypeSupported(mime)) {
                try {
                    recorder = new MediaRecorder(stream, { mimeType: mime });
                    break;
                } catch (e) {}
            }
        }
        if (!recorder) {
            recorder = new MediaRecorder(stream);
        }

        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                chunks.push(e.data);
            }
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
            const fileName = `${chain.owner}-timeline.webm`;
            const textMsg = currentLang === 'fa' 
                ? `🎬 ویدیو دفترچه ${chain.owner}` 
                : `🎬 Results video for ${chain.owner}'s album`;

            if (window.webxdc && typeof window.webxdc.sendToChat === 'function') {
                try {
                    window.webxdc.sendToChat({
                        file: { name: fileName, blob: blob },
                        text: textMsg
                    }).catch((err) => {
                        console.warn('sendToChat failed, falling back to download:', err);
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = fileName;
                        a.click();
                        URL.revokeObjectURL(url);
                    });
                } catch (e) {
                    console.warn('sendToChat exception, falling back to download:', e);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    a.click();
                    URL.revokeObjectURL(url);
                }
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
            }

            btnDownloadResults.disabled = false;
            btnDownloadResults.innerHTML = originalText;
        };

        // Start recording
        recorder.start();
        btnDownloadResults.innerHTML = currentLang === 'fa' ? '📹 در حال ضبط ویدیو...' : '📹 Recording video...';

        let currentStep = 0;
        let stepStartTime = Date.now();
        const durationPerStep = 2500; // 2.5 seconds per step

        const renderInterval = setInterval(() => {
            const elapsed = Date.now() - stepStartTime;
            if (elapsed >= durationPerStep) {
                currentStep++;
                stepStartTime = Date.now();
                if (currentStep >= chain.steps.length) {
                    clearInterval(renderInterval);
                    setTimeout(() => {
                        recorder.stop();
                    }, 500); // short delay to capture the final frame fully
                    return;
                }
            }

            const step = chain.steps[currentStep];

            // Clear canvas with gradient background
            const grad = ctx.createLinearGradient(0, 0, 0, 512);
            grad.addColorStop(0, '#7c3aed');
            grad.addColorStop(1, '#4c1d95');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 512, 512);

            // Draw title header bar
            ctx.fillStyle = '#facc15';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 4;
            ctx.fillRect(0, 0, 512, 60);
            ctx.strokeRect(-2, -2, 516, 64);

            // Album Title text
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 20px Vazirmatn, Vazir, Arad, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const albumTitle = getTranslation('album_of').replace('{name}', chain.owner);
            ctx.fillText(albumTitle, 256, 30);

            // Card coordinates
            const cardX = 40;
            const cardY = 100;
            const cardW = 432;
            const cardH = 370;

            // 1. Brutalist Shadow
            ctx.fillStyle = '#000000';
            ctx.fillRect(cardX + 8, cardY + 8, cardW, cardH);

            // 2. Card White Container
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 4;
            ctx.fillRect(cardX, cardY, cardW, cardH);
            ctx.strokeRect(cardX, cardY, cardW, cardH);

            // 3. Author Badge Banner
            const bannerX = cardX + 24;
            const bannerY = cardY + 24;
            const bannerW = cardW - 48;
            const bannerH = 46;

            ctx.fillStyle = '#fef08a';
            ctx.fillRect(bannerX, bannerY, bannerW, bannerH);
            ctx.strokeRect(bannerX, bannerY, bannerW, bannerH);

            // Author and action text
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 18px Vazirmatn, Vazir, Arad, sans-serif';
            const actionText = step.type === 'prompt' ? getTranslation('wrote') : getTranslation('drew');
            ctx.fillText(`${step.author} ${actionText}`, bannerX + bannerW / 2, bannerY + bannerH / 2);

            // 4. Draw Step Content
            if (step.type === 'prompt') {
                ctx.fillStyle = '#1e293b';
                ctx.font = 'bold 22px Vazirmatn, Vazir, Arad, sans-serif';

                // Wrap text
                const text = step.data || '---';
                const words = text.split(' ');
                let line = '';
                const lines = [];
                const maxTextWidth = cardW - 60;
                for (let n = 0; n < words.length; n++) {
                    const testLine = line + words[n] + ' ';
                    const metrics = ctx.measureText(testLine);
                    if (metrics.width > maxTextWidth && n > 0) {
                        lines.push(line);
                        line = words[n] + ' ';
                    } else {
                        line = testLine;
                    }
                }
                lines.push(line);

                const startTextY = cardY + 110 + (130 - (lines.length * 15));
                for (let j = 0; j < lines.length; j++) {
                    ctx.fillText(lines[j].trim(), cardX + cardW / 2, startTextY + (j * 32));
                }
            } else {
                // SVG Drawing
                const img = loadedImages[currentStep];
                if (img) {
                    const drawW = 260;
                    const drawH = 260;
                    const drawX = cardX + (cardW - drawW) / 2;
                    const drawY = cardY + 90;
                    ctx.drawImage(img, drawX, drawY, drawW, drawH);

                    // subtle border
                    ctx.strokeStyle = '#e2e8f0';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(drawX, drawY, drawW, drawH);
                } else {
                    ctx.fillStyle = '#94a3b8';
                    ctx.font = 'italic 16px Vazirmatn, Vazir, Arad, sans-serif';
                    ctx.fillText(getTranslation('no_drawing'), cardX + cardW / 2, cardY + 220);
                }
            }
        }, 1000 / 30);

    } catch (err) {
        console.error(err);
        btnDownloadResults.disabled = false;
        btnDownloadResults.innerHTML = originalText;
        alert(currentLang === 'fa' ? 'خطا در ساخت ویدیو' : 'Error generating video');
    }
}

window.onload = init;
