/**
 * 第三方库类型声明
 *
 * 为没有自带 TypeScript 类型的依赖库提供类型定义：
 * - sql.js: 基于 WebAssembly 的 SQLite 实现（用于纯 JS 环境操作 SQLite）
 * - adm-zip: ZIP 压缩/解压库（用于数据导入导出功能）
 */

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
