.PHONY: help setup dev build test db-up db-down migrate seed clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup: db-up ## Full initial setup
	cd backend && npm install
	@sleep 3
	cd backend && npx prisma migrate dev --name init
	cd backend && npm run prisma:seed
	@echo "\n  Setup complete. Run 'make dev' to start.\n"

dev: ## Start dev server
	cd backend && npm run start:dev

build: ## Build for production
	cd backend && npm run build

test: ## Run tests
	cd backend && npm test

db-up: ## Start PostgreSQL
	docker-compose up -d postgres

db-down: ## Stop PostgreSQL
	docker-compose down

migrate: ## Run database migrations
	cd backend && npx prisma migrate dev

seed: ## Seed the database
	cd backend && npm run prisma:seed

clean: ## Remove build artifacts
	rm -rf backend/dist backend/coverage
