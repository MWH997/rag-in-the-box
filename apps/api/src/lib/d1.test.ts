import { describe, expect, it } from "vitest";

import {
  MAX_BOUND_PARAMETERS,
  batchForTable,
  batchRows,
  columnsOf,
  rowsPerStatement,
} from "./d1.js";
import { chunkVectors, chunks, documentSegments, usageDaily } from "../db/schema.js";

const TABLES = [chunks, documentSegments, chunkVectors, usageDaily];

describe("D1 statement batching", () => {
  it("keeps every batch inside the bound parameter limit for every table", () => {
    const rows = Array.from({ length: 250 }, (_, index) => index);
    for (const table of TABLES) {
      const columns = columnsOf(table);
      expect(columns).toBeGreaterThan(0);
      for (const batch of batchForTable(table, rows)) {
        expect(batch.length * columns).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS);
        expect(batch.length).toBeGreaterThan(0);
      }
    }
  });

  it("counts every column a table will bind, including defaulted ones", () => {
    // chunks carries an id and a created_at that the caller never supplies but
    // that still take a parameter each.
    expect(columnsOf(chunks)).toBeGreaterThanOrEqual(13);
  });

  it("loses no rows when splitting", () => {
    const rows = Array.from({ length: 97 }, (_, index) => index);
    expect(batchForTable(chunks, rows).flat()).toEqual(rows);
  });

  it("returns nothing for an empty input", () => {
    expect(batchForTable(chunks, [])).toEqual([]);
  });

  it("still emits one row per statement for an implausibly wide table", () => {
    expect(rowsPerStatement(500)).toBe(1);
    expect(rowsPerStatement(0)).toBe(1);
  });

  it("splits the batch size the free tier actually sends", () => {
    // The free tier sends 16 chunks per request, which must never become one
    // statement no matter how the table grows.
    const batches = batchForTable(chunks, Array.from({ length: 16 }));
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.length * columnsOf(chunks)).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS);
    }
  });

  it("splits the largest paid tier batch too", () => {
    const batches = batchForTable(chunks, Array.from({ length: 96 }));
    expect(batchRows(Array.from({ length: 96 }), columnsOf(chunks))).toEqual(batches);
    for (const batch of batches) {
      expect(batch.length * columnsOf(chunks)).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS);
    }
  });
});
