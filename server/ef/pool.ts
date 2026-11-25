import mysql from "mysql2/promise";
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 未設定");
    pool = mysql.createPool({
      uri: url,
      connectionLimit: 10,
      timezone: "Z",
      dateStrings: false,
      charset: "utf8mb4",
      ssl: { rejectUnauthorized: true },
    });
    // 時間一律以 UTC 儲存；畫面按香港時間顯示
    (pool as any).pool.on("connection", (c: any) => c.query("SET time_zone = '+00:00'"));
  }
  return pool;
}

export type Row = RowDataPacket & Record<string, any>;

export async function q<T = Row>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

export async function q1<T = Row>(sql: string, params: any[] = []): Promise<T | undefined> {
  const rows = await q<T>(sql, params);
  return rows[0];
}

export async function exec(sql: string, params: any[] = []): Promise<ResultSetHeader> {
  const [res] = await getPool().query<ResultSetHeader>(sql, params);
  return res;
}

export type Tx = {
  q: <T = Row>(sql: string, params?: any[]) => Promise<T[]>;
  q1: <T = Row>(sql: string, params?: any[]) => Promise<T | undefined>;
  exec: (sql: string, params?: any[]) => Promise<ResultSetHeader>;
};

/** 在單一資料庫交易內執行；失敗自動回滾。 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const conn: PoolConnection = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const tx: Tx = {
      q: async (sql, params = []) => {
        const [rows] = await conn.query<RowDataPacket[]>(sql, params);
        return rows as any;
      },
      q1: async (sql, params = []) => {
        const [rows] = await conn.query<RowDataPacket[]>(sql, params);
        return (rows as any)[0];
      },
      exec: async (sql, params = []) => {
        const [res] = await conn.query<ResultSetHeader>(sql, params);
        return res;
      },
    };
    const out = await fn(tx);
    await conn.commit();
    return out;
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
}

export async function audit(actorUserId: number | null, action: string, entityType?: string, entityId?: number, detail?: unknown) {
  try {
    await exec("INSERT INTO ef_audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?)", [
      actorUserId,
      action,
      entityType ?? null,
      entityId ?? null,
      detail === undefined ? null : JSON.stringify(detail).slice(0, 4000),
    ]);
  } catch (e) {
    console.error("[audit] failed", e);
  }
}
