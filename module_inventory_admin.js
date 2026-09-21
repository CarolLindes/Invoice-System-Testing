/**
 * ============================================================================
 * 模組 4：庫存與管理員後台模組 (module_inventory_admin.js)
 * ============================================================================
 */

function renderInventory() {
    const kw = document.getElementById('stkSearch') ? document.getElementById('stkSearch').value.toLowerCase().trim() : '';
    const container = document.getElementById('stkListContainer');
    if(!container) return;

    let totalValue = 0;
    let alertCount = 0;

    let displayList = globalInventory.filter(item => {
        const val = (Number(item.qty)||0) * (Number(item.cost)||0);
        totalValue += val;
        if(Number(item.qty) <= Number(item.alertQty)) alertCount++;
        
        if(!kw) return true;
        return (item.name && item.name.toLowerCase().includes(kw)) ||
               (item.internalCode && item.internalCode.toLowerCase().includes(kw));
    });

    if(document.getElementById('stkTotalValue')) document.getElementById('stkTotalValue').innerText = `$${Math.round(totalValue).toLocaleString()}`;
    if(document.getElementById('stkAlertCount')) document.getElementById('stkAlertCount').innerText = `${alertCount} 項`;

    if(displayList.length === 0) {
        container.innerHTML = '<div class="text-center text-muted p-3">查無庫存資料</div>';
        return;
    }

    displayList.sort((a,b) => (a.qty - a.alertQty) - (b.qty - b.alertQty));

    container.innerHTML = displayList.map(it => {
        const isAlert = Number(it.qty) <= Number(it.alertQty);
        const cardClass = isAlert ? 'border-danger bg-light' : 'border-light';
        const textClass = isAlert ? 'text-danger fw-bold' : 'text-primary fw-bold';
        
        let batchesHtml = '';
        try {
            let batches = JSON.parse(it.batchesStr || '[]');
            if (batches.length > 0) {
                batchesHtml = `<div class="mt-2 pt-2 border-top border-secondary-subtle">
                    <div class="small text-muted fw-bold mb-1">批號與效期分布：</div>
                    ${batches.map(b => `<span class="badge bg-secondary me-1 mb-1">批號 ${b.lot||'無'} (效期 ${b.exp\vert{}\vert{}'無'}): ${b.qty}</span>`).join('')}
                </div>`;
            }
        } catch(e){}

        return `
        <div class="bg-white border rounded p-3 mb-2 shadow-sm ${cardClass}" onclick="openAdjustModal('${escapeQuotes(it.name)}')" style="cursor:pointer;">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <div class="fw-bold fs-5 text-dark">${it.name}</div>
                    <div class="small text-muted">長固代號：${it.internalCode || '無'}</div>
                    <div class="small text-muted">安全庫存：${it.alertQty} | 成本價：$${it.cost}</div>
                </div>
                <div class="text-end">
                    <div class="fs-3 ${textClass}">${it.qty}</div>
                    <div class="small text-muted">現有庫存</div>
                </div>
            </div>
            ${batchesHtml}
        </div>`;
    }).join('');
}

window.openAdjustModal = function(itemName) {
    document.getElementById('adjRowIdx').value = '';
    
    if(itemName) {
        const it = globalInventory.find(x => x.name === itemName);
        if(it) {
            document.getElementById('adjName').value = it.name;
            document.getElementById('adjInternalCode').value = it.internalCode || '';
            document.getElementById('adjAlert').value = it.alertQty;
            document.getElementById('adjCost').value = it.cost;
            document.getElementById('adjSup').value = it.supplier || '';
        }
    } else {
        document.getElementById('adjName').value = '';
        document.getElementById('adjInternalCode').value = '';
        document.getElementById('adjAlert').value = 0;
        document.getElementById('adjCost').value = 0;
        document.getElementById('adjSup').value = '';
    }
    
    document.getElementById('adjInvoiceNo').value = '';
    document.getElementById('adjArrivalDate').value = getTodayStr();
    document.getElementById('adjQty').value = '';
    document.getElementById('adjLot').value = '';
    document.getElementById('adjExp').value = '';
    document.getElementById('adjType').selectedIndex = 0;
    document.getElementById('adjMemo').value = '';

    bootstrap.Modal.getOrCreateInstance(document.getElementById('adjInvModal')).show();
};

window.selectProductForAdj = function(productName) {
    const it = globalInventory.find(x => x.name === productName);
    if(it) {
        document.getElementById('adjName').value = it.name;
        document.getElementById('adjInternalCode').value = it.internalCode || '';
        document.getElementById('adjAlert').value = it.alertQty;
        document.getElementById('adjCost').value = it.cost;
        document.getElementById('adjSup').value = it.supplier || '';
    } else {
        document.getElementById('adjName').value = productName;
        const catMatch = globalCatalog.find(c => c.productName === productName);
        document.getElementById('adjInternalCode').value = catMatch ? (catMatch.internalCode || '') : '';
    }
};

window.saveInventoryAdjust = function() {
    const name = document.getElementById('adjName').value.trim();
    const qtyChange = Number(document.getElementById('adjQty').value) || 0;
    
    if(!name) return alert("請選擇或輸入產品名稱");
    if(qtyChange === 0) return alert("異動數量不能為 0");

    const payload = {
        name: name,
        changeQty: qtyChange,
        type: document.getElementById('adjType').value,
        alertQty: Number(document.getElementById('adjAlert').value) || 0,
        cost: Number(document.getElementById('adjCost').value) || 0,
        supplier: document.getElementById('adjSup').value.trim(),
        lot: document.getElementById('adjLot').value.trim(),
        expiry: document.getElementById('adjExp').value,
        invoiceNo: document.getElementById('adjInvoiceNo').value.trim(),
        arrivalDate: document.getElementById('adjArrivalDate').value,
        memo: document.getElementById('adjMemo').value.trim(),
        internalCode: document.getElementById('adjInternalCode').value.trim(),
        staff: myName
    };

    let it = globalInventory.find(x => x.name === name);
    if(it) {
        it.qty = Number(it.qty) + qtyChange;
        it.alertQty = payload.alertQty;
        it.cost = payload.cost;
        it.supplier = payload.supplier;
        it.internalCode = payload.internalCode;
        
        let batches = [];
        try { batches = JSON.parse(it.batchesStr || '[]'); } catch(e){}
        if(payload.lot || payload.expiry) {
            let bIdx = batches.findIndex(b => b.lot === payload.lot && b.exp === payload.expiry);
            if(bIdx >= 0) {
                batches[bIdx].qty += qtyChange;
            } else {
                batches.push({lot: payload.lot, exp: payload.expiry, qty: qtyChange});
            }
        }
        it.batchesStr = JSON.stringify(batches);
    } else {
        let newBatches = [];
        if(payload.lot || payload.expiry) {
            newBatches.push({lot: payload.lot, exp: payload.expiry, qty: qtyChange});
        }
        globalInventory.push({
            name: name, qty: qtyChange, alertQty: payload.alertQty,
            cost: payload.cost, supplier: payload.supplier,
            internalCode: payload.internalCode, batchesStr: JSON.stringify(newBatches)
        });
    }

    pushToSyncQueue('adjustInventory', payload);
    
    bootstrap.Modal.getInstance(document.getElementById('adjInvModal')).hide();
    renderInventory();
    showToast("✅ 庫存異動已儲存");
};

// ============================================================================
// 【升級】欠貨出貨模組 (修復出貨邏輯，並橋接送貨單模組)
// ============================================================================
function renderShipments() {
    const container = document.getElementById('stkShipContainer');
    if(!container) return;

    let arr = globalSalesDetails.filter(x => x.shipStatus !== '已結案' && x.shipStatus !== '已送貨' && x.shipStatus !== '作廢');
    
    const kw = document.getElementById('stkShipSearch') ? document.getElementById('stkShipSearch').value.toLowerCase().trim() : '';
    const fClient = document.getElementById('stkShipFilterClient') ? document.getElementById('stkShipFilterClient').value : '';
    const fName = document.getElementById('stkShipFilterName') ? document.getElementById('stkShipFilterName').value : '';

    let clientSet = new Set();
    let nameSet = new Set();
    arr.forEach(a => { if(a.client) clientSet.add(a.client); if(a.name) nameSet.add(a.name); });
    
    const dClient = document.getElementById('stkShipFilterClient');
    if (dClient && dClient.options.length <= 1) {
        Array.from(clientSet).sort().forEach(c => dClient.add(new Option(c, c)));
    }
    const dName = document.getElementById('stkShipFilterName');
    if (dName && dName.options.length <= 1) {
        Array.from(nameSet).sort().forEach(n => dName.add(new Option(n, n)));
    }

    if(kw) arr = arr.filter(x => (x.paperNo && x.paperNo.toLowerCase().includes(kw)) || (x.client && x.client.toLowerCase().includes(kw)) || (x.name && x.name.toLowerCase().includes(kw)) || (x.orderNo && x.orderNo.toLowerCase().includes(kw)));
    if(fClient) arr = arr.filter(x => x.client === fClient);
    if(fName) arr = arr.filter(x => x.name === fName);

    if(arr.length === 0) {
        container.innerHTML = '<div class="text-center text-muted p-3 border rounded bg-light">目前無待出貨或欠貨品項</div>';
        return;
    }

    container.innerHTML = arr.map(it => {
        const shipped = Number(it.shippedQty) || 0;
        const total = Number(it.qty) || 0;
        const remain = total - shipped;
        
        let invMatch = globalInventory.find(x => x.name === it.name);
        const currentStock = invMatch ? Number(invMatch.qty) : 0;
        const stockHtml = currentStock >= remain 
            ? `<span class="badge bg-success ms-2">庫存充足: ${currentStock}</span>`
            : `<span class="badge bg-danger ms-2">庫存不足: ${currentStock}</span>`;

        return `
        <div class="bg-white border rounded p-3 mb-2 shadow-sm border-start border-4 border-warning">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                    <span class="badge bg-warning text-dark mb-1">${it.shipStatus || '待出貨'}</span>
                    <div class="small text-muted">客戶：<span class="fw-bold text-dark">${it.client}</span></div>
                    <div class="small text-muted">發票號碼：${it.paperNo || '無'}</div>
                    ${it.orderNo ? `<div class="small text-muted">訂單號碼：${it.orderNo}</div>` : ''}
                </div>
                <div class="text-end">
                    <button class="btn btn-sm btn-primary fw-bold mb-1 shadow-sm w-100" onclick="openShipModal(${it.rowIdx})">出貨</button>
                    <button class="btn btn-sm btn-outline-warning text-dark fw-bold w-100 mt-1" onclick="openPurchaseOrderModal('${escapeQuotes(it.name)}', '${escapeQuotes(it.client)}')">訂貨</button>
                </div>
            </div>
            <div class="fw-bold fs-6 text-dark mt-2 pt-2 border-top">${it.name} ${stockHtml}</div>
            <div class="d-flex justify-content-between mt-2 align-items-center">
                <span class="small text-muted">訂購: ${total} | 已出: ${shipped}</span>
                <span class="fw-bold text-danger">尚欠: ${remain} ${it.unit}</span>
            </div>
        </div>`;
    }).join('');
}

window.openShipModal = function(rowIdx) {
    const sd = globalSalesDetails.find(x => x.rowIdx === rowIdx);
    if(!sd) return;

    document.getElementById('shipRowIdx').value = rowIdx;
    document.getElementById('shipItemName').innerText = sd.name;
    
    const shipped = Number(sd.shippedQty) || 0;
    const total = Number(sd.qty) || 0;
    const remain = total - shipped;

    document.getElementById('shipTotalQty').innerText = total;
    document.getElementById('shipDoneQty').innerText = shipped;
    document.getElementById('shipRemainQty').innerText = remain;
    document.getElementById('shipNowQty').value = remain;

    const bs = document.getElementById('shipBatchSelect');
    bs.innerHTML = '<option value="">(不指定批號先出貨)</option>';
    
    const invMatch = globalInventory.find(x => x.name === sd.name);
    if(invMatch) {
        try {
            const batches = JSON.parse(invMatch.batchesStr || '[]');
            batches.forEach(b => {
                if(b.qty > 0) {
                    bs.add(new Option(`批號: ${b.lot||'無'} (效期: ${b.exp||'無'}) [庫存: ${b.qty}]`, b.lot));
                }
            });
        } catch(e){}
    }
    updateShipBatchInfo();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('shipModal')).show();
};

window.updateShipBatchInfo = function() {
    const lot = document.getElementById('shipBatchSelect').value;
    const name = document.getElementById('shipItemName').innerText;
    const invMatch = globalInventory.find(x => x.name === name);
    
    if(lot && invMatch) {
        try {
            const batches = JSON.parse(invMatch.batchesStr || '[]');
            const b = batches.find(x => x.lot === lot);
            if(b) {
                document.getElementById('shipBatchExp').innerText = b.exp || '無效期';
                document.getElementById('shipBatchStock').innerText = b.qty;
                document.getElementById('shipNowQty').max = b.qty;
                return;
            }
        } catch(e){}
    }
    document.getElementById('shipBatchExp').innerText = '--';
    document.getElementById('shipBatchStock').innerText = invMatch ? invMatch.qty : 0;
    document.getElementById('shipNowQty').max = invMatch ? invMatch.qty : 0;
};

// 【升級】扣庫並自動拋轉送貨單
window.confirmShipment = function() {
    const rowIdx = Number(document.getElementById('shipRowIdx').value);
    const sd = globalSalesDetails.find(x => x.rowIdx === rowIdx);
    if(!sd) return;

    const qty = Number(document.getElementById('shipNowQty').value);
    const remain = (Number(sd.qty)||0) - (Number(sd.shippedQty)||0);
    const targetLot = document.getElementById('shipBatchSelect').value;

    if(qty <= 0) return alert("出貨數量必須大於 0");
    if(qty > remain) return alert(`出貨數量不能大於尚欠數量 (${remain})`);

    const invMatch = globalInventory.find(x => x.name === sd.name);
    let targetExp = '';
    
    if(invMatch) {
        const currentStock = Number(invMatch.qty) || 0;
        if(qty > currentStock) {
            if(!confirm(`⚠️ 系統庫存不足！目前庫存僅剩 ${currentStock}，但您即將出貨 ${qty}。\n確定要強制扣庫嗎？（庫存將變成負數）`)) return;
        }
        
        if (targetLot) {
            try {
                const batches = JSON.parse(invMatch.batchesStr || '[]');
                const b = batches.find(x => x.lot === targetLot);
                if (b) targetExp = b.exp;
            } catch(e){}
        }

        // 樂觀更新庫存
        invMatch.qty = currentStock - qty;
        if (targetLot) {
            try {
                let batches = JSON.parse(invMatch.batchesStr || '[]');
                let bIdx = batches.findIndex(x => x.lot === targetLot);
                if (bIdx >= 0) batches[bIdx].qty -= qty;
                batches = batches.filter(b => b.qty > 0);
                invMatch.batchesStr = JSON.stringify(batches);
            } catch(e){}
        }
    }

    // 樂觀更新明細
    sd.shippedQty = (Number(sd.shippedQty)||0) + qty;
    sd.shipStatus = sd.shippedQty >= sd.qty ? '已結案' : '部分出貨';

    const updates = [{
        rowIdx: sd.rowIdx,
        name: sd.name,
        shipQty: qty,
        paperNo: sd.paperNo || sd.orderNo || '無單號',
        batchTarget: targetLot
    }];

    // 1. 發送扣庫指令
    pushToSyncQueue('updateShipment', { updates: updates, staff: myName });

    // 2. 【全新升級】發送拋轉送貨單指令
    const deliveryPayload = {
        deliveries: [{
            client: sd.client,
            paperNo: sd.paperNo || '無發票',
            orderNo: sd.orderNo || '',
            itemsStr: JSON.stringify([{
                name: sd.name,
                qty: qty,
                unit: sd.unit || '式'
            }]),
            method: '',
            date: '',
            staff: myName,
            memo: targetLot ? `批號: ${targetLot}` : '',
            lot: targetLot || '',
            expiry: targetExp || '',
            sourceIndices: [sd.rowIdx] // 標記來源，防止重複送貨
        }]
    };
    
    // 短暫延遲後送出送貨單建立指令
    setTimeout(() => {
        pushToSyncQueue('batchExecuteDeliveries', deliveryPayload);
        showToast("✅ 已成功出貨，並拋轉至待送貨區");
    }, 1000);

    bootstrap.Modal.getInstance(document.getElementById('shipModal')).hide();
    renderShipments();
    renderInventory();
};

window.openPurchaseOrderModal = function(itemName, clientName) {
    document.getElementById('poDate').value = getTodayStr();
    document.getElementById('poItemName').value = itemName;
    document.getElementById('poOrderNo').value = '';
    
    document.getElementById('poSupplier').value = '';
    document.getElementById('poSupPhone').value = '';
    document.getElementById('poSupFax').value = '';
    document.getElementById('poUnitPrice').value = '';
    
    const catMatch = globalCatalog.find(c => c.productName === itemName);
    document.getElementById('poInternalCode').value = catMatch ? (catMatch.internalCode || '') : '';
    
    const invMatch = globalInventory.find(x => x.name === itemName);
    if(invMatch && invMatch.supplier) {
        document.getElementById('poSupplier').value = invMatch.supplier;
        const supMatch = globalSuppliers.find(s => s.name === invMatch.supplier);
        if(supMatch) {
            document.getElementById('poSupPhone').value = supMatch.phone || '';
            document.getElementById('poSupFax').value = supMatch.fax || '';
        }
    }

    const cSelect = document.getElementById('poClientName');
    cSelect.innerHTML = '<option value="">(自訂/無指定客戶)</option>';
    globalClients.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
        cSelect.add(new Option(c.name, c.name));
    });
    
    if(clientName) {
        cSelect.value = clientName;
        triggerPoClientChange(clientName);
    } else {
        triggerPoClientChange('');
    }

    document.getElementById('poQty').value = '';
    document.getElementById('poMemo').value = '';

    bootstrap.Modal.getOrCreateInstance(document.getElementById('purchaseOrderModal')).show();
};

window.triggerPoClientChange = function(clientName) {
    const deptSelect = document.getElementById('poReceiveDept');
    const addrInput = document.getElementById('poAddress');
    deptSelect.innerHTML = '<option value="">無指定單位</option>';
    addrInput.value = '';

    if(!clientName) return;

    const cMatch = globalClients.find(c => c.name === clientName);
    if(cMatch) {
        addrInput.value = cMatch.address || '';
        if(cMatch.receiveDept) {
            const depts = cMatch.receiveDept.split(',').map(s=>s.trim()).filter(s=>s);
            depts.forEach(d => deptSelect.add(new Option(d, d)));
        }
    }
};

window.confirmPurchaseOrder = function() {
    const qty = document.getElementById('poQty').value;
    if(!qty || Number(qty) <= 0) return alert("請輸入有效的訂貨數量");

    const payload = {
        name: document.getElementById('poItemName').value,
        qty: Number(qty),
        supplier: document.getElementById('poSupplier').value,
        client: document.getElementById('poClientName').value,
        dept: document.getElementById('poReceiveDept').value,
        address: document.getElementById('poAddress').value,
        memo: document.getElementById('poMemo').value,
        orderNo: document.getElementById('poOrderNo').value,
        date: document.getElementById('poDate').value,
        price: Number(document.getElementById('poUnitPrice').value) || 0,
        staff: myName
    };

    pushToSyncQueue('submitPurchaseOrder', payload);
    
    bootstrap.Modal.getInstance(document.getElementById('purchaseOrderModal')).hide();
    showToast("✅ 已儲存訂購單資料");
    
    if(confirm("是否立即列印/預覽向廠商叫貨的「訂購單」？")) {
        printPurchaseOrder(payload);
    }
};

window.printPurchaseOrder = function(data) {
    const today = getTodayStr();
    
    let supPhone = document.getElementById('poSupPhone').value || '';
    let supFax = document.getElementById('poSupFax').value || '';
    
    const subtotal = data.price * data.qty;

    const html = `
    <div style="width: 100%; max-width: 800px; margin: 0 auto; background: #fff; padding: 40px; box-sizing: border-box; font-family: 'Microsoft JhengHei', sans-serif;">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="margin: 0; font-size: 24px; font-weight: bold;">長固實業有限公司</h1>
            <div style="font-size: 14px; margin-top: 5px;">
                統一編號：86477073<br>
                電話：(04) 2326-9591 &nbsp;&nbsp; 傳真：(04) 2326-8576<br>
                公司地址：台中市西區中美街639號<br>
                發票地址：新北市三重區重新路5段609巷6號4樓
            </div>
            <div style="font-size: 22px; font-weight: bold; letter-spacing: 5px; margin-top: 20px; border-bottom: 2px solid #000; display: inline-block; padding-bottom: 5px;">
                訂購單 (Purchase Order)
            </div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 15px;">
            <div style="line-height: 1.8;">
                <div><strong>供應商名稱：</strong> ${data.supplier || '未指定'}</div>
                <div><strong>連絡電話：</strong> ${supPhone}</div>
                <div><strong>傳真號碼：</strong> ${supFax}</div>
            </div>
            <div style="line-height: 1.8; text-align: right;">
                <div><strong>訂單號碼：</strong> ${data.orderNo || '(未填寫)'}</div>
                <div><strong>訂購日期：</strong> ${data.date || today}</div>
                <div><strong>採購人員：</strong> ${data.staff}</div>
            </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; text-align: center;">
            <thead>
                <tr style="background-color: #f2f2f2;">
                    <th style="border: 1px solid #000; padding: 10px; width: 10%;">項次</th>
                    <th style="border: 1px solid #000; padding: 10px; width: 45%;">品名規格</th>
                    <th style="border: 1px solid #000; padding: 10px; width: 15%;">數量</th>
                    <th style="border: 1px solid #000; padding: 10px; width: 15%;">單價</th>
                    <th style="border: 1px solid #000; padding: 10px; width: 15%;">小計</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="border: 1px solid #000; padding: 10px;">1</td>
                    <td style="border: 1px solid #000; padding: 10px; text-align: left;">${data.name}</td>
                    <td style="border: 1px solid #000; padding: 10px;">${data.qty}</td>
                    <td style="border: 1px solid #000; padding: 10px;">${data.price > 0 ? '$' + data.price.toLocaleString() : '--'}</td>
                    <td style="border: 1px solid #000; padding: 10px;">${subtotal > 0 ? '$' + subtotal.toLocaleString() : '--'}</td>
                </tr>
            </tbody>
        </table>

        <div style="border: 1px solid #000; padding: 15px; margin-bottom: 30px; font-size: 15px; line-height: 1.6; background-color: #fdfdfd;">
            <div style="font-weight: bold; margin-bottom: 5px;">送貨指示與備註：</div>
            <div><strong>指定收件方：</strong> ${data.client || '長固台中公司'} ${data.dept ? ' - ' + data.dept : ''}</div>
            <div><strong>送貨地址：</strong> ${data.address || '台中市西區中美街639號'}</div>
            ${data.memo ? `<div style="margin-top: 10px; color: #d9534f;"><strong>特別備註：</strong> ${data.memo}</div>` : ''}
        </div>

        <div style="display: flex; justify-content: space-between; margin-top: 60px; font-size: 16px;">
            <div>供應商簽章確認：___________________</div>
            <div>長固主管簽章：___________________</div>
        </div>
    </div>`;

    document.getElementById('printPoArea').innerHTML = html;
    applyPrintStyle('A4', 'portrait');
    showPrintPreview('printPoArea');
};

// ============================================================================
// 異動紀錄 (支援備註編輯與換批號)
// ============================================================================
function renderInvLogs() {
    const container = document.getElementById('stkLogContainer');
    if(!container) return;

    let arr = [...globalInvLogs];
    
    const kw = document.getElementById('stkLogSearch') ? document.getElementById('stkLogSearch').value.toLowerCase().trim() : '';
    const fIn = document.getElementById('logFilterIn') ? document.getElementById('logFilterIn').value : '';
    const fOut = document.getElementById('logFilterOut') ? document.getElementById('logFilterOut').value : '';
    const fStart = document.getElementById('logFilterStart') ? document.getElementById('logFilterStart').value : '';
    const fEnd = document.getElementById('logFilterEnd') ? document.getElementById('logFilterEnd').value : '';
    const fName = document.getElementById('logFilterName') ? document.getElementById('logFilterName').value : '';

    if(kw) arr = arr.filter(x => (x.name && x.name.toLowerCase().includes(kw)) || (x.staff && x.staff.toLowerCase().includes(kw)) || (x.memo && x.memo.toLowerCase().includes(kw)) || (x.invoiceNo && x.invoiceNo.toLowerCase().includes(kw)) || (x.orderNo && x.orderNo.toLowerCase().includes(kw)));
    
    if(fIn && !fOut) arr = arr.filter(x => x.type === fIn);
    if(fOut && !fIn) arr = arr.filter(x => x.type === fOut);
    if(fIn && fOut) arr = arr.filter(x => x.type === fIn || x.type === fOut);

    if(fStart) { const tStart = new Date(fStart).getTime(); arr = arr.filter(x => x.time >= tStart); }
    if(fEnd) { const tEnd = new Date(fEnd).getTime() + 86399999; arr = arr.filter(x => x.time <= tEnd); }
    if(fName) arr = arr.filter(x => x.name === fName);

    if(arr.length === 0) {
        container.innerHTML = '<div class="text-center text-muted p-3">查無異動紀錄</div>';
        return;
    }

    container.innerHTML = arr.map(it => {
        const dStr = it.time ? new Date(it.time).toLocaleString() : '';
        const isAdd = Number(it.qtyChange) > 0;
        const color = isAdd ? 'text-success' : 'text-danger';
        const sign = isAdd ? '+' : '';
        const badgeColor = isAdd ? 'bg-info text-white' : 'bg-warning text-dark';
        
        let batchBtnHtml = '';
        if(!isAdd && (it.type === '出貨扣抵' || it.type === '分批出貨' || it.type === '出貨扣抵(新建)')) {
            batchBtnHtml = `<button class="btn btn-sm btn-outline-warning text-dark px-2 py-0 border-dashed ms-2" onclick="openEditBatchModal(${it.rowIdx})" title="修改出貨批號">✏️ 換批號</button>`;
        }

        return `
        <div class="bg-white border rounded p-3 mb-2 shadow-sm">
            <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
                <div class="small text-muted">${dStr} | 操作：${it.staff}</div>
                <button class="btn btn-sm btn-outline-secondary px-2 py-0" onclick="openEditInvLogModal(${it.rowIdx})">📝 編輯備註</button>
            </div>
            <div class="d-flex justify-content-between">
                <div>
                    <div class="fw-bold fs-6 text-dark">${it.name}</div>
                    <div class="mt-1">
                        <span class="badge ${badgeColor}">${it.type}</span>
                        ${it.lot ? `<span class="badge bg-secondary ms-1">批號: ${it.lot}</span>` : ''}
                        ${batchBtnHtml}
                    </div>
                </div>
                <div class="text-end">
                    <div class="fs-4 fw-bold ${color}">${sign}${it.qtyChange}</div>
                    <div class="small text-muted">結存：${it.newQty}</div>
                </div>
            </div>
            ${it.invoiceNo ? `<div class="small text-muted mt-2">進貨發票：${it.invoiceNo}</div>` : ''}
            ${it.orderNo ? `<div class="small text-muted mt-1">單號：${it.orderNo}</div>` : ''}
            ${it.memo ? `<div class="small text-danger mt-1">備註：${it.memo}</div>` : ''}
        </div>`;
    }).join('');
}

window.populateLogDropdowns = function() {
    const dName = document.getElementById('logFilterName');
    if(!dName) return;
    const currentVal = dName.value;
    
    let names = new Set();
    globalInvLogs.forEach(x => { if(x.name) names.add(x.name); });
    
    dName.innerHTML = '<option value="">📦 所有品名 (不限)</option>';
    Array.from(names).sort().forEach(n => dName.add(new Option(n, n)));
    dName.value = currentVal;
};

window.openEditInvLogModal = function(rowIdx) {
    const log = globalInvLogs.find(x => x.rowIdx === rowIdx);
    if(!log) return;
    
    document.getElementById('e_logRowIdx').value = rowIdx;
    document.getElementById('e_logInvoiceNo').value = log.invoiceNo || '';
    document.getElementById('e_logArrivalDate').value = log.arrivalDate || '';
    document.getElementById('e_logOrderNo').value = log.orderNo || '';
    document.getElementById('e_logMemo').value = log.memo || '';
    document.getElementById('e_logSnapshot').value = log.snapshot || '';

    bootstrap.Modal.getOrCreateInstance(document.getElementById('editInvLogModal')).show();
};

window.saveEditInvLog = function() {
    const rowIdx = document.getElementById('e_logRowIdx').value;
    const payload = {
        rowIdx: Number(rowIdx),
        invoiceNo: document.getElementById('e_logInvoiceNo').value.trim(),
        arrivalDate: document.getElementById('e_logArrivalDate').value,
        orderNo: document.getElementById('e_logOrderNo').value.trim(),
        memo: document.getElementById('e_logMemo').value.trim(),
        snapshot: document.getElementById('e_logSnapshot').value
    };

    const log = globalInvLogs.find(x => x.rowIdx == payload.rowIdx);
    if(log) {
        log.invoiceNo = payload.invoiceNo;
        log.arrivalDate = payload.arrivalDate;
        log.orderNo = payload.orderNo;
        log.memo = payload.memo;
    }

    pushToSyncQueue('editInvLogRecord', payload);
    
    bootstrap.Modal.getInstance(document.getElementById('editInvLogModal')).hide();
    renderInvLogs();
    showToast("✅ 紀錄備註修改完成");
};

window.openEditBatchModal = function(rowIdx) {
    const log = globalInvLogs.find(x => x.rowIdx === rowIdx);
    if(!log) return;
    
    document.getElementById('eb_logRowIdx').value = rowIdx;
    document.getElementById('eb_itemName').value = log.name;
    document.getElementById('eb_changeQty').value = log.qtyChange; 
    document.getElementById('eb_oldLot').value = log.lot || '';
    
    document.getElementById('eb_currentLotDisplay').value = log.lot || '未指定批號';

    const invMatch = globalInventory.find(x => x.name === log.name);
    const bs = document.getElementById('eb_newBatchSelect');
    bs.innerHTML = '<option value="">(移除批號紀錄 / 混合批號)</option>';
    
    if(invMatch) {
        try {
            const batches = JSON.parse(invMatch.batchesStr || '[]');
            batches.forEach(b => {
                bs.add(new Option(`更換為批號: ${b.lot||'無'} (效期: ${b.exp||'無'}) [目前庫存: ${b.qty}]`, b.lot));
            });
        } catch(e){}
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editBatchModal')).show();
};

window.confirmEditBatch = function() {
    const rowIdx = Number(document.getElementById('eb_logRowIdx').value);
    const itemName = document.getElementById('eb_itemName').value;
    const changeQty = Number(document.getElementById('eb_changeQty').value); 
    const oldLot = document.getElementById('eb_oldLot').value;
    const newLot = document.getElementById('eb_newBatchSelect').value;

    if(oldLot === newLot) {
        bootstrap.Modal.getInstance(document.getElementById('editBatchModal')).hide();
        return;
    }

    const log = globalInvLogs.find(x => x.rowIdx === rowIdx);
    const invMatch = globalInventory.find(x => x.name === itemName);

    if(log && invMatch) {
        let batches = [];
        try { batches = JSON.parse(invMatch.batchesStr || '[]'); } catch(e){}

        const absQty = Math.abs(changeQty);
        
        if (oldLot) {
            let oIdx = batches.findIndex(b => b.lot === oldLot);
            if (oIdx >= 0) batches[oIdx].qty += absQty; 
            else batches.push({lot: oldLot, exp: '', qty: absQty});
        }

        if (newLot) {
            let nIdx = batches.findIndex(b => b.lot === newLot);
            if (nIdx >= 0) {
                batches[nIdx].qty -= absQty; 
            } else {
                batches.push({lot: newLot, exp: '', qty: -absQty}); 
            }
        }
        
        batches = batches.filter(b => b.qty > 0 || b.qty < 0);
        invMatch.batchesStr = JSON.stringify(batches);

        log.lot = newLot;
        log.memo = `(自批號 ${oldLot||'無'} 修改為 ${newLot||'無'}) ` + (log.memo||'');

        pushToSyncQueue('editInvLogBatch', {
            logRowIdx: rowIdx,
            name: itemName,
            oldLot: oldLot,
            newLot: newLot,
            absQty: absQty
        });

        bootstrap.Modal.getInstance(document.getElementById('editBatchModal')).hide();
        renderInvLogs();
        renderInventory();
        showToast("✅ 批號修改完成，庫存已自動重新運算");
    }
};

window.triggerSyncAssetCodes = function() {
    if(!confirm("這將會讀取「產品價格表」的資材碼，並覆蓋到庫存清單中。\n若庫存清單已手動填寫資材碼則會被覆蓋，確定要執行嗎？")) return;
    
    showLoading("同步資材碼中...");
    
    let updateCount = 0;
    globalInventory.forEach(invItem => {
        const catMatch = globalCatalog.find(c => c.productName === invItem.name && c.internalCode);
        if (catMatch && invMatch.internalCode !== catMatch.internalCode) {
            invItem.internalCode = catMatch.internalCode;
            updateCount++;
            pushToSyncQueue('adjustInventory', {
                name: invItem.name, changeQty: 0, type: '資料同步', alertQty: invItem.alertQty,
                cost: invItem.cost, supplier: invItem.supplier, lot: '', expiry: '',
                invoiceNo: '', arrivalDate: '', memo: '系統自動同步資材碼', internalCode: catMatch.internalCode, staff: myName
            });
        }
    });

    hideLoading();
    renderInventory();
    
    if (updateCount > 0) alert(`✅ 同步完成！共更新了 ${updateCount} 筆產品的長固代號。`);
    else alert("ℹ️ 檢查完畢，目前庫存清單的代號皆已為最新狀態，無須更新。");
};

// ============================================================================
// 後台管理員：產品報價與客戶維護
// ============================================================================
function renderAdminItems() {
    const container = document.getElementById('admItemList');
    if(!container) return;
    
    const kw = document.getElementById('admItemSearch') ? document.getElementById('admItemSearch').value.toLowerCase().trim() : '';
    const fClient = document.getElementById('admItemFilterSelect') ? document.getElementById('admItemFilterSelect').value : '';

    let arr = [...globalCatalog];
    if(kw) arr = arr.filter(x => (x.productName && x.productName.toLowerCase().includes(kw)) || (x.internalCode && x.internalCode.toLowerCase().includes(kw)));
    if(fClient) arr = arr.filter(x => x.clientName === fClient);

    if(arr.length === 0) {
        container.innerHTML = '<div class="text-center text-muted p-3">查無報價品項</div>';
        return;
    }

    container.innerHTML = arr.map(it => `
        <div class="bg-white border rounded p-3 mb-2 shadow-sm d-flex justify-content-between align-items-center" onclick="openAdminItemModal(${it.rowIndex})" style="cursor:pointer;">
            <div>
                <div class="fw-bold text-dark fs-6">${it.productName}</div>
                <div class="small text-muted mt-1">代號：${it.internalCode || '無'} | 單位：${it.unit}</div>
                <div class="small text-primary fw-bold mt-1">客戶：${it.clientName}</div>
            </div>
            <div class="text-end">
                <div class="fw-bold text-danger fs-5">$${it.price}</div>
            </div>
        </div>
    `).join('');
}

window.populateAdminClientFilter = function() {
    const d = document.getElementById('admItemFilterSelect');
    if(!d) return;
    const currentVal = d.value;
    
    let clients = new Set();
    globalCatalog.forEach(x => { if(x.clientName) clients.add(x.clientName); });
    
    d.innerHTML = '<option value="">📂 所有客戶 (顯示全部)</option>';
    Array.from(clients).sort().forEach(c => d.add(new Option(c, c)));
    d.value = currentVal;
};

window.openAdminItemModal = function(rowIndex) {
    document.getElementById('editItemRowIndex').value = rowIndex || '';
    if(rowIndex) {
        const it = globalCatalog.find(x => x.rowIndex === rowIndex);
        if(it) {
            document.getElementById('editItemModalTitle').innerText = '📝 編輯品項';
            document.getElementById('editItemClientDisplay').value = it.clientName;
            document.getElementById('editItemClientVal').value = it.clientName;
            document.getElementById('editItemInternalCode').value = it.internalCode || '';
            document.getElementById('editItemName').value = it.productName;
            document.getElementById('editItemUnit').value = it.unit || '式';
            document.getElementById('editItemPrice').value = it.price || 0;
        }
    } else {
        document.getElementById('editItemModalTitle').innerText = '➕ 新增合約報價品項';
        document.getElementById('editItemClientDisplay').value = '';
        document.getElementById('editItemClientVal').value = '';
        document.getElementById('editItemInternalCode').value = '';
        document.getElementById('editItemName').value = '';
        document.getElementById('editItemUnit').value = '式';
        document.getElementById('editItemPrice').value = '';
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editItemModal')).show();
};

window.triggerItemClientSelect = function() {
    openSearchModal('client_admin_item', (clientName) => {
        document.getElementById('editItemClientDisplay').value = clientName;
        document.getElementById('editItemClientVal').value = clientName;
    });
};

window.submitEditItemOptimistic = function() {
    const client = document.getElementById('editItemClientVal').value.trim();
    const name = document.getElementById('editItemName').value.trim();
    if(!client || !name) return alert("客戶與品名為必填！");

    const rowIdx = document.getElementById('editItemRowIndex').value;
    const payload = {
        rowIndex: rowIdx ? Number(rowIdx) : 0,
        clientName: client,
        internalCode: document.getElementById('editItemInternalCode').value.trim(),
        productName: name,
        unit: document.getElementById('editItemUnit').value.trim() || '式',
        price: Number(document.getElementById('editItemPrice').value) || 0
    };

    if(rowIdx) {
        const it = globalCatalog.find(x => x.rowIndex == rowIdx);
        if(it) {
            it.clientName = payload.clientName;
            it.internalCode = payload.internalCode;
            it.productName = payload.productName;
            it.unit = payload.unit;
            it.price = payload.price;
        }
    } else {
        payload.rowIndex = Date.now(); 
        globalCatalog.unshift({
            rowIndex: payload.rowIndex,
            assetCode: payload.internalCode,
            internalCode: payload.internalCode,
            clientName: payload.clientName,
            productName: payload.productName,
            unit: payload.unit,
            price: payload.price
        });
        populateAdminClientFilter();
    }

    pushToSyncQueue('saveAdminItem', payload);
    bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide();
    renderAdminItems();
    showToast("✅ 品項已儲存");
};

function renderAdminClients() {
    const container = document.getElementById('admClientList');
    if(!container) return;
    
    const kw = document.getElementById('admClientSearch') ? document.getElementById('admClientSearch').value.toLowerCase().trim() : '';

    let arr = [...globalClients];
    if(kw) arr = arr.filter(x => (x.name && x.name.toLowerCase().includes(kw)) || (x.taxId && String(x.taxId).includes(kw)));

    if(arr.length === 0) {
        container.innerHTML = '<div class="text-center text-muted p-3">查無客戶</div>';
        return;
    }

    container.innerHTML = arr.map(c => `
        <div class="bg-white border rounded p-3 mb-2 shadow-sm d-flex justify-content-between align-items-center" onclick="openEditClientModal('${escapeQuotes(c.name)}')" style="cursor:pointer;">
            <div>
                <div class="fw-bold text-dark fs-5">${c.name}</div>
                <div class="small text-muted mt-1">統編：${c.taxId || '無'}</div>
                <div class="small text-secondary mt-1 text-truncate" style="max-width: 250px;">單位：${c.receiveDept || '無'}</div>
            </div>
            <div class="text-end text-muted small">
                📝 編輯
            </div>
        </div>
    `).join('');
}

window.openNewClientModal = function() {
    document.getElementById('addClientName').value = '';
    document.getElementById('addClientTaxId').value = '';
    document.getElementById('addClientAddress').value = '';
    document.getElementById('addClientReceiveDept').value = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addClientModal')).show();
};

window.submitNewClientOptimistic = function() {
    const name = document.getElementById('addClientName').value.trim();
    if(!name) return alert("客戶名稱必填！");
    
    if(globalClients.some(c => c.name === name)) return alert("此客戶名稱已存在！");

    const payload = {
        clientName: name,
        taxId: document.getElementById('addClientTaxId').value.trim(),
        address: document.getElementById('addClientAddress').value.trim(),
        receiveDept: document.getElementById('addClientReceiveDept').value.trim()
    };

    globalClients.unshift({
        name: payload.clientName,
        taxId: payload.taxId,
        address: payload.address,
        receiveDept: payload.receiveDept
    });

    pushToSyncQueue('addClientData', payload);
    bootstrap.Modal.getInstance(document.getElementById('addClientModal')).hide();
    renderAdminClients();
    showToast(`✅ 已新增客戶: ${name}`);
};

window.openEditClientModal = function(name) {
    const c = globalClients.find(x => x.name === name);
    if(!c) return;
    document.getElementById('editClientOldName').value = c.name;
    document.getElementById('editClientName').value = c.name;
    document.getElementById('editClientTaxId').value = c.taxId || '';
    document.getElementById('editClientAddress').value = c.address || '';
    document.getElementById('editClientReceiveDept').value = c.receiveDept || '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editClientModal')).show();
};

window.submitEditClientOptimistic = function() {
    const oldName = document.getElementById('editClientOldName').value;
    const newName = document.getElementById('editClientName').value.trim();
    if(!newName) return alert("客戶名稱必填！");

    const payload = {
        oldName: oldName,
        newName: newName,
        taxId: document.getElementById('editClientTaxId').value.trim(),
        address: document.getElementById('editClientAddress').value.trim(),
        receiveDept: document.getElementById('editClientReceiveDept').value.trim()
    };

    const c = globalClients.find(x => x.name === oldName);
    if(c) {
        c.name = payload.newName;
        c.taxId = payload.taxId;
        c.address = payload.address;
        c.receiveDept = payload.receiveDept;
    }

    pushToSyncQueue('updateClientData', payload);
    bootstrap.Modal.getInstance(document.getElementById('editClientModal')).hide();
    renderAdminClients();
    showToast(`✅ 客戶 ${newName} 資料已更新`);
};
