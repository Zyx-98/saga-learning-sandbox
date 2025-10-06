#!/bin/bash

echo "Testing Consumer Lag Issue"
echo "=============================="

# Test 1: Normal processing
echo "Test 1: Sending normal orders (should process quickly)"
for i in {1..10}; do
  curl -X POST http://localhost:3000/orders \
    -H "Content-Type: application/json" \
    -d "{
      \"customerId\": \"cust_normal\",
      \"productId\": \"prod_1\",
      \"quantity\": 1,
      \"amount\": 100
    }" &
done
wait
echo "Normal orders sent"
sleep 2

# Test 2: Slow consumer causing lag
echo ""
echo "Test 2: Sending orders that cause slow processing (watch lag increase)"
for i in {1..20}; do
  curl -X POST http://localhost:3000/orders \
    -H "Content-Type: application/json" \
    -d "{
      \"customerId\": \"cust_slow_consumer\",
      \"productId\": \"prod_1\",
      \"quantity\": 1,
      \"amount\": 100
    }" &
done
wait
echo "⚠️ Slow orders sent - Check Grafana 'Consumer lag by group' dashboard"
echo "   Expected: Lag will increase significantly"

# Test 3: Burst traffic
echo ""
echo "📍 Test 3: Simulating burst traffic (100 requests)"
for i in {1..100}; do
  curl -X POST http://localhost:3000/orders \
    -H "Content-Type: application/json" \
    -d "{
      \"customerId\": \"cust_burst_test\",
      \"productId\": \"prod_1\",
      \"quantity\": 1,
      \"amount\": 100
    }" &
  
  if [ $((i % 20)) -eq 0 ]; then
    wait
  fi
done
wait
echo "⚠️ Burst traffic sent - Consumer will struggle to keep up"

echo ""
echo "Monitor the following in Grafana:"
echo "   1. Consumer lag by group - Should show increasing lag"
echo "   2. Messages In Per Topic - Should show spike"
echo "   3. Check inventory-service logs for slow processing warnings"
echo ""
echo "To check current lag, run:"
echo "   docker exec -it kafka-1 kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group inventory-service-group"