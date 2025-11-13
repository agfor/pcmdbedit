/**
 * CDB Converter
 * Handles conversion between CDB binary format and SQLite
 */

import pako from 'pako';

const MAGIC = {
CHUNK_BEGIN: 0xAAAAAAAA,
CHUNK_SEPARATOR: 0xBBBBBBBB,
CHUNK_END: 0xCCCCCCCC,
ARRAY_BEGIN: 0xDDDDDDDD,
ARRAY_END: 0xEEEEEEEE
};

const CHUNK_TYPE = {
WRAPPER: 0x00,
DATABASE_TABLES: 0x01,        // Contains array of tables
DATABASE_FLAGS: 0x02,          // Database-level flags/metadata
TABLE: 0x10,                   // Table container with nested chunks
ROW_COUNT: 0x11,               // Number of rows in table
COLUMN_DEFINITIONS: 0x12,      // Array of column definitions
TABLE_ID: 0x15,                // Table identifier/link
TABLE_FLAGS: 0x16,             // Table-level flags/metadata
COLUMN: 0x20,                  // Column container with cell chunks
COLUMN_DATA_TYPE: 0x21,        // Data type enum for column
COLUMN_VALUES: 0x22,           // Row values for column
COLUMN_BLOB_DATA: 0x23,        // Variable-length data (strings, lists)
COLUMN_INDEX: 0x24             // Column index (used in encoding formula)
};

const DATA_TYPE = {
INTEGER: 0,
FLOAT: 1,
STRING: 2,
FLOAT_LIST: 10,
INTEGER_LIST: 11
};

// TABLE_FLAGS values by table ID (extracted from a save file, meaning unknown)
const TABLE_FLAGS_BY_ID = {
3: 65, 4: 50, 8: 129, 9: 241, 10: 209, 11: 241, 12: 241, 14: 129, 16: 65, 17: 97,
18: 49, 19: 49, 22: 225, 23: 161, 24: 65, 25: 188, 26: 113, 27: 33, 28: 51, 29: 33,
30: 129, 31: 177, 35: 129, 36: 241, 39: 49, 40: 241, 41: 81, 44: 241, 45: 113, 50: 33,
51: 76, 52: 97, 53: 81, 54: 33, 55: 81, 59: 241, 65: 227, 80: 33, 81: 19, 83: 19,
84: 19, 85: 35, 86: 33, 87: 241, 92: 113, 93: 35, 94: 82, 98: 49, 99: 35, 100: 65,
101: 83, 107: 163, 108: 241, 109: 75, 110: 49, 111: 81, 113: 49, 117: 35, 118: 129, 119: 33,
122: 241, 124: 65, 125: 60, 126: 19, 127: 19, 128: 65, 129: 81, 131: 241, 132: 44, 134: 241,
135: 51, 136: 99, 137: 227, 142: 195, 143: 145, 144: 113, 145: 33, 146: 35, 147: 49, 149: 19,
152: 241, 153: 49, 155: 33, 159: 33, 164: 243, 166: 241, 168: 161, 170: 146, 172: 241, 173: 33,
175: 241, 177: 130, 179: 113, 180: 145, 181: 97, 185: 82, 186: 193, 192: 65, 193: 242, 200: 50,
202: 98, 203: 33, 204: 65, 205: 49, 206: 92, 207: 145, 208: 65, 209: 33, 210: 49, 211: 34,
213: 17, 215: 177, 217: 81, 218: 156, 220: 241, 221: 145, 223: 65, 224: 97, 225: 65, 228: 241,
229: 161, 230: 49, 231: 33, 236: 33, 240: 241, 241: 65, 242: 19, 244: 178, 245: 241, 246: 33,
249: 115, 250: 193, 251: 83, 252: 193, 253: 49, 254: 92, 255: 83, 256: 19, 257: 81, 258: 97,
259: 33, 263: 65, 264: 129, 265: 33, 266: 129, 268: 33, 270: 19, 273: 65, 274: 129
};

export function cdbToSQLite(cdbData, SQL) {
    const decompressedData = decompressCDB(cdbData);
    const reader = new CDBReader(decompressedData);
    const db = new SQL.Database();

    const wrapperChunk = reader.readChunk();
    const tables = wrapperChunk.children[CHUNK_TYPE.DATABASE_TABLES];

    // DB_STRUCTURE uses special encoding: table_id=1, columns indexed from 1
    db.run(`CREATE TABLE DB_STRUCTURE (TableName TEXT '274', ID INTEGER)`);

    tables.forEach((table) => {
        if (table.tableId === null) {
            throw new Error(`Table '${table.name}' has null tableId`);
        }
        db.run(`INSERT INTO DB_STRUCTURE VALUES (?, ?)`, [table.name, table.tableId]);

        // Keep columns in original file order (do NOT sort)
        const columnDefs = table.columns.map((col) => {
            let baseType;
            switch (col.type) {
                case DATA_TYPE.FLOAT:
                    baseType = 'REAL';
                    break;
                case DATA_TYPE.STRING:
                case DATA_TYPE.INTEGER_LIST:
                case DATA_TYPE.FLOAT_LIST:
                    baseType = 'TEXT';
                    break;
                default:
                    baseType = 'INTEGER';
                    break;
            }

            const encodedValue = (table.tableId * 256 + col.columnIndex) * 16 + (col.type & 0xF);
            return `"${col.name}" '${baseType} ${encodedValue}'`;
        }).join(', ');

        db.run(`CREATE TABLE "${table.name}" (${columnDefs})`);

        // Insert rows in batches (SQLite limit: 999 variables)
        if (table.rowCount > 0) {
            const columnsPerRow = table.columns.length;
            const maxRowsPerBatch = Math.floor(999 / columnsPerRow);
            const placeholders = table.columns.map(() => '?').join(', ');

            for (let i = 0; i < table.rowCount; i += maxRowsPerBatch) {
                const end = Math.min(i + maxRowsPerBatch, table.rowCount);
                const batchCount = end - i;
                const valueSets = Array(batchCount).fill(`(${placeholders})`).join(', ');
                const params = [];

                for (let rowIdx = i; rowIdx < end; rowIdx++) {
                    table.columns.forEach(col => params.push(col.data[rowIdx]));
                }

                db.run(`INSERT INTO "${table.name}" VALUES ${valueSets}`, params);
            }
        }
    });

    return db;
}

export function compressCDB(uncompressedData) {

    const compressed = pako.deflate(uncompressedData);
    const result = new Uint8Array(12 + compressed.length);
    const view = new DataView(result.buffer);
    view.setUint32(0, 0xFFFFFFFF, true);
    view.setUint32(4, uncompressedData.length, true);
    view.setUint32(8, compressed.length, true);
    result.set(compressed, 12);

    return result.buffer;
}

export function sqliteToCDB(db) {
    const tablesResult = db.exec(`SELECT TableName, ID FROM DB_STRUCTURE ORDER BY ID`);
    if (tablesResult.length === 0) {
        throw new Error('No DB_STRUCTURE table found');
    }

    const tables = tablesResult[0].values.map(row => ({ name: row[0], id: row[1] }));

    const estimatedSize = db.export().length;
    const writer = new CDBWriter(estimatedSize);

    writer.writeChunkOpen(CHUNK_TYPE.WRAPPER, 'cyanide database');
    writer.writeChunkOpen(CHUNK_TYPE.DATABASE_FLAGS);
    writer.write32(274);
    writer.writeChunkClose();

    writer.writeChunkOpen(CHUNK_TYPE.DATABASE_TABLES);
    writer.write32(MAGIC.ARRAY_BEGIN);
    writer.write32(tables.length);

    tables.forEach(tableInfo => {
        const schemaResult = db.exec(`PRAGMA table_info("${tableInfo.name}")`);
        const columnInfo = {};
        schemaResult[0].values.forEach(([, colName, colType]) => {
            // Extract encoded value from column type (e.g., 'INTEGER 12345')
            const match = colType.match(/\s+(\d+)/);
            const encodedValue = parseInt(match[1]);
            // Formula: (table_id * 256 + column_index) * 16 + dataType
            const dataType = encodedValue & 0xF;
            const columnIndex = Math.floor(encodedValue / 16) & 0xFF;
            columnInfo[colName] = {
                sqliteType: colType.split(' ')[0],
                cdbDataType: dataType,
                cdbColumnIndex: columnIndex
            };
        });

        const dataResult = db.exec(`SELECT * FROM "${tableInfo.name}"`);
        const rows = dataResult.length > 0 ? dataResult[0].values : [];

        writer.writeChunkOpen(CHUNK_TYPE.TABLE, tableInfo.name);

        writer.writeChunkOpen(CHUNK_TYPE.TABLE_ID);
        writer.write32(tableInfo.id);
        writer.writeChunkClose();

        writer.writeChunkOpen(CHUNK_TYPE.ROW_COUNT);
        writer.write32(rows.length);
        writer.writeChunkClose();

        writer.writeChunkOpen(CHUNK_TYPE.TABLE_FLAGS);
        writer.write32(TABLE_FLAGS_BY_ID[tableInfo.id]);
        writer.writeChunkClose();

        writer.writeChunkOpen(CHUNK_TYPE.COLUMN_DEFINITIONS);
        writer.write32(MAGIC.ARRAY_BEGIN);
        writer.write32(Object.keys(columnInfo).length);

        // Transpose row data to column data in single pass
        const columnNames = Object.keys(columnInfo);
        const columnData = columnNames.map(() => []);
        rows.forEach(row => {
            row.forEach((value, colIdx) => {
                columnData[colIdx].push(value);
            });
        });

        columnNames.forEach((columnName, colIdx) => {
            writer.writeChunkOpen(CHUNK_TYPE.COLUMN, columnName);

            const info = columnInfo[columnName];

            writer.writeChunkOpen(CHUNK_TYPE.COLUMN_INDEX);
            writer.write32(info.cdbColumnIndex);
            writer.writeChunkClose();

            writer.writeChunkOpen(CHUNK_TYPE.COLUMN_DATA_TYPE, columnName);
            writer.write32(info.cdbDataType);
            writer.writeChunkClose();

            writer.writeColumnData(info.cdbDataType, columnData[colIdx]);

            writer.writeChunkClose();
        });

        writer.write32(MAGIC.ARRAY_END);
        writer.writeChunkClose();

        writer.writeChunkClose();
    });

    writer.write32(MAGIC.ARRAY_END);
    writer.writeChunkClose();
    writer.writeChunkClose();

    return compressCDB(writer.getData());
}

export function decompressCDB(arrayBuffer) {
    const view = new DataView(arrayBuffer);

    if (view.getUint32(0, true) !== 0xFFFFFFFF) {
        return arrayBuffer;
    }


    const compressedSize = view.getUint32(8, true);
    const compressedData = new Uint8Array(arrayBuffer, 12, compressedSize);
    return pako.inflate(compressedData).buffer;
}

class CDBReader {
    constructor(arrayBuffer) {
        this.data = new DataView(arrayBuffer);
        this.pos = 0;
        this.chunkStack = [];
    }

    read32() {
        if (this.pos + 4 > this.data.byteLength) {
            throw new Error(`Read past end of file at position ${this.pos}`);
        }
        const value = this.data.getUint32(this.pos, true); // little-endian
        this.pos += 4;
        return value;
    }

    readBytes(length) {
        if (this.pos + length > this.data.byteLength) {
            throw new Error(`Read past end of file at position ${this.pos}`);
        }
        const bytes = new Uint8Array(this.data.buffer, this.data.byteOffset + this.pos, length);
        this.pos += length;
        return bytes;
    }

    readPadding() {
        const padding = (4 - (this.pos & 3)) & 3;
        this.pos += padding;
    }

    readChunkHeader() {
        this.read32();
        const chunkSize = this.read32();
        const chunkType = this.read32();
        const flags = this.read32();
        const hasDescription = this.read32();

        let description = null;
        if (hasDescription) {
            const descLength = this.read32();
            const descBytes = this.readBytes(descLength - 1);
            description = new TextDecoder().decode(descBytes);
            this.pos++;
        }

        this.readPadding();
        this.read32();

        return { chunkSize, chunkType, flags, description };
    }

    readChunk() {
        const chunkStartPos = this.pos;
        const header = this.readChunkHeader();
        const chunkEndPos = chunkStartPos + header.chunkSize;

        let result;

        switch (header.chunkType) {
            case CHUNK_TYPE.ROW_COUNT:
            case CHUNK_TYPE.TABLE_ID:
            case CHUNK_TYPE.TABLE_FLAGS:
            case CHUNK_TYPE.DATABASE_FLAGS:
            case CHUNK_TYPE.COLUMN_INDEX:
            case CHUNK_TYPE.COLUMN_DATA_TYPE:
                result = { type: header.chunkType, value: this.read32() };
                break;

            case CHUNK_TYPE.COLUMN_VALUES:
                const dataBytes = chunkEndPos - this.pos - 4;
                const values = [];
                for (let i = 0; i < dataBytes / 4; i++) {
                    values.push(this.read32());
                }
                result = { type: header.chunkType, value: values };
                break;

            case CHUNK_TYPE.COLUMN_BLOB_DATA:
                const sizedDataBytes = chunkEndPos - this.pos - 4;
                result = { type: header.chunkType, value: this.readBytes(sizedDataBytes) };
                break;

            case CHUNK_TYPE.DATABASE_TABLES:
                const tables = this.readArray(() => {
                    const tableChunk = this.readChunk();
                    return {
                        name: tableChunk.header.description,
                        rowCount: tableChunk.children[CHUNK_TYPE.ROW_COUNT],
                        columns: tableChunk.children[CHUNK_TYPE.COLUMN_DEFINITIONS],
                        tableId: tableChunk.children[CHUNK_TYPE.TABLE_ID],
                        tableFlags: tableChunk.children[CHUNK_TYPE.TABLE_FLAGS]
                    };
                });
                result = { type: header.chunkType, value: tables };
                break;

            case CHUNK_TYPE.COLUMN_DEFINITIONS:
                const columns = this.readArray(() => {
                    const columnChunk = this.readChunk();
                    return {
                        name: columnChunk.header.description,
                        type: columnChunk.children[CHUNK_TYPE.COLUMN_DATA_TYPE],
                        data: this.convertColumnData(columnChunk),
                        columnIndex: columnChunk.children[CHUNK_TYPE.COLUMN_INDEX]
                    };
                });
                result = { type: header.chunkType, value: columns };
                break;

            case CHUNK_TYPE.WRAPPER:
            case CHUNK_TYPE.TABLE:
            case CHUNK_TYPE.COLUMN:
                const children = {};
                while (this.pos < chunkEndPos) {
                    if (chunkEndPos - this.pos < 20) {
                        break;
                    }
                    const chunk = this.readChunk();
                    children[chunk.type] = chunk.value;
                }
                result = {
                    type: header.chunkType,
                    header,
                    children
                };
                break;

            default:
                throw new Error(`Unknown chunk type: 0x${header.chunkType.toString(16)}`);
        }

        this.readPadding();
        this.read32();
        return result;
    }

    readArray(itemReader) {
        this.read32();
        const count = this.read32();
        const items = [];

        for (let i = 0; i < count; i++) {
            items.push(itemReader.call(this));
        }

        this.read32();
        return items;
    }

    convertColumnData(columnChunk) {
        const dataType = columnChunk.children[CHUNK_TYPE.COLUMN_DATA_TYPE];
        const rawData = columnChunk.children[CHUNK_TYPE.COLUMN_VALUES];
        const sizedData = columnChunk.children[CHUNK_TYPE.COLUMN_BLOB_DATA] ?? new Uint8Array([0, 0, 0, 0]);

        switch (dataType) {
            case DATA_TYPE.INTEGER:
                return rawData.map(value => value | 0);

            case DATA_TYPE.FLOAT:
                const view = new DataView(new ArrayBuffer(4));
                return rawData.map(intValue => {
                    view.setUint32(0, intValue, true);
                    return view.getFloat32(0, true);
                });

            case DATA_TYPE.STRING:
                return this.parseStrings(sizedData, rawData);

            case DATA_TYPE.INTEGER_LIST:
                return this.parseNumericLists(sizedData, rawData, (view, offset) => {
                    return view.getUint32(offset, true) | 0;
                });

            case DATA_TYPE.FLOAT_LIST:
                return this.parseNumericLists(sizedData, rawData, (view, offset, count) => {
                    const value = view.getFloat32(offset, true);
                    let formatted = value.toFixed(6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
                    if (!formatted.includes('.') && count > 1) {
                        formatted += '.0';
                    }
                    return formatted;
                });

            default:
                throw new Error(`Unknown data type: ${dataType}`);
        }
    }

    parseStrings(sizedData, lengths) {
        let currentOffset = 4;

        return lengths.map(stringLength => {
            const stringBytes = sizedData.subarray(currentOffset, currentOffset + stringLength - 1);
            currentOffset += stringLength;
            return new TextDecoder().decode(stringBytes);
        });
    }

    parseNumericLists(sizedData, counts, readValue) {
        const view = new DataView(sizedData.buffer, sizedData.byteOffset, sizedData.byteLength);
        let currentOffset = 4;

        return counts.map(count => {
            const values = Array.from({ length: count }, () => {
                const value = readValue(view, currentOffset, count);
                currentOffset += 4;
                return value;
            });
            return '(' + values.join(',') + ')';
        });
    }

}

class CDBWriter {
    constructor(estimatedSize = 1024 * 1024) {
        this.buffer = new Uint8Array(estimatedSize);
        this.view = new DataView(this.buffer.buffer);
        this.chunkStack = [];
        this.closedChunks = [];
        this.pos = 0;
    }

    ensureCapacity(additionalBytes) {
        if (this.pos + additionalBytes > this.buffer.length) {
            const newSize = Math.max(Math.ceil(this.buffer.length * 1.5), this.pos + additionalBytes);
            const newBuffer = new Uint8Array(newSize);
            newBuffer.set(this.buffer);
            this.buffer = newBuffer;
            this.view = new DataView(this.buffer.buffer);
        }
    }

    write32(value) {
        this.ensureCapacity(4);
        this.view.setUint32(this.pos, value, true);
        this.pos += 4;
    }

    writeBytes(bytes) {
        this.ensureCapacity(bytes.length);
        this.buffer.set(bytes, this.pos);
        this.pos += bytes.length;
    }

    writePadding() {
        const padding = (4 - (this.pos & 3)) & 3;
        if (padding > 0) {
            this.ensureCapacity(padding);
            this.pos += padding;
        }
    }

    writeChunkOpen(chunkType, description = null) {
        const chunkStart = this.pos;

        this.write32(MAGIC.CHUNK_BEGIN);
        this.write32(0);
        this.write32(chunkType);
        this.write32(0);
        this.write32(description ? 1 : 0);

        if (description) {
            const descBytes = new TextEncoder().encode(description);
            this.write32(descBytes.length + 1);
            this.writeBytes(descBytes);
            this.ensureCapacity(1);
            this.buffer[this.pos] = 0;
            this.pos += 1;
        }

        this.writePadding();
        this.write32(MAGIC.CHUNK_SEPARATOR);

        this.chunkStack.push({ type: chunkType, startPos: chunkStart });
    }

    writeChunkClose() {
        const chunk = this.chunkStack.pop();

        this.writePadding();
        this.write32(MAGIC.CHUNK_END);

        chunk.size = this.pos - chunk.startPos;
        this.closedChunks.push(chunk);
    }

    getData() {
        for (const chunk of this.closedChunks) {
            this.view.setUint32(chunk.startPos + 4, chunk.size, true);
        }

        return this.buffer.subarray(0, this.pos);
    }

    writeColumnData(dataType, values) {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);

        this.writeChunkOpen(CHUNK_TYPE.COLUMN_VALUES);

        switch (dataType) {
            case DATA_TYPE.INTEGER:
                values.forEach(value => this.write32(value));
                break;

            case DATA_TYPE.FLOAT:
                values.forEach(value => {
                    view.setFloat32(0, parseFloat(value), true);
                    this.write32(view.getUint32(0, true));
                });
                break;

            case DATA_TYPE.STRING:
                this.writeStringData(values);
                break;

            case DATA_TYPE.INTEGER_LIST:
            case DATA_TYPE.FLOAT_LIST:
                this.writeListData(dataType, values);
                break;
        }

        this.writeChunkClose();
    }

    writeStringData(values) {
        const lengths = [];
        const stringData = [];
        const encoder = new TextEncoder();

        values.forEach(value => {
            const encoded = encoder.encode(value);
            stringData.push(...encoded, 0);
            lengths.push(encoded.length + 1);
        });

        lengths.forEach(len => this.write32(len));

        if (stringData.length > 0) {
            this.writeChunkClose();
            this.writeChunkOpen(CHUNK_TYPE.COLUMN_BLOB_DATA);
            this.write32(stringData.length);
            this.writeBytes(new Uint8Array(stringData));
        }
    }

    writeListData(dataType, values) {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        const counts = [];
        const listData = [];

        values.forEach(value => {
            const content = String(value).slice(1, -1);
            if (content === '') {
                counts.push(0);
            } else {
                const elements = content.split(',').map(s => s.trim());
                counts.push(elements.length);

                elements.forEach(elem => {
                    if (dataType === DATA_TYPE.FLOAT_LIST) {
                        view.setFloat32(0, parseFloat(elem), true);
                        listData.push(view.getUint32(0, true));
                    } else {
                        listData.push(parseInt(elem) | 0);
                    }
                });
            }
        });

        counts.forEach(count => this.write32(count));

        if (listData.length > 0) {
            this.writeChunkClose();
            this.writeChunkOpen(CHUNK_TYPE.COLUMN_BLOB_DATA);
            this.write32(listData.length * 4);
            listData.forEach(value => this.write32(value));
        }
    }
}
