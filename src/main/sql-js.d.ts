declare module 'sql.js' {
  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  interface StatementIteratorResult {
    value: Statement;
    done: boolean;
  }

  interface Statement {
    bind(params?: any[] | Record<string, any>): boolean;
    step(): boolean;
    getAsObject(params?: Record<string, any>): Record<string, any>;
    get(params?: any[]): any[];
    free(): boolean;
    reset(): void;
    run(params?: any[] | Record<string, any>): void;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: any[] | Record<string, any>): Database;
    exec(sql: string, params?: any[] | Record<string, any>): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
    handleError(returnCode: number): void;
    db: any;
  }

  interface SqlJsStatic {
    Database: typeof Database;
  }

  export type SqlJsStatic = SqlJsStatic;

  function initSqlJs(config?: any): Promise<SqlJsStatic>;
  export default initSqlJs;
}
