CREATE TABLE activity_plans
(
    id              CHAR(36) PRIMARY KEY,
    owner_id        INT          NOT NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT         NULL,
    start_date      DATE         NOT NULL,
    end_date        DATE         NOT NULL,
    allow_guest_add TINYINT(1)   NOT NULL DEFAULT 0,
    guest_manage    TINYINT(1)   NOT NULL DEFAULT 0,
    created_at      TIMESTAMP             DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP             DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);