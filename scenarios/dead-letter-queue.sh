curl -X POST http://localhost:3000/orders \
-H "Content-Type: application/json" \
-d '{
  "customerId": "cust_dlq_test",
  "productId": "prod_ignore",
  "quantity": 1,
  "amount": 99.00
}'