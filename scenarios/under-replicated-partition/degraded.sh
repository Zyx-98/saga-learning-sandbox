curl -X POST http://localhost:3000/orders \
-H "Content-Type: application/json" \
-d '{ "customerId": "cust_degraded", "productId": "product-123", "quantity": 1, "amount": 100 }'