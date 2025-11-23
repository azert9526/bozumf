import asyncpg

pool = None

# Tinem o conexiune globala la baza de date
async def get_pool():
    global pool
    if pool is None:
        pool = await asyncpg.create_pool(
            user="postgres",
            password="postgres",
            database="visionproxy",
            host="localhost",
            port=5432
        )
    return pool
