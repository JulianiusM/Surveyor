-- Master list of every role your product supports
CREATE TABLE roles
(
    id          SMALLINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,   -- e.g. 'chef', 'coordinator'
    description TEXT,
    is_default  TINYINT(1)  NOT NULL DEFAULT 0 -- roles automatically granted to every assignee
);