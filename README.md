# PCM Database Editor

A browser-based editor for Pro Cycling Manager database files, featuring a complete implementation and documentation of the CDB binary format.

**🔗 Use it now:** https://agfor.github.io/pcmdbedit/

**Privacy:** All processing happens locally in your browser. No files are uploaded to any server. No tracking or analytics.

## About This Project

This project serves two purposes:

### 1. As an Editing Tool
A browser-based interface for editing PCM save files with:
- **Task-driven editing** - Pre-configured editing tasks with appropriate controls
- **Auto-save** - Changes saved immediately to in-memory database
- **Searchable dropdowns** - Quick record selection with search
- **Smart controls** - Sliders for ranges, dropdowns for enums, joined tables
- **Dual format support** - Works with both CDB and SQLite files

### 2. As a CDB Format Implementation
A working decoder/encoder for the proprietary CDB format:
- **Complete CDB parser** (`cdb_converter.js`) - Handles binary format, compression, table structures
- **Round-trip conversion** - CDB → SQLite → CDB with full fidelity
- **Format documentation** (`CDB_FORMAT.md`) - Detailed specification of the binary format
- **Reference implementation** - Can be used by other projects needing CDB support

## Requirements

- Modern browser with ES6 module support (Chrome 89+, Firefox 108+, Safari 16.4+, Edge 89+)
- Pro Cycling Manager 2025 (may work with other versions but not tested)

## Usage

1. Open `index.html` in a modern browser
2. Drag and drop a CDB or SQLite file (or click to browse)
3. Select a task from the dropdown (e.g., "Edit Rider Statistics")
4. Pick a record from the searchable list
5. Edit fields - changes save automatically
6. Download the modified database (SQLite or CDB format)

## Finding Your Database Files

PCM database files are stored in your Windows AppData directory:

```
%APPDATA%\Pro Cycling Manager 2025\
```

Common locations:
- **Cloud saves:** `%APPDATA%\Pro Cycling Manager 2025\Cloud\<SteamID>\`
- **Weekly saves:** `%APPDATA%\Pro Cycling Manager 2025\WeeklySaves\<SteamID>\`

Files are typically named like `ProCyclist_1.cdb` or similar. Copy the file before editing to preserve your original save.

## Project Structure

### Editing Tool
```
index.html              # Main application interface
db_editor.js            # Core editor logic and form generation
db_file_handler.js      # File I/O and format conversion orchestration
task_processor.js       # Task definition processing and validation
tasks/                  # Task definition JSON files
  edit_rider_statistics.json
  edit_contract_offers.json
TASK_FORMAT.md          # How to create new editing tasks
```

### CDB Format Implementation
```
cdb_converter.js        # CDB binary format parser/writer
CDB_FORMAT.md           # Complete CDB format specification
test_cdb_conversion.js  # Round-trip conversion tests
```

## Technology

- **SQL.js** - SQLite in WebAssembly
- **Pako** - Compression/decompression for CDB format
- **Choices.js** - Enhanced dropdowns
- **Vanilla JavaScript** - ES6 modules, no build step required

## TODO

- [ ] Add task to change which countries go to world championships
- [ ] Implement additional useful editing tasks
- [ ] Feed saves to PCM+ and compare input/output databases to understand schema and identify useful editing operations
