curl -X POST http://localhost:3000/orders \
-H "Content-Type: application/json" \
-d '{
  "customerId": "cust_large_quantity",
  "productId": "prod_123",
  "quantity": 10,
  "amount": 250.00
}'