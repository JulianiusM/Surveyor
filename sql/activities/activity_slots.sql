CREATE TABLE activity_slots
(
    id            CHAR(36) PRIMARY KEY,
    plan_id       CHAR(36)     NOT NULL,
    day           DATE         NOT NULL,
    pos           INT       DEFAULT 0,
    title         VARCHAR(255) NOT NULL,
    description   TEXT,
    max_assignees INT       DEFAULT 1,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES activity_plans (id) ON DELETE CASCADE
);