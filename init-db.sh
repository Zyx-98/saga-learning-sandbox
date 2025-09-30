#!/bin/bash
set -e

# This script runs once when the PostgreSQL container is first started.
# It creates the necessary databases and tables for the microservices.

# Create additional databases for the payment and inventory services.
# The 'orders_db' is created automatically by the POSTGRES_DB environment variable.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE payments_db;
    CREATE DATABASE inventory_db;
EOSQL

# Connect to the 'orders_db' and create the 'orders' table.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "orders_db" <<-EOSQL
    CREATE TABLE orders (
        id UUID PRIMARY KEY,
        customer_id VARCHAR(255) NOT NULL,
        product_id VARCHAR(255),
        quantity INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) NOT NULL
    );
EOSQL

# Connect to the 'inventory_db', create the 'products' table, and add sample data.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "inventory_db" <<-EOSQL
    CREATE TABLE products (
        id VARCHAR(255) PRIMARY KEY,
        quantity INT NOT NULL
    );

    INSERT INTO products (id, quantity) VALUES ('product-123', 100000);
EOSQL

echo "Databases and tables created successfully."