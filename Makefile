# Start Docker Compose (Kafka, DB, etc.)
docker-up:
	docker compose up -d

# Create Kafka topics (assumes you have a script in the root directory)
create-kafka-topics:
	bash ./create-kafka-topics.sh

# Install dependencies for all services
install:
	npm install --prefix order-service
	npm install --prefix payment-service
	npm install --prefix inventory-service

# Run Order Service
order:
	npm run dev --prefix order-service

# Run Payment Service
payment:
	npm run dev --prefix payment-service

# Run Inventory Service
inventory:
	npm run dev --prefix inventory-service

# Run all services (in background)
run-all:
	$(MAKE) order &
	$(MAKE) payment &
	$(MAKE) inventory &

# Full setup: Docker, Kafka topics, install, run services
up:
	$(MAKE) docker-up
	$(MAKE) create-kafka-topics
	$(MAKE) install
	$(MAKE) run-all

.PHONY: docker-up create-kafka-topics install order payment inventory run-all up