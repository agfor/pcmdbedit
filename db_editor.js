/**
 * PCM Database Editor
 * A browser-based SQLite editor for Pro Cycling Manager database files
 */

import { PCMFileHandler } from './db_file_handler.js';
import Choices from 'choices.js';
import * as TaskProcessor from './task_processor.js';
import { renderConsole, escapeHtml } from './sql_console.js';

const CHOICES_CONFIG = {
    searchEnabled: true,
    shouldSort: false,
    itemSelectText: ''
};

const CHOICES_CONFIG_NO_SEARCH = {
    searchEnabled: false,
    shouldSort: false,
    itemSelectText: ''
};

class EditorState {
    constructor() {
        this.config = {
            tasks: [],
            tasksDirectory: 'tasks'
        };
        this.tasks = [];
        this.db = null;
        this.currentTask = null;
        this.currentRecordId = null;
        this.taskSelectChoices = null;
        this.recordSelectChoices = null;
        this.fieldSelectChoices = [];
        // SQL Console state
        this.sqlConsole = {
            isActive: false,
            queryHistory: [],
            writeMode: false,
            currentQuery: '',
            maxHistorySize: 20,
            rowLimit: 200,
            currentOffset: 0,
            cachedResult: null
        };
    }

    destroyChoices() {
        if (this.recordSelectChoices) {
            this.recordSelectChoices.destroy();
            this.recordSelectChoices = null;
        }
        this.fieldSelectChoices.forEach(choice => choice.destroy());
        this.fieldSelectChoices = [];
    }
}

const state = new EditorState();

async function init(userConfig) {
    state.config = { ...state.config, ...userConfig };
    await loadTasks();
    setupEventHandlers();
}

async function loadTasks() {
    try {
        state.tasks = await TaskProcessor.loadTaskDefinitions(state.config);
    } catch (error) {
        console.error('Error loading tasks:', error);
        showStatus('Error loading tasks', 'error');
    }
}

function populateTaskDropdown() {
    const options = '<option value="">-- Choose a task --</option>' +
        '<option value="__sql_console__">SQL Console</option>' +
        state.tasks.map((task, index) => `<option value="${index}">${escapeHtml(task.name)}</option>`).join('');
    document.getElementById('taskSelect').innerHTML = options;
}

function setupEventHandlers() {
    document.getElementById('taskSelect').addEventListener('change', (e) => {
        const taskIndex = e.target.value;
        if (taskIndex === '') {
            document.getElementById('record-section').classList.remove('active');
            document.getElementById('form-section').classList.remove('active');
            state.destroyChoices();
            state.currentTask = null;
            state.currentRecordId = null;
            state.sqlConsole.isActive = false;
            return;
        }

        // Check if SQL Console was selected
        if (taskIndex === '__sql_console__') {
            document.getElementById('record-section').classList.remove('active');
            state.destroyChoices();
            state.currentTask = null;
            state.currentRecordId = null;
            state.sqlConsole.isActive = true;
            renderConsole(state.db, state.sqlConsole);
            return;
        }

        document.getElementById('form-section').classList.remove('active');
        state.currentRecordId = null;
        state.sqlConsole.isActive = false;

        if (state.recordSelectChoices) {
            state.recordSelectChoices.destroy();
            state.recordSelectChoices = null;
        }
        document.getElementById('recordSelect').innerHTML = '<option value="">-- Choose a record --</option>';

        state.currentTask = state.tasks[taskIndex];
        loadRecords();
    });

    document.getElementById('recordSelect').addEventListener('change', (e) => {
        state.currentRecordId = e.target.value;
        if (state.currentRecordId) loadEditForm();
    });
}

function onDatabaseLoaded(dbInfo) {
    state.db = dbInfo.db;

    populateTaskDropdown();

    document.getElementById('drop-section').classList.remove('active');
    document.getElementById('task-section').classList.add('active');

    state.taskSelectChoices = new Choices('#taskSelect', CHOICES_CONFIG_NO_SEARCH);

    showStatus('Database loaded successfully', 'success');
}

function onError(message) {
    showStatus(message, 'error');
}

function onLoadingStateChange(isLoading, message) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (isLoading) {
        document.getElementById('loadingMessage').textContent = message || 'Loading...';
        loadingOverlay.classList.add('active');
    } else {
        loadingOverlay.classList.remove('active');
    }
}

function loadRecords() {
    const result = state.db.exec(TaskProcessor.buildRecordQuery(state.currentTask));

    if (result.length === 0) {
        showStatus('No records found in table', 'error');
        return;
    }

    const columns = result[0].columns;
    const rows = result[0].values;
    const recordSelector = TaskProcessor.getRecordSelector(state.currentTask);
    const idIndex = columns.indexOf(recordSelector);
    const displayIndices = TaskProcessor.findDisplayIndices(state.currentTask, columns);

    const options = rows.map(row =>
        `<option value="${escapeHtml(String(row[idIndex]))}">${escapeHtml(TaskProcessor.formatRecordLabel(state.currentTask, row, columns, idIndex, displayIndices))}</option>`
    ).join('');

    document.getElementById('recordSelect').innerHTML = '<option value="">-- Choose a record --</option>' + options;
    document.getElementById('record-section').classList.add('active');

    state.recordSelectChoices = new Choices('#recordSelect', CHOICES_CONFIG);
}

function loadEditForm() {
    const query = TaskProcessor.buildSelectRecordQuery(state.currentTask, state.currentRecordId);
    const stmt = state.db.prepare(query.sql);
    stmt.bind(query.params);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();

    // Destroy previous field choices
    state.fieldSelectChoices.forEach(choice => choice.destroy());
    state.fieldSelectChoices = [];

    document.getElementById('formFields').innerHTML = '';

    const fields = TaskProcessor.buildFieldDefinitions(state.currentTask, state.db, row);

    fields.forEach(field => {
        const fieldDiv = document.createElement('div');
        fieldDiv.classList.add('field-group');

        const label = document.createElement('label');
        label.textContent = field.label;
        label.setAttribute('for', field.column);

        switch (field.type) {
            case 'readonly':
                const input = document.createElement('input');
                input.type = 'text';
                input.id = field.column;
                input.name = field.column;
                input.value = field.currentValue || '';
                input.readOnly = true;
                input.style.background = '#f5f5f5';

                fieldDiv.appendChild(label);
                fieldDiv.appendChild(input);
                break;

            case 'enum':
            case 'query':
            case 'join':
                const select = document.createElement('select');
                select.id = field.column;
                select.name = field.column;
                field.options.forEach(item => select.appendChild(createOption(item, field.currentValue)));
                fieldDiv.appendChild(label);
                fieldDiv.appendChild(select);
                initChoices(select, field.column);
                break;

            case 'list':
                if (field.isConsecutiveIntegers) {
                    // Use slider for consecutive integers
                    const min = field.options[0];
                    const max = field.options[field.options.length - 1];

                    const slider = document.createElement('input');
                    slider.type = 'range';
                    slider.id = field.column;
                    slider.name = field.column;
                    slider.min = min;
                    slider.max = max;
                    slider.step = 1;
                    slider.value = field.currentValue || min;

                    const valueDisplay = document.createElement('span');
                    valueDisplay.classList.add('range-value');
                    valueDisplay.textContent = field.currentValue || min;

                    slider.addEventListener('input', (e) => {
                        valueDisplay.textContent = e.target.value;
                    });
                    slider.addEventListener('change', (e) => {
                        saveField(field.column, e.target.value);
                    });

                    fieldDiv.appendChild(label);
                    fieldDiv.appendChild(slider);
                    fieldDiv.appendChild(valueDisplay);
                } else {
                    const listSelect = document.createElement('select');
                    listSelect.id = field.column;
                    listSelect.name = field.column;
                    field.options.forEach(item => listSelect.appendChild(createOption(item, field.currentValue)));
                    fieldDiv.appendChild(label);
                    fieldDiv.appendChild(listSelect);
                    initChoices(listSelect, field.column);
                }
                break;
        }

        document.getElementById('formFields').appendChild(fieldDiv);
    });

    document.getElementById('form-section').classList.add('active');
}

function saveField(column, value) {
    try {
        const query = TaskProcessor.buildUpdateQuery(state.currentTask, column, state.currentRecordId, value);
        state.db.run(query.sql, query.params);
        showStatus('Saved', 'success');
    } catch (error) {
        showStatus('Error: ' + error.message, 'error');
    }
}

function createOption(item, currentValue) {
    const option = document.createElement('option');

    if (item instanceof Date) {
        const year = item.getFullYear();
        const month = String(item.getMonth() + 1).padStart(2, '0');
        const day = String(item.getDate()).padStart(2, '0');
        const yyyymmdd = parseInt(`${year}${month}${day}`);
        option.value = yyyymmdd;
        option.textContent = `${year}-${month}-${day}`;
        if (yyyymmdd == currentValue) option.selected = true;
    } else if (typeof item === 'number' && item >= 19000101 && item <= 21991231) {
        const dateStr = item.toString();
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        option.value = item;
        option.textContent = `${year}-${month}-${day}`;
        if (item == currentValue) option.selected = true;
    } else if (typeof item === 'object' && item !== null && 'value' in item) {
        option.value = item.value;
        option.textContent = item.display;
        if (item.value == currentValue) option.selected = true;
    } else {
        option.value = item;
        option.textContent = item;
        if (item == currentValue) option.selected = true;
    }

    return option;
}

function initChoices(select, column) {
    setTimeout(() => {
        const choices = new Choices(select, CHOICES_CONFIG);
        state.fieldSelectChoices.push(choices);
        select.addEventListener('change', (e) => saveField(column, e.target.value));
    }, 0);
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status ' + type;

    setTimeout(() => {
        status.className = 'status';
    }, 3000);
}

async function initializeApp(editorConfig) {
    await init(editorConfig);
    await PCMFileHandler.init({
        onDatabaseLoaded: onDatabaseLoaded,
        onError: onError,
        onLoadingStateChange: onLoadingStateChange,
        getDatabase: () => state.db
    });
}


export const PCMEditor = {
    initializeApp: initializeApp
};

