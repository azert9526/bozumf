from db import get_pool

# Funcție care extrage platforma si id-ul video din URL
async def process_video_url(url: str):
    # In Node se verifica doar youtube
    if "youtube" in url and "v=" in url:
        video_id = url.split("v=")[1].split("&")[0]
        return {"platform": "youtube", "video_id": video_id}
    raise ValueError("Platforma neacceptata")


# Verifica daca exista video in baza de date
async def check_video_exists(url: str):
    params = await process_video_url(url)
    pool = await get_pool()

    query = """
        SELECT id FROM Video
        WHERE platform = $1 AND video_id = $2
    """

    row = await pool.fetchrow(query, params["platform"], params["video_id"])
    return row is not None


# Returneaza blockerele asociate video-ului
async def fetch_blockers(url: str):
    params = await process_video_url(url)
    pool = await get_pool()

    query_video = """
        SELECT id FROM Video
        WHERE platform = $1 AND video_id = $2
    """

    video_row = await pool.fetchrow(query_video, params["platform"], params["video_id"])
    if not video_row:
        return None

    video_id = video_row["id"]

    query_blockers = """
        SELECT id, start_time_ms, end_time_ms, description
        FROM Blocker
        WHERE video_id = $1
    """

    rows = await pool.fetch(query_blockers, video_id)

    blockers = []
    for r in rows:
        blockers.append({
            "id": r["id"],
            "start_time_ms": r["start_time_ms"],
            "end_time_ms": r["end_time_ms"],
            "description": r["description"]
        })

    return blockers


# Adauga video + blockere in baza de date
async def add_to_database(url: str, blockers):
    params = await process_video_url(url)
    pool = await get_pool()

    # Insert video
    query_video = """
        INSERT INTO Video (platform, video_id)
        VALUES ($1, $2)
        RETURNING id
    """

    row = await pool.fetchrow(query_video, params["platform"], params["video_id"])
    video_id = row["id"]

    # Insert blockere
    query_blocker = """
        INSERT INTO Blocker (video_id, start_time_ms, end_time_ms, description)
        VALUES ($1, $2, $3, $4)
    """

    for b in blockers:
        await pool.execute(
            query_blocker,
            video_id,
            b["start_time_ms"],
            b["end_time_ms"],
            b["description"]
        )
