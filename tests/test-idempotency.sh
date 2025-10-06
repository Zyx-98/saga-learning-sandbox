#!/bin/bash

echo "🧪 Testing Message Idempotency"
echo "=============================="

# Function to check database for duplicates
check_duplicates() {
  echo ""
  echo "📊 Checking database for duplicate processing..."
  docker exec postgres_db psql -U user -d orders_db -c "
    SELECT order_id, COUNT(*) as process_count
    FROM processed_messages
    GROUP BY order_id
    HAVING COUNT(*) > 1;
  "
  
  echo ""
  echo "📊 Total processed messages:"
  docker exec postgres_db psql -U user -d orders_db -c "
    SELECT COUNT(*) as total_messages, 
           COUNT(DISTINCT order_id) as unique_orders
    FROM processed_messages;
  "
}

# Function to simulate duplicate message
simulate_duplicate() {
  local order_id=$1
  echo ""
  echo "🔄 Simulating duplicate message for order: $order_id"
  echo "   (Sending same order event to Kafka multiple times)"
  
  # Send the same message 3 times rapidly
  for i in {1..3}; do
    docker exec kafka-1 kafka-console-producer \
      --bootstrap-server localhost:9092 \
      --topic orders \
      --property "parse.key=true" \
      --property "key.separator=:" << EOF
${order_id}:{"orderId":"${order_id}","customerId":"cust_duplicate_test","items":[{"productId":"prod_1","quantity":1}],"totalAmount":100}
EOF
    echo "   Attempt $i sent"
    sleep 0.5
  done
}

# Function to check inventory deduction
check_inventory() {
  local product_id=$1
  echo ""
  echo "📦 Checking inventory for product: $product_id"
  docker exec postgres_db psql -U user -d orders_db -c "
    SELECT id, quantity 
    FROM products 
    WHERE id = '$product_id';
  "
}

echo ""
echo "=== PHASE 1: Setup - Check Initial State ==="
echo ""

# Check initial product quantity
echo "📦 Initial product inventory:"
check_inventory "prod_1"

echo ""
echo "=== PHASE 2: Normal Order Processing ==="
echo ""

# Send normal order
echo "📤 Sending normal order..."
NORMAL_ORDER=$(curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_normal_idem",
    "productId": "prod_1",
    "quantity": 1,
    "amount": 100
  }')

NORMAL_ORDER_ID=$(echo $NORMAL_ORDER | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
echo "✅ Order created: $NORMAL_ORDER_ID"
sleep 5

check_duplicates
check_inventory "prod_1"

echo ""
echo "=== PHASE 3: Duplicate Message Test ==="
echo ""

# Create an order for duplicate testing
echo "📤 Creating order for duplicate test..."
DUP_ORDER=$(curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_duplicate_test",
    "productId": "prod_1",
    "quantity": 2,
    "amount": 200
  }')

DUP_ORDER_ID=$(echo $DUP_ORDER | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
echo "✅ Order created: $DUP_ORDER_ID"
echo "   Waiting for payment processing..."
sleep 5

# Now simulate duplicate PaymentSucceeded events
echo ""
echo "🔄 Simulating duplicate PaymentSucceeded events..."
for i in {1..5}; do
  docker exec kafka-1 kafka-console-producer \
    --bootstrap-server localhost:9092 \
    --topic payments \
    --property "parse.key=true" \
    --property "key.separator=:" \
    --property "parse.headers=true" \
    --property "headers.delimiter=|" << EOF
${DUP_ORDER_ID}|correlationId:order-${DUP_ORDER_ID}|event-type:PaymentSucceeded:{"orderId":"${DUP_ORDER_ID}","paymentId":"payment-duplicate-test-${i}"}
EOF
  echo "   Duplicate attempt $i sent"
  sleep 1
done

echo ""
echo "⏳ Waiting for processing (15s)..."
sleep 15

echo ""
echo "📊 Results after duplicate message test:"
check_duplicates
check_inventory "prod_1"

echo ""
echo "🔍 Checking processed_messages table for duplicates:"
docker exec postgres_db psql -U user -d orders_db -c "
  SELECT message_id, order_id, event_type, processed_at
  FROM processed_messages
  WHERE order_id = '$DUP_ORDER_ID'
  ORDER BY processed_at;
"

echo ""
echo "=== PHASE 4: Consumer Restart Test (Reprocessing Prevention) ==="
echo ""

echo "📤 Creating order for restart test..."
RESTART_ORDER=$(curl -s -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_restart_test",
    "productId": "prod_1",
    "quantity": 1,
    "amount": 150
  }')

RESTART_ORDER_ID=$(echo $RESTART_ORDER | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
echo "✅ Order created: $RESTART_ORDER_ID"
sleep 3

echo ""
echo "🔄 Restarting inventory-service (simulating crash/rebalance)..."
docker restart inventory-service
echo "   Waiting for service to restart (10s)..."
sleep 10

echo "   Service should not reprocess the message"
sleep 5

check_duplicates
check_inventory "prod_1"

echo ""
echo "=== PHASE 5: High Concurrency Test ==="
echo ""

echo "📤 Sending 20 concurrent orders to test race conditions..."
INITIAL_QTY=$(docker exec postgres_db psql -U user -d orders_db -t -c "SELECT quantity FROM products WHERE id = 'prod_1';" | xargs)
echo "   Initial quantity: $INITIAL_QTY"

for i in {1..20}; do
  curl -s -X POST http://localhost:3000/orders \
    -H "Content-Type: application/json" \
    -d "{
      \"customerId\": \"cust_concurrent_$i\",
      \"productId\": \"prod_1\",
      \"quantity\": 1,
      \"amount\": 100
    }" > /dev/null &
done

echo "   Waiting for all orders to process..."
wait
sleep 10

FINAL_QTY=$(docker exec postgres_db psql -U user -d orders_db -t -c "SELECT quantity FROM products WHERE id = 'prod_1';" | xargs)
echo "   Final quantity: $FINAL_QTY"
echo "   Expected decrease: 20"
echo "   Actual decrease: $((INITIAL_QTY - FINAL_QTY))"

if [ $((INITIAL_QTY - FINAL_QTY)) -eq 20 ]; then
  echo "   ✅ No race conditions detected!"
else
  echo "   ⚠️ Possible race condition or other issue"
fi

check_duplicates

echo ""
echo "========================================="
echo "VERIFICATION CHECKLIST:"
echo "========================================="
echo ""
echo "Expected Results:"
echo "   1. No duplicate order_id in processed_messages table"
echo "   2. Each message_id appears exactly once"
echo "   3. Inventory decreased by exact number of orders processed"
echo "   4. After consumer restart, no reprocessing occurred"
echo "   5. High concurrency test shows correct inventory deduction"
echo ""
echo "Check inventory-service logs:"
echo "   docker logs inventory-service --tail 100 | grep -E 'Duplicate|Idempotency'"
echo ""
echo "Check processed_messages table:"
echo "   docker exec postgres_db psql -U user -d orders_db -c 'SELECT * FROM processed_messages ORDER BY processed_at DESC LIMIT 20;'"
echo ""
echo "Check for any constraint violations:"
echo "   docker logs inventory-service 2>&1 | grep -i 'duplicate key'"
echo ""
echo "View metrics in logs:"
echo "   docker logs inventory-service 2>&1 | grep 'Idempotency Metrics'"