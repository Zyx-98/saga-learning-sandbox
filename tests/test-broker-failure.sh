#!/bin/bash

echo "Testing Broker Failure & Recovery"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check broker health
check_brokers() {
  echo -e "${YELLOW}📊 Current Broker Status:${NC}"
  docker ps --filter "name=kafka" --format "table {{.Names}}\t{{.Status}}"
  echo ""
}

# Function to send test orders
send_test_orders() {
  local count=$1
  local label=$2
  echo -e "${GREEN}📤 Sending $count test orders ($label)${NC}"
  for i in $(seq 1 $count); do
    curl -s -X POST http://localhost:3000/orders \
      -H "Content-Type: application/json" \
      -d "{
        \"customerId\": \"cust_failover_test_$i\",
        \"productId\": \"prod_1\",
        \"quantity\": 1,
        \"amount\": 100
      }" > /dev/null
    
    if [ $? -eq 0 ]; then
      echo -n "."
    else
      echo -n "✗"
    fi
  done
  echo ""
  echo -e "${GREEN}✅ Sent $count orders${NC}"
}

# Function to check Kafka metrics
check_metrics() {
  echo -e "${YELLOW}📊 Checking Kafka Cluster Metrics:${NC}"
  
  # Check under-replicated partitions
  docker exec kafka-1 kafka-topics --bootstrap-server localhost:9092 --describe --under-replicated-partitions 2>/dev/null | head -10
  
  echo ""
  echo -e "${YELLOW}🔍 Consumer Group Status:${NC}"
  docker exec kafka-1 kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group inventory-service-group 2>/dev/null | head -10
}

echo ""
echo "=== PHASE 1: Baseline (All Brokers Healthy) ==="
echo ""
check_brokers
send_test_orders 5 "baseline"
sleep 3
check_metrics

echo ""
echo "=== PHASE 2: Simulate Broker Failure ==="
echo ""
echo -e "${RED}Stopping kafka-2 (simulating broker failure)${NC}"
docker stop kafka-2
sleep 5

check_brokers
echo ""
echo -e "${YELLOW}️ Checking for under-replicated partitions (this is expected)${NC}"
check_metrics

echo ""
echo -e "${YELLOW} Testing message production during broker failure${NC}"
send_test_orders 10 "during failure"
sleep 3

echo ""
echo "=== PHASE 3: Broker Recovery ==="
echo ""
echo -e "${GREEN}🔄 Restarting kafka-2${NC}"
docker start kafka-2
echo "Waiting for broker to rejoin cluster (30s)..."
sleep 30

check_brokers
echo ""
echo -e "${GREEN} Checking if under-replicated partitions recovered${NC}"
check_metrics

echo ""
echo -e "${GREEN} Testing message production after recovery${NC}"
send_test_orders 5 "after recovery"
sleep 3

echo ""
echo "=== PHASE 4: Two Broker Failure (Quorum Loss) ==="
echo ""
echo -e "${RED} Stopping kafka-2 AND kafka-3 (simulating major failure)${NC}"
docker stop kafka-2 kafka-3
sleep 5

check_brokers
echo ""
echo -e "${RED}️ CRITICAL: Only 1 broker remaining (below min.insync.replicas)${NC}"
echo -e "${YELLOW}📤 Attempting to send orders (should fail with NOT_ENOUGH_REPLICAS)${NC}"

# These should fail or timeout
for i in {1..3}; do
  echo "Attempt $i:"
  curl -X POST http://localhost:3000/orders \
    -H "Content-Type: application/json" \
    -d "{
      \"customerId\": \"cust_quorum_loss_$i\",
      \"productId\": \"prod_1\",
      \"quantity\": 1,
      \"amount\": 100
    }" \
    --max-time 5 || echo -e "${RED}✗ Failed (expected)${NC}"
  echo ""
done

echo ""
echo "=== PHASE 5: Full Recovery ==="
echo ""
echo -e "${GREEN}🔄 Restarting all brokers${NC}"
docker start kafka-2 kafka-3
echo "Waiting for cluster to stabilize (40s)..."
sleep 40

check_brokers
check_metrics

echo ""
echo -e "${GREEN} Testing message production after full recovery${NC}"
send_test_orders 5 "full recovery"

echo ""
echo "========================================="
echo " GRAFANA DASHBOARDS TO MONITOR:"
echo "========================================="
echo "1. Navigate to: http://localhost:3001"
echo "   Login: admin/admin"
echo ""
echo "2. Check these panels during the test:"
echo "   Under Replicated Partitions - Should spike when brokers stop"
echo "   Brokers Online - Should drop from 3 → 2 → 1 → 3"
echo "   Bytes In/Out Per Broker - Should show redistribution"
echo "   ISR expands by instance - Shows partition reassignment"
echo ""
echo "3. Expected Behavior:"
echo "   Phase 1: All metrics normal"
echo "   Phase 2: Under-replicated partitions increase, messages still process"
echo "   Phase 3: Partitions re-replicate, metrics normalize"
echo "   Phase 4: NOT_ENOUGH_REPLICAS errors, producer blocks/fails"
echo "   Phase 5: Full recovery, all metrics back to normal"
echo ""
echo "4. Check order-service logs for producer errors:"
echo "   docker logs order_service --tail 50"