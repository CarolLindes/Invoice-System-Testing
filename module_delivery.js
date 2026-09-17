/**
 * ============================================================================
 * 模組 6：送貨追蹤與簽收 (module_delivery.js)
 * ============================================================================
 */

let currentDeliveryIds = [];
let signaturePadInstance = null;

// ============================================================================
// 送貨清單渲染與狀態管理
// ============================================================================
window.renderDeliveryList = debounce(function() {
    const term = (document.getElementById('dlvSearchInput').value || '').toLowerCase();
    const fMethod = document.getElementById('dlvFilterMethod').value;
    
    let filtered = globalDeliveries;
    if (term) {
        filtered = filtered.filter(d => 
            (d.client || '').toLowerCase().includes(term) ||
            (d.paperNos || '').toLowerCase().includes(term) ||
            (d.itemsStr || '').toLowerCase().includes(term)
        );
    }
    if (fMethod) {
        filtered = filtered.filter(d => d.method === fMethod);
    }

    let pending = filtered.filter(d => d.status === '待送貨');
    let history = filtered.filter(d => d.status === '送貨中' || d.status === '已結案');

    // 渲染待排程送貨
    const pCont = document.getElementById('dlvPendingListContainer');
    if (pending.length === 0) pCont.innerHTML = '<div class="text-center text-muted py-4">目前無待排程送貨資料</div>';
    else {
        pCont.innerHTML = pending.map(d => {
            return `<div class="item-row bg-white shadow-sm p-3 mb-2">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div class="d-flex align-items-center">
                        <input class="form-check-input me-3 cb-dlv" type="checkbox" value="${d.rowIdx}" data-client="${escapeQuotes(d.client)}" style="transform: scale(1.3);">
                        <div class="fw-bold fs-6 text-dark">${d.client}</div>
                    </div>
                    <button class="btn btn-sm text-white fw-bold shadow-sm px-3" style="background-color: #fd7e14;" onclick="openShipDeliveryModal(${d.rowIdx})">▶️ 執行排程送貨</button>
                </div>
                <div class="small text-muted mt-2 border-top pt-2">
                    <div>發票號碼: <span class="text-primary fw-bold">${d.paperNos || '無'}</span></div>
                    <div class="mt-1">出貨明細: <span class="text-dark fw-bold">${d.itemsStr}</span></div>
                </div>
            </div>`;
        }).join('');
    }

    // 渲染送貨歷史與結案
    const hCont = document.getElementById('dlvHistoryListContainer');
    if (history.length === 0) hCont.innerHTML = '<div class="text-center text-muted py-4">無歷史紀錄</div>';
    else {
        hCont.innerHTML = history.sort((a,b)=>b.rowIdx - a.rowIdx).map(d => {
            const isDone = d.status === '已結案';
            const badge = isDone ? '<span class="badge bg-success">已結案</span>' : '<span class="badge bg-info text-dark shadow-sm">送貨中</span>';
            
            let actionBtns = '';
            if (!isDone) {
                actionBtns += `<button class="btn btn-sm btn-outline-danger fw-bold me-1" onclick="revertDelivery(${d.rowIdx})">🔙 退回待送</button>`;
                actionBtns += `<button class="btn btn-sm btn-outline-secondary fw-bold me-1" onclick="openEditDeliveryModal(${d.rowIdx})">✏️ 編輯</button>`;
                actionBtns += `<button class="btn btn-sm btn-success fw-bold text-white shadow-sm px-3" onclick="openSignDeliveryModal(${d.rowIdx})">✍️ 簽收結案</button>`;
            } else {
                if (d.signatureUrl && d.signatureUrl !== '#') {
                    actionBtns += `<a href="${escapeQuotes(d.signatureUrl)}" target="_blank" class="btn btn-sm btn-outline-success fw-bold">📄 檢視電子簽收憑證</a>`;
                } else if (d.signatureUrl === '#') {
                    actionBtns += `<span class="badge bg-secondary">簽名圖片上傳中...</span>`;
                }
            }

            return `<div class="item-row bg-white shadow-sm p-3 mb-2 ${isDone ? 'border-success' : 'border-warning'}">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div class="fw-bold fs-6 text-dark">${d.client} ${badge}</div>
                    <div>
                        <button class="btn btn-sm btn-outline-primary fw-bold me-1" onclick="printDeliveryNoteDoc(${d.rowIdx})">🖨️ 列印單據</button>
                        ${actionBtns}
                    </div>
                </div>
                <div class="small text-muted mt-2 border-top pt-2">
                    <div>對應發票: ${d.paperNos || '無'} | 送貨方式: <span class="text-primary fw-bold">${d.method||'未設定'}</span> | 送貨日期: ${d.deliveryDate||'未設定'}</div>
                    <div class="mt-1">出貨明細: <span class="text-dark fw-bold">${d.itemsStr}</span></div>
                    <div class="mt-1 text-secondary">備註事項: ${d.memo || '無'}</div>
                </div>
            </div>`;
        }).join('');
    }
}, 300);

window.groupDeliveries = function() {
    const cbs = document.querySelectorAll('.cb-dlv:checked');
    if (cbs.length === 0) return alert('請先勾選要排程的送貨單！');
    
    let client = ''; let valid = true; let ids = [];
    cbs.forEach(cb => {
        ids.push(parseInt(cb.value));
        if (!client) client = cb.dataset.client;
        else if (client !== cb.dataset.client) valid = false;
    });

    if (!valid) return alert('⚠️ 合併防呆：不同客戶的單據無法合併排程！請分批勾選。');
    
    currentDeliveryIds = ids;
    document.getElementById('dlv_date').value = getTodayStr();
    document.getElementById('dlv_method').value = '新竹貨運';
    document.getElementById('dlv_memo').value = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('shipDeliveryModal')).show();
};

window.openShipDeliveryModal = function(idx) {
    currentDeliveryIds = [idx];
    document.getElementById('dlv_date').value = getTodayStr();
    document.getElementById('dlv_method').value = '新竹貨運';
    document.getElementById('dlv_memo').value = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('shipDeliveryModal')).show();
};

window.openEditDeliveryModal = function(idx) {
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if (!d) return;
    currentDeliveryIds = [idx];
    // 使用全域或預設方法確保日期格式正確載入
    document.getElementById('dlv_date').value = (typeof cleanDateStr === 'function') ? cleanDateStr(d.deliveryDate) : getTodayStr();
    document.getElementById('dlv_method').value = d.method || '新竹貨運';
    document.getElementById('dlv_memo').value = d.memo || '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('shipDeliveryModal')).show();
};

window.confirmScheduleDelivery = function() {
    const date = document.getElementById('dlv_date').value;
    const method = document.getElementById('dlv_method').value;
    const memo = document.getElementById('dlv_memo').value.trim();

    if (!date || !method) return alert("送貨日期與送貨方式為必填！");

    currentDeliveryIds.forEach(id => {
        const d = globalDeliveries.find(x => x.rowIdx === id);
        if (d) {
            d.status = '送貨中';
            d.deliveryDate = date;
            d.method = method;
            d.memo = memo;
            
            pushToSyncQueue('updateDeliveryStatus', {
                rowIdx: id, status: '送貨中', deliveryDate: date, method: method, memo: memo
            }, null);
        }
    });

    window.renderDeliveryList();
    bootstrap.Modal.getInstance(document.getElementById('shipDeliveryModal')).hide();
    showToast("🚚 送貨單已成功排程進入【送貨中】階段！");
};

window.revertDelivery = function(idx) {
    if (!confirm("確定要將這筆紀錄退回至「待送貨」嗎？")) return;
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if (d) {
        d.status = '待送貨';
        pushToSyncQueue('revertDelivery', { rowIdx: idx }, null);
        window.renderDeliveryList();
        showToast("🔙 已成功退回至待排程狀態！");
    }
};

// ============================================================================
// 一比一 A5 橫式送貨單列印系統
// ============================================================================
window.generateDeliveryPrintHtml = function(d) {
    // 智慧解析明細字串 (提取品名、數量、批號)
    let itemName = d.itemsStr;
    let qty = 0; let lot = '';
    const match = d.itemsStr.match(/^(.*?)\s+x([\d.]+)\s+\(批號:\s*(.+?)\)$/);
    if (match) {
        itemName = match[1];
        qty = parseFloat(match[2]);
        lot = match[3];
    }

    // 從型錄找出內部代號與單價
    const p = globalCatalog.find(x => x.clientName === d.client && x.productName === itemName);
    let intCode = p ? (p.internalCode || p.assetCode || '') : '';
    let price = p ? (parseFloat(p.price) || 0) : 0;
    let subtotal = price * qty;

    // 日期處理：安全防護確保畫面不會壞掉
    let rawDate = d.deliveryDate;
    let cleanD = (typeof cleanDateStr === 'function') ? cleanDateStr(rawDate) : rawDate;
    const dateStr = (cleanD || getTodayStr()).split('-'); // [YYYY, MM, DD]

    let tbody = `
        <tr>
            <td style="border: 1px solid #000; padding: 10px; text-align: center; height: 35px;">${escapeQuotes(intCode)}</td>
            <td style="border: 1px solid #000; padding: 10px; text-align: left;">${escapeQuotes(itemName)} <span style="font-size:12px; color:#555;">(批號: ${escapeQuotes(lot)})</span></td>
            <td style="border: 1px solid #000; padding: 10px; text-align: center;">${qty}</td>
            <td style="border: 1px solid #000; padding: 10px; text-align: right;">${price > 0 ? Number(price).toLocaleString() : ''}</td>
            <td style="border: 1px solid #000; padding: 10px; text-align: right;">${subtotal > 0 ? Number(subtotal).toLocaleString() : ''}</td>
            <td style="border: 1px solid #000; padding: 10px;"></td>
        </tr>
    `;
    // 補齊剩餘的空白行維持版面美觀
    for(let i=0; i<4; i++) {
        tbody += `<tr><td style="border: 1px solid #000; height: 35px;"></td><td style="border: 1px solid #000;"></td><td style="border: 1px solid #000;"></td><td style="border: 1px solid #000;"></td><td style="border: 1px solid #000;"></td><td style="border: 1px solid #000;"></td></tr>`;
    }

    return `
        <div style="max-width: 850px; margin: 0 auto; background: #fff; padding: 10mm 15mm; box-sizing: border-box; font-family: 'MingLiU', '微軟正黑體', serif; color: #000; position: relative;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="margin: 0; font-weight: bold; letter-spacing: 5px; font-size: 26px;">長固實業有限公司</h2>
                <div style="font-size: 28px; font-weight: bold; letter-spacing: 15px; text-decoration: underline; margin-top: 5px; text-underline-offset: 6px;">送貨單</div>
            </div>
            
            <div style="position: absolute; right: 20mm; top: 18mm; font-size: 16px; font-weight: bold;">
                No. <span style="color: #d32f2f; font-size: 20px;">${String(d.rowIdx).slice(-5)}</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px; font-size: 16px;">
                <div style="font-weight: bold;">客戶名稱：<span style="border-bottom: 1px solid #000; padding: 0 10px; min-width: 250px; display: inline-block;">${escapeQuotes(d.client)}</span></div>
                <div style="font-weight: bold;">
                    <span style="display:inline-block; width: 40px; text-align:center;">${dateStr[0]||' '}</span> 年
                    <span style="display:inline-block; width: 30px; text-align:center;">${dateStr[1]||' '}</span> 月
                    <span style="display:inline-block; width: 30px; text-align:center;">${dateStr[2]||' '}</span> 日
                </div>
            </div>

            <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; font-size: 15px;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 8px; width: 12%; text-align: center;">編 號</th>
                        <th style="border: 1px solid #000; padding: 8px; width: 35%; text-align: center;">品 名 規 格</th>
                        <th style="border: 1px solid #000; padding: 8px; width: 8%; text-align: center;">數 量</th>
                        <th style="border: 1px solid #000; padding: 8px; width: 12%; text-align: center;">單 價</th>
                        <th style="border: 1px solid #000; padding: 8px; width: 13%; text-align: center;">金 額</th>
                        <th style="border: 1px solid #000; padding: 8px; width: 20%; text-align: center;">客 戶 簽 收</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbody}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="border: 1px solid #000; padding: 10px; border-right: none;">
                            發票編號： ${escapeQuotes(d.paperNos)}
                        </td>
                        <td colspan="2" style="border: 1px solid #000; padding: 10px; border-left: none; text-align: right; font-weight: bold;">
                            總 計 新 台 幣
                        </td>
                        <td style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">
                            ${subtotal > 0 ? Number(subtotal).toLocaleString() : ''}
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
};

window.printDeliveryNoteDoc = function(idx) {
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if (!d) return;
    
    const area = document.getElementById('printDeliveryArea');
    area.innerHTML = window.generateDeliveryPrintHtml(d);
    if (typeof window.applyPrintStyle === 'function') window.applyPrintStyle('A5', 'landscape');
    if (typeof window.showPrintPreview === 'function') window.showPrintPreview('printDeliveryArea');
};

// ============================================================================
// 手機與平板專用：電子簽收畫布系統
// ============================================================================
window.openSignDeliveryModal = function(idx) {
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if (!d) return;
    
    document.getElementById('sign_rowIdx').value = idx;
    
    // 渲染送貨單的迷你預覽圖，讓客戶簽名前再次確認
    const previewContainer = document.getElementById('sign_previewArea');
    previewContainer.innerHTML = `<div style="transform: scale(0.65); transform-origin: top left; width: 153%;">${window.generateDeliveryPrintHtml(d)}</div>`;
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('signDeliveryModal')).show();
    
    // 初始化 SignaturePad 畫布套件
    setTimeout(() => {
        const canvas = document.getElementById('signaturePad');
        if (canvas) {
            const ratio =  Math.max(window.devicePixelRatio || 1, 1);
            canvas.width = canvas.offsetWidth * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext("2d").scale(ratio, ratio);
            
            if (!signaturePadInstance) {
                signaturePadInstance = new SignaturePad(canvas, {
                    penColor: "rgb(0, 0, 100)", // 深藍色墨水感
                    backgroundColor: "rgba(255, 255, 255, 0)" // 透明背景
                });
            }
            signaturePadInstance.clear();
        }
    }, 300);
};

window.clearSignature = function() {
    if (signaturePadInstance) signaturePadInstance.clear();
};

window.confirmSignatureAndClose = function() {
    if (!signaturePadInstance || signaturePadInstance.isEmpty()) {
        return alert("⚠️ 請引導客戶在下方白色區塊內進行手寫簽名！");
    }
    
    const idx = parseInt(document.getElementById('sign_rowIdx').value);
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if (!d) return;
    
    // 擷取簽名軌跡轉為 Base64 圖檔
    const base64Str = signaturePadInstance.toDataURL("image/png");
    
    showLoading("儲存電子簽名並上傳至雲端中...");
    
    // 樂觀更新狀態，讓畫面瞬間轉換
    d.status = '已結案';
    d.signatureUrl = '#'; // 暫時給一個 Loading 標示
    
    pushToSyncQueue('updateDeliveryStatus', {
        rowIdx: idx, status: '已結案', signBase64: base64Str
    }, null);
    
    window.renderDeliveryList();
    bootstrap.Modal.getInstance(document.getElementById('signDeliveryModal')).hide();
    hideLoading();
    showToast("✅ 客戶簽收成功！圖檔正在背景安全上傳，送貨單已結案。");
};
