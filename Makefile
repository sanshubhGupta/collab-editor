.PHONY: up down reset logs psql redis-cli

up:
	docker compose up -d

down:
	docker compose down

reset:
	docker compose down -v
	docker compose up -d

logs:
	docker compose logs -f

psql:
	docker exec -it collab_postgres psql -U collab_user -d collab_db

redis-cli:
	docker exec -it collab_redis redis-cli
	