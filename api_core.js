/**
 * ============================================================================
 * 模組 1：API 核心、全域狀態與基礎 UI 工具 (api_core.js)
 * ============================================================================
 */

// 🔴 系統 API 端點 (已更新為測試環境專用網址)
const API_URL = "https://script.google.com/macros/s/AKfycbwR4pxjLSldLQW3sG7y8FiTPyV4mZg4rq0L33k0Htz26RxK8mrjFpucpW7pnBmpZaXD/exec";

// ============================================================================
// 全域變數與狀態管理
// ============================================================================
let myName = ""; 
let myUid = localStorage.getItem('invUid') || Math.random().toString(36).substring(2); 
localStorage.setItem('invUid', myUid);

let globalClients = []; 
let globalSuppliers = []; 
let globalCatalog = []; 
let globalHistory = []; 
let globalOrders = []; 
let globalInventory = []; 
let globalSalesDetails = []; 
let globalInvLogs = []; 
let emailSettingsData = { list: [], selected: [] };

let myLastSyncTime = 0;

let aiTempData = null; 
let currentOrderManualItems = []; 
let selectedOrderCache = []; 
let currentInvoiceData = { clientName:'', taxId:'', items:[] }; 
let currentSearchSource = []; 
let currentSearchCallback = null;

// ============================================================================
// API 通訊模組
// ============================================================================
async function callApi(action, payload = {}) {
    if (API_URL.includes("請填入你的")) throw new Error("⚠️ 尚未設定 API_URL，請更新 api_core.js 中的網址！");
    try {
        const response = await fetch(API_URL, { 
            method: 'POST', 
            redirect: 'follow', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
            body: JSON.stringify({ action: action, payload: payload }) 
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);
        return result.data;
    } catch (err) { 
        console.error(`[API Error] ${action}:`, err); 
        throw err; 
    }
}

// ============================================================================
// 背景同步佇列系統
// ============================================================================
let bgSyncQueue = []; 
let isSyncing = false; 
let syncTimeoutTimer = null;

function pushToSyncQueue(action, payload, callback) { 
    if (payload && typeof payload === 'object') {
        payload.clientSyncTime = myLastSyncTime;
    }
    bgSyncQueue.push({ action, payload, callback, retry: 0 }); 
    updateSyncIndicator(); 
    triggerSync(); 
}

function triggerSync() {
    if (isSyncing || bgSyncQueue.length === 0) return; 
    isSyncing = true; 
    const task = bgSyncQueue[0];
    
    clearTimeout(syncTimeoutTimer);
    syncTimeoutTimer = setTimeout(() => {
        console.warn("同步超時，強制重置狀態");
        task.retry += 1;
        handleSyncRetry(task);
    }, 15000);

    callApi(task.action, task.payload).then(res => {
        clearTimeout(syncTimeoutTimer);
        bgSyncQueue.shift(); 
        if(task.callback) task.callback(res); 
        updateSyncIndicator(); 
        isSyncing = false; 
        
        if (bgSyncQueue.length === 0) silentRefreshData();
        else triggerSync();
    }).catch(e => {
        clearTimeout(syncTimeoutTimer);
        console.error("背景傳輸異常", e); 
        if (e.message && e.message.includes("DIRTY_READ")) {
            alert(e.message);
            bgSyncQueue.shift();
            isSyncing = false;
            return;
        }
        task.retry += 1;
        handleSyncRetry(task);
    });
}

function handleSyncRetry(task) {
    if (task.retry > 3) {
        console.warn("任務失敗超過3次，轉存至 LocalStorage");
        let failedTasks = [];
        try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
        failedTasks.push(task);
        localStorage.setItem('failedSyncTasks', JSON.stringify(failedTasks));
        bgSyncQueue.shift(); 
        checkFailedTasks(); 
    }
    isSyncing = false; 
    setTimeout(triggerSync, 5000); 
}

function checkFailedTasks() {
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    let btn = document.getElementById('btnRetrySync');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btnRetrySync';
        btn.className = 'btn btn-danger fw-bold shadow position-fixed';
        btn.style.cssText = 'bottom: 20px; right: 20px; z-index: 10800; border-radius: 30px; padding: 10px 20px; font-size: 0.9rem;';
        btn.onclick = window.retryFailedTasks;
        document.body.appendChild(btn);
    }
    if (failedTasks.length > 0) {
        btn.innerText = `🔴 有 ${failedTasks.length} 筆未同步資料 (點擊重試)`;
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
    }
}

window.retryFailedTasks = function() {
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    if (failedTasks.length === 0) return alert("沒有未同步的資料");
    failedTasks.forEach(task => { task.retry = 0; bgSyncQueue.push(task); });
    localStorage.removeItem('failedSyncTasks');
    checkFailedTasks();
    updateSyncIndicator();
    triggerSync();
    showToast("🔄 已將失敗任務重新加入同步佇列");
}

function updateSyncIndicator() { 
    const ind = document.getElementById('bgSyncIndicator'); 
    if(bgSyncQueue.length > 0) { 
        ind.innerText = `☁️ ${bgSyncQueue.length} 筆同步中...`; 
        ind.style.display = 'block'; 
    } else { 
        ind.innerText = `✅ 同步完成`; 
        setTimeout(()=> ind.style.display = 'none', 2000); 
    } 
}

function silentRefreshData() {
    callApi('getInitData', {}).then(res => {
        globalClients = res.clients||[]; globalSuppliers = res.suppliers||[]; globalCatalog = res.catalog||[]; globalHistory = res.history||[]; globalOrders = res.orders||[]; globalInventory = res.inventory||[]; globalSalesDetails = res.salesDetails||[]; globalInvLogs = res.invLogs||[];
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        
        // 防護機制：確認其他模組已載入再呼叫
        if (typeof populateAdminClientFilter === "function") populateAdminClientFilter();
        if (typeof updateHistoryDropdowns === "function") updateHistoryDropdowns();
        if (typeof populateLogDropdowns === "function") populateLogDropdowns();
        if (typeof updateOrderClientDropdown === "function") updateOrderClientDropdown();
        if (typeof renderEmailSettings === "function") renderEmailSettings();
        
        if(document.getElementById('sys-history').style.display === 'block' && typeof window.renderHistory === "function") { window.renderHistory(); generateReport(); }
        if(document.getElementById('sys-admin').style.display === 'block' && typeof window.renderAdminItems === "function") { window.renderAdminItems(); window.renderAdminClients(); }
        if(document.getElementById('sys-order').style.display === 'block' && typeof window.renderOrderList === "function") window.renderOrderList();
        if(document.getElementById('sys-inventory').style.display === 'block' && typeof window.renderInventory === "function") { window.renderInventory(); window.renderInvLogs(); renderShipments(); }
    }).catch(err => console.log('背景默默同步失敗:', err));
}

// ============================================================================
// 基礎工具與 UI 函式
// ============================================================================
function getTodayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function setSafeText(elementId, textValue) { const el = document.getElementById(elementId); if (el) el.innerText = textValue; }
function escapeQuotes(str) { return !str ? '' : String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;"); }
function lockScreen() { document.body.classList.add('no-scroll'); } 
function unlockScreen() { document.body.classList.remove('no-scroll'); }
function setProgress(pct, text) { document.getElementById('splashProgress').style.width = pct + '%'; if(text) document.getElementById('splashText').innerText = text; }
function showLoading(msg="處理中...") { document.getElementById('miniLoadingText').innerText = msg; document.getElementById('miniLoading').style.display = 'flex'; }
function hideLoading() { document.getElementById('miniLoading').style.display = 'none'; }
function showToast(msg) { const tb = document.getElementById('toastBox'); tb.innerText = msg; tb.style.display = 'block'; setTimeout(()=> tb.style.opacity = '1', 10); setTimeout(() => { tb.style.opacity = '0'; setTimeout(()=> tb.style.display = 'none', 300); }, 2500); }

function debounce(func, delay = 300) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

// ============================================================================
// 拖曳排序 (Drag & Drop) 邏輯
// ============================================================================
let draggedRowId = null;
let draggedType = null;

window.handleDragStart = function(e, id, type) {
    draggedRowId = id; draggedType = type;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
    e.target.style.border = '2px dashed #adb5bd';
};
window.handleDragOver = function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; };
window.handleDragEnter = function(e) { e.currentTarget.style.borderTop = '3px solid #0d6efd'; };
window.handleDragLeave = function(e) { e.currentTarget.style.borderTop = ''; };
window.handleDrop = function(e, targetId, type) {
    e.stopPropagation(); e.currentTarget.style.borderTop = '';
    if (draggedRowId !== targetId && draggedType === type) {
        let arr = type === 'order' ? currentOrderManualItems : currentInvoiceData.items;
        let fromIndex = arr.findIndex(x => x.id === draggedRowId);
        let toIndex = arr.findIndex(x => x.id === targetId);
        if (fromIndex >= 0 && toIndex >= 0) {
            const [movedItem] = arr.splice(fromIndex, 1);
            arr.splice(toIndex, 0, movedItem);
            if (type === 'order' && typeof reRenderOrderManualItems === "function") reRenderOrderManualItems();
            if (type === 'invoice' && typeof reRenderInvoiceItems === "function") reRenderInvoiceItems();
        }
    }
    return false;
};
document.addEventListener('dragend', function(e) {
    if (e.target.style) { e.target.style.opacity = '1'; e.target.style.border = ''; }
    document.querySelectorAll('.draggable-row').forEach(el => el.style.borderTop = '');
});

// ============================================================================
// 系統初始化與授權
// ============================================================================
window.onload = function() {
    lockScreen(); checkFailedTasks();
    const exp = localStorage.getItem('invTokenExp'); 
    if (document.getElementById('invDate')) document.getElementById('invDate').value = getTodayStr();
    if (exp && parseInt(exp) > Date.now()) { 
        myName = localStorage.getItem('invStaffName'); 
        document.getElementById('authScreen').style.display = 'none'; 
        initSystemData(); 
    } else { 
        document.getElementById('splashScreen').style.display = 'none'; 
        document.getElementById('authScreen').style.display = 'flex'; 
    }
    setInterval(() => { 
        if(document.getElementById('mainApp') && document.getElementById('mainApp').style.display === 'block') { 
            callApi('heartbeat', { uid: myUid }).then(count => { 
                if(document.getElementById('mqOnline')) document.getElementById('mqOnline').innerText = `👥 ${count} 人`; 
                if(document.getElementById('navOnlineCount')) document.getElementById('navOnlineCount').innerText = `👥 ${count}`; 
            }).catch(e => console.log('心跳同步失敗', e)); 
        } 
    }, 60000);
};

window.loginSystem = function() {
    const pwd = document.getElementById('frontDoorPwd').value; 
    if(!pwd) return alert("請輸入密碼");
    const btn = document.querySelector('#authScreen button'); 
    btn.innerText = "驗證中..."; btn.disabled = true;
    callApi('verifyManager', { pwd: pwd }).then(res => { 
        myName = res.managerName; 
        localStorage.setItem('invStaffName', myName); 
        localStorage.setItem('invTokenExp', Date.now() + 7 * 24 * 60 * 60 * 1000); 
        document.getElementById('authScreen').style.opacity = '0'; 
        setTimeout(() => { document.getElementById('authScreen').style.display = 'none'; initSystemData(); }, 500); 
    }).catch(err => { 
        btn.innerText = "進入系統"; btn.disabled = false; alert(err.message); 
    });
};

window.logout = function() { if(confirm("確定登出？")) { localStorage.removeItem('invStaffName'); localStorage.removeItem('invTokenExp'); location.reload(); } };

window.initSystemData = function() {
    document.getElementById('splashScreen').style.display = 'flex'; let fakeProgress = 10; setProgress(fakeProgress, '下載雲端資料庫...');
    const intv = setInterval(() => { fakeProgress += (85 - fakeProgress) * 0.15; setProgress(fakeProgress); }, 500);
    callApi('getInitData', {}).then(res => {
        clearInterval(intv); setProgress(100, '✅ 準備完成！');
        globalClients = res.clients || []; globalSuppliers = res.suppliers || []; globalCatalog = res.catalog || []; globalHistory = res.history || []; globalOrders = res.orders || []; globalInventory = res.inventory || []; globalSalesDetails = res.salesDetails || []; globalInvLogs = res.invLogs || [];
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        
        if (typeof populateAdminClientFilter === "function") populateAdminClientFilter();
        if (typeof updateHistoryDropdowns === "function") updateHistoryDropdowns();
        if (typeof populateLogDropdowns === "function") populateLogDropdowns();
        if (typeof updateOrderClientDropdown === "function") updateOrderClientDropdown();
        if (typeof renderEmailSettings === "function") renderEmailSettings();
        
        if(document.getElementById('mqMonthCount')) document.getElementById('mqMonthCount').innerText = `🧾 本月已開立 ${res.monthCount} 張`; 
        let daysLeft = Math.ceil((parseInt(localStorage.getItem('invTokenExp')) - Date.now()) / 86400000); 
        if(document.getElementById('welcomeName')) document.getElementById('welcomeName').innerText = `👋 ${myName}`; 
        if(document.getElementById('tokenCountdown')) document.getElementById('tokenCountdown').innerText = `🔐 憑證效期：${daysLeft} 天`;
        
        setTimeout(() => { 
            document.getElementById('splashScreen').style.opacity = '0'; 
            setTimeout(() => { 
                document.getElementById('splashScreen').style.display = 'none'; 
                unlockScreen(); 
                document.getElementById('homeMenu').style.display = 'block'; 
                if(typeof window.renderOrderList === "function") window.renderOrderList(); 
            }, 500); 
        }, 500);
    }).catch(e => { clearInterval(intv); alert("初始化失敗：" + e.message); });
};

window.refreshData = function() {
    showLoading("同步最新資料...");
    callApi('getInitData', {}).then(res => {
        globalClients = res.clients||[]; globalSuppliers = res.suppliers||[]; globalCatalog = res.catalog||[]; globalHistory = res.history||[]; globalOrders = res.orders||[]; globalInventory = res.inventory||[]; globalSalesDetails = res.salesDetails||[]; globalInvLogs = res.invLogs||[];
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        
        if (typeof populateAdminClientFilter === "function") populateAdminClientFilter();
        if (typeof updateHistoryDropdowns === "function") updateHistoryDropdowns();
        if (typeof populateLogDropdowns === "function") populateLogDropdowns();
        if (typeof updateOrderClientDropdown === "function") updateOrderClientDropdown();
        if (typeof renderEmailSettings === "function") renderEmailSettings();
        
        hideLoading(); showToast('✅ 已同步');
        
        if(document.getElementById('sys-history').style.display === 'block' && typeof window.renderHistory === "function") { window.renderHistory(); generateReport(); }
        if(document.getElementById('sys-admin').style.display === 'block' && typeof window.renderAdminItems === "function") { window.renderAdminItems(); window.renderAdminClients(); }
        if(document.getElementById('sys-order').style.display === 'block' && typeof window.renderOrderList === "function") window.renderOrderList();
        if(document.getElementById('sys-inventory').style.display === 'block' && typeof window.renderInventory === "function") { window.renderInventory(); window.renderInvLogs(); renderShipments(); }
    }).catch(err => { hideLoading(); alert("同步失敗：" + err.message); });
};

window.enterSystem = function(modId) {
    document.getElementById('homeMenu').style.display = 'none'; document.getElementById('mainApp').style.display = 'block';
    document.querySelectorAll('.sys-module').forEach(el => el.style.display = 'none'); document.getElementById(`sys-${modId}`).style.display = 'block';
    const titles = {'order':'📦 訂單辨識建檔', 'invoice':'📝 開立發票', 'inventory': '🏭 產品庫存管理', 'history':'📊 紀錄與報表', 'admin':'⚙️ 管理員後台'}; 
    if(document.getElementById('sysTitle')) document.getElementById('sysTitle').innerText = titles[modId]; 
    document.getElementById('mainApp').scrollTo(0,0);
    
    if(modId === 'history' && typeof window.renderHistory === "function") { window.renderHistory(); generateReport(); }
    if(modId === 'admin' && typeof window.renderAdminItems === "function") { window.renderAdminItems(); window.renderAdminClients(); }
    if(modId === 'order' && typeof window.renderOrderList === "function") window.renderOrderList();
    if(modId === 'inventory' && typeof window.renderInventory === "function") { window.renderInventory(); window.renderInvLogs(); renderShipments(); }
};

window.backToHome = function() { document.getElementById('mainApp').style.display = 'none'; document.getElementById('homeMenu').style.display = 'block'; };
