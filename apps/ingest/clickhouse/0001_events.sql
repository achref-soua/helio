-- The event store (ADR-0007/0010). At-least-once delivery from the bus is
-- deduplicated by ReplacingMergeTree: a redelivered message carries the
-- same sort key, so background merges collapse it. Query-time exactness
-- needs FINAL or GROUP BY message_id; campaign analytics tolerates the
-- merge lag.
CREATE TABLE IF NOT EXISTS events (
    organization_id String,
    workspace_id    String,
    message_id      String,
    type            LowCardinality(String),
    event           String,
    anonymous_id    String,
    user_id         String,
    properties      String CODEC(ZSTD(3)),
    context         String CODEC(ZSTD(3)),
    timestamp       DateTime64(3, 'UTC'),
    received_at     DateTime64(3, 'UTC'),
    INDEX idx_event event TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_user_id user_id TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (workspace_id, timestamp, message_id)
