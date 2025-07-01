CREATE TABLE IF NOT EXISTS packing_items
(
    id            CHAR(36) PRIMARY KEY,
    list_id       CHAR(36)                              NOT NULL,
    title         VARCHAR(255)                          NOT NULL,
    description   VARCHAR(255),
    max_assignees INT       DEFAULT 1,
    position      INT       DEFAULT 0,
    created_at    timestamp default current_timestamp() not null,
    updated_at    timestamp default current_timestamp() not null on update current_timestamp(),
    FOREIGN KEY (list_id) REFERENCES packing_lists (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);