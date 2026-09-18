/**
 * ============================================================================
 * 模組 1：API 核心、全域狀態與雙軌並行架構 (api_core.js) - 【上半部】
 * ============================================================================
 */

// 🔴 舊版系統 API 端點 (GAS)
const API_URL = "https://script.google.com/macros/s/AKfycbxWzxfHYdw9qvcPtGpU2qjxk-10hToTb1Jx-LrMhBN1jkR3IXUnu8m6UgfKcGMsi0tl/exec";

// 🟢 新版系統 API 端點 (Supabase)
const SUPABASE_URL = "https://dojhiznffztiyofkfdiu.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvamhpem5mZnp0aXlvZmtmZGl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzk3MzYsImV4cCI6MjEwNTMxNTczNn0.reT6i25kO1d1V8p2fDMHOOPVxaUJfp9SxOFeg-_xFqI";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
let globalQuotes = []; 
let globalDeliveries = []; 
let emailSettingsData = { list: [], selected: [] };

let myLastSyncTime = 0;

let aiTempData = null; 
let currentOrderManualItems = []; 
let currentQuoItems = []; 
let selectedOrderCache = []; 
let currentInvoiceData = { clientName:'', taxId:'', items:[] }; 
let currentSearchSource = []; 
let currentSearchCallback = null;

// ============================================================================
// API 通訊模組 (發送至 Google Sheets)
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
// 【全新】Supabase 雙軌寫入路由中心
// ============================================================================
async function dualWriteToSupabase(action, payload) {
    try {
        console.log(`[雙軌寫入] 準備同步 ${action} 至 Supabase...`);
        
        // 依據不同行為，將資料極速寫入對應的 Supabase 表格
        if (action === 'saveOrderData') {
            const items = payload.items || [];
            await supabase.from('orders').upsert({
                row_idx: payload.rowIdx || Date.now(),
                time: Date.now(), client: payload.clientName, order_no: payload.orderNo,
                dept: payload.department, status: payload.status, json_str: JSON.stringify(items),
                deadline: payload.deadline, source: payload.source, mail_url: payload.mailUrl
            });
        } 
        else if (action === 'submitInvoice') {
            await supabase.from('invoices').insert({
                row_idx: Date.now(), time: payload.invDate, staff: payload.staff,
                client: payload.clientName, tax_id: payload.taxId, net: payload.netTotal,
                tax: payload.tax, total: payload.totalWithTax, details: payload.detailsStr,
                paper_no: payload.paperNo, order_no: payload.orderNo, status: '正常', history_log: '[]'
            });
            if (payload.items && payload.items.length > 0) {
                const sdArr = payload.items.map((i, idx) => ({
                    row_idx: Date.now() + Math.floor(Math.random() * 1000) + idx,
                    time: payload.invDate, paper_no: payload.paperNo, client: payload.clientName,
                    order_no: payload.orderNo, name: i.name, qty: i.qty, unit: i.unit,
                    price: i.price, subtotal: i.subtotal, ship_status: '待出貨', shipped_qty: 0,
                    lot: '', expiry: ''
                }));
                await supabase.from('sales_details').insert(sdArr);
            }
        } 
        else if (action === 'adjustInventory') {
            const { data: inv } = await supabase.from('inventory').select('*').eq('name', payload.name).single();
            let currentNewQty = payload.changeQty;
            if (inv) {
                currentNewQty = Number(inv.qty) + payload.changeQty;
                let batches = JSON.parse(inv.batches_str || '[]');
                if (payload.lot || payload.expiry) {
                    let bIdx = batches.findIndex(b => b.lot === payload.lot && b.exp === payload.expiry);
                    if (bIdx >= 0) batches[bIdx].qty += payload.changeQty;
                    else batches.push({ lot: payload.lot, exp: payload.expiry, qty: payload.changeQty });
                }
                await supabase.from('inventory').update({ 
                    qty: currentNewQty, cost: payload.cost, alert_qty: payload.alertQty,
                    supplier: payload.supplier, internal_code: payload.internalCode, 
                    batches_str: JSON.stringify(batches) 
                }).eq('name', payload.name);
            } else {
                let newBatches = [];
                if (payload.lot || payload.expiry) newBatches.push({ lot: payload.lot, exp: payload.expiry, qty: payload.changeQty });
                await supabase.from('inventory').insert({
                    name: payload.name, qty: payload.changeQty, alert_qty: payload.alertQty,
                    cost: payload.cost, supplier: payload.supplier, internal_code: payload.internalCode,
                    batches_str: JSON.stringify(newBatches)
                });
            }
            await supabase.from('inventory_logs').insert({
                row_idx: Date.now(), time: Date.now(), staff: payload.staff, name: payload.name,
                type: payload.type, qty_change: payload.changeQty, new_qty: currentNewQty,
                lot: payload.lot, expiry: payload.expiry, invoice_no: payload.invoiceNo,
                arrival_date: payload.arrivalDate, memo: payload.memo, internal_code: payload.internalCode
            });
        } 
        else if (action === 'updateShipment') {
            for (let u of payload.updates) {
                const { data: sd } = await supabase.from('sales_details').select('*').eq('row_idx', u.rowIdx).single();
                if (sd) {
                    let newShipped = (sd.shipped_qty || 0) + u.shipQty;
                    let newStatus = newShipped >= sd.qty ? '已結案' : '部分出貨';
                    await supabase.from('sales_details').update({ shipped_qty: newShipped, ship_status: newStatus }).eq('row_idx', u.rowIdx);
                }
                const { data: inv } = await supabase.from('inventory').select('*').eq('name', u.name).single();
                if (inv) {
                    let newQty = Number(inv.qty) - u.shipQty;
                    let batches = JSON.parse(inv.batches_str || '[]');
                    if (u.batchTarget) {
                        let bIdx = batches.findIndex(b => b.lot === u.batchTarget);
                        if (bIdx >= 0) batches[bIdx].qty -= u.shipQty;
                    }
                    batches = batches.filter(b => b.qty > 0);
                    await supabase.from('inventory').update({ qty: newQty, batches_str: JSON.stringify(batches) }).eq('name', u.name);
                    
                    await supabase.from('inventory_logs').insert({
                        row_idx: Date.now() + Math.floor(Math.random() * 1000), time: Date.now(),
                        staff: payload.staff, name: u.name, type: '分批出貨', qty_change: -u.shipQty,
                        new_qty: newQty, lot: u.batchTarget || '', order_no: u.paperNo, memo: `單號: ${u.paperNo}`
                    });
                }
            }
        } 
        else if (action === 'addClientData') {
            await supabase.from('clients').insert({
                name: payload.clientName, tax_id: payload.taxId, address: payload.address, receive_dept: payload.receiveDept
            });
        }
        console.log(`[雙軌寫入] ${action} 已極速發送至 Supabase`);
    } catch (e) {
        console.error(`[雙軌寫入錯誤] ${action}:`, e);
    }
}

// ============================================================================
// 背景同步佇列系統 (雙向防呆版)
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
        console.warn("同步超時(已達28秒)，準備於背景重試", task.action);
        task.retry += 1;
        handleSyncRetry(task);
    }, 28000);

    // 🔥 雙軌並行核心：同時呼叫 Supabase 與 GAS
    dualWriteToSupabase(task.action, task.payload);

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
        case 'saveQuotation': return `📑 建立/編輯估價單 | 客戶: ${p.clientName} | 單號: ${p.quoteNo}`;
        case 'mergeQuotations': return `🔗 合併估價單 | 群組 ID: ${p.mergeId}`;
        case 'unmergeQuotations': return `✂️ 解除合併估價單`;
        case 'updateQuotationStatus': return `🔄 更改估價單狀態 | 新狀態: ${p.status}`;
        case 'splitAndVoidQuotationItems': return `🗑️ 拆分作廢估價單品項 | 單號: ${p.quoteNo}`;
        case 'updateDeliveryInfo': return `🚚 更新送貨資訊 | 狀態: ${p.status||''}`;
        case 'updateDeliveryStatus': return `📦 送貨狀態變更 | 動作: ${p.action === 'sign' ? '簽收結案' : '退回待送'}`;
        case 'editInvLogBatch': return `🔄 修改出貨批號 | 品名: ${p.name||'未知'} -> 新批號: ${p.newLot||'不分批'}`;
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

// ============================================================================
// 【全新核心】從 Supabase 極速載入全系統資料 (0.1秒載入)
// ============================================================================
async function loadDataFromSupabase() {
    console.log("⚡ 從 Supabase 極速載入資料...");
    const [
        {data: c}, {data: s}, {data: cat}, {data: inv}, {data: ord},
        {data: invc}, {data: sd}, {data: log}, {data: del}, {data: quo}, {data: em}
    ] = await Promise.all([
        supabase.from('clients').select('*'),
        supabase.from('suppliers').select('*'),
        supabase.from('catalog').select('*'),
        supabase.from('inventory').select('*'),
        supabase.from('orders').select('*').order('row_idx', {ascending: false}),
        supabase.from('invoices').select('*').order('row_idx', {ascending: false}),
        supabase.from('sales_details').select('*').order('row_idx', {ascending: false}),
        supabase.from('inventory_logs').select('*').order('row_idx', {ascending: false}),
        supabase.from('deliveries').select('*').order('row_idx', {ascending: false}),
        supabase.from('quotations').select('*').order('row_idx', {ascending: false}),
        supabase.from('email_settings').select('*')
    ]);

    // 將 Supabase 的蛇形命名 (snake_case) 自動轉換回系統適用的駝峰命名 (camelCase)
    globalClients = (c || []).map(x => ({name: x.name, taxId: x.tax_id, address: x.address, receiveDept: x.receive_dept}));
    globalSuppliers = (s || []).map(x => ({name: x.name, code: x.code, phone: x.phone, fax: x.fax}));
    globalCatalog = (cat || []).map(x => ({rowIndex: x.row_index, assetCode: x.asset_code, internalCode: x.internal_code, clientName: x.client_name, productName: x.product_name, unit: x.unit, price: Number(x.price)}));
    globalInventory = (inv || []).map(x => ({rowIdx: 0, name: x.name, qty: Number(x.qty), alertQty: Number(x.alert_qty), cost: Number(x.cost), supplier: x.supplier, internalCode: x.internal_code, assetCodeCombined: x.asset_code_combined, batchesStr: x.batches_str}));
    globalOrders = (ord || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), client: x.client, orderNo: x.order_no, dept: x.dept, status: x.status, jsonStr: x.json_str, deadline: x.deadline, source: x.source, mailUrl: x.mail_url}));
    globalHistory = (invc || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, client: x.client, taxId: x.tax_id, net: Number(x.net), tax: Number(x.tax), total: Number(x.total), details: x.details, paperNo: x.paper_no, orderNo: x.order_no, status: x.status, historyLog: x.history_log}));
    globalSalesDetails = (sd || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), paperNo: x.paper_no, client: x.client, orderNo: x.order_no, name: x.name, qty: Number(x.qty), unit: x.unit, price: Number(x.price), subtotal: Number(x.subtotal), shipStatus: x.ship_status, shippedQty: Number(x.shipped_qty), lot: x.lot, expiry: x.expiry}));
    globalInvLogs = (log || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, name: x.name, type: x.type, qtyChange: Number(x.qty_change), newQty: Number(x.new_qty), lot: x.lot, expiry: x.expiry, invoiceNo: x.invoice_no, orderNo: x.order_no, memo: x.memo, arrivalDate: x.arrival_date, snapshot: x.snapshot, internalCode: x.internal_code}));
    globalDeliveries = (del || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), paperNo: x.paper_no, client: x.client, itemsStr: x.items_str, status: x.status, deliveryDate: x.delivery_date, deliveryMethod: x.delivery_method, memo: x.memo, signature: x.signature, staff: x.staff, orderNo: x.order_no, lot: x.lot, expiry: x.expiry}));
    globalQuotes = (quo || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), quoteNo: x.quote_no, quoteDate: x.quote_date, client: x.client, status: x.status, jsonStr: x.json_str, useSeal: x.use_seal, mergeId: x.merge_id, staff: x.staff, memo: x.memo}));
    
    emailSettingsData.list = (em || []).map(x => ({email: x.email, memo: x.memo}));
    emailSettingsData.selected = emailSettingsData.selected || [];
    
    myLastSyncTime = Date.now();
}

// ============================================================================
// UI 全域刷新控制器 (避免重複撰寫)
// ============================================================================
function refreshAllUI() {
    if (typeof window.populateAdminClientFilter === "function") window.populateAdminClientFilter();
    if (typeof window.updateHistoryDropdowns === "function") window.updateHistoryDropdowns();
    if (typeof window.populateLogDropdowns === "function") window.populateLogDropdowns();
    if (typeof window.updateOrderClientDropdown === "function") window.updateOrderClientDropdown();
    if (typeof window.renderEmailSettings === "function") window.renderEmailSettings();
    
    if(document.getElementById('sys-history') && document.getElementById('sys-history').style.display === 'block') { 
        if (typeof window.renderHistory === "function") window.renderHistory(); 
        if (typeof window.generateReport === "function") window.generateReport(); 
    }
    if(document.getElementById('sys-admin') && document.getElementById('sys-admin').style.display === 'block') { 
        if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
        if (typeof window.renderAdminClients === "function") window.renderAdminClients(); 
    }
    if(document.getElementById('sys-order') && document.getElementById('sys-order').style.display === 'block') {
        if (typeof window.renderOrderList === "function") window.renderOrderList();
    }
    if(document.getElementById('sys-inventory') && document.getElementById('sys-inventory').style.display === 'block') { 
        if (typeof window.renderInventory === "function") window.renderInventory(); 
        if (typeof window.renderInvLogs === "function") window.renderInvLogs(); 
        if (typeof window.renderShipments === "function") window.renderShipments(); 
    }
    if(document.getElementById('sys-quotation') && document.getElementById('sys-quotation').style.display === 'block') {
        if (typeof window.renderQuotationList === "function") window.renderQuotationList(); 
    }
    if(document.getElementById('sys-delivery') && document.getElementById('sys-delivery').style.display === 'block') {
        if (typeof window.renderDeliveryList === "function") window.renderDeliveryList(); 
    }
}

function silentRefreshData() {
    loadDataFromSupabase().then(() => {
        refreshAllUI();
    }).catch(err => console.log('背景靜默同步 Supabase 失敗:', err));
}

// ============================================================================
// Supabase Realtime 即時監聽器 (0.1秒推播)
// ============================================================================
function setupSupabaseRealtime() {
    supabase.channel('custom-all-channel')
        .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
            console.log('🔄 Supabase 偵測到資料庫變更:', payload);
            if (!isSyncing && bgSyncQueue.length === 0) {
                silentRefreshData(); // 收到推播後自動更新畫面，不需重新整理
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Supabase Realtime 即時監聽已啟動');
            }
        });
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
// 動態切換紙張版型與防擠壓預覽系統
// ============================================================================
window.applyPrintStyle = function(size, layout) {
    let styleNode = document.getElementById('dynamicPrintStyle');
    if (!styleNode) {
        styleNode = document.createElement('style');
        styleNode.id = 'dynamicPrintStyle';
        document.head.appendChild(styleNode);
    }
    
    styleNode.innerHTML = `
    @page { size: ${size} ${layout}; margin: 0mm !important; }

    @media screen {
        .print-active > div {
            min-width: 800px !important;
            margin: 0 auto !important;
            background: #fff;
            box-shadow: 0 0 15px rgba(0,0,0,0.3);
        }
    }
    @media print { 
        body { background: #fff !important; padding-top: 0 !important; } 
        #printControlBar { display: none !important; }
        .print-active { padding: 0 !important; overflow: visible !important; }
        .print-active > div { min-width: 100% !important; margin: 0 !important; box-shadow: none !important; }
    }`;
};

window.showPrintPreview = function(areaId) {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('homeMenu').style.display = 'none';
    
    ['printArea', 'printPoArea', 'printQuoteArea', 'printDeliveryArea'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.display = 'none';
            el.classList.remove('print-active');
        }
    });
    
    const targetArea = document.getElementById(areaId);
    targetArea.style.display = 'block';
    targetArea.classList.add('print-active');
    
    targetArea.style.width = '100%';
    targetArea.style.overflowX = 'auto';
    targetArea.style.padding = '20px 0';
    
    let controlBar = document.getElementById('printControlBar');
    if (!controlBar) {
        controlBar = document.createElement('div');
        controlBar.id = 'printControlBar';
        controlBar.className = 'd-flex justify-content-center p-3 position-fixed w-100 top-0 d-print-none';
        controlBar.style.cssText = 'z-index: 10500; left: 0; background-color: #343a40; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
        controlBar.innerHTML = `
            <button onclick="window.print()" class="btn btn-primary fw-bold px-4 py-2 me-3 fs-5 shadow-sm">🖨️ 確認呼叫印表機</button>
            <button onclick="closePrintPreview()" class="btn btn-danger fw-bold px-4 py-2 fs-5 shadow-sm">❌ 關閉預覽並返回</button>
        `;
        document.body.appendChild(controlBar);
    }
    controlBar.style.display = 'flex';
    document.body.style.backgroundColor = '#2c3034';
    document.body.style.paddingTop = '80px'; 
    document.body.style.overflow = 'auto'; 
    window.scrollTo(0,0);
};

window.closePrintPreview = function() {
    let controlBar = document.getElementById('printControlBar');
    if(controlBar) controlBar.remove(); 
    
    document.body.style.paddingTop = '0px';
    document.body.style.backgroundColor = ''; 
    document.body.style.overflow = ''; 
    
    ['printArea', 'printPoArea', 'printQuoteArea', 'printDeliveryArea'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.display = 'none';
            el.classList.remove('print-active');
            el.style.width = '';
            el.style.overflowX = '';
            el.style.padding = '';
            el.replaceChildren(); 
        }
    });
    
    document.getElementById('mainApp').style.display = 'block';
};

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
            if (type === 'order' && typeof window.reRenderOrderManualItems === "function") window.reRenderOrderManualItems();
            if (type === 'invoice' && typeof window.reRenderInvoiceItems === "function") window.reRenderInvoiceItems();
            if (type === 'quotation' && typeof window.reRenderQuotationItems === "function") window.reRenderQuotationItems(); 
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
    
    // ============================================================================
    // 智能心跳系統 (維持舊系統上線人數統計)
    // ============================================================================
    setInterval(() => { 
        if(document.getElementById('mainApp') && document.getElementById('mainApp').style.display === 'block') { 
            callApi('heartbeat', { uid: myUid }).then(res => { 
                let count = typeof res === 'object' ? res.count : res;
                if(document.getElementById('mqOnline')) document.getElementById('mqOnline').innerText = `👥 ${count} 人`; 
                if(document.getElementById('navOnlineCount')) document.getElementById('navOnlineCount').innerText = `👥 ${count}`; 
                // 資料更新已被 Supabase Realtime 接管，此處僅保留人數統計
            }).catch(e => console.log('心跳同步失敗', e)); 
        } 
    }, 15000); 
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
    document.getElementById('splashScreen').style.display = 'flex'; let fakeProgress = 10; setProgress(fakeProgress, '🚀 從 Supabase 極速載入中...');
    const intv = setInterval(() => { fakeProgress += (85 - fakeProgress) * 0.2; setProgress(fakeProgress); }, 100);
    
    // 【升級】直接從 Supabase 一次拉取全系統資料
    loadDataFromSupabase().then(() => {
        clearInterval(intv); setProgress(100, '✅ 載入完成！');
        
        refreshAllUI();
        setupSupabaseRealtime(); // 啟動即時監聽
        
        const currentMonth = new Date().getMonth();
        const monthCount = globalHistory.filter(h => new Date(h.time).getMonth() === currentMonth).length;
        if(document.getElementById('mqMonthCount')) document.getElementById('mqMonthCount').innerText = `🧾 本月已開立 ${monthCount} 張`; 
        
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
    }).catch(e => { clearInterval(intv); alert("初始化連線失敗：" + e.message); });
};

window.refreshData = function() {
    showLoading("極速同步最新資料...");
    loadDataFromSupabase().then(() => {
        refreshAllUI();
        hideLoading(); showToast('✅ 已同步至最新狀態');
    }).catch(err => { hideLoading(); alert("同步失敗：" + err.message); });
};

window.enterSystem = function(modId) {
    document.getElementById('homeMenu').style.display = 'none'; document.getElementById('mainApp').style.display = 'block';
    document.querySelectorAll('.sys-module').forEach(el => el.style.display = 'none'); document.getElementById(`sys-${modId}`).style.display = 'block';
    
    const titles = {'order':'📦 訂單辨識建檔', 'invoice':'📝 開立發票', 'inventory': '🏭 產品庫存管理', 'history':'📊 紀錄與報表', 'admin':'⚙️ 管理員後台', 'quotation': '📑 開立估價單', 'delivery': '🚚 送貨與電子簽收'}; 
    
    if(document.getElementById('sysTitle')) document.getElementById('sysTitle').innerText = titles[modId]; 
    document.getElementById('mainApp').scrollTo(0,0);
    
    if(modId === 'history') { 
        if (typeof window.renderHistory === "function") window.renderHistory(); 
        if (typeof window.generateReport === "function") window.generateReport(); 
    }
    if(modId === 'admin') { 
        if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
        if (typeof window.renderAdminClients === "function") window.renderAdminClients(); 
    }
    if(modId === 'order') {
        if (typeof window.renderOrderList === "function") window.renderOrderList();
    }
    if(modId === 'inventory') { 
        if (typeof window.renderInventory === "function") window.renderInventory(); 
        if (typeof window.renderInvLogs === "function") window.renderInvLogs(); 
        if (typeof window.renderShipments === "function") window.renderShipments(); 
    }
    if(modId === 'quotation') {
        if (typeof window.renderQuotationList === "function") window.renderQuotationList(); 
    }
    if(modId === 'delivery') {
        if (typeof window.renderDeliveryList === "function") window.renderDeliveryList(); 
    }
};

window.backToHome = function() { document.getElementById('mainApp').style.display = 'none'; document.getElementById('homeMenu').style.display = 'block'; };
