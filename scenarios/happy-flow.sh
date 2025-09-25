#!/bin/bash

curl -X POST http://localhost:3000/orders \
-H "Content-Type: application/json" \
-d '{
  "customerId": "cust_abc",
  "productId": "product-123",
  "quantity": 2,
  "amount": 250.50
}'