/**
 * Task Processor
 * Handles loading and processing task definitions for the database editor
 */

function validateTask(task, taskName) {
    const errors = [];

    if (!task.name) errors.push('Missing required field: name');
    if (!task.main_table) errors.push('Missing required field: main_table');
    if (!task.record_identifier) errors.push('Missing required field: record_identifier');
    if (!task.column_groups) errors.push('Missing required field: column_groups');
    if (!task.fields) errors.push('Missing required field: fields');

    if (task.column_groups && task.record_identifier) {
        const recordGroup = task.column_groups[task.record_identifier];
        if (!recordGroup) {
            errors.push(`Record identifier group '${task.record_identifier}' not found in column_groups`);
        } else {
            if (!recordGroup.columns || !Array.isArray(recordGroup.columns) || recordGroup.columns.length === 0) {
                errors.push(`Record identifier group '${task.record_identifier}' must have at least one column`);
            }
            if (!recordGroup.values || !recordGroup.values.type) {
                errors.push(`Record identifier group '${task.record_identifier}' missing values.type`);
            }
        }
    }

    if (task.fields && task.column_groups) {
        task.fields.forEach(fieldName => {
            if (!task.column_groups[fieldName]) {
                errors.push(`Field group '${fieldName}' not found in column_groups`);
            }
        });
    }

    if (errors.length > 0) {
        throw new Error(`Invalid task definition '${taskName}':\n  - ${errors.join('\n  - ')}`);
    }
}

export async function loadTaskDefinitions(config) {
    try {
        const taskPromises = config.tasks.map(async (taskName) => {
            const response = await fetch(`${config.tasksDirectory}/${taskName}.json`);
            const task = await response.json();
            validateTask(task, taskName);
            return task;
        });
        return await Promise.all(taskPromises);
    } catch (error) {
        console.error('Error loading tasks:', error);
        throw error;
    }
}

export function asArray(value) {
    return Array.isArray(value) ? value : [value];
}

export function getRecordSelector(task) {
    return task.column_groups[task.record_identifier].columns[0];
}

export function buildSelectRecordQuery(task, recordId) {
    const selector = getRecordSelector(task);
    return {
        sql: `SELECT * FROM ${task.main_table} WHERE ${selector} = ?`,
        params: [recordId]
    };
}

export function buildUpdateQuery(task, column, recordId, value) {
    const selector = getRecordSelector(task);
    return {
        sql: `UPDATE ${task.main_table} SET ${column} = ? WHERE ${selector} = ?`,
        params: [value, recordId]
    };
}

function parseColumnName(columnName, mainTable) {
    if (columnName.includes('.')) {
        const parts = columnName.split('.');
        return { table: parts[0], column: parts[1] };
    }
    return { table: mainTable, column: columnName };
}

// Cache for enum groups to avoid rebuilding on every query
const enumGroupsCache = new WeakMap();

function getEnumGroups(task) {
    if (enumGroupsCache.has(task)) {
        return enumGroupsCache.get(task);
    }

    const enumGroups = {};
    Object.entries(task.column_groups).forEach(([name, group]) => {
        if (group.values.type === 'enum') {
            group.columns.forEach(col => {
                enumGroups[col] = group.values.options;
            });
        }
    });

    enumGroupsCache.set(task, enumGroups);
    return enumGroups;
}

export function buildRecordQuery(task) {
    const recordGroup = task.column_groups[task.record_identifier];
    if (!recordGroup) {
        throw new Error(`Record identifier group '${task.record_identifier}' not found`);
    }

    const selectorColumn = recordGroup.columns[0];

    // If no display columns, simple query
    if (!recordGroup.display) {
        return `SELECT ${selectorColumn}, * FROM ${task.main_table}`;
    }

    const displayCols = asArray(recordGroup.display);
    const hasJoin = recordGroup.values.type === 'join';
    const enumGroups = getEnumGroups(task);

    // Build select for each display column
    const selects = displayCols.map((qualifiedCol, i) => {
        const { table, column } = parseColumnName(qualifiedCol, task.main_table);
        const tableAlias = hasJoin && table !== task.main_table ? 'fk' : 't';
        const aliasName = `_display_${i}`;

        if (enumGroups[column]) {
            const cases = Object.entries(enumGroups[column])
                .map(([value, label]) => `WHEN ${tableAlias}.${column} = ${value} THEN '${label.replace(/'/g, "''")}'`)
                .join(' ');
            return `CASE ${cases} ELSE ${tableAlias}.${column} END as ${aliasName}`;
        }
        return `${tableAlias}.${column} as ${aliasName}`;
    });

    const allSelects = selects.join(', ');

    if (hasJoin) {
        const join = recordGroup.values;
        return `SELECT t.${selectorColumn}, t.*, ${allSelects}
                FROM ${task.main_table} t
                LEFT JOIN ${join.table} fk ON t.${join.local_key} = fk.${join.foreign_key}`;
    } else {
        return `SELECT t.${selectorColumn}, t.*, ${allSelects}
                FROM ${task.main_table} t`;
    }
}

export function findDisplayIndices(task, columns) {
    const recordGroup = task.column_groups[task.record_identifier];
    if (!recordGroup || !recordGroup.display) return [];

    const displayCols = asArray(recordGroup.display);
    return displayCols.map((col, i) => columns.indexOf(`_display_${i}`));
}

export function findBestDisplayColumn(columns, idIndex) {
    for (let i = 0; i < columns.length; i++) {
        const col = columns[i].toLowerCase();
        if (col.includes('firstlast')) return i;
        if (col.includes('name')) return i;
    }
    return idIndex;
}

export function formatRecordLabel(task, row, columns, idIndex, displayIndices) {
    if (displayIndices.length > 0) {
        const labelParts = displayIndices
            .map(idx => row[idx])
            .filter(v => v != null);
        return labelParts.join(', ');
    }

    const displayIndex = findBestDisplayColumn(columns, idIndex);
    if (displayIndex !== idIndex) {
        return `${row[displayIndex]}`;
    }
    return `ID: ${row[idIndex]}`;
}

export function generateLabel(columnName) {
    let label = columnName;

    const prefixes = ['gene_sz_', 'gene_i_', 'gene_f_', 'gene_b_',
                    'charac_i_', 'value_i_', 'value_f_',
                    'fkID', 'fk'];

    for (const prefix of prefixes) {
        if (label.startsWith(prefix)) {
            label = label.substring(prefix.length);
            break;
        }
    }

    label = label.replace(/_(i|f|sz|b)_/, '_');
    label = label.replace(/_/g, ' ');

    label = label.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

    return label;
}

export function buildFieldDefinitions(task, db, row) {
    const fields = [];

    task.fields.forEach(groupName => {
        const group = task.column_groups[groupName];
        if (!group) {
            console.warn(`Field group '${groupName}' not found`);
            return;
        }

        const columns = group.columns;
        const valueSpec = group.values;

        columns.forEach(column => {
            const field = {
                column: column,
                label: generateLabel(column),
                currentValue: row[column],
                type: valueSpec.type
            };

            switch (valueSpec.type) {
                case 'readonly':
                    field.options = null;
                    break;

                case 'enum':
                    field.options = Object.entries(valueSpec.options).map(([key, display]) => ({
                        value: isNaN(key) ? key : Number(key),
                        display: display
                    }));
                    break;

                case 'query':
                    const queryResult = db.exec(valueSpec.sql);
                    field.options = queryResult.length > 0 ? queryResult[0].values.map(queryRow => queryRow[0]) : [];
                    break;

                case 'list':
                    field.options = valueSpec.options;
                    // Check if consecutive integers for slider
                    const isConsecutive = field.options.length > 0 &&
                        field.options.every((val, idx) => {
                            if (typeof val !== 'number' || !Number.isInteger(val)) return false;
                            if (idx === 0) return true;
                            return val === field.options[idx - 1] + 1;
                        });
                    field.isConsecutiveIntegers = isConsecutive;
                    break;

                case 'join':
                    // For join fields, use first display column or foreign key as fallback
                    const displayCol = group.display ? (Array.isArray(group.display) ? group.display[0] : group.display) : valueSpec.foreign_key;
                    const { column: displayColumn } = parseColumnName(displayCol, task.main_table);
                    const joinResult = db.exec(`SELECT ${valueSpec.foreign_key}, ${displayColumn} FROM ${valueSpec.table} ORDER BY ${displayColumn}`);
                    field.options = joinResult.length > 0 ? joinResult[0].values.map(fkRow => ({
                        value: fkRow[0],
                        display: fkRow[1]
                    })) : [];
                    break;
            }

            fields.push(field);
        });
    });

    return fields;
}
