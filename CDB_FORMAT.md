# CDB File Format Specification

Reverse engineering of the Pro Cycling Manager CDB database format.

## Table of Contents

1. [Format Overview](#format-overview)
2. [Binary Structure](#binary-structure)
3. [Chunk Types](#chunk-types)
4. [Data Types](#data-types)
5. [Implementation Guide](#implementation-guide)

---

## Format Overview

**Type**: Custom chunk-based binary format with hierarchical nesting
**Compression**: zlib deflate (optional, indicated by 0xFFFFFFFF header)
**Endianness**: Little-endian
**Alignment**: 4-byte boundaries

### Key Characteristics

- **Nested chunks**: Parent chunk size includes all nested children
- **Column-wise storage**: All rows for one column stored together (not row-wise)
- **Names in headers**: Table/column names stored in chunk description field, not data section
- **Metadata encoding**: Table ID and column index encoded in SQLite column type string

### Magic Values

| Value | Name | Purpose |
|-------|------|---------|
| 0xAAAAAAAA | CHUNK_BEGIN | Start of chunk header |
| 0xBBBBBBBB | CHUNK_SEPARATOR | End of header, start of data section |
| 0xCCCCCCCC | CHUNK_END | End of chunk (after padding) |
| 0xDDDDDDDD | ARRAY_BEGIN | Array begin marker (followed by count) |
| 0xEEEEEEEE | ARRAY_END | Array end marker (after all elements) |

### File Structure Hierarchy

```
File (optional zlib compression)
  └─ Chunk 0x00 (WRAPPER, description: "cyanide database")
      ├─ Chunk 0x02 (DATABASE_FLAGS - value: 274)
      └─ Chunk 0x01 (DATABASE_TABLES - contains tables array)
          └─ Chunk 0x10 (TABLE, name in description)
              ├─ Chunk 0x15 (TABLE_ID - 4 bytes)
              ├─ Chunk 0x11 (ROW_COUNT - 4 bytes)
              ├─ Chunk 0x16 (TABLE_FLAGS - 4 bytes, table-specific)
              └─ Chunk 0x12 (COLUMN_DEFINITIONS - contains columns array)
                  └─ Chunk 0x20 (COLUMN, name in description)
                      ├─ Chunk 0x24 (COLUMN_INDEX - 4 bytes)
                      ├─ Chunk 0x21 (COLUMN_DATA_TYPE - 4 bytes)
                      ├─ Chunk 0x22 (COLUMN_VALUES - N×4 bytes)
                      └─ Chunk 0x23 (COLUMN_BLOB_DATA - variable, optional)
```

---

## Binary Structure

### Chunk Header Format

All chunks use the same header structure:

```
Offset | Size | Type   | Description
-------|------|--------|----------------------------------
0x00   | 4    | uint   | Magic: 0xAAAAAAAA
0x04   | 4    | uint   | Chunk size (total bytes)
0x08   | 4    | uint   | Chunk type ID
0x0C   | 4    | uint   | Flags (always 0x00000000)
0x10   | 4    | uint   | Has description (0 or 1)
0x14   | 4    | uint   | [If has_description=1] Description length
0x18   | N    | bytes  | [If has_description=1] Description string (null-terminated)
???    | P    | bytes  | Padding to 4-byte alignment
???    | 4    | uint   | Magic: 0xBBBBBBBB (separator)
[Data section begins here]
???    | P    | bytes  | Padding to 4-byte alignment
???    | 4    | uint   | Magic: 0xCCCCCCCC (end marker)
```

**Padding calculation**: `(4 - (position & 3)) & 3`

### Integer Format

**Format**: Raw 4 bytes, little-endian, NO marker prefix

**Used in**: All simple metadata chunks (0x11, 0x02, 0x15, 0x16, 0x24, 0x21)

### Array Format

**Format**: 0xDDDDDDDD + 4-byte count + [nested chunk elements] + 0xEEEEEEEE

**Used in**: DATABASE_HEADER (0x01) and COLUMN_DEFINITIONS (0x12)

### Compression

Files may be zlib-compressed:

```
Offset | Size | Type   | Description
-------|------|--------|----------------------------------
0x00   | 4    | uint   | Magic: 0xFFFFFFFF (compression marker)
0x04   | 4    | uint   | Uncompressed size
0x08   | 4    | uint   | Compressed size
0x0C   | N    | bytes  | zlib compressed data
```

---

## Chunk Types

### Database Level

| Type | Name | Contains | Data |
|------|------|----------|------|
| 0x00 | WRAPPER | Database chunks | Container only |
| 0x01 | DATABASE_TABLES | Tables array | ARRAY_BEGIN + count + tables + ARRAY_END |
| 0x02 | DATABASE_FLAGS | Flags value | Single 32-bit value (always 274) |

### Table Level

| Type | Name | Contains | Data |
|------|------|----------|------|
| 0x10 | TABLE | Table chunks | Container (name in description) |
| 0x11 | ROW_COUNT | Row count | Single 32-bit integer |
| 0x12 | COLUMN_DEFINITIONS | Columns array | ARRAY_BEGIN + count + columns + ARRAY_END |
| 0x15 | TABLE_ID | Table identifier | Single 32-bit integer (stored in DB_STRUCTURE) |
| 0x16 | TABLE_FLAGS | Table flags | Single 32-bit integer (table-specific, see TABLE_FLAGS_BY_ID) |

### Column Level

| Type | Name | Contains | Data |
|------|------|----------|------|
| 0x20 | COLUMN | Column chunks | Container (name in description) |
| 0x21 | COLUMN_DATA_TYPE | Data type enum | Single 32-bit integer (see Data Types) |
| 0x22 | COLUMN_VALUES | Row values | N×4 bytes (one uint32 per row) |
| 0x23 | COLUMN_BLOB_DATA | Variable data | 4-byte size + packed data |
| 0x24 | COLUMN_INDEX | Column index | Single 32-bit integer (used in encoding formula) |

### Metadata Encoding

Column metadata is encoded in SQLite column type strings using this formula:
```
encoded_value = (table_id * 256 + column_index) * 16 + (data_type & 0xF)
```

This allows round-trip conversion by storing table_id and column_index in the SQLite schema. The DB_STRUCTURE table maps table names to table IDs.

---

## Data Types

### Type Enum (COLUMN_DATA_TYPE value)

| Enum | Type | Chunks Used | Storage Format | SQLite Type | Notes |
|------|------|-------------|----------------|-------------|-------|
| 0 | INTEGER | 0x22 | Signed int32 | INTEGER | Standard integers (4 bytes per value) |
| 1 | FLOAT | 0x22 | IEEE 754 float32 | REAL | Stored as uint32, reinterpreted as float (4 bytes per value) |
| 2 | STRING | 0x22 + 0x23 | Length-indexed | TEXT | Null-terminated strings |
| 3 | BOOLEAN | 0x22 | Bit-packed | NUMERIC | 1 bit per value, packed into bytes |
| 4 | INTEGER_BYTE | 0x22 | Signed int8 | INTEGER | Byte integers -128 to 127 (1 byte per value) |
| 5 | INTEGER_SHORT | 0x22 | Unsigned int16 | INTEGER | Short integers 0-65535 (2 bytes per value) |
| 10 | FLOAT_LIST | 0x22 + 0x23 | Count-indexed | TEXT | Formatted as `(v1,v2,v3)` |
| 11 | INTEGER_LIST | 0x22 + 0x23 | Count-indexed | TEXT | Formatted as `(v1,v2,v3)` |

### String Format (Type 2)

**COLUMN_VALUES (0x22)**: Array of string lengths (including null terminator)
**COLUMN_BLOB_DATA (0x23)**: Size (4 bytes) + packed null-terminated strings

```
Lengths in 0x22: [11, 12, 5]
→ String 1: offset 4, length 10 (11-1 for null)
→ String 2: offset 15, length 11 (12-1 for null)
→ String 3: offset 27, length 4 (5-1 for null)
```

### List Format (Types 10, 11)

**COLUMN_VALUES (0x22)**: Array of element counts per row
**COLUMN_BLOB_DATA (0x23)**: Size (4 bytes) + packed 32-bit values

For INTEGER_LIST, values stored as int32. For FLOAT_LIST, values stored as float32 (reinterpreted as uint32).

**SQLite Representation**: `(val1,val2,val3)` or `()` for empty

**Float List Formatting**:
- Precision: 6 decimals, trailing zeros removed
- Single-element: `(1)` or `(1.5)` (no `.0` suffix for whole numbers)
- Multi-element: `(1.0,2.0)` (`.0` suffix for whole numbers)

**Example**:
```
Counts: [3, 0, 2]
Data: [10, 20, 30, 40, 50]
→ Row 0: (10,20,30)
→ Row 1: ()
→ Row 2: (40,50)
```

### Boolean Format (Type 3)

**COLUMN_VALUES (0x22)**: Bit-packed boolean values (1 bit per row)

Each byte contains 8 boolean values. Bit 0 is row 0, bit 1 is row 1, etc.

**Example**:
```
Byte 0: 0b10110001 = rows 0, 4, 5, 7 are true (1)
Byte 1: 0b00000011 = rows 8, 9 are true
```

For N rows, ceil(N/8) bytes are stored.

### Byte Integer Format (Type 4)

**COLUMN_VALUES (0x22)**: Array of signed 8-bit integers (-128 to 127)

One byte per row, values -128 to 127.

### Short Integer Format (Type 5)

**COLUMN_VALUES (0x22)**: Array of unsigned 16-bit integers (0-65535)

Two bytes per row (little-endian), values 0-65535.

### Reading from CDB

| Type | Read From 0x22 | Conversion |
|------|----------------|------------|
| 0 | 4 bytes per row | Convert to signed int32 (`value \| 0`) |
| 1 | 4 bytes per row | Reinterpret bits as IEEE 754 float32 |
| 2 | 4 bytes per row (lengths) | Extract strings from 0x23 using lengths |
| 3 | 1 bit per row (packed) | Unpack bits into boolean values (0 or 1) |
| 4 | 1 byte per row | Read as signed int8 (-128 to 127) |
| 5 | 2 bytes per row | Read as unsigned int16 little-endian (0-65535) |
| 10, 11 | 4 bytes per row (counts) | Extract values from 0x23, format as text |

### Writing to CDB

SQLite column type and encoded value determine CDB data type:
- Extract type from encoded value: `type = encoded_value & 0xF`
- `INTEGER` with type 0 → type 0 (32-bit signed)
- `INTEGER` with type 4 → type 4 (8-bit unsigned)
- `INTEGER` with type 5 → type 5 (16-bit unsigned)
- `NUMERIC` with type 3 → type 3 (bit-packed boolean)
- `REAL` → type 1 (32-bit float)
- `TEXT` starting with `(` → type 10 or 11 (parse to determine integer vs float)
- `TEXT` other → type 2 (string)

---

## Implementation Guide

### Reading Algorithm

```
1. Decompress if needed (check for 0xFFFFFFFF magic)
2. Read chunk header → expect WRAPPER (0x00)
3. Read children until end:
   - DATABASE_FLAGS (0x02): read single uint32 value
   - DATABASE_TABLES (0x01): read array
     - Read ARRAY_BEGIN (0xDDDDDDDD)
     - Read table count (uint32)
     - For each table:
       - Read TABLE (0x10) chunk
       - Extract table name from description
       - Read children (order varies):
         - TABLE_ID (0x15): read uint32
         - ROW_COUNT (0x11): read uint32
         - TABLE_FLAGS (0x16): read uint32
         - COLUMN_DEFINITIONS (0x12): read array
           - Read ARRAY_BEGIN + column count
           - For each column:
             - Read COLUMN (0x20) chunk
             - Extract column name from description
             - Read children:
               - COLUMN_INDEX (0x24): read uint32
               - COLUMN_DATA_TYPE (0x21): read uint32
               - COLUMN_VALUES (0x22): read uint32 array
               - COLUMN_BLOB_DATA (0x23): read if present
             - Close column (CHUNK_END)
           - Read ARRAY_END (0xEEEEEEEE)
       - Close table (CHUNK_END)
     - Read ARRAY_END
4. Close WRAPPER (CHUNK_END)
```

### Writing Algorithm

```
1. Write WRAPPER (0x00) with description "cyanide database"
2. Write DATABASE_FLAGS (0x02) with value 274
3. Write DATABASE_TABLES (0x01):
   - Write ARRAY_BEGIN + table count
   - For each table (ordered by TABLE_ID):
     - Write TABLE (0x10) with table name
     - Write TABLE_ID (0x15)
     - Write ROW_COUNT (0x11)
     - Write TABLE_FLAGS (0x16)
     - Write COLUMN_DEFINITIONS (0x12):
       - Write ARRAY_BEGIN + column count
       - For each column (in original file order):
         - Write COLUMN (0x20) with column name
         - Write COLUMN_INDEX (0x24)
         - Write COLUMN_DATA_TYPE (0x21)
         - Write COLUMN_VALUES (0x22)
         - Write COLUMN_BLOB_DATA (0x23) if needed
         - Close column
       - Write ARRAY_END
     - Close table
   - Write ARRAY_END
4. Close WRAPPER
5. Compress with zlib deflate
```

### Key Implementation Details

**Padding**: After every data section and before CHUNK_END, pad to 4-byte alignment: `(4 - (position & 3)) & 3`

**Chunk Closing**: Always read/write padding + CHUNK_END (0xCCCCCCCC) after chunk data

**Column Order**: Preserve original column order from file; do NOT sort alphabetically

**TABLE_FLAGS**: Use hardcoded values from TABLE_FLAGS_BY_ID map (indexed by table ID)

**String Encoding**: UTF-8, null-terminated

**Float Storage**: Store as uint32 (reinterpret IEEE 754 bits), not as actual float value

### Round-Trip Preservation

The converter preserves these values for round-trip conversion:

1. **TABLE_ID** (0x15) → Stored in `DB_STRUCTURE` table as `ID` column
2. **COLUMN_INDEX** (0x24) → Encoded in SQLite column type string
3. **COLUMN_DATA_TYPE** (0x21) → Encoded in SQLite column type string
4. **TABLE_FLAGS** (0x16) → Hardcoded map in converter (TABLE_FLAGS_BY_ID)

Encoding formula:
```javascript
encoded_value = (table_id * 256 + column_index) * 16 + (data_type & 0xF)
```

Decoding formula:
```javascript
data_type = encoded_value & 0xF
column_index = Math.floor(encoded_value / 16) & 0xFF
table_id = Math.floor(encoded_value / (256 * 16))
```

### DB_STRUCTURE Table

Special table created during CDB → SQLite conversion:
```sql
CREATE TABLE DB_STRUCTURE (TableName TEXT '274', ID INTEGER)
```

The `'274'` encoding is special: table_id=1, column indices start from 1. This matches the DATABASE_FLAGS value of 274.
