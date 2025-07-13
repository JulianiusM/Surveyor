CREATE TABLE activity_assignments
(
    id         INT AUTO_INCREMENT PRIMARY KEY,
    slot_id    CHAR(36) NOT NULL,
    plan_id    CHAR(36) NOT NULL,
    user_id    INT      NULL,
    guest_id   INT      NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (slot_id) REFERENCES activity_slots (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES activity_plans (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES guests (id) ON DELETE CASCADE,
    CONSTRAINT chk_activity_assign_user_or_guest
        CHECK ( (user_id IS NOT NULL AND guest_id IS NULL)
            OR (user_id IS NULL AND guest_id IS NOT NULL) ),
    UNIQUE KEY uk_activity_assign_user (slot_id, user_id),
    UNIQUE KEY uk_activity_assign_guest (slot_id, guest_id)
);