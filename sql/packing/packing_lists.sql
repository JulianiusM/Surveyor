CREATE TABLE IF NOT EXISTS packing_lists
(
    id              CHAR(36) PRIMARY KEY,
    owner_id        INT          NOT NULL,
    title           VARCHAR(255) NOT NULL,
    allow_guest_add TINYINT(1)   NOT NULL DEFAULT 0,
    guest_manage    TINYINT(1)   NOT NULL DEFAULT 0,
    created_at      TIMESTAMP             DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp             default current_timestamp() not null on update current_timestamp(),
    FOREIGN KEY (owner_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);