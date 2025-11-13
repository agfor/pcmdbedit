/**
 * PCM Database File Handler
 * Handles file upload/download for SQLite and CDB files
 */

import { cdbToSQLite, sqliteToCDB } from './cdb_converter.js';
import initSqlJs from 'sql.js';

let SQL = null;
let onDatabaseLoadedCallback = null;
let onErrorCallback = null;
let onLoadingStateChangeCallback = null;
let currentFileName = null;
let getDatabaseCallback = null;

function setLoadingState(isLoading, message) {
    if (onLoadingStateChangeCallback) {
        onLoadingStateChangeCallback(isLoading, message);
    }
}

async function init(options) {
    onDatabaseLoadedCallback = options.onDatabaseLoaded;
    onErrorCallback = options.onError;
    getDatabaseCallback = options.getDatabase;
    onLoadingStateChangeCallback = options.onLoadingStateChange;

    try {
        SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
    } catch (error) {
        console.error('Error initializing SQL.js:', error);
        if (onErrorCallback) onErrorCallback('Error initializing SQL.js');
        return;
    }

    setupEventHandlers();
}

function setupEventHandlers() {
    const dropZone = document.getElementById('dropZone');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.currentTarget.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) loadFile(file);
    });

    document.getElementById('fileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadFile(file);
    });

    document.querySelectorAll('#downloadBtn, #downloadBtnBottom').forEach(btn => {
        btn.addEventListener('click', () => downloadDatabase('sqlite'));
    });

    document.querySelectorAll('#downloadBtnCDB, #downloadBtnCDBBottom').forEach(btn => {
        btn.addEventListener('click', () => downloadDatabase('cdb'));
    });
}

function loadFile(file) {
    currentFileName = file.name;
    const extension = file.name.split('.').pop().toLowerCase();
    const isCDB = extension === 'cdb';

    const reader = new FileReader();

    reader.onload = function(e) {
        const processFile = () => {
            try {
                const db = isCDB
                    ? cdbToSQLite(e.target.result, SQL)
                    : new SQL.Database(new Uint8Array(e.target.result));

                if (isCDB) setLoadingState(false);

                onDatabaseLoadedCallback({
                    db: db,
                    fileName: currentFileName,
                    format: isCDB ? 'cdb' : 'sqlite'
                });
            } catch (error) {
                if (isCDB) setLoadingState(false);
                console.error('Error loading file:', error);
                if (onErrorCallback) onErrorCallback('Error loading file: ' + error.message);
            }
        };

        if (isCDB) {
            setLoadingState(true, 'Loading CDB file...');
            setTimeout(processFile, 50);
        } else {
            processFile();
        }
    };

    reader.onerror = function() {
        if (isCDB) setLoadingState(false);
        if (onErrorCallback) onErrorCallback('Error reading file');
    };

    reader.readAsArrayBuffer(file);
}

function doDownload(data, downloadName) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadDatabase(format) {
    const db = getDatabaseCallback();
    if (!db) {
        console.error('No database loaded');
        return;
    }

    if (format === 'cdb') {
        setLoadingState(true, 'Generating CDB file...');
        setTimeout(() => {
            try {
                doDownload(sqliteToCDB(db), currentFileName.replace(/\.(sqlite|db)$/, '.cdb'));
                setLoadingState(false);
            } catch (error) {
                setLoadingState(false);
                console.error('Error exporting database:', error);
                throw error;
            }
        }, 50);
    } else {
        doDownload(db.export(), currentFileName.replace(/\.cdb$/, '.sqlite'));
    }
}


export const PCMFileHandler = {
    init: init,
    downloadDatabase: downloadDatabase
};
