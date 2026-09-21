/**
 * ============================================================================
 * 模組 5：估價單管理模組 (module_quotation.js)
 * ============================================================================
 */

function renderQuotationList() {
    const listPending = document.getElementById('quoPendingListContainer');
    const listVerified = document.getElementById('quoVerifiedListContainer');
    if (!listPending || !listVerified) return;

    const kw = document.getElementById('quoSearchInput') ? document.getElementById('quoSearchInput').value.toLowerCase().trim() : '';
    
    // 取消跨越合併限制，顯示所有獨立或母合併單
    let displayQuotes = globalQuotes.filter(q => !q.mergeId || q.mergeId === q.quoteNo);
    
    if(kw) {
        displayQuotes = displayQuotes.filter(q => 
            (q.quoteNo && q.quoteNo.toLowerCase().includes(kw)) ||
            (q.client && q.client.toLowerCase().includes(kw)) ||
            (q.jsonStr && q.jsonStr.toLowerCase().includes(kw))
        );
    }

    const pending = displayQuotes.filter(q => q.status === '待確認' || q.status === '處理中');
    const verified = displayQuotes.filter(q => q.status !== '待確認' && q.status !== '處理中');

    listPending.innerHTML = buildQuotationListHTML(pending, true);
    listVerified.innerHTML = buildQuotationListHTML(verified, false);
}

function buildQuotationListHTML(dataArr, isPending) {
    if(dataArr.length === 0) return '<div class="text-center text-muted p-3">沒有符合的估價單資料</div>';
    
    return dataArr.map(q => {
        let items = [];
        try { items = JSON.parse(q.jsonStr || '[]'); } catch(e){}
        const dateStr = q.quoteDate ? q.quoteDate.substring(0,10) : '';
        const total = items.reduce((sum, item) => sum + (Number(item.qty)*Number(item.price)), 0);
        
        let subItemsStr = items.map(i => `${i.name} (x${i.qty})`).join(', ');
        if(subItemsStr.length > 50) subItemsStr = subItemsStr.substring(0, 50) + '...';

        const mergeBadge = q.mergeId === q.quoteNo ? `<span class="badge bg-primary ms-2">🔗 已合併群組</span>` : '';
        const statusColor = q.status === '作廢' ? 'danger' : (q.status === '已核銷' ? 'success' : 'warning');
        
        let checkboxHtml = '';
        if (isPending) {
            checkboxHtml = `<input class="form-check-input quo-checkbox" type="checkbox" value="${q.quoteNo}" style="transform: scale(1.3); cursor: pointer;" onclick="event.stopPropagation()">`;
        }

        return `
        <div class="bg-white border rounded p-3 mb-2 shadow-sm d-flex justify-content-between align-items-center" onclick="openQuotationModal(${q.rowIdx})" style="cursor:pointer; transition: 0.2s;">
            <div class="d-flex align-items-center gap-3">
                ${checkboxHtml}
                <div>
                    <div class="fw-bold fs-5 text-dark">
                        ${q.client} 
                        <span class="badge bg-${statusColor} ms-2 fs-6 align-middle">${q.status || '待確認'}</span>
                        ${mergeBadge}
                    </div>
                    <div class="text-muted small mt-1">單號: ${q.quoteNo} | 日期: ${dateStr}</div>
                    <div class="text-secondary small mt-1 text-truncate" style="max-width: 300px;">明細: ${subItemsStr}</div>
                </div>
            </div>
            <div class="text-end">
                <div class="fw-bold text-danger fs-5">$${Math.round(total).toLocaleString()}</div>
                <div class="small text-muted mt-1">含稅總計</div>
            </div>
        </div>`;
    }).join('');
}

// ============================================================================
// 【升級】打開編輯視窗 (加入申請單位解析)
// ============================================================================
window.openQuotationModal = function(rowIdx) {
    currentQuoItems = [];
    document.getElementById('e_quoRow').value = rowIdx || '';
    
    if (rowIdx) {
        const quo = globalQuotes.find(q => q.rowIdx === rowIdx);
        if (quo) {
            // 嘗試解析備註中的申請單位 (向下相容)
            let parsedDept = '';
            let pureMemo = quo.memo || '';
            if (pureMemo.startsWith('單位:[')) {
                let endIdx = pureMemo.indexOf(']');
                if (endIdx > -1) {
                    parsedDept = pureMemo.substring(4, endIdx);
                    pureMemo = pureMemo.substring(endIdx + 1).trim();
                }
            }

            document.getElementById('e_quoDate').value = quo.quoteDate ? quo.quoteDate.substring(0,10) : '';
            document.getElementById('e_quoNo').value = quo.quoteNo || '';
            document.getElementById('e_quoClient').value = quo.client || '';
            document.getElementById('e_quoDept').value = parsedDept;
            document.getElementById('e_quoMemo').value = pureMemo;
            document.getElementById('e_quoUseSeal').checked = quo.useSeal;
            
            try { currentQuoItems = JSON.parse(quo.jsonStr || '[]'); } catch(e){}
        }
    } else {
        document.getElementById('e_quoDate').value = getTodayStr();
        document.getElementById('e_quoNo').value = generateQuoteNo();
        document.getElementById('e_quoClient').value = '';
        document.getElementById('e_quoDept').value = '';
        document.getElementById('e_quoMemo').value = '';
        document.getElementById('e_quoUseSeal').checked = true;
    }

    reRenderQuotationItems();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editQuoModal')).show();
};

function generateQuoteNo() {
    const d = new Date();
    const y = String(d.getFullYear()).substring(2);
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const todayStr = y + m + day;
    
    const todayQuotes = globalQuotes.filter(q => (q.quoteNo||'').startsWith(todayStr));
    const nextSeq = String(todayQuotes.length + 1).padStart(3, '0');
    return todayStr + nextSeq;
}

window.selectClientForQuotation = function(clientName) {
    document.getElementById('e_quoClient').value = clientName;
    document.getElementById('e_quoClient').classList.remove('is-invalid');
    
    const clientData = globalClients.find(c => c.name === clientName);
    if(clientData) {
        if(currentQuoItems.length === 0) {
            autoLoadCatalogForQuotation(clientName);
        } else {
            recheckQuotationPrices(clientName);
        }
    }
};

function autoLoadCatalogForQuotation(clientName) {
    const items = globalCatalog.filter(c => c.clientName === clientName);
    currentQuoItems = items.map(i => ({
        id: 'Q_' + Date.now() + Math.random().toString(36).substr(2,5),
        name: i.productName,
        internalCode: i.internalCode || '',
        qty: 0,
        unit: i.unit || '式',
        price: i.price || 0,
        remark: ''
    }));
    reRenderQuotationItems();
}

function recheckQuotationPrices(clientName) {
    currentQuoItems.forEach(item => {
        const matched = globalCatalog.find(c => c.clientName === clientName && c.productName === item.name);
        if(matched) {
            item.price = matched.price;
        }
    });
    reRenderQuotationItems();
}

window.addQuotationManualItemRow = function() {
    currentQuoItems.push({
        id: 'Q_' + Date.now() + Math.random().toString(36).substr(2,5),
        name: '', internalCode: '', qty: 1, unit: '式', price: 0, remark: ''
    });
    reRenderQuotationItems();
};

window.removeQuoItem = function(id) {
    currentQuoItems = currentQuoItems.filter(x => x.id !== id);
    reRenderQuotationItems();
};

window.reRenderQuotationItems = function() {
    const c = document.getElementById('e_quoItemsContainer');
    if(currentQuoItems.length === 0) {
        c.innerHTML = '<div class="alert alert-secondary text-center small py-2">尚未加入任何品項</div>';
        return;
    }
    
    let total = 0;
    const html = currentQuoItems.map((it, idx) => {
        const subtotal = (Number(it.qty) || 0) * (Number(it.price) || 0);
        total += subtotal;
        return `
        <div class="row g-2 align-items-center mb-2 pb-2 border-bottom draggable-row" draggable="true" ondragstart="handleDragStart(event, '${it.id}', 'quotation')" ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${it.id}', 'quotation')">
            <div class="col-auto" style="cursor: grab; color: #adb5bd;">⋮⋮</div>
            <div class="col-3">
                <input type="text" class="form-control form-control-sm fw-bold" placeholder="品名" value="${escapeQuotes(it.name)}" oninput="updateQuoItem('${it.id}', 'name', this.value)">
                <input type="text" class="form-control form-control-sm text-primary mt-1" style="font-size: 0.75rem;" placeholder="長固代號(選填)" value="${escapeQuotes(it.internalCode)}" oninput="updateQuoItem('${it.id}', 'internalCode', this.value)">
            </div>
            <div class="col-2">
                <input type="number" class="form-control form-control-sm text-center fw-bold text-danger" placeholder="數量" value="${it.qty}" oninput="updateQuoItem('${it.id}', 'qty', this.value)">
            </div>
            <div class="col-2">
                <input type="text" class="form-control form-control-sm text-center" placeholder="單位" value="${escapeQuotes(it.unit)}" oninput="updateQuoItem('${it.id}', 'unit', this.value)">
            </div>
            <div class="col-2">
                <input type="number" class="form-control form-control-sm text-end fw-bold" placeholder="單價(含稅)" value="${it.price}" oninput="updateQuoItem('${it.id}', 'price', this.value)">
            </div>
            <div class="col-2">
                <input type="text" class="form-control form-control-sm" placeholder="備註" value="${escapeQuotes(it.remark)}" oninput="updateQuoItem('${it.id}', 'remark', this.value)">
            </div>
            <div class="col-auto">
                <button class="btn btn-sm btn-outline-danger" onclick="removeQuoItem('${it.id}')">✖</button>
            </div>
            <div class="col-12 text-end text-muted small mt-1">
                小計: <strong class="text-danger">$${Math.round(subtotal).toLocaleString()}</strong>
            </div>
        </div>
        `;
    }).join('');
    
    c.innerHTML = html + `
    <div class="text-end mt-3 fs-5">
        總計 (含稅): <strong class="text-danger fw-bold">$${Math.round(total).toLocaleString()}</strong>
    </div>`;
};

window.updateQuoItem = function(id, field, val) {
    const it = currentQuoItems.find(x => x.id === id);
    if(it) {
        if(field === 'qty' || field === 'price') it[field] = Number(val) || 0;
        else it[field] = val;
    }
};

// ============================================================================
// 【升級】儲存估價單 (處理申請單位同步)
// ============================================================================
window.saveEditQuotation = function() {
    const client = document.getElementById('e_quoClient').value.trim();
    if(!client) {
        document.getElementById('e_quoClient').classList.add('is-invalid');
        return alert("請選擇客戶名稱！");
    }
    
    // 過濾數量大於 0 的品項
    const validItems = currentQuoItems.filter(x => Number(x.qty) > 0 && String(x.name).trim() !== '');
    if(validItems.length === 0) return alert("請至少輸入一項數量大於 0 的有效品項！");

    const rowIdx = document.getElementById('e_quoRow').value;
    const isNew = !rowIdx;
    
    const quoNo = document.getElementById('e_quoNo').value.trim() || generateQuoteNo();
    const quoteDate = document.getElementById('e_quoDate').value || getTodayStr();
    let memo = document.getElementById('e_quoMemo').value.trim();
    const dept = document.getElementById('e_quoDept').value.trim();
    
    // 【升級】檢查並同步申請單位至客戶資料庫
    if (dept) {
        memo = `單位:[${dept}] ${memo}`.trim();
        const clientData = globalClients.find(c => c.name === client);
        if (clientData) {
            let deptList = (clientData.receiveDept || '').split(',').map(s => s.trim()).filter(s => s);
            if (!deptList.includes(dept)) {
                deptList.push(dept);
                clientData.receiveDept = deptList.join(', ');
                pushToSyncQueue('updateClientData', {
                    oldName: clientData.name,
                    newName: clientData.name,
                    taxId: clientData.taxId,
                    address: clientData.address,
                    receiveDept: clientData.receiveDept
                });
                console.log(`[自動同步] 已將新單位 ${dept} 加入客戶 ${client} 的收貨單位清單中`);
            }
        }
    }

    const payload = {
        rowIdx: isNew ? Date.now() : Number(rowIdx),
        quoteNo: quoNo,
        quoteDate: quoteDate,
        clientName: client,
        status: isNew ? '待確認' : globalQuotes.find(q => q.rowIdx == rowIdx).status,
        jsonStr: JSON.stringify(validItems),
        useSeal: document.getElementById('e_quoUseSeal').checked,
        staff: myName,
        memo: memo
    };

    if(isNew) {
        globalQuotes.unshift({
            rowIdx: payload.rowIdx, time: Date.now(), quoteNo: quoNo,
            quoteDate: quoteDate, client: client, status: '待確認',
            jsonStr: payload.jsonStr, useSeal: payload.useSeal, mergeId: quoNo,
            staff: myName, memo: memo
        });
    } else {
        const idx = globalQuotes.findIndex(q => q.rowIdx == rowIdx);
        if(idx > -1) {
            globalQuotes[idx].quoteNo = quoNo;
            globalQuotes[idx].quoteDate = quoteDate;
            globalQuotes[idx].client = client;
            globalQuotes[idx].jsonStr = payload.jsonStr;
            globalQuotes[idx].useSeal = payload.useSeal;
            globalQuotes[idx].memo = memo;
        }
    }

    pushToSyncQueue('saveQuotation', payload);
    bootstrap.Modal.getInstance(document.getElementById('editQuoModal')).hide();
    renderQuotationList();
    
    if(confirm("儲存成功！是否立即列印/預覽估價單？")) {
        setTimeout(() => printQuotation(payload.rowIdx), 500);
    }
};

window.groupMergeQuotations = function() {
    const checked = Array.from(document.querySelectorAll('#quoPendingListContainer .quo-checkbox:checked')).map(cb => cb.value);
    if (checked.length < 2) return alert("請至少勾選 2 張以上的估價單進行合併。");
    
    const targetQuotes = globalQuotes.filter(q => checked.includes(q.quoteNo));
    const firstClient = targetQuotes[0].client;
    if (!targetQuotes.every(q => q.client === firstClient)) {
        return alert("錯誤：只能合併相同客戶的估價單！");
    }

    const parentQuoteNo = targetQuotes[0].quoteNo;
    let allItems = [];
    
    targetQuotes.forEach(q => {
        let items = [];
        try { items = JSON.parse(q.jsonStr || '[]'); } catch(e){}
        items.forEach(it => {
            const exist = allItems.find(a => a.name === it.name && a.price === it.price);
            if (exist) { exist.qty = Number(exist.qty) + Number(it.qty); }
            else { allItems.push({...it}); }
        });
    });

    if(!confirm(`確定將這 ${checked.length} 張估價單，合併至群組主單號 [${parentQuoteNo}] 嗎？`)) return;

    targetQuotes.forEach(q => {
        q.mergeId = parentQuoteNo;
        if(q.quoteNo === parentQuoteNo) q.jsonStr = JSON.stringify(allItems);
    });

    pushToSyncQueue('mergeQuotations', { mergeId: parentQuoteNo, quoteNos: checked, mergedItemsJson: JSON.stringify(allItems) });
    renderQuotationList();
    showToast("✅ 估價單合併完成");
};

window.groupUnmergeQuotations = function() {
    const checked = Array.from(document.querySelectorAll('#quoPendingListContainer .quo-checkbox:checked')).map(cb => cb.value);
    if (checked.length === 0) return alert("請勾選要解除合併的母估價單。");
    
    const parentQuoteNo = checked[0];
    const relatedQuotes = globalQuotes.filter(q => q.mergeId === parentQuoteNo);
    
    if (relatedQuotes.length <= 1) return alert("該估價單目前並無與其他單據合併。");
    if(!confirm(`確定要解除單號 [${parentQuoteNo}] 的合併群組嗎？\n(解除後將恢復為各自獨立的狀態)`)) return;

    relatedQuotes.forEach(q => q.mergeId = q.quoteNo);
    
    pushToSyncQueue('unmergeQuotations', { mergeId: parentQuoteNo });
    renderQuotationList();
    showToast("✅ 已解除合併");
};

window.promptUpdateQuoStatus = function(rowIdx) {
    const quo = globalQuotes.find(q => q.rowIdx === rowIdx);
    if(!quo) return;
    
    let newStatus = prompt(`更新估價單 [${quo.quoteNo}] 狀態：\n請輸入：待確認、已核銷、作廢`, quo.status);
    if(!newStatus) return;
    newStatus = newStatus.trim();
    if(!['待確認','處理中','已核銷','作廢'].includes(newStatus)) return alert("無效的狀態");

    quo.status = newStatus;
    
    if (quo.mergeId && quo.mergeId !== quo.quoteNo) {
        globalQuotes.filter(q => q.mergeId === quo.mergeId).forEach(q => q.status = newStatus);
    }

    pushToSyncQueue('updateQuotationStatus', { quoteNo: quo.quoteNo, status: newStatus, mergeId: quo.mergeId });
    renderQuotationList();
    showToast(`✅ 狀態已更新為 ${newStatus}`);
};

window.openVoidQuotationItemsModal = function(rowIdx) {
    const quo = globalQuotes.find(q => q.rowIdx === rowIdx);
    if(!quo) return;
    
    document.getElementById('vq_rowIdx').value = rowIdx;
    
    let items = [];
    try { items = JSON.parse(quo.jsonStr || '[]'); } catch(e){}
    
    if (items.length === 0) return alert("該單據無品項");
    if (items.length === 1) return alert("估價單只剩一個品項，無法拆分。若客戶完全不需要，請直接將整張單據作廢。");
    
    const html = items.map((it, idx) => `
        <div class="form-check mb-2 p-2 border rounded bg-white" style="font-size: 1.1rem;">
            <input class="form-check-input ms-2 me-3" type="checkbox" value="${idx}" id="vq_cb_${idx}" style="transform: scale(1.5);">
            <label class="form-check-label fw-bold d-inline-block w-75" for="vq_cb_${idx}" style="cursor:pointer;">
                ${escapeQuotes(it.name)} <span class="text-danger ms-2">x ${it.qty}</span>
            </label>
        </div>
    `).join('');
    
    document.getElementById('vq_itemsList').innerHTML = html;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('voidQuoItemsModal')).show();
};

window.confirmVoidQuotationItems = function() {
    const rowIdx = Number(document.getElementById('vq_rowIdx').value);
    const quo = globalQuotes.find(q => q.rowIdx === rowIdx);
    if(!quo) return;
    
    const checkedIndices = Array.from(document.querySelectorAll('#vq_itemsList input:checked')).map(cb => Number(cb.value));
    if (checkedIndices.length === 0) return alert("請至少勾選一項");
    
    let items = [];
    try { items = JSON.parse(quo.jsonStr || '[]'); } catch(e){}
    
    if (checkedIndices.length === items.length) {
        alert("不能作廢全部品項！請直接更改該估價單狀態為「作廢」。");
        return;
    }
    
    if(!confirm("確定要將這些品項拆分並標記為作廢嗎？\n(原本的單據將只保留未勾選的品項，而作廢的品項將會產生一張附有 '-作廢' 字尾的新單據)")) return;
    
    const voidedItems = checkedIndices.map(idx => items[idx]);
    const keptItems = items.filter((_, idx) => !checkedIndices.includes(idx));
    
    quo.jsonStr = JSON.stringify(keptItems);
    
    const voidedQuote = {
        rowIdx: Date.now() + Math.floor(Math.random()*1000),
        time: Date.now(),
        quoteNo: quo.quoteNo + '-作廢',
        quoteDate: quo.quoteDate,
        client: quo.client,
        status: '作廢',
        jsonStr: JSON.stringify(voidedItems),
        useSeal: quo.useSeal,
        mergeId: quo.quoteNo + '-作廢',
        staff: quo.staff,
        memo: `從單號 ${quo.quoteNo} 拆分作廢`
    };
    globalQuotes.unshift(voidedQuote);

    pushToSyncQueue('splitAndVoidQuotationItems', {
        originalRowIdx: rowIdx,
        quoteNo: quo.quoteNo,
        keptItemsJson: JSON.stringify(keptItems),
        voidedQuote: voidedQuote
    });

    bootstrap.Modal.getInstance(document.getElementById('voidQuoItemsModal')).hide();
    renderQuotationList();
    showToast("✅ 已成功拆分作廢品項");
};

// ============================================================================
// 【升級】估價單列印與預覽 (加入申請單位顯示設計)
// ============================================================================
window.printQuotation = function(rowIdx) {
    const quo = globalQuotes.find(q => q.rowIdx === rowIdx);
    if(!quo) return alert("找不到估價單資料");
    
    const clientData = globalClients.find(c => c.name === quo.client) || { taxId: '', address: '' };
    
    let items = [];
    try { items = JSON.parse(quo.jsonStr || '[]'); } catch(e){}

    // 解析出申請單位 (相容舊有備註格式)
    let parsedDept = '';
    let pureMemo = quo.memo || '';
    if (pureMemo.startsWith('單位:[')) {
        let endIdx = pureMemo.indexOf(']');
        if (endIdx > -1) {
            parsedDept = pureMemo.substring(4, endIdx);
            pureMemo = pureMemo.substring(endIdx + 1).trim();
        }
    }

    const dateStr = quo.quoteDate ? quo.quoteDate.substring(0,10) : getTodayStr();
    let total = 0;
    
    const tbodyHtml = items.map((it, idx) => {
        const subtotal = (Number(it.qty) || 0) * (Number(it.price) || 0);
        total += subtotal;
        return `
        <tr>
            <td class="text-center py-2" style="border: 1px solid #333;">${idx+1}</td>
            <td class="py-2 px-2" style="border: 1px solid #333;">
                <div class="fw-bold fs-6">${it.name}</div>
                <div class="text-muted" style="font-size: 0.7rem;">${it.internalCode || ''}</div>
            </td>
            <td class="text-center py-2 fs-6" style="border: 1px solid #333;">${it.qty}</td>
            <td class="text-center py-2 fs-6" style="border: 1px solid #333;">${it.unit}</td>
            <td class="text-end py-2 px-2 fs-6" style="border: 1px solid #333;">${Math.round(it.price).toLocaleString()}</td>
            <td class="text-end py-2 px-2 fw-bold text-danger fs-6" style="border: 1px solid #333;">${Math.round(subtotal).toLocaleString()}</td>
            <td class="py-2 px-2" style="border: 1px solid #333; font-size:0.8rem;">${it.remark || ''}</td>
        </tr>`;
    }).join('');

    // 【升級排版】在客戶名稱下方插入申請單位
    const deptHtml = parsedDept ? `<div style="font-size: 1.1rem; margin-top: 5px;"><strong>申請單位：</strong>${parsedDept}</div>` : '';

    const html = `
    <div style="width: 100%; max-width: 800px; margin: 0 auto; background: #fff; padding: 40px; box-sizing: border-box; font-family: 'Microsoft JhengHei', sans-serif; position: relative;">
        
        <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="margin: 0; font-size: 2.2rem; font-weight: bold; letter-spacing: 2px;">長固實業有限公司</h1>
            <div style="font-size: 1rem; color: #555; margin-top: 10px;">
                新北市三重區重新路五段609巷6號4樓<br>
                電話：(04) 2326-9591 &nbsp;&nbsp; 傳真：(04) 2326-8576<br>
                統一編號：86477073
            </div>
            <div style="font-size: 1.8rem; font-weight: bold; letter-spacing: 15px; margin-top: 20px; border-bottom: 3px double #333; display: inline-block; padding-bottom: 5px;">估價單</div>
        </div>
        
        <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
            <div style="flex: 1;">
                <div style="font-size: 1.3rem; margin-bottom: 5px;"><strong>客戶名稱：</strong>${quo.client}</div>
                ${deptHtml}
                <div style="border-top: 1px solid #333; width: 80%; margin: 8px 0;"></div>
                <div style="font-size: 1rem; color: #333;">統編：${clientData.taxId || '無'}</div>
                <div style="font-size: 1rem; color: #333;">地址：${clientData.address || ''}</div>
            </div>
            <div style="text-align: right; font-size: 1rem;">
                <div style="margin-bottom: 8px;"><strong>估價單號：</strong> ${quo.quoteNo}</div>
                <div style="margin-bottom: 8px;"><strong>報價日期：</strong> ${dateStr}</div>
                <div style="margin-bottom: 8px;"><strong>報價人員：</strong> ${quo.staff || '系統'}</div>
            </div>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
                <tr style="background-color: #f8f9fa;">
                    <th style="border: 1px solid #333; padding: 10px; width: 5%;">項次</th>
                    <th style="border: 1px solid #333; padding: 10px; width: 35%;">品名規格</th>
                    <th style="border: 1px solid #333; padding: 10px; width: 8%;">數量</th>
                    <th style="border: 1px solid #333; padding: 10px; width: 8%;">單位</th>
                    <th style="border: 1px solid #333; padding: 10px; width: 12%;">單價(含稅)</th>
                    <th style="border: 1px solid #333; padding: 10px; width: 15%;">總價</th>
                    <th style="border: 1px solid #333; padding: 10px; width: 17%;">備註</th>
                </tr>
            </thead>
            <tbody>
                ${tbodyHtml}
            </tbody>
        </table>
        
        <div style="display: flex; justify-content: flex-end; margin-bottom: 30px;">
            <div style="width: 300px; border: 2px solid #333; padding: 15px; border-radius: 8px; background: #fffaf0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 1.1rem;">
                    <span>銷售額：</span><span>$${Math.round(total / 1.05).toLocaleString()}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 1.1rem;">
                    <span>營業稅 (5%)：</span><span>$${Math.round(total - (total / 1.05)).toLocaleString()}</span>
                </div>
                <div style="border-top: 1px dashed #333; margin: 10px 0;"></div>
                <div style="display: flex; justify-content: space-between; font-size: 1.4rem; font-weight: bold; color: #dc3545;">
                    <span>總計金額：</span><span>$${Math.round(total).toLocaleString()}</span>
                </div>
            </div>
        </div>

        <div style="font-size: 1rem; line-height: 1.6; border: 1px solid #ddd; padding: 15px; background: #fdfdfd; border-left: 5px solid #6f42c1;">
            <div style="font-weight: bold; margin-bottom: 5px; color: #6f42c1;">備註事項：</div>
            ${pureMemo ? `<div style="margin-bottom:10px;">${pureMemo.replace(/\n/g, '<br>')}</div>` : ''}
            <div>1. 本報價單自開立日起 <strong style="color:red;">30天</strong> 內有效。</div>
            <div>2. 報價金額均 <strong style="color:red;">包含5%營業稅</strong>，訂單確認後請簽名回傳。</div>
        </div>

        ${quo.useSeal ? `
        <div style="position: absolute; bottom: 80px; right: 50px; z-index: 10;">
            <div style="position: relative; width: 150px; height: 150px;">
                <img src="seal_big.png" style="position: absolute; top: 0; left: 0; width: 120px; opacity: 0.85; transform: rotate(-5deg);" onerror="this.style.display='none'">
                <img src="seal_small.png" style="position: absolute; bottom: -10px; right: -10px; width: 50px; opacity: 0.9; transform: rotate(10deg);" onerror="this.style.display='none'">
            </div>
        </div>
        ` : ''}

        <div style="margin-top: 50px; display: flex; justify-content: space-between; border-top: 1px solid #ccc; padding-top: 20px; font-size: 1.1rem;">
            <div>客戶簽章確認：____________________</div>
            <div style="margin-right: 50px;">業務代表：${quo.staff || '系統'}</div>
        </div>

        <div style="margin-top: 20px; text-align: right;">
            <button class="btn btn-outline-secondary d-print-none btn-sm fw-bold" onclick="promptUpdateQuoStatus(${quo.rowIdx})">🔄 更改單據狀態</button>
            <button class="btn btn-outline-danger d-print-none btn-sm fw-bold ms-2" onclick="openVoidQuotationItemsModal(${quo.rowIdx})">✂️ 拆分作廢品項</button>
        </div>
    </div>
    `;

    document.getElementById('printQuoteArea').innerHTML = html;
    applyPrintStyle('A4', 'portrait');
    showPrintPreview('printQuoteArea');
};
