/**
 * ============================================================================
 * 模組 3：發票管理與歷史紀錄 (module_invoice_history.js) - 【已連動修復版】
 * ============================================================================
 */

// ============================================================================
// 歷史紀錄與報表模組
// ============================================================================
let histSearchText = "";
let reportChartInstance = null;

window.updateHistoryDropdowns = function() {
    const sStaff = document.getElementById('histFilterStaff');
    const sClient = document.getElementById('histFilterClient');
    if (!sStaff || !sClient) return;
    
    const curStaff = sStaff.value; const curClient = sClient.value;
    let staffs = new Set(); let clients = new Set();
    globalHistory.forEach(h => {
        if(h.staff) staffs.add(h.staff);
        if(h.client) clients.add(h.client);
    });
    
    sStaff.innerHTML = '<option value="">👤 所有員工</option>' + Array.from(staffs).sort().map(x => `<option value="${escapeQuotes(x)}" ${x===curStaff?'selected':''}>${escapeQuotes(x)}</option>`).join('');
    sClient.innerHTML = '<option value="">🏢 所有客戶</option>' + Array.from(clients).sort().map(x => `<option value="${escapeQuotes(x)}" ${x===curClient?'selected':''}>${escapeQuotes(x)}</option>`).join('');
};

window.renderHistory = debounce(function() {
    const listC = document.getElementById('histListContainer');
    if(!listC) return;
    
    histSearchText = document.getElementById('histSearch').value.trim().toLowerCase();
    const fStaff = document.getElementById('histFilterStaff').value;
    const fClient = document.getElementById('histFilterClient').value;
    const fStatus = document.getElementById('histFilterStatus').value;
    const fDate = document.getElementById('histFilterDate').value;
    
    let html = "";
    globalHistory.forEach(h => {
        let match = true;
        const dStr = new Date(h.time).toLocaleDateString('zh-TW');
        
        if (fStaff && h.staff !== fStaff) match = false;
        if (fClient && h.client !== fClient) match = false;
        if (fStatus && h.status !== fStatus) match = false;
        if (fDate && getDateStr(h.time) !== fDate) match = false;
        
        if (histSearchText && match) {
            const str = `${h.client} ${h.paperNo} ${h.orderNo} ${h.details} ${dStr}`.toLowerCase();
            if (!str.includes(histSearchText)) match = false;
        }
        
        if (match) {
            let statusBadge = h.status === '作廢' ? '<span class="badge bg-danger">🔴 已作廢</span>' : '<span class="badge bg-success">🟢 正常</span>';
            let paperStr = h.paperNo;
            if(paperStr && paperStr.startsWith('VIRTUAL-')) paperStr = `<span class="text-danger">缺號(${paperStr.split('-')[1]})</span>`;
            
            html += `
            <div class="card mb-2 border-0 shadow-sm">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between mb-2">
                        <div>
                            <div class="fw-bold fs-6 text-dark">${escapeQuotes(h.client)}</div>
                            <div class="small text-muted">單號: ${paperStr} | 訂單: ${h.orderNo || '無'}</div>
                        </div>
                        <div class="text-end">
                            ${statusBadge}
                            <div class="text-danger fw-bold mt-1">$${Math.round(h.total).toLocaleString()}</div>
                        </div>
                    </div>
                    <div class="small text-secondary mb-2 line-clamp-2">${h.details ? escapeQuotes(h.details).replace(/\n/g, '<br>') : '無明細'}</div>
                    <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top">
                        <span class="small text-muted">📅 ${dStr} | 👨‍💼 ${h.staff}</span>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="printInvoice(${h.rowIdx})">🖨️ 列印</button>
                            <button class="btn btn-sm btn-outline-primary fw-bold" onclick="openEditInvoiceModal(${h.rowIdx})">✏️ 編輯</button>
                            ${h.status !== '作廢' ? `<button class="btn btn-sm btn-outline-danger fw-bold" onclick="voidInvoice(${h.rowIdx})">🗑️ 作廢</button>` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
        }
    });
    
    listC.innerHTML = html || '<div class="text-center text-muted py-3">無符合的紀錄</div>';
}, 300);

// ============================================================================
// 解決問題 1：發票編輯與作廢邏輯 (對接雙軌寫入)
// ============================================================================
window.openEditInvoiceModal = function(rowIdx) {
    const h = globalHistory.find(x => x.rowIdx === rowIdx);
    if (!h) return;
    document.getElementById('e_invRow').value = h.rowIdx;
    document.getElementById('e_invPaper').value = h.paperNo || '';
    document.getElementById('e_invOrder').value = h.orderNo || '';
    document.getElementById('e_invNet').value = h.net || 0;
    document.getElementById('e_invTotal').value = h.total || 0;
    document.getElementById('e_invDetails').value = h.details || '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editInvModal')).show();
};

window.saveEditInvoice = function() {
    const rowIdx = Number(document.getElementById('e_invRow').value);
    const paperNo = document.getElementById('e_invPaper').value.trim().toUpperCase();
    const orderNo = document.getElementById('e_invOrder').value.trim();
    const net = Number(document.getElementById('e_invNet').value) || 0;
    const total = Number(document.getElementById('e_invTotal').value) || 0;
    const details = document.getElementById('e_invDetails').value.trim();
    
    const h = globalHistory.find(x => x.rowIdx === rowIdx);
    if (h) {
        h.paperNo = paperNo; h.orderNo = orderNo; h.net = net; h.total = total; h.details = details;
        pushToSyncQueue('updateInvoiceRecord', { 
            action: 'edit', rowIdx: rowIdx, paperNo: paperNo, orderNo: orderNo, net: net, total: total, details: details 
        });
    }
    
    bootstrap.Modal.getInstance(document.getElementById('editInvModal')).hide();
    renderHistory();
    showToast("💾 發票已更新");
};

window.voidInvoice = function(rowIdx) {
    if (!confirm("確定要作廢這張發票嗎？\n(注意：作廢發票不會自動退回庫存，若需退庫請至庫存異動手動操作)")) return;
    const h = globalHistory.find(x => x.rowIdx === rowIdx);
    if (h) {
        h.status = '作廢';
        pushToSyncQueue('updateInvoiceRecord', { action: 'void', rowIdx: rowIdx });
    }
    renderHistory();
    showToast("🔴 發票已作廢");
};

// ============================================================================
// 工具函式
// ============================================================================
function getDateStr(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

window.borrowInvoiceNo = function() {
    let p = prompt("未有實體發票號碼，系統將產生暫時虛擬單號。\n請輸入辨識後綴 (如客戶簡稱)：", "代用單");
    if(p) document.getElementById('invPaperNo').value = "VIRTUAL-" + Date.now().toString().substr(-5) + "-" + p;
};

// ============================================================================
// 開立發票模組 - 主邏輯
// ============================================================================
window.goStep = function(step) {
    [1,2,3,4,5].forEach(s => {
        let el = document.getElementById('invStep'+s);
        if(el) {
            el.style.display = (s===step) ? 'block' : 'none';
            if(s===step) setTimeout(()=> el.classList.add('active'), 50);
            else el.classList.remove('active');
        }
    });
};

window.selectClientForInvoice = function(clientName) {
    currentInvoiceData.clientName = clientName;
    document.getElementById('invClientInput').value = clientName;
    
    let info = globalClients.find(c => c.name === clientName);
    currentInvoiceData.taxId = info ? info.taxId : '';
    
    let infoBox = document.getElementById('invClientInfo');
    infoBox.innerHTML = `已選擇：<strong>${clientName}</strong>${currentInvoiceData.taxId ? `<br>統編：${currentInvoiceData.taxId}` : ''}`;
    infoBox.style.display = 'block';
    
    bootstrap.Modal.getInstance(document.getElementById('searchModal')).hide();
    document.getElementById('btnNext1').style.display = 'block';
    
    let pendingOrders = globalOrders.filter(o => o.client === clientName && o.status !== '已結案');
    let aiNotice = document.getElementById('invAiNotice');
    
    if (pendingOrders.length > 0) {
        if(confirm(`偵測到該客戶有 ${pendingOrders.length} 筆未結案訂單，是否要自動帶入所有未出貨明細？`)) {
            let orderNos = [];
            currentInvoiceData.items = [];
            let catData = globalCatalog.filter(c => c.clientName === clientName);
            
            pendingOrders.forEach(po => {
                if(po.orderNo) orderNos.push(po.orderNo);
                let poItems = [];
                try { poItems = JSON.parse(po.jsonStr || '[]'); } catch(e){}
                
                poItems.forEach(poi => {
                    let shippedQty = 0;
                    globalSalesDetails.forEach(sd => {
                        if(sd.orderNo === po.orderNo && sd.name === poi.name) {
                            shippedQty += (Number(sd.qty) || 0); 
                        }
                    });
                    
                    let remainQty = (Number(poi.qty) || 0) - shippedQty;
                    if (remainQty > 0) {
                        let cItem = catData.find(c => c.productName === poi.name);
                        currentInvoiceData.items.push({
                            id: Date.now().toString() + Math.random().toString(36).substr(2,4),
                            name: poi.name, qty: remainQty,
                            price: cItem ? cItem.price : (Number(poi.price) || 0),
                            unit: cItem ? cItem.unit : (poi.unit || '式')
                        });
                    }
                });
                
                // 智慧帶入後，將該訂單狀態標記為處理中(假定即將開票)
                if(po.status === '未結案') {
                    po.status = '處理中';
                    pushToSyncQueue('updateOrderStatus', { rowIdx: po.rowIdx, status: '處理中' });
                }
            });
            
            document.getElementById('invOrderNo').value = orderNos.join(', ');
            aiNotice.style.display = 'block';
            
            if(currentInvoiceData.items.length === 0) {
                 aiNotice.innerHTML = "✨ 偵測到訂單，但所有品項均已開立出貨完畢。";
            }
        }
    } else {
        currentInvoiceData.items = [{ id: Date.now().toString(), name: '', qty: 1, price: 0, unit: '式' }];
        aiNotice.style.display = 'none';
    }
    
    reRenderInvoiceItems();
};

window.addInvoiceItemRow = function() {
    if (currentInvoiceData.items.length >= 10) return alert("單張發票最多開立 10 項！");
    currentInvoiceData.items.push({ id: Date.now().toString(), name: '', qty: 1, price: 0, unit: '式' });
    reRenderInvoiceItems();
};

window.removeInvoiceItem = function(id) {
    currentInvoiceData.items = currentInvoiceData.items.filter(x => x.id !== id);
    reRenderInvoiceItems();
};

window.reRenderInvoiceItems = function() {
    const c = document.getElementById('invItemsContainer');
    let catData = globalCatalog.filter(x => x.clientName === currentInvoiceData.clientName);
    
    if (currentInvoiceData.items.length === 0) {
        c.innerHTML = '<div class="alert alert-warning small fw-bold">目前無品項，請點擊下方按鈕新增。</div>';
        return;
    }
    
    c.innerHTML = currentInvoiceData.items.map((item, index) => {
        let opts = catData.map(cd => `<option value="${escapeQuotes(cd.productName)}" data-price="${cd.price}" data-unit="${escapeQuotes(cd.unit)}">`).join('');
        return `
        <div class="row g-2 mb-2 align-items-end draggable-row bg-white p-2 border rounded shadow-sm" draggable="true" ondragstart="handleDragStart(event, '${item.id}', 'invoice')" ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${item.id}', 'invoice')">
            <div class="col-1 text-center" style="cursor: grab; color: #adb5bd; padding-bottom: 8px;">☰</div>
            <div class="col-1 text-center"><span class="badge bg-secondary">${index+1}</span></div>
            <div class="col-5">
                <label class="small text-muted fw-bold">品名</label>
                <input type="text" class="form-control fw-bold" value="${escapeQuotes(item.name)}" list="dl_inv_${item.id}" onchange="updateInvItemAuto(this, '${item.id}')">
                <datalist id="dl_inv_${item.id}">${opts}</datalist>
            </div>
            <div class="col-2">
                <label class="small text-muted fw-bold">數量</label>
                <input type="number" class="form-control fw-bold text-primary" value="${item.qty}" min="0.1" step="any" oninput="updateInvItemVal('${item.id}', 'qty', this.value)">
            </div>
            <div class="col-2">
                <label class="small text-muted fw-bold">單價</label>
                <input type="number" class="form-control" value="${item.price}" step="any" oninput="updateInvItemVal('${item.id}', 'price', this.value)">
            </div>
            <div class="col-1 text-end">
                <button class="btn btn-sm btn-outline-danger" onclick="removeInvoiceItem('${item.id}')">✖</button>
            </div>
        </div>`;
    }).join('');
    
    const btn = document.getElementById('btnAddInvItem');
    if (btn) btn.style.display = currentInvoiceData.items.length >= 10 ? 'none' : 'block';
};

window.updateInvItemVal = function(id, field, val) {
    let item = currentInvoiceData.items.find(x => x.id === id);
    if(item) {
        if(field==='qty' || field==='price') item[field] = Number(val) || 0;
        else item[field] = val;
    }
};

window.updateInvItemAuto = function(inputEl, id) {
    let val = inputEl.value;
    let item = currentInvoiceData.items.find(x => x.id === id);
    if(item) {
        item.name = val;
        let catData = globalCatalog.filter(x => x.clientName === currentInvoiceData.clientName);
        let match = catData.find(x => x.productName === val);
        if(match) {
            item.price = match.price || item.price;
            item.unit = match.unit || item.unit;
        }
    }
    reRenderInvoiceItems();
};

window.generatePreview = function() {
    let validItems = currentInvoiceData.items.filter(i => i.name.trim() !== "");
    if(validItems.length === 0) return alert("請至少輸入一項有效品名");
    
    let subtotal = 0;
    let detailsArr = [];
    let tbody = validItems.map(item => {
        let qty = item.qty || 0; let price = item.price || 0;
        let ext = qty * price;
        subtotal += ext;
        detailsArr.push(`${item.name} x ${qty}`);
        item.subtotal = ext;
        return `<tr><td>${escapeQuotes(item.name)}</td><td>${qty}</td><td class="text-end">${Math.round(price).toLocaleString()}</td><td class="text-end fw-bold">${Math.round(ext).toLocaleString()}</td><td></td></tr>`;
    }).join('');
    
    let tax = Math.round(subtotal * 0.05);
    let total = subtotal + tax;
    
    document.getElementById('prevClientName').innerText = currentInvoiceData.clientName;
    document.getElementById('prevTaxId').innerText = currentInvoiceData.taxId || '無';
    document.getElementById('prevOrderNo').innerText = document.getElementById('invOrderNo').value || '未填';
    let pNo = document.getElementById('invPaperNo').value.toUpperCase();
    document.getElementById('prevPaperNo').innerText = pNo || '虛擬發票';
    document.getElementById('prevInvDate').innerText = document.getElementById('invDate').value;
    
    document.getElementById('prevTableBody').innerHTML = tbody;
    document.getElementById('prevNet').innerText = Math.round(subtotal).toLocaleString();
    document.getElementById('prevTax').innerText = Math.round(tax).toLocaleString();
    document.getElementById('prevTotal').innerText = Math.round(total).toLocaleString();
    
    currentInvoiceData.netTotal = subtotal;
    currentInvoiceData.tax = tax;
    currentInvoiceData.totalWithTax = total;
    currentInvoiceData.detailsStr = detailsArr.join('\n');
    currentInvoiceData.validItems = validItems;
    
    goStep(4);
};

window.submitInvoiceOptimistic = function() {
    const payload = {
        clientName: currentInvoiceData.clientName,
        taxId: currentInvoiceData.taxId,
        invDate: new Date(document.getElementById('invDate').value).getTime(),
        staff: myName,
        orderNo: document.getElementById('invOrderNo').value.trim(),
        paperNo: document.getElementById('invPaperNo').value.trim().toUpperCase() || ('VIRTUAL-' + Date.now().toString().substr(-5)),
        netTotal: currentInvoiceData.netTotal,
        tax: currentInvoiceData.tax,
        totalWithTax: currentInvoiceData.totalWithTax,
        detailsStr: currentInvoiceData.detailsStr,
        items: currentInvoiceData.validItems
    };
    
    globalHistory.unshift({
        rowIdx: Date.now(), time: payload.invDate, staff: payload.staff, client: payload.clientName,
        taxId: payload.taxId, net: payload.netTotal, tax: payload.tax, total: payload.totalWithTax,
        details: payload.detailsStr, paperNo: payload.paperNo, orderNo: payload.orderNo,
        status: '正常', historyLog: '[]'
    });
    
    payload.items.forEach((item, idx) => {
        globalSalesDetails.unshift({
            rowIdx: Date.now() + idx, time: payload.invDate, paperNo: payload.paperNo,
            client: payload.clientName, orderNo: payload.orderNo, name: item.name,
            qty: item.qty, unit: item.unit, price: item.price, subtotal: item.subtotal,
            shipStatus: '待出貨', shippedQty: 0, lot: '', expiry: ''
        });
    });
    
    if (payload.orderNo) {
        let orders = payload.orderNo.split(',').map(s=>s.trim());
        orders.forEach(oNo => {
            let po = globalOrders.find(o => o.orderNo === oNo);
            if(po && po.status !== '已結案') {
                po.status = '已結案';
                pushToSyncQueue('updateOrderStatus', { rowIdx: po.rowIdx, status: '已結案' });
            }
        });
    }
    
    pushToSyncQueue('submitInvoice', payload);
    showFinalInvoice(payload);
    goStep(5);
};

function showFinalInvoice(p) {
    const d = new Date(p.invDate);
    const m = d.getMonth() + 1;
    const y = d.getFullYear() - 1911;
    const mStr = m % 2 === 0 ? `${m-1}-${m}月份` : `${m}-${m+1}月份`;
    
    document.getElementById('visBuyer').innerText = p.clientName;
    document.getElementById('visTaxId').innerText = p.taxId || '';
    document.getElementById('visPaperNo').innerText = p.paperNo;
    document.getElementById('visInvDate').innerText = `中華民國 ${y} 年 ${mStr} ${d.getDate()} 日`;
    
    document.getElementById('visTbody').innerHTML = p.items.map(i => `<tr><td class="text-start">${escapeQuotes(i.name)}</td><td>${i.qty}</td><td class="text-end">${Math.round(i.price).toLocaleString()}</td><td class="text-end">${Math.round(i.subtotal).toLocaleString()}</td><td></td></tr>`).join('');
    
    document.getElementById('visNet').innerText = Math.round(p.netTotal).toLocaleString();
    document.getElementById('visTax').innerText = Math.round(p.tax).toLocaleString();
    document.getElementById('visTotal').innerText = Math.round(p.totalWithTax).toLocaleString();
}

window.resetInvoiceSystem = function() {
    currentInvoiceData = { clientName:'', taxId:'', items:[] };
    document.getElementById('invClientInput').value = "";
    document.getElementById('invClientInfo').style.display = "none";
    document.getElementById('btnNext1').style.display = "none";
    document.getElementById('invOrderNo').value = "";
    document.getElementById('invPaperNo').value = "";
    document.getElementById('invAiNotice').style.display = "none";
    goStep(1);
};
