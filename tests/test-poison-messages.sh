#!/bin/bash

echo "Testing Poison Messages & Retry Logic"
echo "=========================================="

# Test 1: Valid message (should succeed)
echo "Test 1: Sending valid order"
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_normal",
    "productId": "prod_1",
    "quantity": 1,
    "amount": 100
  }'
echo ""
echo "Valid order sent"
sleep 2

# Test 2: Missing required fields (immediate DLQ)
echo ""
echo "📍 Test 2: Sending order with missing fields (should go to DLQ immediately)"
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_poison_missing_fields",
    "productId": "prod_1",
    "quantity": 1,
    "amount": 100
  }'
echo ""
echo "Check payment-service logs for validation failure"
echo "   Expected: Message sent to orders.dlq without retries"
sleep 2

# Test 3: Invalid data type (immediate DLQ)
echo ""
echo "Test 3: Sending order with invalid data type"
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_poison_invalid_type",
    "productId": "prod_1",
    "quantity": 1,
    "amount": 100
  }'
echo ""
echo "Check payment-service logs for validation failure"
sleep 2

# Test 4: Transient error (should retry and succeed)
echo ""
echo "Test 4: Sending order that causes transient error (should retry)"
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_transient_error",
    "productId": "prod_1",
    "quantity": 1,
    "amount": 100
  }'
echo ""
echo "Check payment-service logs for retry attempts"
echo "   Expected: 2 failures, then success on 3rd attempt"
sleep 5

# Test 5: Malformed JSON error
echo ""
echo "Test 5: Sending order with JSON parse simulation"
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_poison_json_error",
    "productId": "prod_1",
    "quantity": 1,
    "amount": 100
  }'
echo ""
echo "Check payment-service logs for JSON parse error"
sleep 2

echo ""
echo "Verification Steps:"
echo "======================================"
echo "1. Check payment-service logs:"
echo "   docker logs payment_service --tail 50"
echo ""
echo "2. Check DLQ topics for poison messages:"
echo "   docker exec -it kafka-1 kafka-console-consumer \\"
echo "     --bootstrap-server localhost:9092 \\"
echo "     --topic orders.dlq \\"
echo "     --from-beginning"
echo ""
echo "3. Check AKHQ UI at http://localhost:8080"
echo "   Navigate to Topics > orders.dlq to see poison messages"
echo ""
echo "4. Expected Results:"
echo "   - Test 1:  Processes successfully"
echo "   - Test 2: ️ Goes to DLQ (validation error - no retries)"
echo "   - Test 3: ️ Goes to DLQ (validation error - no retries)"
echo "   - Test 4:  Retries 2 times, then succeeds"
echo "   - Test 5:  ️Goes to DLQ (parse error - no retries)"