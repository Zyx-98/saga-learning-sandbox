#!/bin/bash

echo "Testing Message Ordering"
echo "==========================="

# Function to send message directly to Kafka (bypassing order-service)
send_kafka_message() {
  local topic=$1
  local key=$2
  local value=$3
  local headers=$4
  
  docker exec kafka-1 kafka-console-producer \
    --bootstrap-server localhost:9092 \
    --topic "$topic" \
    --property "parse.key=true" \
    --property "key.separator=:" \
    --property "parse.headers=true" \
    --property "headers.delimiter=|" << EOF
${key}|${headers}:${value}
EOF
}

echo ""
echo "=== PHASE 1: In-Order Processing (Baseline) ==="
echo ""
echo "Sending order through normal flow..."
NORMAL_ORDER=$(curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_ordered",
    "productId": "prod_1",
    "quantity": 1,
    "amount": 100
  }')

ORDER_ID=$(echo $NORMAL_ORDER | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
echo "Order created: $ORDER_ID"
sleep 5

echo "Checking payment-service logs for sequence:"
docker logs payment_service --tail 20 2>&1 | grep -E "$ORDER_ID|sequence" | head -10

echo ""
echo "=== PHASE 2: Out-of-Order Message Injection ==="
echo ""
echo "Simulating out-of-order messages by sending PaymentSucceeded BEFORE OrderCreated"

# Generate a unique order ID
OOO_ORDER_ID=$(uuidgen)
echo "Test Order ID: $OOO_ORDER_ID"

echo ""
echo "Step 1: Sending PaymentSucceeded (sequence 2) - should be buffered"
send_kafka_message "payments" "$OOO_ORDER_ID" \
  "{\"orderId\":\"${OOO_ORDER_ID}\",\"paymentId\":\"payment-ooo-test\",\"sequenceNumber\":2,\"timestamp\":$(date +%s)000}" \
  "correlationId:payment-${OOO_ORDER_ID}|event-type:PaymentSucceeded"

sleep 2

echo ""
echo "Step 2: Sending OrderCreated (sequence 1) - should trigger buffer processing"
send_kafka_message "orders" "$OOO_ORDER_ID" \
  "{\"orderId\":\"${OOO_ORDER_ID}\",\"customerId\":\"cust_ooo_test\",\"items\":[{\"productId\":\"prod_1\",\"quantity\":1}],\"totalAmount\":100,\"sequenceNumber\":1,\"timestamp\":$(date +%s)000}" \
  "correlationId:order-${OOO_ORDER_ID}"

sleep 3

echo ""
echo "Checking if messages were reordered correctly:"
docker logs payment_service --tail 30 2>&1 | grep -A 5 "$OOO_ORDER_ID"

echo ""
echo "=== PHASE 3: Multiple Messages Out of Order ==="
echo ""
MULTI_ORDER_ID=$(uuidgen)
echo "Test Order ID: $MULTI_ORDER_ID"

echo "Sending 5 messages in reverse order (5, 4, 3, 2, 1)..."

# Send sequence 5
echo "  Sending sequence 5..."
send_kafka_message "orders" "$MULTI_ORDER_ID" \
  "{\"orderId\":\"${MULTI_ORDER_ID}\",\"customerId\":\"cust_multi\",\"items\":[{\"productId\":\"prod_1\",\"quantity\":1}],\"totalAmount\":100,\"sequenceNumber\":5,\"timestamp\":$(date +%s)000}" \
  "correlationId:order-${MULTI_ORDER_ID}"
sleep 1

# Send sequence 4
echo "  Sending sequence 4..."
send_kafka_message "orders" "$MULTI_ORDER_ID" \
  "{\"orderId\":\"${MULTI_ORDER_ID}\",\"customerId\":\"cust_multi\",\"items\":[{\"productId\":\"prod_1\",\"quantity\":1}],\"totalAmount\":100,\"sequenceNumber\":4,\"timestamp\":$(date +%s)000}" \
  "correlationId:order-${MULTI_ORDER_ID}"
sleep 1

# Send sequence 3
echo "  Sending sequence 3..."
send_kafka_message "orders" "$MULTI_ORDER_ID" \
  "{\"orderId\":\"${MULTI_ORDER_ID}\",\"customerId\":\"cust_multi\",\"items\":[{\"productId\":\"prod_1\",\"quantity\":1}],\"totalAmount\":100,\"sequenceNumber\":3,\"timestamp\":$(date +%s)000}" \
  "correlationId:order-${MULTI_ORDER_ID}"
sleep 1

# Send sequence 2
echo "  Sending sequence 2..."
send_kafka_message "orders" "$MULTI_ORDER_ID" \
  "{\"orderId\":\"${MULTI_ORDER_ID}\",\"customerId\":\"cust_multi\",\"items\":[{\"productId\":\"prod_1\",\"quantity\":1}],\"totalAmount\":100,\"sequenceNumber\":2,\"timestamp\":$(date +%s)000}" \
  "correlationId:order-${MULTI_ORDER_ID}"
sleep 1

# Send sequence 1 - this should trigger processing of all buffered messages
echo "  Sending sequence 1 (should unlock buffer)..."
send_kafka_message "orders" "$MULTI_ORDER_ID" \
  "{\"orderId\":\"${MULTI_ORDER_ID}\",\"customerId\":\"cust_multi\",\"items\":[{\"productId\":\"prod_1\",\"quantity\":1}],\"totalAmount\":100,\"sequenceNumber\":1,\"timestamp\":$(date +%s)000}" \
  "correlationId:order-${MULTI_ORDER_ID}"

echo ""
echo "⏳ Waiting for buffer to process (10s)..."
sleep 10

echo ""
echo "Checking processing order:"
docker logs payment_service --tail 50 2>&1 | grep -E "${MULTI_ORDER_ID}|Buffered|Processing buffered"

echo ""
echo "=== PHASE 4: Same Key Ensures Partition Ordering ==="
echo ""
echo "Sending 10 events with same key to verify partition assignment..."

PARTITION_TEST_ID=$(uuidgen)
echo "Test Order ID: $PARTITION_TEST_ID"

for i in {1..10}; do
  curl -s -X POST http://localhost:3000/orders \
    -H "Content-Type: application/json" \
    -d "{
      \"customerId\": \"cust_partition_${i}\",
      \"productId\": \"prod_1\",
      \"quantity\": 1,
      \"amount\": 50
    }" > /dev/null &
  
  if [ $((i % 2)) -eq 0 ]; then
    echo -n "."
  fi
done
wait
echo ""

sleep 5

echo ""
echo "Checking partition distribution:"
docker exec kafka-1 kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic orders \
  --from-beginning \
  --max-messages 10 \
  --property print.partition=true \
  --timeout-ms 5000 2>/dev/null | tail -10

echo ""
echo "=== PHASE 5: Wrong Partition Assignment (No Key) ==="
echo ""
echo "⚠️ Sending messages without key (random partition assignment)..."

NO_KEY_ORDER_ID=$(uuidgen)
echo "Test Order ID: $NO_KEY_ORDER_ID"

# Send without key - will go to random partition
docker exec kafka-1 kafka-console-producer \
  --bootstrap-server localhost:9092 \
  --topic orders << EOF
{"orderId":"${NO_KEY_ORDER_ID}","customerId":"cust_no_key","items":[{"productId":"prod_1","quantity":1}],"totalAmount":100,"sequenceNumber":1}
{"orderId":"${NO_KEY_ORDER_ID}","customerId":"cust_no_key","items":[{"productId":"prod_1","quantity":1}],"totalAmount":100,"sequenceNumber":2}
EOF

sleep 3

echo ""
echo "Messages without keys may arrive out of order on different partitions"
echo "   Check logs for potential out-of-order warnings"

echo ""
echo "========================================="
echo "FINAL METRICS:"
echo "========================================="
docker logs payment_service --tail 5 2>&1 | grep "Message Ordering Metrics" -A 6

echo ""
echo "Expected Results:"
echo "   1. Phase 1: Normal in-order processing"
echo "   2. Phase 2: PaymentSucceeded buffered, processed after OrderCreated"
echo "   3. Phase 3: All 5 messages buffered and processed in correct order"
echo "   4. Phase 4: Messages with same key go to same partition"
echo "   5. Phase 5: Messages without key may be out of order"
echo ""

echo "Detailed Analysis Commands:"
echo "================================"
echo ""
echo "1. Check buffering behavior:"
echo "   docker logs payment_service 2>&1 | grep -E 'Buffered|Processing buffered'"
echo ""
echo "2. Check sequence numbers:"
echo "   docker logs payment_service 2>&1 | grep 'sequenceNumber'"
echo ""
echo "3. Check out-of-order detection:"
echo "   docker logs payment_service 2>&1 | grep 'Out-of-order'"
echo ""
echo "4. View partition assignment:"
echo "   docker exec kafka-1 kafka-console-consumer \\"
echo "     --bootstrap-server localhost:9092 \\"
echo "     --topic orders \\"
echo "     --from-beginning \\"
echo "     --property print.key=true \\"
echo "     --property print.partition=true \\"
echo "     --max-messages 20"