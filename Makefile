.PHONY: help setup test-all test-lag test-poison test-broker test-idempotency test-rebalance test-ordering
.PHONY: switch-lag switch-poison switch-broker switch-idempotent switch-rebalance switch-ordered
.PHONY: restore-all restore-inventory restore-order restore-payment
.PHONY: clean logs status dashboard

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
MAGENTA := \033[0;35m
CYAN := \033[0;36m
NC := \033[0m # No Color

# Service directories
INVENTORY_DIR := inventory-service
ORDER_DIR := order-service
PAYMENT_DIR := payment-service

# Implementation files
INVENTORY_LAG := $(INVENTORY_DIR)/src/inventory-service-with-lag-demo.ts
INVENTORY_IDEMPOTENT := $(INVENTORY_DIR)/src/inventory-service-idempotent.ts
INVENTORY_REBALANCE := $(INVENTORY_DIR)/src/consumer-rebalance-resilient.ts
ORDER_RESILIENT := $(ORDER_DIR)/src/order-service-resilient-producer.ts
PAYMENT_POISON := $(PAYMENT_DIR)/src/payment-service-with-poison-handling.ts
PAYMENT_ORDERED := $(PAYMENT_DIR)/src/payment-service-ordered.ts

# Backup files
INVENTORY_BACKUP := $(INVENTORY_DIR)/src/index.backup.ts
ORDER_BACKUP := $(ORDER_DIR)/src/index.backup.ts
PAYMENT_BACKUP := $(PAYMENT_DIR)/src/index.backup.ts

# Test scripts
TEST_DIR := tests
TEST_LAG := $(TEST_DIR)/test-consumer-lag.sh
TEST_POISON := $(TEST_DIR)/test-poison-messages.sh
TEST_BROKER := $(TEST_DIR)/test-broker-failure.sh
TEST_IDEMPOTENCY := $(TEST_DIR)/test-idempotency.sh
TEST_REBALANCE := $(TEST_DIR)/test-rebalancing.sh
TEST_ORDERING := $(TEST_DIR)/test-message-ordering.sh

##@ Help

help: ## Display this help message
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║        Kafka Troubleshooting Test Suite                     ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make $(CYAN)<target>$(NC)\n\n"} \
		/^[a-zA-Z_-]+:.*?##/ { printf "  $(CYAN)%-25s$(NC) %s\n", $$1, $$2 } \
		/^##@/ { printf "\n$(YELLOW)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Setup & Status

setup: ## Initial setup (create backup files)
	@echo "$(BLUE)📦 Creating backup files...$(NC)"
	@if [ ! -f $(INVENTORY_BACKUP) ]; then \
		cp $(INVENTORY_DIR)/src/index.ts $(INVENTORY_BACKUP); \
		echo "$(GREEN)✓ Created $(INVENTORY_BACKUP)$(NC)"; \
	fi
	@if [ ! -f $(ORDER_BACKUP) ]; then \
		cp $(ORDER_DIR)/src/index.ts $(ORDER_BACKUP); \
		echo "$(GREEN)✓ Created $(ORDER_BACKUP)$(NC)"; \
	fi
	@if [ ! -f $(PAYMENT_BACKUP) ]; then \
		cp $(PAYMENT_DIR)/src/index.ts $(PAYMENT_BACKUP); \
		echo "$(GREEN)✓ Created $(PAYMENT_BACKUP)$(NC)"; \
	fi
	@echo "$(GREEN)✓ Setup complete!$(NC)"

status: ## Show current implementation status
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║              Current Implementation Status                   ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)Inventory Service:$(NC)"
	@if diff -q $(INVENTORY_DIR)/src/index.ts $(INVENTORY_BACKUP) > /dev/null 2>&1; then \
		echo "  $(GREEN)✓ Original (default)$(NC)"; \
	elif [ -f $(INVENTORY_LAG) ] && diff -q $(INVENTORY_DIR)/src/index.ts $(INVENTORY_LAG) > /dev/null 2>&1; then \
		echo "  $(MAGENTA)➜ Consumer Lag Demo$(NC)"; \
	elif [ -f $(INVENTORY_IDEMPOTENT) ] && diff -q $(INVENTORY_DIR)/src/index.ts $(INVENTORY_IDEMPOTENT) > /dev/null 2>&1; then \
		echo "  $(MAGENTA)➜ Idempotency Implementation$(NC)"; \
	elif [ -f $(INVENTORY_REBALANCE) ] && diff -q $(INVENTORY_DIR)/src/index.ts $(INVENTORY_REBALANCE) > /dev/null 2>&1; then \
		echo "  $(MAGENTA)➜ Rebalance Resilient$(NC)"; \
	else \
		echo "  $(YELLOW)⚠ Modified (unknown)$(NC)"; \
	fi
	@echo ""
	@echo "$(YELLOW)Order Service:$(NC)"
	@if diff -q $(ORDER_DIR)/src/index.ts $(ORDER_BACKUP) > /dev/null 2>&1; then \
		echo "  $(GREEN)✓ Original (default)$(NC)"; \
	elif [ -f $(ORDER_RESILIENT) ] && diff -q $(ORDER_DIR)/src/index.ts $(ORDER_RESILIENT) > /dev/null 2>&1; then \
		echo "  $(MAGENTA)➜ Resilient Producer$(NC)"; \
	else \
		echo "  $(YELLOW)⚠ Modified (unknown)$(NC)"; \
	fi
	@echo ""
	@echo "$(YELLOW)Payment Service:$(NC)"
	@if diff -q $(PAYMENT_DIR)/src/index.ts $(PAYMENT_BACKUP) > /dev/null 2>&1; then \
		echo "  $(GREEN)✓ Original (default)$(NC)"; \
	elif [ -f $(PAYMENT_POISON) ] && diff -q $(PAYMENT_DIR)/src/index.ts $(PAYMENT_POISON) > /dev/null 2>&1; then \
		echo "  $(MAGENTA)➜ Poison Message Handling$(NC)"; \
	elif [ -f $(PAYMENT_ORDERED) ] && diff -q $(PAYMENT_DIR)/src/index.ts $(PAYMENT_ORDERED) > /dev/null 2>&1; then \
		echo "  $(MAGENTA)➜ Ordered Messages$(NC)"; \
	else \
		echo "  $(YELLOW)⚠ Modified (unknown)$(NC)"; \
	fi
	@echo ""

dashboard: ## Open monitoring dashboards
	@echo "$(BLUE)🌐 Opening monitoring dashboards...$(NC)"
	@echo "$(CYAN)Grafana:$(NC) http://localhost:3001 (admin/admin)"
	@echo "$(CYAN)AKHQ:$(NC) http://localhost:8080"
	@echo "$(CYAN)Prometheus:$(NC) http://localhost:9090"
	@command -v open >/dev/null 2>&1 && open http://localhost:3001 || \
	command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:3001 || \
	echo "$(YELLOW)Please open http://localhost:3001 manually$(NC)"

##@ Implementation Switching

switch-lag: setup ## Switch to Consumer Lag implementation
	@echo "$(MAGENTA)🔄 Switching to Consumer Lag Demo...$(NC)"
	@cp $(INVENTORY_LAG) $(INVENTORY_DIR)/src/index.ts
	@echo "$(YELLOW)⏳ Restarting inventory-service...$(NC)"
	@docker-compose restart inventory-service
	@echo "$(YELLOW)⏳ Waiting for service to start (10s)...$(NC)"
	@sleep 10
	@echo "$(GREEN)✓ Switched to Consumer Lag implementation$(NC)"
	@echo "$(CYAN)ℹ Run 'make test-lag' to test this issue$(NC)"

switch-poison: setup ## Switch to Poison Message Handling implementation
	@echo "$(MAGENTA)🔄 Switching to Poison Message Handling...$(NC)"
	@cp $(PAYMENT_POISON) $(PAYMENT_DIR)/src/index.ts
	@echo "$(YELLOW)⏳ Restarting payment-service...$(NC)"
	@docker-compose restart payment-service
	@echo "$(YELLOW)⏳ Waiting for service to start (10s)...$(NC)"
	@sleep 10
	@echo "$(GREEN)✓ Switched to Poison Message Handling implementation$(NC)"
	@echo "$(CYAN)ℹ Run 'make test-poison' to test this issue$(NC)"

switch-broker: setup ## Switch to Resilient Producer implementation
	@echo "$(MAGENTA)🔄 Switching to Resilient Producer...$(NC)"
	@cp $(ORDER_RESILIENT) $(ORDER_DIR)/src/index.ts
	@echo "$(YELLOW)⏳ Restarting order-service...$(NC)"
	@docker-compose restart order-service
	@echo "$(YELLOW)⏳ Waiting for service to start (10s)...$(NC)"
	@sleep 10
	@echo "$(GREEN)✓ Switched to Resilient Producer implementation$(NC)"
	@echo "$(CYAN)ℹ Run 'make test-broker' to test this issue$(NC)"

switch-idempotent: setup ## Switch to Idempotency implementation
	@echo "$(MAGENTA)🔄 Switching to Idempotent Consumer...$(NC)"
	@cp $(INVENTORY_IDEMPOTENT) $(INVENTORY_DIR)/src/index.ts
	@echo "$(YELLOW)⏳ Restarting inventory-service...$(NC)"
	@docker-compose restart inventory-service
	@echo "$(YELLOW)⏳ Waiting for service to start (10s)...$(NC)"
	@sleep 10
	@echo "$(GREEN)✓ Switched to Idempotent implementation$(NC)"
	@echo "$(CYAN)ℹ Run 'make test-idempotency' to test this issue$(NC)"

switch-rebalance: setup ## Switch to Rebalance Resilient implementation
	@echo "$(MAGENTA)🔄 Switching to Rebalance Resilient...$(NC)"
	@cp $(INVENTORY_REBALANCE) $(INVENTORY_DIR)/src/index.ts
	@echo "$(YELLOW)⏳ Restarting inventory-service...$(NC)"
	@docker-compose restart inventory-service
	@echo "$(YELLOW)⏳ Waiting for service to start (10s)...$(NC)"
	@sleep 10
	@echo "$(GREEN)✓ Switched to Rebalance Resilient implementation$(NC)"
	@echo "$(CYAN)ℹ Run 'make test-rebalance' to test this issue$(NC)"

switch-ordered: setup ## Switch to Ordered Messages implementation
	@echo "$(MAGENTA)🔄 Switching to Ordered Messages...$(NC)"
	@cp $(PAYMENT_ORDERED) $(PAYMENT_DIR)/src/index.ts
	@echo "$(YELLOW)⏳ Restarting payment-service...$(NC)"
	@docker-compose restart payment-service
	@echo "$(YELLOW)⏳ Waiting for service to start (10s)...$(NC)"
	@sleep 10
	@echo "$(GREEN)✓ Switched to Ordered Messages implementation$(NC)"
	@echo "$(CYAN)ℹ Run 'make test-ordering' to test this issue$(NC)"

##@ Restore Original

restore-inventory: ## Restore inventory-service to original
	@echo "$(BLUE)🔙 Restoring inventory-service to original...$(NC)"
	@if [ -f $(INVENTORY_BACKUP) ]; then \
		cp $(INVENTORY_BACKUP) $(INVENTORY_DIR)/src/index.ts; \
		docker-compose restart inventory-service; \
		echo "$(GREEN)✓ Inventory service restored$(NC)"; \
	else \
		echo "$(RED)✗ Backup file not found. Run 'make setup' first$(NC)"; \
	fi

restore-order: ## Restore order-service to original
	@echo "$(BLUE)🔙 Restoring order-service to original...$(NC)"
	@if [ -f $(ORDER_BACKUP) ]; then \
		cp $(ORDER_BACKUP) $(ORDER_DIR)/src/index.ts; \
		docker-compose restart order-service; \
		echo "$(GREEN)✓ Order service restored$(NC)"; \
	else \
		echo "$(RED)✗ Backup file not found. Run 'make setup' first$(NC)"; \
	fi

restore-payment: ## Restore payment-service to original
	@echo "$(BLUE)🔙 Restoring payment-service to original...$(NC)"
	@if [ -f $(PAYMENT_BACKUP) ]; then \
		cp $(PAYMENT_BACKUP) $(PAYMENT_DIR)/src/index.ts; \
		docker-compose restart payment-service; \
		echo "$(GREEN)✓ Payment service restored$(NC)"; \
	else \
		echo "$(RED)✗ Backup file not found. Run 'make setup' first$(NC)"; \
	fi

restore-all: restore-inventory restore-order restore-payment ## Restore all services to original
	@echo "$(GREEN)✓ All services restored to original state$(NC)"

##@ Testing (Individual)

test-lag: switch-lag ## Test Issue 1: Consumer Lag
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  Issue 1: Consumer Lag & Backpressure                       ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)📊 Open Grafana to monitor:$(NC)"
	@echo "   • Consumer lag by group"
	@echo "   • Messages In Per Topic"
	@echo ""
	@echo "$(YELLOW)Press Enter to start test...$(NC)"
	@read dummy
	@bash $(TEST_LAG)
	@echo ""
	@echo "$(YELLOW)Press Enter to restore original implementation...$(NC)"
	@read dummy
	@$(MAKE) restore-inventory

test-poison: switch-poison ## Test Issue 2: Poison Messages
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  Issue 2: Poison Messages & DLQ                             ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)📊 Monitor:$(NC)"
	@echo "   • Payment service logs: docker logs payment_service -f"
	@echo "   • DLQ topic in AKHQ"
	@echo ""
	@echo "$(YELLOW)Press Enter to start test...$(NC)"
	@read dummy
	@bash $(TEST_POISON)
	@echo ""
	@echo "$(YELLOW)Press Enter to restore original implementation...$(NC)"
	@read dummy
	@$(MAKE) restore-payment

test-broker: switch-broker ## Test Issue 3: Broker Failure
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  Issue 3: Broker Failure & Under-Replicated Partitions      ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)📊 Open Grafana to monitor:$(NC)"
	@echo "   • Brokers Online"
	@echo "   • Under Replicated Partitions"
	@echo "   • ISR expands by instance"
	@echo ""
	@echo "$(RED)⚠️  WARNING: This test will stop/start Kafka brokers$(NC)"
	@echo "$(YELLOW)Press Enter to start test...$(NC)"
	@read dummy
	@bash $(TEST_BROKER)
	@echo ""
	@echo "$(YELLOW)Press Enter to restore original implementation...$(NC)"
	@read dummy
	@$(MAKE) restore-order

test-idempotency: switch-idempotent ## Test Issue 4: Message Duplication
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  Issue 4: Message Duplication & Idempotency                 ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)📊 Monitor:$(NC)"
	@echo "   • Inventory service logs"
	@echo "   • Database: processed_messages table"
	@echo ""
	@echo "$(YELLOW)Press Enter to start test...$(NC)"
	@read dummy
	@bash $(TEST_IDEMPOTENCY)
	@echo ""
	@echo "$(YELLOW)Press Enter to restore original implementation...$(NC)"
	@read dummy
	@$(MAKE) restore-inventory

test-rebalance: switch-rebalance ## Test Issue 5: Rebalancing Storm
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  Issue 5: Consumer Rebalancing Storm                        ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)📊 Open Grafana to monitor:$(NC)"
	@echo "   • Consumer lag (look for sawtooth pattern)"
	@echo ""
	@echo "$(YELLOW)📊 Monitor logs:$(NC)"
	@echo "   docker logs inventory-service -f | grep rebalance"
	@echo ""
	@echo "$(YELLOW)Press Enter to start test...$(NC)"
	@read dummy
	@bash $(TEST_REBALANCE)
	@echo ""
	@echo "$(YELLOW)Press Enter to restore original implementation...$(NC)"
	@read dummy
	@$(MAKE) restore-inventory

test-ordering: switch-ordered ## Test Issue 6: Out of Order Messages
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║  Issue 6: Out of Order Message Processing                   ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)📊 Monitor:$(NC)"
	@echo "   • Payment service logs: docker logs payment_service -f"
	@echo "   • Look for 'Buffered' and 'Processing buffered' messages"
	@echo ""
	@echo "$(YELLOW)Press Enter to start test...$(NC)"
	@read dummy
	@bash $(TEST_ORDERING)
	@echo ""
	@echo "$(YELLOW)Press Enter to restore original implementation...$(NC)"
	@read dummy
	@$(MAKE) restore-payment

##@ Testing (Batch)

test-all: setup ## Run ALL tests sequentially (with prompts)
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║           Running ALL Kafka Troubleshooting Tests           ║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)This will run all 6 tests sequentially.$(NC)"
	@echo "$(YELLOW)Each test will switch implementations and restore after.$(NC)"
	@echo ""
	@echo "$(YELLOW)Total estimated time: ~25 minutes$(NC)"
	@echo ""
	@echo "$(YELLOW)Press Enter to begin, or Ctrl+C to cancel...$(NC)"
	@read dummy
	@$(MAKE) test-lag
	@$(MAKE) test-poison
	@$(MAKE) test-broker
	@$(MAKE) test-idempotency
	@$(MAKE) test-rebalance
	@$(MAKE) test-ordering
	@echo ""
	@echo "$(GREEN)╔══════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(GREEN)║              All Tests Completed Successfully!               ║$(NC)"
	@echo "$(GREEN)╚══════════════════════════════════════════════════════════════╝$(NC)"

test-all-auto: setup ## Run ALL tests automatically (no prompts)
	@echo "$(CYAN)Running all tests automatically...$(NC)"
	@$(MAKE) switch-lag && bash $(TEST_LAG) && $(MAKE) restore-inventory
	@$(MAKE) switch-poison && bash $(TEST_POISON) && $(MAKE) restore-payment
	@$(MAKE) switch-broker && bash $(TEST_BROKER) && $(MAKE) restore-order
	@$(MAKE) switch-idempotent && bash $(TEST_IDEMPOTENCY) && $(MAKE) restore-inventory
	@$(MAKE) switch-rebalance && bash $(TEST_REBALANCE) && $(MAKE) restore-inventory
	@$(MAKE) switch-ordered && bash $(TEST_ORDERING) && $(MAKE) restore-payment
	@echo "$(GREEN)✓ All tests completed$(NC)"

##@ Utilities

logs: ## Show logs for all services
	@echo "$(CYAN)📜 Service Logs:$(NC)"
	@echo ""
	@echo "$(YELLOW)Order Service:$(NC)"
	@docker logs order_service --tail 20
	@echo ""
	@echo "$(YELLOW)Inventory Service:$(NC)"
	@docker logs inventory-service --tail 20
	@echo ""
	@echo "$(YELLOW)Payment Service:$(NC)"
	@docker logs payment_service --tail 20

logs-follow: ## Follow logs for all services (Ctrl+C to stop)
	@echo "$(CYAN)📜 Following logs (Ctrl+C to stop)...$(NC)"
	@docker-compose logs -f order-service inventory-service payment-service

clean: restore-all ## Clean up backup files and restore services
	@echo "$(BLUE)🧹 Cleaning up...$(NC)"
	@rm -f $(INVENTORY_BACKUP) $(ORDER_BACKUP) $(PAYMENT_BACKUP)
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

##@ Docker Management

up: ## Start all services
	@echo "$(BLUE)🚀 Starting all services...$(NC)"
	@docker-compose up -d
	@echo "$(GREEN)✓ Services started$(NC)"

down: ## Stop all services
	@echo "$(BLUE)🛑 Stopping all services...$(NC)"
	@docker-compose down
	@echo "$(GREEN)✓ Services stopped$(NC)"

restart: ## Restart all services
	@echo "$(BLUE)🔄 Restarting all services...$(NC)"
	@docker-compose restart
	@echo "$(GREEN)✓ Services restarted$(NC)"

ps: ## Show running containers
	@docker-compose ps