/**
 * ============================================================================
 * 模組 4：庫存與管理員後台 (module_inventory_admin.js) - 【已連動修復版】
 * ============================================================================
 */

let stkSearchText = ""; let logSearchText = ""; let shipSearchText = "";
let admItemSearchText = ""; let admClientSearchText = "";

window.renderInventory = debounce(function() {
    stkSearchText = document.getElementById('stkSearch').value.trim().toLowerCase();
    const c = document.getElementById('stkListContainer');
    let html = ""; let totalVal = 0; let alertCount = 0;
    
    globalInventory.forEach(v => {
        if (stkSearchText && !(v.name.toLowerCase().includes(stkSearchText) || (v.internalCode && v.internalCode.toLowerCase().includes(stkSearchText)))) return;
        
        let val = (v.qty || 0) * (v.cost || 0); totalVal += val;
        let isLow = (v.qty || 0) <= (v.alertQty || 0);
        if (isLow) alertCount++;
        
        let batchStrHtml = "";
        try {
            let batches = JSON.parse(v.batchesStr || '[]');
            if (batches.length > 0) {
                batchStrHtml = `<div class="mt-2 pt-2 border-top"><div class="small text-muted fw-bold mb-1">分批資訊：</div>` + 
                    batches.map(b => `<div class="small badge bg-light text-dark border me-1 mb-1">批號: ${escapeQuotes(b.lot||'無')} | 效期: ${b.exp||'無'} | 數: ${b.qty}</div>`).join('') +
                    `</div>`;
            }
        } catch(e){}
        
        html += `
        <div class="card mb-2 border-0 shadow-sm ${isLow ? 'border-start border-danger border-4' : ''}">
            <div class="card-body p-3">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <div class="fw-bold fs-6 text-dark">${escapeQuotes(v.name)}</div>
                    <div class="fs-5 fw-bold ${isLow ? 'text-danger' : 'text-primary'}">${v.qty}</div>
                </div>
                <div class="small text-muted mb-2">代號：${v.internalCode || '未設定'} | 廠商：${escapeQuotes(v.supplier)} | 安全量：${v.alertQty}</div>
                ${batchStrHtml}
                <div class="text-end mt-2 pt-2 border-top"><button class="btn btn-sm btn-outline-info fw-bold" onclick="openAdjustModal('${escapeQuotes(v.name)}')">✏️ 異動/盤點</button></div>
            </div>
        </div>`;
    });
    
    c.innerHTML = html || '<div class="text-center text-muted py-3">無符合的庫存資料</div>';
    document.getElementById('stkTotalValue').innerText = "$" + Math.round(totalVal).toLocaleString();
    document.getElementById('stkAlertCount').innerText = alertCount + " 項";
}, 300);

window.populateLogDropdowns = function() {
    const sName = document.getElementById('logFilterName');
    if (!sName) return;
    let names = new Set();
    globalInvLogs.forEach(h => { if(h.name) names.add(h.name); });
    let currentName = sName.value;
    sName.innerHTML = '<option value="">📦 所有品名 (不限)</option>' + Array.from(names).sort().map(x => `<option value="${escapeQuotes(x)}" ${x===currentName?'selected':''}>${escapeQuotes(x)}</option>`).join('');
};

window.renderInvLogs = debounce(function() {
    logSearchText = document.getElementById('stkLogSearch').value.trim().toLowerCase();
    const c = document.getElementById('stkLogContainer');
    
    const fIn = document.getElementById('logFilterIn').value;
    const fOut = document.getElementById('logFilterOut').value;
    const fStart = document.getElementById('logFilterStart').value;
    const fEnd = document.getElementById('logFilterEnd').value;
    const fName = document.getElementById('logFilterName').value;
    
    let filterType = "";
    if (fIn) filterType = fIn;
    else if (fOut) filterType = fOut;
    
    let html = "";
    globalInvLogs.forEach(L => {
        let match = true;
        
        if (filterType && L.type !== filterType) match = false;
        if (fName && L.name !== fName) match = false;
        
        const dStr = new Date(L.time).toLocaleDateString('zh-TW');
        const LTime = new Date(L.time).getTime();
        if (fStart) { const sTime = new Date(fStart).getTime(); if (LTime < sTime) match = false; }
        if (fEnd) { const eTime = new Date(fEnd).getTime() + 86400000; if (LTime >= eTime) match = false; }
        
        if (logSearchText && match) {
            const str = `${L.name} ${L.staff} ${L.memo} ${L.type} ${L.orderNo} ${L.invoiceNo}`.toLowerCase();
            if (!str.includes(logSearchText)) match = false;
        }
        
        if (match) {
            let chgStr = L.qtyChange > 0 ? `<span class="text-success fw-bold">+${L.qtyChange}</span>` : `<span class="text-danger fw-bold">${L.qtyChange}</span>`;
            
            html += `
            <div class="card mb-2 border-0 shadow-sm" style="background-color: ${L.type.includes('出貨') ? '#fff5f5' : '#f0fdf4'}">
                <div class="card-body p-2">
                    <div class="d-flex justify-content-between mb-1">
                        <div class="fw-bold text-dark w-75 text-truncate">${escapeQuotes(L.name)}</div>
                        <div class="text-end w-25">${chgStr}</div>
                    </div>
                    <div class="d-flex justify-content-between small text-muted mb-1">
                        <span><span class="badge bg-secondary">${L.type}</span> 餘:${L.newQty}</span>
                        <span>👨‍💼 ${L.staff}</span>
                    </div>
                    ${L.memo ? `<div class="small text-secondary mb-1">備註: ${escapeQuotes(L.memo)}</div>` : ''}
                    <div class="d-flex justify-content-between align-items-center mt-1 pt-1 border-top small">
                        <span class="text-muted">${dStr}</span>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-outline-secondary" onclick="openEditInvLogModal(${L.rowIdx})">✏️</button>
                            ${(L.type === '出貨扣抵(新建)' || L.type === '分批出貨' || L.type === '出貨扣抵') ? `<button class="btn btn-sm btn-outline-warning" onclick="openEditBatchModal(${L.rowIdx}, '${escapeQuotes(L.name)}', ${L.qtyChange}, '${escapeQuotes(L.lot||'')}')">換批號</button>` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
        }
    });
    c.innerHTML = html || '<div class="text-center text-muted py-3">無異動紀錄</div>';
}, 300);

// ============================================================================
// 手動庫存盤點與進貨
// ============================================================================
window.openAdjustModal = function(name) {
    document.getElementById('adjRowIdx').value = "";
    document.getElementById('adjName').value = name || "";
    document.getElementById('adjInternalCode').value = "";
    document.getElementById('adjQty').value = "";
    document.getElementById('adjCost').value = "";
    document.getElementById('adjAlert').value = "";
    document.getElementById('adjSup').value = "";
    document.getElementById('adjLot').value = "";
    document.getElementById('adjExp').value = "";
    document.getElementById('adjType').value = "進貨入庫";
    document.getElementById('adjMemo').value = "";
    document.getElementById('adjInvoiceNo').value = "";
    document.getElementById('adjArrivalDate').value = "";
    
    if (name) {
        let v = globalInventory.find(x => x.name === name);
        if (v) {
            document.getElementById('adjInternalCode').value = v.internalCode || "";
            document.getElementById('adjCost').value = v.cost || "";
            document.getElementById('adjAlert').value = v.alertQty || "";
            document.getElementById('adjSup').value = v.supplier || "";
        }
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('adjInvModal')).show();
};

window.selectProductForAdj = function(prodName) {
    document.getElementById('adjName').value = prodName;
    let v = globalInventory.find(x => x.name === prodName);
    if(v) {
        document.getElementById('adjInternalCode').value = v.internalCode || "";
        document.getElementById('adjCost').value = v.cost || "";
        document.getElementById('adjAlert').value = v.alertQty || "";
        document.getElementById('adjSup').value = v.supplier || "";
    } else {
        let catMatch = globalCatalog.find(x => x.productName === prodName);
        if(catMatch) document.getElementById('adjInternalCode').value = catMatch.internalCode || "";
    }
    bootstrap.Modal.getInstance(document.getElementById('searchModal')).hide();
};

window.saveInventoryAdjust = function() {
    let name = document.getElementById('adjName').value.trim();
    let qty = Number(document.getElementById('adjQty').value) || 0;
    if (!name || qty === 0) return alert("請選擇品名並輸入正確的異動數量 (不可為0)！");
    
    let type = document.getElementById('adjType').value;
    if (type === '退貨' && qty > 0) qty = -qty;
    
    const payload = {
        name: name, changeQty: qty, type: type, staff: myName,
        cost: Number(document.getElementById('adjCost').value)||0,
        alertQty: Number(document.getElementById('adjAlert').value)||0,
        supplier: document.getElementById('adjSup').value.trim(),
        lot: document.getElementById('adjLot').value.trim(),
        expiry: document.getElementById('adjExp').value,
        invoiceNo: document.getElementById('adjInvoiceNo').value.trim(),
        arrivalDate: document.getElementById('adjArrivalDate').value,
        memo: document.getElementById('adjMemo').value.trim(),
        internalCode: document.getElementById('adjInternalCode').value.trim()
    };
    
    let inv = globalInventory.find(x => x.name === name);
    if(inv) inv.qty += qty;
    
    pushToSyncQueue('adjustInventory', payload);
    bootstrap.Modal.getInstance(document.getElementById('adjInvModal')).show();
    renderInventory();
    showToast("💾 庫存異動已送出");
};

// ============================================================================
// 欠貨出貨與訂貨模組
// ============================================================================
window.renderShipments = debounce(function() {
    shipSearchText = document.getElementById('stkShipSearch').value.trim().toLowerCase();
    const c = document.getElementById('stkShipContainer');
    
    const fClient = document.getElementById('stkShipFilterClient');
    const fName = document.getElementById('stkShipFilterName');
    
    let clients = new Set(); let names = new Set();
    
    let pendingList = globalSalesDetails.filter(sd => sd.shipStatus !== '已結案' && (Number(sd.qty) - (Number(sd.shippedQty)||0) > 0));
    
    pendingList.forEach(sd => { clients.add(sd.client); names.add(sd.name); });
    
    if (fClient.options.length <= 1) fClient.innerHTML = '<option value="">🏢 所有客戶</option>' + Array.from(clients).sort().map(x => `<option value="${escapeQuotes(x)}">${escapeQuotes(x)}</option>`).join('');
    if (fName.options.length <= 1) fName.innerHTML = '<option value="">📦 所有品名</option>' + Array.from(names).sort().map(x => `<option value="${escapeQuotes(x)}">${escapeQuotes(x)}</option>`).join('');
    
    const cv = fClient.value; const nv = fName.value;
    
    let html = "";
    pendingList.forEach(sd => {
        let match = true;
        if (cv && sd.client !== cv) match = false;
        if (nv && sd.name !== nv) match = false;
        
        if (shipSearchText && match) {
            const str = `${sd.paperNo} ${sd.client} ${sd.name} ${sd.orderNo}`.toLowerCase();
            if (!str.includes(shipSearchText)) match = false;
        }
        
        if (match) {
            let inv = globalInventory.find(v => v.name === sd.name);
            let curStock = inv ? inv.qty : 0;
            let remain = Number(sd.qty) - (Number(sd.shippedQty)||0);
            let dStr = new Date(sd.time).toLocaleDateString('zh-TW');
            
            html += `
            <div class="card mb-2 border-secondary shadow-sm">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between mb-1">
                        <div class="fw-bold fs-6 text-dark w-75 text-truncate">${escapeQuotes(sd.name)}</div>
                        <div class="text-end w-25"><span class="badge ${remain > curStock ? 'bg-danger' : 'bg-primary'} fs-6">欠 ${remain}</span></div>
                    </div>
                    <div class="small text-muted mb-2">客戶: ${escapeQuotes(sd.client)} | 發票: ${sd.paperNo}</div>
                    <div class="d-flex justify-content-between align-items-center mb-2 pt-2 border-top">
                        <span class="small fw-bold text-success">現有庫存：${curStock}</span>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-outline-warning fw-bold" onclick="openPurchaseOrderModal('${escapeQuotes(sd.name)}', '${escapeQuotes(sd.client)}', ${remain})">🛒 訂貨</button>
                            ${curStock > 0 ? `<button class="btn btn-sm btn-primary fw-bold" onclick="openShipModal(${sd.rowIdx})">📦 出貨</button>` : `<button class="btn btn-sm btn-secondary fw-bold" disabled>無庫存</button>`}
                        </div>
                    </div>
                </div>
            </div>`;
        }
    });
    
    c.innerHTML = html || '<div class="text-center text-muted py-4">無欠貨出貨紀錄</div>';
}, 300);

// ============================================================================
// 預先訂貨功能 (新增)
// ============================================================================
window.openPreOrderModal = function() {
    let pName = prompt("請輸入想要預先訂購的品項名稱：", "");
    if(pName) openPurchaseOrderModal(pName, "公司預留備貨", 1);
};

window.openPurchaseOrderModal = function(itemName, clientName, defaultQty) {
    document.getElementById('poDate').value = getTodayStr();
    document.getElementById('poOrderNo').value = "PO-" + Date.now().toString().substr(-5);
    document.getElementById('poItemName').value = itemName;
    document.getElementById('poQty').value = defaultQty || 0;
    document.getElementById('poMemo').value = "";
    
    let inv = globalInventory.find(v => v.name === itemName);
    if(inv) {
        document.getElementById('poInternalCode').value = inv.internalCode || '';
        document.getElementById('poSupplier').value = inv.supplier || '';
    } else {
        document.getElementById('poInternalCode').value = ''; document.getElementById('poSupplier').value = '';
    }
    
    let cSelect = document.getElementById('poClientName');
    let clientsSet = new Set(["公司預留備貨"]);
    globalClients.forEach(c => clientsSet.add(c.name));
    cSelect.innerHTML = Array.from(clientsSet).sort().map(c => `<option value="${escapeQuotes(c)}" ${c===clientName?'selected':''}>${escapeQuotes(c)}</option>`).join('');
    
    triggerPoClientChange(clientName);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('purchaseOrderModal')).show();
};

window.triggerPoClientChange = function(cName) {
    let dSelect = document.getElementById('poReceiveDept');
    if (cName === "公司預留備貨") {
        dSelect.innerHTML = `<option value="總倉庫">總倉庫</option>`;
        document.getElementById('poAddress').value = "台中市西區中美街639號";
    } else {
        let cInfo = globalClients.find(c => c.name === cName);
        if(cInfo && cInfo.receiveDept) {
            let depts = cInfo.receiveDept.split(/,|\n/).map(s=>s.trim()).filter(s=>s);
            dSelect.innerHTML = depts.map(d => `<option value="${escapeQuotes(d)}">${escapeQuotes(d)}</option>`).join('');
        } else {
            dSelect.innerHTML = `<option value="">無單位資料</option>`;
        }
        document.getElementById('poAddress').value = cInfo ? (cInfo.address || "") : "";
    }
};

window.confirmPurchaseOrder = function() {
    let qty = Number(document.getElementById('poQty').value);
    if(qty <= 0) return alert("請輸入有效的訂貨數量");
    
    let payload = {
        name: document.getElementById('poItemName').value,
        poDate: document.getElementById('poDate').value,
        poOrderNo: document.getElementById('poOrderNo').value,
        supplier: document.getElementById('poSupplier').value,
        qty: qty,
        memo: document.getElementById('poMemo').value,
        staff: myName
    };
    
    pushToSyncQueue('submitPurchaseOrder', payload);
    bootstrap.Modal.getInstance(document.getElementById('purchaseOrderModal')).hide();
    generatePrintPoHtml();
};

window.generatePrintPoHtml = function() {
    const printArea = document.getElementById('printPoArea');
    if(!printArea) return;
    applyPrintStyle('A4', 'portrait');
    
    let html = `
    <div style="width: 210mm; min-height: 297mm; padding: 20mm; background: #fff; margin: 0 auto; box-sizing: border-box; font-family: '微軟正黑體', sans-serif;">
        <h2 style="text-align:center; font-weight:bold; letter-spacing: 5px; margin-bottom: 20px;">訂購單</h2>
        <div style="display:flex; justify-content:space-between; margin-bottom: 20px; font-size:15px; border-bottom:2px solid #000; padding-bottom:10px;">
            <div>
                <div><strong>供應商：</strong>${escapeQuotes(document.getElementById('poSupplier').value)}</div>
                <div><strong>電話：</strong>${escapeQuotes(document.getElementById('poSupPhone').value)}</div>
                <div><strong>傳真：</strong>${escapeQuotes(document.getElementById('poSupFax').value)}</div>
            </div>
            <div style="text-align:right;">
                <div><strong>訂單編號：</strong>${document.getElementById('poOrderNo').value}</div>
                <div><strong>訂購日期：</strong>${document.getElementById('poDate').value}</div>
            </div>
        </div>
        <table style="width:100%; border-collapse:collapse; text-align:center; margin-bottom:30px;">
            <thead><tr style="border-bottom:1px solid #000;"><th style="padding:10px;">品名規格</th><th>長固代號</th><th>數量</th><th>備註</th></tr></thead>
            <tbody><tr><td style="padding:10px;">${escapeQuotes(document.getElementById('poItemName').value)}</td><td>${escapeQuotes(document.getElementById('poInternalCode').value)}</td><td style="font-weight:bold; font-size:18px;">${document.getElementById('poQty').value}</td><td>${escapeQuotes(document.getElementById('poMemo').value)}</td></tr></tbody>
        </table>
        <div style="border:1px dashed #666; padding:15px; font-size:14px; margin-bottom:30px;">
            <div style="font-weight:bold; margin-bottom:10px;">🚚 送貨資訊</div>
            <div><strong>收貨對象：</strong>${escapeQuotes(document.getElementById('poClientName').value)}</div>
            <div><strong>收貨單位：</strong>${escapeQuotes(document.getElementById('poReceiveDept').value)}</div>
            <div><strong>送貨地址：</strong>${escapeQuotes(document.getElementById('poAddress').value)}</div>
        </div>
    </div>`;
    printArea.innerHTML = html;
    showPrintPreview('printPoArea');
};

// ============================================================================
// 扣庫存出貨並連動送貨單
// ============================================================================
window.openShipModal = function(rowIdx) {
    const sd = globalSalesDetails.find(x => x.rowIdx === rowIdx);
    if(!sd) return;
    const inv = globalInventory.find(v => v.name === sd.name);
    
    document.getElementById('shipRowIdx').value = sd.rowIdx;
    document.getElementById('shipItemName').innerText = sd.name;
    document.getElementById('shipTotalQty').innerText = sd.qty;
    let shipped = sd.shippedQty || 0;
    document.getElementById('shipDoneQty').innerText = shipped;
    let remain = sd.qty - shipped;
    document.getElementById('shipRemainQty').innerText = remain;
    
    let curStock = inv ? inv.qty : 0;
    let defaultQty = remain > curStock ? curStock : remain;
    document.getElementById('shipNowQty').value = defaultQty;
    
    const bs = document.getElementById('shipBatchSelect');
    if (inv && inv.batchesStr) {
        try {
            let batches = JSON.parse(inv.batchesStr);
            if (batches.length > 0) {
                bs.innerHTML = '<option value="">不指定批號 (自動扣除)</option>' + batches.map(b => `<option value="${escapeQuotes(b.lot)}" data-exp="${b.exp||'無'}" data-stock="${b.qty}">${escapeQuotes(b.lot)} (餘:${b.qty})</option>`).join('');
                document.getElementById('shipBatchSelect').parentElement.style.display = 'block';
                updateShipBatchInfo();
            } else {
                bs.innerHTML = '<option value="">此商品無分批資訊</option>';
                document.getElementById('shipBatchExp').innerText = '--'; document.getElementById('shipBatchStock').innerText = '0';
            }
        } catch(e) {}
    } else {
        bs.innerHTML = '<option value="">此商品無分批資訊</option>';
        document.getElementById('shipBatchExp').innerText = '--'; document.getElementById('shipBatchStock').innerText = '0';
    }
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('shipModal')).show();
};

window.updateShipBatchInfo = function() {
    const sel = document.getElementById('shipBatchSelect');
    const opt = sel.options[sel.selectedIndex];
    if(opt && opt.value !== "") {
        document.getElementById('shipBatchExp').innerText = opt.getAttribute('data-exp');
        document.getElementById('shipBatchStock').innerText = opt.getAttribute('data-stock');
        document.getElementById('shipNowQty').value = opt.getAttribute('data-stock');
    } else {
        document.getElementById('shipBatchExp').innerText = '--'; document.getElementById('shipBatchStock').innerText = '--';
    }
};

window.confirmShipment = function() {
    const rIdx = Number(document.getElementById('shipRowIdx').value);
    const sd = globalSalesDetails.find(x => x.rowIdx === rIdx);
    const shipQty = Number(document.getElementById('shipNowQty').value);
    
    if(!sd || shipQty <= 0) return alert("輸入數量無效");
    
    const bs = document.getElementById('shipBatchSelect');
    let batchLot = bs ? bs.value : '';
    
    let remain = sd.qty - (sd.shippedQty||0);
    if(shipQty > remain) return alert("出貨數量不可大於尚欠數量");
    
    pushToSyncQueue('updateShipment', {
        staff: myName,
        updates: [{
            rowIdx: sd.rowIdx, name: sd.name, shipQty: shipQty, batchTarget: batchLot, paperNo: sd.paperNo
        }]
    });
    
    bootstrap.Modal.getInstance(document.getElementById('shipModal')).hide();
    renderShipments();
    showToast("✅ 已成功出貨扣庫，送貨單已自動建立！");
};

// ============================================================================
// 管理員後台
// ============================================================================
window.openAdminItemModal = function(rowIdx) {
    if(rowIdx) {
        const item = globalCatalog.find(x => x.rowIndex === rowIdx);
        document.getElementById('editItemRowIndex').value = item.rowIndex;
        document.getElementById('editItemClientDisplay').value = item.clientName;
        document.getElementById('editItemClientVal').value = item.clientName;
        document.getElementById('editItemInternalCode').value = item.internalCode || "";
        document.getElementById('editItemName').value = item.productName || "";
        document.getElementById('editItemUnit').value = item.unit || "式";
        document.getElementById('editItemPrice').value = item.price || 0;
        document.getElementById('editItemModalTitle').innerText = "📝 編輯品項";
    } else {
        document.getElementById('editItemRowIndex').value = "";
        document.getElementById('editItemClientDisplay').value = "";
        document.getElementById('editItemClientVal').value = "";
        document.getElementById('editItemInternalCode').value = "";
        document.getElementById('editItemName').value = "";
        document.getElementById('editItemUnit').value = "式";
        document.getElementById('editItemPrice').value = 0;
        document.getElementById('editItemModalTitle').innerText = "➕ 新增合約報價品項";
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editItemModal')).show();
};
window.triggerItemClientSelect = function() { openSearchModal('client', function(cName){ document.getElementById('editItemClientDisplay').value = cName; document.getElementById('editItemClientVal').value = cName; bootstrap.Modal.getInstance(document.getElementById('searchModal')).hide(); }); };
window.submitEditItemOptimistic = function() {
    const cName = document.getElementById('editItemClientVal').value; const pName = document.getElementById('editItemName').value.trim();
    if(!cName || !pName) return alert("客戶名稱與合約品名為必填！");
    let payload = {
        rowIndex: document.getElementById('editItemRowIndex').value ? Number(document.getElementById('editItemRowIndex').value) : Date.now(),
        clientName: cName, internalCode: document.getElementById('editItemInternalCode').value.trim(),
        productName: pName, unit: document.getElementById('editItemUnit').value.trim(),
        price: Number(document.getElementById('editItemPrice').value)||0
    };
    pushToSyncQueue('saveAdminItem', payload);
    bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide();
    showToast("💾 品項儲存成功"); setTimeout(renderAdminItems, 500);
};

window.openNewClientModal = function() {
    ['Name','TaxId','Address','ReceiveDept'].forEach(id => document.getElementById('addClient'+id).value = "");
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addClientModal')).show();
};
window.submitNewClientOptimistic = function() {
    let name = document.getElementById('addClientName').value.trim();
    if(!name) return alert("客戶名稱必填");
    pushToSyncQueue('addClientData', {
        clientName: name, taxId: document.getElementById('addClientTaxId').value.trim(),
        address: document.getElementById('addClientAddress').value.trim(),
        receiveDept: document.getElementById('addClientReceiveDept').value.trim()
    });
    bootstrap.Modal.getInstance(document.getElementById('addClientModal')).hide();
    showToast("🏢 客戶建立成功");
};

window.renderAdminItems = debounce(function() {
    admItemSearchText = document.getElementById('admItemSearch').value.trim().toLowerCase();
    const sel = document.getElementById('admItemFilterSelect').value;
    const c = document.getElementById('admItemList');
    let html = "";
    globalCatalog.forEach(item => {
        let match = true;
        if(sel && item.clientName !== sel) match = false;
        if(admItemSearchText && match) {
            if(!`${item.productName} ${item.clientName} ${item.internalCode}`.toLowerCase().includes(admItemSearchText)) match = false;
        }
        if(match) {
            html += `<div class="card mb-2 shadow-sm border-0"><div class="card-body p-2 d-flex justify-content-between align-items-center"><div><div class="fw-bold text-dark">${escapeQuotes(item.productName)}</div><div class="small text-muted">${escapeQuotes(item.clientName)} | 代號:${item.internalCode||'無'}</div></div><div class="text-end"><div class="text-primary fw-bold">$${item.price} / ${escapeQuotes(item.unit)}</div><button class="btn btn-sm btn-outline-secondary mt-1" onclick="openAdminItemModal(${item.rowIndex})">✏️ 編輯</button></div></div></div>`;
        }
    });
    c.innerHTML = html || '<div class="text-center text-muted py-3">查無符合的品項</div>';
}, 300);
