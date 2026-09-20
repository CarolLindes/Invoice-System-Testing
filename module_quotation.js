/**
 * ============================================================================
 * 模組 5：估價單管理 (module_quotation.js) - 【含申請單位與 PDF 分享】
 * ============================================================================
 */

let quoSearchText = "";
let groupMergeQuoSelection = new Set();
let quoClientMapForSearch = {};
let quoItemSearchData = [];

window.renderQuotationList = debounce(function() {
    quoSearchText = document.getElementById('quoSearchInput').value.trim().toLowerCase();
    const pendC = document.getElementById('quoPendingListContainer');
    const verC = document.getElementById('quoVerifiedListContainer');
    
    let pendHTML = ""; let verHTML = "";
    
    // 用 merge_id 來分群
    let groups = {};
    let noGroups = [];
    
    globalQuotes.forEach(q => {
        let match = true;
        if (quoSearchText) {
            let itemText = "";
            try {
                let items = JSON.parse(q.jsonStr || '[]');
                itemText = items.map(i => `${i.name} ${i.internalCode}`).join(" ");
            } catch(e){}
            const searchStr = `${q.quoteNo} ${q.client} ${itemText} ${q.memo} ${q.staff}`.toLowerCase();
            if (!searchStr.includes(quoSearchText)) match = false;
        }
        
        if (match) {
            if (q.mergeId) {
                if (!groups[q.mergeId]) groups[q.mergeId] = [];
                groups[q.mergeId].push(q);
            } else {
                noGroups.push(q);
            }
        }
    });

    // 處理已合併群組
    for (let mId in groups) {
        let arr = groups[mId];
        // 群組狀態由內部成員決定：若全為已核銷/歷史則歸類為 verified，否則為 pending
        let isAllVerified = arr.every(q => q.status !== '待確認' && q.status !== '處理中');
        let groupHTML = `
        <div class="card mb-3 border-secondary shadow-sm">
            <div class="card-header bg-light d-flex justify-content-between align-items-center">
                <div class="fw-bold text-secondary">🔗 合併估價單群組</div>
                <div>
                    <span class="badge bg-secondary me-2">共 ${arr.length} 筆</span>
                    <button class="btn btn-sm btn-outline-primary fw-bold" onclick="printMergedQuotation('${mId}')">🖨️ 合併列印</button>
                    ${!isAllVerified ? `<button class="btn btn-sm btn-success fw-bold ms-2" onclick="convertMergedToOrder('${mId}')">✅ 轉訂單/發票</button>` : ''}
                </div>
            </div>
            <div class="card-body p-2">
                ${arr.map(q => buildQuoCard(q, true)).join('')}
            </div>
        </div>`;
        if (isAllVerified) verHTML += groupHTML;
        else pendHTML += groupHTML;
    }

    // 處理未合併單筆
    noGroups.forEach(q => {
        let card = buildQuoCard(q, false);
        if (q.status === '待確認' || q.status === '處理中') pendHTML += card;
        else verHTML += card;
    });

    pendC.innerHTML = pendHTML || '<div class="text-center text-muted py-3">無符合的待確認估價單</div>';
    verC.innerHTML = verHTML || '<div class="text-center text-muted py-3">無符合的歷史估價單</div>';
}, 300);

function buildQuoCard(q, isGrouped) {
    let items = [];
    try { items = JSON.parse(q.jsonStr || '[]'); } catch(e){}
    let total = items.reduce((sum, item) => sum + (Number(item.qty)*Number(item.price)), 0);
    let dateStr = q.quoteDate;
    
    let badgeClass = "bg-warning text-dark";
    if (q.status === '已核銷轉單') badgeClass = "bg-success";
    else if (q.status === '已作廢') badgeClass = "bg-danger";
    
    const checked = groupMergeQuoSelection.has(q.rowIdx) ? 'checked' : '';
    const checkboxHtml = isGrouped ? '' : `<input class="form-check-input me-2 mt-1 cb-quo-merge" type="checkbox" value="${q.rowIdx}" ${checked} onchange="toggleQuoMergeSelect(${q.rowIdx}, this.checked)" style="transform: scale(1.3);">`;

    return `
    <div class="card mb-2 border-0 shadow-sm" style="${isGrouped ? 'background-color: #f8f9fa;' : ''}">
        <div class="card-body p-3">
            <div class="d-flex justify-content-between mb-2">
                <div class="d-flex align-items-start">
                    ${checkboxHtml}
                    <div>
                        <div class="fw-bold fs-6 text-dark">${escapeQuotes(q.client)}</div>
                        <div class="small text-muted">${q.quoteNo || '未編號'} | 👨‍💼 ${q.staff}</div>
                    </div>
                </div>
                <div class="text-end">
                    <span class="badge ${badgeClass} mb-1">${q.status}</span>
                    <div class="text-primary fw-bold">$${Math.round(total).toLocaleString()}</div>
                </div>
            </div>
            
            <div class="small text-secondary mb-2 ms-${isGrouped ? '0' : '4'}">
                ${items.map(i => `• ${escapeQuotes(i.name)} x${i.qty}`).join('<br>')}
            </div>
            
            <div class="d-flex justify-content-between align-items-center ms-${isGrouped ? '0' : '4'} mt-2 pt-2 border-top">
                <span class="small text-muted">📅 ${dateStr}</span>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="printSingleQuotation(${q.rowIdx})">🖨️ 列印</button>
                    ${(q.status === '待確認' || q.status === '處理中') ? `
                        <button class="btn btn-sm btn-outline-primary fw-bold" onclick="openQuotationModal(${q.rowIdx})">✏️ 編輯</button>
                        <button class="btn btn-sm btn-outline-danger fw-bold" onclick="openVoidQuotationItemsModal(${q.rowIdx})">✂️ 作廢</button>
                        ${!isGrouped ? `<button class="btn btn-sm btn-outline-success fw-bold" onclick="convertSingleToOrder(${q.rowIdx})">✅ 核銷</button>` : ''}
                    ` : ''}
                </div>
            </div>
        </div>
    </div>`;
}

// ============================================================================
// 批次合併邏輯
// ============================================================================
window.toggleQuoMergeSelect = function(rowIdx, isChecked) {
    if (isChecked) groupMergeQuoSelection.add(rowIdx);
    else groupMergeQuoSelection.delete(rowIdx);
};

window.groupMergeQuotations = function() {
    if (groupMergeQuoSelection.size < 2) return alert("請至少勾選兩筆估價單進行合併。");
    
    let clients = new Set();
    let selectedQuotes = [];
    groupMergeQuoSelection.forEach(id => {
        let q = globalQuotes.find(x => x.rowIdx === id);
        if(q) {
            clients.add(q.client);
            selectedQuotes.push(q);
        }
    });
    
    if (clients.size > 1) return alert("⚠️ 只能合併「相同客戶」的估價單！");
    if (!confirm(`確定要將這 ${groupMergeQuoSelection.size} 筆估價單綁定為同一群組嗎？\n(合併後列印與轉單將會同時執行)`)) return;
    
    const newMergeId = 'M_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const rowIndices = Array.from(groupMergeQuoSelection);
    
    rowIndices.forEach(id => {
        let q = globalQuotes.find(x => x.rowIdx === id);
        if(q) Object.assign(q, {mergeId: newMergeId});
    });
    
    pushToSyncQueue('mergeQuotations', { rowIndices: rowIndices, mergeId: newMergeId });
    groupMergeQuoSelection.clear();
    renderQuotationList();
    showToast("🔗 已綁定為合併估價單");
};

window.groupUnmergeQuotations = function() {
    if (groupMergeQuoSelection.size === 0) return alert("請勾選要解除合併的估價單 (可單筆勾選)。");
    if (!confirm("確定要將勾選的估價單從群組中解除綁定嗎？\n(解除後將恢復為獨立單據)")) return;
    
    const rowIndices = Array.from(groupMergeQuoSelection);
    rowIndices.forEach(id => {
        let q = globalQuotes.find(x => x.rowIdx === id);
        if(q) Object.assign(q, {mergeId: ''});
    });
    
    pushToSyncQueue('unmergeQuotations', { rowIndices: rowIndices });
    groupMergeQuoSelection.clear();
    renderQuotationList();
    showToast("✂️ 已解除合併綁定");
};

// ============================================================================
// 手動建立/編輯估價單 (支援申請單位)
// ============================================================================
window.openQuotationModal = function(rowIdx) {
    currentQuoItems = [];
    if (rowIdx) {
        const q = globalQuotes.find(x => x.rowIdx === rowIdx);
        if (!q) return;
        document.getElementById('e_quoRow').value = q.rowIdx;
        document.getElementById('e_quoDate').value = q.quoteDate || getTodayStr();
        document.getElementById('e_quoNo').value = q.quoteNo || '';
        document.getElementById('e_quoClient').value = q.client || '';
        document.getElementById('e_quoMemo').value = q.memo || '';
        document.getElementById('e_quoUseSeal').checked = q.useSeal !== false;
        
        // 嘗試自動反查該客戶的申請單位 (讀取 client 表)
        let deptVal = "";
        let cInfo = globalClients.find(c => c.name === q.client);
        if(cInfo && cInfo.receiveDept) {
             let depts = cInfo.receiveDept.split(/,|\n/).map(s=>s.trim()).filter(s=>s);
             if(depts.length > 0) deptVal = depts[0]; // 預設帶入第一個
        }
        document.getElementById('e_quoDept').value = deptVal;
        
        try { currentQuoItems = JSON.parse(q.jsonStr || '[]'); } catch(e){}
    } else {
        document.getElementById('e_quoRow').value = "";
        document.getElementById('e_quoDate').value = getTodayStr();
        document.getElementById('e_quoNo').value = "";
        document.getElementById('e_quoClient').value = "";
        document.getElementById('e_quoDept').value = "";
        document.getElementById('e_quoMemo').value = "";
        document.getElementById('e_quoUseSeal').checked = true;
        currentQuoItems = [{ id: Date.now().toString(), name: '', internalCode: '', qty: 1, unit: '式', price: 0 }];
    }
    
    quoClientMapForSearch = {};
    globalClients.forEach(c => quoClientMapForSearch[c.name] = c);
    
    reRenderQuotationItems();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editQuoModal')).show();
};

window.selectClientForQuotation = function(clientName) {
    document.getElementById('e_quoClient').value = clientName;
    
    // 自動帶入申請單位
    let cInfo = globalClients.find(c => c.name === clientName);
    if(cInfo && cInfo.receiveDept) {
         let depts = cInfo.receiveDept.split(/,|\n/).map(s=>s.trim()).filter(s=>s);
         if(depts.length > 0) document.getElementById('e_quoDept').value = depts[0];
    }
    
    bootstrap.Modal.getInstance(document.getElementById('searchModal')).hide();
    
    quoItemSearchData = globalCatalog.filter(x => x.clientName === clientName);
    currentQuoItems.forEach(item => {
        let match = quoItemSearchData.find(x => x.productName === item.name);
        if (match && item.price === 0) item.price = match.price;
    });
    reRenderQuotationItems();
};

window.addQuotationManualItemRow = function() {
    currentQuoItems.push({ id: Date.now().toString(), name: '', internalCode: '', qty: 1, unit: '式', price: 0 });
    reRenderQuotationItems();
};

window.removeQuotationItem = function(id) {
    currentQuoItems = currentQuoItems.filter(x => x.id !== id);
    reRenderQuotationItems();
};

window.reRenderQuotationItems = function() {
    const container = document.getElementById('e_quoItemsContainer');
    const clientName = document.getElementById('e_quoClient').value;
    
    if(!quoItemSearchData.length && clientName) {
         quoItemSearchData = globalCatalog.filter(x => x.clientName === clientName);
    }

    container.innerHTML = currentQuoItems.map((item, index) => {
        let optionsHtml = quoItemSearchData.map(c => `<option value="${escapeQuotes(c.productName)}" data-code="${escapeQuotes(c.internalCode)}" data-price="${c.price}" data-unit="${escapeQuotes(c.unit)}">`).join('');
        return `
        <div class="row g-2 mb-2 align-items-end draggable-row bg-white p-2 border rounded shadow-sm" draggable="true" ondragstart="handleDragStart(event, '${item.id}', 'quotation')" ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${item.id}', 'quotation')">
            <div class="col-1 text-center" style="cursor: grab; color: #adb5bd; padding-bottom: 8px;">☰</div>
            <div class="col-1 text-center"><span class="badge bg-secondary">${index + 1}</span></div>
            <div class="col-4">
                <label class="small text-muted fw-bold">品名</label>
                <input type="text" class="form-control fw-bold" value="${escapeQuotes(item.name)}" list="dl_quo_${item.id}" onchange="updateQuoItemAuto(this, '${item.id}')">
                <datalist id="dl_quo_${item.id}">${optionsHtml}</datalist>
            </div>
            <div class="col-2">
                <label class="small text-muted fw-bold">長固代號</label>
                <input type="text" class="form-control" value="${escapeQuotes(item.internalCode)}" oninput="updateQuoItemVal('${item.id}', 'internalCode', this.value)">
            </div>
            <div class="col-1">
                <label class="small text-muted fw-bold">數量</label>
                <input type="number" class="form-control fw-bold text-primary" value="${item.qty}" min="0.1" step="any" oninput="updateQuoItemVal('${item.id}', 'qty', this.value)">
            </div>
            <div class="col-1">
                <label class="small text-muted fw-bold">單位</label>
                <input type="text" class="form-control" value="${escapeQuotes(item.unit)}" oninput="updateQuoItemVal('${item.id}', 'unit', this.value)">
            </div>
            <div class="col-1">
                <label class="small text-muted fw-bold">單價</label>
                <input type="number" class="form-control" value="${item.price}" step="any" oninput="updateQuoItemVal('${item.id}', 'price', this.value)">
            </div>
            <div class="col-1 text-end">
                <button class="btn btn-sm btn-outline-danger" onclick="removeQuotationItem('${item.id}')">✖</button>
            </div>
        </div>`;
    }).join('');
};

window.updateQuoItemVal = function(id, field, val) {
    let item = currentQuoItems.find(x => x.id === id);
    if(item) {
        if(field==='qty' || field==='price') item[field] = Number(val) || 0;
        else item[field] = val;
    }
};

window.updateQuoItemAuto = function(inputEl, id) {
    let val = inputEl.value;
    let item = currentQuoItems.find(x => x.id === id);
    if(item) {
        item.name = val;
        let match = quoItemSearchData.find(x => x.productName === val);
        if(match) {
            item.internalCode = match.internalCode || item.internalCode;
            item.price = match.price || item.price;
            item.unit = match.unit || item.unit;
        }
    }
    reRenderQuotationItems();
};

window.saveEditQuotation = function() {
    let clientName = document.getElementById('e_quoClient').value.trim();
    if (!clientName) return alert("請選擇客戶");
    let validItems = currentQuoItems.filter(i => i.name.trim() !== "");
    if (validItems.length === 0) return alert("請至少輸入一項品項");
    
    let deptName = document.getElementById('e_quoDept').value.trim();
    let rowIdx = document.getElementById('e_quoRow').value;
    let payload = {
        rowIdx: rowIdx ? Number(rowIdx) : Date.now(),
        quoteNo: document.getElementById('e_quoNo').value.trim() || 'QUO-' + getTodayStr().replace(/-/g,'') + '-' + Math.floor(Math.random()*1000),
        quoteDate: document.getElementById('e_quoDate').value,
        clientName: clientName,
        deptName: deptName, // 傳送申請單位供後端連動
        items: validItems,
        memo: document.getElementById('e_quoMemo').value.trim(),
        useSeal: document.getElementById('e_quoUseSeal').checked,
        staff: myName,
        status: '待確認'
    };
    
    let existing = globalQuotes.find(x => x.rowIdx === payload.rowIdx);
    if(existing) {
        Object.assign(existing, {
            quoteNo: payload.quoteNo, quoteDate: payload.quoteDate, client: payload.clientName,
            jsonStr: JSON.stringify(payload.items), useSeal: payload.useSeal, memo: payload.memo
        });
        payload.mergeId = existing.mergeId;
    } else {
        globalQuotes.unshift({
            rowIdx: payload.rowIdx, time: Date.now(), quoteNo: payload.quoteNo, quoteDate: payload.quoteDate,
            client: payload.clientName, status: payload.status, jsonStr: JSON.stringify(payload.items),
            useSeal: payload.useSeal, staff: payload.staff, memo: payload.memo, mergeId: ''
        });
    }
    
    pushToSyncQueue('saveQuotation', payload);
    bootstrap.Modal.getInstance(document.getElementById('editQuoModal')).hide();
    renderQuotationList();
    showToast("💾 估價單已儲存");
};

// ============================================================================
// 作廢估價單品項 (拆分)
// ============================================================================
window.openVoidQuotationItemsModal = function(rowIdx) {
    const q = globalQuotes.find(x => x.rowIdx === rowIdx);
    if (!q) return;
    document.getElementById('vq_rowIdx').value = q.rowIdx;
    let items = [];
    try { items = JSON.parse(q.jsonStr || '[]'); } catch(e){}
    
    let html = items.map((i, idx) => `
        <div class="form-check mb-2">
            <input class="form-check-input vq-item-cb" type="checkbox" value="${idx}" id="vq_cb_${idx}" style="transform: scale(1.3); margin-right: 10px;">
            <label class="form-check-label fw-bold" for="vq_cb_${idx}">${escapeQuotes(i.name)} (x${i.qty})</label>
        </div>
    `).join('');
    
    document.getElementById('vq_itemsList').innerHTML = html;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('voidQuoItemsModal')).show();
};

window.confirmVoidQuotationItems = function() {
    let rowIdx = Number(document.getElementById('vq_rowIdx').value);
    const q = globalQuotes.find(x => x.rowIdx === rowIdx);
    if (!q) return;
    
    let checkboxes = document.querySelectorAll('.vq-item-cb');
    let toVoidIndices = [];
    checkboxes.forEach(cb => { if(cb.checked) toVoidIndices.push(Number(cb.value)); });
    
    if (toVoidIndices.length === 0) return alert("請勾選要作廢的品項");
    
    let items = [];
    try { items = JSON.parse(q.jsonStr || '[]'); } catch(e){}
    
    if (toVoidIndices.length === items.length) {
        if(!confirm("您勾選了所有品項，這將會直接把整張估價單標記為「已作廢」。確定嗎？")) return;
        q.status = '已作廢';
        pushToSyncQueue('updateQuotationStatus', { rowIdx: q.rowIdx, status: '已作廢' });
    } else {
        let keepItems = []; let voidItems = [];
        items.forEach((item, idx) => {
            if (toVoidIndices.includes(idx)) voidItems.push(item);
            else keepItems.push(item);
        });
        
        q.jsonStr = JSON.stringify(keepItems);
        let newVoidQ = {
            rowIdx: Date.now(), time: Date.now(), quoteNo: q.quoteNo + '-V', quoteDate: q.quoteDate,
            client: q.client, status: '已作廢', jsonStr: JSON.stringify(voidItems),
            useSeal: q.useSeal, staff: q.staff, memo: q.memo + ' (部份作廢拆分)', mergeId: ''
        };
        globalQuotes.unshift(newVoidQ);
        
        pushToSyncQueue('splitAndVoidQuotationItems', {
            originalRowIdx: q.rowIdx, keepItems: keepItems, voidQuoteData: newVoidQ
        });
        showToast("✂️ 已拆分作廢品項");
    }
    
    bootstrap.Modal.getInstance(document.getElementById('voidQuoItemsModal')).hide();
    renderQuotationList();
};

// ============================================================================
// 轉單 (核銷估價單轉發票與訂貨)
// ============================================================================
window.convertSingleToOrder = function(rowIdx) {
    const q = globalQuotes.find(x => x.rowIdx === rowIdx);
    if(!q) return;
    if(!confirm(`確定要將估價單 ${q.quoteNo || ''} 核銷轉入訂單系統嗎？\n(轉單後將無法再修改此估價單)`)) return;
    executeConvert([q]);
};

window.convertMergedToOrder = function(mergeId) {
    const qs = globalQuotes.filter(x => x.mergeId === mergeId && (x.status === '待確認' || x.status === '處理中'));
    if(qs.length === 0) return alert("此群組中沒有可轉單的估價單。");
    if(!confirm(`確定要將這 ${qs.length} 筆估價單合併轉入訂單系統嗎？`)) return;
    executeConvert(qs);
};

function executeConvert(quoteArr) {
    let allItems = [];
    let clientName = quoteArr[0].client;
    let memoLines = [];
    
    quoteArr.forEach(q => {
        q.status = '已核銷轉單';
        pushToSyncQueue('updateQuotationStatus', { rowIdx: q.rowIdx, status: '已核銷轉單' });
        try {
            let items = JSON.parse(q.jsonStr || '[]');
            items.forEach(i => allItems.push(i));
        } catch(e){}
        if(q.quoteNo) memoLines.push(q.quoteNo);
    });
    
    let deptVal = "";
    let cInfo = globalClients.find(c => c.name === clientName);
    if(cInfo && cInfo.receiveDept) {
         let depts = cInfo.receiveDept.split(/,|\n/).map(s=>s.trim()).filter(s=>s);
         if(depts.length > 0) deptVal = depts[0];
    }
    
    let newOrderPayload = {
        rowIdx: Date.now(),
        clientName: clientName,
        orderNo: memoLines.join(', '),
        department: deptVal,
        deadline: '',
        source: '估價轉單',
        mailUrl: '',
        status: '未結案',
        items: allItems
    };
    
    globalOrders.unshift({
        rowIdx: newOrderPayload.rowIdx, time: Date.now(), client: newOrderPayload.clientName,
        orderNo: newOrderPayload.orderNo, dept: newOrderPayload.department, status: newOrderPayload.status,
        jsonStr: JSON.stringify(newOrderPayload.items), deadline: newOrderPayload.deadline,
        source: newOrderPayload.source, mailUrl: newOrderPayload.mailUrl
    });
    
    pushToSyncQueue('saveOrderData', newOrderPayload);
    showToast("✅ 已成功核銷轉單，請至「訂單辨識建檔」查看");
    renderQuotationList();
}

// ============================================================================
// 估價單列印與 PDF 分享邏輯 (升級版)
// ============================================================================
window.printSingleQuotation = function(rowIdx) {
    const q = globalQuotes.find(x => x.rowIdx === rowIdx);
    if(!q) return;
    generatePrintQuoteHtml([q]);
};

window.printMergedQuotation = function(mergeId) {
    const qs = globalQuotes.filter(x => x.mergeId === mergeId && x.status !== '已作廢');
    if(qs.length === 0) return alert("無有效估價單可列印");
    generatePrintQuoteHtml(qs);
};

function generatePrintQuoteHtml(quoteArr) {
    const printArea = document.getElementById('printQuoteArea');
    if(!printArea) return;
    applyPrintStyle('A4', 'portrait');

    // 建立分享按鈕 (呼叫 sharePdf)
    let shareBtn = document.createElement('button');
    shareBtn.id = 'btnSharePdf';
    shareBtn.className = 'btn btn-success fw-bold px-4 py-2 fs-5 shadow-sm me-3 d-print-none';
    shareBtn.innerHTML = '📤 分享檔案 (PDF)';
    shareBtn.onclick = () => sharePdf('printQuoteArea', `估價單_${quoteArr[0].client}_${getTodayStr()}.pdf`);

    // 確保 controlBar 存在並插入分享按鈕
    let checkInterval = setInterval(() => {
        let controlBar = document.getElementById('printControlBar');
        if (controlBar && !document.getElementById('btnSharePdf')) {
            controlBar.insertBefore(shareBtn, controlBar.children[1]); // 放在關閉按鈕前面
            clearInterval(checkInterval);
        }
    }, 100);

    let html = "";
    quoteArr.forEach((q, index) => {
        let items = [];
        try { items = JSON.parse(q.jsonStr || '[]'); } catch(e){}
        
        let subtotalNet = 0;
        let tbodyHtml = items.map(item => {
            let price = Number(item.price) || 0;
            let qty = Number(item.qty) || 0;
            let ext = price * qty;
            subtotalNet += ext;
            return `<tr><td class="text-start ps-2">${escapeQuotes(item.name)}</td><td class="text-center">${qty}</td><td class="text-center">${escapeQuotes(item.unit)}</td><td class="text-end pe-2">${Math.round(price).toLocaleString()}</td><td class="text-end pe-2">${Math.round(ext).toLocaleString()}</td><td class="text-center">${escapeQuotes(item.internalCode)}</td></tr>`;
        }).join('');
        
        // 估價單一律採用「未稅單價加總後，再加上 5% 稅金」的計算邏輯
        let tax = Math.round(subtotalNet * 0.05);
        let total = subtotalNet + tax;
        
        let deptStr = "";
        let cInfo = globalClients.find(c => c.name === q.client);
        if(cInfo && cInfo.receiveDept) {
            let depts = cInfo.receiveDept.split(/,|\n/).map(s=>s.trim()).filter(s=>s);
            if(depts.length > 0) deptStr = depts[0];
        }

        let sealHtml = q.useSeal ? `
            <div style="position: absolute; right: 80px; bottom: 30px; opacity: 0.8; z-index: 10;">
                <img src="https://i.imgur.com/KzXG89O.png" style="width: 150px; height: auto;">
            </div>` : '';
            
        let pageBreak = index < quoteArr.length - 1 ? 'page-break-after: always;' : '';

        html += `
        <div style="width: 210mm; min-height: 297mm; padding: 20mm; background: #fff; margin: 0 auto; box-sizing: border-box; font-family: '微軟正黑體', sans-serif; position: relative; color: #000; ${pageBreak}">
            <div style="text-align: center; margin-bottom: 25px; border-bottom: 3px double #000; padding-bottom: 10px;">
                <h1 style="font-size: 28px; font-weight: bold; margin: 0 0 5px 0; letter-spacing: 2px;">長固實業有限公司</h1>
                <p style="font-size: 14px; margin: 0; line-height: 1.5;">241新北市三重區重新路五段609巷6號4樓之3</p>
                <p style="font-size: 14px; margin: 0; line-height: 1.5;">電話：(04)2326-9591 &nbsp;&nbsp; 傳真：(04)2326-8576 &nbsp;&nbsp; 統編：86477073</p>
                <div style="font-size: 24px; font-weight: bold; margin-top: 15px; letter-spacing: 15px;">估價單</div>
            </div>
            
            <div style="display: flex; justify-content: space-between; font-size: 15px; margin-bottom: 15px;">
                <div style="line-height: 1.8;">
                    <div>客戶名稱：<span style="font-size: 18px; font-weight: bold;">${escapeQuotes(q.client)}</span></div>
                    <div style="border-top: 1px solid #000; margin-top: 5px; padding-top: 5px;">申請單位：<span style="font-weight: bold;">${escapeQuotes(deptStr)}</span></div>
                </div>
                <div style="line-height: 1.8; text-align: right;">
                    <div>估價單號：${q.quoteNo || '未編號'}</div>
                    <div>報價日期：${q.quoteDate}</div>
                    <div>業務人員：${q.staff}</div>
                </div>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
                <thead>
                    <tr style="border-top: 2px solid #000; border-bottom: 2px solid #000;">
                        <th style="padding: 8px; text-align: left; width: 45%;">品名規格</th>
                        <th style="padding: 8px; text-align: center; width: 10%;">數量</th>
                        <th style="padding: 8px; text-align: center; width: 10%;">單位</th>
                        <th style="padding: 8px; text-align: right; width: 12%;">單價</th>
                        <th style="padding: 8px; text-align: right; width: 13%;">金額</th>
                        <th style="padding: 8px; text-align: center; width: 10%;">備註</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbodyHtml}
                </tbody>
                <tfoot>
                    <tr style="border-top: 2px solid #000;">
                        <td colspan="4" style="text-align: right; padding: 5px 8px;">銷售合計：</td>
                        <td style="text-align: right; padding: 5px 8px;">${Math.round(subtotalNet).toLocaleString()}</td>
                        <td></td>
                    </tr>
                    <tr>
                        <td colspan="4" style="text-align: right; padding: 5px 8px;">營業稅 (5%)：</td>
                        <td style="text-align: right; padding: 5px 8px;">${Math.round(tax).toLocaleString()}</td>
                        <td></td>
                    </tr>
                    <tr style="font-weight: bold; font-size: 16px;">
                        <td colspan="4" style="text-align: right; padding: 5px 8px;">總計金額：</td>
                        <td style="text-align: right; padding: 5px 8px; border-bottom: 2px double #000;">NT$ ${Math.round(total).toLocaleString()}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
            
            <div style="font-size: 13px; line-height: 1.6; margin-top: 30px;">
                <div style="font-weight: bold; text-decoration: underline; margin-bottom: 5px;">注意事項：</div>
                <div>1. 本報價單有效期限為自報價日起 30 天內有效。</div>
                <div>2. 報價內容若需修改或規格變動，請重新申請報價。</div>
                <div>3. 交貨期需視實際庫存與訂單確認時間而定。</div>
                ${q.memo ? `<div style="color: #d9534f; margin-top: 5px;">備註：${escapeQuotes(q.memo)}</div>` : ''}
            </div>
            
            ${sealHtml}
        </div>`;
    });
    
    printArea.innerHTML = html;
    showPrintPreview('printQuoteArea');
}

// ============================================================================
// 一鍵分享 PDF 功能 (利用 html2pdf.js 與 Web Share API)
// ============================================================================
window.sharePdf = function(elementId, filename) {
    const btn = document.getElementById('btnSharePdf');
    if(btn) { btn.innerHTML = "⏳ 產生中..."; btn.disabled = true; }
    
    const element = document.getElementById(elementId);
    // 為了確保轉換時樣式不會跑掉，暫時移除 print-active 帶來的限制
    element.classList.remove('print-active');
    
    const opt = {
      margin:       0,
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).output('blob').then(function (blob) {
        element.classList.add('print-active'); // 恢復預覽樣式
        if(btn) { btn.innerHTML = "📤 分享檔案 (PDF)"; btn.disabled = false; }
        
        const file = new File([blob], filename, { type: 'application/pdf' });
        
        // 檢查瀏覽器是否支援 Web Share API (手機原生分享)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
                files: [file],
                title: '估價單',
                text: '您好，附上長固實業估價單 PDF 檔案，請查收。'
            }).catch((error) => console.log('分享取消或失敗', error));
        } else {
            // 如果不支援分享 (如某些電腦瀏覽器)，則直接下載檔案
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            showToast("📥 瀏覽器不支援直接分享，已自動下載 PDF 檔案");
        }
    }).catch(err => {
        console.error("PDF 產生失敗", err);
        if(btn) { btn.innerHTML = "📤 分享檔案 (PDF)"; btn.disabled = false; }
        alert("產生 PDF 失敗，請重試！");
    });
};
