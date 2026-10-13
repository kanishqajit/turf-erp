import initSql from 'sql.js/dist/sql-asm.js';

const SQL=await initSql();
// Synchronous statement interface used by the existing domain layer. Durable
// state remains in PostgreSQL; this engine accepts in-memory workspaces only.
export class DatabaseSync {
  constructor(filename){
    if(filename!==':memory:')throw new Error('Portable SQLite only supports in-memory workspaces.');
    this.database=new SQL.Database();
  }
  exec(sql){this.database.exec(sql);}
  prepare(sql){
    const database=this.database;
    function rows(args,first){
      const statement=database.prepare(sql);
      try{
        statement.bind(args);
        const result=[];
        while(statement.step()){
          const row=statement.getAsObject();
          if(first)return row;
          result.push(row);
        }
        return first?undefined:result;
      }finally{statement.free();}
    }
    return {
      get:(...args)=>rows(args,true),
      all:(...args)=>rows(args,false),
      run:(...args)=>{
        const statement=database.prepare(sql);
        try{statement.bind(args);while(statement.step()){};}
        finally{statement.free();}
        return {changes:database.getRowsModified()};
      },
    };
  }
  close(){this.database.close();}
}
