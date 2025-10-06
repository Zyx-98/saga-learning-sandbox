import { Pool } from "pg";

const pool = new Pool({
  user: "user",
  host: "postgres_db",
  database: "orders_db",
  password: "password",
  port: 5432,
});

export default {
  query: (text: string, params: any[] = []) => pool.query(text, params),
};
