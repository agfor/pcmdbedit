# Task Definition Format

Task definitions specify how the database editor displays and allows editing of database records.

## File Location

Task definitions are JSON files stored in the `tasks/` directory and referenced in the editor configuration.

## Structure

```json
{
  "name": "Human-readable task name",
  "main_table": "primary_database_table",
  "record_identifier": "group_name",
  "fields": ["group1", "group2"],
  "column_groups": {
    "group_name": {
      "columns": ["col1", "col2"],
      "values": { /* value specification */ }
    }
  }
}
```

## Top-Level Fields

### `name` (string, required)
Display name shown in the task selector dropdown.

### `main_table` (string, required)
The primary database table this task operates on. Column names without a table prefix default to this table.

### `record_identifier` (string, required)
The name of a column group to use for identifying and labeling records in the record selector dropdown. The first column in this group's `columns` array is used as the primary key.

### `fields` (array, required)
Array of column group names to display as editable fields in the form. Groups listed here will be shown in order.

### `column_groups` (object, required)
Named groups of columns that share the same value specification. Each group defines both which columns to use and how to populate/display values.

## Column Group Structure

Each column group has:

```json
{
  "columns": ["column_name1", "column_name2"],
  "values": {
    "type": "value_type",
    /* type-specific fields */
  }
}
```

### `columns` (array, required)
Array of column names. For `record_identifier` groups, the first column is the primary key. Column names can be:
- Unqualified (e.g., `"column_name"`) - defaults to `main_table`
- Qualified (e.g., `"TableName.column_name"`) - specifies exact table

### `values` (object, required)
Specifies what values are allowed and how to populate the control. Must include a `type` field.

## Value Types

### `readonly`

Display-only field. User cannot edit. Typically used for record identifiers without joins.

```json
{
  "type": "readonly"
}
```

**Renders as:** Read-only text input with gray background

---

### `enum`

Fixed set of labeled values (typically status codes or flags).

```json
{
  "type": "enum",
  "options": {
    "0": "Label for 0",
    "1": "Label for 1",
    "-1": "Label for -1"
  }
}
```

**Renders as:** Searchable dropdown with labels

**Note:** Enum labels are automatically applied in record identifier displays when a column appears in both an enum group and a join's display array.

---

### `list`

Array of allowed values. Can be any type but typically numbers.

```json
{
  "type": "list",
  "options": [50, 51, 52, 53, ..., 85]
}
```

**Renders as:**
- **Slider** if values are consecutive integers (e.g., `[50, 51, 52, ..., 85]`)
- **Dropdown** otherwise

---

### `query`

Execute SQL query to get allowed values.

```json
{
  "type": "query",
  "sql": "SELECT DISTINCT value FROM some_table ORDER BY value"
}
```

**SQL Requirements:**
- Must return a single column
- Each row becomes an option

**Renders as:** Dropdown populated with query results

---

### `join`

Join with another table to populate values. Used for foreign key relationships and record display.

```json
{
  "type": "join",
  "table": "referenced_table",
  "local_key": "fkIDcolumn",
  "foreign_key": "IDcolumn",
  "display": ["TableName.column1", "column2"]
}
```

**Fields:**
- `table`: The table being joined
- `local_key`: The foreign key column in the main table
- `foreign_key`: The primary key column in the referenced table
- `display`: Array of columns to show (can be qualified with table names)

**Renders as:**
- **For record identifiers:** Shows formatted label with all display columns
- **For fields:** Dropdown sorted by first display column

**Display Column Resolution:**
- Qualified columns (e.g., `"DYN_team.gene_sz_shortname"`) come from the specified table
- Unqualified columns (e.g., `"value_i_status"`) default to `main_table`
- Enum labels are automatically applied if a display column has a corresponding enum group

## Examples

### Contract Offers with Join and Enum

```json
{
  "name": "Edit Contract Offers",
  "main_table": "DYN_procyclist_contract_offer",
  "record_identifier": "record_info",
  "fields": ["status", "dates"],
  "column_groups": {
    "record_info": {
      "columns": ["IDprocyclist_contract_offer"],
      "values": {
        "type": "join",
        "table": "DYN_team",
        "local_key": "fkIDteam",
        "foreign_key": "IDteam",
        "display": ["DYN_team.gene_sz_shortname", "value_i_status"]
      }
    },
    "status": {
      "columns": ["value_i_status"],
      "values": {
        "type": "enum",
        "options": {
          "-1": "Not offered / Rejected",
          "0": "Will offer",
          "1": "Offer active",
          "2": "Offer accepted"
        }
      }
    },
    "dates": {
      "columns": ["value_i_date_proposal", "value_i_date_withdrawal"],
      "values": {
        "type": "query",
        "sql": "WITH RECURSIVE date_range AS (...) SELECT CAST(strftime('%Y%m%d', d) AS INTEGER) FROM date_range"
      }
    }
  }
}
```

**Record Display:** `Shortname: Uno-X Mobility - Status: Not offered / Rejected`
- `DYN_team.gene_sz_shortname` pulls from DYN_team table
- `value_i_status` pulls from main table and applies enum labels

### Rider Statistics with Sliders

```json
{
  "name": "Edit Rider Statistics",
  "main_table": "DYN_cyclist",
  "record_identifier": "record_info",
  "fields": ["statistics"],
  "column_groups": {
    "record_info": {
      "columns": ["IDcyclist"],
      "values": {
        "type": "readonly"
      }
    },
    "statistics": {
      "columns": [
        "charac_i_plain",
        "limit_i_plain",
        "charac_i_mountain",
        "limit_i_mountain"
      ],
      "values": {
        "type": "list",
        "options": [50, 51, 52, 53, 54, 55, ..., 85]
      }
    }
  }
}
```

**Record Display:** `ID: 12345` (readonly, no join)
**Fields:** Sliders for all statistics (consecutive integers)

## Column Name Formatting

Column names are automatically converted to human-readable labels by:
1. Removing common prefixes (`gene_sz_`, `gene_i_`, `value_i_`, `charac_i_`, `fkID`, etc.)
2. Replacing underscores with spaces
3. Title-casing each word

Examples:
- `gene_sz_firstname` → `Firstname`
- `value_i_status` → `Status`
- `charac_i_mountain` → `Mountain`
- `fkIDteam` → `Team`

## Design Principles

1. **Unified Structure:** Record identifiers and editable fields use the same column group format
2. **Explicit Table References:** Column names can specify their source table
3. **Smart Defaults:** Unqualified columns default to `main_table`
4. **Automatic Enum Integration:** Enum labels automatically apply in joins when column names match
5. **Flexible Display:** Join display arrays support multiple columns from any table
