curl -X POST http://localhost:3000/orders \
-H "Content-Type: application/json" \
-d '{
  "customerId": "cust_high_value",
  "productId": "prod_123",
  "quantity": 1,
  "amount": 1500.00
}'