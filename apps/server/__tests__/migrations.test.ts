/**
 * Migration integrity tests
 * 
 * These tests ensure that database migrations are consistent and don't have
 * conflicts like duplicate column additions across different migration files.
 */
import { describe, test, expect } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "../db/migrations");

interface ColumnAddition {
  table: string;
  column: string;
  file: string;
  line: number;
}

interface TableCreation {
  table: string;
  file: string;
  columns: string[];
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter(f => f.endsWith(".sql")).sort();
}

async function parseMigrationFile(filename: string): Promise<{
  columnAdditions: ColumnAddition[];
  tableCreations: TableCreation[];
}> {
  const filepath = join(MIGRATIONS_DIR, filename);
  const content = await readFile(filepath, "utf-8");
  const lines = content.split("\n");
  
  const columnAdditions: ColumnAddition[] = [];
  const tableCreations: TableCreation[] = [];
  
  // Parse ALTER TABLE ... ADD statements
  // Matches: ALTER TABLE `table` ADD `column` or ALTER TABLE `table` ADD COLUMN `column`
  const alterRegex = /ALTER TABLE [`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/gi;
  
  lines.forEach((line, index) => {
    let match;
    while ((match = alterRegex.exec(line)) !== null) {
      columnAdditions.push({
        table: match[1],
        column: match[2],
        file: filename,
        line: index + 1,
      });
    }
  });
  
  // Parse CREATE TABLE statements to extract columns
  const createTableRegex = /CREATE TABLE [`"]?(\w+)[`"]?\s*\(([\s\S]*?)\)/gi;
  let createMatch;
  while ((createMatch = createTableRegex.exec(content)) !== null) {
    const tableName = createMatch[1];
    const columnsBlock = createMatch[2];
    
    // Extract column names from the columns block
    const columnRegex = /[`"](\w+)[`"]\s+(?:text|integer|real|blob)/gi;
    const columns: string[] = [];
    let colMatch;
    while ((colMatch = columnRegex.exec(columnsBlock)) !== null) {
      columns.push(colMatch[1]);
    }
    
    tableCreations.push({
      table: tableName,
      file: filename,
      columns,
    });
  }
  
  return { columnAdditions, tableCreations };
}

describe("Database Migrations", () => {
  describe("Migration file structure", () => {
    test("migration files exist", async () => {
      const files = await getMigrationFiles();
      expect(files.length).toBeGreaterThan(0);
    });

    test("migration files are numbered sequentially", async () => {
      const files = await getMigrationFiles();
      
      files.forEach((file, index) => {
        const expectedPrefix = String(index).padStart(4, "0");
        expect(file.startsWith(expectedPrefix)).toBe(true);
      });
    });

    test("migration files have .sql extension", async () => {
      const files = await getMigrationFiles();
      
      files.forEach(file => {
        expect(file.endsWith(".sql")).toBe(true);
      });
    });
  });

  describe("Column conflicts", () => {
    test("no duplicate column additions across migrations", async () => {
      const files = await getMigrationFiles();
      const allAdditions: ColumnAddition[] = [];
      
      for (const file of files) {
        const { columnAdditions } = await parseMigrationFile(file);
        allAdditions.push(...columnAdditions);
      }
      
      // Group by table.column
      const columnMap = new Map<string, ColumnAddition[]>();
      
      for (const addition of allAdditions) {
        const key = `${addition.table}.${addition.column}`;
        if (!columnMap.has(key)) {
          columnMap.set(key, []);
        }
        columnMap.get(key)!.push(addition);
      }
      
      // Check for duplicates
      const duplicates: string[] = [];
      
      for (const [key, additions] of columnMap) {
        if (additions.length > 1) {
          const files = additions.map(a => `${a.file}:${a.line}`).join(", ");
          duplicates.push(`Column ${key} added in multiple migrations: ${files}`);
        }
      }
      
      expect(duplicates).toEqual([]);
    });

    test("ALTER TABLE ADD does not add column that exists in CREATE TABLE", async () => {
      const files = await getMigrationFiles();
      const allAdditions: ColumnAddition[] = [];
      const allCreations: TableCreation[] = [];
      
      // Process files in order
      for (const file of files) {
        const { columnAdditions, tableCreations } = await parseMigrationFile(file);
        allAdditions.push(...columnAdditions);
        allCreations.push(...tableCreations);
      }
      
      // Build a map of which columns exist from CREATE TABLE
      const existingColumns = new Map<string, { file: string }>();
      
      for (const creation of allCreations) {
        for (const column of creation.columns) {
          const key = `${creation.table}.${column}`;
          existingColumns.set(key, { file: creation.file });
        }
      }
      
      // Check if any ALTER TABLE ADD tries to add an existing column
      const conflicts: string[] = [];
      
      for (const addition of allAdditions) {
        const key = `${addition.table}.${addition.column}`;
        const existing = existingColumns.get(key);
        
        if (existing) {
          // Only a conflict if the CREATE TABLE came before the ALTER TABLE
          const existingFileNum = parseInt(existing.file.split("_")[0]);
          const additionFileNum = parseInt(addition.file.split("_")[0]);
          
          if (existingFileNum < additionFileNum) {
            conflicts.push(
              `Column ${key} created in ${existing.file} but ALTER TABLE ADD in ${addition.file}`
            );
          }
        }
      }
      
      expect(conflicts).toEqual([]);
    });
  });

  describe("Table conflicts", () => {
    test("no duplicate table creations", async () => {
      const files = await getMigrationFiles();
      const tableMap = new Map<string, string[]>();
      
      for (const file of files) {
        const { tableCreations } = await parseMigrationFile(file);
        
        for (const creation of tableCreations) {
          if (!tableMap.has(creation.table)) {
            tableMap.set(creation.table, []);
          }
          tableMap.get(creation.table)!.push(file);
        }
      }
      
      // Check for duplicates
      const duplicates: string[] = [];
      
      for (const [table, files] of tableMap) {
        if (files.length > 1) {
          duplicates.push(`Table ${table} created in multiple migrations: ${files.join(", ")}`);
        }
      }
      
      expect(duplicates).toEqual([]);
    });
  });

  describe("SQL syntax validation", () => {
    test("no obviously malformed SQL statements", async () => {
      const files = await getMigrationFiles();
      const issues: string[] = [];
      
      for (const file of files) {
        const filepath = join(MIGRATIONS_DIR, file);
        const content = await readFile(filepath, "utf-8");
        
        // Check for common SQL issues
        
        // Unclosed parentheses in CREATE TABLE (simple check)
        const createMatches = content.match(/CREATE TABLE[^;]+/g) || [];
        for (const match of createMatches) {
          const openParens = (match.match(/\(/g) || []).length;
          const closeParens = (match.match(/\)/g) || []).length;
          if (openParens !== closeParens) {
            issues.push(`${file}: Unbalanced parentheses in CREATE TABLE`);
          }
        }
        
        // Check for missing semicolons before statement breakpoints
        if (content.includes("--> statement-breakpoint")) {
          const parts = content.split("--> statement-breakpoint");
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i].trim();
            if (part && !part.endsWith(";")) {
              issues.push(`${file}: Missing semicolon before statement-breakpoint`);
            }
          }
        }
      }
      
      expect(issues).toEqual([]);
    });
  });
});

describe("Migration journal consistency", () => {
  test("journal entries match migration files", async () => {
    const journalPath = join(MIGRATIONS_DIR, "meta/_journal.json");
    const journalContent = await readFile(journalPath, "utf-8");
    const journal = JSON.parse(journalContent);
    
    const migrationFiles = await getMigrationFiles();
    
    // Each journal entry should have a corresponding migration file
    for (const entry of journal.entries) {
      const expectedFile = `${entry.tag}.sql`;
      expect(
        migrationFiles.includes(expectedFile),
        `Journal entry ${entry.tag} has no corresponding migration file`
      ).toBe(true);
    }
    
    // Each migration file should have a journal entry
    for (const file of migrationFiles) {
      const tag = file.replace(".sql", "");
      const hasEntry = journal.entries.some((e: { tag: string }) => e.tag === tag);
      expect(
        hasEntry,
        `Migration file ${file} has no journal entry`
      ).toBe(true);
    }
  });

  test("journal entries are in chronological order", async () => {
    const journalPath = join(MIGRATIONS_DIR, "meta/_journal.json");
    const journalContent = await readFile(journalPath, "utf-8");
    const journal = JSON.parse(journalContent);
    
    for (let i = 0; i < journal.entries.length; i++) {
      expect(journal.entries[i].idx).toBe(i);
    }
  });
});
