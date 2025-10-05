docker cp reassignment.json kafka-1:/tmp/

docker exec -it kafka-1 /bin/bash
kafka-reassign-partitions --bootstrap-server localhost:9092 \
  --reassignment-json-file /tmp/reassignment.json \
  --execute