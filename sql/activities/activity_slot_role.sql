CREATE TABLE activity_slot_role
(
    slot_id CHAR(36) NOT NULL,
    role_id SMALLINT NOT NULL,
    max_qty SMALLINT NOT NULL, -- e.g. 1 for 'chef'
    PRIMARY KEY (slot_id, role_id),
    FOREIGN KEY (slot_id) REFERENCES activity_slots (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles (id) ON UPDATE CASCADE ON DELETE RESTRICT
);

DELIMITER $$

CREATE TRIGGER trg_check_slot_role_limit
    BEFORE INSERT
    ON activity_assignment_roles
    FOR EACH ROW
BEGIN
    DECLARE v_max SMALLINT;
    DECLARE v_cnt INT;

    -- Look up cap (NULL = unlimited)
    SELECT max_qty
    INTO v_max
    FROM activity_slot_role
    WHERE slot_id = (SELECT slot_id
                     FROM activity_assignments
                     WHERE id = NEW.assignment_id)
      AND role_id = NEW.role_id;

    IF v_max IS NOT NULL THEN
        SELECT COUNT(*)
        INTO v_cnt
        FROM activity_assignment_roles ar
                 JOIN activity_assignments aa ON aa.id = ar.assignment_id
        WHERE aa.slot_id = (SELECT slot_id
                            FROM activity_assignments
                            WHERE id = NEW.assignment_id)
          AND ar.role_id = NEW.role_id;

        IF v_cnt >= v_max THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Role capacity reached for this slot';
        END IF;
    END IF;
END$$

DELIMITER ;