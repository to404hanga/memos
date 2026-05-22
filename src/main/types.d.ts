declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: any[]): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface Statement {
    bind(params?: any[]): void;
    step(): boolean;
    getAsObject(): any;
    free(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
  export { Database, Statement, SqlJsStatic };
}

declare module 'adm-zip' {
  class AdmZip {
    constructor(fileNameOrRawData?: string | Buffer);
    addFile(entryName: string, content: Buffer, comment?: string, attr?: number): void;
    addLocalFile(localPath: string, zipPath?: string, zipName?: string): void;
    getEntries(): Array<{
      entryName: string;
      isDirectory: boolean;
      getData(): Buffer;
    }>;
    writeZip(targetFileName: string): void;
  }
  export = AdmZip;
}
