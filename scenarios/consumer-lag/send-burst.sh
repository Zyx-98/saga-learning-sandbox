#!/bin/bash
for i in {1..20}
do
   echo "Sending order $i"
   curl -X POST http://localhost:3000/orders \
   -H "Content-Type: application/json" \
   -d '{
     "customerId": "cust_burst_test",
     "productId": "product-123",
     "quantity": 1,
     "amount": 100.00
   }' &
done