#!/usr/bin/env node

/**
 * Comprehensive CDB Converter Test
 *
 * Tests round-trip CDB conversion:
 * 1. test_original.cdb -> JS -> test_roundtrip.cdb
 * 2. Compare decompressed CDB files (should be identical)
 * 3. test_roundtrip.cdb -> Official Tool -> test_roundtrip.sqlite
 * 4. Compare test_roundtrip.sqlite to test_original.sqlite
 *
 * Usage:
 *   node test_cdb_conversion.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import initSqlJs from 'sql.js';
import { cdbToSQLite, sqliteToCDB, decompressCDB } from './cdb_converter.js';

// ES6 module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load paths from environment variables
const CONVERTER_PATH = process.env.PCM_CONVERTER_PATH;
const SAVE_PATH = process.env.PCM_SAVE_PATH;
const TMP_DIR = path.join(__dirname, 'tmp');

if (!CONVERTER_PATH) {
    console.error('Error: PCM_CONVERTER_PATH environment variable not set');
    process.exit(1);
}

if (!SAVE_PATH) {
    console.error('Error: PCM_SAVE_PATH environment variable not set');
    process.exit(1);
}

function wslToWindowsPath(wslPath) {
    const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/);
    if (match) {
        const drive = match[1].toUpperCase();
        const pathPart = match[2] || '';
        return `${drive}:${pathPart.replace(/\//g, '\\')}`;
    }
    return wslPath;
}

async function runTests() {
    console.log('='.repeat(70));
    console.log('CDB Converter Round-Trip Test');
    console.log('='.repeat(70));
    console.log('');

    const SQL = await initSqlJs();

    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR, { recursive: true });
    }

    const originalCdbPath = path.join(SAVE_PATH, 'test_original.cdb');
    const originalSqlitePath = path.join(SAVE_PATH, 'test_original.sqlite');
    const roundtripCdbPath = path.join(SAVE_PATH, 'test_roundtrip.cdb');
    const roundtripSqlitePath = path.join(SAVE_PATH, 'test_roundtrip.sqlite');

    // Check test files exist
    if (!fs.existsSync(originalCdbPath)) {
        console.error(`Error: ${originalCdbPath} not found`);
        process.exit(1);
    }

    // Generate test_original.sqlite if missing
    if (!fs.existsSync(originalSqlitePath)) {
        console.log('Setup: Generating test_original.sqlite from test_original.cdb (Official Tool)');
        try {
            const winOriginalCdbPath = wslToWindowsPath(originalCdbPath);
            execSync(`"${CONVERTER_PATH}" -a -export "${winOriginalCdbPath}"`, {
                encoding: 'utf-8',
                timeout: 60000
            });
            if (fs.existsSync(originalSqlitePath)) {
                console.log('  ✓ Created test_original.sqlite');
            } else {
                console.error('  ✗ Official tool did not create SQLite file');
                process.exit(1);
            }
        } catch (error) {
            console.error(`  ✗ Failed: ${error.message}`);
            process.exit(1);
        }
        console.log('');
    }

    let passed = 0;
    let total = 0;

    // Test 1: Read test_original.cdb and write test_roundtrip.cdb
    console.log('Step 1: Converting test_original.cdb → test_roundtrip.cdb (JS)');
    total++;
    try {
        const originalCdbData = fs.readFileSync(originalCdbPath).buffer;
        const db = cdbToSQLite(originalCdbData, SQL);
        const roundtripCdbData = sqliteToCDB(db);
        db.close();

        fs.writeFileSync(roundtripCdbPath, Buffer.from(roundtripCdbData));
        console.log('  ✓ Created test_roundtrip.cdb');
        passed++;
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
        process.exit(1);
    }
    console.log('');

    // Test 2: Compare decompressed CDB files
    console.log('Step 2: Comparing decompressed CDB files');
    total++;
    try {
        const originalData = fs.readFileSync(originalCdbPath);
        const roundtripData = fs.readFileSync(roundtripCdbPath);

        const originalDecompressed = Buffer.from(decompressCDB(originalData.buffer));
        const roundtripDecompressed = Buffer.from(decompressCDB(roundtripData.buffer));

        // Save decompressed versions for debugging
        fs.writeFileSync(path.join(TMP_DIR, 'test_original_decompressed.bin'), originalDecompressed);
        fs.writeFileSync(path.join(TMP_DIR, 'test_roundtrip_decompressed.bin'), roundtripDecompressed);

        if (originalDecompressed.length === roundtripDecompressed.length &&
            originalDecompressed.equals(roundtripDecompressed)) {
            console.log('  ✓ Decompressed CDB files are identical');
            passed++;
        } else {
            console.log(`  ✗ Decompressed CDB files differ`);
            console.log(`     Original size:  ${originalDecompressed.length} bytes`);
            console.log(`     Roundtrip size: ${roundtripDecompressed.length} bytes`);
        }
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
    }
    console.log('');

    // Test 3: Convert test_roundtrip.cdb to SQLite with official tool
    console.log('Step 3: Converting test_roundtrip.cdb → test_roundtrip.sqlite (Official Tool)');
    total++;
    try {
        // Clean up old roundtrip sqlite if exists
        if (fs.existsSync(roundtripSqlitePath)) {
            fs.unlinkSync(roundtripSqlitePath);
        }

        const winRoundtripCdbPath = wslToWindowsPath(roundtripCdbPath);
        execSync(`"${CONVERTER_PATH}" -a -export "${winRoundtripCdbPath}"`, {
            encoding: 'utf-8',
            timeout: 60000
        });

        if (fs.existsSync(roundtripSqlitePath)) {
            console.log('  ✓ Created test_roundtrip.sqlite');
            passed++;
        } else {
            console.log('  ✗ Official tool did not create SQLite file');
        }
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
    }
    console.log('');

    // Test 4: Compare SQLite files
    console.log('Step 4: Comparing test_original.sqlite to test_roundtrip.sqlite');
    total++;
    try {
        const dbOriginal = new SQL.Database(fs.readFileSync(originalSqlitePath));
        const dbRoundtrip = new SQL.Database(fs.readFileSync(roundtripSqlitePath));

        const result = compareDatabases(dbOriginal, dbRoundtrip, 'original', 'roundtrip');

        if (result.pass) {
            console.log('  ✓ SQLite files match');
            passed++;
        } else {
            console.log(`  ✗ SQLite files differ: ${result.error}`);
        }

        dbOriginal.close();
        dbRoundtrip.close();
    } catch (error) {
        console.log(`  ✗ Failed: ${error.message}`);
    }
    console.log('');

    console.log('='.repeat(70));
    console.log(`Results: ${passed}/${total} tests passed`);
    console.log('='.repeat(70));

    process.exit(passed === total ? 0 : 1);
}

// Compare two databases
function compareDatabases(db1, db2, label1 = 'db1', label2 = 'db2') {
    try {
        // Get tables
        const tables1 = getTables(db1);
        const tables2 = getTables(db2);

        if (tables1.length !== tables2.length) {
            return { pass: false, error: `Table count mismatch: ${label1} has ${tables1.length}, ${label2} has ${tables2.length}` };
        }

        for (const table of tables1) {
            if (!tables2.includes(table)) {
                return { pass: false, error: `Table '${table}' exists in ${label1} but missing in ${label2}` };
            }

            // Compare row count
            const count1 = getRowCount(db1, table);
            const count2 = getRowCount(db2, table);
            if (count1 !== count2) {
                return { pass: false, error: `Row count mismatch in '${table}': ${label1} has ${count1}, ${label2} has ${count2}` };
            }

            // Compare columns
            const cols1 = getColumns(db1, table);
            const cols2 = getColumns(db2, table);
            if (cols1.length !== cols2.length) {
                return { pass: false, error: `Column count mismatch in '${table}': ${label1} has ${cols1.length}, ${label2} has ${cols2.length}` };
            }

            for (let i = 0; i < cols1.length; i++) {
                if (cols1[i] !== cols2[i]) {
                    return { pass: false, error: `Column name mismatch in '${table}': ${label1} has '${cols1[i]}', ${label2} has '${cols2[i]}'` };
                }
            }

            // Compare column types
            const types1 = getColumnTypes(db1, table);
            const types2 = getColumnTypes(db2, table);
            for (let i = 0; i < types1.length; i++) {
                if (types1[i] !== types2[i]) {
                    return { pass: false, error: `Column type mismatch in '${table}' column '${cols1[i]}': ${label1} has '${types1[i]}', ${label2} has '${types2[i]}'` };
                }
            }

            // Compare data
            const data1 = getAllData(db1, table);
            const data2 = getAllData(db2, table);

            if (data1.length !== data2.length) {
                return { pass: false, error: `Data row count mismatch in '${table}': ${label1} has ${data1.length}, ${label2} has ${data2.length}` };
            }

            for (let i = 0; i < data1.length; i++) {
                for (let j = 0; j < data1[i].length; j++) {
                    const val1 = data1[i][j];
                    const val2 = data2[i][j];

                    // Skip timestamp comparison for TAG metadata rows in GAM_career_data
                    if (table === 'GAM_career_data' && j === 2 && data1[i][1] &&
                        (data1[i][1].includes('SQLITE_DB_EXPORT_TAG') || data1[i][1].includes('SQLITE_DB_IMPORT_TAG'))) {
                        continue;
                    }

                    // For floating point numbers, use epsilon comparison
                    // Check if either value is a float (has decimal point or is in scientific notation)
                    if (typeof val1 === 'number' && typeof val2 === 'number' &&
                        (!Number.isInteger(val1) || !Number.isInteger(val2) ||
                         Math.abs(val1) < 1e-6 || Math.abs(val2) < 1e-6)) {
                        const epsilon = 1e-6;
                        if (Math.abs(val1 - val2) > epsilon) {
                            return { pass: false, error: `Data mismatch in '${table}' row ${i}, column ${j}: ${label1} has ${val1}, ${label2} has ${val2}` };
                        }
                    } else if (val1 !== val2) {
                        return { pass: false, error: `Data mismatch in '${table}' row ${i}, column ${j}: ${label1} has ${val1}, ${label2} has ${val2}` };
                    }
                }
            }
        }

        return { pass: true };
    } catch (error) {
        return { pass: false, error: error.message };
    }
}

// Helper functions
function getTables(db) {
    const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    return result.length > 0 ? result[0].values.map(row => row[0]) : [];
}

function getRowCount(db, table) {
    const result = db.exec(`SELECT COUNT(*) FROM "${table}"`);
    return result.length > 0 ? result[0].values[0][0] : 0;
}

function getColumns(db, table) {
    const result = db.exec(`PRAGMA table_info("${table}")`);
    return result.length > 0 ? result[0].values.map(row => row[1]) : [];
}

function getColumnTypes(db, table) {
    const result = db.exec(`PRAGMA table_info("${table}")`);
    return result.length > 0 ? result[0].values.map(row => row[2]) : [];
}

function getAllData(db, table) {
    const result = db.exec(`SELECT * FROM "${table}"`);
    return result.length > 0 ? result[0].values : [];
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
