#!/bin/bash

echo "Testing Consumer Rebalancing Scenarios"
echo "=========================================="

# Function to count rebalances in logs
count_rebalances() {
  local service=$1
  local count=$(docker logs $service 2>&1 | grep -c "Consumer group rebalancing started")
  echo "$count"
}

# Function to send test order
send_order() {
  local customer_id=$1
  curl -s -X POST http://localhost:3000/orders \
    -H "Content-Type: application/json" \
    -d "{
      \"customerId\": \"$customer_id\",
      \"productId\": \"prod_1\",
      \"quantity\": 1,
      \"amount\": 100
    }" | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4
}

echo ""
echo "=== PHASE 1: Baseline (Single Consumer) ==="
echo ""
INITIAL_REBALANCES=$(count_rebalances "inventory-service")
echo "Initial rebalance count: $INITIAL_REBALANCES"

echo "Sending test orders..."
for i in {1..5}; do
  ORDER_ID=$(send_order "cust_baseline_$i")
  echo "  Order $i created: $ORDER_ID"
  sleep 1
done

sleep 5
NEW_REBALANCES=$(count_rebalances "inventory-service")
echo "Rebalances after normal processing: $NEW_REBALANCES"
echo "   Change: $((NEW_REBALANCES - INITIAL_REBALANCES))"

echo ""
echo "=== PHASE 2: Consumer Restart (Graceful Shutdown) ==="
echo ""
echo "Gracefully restarting inventory-service..."
docker restart inventory-service
sleep 10

echo "Sending orders after restart..."
for i in {1..3}; do
  ORDER_ID=$(send_order "cust_restart_$i")
  echo "  Order $i created: $ORDER_ID"
  sleep 1
done

sleep 5
AFTER_RESTART=$(count_rebalances "inventory-service")
echo "Rebalances after restart: $AFTER_RESTART"
echo "   Expected: 1-2 rebalances (rejoin group)"

echo ""
echo "=== PHASE 3: Slow Processing Test (Session Timeout Risk) ==="
echo ""
echo "Sending order that causes 35s processing delay..."
echo "   (Testing if heartbeats prevent session timeout)"

ORDER_ID=$(send_order "cust_slow_rebalance_test")
echo "  Slow order created: $ORDER_ID"

echo "   Monitoring for 40 seconds..."
BEFORE_SLOW=$(count_rebalances "inventory-service")

for i in {1..8}; do
  sleep 5
  echo "   ... ${i}x5s elapsed"
  # Check if consumer is still connected
  docker logs inventory-service --tail 5 2>&1 | grep -q "Heartbeat sent" && echo "     Heartbeat detected"
done

AFTER_SLOW=$(count_rebalances "inventory-service")
echo ""
echo "📊 Rebalances during slow processing: $((AFTER_SLOW - BEFORE_SLOW))"
if [ $((AFTER_SLOW - BEFORE_SLOW)) -eq 0 ]; then
  echo "   No rebalance occurred! Heartbeats working correctly."
else
  echo "   Rebalance occurred - session timeout might be too short"
fi

echo ""
echo "=== PHASE 4: Multiple Consumer Instances (Scale Out) ==="
echo ""
echo "Starting second inventory-service instance..."

# Start a second instance
docker run -d \
  --name inventory-service-2 \
  --network app-network \
  -v $(pwd)/inventory-service:/app \
  -e NODE_ENV=development \
  inventory-service:latest \
  > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "Second instance started"
  sleep 15
  
  echo "Checking rebalances on both instances:"
  INSTANCE1_REBALANCES=$(count_rebalances "inventory-service")
  INSTANCE2_REBALANCES=$(count_rebalances "inventory-service-2")
  
  echo "   Instance 1 rebalances: $INSTANCE1_REBALANCES"
  echo "   Instance 2 rebalances: $INSTANCE2_REBALANCES"
  
  echo ""
  echo "Sending orders to test load distribution..."
  for i in {1..10}; do
    send_order "cust_multi_instance_$i" > /dev/null
    echo -n "."
  done
  echo ""
  
  sleep 10
  
  echo "Checking which instance processed messages:"
  docker logs inventory-service --tail 20 2>&1 | grep "Published InventoryReservedEvent" | wc -l | xargs echo "   Instance 1 processed:"
  docker logs inventory-service-2 --tail 20 2>&1 | grep "Published InventoryReservedEvent" | wc -l | xargs echo "   Instance 2 processed:"
  
  echo ""
  echo "Stopping second instance..."
  docker stop inventory-service-2
  docker rm inventory-service-2
  sleep 10
  
  FINAL_REBALANCES=$(count_rebalances "inventory-service")
  echo "Rebalances after scale down: $FINAL_REBALANCES"
else
  echo "Failed to start second instance"
fi

echo ""
echo "=== PHASE 5: Frequent Restarts (Rebalancing Storm) ==="
echo ""
echo "Simulating rebalancing storm (5 rapid restarts)..."
STORM_START=$(count_rebalances "inventory-service")

for i in {1..5}; do
  echo "   Restart $i/5..."
  docker restart inventory-service > /dev/null 2>&1
  sleep 5
done

sleep 10
STORM_END=$(count_rebalances "inventory-service")
STORM_REBALANCES=$((STORM_END - STORM_START))

echo "Rebalances during storm: $STORM_REBALANCES"
echo "   Expected: ~5 (one per restart)"
if [ $STORM_REBALANCES -gt 10 ]; then
  echo "   Excessive rebalancing detected!"
else
  echo "   Rebalancing within acceptable range"
fi

echo ""
echo "========================================="
echo "FINAL RESULTS:"
echo "