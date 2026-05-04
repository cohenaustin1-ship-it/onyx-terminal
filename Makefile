# ─── Onyx Terminal — operations Makefile ────────────────────────────────

.PHONY: help dev down logs check spa build clean

help:
	@echo "Onyx Terminal — backend stack"
	@echo ""
	@echo "  make dev        — start all 3 backends + postgres in foreground"
	@echo "  make dev-bg     — same but detached"
	@echo "  make down       — stop and remove containers"
	@echo "  make clean      — also drop volumes"
	@echo "  make logs       — tail all backend logs"
	@echo "  make check      — verify all 3 backends respond to /health"
	@echo "  make spa        — run the SPA dev server (separate terminal)"
	@echo "  make build      — npm run build (production SPA bundle)"

dev:
	@if [ ! -f services/tick-ingestion/.env ]; then \
	  cp services/tick-ingestion/.env.example services/tick-ingestion/.env; \
	  echo "✓ created services/tick-ingestion/.env"; \
	fi
	@if [ ! -f services/executor/.env ]; then \
	  cp services/executor/.env.example services/executor/.env; \
	  echo "✓ created services/executor/.env"; \
	fi
	@if [ ! -f services/agent/.env ]; then \
	  cp services/agent/.env.example services/agent/.env; \
	  echo "✓ created services/agent/.env"; \
	  echo ""; \
	  echo "→ Edit services/agent/.env to set ANTHROPIC_API_KEY"; \
	  echo ""; \
	fi
	docker compose up --build

dev-bg:
	docker compose up --build -d

down:
	docker compose down

clean:
	docker compose down -v

logs:
	docker compose logs -f tick-ingestion executor agent

check:
	@echo "Checking tick-ingestion..."
	@curl -sf http://localhost:8001/health > /dev/null && echo "  ✓ tick-ingestion OK" || echo "  ✗ tick-ingestion DOWN"
	@echo "Checking executor..."
	@curl -sf http://localhost:8002/health > /dev/null && echo "  ✓ executor OK" || echo "  ✗ executor DOWN"
	@echo "Checking agent..."
	@curl -sf http://localhost:7777/health > /dev/null && echo "  ✓ agent OK" || echo "  ✗ agent DOWN"

spa:
	npm run dev

build:
	npm run build
