CREATE TABLE "DeezerAccount" (
    "id"             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id"        TEXT NOT NULL,
    "label"          TEXT,
    "sync_loved"     BOOLEAN NOT NULL DEFAULT true,
    "sync_albums"    BOOLEAN NOT NULL DEFAULT true,
    "sync_playlists" BOOLEAN NOT NULL DEFAULT true,
    "created_at"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "DeezerAccount_user_id_key" ON "DeezerAccount"("user_id");
