CREATE TABLE IF NOT EXISTS drivers_items
(
    id            CHAR(36) PRIMARY KEY,
    list_id       CHAR(36)                              NOT NULL,
    title         VARCHAR(255)                          NOT NULL,
    description   VARCHAR(255),
    user_id       INT                                   NULL,
    guest_id      INT                                   NULL,
    max_assignees INT       DEFAULT 1,
    pos           INT       DEFAULT 0,
    created_at    timestamp default current_timestamp() not null,
    updated_at    timestamp default current_timestamp() not null on update current_timestamp(),
    FOREIGN KEY (list_id) REFERENCES drivers_lists (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE RESTRICT ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES guests (id)
        ON UPDATE RESTRICT ON DELETE CASCADE,

    -- 2) Entweder User **oder** Gast
    CONSTRAINT chk_driver_item_user_or_guest
        CHECK (
            (user_id IS NOT NULL AND guest_id IS NULL) OR
            (user_id IS NULL AND guest_id IS NOT NULL)
            )
);