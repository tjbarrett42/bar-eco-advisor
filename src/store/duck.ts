import { DuckDBInstance } from "@duckdb/node-api";

export interface Duck {
  run(sql: string): Promise<void>;
  rows(sql: string): Promise<Record<string, unknown>[]>;
}

/** Open an in-memory DuckDB, run `fn`, and close the connection. */
export async function withDuck<T>(fn: (db: Duck) => Promise<T>): Promise<T> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const db: Duck = {
    async run(sql) {
      await connection.run(sql);
    },
    async rows(sql) {
      const reader = await connection.runAndReadAll(sql);
      return reader.getRowObjectsJson() as Record<string, unknown>[];
    },
  };
  try {
    return await fn(db);
  } finally {
    connection.closeSync();
  }
}
