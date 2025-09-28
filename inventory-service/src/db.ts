import { Pool } from "pg";

const pool = new Pool({
  user: "user",
  host: "postgres_db",
  database: "inventory_db",
  password: "password",
  port: 5432,
});

export default {
  query: (text: string, params: any[]) => {
    console.log("Executing query:", text, "with params:", params);
    return pool.query(text, params);
  },
};
