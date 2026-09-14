/**
 * ============================================================================
 * 長固 ERP 系統 - 前端核心運算邏輯 (徹底大掃除 + 估價單模組全新上線)
 * ============================================================================
 */

// 🔴 系統 API 端點
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
let globalQuotes = []; // 【新增】估價單全域變數
let emailSettingsData = { list: [], selected: [] };

let myLastSyncTime = 0;

let aiTempData = null; 
let currentOrderManualItems = []; 
let currentQuoItems = []; // 【新增】估價單手動品項快取
let selectedOrderCache = []; 
let currentInvoiceData = { clientName:'', taxId:'', items:[] }; 
let currentSearchSource = []; 
let currentSearchCallback = null;

// ============================================================================
// API 通訊模組
// ============================================================================
async function callApi(action, payload = {}) {
    if (API_URL.includes("請填入你的")) throw new Error("⚠️ 尚未設定 API_URL，請更新 main.js 中的網址！");
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
        if (!payload.taskId) {
            payload.taskId = 'T_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        }
    }
    bgSyncQueue.push({ action, payload, callback, retry: 0, time: Date.now() }); 
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
    }, 30000);

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
            updateSyncIndicator();
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
        updateSyncIndicator();
    }
    isSyncing = false; 
    if (bgSyncQueue.length > 0) {
        setTimeout(triggerSync, 5000); 
    }
}

// ============================================================================
// 報錯與未同步處理中心介面
// ============================================================================
function checkFailedTasks() {
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    let btn = document.getElementById('btnRetrySync');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btnRetrySync';
        btn.className = 'btn btn-danger fw-bold shadow position-fixed';
        btn.style.cssText = 'bottom: 20px; right: 20px; z-index: 10800; border-radius: 30px; padding: 10px 20px; font-size: 0.9rem;';
        btn.onclick = window.openSyncErrorModal;
        document.body.appendChild(btn);
    }
    if (failedTasks.length > 0) {
        btn.innerText = `🔴 有 ${failedTasks.length} 筆未同步資料 (點擊處理)`;
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
    }
}

window.openSyncErrorModal = function() {
    renderSyncErrorList();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('syncErrorModal')).show();
};

function renderSyncErrorList() {
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    const c = document.getElementById('syncErrorList');
    
    if (failedTasks.length === 0) {
        c.innerHTML = '<div class="text-center text-success fw-bold py-4 fs-5">✅ 所有資料皆已同步完成！</div>';
        checkFailedTasks();
        setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('syncErrorModal')).hide(), 1500);
        return;
    }
    
    c.innerHTML = failedTasks.map((t, idx) => {
        const dateStr = t.time ? new Date(t.time).toLocaleString() : '未知時間';
        const desc = translateTaskDesc(t);
        return `<div class="bg-white border rounded p-3 mb-2 shadow-sm d-flex justify-content-between align-items-center">
            <div>
                <div class="fw-bold text-dark fs-6">${desc}</div>
                <div class="small text-muted mt-1">🕒 發生時間: ${dateStr}</div>
                <div class="small text-secondary" style="font-size: 0.75rem;">內部指令: ${t.action}</div>
            </div>
            <div class="d-flex flex-column gap-2" style="min-width: 100px;">
                <button class="btn btn-sm btn-primary fw-bold" onclick="retrySingleTask(${idx})">🔄 重新傳送</button>
                <button class="btn btn-sm btn-outline-danger fw-bold" onclick="discardSingleTask(${idx})">🗑️ 清除捨棄</button>
            </div>
        </div>`;
    }).join('');
}

function translateTaskDesc(t) {
    const p = t.payload || {};
    switch(t.action) {
        case 'saveOrderData': return `📦 建立/編輯訂單 | 醫院: ${p.clientName||'未知'} | 單號: ${p.orderNo||'無'}`;
        case 'submitInvoice': return `📝 開立發票 | 客戶: ${p.clientName||'未知'} | 總計: $${(p.totalWithTax||0).toLocaleString()}`;
        case 'updateShipment': return `🚚 出貨作業 | 扣庫存 (${p.updates?.[0]?.name||'多筆品項'})`;
        case 'adjustInventory': return `🏭 庫存異動 | 品項: ${p.name||'未知'} | 動作: ${p.type||''} (${(p.changeQty||0)>0?'+':''}${p.changeQty||0})`;
        case 'submitPurchaseOrder': return `🛒 向廠商訂貨 | 品項: ${p.name||'未知'}`;
        case 'supplementInvoiceNo': return `📝 補登發票 | 新號碼: ${p.newPaperNo||'未知'}`;
        case 'addClientData': return `🏢 新增客戶 | 名稱: ${p.clientName||'未知'}`;
        case 'updateClientData': return `🏢 修改客戶 | 名稱: ${p.newName||'未知'}`;
        case 'saveAdminItem': return `📦 編輯報價品項 | 品名: ${p.productName||'未知'}`;
        case 'editInvLogRecord': return `✏️ 編輯異動紀錄 | 單號: ${p.invoiceNo||p.orderNo||'未知'}`;
        case 'updateInvoiceRecord': return `🗑️ 發票狀態操作 | 動作: ${p.action==='void'?'作廢':'修改'}`;
        case 'updateOrderStatus': return `📝 訂單狀態更新 | 狀態變更`;
        // 【新增】估價單的翻譯
        case 'saveQuotation': return `📑 建立/編輯估價單 | 客戶: ${p.clientName} | 單號: ${p.quoteNo}`;
        case 'mergeQuotations': return `🔗 合併估價單 | 群組 ID: ${p.mergeId}`;
        case 'unmergeQuotations': return `✂️ 解除合併估價單`;
        case 'updateQuotationStatus': return `🔄 更改估價單狀態 | 新狀態: ${p.status}`;
        case 'splitAndVoidQuotationItems': return `🗑️ 拆分作廢估價單品項 | 單號: ${p.quoteNo}`;
        default: return `⚙️ 系統操作 (${t.action})`;
    }
}

window.retrySingleTask = function(idx) {
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    if (failedTasks[idx]) {
        let t = failedTasks[idx];
        t.retry = 0; 
        bgSyncQueue.push(t);
        failedTasks.splice(idx, 1);
        localStorage.setItem('failedSyncTasks', JSON.stringify(failedTasks));
        renderSyncErrorList();
        checkFailedTasks();
        updateSyncIndicator();
        triggerSync();
        showToast("🔄 已加入同步佇列重試");
    }
};

window.discardSingleTask = function(idx) {
    if(!confirm("確定要捨棄這筆資料嗎？\n(捨棄後資料將不會寫入系統，請確認您已不需要此操作)")) return;
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    if (failedTasks[idx]) {
        failedTasks.splice(idx, 1);
        localStorage.setItem('failedSyncTasks', JSON.stringify(failedTasks));
        renderSyncErrorList();
        checkFailedTasks();
    }
};

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
        globalQuotes = res.quotes || []; // 【新增】
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        populateAdminClientFilter(); updateHistoryDropdowns(); populateLogDropdowns(); updateOrderClientDropdown(); renderEmailSettings();
        if(document.getElementById('sys-history').style.display === 'block') { window.renderHistory(); generateReport(); }
        if(document.getElementById('sys-admin').style.display === 'block') { window.renderAdminItems(); window.renderAdminClients(); }
        if(document.getElementById('sys-order').style.display === 'block') window.renderOrderList();
        if(document.getElementById('sys-inventory').style.display === 'block') { window.renderInventory(); window.renderInvLogs(); renderShipments(); }
        if(document.getElementById('sys-quotation').style.display === 'block') window.renderQuotationList(); // 【新增】
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
        let arr = type === 'order' ? currentOrderManualItems : (type === 'invoice' ? currentInvoiceData.items : currentQuoItems);
        let fromIndex = arr.findIndex(x => x.id === draggedRowId);
        let toIndex = arr.findIndex(x => x.id === targetId);
        if (fromIndex >= 0 && toIndex >= 0) {
            const [movedItem] = arr.splice(fromIndex, 1);
            arr.splice(toIndex, 0, movedItem);
            if (type === 'order') reRenderOrderManualItems();
            if (type === 'invoice') reRenderInvoiceItems();
            if (type === 'quotation') reRenderQuotationItems(); // 【新增】
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
    document.getElementById('invDate').value = getTodayStr();
    if (exp && parseInt(exp) > Date.now()) { 
        myName = localStorage.getItem('invStaffName'); 
        document.getElementById('authScreen').style.display = 'none'; 
        initSystemData(); 
    } else { 
        document.getElementById('splashScreen').style.display = 'none'; 
        document.getElementById('authScreen').style.display = 'flex'; 
    }
    setInterval(() => { 
        if(document.getElementById('mainApp').style.display === 'block') { 
            callApi('heartbeat', { uid: myUid }).then(count => { 
                document.getElementById('mqOnline').innerText = `👥 ${count} 人`; 
                document.getElementById('navOnlineCount').innerText = `👥 ${count}`; 
            }).catch(e => console.log('心跳同步失敗', e)); 
        } 
    }, 60000);
};

function loginSystem() {
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
}
function logout() { if(confirm("確定登出？")) { localStorage.removeItem('invStaffName'); localStorage.removeItem('invTokenExp'); location.reload(); } }

function initSystemData() {
    document.getElementById('splashScreen').style.display = 'flex'; let fakeProgress = 10; setProgress(fakeProgress, '下載雲端資料庫...');
    const intv = setInterval(() => { fakeProgress += (85 - fakeProgress) * 0.15; setProgress(fakeProgress); }, 500);
    callApi('getInitData', {}).then(res => {
        clearInterval(intv); setProgress(100, '✅ 準備完成！');
        globalClients = res.clients || []; globalSuppliers = res.suppliers || []; globalCatalog = res.catalog || []; globalHistory = res.history || []; globalOrders = res.orders || []; globalInventory = res.inventory || []; globalSalesDetails = res.salesDetails || []; globalInvLogs = res.invLogs || [];
        globalQuotes = res.quotes || []; // 【新增】
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        
        populateAdminClientFilter(); updateHistoryDropdowns(); populateLogDropdowns(); updateOrderClientDropdown(); renderEmailSettings();
        document.getElementById('mqMonthCount').innerText = `🧾 本月已開立 ${res.monthCount} 張`; 
        let daysLeft = Math.ceil((parseInt(localStorage.getItem('invTokenExp')) - Date.now()) / 86400000); 
        document.getElementById('welcomeName').innerText = `👋 ${myName}`; 
        document.getElementById('tokenCountdown').innerText = `🔐 憑證效期：${daysLeft} 天`;
        setTimeout(() => { document.getElementById('splashScreen').style.opacity = '0'; setTimeout(() => { document.getElementById('splashScreen').style.display = 'none'; unlockScreen(); document.getElementById('homeMenu').style.display = 'block'; window.renderOrderList(); }, 500); }, 500);
    }).catch(e => { clearInterval(intv); alert("初始化失敗：" + e.message); });
}

function refreshData() {
    showLoading("同步最新資料...");
    callApi('getInitData', {}).then(res => {
        globalClients = res.clients||[]; globalSuppliers = res.suppliers||[]; globalCatalog = res.catalog||[]; globalHistory = res.history||[]; globalOrders = res.orders||[]; globalInventory = res.inventory||[]; globalSalesDetails = res.salesDetails||[]; globalInvLogs = res.invLogs||[];
        globalQuotes = res.quotes || []; // 【新增】
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        populateAdminClientFilter(); updateHistoryDropdowns(); populateLogDropdowns(); updateOrderClientDropdown(); renderEmailSettings();
        hideLoading(); showToast('✅ 已同步');
        if(document.getElementById('sys-history').style.display === 'block') { window.renderHistory(); generateReport(); }
        if(document.getElementById('sys-admin').style.display === 'block') { window.renderAdminItems(); window.renderAdminClients(); }
        if(document.getElementById('sys-order').style.display === 'block') window.renderOrderList();
        if(document.getElementById('sys-inventory').style.display === 'block') { window.renderInventory(); window.renderInvLogs(); renderShipments(); }
        if(document.getElementById('sys-quotation').style.display === 'block') window.renderQuotationList(); // 【新增】
    }).catch(err => { hideLoading(); alert("同步失敗：" + err.message); });
}

function enterSystem(modId) {
    document.getElementById('homeMenu').style.display = 'none'; document.getElementById('mainApp').style.display = 'block';
    document.querySelectorAll('.sys-module').forEach(el => el.style.display = 'none'); document.getElementById(`sys-${modId}`).style.display = 'block';
    const titles = {'order':'📦 訂單辨識建檔', 'invoice':'📝 開立發票', 'inventory': '🏭 產品庫存管理', 'history':'📊 紀錄與報表', 'admin':'⚙️ 管理員後台', 'quotation': '📑 開立估價單'}; // 【修改】加入標題
    document.getElementById('sysTitle').innerText = titles[modId]; document.getElementById('mainApp').scrollTo(0,0);
    if(modId === 'history') { window.renderHistory(); generateReport(); }
    if(modId === 'admin') { window.renderAdminItems(); window.renderAdminClients(); }
    if(modId === 'order') window.renderOrderList();
    if(modId === 'inventory') { window.renderInventory(); window.renderInvLogs(); renderShipments(); }
    if(modId === 'quotation') window.renderQuotationList(); // 【新增】
}
function backToHome() { document.getElementById('mainApp').style.display = 'none'; document.getElementById('homeMenu').style.display = 'block'; }

// ============================================================================
// 下拉選單與信箱設定
// ============================================================================
function populateLogDropdowns() { const names = [...new Set(globalInvLogs.map(l=>l.name).filter(x=>x))].sort(); document.getElementById('logFilterName').innerHTML = '<option value="">📦 所有品名 (不限)</option>' + names.map(n => `<option value="${escapeQuotes(n)}">${n}</option>`).join(''); }
function updateOrderClientDropdown() { const pending = globalOrders.filter(o => o.status !== '已結案' && o.status !== '作廢' && o.status !== '已作廢'); const clients = [...new Set(pending.map(o => o.client).filter(x => x))].sort(); document.getElementById('ordFilterClient').innerHTML = '<option value="">🏢 所有醫院</option>' + clients.map(c => `<option value="${escapeQuotes(c)}">${c}</option>`).join(''); }
function updateHistoryDropdowns() { const staffs = [...new Set(globalHistory.map(h=>h.staff).filter(x=>x))].sort(); const clients = [...new Set(globalHistory.map(h=>h.client).filter(x=>x))].sort(); document.getElementById('histFilterStaff').innerHTML = '<option value="">👤 員工</option>' + staffs.map(s => `<option value="${s}">${s}</option>`).join(''); document.getElementById('histFilterClient').innerHTML = '<option value="">🏢 客戶</option>' + clients.map(c => `<option value="${c}">${c}</option>`).join(''); }

function renderEmailSettings() {
    const container = document.getElementById('emailCheckboxes');
    if (emailSettingsData.list.length === 0) { container.innerHTML = '<div class="text-muted small">尚未在「收件信箱管理」工作表設定任何信箱。</div>'; return; }
    let html = '';
    emailSettingsData.list.forEach((item, idx) => {
        const isChecked = emailSettingsData.selected.includes(item.email) ? 'checked' : '';
        html += `<div class="form-check"><input class="form-check-input email-cb" type="checkbox" value="${item.email}" id="cb_email_${idx}" ${isChecked}><label class="form-check-label fw-bold text-dark" for="cb_email_${idx}">${item.email} <span class="badge bg-secondary ms-1">${item.memo || ''}</span></label></div>`;
    });
    container.innerHTML = html;
}
function saveEmailSettings() {
    const cbs = document.querySelectorAll('.email-cb:checked'); emailSettingsData.selected = Array.from(cbs).map(cb => cb.value);
    showLoading("儲存設定中..."); callApi('saveReportEmails', { selectedEmails: emailSettingsData.selected }).then(res => { hideLoading(); showToast("💾 收件信箱設定已儲存"); }).catch(err => { hideLoading(); alert("儲存失敗：" + err.message); });
}
function triggerManualReport() {
    if (emailSettingsData.selected.length === 0) return alert("請先勾選至少一個收件信箱並儲存設定！"); if (!confirm("確定要現在立即產生並發送「未結案訂單報表」嗎？\n(將發送至勾選的信箱)")) return;
    showLoading("報表產生並發送中..."); callApi('sendPendingOrdersReport', {}).then(res => { hideLoading(); alert(res.msg); }).catch(err => { hideLoading(); alert("發送失敗：" + err.message); });
}

// ============================================================================
// 📑 【全新】開立估價單模組
// ============================================================================
window.renderQuotationList = debounce(function() {
    const searchTerm = document.getElementById('quoSearchInput').value.toLowerCase();
    
    // 依據搜尋條件過濾
    let filtered = globalQuotes;
    if (searchTerm) {
        filtered = filtered.filter(q => 
            q.client.toLowerCase().includes(searchTerm) || 
            q.quoteNo.toLowerCase().includes(searchTerm) || 
            q.jsonStr.toLowerCase().includes(searchTerm)
        );
    }

    // 分流資料
    let pending = filtered.filter(q => q.status === '待確認');
    let verified = filtered.filter(q => q.status !== '待確認');

    // 負責渲染 HTML 的子函式 (群組化邏輯)
    function buildQuoHtml(dataArr, isPendingTab) {
        if(dataArr.length === 0) return '<div class="text-center text-muted py-4">目前沒有資料</div>';
        
        // 依照 mergeId 群組化
        let groups = {};
        dataArr.forEach(q => {
            let gid = q.mergeId || `Single_${q.rowIdx}`;
            if (!groups[gid]) groups[gid] = { isMerged: !!q.mergeId, client: q.client, quotes: [] };
            groups[gid].quotes.push(q);
        });

        let html = '';
        for (let gid in groups) {
            const group = groups[gid];
            const isMerged = group.isMerged;
            
            // 標題顯示
            let titleHtml = `<div class="fw-bold text-dark fs-6">${group.client} ${isMerged ? '<span class="badge bg-primary ms-2">🔗 已合併</span>' : ''}</div>`;
            
            // 明細列表
            let allItemsDesc = group.quotes.map(q => {
                let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
                let itemsStr = items.map(i => `<div>${i.name} <span class="badge bg-light text-dark border ms-1">x${i.qty}</span></div>`).join('');
                return `<div class="mt-2 pt-2 border-top">
                            <span class="small fw-bold text-secondary">單號: ${q.quoteNo} (${q.quoteDate})</span>
                            <div class="small text-muted mt-1">${itemsStr}</div>
                        </div>`;
            }).join('');

            // 按鈕區
            let actionBtns = '';
            if (isPendingTab) {
                actionBtns += `<button class="btn btn-sm btn-outline-info fw-bold me-1 text-dark" onclick="printQuotation('${gid}')">🖨️ 列印出單</button>`;
                actionBtns += `<button class="btn btn-sm btn-outline-danger fw-bold me-1" onclick="voidQuotation('${gid}')">🗑️ 作廢</button>`;
                // 編輯按鈕 (若已合併，則不允許單筆編輯，請先解除合併)
                if (!isMerged) {
                    actionBtns += `<button class="btn btn-sm btn-outline-secondary fw-bold me-1" onclick="openQuotationModal(${group.quotes[0].rowIdx})">📝 編輯</button>`;
                }
                actionBtns += `<button class="btn btn-sm btn-success fw-bold text-white shadow-sm" onclick="verifyQuotationToInvoice('${gid}')">✅ 核銷轉發票</button>`;
            } else {
                // 已核銷或作廢狀態
                let statusBadge = '';
                if(group.quotes[0].status === '已核銷') statusBadge = '<span class="badge bg-success">已核銷</span>';
                else if(group.quotes[0].status === '已作廢') statusBadge = '<span class="badge bg-danger">已作廢</span>';
                actionBtns += statusBadge;
            }

            // 勾選框 (只在待確認提供)
            let checkboxHtml = '';
            if (isPendingTab) {
                // 如果已合併，勾選框代表整個群組；如果未合併，勾選框代表單筆
                const val = isMerged ? `M_${gid}` : `S_${group.quotes[0].rowIdx}`;
                checkboxHtml = `<input class="form-check-input me-3 cb-quo" type="checkbox" value="${val}" data-client="${escapeQuotes(group.client)}" style="transform: scale(1.3); flex-shrink: 0;">`;
            }

            html += `<div class="item-row bg-white shadow-sm p-3 mb-3 ${isMerged ? 'border-primary' : ''}">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div class="d-flex align-items-center">
                        ${checkboxHtml}
                        ${titleHtml}
                    </div>
                    <div>${actionBtns}</div>
                </div>
                ${allItemsDesc}
            </div>`;
        }
        return html;
    }

    document.getElementById('quoPendingListContainer').innerHTML = buildQuoHtml(pending, true);
    document.getElementById('quoVerifiedListContainer').innerHTML = buildQuoHtml(verified, false);

}, 300);

// 開啟估價單手動視窗
window.openQuotationModal = function(idx) {
    currentQuoItems = [];
    document.getElementById('e_quoMemo').value = '';
    document.getElementById('e_quoUseSeal').checked = true;

    if(idx) {
        const q = globalQuotes.find(x => x.rowIdx === idx);
        document.getElementById('e_quoRow').value = idx;
        document.getElementById('e_quoDate').value = q.quoteDate;
        document.getElementById('e_quoNo').value = q.quoteNo;
        document.getElementById('e_quoClient').value = q.client;
        document.getElementById('e_quoUseSeal').checked = q.useSeal;
        
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(i => {
            const rowId = `quo_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
            currentQuoItems.push({ id: rowId, name: i.name||'', price: i.price||0, qty: i.qty||1, unit: i.unit||'式', brandModel: i.brandModel||'', memo: i.memo||'', showBrand: !!i.brandModel });
        });
    } else {
        document.getElementById('e_quoRow').value = '';
        document.getElementById('e_quoDate').value = getTodayStr();
        document.getElementById('e_quoNo').value = '';
        document.getElementById('e_quoClient').value = '';
        addQuotationManualItemRow();
    }
    reRenderQuotationItems();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editQuoModal')).show();
};

window.addQuotationManualItemRow = function() {
    const rowId = `quo_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    currentQuoItems.push({ id: rowId, name: '', price: 0, qty: 1, unit: '式', brandModel: '', memo: '', showBrand: false });
    reRenderQuotationItems();
};

function renderSingleQuotationItem(item) {
    let subtotal = (parseFloat(item.price) || 0) * (parseFloat(item.qty) || 0);
    
    return `<div class="item-row p-3 mb-2 bg-white border border-secondary shadow-sm draggable-row" id="${item.id}" draggable="true" ondragstart="handleDragStart(event, '${item.id}', 'quotation')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${item.id}', 'quotation')" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)">
        <div class="drag-handle position-absolute" style="top:10px; left:10px; cursor:grab; font-size: 1.2rem; color: #adb5bd;" title="按住拖曳排序">☰</div>
        <button class="btn btn-sm btn-outline-danger position-absolute" style="top:8px; right:8px;" onclick="removeQuotationItem('${item.id}')">✕</button>
        
        <div class="mb-2 pe-4 ps-4">
            <label class="form-label small fw-bold text-muted mb-1">品名 <span class="text-danger">*</span></label>
            <input type="text" class="form-control fake-input-btn form-control-sm fw-bold fs-6 border-primary" id="quo_name_${item.id}" value="${escapeQuotes(item.name)}" readonly placeholder="點此對應產品庫..." onclick="openSearchModal('item_quo_${item.id}', (val)=>selectProductForQuo('${item.id}', val))">
        </div>
        <div class="row g-2 ps-4 mb-2">
            <div class="col-3"><label class="form-label small fw-bold text-muted mb-1">數量</label><input type="number" class="form-control form-control-sm fw-bold text-danger text-center" id="quo_qty_${item.id}" value="${item.qty}" min="0" step="any" oninput="updateQuoQty('${item.id}', this.value)"></div>
            <div class="col-3"><label class="form-label small fw-bold text-muted mb-1">單位</label><input type="text" class="form-control form-control-sm text-center" id="quo_unit_${item.id}" value="${escapeQuotes(item.unit)}" oninput="updateQuoUnit('${item.id}', this.value)"></div>
            <div class="col-3"><label class="form-label small fw-bold text-muted mb-1">單價</label><input type="number" class="form-control form-control-sm text-end" id="quo_price_${item.id}" value="${item.price}" min="0" step="any" oninput="updateQuoPrice('${item.id}', this.value)"></div>
            <div class="col-3"><label class="form-label small fw-bold text-muted mb-1">小計(含稅)</label><input type="text" class="form-control form-control-sm bg-light text-end fw-bold text-primary" value="$${Math.round(subtotal).toLocaleString()}" readonly></div>
        </div>
        <div class="row g-2 ps-4 align-items-end">
            <div class="col-12">
                <div class="form-check form-switch mb-1">
                    <input class="form-check-input" type="checkbox" id="quo_showBrand_${item.id}" ${item.showBrand ? 'checked' : ''} onchange="toggleQuoBrand('${item.id}', this.checked)">
                    <label class="form-check-label small fw-bold text-muted" for="quo_showBrand_${item.id}">需要填寫廠牌型號</label>
                </div>
                <div id="quo_brandBox_${item.id}" style="display: ${item.showBrand ? 'block' : 'none'};">
                    <input type="text" class="form-control form-control-sm mb-2" placeholder="輸入廠牌型號..." value="${escapeQuotes(item.brandModel)}" oninput="updateQuoBrand('${item.id}', this.value)">
                </div>
            </div>
            <div class="col-12"><label class="form-label small fw-bold text-muted mb-1">單項備註</label><input type="text" class="form-control form-control-sm text-secondary" placeholder="選填..." value="${escapeQuotes(item.memo)}" oninput="updateQuoMemo('${item.id}', this.value)"></div>
        </div>
    </div>`;
}

function reRenderQuotationItems() {
    document.getElementById('e_quoItemsContainer').innerHTML = currentQuoItems.map(renderSingleQuotationItem).join('');
}

window.selectClientForQuotation = function(val) {
    document.getElementById('e_quoClient').value = val;
    // 重置品項，確保品名對應正確的客戶
    currentQuoItems = [];
    addQuotationManualItemRow();
};

window.selectProductForQuo = function(rowId, prodName) {
    const client = document.getElementById('e_quoClient').value;
    const p = globalCatalog.find(x => x.clientName === client && x.productName === prodName);
    if(p) {
        const item = currentQuoItems.find(x => x.id === rowId);
        if(item) {
            item.name = p.productName;
            item.price = p.price || 0;
            item.unit = p.unit || '式';
        }
        reRenderQuotationItems();
    }
};

window.updateQuoQty = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) { item.qty = Math.max(0, parseFloat(val)||0); reRenderQuotationItems(); } };
window.updateQuoUnit = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) { item.unit = val; } };
window.updateQuoPrice = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) { item.price = Math.max(0, parseFloat(val)||0); reRenderQuotationItems(); } };
window.updateQuoBrand = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) item.brandModel = val; };
window.updateQuoMemo = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) item.memo = val; };
window.toggleQuoBrand = function(id, isChecked) { const item = currentQuoItems.find(x=>x.id===id); if(item) { item.showBrand = isChecked; reRenderQuotationItems(); } };
window.removeQuotationItem = function(id) { currentQuoItems = currentQuoItems.filter(x=>x.id!==id); reRenderQuotationItems(); };

window.saveEditQuotation = function() {
    const idx = document.getElementById('e_quoRow').value;
    const date = document.getElementById('e_quoDate').value;
    const no = document.getElementById('e_quoNo').value.trim();
    const client = document.getElementById('e_quoClient').value;
    const useSeal = document.getElementById('e_quoUseSeal').checked;
    
    if(!date || !no || !client) return alert("估價日期、編號與客戶名稱皆為必填！");
    
    let items = [];
    for(let i of currentQuoItems) {
        if(!i.name || i.qty <= 0) return alert("所有品項必須填寫名稱且數量需大於0！");
        items.push({
            name: i.name,
            qty: i.qty,
            unit: i.unit,
            price: i.price,
            brandModel: i.showBrand ? i.brandModel : '',
            memo: i.memo
        });
    }
    if(items.length === 0) return alert("請至少新增一項品項！");

    const payload = {
        rowIdx: idx ? parseInt(idx) : null,
        quoteDate: date,
        quoteNo: no,
        clientName: client,
        useSeal: useSeal,
        items: items,
        status: '待確認'
    };

    // 樂觀更新
    if(idx) {
        const q = globalQuotes.find(x => x.rowIdx === parseInt(idx));
        if(q) { q.quoteDate=date; q.quoteNo=no; q.client=client; q.useSeal=useSeal; q.jsonStr=JSON.stringify(items); }
    } else {
        globalQuotes.unshift({ rowIdx: Date.now(), time: Date.now(), quoteNo: no, quoteDate: date, client: client, status: '待確認', jsonStr: JSON.stringify(items), useSeal: useSeal, mergeId: '', staff: myName });
    }

    pushToSyncQueue('saveQuotation', payload, null);
    window.renderQuotationList();
    bootstrap.Modal.getInstance(document.getElementById('editQuoModal')).hide();
    showToast("💾 估價單已儲存");
};

// ============================================================================
// 估價單合併與解除機制
// ============================================================================
window.groupMergeQuotations = function() {
    const cbs = document.querySelectorAll('.cb-quo:checked');
    if(cbs.length < 2) return alert('請至少勾選 2 筆估價單進行合併！');
    
    let client = ''; let valid = true; let idsToMerge = [];
    cbs.forEach(cb => {
        if(!client) client = cb.dataset.client;
        else if(client !== cb.dataset.client) valid = false;
        
        const val = cb.value;
        if(val.startsWith('M_')) {
            // 已合併群組
            const groupQuotes = globalQuotes.filter(q => q.mergeId === val.replace('M_',''));
            idsToMerge.push(...groupQuotes.map(q => q.rowIdx));
        } else {
            // 單筆
            idsToMerge.push(parseInt(val.replace('S_','')));
        }
    });

    if(!valid) return alert('⚠️ 合併防呆：不可將「不同客戶」的估價單合併在一起！請重新勾選。');

    const newMergeId = 'MG_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
    
    // 樂觀更新
    globalQuotes.forEach(q => {
        if(idsToMerge.includes(q.rowIdx)) q.mergeId = newMergeId;
    });

    pushToSyncQueue('mergeQuotations', { rowIndices: idsToMerge, mergeId: newMergeId }, null);
    window.renderQuotationList();
    showToast("🔗 估價單已成功合併！");
};

window.groupUnmergeQuotations = function() {
    const cbs = document.querySelectorAll('.cb-quo:checked');
    if(cbs.length === 0) return alert('請先勾選已合併的估價單群組！');
    
    let idsToUnmerge = [];
    cbs.forEach(cb => {
        const val = cb.value;
        if(val.startsWith('M_')) {
            const groupQuotes = globalQuotes.filter(q => q.mergeId === val.replace('M_',''));
            idsToUnmerge.push(...groupQuotes.map(q => q.rowIdx));
        }
    });

    if(idsToUnmerge.length === 0) return showToast("勾選的皆為單筆估價單，不需解除合併。");

    globalQuotes.forEach(q => {
        if(idsToUnmerge.includes(q.rowIdx)) q.mergeId = '';
    });

    pushToSyncQueue('unmergeQuotations', { rowIndices: idsToUnmerge }, null);
    window.renderQuotationList();
    showToast("✂️ 已解除合併拆分為單筆！");
};

// ============================================================================
// 估價單獨立拆分作廢
// ============================================================================
let tempVoidGroupData = []; // 暫存要作廢的目標群

window.voidQuotation = function(gid) {
    const quotesInGroup = globalQuotes.filter(q => q.mergeId === gid || `Single_${q.rowIdx}` === gid);
    if(quotesInGroup.length === 0) return;

    let allItems = [];
    quotesInGroup.forEach(q => {
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(i => {
            // 給每個 item 帶上來源 rowIdx 才能精準拆分
            i.sourceRowIdx = q.rowIdx;
            i.sourceQuoteNo = q.quoteNo;
            allItems.push(i);
        });
    });

    if(allItems.length <= 1) {
        // 單一品項，直接整筆作廢
        if(confirm("確定要將此估價單作廢嗎？")) {
            const ids = quotesInGroup.map(q => q.rowIdx);
            quotesInGroup.forEach(q => q.status = '已作廢');
            pushToSyncQueue('updateQuotationStatus', { rowIndices: ids, status: '已作廢' }, null);
            window.renderQuotationList();
        }
    } else {
        // 多品項，跳出視窗選擇
        tempVoidGroupData = quotesInGroup;
        let html = allItems.map((item, idx) => {
            return `<div class="form-check mb-2 p-2 border-bottom">
                <input class="form-check-input cb-void-item" type="checkbox" value="${idx}" id="cb_void_${idx}" style="transform: scale(1.3); margin-right: 10px;">
                <label class="form-check-label fw-bold" for="cb_void_${idx}">
                    ${item.name} <span class="badge bg-secondary ms-1">x${item.qty}</span>
                    <div class="small text-muted fw-normal mt-1">來源: ${item.sourceQuoteNo}</div>
                </label>
            </div>`;
        }).join('');
        document.getElementById('vq_itemsList').innerHTML = html;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('voidQuoItemsModal')).show();
    }
};

window.confirmVoidQuotationItems = function() {
    const cbs = document.querySelectorAll('.cb-void-item:checked');
    if(cbs.length === 0) return alert('請至少勾選一項要作廢的品項！');

    let allItems = [];
    tempVoidGroupData.forEach(q => {
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(i => {
            i.sourceRowIdx = q.rowIdx;
            allItems.push(i);
        });
    });

    // 如果全選，等同於整筆群組作廢
    if(cbs.length === allItems.length) {
        const ids = tempVoidGroupData.map(q => q.rowIdx);
        tempVoidGroupData.forEach(q => q.status = '已作廢');
        pushToSyncQueue('updateQuotationStatus', { rowIndices: ids, status: '已作廢' }, null);
        window.renderQuotationList();
        bootstrap.Modal.getInstance(document.getElementById('voidQuoItemsModal')).hide();
        return;
    }

    // 部分拆分作廢 (依據 sourceRowIdx 分組處理)
    let selectedIndices = Array.from(cbs).map(cb => parseInt(cb.value));
    
    // 依據原本的單號整理要保留與要作廢的
    tempVoidGroupData.forEach(q => {
        let origItems = []; try { origItems = JSON.parse(q.jsonStr); } catch(e){}
        let keepItems = [];
        let voidItems = [];
        
        origItems.forEach(oi => {
            // 找出這個 oi 在 allItems 裡的 index
            let matchIdx = allItems.findIndex(ai => ai.sourceRowIdx === q.rowIdx && ai.name === oi.name && ai.qty === oi.qty);
            if(selectedIndices.includes(matchIdx)) {
                voidItems.push(oi);
                // 為了避免重複品項抓錯，找到後把它從選單裡移除
                selectedIndices = selectedIndices.filter(x => x !== matchIdx);
            } else {
                keepItems.push(oi);
            }
        });

        if(voidItems.length > 0) {
            // 更新本機端狀態
            q.jsonStr = JSON.stringify(keepItems);
            globalQuotes.unshift({ rowIdx: Date.now()+Math.random(), time: Date.now(), quoteNo: q.quoteNo+"-作廢", quoteDate: q.quoteDate, client: q.client, status: '已作廢', jsonStr: JSON.stringify(voidItems), useSeal: q.useSeal, mergeId: '', staff: myName });
            
            // 打 API 給後端處理分拆
            pushToSyncQueue('splitAndVoidQuotationItems', {
                rowIdx: q.rowIdx,
                quoteNo: q.quoteNo,
                quoteDate: q.quoteDate,
                clientName: q.client,
                useSeal: q.useSeal,
                staff: myName,
                keepItems: keepItems,
                voidItems: voidItems
            }, null);
        }
    });

    window.renderQuotationList();
    bootstrap.Modal.getInstance(document.getElementById('voidQuoItemsModal')).hide();
    showToast("🗑️ 指定品項已成功拆分並作廢！");
};

// ============================================================================
// 核銷估價單 -> 轉發票開立
// ============================================================================
window.verifyQuotationToInvoice = function(gid) {
    const quotesInGroup = globalQuotes.filter(q => q.mergeId === gid || `Single_${q.rowIdx}` === gid);
    if(quotesInGroup.length === 0) return;

    const clientName = quotesInGroup[0].client;
    const cObj = globalClients.find(x => x.name === clientName);
    const taxId = cObj ? cObj.taxId : '';
    
    // 組合多單號
    const quoteNos = quotesInGroup.map(q => q.quoteNo).join(', ');

    // 準備跳轉至 Invoice 模組
    enterSystem('invoice');
    document.getElementById('invClientInput').value = clientName; 
    currentInvoiceData.clientName = clientName; 
    currentInvoiceData.taxId = taxId; 
    document.getElementById('invClientInfo').innerText = `✓ 綁定成功 (統編: ${taxId||'無'})`; 
    document.getElementById('invClientInfo').style.display = 'block'; 
    document.getElementById('btnNext1').style.display = 'block'; 
    
    // 【關鍵標記】自動帶入特殊訂單號，讓後端知道這是從估價單核銷來的，不要去扣訂單總表
    document.getElementById('invOrderNo').value = `[估價單核銷]-${quoteNos}`;
    
    currentInvoiceData.items = [];
    document.getElementById('invAiNotice').style.display = 'block';
    
    // 將所有品項灌入
    quotesInGroup.forEach(q => {
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(i => {
            const rowId = `invR_${Date.now()}_${Math.random().toString(36).substring(2)}`; 
            // 嘗試尋找內部代碼 (為了讓預覽畫面好看)
            const p = globalCatalog.find(x => x.clientName === clientName && x.productName === i.name);
            let internalCode = p ? (p.internalCode || p.assetCode) : '';
            
            // 將估價單特有的備註(含廠牌) 整合
            let fullMemo = ((i.brandModel ? i.brandModel + ' ' : '') + (i.memo || '')).trim();

            currentInvoiceData.items.push({ 
                id: rowId, 
                // 這裡強迫使用估價單原本設定好的單價與單位，不受限於產品庫
                product: { productName: i.name, unit: i.unit, price: i.price, internalCode: internalCode }, 
                qty: i.qty, 
                orderRef: q.quoteNo, 
                deptRef: fullMemo 
            });
        });
    });

    // 變更原估價單狀態為已核銷
    const ids = quotesInGroup.map(q => q.rowIdx);
    quotesInGroup.forEach(q => q.status = '已核銷');
    pushToSyncQueue('updateQuotationStatus', { rowIndices: ids, status: '已核銷' }, null);

    reRenderInvoiceItems(); 
    goStep(2); 
    showToast("✅ 已將估價單品項全數載入發票系統！您可以自由刪減本次要開立的品項 (每張發票限5筆)。");
};

// ============================================================================
// 🖨️ 列印 A4 估價單
// ============================================================================
window.printQuotation = function(gid) {
    const quotesInGroup = globalQuotes.filter(q => q.mergeId === gid || `Single_${q.rowIdx}` === gid);
    if(quotesInGroup.length === 0) return;

    const client = quotesInGroup[0].client;
    // 列印日期抓今天，或者如果只有單張就抓單張的報價日
    const printDate = quotesInGroup.length === 1 ? quotesInGroup[0].quoteDate.replace(/-/g, '/') : getTodayStr().replace(/-/g, '/');
    const quoteNos = quotesInGroup.map(q => q.quoteNo).join(', ');
    const useSeal = quotesInGroup.some(q => q.useSeal); // 只要其中一張有用印，合併就用印

    let tbodyHtml = '';
    let totalTaxInc = 0; // 含稅總計
    let totalTaxExc = 0; // 未稅總計

    quotesInGroup.forEach(q => {
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(item => {
            let price = parseFloat(item.price) || 0;
            let qty = parseFloat(item.qty) || 0;
            let subtotal = Math.round(price * qty);
            totalTaxInc += subtotal;

            let brandModelDisplay = item.brandModel ? `<div style="font-size: 13px; color: #555;">${escapeQuotes(item.brandModel)}</div>` : '';
            let memoDisplay = item.memo ? `<div style="font-size: 12px; color: #777; margin-top: 2px;">${escapeQuotes(item.memo)}</div>` : '';

            tbodyHtml += `
                <tr>
                    <td style="border: 1px solid #333; padding: 10px 8px; text-align: left;">
                        <div style="font-weight: bold; font-size: 15px;">${escapeQuotes(item.name)}</div>
                        ${brandModelDisplay}
                    </td>
                    <td style="border: 1px solid #333; padding: 10px 8px; text-align: center; font-size: 15px;">${qty}</td>
                    <td style="border: 1px solid #333; padding: 10px 8px; text-align: center; font-size: 15px;">${escapeQuotes(item.unit)}</td>
                    <td style="border: 1px solid #333; padding: 10px 8px; text-align: right; font-size: 15px;">${price.toLocaleString()}</td>
                    <td style="border: 1px solid #333; padding: 10px 8px; text-align: right; font-weight: bold; font-size: 15px;">${subtotal.toLocaleString()}</td>
                    <td style="border: 1px solid #333; padding: 10px 8px; text-align: left; font-size: 13px;">${memoDisplay}</td>
                </tr>
            `;
        });
    });

    totalTaxExc = Math.round(totalTaxInc / 1.05);
    const taxValue = totalTaxInc - totalTaxExc;

    let sealHtml = '';
    if (useSeal) {
        // 使用 Google Drive 的直連縮圖 URL 方式渲染圖檔
        sealHtml = `<img src="https://drive.google.com/uc?export=view&id=1GX-Lkrd7aQgsrMPW5VQ0t_ZzONGe7rin" style="width: 140px; position: absolute; right: 80px; bottom: 30px; mix-blend-mode: multiply; opacity: 0.85;">`;
    }

    const html = `
        <div style="padding: 20px; width: 100%; box-sizing: border-box; font-family: 'MingLiU', '微軟正黑體', sans-serif; position: relative; min-height: 90vh;">
            
            <!-- 表頭區塊 -->
            <div style="text-align: center; margin-bottom: 20px;">
                <div style="font-size: 28px; font-weight: 900; letter-spacing: 5px; color: #000;">長固實業有限公司</div>
                <div style="font-size: 14px; margin-top: 5px; color: #000;">新北市三重區重新路五段609巷6號4樓</div>
                <div style="font-size: 14px; color: #000;">電話：(04) 2326-9591 &nbsp;&nbsp;&nbsp; 傳真：(04) 2326-8576</div>
                <div style="font-size: 22px; font-weight: bold; letter-spacing: 8px; margin-top: 15px; text-decoration: underline; text-underline-offset: 6px;">估價單</div>
            </div>

            <!-- 客戶與日期資訊 -->
            <table style="width: 100%; border: none; margin-bottom: 15px; font-size: 15px; color: #000;">
                <tr>
                    <td style="width: 60%; vertical-align: bottom;">
                        <div style="font-weight: bold; font-size: 18px; margin-bottom: 5px;">客戶名稱：${client}</div>
                    </td>
                    <td style="width: 40%; vertical-align: bottom; text-align: right; line-height: 1.6;">
                        <div style="font-weight: bold;">估價日期：${printDate}</div>
                        <div style="font-weight: bold;">估價單號：${quoteNos}</div>
                    </td>
                </tr>
            </table>

            <!-- 品項表格 -->
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; color: #000;">
                <thead>
                    <tr style="background-color: #f4f4f4;">
                        <th style="border: 1px solid #333; padding: 10px; text-align: center;">品名 (含廠牌型號)</th>
                        <th style="border: 1px solid #333; padding: 10px; width: 60px; text-align: center;">數量</th>
                        <th style="border: 1px solid #333; padding: 10px; width: 60px; text-align: center;">單位</th>
                        <th style="border: 1px solid #333; padding: 10px; width: 90px; text-align: center;">單價</th>
                        <th style="border: 1px solid #333; padding: 10px; width: 110px; text-align: center;">小計</th>
                        <th style="border: 1px solid #333; padding: 10px; width: 120px; text-align: center;">備註</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbodyHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="4" style="border: 1px solid #333; padding: 10px; text-align: right; font-weight: bold;">銷售額 (未稅)：</td>
                        <td style="border: 1px solid #333; padding: 10px; text-align: right;">${totalTaxExc.toLocaleString()}</td>
                        <td style="border: 1px solid #333; padding: 10px;"></td>
                    </tr>
                    <tr>
                        <td colspan="4" style="border: 1px solid #333; padding: 10px; text-align: right; font-weight: bold;">營業稅 (5%)：</td>
                        <td style="border: 1px solid #333; padding: 10px; text-align: right;">${taxValue.toLocaleString()}</td>
                        <td style="border: 1px solid #333; padding: 10px;"></td>
                    </tr>
                    <tr>
                        <td colspan="4" style="border: 1px solid #333; padding: 10px; text-align: right; font-weight: bold; font-size: 16px;">總金額 (含稅)：</td>
                        <td style="border: 1px solid #333; padding: 10px; text-align: right; font-weight: bold; font-size: 16px;">${totalTaxInc.toLocaleString()}</td>
                        <td style="border: 1px solid #333; padding: 10px;"></td>
                    </tr>
                </tfoot>
            </table>

            <!-- 用印與簽收區 -->
            <div style="margin-top: 50px; font-size: 15px; color: #000; position: relative;">
                <table style="width: 100%; border: none;">
                    <tr>
                        <td style="width: 50%; padding-left: 20px;">
                            <div>客戶簽名 / 蓋章確認：</div>
                            <div style="border-bottom: 1px solid #000; width: 80%; margin-top: 40px;"></div>
                        </td>
                        <td style="width: 50%; text-align: right; padding-right: 40px; vertical-align: top;">
                            <div style="margin-bottom: 10px;">長固實業有限公司</div>
                        </td>
                    </tr>
                </table>
                <!-- 動態注入公司大小章圖檔 -->
                ${sealHtml}
            </div>
            
        </div>
    `;

    document.getElementById('printQuoteArea').innerHTML = html;
    
    // 切換列印模式
    document.getElementById('printQuoteArea').classList.add('print-active');
    document.getElementById('printPoArea').classList.remove('print-active');
    document.getElementById('printArea').classList.remove('print-active');
    
    setTimeout(() => { window.print(); }, 500);
};

// ============================================================================
// 報表與發票模組... (以下保留原本發票邏輯無更動)
// ============================================================================
window.renderHistory = debounce(function() {
    const fStaff = document.getElementById('histFilterStaff').value; const fClient = document.getElementById('histFilterClient').value; const fDate = document.getElementById('histFilterDate').value; const fStatus = document.getElementById('histFilterStatus').value; const term = document.getElementById('histSearch').value.toLowerCase();
    let filtered = globalHistory;
    if(fStaff) filtered = filtered.filter(h => h.staff === fStaff); if(fClient) filtered = filtered.filter(h => h.client === fClient); if(fStatus) filtered = filtered.filter(h => h.status === fStatus);
    if(fDate) { const target = new Date(fDate).setHours(0,0,0,0); filtered = filtered.filter(h => { const d = new Date(h.time).setHours(0,0,0,0); return d === target; }); }
    if(term) filtered = filtered.filter(h => h.client.toLowerCase().includes(term) || String(h.paperNo).toLowerCase().includes(term) || h.details.toLowerCase().includes(term));
    const c = document.getElementById('histListContainer'); if(filtered.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">無紀錄</div>';
    
    c.innerHTML = filtered.map(h => {
        const d = new Date(h.time); const dateStr = isNaN(d.getTime()) ? '未知' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        const isVoid = h.status === '作廢'; const isEdited = h.historyLog && h.historyLog.length > 2;
        let badgeHTML = isVoid ? '<span class="badge bg-danger ms-1">已作廢</span>' : '';
        if(isEdited && !isVoid) badgeHTML += `<span class="badge bg-warning text-dark ms-1" onclick="alert('修改紀錄：\\n${escapeQuotes(JSON.parse(h.historyLog).join('\\n'))}')" style="cursor:pointer;">⚠️ 已修改</span>`;
        
        // 估價單核銷的特殊視覺標籤
        if(h.orderNo && h.orderNo.includes('估價單核銷')) {
            badgeHTML += `<span class="badge bg-primary ms-1">📑 估價單核銷</span>`;
        }

        const isBorrowed = String(h.paperNo).startsWith('[借用中]');
        let paperNoHtml = h.paperNo ? (isBorrowed ? `<span class="text-danger">⚠️ ${h.paperNo}</span>` : `發票: ${h.paperNo}`) : '';

        let actionBtns = '';
        if (!isVoid) {
            actionBtns += `<button class="btn btn-sm btn-outline-info me-1 fw-bold" onclick="printDeliveryNote(${h.rowIdx})">🖨️ 列印出單</button>`;
            if (isBorrowed) actionBtns += `<button class="btn btn-sm btn-danger me-1 fw-bold" onclick="openSuppInvModal(${h.rowIdx}, '${escapeQuotes(h.paperNo)}')">📝 補登發票</button>`;
            actionBtns += `<button class="btn btn-sm btn-outline-danger me-1" onclick="voidInv(${h.rowIdx}, '${escapeQuotes(h.paperNo)}')">作廢</button>`;
            actionBtns += `<button class="btn btn-sm btn-outline-secondary" onclick="openEditInv(${h.rowIdx})">編輯</button>`;
        }

        return `<div class="item-row bg-white shadow-sm p-3 ${isVoid?'status-void':''}">
            <div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2">
                <div><div class="fw-bold fs-6 text-dark">${h.client} ${badgeHTML}</div><div class="small text-muted">單號: ${h.orderNo||'--'} | 開立: ${h.staff}</div></div>
                <div class="text-end"><div class="badge bg-light text-dark border">${dateStr}</div><div class="small mt-1 fw-bold ${isBorrowed?'text-danger':'text-primary'}">${paperNoHtml}</div></div>
            </div>
            <div class="history-details text-muted mb-3">${h.details}</div>
            <div class="d-flex justify-content-between align-items-center">
                <div>${actionBtns}</div>
                <span class="fw-bold text-danger fs-5">$${Number(h.total).toLocaleString()}</span>
            </div>
        </div>`;
    }).join('');
}, 300);

window.openSuppInvModal = function(idx, oldPaperNo) {
    document.getElementById('supp_invRowIdx').value = idx; document.getElementById('supp_oldPaperNo').value = oldPaperNo; document.getElementById('supp_newPaperNo').value = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('suppInvModal')).show();
};

window.confirmSupplementInvoice = function() {
    const idx = parseInt(document.getElementById('supp_invRowIdx').value);
    const oldPaperNo = document.getElementById('supp_oldPaperNo').value;
    const newPaperNo = document.getElementById('supp_newPaperNo').value.trim().toUpperCase();
    if (!newPaperNo) return alert("請輸入正確的發票號碼！");
    
    showLoading("連動更新中...");
    callApi('supplementInvoiceNo', { rowIdx: idx, oldPaperNo: oldPaperNo, newPaperNo: newPaperNo, staff: myName })
    .then(res => {
        hideLoading();
        bootstrap.Modal.getInstance(document.getElementById('suppInvModal')).hide();
        showToast("✅ 發票號碼已成功補登並連動更新");
        refreshData(); // 強制重整抓取最新資料
    })
    .catch(err => { hideLoading(); alert("補登失敗：" + err.message); });
};

function printDeliveryNote(idx) {
    const h = globalHistory.find(x => x.rowIdx === idx); if (!h) return;
    const items = globalSalesDetails.filter(s => s.paperNo === h.paperNo && s.shipStatus !== '作廢');
    const printDate = new Date(h.time);
    const dateStr = isNaN(printDate.getTime()) ? getTodayStr().replace(/-/g, '/') : `${printDate.getFullYear()}年${printDate.getMonth() + 1}月${printDate.getDate()}日`;

    let tbodyHtml = '';
    if (items.length > 0) {
        items.forEach(item => {
            const inv = globalInventory.find(v => v.name === item.name);
            const lotExp = inv ? `${inv.lot||''} ${inv.expiry||''}`.trim() : '';
            tbodyHtml += `<tr><td style="border: 1px solid #333; padding: 8px; text-align: left;">${item.name}</td><td style="border: 1px solid #333; padding: 8px; text-align: center;">${item.qty}</td><td style="border: 1px solid #333; padding: 8px; text-align: center;">0</td><td style="border: 1px solid #333; padding: 8px; text-align: right;">${Number(item.price).toLocaleString()}</td><td style="border: 1px solid #333; padding: 8px; text-align: right;">${Number(item.subtotal).toLocaleString()}<br><span style="font-size: 11px; color: #555;">${item.orderNo || ''}</span></td><td style="border: 1px solid #333; padding: 8px; text-align: center; font-size: 11px;">${lotExp}</td></tr>`;
        });
    } else { tbodyHtml = `<tr><td colspan="6" style="border: 1px solid #333; padding: 8px; text-align: center;">(無明細資料或為舊資料)</td></tr>`; }

    const html = `
        <div style="padding: 0; width: 100%; box-sizing: border-box;">
            <table style="width: 100%; border: none; margin-bottom: 15px;"><tr><td style="width: 50%; vertical-align: top;"><div style="font-weight: bold; font-size: 16px;">TO:</div><div style="font-weight: bold; font-size: 22px; margin-top: 5px; letter-spacing: 2px;">${h.client}</div></td><td style="width: 50%; vertical-align: top; font-size: 14px; line-height: 1.6; text-align: right;"><div style="font-weight: bold; font-size: 16px;">FROM: 長固實業有限公司</div><div>新北市三重區重新路五段609巷6號4樓</div><div>TEL: (02) 2999-3881 &nbsp; 2999-3593</div><div>FAX: 886-2-2999-3495</div><div style="margin-top: 5px;">${dateStr} &nbsp;&nbsp; 1/1</div></td></tr></table>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;"><thead><tr style="background-color: #f8f9fa;"><th style="border: 1px solid #333; padding: 8px; text-align: center;">品名</th><th style="border: 1px solid #333; padding: 8px; width: 60px; text-align: center;">數量</th><th style="border: 1px solid #333; padding: 8px; width: 60px; text-align: center;">欠貨</th><th style="border: 1px solid #333; padding: 8px; width: 80px; text-align: center;">單價</th><th style="border: 1px solid #333; padding: 8px; width: 120px; text-align: center;">小計 客戶訂單號</th><th style="border: 1px solid #333; padding: 8px; width: 100px; text-align: center;">批號/效期</th></tr></thead><tbody>${tbodyHtml}</tbody><tfoot><tr><td colspan="4" style="border: 1px solid #333; padding: 8px; text-align: right; font-weight: bold;">*總計*</td><td style="border: 1px solid #333; padding: 8px; text-align: right; font-weight: bold;">${Number(h.total).toLocaleString()}</td><td style="border: 1px solid #333; padding: 8px;"></td></tr></tfoot></table>
            <div style="margin-top: 15px; font-size: 14px; line-height: 1.6;"><p style="margin-bottom: 5px;">以上貨品數量及單價請查核.</p><p style="margin-bottom: 15px;">附發票號碼: <strong style="font-size: 16px;">${h.paperNo || ''}</strong></p><div style="display: flex; justify-content: space-between; margin-top: 30px;"><div style="width: 45%;">簽收: <span style="border-bottom: 1px solid #000; display: inline-block; width: 75%;">&nbsp;</span></div><div style="width: 45%;">備考: <span style="border-bottom: 1px solid #000; display: inline-block; width: 75%;">&nbsp;</span></div></div></div>
        </div>
    `;
    document.getElementById('printArea').innerHTML = html; document.getElementById('printArea').classList.add('print-active'); document.getElementById('printPoArea').classList.remove('print-active'); document.getElementById('printQuoteArea').classList.remove('print-active');
    setTimeout(() => { window.print(); }, 300);
}

function voidInv(idx, pNo) { 
    if(confirm("確定作廢？系統將自動：\n1. 註銷此發票帳款\n2. 註銷銷售明細\n3. 【自動返還已出貨之庫存數量】")) { 
        const h = globalHistory.find(x=>x.rowIdx === idx); if(h) h.status = '作廢'; 
        globalSalesDetails.forEach(sd => { 
            if(sd.paperNo === pNo && sd.shipStatus !== '作廢') { 
                sd.shipStatus = '作廢'; 
                if (sd.shippedQty > 0) {
                    let inv = globalInventory.find(x=>x.name === sd.name); if(inv) inv.qty += sd.shippedQty; 
                    globalInvLogs.unshift({ time: Date.now(), staff: myName, name: sd.name, type: '作廢返還', qtyChange: sd.shippedQty, newQty: inv ? inv.qty : sd.shippedQty, memo: `作廢單號: ${pNo}` });
                }
            } 
        });
        populateLogDropdowns(); window.renderHistory(); window.renderInventory(); window.renderInvLogs(); renderShipments(); generateReport(); 
        pushToSyncQueue('updateInvoiceRecord', {action:'void', rowIdx: idx, staff: myName, paperNo: pNo}, null); showToast("🗑️ 已作廢並返還庫存");
    } 
}
function openEditInv(idx) { const h = globalHistory.find(x=>x.rowIdx === idx); if(!h) return; document.getElementById('e_invRow').value = idx; document.getElementById('e_invPaper').value = h.paperNo; document.getElementById('e_invOrder').value = h.orderNo; document.getElementById('e_invNet').value = h.net; document.getElementById('e_invTotal').value = h.total; document.getElementById('e_invDetails').value = h.details; bootstrap.Modal.getOrCreateInstance(document.getElementById('editInvModal')).show(); }
function saveEditInvoice() { const idx = parseInt(document.getElementById('e_invRow').value); const h = globalHistory.find(x=>x.rowIdx === idx); const data = { client: h.client, taxId: h.taxId, paperNo: document.getElementById('e_invPaper').value.toUpperCase(), orderNo: document.getElementById('e_invOrder').value, net: document.getElementById('e_invNet').value, tax: Math.round(document.getElementById('e_invTotal').value - document.getElementById('e_invNet').value), total: document.getElementById('e_invTotal').value, details: document.getElementById('e_invDetails').value }; if(h) { Object.assign(h, data); h.historyLog = "[\"修改紀錄存在\"]"; } window.renderHistory(); bootstrap.Modal.getInstance(document.getElementById('editInvModal')).hide(); pushToSyncQueue('updateInvoiceRecord', {action:'edit', rowIdx: idx, staff: myName, data: data}, null); }
function setReportDate(days) { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - (days - 1)); document.getElementById('repEnd').valueAsDate = e; document.getElementById('repStart').valueAsDate = s; generateReport(); }
function setReportMonth() { const val = document.getElementById('repMonthPicker').value; if(!val) return; const [year, month] = val.split('-'); document.getElementById('repStart').valueAsDate = new Date(year, month - 1, 1); document.getElementById('repEnd').valueAsDate = new Date(year, month, 0); generateReport(); }
function generateReport() {
    const sVal = document.getElementById('repStart').value; const eVal = document.getElementById('repEnd').value; if(!sVal || !eVal) return;
    const sDate = new Date(sVal); sDate.setHours(0,0,0,0); const eDate = new Date(eVal); eDate.setHours(23,59,59,999);
    let rCount=0, rNet=0, rTotal=0; const clientStats = {};
    globalHistory.forEach(h => { const d = new Date(h.time); if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && h.status !== '作廢') { rCount++; rNet += Number(h.net); rTotal += Number(h.total); if(!clientStats[h.client]) clientStats[h.client] = 0; clientStats[h.client] += Number(h.total); } });
    document.getElementById('repCount').innerText = `${rCount} 張`; document.getElementById('repNet').innerText = `$${rNet.toLocaleString()}`; document.getElementById('repTotal').innerText = `$${rTotal.toLocaleString()}`;
}
function exportReportToEmail() {
    const sVal = document.getElementById('repStart').value; const eVal = document.getElementById('repEnd').value; if(!sVal || !eVal) return alert("請先設定日期");
    const email = prompt("接收報表的 Email："); if(!email) return; showLoading("產生 Excel 中...");
    const sDate = new Date(sVal); sDate.setHours(0,0,0,0); const eDate = new Date(eVal); eDate.setHours(23,59,59,999);
    let rCount=0, rNet=0, rTax=0, rTotal=0; const clientStats = {}; const details = []; const lines = [];
    globalHistory.forEach(h => { const d = new Date(h.time); if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && h.status !== '作廢') { rCount++; rNet += Number(h.net); rTax += Number(h.tax); rTotal += Number(h.total); if(!clientStats[h.client]) clientStats[h.client] = 0; clientStats[h.client] += Number(h.total); details.push({ date: `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`, paperNo: h.paperNo, orderNo: h.orderNo, status: h.status, staff: h.staff, client: h.client, taxId: h.taxId, net: h.net, tax: h.tax, total: h.total, desc: h.details }); } });
    globalSalesDetails.forEach(s => { const d = new Date(s.time); if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && s.shipStatus !== '作廢') { lines.push({ time: `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`, paperNo: s.paperNo, client: s.client, orderNo: s.orderNo, name: s.name, qty: s.qty, price: 0, shipStatus: s.shipStatus, shippedQty: s.shippedQty }); } });
    const payload = { email: email, dateRange: `${sVal} ~ ${eVal}`, summary: { count: rCount, net: rNet, tax: rTax, total: rTotal }, clientStats: Object.keys(clientStats).map(k=>({name:k, total:clientStats[k]})).sort((a,b)=>b.total-a.total), details: details.reverse(), lineItems: lines.reverse() };
    callApi('exportExcelReport', payload).then(res => { hideLoading(); alert(`✅ 報表已寄送至 ${email}`); }).catch(err => { hideLoading(); alert("匯出失敗：" + err.message); });
}

// ============================================================================
// 通用搜尋與管理員模組
// ============================================================================
function openSearchModal(type, callback) {
    currentSearchCallback = callback; document.getElementById('searchModalList').innerHTML = ''; document.getElementById('searchModalInput').value = '';
    if(type === 'client' || type === 'admin_client' || type === 'client_ord' || type === 'client_quo') { document.getElementById('searchModalTitle').innerText = '選擇客戶'; currentSearchSource = globalClients.map(c => ({ text: c.name, sub: `統編: ${c.taxId||'無'}`, val: c.name })); }
    else if(type === 'item_adj') { document.getElementById('searchModalTitle').innerText = '選擇盤點品項'; const uniqueProds = [...new Map(globalCatalog.map(item => [item.productName, item])).values()]; currentSearchSource = uniqueProds.map((p, idx) => ({ text: p.productName, sub: `長固代號: ${p.internalCode||p.assetCode||'無'}`, val: p.productName, idx: idx, ref: p })); }
    else if(type.startsWith('item_')) { document.getElementById('searchModalTitle').innerText = '選擇品項'; let clientName = ''; if(type.startsWith('item_ord_')) clientName = document.getElementById('e_ordClient').value; else if(type.startsWith('item_quo_')) clientName = document.getElementById('e_quoClient').value; else clientName = document.getElementById('invClientInput').value; if(!clientName) { alert('請先選擇客戶！'); return; } currentSearchSource = globalCatalog.filter(p => p.clientName === clientName).map((p, idx) => ({ text: p.productName, sub: `單價: $${p.price} / ${p.unit}`, val: p.productName, idx: idx, ref: p })); }
    renderSearchList(currentSearchSource); bootstrap.Modal.getOrCreateInstance(document.getElementById('searchModal')).show(); setTimeout(()=> document.getElementById('searchModalInput').focus(), 500);
}

window.filterSearchModal = debounce(function() { 
    const term = document.getElementById('searchModalInput').value.toLowerCase(); 
    renderSearchList(currentSearchSource.filter(s => s.text.toLowerCase().includes(term) || (s.sub && s.sub.toLowerCase().includes(term)))); 
}, 300);

function renderSearchList(arr) { document.getElementById('searchModalList').innerHTML = arr.map(item => `<button class="search-btn-item" onclick="onSearchSelect('${escapeQuotes(item.val)}')"><div class="d-flex justify-content-between align-items-center"><span>${item.text}</span><span class="badge bg-secondary">${item.sub}</span></div></button>`).join(''); }
function onSearchSelect(val) { bootstrap.Modal.getInstance(document.getElementById('searchModal')).hide(); if(currentSearchCallback) currentSearchCallback(val); }

function populateAdminClientFilter() { document.getElementById('admItemFilterSelect').innerHTML = '<option value="">📂 所有客戶 (顯示全部)</option>' + globalClients.map(c => `<option value="${c.name}">${c.name}</option>`).join(''); }

window.renderAdminClients = debounce(function() { 
    const term = document.getElementById('admClientSearch').value.toLowerCase(); 
    document.getElementById('admClientList').innerHTML = globalClients.filter(c => c.name.toLowerCase().includes(term) || String(c.taxId).includes(term)).map(c => `<div class="item-row bg-white d-flex justify-content-between align-items-center shadow-sm"><div><div class="fw-bold text-dark fs-6">${c.name}</div><div class="small text-muted mt-1">統編: ${c.taxId||'無'}</div></div><button class="btn btn-outline-danger btn-sm fw-bold px-3" onclick="openEditClientModal('${escapeQuotes(c.name)}', '${escapeQuotes(c.taxId)}')">📝 編輯</button></div>`).join(''); 
}, 300);

function openNewClientModal() { document.getElementById('addClientName').value = ''; document.getElementById('addClientTaxId').value = ''; document.getElementById('addClientAddress').value = ''; document.getElementById('addClientReceiveDept').value = ''; bootstrap.Modal.getOrCreateInstance(document.getElementById('addClientModal')).show(); }
function submitNewClientOptimistic() { const name = document.getElementById('addClientName').value.trim(); const taxId = document.getElementById('addClientTaxId').value.trim(); const address = document.getElementById('addClientAddress').value.trim(); const receiveDept = document.getElementById('addClientReceiveDept').value.trim(); if(!name) return alert('名稱必填'); globalClients.push({ name, taxId, address, receiveDept }); populateAdminClientFilter(); window.renderAdminClients(); bootstrap.Modal.getInstance(document.getElementById('addClientModal')).hide(); pushToSyncQueue('addClientData', {clientName: name, taxId, address, receiveDept}, null); }
function openEditClientModal(name, taxId) { 
    const c = globalClients.find(x => x.name === name);
    document.getElementById('editClientOldName').value = name; document.getElementById('editClientName').value = name; document.getElementById('editClientTaxId').value = taxId; 
    document.getElementById('editClientAddress').value = c ? (c.address || '') : '';
    document.getElementById('editClientReceiveDept').value = c ? (c.receiveDept || '') : '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editClientModal')).show(); 
}
function submitEditClientOptimistic() { const old = document.getElementById('editClientOldName').value; const name = document.getElementById('editClientName').value.trim(); const tax = document.getElementById('editClientTaxId').value.trim(); const address = document.getElementById('editClientAddress').value.trim(); const receiveDept = document.getElementById('editClientReceiveDept').value.trim(); if(!name) return; const c = globalClients.find(x => x.name === old); if(c) { c.name = name; c.taxId = tax; c.address = address; c.receiveDept = receiveDept; } globalCatalog.forEach(p => { if(p.clientName === old) p.clientName = name; }); populateAdminClientFilter(); window.renderAdminClients(); window.renderAdminItems(); bootstrap.Modal.getInstance(document.getElementById('editClientModal')).hide(); pushToSyncQueue('updateClientData', {oldName: old, newName: name, newTaxId: tax, address, receiveDept}, null); }

window.renderAdminItems = debounce(function() { 
    const f = document.getElementById('admItemFilterSelect').value; const t = document.getElementById('admItemSearch').value.toLowerCase(); let arr = globalCatalog; if(f) arr = arr.filter(p => p.clientName === f); if(t) arr = arr.filter(p => p.productName.toLowerCase().includes(t) || p.clientName.toLowerCase().includes(t)); document.getElementById('admItemList').innerHTML = arr.length ? arr.map(p => `<div class="item-row bg-white d-flex justify-content-between align-items-center shadow-sm"><div><div class="fw-bold text-dark fs-6 mb-2">${p.productName} <span class="badge bg-secondary ms-1">${p.internalCode||''}</span></div><div class="d-flex align-items-center"><span class="badge bg-light text-dark border me-2 align-self-center">${p.clientName}</span><div class="bg-success text-white px-2 py-1 rounded shadow-sm d-inline-block"><span class="fw-bold">NT$ ${p.price}</span></div><span class="text-muted small fw-bold ms-1">/ ${p.unit}</span></div></div><button class="btn btn-outline-primary btn-sm fw-bold px-3 ms-2" onclick="openAdminItemModal(${p.rowIndex})">📝</button></div>`).join('') : '<div class="text-center text-muted py-4">查無對應品項</div>'; 
}, 300);

function openAdminItemModal(idx) { const m = document.getElementById('editItemModal'); const ipt = document.getElementById('editItemClientDisplay'); if(idx) { const p = globalCatalog.find(x => x.rowIndex === idx); document.getElementById('editItemRowIndex').value = idx; ipt.value = p.clientName; document.getElementById('editItemClientVal').value = p.clientName; ipt.onclick = null; ipt.classList.remove('fake-input-btn'); document.getElementById('editItemName').value = p.productName; document.getElementById('editItemInternalCode').value = p.internalCode || ''; document.getElementById('editItemUnit').value = p.unit; document.getElementById('editItemPrice').value = p.price; } else { document.getElementById('editItemRowIndex').value = ''; ipt.value = ''; ipt.onclick = triggerItemClientSelect; ipt.classList.add('fake-input-btn'); document.getElementById('editItemName').value = ''; document.getElementById('editItemInternalCode').value = ''; document.getElementById('editItemUnit').value = '式'; document.getElementById('editItemPrice').value = ''; } bootstrap.Modal.getOrCreateInstance(m).show(); }
function triggerItemClientSelect() { bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide(); openSearchModal('admin_client', (val) => { document.getElementById('editItemClientDisplay').value = val; document.getElementById('editItemClientVal').value = val; setTimeout(()=> bootstrap.Modal.getOrCreateInstance(document.getElementById('editItemModal')).show(), 400); }); }

function submitEditItemOptimistic() { 
    const idx = document.getElementById('editItemRowIndex').value; 
    const client = document.getElementById('editItemClientVal').value; 
    const name = document.getElementById('editItemName').value.trim(); 
    const internalCode = document.getElementById('editItemInternalCode').value.trim(); 
    const unit = document.getElementById('editItemUnit').value.trim(); 
    const price = document.getElementById('editItemPrice').value; 
    
    if(!client || !name || !price) return alert('必填未填'); 
    
    const payload = { 
        rowIndex: idx ? parseInt(idx) : null, 
        clientName: client, 
        productName: name, 
        internalCode: internalCode, 
        unit: unit, 
        price: Number(price) 
    }; 
    
    if(idx) { 
        const p = globalCatalog.find(x => x.rowIndex === payload.rowIndex); 
        if(p) Object.assign(p, payload); 
    } else { 
        globalCatalog.push({ 
            rowIndex: Date.now(), 
            clientName: client, 
            productName: name, 
            internalCode: internalCode, 
            unit: unit, 
            price: Number(price) 
        }); 
    } 
    
    window.renderAdminItems(); 
    bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide(); 
    
    pushToSyncQueue('saveAdminItem', payload, null); 
}
