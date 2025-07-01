CREATE TABLE IF NOT EXISTS packing_assignments
(
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT                                 NULL,
    guest_id   INT                                 NULL,
    list_id    CHAR(36)                            NOT NULL,
    item_id    CHAR(36)                            NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        ON UPDATE CURRENT_TIMESTAMP,

    -- 1) Referenzen
    FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES guests (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES packing_items (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (list_id) REFERENCES packing_lists (id)
        ON UPDATE CASCADE ON DELETE CASCADE,

    -- 2) Entweder User **oder** Gast
    CONSTRAINT chk_user_or_guest
        CHECK (
            (user_id IS NOT NULL AND guest_id IS NULL) OR
            (user_id IS NULL AND guest_id IS NOT NULL)
            ),

    -- 3) Jeder User/Gast darf ein Item nur einmal übernehmen
    UNIQUE KEY uk_unique_assignment (item_id, user_id, guest_id)
);