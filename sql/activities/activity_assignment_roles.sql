CREATE TABLE activity_assignment_roles
(
    assignment_id INT      NOT NULL,      -- FK to activity_assignments
    role_id       SMALLINT NOT NULL,      -- FK to roles
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (assignment_id, role_id), -- one row per role per assignment
    FOREIGN KEY (assignment_id) REFERENCES activity_assignments (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles (id) ON UPDATE CASCADE ON DELETE RESTRICT
);
