/**
 * SQL Console Module
 * Handles SQL console UI rendering and query execution
 */

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Check if a query is a write operation
 */
function isWriteQuery(sql) {
    const trimmed = sql.trim().toUpperCase();
    const writeKeywords = [
        'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'REPLACE',
        'TRUNCATE', 'ATTACH', 'DETACH', 'VACUUM', 'REINDEX'
    ];
    return writeKeywords.some(keyword => trimmed.startsWith(keyword));
}

/**
 * Get all tables and their schema information
 */
function getSchemaInfo(db) {
    const tableResult = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    if (tableResult.length === 0) return [];

    return tableResult[0].values.map(row => {
        const tableName = row[0];
        const columnResult = db.exec(`PRAGMA table_info("${tableName}")`);
        const columns = columnResult[0].values.map(row => ({
            name: row[1],
            type: row[2],
            pk: row[5]
        }));
        const countResult = db.exec(`SELECT COUNT(*) FROM "${tableName}"`);

        return { name: tableName, columns, rowCount: countResult[0].values[0][0] };
    });
}

/**
 * Execute a SQL query
 */
export function executeQuery(db, sql, consoleState) {
    const startTime = performance.now();
    const isWrite = isWriteQuery(sql);

    // Check if write mode is required
    if (isWrite && !consoleState.writeMode) {
        return {
            success: false,
            error: 'Write operations require Write Mode to be enabled',
            executionTime: 0
        };
    }

    try {
        let result;

        if (isWrite) {
            // For write operations, use run() and return affected rows
            db.run(sql);
            const changes = db.getRowsModified();
            result = {
                success: true,
                isWrite: true,
                rowsAffected: changes,
                executionTime: performance.now() - startTime
            };
        } else {
            // For read operations, use exec() and return results
            const queryResult = db.exec(sql);
            result = {
                success: true,
                isWrite: false,
                data: queryResult,
                executionTime: performance.now() - startTime
            };
        }

        // Add to query history
        if (!consoleState.queryHistory.includes(sql)) {
            consoleState.queryHistory = [sql, ...consoleState.queryHistory.slice(0, consoleState.maxHistorySize - 1)];
        }

        return result;
    } catch (error) {
        return {
            success: false,
            error: error.message,
            executionTime: performance.now() - startTime
        };
    }
}

/**
 * Render the query results as an HTML table
 */
function renderResultsTable(data, rowLimit, offset, append = false) {
    if (!data || data.length === 0) {
        return '<div style="padding: 20px; text-align: center; color: #666;">No rows returned</div>';
    }

    const result = data[0];
    const columns = result.columns;
    const allRows = result.values;
    const totalRows = allRows.length;
    const rows = allRows.slice(offset, offset + rowLimit);

    let html = '';

    if (!append) {
        // First render - include table header
        html += '<div id="resultsTableContainer" style="overflow-x: auto;">';
        html += '<table id="resultsTable" style="width: 100%; border-collapse: collapse; margin-top: 10px;">';

        // Header
        html += '<thead><tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">';
        columns.forEach(col => {
            html += `<th style="padding: 10px; text-align: left; font-weight: 600; border-right: 1px solid #ddd;">${escapeHtml(col)}</th>`;
        });
        html += '</tr></thead>';
        html += '<tbody id="resultsTableBody">';
    }

    // Body rows
    rows.forEach((row, index) => {
        const actualIndex = offset + index;
        const bgColor = actualIndex % 2 === 0 ? '#fff' : '#f9f9f9';
        html += `<tr style="background: ${bgColor}; border-bottom: 1px solid #eee;">`;
        row.forEach(cell => {
            const cellValue = cell === null ? '<em style="color: #999;">NULL</em>' : escapeHtml(String(cell));
            html += `<td style="padding: 8px 10px; border-right: 1px solid #eee;">${cellValue}</td>`;
        });
        html += '</tr>';
    });

    if (!append) {
        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        // Row count and load more button
        if (totalRows > 0) {
            const showing = Math.min(offset + rowLimit, totalRows);
            html += `<div id="rowCountInfo" style="margin-top: 10px; color: #666; font-size: 14px;">`;
            html += `Showing ${offset + 1}-${showing} of ${totalRows} rows`;

            if (showing < totalRows) {
                html += ` <button id="loadMoreBtn" style="margin-left: 10px;">Load more</button>`;
            }
            html += '</div>';
        }
    }

    return html;
}

/**
 * Render a single table in the schema browser
 */
function renderSchemaTable(table) {
    const columns = table.columns.map(col => {
        const pk = col.pk ? ' <span style="background: #ffc107; color: #000; padding: 1px 4px; border-radius: 2px; font-size: 10px;">PK</span>' : '';
        const baseType = col.type.split(' ')[0] || col.type;
        return `<div style="margin: 2px 0;"><span class="schema-column" data-table="${escapeHtml(table.name)}" data-column="${escapeHtml(col.name)}" style="cursor: pointer; color: #007bff; text-decoration: underline;">${escapeHtml(col.name)}</span> <span style="color: #666;">${escapeHtml(baseType)}</span>${pk}</div>`;
    }).join('');

    return `<div style="margin-bottom: 15px;">
        <div style="font-weight: 600; color: #333; margin-bottom: 5px;">
            <span class="schema-table" data-name="${escapeHtml(table.name)}" style="cursor: pointer; color: #007bff; text-decoration: underline;">${escapeHtml(table.name)}</span>
            <span style="color: #666; font-weight: normal; font-size: 12px;">(${table.rowCount} rows)</span>
        </div>
        <div style="margin-left: 20px; font-size: 13px;">${columns}</div>
    </div>`;
}

/**
 * Render the schema browser panel
 */
function renderSchemaBrowser(db) {
    const schema = getSchemaInfo(db);
    const tables = schema.map(table => renderSchemaTable(table)).join('');

    return `
        <div style="margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;">
            <div style="padding: 10px; background: #e9ecef; border-bottom: 1px solid #ddd; font-weight: 600; cursor: pointer;" id="schemaBrowserToggle">
                ▼ Schema Browser <span style="font-weight: normal; color: #666;">(click table/column to insert)</span>
            </div>
            <div id="schemaBrowserContent" style="padding: 10px; max-height: 300px; overflow-y: auto;">
                ${tables}
            </div>
        </div>
    `;
}

/**
 * Render query history dropdown
 */
function renderQueryHistory(consoleState) {
    if (consoleState.queryHistory.length === 0) return '';

    const options = consoleState.queryHistory.map((query, index) => {
        const preview = query.length > 80 ? query.substring(0, 80) + '...' : query;
        return `<option value="${index}">${escapeHtml(preview)}</option>`;
    }).join('');

    return `
        <div style="margin-bottom: 10px;">
            <label for="queryHistory">Query History:</label>
            <select id="queryHistory" style="width: calc(100% - 220px);">
                <option value="">-- Select from history --</option>
                ${options}
            </select>
            <button id="clearHistoryBtn" class="button-secondary">Clear History</button>
        </div>
    `;
}

/**
 * Render query input section
 */
function renderQueryInput(consoleState) {
    return `
        <div style="display: flex; gap: 20px; margin-bottom: 10px;">
            <div style="display: flex; flex-direction: column; gap: 10px; width: 200px;">
                <label for="sqlQuery">Enter SQL Query:</label>
                <label style="font-weight: normal;">
                    <input type="checkbox" id="writeModeToggle" ${consoleState.writeMode ? 'checked' : ''}>
                    Enable Write Mode
                </label>
                <button id="executeQueryBtn">Execute Query</button>
            </div>
            <textarea id="sqlQuery" rows="6" style="flex: 1; font-family: monospace; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${escapeHtml(consoleState.currentQuery)}</textarea>
        </div>
    `;
}

/**
 * Render write mode warning
 */
function renderWriteModeWarning(consoleState) {
    if (!consoleState.writeMode) return '';

    return `
        <div style="background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 10px; margin-bottom: 20px; border-radius: 4px;">
            ⚠️ <strong>Write Mode Enabled:</strong> Changes will be saved to the in-memory database. Use the download buttons to export your changes.
        </div>
    `;
}

/**
 * Handle history selection - execute read queries automatically
 */
function handleHistorySelection(db, consoleState, query) {
    const sqlQuery = document.getElementById('sqlQuery');
    sqlQuery.value = query;
    consoleState.currentQuery = query;

    // Auto-execute read queries, but not write queries
    if (!isWriteQuery(query)) {
        consoleState.currentOffset = 0;
        const result = executeQuery(db, query, consoleState);
        updateQueryHistory(db, consoleState);
        displayQueryResult(result, db, consoleState);
    }
}

/**
 * Update just the query history dropdown
 */
function updateQueryHistory(db, consoleState) {
    document.getElementById('queryHistoryContainer').innerHTML = renderQueryHistory(consoleState);
    attachHistoryListeners(db, consoleState);
}

/**
 * Attach history dropdown event listeners
 */
function attachHistoryListeners(db, consoleState) {
    const historySelect = document.getElementById('queryHistory');
    historySelect?.addEventListener('change', (e) => {
        if (e.target.value) {
            handleHistorySelection(db, consoleState, consoleState.queryHistory[e.target.value]);
        }
    });

    document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
        consoleState.queryHistory = [];
        updateQueryHistory(db, consoleState);
    });
}

/**
 * Render the SQL console UI
 */
export function renderConsole(db, consoleState) {
    const formSection = document.getElementById('form-section');

    const html = `
        <div id="sqlConsoleContainer">
            ${renderSchemaBrowser(db)}
            <div id="queryHistoryContainer">${renderQueryHistory(consoleState)}</div>
            ${renderQueryInput(consoleState)}
            <div id="writeModeWarningContainer">${renderWriteModeWarning(consoleState)}</div>
            <div id="queryResults"></div>
        </div>
    `;

    formSection.innerHTML = html;
    formSection.classList.add('active');

    // Attach event listeners
    attachConsoleEventListeners(db, consoleState);
}

/**
 * Attach event listeners to console elements
 */
function attachConsoleEventListeners(db, consoleState) {
    const sqlQuery = document.getElementById('sqlQuery');

    // Execute query button
    document.getElementById('executeQueryBtn').addEventListener('click', () => {
        const query = sqlQuery.value.trim();
        if (!query) return;

        consoleState.currentQuery = query;
        consoleState.currentOffset = 0;

        const result = executeQuery(db, query, consoleState);
        updateQueryHistory(db, consoleState);
        displayQueryResult(result, db, consoleState);
    });

    // Write mode toggle
    document.getElementById('writeModeToggle').addEventListener('change', (e) => {
        consoleState.writeMode = e.target.checked;
        document.getElementById('writeModeWarningContainer').innerHTML = renderWriteModeWarning(consoleState);
    });

    // Attach history listeners on initial render
    attachHistoryListeners(db, consoleState);

    // Schema browser toggle
    document.getElementById('schemaBrowserToggle').addEventListener('click', (e) => {
        const content = document.getElementById('schemaBrowserContent');
        const isCollapsed = content.style.display === 'none';
        content.style.display = isCollapsed ? 'block' : 'none';
        e.target.textContent = e.target.textContent.replace(isCollapsed ? '▶' : '▼', isCollapsed ? '▼' : '▶');
    });

    // Schema item clicks (insert into query)
    document.querySelectorAll('.schema-table').forEach(el => {
        el.addEventListener('click', () => insertAtCursor(sqlQuery, el.dataset.name));
    });

    document.querySelectorAll('.schema-column').forEach(el => {
        el.addEventListener('click', () => insertAtCursor(sqlQuery, el.dataset.column));
    });

    // Save current query on change
    sqlQuery.addEventListener('input', (e) => {
        consoleState.currentQuery = e.target.value;
    });
}

/**
 * Insert text at cursor position in textarea
 */
function insertAtCursor(textarea, text) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    textarea.value = value.substring(0, start) + text + value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
}

/**
 * Display query result in the results area
 */
function displayQueryResult(result, db, consoleState) {
    const resultsDiv = document.getElementById('queryResults');

    if (!result.success) {
        resultsDiv.innerHTML = `<div style="background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 4px; margin-top: 10px;"><strong>Error:</strong> ${escapeHtml(result.error)}</div>`;
        return;
    }

    const executionTimeHtml = `<div style="color: #666; font-size: 13px; margin: 10px 0 5px;">Execution time: ${result.executionTime.toFixed(2)}ms</div>`;

    if (result.isWrite) {
        resultsDiv.innerHTML = `${executionTimeHtml}<div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 4px;"><strong>Success:</strong> Query executed. Rows affected: ${result.rowsAffected}</div>`;
    } else {
        consoleState.cachedResult = result.data;
        resultsDiv.innerHTML = executionTimeHtml + renderResultsTable(result.data, consoleState.rowLimit, consoleState.currentOffset);
        attachLoadMoreListener(consoleState);
    }
}

/**
 * Attach load more button event listener
 */
function attachLoadMoreListener(consoleState) {
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (!loadMoreBtn) return;

    loadMoreBtn.addEventListener('click', function handleLoadMore() {
        consoleState.currentOffset += consoleState.rowLimit;
        const { cachedResult, rowLimit, currentOffset } = consoleState;
        const totalRows = cachedResult[0].values.length;
        const showing = Math.min(currentOffset + rowLimit, totalRows);

        document.getElementById('resultsTableBody').insertAdjacentHTML('beforeend',
            renderResultsTable(cachedResult, rowLimit, currentOffset, true));

        const infoDiv = document.getElementById('rowCountInfo');
        infoDiv.innerHTML = `Showing 1-${showing} of ${totalRows} rows`;

        if (showing < totalRows) {
            infoDiv.insertAdjacentHTML('beforeend', ' <button id="loadMoreBtn" style="margin-left: 10px;">Load more</button>');
            document.getElementById('loadMoreBtn').addEventListener('click', handleLoadMore);
        }
    });
}

