/**
 * ============================================================================
 * 模組 6：送貨與電子簽收模組 (module_delivery.js) - 【已連動修復版】
 * ============================================================================
 */

let deliverySearchText = "";
let groupDeliverySelection = new Set();
let signaturePadInstance = null;

// ============================================================================
// 列表渲染
// ============================================================================
window.renderDeliveryList = debounce(function() {
    deliverySearchText = document.getElementById('delSearchInput').value.trim().toLowerCase();
    const pendC = document.getElementById('delPendingListContainer');
    const compC = document.getElementById('delCompletedListContainer');
    
    const fMethod = document.getElementById('delFilterMethod').value;
    const fStatus = document.getElementById('delFilterStatus').value;
    
    let pendHTML = ""; let compHTML = "";
    
    globalDeliveries.forEach(d => {
        let match = true;
        
        if (fMethod && d.deliveryMethod !== fMethod) match = false;
        if (fStatus && d.status !== fStatus) match = false;
        
        let itemsText = "";
        try {
            let items = JSON.parse(d.itemsStr || '[]');
            itemsText = items.map(i => i.name).join(" ");
        } catch(e){}
        
        if (deliverySearchText && match) {
            const str = `${d.client} ${d.paperNo} ${d.orderNo} ${itemsText} ${d.memo}`.toLowerCase();
            if (!str.includes(deliverySearchText)) match = false;
        }
        
        if (match) {
            let card = buildDeliveryCard(d);
            if (d.status === '待送貨') pendHTML += card;
            else compHTML += card;
        }
    });
    
    pendC.innerHTML = pendHTML || '<div class="text-center text-muted py-4">無待送貨紀錄</div>';
    compC.innerHTML = compHTML || '<div class="text-center text-muted py-4">無已送貨/已結案紀錄</div>';
}, 300);

function buildDeliveryCard(d) {
    let badgeClass = "bg-warning text-dark";
    if (d.status === '已送貨') badgeClass = "bg-primary";
    else if (d.status === '已結案') badgeClass = "bg-success";
    
    let items = [];
    try { items = JSON.parse(d.itemsStr || '[]'); } catch(e){}
    
    const isPending = d.status === '待送貨';
    const checked = groupDeliverySelection.has(d.rowIdx) ? 'checked' : '';
    const checkboxHtml = isPending ? `<input class="form-check-input me-2 mt-1 cb-del-merge" type="checkbox" value="${d.rowIdx}" ${checked} onchange="toggleDeliverySelect(${d.rowIdx}, this.checked)" style="transform: scale(1.3);">` : '';
    
    let actionButtons = "";
    if (isPending) {
        actionButtons = `<button class="btn btn-sm btn-outline-primary fw-bold" onclick="printDeliveryNote(${d.rowIdx})">🖨️ 印送貨單</button>`;
    } else if (d.status === '已送貨') {
        actionButtons = `
            <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="printDeliveryNote(${d.rowIdx})">🖨️</button>
            <button class="btn btn-sm btn-outline-warning fw-bold ms-1" onclick="returnToPending(${d.rowIdx})">🔙 退回</button>
            <button class="btn btn-sm btn-success fw-bold ms-1" onclick="openSignatureModal(${d.rowIdx})">✍️ 結案簽收</button>
        `;
    } else { // 已結案
        actionButtons = `
            <span class="text-success small fw-bold me-2">✅ 已完成簽收</span>
            <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="printDeliveryNote(${d.rowIdx})">📄 檢視單據</button>
        `;
    }

    return `
    <div class="card mb-2 border-0 shadow-sm">
        <div class="card-body p-3">
            <div class="d-flex justify-content-between mb-2">
                <div class="d-flex align-items-start">
                    ${checkboxHtml}
                    <div>
                        <div class="fw-bold fs-6 text-dark">${escapeQuotes(d.client)}</div>
                        <div class="small text-muted">發票: ${d.paperNo || '無'} | 訂單: ${d.orderNo || '無'}</div>
                    </div>
                </div>
                <div class="text-end">
                    <span class="badge ${badgeClass} mb-1">${d.status}</span>
                </div>
            </div>
            
            <div class="small text-secondary mb-2 ms-${isPending ? '4' : '0'} bg-light p-2 rounded">
                ${items.map(i => `• ${escapeQuotes(i.name)} <strong>x ${i.qty}</strong>${i.lot ? `(批:${i.lot})` : ''}`).join('<br>')}
            </div>
            
            ${d.deliveryDate ? `<div class="small text-primary fw-bold ms-${isPending ? '4' : '0'} mb-2">🚚 ${d.deliveryMethod} (${d.deliveryDate})${d.memo ? `- ${escapeQuotes(d.memo)}` : ''}</div>` : ''}
            
            <div class="d-flex justify-content-end align-items-center mt-2 pt-2 border-top">
                <div class="btn-group">${actionButtons}</div>
            </div>
        </div>
    </div>`;
}

// ============================================================================
// 批次操作與狀態變更
// ============================================================================
window.toggleDeliverySelect = function(rowIdx, isChecked) {
    if (isChecked) groupDeliverySelection.add(rowIdx);
    else groupDeliverySelection.delete(rowIdx);
};

window.groupExecuteDelivery = function() {
    if (groupDeliverySelection.size === 0) return alert("請勾選至少一筆待送貨的資料！");
    document.getElementById('da_rowIndices').value = JSON.stringify(Array.from(groupDeliverySelection));
    document.getElementById('da_date').value = getTodayStr();
    document.getElementById('da_method').value = "";
    document.getElementById('da_memo').value = "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById('deliveryActionModal')).show();
};

window.confirmDeliveryAction = function() {
    const rowIndices = JSON.parse(document.getElementById('da_rowIndices').value || '[]');
    const dDate = document.getElementById('da_date').value;
    const dMethod = document.getElementById('da_method').value;
    const dMemo = document.getElementById('da_memo').value.trim();
    
    if(!dDate || !dMethod) return alert("請填寫送貨日期與送貨方式！");
    
    pushToSyncQueue('batchExecuteDeliveries', {
        rowIndices: rowIndices, date: dDate, method: dMethod, memo: dMemo, staff: myName
    });
    
    groupDeliverySelection.clear();
    bootstrap.Modal.getInstance(document.getElementById('deliveryActionModal')).hide();
    renderDeliveryList();
    showToast(`🚚 ${rowIndices.length} 筆已移至已送貨區`);
};

// ============================================================================
// 解決問題 5：全新作廢註銷邏輯 (連動註銷發票)
// ============================================================================
window.groupVoidDeliveryAndInvoice = function() {
    if (groupDeliverySelection.size === 0) return alert("請先勾選要作廢註銷的送貨單！");
    if (!confirm(`⚠️ 嚴重警告 ⚠️\n您確定要作廢這 ${groupDeliverySelection.size} 筆送貨單嗎？\n\n系統將會「同步作廢」它所屬的發票。\n(注意：作廢後庫存不會自動退回，請至庫存異動手動退庫)`)) return;
    
    const rowIndices = Array.from(groupDeliverySelection);
    pushToSyncQueue('voidDeliveryAndInvoice', { rowIndices: rowIndices });
    
    groupDeliverySelection.clear();
    renderDeliveryList();
    showToast(`🗑️ 送貨單與關聯發票作廢指令已送出`);
};

window.returnToPending = function(rowIdx) {
    if(!confirm("確定要將這筆取消送貨，退回「待送貨」狀態嗎？")) return;
    pushToSyncQueue('updateDeliveryStatus', { action: 'return', rowIdx: rowIdx });
    renderDeliveryList();
    showToast("🔙 已退回待送貨");
};

// ============================================================================
// 送貨單列印
// ============================================================================
window.printDeliveryNote = function(rowIdx) {
    const d = globalDeliveries.find(x => x.rowIdx === rowIdx);
    if (!d) return;
    
    const printArea = document.getElementById('printDeliveryArea');
    if(!printArea) return;
    applyPrintStyle('A5', 'landscape');
    
    let items = [];
    try { items = JSON.parse(d.itemsStr || '[]'); } catch(e){}
    
    let tbodyHtml = items.map((item, idx) => `
        <tr>
            <td style="padding: 8px; text-align: center;">${idx+1}</td>
            <td style="padding: 8px; text-align: left;">${escapeQuotes(item.name)}</td>
            <td style="padding: 8px; text-align: center;">${item.qty}</td>
            <td style="padding: 8px; text-align: center;">${escapeQuotes(item.lot || '')}</td>
            <td style="padding: 8px; border-right: none;"></td>
        </tr>
    `).join('');
    
    let signImageHtml = d.signature ? `<img src="${d.signature}" style="max-width: 200px; max-height: 80px;">` : `<div style="height: 60px;"></div>`;
    
    let html = `
    <div style="width: 210mm; min-height: 148mm; padding: 10mm; background: #fff; margin: 0 auto; box-sizing: border-box; font-family: '微軟正黑體', sans-serif; color: #000; position: relative;">
        <h2 style="text-align: center; font-weight: bold; letter-spacing: 10px; margin-bottom: 20px;">出貨/送貨單</h2>
        
        <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 15px;">
            <div style="line-height: 1.8;">
                <div>客戶名稱：<span style="font-size: 16px; font-weight: bold;">${escapeQuotes(d.client)}</span></div>
                <div>聯絡電話：_____________________</div>
                <div>送貨地址：___________________________________________</div>
            </div>
            <div style="line-height: 1.8; text-align: right;">
                <div>送貨單號：${d.paperNo || '無'}</div>
                <div>訂單編號：${d.orderNo || '無'}</div>
                <div>列印日期：${getTodayStr()}</div>
            </div>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px; border: 2px solid #000;">
            <thead>
                <tr style="border-bottom: 2px solid #000;">
                    <th style="padding: 8px; text-align: center; width: 8%; border-right: 1px solid #000;">項次</th>
                    <th style="padding: 8px; text-align: left; width: 45%; border-right: 1px solid #000;">品名規格</th>
                    <th style="padding: 8px; text-align: center; width: 12%; border-right: 1px solid #000;">數量</th>
                    <th style="padding: 8px; text-align: center; width: 15%; border-right: 1px solid #000;">批號</th>
                    <th style="padding: 8px; text-align: center; width: 20%;">備註</th>
                </tr>
            </thead>
            <tbody>
                ${tbodyHtml}
            </tbody>
        </table>
        
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px;">
            <div style="font-size: 13px;">
                <div>🚚 配送方式：${d.deliveryMethod || '未指定'}</div>
                <div>📅 配送日期：${d.deliveryDate || '未指定'}</div>
            </div>
            <div style="text-align: center; width: 250px;">
                <div style="border-bottom: 1px solid #000; margin-bottom: 5px;">
                    ${signImageHtml}
                </div>
                <div style="font-weight: bold; font-size: 14px;">客戶簽收處 (Sign Here)</div>
            </div>
        </div>
    </div>`;
    
    printArea.innerHTML = html;
    showPrintPreview('printDeliveryArea');
};

// ============================================================================
// 電子簽收 (Canvas)
// ============================================================================
window.openSignatureModal = function(rowIdx) {
    document.getElementById('ds_rowIdx').value = rowIdx;
    
    const d = globalDeliveries.find(x => x.rowIdx === rowIdx);
    if(d) {
        let items = [];
        try { items = JSON.parse(d.itemsStr || '[]'); } catch(e){}
        let miniHtml = `<div class="fw-bold mb-2 text-primary">客戶：${escapeQuotes(d.client)}</div>`;
        miniHtml += items.map(i => `<div class="small">• ${escapeQuotes(i.name)} x ${i.qty}</div>`).join('');
        document.getElementById('ds_previewContainer').innerHTML = miniHtml;
    }
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('deliverySignModal')).show();
    
    setTimeout(() => {
        const canvas = document.getElementById('signaturePad');
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext("2d").scale(ratio, ratio);
        
        if (!signaturePadInstance) {
            initSignaturePad(canvas);
        } else {
            signaturePadInstance.clear();
        }
    }, 300);
};

let isDrawing = false;
let ctx = null;

function initSignaturePad(canvas) {
    ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const start = (e) => { e.preventDefault(); isDrawing = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); };
    const move = (e) => { e.preventDefault(); if (!isDrawing) return; const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); };
    const end = (e) => { e.preventDefault(); isDrawing = false; };

    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); canvas.addEventListener('mouseup', end); canvas.addEventListener('mouseout', end);
    canvas.addEventListener('touchstart', start, {passive: false}); canvas.addEventListener('touchmove', move, {passive: false}); canvas.addEventListener('touchend', end);
    signaturePadInstance = { clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); } };
}

window.clearSignature = function() {
    if(signaturePadInstance) signaturePadInstance.clear();
};

window.confirmSignature = function() {
    const canvas = document.getElementById('signaturePad');
    
    const blank = document.createElement('canvas');
    blank.width = canvas.width; blank.height = canvas.height;
    if(canvas.toDataURL() === blank.toDataURL()) return alert("請先完成簽名！");

    const signatureData = canvas.toDataURL('image/png');
    const rowIdx = Number(document.getElementById('ds_rowIdx').value);
    
    pushToSyncQueue('updateDeliveryStatus', { action: 'sign', rowIdx: rowIdx, signatureData: signatureData });
    
    bootstrap.Modal.getInstance(document.getElementById('deliverySignModal')).hide();
    renderDeliveryList();
    showToast("✅ 簽收完成，案件已結案！");
};
